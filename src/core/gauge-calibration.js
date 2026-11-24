/**
 * OCTANE // KINETIC — Empirical Self-Learning Fuel Gauge Calibration Engine
 *
 * 100% pure mathematical core (zero DOM, zero IndexedDB, zero network).
 * Learns the vehicle's true non-linear sender curve mapping indicated needle %
 * to physical fuel % and gallons using:
 *   1. Direct pump refuel anchors (weight = 3.0) via `pre_refuel_gauge_pct` or
 *      adjacent pre-refuel gauge readings (<= 5 km and <= 18 hours / <= 1 day).
 *   2. Retroactive conservation-of-fuel anchors (weight = 1.5) from intermediate
 *      gauge readings inside valid closed full-tank cycles.
 *   3. Bucket clustering (<= 1.5%), Bayesian shrinkage toward linear identity,
 *      and Weighted Pool Adjacent Violators Algorithm (PAVA) to guarantee a
 *      strictly non-decreasing monotonic transfer curve anchored at (0,0) and (100,100).
 */

import { parseFuelVolume, parseIntegerMetric } from './number-utils.js';

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MAX_ANCHOR_ODO_DELTA_KM = 5;
const MAX_ANCHOR_TIME_DELTA_MS = 18 * HOUR_MS;
const BUCKET_WIDTH_PCT = 1.5;
const SHRINKAGE_PRIOR_WEIGHT = 0.35;
const DIRECT_ANCHOR_WEIGHT = 3.0;
const RETROACTIVE_ANCHOR_WEIGHT = 1.5;

function clamp(val, min, max) {
  if (!Number.isFinite(val)) return min;
  return Math.min(max, Math.max(min, val));
}

/**
 * Legacy smooth monotonic transfer function mapping indicated gauge % to physical fluid %.
 * Used as the prior fallback when no empirical calibration samples exist.
 *
 * @param {number} pct - Indicated needle percentage (0 - 100)
 * @returns {number} Calibrated physical fuel percentage (0 - 100)
 */
export function defaultCalibratedGaugePct(pct) {
  if (pct === null || pct === undefined || pct === '' || Number.isNaN(Number(pct))) return 0;
  const p = Math.min(100, Math.max(0, Number(pct)));
  if (p <= 0) return 0;
  if (p >= 100) return 100;
  const x = p / 100;
  return Number(
    Math.min(100, Math.max(0, (0.7 * Math.pow(x, 1.18) + 0.3 * (3 * x * x - 2 * x * x * x)) * 100)).toFixed(1)
  );
}

function extractDateYmd(raw) {
  const candidates = [raw?.date, raw?.id, raw?.createdAt, raw?.updatedAt];
  for (const c of candidates) {
    if (typeof c === 'string' && /^\d{4}-\d{2}-\d{2}/.test(c.trim())) {
      return c.trim().slice(0, 10);
    }
  }
  return '';
}

