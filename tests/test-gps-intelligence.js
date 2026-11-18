import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sanitizeSnapshotForCloud } from '../src/core/firebase-sync.js';
import { importAllStores, mergeVehicleProfileRecords } from '../src/core/db-local.js';
import {
  resolveProxyMode,
  DEFAULT_IOPGPS_CONFIG,
  getGpsConfig,
  extractTripKinematics,
  detectAndProcessStationStops
} from '../src/core/iopgps-sync.js';
import {
  calculateTelemetryModel,
  getActiveTankState,
  computeWeekdaySeverity
} from '../src/core/telemetry-engine.js';
import { buildRefuelTelemetryEnrichment } from '../src/components/modals/modal-refuel.js';
import {
  resolveDayOdometerDelta,
  learnRoutineDailyKmByWeekday,
  calculateRidesCycleSummary
} from '../src/core/rides-engine.js';
import {
  buildTimeSlotMatrix,
  generateOperationalDiagnostic
} from '../src/core/diagnostic-engine.js';
import {
  DEFAULT_FUEL_PHYSICS_PRIORS,
  decomposeFuelCost,
  reconcileClosedCycleTrips,
  solveRidge4x4,
  calibrateVehicleFuelModel
} from '../src/core/fuel-physics-engine.js';
import { reconcileTripsAgainstClosedCycles, groupTripsByDay } from '../src/core/iopgps-sync.js';
import { computeMonthlyFuelMetrics } from '../src/core/cockpit-analytics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

