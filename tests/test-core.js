import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateTelemetryModel,
  formatEff,
  formatVol,
  buildInterpolatedDailySeries,
  computeCyclePhysicalTelemetry,
  GAL_TO_L
} from '../src/core/telemetry-engine.js';
import {
  computeMonthlyFuelMetrics,
  computeCockpitGpsSummary
} from '../src/core/cockpit-analytics.js';
import { sanitizeSnapshotForCloud } from '../src/core/firebase-sync.js';

describe('Telemetry Engine Core', () => {
  test('formatEff and formatVol handle all units and edge cases', () => {
    assert.equal(formatEff(34.5, 'gal', true), '34.50 KM/G');
    assert.equal(formatEff(34.5, 'gal', false), '34.50');
    assert.equal(formatEff(37.8541, 'l100', true), '10.00 L/100');
    assert.equal(formatEff(GAL_TO_L * 10, 'kml', true), '10.00 KM/L');
    assert.equal(formatEff(0, 'gal'), '--');
    assert.equal(formatEff(NaN, 'gal'), '--');

    assert.equal(formatVol(2.5, 'gal', true), '2.50 GAL');
    assert.equal(formatVol(1, 'l', true), `${GAL_TO_L.toFixed(2)} L`);
    assert.equal(formatVol(-1, 'gal', true), '0.00 GAL');
  });

  test('calculateTelemetryModel computes full-to-full cycles and guards empty logs', () => {
    const emptyModel = calculateTelemetryModel([], { tankCapacityGallons: 9.25 });
    assert.equal(emptyModel.processedData.length, 0);
    assert.equal(emptyModel.closedCycles.length, 0);

    const logs = [
      {
        id: '2026-09-01',
        date: '2026-09-01',
        odometer_reading: 90000,
        fuel_level_percent: 100,
        gallons_added: 7.0,
        is_full_tank: true,
        total_cost_cop: 112000
      },
      {
        id: '2026-09-10',
        date: '2026-09-10',
        odometer_reading: 90280,
        fuel_level_percent: 100,
        gallons_added: 8.0,
        is_full_tank: true,
        total_cost_cop: 128000
      },
      {
        id: '2026-09-20',
        date: '2026-09-20',
        odometer_reading: 90630,
        fuel_level_percent: 100,
        gallons_added: 10.0,
        is_full_tank: true,
        total_cost_cop: 160000
      }
    ];

    const model = calculateTelemetryModel(logs, {
      tankCapacityGallons: 9.25,
      tankCapacityLiters: 35,
      reserveLiters: 5,
      fuelPriceCop: 16000
    });

    assert.equal(model.closedCycles.length, 2);
    assert.equal(model.closedCycles[0].dist, 280);
    assert.equal(model.closedCycles[0].eff, 35);
    assert.equal(model.closedCycles[1].dist, 350);
    assert.equal(model.closedCycles[1].eff, 35);
    assert.equal(model.fullEraAvgEff, 35);
    assert.equal(model.stats.totalKm, 630);
    assert.ok(model.activeTankState);
  });

  test('buildInterpolatedDailySeries distributes odometer delta proportionally to GPS days', () => {
    const processed = [
      { date: '2026-09-01', odometer_reading: 10000, gallons_added: 5, isFullTank: true },
      { date: '2026-09-04', odometer_reading: 10100, gallons_added: 3, isFullTank: true }
    ];
    const gpsDaysMap = {
      '2026-09-01': { km: 20, runTimeSec: 1800, idleAccOnSec: 120 },
      '2026-09-02': { km: 0, runTimeSec: 0, idleAccOnSec: 0 },
      '2026-09-03': { km: 80, runTimeSec: 7200, idleAccOnSec: 600 },
      '2026-09-04': { km: 20, runTimeSec: 1800, idleAccOnSec: 120 }
    };
    const series = buildInterpolatedDailySeries(processed, gpsDaysMap);
    assert.equal(series.length, 4);
    const parkedDay = series.find((d) => d.date === '2026-09-02');
    assert.equal(parkedDay.km, 0);
    const totalSum = series.reduce((acc, d) => acc + d.km, 0);
    assert.ok(Math.abs(totalSum - 100) < 0.05);
  });

  test('computeCyclePhysicalTelemetry computes severity factor and guards empty inputs', () => {
    assert.equal(computeCyclePhysicalTelemetry('', '2026-09-10', {}), null);
    assert.equal(computeCyclePhysicalTelemetry('2026-09-01', '2026-09-10', {}), null);

    const phys = computeCyclePhysicalTelemetry('2026-09-01', '2026-09-03', {
      '2026-09-01': { km: 30, runTimeSec: 5400, stayTimeSec: 600, idleAccOnSec: 900, idleAccOnCount: 2, runNo: 4, overspeedNo: 0 },
      '2026-09-02': { km: 40, runTimeSec: 7200, stayTimeSec: 900, idleAccOnSec: 1200, idleAccOnCount: 3, runNo: 6, overspeedNo: 1 }
    });
    assert.ok(phys);
    assert.equal(phys.gpsKm, 70);
    assert.equal(phys.idleAccOnMin, 35);
    assert.ok(phys.severityFactor >= 0.88 && phys.severityFactor <= 1.28);
  });
});

