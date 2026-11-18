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
import { computeMonthlyFuelMetrics, computeCockpitGpsSummary } from '../src/core/cockpit-analytics.js';
import {
  VOLTAGE_HISTORY_MAX,
  recordVoltageSample,
  analyzeElectricalHealth,
  computePhysicalWear
} from '../src/core/vehicle-health-engine.js';
import {
  calculateWearDialTelemetry,
  renderWearDialCard
} from '../src/components/cluster/wear-dial-card.js';
import { calculateActiveAlerts } from '../src/core/alerts-engine.js';
import {
  detectSemanticPlaces,
  resolvePlaceLabel,
  computeStationHonestyIndex,
  analyzeOptimalDeparture,
  computeParkingSentinel
} from '../src/core/geospatial-intelligence.js';

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

describe('Phase 3 — Longitudinal Electrical Health & Physical Equivalent Mechanical Wear', () => {
  test('recordVoltageSample deduplicates within 15min & <0.05V, caps at 180, normalizes seconds, and never mutates input', () => {
    const baseMs = Date.parse('2026-09-15T12:00:00Z');
    const orig = [{ ts: baseMs, v: 12.6, acc: false, speed: 0 }];

    // Guard invalid snapshot -> returns cloned array unchanged
    const guarded = recordVoltageSample(orig, { externalVoltage: 0, accStatus: false }, baseMs + 60_000);
    assert.deepEqual(guarded, orig);
    assert.notEqual(guarded, orig);

    // Dedup within 15 min & delta < 0.05V & same ACC -> unchanged
    const dedup = recordVoltageSample(
      orig,
      { gpsTime: baseMs + 10 * 60 * 1000, externalVoltage: 12.63, accStatus: false, speed: 0 },
      baseMs + 10 * 60 * 1000
    );
    assert.equal(dedup.length, 1);

    // Same 10 min window, but voltage delta >= 0.05V -> appended
    const deltaJump = recordVoltageSample(
      orig,
      { gpsTime: baseMs + 10 * 60 * 1000, externalVoltage: 12.70, accStatus: false, speed: 0 },
      baseMs + 10 * 60 * 1000
    );
    assert.equal(deltaJump.length, 2);
    assert.equal(orig.length, 1); // original never mutated

    // Seconds timestamp normalization (< 1e12 -> * 1000)
    const secSample = recordVoltageSample(
      [],
      { gpsTime: Math.floor(baseMs / 1000), externalVoltage: 14.123, accStatus: true, speed: 42 },
      baseMs
    );
    assert.equal(secSample[0].ts, baseMs);
    assert.equal(secSample[0].v, 14.12);
    assert.equal(secSample[0].acc, true);
    assert.equal(secSample[0].speed, 42);

    // Cap at VOLTAGE_HISTORY_MAX (180)
    let bigHistory = [];
    for (let i = 0; i < 195; i++) {
      const ts = baseMs + i * 20 * 60 * 1000;
      bigHistory = recordVoltageSample(bigHistory, { gpsTime: ts, externalVoltage: 12.5 + (i % 3) * 0.1, accStatus: false, speed: 0 }, ts);
    }
    assert.equal(bigHistory.length, VOLTAGE_HISTORY_MAX);
    assert.equal(bigHistory[0].ts, baseMs + 15 * 20 * 60 * 1000);
  });

  test('analyzeElectricalHealth separates ACC OFF vs ACC ON, detects -0.20V/30d slope warning, <12.1V critical, and alternator SUBCARGA', () => {
    const nowMs = Date.parse('2026-09-30T12:00:00Z');
    const dayMs = 86400000;

    // 1. Nominal resting (12.65V) + nominal alternator (14.2V) + ignitions sum
    const nominalHistory = [
      { ts: nowMs - 20 * dayMs, v: 12.66, acc: false, speed: 0 },
      { ts: nowMs - 10 * dayMs, v: 12.65, acc: false, speed: 0 },
      { ts: nowMs - 1 * dayMs, v: 12.64, acc: false, speed: 0 },
      { ts: nowMs - 5 * dayMs, v: 14.15, acc: true, speed: 35 },
      { ts: nowMs - 2 * dayMs, v: 14.25, acc: true, speed: 48 }
    ];
    const gpsDaysMap = {
      '2026-09-05': { runNo: 10 },
      '2026-09-20': { runNo: 14 },
      '2026-08-01': { runNo: 99 } // outside 30d window
    };
    const nominal = analyzeElectricalHealth(nominalHistory, gpsDaysMap, null, nowMs);
    assert.equal(nominal.restingStatus, 'ÓPTIMA');
    assert.equal(nominal.restingTone, 'volt');
    assert.equal(nominal.chargingStatus, 'NOMINAL');
    assert.equal(nominal.chargingTone, 'volt');
    assert.equal(nominal.ignitions30d, 24);
    assert.equal(nominal.alerts.length, 0);
    assert.equal(nominal.sparklineSeries.length, 3);

    // 2. -0.20V/30d downward slope over 20 days -> DESGASTE warning
    const dropHistory = [
      { ts: nowMs - 20 * dayMs, v: 12.70, acc: false, speed: 0 },
      { ts: nowMs - 10 * dayMs, v: 12.60, acc: false, speed: 0 },
      { ts: nowMs - 0 * dayMs, v: 12.50, acc: false, speed: 0 }
    ];
    const dropping = analyzeElectricalHealth(dropHistory, null, null, nowMs);
    assert.ok(dropping.slopeVPer30d <= -0.15, `Expected slope <= -0.15, got ${dropping.slopeVPer30d}`);
    assert.equal(dropping.restingStatus, 'DESGASTE');
    assert.equal(dropping.restingTone, 'amber');
    assert.equal(dropping.alerts.length, 1);
    assert.equal(dropping.alerts[0].severity, 'warning');
    assert.equal(dropping.alerts[0].label, 'DESGASTE');

    // 3. < 12.15V resting -> CRÍTICA + alternator < 13.4V -> SUBCARGA critical
    const failingHistory = [
      { ts: nowMs - 4 * dayMs, v: 12.05, acc: false, speed: 0 },
      { ts: nowMs - 1 * dayMs, v: 12.02, acc: false, speed: 0 },
      { ts: nowMs - 2 * dayMs, v: 13.10, acc: true, speed: 40 },
      { ts: nowMs - 1 * dayMs, v: 13.20, acc: true, speed: 30 }
    ];
    const failing = analyzeElectricalHealth(failingHistory, null, null, nowMs);
    assert.equal(failing.restingStatus, 'CRÍTICA');
    assert.equal(failing.restingTone, 'crimson');
    assert.equal(failing.chargingStatus, 'SUBCARGA');
    assert.equal(failing.chargingTone, 'crimson');
    assert.equal(failing.alerts.length, 2);
    assert.ok(failing.alerts.some(a => a.id === 'elec_battery_resting' && a.severity === 'critical'));
    assert.ok(failing.alerts.some(a => a.id === 'elec_alternator' && a.label === 'SUBCARGA' && a.severity === 'critical'));
  });

  test('computePhysicalWear adjusts Oil, Brakes, and Tires with GPS stress and keeps Cabin strictly linear', () => {
    const gpsDays = {
      '2026-08-15': { km: 50, runTimeSec: 10800, idleAccOnSec: 1800 }, // before lastServiceDate (ignored)
      '2026-09-02': { km: 300, runTimeSec: 3600 * 35, idleAccOnSec: 3600 * 10 }, // 45h
      '2026-09-10': { km: 700, runTimeSec: 3600 * 40, idleAccOnSec: 3600 * 10 }  // 50h -> total 95h * 31.25 = 2968.75 km
    };
    const tripsByDate = {
      '2026-09-05': [
        { distanceKm: 3.5, coldPenaltyPct: 10, brakeEnergyMj: 2.0, lateralStressEvents: 4, hardBrakes: 3 },
        { distanceKm: 4.0, coldPenaltyPct: 9, brakeEnergyMj: 2.2, lateralStressEvents: 5, hardBrakes: 2 },
        { distanceKm: 30.0, coldPenaltyPct: 2, brakeEnergyMj: 12.6, lateralStressEvents: 25, hardBrakes: 15 }
      ]
    };

    // Oil: realKmUsed = 2000, engineHours = 95h -> 2968.75 + 2*4 = 2977, capped at 2000*1.60 = 3200
    const oilItem = { id: 'maint_oil_filter', name: 'ACEITE + FILTRO', category: 'engine', intervalKm: 5000, lastServiceOdo: 90000, lastServiceDate: '2026-09-01' };
    const oilWear = computePhysicalWear(oilItem, { currentOdo: 92000, gpsDays, tripsByDate });
    assert.equal(oilWear.hasGpsStressData, true);
    assert.equal(oilWear.basisLabel, 'HORAS MOTOR');
    assert.equal(oilWear.realKmUsed, 2000);
    assert.equal(oilWear.equivalentKmUsed, 2977);
    assert.equal(oilWear.remainingEquivalentKm, 2023);
    assert.ok(oilWear.stressMultiplier > 1.45);

    // Brakes: tripKm = 37.5, brakeEnergyMj = 16.8 -> 0.448 MJ/km / 0.28 = 1.6 -> clamped to 1.45
    const brakeItem = { id: 'maint_brake_fluid', name: 'LÍQUIDO FRENOS', category: 'brakes', intervalKm: 30000, lastServiceOdo: 80000, lastServiceDate: '2026-09-01' };
    const brakeWear = computePhysicalWear(brakeItem, { currentOdo: 90000, gpsDays, tripsByDate });
    assert.equal(brakeWear.hasGpsStressData, true);
    assert.equal(brakeWear.basisLabel, 'FRENADO');
    assert.equal(brakeWear.equivalentKmUsed, 14500);
    assert.equal(brakeWear.stressMultiplier, 1.45);

    // Tires: tripKm = 37.5, events = 54 -> events/100km = 144 -> 1 + 0.002*144 = 1.288
    const tireItem = { id: 'maint_tire_rotation', name: 'ROTACIÓN LLANTAS', category: 'tires', intervalKm: 10000, lastServiceOdo: 88000, lastServiceDate: '2026-09-01' };
    const tireWear = computePhysicalWear(tireItem, { currentOdo: 92000, gpsDays, tripsByDate });
    assert.equal(tireWear.hasGpsStressData, true);
    assert.equal(tireWear.basisLabel, 'CARGA LATERAL');
    assert.ok(tireWear.equivalentKmUsed > 5000 && tireWear.stressMultiplier >= 1.25 && tireWear.stressMultiplier <= 1.30);

    // Cabin: strictly linear
    const cabinItem = { id: 'maint_cabin_filter', name: 'FILTRO CABINA A/C', category: 'cabin', intervalKm: 15000, lastServiceOdo: 85000, lastServiceDate: '2026-09-01' };
    const cabinWear = computePhysicalWear(cabinItem, { currentOdo: 92000, gpsDays, tripsByDate });
    assert.equal(cabinWear.hasGpsStressData, false);
    assert.equal(cabinWear.basisLabel, 'ODÓMETRO');
    assert.equal(cabinWear.equivalentKmUsed, 7000);
    assert.equal(cabinWear.stressMultiplier, 1.0);

    // Wear dial card backward compatibility & inline micro-tag when >= 1.10x
    const dialNoGps = calculateWearDialTelemetry(oilItem, 92000);
    assert.equal(dialNoGps.kmRemaining, 3000);
    assert.equal(dialNoGps.stressMultiplier, 1.0);

    const dialWithGps = calculateWearDialTelemetry(oilItem, 92000, { gpsDays, tripsByDate });
    assert.equal(dialWithGps.kmRemaining, 2023);
    assert.equal(dialWithGps.realKmRemaining, 3000);
    assert.ok(dialWithGps.stressMultiplier >= 1.10);

    const cardHtml = renderWearDialCard(oilItem, 92000, { gpsDays, tripsByDate });
    assert.ok(cardHtml.includes(`· ${dialWithGps.stressMultiplier.toFixed(2)}×`));
    assert.equal(/<p[\s>]/i.test(cardHtml), false);
  });

  test('calculateActiveAlerts integrates electrical critical/warning alerts and fuel drift warning alerts', () => {
    const nowDate = new Date('2026-09-30T12:00:00Z');
    const dayMs = 86400000;
    const alerts = calculateActiveAlerts({
      legalDocs: [],
      maintenanceItems: [],
      currentOdo: 92000,
      fromDate: nowDate,
      voltageHistory: [
        { ts: nowDate.getTime() - 2 * dayMs, v: 12.05, acc: false, speed: 0 },
        { ts: nowDate.getTime() - 1 * dayMs, v: 13.15, acc: true, speed: 35 }
      ],
      fuelAnomalyAlert: {
        type: 'fuel_consumption_drift',
        severity: 'warning',
        consecutiveCount: 2,
        avgExcessPct: 18,
        label: 'CONSUMO ANÓMALO'
      }
    });

    assert.equal(alerts.hasCritical, true);
    assert.equal(alerts.criticalCount, 2);
    assert.equal(alerts.hasWarning, true);
    assert.equal(alerts.warningCount, 1);
    assert.ok(alerts.criticalAlerts.some(a => a.id === 'elec_battery_resting'));
    assert.ok(alerts.criticalAlerts.some(a => a.id === 'elec_alternator'));
    assert.ok(alerts.warningAlerts.some(a => a.type === 'fuel_consumption_drift' && a.message === 'CONSUMO ANÓMALO · +18%'));
  });

  test('Phase 3 UI files (view-cluster.js, wear-dial-card.js) contain zero <p> HTML tags and zero technical jargon', () => {
    const jargonRegex = /\b(Ridge|Haversine|IndexedDB|EMA|JSON|MJ)\b/i;
    for (const relPath of [
      'src/views/view-cluster.js',
      'src/components/cluster/wear-dial-card.js'
    ]) {
      const filePath = path.join(REPO_ROOT, relPath);
      const raw = fs.readFileSync(filePath, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      assert.equal(/<p[\s>]/i.test(raw), false, `${relPath} must not contain <p> HTML tags`);

      const templateTexts = [...raw.matchAll(/`([\s\S]*?)`/g)]
        .map(m => m[1])
        .filter(s => s.includes('<') && s.includes('>'))
        .map(s => s.replace(/\$\{[\s\S]*?\}/g, ' ').replace(/<[^>]+>/g, ' '))
        .join(' ');
      assert.equal(jargonRegex.test(templateTexts), false, `${relPath} UI text must not leak technical jargon`);
    }
  });
});

describe('Phase 4 — Passive Geospatial Intelligence & UX Compliance', () => {
  test('detectSemanticPlaces identifies CASA (>= 4 overnight days) and TRABAJO (>= 4 weekday 3h+ stays > 500m away), and resolvePlaceLabel maps them', () => {
    const HOME = { lat: 10.9878, lng: -74.7889 };
    const WORK = { lat: 11.0155, lng: -74.8122 }; // ~4 km from home
    const STATION = { id: 'st_terpel', name: 'Terpel Murillo', lat: 10.9960, lng: -74.7950, radiusMeters: 80, refuelCount: 4 };

    // 5 weekdays (Mon 2026-09-07 .. Fri 2026-09-11)
    const weekdays = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'];
    const tripsByDate = {};
    weekdays.forEach((date, idx) => {
      const jitter = idx * 0.00005; // ~5m drift within 120m cluster radius
      tripsByDate[date] = [
        {
          id: `am_${idx}`,
          date,
          startTimeHm: '07:15',
          endTimeHm: '07:45',
          startLat: HOME.lat + jitter,
          startLng: HOME.lng - jitter,
          endLat: WORK.lat + jitter,
          endLng: WORK.lng - jitter,
          durationMin: 30
        },
        {
          id: `pm_${idx}`,
          date,
          startTimeHm: '17:30',
          endTimeHm: '18:10',
          startLat: WORK.lat - jitter,
          startLng: WORK.lng + jitter,
          endLat: HOME.lat - jitter,
          endLng: HOME.lng + jitter,
          durationMin: 40
        }
      ];
    });

    const places = detectSemanticPlaces(tripsByDate, [STATION]);
    assert.ok(places.home, 'CASA should be detected');
    assert.equal(places.home.label, 'CASA');
    assert.ok(places.home.daysCount >= 4);

    assert.ok(places.work, 'TRABAJO should be detected');
    assert.equal(places.work.label, 'TRABAJO');
    assert.ok(places.work.daysCount >= 4);

    assert.equal(places.stations.length, 1);
    assert.equal(places.allPlaces.length, 3);

    assert.equal(resolvePlaceLabel(HOME.lat + 0.0001, HOME.lng, 'Cl 56', places), 'CASA');
    assert.equal(resolvePlaceLabel(WORK.lat - 0.0001, WORK.lng, 'Cra 53', places), 'TRABAJO');
    assert.equal(resolvePlaceLabel(STATION.lat, STATION.lng, 'Av Murillo', places), 'TERPEL MURILLO');
    assert.equal(resolvePlaceLabel(0, 0, 'Calle 80', places), 'Calle 80');
    assert.equal(resolvePlaceLabel(10.5000, -75.0000, 'Cartagena', places), 'Cartagena');
    assert.equal(resolvePlaceLabel(null, undefined, '', places), 'Ubicación');
  });

  test('computeStationHonestyIndex ranks stations with >= 2 valid cycles by severity-adjusted residual and excludes < 2 cycle stations', () => {
    const closedCycles = [
      { cycleIndex: 1, isValid: true, eff: 37.5, endDate: '2026-08-10', endOdo: 50300, physicalTelemetry: { severityFactor: 1.0 } },
      { cycleIndex: 2, isValid: true, eff: 36.8, endDate: '2026-08-20', endOdo: 50600, physicalTelemetry: { severityFactor: 1.02 } },
      { cycleIndex: 3, isValid: true, eff: 31.0, endDate: '2026-08-30', endOdo: 50900, physicalTelemetry: { severityFactor: 1.0 } },
      { cycleIndex: 4, isValid: true, eff: 30.5, endDate: '2026-09-10', endOdo: 51200, physicalTelemetry: { severityFactor: 1.0 } },
      { cycleIndex: 5, isValid: true, eff: 39.0, endDate: '2026-09-20', endOdo: 51500, physicalTelemetry: { severityFactor: 1.0 } }
    ];

    const telemetryLogs = [
      { id: 'l1', date: '2026-08-10', odometer_reading: 50300, stationId: 'st_good', stationName: 'Primax Norte' },
      { id: 'l2', date: '2026-08-20', odometer_reading: 50600, stationId: 'st_good', stationName: 'Primax Norte' },
      { id: 'l3', date: '2026-08-30', odometer_reading: 50900, stationId: 'st_bad', stationName: 'EDS Genérica' },
      { id: 'l4', date: '2026-09-10', odometer_reading: 51200, stationId: 'st_bad', stationName: 'EDS Genérica' },
      { id: 'l5', date: '2026-09-20', odometer_reading: 51500, stationId: 'st_single', stationName: 'Una Sola' }
    ];

    const result = computeStationHonestyIndex(closedCycles, telemetryLogs, []);
    assert.equal(result.totalQualifiedStations, 2);
    assert.equal(result.rankedStations.length, 2);
    assert.equal(result.rankedStations[0].stationId, 'st_good');
    assert.equal(result.rankedStations[1].stationId, 'st_bad');
    assert.ok(result.rankedStations[0].residualPct > 0);
    assert.ok(result.rankedStations[1].residualPct < 0);
    assert.equal(result.rankedStations.some(s => s.stationId === 'st_single'), false);
  });

  test('analyzeOptimalDeparture detects fastest/cheapest 15-min window on >= 6 trip corridor and exposes .primary', () => {
    const HOME = { lat: 10.9878, lng: -74.7889 };
    const WORK = { lat: 11.0155, lng: -74.8122 };
    const semanticPlaces = {
      home: { label: 'CASA', lat: HOME.lat, lng: HOME.lng },
      work: { label: 'TRABAJO', lat: WORK.lat, lng: WORK.lng },
      stations: []
    };

    const trips = [
      // 3 early trips at 06:45 (fast & cheap: 18 min, $3200)
      { date: '2026-09-01', startTimeHm: '06:46', durationMin: 18, estCostCop: 3200, startLat: HOME.lat, startLng: HOME.lng, endLat: WORK.lat, endLng: WORK.lng },
      { date: '2026-09-02', startTimeHm: '06:50', durationMin: 17, estCostCop: 3100, startLat: HOME.lat, startLng: HOME.lng, endLat: WORK.lat, endLng: WORK.lng },
      { date: '2026-09-03', startTimeHm: '06:48', durationMin: 19, estCostCop: 3300, startLat: HOME.lat, startLng: HOME.lng, endLat: WORK.lat, endLng: WORK.lng },
      // 5 rush-hour trips at 07:30 (slow & expensive: 30 min, $3900)
      { date: '2026-09-04', startTimeHm: '07:32', durationMin: 30, estCostCop: 3900, startLat: HOME.lat, startLng: HOME.lng, endLat: WORK.lat, endLng: WORK.lng },
      { date: '2026-09-05', startTimeHm: '07:35', durationMin: 31, estCostCop: 4000, startLat: HOME.lat, startLng: HOME.lng, endLat: WORK.lat, endLng: WORK.lng },
      { date: '2026-09-06', startTimeHm: '07:40', durationMin: 29, estCostCop: 3850, startLat: HOME.lat, startLng: HOME.lng, endLat: WORK.lat, endLng: WORK.lng },
      { date: '2026-09-07', startTimeHm: '07:31', durationMin: 32, estCostCop: 4100, startLat: HOME.lat, startLng: HOME.lng, endLat: WORK.lat, endLng: WORK.lng },
      { date: '2026-09-08', startTimeHm: '07:36', durationMin: 30, estCostCop: 3950, startLat: HOME.lat, startLng: HOME.lng, endLat: WORK.lat, endLng: WORK.lng }
    ];

    const corridors = analyzeOptimalDeparture(trips, { semanticPlaces });
    assert.equal(Array.isArray(corridors), true);
    assert.equal(corridors.length, 1);
    assert.ok(corridors.primary);
    assert.equal(corridors.primary.corridorLabel, 'CASA → TRABAJO');
    assert.equal(corridors.primary.bestWindowHm, '06:45');
    assert.equal(corridors.primary.bestDurationMin, 18);
    assert.ok(corridors.primary.savedMin >= 10);
    assert.ok(corridors.primary.savedCopPerTrip >= 500);
    assert.equal(corridors.primary.sampleCount, 8);

    // Fewer than 6 trips should return empty
    const sparse = analyzeOptimalDeparture(trips.slice(0, 4), { semanticPlaces });
    assert.equal(sparse.length, 0);
    assert.equal(sparse.primary, null);
  });

  test('computeParkingSentinel computes parked duration, semantic place, and resting voltage drift accurately', () => {
    const nowMs = Date.parse('2026-09-15T20:15:00Z');
    const twoHours15Ago = nowMs - (135 * 60 * 1000);
    const threeHoursAgo = nowMs - (180 * 60 * 1000);

    const semanticPlaces = {
      home: { label: 'CASA', lat: 10.9878, lng: -74.7889 },
      work: null,
      stations: []
    };

    const voltageHistory = [
      { ts: threeHoursAgo, v: 14.1, acc: true, speed: 35 },
      { ts: twoHours15Ago, v: 12.72, acc: false, speed: 0 },
      { ts: nowMs - 60 * 60 * 1000, v: 12.64, acc: false, speed: 0 },
      { ts: nowMs - 5 * 60 * 1000, v: 12.60, acc: false, speed: 0 }
    ];

    const live = {
      accStatus: false,
      lat: 10.98782,
      lng: -74.78891,
      address: 'Cl. 56 #13-13',
      externalVoltage: 12.58,
      speed: 0
    };

    const sentinel = computeParkingSentinel(live, voltageHistory, semanticPlaces, nowMs);
    assert.equal(sentinel.hasData, true);
    assert.equal(sentinel.isParked, true);
    assert.equal(sentinel.placeLabel, 'CASA');
    assert.equal(sentinel.parkedMinutes, 135);
    assert.equal(sentinel.parkedDurationLabel, '2H 15M');
    assert.equal(sentinel.currentVoltage, 12.58);
    assert.equal(sentinel.voltageDeltaV, -0.14);

    // Missing live snapshot guard
    assert.deepEqual(computeParkingSentinel(null), { isParked: false, hasData: false });

    // Driving state
    const driving = computeParkingSentinel({ accStatus: true, lat: 10.99, lng: -74.80, speed: 42, externalVoltage: 14.15 }, voltageHistory, semanticPlaces, nowMs);
    assert.equal(driving.isParked, false);
    assert.equal(driving.parkedMinutes, 0);
    assert.equal(driving.voltageDeltaV, 0);
  });

  test('computeCockpitGpsSummary exposes semanticPlaces, parkingSentinel, and resolved latestTrip labels', () => {
    const HOME = { lat: 10.9878, lng: -74.7889 };
    const WORK = { lat: 11.0155, lng: -74.8122 };
    const tripsByDate = {};
    ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'].forEach((date, i) => {
      tripsByDate[date] = [
        { id: `a${i}`, date, startTimeHm: '07:15', endTimeHm: '07:45', startTimeMs: Date.parse(`${date}T12:15:00Z`), startLat: HOME.lat, startLng: HOME.lng, endLat: WORK.lat, endLng: WORK.lng, startAddress: 'Cl 56', endAddress: 'Cra 53', distanceKm: 6.2 },
        { id: `b${i}`, date, startTimeHm: '17:30', endTimeHm: '18:05', startTimeMs: Date.parse(`${date}T22:30:00Z`), startLat: WORK.lat, startLng: WORK.lng, endLat: HOME.lat, endLng: HOME.lng, startAddress: 'Cra 53', endAddress: 'Cl 56', distanceKm: 6.4 }
      ];
    });

    const summary = computeCockpitGpsSummary({
      gpsCache: {
        live: { accStatus: false, lat: HOME.lat, lng: HOME.lng, externalVoltage: 12.6, syncedAt: '2026-09-11T23:00:00Z' },
        tripsByDate,
        voltageHistory: [{ ts: Date.parse('2026-09-11T22:30:00Z'), v: 12.65, acc: false }]
      }
    }, null, new Date('2026-09-11T23:30:00Z'));

    assert.equal(summary.parkingSentinel.isParked, true);
    assert.equal(summary.parkingSentinel.placeLabel, 'CASA');
    assert.equal(summary.latestTrip.startLabel, 'TRABAJO');
    assert.equal(summary.latestTrip.endLabel, 'CASA');
  });

  test('Full codebase compliance audit: ZERO <p> tags, ZERO technical jargon in UI markup across ALL src/views/ & src/components/, ZERO hardcoded credentials', () => {
    const uiDirs = ['src/views', 'src/components'].map(d => path.join(REPO_ROOT, d));
    const jargonRegex = /\b(Ridge|Haversine|IndexedDB|EMA|OLS|MJ)\b/i;

    for (const dir of uiDirs) {
      for (const filePath of walkJsFiles(dir)) {
        const rel = path.relative(REPO_ROOT, filePath);
        const raw = fs.readFileSync(filePath, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\/\/.*$/gm, '');

        assert.equal(/<p[\s>]/i.test(raw), false, `${rel} must not contain <p> HTML tags`);

        const templateTexts = [...raw.matchAll(/`([\s\S]*?)`/g)]
          .map(m => m[1])
          .filter(s => s.includes('<') && s.includes('>'))
          .map(s => s.replace(/\$\{[\s\S]*?\}/g, ' ').replace(/<[^>]+>/g, ' '))
          .join(' ');

        assert.equal(jargonRegex.test(templateTexts), false, `${rel} UI markup must not leak technical jargon`);
      }
    }

    const credDirs = ['src', 'infra', 'tests']
      .map(d => path.join(REPO_ROOT, d))
      .filter(d => fs.existsSync(d));
    const forbiddenPatterns = [
      new RegExp('JGN' + '691'),
      new RegExp('Spicy' + '691'),
      new RegExp('359710' + '04')
    ];

    for (const dir of credDirs) {
      for (const filePath of walkJsFiles(dir)) {
        if (path.resolve(filePath) === __filename) continue;
        const content = fs.readFileSync(filePath, 'utf8');
        for (const pat of forbiddenPatterns) {
          assert.equal(pat.test(content), false, `Hardcoded credential detected in ${path.relative(REPO_ROOT, filePath)}`);
        }
      }
    }
  });
});


