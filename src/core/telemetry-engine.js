/**
 * OCTANE // KINETIC — Pure Mathematical Telemetry Engine
 * 
 * Implements:
 * - Ciclos de Consumo (Full-to-Full and Compensated Partial cycles)
 * - Fuel Burned Calculation & Fluid Level Simulation
 * - Interpolated Daily Series (Even distribution of KM over intermediate calendar days)
 * - Weekday DNA (7-day driving pattern profile)
 * - Active Tank State (Live autonomy, reserve distance, tank percentage)
 * - Multi-unit conversion and Swiss typography formatters
 * - Tactile Horology Sound Synthesizer (Web Audio API)
 */

import { parseFuelVolume, parseIntegerMetric } from './number-utils.js';
import { localYmd } from './date-utils.js';
import { calibrateVehicleFuelModel, decomposeFuelCost, predictTripGallonsWithPhysics } from './fuel-physics-engine.js';
import { buildGaugeCalibrationModel, evaluateGaugeCalibration } from './gauge-calibration.js';

export const GAL_TO_L = 3.78541;
export const L_TO_GAL = 1 / 3.78541;
export const FULL_ERA_START = '2026-07-28';
export const DEFAULT_TANK_CAPACITY_L = 35.0;
export const DEFAULT_TANK_CAPACITY_GAL = DEFAULT_TANK_CAPACITY_L * L_TO_GAL; // ~9.246 gal (9.25 gal)
export const DEFAULT_RESERVE_L = 5.0;
export const DEFAULT_RESERVE_GAL = DEFAULT_RESERVE_L * L_TO_GAL; // ~1.32 gal
export const DEFAULT_BENCHMARK_EFF = 33.71; // KM/GAL default benchmark
export const MIN_PLAUSIBLE_EFF_KM_GAL = 8;
export const MAX_PLAUSIBLE_EFF_KM_GAL = 70; // Upper physical ceiling for gasoline passenger cars

let audioCtx = null;
let soundEnabled = true;

/**
 * Tactical Horology tick feedback via Web Audio API.
 * Emulates the crisp micro-escapement mechanical click of Swiss horology instruments.
 */
export function playHorologyTick(freq = 1200, dur = 0.012, gainVal = 0.025) {
    if (!soundEnabled) return;
    try {
        if (typeof window === 'undefined') return;
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        if (!audioCtx) audioCtx = new AudioContextClass();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(180, audioCtx.currentTime + dur);
        gain.gain.setValueAtTime(gainVal, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + dur);
    } catch {
        // AudioContext not allowed before user gesture or unsupported
    }
}

export function isSoundEnabled() {
    return soundEnabled;
}

export function setSoundEnabled(enabled) {
    soundEnabled = Boolean(enabled);
    return soundEnabled;
}

export function toggleSound() {
    soundEnabled = !soundEnabled;
    if (soundEnabled) {
        playHorologyTick(1400, 0.02, 0.04);
    }
    return soundEnabled;
}

/**
 * Format fuel efficiency value based on active unit.
 * @param {number} effKmGal - Efficiency in KM per Gallon
 * @param {'gal'|'l100'|'kml'} unit - Measurement unit
 * @param {boolean} withUnit - Include suffix
 * @returns {string} Formatted string
 */
export function formatEff(effKmGal, unit = 'gal', withUnit = true) {
    if (!effKmGal || effKmGal <= 0 || !Number.isFinite(effKmGal)) return '--';
    if (unit === 'gal') {
        return withUnit ? `${effKmGal.toFixed(2)} KM/G` : effKmGal.toFixed(2);
    }
    if (unit === 'l100') {
        const v = 378.541 / effKmGal;
        return withUnit ? `${v.toFixed(2)} L/100` : v.toFixed(2);
    }
    // KM/L
    const v = effKmGal / GAL_TO_L;
    return withUnit ? `${v.toFixed(2)} KM/L` : v.toFixed(2);
}

/**
 * Format fuel volume.
 * @param {number} gal - Volume in Gallons
 * @param {'gal'|'l'} unit - Volume unit
 * @param {boolean} withUnit - Include suffix
 * @returns {string} Formatted string
 */
export function formatVol(gal, unit = 'gal', withUnit = true) {
    if (!Number.isFinite(gal) || gal < 0) return withUnit ? (unit === 'l' ? '0.00 L' : '0.00 GAL') : '0.00';
    const isL = unit === 'l' || unit === 'liters';
    const v = isL ? gal * GAL_TO_L : gal;
    return withUnit ? `${v.toFixed(2)} ${isL ? 'L' : 'GAL'}` : v.toFixed(2);
}

/**
 * Formats a number with precision dot thousands separators (Swiss/Latin standard).
 * Example: 97395 -> "97.395", 150000 -> "150.000"
 * @param {number|string} val
 * @returns {string} Formatted number
 */
