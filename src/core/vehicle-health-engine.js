/**
 * OCTANE // KINETIC — Pure Vehicle Electrical Health & Physical Wear Engine
 *
 * 100% pure mathematical core (zero DOM, zero IndexedDB, zero network).
 * Implements:
 * - Bounded longitudinal voltage sample recording with time/delta deduplication
 * - ACC OFF (resting battery) vs ACC ON (alternator charging) separation & 30d OLS degradation slope
 * - Physical equivalent mechanical wear for oil (engine hours + cold starts), brakes (dissipated energy),
 *   and tires (lateral + braking stress events), keeping non-kinematic components strictly linear.
 */

import { localYmd } from './date-utils.js';

export const VOLTAGE_HISTORY_MAX = 180;

const DEDUP_WINDOW_MS = 15 * 60 * 1000;
const DEDUP_VOLTAGE_DELTA = 0.05;
const MS_PER_DAY = 86400000;

function clampVal(val, min, max) {
  if (!Number.isFinite(val)) return min;
  return Math.min(max, Math.max(min, val));
}

function normalizeTimestampMs(rawTs, fallbackMs) {
  const num = Number(rawTs);
  if (!Number.isFinite(num) || num <= 0) {
    return Number.isFinite(Number(fallbackMs)) && Number(fallbackMs) > 0
      ? Math.round(Number(fallbackMs))
      : Date.now();
  }
  return num < 1e12 ? Math.round(num * 1000) : Math.round(num);
}

/**
 * Appends a live external battery voltage reading to the longitudinal history array,
 * deduplicating consecutive readings within 15 minutes and < 0.05V under the same ACC state,
 * and capping the history at VOLTAGE_HISTORY_MAX (180) samples without mutating the input array.
 *
 * @param {Array<Object>} [existingHistory=[]]
 * @param {Object|null} [liveSnapshot=null]
 * @param {number} [nowMs=Date.now()]
 * @returns {Array<Object>}
 */
export function recordVoltageSample(existingHistory = [], liveSnapshot = null, nowMs = Date.now()) {
  const cloned = Array.isArray(existingHistory)
    ? existingHistory.map(item => (item && typeof item === 'object' ? { ...item } : item))
    : [];

  const extV = Number(liveSnapshot?.externalVoltage);
  if (!liveSnapshot || !Number.isFinite(extV) || extV <= 0) {
    return cloned;
  }

  const safeNow = Number.isFinite(Number(nowMs)) && Number(nowMs) > 0 ? Number(nowMs) : Date.now();
  const sample = {
    ts: normalizeTimestampMs(liveSnapshot.gpsTime, safeNow),
    v: Number(extV.toFixed(2)),
    acc: Boolean(liveSnapshot.accStatus),
    speed: Number.isFinite(Number(liveSnapshot.speed)) ? Number(liveSnapshot.speed) : 0
  };

  if (cloned.length > 0) {
    const last = cloned[cloned.length - 1];
    if (last && typeof last === 'object') {
      const lastRawTs = last.ts ?? last.t ?? last.timestamp ?? last.time;
      const lastTs = Number.isFinite(Number(lastRawTs)) && Number(lastRawTs) > 0
        ? normalizeTimestampMs(lastRawTs, 0)
        : NaN;
      const lastV = Number(last.v);
      const sameAcc = Boolean(last.acc) === sample.acc;

      if (
        Number.isFinite(lastTs) &&
        Number.isFinite(lastV) &&
        Math.abs(sample.ts - lastTs) < DEDUP_WINDOW_MS &&
        Math.abs(lastV - sample.v) < DEDUP_VOLTAGE_DELTA &&
        sameAcc
      ) {
        return cloned;
      }
    }
  }

  const next = [...cloned, sample];
  return next.length > VOLTAGE_HISTORY_MAX ? next.slice(-VOLTAGE_HISTORY_MAX) : next;
}

/**
 * Analyzes 30-day and 7-day longitudinal electrical telemetry, separating resting battery voltage
 * (ACC OFF) from alternator charging voltage (ACC ON) and computing linear voltage drift (V / 30d).
 *
 * @param {Array<Object>} [voltageHistory=[]]
 * @param {Object|null} [gpsDaysMap=null]
 * @param {Object|null} [live=null]
 * @param {number} [nowMs=Date.now()]
 * @returns {Object}
 */
