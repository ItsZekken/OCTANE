import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  defaultCalibratedGaugePct,
  buildGaugeCalibrationModel,
  evaluateGaugeCalibration
} from '../src/core/gauge-calibration.js';
import { calculateTelemetryModel, calibratedGaugePct } from '../src/core/telemetry-engine.js';
import { reconcileTripsAgainstClosedCycles } from '../src/core/iopgps-sync.js';
import { predictTripGallonsWithPhysics } from '../src/core/fuel-physics-engine.js';
import { generateOperationalDiagnostic } from '../src/core/diagnostic-engine.js';
import { normalizeTelemetryLog } from '../src/core/db-local.js';

describe('Empirical Fuel Gauge Calibration Engine', () => {
  test('1. Zero samples falls back to mode="prior" and matches defaultCalibratedGaugePct identically', () => {
    const model = buildGaugeCalibrationModel([], { tankMaxGal: 9.25 });
    assert.equal(model.mode, 'prior');
    assert.equal(model.sampleCount, 0);
    assert.equal(model.directCount, 0);
    assert.equal(model.retroactiveCount, 0);
    assert.equal(model.confidence, 0);
    assert.deepEqual(model.knots, []);

    for (const p of [0, 10, 27, 50, 75, 100]) {
      assert.equal(evaluateGaugeCalibration(p, model), defaultCalibratedGaugePct(p));
      assert.equal(model.mapPct(p), defaultCalibratedGaugePct(p));
      assert.equal(evaluateGaugeCalibration(p, null), defaultCalibratedGaugePct(p));
    }
  });

  test('2. Real user scenario: 5.67 gal full refuel at 27% pre_refuel_gauge_pct learns empirical curve near 38.7%', () => {
    const logs = [
      {
        id: '2026-09-01',
        date: '2026-09-01',
        odometer_reading: 97000,
        fuel_level_percent: 100,
        gallons_added: 6.1,
        is_full_tank: true
      },
      {
        id: '2026-09-10',
        date: '2026-09-10',
        odometer_reading: 97210,
        fuel_level_percent: 100,
        gallons_added: 5.67,
        is_full_tank: true,
        pre_refuel_gauge_pct: 27
      }
    ];

    const model = buildGaugeCalibrationModel(logs, { tankMaxGal: 9.25 });
    assert.equal(model.mode, 'empirical');
    assert.equal(model.directCount, 1);
    assert.equal(model.retroactiveCount, 0);
    assert.equal(model.sampleCount, 1);

    const legacyPct = defaultCalibratedGaugePct(27); // ~20.3%
    const learnedPct = evaluateGaugeCalibration(27, model);
    assert.ok(legacyPct < 22, `Expected legacyPct ~20.3, got ${legacyPct}`);
    assert.ok(Math.abs(learnedPct - 38.7) <= 2.5, `Expected learnedPct close to 38.7%, got ${learnedPct}%`);
    assert.ok(Math.abs(learnedPct - 38.7) < Math.abs(legacyPct - 38.7));

    const mappedGal = model.mapGallons(27);
    assert.ok(mappedGal >= 3.4 && mappedGal <= 3.6, `Expected mapGallons(27) in [3.4, 3.6], got ${mappedGal}`);
  });

  test('3. Adjacent reading within 3 km before full refuel automatically produces a direct_refuel anchor', () => {
    const logs = [
      {
        id: '2026-09-10_reading',
        date: '2026-09-10',
        time: '09:30',
        odometer_reading: 97207,
        fuel_level_percent: 27,
        gallons_added: 0,
        is_full_tank: false
      },
      {
        id: '2026-09-10_refuel',
        date: '2026-09-10',
        time: '09:45',
        odometer_reading: 97210,
        fuel_level_percent: 100,
        gallons_added: 5.67,
        is_full_tank: true
      }
    ];

    const model = buildGaugeCalibrationModel(logs, { tankMaxGal: 9.25 });
    assert.equal(model.mode, 'empirical');
    assert.equal(model.directCount, 1);
    assert.equal(model.retroactiveCount, 0);
    assert.equal(model.samples[0].source, 'direct_refuel');
    assert.equal(model.samples[0].weight, 3.0);
    assert.equal(model.samples[0].needlePct, 27);
    assert.ok(Math.abs(evaluateGaugeCalibration(27, model) - 38.7) <= 2.5);

    // Reading > 5 km away or > 18 hours away should NOT become a direct_refuel anchor
    const tooFarLogs = [
      {
        id: 'r_far',
        date: '2026-09-10',
        time: '08:00',
        odometer_reading: 97200,
        fuel_level_percent: 27,
        gallons_added: 0
      },
      {
        id: 'f_far',
        date: '2026-09-10',
        time: '09:00',
        odometer_reading: 97210,
        fuel_level_percent: 100,
        gallons_added: 5.67,
        is_full_tank: true
      }
    ];
    const farModel = buildGaugeCalibrationModel(tooFarLogs, { tankMaxGal: 9.25 });
    assert.equal(farModel.directCount, 0);
    assert.equal(farModel.mode, 'prior');
  });

  test('4. Retroactive intermediate reading at 50% halfway through 6.0 gal cycle learns 6.25 gal (67.6%)', () => {
    const logs = [
      {
        id: '2026-09-01',
        date: '2026-09-01',
        odometer_reading: 10000,
        fuel_level_percent: 100,
        gallons_added: 0,
        is_full_tank: true
      },
      {
        id: '2026-09-05',
        date: '2026-09-05',
        odometer_reading: 10100,
        fuel_level_percent: 50,
        gallons_added: 0,
        is_full_tank: false
      },
      {
        id: '2026-09-10',
        date: '2026-09-10',
        odometer_reading: 10200,
        fuel_level_percent: 100,
        gallons_added: 6.0,
        is_full_tank: true
      }
    ];

    const model = buildGaugeCalibrationModel(logs, { tankMaxGal: 9.25 });
    assert.equal(model.mode, 'empirical');
    assert.equal(model.directCount, 0);
    assert.equal(model.retroactiveCount, 1);
    assert.equal(model.samples[0].source, 'retroactive_reading');
    assert.equal(model.samples[0].weight, 1.5);
    assert.equal(model.samples[0].realGal, 6.25);
    assert.ok(Math.abs(model.samples[0].realPct - 67.57) <= 0.1);
    assert.ok(evaluateGaugeCalibration(50, model) > 60);
  });

  test('4b. Retroactive reading uses tripsByDate when trips cover the cycle window cleanly', () => {
    const logs = [
      {
        id: '2026-09-01',
        date: '2026-09-01',
        odometer_reading: 10000,
        fuel_level_percent: 100,
        gallons_added: 0,
        is_full_tank: true
      },
      {
        id: '2026-09-04',
        date: '2026-09-04',
        odometer_reading: 10100,
        fuel_level_percent: 45,
        gallons_added: 0,
        is_full_tank: false
      },
      {
        id: '2026-09-08',
        date: '2026-09-08',
        odometer_reading: 10200,
        fuel_level_percent: 100,
        gallons_added: 6.0,
        is_full_tank: true
      }
    ];

    const tripsByDate = {
      '2026-09-02': [{ estGallons: 4.0 }],
      '2026-09-06': [{ estGallons: 2.0 }]
    };

    const model = buildGaugeCalibrationModel(logs, { tankMaxGal: 9.25, tripsByDate });
    assert.equal(model.retroactiveCount, 1);
    // 2.0 / 6.0 of 6.0 gal burned after reading -> realGal = (9.25 - 6.0) + 2.0 = 5.25 gal
    assert.equal(model.samples[0].realGal, 5.25);
  });

  test('5. Noisy non-monotonic samples are enforced strictly non-decreasing by PAVA across 0..100', () => {
    const logs = [
      {
        id: '2026-09-01',
        date: '2026-09-01',
        odometer_reading: 10000,
        fuel_level_percent: 100,
        gallons_added: 0,
        is_full_tank: true
      },
      {
        id: '2026-09-05',
        date: '2026-09-05',
        odometer_reading: 10150,
        fuel_level_percent: 100,
        // 9.25 - 5.0875 = 4.1625 gal = 45.0% real at 30% needle
        gallons_added: 5.088,
        is_full_tank: true,
        pre_refuel_gauge_pct: 30
      },
      {
        id: '2026-09-10',
        date: '2026-09-10',
        odometer_reading: 10300,
        fuel_level_percent: 100,
        // 9.25 - 5.365 = 3.885 gal = 42.0% real at 40% needle (inverted vs 30%!)
        gallons_added: 5.365,
        is_full_tank: true,
        pre_refuel_gauge_pct: 40
      }
    ];

    const model = buildGaugeCalibrationModel(logs, { tankMaxGal: 9.25 });
    assert.equal(model.mode, 'empirical');
    assert.equal(model.directCount, 2);

    let prev = -1;
    for (let p = 0; p <= 100; p++) {
      const val = evaluateGaugeCalibration(p, model);
      assert.ok(val >= prev, `Non-monotonic at ${p}%: ${val} < ${prev}`);
      prev = val;
    }
    assert.ok(evaluateGaugeCalibration(40, model) >= evaluateGaugeCalibration(30, model));
  });

  test('6. JSON-deserialized model still works identically with evaluateGaugeCalibration', () => {
    const logs = [
      {
        id: '2026-09-10',
        date: '2026-09-10',
        odometer_reading: 97210,
        fuel_level_percent: 100,
        gallons_added: 5.67,
        is_full_tank: true,
        pre_refuel_gauge_pct: 27
      }
    ];

    const model = buildGaugeCalibrationModel(logs, { tankMaxGal: 9.25 });
    const plain = JSON.parse(JSON.stringify(model));
    assert.equal(plain.mapPct, undefined);

    for (let p = 0; p <= 100; p += 5) {
      assert.equal(
        evaluateGaugeCalibration(p, plain),
        evaluateGaugeCalibration(p, model),
        `Mismatch at ${p}% after JSON roundtrip`
      );
    }
  });
});