export function formatNumber(val) {
    if (val === null || val === undefined || val === '') return '0';
    const num = typeof val === 'number' ? Math.round(val) : parseInt(String(val).replace(/[^\d]/g, ''), 10);
    if (isNaN(num)) return '0';
    return String(num).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * Format cost in Colombian Pesos (COP).
 * @param {number} amountCop - Total COP
 * @param {boolean} short - e.g. $813K vs $813,000
 * @returns {string} Formatted string
 */
export function formatCost(amountCop, short = false) {
    if (!Number.isFinite(amountCop) || amountCop < 0) return '$0';
    if (short) {
        if (amountCop >= 1000000) {
            return `$${(amountCop / 1000000).toFixed(1)}M`;
        }
        return `$${Math.round(amountCop / 1000)}K`;
    }
    return `$${formatNumber(amountCop)}`;
}

/**
 * Format ISO date string to Swiss architectural short format (e.g. "23 SEP").
 * @param {string} dateStr - "YYYY-MM-DD"
 * @returns {string} Formatted string
 */
export function formatDateShort(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return '';
    const clean = dateStr.substring(0, 10);
    const d = new Date(clean + 'T12:00:00');
    if (isNaN(d.getTime())) return dateStr;
    const months = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
    return `${String(d.getDate()).padStart(2, '0')} ${months[d.getMonth()]}`;
}

/**
 * Format ISO date string with Spanish 3-letter weekday abbreviation and short date.
 * Example: "2026-10-25" -> "DOM 25 OCT", "2026-10-26" -> "LUN 26 OCT", "2026-10-27" -> "MAR 27 OCT"
 * 
 * @param {string|Date} dateStr - Date string ("YYYY-MM-DD") or Date object
 * @returns {string} Formatted string, e.g. "DOM 26 OCT"
 */
export function formatDateWithWeekday(dateStr) {
    if (!dateStr) return '';
    let d;
    if (dateStr instanceof Date) {
        d = dateStr;
    } else {
        const clean = String(dateStr).substring(0, 10);
        d = new Date(clean + 'T12:00:00');
    }
    if (isNaN(d.getTime())) return String(dateStr);

    const weekdays = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
    const months = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

    const weekday = weekdays[d.getDay()];
    const day = String(d.getDate()).padStart(2, '0');
    const month = months[d.getMonth()];

    return `${weekday} ${day} ${month}`;
}

/**
 * Non-linear automotive float gauge calibration.
 * Delegates to the empirical piecewise-linear PAVA gauge model when available,
 * falling back to the legacy smooth monotonic transfer function otherwise.
 * 
 * @param {number} pct - Indicated needle percentage (0 - 100)
 * @param {Object|null} [gaugeModel=null] - Empirical calibration model from buildGaugeCalibrationModel
 * @returns {number} Calibrated physical fuel percentage (0 - 100)
 */
export function calibratedGaugePct(pct, gaugeModel = null) {
    return evaluateGaugeCalibration(pct, gaugeModel);
}

/**
 * Resolves an epoch timestamp (ms) for a telemetry log record.
 * Uses explicit `date` + `time` (CO -05:00), or `createdAt` ONLY when its local calendar
 * date matches `log.date` (preventing backdated entries without time from getting today's ms).
 *
 * @param {Object|null} log
 * @returns {number|null}
 */
function resolveLogTimestampMs(log) {
    if (!log || typeof log !== 'object') return null;
    const dateStr = typeof log.date === 'string' ? log.date.slice(0, 10) : '';
    const timeRaw = typeof log.time === 'string' ? log.time.trim() : '';
    if (dateStr && /^\d{1,2}:\d{2}(:\d{2})?$/.test(timeRaw)) {
        const [hh, mm] = timeRaw.split(':');
        const hhmm = `${hh.padStart(2, '0')}:${mm.padStart(2, '0')}`;
        const ms = Date.parse(`${dateStr}T${hhmm}:00-05:00`);
        return Number.isFinite(ms) ? ms : null;
    }
    if (log.createdAt) {
        const ms = Date.parse(log.createdAt);
        if (Number.isFinite(ms) && dateStr && localYmd(new Date(ms)) === dateStr) {
            return ms;
        }
    }
    return null;
}

/**
 * Computes adaptive efficiency through Bayesian Shrinkage and Exponential Moving Average (EMA).
 * α = 0.42 weights recent closed cycles higher while Bayesian shrinkage against benchmark
 * prevents overfitting when sample size of valid cycles is low.
 * 
 * Formula: adaptiveEff = (validCyclesCount * emaEff + 1.5 * benchmarkEff) / (validCyclesCount + 1.5)
 * 
 * @param {Array} validCycles - Array of valid closed cycle objects with .eff property
 * @param {number} benchmarkEff - Vehicle benchmark efficiency in KM/GAL (default 33.71)
 * @returns {{ adaptiveEff: number, emaEff: number, historicalEff: number, validCyclesCount: number }}
 */
export function calculateAdaptiveEff(validCycles = [], benchmarkEff = DEFAULT_BENCHMARK_EFF) {
    const cycles = Array.isArray(validCycles) ? validCycles.filter(c => c && c.isValid && Number(c.eff) > 0) : [];
    const validCyclesCount = cycles.length;
    const bEff = Number(benchmarkEff) || DEFAULT_BENCHMARK_EFF;

    if (validCyclesCount === 0) {
        return {
            adaptiveEff: bEff,
            emaEff: bEff,
            historicalEff: bEff,
            validCyclesCount: 0
        };
    }

    let sumKm = 0;
    let sumGal = 0;
    cycles.forEach(c => {
        sumKm += Number(c.dist) || 0;
        sumGal += Number(c.gals) || 0;
    });
    const historicalEff = (sumGal > 0 && sumKm > 0) ? Number((sumKm / sumGal).toFixed(2)) : bEff;

    let emaEff = Number(cycles[0].eff) || bEff;
    for (let i = 1; i < cycles.length; i++) {
        const cycleEff = Number(cycles[i].eff) || bEff;
        emaEff = 0.42 * cycleEff + (1 - 0.42) * emaEff;
    }

    const adaptive = (validCyclesCount * emaEff + 1.5 * bEff) / (validCyclesCount + 1.5);
    return {
        adaptiveEff: Number(adaptive.toFixed(2)),
        emaEff: Number(emaEff.toFixed(2)),
        historicalEff,
        validCyclesCount
    };
}

/**
 * Determines whether a log record represents a full tank event (TANQUE LLENO 100%).
 * Standards:
 * - Explicit `is_full_tank === true`
 * - Or when refuel reached full level (`fuel_level_percent >= 99.5` or `date >= FULL_ERA_START` with refuel)
 */
export function isFullTankLog(log) {
    if (!log) return false;
    if (log.is_full_tank !== undefined) {
        return Boolean(log.is_full_tank);
    }
    const pct = Number(log.fuel_level_percent) || 0;
    if (pct >= 99.5) return true;
    const gals = Number(log.gallons_added) || 0;
    return gals > 0 && log.date >= FULL_ERA_START;
}

/**
 * Computes physical telemetry metrics and severity factor for a date window [startDate, endDate]
 * using the cached daily GPS records from IOPGPS.
 *
 * @param {string} startDate - "YYYY-MM-DD"
 * @param {string} endDate - "YYYY-MM-DD"
 * @param {Object} [gpsDaysMap={}] - Map of "YYYY-MM-DD" -> { km, runTimeSec, stayTimeSec, idleAccOnSec, idleAccOnCount, runNo, overspeedNo }
 * @param {number} [sensitivity=1.0] - Learned physical sensitivity multiplier (0.5 to 1.6)
 * @returns {Object|null}
 */
export function computeCyclePhysicalTelemetry(startDate, endDate, gpsDaysMap = {}, sensitivity = 1.0) {
    if (!startDate || !endDate || !gpsDaysMap || typeof gpsDaysMap !== 'object') {
        return null;
    }
    const keys = Object.keys(gpsDaysMap).filter(d => d >= startDate && d <= endDate).sort();
    if (keys.length === 0) return null;

    let gpsKm = 0;
    let runTimeSec = 0;
    let stayTimeSec = 0;
    let idleAccOnSec = 0;
    let idleAccOnCount = 0;
    let runNo = 0;
    let overspeedNo = 0;
    let activeDays = 0;

    keys.forEach(k => {
        const day = gpsDaysMap[k];
        if (!day) return;
        const km = Number(day.km) || 0;
        gpsKm += km;
        if (km >= 0.5) activeDays++;
        runTimeSec += Number(day.runTimeSec) || 0;
        stayTimeSec += Number(day.stayTimeSec) || 0;
        idleAccOnSec += Number(day.idleAccOnSec) || 0;
        idleAccOnCount += Number(day.idleAccOnCount) || 0;
        runNo += Number(day.runNo) || 0;
        overspeedNo += Number(day.overspeedNo) || 0;
    });

    if (gpsKm <= 0 && runTimeSec <= 0) return null;

    const runHours = runTimeSec / 3600;
    const avgSpeedKmh = runHours > 0.05 ? Number((gpsKm / runHours).toFixed(1)) : 22.0;
    const idleAccOnMin = Math.round(idleAccOnSec / 60);
    const tripsPerActiveDay = activeDays > 0 ? Number((runNo / activeDays).toFixed(1)) : 0;

    // Physical fuel penalty model for urban driving (Barranquilla traffic + A/C load):
    // 1. Traffic density penalty: average speed below 22 km/h increases fuel burn per km;
    //    fluid highway/avenue speed above 25 km/h slightly reduces burn.
    const speedDelta = (22 - avgSpeedKmh) / 22;
    const trafficPenalty = Math.max(-0.08, Math.min(0.16, speedDelta * 0.22));

    // 2. Stationary idling with A/C on (stayAccOn): ~0.22 gal/hr (~0.83 L/hr on 1.25L engine with compressor)
    //    expressed as a fractional penalty relative to nominal cycle fuel burn.
    const nominalGal = Math.max(0.4, gpsKm / DEFAULT_BENCHMARK_EFF);
    const estIdleGal = (idleAccOnSec / 3600) * 0.22;
    const idlePenalty = Math.min(0.14, estIdleGal / nominalGal);

    // 3. Short-trip thermal/stop-go penalty when > 6 micro-trips per active day
    const shortTripPenalty = tripsPerActiveDay > 6
        ? Math.min(0.06, (tripsPerActiveDay - 6) * 0.008)
        : 0;

    const sens = Math.max(0.5, Math.min(1.6, Number(sensitivity) || 1.0));
    const rawSeverity = 1 + (trafficPenalty + idlePenalty + shortTripPenalty) * sens;
    const severityFactor = Number(Math.max(0.88, Math.min(1.28, rawSeverity)).toFixed(3));

    let regimeLabel = 'FLUIDO';
    if (severityFactor >= 1.10) regimeLabel = 'TRÁFICO DENSO + A/C';
    else if (severityFactor >= 1.03) regimeLabel = 'URBANO MIXTO';

    return {
        gpsKm: Number(gpsKm.toFixed(2)),
        runTimeSec,
        runTimeHours: Number(runHours.toFixed(1)),
        idleAccOnSec,
        idleAccOnMin,
        idleAccOnCount,
        avgSpeedKmh,
        runNo,
        activeDays,
        tripsPerActiveDay,
        overspeedNo,
        severityFactor,
        regimeLabel
    };
}

/**
 * Computes average physical severity multiplier per weekday (Mon=0 .. Sun=6) from GPS daily records.
 * Uses a weekday's average severity when at least 2 active GPS samples exist for that weekday,
 * otherwise falls back to 1.0.
 *
 * @param {Object|null} gpsDaysMap
 * @param {number} [sensitivity=1.0]
 * @returns {Array<number>} Array of 7 severity multipliers [Mon..Sun]
 */
export function computeWeekdaySeverity(gpsDaysMap = null, sensitivity = 1.0) {
    const result = [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0];
    if (!gpsDaysMap || typeof gpsDaysMap !== 'object') return result;

    const buckets = [[], [], [], [], [], [], []];
    for (const dateStr of Object.keys(gpsDaysMap)) {
        const rec = gpsDaysMap[dateStr];
        if (!rec) continue;
        const km = Number(rec.km ?? rec.miles) || 0;
        const runTimeSec = Number(rec.runTimeSec) || 0;
        if (km <= 0 && runTimeSec <= 0) continue;

        const dt = new Date(dateStr + 'T12:00:00');
        if (isNaN(dt.getTime())) continue;
        const w = dt.getDay();
        const idx = w === 0 ? 6 : w - 1; // 0=LUN, 6=DOM

        const dayPhys = computeCyclePhysicalTelemetry(dateStr, dateStr, gpsDaysMap, sensitivity);
        if (dayPhys && Number.isFinite(dayPhys.severityFactor) && dayPhys.severityFactor > 0) {
            buckets[idx].push(dayPhys.severityFactor);
        }
    }

    for (let i = 0; i < 7; i++) {
        if (buckets[i].length >= 2) {
            const avg = buckets[i].reduce((a, b) => a + b, 0) / buckets[i].length;
            result[i] = Number(avg.toFixed(3));
        }
    }

    return result;
}

/**
 * Distributes kilometers across intermediate days between discrete readings.
 * When GPS daily telemetry (`gpsDaysMap`) is available for an interval, distributes
 * the exact physical odometer delta (`dKm`) proportionally to the real GPS daily curve
 * so that 0-km parked days stay at 0 km and heavy driving days reflect their true weight,
 * while guaranteeing the sum matches 100% of the physical dashboard odometer.
 * Falls back to uniform hourly interpolation only for pre-GPS intervals.
 * 
 * @param {Array} processedData - Logs processed in chronological order
 * @param {Object} [gpsDaysMap=null] - Optional map of YYYY-MM-DD -> { km, runTimeSec, ... }
 * @returns {Array} Array of daily records { date, km, odo, refuelGal, isFull, isGpsReal, runTimeSec, idleAccOnSec }
 */
export function buildInterpolatedDailySeries(processedData, gpsDaysMap = null) {
    const hasGpsMap = gpsDaysMap && typeof gpsDaysMap === 'object' && Object.keys(gpsDaysMap).length > 0;

    if (!Array.isArray(processedData) || processedData.length === 0) {
        if (!hasGpsMap) return [];
        return Object.keys(gpsDaysMap).sort().map(k => ({
            date: k,
            km: Number((Number(gpsDaysMap[k]?.km) || 0).toFixed(2)),
            odo: null,
            refuelGal: 0,
            isFull: false,
            isGpsReal: true,
            runTimeSec: Number(gpsDaysMap[k]?.runTimeSec) || 0,
            idleAccOnSec: Number(gpsDaysMap[k]?.idleAccOnSec) || 0
        }));
    }

    if (processedData.length === 1 && !hasGpsMap) {
        const single = processedData[0];
        return [{
            date: single.date,
            km: 0,
            odo: single.odometer_reading,
            refuelGal: Number(single.gallons_added) || 0,
            isFull: Boolean(single.isFullTank),
            isGpsReal: false
        }];
    }

    const sorted = processedData.map(d => ({
        ...d,
        dateObj: new Date(d.date + 'T12:00:00')
    })).filter(d => !isNaN(d.dateObj.getTime()));

    const kmMap = {};
    const gpsFlagMap = {};

    for (let i = 0; i < sorted.length - 1; i++) {
        const p1 = sorted[i];
        const p2 = sorted[i + 1];
        const dKm = Math.max(0, p2.odometer_reading - p1.odometer_reading);
        const dHr = (p2.dateObj.getTime() - p1.dateObj.getTime()) / 3600000;

        if (dHr <= 0) {
            const key = p2.date;
            kmMap[key] = (kmMap[key] || 0) + dKm;
            continue;
        }

        // Collect calendar days in [p1.date, p2.date] with boundary weights (0.5 on anchor days, 1.0 on interior days)
        const intervalDays = [];
        const curDay = new Date(p1.dateObj.getFullYear(), p1.dateObj.getMonth(), p1.dateObj.getDate());
        const endDay = new Date(p2.dateObj.getFullYear(), p2.dateObj.getMonth(), p2.dateObj.getDate());
        let guard = 0;
        while (curDay <= endDay && guard < 5000) {
            guard++;
            const y = curDay.getFullYear();
            const m = String(curDay.getMonth() + 1).padStart(2, '0');
            const d = String(curDay.getDate()).padStart(2, '0');
            const key = `${y}-${m}-${d}`;
            const isBoundary = (key === p1.date || key === p2.date) && (p1.date !== p2.date);
            const boundaryWeight = isBoundary ? 0.5 : 1.0;
            intervalDays.push({ key, boundaryWeight });
            curDay.setDate(curDay.getDate() + 1);
        }

        // Check if GPS daily records cover this interval
        let gpsWeightedSum = 0;
        let gpsDaysFound = 0;
        if (hasGpsMap) {
            intervalDays.forEach(item => {
                const rec = gpsDaysMap[item.key];
                if (rec && rec.km !== undefined) {
                    gpsDaysFound++;
                    gpsWeightedSum += Math.max(0, Number(rec.km) || 0) * item.boundaryWeight;
                }
            });
        }

        if (hasGpsMap && gpsDaysFound > 0 && gpsWeightedSum > 0) {
            // Distribute physical odometer delta proportionally to real GPS daily mileage
            const scale = dKm / gpsWeightedSum;
            intervalDays.forEach(item => {
                const rec = gpsDaysMap[item.key];
                const rawGpsKm = rec ? Math.max(0, Number(rec.km) || 0) : 0;
                const allocatedKm = rawGpsKm * item.boundaryWeight * scale;
                kmMap[item.key] = (kmMap[item.key] || 0) + allocatedKm;
                if (rec) gpsFlagMap[item.key] = true;
            });
            continue;
        }

        // Fallback: uniform hourly interpolation for pre-GPS eras
        const rate = dKm / dHr;
        const cur = new Date(p1.dateObj.getFullYear(), p1.dateObj.getMonth(), p1.dateObj.getDate());
        const end = new Date(p2.dateObj.getFullYear(), p2.dateObj.getMonth(), p2.dateObj.getDate());

        let guardCount = 0;
        while (cur <= end && guardCount < 5000) {
            guardCount++;
            const sDay = new Date(cur.getTime());
            const eDay = new Date(cur.getTime());
            eDay.setDate(eDay.getDate() + 1);

            const oStart = p1.dateObj > sDay ? p1.dateObj : sDay;
            const oEnd = p2.dateObj < eDay ? p2.dateObj : eDay;

            if (oEnd > oStart) {
                const hrs = (oEnd.getTime() - oStart.getTime()) / 3600000;
                const year = cur.getFullYear();
                const month = String(cur.getMonth() + 1).padStart(2, '0');
                const day = String(cur.getDate()).padStart(2, '0');
                const key = `${year}-${month}-${day}`;
                kmMap[key] = (kmMap[key] || 0) + hrs * rate;
            }
            cur.setDate(cur.getDate() + 1);
        }
    }

    // Also include any GPS days after the latest manual log (or before if only 1 log exists)
    if (hasGpsMap && sorted.length > 0) {
        const lastManualDate = sorted[sorted.length - 1].date;
        Object.keys(gpsDaysMap).sort().forEach(k => {
            const rec = gpsDaysMap[k];
            if (!rec) return;
            if (k > lastManualDate) {
                kmMap[k] = Number(rec.km) || 0;
                gpsFlagMap[k] = true;
            } else if (k === lastManualDate && sorted.length === 1) {
                kmMap[k] = Number(rec.km) || 0;
                gpsFlagMap[k] = true;
            }
        });
    }

    const keys = Object.keys(kmMap).sort();
    return keys.map(k => {
        const direct = processedData.find(r => r.date === k);
        const gpsRec = hasGpsMap ? gpsDaysMap[k] : null;
        return {
            date: k,
            km: Number((kmMap[k] || 0).toFixed(2)),
            odo: direct ? direct.odometer_reading : null,
            refuelGal: direct && direct.gallons_added > 0 ? Number(direct.gallons_added) : 0,
            isFull: direct ? Boolean(direct.isFullTank) : false,
            isGpsReal: Boolean(gpsFlagMap[k] || gpsRec),
            runTimeSec: gpsRec ? (Number(gpsRec.runTimeSec) || 0) : 0,
            idleAccOnSec: gpsRec ? (Number(gpsRec.idleAccOnSec) || 0) : 0
        };
    });
}

/**
 * Computes the active tank state, real remaining fuel volume and autonomy metrics.
 * Incorporates:
 * - Sensor Fusion (EMA-safe odometer burn + non-linear calibrated float gauge)
 * - Weekly DNA-based calendar projection for autonomy and reserve days
 * 
 * @param {Array} processedData - Logs processed with v_before/v_after
 * @param {number} avgEff - Average or adaptive efficiency in KM/GAL
 * @param {Object} [vehicleProfile={}] - Vehicle specs { tankCapacityGallons, reserveLiters, ... }
 * @param {Array|Object} [arg4=null] - weekdayDNA array or options object
 * @param {number|Object} [arg5=null] - avgDailyKm number or options object
 * @param {Object} [arg6=null] - options object { fuseSensors, fuelPriceCop, ... }
 * @returns {Object|null} Active tank state
 */
export function getActiveTankState(processedData, avgEff, vehicleProfile = {}, arg4 = null, arg5 = null, arg6 = null) {
    if (!Array.isArray(processedData) || processedData.length === 0) {
        return null;
    }

    let weekdayDNA = [];
    let avgDailyKm = 0;
    let options = {};

    if (Array.isArray(arg4)) {
        weekdayDNA = arg4;
        avgDailyKm = Number(arg5) || 0;
        options = (typeof arg6 === 'object' && arg6 !== null) ? arg6 : {};
    } else if (typeof arg4 === 'object' && arg4 !== null) {
        options = arg4;
        weekdayDNA = Array.isArray(options.weekdayDNA) ? options.weekdayDNA : [];
        avgDailyKm = Number(options.avgDailyKm) || 0;
    } else if (typeof arg5 === 'object' && arg5 !== null) {
        options = arg5;
    }

    const tankMaxGal = Number(vehicleProfile.tankCapacityGallons) || 
                       (vehicleProfile.tankCapacityLiters ? vehicleProfile.tankCapacityLiters * L_TO_GAL : DEFAULT_TANK_CAPACITY_GAL);
    const reserveGal = vehicleProfile.reserveLiters ? (vehicleProfile.reserveLiters * L_TO_GAL) : DEFAULT_RESERVE_GAL;
    const benchmarkEff = Number(vehicleProfile.benchmarkEff) || Number(vehicleProfile.defaultEfficiencyKmGal) || DEFAULT_BENCHMARK_EFF;
    const safeEff = (avgEff && avgEff >= MIN_PLAUSIBLE_EFF_KM_GAL && avgEff <= MAX_PLAUSIBLE_EFF_KM_GAL && Number.isFinite(avgEff)) ? avgEff : benchmarkEff;
    const fuelPriceCop = Number(options.fuelPriceCop || vehicleProfile.fuelPriceCop) || 16000;

    const latest = processedData[processedData.length - 1];
    const gpsDaysMap = vehicleProfile?.gpsCache?.days || options?.gpsDaysMap || null;
    const gpsLive = vehicleProfile?.gpsCache?.live || options?.gpsLive || null;
    const gaugeCalibration = options.gaugeCalibration || null;
    const fuelPhysicsModel = options.fuelPhysicsModel || null;
    const tripsByDate = options.tripsByDate || vehicleProfile?.gpsCache?.tripsByDate || null;
    const gpsLiveOdo = Number(gpsLive?.totalMile) || 0;
    const gpsLiveDate = gpsLive?.date || '';
    const physicalSensitivity = Number(options?.physicalSensitivity) || Number(vehicleProfile?.gpsCache?.physicalSensitivity) || 1.0;

    // Live autonomous odometer: if IOPGPS reports a higher odometer than the latest manual log,
    // use the live GPS odometer to drive active tank consumption in real time.
    const hasNewerGpsOdo = gpsLiveOdo > latest.odometer_reading && (!gpsLiveDate || gpsLiveDate >= latest.date);
    const effectiveLatestOdo = hasNewerGpsOdo ? gpsLiveOdo : latest.odometer_reading;
    const gpsExtraKm = Math.max(0, effectiveLatestOdo - latest.odometer_reading);
    const activeEndDate = (hasNewerGpsOdo && gpsLiveDate) ? gpsLiveDate : latest.date;

    let activeGal = 0;
    let startOdo = latest.odometer_reading;
    let startDate = latest.date;

    let v_odo = 0;
    let v_gauge = 0;
    let gaugePct = (latest.fuel_level_percent !== null && latest.fuel_level_percent !== undefined)
        ? Math.min(100, Math.max(0, Number(latest.fuel_level_percent)))
        : 100;
    let fusedGal = 0;
    let activePhysicalTelemetry = null;

    const isLatestFull = Boolean(latest.is_full_tank) || Boolean(latest.isFullTank) || (Number(latest.fuel_level_percent) >= 99.5);

    if (isLatestFull && !hasNewerGpsOdo) {
        // Full tank on latest record and no subsequent GPS movement yet: 100% tank capacity
        activeGal = tankMaxGal;
        startOdo = latest.odometer_reading;
        startDate = latest.date;
        v_odo = tankMaxGal;
        v_gauge = tankMaxGal;
        gaugePct = 100;
        fusedGal = tankMaxGal;
    } else {
        // Look back for the most recent full tank anchor
        let lastFullIdx = -1;
        for (let i = processedData.length - 1; i >= 0; i--) {
            const d = processedData[i];
            if (Boolean(d.is_full_tank) || Boolean(d.isFullTank) || (Number(d.fuel_level_percent) >= 99.5)) {
                lastFullIdx = i;
                break;
            }
        }

        if (lastFullIdx >= 0) {
            const lastFull = processedData[lastFullIdx];
            startOdo = lastFull.odometer_reading;
            startDate = lastFull.date;
            const kmSinceFull = Math.max(0, effectiveLatestOdo - startOdo);

            // Sum partial refuels added between lastFull (exclusive) and latest (inclusive)
            let partialGalsAdded = 0;
            for (let k = lastFullIdx + 1; k < processedData.length; k++) {
                partialGalsAdded += parseFuelVolume(processedData[k].gallons_added, tankMaxGal);
            }

            // Compute physical severity factor for the active cycle from GPS telemetry
            activePhysicalTelemetry = computeCyclePhysicalTelemetry(startDate, activeEndDate, gpsDaysMap, physicalSensitivity);
            const severityFactor = activePhysicalTelemetry ? activePhysicalTelemetry.severityFactor : 1.0;
            const effectiveCycleEff = safeEff / severityFactor;

            let burned = effectiveCycleEff > 0 ? (kmSinceFull / effectiveCycleEff) : 0;

            // Closed-loop open-cycle physics burn when GPS trips cover >= 75% of kmSinceFull
            if (kmSinceFull > 5 && tripsByDate && typeof tripsByDate === 'object') {
                const lastFullMs = resolveLogTimestampMs(lastFull);
                let openTripsKm = 0;
                let openTripsGal = 0;

                for (const [dateKey, dayTrips] of Object.entries(tripsByDate)) {
                    if (!Array.isArray(dayTrips) || dayTrips.length === 0) continue;
                    if (lastFullMs !== null) {
                        if (dateKey < startDate) continue;
                    } else if (dateKey <= startDate) {
                        continue;
                    }
                    for (const t of dayTrips) {
                        if (!t || typeof t !== 'object') continue;
                        if (lastFullMs !== null) {
                            const tStartMs = Number(t.startTimeMs ?? (t.startTimeUnix ? t.startTimeUnix * 1000 : 0)) || 0;
                            if (tStartMs > 0) {
                                if (tStartMs < lastFullMs) continue;
                            } else if (dateKey <= startDate) {
                                continue;
                            }
                        }
                        const tripKm = Number(t.distanceKm ?? t.mileageKm) || 0;
                        const tripGal = fuelPhysicsModel?.mode === 'ridge'
                            ? predictTripGallonsWithPhysics(t, fuelPhysicsModel.coeffs)
                            : (Number(t.estGallons) || 0);
                        if (tripKm > 0 || tripGal > 0) {
                            openTripsKm += tripKm;
                            openTripsGal += Math.max(0, Number(tripGal) || 0);
                        }
                    }
                }

                if (openTripsKm >= kmSinceFull * 0.75 && openTripsGal > 0) {
                    const physicsBurned = openTripsGal * (kmSinceFull / openTripsKm);
                    const minBurn = kmSinceFull / 90;
                    const maxBurn = kmSinceFull / 10;
                    burned = Math.min(maxBurn, Math.max(minBurn, physicsBurned));
                }
            }

            v_odo = Math.max(0, tankMaxGal + partialGalsAdded - burned);

            // If latest record is an explicit manual gauge percentage without refuel:
            const hasManualGaugeOnLatest = latest.fuel_level_percent !== null && 
                                           latest.fuel_level_percent !== undefined && 
                                           !(Number(latest.gallons_added) > 0);

            if (hasManualGaugeOnLatest) {
                const rawPct = Math.min(100, Math.max(0, Number(latest.fuel_level_percent)));
                gaugePct = calibratedGaugePct(rawPct, gaugeCalibration);
                const gpsBurnSinceLatest = (hasNewerGpsOdo && effectiveCycleEff > 0) ? (gpsExtraKm / effectiveCycleEff) : 0;
                v_gauge = Math.max(0, (gaugePct / 100) * tankMaxGal - gpsBurnSinceLatest);

                // Sensor fusion: 0.65 v_odo + 0.35 v_gauge
                // If needle is in low zone (<25%), give more weight to needle (0.60 v_gauge + 0.40 v_odo)
                if (rawPct < 25) {
                    fusedGal = 0.60 * v_gauge + 0.40 * v_odo;
                } else {
                    fusedGal = 0.65 * v_odo + 0.35 * v_gauge;
                }
                fusedGal = Math.min(tankMaxGal, Math.max(0, fusedGal));

                // Use fusedGal when empirical gauge calibration is active OR sensor fusion is explicitly enabled
                const isEmpiricalGauge = gaugeCalibration?.mode === 'empirical';
                if (isEmpiricalGauge || options.fuseSensors === true || vehicleProfile.sensorFusion === true || vehicleProfile.fuseSensors === true) {
                    activeGal = fusedGal;
                } else {
                    // Raw manual needle reading reflection minus any newer GPS burn since that reading
                    activeGal = Math.max(0, (rawPct / 100) * tankMaxGal - gpsBurnSinceLatest);
                }
            } else {
                v_gauge = v_odo;
                fusedGal = v_odo;
                activeGal = v_odo;
            }
        } else {
            // No full tank event recorded yet
            const gpsBurnSinceLatest = (hasNewerGpsOdo && safeEff > 0) ? (gpsExtraKm / safeEff) : 0;
            if (latest.fuel_level_percent !== null && latest.fuel_level_percent !== undefined) {
                const rawPct = Math.min(100, Math.max(0, Number(latest.fuel_level_percent)));
                gaugePct = calibratedGaugePct(rawPct, gaugeCalibration);
                v_gauge = Math.max(0, (gaugePct / 100) * tankMaxGal - gpsBurnSinceLatest);
                v_odo = v_gauge;
                fusedGal = v_gauge;
                const isEmpiricalGauge = gaugeCalibration?.mode === 'empirical';
                activeGal = (isEmpiricalGauge || options.fuseSensors === true || vehicleProfile.sensorFusion === true)
                    ? v_gauge
                    : Math.max(0, (rawPct / 100) * tankMaxGal - gpsBurnSinceLatest);
            } else if (latest.v_after !== undefined && Number.isFinite(latest.v_after)) {
                activeGal = Math.max(0, latest.v_after - gpsBurnSinceLatest);
                v_odo = activeGal;
                v_gauge = activeGal;
                fusedGal = activeGal;
            } else {
                activeGal = Math.max(0, tankMaxGal * 0.5 - gpsBurnSinceLatest); // 50% default
                v_odo = activeGal;
                v_gauge = activeGal;
                fusedGal = activeGal;
            }
            startOdo = processedData[0].odometer_reading;
            startDate = processedData[0].date;
        }
    }

    // Defend against overflow or NaN
    activeGal = Math.min(tankMaxGal, Math.max(0, Number.isFinite(activeGal) ? activeGal : 0));
    const kmDriven = Math.max(0, effectiveLatestOdo - startOdo);
    const activePct = tankMaxGal > 0 ? (activeGal / tankMaxGal) * 100 : 0;

    // Consistent cycle physical severity across burned fuel and remaining autonomy/reserve
    const projEff = (activePhysicalTelemetry?.severityFactor > 0)
        ? (safeEff / activePhysicalTelemetry.severityFactor)
        : safeEff;
    const autonomyKm = Math.round(activeGal * projEff);
    const reserveKm = Math.max(0, Math.round(Math.max(0, activeGal - reserveGal) * projEff));
    const isReserve = activeGal <= reserveGal || activePct <= 14.5;

    if (activePhysicalTelemetry) {
        const activeBurnedGal = projEff > 0 && kmDriven > 0 ? (kmDriven / projEff) : 0;
        activePhysicalTelemetry.invisibleTax = decomposeFuelCost(activePhysicalTelemetry, {
            totalGallons: activeBurnedGal,
            fuelPriceCop,
            priors: options.fuelPhysicsPriors
        });
    }

    // Day-by-day gallon simulation based on Weekly DNA & Weekday GPS Severity, subtracting todayKm
    const simNow = options.now instanceof Date ? options.now : new Date();
    const todayStr = localYmd(simNow);
    const todayKm = Number(gpsDaysMap?.[todayStr]?.km ?? gpsDaysMap?.[todayStr]?.miles ?? vehicleProfile?.gpsCache?.live?.todayMile) || 0;
    const weekdaySeverity = computeWeekdaySeverity(gpsDaysMap, physicalSensitivity);
    const routineDaily = Number(vehicleProfile.routineDailyKm) || 24;
    const fallbackDaily = avgDailyKm > 0 ? avgDailyKm : routineDaily;

    const simulateFuelDays = (fuelGal) => {
        if (!Number.isFinite(fuelGal) || fuelGal <= 0 || !Number.isFinite(safeEff) || safeEff <= 0) {
            return { days: 0, date: null };
        }
        let remGal = fuelGal;
        let dayOffset = 0;
        let finalDateStr = todayStr;

        while (remGal > 0 && dayOffset < 730) {
            const simDate = new Date(simNow.getFullYear(), simNow.getMonth(), simNow.getDate() + dayOffset, 12, 0, 0);
            finalDateStr = localYmd(simDate);
            const w = simDate.getDay();
            const idx = w === 0 ? 6 : w - 1;
            const plannedKm = (Array.isArray(weekdayDNA) && weekdayDNA[idx] && weekdayDNA[idx].avgKm > 0)
                ? weekdayDNA[idx].avgKm
                : fallbackDaily;
            const kmForDay = dayOffset === 0
                ? Math.max(0, plannedKm - todayKm)
                : Math.max(1, plannedKm);

            if (kmForDay > 0) {
                const effToday = safeEff / (weekdaySeverity[idx] || 1.0);
                const galBurn = effToday > 0 ? (kmForDay / effToday) : 0;
                remGal -= galBurn;
            }

            if (remGal <= 0) {
                return { days: dayOffset, date: finalDateStr };
            }
            dayOffset++;
        }

        return { days: dayOffset, date: finalDateStr };
    };

    const autonomySim = simulateFuelDays(activeGal);
    const autonomyDays = autonomySim.days;
    const autonomyDate = autonomySim.date;

    const galAboveReserve = Math.max(0, activeGal - reserveGal);
    let reserveDays = 0;
    let reserveDate = null;
    if (safeEff > 0 && activeGal > 0) {
        if (galAboveReserve <= 0) {
            reserveDays = 0;
            reserveDate = todayStr;
        } else {
            const reserveSim = simulateFuelDays(galAboveReserve);
            reserveDays = reserveSim.days;
            reserveDate = reserveSim.date;
        }
    }

    const reserveDateLabel = (reserveDays <= 0 || !reserveDate)
        ? 'HOY'
        : formatDateWithWeekday(reserveDate);

    return {
        latest,
        liveOdometer: effectiveLatestOdo,
        gpsExtraKm,
        physicalTelemetry: activePhysicalTelemetry,
        weekdaySeverity,
        activeGal: Number(activeGal.toFixed(3)),
        startOdo,
        startDate,
        kmDriven,
        activePct: Number(activePct.toFixed(1)),
        autonomyKm,
        reserveKm,
        reserveGal: Number(reserveGal.toFixed(2)),
        tankMaxGal: Number(tankMaxGal.toFixed(2)),
        isReserve,
        autonomyDays,
        autonomyDate,
        reserveDays,
        reserveDate,
        reserveDateLabel,
        adaptiveEff: Number(safeEff.toFixed(2)),
        fuelValueCop: Math.round(activeGal * fuelPriceCop),
        v_odo: Number(v_odo.toFixed(3)),
        v_gauge: Number(v_gauge.toFixed(3)),
        calibratedGaugePct: gaugePct,
        gaugeCalibrated: gaugeCalibration?.mode === 'empirical',
        fusedGal: Number(fusedGal.toFixed(3)),
        fusedPct: Number(((fusedGal / tankMaxGal) * 100).toFixed(1)),
        fusedAutonomyKm: Math.round(fusedGal * projEff)
    };
}

/**
 * Aggregates driving frequency by 7 weekdays.
 * 
 * @param {Array} dailySeries - Interpolated daily series
 * @returns {Array} Array of 7 weekday records
 */
export function calculateWeekdayDNA(dailySeries) {
    const names = ['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM'];
    const buckets = [[], [], [], [], [], [], []];

    if (Array.isArray(dailySeries)) {
        dailySeries.forEach(d => {
            if (!d || !d.date) return;
            const dt = new Date(d.date + 'T12:00:00');
            if (isNaN(dt.getTime())) return;
            const w = dt.getDay(); // 0 is DOM
            const idx = w === 0 ? 6 : w - 1; // 0=LUN, 6=DOM
            buckets[idx].push(Number(d.km) || 0);
        });
    }

    const avgs = buckets.map(arr => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length) : 0);
    const maxA = Math.max(...avgs, 1);

    return names.map((name, i) => {
        const avg = Number(avgs[i].toFixed(1));
        const total = Number(buckets[i].reduce((a, b) => a + b, 0).toFixed(1));
        return {
            name,
            dayIndex: i,
            avgKm: avg,
            totalKm: total,
            count: buckets[i].length,
            isPeak: avgs[i] >= maxA * 0.88 && avgs[i] > 0
        };
    });
}