export function analyzeElectricalHealth(voltageHistory = [], gpsDaysMap = null, live = null, nowMs = Date.now()) {
  const safeNow = Number.isFinite(Number(nowMs)) && Number(nowMs) > 0 ? Number(nowMs) : Date.now();
  const cutoff30d = safeNow - 30 * MS_PER_DAY;
  const cutoff7d = safeNow - 7 * MS_PER_DAY;

  const validSamples = [];
  if (Array.isArray(voltageHistory)) {
    for (const raw of voltageHistory) {
      if (!raw || typeof raw !== 'object') continue;
      const v = Number(raw.v);
      const rawTs = raw.ts ?? raw.t ?? raw.timestamp ?? raw.time;
      const numTs = Number(rawTs);
      if (!Number.isFinite(v) || v <= 0 || !Number.isFinite(numTs) || numTs <= 0) continue;
      const ts = numTs < 1e12 ? Math.round(numTs * 1000) : Math.round(numTs);
      validSamples.push({
        ts,
        v: Number(v.toFixed(2)),
        acc: Boolean(raw.acc),
        speed: Number.isFinite(Number(raw.speed)) ? Number(raw.speed) : 0
      });
    }
  }

  const samples30d = validSamples
    .filter(s => s.ts >= cutoff30d)
    .sort((a, b) => a.ts - b.ts);
  const samples7d = samples30d.filter(s => s.ts >= cutoff7d);

  const restingSamples = samples30d.filter(s => s.acc === false);
  const restingSamples7d = samples7d.filter(s => s.acc === false);
  const chargingMoving = samples30d.filter(s => s.acc === true && s.speed > 5);
  const chargingSamples = chargingMoving.length > 0
    ? chargingMoving
    : samples30d.filter(s => s.acc === true);

  const liveV = Number(live?.externalVoltage);
  const hasLiveV = Number.isFinite(liveV) && liveV > 0;
  const liveAcc = Boolean(live?.accStatus);

  let restingAvgV = 0;
  let restingMinV = 0;
  if (restingSamples.length > 0) {
    const sum = restingSamples.reduce((acc, s) => acc + s.v, 0);
    restingAvgV = Number((sum / restingSamples.length).toFixed(2));
    restingMinV = Number(Math.min(...restingSamples.map(s => s.v)).toFixed(2));
  } else if (hasLiveV && !liveAcc) {
    restingAvgV = Number(liveV.toFixed(2));
    restingMinV = restingAvgV;
  }

  const restingAvg7dV = restingSamples7d.length > 0
    ? Number((restingSamples7d.reduce((acc, s) => acc + s.v, 0) / restingSamples7d.length).toFixed(2))
    : restingAvgV;

  // Ordinary least squares linear slope (V / day) * 30 over resting samples spanning >= 2 days
  let slopeVPer30d = 0;
  if (restingSamples.length >= 2) {
    const t0 = restingSamples[0].ts;
    const tMax = restingSamples[restingSamples.length - 1].ts;
    const spanDays = (tMax - t0) / MS_PER_DAY;

    if (spanDays >= 2) {
      const n = restingSamples.length;
      let sumX = 0;
      let sumY = 0;
      const xs = new Array(n);
      for (let i = 0; i < n; i++) {
        const x = (restingSamples[i].ts - t0) / MS_PER_DAY;
        xs[i] = x;
        sumX += x;
        sumY += restingSamples[i].v;
      }
      const meanX = sumX / n;
      const meanY = sumY / n;
      let num = 0;
      let den = 0;
      for (let i = 0; i < n; i++) {
        const dx = xs[i] - meanX;
        num += dx * (restingSamples[i].v - meanY);
        den += dx * dx;
      }
      if (den > 1e-9) {
        slopeVPer30d = Number(((num / den) * 30).toFixed(3));
      }
    }
  }

  const latestRestingV = restingSamples.length > 0
    ? restingSamples[restingSamples.length - 1].v
    : restingAvgV;

  let restingStatus = 'SIN DATO';
  let restingTone = 'neutral';
  if (restingAvgV > 0) {
    // Only treat negative 30d slope as wear when resting voltage has actually settled below healthy full-charge (~12.65V)
    const hasMeaningfulDrift = slopeVPer30d <= -0.15 && restingAvgV < 12.65 && latestRestingV < 12.55;
    if (restingAvgV < 12.15) {
      restingStatus = 'CRÍTICA';
      restingTone = 'crimson';
    } else if (restingAvgV < 12.30 || hasMeaningfulDrift) {
      restingStatus = 'DESGASTE';
      restingTone = 'amber';
    } else {
      restingStatus = 'ÓPTIMA';
      restingTone = 'volt';
    }
  }

  let chargingAvgV = 0;
  if (chargingSamples.length > 0) {
    const sum = chargingSamples.reduce((acc, s) => acc + s.v, 0);
    chargingAvgV = Number((sum / chargingSamples.length).toFixed(2));
  } else if (hasLiveV && liveAcc) {
    chargingAvgV = Number(liveV.toFixed(2));
  }

  let chargingStatus = 'SIN DATO';
  let chargingTone = 'neutral';
  if (chargingAvgV > 0) {
    if (chargingAvgV < 13.4) {
      chargingStatus = 'SUBCARGA';
      chargingTone = 'crimson';
    } else if (chargingAvgV > 14.8) {
      chargingStatus = 'SOBRECARGA';
      chargingTone = 'crimson';
    } else {
      chargingStatus = 'NOMINAL';
      chargingTone = 'volt';
    }
  }

  // Sum ignitions (runNo) over the last 30 calendar days from gpsDaysMap
  const todayYmd = localYmd(new Date(safeNow));
  const cutoffYmd = localYmd(new Date(safeNow - 30 * MS_PER_DAY));
  let ignitions30d = 0;
  if (gpsDaysMap && typeof gpsDaysMap === 'object') {
    for (const dateKey of Object.keys(gpsDaysMap)) {
      if (dateKey >= cutoffYmd && dateKey <= todayYmd) {
        const rec = gpsDaysMap[dateKey];
        ignitions30d += Math.max(0, Number(rec?.runNo) || 0);
      }
    }
  }

  // Daily-averaged (or chronological fallback) resting voltage sparkline series (up to 30 points)
  const dayBuckets = new Map();
  for (const s of restingSamples) {
    const dateKey = localYmd(new Date(s.ts));
    if (!dayBuckets.has(dateKey)) {
      dayBuckets.set(dateKey, { sum: 0, count: 0 });
    }
    const b = dayBuckets.get(dateKey);
    b.sum += s.v;
    b.count += 1;
  }

  let sparklineSeries = [];
  if (dayBuckets.size >= 2) {
    sparklineSeries = Array.from(dayBuckets.keys())
      .sort()
      .map(date => {
        const b = dayBuckets.get(date);
        return { date, v: Number((b.sum / b.count).toFixed(2)) };
      })
      .slice(-30);
  } else if (restingSamples.length > 0) {
    sparklineSeries = restingSamples
      .slice(-30)
      .map(s => ({ date: localYmd(new Date(s.ts)), v: s.v }));
  } else if (restingAvgV > 0) {
    sparklineSeries = [{ date: todayYmd, v: restingAvgV }];
  }

  // Build electrical alerts
  const alerts = [];
  if (restingStatus === 'CRÍTICA') {
    alerts.push({
      id: 'elec_battery_resting',
      type: 'electrical',
      category: 'electrical',
      title: 'BATERÍA EN REPOSO',
      name: 'BATERÍA EN REPOSO',
      severity: 'critical',
      label: 'CRÍTICA',
      color: 'var(--accent-crimson)',
      isCritical: true,
      isWarning: false,
      message: `BATERÍA EN REPOSO: ${restingAvgV.toFixed(2)}V`
    });
  } else if (restingStatus === 'DESGASTE') {
    const slopeSuffix = slopeVPer30d <= -0.15 ? ` (${slopeVPer30d.toFixed(2)}V/30D)` : '';
    alerts.push({
      id: 'elec_battery_resting',
      type: 'electrical',
      category: 'electrical',
      title: 'BATERÍA EN REPOSO',
      name: 'BATERÍA EN REPOSO',
      severity: 'warning',
      label: 'DESGASTE',
      color: 'var(--accent-amber)',
      isCritical: false,
      isWarning: true,
      message: `BATERÍA EN REPOSO: ${restingAvgV.toFixed(2)}V${slopeSuffix}`
    });
  }

  if (chargingStatus === 'SUBCARGA' || chargingStatus === 'SOBRECARGA') {
    alerts.push({
      id: 'elec_alternator',
      type: 'electrical',
      category: 'electrical',
      title: 'ALTERNADOR',
      name: 'ALTERNADOR',
      severity: 'critical',
      label: chargingStatus,
      color: 'var(--accent-crimson)',
      isCritical: true,
      isWarning: false,
      message: `ALTERNADOR: ${chargingStatus} (${chargingAvgV.toFixed(2)}V)`
    });
  }

  return {
    hasData: restingAvgV > 0 || chargingAvgV > 0,
    restingAvgV,
    restingAvg7dV,
    restingMinV,
    slopeVPer30d,
    restingStatus,
    restingTone,
    chargingAvgV,
    chargingStatus,
    chargingTone,
    ignitions30d,
    sparklineSeries,
    restingSampleCount: restingSamples.length,
    chargingSampleCount: chargingSamples.length,
    sampleCount30d: samples30d.length,
    sampleCount7d: samples7d.length,
    alerts
  };
}

