import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  groupTripsByDay,
  computeTripsSummary,
  applyThermalDissipation,
  resolveProxyMode,
  formatCleanGpsAddress
} from '../src/core/iopgps-sync.js';
import {
  calculateDistanceMeters,
  learnGasStation,
  checkStopNearStation
} from '../src/core/gas-station-matcher.js';
import { detectRecurrentRoute } from '../src/views/modal-ghost-race.js';

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
