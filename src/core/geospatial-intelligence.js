/**
 * OCTANE // KINETIC — Pure Passive Geospatial Intelligence Engine
 *
 * 100% pure mathematical core (zero DOM, zero IndexedDB, zero network).
 * Implements:
 * - Semantic place clustering & discovery (CASA overnight, TRABAJO weekday stays, learned stations)
 * - Fast coordinate-to-place label resolution
 * - Station Honesty Index (severity-adjusted efficiency residuals grouped by station, >= 2 cycles)
 * - Optimal Departure Time Analyzer (directed corridor clustering + 15-min departure window comparison)
 * - Parking Sentinel (resting state, parked duration, semantic location & voltage drift while parked)
 */

import { calculateDistanceMeters } from './gas-station-matcher.js';

const PLACE_CLUSTER_RADIUS_M = 120;
const WORK_MIN_DISTANCE_FROM_HOME_M = 500;
const MIN_SEMANTIC_DAYS = 4;
const WORK_MIN_STAY_MIN = 180; // 3 hours
const CORRIDOR_RADIUS_M = 400;
const CORRIDOR_MIN_TRIPS = 6;
const CORRIDOR_MIN_DISTANCE_KM = 3.0;
const CORRIDOR_MIN_DISPLACEMENT_M = 500;
const STATION_MIN_CYCLES = 2;

function isValidCoord(lat, lng) {
  const nLat = Number(lat);
  const nLng = Number(lng);
  if (!Number.isFinite(nLat) || !Number.isFinite(nLng)) return false;
  if (nLat === 0 && nLng === 0) return false;
  if (Math.abs(nLat) > 90 || Math.abs(nLng) > 180) return false;
  return true;
}

function normalizeTimestampMs(rawTs) {
  const num = Number(rawTs);
  if (!Number.isFinite(num) || num <= 0) return null;
  return num < 1e12 ? Math.round(num * 1000) : Math.round(num);
}

function parseHmToMinutes(hm) {
  if (typeof hm !== 'string') return null;
  const match = hm.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    return null;
  }
  return h * 60 + m;
}

function minutesFromTimestampMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.getHours() * 60 + d.getMinutes();
}

