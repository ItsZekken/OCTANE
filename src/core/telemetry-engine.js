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

export const GAL_TO_L = 3.78541;
export const L_TO_GAL = 1 / 3.78541;
export const FULL_ERA_START = '2026-07-28';
export const DEFAULT_TANK_CAPACITY_L = 35.0;
export const DEFAULT_TANK_CAPACITY_GAL = DEFAULT_TANK_CAPACITY_L * L_TO_GAL; // ~9.246 gal (9.25 gal)
export const DEFAULT_RESERVE_L = 5.0;
export const DEFAULT_RESERVE_GAL = DEFAULT_RESERVE_L * L_TO_GAL; // ~1.32 gal
export const DEFAULT_BENCHMARK_EFF = 33.71; // KM/GAL default benchmark

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
    return `$${Math.round(amountCop).toLocaleString('es-CO')}`;
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
    const gals = Number(log.gallons_added) || 0;
    const pct = Number(log.fuel_level_percent) || 0;
    return gals > 0 && (pct >= 99.5 || log.date >= FULL_ERA_START);
}

/**
 * Distributes kilometers evenly across intermediate days between discrete readings.
 * Prevents phantom spikes when readings are taken days or weeks apart.
 * 
 * @param {Array} processedData - Logs processed in chronological order
 * @returns {Array} Array of daily records { date, km, odo, refuelGal, isFull }
 */