describe('Phase 1 Precision Integration: Time-Exact Split, Historical Prices, Ridge Loop & Diagnostic Unification', () => {
  test('7. Time-exact refuel boundary keeps morning trip in old cycle and afternoon trip in open cycle with Ridge prediction', () => {
    const logs = [
      {
        id: 'ref-1',
        date: '2026-11-15',
        time: '09:00',
        odometer_reading: 97000,
        fuel_level_percent: 100,
        gallons_added: 6.0,
        total_cost_cop: 90000, // $15.000/gal
        is_full_tank: true
      },
      {
        id: 'ref-2',
        date: '2026-11-23',
        time: '12:00',
        odometer_reading: 97200,
        fuel_level_percent: 100,
        gallons_added: 5.67,
        total_cost_cop: 87885, // $15.500/gal
        is_full_tank: true,
        pre_refuel_gauge_pct: 27
      }
    ];

    const model = calculateTelemetryModel(logs, { tankCapacityGallons: 9.25, fuelPriceCop: 16500 });
    assert.equal(model.closedCycles.length, 1);
    const cycle = model.closedCycles[0];
    assert.equal(cycle.pricePerGal, 15500);
    assert.ok(Number.isFinite(cycle.startTimeMs) && Number.isFinite(cycle.endTimeMs));
    assert.equal(model.gaugeCalibration.mode, 'empirical');
    assert.ok(calibratedGaugePct(27, model.gaugeCalibration) > 35);

    const morningMs = Date.parse('2026-11-23T08:30:00-05:00');
    const afternoonMs = Date.parse('2026-11-23T15:30:00-05:00');
    const tripsByDate = {
      '2026-11-20': [{ id: 't1', date: '2026-11-20', startTimeMs: Date.parse('2026-11-20T10:00:00-05:00'), distanceKm: 120, estGallons: 3.5, estCostCop: 57750 }],
      '2026-11-23': [
        { id: 't2-am', date: '2026-11-23', startTimeMs: morningMs, distanceKm: 60, estGallons: 1.8, estCostCop: 29700 },
        { id: 't3-pm', date: '2026-11-23', startTimeMs: afternoonMs, distanceKm: 30, avgSpeedKmh: 18, stoppedTimeSec: 600, thermalRetentionPct: 10, estGallons: 0.9, estCostCop: 14850, isCalibrated: true, reconciledGallons: 0.9, reconciledCostCop: 14850 }
      ]
    };

    const ridgeModel = {
      mode: 'ridge',
      coeffs: { galPerKmBase: 0.028, galPerIdleHour: 0.22, galPerTrafficKm: 0.01, galPerColdStart: 0.03 }
    };

    const rec = reconcileTripsAgainstClosedCycles(tripsByDate, model.closedCycles, 16500, { fuelPhysicsModel: ridgeModel });
    const t1 = rec['2026-11-20'][0];
    const t2Am = rec['2026-11-23'][0];
    const t3Pm = rec['2026-11-23'][1];

    // Morning trip stays in closed cycle and uses historical $15.500/gal (NOT $16.500/gal)
    assert.equal(t1.isCalibrated, true);
    assert.equal(t2Am.isCalibrated, true);
    assert.ok(Math.abs((t1.reconciledGallons + t2Am.reconciledGallons) - 5.67) <= 0.01);
    assert.equal(t2Am.reconciledCostCop, Math.round(t2Am.reconciledGallons * 15500));

    // Afternoon trip AFTER 12:00 refuel is in open cycle, stale calibration cleared, Ridge applied at current $16.500/gal
    assert.equal(Boolean(t3Pm.isCalibrated), false);
    assert.equal(t3Pm.reconciledGallons, undefined);
    assert.equal(t3Pm.reconciledCostCop, undefined);
    assert.equal(t3Pm.physicsModel, 'ridge');
    const expectedRidgeGal = predictTripGallonsWithPhysics(t3Pm, ridgeModel.coeffs);
    assert.equal(t3Pm.estGallons, expectedRidgeGal);
    assert.equal(t3Pm.estCostCop, Math.round(expectedRidgeGal * 16500));
  });

  test('8. Diagnostic engine unifies fuelBreakdown with GPS calibrated totals without double-counting idle', () => {
    const profile = {
      tankCapacityGallons: 9.25,
      fuelPriceCop: 15430,
      defaultEfficiencyKmGal: 33.71,
      routineDailyKm: 24,
      gpsCache: {
        days: {
          '2026-11-23': { date: '2026-11-23', km: 75.35, runTimeSec: 12000, idleAccOnSec: 2400 }
        },
        tripsByDate: {
          '2026-11-23': [
            { id: 'c1', date: '2026-11-23', startTimeMs: Date.parse('2026-11-23T07:38:00-05:00'), endTimeMs: Date.parse('2026-11-23T08:10:00-05:00'), distanceKm: 12.23, reconciledGallons: 0.367, reconciledCostCop: 5663, isCalibrated: true },
            { id: 'w1', date: '2026-11-23', startTimeMs: Date.parse('2026-11-23T18:13:00-05:00'), endTimeMs: Date.parse('2026-11-23T22:30:00-05:00'), distanceKm: 63.12, reconciledGallons: 1.893, reconciledCostCop: 29210, isCalibrated: true }
          ]
        }
      }
    };

    const diag = generateOperationalDiagnostic({
      vehicleProfile: profile,
      telemetryLogs: [{ id: 'l1', date: '2026-11-23', odometer_reading: 97275, fuel_level_percent: 60 }],
      rideSessions: [
        { id: 'r1', date: '2026-11-23', platform: 'Uber', fareCop: 67000, distanceKm: 40 }
      ],
      platformPasses: []
    }, { startDate: '2026-11-23', endDate: '2026-11-23', label: 'LUN 23 NOV' });

    assert.equal(diag.fuelBreakdown.fuelDataSource, 'gps');
    assert.equal(diag.fuelBreakdown.isGpsCalibrated, true);
    assert.equal(diag.fuelBreakdown.totalCarFuelCop, 34873);
    assert.equal(
      diag.fuelBreakdown.fuelBaseCop + diag.fuelBreakdown.fuelRidesCop + diag.fuelBreakdown.fuelPickupCop,
      diag.fuelBreakdown.totalCarFuelCop
    );
  });

  test('9. normalizeTelemetryLog preserves pre_refuel_gauge_pct, stationId, and stationName across persistence', () => {
    const normalized = normalizeTelemetryLog({
      id: '2026-11-24_ref',
      date: '2026-11-24',
      odometer_reading: 97200,
      fuel_level_percent: 100,
      pre_refuel_gauge_pct: 27,
      gallons_added: 5.67,
      is_full_tank: true,
      total_cost_cop: 90720,
      stationId: 'st_terpel_1',
      stationName: 'Terpel Norte'
    });
    assert.equal(normalized.pre_refuel_gauge_pct, 27);
    assert.equal(normalized.stationId, 'st_terpel_1');
    assert.equal(normalized.stationName, 'Terpel Norte');
  });
});