function minutesToHm(totalMinutes) {
  const clamped = ((Math.round(Number(totalMinutes) || 0) % 1440) + 1440) % 1440;
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function getWeekdayFromYmd(ymd) {
  if (typeof ymd !== 'string' || ymd.length < 10) return null;
  const parts = ymd.slice(0, 10).split('-').map(Number);
  if (parts.length !== 3 || parts.some(p => !Number.isFinite(p))) return null;
  const d = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d.getDay();
}

function computeMedian(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const clean = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (clean.length === 0) return 0;
  const mid = Math.floor(clean.length / 2);
  return clean.length % 2 === 1 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

function extractTripGeo(trip, fallbackDate = '') {
  if (!trip || typeof trip !== 'object') return null;

  const track = Array.isArray(trip.trackPoints) ? trip.trackPoints : [];
  const firstPt = track.length > 0 ? track[0] : null;
  const lastPt = track.length > 0 ? track[track.length - 1] : null;

  const rawStartLat = trip.startLat ?? trip.startLatitude ?? firstPt?.lat ?? firstPt?.latitude;
  const rawStartLng = trip.startLng ?? trip.startLongitude ?? firstPt?.lng ?? firstPt?.longitude ?? firstPt?.lon;
  const rawEndLat = trip.endLat ?? trip.endLatitude ?? lastPt?.lat ?? lastPt?.latitude;
  const rawEndLng = trip.endLng ?? trip.endLongitude ?? lastPt?.lng ?? lastPt?.longitude ?? lastPt?.lon;

  const hasStart = isValidCoord(rawStartLat, rawStartLng);
  const hasEnd = isValidCoord(rawEndLat, rawEndLng);

  const date = String(trip.date || fallbackDate || '').slice(0, 10);
  const startTimeMs = normalizeTimestampMs(trip.startTimeMs ?? trip.startTime);
  const endTimeMs = normalizeTimestampMs(trip.endTimeMs ?? trip.endTime);

  const durationMinRaw = Number(trip.durationMin);
  const durationSecRaw = Number(trip.durationSec ?? trip.duration);
  let durationMin = 0;
  if (Number.isFinite(durationMinRaw) && durationMinRaw > 0) {
    durationMin = durationMinRaw;
  } else if (Number.isFinite(durationSecRaw) && durationSecRaw > 0) {
    durationMin = durationSecRaw / 60;
  } else if (startTimeMs && endTimeMs && endTimeMs > startTimeMs) {
    durationMin = (endTimeMs - startTimeMs) / 60000;
  }

  let startMin = parseHmToMinutes(trip.startTimeHm);
  if (startMin === null && startTimeMs !== null) {
    startMin = minutesFromTimestampMs(startTimeMs);
  }

  let endMin = parseHmToMinutes(trip.endTimeHm);
  if (endMin === null && endTimeMs !== null) {
    endMin = minutesFromTimestampMs(endTimeMs);
  }
  if (endMin === null && startMin !== null && durationMin > 0) {
    endMin = Math.round(startMin + durationMin) % 1440;
  }

  const costCop = Number(trip.reconciledCostCop ?? trip.estCostCop) || 0;
  const distanceKm = Number(trip.distanceKm ?? trip.km ?? trip.mileageKm) || 0;

  return {
    trip,
    date,
    hasStart,
    hasEnd,
    startLat: hasStart ? Number(rawStartLat) : null,
    startLng: hasStart ? Number(rawStartLng) : null,
    endLat: hasEnd ? Number(rawEndLat) : null,
    endLng: hasEnd ? Number(rawEndLng) : null,
    startMin,
    endMin,
    startTimeMs,
    endTimeMs,
    durationMin,
    distanceKm,
    costCop,
    startAddress: trip.startAddress || trip.rawStartAddress || '',
    endAddress: trip.endAddress || trip.rawEndAddress || ''
  };
}

/**
 * Passively discovers recurring semantic places (CASA, TRABAJO, learned stations)
 * from historical GPS trip endpoints using 120 m centroid running-average clustering.
 *
 * @param {Object} [tripsByDate={}]
 * @param {Array<Object>} [learnedStations=[]]
 * @param {Object} [customLabels={}]
 * @returns {{ home: Object|null, work: Object|null, stations: Array<Object>, allPlaces: Array<Object> }}
 */
export function detectSemanticPlaces(tripsByDate = {}, learnedStations = [], customLabels = {}) {
  const safeCustom = customLabels && typeof customLabels === 'object' ? customLabels : {};
  const stations = [];

  if (Array.isArray(learnedStations)) {
    for (const st of learnedStations) {
      if (!st || typeof st !== 'object') continue;
      const sLat = Number(st.lat ?? st.latitude);
      const sLng = Number(st.lng ?? st.longitude ?? st.lon);
      if (!isValidCoord(sLat, sLng)) continue;
      const name = String(st.name || 'ESTACIÓN').trim() || 'ESTACIÓN';
      stations.push({
        id: st.id || '',
        name,
        label: name.toUpperCase(),
        lat: Number(sLat.toFixed(6)),
        lng: Number(sLng.toFixed(6)),
        radiusMeters: Math.max(20, Number(st.radiusMeters) || 80),
        refuelCount: Math.max(1, Number(st.refuelCount) || 1),
        type: 'station'
      });
    }
  }

  const clusters = [];

  const assignCluster = (lat, lng) => {
    let best = null;
    let bestDist = Infinity;
    for (const c of clusters) {
      const dist = calculateDistanceMeters(lat, lng, c.lat, c.lng);
      if (dist <= PLACE_CLUSTER_RADIUS_M && dist < bestDist) {
        bestDist = dist;
        best = c;
      }
    }

    if (best) {
      const nextCount = best.count + 1;
      best.lat = (best.lat * best.count + lat) / nextCount;
      best.lng = (best.lng * best.count + lng) / nextCount;
      best.count = nextCount;
      return best;
    }

    const created = {
      id: clusters.length,
      lat,
      lng,
      count: 1,
      overnightDays: new Set(),
      workDays: new Set()
    };
    clusters.push(created);
    return created;
  };

  if (tripsByDate && typeof tripsByDate === 'object') {
    const sortedDates = Object.keys(tripsByDate).sort();

    for (const dateKey of sortedDates) {
      const rawTrips = tripsByDate[dateKey];
      if (!Array.isArray(rawTrips) || rawTrips.length === 0) continue;

      const parsed = rawTrips
        .map(t => extractTripGeo(t, dateKey))
        .filter(item => item && (item.hasStart || item.hasEnd));

      if (parsed.length === 0) continue;

      parsed.sort((a, b) => {
        if (a.startMin !== null && b.startMin !== null && a.startMin !== b.startMin) {
          return a.startMin - b.startMin;
        }
        return (a.startTimeMs || 0) - (b.startTimeMs || 0);
      });

      const dayRecords = parsed.map(item => ({
        ...item,
        startCluster: item.hasStart ? assignCluster(item.startLat, item.startLng) : null,
        endCluster: item.hasEnd ? assignCluster(item.endLat, item.endLng) : null
      }));

      // First trip of day starting 04:30..10:00 -> overnight home candidate
      const firstTrip = dayRecords[0];
      if (
        firstTrip?.startCluster &&
        firstTrip.startMin !== null &&
        firstTrip.startMin >= 270 &&
        firstTrip.startMin <= 600
      ) {
        firstTrip.startCluster.overnightDays.add(dateKey);
      }

      // Last trip of day ending 18:00..23:59 or 00:00..03:59 -> overnight home candidate
      const lastTrip = dayRecords[dayRecords.length - 1];
      if (
        lastTrip?.endCluster &&
        lastTrip.endMin !== null &&
        (lastTrip.endMin >= 1080 || lastTrip.endMin < 240)
      ) {
        lastTrip.endCluster.overnightDays.add(dateKey);
      }

      // Weekday (Mon-Fri) daytime stay >= 3 hours at same cluster -> work candidate
      const weekday = getWeekdayFromYmd(dateKey);
      const isWeekday = weekday !== null && weekday >= 1 && weekday <= 5;

      if (isWeekday && dayRecords.length >= 2) {
        for (let i = 0; i < dayRecords.length - 1; i++) {
          const arrivalTrip = dayRecords[i];
          const departureTrip = dayRecords[i + 1];
          if (!arrivalTrip.endCluster || !departureTrip.startCluster) continue;

          const sameCluster =
            arrivalTrip.endCluster === departureTrip.startCluster ||
            calculateDistanceMeters(
              arrivalTrip.endCluster.lat,
              arrivalTrip.endCluster.lng,
              departureTrip.startCluster.lat,
              departureTrip.startCluster.lng
            ) <= PLACE_CLUSTER_RADIUS_M;

          if (!sameCluster) continue;

          let stayMin = null;
          if (arrivalTrip.endMin !== null && departureTrip.startMin !== null) {
            stayMin = departureTrip.startMin - arrivalTrip.endMin;
          } else if (arrivalTrip.endTimeMs && departureTrip.startTimeMs) {
            stayMin = (departureTrip.startTimeMs - arrivalTrip.endTimeMs) / 60000;
          }

          const arrMin = arrivalTrip.endMin;
          const depMin = departureTrip.startMin;
          const isDaytime =
            (arrMin === null || (arrMin >= 360 && arrMin <= 1020)) &&
            (depMin === null || (depMin >= 600 && depMin <= 1320));

          if (stayMin !== null && stayMin >= WORK_MIN_STAY_MIN && isDaytime) {
            arrivalTrip.endCluster.workDays.add(dateKey);
          }
        }
      }
    }
  }

  // Pick CASA: highest distinct overnight days >= 4
  let homeCluster = null;
  for (const c of clusters) {
    if (c.overnightDays.size < MIN_SEMANTIC_DAYS) continue;
    if (
      !homeCluster ||
      c.overnightDays.size > homeCluster.overnightDays.size ||
      (c.overnightDays.size === homeCluster.overnightDays.size && c.count > homeCluster.count)
    ) {
      homeCluster = c;
    }
  }

  const home = homeCluster
    ? {
        label: String(safeCustom.home || 'CASA').toUpperCase(),
        lat: Number(homeCluster.lat.toFixed(6)),
        lng: Number(homeCluster.lng.toFixed(6)),
        daysCount: homeCluster.overnightDays.size,
        visits: homeCluster.count
      }
    : null;

  // Pick TRABAJO: > 500 m from CASA, highest distinct weekday stay days >= 4
  let workCluster = null;
  for (const c of clusters) {
    if (c.workDays.size < MIN_SEMANTIC_DAYS) continue;
    if (home) {
      const distFromHome = calculateDistanceMeters(c.lat, c.lng, home.lat, home.lng);
      if (distFromHome <= WORK_MIN_DISTANCE_FROM_HOME_M) continue;
    }
    if (
      !workCluster ||
      c.workDays.size > workCluster.workDays.size ||
      (c.workDays.size === workCluster.workDays.size && c.count > workCluster.count)
    ) {
      workCluster = c;
    }
  }

  const work = workCluster
    ? {
        label: String(safeCustom.work || 'TRABAJO').toUpperCase(),
        lat: Number(workCluster.lat.toFixed(6)),
        lng: Number(workCluster.lng.toFixed(6)),
        daysCount: workCluster.workDays.size,
        visits: workCluster.count
      }
    : null;

  const allPlaces = [
    ...(home ? [{ ...home, type: 'home' }] : []),
    ...(work ? [{ ...work, type: 'work' }] : []),
    ...stations
  ];

  return {
    home,
    work,
    stations,
    allPlaces
  };
}

/**
 * Resolves a coordinate pair to its semantic place label (CASA, TRABAJO, station name)
 * or falls back cleanly to rawAddress / 'Ubicación'.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {string} [rawAddress='']
 * @param {Object|null} [semanticPlaces=null]
 * @returns {string}
 */
export function resolvePlaceLabel(lat, lng, rawAddress = '', semanticPlaces = null) {
  const fallback = (typeof rawAddress === 'string' && rawAddress.trim()) ? rawAddress.trim() : 'Ubicación';
  if (!isValidCoord(lat, lng) || !semanticPlaces || typeof semanticPlaces !== 'object') {
    return fallback;
  }

  const nLat = Number(lat);
  const nLng = Number(lng);

  if (semanticPlaces.home && isValidCoord(semanticPlaces.home.lat, semanticPlaces.home.lng)) {
    const distHome = calculateDistanceMeters(nLat, nLng, semanticPlaces.home.lat, semanticPlaces.home.lng);
    if (distHome <= PLACE_CLUSTER_RADIUS_M) {
      return String(semanticPlaces.home.label || 'CASA').toUpperCase();
    }
  }

  if (semanticPlaces.work && isValidCoord(semanticPlaces.work.lat, semanticPlaces.work.lng)) {
    const distWork = calculateDistanceMeters(nLat, nLng, semanticPlaces.work.lat, semanticPlaces.work.lng);
    if (distWork <= PLACE_CLUSTER_RADIUS_M) {
      return String(semanticPlaces.work.label || 'TRABAJO').toUpperCase();
    }
  }

  if (Array.isArray(semanticPlaces.stations) && semanticPlaces.stations.length > 0) {
    let bestStation = null;
    let bestDist = Infinity;
    for (const st of semanticPlaces.stations) {
      if (!st || !isValidCoord(st.lat, st.lng)) continue;
      const radius = Math.max(20, Number(st.radiusMeters) || 80);
      const dist = calculateDistanceMeters(nLat, nLng, Number(st.lat), Number(st.lng));
      if (dist <= radius && dist < bestDist) {
        bestDist = dist;
        bestStation = st;
      }
    }
    if (bestStation) {
      return String(bestStation.name || bestStation.label || 'ESTACIÓN').toUpperCase();
    }
  }

  return fallback;
}

/**
 * Ranks refueling stations by severity-adjusted fuel efficiency residual across closed tank cycles.
 * Excludes any station with fewer than 2 valid closed cycles to prevent statistical noise.
 *
 * @param {Array<Object>} [closedCycles=[]]
 * @param {Array<Object>} [telemetryLogs=[]]
 * @param {Array<Object>} [learnedStations=[]]
 * @returns {{ rankedStations: Array<Object>, totalQualifiedStations: number }}
 */
export function computeStationHonestyIndex(closedCycles = [], telemetryLogs = [], learnedStations = []) {
  if (!Array.isArray(closedCycles) || closedCycles.length === 0) {
    return { rankedStations: [], totalQualifiedStations: 0 };
  }

  const validCycles = closedCycles.filter(c => c && c.isValid !== false && Number(c.eff) > 0);
  if (validCycles.length === 0) {
    return { rankedStations: [], totalQualifiedStations: 0 };
  }

  const baseMedianEff = computeMedian(validCycles.map(c => Number(c.eff)));
  if (!(baseMedianEff > 0)) {
    return { rankedStations: [], totalQualifiedStations: 0 };
  }

  const stationNameById = new Map();
  if (Array.isArray(learnedStations)) {
    for (const st of learnedStations) {
      if (st?.id && st?.name) {
        stationNameById.set(String(st.id), String(st.name));
      }
    }
  }

  const logs = Array.isArray(telemetryLogs) ? telemetryLogs.filter(Boolean) : [];
  const logById = new Map();
  for (const l of logs) {
    if (l.id !== undefined && l.id !== null) {
      logById.set(String(l.id), l);
    }
  }

  const matchClosingLog = (cycle) => {
    if (cycle.endLogId !== undefined && cycle.endLogId !== null && logById.has(String(cycle.endLogId))) {
      return logById.get(String(cycle.endLogId));
    }

    const endDate = String(cycle.endDate || '').slice(0, 10);
    const endOdo = Number(cycle.endOdo);

    if (endDate && Number.isFinite(endOdo) && endOdo > 0) {
      const exact = logs.find(
        l => String(l.date || '').slice(0, 10) === endDate && Math.abs((Number(l.odometer_reading) || 0) - endOdo) < 1
      );
      if (exact) return exact;
    }

    if (Number.isFinite(endOdo) && endOdo > 0) {
      const byOdoWithStation = logs.find(
        l => Math.abs((Number(l.odometer_reading) || 0) - endOdo) < 1 && l.stationId
      );
      if (byOdoWithStation) return byOdoWithStation;
    }

    if (endDate) {
      const byDateWithStation = logs.find(
        l => String(l.date || '').slice(0, 10) === endDate && l.stationId
      );
      if (byDateWithStation) return byDateWithStation;
    }

    return null;
  };

  const groups = new Map();

  for (const c of validCycles) {
    const closingLog = matchClosingLog(c);
    const stationId = String(c.stationId || closingLog?.stationId || '').trim();
    if (!stationId) continue;

    const stationName =
      String(c.stationName || closingLog?.stationName || stationNameById.get(stationId) || 'ESTACIÓN').trim() ||
      'ESTACIÓN';

    const severityRaw = Number(c.physicalTelemetry?.severityFactor);
    const severity = Number.isFinite(severityRaw) && severityRaw > 0 ? severityRaw : 1.0;
    const cycleBaseEff = Number(c.adaptiveEff) > 0 ? Number(c.adaptiveEff) : baseMedianEff;
    const expectedEff = cycleBaseEff / severity;
    if (!(expectedEff > 0)) continue;

    const actualEff = Number(c.eff);
    const residualPct = ((actualEff - expectedEff) / expectedEff) * 100;
    if (!Number.isFinite(residualPct)) continue;

    if (!groups.has(stationId)) {
      groups.set(stationId, {
        stationId,
        stationName,
        cyclesCount: 0,
        sumEff: 0,
        sumExpectedEff: 0,
        sumResidualPct: 0
      });
    }

    const g = groups.get(stationId);
    g.cyclesCount += 1;
    g.sumEff += actualEff;
    g.sumExpectedEff += expectedEff;
    g.sumResidualPct += residualPct;
    if (g.stationName === 'ESTACIÓN' && stationName !== 'ESTACIÓN') {
      g.stationName = stationName;
    }
  }

  const rankedStations = [];
  for (const g of groups.values()) {
    if (g.cyclesCount < STATION_MIN_CYCLES) continue;
    const avgEff = Number((g.sumEff / g.cyclesCount).toFixed(2));
    const expectedAvgEff = Number((g.sumExpectedEff / g.cyclesCount).toFixed(2));
    const residualPct = Number((g.sumResidualPct / g.cyclesCount).toFixed(1));

    let tone = 'neutral';
    if (residualPct >= 1.5) tone = 'volt';
    else if (residualPct <= -3.0) tone = 'crimson';
    else if (residualPct <= -1.5) tone = 'amber';

    rankedStations.push({
      stationId: g.stationId,
      stationName: g.stationName,
      cyclesCount: g.cyclesCount,
      avgEff,
      expectedAvgEff,
      residualPct,
      tone
    });
  }

  rankedStations.sort((a, b) => {
    if (b.residualPct !== a.residualPct) return b.residualPct - a.residualPct;
    return b.cyclesCount - a.cyclesCount;
  });

  return {
    rankedStations,
    totalQualifiedStations: rankedStations.length
  };
}

/**
 * Analyzes directed recurring corridors (>= 6 trips within 400 m origin & destination)
 * across 15-minute departure buckets to recommend the fastest / lowest-cost departure window.
 *
 * Returns an Array of corridors sorted by sampleCount desc, augmented with `.primary = corridors[0] || null`.
 *
 * @param {Array<Object>|Object} [tripsSource=[]]
 * @param {Object} [options={}] - { semanticPlaces }
 * @returns {Array<Object>}
 */
export function analyzeOptimalDeparture(tripsSource = [], options = {}) {
  const flatTrips = [];

  if (Array.isArray(tripsSource)) {
    for (const t of tripsSource) {
      const geo = extractTripGeo(t);
      if (geo) flatTrips.push(geo);
    }
  } else if (tripsSource && typeof tripsSource === 'object') {
    for (const dateKey of Object.keys(tripsSource)) {
      const arr = tripsSource[dateKey];
      if (!Array.isArray(arr)) continue;
      for (const t of arr) {
        const geo = extractTripGeo(t, dateKey);
        if (geo) flatTrips.push(geo);
      }
    }
  }

  const corridors = [];

  for (const item of flatTrips) {
    if (!item.hasStart || !item.hasEnd || item.startMin === null || !(item.durationMin > 0)) {
      continue;
    }

    // Ignore parking maneuvers / same-spot micro-moves (< 3 km or < 500 m origin-to-destination displacement)
    const displacementM = calculateDistanceMeters(item.startLat, item.startLng, item.endLat, item.endLng);
    const effectiveDistKm = item.distanceKm > 0 ? item.distanceKm : (displacementM / 1000);
    if (displacementM < CORRIDOR_MIN_DISPLACEMENT_M || effectiveDistKm < CORRIDOR_MIN_DISTANCE_KM) {
      continue;
    }

    let matched = null;
    let bestScore = Infinity;

    for (const c of corridors) {
      const dStart = calculateDistanceMeters(item.startLat, item.startLng, c.startLat, c.startLng);
      if (dStart > CORRIDOR_RADIUS_M) continue;
      const dEnd = calculateDistanceMeters(item.endLat, item.endLng, c.endLat, c.endLng);
      if (dEnd > CORRIDOR_RADIUS_M) continue;

      const score = dStart + dEnd;
      if (score < bestScore) {
        bestScore = score;
        matched = c;
      }
    }

    if (matched) {
      const n = matched.trips.length;
      matched.startLat = (matched.startLat * n + item.startLat) / (n + 1);
      matched.startLng = (matched.startLng * n + item.startLng) / (n + 1);
      matched.endLat = (matched.endLat * n + item.endLat) / (n + 1);
      matched.endLng = (matched.endLng * n + item.endLng) / (n + 1);
      matched.trips.push(item);
      if (!matched.fallbackStartAddress && item.startAddress) matched.fallbackStartAddress = item.startAddress;
      if (!matched.fallbackEndAddress && item.endAddress) matched.fallbackEndAddress = item.endAddress;
    } else {
      corridors.push({
        startLat: item.startLat,
        startLng: item.startLng,
        endLat: item.endLat,
        endLng: item.endLng,
        fallbackStartAddress: item.startAddress || 'Origen',
        fallbackEndAddress: item.endAddress || 'Destino',
        trips: [item]
      });
    }
  }

  const semanticPlaces = options?.semanticPlaces || null;
  const results = [];

  for (const c of corridors) {
    if (c.trips.length < CORRIDOR_MIN_TRIPS) continue;

    const bucketMap = new Map();
    const allDurations = [];
    const allCosts = [];
    const allDepMins = [];

    for (const t of c.trips) {
      allDurations.push(t.durationMin);
      allCosts.push(t.costCop);
      allDepMins.push(t.startMin);

      const bucketMin = Math.floor(t.startMin / 15) * 15;
      if (!bucketMap.has(bucketMin)) {
        bucketMap.set(bucketMin, { bucketMin, durations: [], costs: [] });
      }
      const b = bucketMap.get(bucketMin);
      b.durations.push(t.durationMin);
      b.costs.push(t.costCop);
    }

    const buckets = Array.from(bucketMap.values()).map(b => ({
      bucketMin: b.bucketMin,
      count: b.durations.length,
      medianDurationMin: computeMedian(b.durations),
      medianCostCop: computeMedian(b.costs)
    }));

    const qualifiedBuckets = buckets.filter(b => b.count >= 2);
    const candidates = qualifiedBuckets.length > 0 ? qualifiedBuckets : buckets;

    candidates.sort((a, b) => {
      if (a.medianDurationMin !== b.medianDurationMin) return a.medianDurationMin - b.medianDurationMin;
      if (a.medianCostCop !== b.medianCostCop) return a.medianCostCop - b.medianCostCop;
      return b.count - a.count;
    });

    const bestBucket = candidates[0];
    if (!bestBucket) continue;

    const typicalDurationMin = Math.round(computeMedian(allDurations));
    const typicalCostCop = computeMedian(allCosts);
    const typicalBucketMin = Math.floor(computeMedian(allDepMins) / 15) * 15;

    const bestDurationMin = Math.round(bestBucket.medianDurationMin);
    const savedMin = Math.max(0, Math.round(typicalDurationMin - bestDurationMin));
    const savedCopPerTrip = Math.max(0, Math.round(typicalCostCop - bestBucket.medianCostCop));

    const startLabel = semanticPlaces
      ? resolvePlaceLabel(c.startLat, c.startLng, c.fallbackStartAddress, semanticPlaces)
      : (c.fallbackStartAddress || 'Origen');
    const endLabel = semanticPlaces
      ? resolvePlaceLabel(c.endLat, c.endLng, c.fallbackEndAddress, semanticPlaces)
      : (c.fallbackEndAddress || 'Destino');

    // Never emit round-trip / same-place parking loops (e.g., "CASA → CASA")
    if (String(startLabel).trim().toUpperCase() === String(endLabel).trim().toUpperCase()) {
      continue;
    }

    results.push({
      corridorLabel: `${startLabel} → ${endLabel}`,
      bestWindowHm: minutesToHm(bestBucket.bucketMin),
      typicalWindowHm: minutesToHm(typicalBucketMin),
      bestDurationMin,
      typicalDurationMin,
      savedMin,
      savedCopPerTrip,
      sampleCount: c.trips.length
    });
  }

  results.sort((a, b) => {
    if (b.sampleCount !== a.sampleCount) return b.sampleCount - a.sampleCount;
    return b.savedMin - a.savedMin;
  });

  results.primary = results[0] || null;
  return results;
}

function formatParkedDuration(minutes) {
  const safeMin = Math.max(0, Math.round(Number(minutes) || 0));
  if (safeMin < 60) return `${safeMin}M`;
  if (safeMin < 1440) {
    const h = Math.floor(safeMin / 60);
    const m = safeMin % 60;
    return m > 0 ? `${h}H ${m}M` : `${h}H`;
  }
  const d = Math.floor(safeMin / 1440);
  const h = Math.floor((safeMin % 1440) / 60);
  return h > 0 ? `${d}D ${h}H` : `${d}D`;
}

/**
 * Computes real-time Parking Sentinel telemetry: parked state, semantic location,
 * continuous parked duration, resting voltage, and resting voltage drift since parked.
 *
 * @param {Object|null} [live=null]
 * @param {Array<Object>} [voltageHistory=[]]
 * @param {Object|null} [semanticPlaces=null]
 * @param {number} [nowMs=Date.now()]
 * @returns {Object}
 */
export function computeParkingSentinel(live = null, voltageHistory = [], semanticPlaces = null, nowMs = Date.now()) {
  if (!live || typeof live !== 'object') {
    return { isParked: false, hasData: false };
  }

  const safeNow = Number.isFinite(Number(nowMs)) && Number(nowMs) > 0 ? Number(nowMs) : Date.now();
  const isParked = !Boolean(live.accStatus);
  const lat = Number(live.lat ?? live.latitude) || 0;
  const lng = Number(live.lng ?? live.longitude ?? live.lon) || 0;
  const placeLabel = resolvePlaceLabel(lat, lng, live.address || '', semanticPlaces);

  const rawLiveV = Number(live.externalVoltage);
  const currentVoltage = Number.isFinite(rawLiveV) && rawLiveV > 0 ? Number(rawLiveV.toFixed(2)) : 0;

  let parkedMinutes = 0;
  let parkedDurationLabel = '';
  let voltageDeltaV = 0;

  if (isParked) {
    const cleanHistory = [];
    if (Array.isArray(voltageHistory)) {
      for (const s of voltageHistory) {
        if (!s || typeof s !== 'object') continue;
        const ts = normalizeTimestampMs(s.ts ?? s.t ?? s.timestamp ?? s.time);
        const v = Number(s.v);
        if (!ts || !Number.isFinite(v) || v <= 0) continue;
        cleanHistory.push({ ts, v: Number(v.toFixed(2)), acc: Boolean(s.acc) });
      }
    }
    cleanHistory.sort((a, b) => a.ts - b.ts);

    let earliestContiguousOff = null;
    let latestContiguousOff = null;
    for (let i = cleanHistory.length - 1; i >= 0; i--) {
      if (cleanHistory[i].acc === false) {
        if (!latestContiguousOff) latestContiguousOff = cleanHistory[i];
        earliestContiguousOff = cleanHistory[i];
      } else {
        break;
      }
    }

    let parkedSinceMs = null;
    if (earliestContiguousOff && earliestContiguousOff.ts <= safeNow) {
      parkedSinceMs = earliestContiguousOff.ts;
    } else {
      const gpsMs = normalizeTimestampMs(live.gpsTime);
      const syncedMs = live.syncedAt ? Date.parse(live.syncedAt) : NaN;
      if (gpsMs && gpsMs <= safeNow) {
        parkedSinceMs = gpsMs;
      } else if (Number.isFinite(syncedMs) && syncedMs > 0 && syncedMs <= safeNow) {
        parkedSinceMs = syncedMs;
      } else {
        parkedSinceMs = safeNow;
      }
    }

    parkedMinutes = Math.max(0, Math.round((safeNow - parkedSinceMs) / 60000));
    parkedDurationLabel = formatParkedDuration(parkedMinutes);

    const firstRestingV = earliestContiguousOff?.v || 0;
    const latestRestingV = currentVoltage > 0 ? currentVoltage : (latestContiguousOff?.v || 0);
    if (firstRestingV > 0 && latestRestingV > 0) {
      voltageDeltaV = Number((latestRestingV - firstRestingV).toFixed(2));
    }
  }

  return {
    hasData: true,
    isParked,
    placeLabel,
    parkedMinutes,
    parkedDurationLabel,
    currentVoltage,
    voltageDeltaV,
    lat,
    lng,
    liveSpeed: Number(live.speed) || 0
  };
}
