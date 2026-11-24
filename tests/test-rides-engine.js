import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateCostPerKm,
  resolveDayOdometerDelta,
  calculateRidesCycleSummary,
  classifyGpsDayTrips,
  MAX_PICKUP_RATIO
} from '../src/core/rides-engine.js';
import { generateOperationalDiagnostic, buildTimeSlotMatrix } from '../src/core/diagnostic-engine.js';

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

  test('reconciles exact GPS calibrated fuel ($34,873), separates routine CASA->TRABAJO trips, and computes GAS TOTAL vs SOLO CARRERAS', () => {
    const home = { lat: 10.9600, lng: -74.8000, label: 'CASA' };
    const work = { lat: 11.0180, lng: -74.8500, label: 'TRABAJO' };
    const cityA = { lat: 10.9950, lng: -74.8100 };
    const cityB = { lat: 10.9850, lng: -74.7950 };

    const mondayTrips = [
      { startLat: home.lat, startLng: home.lng, endLat: work.lat, endLng: work.lng, startTimeHm: '07:38', endTimeHm: '08:10', distanceKm: 12.23, durationSec: 1920, reconciledCostCop: 5660, isCalibrated: true },
      { startLat: work.lat, startLng: work.lng, endLat: cityA.lat, endLng: cityA.lng, startTimeHm: '18:13', endTimeHm: '18:44', distanceKm: 7.26, durationSec: 1860, reconciledCostCop: 3360, isCalibrated: true },
      { startLat: cityA.lat, startLng: cityA.lng, endLat: cityB.lat, endLng: cityB.lng, startTimeHm: '18:50', endTimeHm: '21:27', distanceKm: 46.99, durationSec: 9420, reconciledCostCop: 21748, isCalibrated: true },
      { startLat: cityB.lat, startLng: cityB.lng, endLat: home.lat, endLng: home.lng, startTimeHm: '21:46', endTimeHm: '22:15', distanceKm: 8.46, durationSec: 1740, reconciledCostCop: 3915, isCalibrated: true },
      { startLat: home.lat, startLng: home.lng, endLat: home.lat, endLng: home.lng, startTimeHm: '22:28', endTimeHm: '22:30', distanceKm: 0.41, durationSec: 120, reconciledCostCop: 190, isCalibrated: true }
    ];

    const classified = classifyGpsDayTrips(mondayTrips, { semanticPlaces: { home, work }, costPerKmCop: 448 });
    assert.equal(classified.totalKm, 75.35);
    assert.equal(classified.totalFuelCop, 34873);
    assert.equal(classified.isCalibrated, true);
    assert.equal(classified.hasHomeToWork, true);
    assert.equal(classified.routineTripsCount, 2); // 07:38 commute + 22:28 parking hop
    assert.equal(classified.workTripsCount, 3);
    assert.equal(classified.workWindowStartHm, '18:13');
    assert.equal(classified.workWindowEndHm, '22:15');

    const summary = calculateRidesCycleSummary({
      sessions: [
        { id: 'r1', date: '2026-11-23', platform: 'Uber', grossEarnings: 66620, distanceKm: 32.4, isEnRoute: false }
      ],
      passes: [
        { id: 'p1', date: '2026-11-23', platform: 'Recarga', amountCop: 4000 }
      ],
      profile: {
        fuelPriceCop: 16000,
        routineDailyKm: 24,
        defaultEfficiencyKmGal: 35.7,
        gpsCache: { tripsByDate: { '2026-11-23': mondayTrips } }
      },
      cycleType: 'custom',
      startDate: '2026-11-23',
      endDate: '2026-11-23',
      accountingMode: 'total_fuel'
    });

    // Exact GPS fuel match ($34,873) and 100%-fuel-covered net profit (+$27,747)
    assert.equal(summary.periodCarFuelCop, 34873);
    assert.equal(summary.periodCarKm, 75.35);
    assert.equal(summary.fuelSource, 'gps_calibrated');
    assert.equal(summary.totalFuelNetProfitCop, 66620 - 4000 - 34873);
    assert.equal(summary.activeNetProfitCop, 27747);
    assert.equal(summary.fuelCoveredPct, Math.round((62620 / 34873) * 100)); // 180%
    assert.equal(summary.fuelExpenseCop + summary.personalFuelCop, 34873);
    assert.ok(summary.marginalNetProfitCop > summary.totalFuelNetProfitCop);
  });

  test('buildTimeSlotMatrix ignores createdAt fallback when rides have no explicit time', () => {
    const retroactiveSessions = [
      { id: 'r1', date: '2026-11-23', grossEarnings: 25000, distanceKm: 10, createdAt: '2026-11-24T09:15:00.000Z' }
    ];
    const matrix = buildTimeSlotMatrix(retroactiveSessions, {}, { startDate: '2026-11-01', endDate: '2026-11-30' });
    assert.equal(matrix.hasTimestampedData, false);
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
