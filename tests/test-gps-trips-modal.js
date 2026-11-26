import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  groupTripsByDay,
  computeTripsSummary,
  applyThermalDissipation,
  resolveProxyMode,
  formatCleanGpsAddress,
  buildCanonicalTripId,
  classifyTripDatesToFetch,
  groupDatesIntoFetchWindows,
  fetchGpsCycleTrips
} from '../src/core/iopgps-sync.js';
import {
  mergeTripsByDateMaps,
  mergeVehicleProfileRecords
} from '../src/core/db-local.js';
import {
  calculateDistanceMeters,
  learnGasStation,
  checkStopNearStation
} from '../src/core/gas-station-matcher.js';
import {
  detectRecurrentRoute,
  extractRecurrentDynamicTrips
} from '../src/views/modal-ghost-race.js';

describe('IOPGPS Sync Pure Utilities', () => {
  test('formatCleanGpsAddress strips Colombian boilerplate while keeping street and neighborhood', () => {
    assert.equal(
      formatCleanGpsAddress('Cl. 56 #13-13, La Ceiba, Barranquilla, Atlántico, Colombia'),
      'Cl. 56 #13-13 · La Ceiba'
    );
    assert.equal(formatCleanGpsAddress(''), 'Ubicación GPS');
  });

  test('applyThermalDissipation penalizes short cold trips more than warm consecutive trips', () => {
    const baseTime = Date.parse('2026-09-15T13:00:00Z');
    const trips = [
      {
        id: 't_cold',
        date: '2026-09-15',
        startTimeMs: baseTime,
        endTimeMs: baseTime + 10 * 60 * 1000,
        distanceKm: 1.5,
        baseSeverity: 1.0
      },
      {
        id: 't_warm',
        date: '2026-09-15',
        startTimeMs: baseTime + 15 * 60 * 1000, // only 5 min engine off
        endTimeMs: baseTime + 25 * 60 * 1000,
        distanceKm: 1.5,
        baseSeverity: 1.0
      }
    ];

    applyThermalDissipation(trips, { baseEff: 33.71, fuelPriceCop: 16000 });
    assert.equal(trips[0].thermalRetentionPct, 0);
    assert.ok(trips[0].coldPenaltyPct > trips[1].coldPenaltyPct);
    assert.ok(trips[1].thermalRetentionPct > 85);
    assert.ok(trips[0].tripSeverity > trips[1].tripSeverity);
  });

  test('groupTripsByDay and computeTripsSummary aggregate daily and total metrics accurately', () => {
    const trips = [
      {
        id: 't1',
        date: '2026-09-14',
        startTimeMs: 1789390000000,
        distanceKm: 10,
        durationSec: 1200,
        estGallons: 0.3,
        estCostCop: 4800,
        trackPoints: [{ lat: 10.98, lng: -74.79, speed: 30 }, { lat: 10.99, lng: -74.80, speed: 40 }]
      },
      {
        id: 't2',
        date: '2026-09-15',
        startTimeMs: 1789470000000,
        distanceKm: 20,
        durationSec: 1800,
        estGallons: 0.6,
        estCostCop: 9600,
        trackPoints: [{ lat: 10.99, lng: -74.80, speed: 10 }, { lat: 11.01, lng: -74.81, speed: 50 }]
      }
    ];

    const days = groupTripsByDay(trips);
    assert.equal(days.length, 2);
    assert.equal(days[0].date, '2026-09-15');
    assert.equal(days[0].totalKm, 20);
    assert.ok(days[0].routeGlyph.startsWith('M '));

    const summary = computeTripsSummary(trips, [{ duration: 120 }]);
    assert.equal(summary.tripCount, 2);
    assert.equal(summary.totalKm, 30);
    assert.equal(summary.totalIdleSec, 120);
    assert.equal(summary.totalEstCostCop, 14400);
  });

  test('resolveProxyMode prioritizes private-proxy, localhost vite-proxy, public-bridge, and Node direct', () => {
    assert.equal(
      resolveProxyMode({ proxyUrl: 'https://my-proxy.workers.dev/' }, { isBrowser: true, hostname: 'octane-app.web.app' }).mode,
      'private-proxy'
    );
    assert.equal(
      resolveProxyMode({ proxyUrl: 'https://my-proxy.workers.dev/iopgps-api/' }, { isBrowser: true, hostname: 'localhost' }).apiBase,
      'https://my-proxy.workers.dev/iopgps-api'
    );
    assert.equal(
      resolveProxyMode({}, { isBrowser: true, hostname: 'localhost' }).mode,
      'vite-proxy'
    );
    assert.equal(
      resolveProxyMode({}, { isBrowser: true, hostname: 'octane-app.web.app' }).mode,
      'public-bridge'
    );
    assert.equal(
      resolveProxyMode({ proxyUrl: 'https://my-proxy.workers.dev' }, { isBrowser: false }).mode,
      'direct'
    );
  });
});

