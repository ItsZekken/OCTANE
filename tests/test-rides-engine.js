import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateCostPerKm,
  resolveDayOdometerDelta,
  calculateRidesCycleSummary,
  MAX_PICKUP_RATIO
} from '../src/core/rides-engine.js';
import { generateOperationalDiagnostic } from '../src/core/diagnostic-engine.js';

describe('Rides Engine', () => {
  test('calculateCostPerKm resolves fuelPrice / efficiency and guards zero values', () => {
    assert.equal(calculateCostPerKm({ fuelPriceCop: 16000, efficiencyKmGal: 32 }), 500);
    assert.equal(calculateCostPerKm({ fuelPriceCop: 16000, efficiencyKmGal: 33.71, exact: true }), 474.64);
    const fallbackCost = calculateCostPerKm({});
    assert.ok(Number.isFinite(fallbackCost) && fallbackCost > 0);
  });

  test('resolveDayOdometerDelta handles same-day multiple readings, previous day span, and missing logs', () => {
    const empty = resolveDayOdometerDelta('2026-09-10', []);
    assert.equal(empty.hasClosing, false);
    assert.equal(empty.deltaOdo, 0);

    const logs = [
      { date: '2026-09-08', odometer_reading: 90000 },
      { date: '2026-09-10', odometer_reading: 90120 },
      { date: '2026-09-11', odometer_reading: 90130 },
      { date: '2026-09-11', odometer_reading: 90210 }
    ];

    const multiDay = resolveDayOdometerDelta('2026-09-10', logs);
    assert.equal(multiDay.hasClosing, true);
    assert.equal(multiDay.deltaOdo, 120);
    assert.equal(multiDay.daysElapsed, 2);
    assert.equal(multiDay.isMultiDaySpan, true);

    const sameDay = resolveDayOdometerDelta('2026-09-11', logs);
    assert.equal(sameDay.hasClosing, true);
    assert.equal(sameDay.deltaOdo, 80);
    assert.equal(sameDay.daysElapsed, 1);
  });

  test('calculateRidesCycleSummary applies en-route credit and caps pickup deadhead km', () => {
    const telemetryLogs = [
      { date: '2026-09-10', odometer_reading: 90000 },
      { date: '2026-09-11', odometer_reading: 90200 } // deltaOdo = 200 km, plenty of excess above routine + rides
    ];

    const sessions = [
      {
        id: 'r1',
        date: '2026-09-11',
        platform: 'Uber',
        grossEarnings: 40000,
        distanceKm: 20,
        isEnRoute: true // Within 24 km routine credit -> 0 detour km
      },
      {
        id: 'r2',
        date: '2026-09-11',
        platform: 'DiDi',
        grossEarnings: 50000,
        distanceKm: 25,
        isEnRoute: false // 25 km free work
      }
    ];

    const summary = calculateRidesCycleSummary({
      sessions,
      passes: [{ id: 'p1', date: '2026-09-11', platform: 'DiDi', amountCop: 4000 }],
      profile: { fuelPriceCop: 16000, routineDailyKm: 24, defaultEfficiencyKmGal: 32 },
      telemetryLogs,
      cycleType: 'custom',
      startDate: '2026-09-11',
      endDate: '2026-09-11'
    });

    // En-route 20 km <= 24 km routine credit -> 20 km credit used, 0 detour
    assert.equal(summary.totalRouteCreditUsedKm, 20);
    assert.equal(summary.totalEnRouteKm, 20);
    assert.equal(summary.totalFreeKm, 25);

    // Max pickup cap: 25 * 0.40 (10) + min(1.5, 20*0.15=3 -> 1.5) = 11.5 km
    const expectedMaxPickup = Number(((25 * MAX_PICKUP_RATIO) + 1.5).toFixed(1));
    assert.equal(summary.totalPickupKm, expectedMaxPickup);
    assert.equal(summary.totalExtraKm, Number((25 + expectedMaxPickup).toFixed(1)));
    assert.equal(summary.grossRevenueCop, 90000);
    assert.equal(summary.totalExpensesCop, 4000);
    assert.equal(summary.wearReserveCop, 9000);
  });
});

describe('Diagnostic Engine', () => {
  test('generateOperationalDiagnostic computes pocket balance and guards empty state', () => {
    const emptyDiag = generateOperationalDiagnostic({}, 'this_month');
    assert.equal(emptyDiag.cashFlow.grossRevenueCop, 0);
    assert.equal(emptyDiag.platformBreakdown.length, 0);

    const diag = generateOperationalDiagnostic({
      vehicleProfile: { name: 'Test Car', fuelPriceCop: 16000, routineDailyKm: 24, tankCapacityGallons: 9.25 },
      telemetryModel: { fullEraAvgEff: 32, fuelPriceCop: 16000 },
      telemetryLogs: [
        { date: '2026-09-01', odometer_reading: 90000, gallons_added: 5, is_full_tank: true },
        { date: '2026-09-02', odometer_reading: 90080, gallons_added: 0, is_full_tank: false }
      ],
      rideSessions: [
        { id: 's1', date: '2026-09-02', platform: 'uber', grossEarnings: 80000, distanceKm: 30, isEnRoute: false }
      ],
      platformPasses: []
    }, { startDate: '2026-09-01', endDate: '2026-09-02', label: 'TEST' });

    assert.equal(diag.cashFlow.grossRevenueCop, 80000);
    assert.equal(diag.platformBreakdown.length, 1);
    assert.equal(diag.platformBreakdown[0].platform, 'Uber');
    assert.ok(diag.fuelBreakdown.totalCarFuelCop > 0);
  });
});