export function buildInterpolatedDailySeries(processedData) {
    if (!Array.isArray(processedData) || processedData.length === 0) {
        return [];
    }

    if (processedData.length === 1) {
        const single = processedData[0];
        return [{
            date: single.date,
            km: 0,
            odo: single.odometer_reading,
            refuelGal: Number(single.gallons_added) || 0,
            isFull: Boolean(single.isFullTank)
        }];
    }

    const sorted = processedData.map(d => ({
        ...d,
        dateObj: new Date(d.date + 'T12:00:00')
    })).filter(d => !isNaN(d.dateObj.getTime()));

    const kmMap = {};

    for (let i = 0; i < sorted.length - 1; i++) {
        const p1 = sorted[i];
        const p2 = sorted[i + 1];
        const dKm = Math.max(0, p2.odometer_reading - p1.odometer_reading);
        const dHr = (p2.dateObj.getTime() - p1.dateObj.getTime()) / 3600000;

        if (dHr <= 0) {
            // Same day readings: accumulate distance into that day
            const key = p2.date;
            kmMap[key] = (kmMap[key] || 0) + dKm;
            continue;
        }

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

    const keys = Object.keys(kmMap).sort();
    return keys.map(k => {
        const direct = processedData.find(r => r.date === k);
        return {
            date: k,
            km: Number((kmMap[k] || 0).toFixed(2)),
            odo: direct ? direct.odometer_reading : null,
            refuelGal: direct && direct.gallons_added > 0 ? Number(direct.gallons_added) : 0,
            isFull: direct ? Boolean(direct.isFullTank) : false
        };
    });
}

/**
 * Computes the active tank state, real remaining fuel volume and autonomy metrics.
 * 
 * @param {Array} processedData - Logs processed with v_before/v_after
 * @param {number} avgEff - Average efficiency in KM/GAL
 * @param {Object} vehicleProfile - Vehicle specs { tankCapacityGallons, reserveLiters, ... }
 * @returns {Object|null} Active tank state
 */
export function getActiveTankState(processedData, avgEff, vehicleProfile = {}) {
    if (!Array.isArray(processedData) || processedData.length === 0) {
        return null;
    }

    const tankMaxGal = Number(vehicleProfile.tankCapacityGallons) || 
                       (vehicleProfile.tankCapacityLiters ? vehicleProfile.tankCapacityLiters * L_TO_GAL : DEFAULT_TANK_CAPACITY_GAL);
    const reserveGal = vehicleProfile.reserveLiters ? (vehicleProfile.reserveLiters * L_TO_GAL) : DEFAULT_RESERVE_GAL;
    const safeEff = (avgEff && avgEff > 0 && Number.isFinite(avgEff)) ? avgEff : DEFAULT_BENCHMARK_EFF;

    const latest = processedData[processedData.length - 1];
    const fulls = processedData.filter(d => d.isFullTank && Number(d.gallons_added) > 0);
    const refuels = processedData.filter(d => Number(d.gallons_added) > 0);

    let activeGal = 0;
    let startOdo = latest.odometer_reading;
    let startDate = latest.date;

    if (fulls.length > 0) {
        const lastFull = fulls[fulls.length - 1];
        startOdo = lastFull.odometer_reading;
        startDate = lastFull.date;
        const kmSince = Math.max(0, latest.odometer_reading - startOdo);
        activeGal = Math.max(0, tankMaxGal - (kmSince / safeEff));
    } else if (refuels.length > 0) {
        const lastRefuel = refuels[refuels.length - 1];
        startOdo = lastRefuel.odometer_reading;
        startDate = lastRefuel.date;
        const kmSince = Math.max(0, latest.odometer_reading - startOdo);
        const baseGal = lastRefuel.v_after !== undefined
            ? lastRefuel.v_after
            : ((Number(lastRefuel.fuel_level_percent) || 50) / 100) * tankMaxGal;
        activeGal = Math.max(0, baseGal - (kmSince / safeEff));
    } else {
        // Fallback for fleets or records without full tank yet
        const first = processedData[0];
        startOdo = first.odometer_reading;
        startDate = first.date;
        const kmSince = Math.max(0, latest.odometer_reading - startOdo);
        const basePct = latest.fuel_level_percent !== undefined ? Number(latest.fuel_level_percent) : 50;
        const estimatedBaseGal = (basePct / 100) * tankMaxGal;
        activeGal = Math.max(0, estimatedBaseGal - (kmSince / safeEff));
    }

    // Defend against overflow or NaN
    activeGal = Math.min(tankMaxGal, Math.max(0, Number.isFinite(activeGal) ? activeGal : 0));
    const kmDriven = Math.max(0, latest.odometer_reading - startOdo);
    const activePct = tankMaxGal > 0 ? (activeGal / tankMaxGal) * 100 : 0;
    const autonomyKm = Math.round(activeGal * safeEff);
    const reserveKm = Math.max(0, Math.round(Math.max(0, activeGal - reserveGal) * safeEff));
    const isReserve = activeGal <= reserveGal || activePct <= 14.5;

    return {
        latest,
        activeGal: Number(activeGal.toFixed(3)),
        startOdo,
        startDate,
        kmDriven,
        activePct: Number(activePct.toFixed(1)),
        autonomyKm,
        reserveKm,
        reserveGal: Number(reserveGal.toFixed(2)),
        tankMaxGal: Number(tankMaxGal.toFixed(2)),
        isReserve
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
 * @param {Array} logs - Raw or stored telemetry records
 * @param {Object} vehicleProfile - Vehicle specifications
 * @param {Object} options - Calculation options { scope: 'full_era'|'all', unit: 'gal'|'l100'|'kml', fuelPriceCop: number }
 * @returns {Object} Complete telemetry model
 */
export function calculateTelemetryModel(logs = [], vehicleProfile = {}, options = {}) {
    const defaultEff = Number(vehicleProfile.defaultEfficiencyKmGal) || DEFAULT_BENCHMARK_EFF;
    const tankMaxGal = Number(vehicleProfile.tankCapacityGallons) || 
                       (vehicleProfile.tankCapacityLiters ? vehicleProfile.tankCapacityLiters * L_TO_GAL : DEFAULT_TANK_CAPACITY_GAL);
    const fuelPriceCop = Number(options.fuelPriceCop || vehicleProfile.fuelPriceCop) || 16000;
    const scope = options.scope || 'full_era';

    // Zero-length guard: Return clean empty model
    if (!Array.isArray(logs) || logs.length === 0) {
        return {
            processedData: [],
            fullEraCycles: [],
            fullEraAvgEff: defaultEff,
            dailySeries: [],
            activeTankState: null,
            scopedRecords: [],
            weekdayDNA: calculateWeekdayDNA([]),
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

    // Sort ascending by date, then by odometer reading
    const sorted = [...logs].sort((a, b) => {
        if (a.date !== b.date) return a.date > b.date ? 1 : -1;
        return (Number(a.odometer_reading) || 0) - (Number(b.odometer_reading) || 0);
    });

    // Extract refuel events for Universal Dual Algorithm (Full-to-Full and Compensated Partial)
    const refuelEvents = [];
    sorted.forEach((item, idx) => {
        const gals = Number(item.gallons_added) || 0;
        if (gals > 0) {
            refuelEvents.push({
                idx,
                date: item.date,
                odo: Number(item.odometer_reading) || 0,
                gals,
                fuel_level_percent: item.fuel_level_percent !== undefined ? Number(item.fuel_level_percent) : null,
                isFull: isFullTankLog(item)
            });
        }
    });

    const allClosedCycles = [];
    let sumKm = 0;
    let sumGal = 0;

    for (let i = 0; i < refuelEvents.length - 1; i++) {
        const s = refuelEvents[i];
        const e = refuelEvents[i + 1];
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
        if (!Number.isFinite(consumedGals) || consumedGals <= 0.01) {
            consumedGals = Math.max(0.1, s.gals || e.gals);
        }

        const eff = consumedGals > 0 ? (dist / consumedGals) : 0;

        sumKm += dist;
        sumGal += consumedGals;

        allClosedCycles.push({
            cycleIndex: i + 1,
            startDate: s.date,
            endDate: e.date,
            startOdo: s.odo,
            endOdo: e.odo,
            days,
            dist,
            gals: Number(consumedGals.toFixed(3)),
            eff: Number(eff.toFixed(2)),
            kmPerDay: Number.isFinite(kmPerDay) ? kmPerDay : 0,
            type: cycleType,
            isFull: cycleType === 'full'
        });
    }

    // Defensive fullEraAvgEff calculation with guard against division by zero
    const fullEraAvgEff = (sumGal > 0 && sumKm > 0 && Number.isFinite(sumKm / sumGal))
        ? Number((sumKm / sumGal).toFixed(2))
        : defaultEff;

    // Unified Stage 02: returns up to 7 latest closed cycles (Full or Compensated Partial)
    const fullEraCycles = allClosedCycles.slice(-7);

    // Process fluid level across all records
    const processedData = [];
    let curGal = tankMaxGal;

    for (let i = 0; i < sorted.length; i++) {
        const item = sorted[i];
        const isFull = isFullTankLog(item);
        const odo = Number(item.odometer_reading) || 0;
        const prev = i > 0 ? sorted[i - 1] : null;
        const prevOdo = prev ? (Number(prev.odometer_reading) || 0) : odo;
        const deltaKm = Math.max(0, odo - prevOdo);
        const galsAdded = Number(item.gallons_added) || 0;
        const burned = fullEraAvgEff > 0 ? (deltaKm / fullEraAvgEff) : 0;

        const vBefore = Math.max(0, curGal - burned);
        let vAfter = vBefore;
        if (galsAdded > 0) {
            vAfter = isFull ? tankMaxGal : Math.min(tankMaxGal, vBefore + galsAdded);
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

    // Build interpolated daily series
    const dailySeries = buildInterpolatedDailySeries(processedData);

    // Active tank state
    const activeTankState = getActiveTankState(processedData, fullEraAvgEff, vehicleProfile);

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

    const weekdayDNA = calculateWeekdayDNA(dailySeries);

    const totalDays = dailySeries.length > 0 ? dailySeries.length : 1;
    const avgDailyKm = dailySeries.length > 0
        ? dailySeries.reduce((acc, curr) => acc + curr.km, 0) / totalDays
        : 0;

    return {
        processedData,
        fullEraCycles,
        closedCycles: allClosedCycles,
        allCycles: allClosedCycles,
        fullEraAvgEff,
        dailySeries,
        activeTankState,
        scopedRecords,
        weekdayDNA,
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