/**
 * Computes physical equivalent mechanical wear for a maintenance item using GPS engine hours,
 * cold short-trips, dissipated braking energy, or lateral stress events since `lastServiceDate`.
 * Falls back cleanly to exact linear odometer wear when GPS data is absent or component is non-kinematic.
 *
 * @param {Object} maintItem
 * @param {Object} [context={}] - { currentOdo, gpsDays, tripsByDate }
 * @returns {Object}
 */
export function computePhysicalWear(maintItem, context = {}) {
  const { currentOdo = 0, gpsDays = null, tripsByDate = null } = context || {};
  const odo = Number(currentOdo) || 0;
  const lastServiceOdo = Number(maintItem?.lastServiceOdo) || 0;
  const realKmUsed = Math.max(0, odo - lastServiceOdo);
  const intervalKm = Math.max(1, Number(maintItem?.intervalKm) || 5000);
  const lastServiceDate = String(maintItem?.lastServiceDate || '').slice(0, 10);

  const finalize = (equivalentKmUsed, basisLabel, hasGpsStressData, extras = {}) => {
    const safeEq = Math.max(0, Number.isFinite(equivalentKmUsed) ? equivalentKmUsed : realKmUsed);
    const remainingRealKm = Math.max(0, intervalKm - realKmUsed);
    const remainingEquivalentKm = Math.max(0, intervalKm - safeEq);
    const wearPct = clampVal((safeEq / intervalKm) * 100, 0, 100);
    const lifePct = clampVal(100 - wearPct, 0, 100);
    const stressMultiplier = realKmUsed > 0
      ? Number((safeEq / realKmUsed).toFixed(2))
      : 1.0;

    return {
      realKmUsed,
      equivalentKmUsed: safeEq,
      intervalKm,
      remainingRealKm,
      remainingEquivalentKm,
      wearPct: Number(wearPct.toFixed(1)),
      lifePct: Number(lifePct.toFixed(1)),
      stressMultiplier,
      basisLabel,
      hasGpsStressData,
      ...extras
    };
  };

  if (!maintItem || !lastServiceDate) {
    return finalize(realKmUsed, 'ODÓMETRO', false);
  }

  const id = String(maintItem.id || '');
  const name = String(maintItem.name || '');
  const category = String(maintItem.category || '').toLowerCase();

  const isOil = id === 'maint_oil_filter' || (category === 'engine' && /aceite|oil/i.test(`${name} ${id}`));
  const isBrakes = id === 'maint_brake_fluid' || category === 'brakes';
  const isTires = id === 'maint_tire_rotation' || category === 'tires';

  if (isOil) {
    let engineSec = 0;
    let matchedDays = 0;
    if (gpsDays && typeof gpsDays === 'object') {
      for (const dateKey of Object.keys(gpsDays)) {
        if (dateKey >= lastServiceDate) {
          const rec = gpsDays[dateKey];
          if (!rec || typeof rec !== 'object') continue;
          const runSec = Math.max(0, Number(rec.runTimeSec ?? rec.runTime) || 0);
          const idleSec = Math.max(0, Number(rec.idleAccOnSec) || 0);
          const dayKm = Math.max(0, Number(rec.km ?? rec.miles) || 0);
          if (runSec > 0 || idleSec > 0 || dayKm > 0) {
            matchedDays++;
            engineSec += runSec + idleSec;
          }
        }
      }
    }

    let shortColdStarts = 0;
    if (tripsByDate && typeof tripsByDate === 'object') {
      for (const dateKey of Object.keys(tripsByDate)) {
        if (dateKey < lastServiceDate) continue;
        const dayTrips = tripsByDate[dateKey];
        if (!Array.isArray(dayTrips)) continue;
        for (const t of dayTrips) {
          if (!t || typeof t !== 'object') continue;
          const coldPct = Number(t.coldPenaltyPct) || 0;
          const dist = Number(t.distanceKm ?? t.mileageKm) || 0;
          if (coldPct >= 8 && dist < 5) {
            shortColdStarts++;
          }
        }
      }
    }

    if (matchedDays === 0 && engineSec <= 0 && shortColdStarts === 0) {
      return finalize(realKmUsed, 'ODÓMETRO', false);
    }

    const engineHours = engineSec / 3600;
    const kmPerHourRef = 31.25; // 5000 km / 160 h
    const rawEq = Math.round(Math.max(realKmUsed, engineHours * kmPerHourRef) + 4 * shortColdStarts);
    const equivalentKmUsed = realKmUsed >= 100
      ? Math.min(rawEq, Math.round(realKmUsed * 1.60))
      : rawEq;

    return finalize(equivalentKmUsed, 'HORAS MOTOR', true, {
      engineHours: Number(engineHours.toFixed(1)),
      shortColdStarts
    });
  }

  if (isBrakes) {
    let brakeEnergyMj = 0;
    let tripKm = 0;
    if (tripsByDate && typeof tripsByDate === 'object') {
      for (const dateKey of Object.keys(tripsByDate)) {
        if (dateKey < lastServiceDate) continue;
        const dayTrips = tripsByDate[dateKey];
        if (!Array.isArray(dayTrips)) continue;
        for (const t of dayTrips) {
          if (!t || typeof t !== 'object') continue;
          brakeEnergyMj += Math.max(0, Number(t.brakeEnergyMj) || 0);
          tripKm += Math.max(0, Number(t.distanceKm ?? t.mileageKm) || 0);
        }
      }
    }

    if (tripKm >= 20 && brakeEnergyMj > 0) {
      const mult = clampVal((brakeEnergyMj / tripKm) / 0.28, 0.85, 1.45);
      const equivalentKmUsed = Math.round(realKmUsed * mult);
      return finalize(equivalentKmUsed, 'FRENADO', true, {
        brakeEnergyMj: Number(brakeEnergyMj.toFixed(2)),
        tripKm: Number(tripKm.toFixed(1))
      });
    }

    return finalize(realKmUsed, 'ODÓMETRO', false);
  }

  if (isTires) {
    let events = 0;
    let tripKm = 0;
    if (tripsByDate && typeof tripsByDate === 'object') {
      for (const dateKey of Object.keys(tripsByDate)) {
        if (dateKey < lastServiceDate) continue;
        const dayTrips = tripsByDate[dateKey];
        if (!Array.isArray(dayTrips)) continue;
        for (const t of dayTrips) {
          if (!t || typeof t !== 'object') continue;
          events += Math.max(0, Number(t.lateralStressEvents) || 0) + Math.max(0, Number(t.hardBrakes) || 0);
          tripKm += Math.max(0, Number(t.distanceKm ?? t.mileageKm) || 0);
        }
      }
    }

    if (tripKm >= 20) {
      const mult = clampVal(1 + 0.002 * ((events / tripKm) * 100), 0.95, 1.30);
      const equivalentKmUsed = Math.round(realKmUsed * mult);
      return finalize(equivalentKmUsed, 'CARGA LATERAL', true, {
        stressEvents: events,
        tripKm: Number(tripKm.toFixed(1))
      });
    }

    return finalize(realKmUsed, 'ODÓMETRO', false);
  }

  // All other components (cabin, fuel, spark_plugs, etc.) remain strictly linear
  return finalize(realKmUsed, 'ODÓMETRO', false);
}