function extractTimestampMs(raw, dateYmd) {
  if (raw && raw.timestampMs !== undefined && raw.timestampMs !== null && raw.timestampMs !== '') {
    const ms = Number(raw.timestampMs);
    if (Number.isFinite(ms) && ms > 0) return ms;
  }
  if (raw && raw.timestamp !== undefined && raw.timestamp !== null && raw.timestamp !== '') {
    if (typeof raw.timestamp === 'number' && Number.isFinite(raw.timestamp) && raw.timestamp > 0) {
      return raw.timestamp < 1e12 ? raw.timestamp * 1000 : raw.timestamp;
    }
    if (typeof raw.timestamp === 'string') {
      const parsed = Date.parse(raw.timestamp);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  if (raw && typeof raw.time === 'string' && /^\d{2}:\d{2}/.test(raw.time.trim()) && dateYmd) {
    const t = raw.time.trim().length === 5 ? `${raw.time.trim()}:00` : raw.time.trim().slice(0, 8);
    const parsed = Date.parse(`${dateYmd}T${t}-05:00`);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  if (raw && typeof raw.createdAt === 'string' && raw.createdAt.trim()) {
    const parsed = Date.parse(raw.createdAt.trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      if (!dateYmd) return parsed;
      const colYmd = new Date(parsed - 5 * HOUR_MS).toISOString().slice(0, 10);
      if (colYmd === dateYmd) return parsed;
    }
  }
  return null;
}

function calendarDayDiff(dateA, dateB) {
  if (!dateA || !dateB) return Infinity;
  const msA = Date.parse(`${dateA}T12:00:00Z`);
  const msB = Date.parse(`${dateB}T12:00:00Z`);
  if (!Number.isFinite(msA) || !Number.isFinite(msB)) return Infinity;
  return Math.round((msB - msA) / DAY_MS);
}

function normalizeLog(raw, idx, tankMaxGal) {
  const date = extractDateYmd(raw);
  const odo = parseIntegerMetric(raw?.odometer_reading);
  const gallonsAdded = parseFuelVolume(raw?.gallons_added, tankMaxGal);
  const hasFuelPct = raw?.fuel_level_percent !== undefined && raw?.fuel_level_percent !== null && raw?.fuel_level_percent !== '';
  const fuelPct = hasFuelPct && Number.isFinite(Number(raw.fuel_level_percent))
    ? clamp(Number(raw.fuel_level_percent), 0, 100)
    : null;
  const hasPrePct = raw?.pre_refuel_gauge_pct !== undefined && raw?.pre_refuel_gauge_pct !== null && raw?.pre_refuel_gauge_pct !== '';
  const preRefuelPct = hasPrePct && Number.isFinite(Number(raw.pre_refuel_gauge_pct))
    ? Number(raw.pre_refuel_gauge_pct)
    : null;
  const isFull = raw?.is_full_tank === true || raw?.isFullTank === true;
  const tsMs = extractTimestampMs(raw, date);

  return {
    origIdx: idx,
    id: raw?.id || date || `log_${idx}`,
    date,
    tsMs,
    odo,
    gallonsAdded,
    fuelPct,
    preRefuelPct,
    isFull
  };
}

function sortLogsAscending(normalized) {
  return [...normalized].sort((a, b) => {
    if (a.date !== b.date) {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return a.date > b.date ? 1 : -1;
    }
    if (a.odo !== b.odo) return a.odo - b.odo;
    if (a.tsMs !== null && b.tsMs !== null && a.tsMs !== b.tsMs) {
      return a.tsMs - b.tsMs;
    }
    // At identical date & odometer without timestamps, place non-refuel reading before refuel
    const refA = a.gallonsAdded > 0 || a.isFull ? 1 : 0;
    const refB = b.gallonsAdded > 0 || b.isFull ? 1 : 0;
    if (refA !== refB) return refA - refB;
    return a.origIdx - b.origIdx;
  });
}

function isWithinPreRefuelWindow(reading, refuel) {
  const odoDelta = refuel.odo - reading.odo;
  if (odoDelta < 0 || odoDelta > MAX_ANCHOR_ODO_DELTA_KM) return false;

  if (reading.tsMs !== null && refuel.tsMs !== null) {
    const dt = refuel.tsMs - reading.tsMs;
    return dt >= 0 && dt <= MAX_ANCHOR_TIME_DELTA_MS;
  }

  const dayDelta = calendarDayDiff(reading.date, refuel.date);
  return dayDelta >= 0 && dayDelta <= 1;
}

function getTripGallons(trip) {
  if (!trip || typeof trip !== 'object') return 0;
  if (trip.reconciledGallons !== undefined && trip.reconciledGallons !== null && Number.isFinite(Number(trip.reconciledGallons))) {
    return Math.max(0, Number(trip.reconciledGallons));
  }
  if (trip.estGallons !== undefined && trip.estGallons !== null && Number.isFinite(Number(trip.estGallons))) {
    return Math.max(0, Number(trip.estGallons));
  }
  return 0;
}

function getTripTimestampMs(trip) {
  const start = Number(trip?.startTimeMs);
  if (Number.isFinite(start) && start > 0) return start;
  const end = Number(trip?.endTimeMs);
  if (Number.isFinite(end) && end > 0) return end;
  const unix = Number(trip?.startTimeUnix);
  if (Number.isFinite(unix) && unix > 0) return unix * 1000;
  return null;
}

function collectCycleTrips(tripsByDate, startLog, endLog) {
  if (!tripsByDate || typeof tripsByDate !== 'object' || !startLog.date || !endLog.date) {
    return [];
  }

  const trips = [];
  const hasStartTs = startLog.tsMs !== null;
  const hasEndTs = endLog.tsMs !== null;

  for (const dateKey of Object.keys(tripsByDate)) {
    if (dateKey < startLog.date || dateKey > endLog.date) continue;
    const dayTrips = tripsByDate[dateKey];
    if (!Array.isArray(dayTrips)) continue;

    for (const trip of dayTrips) {
      if (!trip || typeof trip !== 'object') continue;
      const tMs = getTripTimestampMs(trip);

      let inCycle = false;
      if (hasStartTs && hasEndTs && tMs !== null) {
        inCycle = tMs > startLog.tsMs && tMs <= endLog.tsMs;
      } else if (hasEndTs && dateKey === endLog.date && tMs !== null) {
        inCycle = tMs <= endLog.tsMs && (startLog.date === endLog.date ? (!hasStartTs || tMs > startLog.tsMs) : true);
      } else if (hasStartTs && dateKey === startLog.date && tMs !== null) {
        inCycle = tMs > startLog.tsMs;
      } else if (startLog.date === endLog.date) {
        inCycle = dateKey === endLog.date;
      } else {
        inCycle = dateKey > startLog.date && dateKey <= endLog.date;
      }

      if (inCycle) {
        trips.push({
          dateKey,
          tsMs: tMs,
          gallons: getTripGallons(trip)
        });
      }
    }
  }

  return trips;
}

function computeBurnedAfterReading({ reading, startLog, endLog, cycleConsumedGal, cycleTrips }) {
  const odoFrac = (endLog.odo - reading.odo) / (endLog.odo - startLog.odo);
  const odoFallback = cycleConsumedGal * odoFrac;

  if (!Array.isArray(cycleTrips) || cycleTrips.length === 0) {
    return odoFallback;
  }

  const totalTripGal = cycleTrips.reduce((sum, t) => sum + t.gallons, 0);
  if (totalTripGal <= 0) {
    return odoFallback;
  }

  let afterTripGal = null;

  if (reading.tsMs !== null && cycleTrips.every(t => t.tsMs !== null)) {
    afterTripGal = cycleTrips
      .filter(t => t.tsMs > reading.tsMs)
      .reduce((sum, t) => sum + t.gallons, 0);
  } else if (reading.date) {
    const hasTripsOnReadingDate = cycleTrips.some(t => t.dateKey === reading.date);
    if (!hasTripsOnReadingDate) {
      afterTripGal = cycleTrips
        .filter(t => t.dateKey > reading.date)
        .reduce((sum, t) => sum + t.gallons, 0);
    }
  }

  if (afterTripGal === null) {
    return odoFallback;
  }

  // Guard against incomplete trip coverage in the sub-window when odometer clearly moved
  if (endLog.odo - reading.odo > 2 && afterTripGal <= 0) {
    return odoFallback;
  }
  if (reading.odo - startLog.odo > 2 && afterTripGal >= totalTripGal) {
    return odoFallback;
  }

  return cycleConsumedGal * (afterTripGal / totalTripGal);
}

function buildMonotonicKnots(samples, tankMaxGal) {
  if (!samples || samples.length === 0) {
    return [];
  }

  const sortedSamples = [...samples]
    .filter(s => s.needlePct > 0 && s.needlePct < 100 && Number.isFinite(s.realPct))
    .sort((a, b) => a.needlePct - b.needlePct);

  if (sortedSamples.length === 0) {
    return [];
  }

  // 1. Merge samples within <= 1.5% needle bucket via weighted average
  const buckets = [];
  for (const s of sortedSamples) {
    const current = buckets[buckets.length - 1];
    if (current && (s.needlePct - current.startNeedle) <= BUCKET_WIDTH_PCT) {
      current.sumW += s.weight;
      current.sumWNeedle += s.weight * s.needlePct;
      current.sumWReal += s.weight * s.realPct;
    } else {
      buckets.push({
        startNeedle: s.needlePct,
        sumW: s.weight,
        sumWNeedle: s.weight * s.needlePct,
        sumWReal: s.weight * s.realPct
      });
    }
  }

  // 2. Apply slight Bayesian shrinkage per bucket toward linear identity `needlePct`
  //    using w / (w + 0.35)
  const shrunkInterior = buckets.map(b => {
    const needlePct = b.sumWNeedle / b.sumW;
    const rawRealPct = b.sumWReal / b.sumW;
    const alpha = b.sumW / (b.sumW + SHRINKAGE_PRIOR_WEIGHT);
    const realPct = clamp(alpha * rawRealPct + (1 - alpha) * needlePct, 0, 100);
    return {
      needlePct,
      realPct,
      weight: b.sumW
    };
  });

  // 3. Apply Weighted Pool Adjacent Violators Algorithm (PAVA) on interior knots
  //    so 0 <= y_0 <= y_1 <= ... <= y_k <= 100 (strictly non-decreasing)
  const blocks = [];
  for (const knot of shrunkInterior) {
    blocks.push({
      sumWY: knot.weight * knot.realPct,
      sumW: knot.weight,
      items: [knot]
    });

    while (blocks.length >= 2) {
      const last = blocks[blocks.length - 1];
      const prev = blocks[blocks.length - 2];
      const prevMean = prev.sumWY / prev.sumW;
      const lastMean = last.sumWY / last.sumW;
      if (prevMean > lastMean) {
        prev.sumWY += last.sumWY;
        prev.sumW += last.sumW;
        prev.items.push(...last.items);
        blocks.pop();
      } else {
        break;
      }
    }
  }

  const interiorKnots = [];
  for (const block of blocks) {
    const pooledY = clamp(block.sumWY / block.sumW, 0, 100);
    for (const item of block.items) {
      const realPctRounded = Number(pooledY.toFixed(2));
      interiorKnots.push({
        needlePct: Number(item.needlePct.toFixed(2)),
        realPct: realPctRounded,
        realGal: Number(((realPctRounded / 100) * tankMaxGal).toFixed(3)),
        weight: Number(item.weight.toFixed(2))
      });
    }
  }

  // 4. Anchor (0, 0) and (100, 100)
  return [
    { needlePct: 0, realPct: 0, realGal: 0, weight: 0 },
    ...interiorKnots,
    { needlePct: 100, realPct: 100, realGal: Number(tankMaxGal.toFixed(3)), weight: 0 }
  ];
}

/**
 * Evaluates a fuel needle reading (0 - 100) using a trained or JSON-deserialized
 * gauge calibration model. Falls back to `defaultCalibratedGaugePct` when no empirical
 * curve is available.
 *
 * @param {number} pct - Indicated needle percentage (0 - 100)
 * @param {Object|null} [gaugeModel=null] - Calibration model or plain `{ mode, knots }`
 * @returns {number} Calibrated physical fuel percentage (0 - 100), rounded to 1 decimal
 */
export function evaluateGaugeCalibration(pct, gaugeModel = null) {
  if (pct === null || pct === undefined || pct === '' || Number.isNaN(Number(pct))) return 0;
  const p = clamp(Number(pct), 0, 100);
  if (p <= 0) return 0;
  if (p >= 100) return 100;

  if (
    gaugeModel &&
    gaugeModel.mode === 'empirical' &&
    Array.isArray(gaugeModel.knots) &&
    gaugeModel.knots.length >= 3
  ) {
    const knots = [...gaugeModel.knots]
      .filter(k => k && Number.isFinite(Number(k.needlePct)) && Number.isFinite(Number(k.realPct)))
      .sort((a, b) => Number(a.needlePct) - Number(b.needlePct));

    if (knots.length >= 3) {
      if (p <= Number(knots[0].needlePct)) {
        return Number(clamp(Number(knots[0].realPct), 0, 100).toFixed(1));
      }
      const last = knots[knots.length - 1];
      if (p >= Number(last.needlePct)) {
        return Number(clamp(Number(last.realPct), 0, 100).toFixed(1));
      }

      for (let i = 0; i < knots.length - 1; i++) {
        const k0 = knots[i];
        const k1 = knots[i + 1];
        const x0 = Number(k0.needlePct);
        const x1 = Number(k1.needlePct);
        if (p >= x0 && p <= x1) {
          const y0 = Number(k0.realPct);
          const y1 = Number(k1.realPct);
          if (x1 <= x0) {
            return Number(clamp(y1, 0, 100).toFixed(1));
          }
          const t = (p - x0) / (x1 - x0);
          const y = y0 + t * (y1 - y0);
          return Number(clamp(y, 0, 100).toFixed(1));
        }
      }
    }
  }

  return defaultCalibratedGaugePct(p);
}

/**
 * Builds an empirical self-learning non-linear fuel gauge calibration model
 * from historical refuels, intermediate gauge readings, and optional GPS trips.
 *
 * @param {Array<Object>} [logs=[]]
 * @param {Object} [options={}] - `{ tankMaxGal = 9.25, tripsByDate = null, closedCycles = null, adaptiveEff = 33.71 }`
 * @returns {Object} JSON-serializable calibration model with `mapPct` & `mapGallons` helpers
 */
export function buildGaugeCalibrationModel(logs = [], options = {}) {
  const tankMaxGal = Number(options?.tankMaxGal) > 0 ? Number(options.tankMaxGal) : 9.25;
  const tripsByDate = options?.tripsByDate && typeof options.tripsByDate === 'object' ? options.tripsByDate : null;
  const externalClosedCycles = Array.isArray(options?.closedCycles) ? options.closedCycles : null;
  // Accepted as part of signature contract
  const _adaptiveEff = Number(options?.adaptiveEff) > 0 ? Number(options.adaptiveEff) : 33.71;
  void _adaptiveEff;

  if (!Array.isArray(logs) || logs.length === 0) {
    const emptyModel = {
      mode: 'prior',
      sampleCount: 0,
      directCount: 0,
      retroactiveCount: 0,
      confidence: 0,
      tankMaxGal: Number(tankMaxGal.toFixed(3)),
      knots: [],
      samples: []
    };
    return {
      ...emptyModel,
      mapPct: (pct) => evaluateGaugeCalibration(pct, emptyModel),
      mapGallons: (pct) => Number(((evaluateGaugeCalibration(pct, emptyModel) / 100) * emptyModel.tankMaxGal).toFixed(3))
    };
  }

  const normalized = logs
    .filter(r => r && typeof r === 'object')
    .map((r, idx) => normalizeLog(r, idx, tankMaxGal));
  const sorted = sortLogsAscending(normalized);

  const samples = [];
  const consumedReadingIndices = new Set();
  let directCount = 0;
  let retroactiveCount = 0;

  // 1. Direct Pump Anchors (weight = 3.0, source = 'direct_refuel')
  for (let i = 0; i < sorted.length; i++) {
    const log = sorted[i];
    if (!log.isFull || !(log.gallonsAdded > 0)) continue;

    let needlePct = null;

    // (a) Explicit pre_refuel_gauge_pct strictly between 0 and 100
    if (log.preRefuelPct !== null && log.preRefuelPct > 0 && log.preRefuelPct < 100) {
      needlePct = log.preRefuelPct;
    } else {
      // (b) Prior non-refuel reading within <= 5 km and <= 18 hours (or same/previous day)
      for (let j = i - 1; j >= 0; j--) {
        const prev = sorted[j];
        // Stop scanning if an intervening refuel occurred
        if (prev.gallonsAdded > 0 || prev.isFull) break;
        if (log.odo - prev.odo > MAX_ANCHOR_ODO_DELTA_KM) break;
        if (consumedReadingIndices.has(j)) continue;
        if (prev.fuelPct !== null && prev.fuelPct > 0 && prev.fuelPct < 100 && isWithinPreRefuelWindow(prev, log)) {
          needlePct = prev.fuelPct;
          consumedReadingIndices.add(j);
          break;
        }
      }
    }

    if (needlePct === null) continue;

    const realGal = clamp(tankMaxGal - log.gallonsAdded, 0, tankMaxGal);
    const realPct = (realGal / tankMaxGal) * 100;

    samples.push({
      source: 'direct_refuel',
      weight: DIRECT_ANCHOR_WEIGHT,
      needlePct: Number(needlePct.toFixed(2)),
      realPct: Number(realPct.toFixed(2)),
      realGal: Number(realGal.toFixed(3)),
      date: log.date,
      odo: log.odo
    });
    directCount++;
  }

  // 2. Retroactive Intermediate Readings (weight = 1.5, source = 'retroactive_reading')
  const fullIndices = [];
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].isFull) fullIndices.push(i);
  }

  for (let f = 0; f < fullIndices.length - 1; f++) {
    const sIdx = fullIndices[f];
    const eIdx = fullIndices[f + 1];
    const s = sorted[sIdx];
    const e = sorted[eIdx];

    if (!(e.gallonsAdded > 0)) continue;
    const dist = e.odo - s.odo;
    if (!(dist > 0)) continue;

    // Sum any partial refuels strictly between s and e
    let partialBetweenGal = 0;
    for (let k = sIdx + 1; k < eIdx; k++) {
      if (!sorted[k].isFull && sorted[k].gallonsAdded > 0) {
        partialBetweenGal += sorted[k].gallonsAdded;
      }
    }

    const cycleConsumedGal = partialBetweenGal + e.gallonsAdded;
    if (!(cycleConsumedGal > 0)) continue;

    const eff = dist / cycleConsumedGal;
    if (eff < 8 || eff > 130) continue;

    // Respect explicit external closedCycles invalidation if matching cycle is marked invalid
    if (externalClosedCycles) {
      const matched = externalClosedCycles.find(
        c => c && c.startOdo === s.odo && c.endOdo === e.odo && c.startDate === s.date && c.endDate === e.date
      );
      if (matched && matched.isValid === false) continue;
    }

    const cycleTrips = tripsByDate ? collectCycleTrips(tripsByDate, s, e) : [];

    for (let rIdx = sIdx + 1; rIdx < eIdx; rIdx++) {
      if (consumedReadingIndices.has(rIdx)) continue;
      const r = sorted[rIdx];
      if (r.isFull || r.gallonsAdded > 0) continue;
      if (r.fuelPct === null || r.fuelPct <= 0 || r.fuelPct >= 100) continue;
      if (r.odo < s.odo || r.odo > e.odo) continue;

      const burnedAfterGal = computeBurnedAfterReading({
        reading: r,
        startLog: s,
        endLog: e,
        cycleConsumedGal,
        cycleTrips
      });

      let partialAfterGal = 0;
      for (let k = rIdx + 1; k < eIdx; k++) {
        if (!sorted[k].isFull && sorted[k].gallonsAdded > 0) {
          partialAfterGal += sorted[k].gallonsAdded;
        }
      }

      const rawRealGalAtReading = (tankMaxGal - e.gallonsAdded) + burnedAfterGal - partialAfterGal;
      if (!Number.isFinite(rawRealGalAtReading) || rawRealGalAtReading < 0 || rawRealGalAtReading > tankMaxGal * 1.03) {
        continue;
      }

      const realGal = clamp(rawRealGalAtReading, 0, tankMaxGal);
      const realPct = (realGal / tankMaxGal) * 100;

      samples.push({
        source: 'retroactive_reading',
        weight: RETROACTIVE_ANCHOR_WEIGHT,
        needlePct: Number(r.fuelPct.toFixed(2)),
        realPct: Number(realPct.toFixed(2)),
        realGal: Number(realGal.toFixed(3)),
        date: r.date,
        odo: r.odo
      });
      retroactiveCount++;
    }
  }

  const knots = buildMonotonicKnots(samples, tankMaxGal);
  const mode = samples.length > 0 && knots.length >= 3 ? 'empirical' : 'prior';
  const totalWeight = samples.reduce((acc, s) => acc + s.weight, 0);
  const confidence = samples.length > 0 ? Number(Math.min(1, totalWeight / 9).toFixed(2)) : 0;

  const modelData = {
    mode,
    sampleCount: samples.length,
    directCount,
    retroactiveCount,
    confidence,
    tankMaxGal: Number(tankMaxGal.toFixed(3)),
    knots,
    samples
  };

  return {
    ...modelData,
    mapPct: (pct) => evaluateGaugeCalibration(pct, modelData),
    mapGallons: (pct) => {
      const mappedPct = evaluateGaugeCalibration(pct, modelData);
      return Number(clamp((mappedPct / 100) * modelData.tankMaxGal, 0, modelData.tankMaxGal).toFixed(3));
    }
  };
}