describe('Gas Station Matcher & Recurrent Route Clustering', () => {
  test('calculateDistanceMeters, learnGasStation, and checkStopNearStation work coherently', () => {
    const sameSpot = calculateDistanceMeters(10.9878, -74.7889, 10.9878, -74.7889);
    assert.equal(sameSpot, 0);

    const profile = { learnedGasStations: [] };
    const st1 = learnGasStation(profile, { lat: 10.9878, lng: -74.7889 }, 'Terpel Murillo');
    assert.equal(st1.refuelCount, 1);

    // Nearby stop within 80m clusters into the existing station
    const st2 = learnGasStation(profile, { lat: 10.9879, lng: -74.78895 }, 'Terpel Murillo');
    assert.equal(profile.learnedGasStations.length, 1);
    assert.equal(st2.refuelCount, 2);

    // Short stop < 120s must not trigger
    assert.equal(checkStopNearStation({ lat: 10.98785, lng: -74.7889, durationSeconds: 90 }, profile.learnedGasStations), null);

    // Valid stop >= 120s within 60m must match
    const matched = checkStopNearStation({ lat: 10.98785, lng: -74.7889, durationSeconds: 180 }, profile.learnedGasStations);
    assert.ok(matched);
    assert.equal(matched.name, 'Terpel Murillo');
  });

  test('detectRecurrentRoute clusters >= 2 matching commute trips', () => {
    const tripsByDate = {
      '2026-09-14': [
        {
          id: 'c1',
          date: '2026-09-14',
          startTimeHm: '07:30',
          distanceKm: 8.5,
          durationSec: 1200,
          trackPoints: [
            { lat: 10.9800, lng: -74.7900, speed: 20, time: 100 },
            { lat: 11.0100, lng: -74.8100, speed: 30, time: 1300 }
          ]
        }
      ],
      '2026-09-15': [
        {
          id: 'c2',
          date: '2026-09-15',
          startTimeHm: '07:45',
          distanceKm: 8.7,
          durationSec: 1150,
          trackPoints: [
            { lat: 10.9803, lng: -74.7902, speed: 22, time: 100 },
            { lat: 11.0102, lng: -74.8101, speed: 32, time: 1250 }
          ]
        }
      ]
    };

    const route = detectRecurrentRoute(tripsByDate);
    assert.ok(route);
    assert.equal(route.tripsCount, 2);
  });
});

function makeTrack(startLat, startLng, endLat, endLng, startUnixSec, count = 15, durationSec = 1500) {
  return Array.from({ length: count }, (_, i) => {
    const ratio = i / Math.max(1, count - 1);
    return {
      lat: Number((startLat + (endLat - startLat) * ratio).toFixed(6)),
      lng: Number((startLng + (endLng - startLng) * ratio).toFixed(6)),
      speed: 25 + (i % 12),
      time: Math.round(startUnixSec + ratio * durationSec),
      heading: 315
    };
  });
}

function makeRawApiTrip(dateYmd, startHourCol, distKm, startLat, startLng, endLat, endLng) {
  const startMs = Date.parse(`${dateYmd}T${String(startHourCol).padStart(2, '0')}:20:00-05:00`);
  const endMs = startMs + 1800 * 1000;
  const startSec = Math.floor(startMs / 1000);
  const pts = Array.from({ length: 14 }, (_, i) => {
    const r = i / 13;
    return {
      '4': 315,
      '7': startSec + i * 120,
      '9': Number((startLat + (endLat - startLat) * r).toFixed(6)),
      '10': Number((startLng + (endLng - startLng) * r).toFixed(6)),
      '12': 28,
      '13': 1
    };
  });
  return {
    startTime: startMs,
    endTime: endMs,
    mileage: distKm,
    tripTime: 1800,
    speedMax: 58,
    startAddress: 'Cl. 56 #13-13, La Ceiba, Barranquilla, Colombia',
    endAddress: 'Km 5 Vía Puerto Colombia, Uninorte, Barranquilla, Colombia',
    deviceTrackPoints: pts
  };
}