describe('Cockpit Analytics', () => {
  test('computeMonthlyFuelMetrics aggregates current & previous month spend cleanly', () => {
    const logs = [
      { id: '1', date: '2026-08-12', odometer_reading: 89500, gallons_added: 7, total_cost_cop: 112000, is_full_tank: true },
      { id: '2', date: '2026-09-05', odometer_reading: 89800, gallons_added: 6, total_cost_cop: 96000, is_full_tank: true },
      { id: '3', date: '2026-09-14', odometer_reading: 90100, gallons_added: 5, total_cost_cop: 80000, is_full_tank: true }
    ];
    const model = calculateTelemetryModel(logs, { tankCapacityGallons: 9.25, fuelPriceCop: 16000 });
    const metrics = computeMonthlyFuelMetrics(logs, model, 16000, new Date('2026-09-15T12:00:00'));

    assert.equal(metrics.curKey, '2026-09');
    assert.equal(metrics.prevKey, '2026-08');
    assert.equal(metrics.currentMonthSpent, 176000);
    assert.equal(metrics.prevMonthSpent, 112000);
    assert.equal(metrics.currentMonthRefuels, 2);
    assert.ok(metrics.projectedMonthSpent >= metrics.currentMonthSpent);
  });

  test('computeCockpitGpsSummary handles missing GPS cache safely and summarizes cached data', () => {
    const empty = computeCockpitGpsSummary({}, null, new Date('2026-09-15T12:00:00'));
    assert.equal(empty.isConnected, false);
    assert.equal(empty.todayKm, 0);
    assert.equal(empty.batteryLabel, 'SIN DATO');

    const withGps = computeCockpitGpsSummary({
      gpsConfig: { enabled: true, username: 'demo_user', password: 'demo_secret_value' },
      gpsCache: {
        live: {
          totalMile: 90120,
          todayMile: 32.5,
          externalVoltage: 12.7,
          accStatus: false,
          speed: 0,
          address: 'Cl. 56 #13-13 · La Ceiba',
          date: '2026-09-15',
          syncedAt: '2026-09-15T11:59:00.000Z'
        },
        days: {
          '2026-09-15': { km: 32.5, runTimeSec: 3600, runNo: 3 }
        },
        tripsByDate: {
          '2026-09-15': [
            {
              id: 't1',
              date: '2026-09-15',
              startTimeMs: 1789470000000,
              distanceKm: 12.4,
              trackPoints: [{ lat: 10.98, lng: -74.79 }, { lat: 10.99, lng: -74.80 }]
            }
          ]
        }
      }
    }, null, new Date('2026-09-15T12:00:00Z'));

    assert.equal(withGps.isConnected, true);
    assert.equal(withGps.todayKm, 32.5);
    assert.equal(withGps.batteryLabel, 'ÓPTIMA');
    assert.equal(withGps.cachedTripsCount, 1);
    assert.ok(withGps.latestTrip.routeGlyph.startsWith('M '));
  });
});

describe('Firebase Sync Sanitization', () => {
  test('sanitizeSnapshotForCloud strips trackPoints, scrubs GPS password, caps arrays, and enforces byte cap without mutating input', () => {
    const trackPoints = Array.from({ length: 400 }, (_, i) => ({
      lat: 10.95 + i * 0.0001,
      lng: -74.8 + i * 0.0001,
      speed: 35,
      time: 1700000000 + i * 10
    }));
    const tripsByDate = {};
    for (let i = 0; i < 160; i++) {
      const month = String(Math.floor(i / 28) + 1).padStart(2, '0');
      const day = String((i % 28) + 1).padStart(2, '0');
      const dateKey = `2026-${month}-${day}`;
      tripsByDate[dateKey] = [
        {
          id: `trip_${i}`,
          date: dateKey,
          distanceKm: 14.2,
          estCostCop: 6750,
          trackPoints,
          paddingNote: 'X'.repeat(5500)
        }
      ];
    }

    const original = {
      version: 1,
      stores: {
        vehicle_profile: [
          {
            id: 'main',
            name: 'Test Car',
            gpsConfig: {
              enabled: true,
              username: 'demo_user',
              password: 'local_only_password_sample',
              imei: '000000000000001'
            },
            gpsCache: {
              tripsByDate,
              voltageHistory: Array.from({ length: 240 }, (_, i) => ({ t: i, v: 12.6 })),
              notifiedStopIds: Array.from({ length: 90 }, (_, i) => `stop_${i}`)
            }
          }
        ]
      }
    };

    const sanitized = sanitizeSnapshotForCloud(original);
    const sanitizedProfile = sanitized.stores.vehicle_profile[0];

    // Original must remain untouched
    assert.equal(original.stores.vehicle_profile[0].gpsConfig.password, 'local_only_password_sample');
    assert.equal(original.stores.vehicle_profile[0].gpsCache.voltageHistory.length, 240);
    assert.equal(original.stores.vehicle_profile[0].gpsCache.notifiedStopIds.length, 90);
    assert.ok(Object.values(original.stores.vehicle_profile[0].gpsCache.tripsByDate)[0][0].trackPoints.length === 400);

    // Password scrubbed
    assert.equal(sanitizedProfile.gpsConfig.password, '');
    assert.equal(sanitizedProfile.gpsConfig.username, 'demo_user');

    // Arrays capped
    assert.equal(sanitizedProfile.gpsCache.voltageHistory.length, 180);
    assert.equal(sanitizedProfile.gpsCache.voltageHistory[0].t, 60);
    assert.equal(sanitizedProfile.gpsCache.notifiedStopIds.length, 60);
    assert.equal(sanitizedProfile.gpsCache.notifiedStopIds[0], 'stop_30');

    // trackPoints stripped and byte size cap pruned to <= 120 dates
    const remainingDates = Object.keys(sanitizedProfile.gpsCache.tripsByDate).sort();
    assert.equal(remainingDates.length, 120);
    const sampleTrip = sanitizedProfile.gpsCache.tripsByDate[remainingDates[0]][0];
    assert.equal('trackPoints' in sampleTrip, false);
    assert.equal(sampleTrip.distanceKm, 14.2);
  });
});