/**
 * Pure Mathematical Telemetry Engine Core.
 * Computes closed cycles, burned fuel vectors, daily series, and active tank state.
 * 
 * Supports both call styles:
 * - calculateTelemetryModel(logs, vehicleProfile, options)
 * - calculateTelemetryModel(data, fuelPriceCop, scope, vehicleProfile)
 * 
 * @param {Array} logs - Raw or stored telemetry records
 * @param {Object|number} [arg2={}] - vehicleProfile or fuelPriceCop
 * @param {Object|string} [arg3={}] - options or scope string
 * @param {Object} [arg4={}] - vehicleProfile when using positional fuelPriceCop
 * @returns {Object} Complete telemetry model
 */
export function calculateTelemetryModel(logs = [], arg2 = {}, arg3 = {}, arg4 = {}) {
    let vehicleProfile = {};
    let options = {};
    if (typeof arg2 === 'number') {
        // Positional signature: calculateTelemetryModel(data, fuelPriceCop, scope, vehicleProfile)
        options = {
            fuelPriceCop: arg2,
            scope: typeof arg3 === 'string' ? arg3 : 'full_era'
        };
        vehicleProfile = (typeof arg4 === 'object' && arg4 !== null) ? arg4 : {};
    } else {
        // Standard signature: calculateTelemetryModel(logs, vehicleProfile, options)
        vehicleProfile = (typeof arg2 === 'object' && arg2 !== null) ? arg2 : {};
        options = (typeof arg3 === 'object' && arg3 !== null) ? arg3 : (typeof arg3 === 'string' ? { scope: arg3 } : {});
        if (typeof arg4 === 'object' && arg4 !== null && Object.keys(arg4).length > 0) {
            vehicleProfile = { ...vehicleProfile, ...arg4 };
        }
    }

    const benchmarkEff = Number(vehicleProfile.benchmarkEff) || 
                         Number(vehicleProfile.defaultEfficiencyKmGal) || 
                         DEFAULT_BENCHMARK_EFF;
    const defaultEff = benchmarkEff;
    const tankMaxGal = Number(vehicleProfile.tankCapacityGallons) || 
                       (vehicleProfile.tankCapacityLiters ? vehicleProfile.tankCapacityLiters * L_TO_GAL : DEFAULT_TANK_CAPACITY_GAL);
    const fuelPriceCop = Number(options.fuelPriceCop || vehicleProfile.fuelPriceCop) || 16000;
    const scope = options.scope || 'full_era';

    // Zero-length guard: Return clean empty model
    if (!Array.isArray(logs) || logs.length === 0) {
        return {
            processedData: [],
            fullEraCycles: [],
            closedCycles: [],
            allCycles: [],
            fullEraAvgEff: defaultEff,
            historicalEff: defaultEff,
            emaEff: defaultEff,
            adaptiveEff: defaultEff,
            dailySeries: [],
            activeTankState: null,
            scopedRecords: [],
            weekdayDNA: calculateWeekdayDNA([]),
            learnedSensitivity: Number(vehicleProfile?.gpsCache?.physicalSensitivity) || 1.0,
            fuelPhysicsModel: calibrateVehicleFuelModel([], { tripsByDate: vehicleProfile?.gpsCache?.tripsByDate }),
            gaugeCalibration: buildGaugeCalibrationModel([], { tankMaxGal }),
            stats: {
                totalKm: 0,
                totalGallons: 0,
                totalCostCop: 0,
                avgKmPerDay: 0,
                cycleCount: 0,
                readingCount: 0
            }
        };
    }

    // Normalize and sort logs ascending by date, then by odometer reading
    const sorted = [...logs].map(r => {
        const gals = parseFuelVolume(r.gallons_added, tankMaxGal);
        const odo = parseIntegerMetric(r.odometer_reading);
        const pct = r.fuel_level_percent !== undefined && r.fuel_level_percent !== null && r.fuel_level_percent !== ''
            ? Math.min(100, Math.max(0, Number(r.fuel_level_percent)))
            : null;
        let isFull = false;
        if (r.is_full_tank !== undefined) {
            isFull = Boolean(r.is_full_tank);
        } else {
            const hasDecimalGallons = gals > 0 && Math.abs(gals - Math.round(gals)) > 0.0001;
            isFull = Boolean(hasDecimalGallons || (pct !== null && pct >= 99.5));
        }
        return {
            ...r,
            odometer_reading: odo,
            gallons_added: gals,
            fuel_level_percent: pct,
            is_full_tank: isFull
        };
    }).sort((a, b) => {
        if (a.date !== b.date) return a.date > b.date ? 1 : -1;
        if (a.odometer_reading !== b.odometer_reading) {
            return (Number(a.odometer_reading) || 0) - (Number(b.odometer_reading) || 0);
        }
        const timeA = a.time || (a.createdAt ? String(a.createdAt).slice(11, 16) : '');
        const timeB = b.time || (b.createdAt ? String(b.createdAt).slice(11, 16) : '');
        if (timeA && timeB && timeA !== timeB) return timeA > timeB ? 1 : -1;
        return String(a.id || '').localeCompare(String(b.id || ''));
    });

    // Extract refuel events for Universal Dual Algorithm (Full-to-Full and Compensated Partial)
    // Allow a base full-tank record (even with gallons_added === 0 and is_full_tank === true, like onboarding)
    // to act as start anchor (s) for consumption cycles
    const refuelEvents = [];
    sorted.forEach((item, idx) => {
        const gals = item.gallons_added;
        const isFull = isFullTankLog(item) || Boolean(item.is_full_tank);
        if (gals > 0 || isFull) {
            refuelEvents.push({
                idx,
                date: item.date,
                odo: item.odometer_reading,
                gals,
                fuel_level_percent: item.fuel_level_percent,
                isFull
            });
        }
    });

    const allClosedCycles = [];
    let sumKm = 0;
    let sumGal = 0;
    let validCyclesCount = 0;

    for (let i = 0; i < refuelEvents.length - 1; i++) {
        const s = refuelEvents[i];
        const e = refuelEvents[i + 1];

        // An end event must add fuel (e.gals > 0) to close a measurable consumption cycle
        if (!e.gals || e.gals <= 0) {
            continue;
        }

        const dist = Math.max(0, e.odo - s.odo);
        const d1 = new Date(s.date + 'T12:00:00');
        const d2 = new Date(e.date + 'T12:00:00');
        const diffMs = !isNaN(d1.getTime()) && !isNaN(d2.getTime()) ? d2.getTime() - d1.getTime() : 0;
        const days = Math.max(1, Math.round(diffMs / 86400000) || 1);
        const kmPerDay = days > 0 ? Number((dist / days).toFixed(1)) : dist;

        let consumedGals = 0;
        let cycleType = 'full';

        if (s.isFull && e.isFull) {
            // Full-to-Full cycle: exact consumption between full tanks
            consumedGals = e.gals;
            cycleType = 'full';
        } else {
            // Compensated Partial cycle: delta needle percentage compensation
            // DeltaTanqueGal = ((Nivel_i - Nivel_i+1) / 100) * CapacidadTanqueGal
            // GalonesConsumidos = GalonesAñadidos_i + DeltaTanqueGal
            const nivelI = s.fuel_level_percent !== null ? s.fuel_level_percent : (s.isFull ? 100 : 50);
            const nivelNext = e.fuel_level_percent !== null ? e.fuel_level_percent : (e.isFull ? 100 : 50);
            const deltaTanqueGal = ((nivelI - nivelNext) / 100) * tankMaxGal;
            consumedGals = s.gals + deltaTanqueGal;
            cycleType = 'partial';
        }

        // Defensive validation against negative, NaN, or zero fuel consumption
        if (!Number.isFinite(consumedGals) || consumedGals <= 0.001) {
            consumedGals = Math.max(0.1, e.gals || s.gals || 0.1);
        }

        const eff = (consumedGals > 0 && dist > 0) ? (dist / consumedGals) : 0;

        // Filter physically impossible / partial-residual cycles:
        // Exclude from averages if dist < 5 km, consumedGals < 0.3 gal, or eff outside [8, 70] km/gal
        const isValidCycle = dist >= 5 && consumedGals >= 0.3 && eff >= MIN_PLAUSIBLE_EFF_KM_GAL && eff <= MAX_PLAUSIBLE_EFF_KM_GAL;
        let invalidReason = null;
        if (!isValidCycle) {
            if (eff > MAX_PLAUSIBLE_EFF_KM_GAL) invalidReason = 'implausible_high';
            else if (eff < MIN_PLAUSIBLE_EFF_KM_GAL) invalidReason = 'implausible_low';
            else invalidReason = 'partial_residual';
        }
        if (isValidCycle) {
            sumKm += dist;
            sumGal += consumedGals;
            validCyclesCount++;
        }

        const rawEndCost = parseIntegerMetric(sorted[e.idx]?.total_cost_cop);
        const totalCostCop = rawEndCost > 0 ? rawEndCost : Math.round(consumedGals * fuelPriceCop);
        let pricePerGal = fuelPriceCop;
        if (e.gals > 0 && rawEndCost > 0) {
            const computedPrice = Math.round(rawEndCost / e.gals);
            if (computedPrice >= 5000 && computedPrice <= 45000) {
                pricePerGal = computedPrice;
            }
        }

        allClosedCycles.push({
            cycleIndex: allClosedCycles.length + 1,
            startDate: s.date,
            endDate: e.date,
            startTime: sorted[s.idx]?.time || null,
            endTime: sorted[e.idx]?.time || null,
            startTimeMs: resolveLogTimestampMs(sorted[s.idx]),
            endTimeMs: resolveLogTimestampMs(sorted[e.idx]),
            startOdo: s.odo,
            endOdo: e.odo,
            startIndex: s.idx,
            endIndex: e.idx,
            startLogId: sorted[s.idx]?.id || sorted[s.idx]?.date,
            endLogId: sorted[e.idx]?.id || sorted[e.idx]?.date,
            days,
            dist,
            gals: Number(consumedGals.toFixed(3)),
            eff: Number(eff.toFixed(2)),
            kmPerDay: Number.isFinite(kmPerDay) ? kmPerDay : 0,
            totalCostCop,
            pricePerGal,
            type: cycleType,
            isFull: cycleType === 'full',
            isValid: isValidCycle,
            invalidReason
        });
    }

    // Defensive fullEraAvgEff calculation with guard against division by zero and anomalous cycles.
    // If no valid closed cycles, fallback to vehicleProfile.benchmarkEff || DEFAULT_BENCHMARK_EFF (33.71), NEVER 0.54
    const fullEraAvgEff = (validCyclesCount > 0 && sumGal > 0 && sumKm > 0 && Number.isFinite(sumKm / sumGal))
        ? Number((sumKm / sumGal).toFixed(2))
        : defaultEff;
    const historicalEff = fullEraAvgEff;

    // Adaptive Efficiency (Bayesian Shrinkage + Chronological EMA with recency factor alpha = 0.42)
    const validClosedCycles = allClosedCycles.filter(c => c.isValid);
    let emaEff = benchmarkEff;
    if (validClosedCycles.length > 0) {
        let currentEma = validClosedCycles[0].eff;
        for (let k = 1; k < validClosedCycles.length; k++) {
            currentEma = 0.42 * validClosedCycles[k].eff + (1 - 0.42) * currentEma;
        }
        emaEff = currentEma;
    }

    const adaptiveEff = Number(((validCyclesCount * emaEff + 1.5 * benchmarkEff) / (validCyclesCount + 1.5)).toFixed(2));

    // Attach physical GPS telemetry to each closed cycle & auto-calibrate physical sensitivity across valid cycles
    const gpsDaysMap = vehicleProfile?.gpsCache?.days || options?.gpsDaysMap || null;
    let learnedSensitivity = Number(vehicleProfile?.gpsCache?.physicalSensitivity) || 1.0;
    if (gpsDaysMap && typeof gpsDaysMap === 'object' && Object.keys(gpsDaysMap).length > 0) {
        const sensSamples = [];
        allClosedCycles.forEach(cycle => {
            const basePhys = computeCyclePhysicalTelemetry(cycle.startDate, cycle.endDate, gpsDaysMap, 1.0);
            if (basePhys && cycle.isValid && cycle.eff > 0 && adaptiveEff > 0) {
                const observedSeverity = adaptiveEff / cycle.eff;
                const modelDelta = basePhys.severityFactor - 1.0;
                if (Math.abs(modelDelta) >= 0.015) {
                    const ratio = (observedSeverity - 1.0) / modelDelta;
                    sensSamples.push(Math.max(0.5, Math.min(1.6, ratio)));
                }
            }
        });
        if (sensSamples.length > 0) {
            const avgSens = sensSamples.reduce((a, b) => a + b, 0) / sensSamples.length;
            learnedSensitivity = Number((0.6 * learnedSensitivity + 0.4 * avgSens).toFixed(3));
        }
        allClosedCycles.forEach(cycle => {
            cycle.physicalTelemetry = computeCyclePhysicalTelemetry(cycle.startDate, cycle.endDate, gpsDaysMap, learnedSensitivity);
        });
    }

    const fuelPhysicsModel = calibrateVehicleFuelModel(allClosedCycles, {
        tripsByDate: vehicleProfile?.gpsCache?.tripsByDate
    });

    allClosedCycles.forEach(cycle => {
        if (cycle.physicalTelemetry) {
            cycle.physicalTelemetry.invisibleTax = decomposeFuelCost(cycle.physicalTelemetry, {
                totalGallons: cycle.gals,
                fuelPriceCop,
                priors: fuelPhysicsModel.coeffs
            });
        }
    });

    // Unified Stage 02: returns up to 7 latest closed cycles (Full or Compensated Partial)
    const fullEraCycles = allClosedCycles.slice(-7);

    // Process fluid level across all records
    const processedData = [];
    let curGal = tankMaxGal;

    for (let i = 0; i < sorted.length; i++) {
        const item = sorted[i];
        const isFull = isFullTankLog(item) || Boolean(item.is_full_tank);
        const odo = item.odometer_reading;
        const prev = i > 0 ? sorted[i - 1] : null;
        const prevOdo = prev ? prev.odometer_reading : odo;
        const deltaKm = Math.max(0, odo - prevOdo);
        const galsAdded = item.gallons_added;
        const effForBurn = fullEraAvgEff > 0 ? fullEraAvgEff : defaultEff;
        const burned = effForBurn > 0 ? (deltaKm / effForBurn) : 0;

        const vBefore = Math.max(0, curGal - burned);
        let vAfter = vBefore;
        if (galsAdded > 0) {
            vAfter = isFull ? tankMaxGal : Math.min(tankMaxGal, vBefore + galsAdded);
        } else if (isFull) {
            vAfter = tankMaxGal;
        } else if (item.fuel_level_percent !== null && item.fuel_level_percent !== undefined) {
            vAfter = (Math.min(100, Math.max(0, Number(item.fuel_level_percent))) / 100) * tankMaxGal;
        }
        curGal = vAfter;

        processedData.push({
            ...item,
            odometer_reading: odo,
            gallons_added: galsAdded,
            delta_km: deltaKm,
            isFullTank: isFull,
            v_before: Number(vBefore.toFixed(3)),
            v_after: Number(vAfter.toFixed(3))
        });
    }

    // Build empirical float-gauge calibration curve from direct pre-refuel anchors & retroactive intermediate readings
    const tripsByDate = vehicleProfile?.gpsCache?.tripsByDate || options?.tripsByDate || null;
    const gaugeCalibration = buildGaugeCalibrationModel(processedData, {
        tankMaxGal,
        tripsByDate,
        closedCycles: allClosedCycles,
        adaptiveEff
    });

    // Build interpolated daily series (proportional to GPS daily mileage when available)
    const dailySeries = buildInterpolatedDailySeries(processedData, gpsDaysMap);
    const weekdayDNA = calculateWeekdayDNA(dailySeries);

    const totalDays = dailySeries.length > 0 ? dailySeries.length : 1;
    const avgDailyKm = dailySeries.length > 0
        ? dailySeries.reduce((acc, curr) => acc + curr.km, 0) / totalDays
        : 0;

    // Active tank state (incorporates sensor fusion, physical severity & weekly DNA days projection)
    const activeTankState = getActiveTankState(
        processedData,
        adaptiveEff,
        vehicleProfile,
        weekdayDNA,
        avgDailyKm,
        {
            ...options,
            gpsDaysMap,
            tripsByDate,
            physicalSensitivity: learnedSensitivity,
            fuelPhysicsPriors: fuelPhysicsModel.coeffs,
            fuelPhysicsModel,
            gaugeCalibration
        }
    );

    // Scoped records (Active telemetry calibration)
    const scopedRecords = scope === 'full_era'
        ? processedData.filter(d => d.date >= FULL_ERA_START)
        : processedData;

    // Scoped gallons and costs
    let scopedGals = 0;
    scopedRecords.forEach((r, idx) => {
        if (r.gallons_added > 0) {
            // First record is calibration base
            if (scope === 'full_era' && idx === 0) return;
            scopedGals += r.gallons_added;
        }
    });

    const totalDistance = processedData.length > 1
        ? Math.max(0, processedData[processedData.length - 1].odometer_reading - processedData[0].odometer_reading)
        : 0;

    const lastRefuelEvent = refuelEvents.length > 0 ? refuelEvents[refuelEvents.length - 1] : null;
    const lastRefuelIndex = lastRefuelEvent ? lastRefuelEvent.idx : -1;

    return {
        processedData,
        fullEraCycles,
        closedCycles: allClosedCycles,
        allCycles: allClosedCycles,
        fullEraAvgEff,
        historicalEff,
        emaEff: Number(emaEff.toFixed(2)),
        adaptiveEff,
        dailySeries,
        activeTankState,
        lastRefuelIndex,
        scopedRecords,
        weekdayDNA,
        learnedSensitivity,
        fuelPhysicsModel,
        gaugeCalibration,
        stats: {
            totalKm: totalDistance,
            totalGallons: Number(scopedGals.toFixed(2)),
            totalCostCop: Math.round(scopedGals * fuelPriceCop),
            avgKmPerDay: Number(avgDailyKm.toFixed(1)),
            cycleCount: allClosedCycles.length,
            readingCount: processedData.length
        }
    };
}

/**
 * Convenient alias for calculateTelemetryModel
 */
export const recalculateTelemetry = calculateTelemetryModel;