describe('Immutable-Past Incremental GPS Cache & Archiving', () => {
  test('classifyTripDatesToFetch seals past days, skips 0-km days, and only requests missing/unfinalized/stale dates', () => {
    const nowMs = Date.parse('2026-11-26T15:00:00Z');
    const profile = {
      gpsCache: {
        live: { date: '2026-11-26', todayMile: 12.4 },
        days: {
          '2026-11-22': { date: '2026-11-22', km: 0, runNo: 0 }, // parked Sunday -> 0 API calls
          '2026-11-26': { date: '2026-11-26', km: 12.4, runNo: 1 }
        },
        tripsByDate: {
          '2026-11-20': [{ id: 't20', date: '2026-11-20', distanceKm: 10, trackPoints: makeTrack(10.95, -74.80, 11.01, -74.85, 1795000000) }],
          '2026-11-21': [{ id: 't21', date: '2026-11-21', distanceKm: 9, trackPoints: [] }], // cloud-stripped tracks
          '2026-11-23': [{ id: 't23', date: '2026-11-23', distanceKm: 11, trackPoints: [] }], // tracksUnavailable -> don't retry
          '2026-11-25': [{ id: 't25', date: '2026-11-25', distanceKm: 12, trackPoints: makeTrack(10.95, -74.80, 11.01, -74.85, 1795500000) }],
          '2026-11-26': [{ id: 't26', date: '2026-11-26', distanceKm: 12.4, trackPoints: makeTrack(10.95, -74.80, 11.01, -74.85, 1795600000) }]
        },
        tripsMeta: {
          '2026-11-20': { finalized: true, syncedOnDate: '2026-11-21', syncedAt: '2026-11-21T12:00:00Z' },
          '2026-11-21': { finalized: true, syncedOnDate: '2026-11-22', syncedAt: '2026-11-22T12:00:00Z' },
          '2026-11-23': { finalized: true, syncedOnDate: '2026-11-24', syncedAt: '2026-11-24T12:00:00Z', tracksUnavailable: true },
          '2026-11-25': { finalized: false, syncedOnDate: '2026-11-25', syncedAt: '2026-11-25T15:00:00Z' }, // synced mid-day yesterday -> finalize once
          '2026-11-26': { finalized: false, syncedOnDate: '2026-11-26', syncedAt: '2026-11-26T14:58:00Z' }  // 2 min ago -> fresh!
        },
        lastTripsSyncedDate: '2026-11-26',
        lastTripsSyncedAt: '2026-11-26T14:58:00Z'
      }
    };

    const plan = classifyTripDatesToFetch('2026-11-20', '2026-11-26', profile, {
      todayStr: '2026-11-26',
      nowMs
    });

    assert.deepEqual(plan.zeroActivityPastDays, ['2026-11-22']);
    assert.deepEqual(plan.datesToFetch, ['2026-11-21', '2026-11-24', '2026-11-25']);
    assert.equal(plan.reasonByDate['2026-11-21'], 'missing_tracks');
    assert.equal(plan.reasonByDate['2026-11-24'], 'missing');
    assert.equal(plan.reasonByDate['2026-11-25'], 'unfinalized_past');
    // 2026-11-20 (sealed), 2026-11-22 (0-km), 2026-11-23 (tracksUnavailable), 2026-11-26 (fresh 2 min ago)
    assert.equal(plan.sealedCount, 4);

    // Even with forceRefresh: true, already-sealed past day 2026-11-20 is NEVER re-fetched, while today IS refreshed
    const refreshPlan = classifyTripDatesToFetch('2026-11-20', '2026-11-26', profile, {
      todayStr: '2026-11-26',
      nowMs,
      forceRefresh: true
    });
    assert.equal(refreshPlan.datesToFetch.includes('2026-11-20'), false);
    assert.equal(refreshPlan.datesToFetch.includes('2026-11-26'), true);
  });

  test('groupDatesIntoFetchWindows chunks large spans into <= 10-day windows and respects cached gaps', () => {
    const dates = [
      '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05',
      '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10',
      '2026-10-11', '2026-10-12',
      // Gap on 10-13..10-19 (already cached!)
      '2026-10-20', '2026-10-22' // 10-21 is bridgeable zero-km day
    ];

    const windows = groupDatesIntoFetchWindows(dates, 10, {
      order: 'desc',
      bridgeableDates: ['2026-10-21']
    });

    assert.equal(windows.length, 3);
    assert.equal(windows[0].startYmd, '2026-10-20');
    assert.equal(windows[0].endYmd, '2026-10-22');
    assert.equal(windows[1].startYmd, '2026-10-11');
    assert.equal(windows[1].endYmd, '2026-10-12');
    assert.equal(windows[2].startYmd, '2026-10-01');
    assert.equal(windows[2].endYmd, '2026-10-10');
  });

  test('fetchGpsCycleTrips fetches incrementally, seals past days, never re-fetches sealed history, and never wipes on API errors', async () => {
    let storedProfile = {
      id: 'main',
      fuelPriceCop: 16000,
      benchmarkEff: 34,
      gpsConfig: { enabled: true, username: 'demo_user', password: 'demo_password', imei: '000000000000001' },
      gpsCache: {
        days: { '2026-11-16': { date: '2026-11-16', km: 0, runNo: 0 } },
        tripsByDate: {},
        tripsMeta: {}
      }
    };

    const apiCalls = [];
    let simulateError = false;
    let simulateEmpty = false;

    const mockApiClient = async (path) => {
      if (path.includes('/travel')) {
        apiCalls.push(path);
        if (simulateError) return { code: 500, message: 'upstream error' };
        if (simulateEmpty) return { code: 0, data: [] };

        const url = new URL(`https://example.test${path}`);
        const sUnix = Number(url.searchParams.get('startTime'));
        const eUnix = Number(url.searchParams.get('endTime'));
        const allMockTrips = [
          makeRawApiTrip('2026-11-15', 7, 12.3, 10.9587, -74.8067, 11.0181, -74.8516),
          makeRawApiTrip('2026-11-18', 7, 12.4, 10.9587, -74.8067, 11.0200, -74.8487),
          makeRawApiTrip('2026-11-26', 7, 12.2, 10.9587, -74.8067, 11.0185, -74.8510)
        ];
        const matched = allMockTrips.filter(t => (t.startTime / 1000) >= sUnix && (t.startTime / 1000) <= eUnix);
        return { code: 0, data: matched };
      }
      return { code: 0, data: [] };
    };

    const deps = {
      profileProvider: async () => JSON.parse(JSON.stringify(storedProfile)),
      profileSaver: async (next) => {
        storedProfile = {
          ...storedProfile,
          ...next,
          gpsCache: {
            ...(storedProfile.gpsCache || {}),
            ...(next.gpsCache || {}),
            tripsByDate: mergeTripsByDateMaps(storedProfile.gpsCache?.tripsByDate, next.gpsCache?.tripsByDate)
          }
        };
        return JSON.parse(JSON.stringify(storedProfile));
      },
      apiClient: mockApiClient,
      logsProvider: async () => [],
      engineSnap: null,
      skipCloudSync: true
    };

    // 1. Initial load of 12-day span (Nov 15..Nov 26): chunks into <=10-day windows and skips 0-km Nov 16
    const first = await fetchGpsCycleTrips('2026-11-15', '2026-11-26', {
      ...deps,
      todayStr: '2026-11-26',
      nowMs: Date.parse('2026-11-26T15:00:00Z')
    });
    assert.equal(first.fromCache, false);
    assert.equal(first.trips.length, 3);
    assert.equal(apiCalls.length, 2, '12-day span must be split into 2 safe <=10-day windows');
    assert.equal(storedProfile.gpsCache.tripsMeta['2026-11-15'].finalized, true);
    assert.equal(storedProfile.gpsCache.tripsMeta['2026-11-16'].finalized, true);
    assert.equal(storedProfile.gpsCache.tripsMeta['2026-11-26'].finalized, false);

    // 2. Re-opening 2 minutes later makes ZERO API calls
    const second = await fetchGpsCycleTrips('2026-11-15', '2026-11-26', {
      ...deps,
      todayStr: '2026-11-26',
      nowMs: Date.parse('2026-11-26T15:02:00Z')
    });
    assert.equal(second.fromCache, true);
    assert.equal(second.trips.length, 3);
    assert.equal(apiCalls.length, 2, 'Must make zero API calls when cache is fresh');

    // 3. Next day (Nov 27): fetches ONLY Nov 26 (unfinalized yesterday) + Nov 27 (today) in 1 tiny call
    const third = await fetchGpsCycleTrips('2026-11-15', '2026-11-27', {
      ...deps,
      todayStr: '2026-11-27',
      nowMs: Date.parse('2026-11-27T15:00:00Z')
    });
    assert.equal(apiCalls.length, 3, 'Only 1 incremental window for yesterday+today should be fetched');
    const lastCallUrl = new URL(`https://example.test${apiCalls[2]}`);
    const spanSec = Number(lastCallUrl.searchParams.get('endTime')) - Number(lastCallUrl.searchParams.get('startTime'));
    assert.ok(spanSec <= 2 * 86400, `Expected <=2-day incremental fetch, got ${spanSec}s`);
    assert.equal(storedProfile.gpsCache.tripsMeta['2026-11-26'].finalized, true);
    assert.equal(third.trips.length, 3);

    // 4. Anti-wipe guarantee: forced full refetch hitting upstream error or empty retention NEVER wipes past trips
    simulateError = true;
    await fetchGpsCycleTrips('2026-11-15', '2026-11-27', {
      ...deps,
      todayStr: '2026-11-27',
      nowMs: Date.parse('2026-11-27T16:00:00Z'),
      forceFullRefetch: true
    });
    assert.equal(storedProfile.gpsCache.tripsByDate['2026-11-15'].length, 1);

    simulateError = false;
    simulateEmpty = true;
    await fetchGpsCycleTrips('2026-11-15', '2026-11-27', {
      ...deps,
      todayStr: '2026-11-27',
      nowMs: Date.parse('2026-11-27T16:10:00Z'),
      forceFullRefetch: true
    });
    assert.equal(storedProfile.gpsCache.tripsByDate['2026-11-15'].length, 1, 'Empty API response must NEVER wipe existing trips');
    assert.equal(storedProfile.gpsCache.tripsByDate['2026-11-18'].length, 1);
  });

  test('mergeTripsByDateMaps and mergeVehicleProfileRecords preserve multi-cycle trips and tracks symmetrically', () => {
    const startMs = Date.parse('2026-09-10T12:20:00Z');
    const local = {
      id: 'main',
      name: 'Local Car',
      updatedAt: '2026-11-26T15:00:00.000Z', // Local is NEWER than cloud
      gpsConfig: { enabled: true, username: 'demo_user', password: 'kept_local_secret' },
      gpsCache: {
        days: { '2026-11-20': { date: '2026-11-20', km: 25, runNo: 2 } },
        tripsByDate: {
          '2026-09-10': [{
            id: `trip_${startMs}_0`, // legacy index ID
            date: '2026-09-10',
            startTimeMs: startMs,
            distanceKm: 12.4,
            trackPoints: makeTrack(10.9587, -74.8067, 11.0181, -74.8516, Math.floor(startMs / 1000))
          }],
          '2026-11-20': [{
            id: 'trip_nov_20',
            date: '2026-11-20',
            startTimeMs: Date.parse('2026-11-20T12:20:00Z'),
            distanceKm: 12.2,
            trackPoints: makeTrack(10.9587, -74.8067, 11.0181, -74.8516, 1795177200)
          }]
        }
      }
    };

    const cloud = {
      id: 'main',
      name: 'Older Cloud Name',
      updatedAt: '2026-11-25T10:00:00.000Z', // Older than local
      gpsConfig: { enabled: true, username: 'demo_user', password: '' },
      gpsCache: {
        days: { '2026-08-05': { date: '2026-08-05', km: 18, runNo: 2 } },
        tripsByDate: {
          '2026-08-05': [{ id: 'trip_aug_05', date: '2026-08-05', startTimeMs: Date.parse('2026-08-05T12:20:00Z'), distanceKm: 12.1 }],
          '2026-09-10': [{
            id: buildCanonicalTripId(startMs, startMs + 1800000), // canonical ID, cloud-stripped tracks
            date: '2026-09-10',
            startTimeMs: startMs,
            distanceKm: 12.4
          }],
          '2026-11-20': [] // empty cloud array must NEVER wipe local trips
        }
      }
    };

    const merged = mergeVehicleProfileRecords(local, cloud);
    assert.equal(merged.name, 'Local Car', 'Newer local scalar settings must win');
    assert.equal(merged.gpsConfig.password, 'kept_local_secret');
    assert.equal(merged.gpsCache.days['2026-08-05'].km, 18, 'Cloud past day stats must still merge into newer local');
    assert.equal(merged.gpsCache.tripsByDate['2026-08-05'].length, 1, 'Cloud past cycle trips must merge into newer local');
    assert.equal(merged.gpsCache.tripsByDate['2026-09-10'].length, 1, 'Legacy and canonical IDs for same startTimeMs must deduplicate');
    assert.equal(merged.gpsCache.tripsByDate['2026-09-10'][0].trackPoints.length, 15, 'Local trackPoints must survive merge');
    assert.equal(merged.gpsCache.tripsByDate['2026-11-20'].length, 1, 'Empty cloud array must never wipe local trips');
  });

  test('Ghost Race accumulates matching commutes across multiple past cycles and campus gates/windows', () => {
    const tripsByDate = {
      // Cycle 1 (March): departure 07:15, campus gate A
      '2026-03-06': [{
        id: 't_mar_06',
        date: '2026-03-06',
        startTimeMs: Date.parse('2026-03-06T07:15:00-05:00'),
        endTimeMs: Date.parse('2026-03-06T07:47:00-05:00'),
        startTimeHm: '07:15',
        distanceKm: 12.4,
        durationSec: 1920,
        startAddress: 'La Ceiba',
        endAddress: 'Uninorte',
        trackPoints: makeTrack(10.95869, -74.80671, 11.01806, -74.85161, 1772799300, 16, 1920)
      }],
      // Cycle 2 (September): departure 08:04 (49 min later), campus gate B (~383m away from gate A)
      '2026-09-14': [{
        id: 't_sep_14',
        date: '2026-09-14',
        startTimeMs: Date.parse('2026-09-14T08:04:00-05:00'),
        endTimeMs: Date.parse('2026-09-14T08:35:00-05:00'),
        startTimeHm: '08:04',
        distanceKm: 12.3,
        durationSec: 1860,
        startAddress: 'La Ceiba',
        endAddress: 'Uninorte',
        trackPoints: makeTrack(10.95870, -74.80672, 11.02007, -74.84875, 1789391040, 16, 1860)
      }],
      // Cycle 3 (November — current cycle): departure 07:25
      '2026-11-24': [{
        id: 't_nov_24',
        date: '2026-11-24',
        startTimeMs: Date.parse('2026-11-24T07:25:00-05:00'),
        endTimeMs: Date.parse('2026-11-24T07:54:00-05:00'),
        startTimeHm: '07:25',
        distanceKm: 12.35,
        durationSec: 1740,
        startAddress: 'La Ceiba',
        endAddress: 'Uninorte',
        trackPoints: makeTrack(10.95868, -74.80668, 11.01850, -74.85090, 1795523100, 16, 1740)
      }],
      '2026-11-26': [{
        id: 't_nov_26',
        date: '2026-11-26',
        startTimeMs: Date.parse('2026-11-26T07:30:00-05:00'),
        endTimeMs: Date.parse('2026-11-26T08:00:00-05:00'),
        startTimeHm: '07:30',
        distanceKm: 12.38,
        durationSec: 1800,
        startAddress: 'La Ceiba',
        endAddress: 'Uninorte',
        trackPoints: makeTrack(10.95871, -74.80670, 11.01910, -74.85010, 1795696200, 16, 1800)
      }]
    };

    const route = detectRecurrentRoute(tripsByDate, { minTrackPoints: 10 });
    assert.ok(route);
    assert.equal(route.tripsCount, 4, 'All 4 commutes across March, September, and November must cluster together');
    assert.equal(route.playableTripsCount, 4);

    // Even if passed a stale route descriptor with only 1 tripId from Cycle 1, extraction accumulates ALL 4 trips
    const staleRoute = { ...route, tripIds: ['t_mar_06'] };
    const ghostTrips = extractRecurrentDynamicTrips(staleRoute, tripsByDate);
    assert.ok(Array.isArray(ghostTrips));
    assert.equal(ghostTrips.length, 4, 'Ghost Race must include all 4 accumulated trips across past + current cycles');
    assert.equal(ghostTrips[0].id, 't_nov_24', 'Fastest trip (1740s) must rank #1 (PB)');
    assert.equal(ghostTrips[0].rank, 1);
  });
});