function walkJsFiles(dir, results = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkJsFiles(full, results);
    } else if (entry.isFile() && /\.(js|mjs|html)$/i.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

describe('Phase 0 — Firestore 1 MiB Guard & Merge Preservation', () => {
  test('reduces > 2 MB snapshot with trackPoints down to < 150 KB sanitized payload', () => {
    const heavyTrack = Array.from({ length: 500 }, (_, idx) => ({
      lat: 10.98 + idx * 0.0001,
      lng: -74.79 - idx * 0.0001,
      speed: 28 + (idx % 25),
      time: 1789400000 + idx * 10,
      heading: 180
    }));

    const tripsByDate = {};
    for (let d = 0; d < 60; d++) {
      const m = String(Math.floor(d / 28) + 8).padStart(2, '0');
      const day = String((d % 28) + 1).padStart(2, '0');
      const dateKey = `2026-${m}-${day}`;
      tripsByDate[dateKey] = [
        {
          id: `trip_${dateKey}_0`,
          date: dateKey,
          startTimeMs: 1789400000000 + d * 86400000,
          distanceKm: 18.4,
          durationSec: 2100,
          estGallons: 0.55,
          estCostCop: 8800,
          trackPoints: heavyTrack
        }
      ];
    }

    const rawSnapshot = {
      version: 1,
      exportedAt: '2026-09-15T12:00:00.000Z',
      stores: {
        vehicle_profile: [
          {
            id: 'main',
            name: 'Kia Picanto 1.0L',
            gpsConfig: {
              enabled: true,
              username: 'demo_driver',
              password: 'local_secret_should_never_sync',
              proxyUrl: 'https://my-proxy.workers.dev',
              stationAlertsEnabled: false
            },
            gpsCache: {
              tripsByDate,
              voltageHistory: Array.from({ length: 250 }, (_, i) => ({ t: i, v: 12.6 })),
              notifiedStopIds: Array.from({ length: 85 }, (_, i) => `stop_${i}`)
            }
          }
        ],
        telemetry_logs: [],
        maintenance_items: [],
        free_notes: [],
        legal_docs: [],
        ride_sessions: [],
        platform_passes: []
      }
    };

    const encoder = new TextEncoder();
    const rawBytes = encoder.encode(JSON.stringify(rawSnapshot)).length;
    assert.ok(rawBytes > 2_000_000, `Expected raw snapshot > 2 MB, got ${rawBytes}`);

    const sanitized = sanitizeSnapshotForCloud(rawSnapshot);
    const sanitizedBytes = encoder.encode(JSON.stringify(sanitized)).length;
    assert.ok(sanitizedBytes < 150_000, `Expected sanitized snapshot < 150 KB, got ${sanitizedBytes}`);

    const profile = sanitized.stores.vehicle_profile[0];
    assert.equal(profile.gpsConfig.password, '');
    assert.equal(profile.gpsCache.voltageHistory.length, 180);
    assert.equal(profile.gpsCache.notifiedStopIds.length, 60);
  });

  test('importAllStores exists and mergeVehicleProfileRecords preserves local trackPoints, password, voltageHistory, and notifiedStopIds', () => {
    assert.equal(typeof importAllStores, 'function');
    assert.equal(importAllStores.length >= 1, true);

    const localProfile = {
      id: 'main',
      updatedAt: '2026-09-15T10:00:00.000Z',
      gpsConfig: {
        enabled: true,
        username: 'demo_driver',
        password: 'kept_local_password'
      },
      gpsCache: {
        tripsByDate: {
          '2026-09-15': [
            {
              id: 'trip_abc',
              date: '2026-09-15',
              distanceKm: 12.5,
              trackPoints: [{ lat: 10.98, lng: -74.79, speed: 30 }]
            }
          ],
          '2026-04-01': [
            {
              id: 'trip_old',
              date: '2026-04-01',
              distanceKm: 9.0,
              trackPoints: [{ lat: 10.97, lng: -74.78, speed: 25 }]
            }
          ]
        },
        voltageHistory: [{ t: 1, v: 12.5 }, { t: 2, v: 12.6 }],
        notifiedStopIds: ['stop_1', 'stop_2']
      }
    };

    const incomingCloudProfile = {
      id: 'main',
      updatedAt: '2026-09-15T12:00:00.000Z',
      gpsConfig: {
        enabled: true,
        username: 'demo_driver',
        password: ''
      },
      gpsCache: {
        tripsByDate: {
          '2026-09-15': [
            {
              id: 'trip_abc',
              date: '2026-09-15',
              distanceKm: 12.5
            }
          ]
        },
        voltageHistory: [{ t: 2, v: 12.6 }, { t: 3, v: 12.7 }],
        notifiedStopIds: ['stop_2', 'stop_3']
      }
    };

    const merged = mergeVehicleProfileRecords(localProfile, incomingCloudProfile);
    assert.equal(merged.gpsConfig.password, 'kept_local_password');
    assert.equal(merged.gpsCache.tripsByDate['2026-09-15'][0].trackPoints.length, 1);
    assert.equal(merged.gpsCache.tripsByDate['2026-04-01'][0].id, 'trip_old');
    assert.equal(merged.gpsCache.voltageHistory.length, 3);
    assert.deepEqual(merged.gpsCache.notifiedStopIds, ['stop_1', 'stop_2', 'stop_3']);
  });
});

describe('Phase 0 — Proxy Security Resolution & Config Defaults', () => {
  test('DEFAULT_IOPGPS_CONFIG and getGpsConfig include proxyUrl and opt-in stationAlertsEnabled=false', () => {
    assert.equal(DEFAULT_IOPGPS_CONFIG.proxyUrl, '');
    assert.equal(DEFAULT_IOPGPS_CONFIG.stationAlertsEnabled, false);

    const cfg = getGpsConfig({
      gpsConfig: {
        username: 'demo_driver',
        password: 'demo_password',
        proxyUrl: 'https://my-worker.workers.dev/',
        stationAlertsEnabled: true
      }
    });
    assert.equal(cfg.proxyUrl, 'https://my-worker.workers.dev/');
    assert.equal(cfg.stationAlertsEnabled, true);
  });

  test('resolveProxyMode handles localhost, custom proxyUrl variants, and public-bridge fallback', () => {
    const local = resolveProxyMode({ proxyUrl: '' }, { isBrowser: true, hostname: 'localhost' });
    assert.deepEqual(local, { mode: 'vite-proxy', apiBase: '/iopgps-api', isLocalhost: true });

    const loopV6 = resolveProxyMode({ proxyUrl: '' }, { isBrowser: true, hostname: '[::1]' });
    assert.equal(loopV6.mode, 'vite-proxy');

    const customBase = resolveProxyMode(
      { proxyUrl: 'https://octane-proxy.example.workers.dev/' },
      { isBrowser: true, hostname: 'octane-app.web.app' }
    );
    assert.equal(customBase.mode, 'private-proxy');
    assert.equal(customBase.apiBase, 'https://octane-proxy.example.workers.dev/iopgps-api');

    const customWithSuffix = resolveProxyMode(
      { proxyUrl: 'https://octane-proxy.example.workers.dev/iopgps-api/' },
      { isBrowser: true, hostname: 'octane-app.web.app' }
    );
    assert.equal(customWithSuffix.mode, 'private-proxy');
    assert.equal(customWithSuffix.apiBase, 'https://octane-proxy.example.workers.dev/iopgps-api');

    const fallback = resolveProxyMode(
      { proxyUrl: '' },
      { isBrowser: true, hostname: 'octane-app.web.app' }
    );
    assert.equal(fallback.mode, 'public-bridge');
  });
});

describe('Phase 0 — Security & AGENTS.md Compliance Audit', () => {
  test('zero hardcoded credentials exist in src/, infra/, or tests/', () => {
    const dirsToScan = ['src', 'infra', 'tests']
      .map((d) => path.join(REPO_ROOT, d))
      .filter((d) => fs.existsSync(d));

    const forbiddenPatterns = [
      new RegExp('JGN' + '691'),
      new RegExp('Spicy' + '691'),
      new RegExp('359710' + '04')
    ];
    for (const dir of dirsToScan) {
      for (const filePath of walkJsFiles(dir)) {
        if (path.resolve(filePath) === __filename) continue;
        const content = fs.readFileSync(filePath, 'utf8');
        for (const pattern of forbiddenPatterns) {
          assert.equal(
            pattern.test(content),
            false,
            `Forbidden credential pattern detected in ${path.relative(REPO_ROOT, filePath)}`
          );
        }
      }
    }
  });

  test('view-settings.js, view-rides.js, and modal-diagnostic.js contain zero <p> HTML tags', () => {
    for (const relPath of [
      'src/views/view-settings.js',
      'src/views/view-rides.js',
      'src/components/modals/modal-diagnostic.js'
    ]) {
      const filePath = path.join(REPO_ROOT, relPath);
      const content = fs.readFileSync(filePath, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      const hasParagraphTag = /<p[\s>]/i.test(content);
      assert.equal(hasParagraphTag, false, `${relPath} must not contain <p> HTML tags`);
    }
  });
});

describe('Phase 1 — Tank Autonomy, Weekday Severity & Sensitivity', () => {
  test('computeWeekdaySeverity averages weekday severity when >= 2 samples exist and falls back to 1.0', () => {
    const gpsDaysMap = {
      // Two Mondays (2026-09-07 and 2026-09-14) with heavy traffic & idle
      '2026-09-07': { km: 15, runTimeSec: 5400, idleAccOnSec: 1800, runNo: 8 },
      '2026-09-14': { km: 16, runTimeSec: 5400, idleAccOnSec: 1800, runNo: 8 },
      // Only one Tuesday -> falls back to 1.0
      '2026-09-08': { km: 15, runTimeSec: 5400, idleAccOnSec: 1800, runNo: 8 }
    };
    const sev = computeWeekdaySeverity(gpsDaysMap, 1.0);
    assert.equal(sev.length, 7);
    assert.ok(sev[0] > 1.05, `Monday severity should exceed 1.05, got ${sev[0]}`);
    assert.equal(sev[1], 1.0);
  });

  test('getActiveTankState uses severity-consistent autonomy/reserve and subtracts todayKm on day 0', () => {
    const now = new Date('2026-09-15T18:00:00');
    const gpsDaysMap = {
      '2026-09-14': { km: 30, runTimeSec: 7200, idleAccOnSec: 1800, runNo: 6 },
      '2026-09-15': { km: 20, runTimeSec: 5400, idleAccOnSec: 1200, runNo: 4 }
    };
    const profile = {
      tankCapacityGallons: 9.25,
      reserveLiters: 5, // ~1.32 gal
      benchmarkEff: 30,
      routineDailyKm: 30,
      gpsCache: { days: gpsDaysMap, live: { totalMile: 90150, todayMile: 20, date: '2026-09-15' } }
    };
    const processed = [
      { date: '2026-09-14', odometer_reading: 90000, gallons_added: 9.25, is_full_tank: true, fuel_level_percent: 100 }
    ];
    const weekdayDNA = Array.from({ length: 7 }, (_, i) => ({ dayIndex: i, avgKm: 30 }));

    const tank = getActiveTankState(processed, 30, profile, weekdayDNA, 30, { now, gpsDaysMap });
    assert.ok(tank.physicalTelemetry);
    const expectedProjEff = 30 / tank.physicalTelemetry.severityFactor;
    assert.equal(tank.autonomyKm, Math.round(tank.activeGal * expectedProjEff));
    assert.equal(tank.reserveKm, Math.max(0, Math.round(Math.max(0, tank.activeGal - tank.reserveGal) * expectedProjEff)));
    assert.ok(tank.autonomyDate);
    assert.ok(tank.reserveDate);
    assert.ok(tank.reserveDateLabel && tank.reserveDateLabel !== 'HOY');

    // Empty tank / already in reserve -> reserveDays = 0 and reserveDateLabel = 'HOY'
    const reserveProcessed = [
      { date: '2026-09-14', odometer_reading: 90000, gallons_added: 9.25, is_full_tank: true, fuel_level_percent: 100 },
      { date: '2026-09-15', odometer_reading: 90230, gallons_added: 0, is_full_tank: false, fuel_level_percent: 10 }
    ];
    const inReserveTank = getActiveTankState(reserveProcessed, 30, profile, weekdayDNA, 30, { now, gpsDaysMap });
    assert.equal(inReserveTank.reserveDays, 0);
    assert.equal(inReserveTank.reserveDateLabel, 'HOY');
  });

  test('calculateTelemetryModel exposes learnedSensitivity', () => {
    const model = calculateTelemetryModel([
      { id: '1', date: '2026-09-01', odometer_reading: 90000, gallons_added: 7, is_full_tank: true },
      { id: '2', date: '2026-09-10', odometer_reading: 90250, gallons_added: 8, is_full_tank: true }
    ], {
      tankCapacityGallons: 9.25,
      gpsCache: {
        physicalSensitivity: 1.0,
        days: {
          '2026-09-02': { km: 30, runTimeSec: 7200, idleAccOnSec: 1800, runNo: 6 }
        }
      }
    });
    assert.equal(typeof model.learnedSensitivity, 'number');
    assert.ok(model.learnedSensitivity >= 0.5 && model.learnedSensitivity <= 1.6);
  });
});

describe('Phase 1 — 10s Kinematics, Station Geofence & Refuel Enrichment', () => {
  test('extractTripKinematics computes brakeEnergyMj, accelEnergyMj, lateralStressEvents, and accelVariance', () => {
    const pts = [
      { '7': 1000, '9': 10.9800, '10': -74.7900, '12': 0, '13': 1, '4': 0 },
      { '7': 1010, '9': 10.9805, '10': -74.7900, '12': 54, '13': 1, '4': 0 },   // +15 m/s in 10s
      { '7': 1020, '9': 10.9810, '10': -74.7905, '12': 54, '13': 1, '4': 120 }, // 120 deg turn in 10s at 15 m/s -> ~3.14 m/s^2 lateral
      { '7': 1030, '9': 10.9812, '10': -74.7910, '12': 0, '13': 0, '4': 120 }   // -15 m/s braking
    ];
    const kin = extractTripKinematics(pts, 1045);
    assert.ok(kin.accelEnergyMj > 0);
    assert.ok(kin.brakeEnergyMj > 0);
    assert.equal(kin.lateralStressEvents, 1);
    assert.ok(kin.accelVariance > 0);
    assert.equal(kin.movingTimeSec, 30);
    assert.equal(kin.stoppedTimeSec, 10);
  });

  test('detectAndProcessStationStops deduplicates notifiedStopIds and suppresses within 2h of refuel', () => {
    const stationCoord = { lat: 10.9878, lng: -74.7889 };
    const profile = {
      gpsConfig: { stationAlertsEnabled: false },
      learnedGasStations: [{ id: 'st_1', name: 'Terpel Murillo', lat: stationCoord.lat, lng: stationCoord.lng }],
      gpsCache: { notifiedStopIds: [] }
    };
    const stopTimeMs = Date.parse('2026-09-15T15:00:00Z');
    const idles = [{ id: 'idle_100', lat: 10.98785, lng: -74.78892, durationSeconds: 210, startTimeMs: stopTimeMs }];

    const match1 = detectAndProcessStationStops({ idles, profile, telemetryLogs: [], nowMs: stopTimeMs });
    assert.ok(match1.matchedStop);
    assert.equal(match1.station.id, 'st_1');
    assert.deepEqual(match1.updatedNotifiedStopIds, ['idle_100']);
    assert.equal(match1.pendingStationMatch.stationName, 'Terpel Murillo');

    // Deduplicate already-notified stop ID
    const profileNotified = {
      ...profile,
      gpsCache: { notifiedStopIds: match1.updatedNotifiedStopIds }
    };
    const matchDup = detectAndProcessStationStops({ idles, profile: profileNotified, telemetryLogs: [], nowMs: stopTimeMs });
    assert.equal(matchDup.matchedStop, null);

    // Suppress if a refuel was logged within 2 hours of the stop
    const matchSuppressed = detectAndProcessStationStops({
      idles,
      profile,
      telemetryLogs: [{ date: '2026-09-15', gallons_added: 6.5, createdAt: '2026-09-15T14:15:00Z' }],
      nowMs: stopTimeMs
    });
    assert.equal(matchSuppressed.matchedStop, null);
  });

  test('buildRefuelTelemetryEnrichment aggregates GPS cycle telemetry and station metadata', () => {
    const enrichment = buildRefuelTelemetryEnrichment({
      prevLog: { date: '2026-09-10' },
      refuelDate: '2026-09-15',
      gpsCache: {
        days: {
          '2026-09-11': { runTimeSec: 3600, idleAccOnSec: 600 },
          '2026-09-14': { runTimeSec: 5400, idleAccOnSec: 900 }
        },
        tripsByDate: {
          '2026-09-11': [{ maxSpeedKmh: 78, accelVariance: 0.42, coldPenaltyPct: 8.5 }],
          '2026-09-14': [{ maxSpeedKmh: 84, accelVariance: 0.58, coldPenaltyPct: 4.5 }]
        }
      },
      matchedStation: { id: 'st_1', name: 'Terpel Murillo' }
    });

    assert.equal(enrichment.duration_seconds, 9000);
    assert.equal(enrichment.idle_seconds, 1500);
    assert.equal(enrichment.idle_ratio, Number((1500 / 9000).toFixed(3)));
    assert.equal(enrichment.acceleration_variance, 0.5);
    assert.equal(enrichment.max_speed_kmh, 84);
    assert.equal(enrichment.thermal_stress_score, 6.5);
    assert.equal(enrichment.stationId, 'st_1');
    assert.equal(enrichment.stationName, 'Terpel Murillo');
  });
});

describe('Phase 1 — Rides & Diagnostic GPS Unification', () => {
  test('resolveDayOdometerDelta prioritizes GPS daily km and learnRoutineDailyKmByWeekday learns non-work routine', () => {
    const gpsDaysMap = {
      '2026-09-01': { km: 22, runTimeSec: 3600, idleAccOnSec: 300 },
      '2026-09-02': { km: 26, runTimeSec: 3800, idleAccOnSec: 300 },
      '2026-09-03': { km: 24, runTimeSec: 3700, idleAccOnSec: 300 },
      '2026-09-08': { km: 110, runTimeSec: 18000, idleAccOnSec: 1800 } // Ride day
    };
    const rideSessions = [
      { id: 'r1', date: '2026-09-08', platform: 'Uber', grossEarnings: 120000, distanceKm: 60, isEnRoute: false, time: '14:00' }
    ];

    const routine = learnRoutineDailyKmByWeekday(gpsDaysMap, rideSessions, 24);
    assert.equal(routine.isGpsLearned, true);
    assert.equal(routine.learnedDaysCount, 3);
    assert.equal(routine.avgRoutineKm, 24);

    const odo = resolveDayOdometerDelta('2026-09-08', [], null, gpsDaysMap);
    assert.equal(odo.source, 'gps');
    assert.equal(odo.deltaOdo, 110);
    assert.equal(odo.idleAccOnSec, 1800);

    const summary = calculateRidesCycleSummary({
      sessions: rideSessions,
      profile: { fuelPriceCop: 16000, routineDailyKm: 24, defaultEfficiencyKmGal: 32, gpsCache: { days: gpsDaysMap } },
      telemetryLogs: [],
      cycleType: 'custom',
      startDate: '2026-09-08',
      endDate: '2026-09-08'
    });
    assert.equal(summary.deadheadSource, 'gps');
    assert.equal(summary.gpsOdoDaysCount, 1);
    assert.ok(summary.totalIdleFuelCop > 0);
    assert.ok(summary.totalGpsWorkHours > 1);
    assert.ok(summary.netProfitPerHourCop > 0);
  });

  test('buildTimeSlotMatrix classifies timestamped sessions into 4 circadian slots and correlates GPS duration', () => {
    const sessions = [
      { id: 's1', date: '2026-09-08', time: '07:30', grossEarnings: 35000, distanceKm: 15 },
      { id: 's2', date: '2026-09-08', time: '19:15', grossEarnings: 45000, distanceKm: 20 }
    ];
    const tripsByDate = {
      '2026-09-08': [
        { startTimeHm: '07:25', durationSec: 2700 },
        { startTimeHm: '19:10', durationSec: 3600 }
      ]
    };

    const matrix = buildTimeSlotMatrix(sessions, tripsByDate, { startDate: '2026-09-01', endDate: '2026-09-30' });
    assert.equal(matrix.hasTimestampedData, true);
    const manana = matrix.slots.find(s => s.key === 'manana');
    const noche = matrix.slots.find(s => s.key === 'noche');
    assert.equal(manana.grossCop, 35000);
    assert.equal(manana.workHours, 0.75);
    assert.equal(noche.grossCop, 45000);
    assert.equal(noche.ratePerHourCop, 45000);

    const diag = generateOperationalDiagnostic({
      rideSessions: sessions,
      telemetryLogs: [],
      vehicleProfile: { fuelPriceCop: 16000, gpsCache: { tripsByDate, days: { '2026-09-08': { km: 80, runTimeSec: 7200, idleAccOnSec: 900 } } } }
    }, { startDate: '2026-09-01', endDate: '2026-09-30', label: 'TEST' });
    assert.equal(diag.timeSlotMatrix.hasTimestampedData, true);
    assert.ok(diag.hourlyProfitCop !== null);
  });
});

describe('Phase 2 — Impuesto Invisible, Reconciliation & Ridge Calibration', () => {
  test('decomposeFuelCost conserves 100% of totalCostCop and totalGallons and guards empty inputs', () => {
    const empty = decomposeFuelCost(null);
    assert.equal(empty.hasData, false);
    assert.equal(empty.totalCostCop, 0);

    const tax = decomposeFuelCost({
      gpsKm: 240,
      avgSpeedKmh: 16.5,
      idleAccOnSec: 5400, // 1.5h
      runNo: 22,
      hardAccels: 14,
      trafficPct: 48
    }, {
      totalGallons: 8.123,
      totalCostCop: 130001,
      fuelPriceCop: 16000
    });

    assert.equal(tax.hasData, true);
    assert.equal(tax.baseCop + tax.trafficCop + tax.idleCop + tax.dynamicsColdCop, 130001);
    const sumGal = Number((tax.baseGal + tax.trafficGal + tax.idleGal + tax.dynamicsColdGal).toFixed(3));
    assert.equal(sumGal, 8.123);
    assert.equal(tax.pctBase + tax.pctTraffic + tax.pctIdle + tax.pctDynamicsCold, 100);
    assert.ok(tax.trafficCop > 0);
    assert.ok(tax.idleCop > 0);
    assert.ok(tax.dynamicsColdCop > 0);
  });

  test('reconcileClosedCycleTrips reconciles sum within ±0.01 gal and clamps factor to [0.65, 1.45]', () => {
    const trips = [
      { id: 't1', date: '2026-09-02', estGallons: 2.0, estCostCop: 32000 },
      { id: 't2', date: '2026-09-03', estGallons: 3.0, estCostCop: 48000 },
      { id: 't3', date: '2026-09-04', estGallons: 1.0, estCostCop: 16000 }
    ]; // totalEst = 6.0

    const rec = reconcileClosedCycleTrips(trips, 7.2, 16000);
    // Input must not be mutated
    assert.equal(trips[0].isCalibrated, undefined);

    const sumRecGal = rec.reduce((acc, t) => acc + t.reconciledGallons, 0);
    assert.ok(Math.abs(sumRecGal - 7.2) <= 0.01, `Expected ~7.2 gal, got ${sumRecGal}`);
    assert.equal(rec[0].reconciliationFactor, 1.2);
    assert.equal(rec[0].isCalibrated, true);

    // Factor clamping: 6.0 est vs 12.0 pump -> 2.0x clamped to 1.45
    const clampedHigh = reconcileClosedCycleTrips(trips, 12.0, 16000);
    assert.equal(clampedHigh[0].reconciliationFactor, 1.45);
    const clampedLow = reconcileClosedCycleTrips(trips, 2.0, 16000);
    assert.equal(clampedLow[0].reconciliationFactor, 0.65);

    // reconcileTripsAgainstClosedCycles & groupTripsByDay integration
    const byDate = {
      '2026-09-02': [{ id: 't1', date: '2026-09-02', startTimeMs: 1000, distanceKm: 50, durationSec: 3600, estGallons: 2.0, estCostCop: 32000 }],
      '2026-09-03': [{ id: 't2', date: '2026-09-03', startTimeMs: 2000, distanceKm: 75, durationSec: 5400, estGallons: 4.0, estCostCop: 64000 }]
    };
    const cycles = [{ startDate: '2026-09-01', endDate: '2026-09-03', gals: 7.5, isFull: true }];
    const recMap = reconcileTripsAgainstClosedCycles(byDate, cycles, 16000);
    assert.equal(recMap['2026-09-02'][0].isCalibrated, true);
    const dayGroups = groupTripsByDay(Object.values(recMap).flat(), { fuelPriceCop: 16000 });
    const day03 = dayGroups.find(d => d.date === '2026-09-03');
    assert.equal(day03.totalEstGallons, 5);
  });

  test('calibrateVehicleFuelModel uses prior when < 5 cycles, converges with Ridge on >= 5, and fires anomalyAlert only on 2+ consecutive spikes', () => {
    const makeCycle = (idx, km, idleH, avgSpd, runNo, gals) => ({
      cycleIndex: idx,
      startDate: `2026-08-0${idx}`,
      endDate: `2026-08-0${idx + 1}`,
      days: 2,
      dist: km,
      gals,
      isValid: true,
      physicalTelemetry: {
        gpsKm: km,
        idleAccOnSec: Math.round(idleH * 3600),
        avgSpeedKmh: avgSpd,
        runNo,
        activeDays: 2,
        gpsCoverage: 1.0
      }
    });

    // < 5 cycles -> prior mode
    const sparse = calibrateVehicleFuelModel([makeCycle(1, 200, 1, 24, 10, 6.2)]);
    assert.equal(sparse.mode, 'prior');
    assert.equal(sparse.anomalyAlert, null);

    // True synthetic vehicle: slightly thirstier base (0.031 gal/km), idle 0.22, traffic 0.01, cold 0.03
    const trueB = [0.031, 0.22, 0.01, 0.03];
    const synthSpecs = [
      [210, 0.8, 28, 8],
      [180, 2.2, 16, 14],
      [260, 0.4, 34, 6],
      [195, 1.5, 20, 12],
      [240, 1.1, 22, 10],
      [225, 1.8, 17, 13]
    ];
    const predictSynth = ([km, ih, spd, rn]) => {
      const tw = spd < 30 ? Math.min(1, (30 - spd) / 18) : 0;
      return km * trueB[0] + ih * trueB[1] + (km * tw) * trueB[2] + (rn * 0.55) * trueB[3];
    };

    const cleanCycles = synthSpecs.map((sp, i) => makeCycle(i + 1, sp[0], sp[1], sp[2], sp[3], predictSynth(sp)));
    const fitted = calibrateVehicleFuelModel(cleanCycles);
    assert.equal(fitted.mode, 'ridge');
    assert.equal(fitted.anomalyAlert, null);
    for (const r of fitted.cycleResiduals) {
      assert.ok(Math.abs(r.residualPct) < 8, `Expected residual < 8%, got ${r.residualPct}%`);
    }

    // 1 isolated spike (+28% on cycle 6) must NOT trigger anomalyAlert
    const oneSpike = [...cleanCycles.slice(0, 5), makeCycle(6, 225, 1.8, 17, 13, predictSynth(synthSpecs[5]) * 1.28)];
    assert.equal(calibrateVehicleFuelModel(oneSpike).anomalyAlert, null);

    // 2 consecutive trailing spikes (+25% and +30% with higher lambda so fitted baseline stays grounded) MUST trigger anomalyAlert
    const twoSpikes = [
      ...cleanCycles,
      makeCycle(7, 220, 1.0, 22, 10, predictSynth([220, 1.0, 22, 10]) * 1.32),
      makeCycle(8, 215, 1.2, 21, 11, predictSynth([215, 1.2, 21, 11]) * 1.35)
    ];
    const driftModel = calibrateVehicleFuelModel(twoSpikes, { lambda: 5.0 });
    assert.ok(driftModel.anomalyAlert, 'Expected anomalyAlert on 2 consecutive high-residual cycles');
    assert.equal(driftModel.anomalyAlert.type, 'fuel_consumption_drift');
    assert.equal(driftModel.anomalyAlert.consecutiveCount, 2);
  });

  test('computeMonthlyFuelMetrics calendar projection reflects weekday vs weekend remaining days', () => {
    const weekdayDNA = [
      { dayIndex: 0, avgKm: 55, count: 4 },
      { dayIndex: 1, avgKm: 55, count: 4 },
      { dayIndex: 2, avgKm: 55, count: 4 },
      { dayIndex: 3, avgKm: 55, count: 4 },
      { dayIndex: 4, avgKm: 55, count: 4 },
      { dayIndex: 5, avgKm: 8, count: 4 },
      { dayIndex: 6, avgKm: 5, count: 4 }
    ];
    const model = {
      adaptiveEff: 35,
      fullEraAvgEff: 35,
      weekdayDNA,
      dailySeries: Array.from({ length: 20 }, (_, i) => ({ date: `2026-08-${String(i + 1).padStart(2, '0')}`, km: 35 })),
      activeTankState: { adaptiveEff: 35, weekdaySeverity: [1.1, 1.1, 1.1, 1.1, 1.1, 1.0, 1.0] },
      stats: { avgKmPerDay: 40 }
    };
    const logs = [{ date: '2026-09-10', gallons_added: 5, total_cost_cop: 80000, odometer_reading: 91000 }];

    // 2026-09-25 is Friday -> remaining 5 days are Sat, Sun, Mon, Tue, Wed (3 heavy weekdays + 2 light weekend days)
    const projMix = computeMonthlyFuelMetrics(logs, model, 16000, new Date('2026-09-25T12:00:00'), {
      gpsCache: { days: { '2026-09-25': { km: 55, runTimeSec: 5400, idleAccOnSec: 600 } } }
    });
    // 2026-09-26 is Saturday -> remaining 4 days are Sun, Mon, Tue, Wed (lost Sat, wait: let's compare 2026-09-25 vs 2026-09-26 vs heavy week)
    // Compare 2026-10-29 (Thursday -> remaining Fri(55) + Sat(8) = 63 km) vs 2026-10-28 (Wednesday -> Thu(55)+Fri(55)+Sat(8) = 118 km)
    const octThu = computeMonthlyFuelMetrics(
      [{ date: '2026-10-10', gallons_added: 5, total_cost_cop: 80000, odometer_reading: 91000 }],
      model,
      16000,
      new Date('2026-10-29T12:00:00')
    );
    const octFri = computeMonthlyFuelMetrics(
      [{ date: '2026-10-10', gallons_added: 5, total_cost_cop: 80000, odometer_reading: 91000 }],
      model,
      16000,
      new Date('2026-10-30T12:00:00')
    );
    assert.ok(octThu.calendarRemainingCostCop > octFri.calendarRemainingCostCop);
    assert.ok(projMix.invisibleTax && projMix.invisibleTax.hasData);
    assert.equal(projMix.invisibleTax.totalCostCop, 80000);
  });

  test('Phase 2 UI files contain zero <p> HTML tags and zero technical jargon in markup', () => {
    const jargonRegex = /\b(Ridge|Haversine|IndexedDB|EMA|JSON)\b/i;
    for (const relPath of [
      'src/views/view-cockpit.js',
      'src/components/modals/modal-kpi-detail.js',
      'src/components/modals/modal-gps-trips.js'
    ]) {
      const filePath = path.join(REPO_ROOT, relPath);
      const raw = fs.readFileSync(filePath, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      assert.equal(/<p[\s>]/i.test(raw), false, `${relPath} must not contain <p> HTML tags`);

      // Inspect HTML template literals only (text rendered to DOM)
      const templateTexts = [...raw.matchAll(/`([\s\S]*?)`/g)]
        .map(m => m[1])
        .filter(s => s.includes('<') && s.includes('>'))
        .map(s => s.replace(/\$\{[\s\S]*?\}/g, ' ').replace(/<[^>]+>/g, ' '))
        .join(' ');
      assert.equal(jargonRegex.test(templateTexts), false, `${relPath} UI text must not leak technical jargon`);
    }
  });
});
