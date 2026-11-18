/**
 * OCTANE // KINETIC — Rides Engine & Marginal Cost Calculator
 * Pure Mathematical Model for Urban Rides & Cycle Accounting
 * 
 * Equations & Intelligence:
 * - Costo por KM: Telemetría real (precio / eficiencia).
 * - Kilometraje habitual base (KM_rutina): Descuento de ruta diaria (ej. 24 km/día).
 * - Lógica En ruta vs Libre:
 *     * Crédito de ruta diaria = 0.5 * KM_rutina (ej. 12 km).
 *     * En carreras "En ruta", los km consumidos hasta ese crédito tienen costo marginal de gasolina $0.
 *     * Los km que excedan ese crédito corresponden a desvío y SÍ suman a KM de trabajo con costo de combustible.
 * - Estimación de Recogidas:
 *     * Cruzando odómetro del día contra km declarados:
 *       KM Trabajo Real = max(0, DeltaOdo - KM_rutina)
 *       KM Recogida Estimados = max(0, KM Trabajo Real - KM Efectivos Declarados)
 *     * Si no hay odómetro del día, usa factor histórico promedio de recogida.
 * - Desgaste Obligatorio en TODAS las carreras:
 *     * Todas las carreras (Libre, En ruta y recogidas) generan desgaste.
 *     * Reserva sugerida por desgaste: 10% del ingreso bruto.
 * - Agnóstico de plataformas: Cero plataformas quemadas en código o UI.
 * - Silencio Verbal Absoluto: Prohibidos párrafos/p-tags, únicamente micro-labels y macro-números.
 */

export const DEFAULT_ROUTINE_DAILY_KM = 24;
export const DEFAULT_FUEL_PRICE_COP = 16000;
export const DEFAULT_EFFICIENCY_KM_GAL = 33.71; // Benchmark Kia Picanto 1.0L urbano
export const DEFAULT_TANK_CAPACITY_GAL = 9.246; // ~35 Litros
export const DEFAULT_WEAR_RESERVE_PERCENT = 10; // 10% del ingreso bruto
export const INDRIVE_ESTIMATED_COMMISSION_COP = 1375;
export const DIDI_PASS_COST_1D = 4000;
export const DIDI_PASS_COST_3D = 10500;

// Constantes físicas realistas para recogida (deadhead) en transporte urbano
export const MIN_PICKUP_RATIO = 0.20;
export const DEFAULT_PICKUP_RATIO = 0.28;
export const MAX_PICKUP_RATIO = 0.40;

/**
 * Calculates marginal fuel cost per kilometer based on real telemetry or vehicle profile.
 * Formula: fuelPriceCop / efficiencyKmGal
 * 
 * @param {Object} options
 * @param {number} [options.fuelPriceCop]
 * @param {number} [options.efficiencyKmGal]
 * @param {Object} [options.telemetryModel]
 * @param {Object} [options.vehicleProfile]
 * @param {boolean} [options.exact=false]
 * @returns {number} Cost per KM in COP
 */
export function calculateCostPerKm(options = {}) {
    const {
        fuelPriceCop,
        efficiencyKmGal,
        telemetryModel,
        vehicleProfile,
        exact = false
    } = options;

    // Resolve efficiency
    let eff = Number(efficiencyKmGal);
    if (!eff || eff <= 0 || !Number.isFinite(eff)) {
        if (telemetryModel && Number(telemetryModel.fullEraAvgEff) > 0) {
            eff = Number(telemetryModel.fullEraAvgEff);
        } else if (vehicleProfile && Number(vehicleProfile.defaultEfficiencyKmGal) > 0) {
            eff = Number(vehicleProfile.defaultEfficiencyKmGal);
        } else {
            eff = DEFAULT_EFFICIENCY_KM_GAL;
        }
    }

    // Resolve fuel price
    let price = Number(fuelPriceCop);
    if (!price || price <= 0 || !Number.isFinite(price)) {
        if (telemetryModel && Number(telemetryModel.fuelPriceCop) > 0) {
            price = Number(telemetryModel.fuelPriceCop);
        } else if (vehicleProfile && Number(vehicleProfile.fuelPriceCop) > 0) {
            price = Number(vehicleProfile.fuelPriceCop);
        } else {
            price = DEFAULT_FUEL_PRICE_COP;
        }
    }

    const cost = eff > 0 ? (price / eff) : 0;
    return exact ? Number(cost.toFixed(2)) : Math.round(cost);
}

/**
 * Learns habitual non-work daily routine kilometers per weekday (Mon=0..Sun=6) from GPS days
 * where no ride sessions occurred. Falls back to overall non-ride average (>= 3 days) or
 * `fallbackRoutineKm`.
 *
 * @param {Object|null} gpsDaysMap
 * @param {Array} [rideSessions=[]]
 * @param {number} [fallbackRoutineKm=DEFAULT_ROUTINE_DAILY_KM]
 * @returns {{ byWeekday: Array<number>, avgRoutineKm: number, learnedDaysCount: number, isGpsLearned: boolean }}
 */
export function learnRoutineDailyKmByWeekday(gpsDaysMap = null, rideSessions = [], fallbackRoutineKm = DEFAULT_ROUTINE_DAILY_KM) {
    const fallback = Number(fallbackRoutineKm) > 0 ? Number(fallbackRoutineKm) : DEFAULT_ROUTINE_DAILY_KM;
    const defaultResult = {
        byWeekday: [fallback, fallback, fallback, fallback, fallback, fallback, fallback],
        avgRoutineKm: fallback,
        learnedDaysCount: 0,
        isGpsLearned: false
    };

    if (!gpsDaysMap || typeof gpsDaysMap !== 'object') {
        return defaultResult;
    }

    const rideDates = new Set();
    if (Array.isArray(rideSessions)) {
        for (const s of rideSessions) {
            if (!s || !s.date || s.type === 'expense' || s.type === 'pass') continue;
            rideDates.add(String(s.date).slice(0, 10));
        }
    }

    const buckets = [[], [], [], [], [], [], []];
    const allNonRideKm = [];

    for (const dateKey of Object.keys(gpsDaysMap)) {
        const cleanDate = String(dateKey).slice(0, 10);
        if (rideDates.has(cleanDate)) continue;
        const rec = gpsDaysMap[dateKey];
        if (!rec) continue;
        const km = Number(rec.km ?? rec.miles) || 0;
        if (km <= 0) continue;

        const dt = new Date(`${cleanDate}T12:00:00`);
        if (isNaN(dt.getTime())) continue;
        const w = dt.getDay();
        const idx = w === 0 ? 6 : w - 1; // 0=LUN..6=DOM
        buckets[idx].push(km);
        allNonRideKm.push(km);
    }

    if (allNonRideKm.length < 3) {
        return {
            ...defaultResult,
            learnedDaysCount: allNonRideKm.length
        };
    }

    const overallAvg = Number((allNonRideKm.reduce((a, b) => a + b, 0) / allNonRideKm.length).toFixed(1));
    const byWeekday = buckets.map((arr) => {
        if (arr.length >= 3) {
            return Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1));
        }
        return overallAvg;
    });

    return {
        byWeekday,
        avgRoutineKm: overallAvg,
        learnedDaysCount: allNonRideKm.length,
        isGpsLearned: true
    };
}

/**
 * Resolves the odometer delta for a specific calendar date from explicit fallback,
 * GPS daily telemetry (`gpsDaysMap`), or manual telemetry logs.
 * Returns closing status, delta, and source metadata.
 * 
 * @param {string} date - 'YYYY-MM-DD'
 * @param {Array} [telemetryLogs=[]]
 * @param {number|null} [fallbackDelta=null]
 * @param {Object|null} [gpsDaysMap=null]
 * @returns {{ deltaOdo: number, hasClosing: boolean, isPendingOdometer: boolean, source: string, startOdo: number|null, endOdo: number|null, daysElapsed: number, isMultiDaySpan: boolean, prevDate: string|null }}
 */
export function resolveDayOdometerDelta(date, telemetryLogs = [], fallbackDelta = null, gpsDaysMap = null) {
    if (fallbackDelta !== null && fallbackDelta !== undefined && !isNaN(Number(fallbackDelta))) {
        const d = Math.max(0, Number(fallbackDelta));
        return {
            deltaOdo: d,
            hasClosing: true,
            isPendingOdometer: false,
            source: 'manual',
            startOdo: null,
            endOdo: null,
            daysElapsed: 1,
            isMultiDaySpan: false,
            prevDate: null
        };
    }

    const targetDate = date ? String(date).slice(0, 10) : '';
    if (targetDate && gpsDaysMap && typeof gpsDaysMap === 'object') {
        const gpsDay = gpsDaysMap[targetDate];
        const gpsKm = Number(gpsDay?.km ?? gpsDay?.miles) || 0;
        if (gpsKm > 0) {
            return {
                deltaOdo: Number(gpsKm.toFixed(1)),
                hasClosing: true,
                isPendingOdometer: false,
                source: 'gps',
                startOdo: null,
                endOdo: null,
                daysElapsed: 1,
                isMultiDaySpan: false,
                prevDate: targetDate,
                runTimeSec: Number(gpsDay.runTimeSec) || 0,
                idleAccOnSec: Number(gpsDay.idleAccOnSec) || 0,
                avgSpeedKmh: Number(gpsDay.avgSpeedKmh) || 0
            };
        }
    }

    if (!targetDate || !Array.isArray(telemetryLogs) || telemetryLogs.length === 0) {
        return {
            deltaOdo: 0,
            hasClosing: false,
            isPendingOdometer: true,
            source: 'none',
            startOdo: null,
            endOdo: null,
            daysElapsed: 1,
            isMultiDaySpan: false,
            prevDate: null
        };
    }

    const sorted = [...telemetryLogs]
        .filter(l => l && l.odometer_reading !== undefined && l.date)
        .sort((a, b) => {
            const da = String(a.date).slice(0, 10);
            const db = String(b.date).slice(0, 10);
            if (da !== db) return da.localeCompare(db);
            return (Number(a.odometer_reading) || 0) - (Number(b.odometer_reading) || 0);
        });

    const onDate = sorted.filter(l => String(l.date).slice(0, 10) === targetDate);

    // If multiple readings exist for the date, use first and last
    if (onDate.length >= 2) {
        const startOdo = Number(onDate[0].odometer_reading) || 0;
        const endOdo = Number(onDate[onDate.length - 1].odometer_reading) || 0;
        return {
            deltaOdo: Math.max(0, endOdo - startOdo),
            hasClosing: true,
            isPendingOdometer: false,
            source: 'odometer',
            startOdo,
            endOdo,
            daysElapsed: 1,
            isMultiDaySpan: false,
            prevDate: targetDate
        };
    }

    // If only one reading exists on that date, check if a previous reading exists
    if (onDate.length === 1) {
        const targetReading = Number(onDate[0].odometer_reading) || 0;
        const prevLogs = sorted.filter(l => String(l.date).slice(0, 10) < targetDate);
        if (prevLogs.length > 0) {
            const prevLog = prevLogs[prevLogs.length - 1];
            const prevReading = Number(prevLog.odometer_reading) || 0;
            const prevDateStr = String(prevLog.date).slice(0, 10);

            // Compute calendar days elapsed between previous log and target date
            const msTarget = new Date(targetDate + 'T12:00:00').getTime();
            const msPrev = new Date(prevDateStr + 'T12:00:00').getTime();
            const daysElapsed = Math.max(1, Math.round((msTarget - msPrev) / 86400000));
            const isMultiDaySpan = daysElapsed > 1;

            return {
                deltaOdo: Math.max(0, targetReading - prevReading),
                hasClosing: true,
                isPendingOdometer: false,
                source: 'odometer',
                startOdo: prevReading,
                endOdo: targetReading,
                daysElapsed,
                isMultiDaySpan,
                prevDate: prevDateStr
            };
        }
        return {
            deltaOdo: 0,
            hasClosing: false,
            isPendingOdometer: true,
            source: 'none',
            startOdo: targetReading,
            endOdo: null,
            daysElapsed: 1,
            isMultiDaySpan: false,
            prevDate: null
        };
    }

    return {
        deltaOdo: 0,
        hasClosing: false,
        isPendingOdometer: true,
        source: 'none',
        startOdo: null,
        endOdo: null,
        daysElapsed: 1,
        isMultiDaySpan: false,
        prevDate: null
    };
}

function formatLocalYmd(d) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function parseLocalDate(refDate) {
    if (refDate instanceof Date) {
        return new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate(), 12, 0, 0);
    }
    if (typeof refDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(refDate)) {
        const [y, m, d] = refDate.slice(0, 10).split('-').map(Number);
        return new Date(y, m - 1, d, 12, 0, 0);
    }
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0);
}

const WEEKDAYS_SHORT_ES = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
const MONTHS_SHORT_ES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

function formatHumanDay(ymdStr) {
    if (!ymdStr) return '';
    const d = parseLocalDate(ymdStr);
    const w = WEEKDAYS_SHORT_ES[d.getDay()];
    const day = String(d.getDate()).padStart(2, '0');
    const m = MONTHS_SHORT_ES[d.getMonth()];
    return `${w} ${day} ${m}`;
}

function formatHumanShort(ymdStr) {
    if (!ymdStr) return '';
    const d = parseLocalDate(ymdStr);
    const day = String(d.getDate()).padStart(2, '0');
    const m = MONTHS_SHORT_ES[d.getMonth()];
    return `${day} ${m}`;
}

/**
 * Computes calendar-anchored start and end date strings for a given cycle type and offset.
 * Cycle Options: 'day' | 'week' | '15d' | 'month' | 'tank_cycle'
 * Offset <= 0 (0 = current period, -1 = previous period, etc.)
 * 
 * @param {string} cycleType
 * @param {Date|string} [refDate]
 * @param {Array} [telemetryLogs=[]]
 * @param {number} [offset=0]
 * @returns {{ startDate: string, endDate: string, label: string, displayRange: string, offset: number, canGoPrev: boolean, canGoNext: boolean, isCurrentPeriod: boolean }}
 */
export function getCycleDateRange(cycleType = 'month', refDate = new Date(), telemetryLogs = [], offset = 0) {
    const safeOffset = Math.min(0, Math.trunc(Number(offset) || 0));
    const baseDate = parseLocalDate(refDate);
    const todayStr = formatLocalYmd(baseDate);

    if (cycleType === 'day') {
        const target = new Date(baseDate);
        target.setDate(baseDate.getDate() + safeOffset);
        const targetStr = formatLocalYmd(target);
        const humanDay = formatHumanDay(targetStr);
        return {
            startDate: targetStr,
            endDate: targetStr,
            label: safeOffset === 0 ? 'DIARIA · HOY' : 'DIARIA',
            displayRange: safeOffset === 0 ? `${humanDay} · HOY` : humanDay,
            offset: safeOffset,
            canGoPrev: true,
            canGoNext: safeOffset < 0,
            isCurrentPeriod: safeOffset === 0
        };
    }

    if (cycleType === 'week') {
        const dayOfWeek = baseDate.getDay(); // 0 is Sunday, 1 is Monday...
        const diffToMonday = (dayOfWeek === 0 ? -6 : 1) - dayOfWeek;
        const start = new Date(baseDate);
        start.setDate(baseDate.getDate() + diffToMonday + (safeOffset * 7));
        const end = new Date(start);
        end.setDate(start.getDate() + 6); // Always Monday to Sunday
        const startStr = formatLocalYmd(start);
        const endStr = formatLocalYmd(end);
        return {
            startDate: startStr,
            endDate: endStr,
            label: 'SEMANAL',
            displayRange: `${formatHumanDay(startStr)} — ${formatHumanDay(endStr)}`,
            offset: safeOffset,
            canGoPrev: true,
            canGoNext: safeOffset < 0,
            isCurrentPeriod: safeOffset === 0
        };
    }

    if (cycleType === '15d') {
        const curHalfIdx = (baseDate.getFullYear() * 24) + (baseDate.getMonth() * 2) + (baseDate.getDate() > 15 ? 1 : 0);
        const targetHalfIdx = curHalfIdx + safeOffset;
        const targetYear = Math.floor(targetHalfIdx / 24);
        const rem = ((targetHalfIdx % 24) + 24) % 24;
        const targetMonth = Math.floor(rem / 2); // 0..11
        const isSecondHalf = (rem % 2) === 1;
        const monthStr = String(targetMonth + 1).padStart(2, '0');
        const monthLabel = MONTHS_SHORT_ES[targetMonth];

        if (!isSecondHalf) {
            const startStr = `${targetYear}-${monthStr}-01`;
            const endStr = `${targetYear}-${monthStr}-15`;
            return {
                startDate: startStr,
                endDate: endStr,
                label: 'QUINCENAL (1–15)',
                displayRange: `01 ${monthLabel} — 15 ${monthLabel} ${targetYear}`,
                offset: safeOffset,
                canGoPrev: true,
                canGoNext: safeOffset < 0,
                isCurrentPeriod: safeOffset === 0
            };
        } else {
            const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
            const startStr = `${targetYear}-${monthStr}-16`;
            const endStr = `${targetYear}-${monthStr}-${String(lastDay).padStart(2, '0')}`;
            return {
                startDate: startStr,
                endDate: endStr,
                label: `QUINCENAL (16–${lastDay})`,
                displayRange: `16 ${monthLabel} — ${lastDay} ${monthLabel} ${targetYear}`,
                offset: safeOffset,
                canGoPrev: true,
                canGoNext: safeOffset < 0,
                isCurrentPeriod: safeOffset === 0
            };
        }
    }

    if (cycleType === 'tank_cycle') {
        const windows = [];
        if (Array.isArray(telemetryLogs) && telemetryLogs.length > 0) {
            const sortedLogs = [...telemetryLogs]
                .filter(l => l && l.date)
                .sort((a, b) => {
                    const da = String(a.date).slice(0, 10);
                    const db = String(b.date).slice(0, 10);
                    if (da !== db) return da.localeCompare(db);
                    return (Number(a.odometer_reading) || 0) - (Number(b.odometer_reading) || 0);
                });

            const refuels = sortedLogs.filter(l =>
                Number(l.refuels_count) > 0 ||
                Number(l.gallons_added) > 0 ||
                Boolean(l.is_full_tank) ||
                Boolean(l.isFullTank) ||
                Number(l.fuel_level_percent) >= 99.5
            );

            for (let i = 0; i < refuels.length - 1; i++) {
                const sDate = String(refuels[i].date).slice(0, 10);
                const eDate = String(refuels[i + 1].date).slice(0, 10);
                windows.push({
                    startDate: sDate,
                    endDate: eDate,
                    isActive: false
                });
            }

            if (refuels.length > 0) {
                const lastRefuelDate = String(refuels[refuels.length - 1].date).slice(0, 10);
                windows.push({
                    startDate: lastRefuelDate,
                    endDate: todayStr >= lastRefuelDate ? todayStr : lastRefuelDate,
                    isActive: true
                });
            }
        }

        if (windows.length > 0) {
            const targetIdx = Math.max(0, windows.length - 1 + safeOffset);
            const actualOffset = targetIdx - (windows.length - 1);
            const win = windows[targetIdx];
            const disp = win.isActive
                ? `DESDE ${formatHumanShort(win.startDate)} · ACTIVO`
                : `${formatHumanShort(win.startDate)} — ${formatHumanShort(win.endDate)}`;
            return {
                startDate: win.startDate,
                endDate: win.endDate,
                label: win.isActive ? 'CICLO TANQUE ACTUAL' : 'CICLO TANQUE CERRADO',
                displayRange: disp,
                offset: actualOffset,
                canGoPrev: targetIdx > 0,
                canGoNext: targetIdx < windows.length - 1,
                isCurrentPeriod: targetIdx === windows.length - 1
            };
        }
    }

    // Default: 'month' (Calendar month: 1st to last day of month)
    const targetMonthDate = new Date(baseDate.getFullYear(), baseDate.getMonth() + safeOffset, 1, 12, 0, 0);
    const year = targetMonthDate.getFullYear();
    const monthIdx = targetMonthDate.getMonth();
    const month = String(monthIdx + 1).padStart(2, '0');
    const lastDay = new Date(year, monthIdx + 1, 0).getDate();
    const monthLabel = MONTHS_SHORT_ES[monthIdx];
    const startStr = `${year}-${month}-01`;
    const endStr = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;

    return {
        startDate: startStr,
        endDate: endStr,
        label: 'MENSUAL',
        displayRange: `01 ${monthLabel} — ${lastDay} ${monthLabel} ${year}`,
        offset: safeOffset,
        canGoPrev: true,
        canGoNext: safeOffset < 0,
        isCurrentPeriod: safeOffset === 0
    };
}

/**
 * Calculates complete Cycle Accounting Summary for Rides.
 * Implements all mathematical intelligence:
 * - Fuel marginal costs
 * - Routine KM commute credit (0.5 * KM_rutina for 'En ruta')
 * - Pickup estimation (cross-odometer or learned factor)
 * - Wear reserve (10% of gross revenue)
 * - Fuel coverage percentage against tank or cycle fuel
 * 
 * @param {Object} params
 * @param {Array} [params.sessions=[]] - Stored ride sessions
 * @param {Array} [params.passes=[]] - Stored platform passes / expenses
 * @param {Object} [params.profile={}] - Vehicle profile
 * @param {Array} [params.telemetryLogs=[]] - Raw telemetry logs
 * @param {Object|null} [params.telemetryModel=null] - Computed telemetry model
 * @param {string} [params.cycleType='month'] - 'day' | 'week' | '15d' | 'month' | 'tank_cycle'
 * @param {number} [params.cycleOffset=0] - Relative period offset (0 = current, -1 = previous, etc.)
 * @param {string|null} [params.startDate=null]
 * @param {string|null} [params.endDate=null]
 * @returns {Object} Complete cycle metrics
 */
export function calculateRidesCycleSummary(params = {}) {
    const {
        sessions = [],
        passes = [],
        profile = {},
        telemetryLogs = [],
        telemetryModel = null,
        cycleType = 'month',
        cycleOffset = 0
    } = params;

    const rawSessions = Array.isArray(sessions) ? sessions : [];
    const rawPasses = Array.isArray(passes) ? passes : [];
    const rawLogs = Array.isArray(telemetryLogs) ? telemetryLogs : [];

    // Resolve date window
    const dateRange = (params.startDate && params.endDate)
        ? {
            startDate: params.startDate,
            endDate: params.endDate,
            label: 'PERSONALIZADO',
            displayRange: `${formatHumanShort(params.startDate)} — ${formatHumanShort(params.endDate)}`,
            offset: 0,
            canGoPrev: true,
            canGoNext: false,
            isCurrentPeriod: true
        }
        : getCycleDateRange(cycleType, new Date(), rawLogs, cycleOffset);

    const { startDate, endDate, label: cycleLabel, displayRange, offset: resolvedOffset, canGoPrev, canGoNext, isCurrentPeriod } = dateRange;

    // Vehicle profile parameters
    const fuelPriceCop = Number(profile.fuelPriceCop) || (telemetryModel && Number(telemetryModel.fuelPriceCop)) || DEFAULT_FUEL_PRICE_COP;
    const routineDailyKm = Number(profile.routineDailyKm) || DEFAULT_ROUTINE_DAILY_KM;
    const routeCreditKm = routineDailyKm; // Crédito completo de ruta habitual diaria (ej. 24 km)
    const tankCapacityGal = Number(profile.tankCapacityGallons) ||
        (profile.tankCapacityLiters ? Number(profile.tankCapacityLiters) / 3.78541 : DEFAULT_TANK_CAPACITY_GAL);
    const costPerKmCop = calculateCostPerKm({ fuelPriceCop, telemetryModel, vehicleProfile: profile });

    // 1. Filter sessions & passes within cycle
    const cycleSessions = rawSessions.filter(s => {
        if (!s || !s.date) return false;
        const d = String(s.date).slice(0, 10);
        return d >= startDate && d <= endDate;
    });

    const cyclePasses = rawPasses.filter(p => {
        const d = String(p.date || p.startDate || '').slice(0, 10);
        if (!d) return false;
        return d >= startDate && d <= endDate;
    });

    // 2. Group sessions by calendar day to apply route credit and odometer cross-checks
    const sessionsByDate = {};
    cycleSessions.forEach(s => {
        const d = String(s.date).slice(0, 10);
        if (!sessionsByDate[d]) sessionsByDate[d] = [];
        sessionsByDate[d].push(s);
    });

    const gpsDaysMap = (profile?.gpsCache?.days && typeof profile.gpsCache.days === 'object')
        ? profile.gpsCache.days
        : null;
    const routineProfile = learnRoutineDailyKmByWeekday(gpsDaysMap, rawSessions, routineDailyKm);

    const getDayRoutineKm = (dateStr) => {
        if (!routineProfile.isGpsLearned) return routineDailyKm;
        const dt = new Date(`${String(dateStr).slice(0, 10)}T12:00:00`);
        if (isNaN(dt.getTime())) return routineDailyKm;
        const w = dt.getDay();
        const idx = w === 0 ? 6 : w - 1;
        return routineProfile.byWeekday[idx] ?? routineDailyKm;
    };

    // Compute historical pickup factor from all sessions with single-day closing odometer readings
    let histOdoEffectiveKm = 0;
    let histOdoPickupKm = 0;

    rawSessions.forEach(s => {
        const d = String(s.date).slice(0, 10);
        const odo = resolveDayOdometerDelta(d, rawLogs, null, gpsDaysMap);
        if (odo.hasClosing && odo.deltaOdo > 0 && !odo.isMultiDaySpan) {
            const kmWorkReal = Math.max(0, odo.deltaOdo - getDayRoutineKm(d));
            const declared = Number(s.workKm || s.distanceKm || s.tripKmTotal || 0);
            if (declared > 0) {
                histOdoEffectiveKm += declared;
                const rawSamplePickup = Math.max(0, kmWorkReal - declared);
                histOdoPickupKm += Math.min(rawSamplePickup, declared * MAX_PICKUP_RATIO);
            }
        }
    });

    const rawLearned = histOdoEffectiveKm > 0
        ? (histOdoPickupKm / histOdoEffectiveKm)
        : DEFAULT_PICKUP_RATIO;
    const learnedPickupFactor = Math.min(MAX_PICKUP_RATIO, Math.max(MIN_PICKUP_RATIO, rawLearned));

    // Day-by-day calculations
    let totalGrossRevenueCop = 0;
    let totalDeclaredKm = 0;
    let totalEnRouteKm = 0;
    let totalFreeKm = 0;
    let totalRouteCreditUsedKm = 0;
    let totalEffectiveWorkKm = 0;
    let totalPickupKm = 0;
    let totalExtraKm = 0;
    let totalFuelExpenseCop = 0;
    let totalIdleFuelCop = 0;
    let totalGpsWorkHours = 0;
    let gpsOdoDaysCount = 0;
    let odoManualDaysCount = 0;
    let totalRidesCount = 0;

    const dailyBreakdown = {};

    Object.keys(sessionsByDate).sort().forEach(dateStr => {
        const dayRides = sessionsByDate[dateStr];
        let dayGross = 0;
        let dayEnRouteKm = 0;
        let dayFreeKm = 0;
        let dayRidesCount = 0;

        dayRides.forEach(r => {
            // Can be individual ride or day summary session
            if (Array.isArray(r.rides) && r.rides.length > 0) {
                r.rides.forEach(sub => {
                    const fare = Number(sub.fareCop || sub.netValue || 0);
                    const km = Number(sub.distanceKm || sub.km || 0);
                    const isEnRoute = Boolean(sub.isEnRoute || sub.tripType === 'en_route');
                    dayGross += fare;
                    dayRidesCount += 1;
                    if (isEnRoute) {
                        dayEnRouteKm += km;
                    } else {
                        dayFreeKm += km;
                    }
                });
            } else {
                const fare = Number(r.grossEarnings || r.grossRevenueCop || r.grossIncomeCop || r.fareCop || 0);
                const km = Number(r.workKm || r.distanceKm || r.tripKmTotal || 0);
                const isEnRoute = Boolean(r.isEnRoute || r.tripType === 'en_route');
                dayGross += fare;
                dayRidesCount += (Number(r.totalRidesCount) || 1);
                if (isEnRoute) {
                    dayEnRouteKm += km;
                } else {
                    dayFreeKm += km;
                }
            }
        });

        const dayDeclaredKm = dayEnRouteKm + dayFreeKm;
        const dayRoutineKm = getDayRoutineKm(dateStr);

        // Apply route credit to en_route km (remplaza viaje habitual, hasta dayRoutineKm por jornada)
        const creditUsed = Math.min(dayEnRouteKm, dayRoutineKm);
        const enRouteDetourKm = Math.max(0, dayEnRouteKm - dayRoutineKm); // Desvío excedente que supera la rutina
        const dayEffectiveKm = dayFreeKm + enRouteDetourKm; // Km de carreras que requieren combustible

        // Tope Físico Realista de Recogida (Criterios 2 y 3):
        // - Carreras libres: tope máximo del 40% (realidad urbana ciudad).
        // - Carreras 'En ruta': matches sobre el corredor del viaje habitual (máximo 15% o 1.5 km).
        const enRoutePickupCap = dayEnRouteKm > 0 ? Math.min(1.5, Number((dayEnRouteKm * 0.15).toFixed(1))) : 0;
        const maxAllowedPickupKm = Number(((dayFreeKm * MAX_PICKUP_RATIO) + (enRouteDetourKm * 0.20) + enRoutePickupCap).toFixed(1));
        const defaultExpectedPickupKm = Number(((dayFreeKm * learnedPickupFactor) + (enRouteDetourKm * 0.15) + (enRoutePickupCap * 0.5)).toFixed(1));

        // Resolve day odometer reading (GPS daily telemetry takes priority over manual odometer logs)
        const odo = resolveDayOdometerDelta(dateStr, rawLogs, null, gpsDaysMap);
        let dayPickupKm = 0;
        let dayDeadheadSource = 'estimated';

        if (odo.hasClosing && odo.deltaOdo > 0) {
            // Criterio 1: Si pasaron múltiples días entre lecturas, deducir la rutina de todos los días transcurridos
            const elapsedDays = Math.max(1, odo.daysElapsed || 1);
            const multiDayRoutine = elapsedDays * dayRoutineKm;
            const candidateWorkKm = Math.max(0, odo.deltaOdo - multiDayRoutine);
            const rawPickup = Math.max(0, candidateWorkKm - dayEffectiveKm);

            // Criterio 2: Acotamiento estricto contra el tope físico de recogida
            // Cualquier exceso por encima de maxAllowedPickupKm es uso personal del conductor (fines de semana, diligencias)
            dayPickupKm = Math.min(rawPickup, maxAllowedPickupKm);
            dayDeadheadSource = odo.source === 'gps' ? 'gps' : 'odometer';
            if (odo.source === 'gps') gpsOdoDaysCount++;
            else odoManualDaysCount++;
        } else {
            dayPickupKm = defaultExpectedPickupKm;
        }

        const dayExtraKm = Number((dayEffectiveKm + dayPickupKm).toFixed(1));
        let dayIdleWorkFuelCop = 0;
        let dayGpsWorkHours = 0;
        if (odo.hasClosing && odo.deltaOdo > 0 && (odo.idleAccOnSec > 0 || odo.runTimeSec > 0)) {
            const workShare = Math.min(1, dayExtraKm / odo.deltaOdo);
            if (odo.idleAccOnSec > 0) {
                dayIdleWorkFuelCop = Math.round(((odo.idleAccOnSec / 3600) * 0.18) * workShare * fuelPriceCop);
            }
            dayGpsWorkHours = ((Number(odo.runTimeSec) || 0) + (Number(odo.idleAccOnSec) || 0)) * workShare / 3600;
        }
        const dayFuelCost = Math.round(dayExtraKm * costPerKmCop) + dayIdleWorkFuelCop;

        dailyBreakdown[dateStr] = {
            date: dateStr,
            grossCop: dayGross,
            declaredKm: dayDeclaredKm,
            enRouteKm: dayEnRouteKm,
            freeKm: dayFreeKm,
            creditUsedKm: creditUsed,
            detourKm: enRouteDetourKm,
            effectiveKm: dayEffectiveKm,
            pickupKm: dayPickupKm,
            extraKm: dayExtraKm,
            idleFuelCop: dayIdleWorkFuelCop,
            gpsWorkHours: Number(dayGpsWorkHours.toFixed(2)),
            deadheadSource: dayDeadheadSource,
            fuelCostCop: dayFuelCost,
            ridesCount: dayRidesCount,
            hasOdometer: odo.hasClosing
        };

        totalGrossRevenueCop += dayGross;
        totalDeclaredKm += dayDeclaredKm;
        totalEnRouteKm += dayEnRouteKm;
        totalFreeKm += dayFreeKm;
        totalRouteCreditUsedKm += creditUsed;
        totalEffectiveWorkKm += dayEffectiveKm;
        totalPickupKm += dayPickupKm;
        totalExtraKm += dayExtraKm;
        totalIdleFuelCop += dayIdleWorkFuelCop;
        totalGpsWorkHours += dayGpsWorkHours;
        totalFuelExpenseCop += dayFuelCost;
        totalRidesCount += dayRidesCount;
    });

    // 3. Sum expenses from passes and session commissions
    let totalExpensesCop = 0;
    cyclePasses.forEach(p => {
        totalExpensesCop += Number(p.amountCop || p.costCop || 0);
    });

    // Also include any appCommissions stored in legacy session objects
    cycleSessions.forEach(s => {
        if (s.type === 'expense') {
            const exp = Number(s.amountCop || s.costCop || s.expenseCop || s.appCommissions || 0);
            if (exp > 0) {
                totalExpensesCop += exp;
            }
        } else if (!s.type || s.type !== 'ride') {
            const comm = Number(s.appCommissions || s.appCommissionsCop || 0);
            if (comm > 0 && cyclePasses.length === 0) {
                totalExpensesCop += comm;
            }
        }
    });

    // 4. Net Free Profit (Bolsillo Libre)
    // Formula: Gross - Expenses - Fuel Extra
    const freeNetProfitCop = Math.round(totalGrossRevenueCop - totalExpensesCop - totalFuelExpenseCop);

    // 5. Wear Reserve (Desgaste obligatorio 10% del ingreso bruto)
    const wearReserveCop = Math.round(totalGrossRevenueCop * (DEFAULT_WEAR_RESERVE_PERCENT / 100));

    // 6. Fuel Coverage (Gasolina Cubierta)
    // Based on the fuel spent on the active day(s) (routine + extra work fuel), NOT a full tank.
    // Whenever earnings after expenses exceed the fuel spent on those days (i.e. driver makes money
    // on top of covering the gas spent), fuelCoveredPct is > 100%.
    const tankFuelCostCop = Math.round(tankCapacityGal * fuelPriceCop);
    const activeDaysCount = Math.max(1, Object.keys(sessionsByDate).length);
    const routineFuelCostCop = Math.round(activeDaysCount * routineDailyKm * costPerKmCop);
    const periodFuelCostCop = Math.max(1, routineFuelCostCop + totalFuelExpenseCop);
    const netBeforeFuelCop = Math.max(0, Math.round(totalGrossRevenueCop - totalExpensesCop));

    let fuelCoveredPct = 0;
    if (netBeforeFuelCop > 0 && periodFuelCostCop > 0) {
        fuelCoveredPct = Math.round((netBeforeFuelCop / periodFuelCostCop) * 100);
    }

    // Status text for fuel coverage
    const periodTag = cycleType === 'day' ? 'DEL DÍA' : 'GASTADA';
    let fuelCoveredStatus = '';
    if (fuelCoveredPct <= 0) {
        fuelCoveredStatus = `0% DE GAS ${periodTag} (${formatCompactCop(periodFuelCostCop)})`;
    } else {
        fuelCoveredStatus = `${fuelCoveredPct}% DE GAS ${periodTag} (${formatCompactCop(periodFuelCostCop)})`;
    }

    // 7. Unified movements list for this cycle
    const movements = [];

    // Add rides as movements
    cycleSessions.forEach(s => {
        const fare = Number(s.grossEarnings || s.grossRevenueCop || s.grossIncomeCop || s.fareCop || 0);
        const km = Number(s.distanceKm || s.workKm || s.tripKmTotal || 0);
        const isEnRoute = Boolean(s.isEnRoute || s.tripType === 'en_route');

        movements.push({
            id: s.id,
            store: 'ride_sessions',
            type: 'ride',
            date: String(s.date).slice(0, 10),
            amountCop: fare,
            km: km,
            isEnRoute: isEnRoute,
            platform: s.platform || 'Directo',
            notes: s.notes || '',
            createdAt: s.createdAt || s.updatedAt || s.date,
            raw: s
        });
    });

    // Add passes / expenses as movements
    cyclePasses.forEach(p => {
        const amount = Number(p.amountCop || p.costCop || 0);
        movements.push({
            id: p.id,
            store: 'platform_passes',
            type: 'expense',
            date: String(p.date || p.startDate || '').slice(0, 10),
            amountCop: amount,
            km: 0,
            isEnRoute: false,
            platform: p.platform || p.concept || 'General',
            concept: p.concept || p.platform || 'Comisión / Tarifa',
            notes: p.notes || '',
            createdAt: p.createdAt || p.updatedAt || p.date || p.startDate,
            raw: p
        });
    });

    // Sort movements chronologically descending (newest first)
    movements.sort((a, b) => {
        const da = String(a.date).slice(0, 10);
        const db = String(b.date).slice(0, 10);
        if (da !== db) return db.localeCompare(da);
        return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });

    const netProfitPerHourCop = totalGpsWorkHours >= 0.25
        ? Math.round(freeNetProfitCop / totalGpsWorkHours)
        : null;
    const deadheadSource = gpsOdoDaysCount > 0
        ? 'gps'
        : (odoManualDaysCount > 0 ? 'odometer' : 'estimated');

    return {
        cycleType,
        cycleLabel,
        displayRange,
        cycleOffset: resolvedOffset,
        canGoPrev,
        canGoNext,
        isCurrentPeriod,
        startDate,
        endDate,
        costPerKmCop,
        routineDailyKm,
        routeCreditKm,
        // 4 Clean Card Metrics:
        // 1. Ganancia Neta Libre
        freeNetProfitCop,
        grossRevenueCop: totalGrossRevenueCop,
        grossIncomeCop: totalGrossRevenueCop, // alias
        totalExpensesCop,
        appCommissionsCop: totalExpensesCop, // alias
        fuelExpenseCop: totalFuelExpenseCop,
        fuelCostCop: totalFuelExpenseCop, // alias
        // 2. Gasolina Cubierta
        fuelCoveredPct,
        fuelCoveredStatus,
        tankFuelCostCop,
        tankCapacityGal,
        // 3. Kilómetros Extra Totales
        totalDeclaredKm: Number(totalDeclaredKm.toFixed(1)),
        totalEnRouteKm: Number(totalEnRouteKm.toFixed(1)),
        totalFreeKm: Number(totalFreeKm.toFixed(1)),
        totalRouteCreditUsedKm: Number(totalRouteCreditUsedKm.toFixed(1)),
        totalPickupKm: Number(totalPickupKm.toFixed(1)),
        totalExtraKm: Number(totalExtraKm.toFixed(1)),
        tripKmTotal: Number(totalDeclaredKm.toFixed(1)), // alias
        workKmTotal: Number(totalExtraKm.toFixed(1)), // alias
        deadheadKmTotal: Number(totalPickupKm.toFixed(1)), // alias
        // 4. Fondo de Desgaste Sugerido
        wearReserveCop,
        wearReservePct: DEFAULT_WEAR_RESERVE_PERCENT,
        // GPS Unified Telemetry & Profitability
        netProfitPerHourCop,
        totalGpsWorkHours: Number(totalGpsWorkHours.toFixed(2)),
        totalIdleFuelCop,
        routineProfile,
        gpsOdoDaysCount,
        deadheadSource,
        // Activity & Movements
        ridesCount: totalRidesCount,
        totalRidesCount,
        expensesCount: cyclePasses.length,
        sessionCount: cycleSessions.length,
        movements,
        dailyBreakdown
    };
}

/**
 * Deadhead distance pure calculator.
 * @param {number} odometerDeltaKm
 * @param {number} tripKmTotal
 * @param {number} routineDailyKm
 * @returns {number}
 */
export function calculateDeadheadKm(odometerDeltaKm, tripKmTotal, routineDailyKm = DEFAULT_ROUTINE_DAILY_KM) {
    const kmWorkReal = Math.max(0, Number(odometerDeltaKm || 0) - (Number(routineDailyKm) || 0));
    return Math.max(0, Number((kmWorkReal - Number(tripKmTotal || 0)).toFixed(1)));
}

/**
 * Single session or day summary metrics calculator.
 * @param {Object} session
 * @returns {Object}
 */
export function calculateSessionMetrics(session = {}) {
    const rawDelta = session.odometerDeltaKm !== undefined ? session.odometerDeltaKm : session.deltaOdo;
    const isPending = rawDelta === null || rawDelta === undefined || rawDelta === '' || isNaN(Number(rawDelta));
    const delta = isPending ? null : Number(rawDelta);
    const tripKm = Number(session.tripKmTotal || session.workKm || session.distanceKm || 0);
    const routine = session.subtractRoutine !== false ? Number(session.routineDailyKm !== undefined ? session.routineDailyKm : DEFAULT_ROUTINE_DAILY_KM) : 0;
    const kmWorkReal = isPending ? tripKm : Math.max(0, delta - routine);
    const kmDeadhead = isPending ? 0 : Math.max(0, Number((kmWorkReal - tripKm).toFixed(1)));
    const deadheadPct = kmWorkReal > 0 ? Number(((kmDeadhead / kmWorkReal) * 100).toFixed(1)) : 0;
    const deadheadRatio = tripKm > 0 ? Number((kmWorkReal / tripKm).toFixed(2)) : 1;
    const costPerKm = Number(session.costPerKmCop || session.costPerKm) || calculateCostPerKm({
        fuelPriceCop: session.fuelPriceCop,
        efficiencyKmGal: session.efficiencyKmGal
    });
    const fuelCostCop = Math.round(kmWorkReal * costPerKm);
    const gross = Number(session.grossIncomeCop !== undefined ? session.grossIncomeCop : (session.grossEarnings || session.grossRevenueCop || 0));
    const comm = Number(session.appCommissionsCop !== undefined ? session.appCommissionsCop : (session.appCommissions || 0));
    const freeNetProfitCop = Math.round(gross - comm - fuelCostCop);

    return {
        grossEarnings: gross,
        grossIncomeCop: gross,
        appCommissionsCop: comm,
        workKm: tripKm,
        tripKmTotal: tripKm,
        kmWorkReal: Number(kmWorkReal.toFixed(1)),
        kmDeadhead: Number(kmDeadhead.toFixed(1)),
        deadheadPct,
        deadheadRatio,
        fuelCostCop,
        freeNetProfitCop,
        isPendingOdometer: isPending,
        isEnRoute: Boolean(session.isEnRoute || session.tripType === 'en_route')
    };
}

export const calculateDaySummarySession = calculateSessionMetrics;

/**
 * Calculates a ride-by-ride daily session with active pass integration.
 * @param {Object} params
 * @returns {Object}
 */
export function calculateRideByRideSession(params = {}) {
    const { rides = [], activePasses = [], deltaOdo = null, costPerKmCop = null, subtractRoutine = true, routineDailyKm = DEFAULT_ROUTINE_DAILY_KM } = params;
    const tripKmTotal = Number(rides.reduce((acc, r) => acc + (Number(r.distanceKm) || 0), 0).toFixed(1));
    const grossIncomeCop = rides.reduce((acc, r) => acc + (Number(r.fareCop) || 0), 0);
    
    // Check if didi pass is active on date
    const didiPass = getActiveDiDiPass(activePasses, params.date);
    let appCommissionsCop = 0;
    rides.forEach(r => {
        if (r.indriveDebit) {
            appCommissionsCop += Number(r.indriveDebit);
        } else if (r.app === 'didi') {
            if (!didiPass.active && r.commissionCop) {
                appCommissionsCop += Number(r.commissionCop);
            }
        } else if (r.commissionCop) {
            appCommissionsCop += Number(r.commissionCop);
        }
    });

    return calculateSessionMetrics({
        ...params,
        tripKmTotal,
        grossIncomeCop,
        appCommissionsCop,
        odometerDeltaKm: deltaOdo,
        subtractRoutine,
        routineDailyKm,
        costPerKmCop
    });
}

/**
 * Checks for an active DiDi pass on a given date.
 * @param {Array} passes
 * @param {string} targetDate
 * @returns {Object}
 */
export function getActiveDiDiPass(passes = [], targetDate = '') {
    const rawPasses = Array.isArray(passes) ? passes : [];
    const dateStr = String(targetDate || '').slice(0, 10);
    const pass = rawPasses.find(p => {
        const plat = String(p.platform || p.concept || '').toLowerCase();
        if (!plat.includes('didi')) return false;
        const start = String(p.startDate || p.date || '').slice(0, 10);
        const end = String(p.endDate || '').slice(0, 10);
        if (start && end) {
            return dateStr >= start && dateStr <= end;
        }
        return false;
    });

    if (!pass) {
        return {
            active: false,
            currentDay: 0,
            durationDays: 0,
            label: 'SIN PASE ACTIVO'
        };
    }

    const startMs = new Date(pass.startDate + 'T12:00:00').getTime();
    const curMs = new Date(dateStr + 'T12:00:00').getTime();
    const diffDays = Math.max(0, Math.floor((curMs - startMs) / 86400000));
    const currentDay = Math.min(pass.durationDays, diffDays + 1);

    return {
        active: true,
        pass,
        currentDay,
        durationDays: pass.durationDays,
        label: `PASE ${pass.durationDays}D · DÍA ${currentDay}/${pass.durationDays} · 0% COMISIÓN`
    };
}

/**
 * Calculates inDrive prepaid wallet balance and estimated trips remaining.
 * @param {Array} passes
 * @param {Array} rideSessions
 * @returns {Object}
 */
export function calculateInDriveBalance(passes = [], rideSessions = []) {
    const rawPasses = Array.isArray(passes) ? passes : [];
    const rawSessions = Array.isArray(rideSessions) ? rideSessions : [];

    let totalRecharge = 0;
    rawPasses.forEach(p => {
        const plat = String(p.platform || p.concept || '').toLowerCase();
        if (plat.includes('indrive')) {
            totalRecharge += Number(p.amountCop || p.costCop || 0);
        }
    });

    let totalDebits = 0;
    rawSessions.forEach(s => {
        if (Array.isArray(s.rides)) {
            s.rides.forEach(r => {
                const plat = String(r.app || r.platform || '').toLowerCase();
                if (plat.includes('indrive')) {
                    totalDebits += Number(r.indriveDebit !== undefined ? r.indriveDebit : INDRIVE_ESTIMATED_COMMISSION_COP);
                }
            });
        }
    });

    const balanceCop = Math.max(0, totalRecharge - totalDebits);
    const estimatedTripsRemaining = Math.floor(balanceCop / INDRIVE_ESTIMATED_COMMISSION_COP);

    return {
        balanceCop,
        estimatedTripsRemaining,
        label: `SALDO: $${balanceCop.toLocaleString('es-CO')} · ~${estimatedTripsRemaining} VIAJES`
    };
}

/**
 * Calculates 2x2 Driver KPIs for urban transport platforms.
 * @param {Array} sessions
 * @returns {Object}
 */
export function calculateDriverKpis(sessions = []) {
    let gross = 0;
    let tripKm = 0;
    let realKm = 0;
    const platformRev = {};

    sessions.forEach(s => {
        const g = Number(s.grossIncomeCop || s.grossEarnings || 0);
        const t = Number(s.tripKmTotal || s.workKm || 0);
        const r = Number(s.kmWorkReal || (s.odometerDeltaKm ? Math.max(0, s.odometerDeltaKm - 24) : t));
        gross += g;
        tripKm += t;
        realKm += r;
        const app = (s.app || 'DIRECT').toUpperCase();
        platformRev[app] = (platformRev[app] || 0) + g;
    });

    const deadheadKm = Math.max(0, realKm - tripKm);
    const deadheadPct = realKm > 0 ? Number(((deadheadKm / realKm) * 100).toFixed(1)) : 0;
    const farePerTripKmCop = tripKm > 0 ? Math.round(gross / tripKm) : 0;
    const farePerRealKmCop = realKm > 0 ? Math.round(gross / realKm) : 0;

    let bestName = 'DIDI';
    let bestVal = -1;
    Object.keys(platformRev).forEach(k => {
        if (platformRev[k] > bestVal) {
            bestVal = platformRev[k];
            bestName = k;
        }
    });

    return {
        farePerTripKmCop,
        farePerRealKmCop,
        deadheadPct,
        bestPlatform: { name: bestName }
    };
}

/**
 * Backward-compatible wrapper for calculateMonthlyRidesSummary.
 */
export function calculateMonthlyRidesSummary(sessions = [], passes = [], profile = {}, telemetryModel = null, monthFilter = null) {
    const rawSessions = Array.isArray(sessions) ? sessions : [];
    const rawPasses = Array.isArray(passes) ? passes : [];

    let totalGross = 0;
    let totalCommissions = 0;
    let totalFuelExpense = 0;
    let totalTripKm = 0;
    let totalWorkKm = 0;
    let totalDeadheadKm = 0;
    let totalRidesCount = 0;
    const workingDaysSet = new Set();
    const platformRev = {};

    const costPerKm = calculateCostPerKm({
        fuelPriceCop: profile.fuelPriceCop,
        efficiencyKmGal: profile.defaultEfficiencyKmGal,
        telemetryModel,
        vehicleProfile: profile
    });
    const routineKm = Number(profile.routineDailyKm !== undefined ? profile.routineDailyKm : DEFAULT_ROUTINE_DAILY_KM);

    rawSessions.forEach(s => {
        const d = String(s.date || '').slice(0, 10);
        if (d) workingDaysSet.add(d);

        const g = Number(s.grossIncomeCop !== undefined ? s.grossIncomeCop : (s.grossEarnings || s.grossRevenueCop || 0));
        const comm = Number(s.appCommissionsCop !== undefined ? s.appCommissionsCop : (s.appCommissions || 0));
        const trip = Number(s.tripKmTotal !== undefined ? s.tripKmTotal : (s.workKm || s.distanceKm || 0));
        
        let work = s.kmWorkReal;
        if (work === undefined || work === null) {
            const delta = s.odometerDeltaKm !== undefined ? s.odometerDeltaKm : s.deltaOdo;
            if (delta !== undefined && delta !== null) {
                work = s.subtractRoutine !== false ? Math.max(0, delta - routineKm) : delta;
            } else {
                work = trip;
            }
        }
        work = Number(work || 0);

        let fuel = s.fuelCostCop;
        if (fuel === undefined || fuel === null) {
            fuel = Math.round(work * (Number(s.costPerKmCop) || costPerKm));
        }
        fuel = Number(fuel || 0);

        let dh = s.kmDeadhead;
        if (dh === undefined || dh === null) {
            dh = Math.max(0, work - trip);
        }
        dh = Number(dh || 0);

        let ridesC = s.ridesCount !== undefined ? Number(s.ridesCount) : (s.totalRidesCount !== undefined ? Number(s.totalRidesCount) : (Array.isArray(s.rides) ? s.rides.length : 1));
        if (Array.isArray(s.rides) && s.rides.length > 0) {
            s.rides.forEach(r => {
                const app = (r.app || r.platform || 'DIRECT').toUpperCase();
                platformRev[app] = (platformRev[app] || 0) + Number(r.fareCop || 0);
            });
        } else if (s.app) {
            const app = String(s.app).toUpperCase();
            platformRev[app] = (platformRev[app] || 0) + g;
        }

        totalGross += g;
        totalCommissions += comm;
        totalFuelExpense += fuel;
        totalTripKm += trip;
        totalWorkKm += work;
        totalDeadheadKm += dh;
        totalRidesCount += ridesC;
    });

    rawPasses.forEach(p => {
        totalCommissions += Number(p.amountCop || p.costCop || 0);
    });

    const totalFreeNetProfitCop = Math.round(totalGross - totalCommissions - totalFuelExpense);
    const tankGal = Number(profile.tankCapacityGallons) || DEFAULT_TANK_CAPACITY_GAL;
    const fuelPrice = Number(profile.fuelPriceCop) || DEFAULT_FUEL_PRICE_COP;
    const targetTankCop = Math.round(tankGal * fuelPrice);
    const percentCovered = targetTankCop > 0 ? Number(((totalFreeNetProfitCop / targetTankCop) * 100).toFixed(1)) : 0;

    const commuteTarget = Math.round(20 * routineKm * costPerKm);
    const avgDailyKm = Number(telemetryModel?.stats?.avgKmPerDay || 27.5);
    const monthlyFuelTarget = Number(telemetryModel?.projectedMonthlyFuelCostCop) || Math.round(avgDailyKm * 30 * costPerKm);

    let bestPlatformName = 'DIDI';
    let bestRev = -1;
    Object.keys(platformRev).forEach(k => {
        if (platformRev[k] > bestRev) {
            bestRev = platformRev[k];
            bestPlatformName = k;
        }
    });

    const deadheadPct = totalWorkKm > 0 ? Number(((totalDeadheadKm / totalWorkKm) * 100).toFixed(1)) : 0;
    const deadheadRatio = totalTripKm > 0 ? Number((totalWorkKm / totalTripKm).toFixed(2)) : 1;
    const grossPerTripKm = totalTripKm > 0 ? Math.round(totalGross / totalTripKm) : 0;
    const netRealPerWorkKm = totalWorkKm > 0 ? Math.round(totalFreeNetProfitCop / totalWorkKm) : 0;

    return {
        totalGrossIncomeCop: totalGross,
        totalCommissionsCop: totalCommissions,
        totalFreeNetProfitCop,
        freeNetProfitCop: totalFreeNetProfitCop,
        totalRidesCount,
        totalWorkingDays: workingDaysSet.size,
        grossRevenueCop: totalGross,
        totalExpensesCop: totalCommissions,
        totalFuelExpenseCop: totalFuelExpense,
        totalDeclaredKm: totalTripKm,
        totalExtraKm: totalWorkKm,
        totalPickupKm: totalDeadheadKm,
        costPerKmCop: costPerKm,
        subsidies: {
            meta1: {
                label: 'TANQUE FULL',
                targetCop: targetTankCop,
                progressPct: percentCovered,
                percentCovered,
                clampedPct: Math.min(100, Math.max(0, percentCovered)),
                statusText: `${percentCovered}% CUBIERTO`
            },
            meta2: {
                label: 'RUTAS TRABAJO',
                targetCop: commuteTarget
            },
            meta3: {
                label: 'COMBUSTIBLE MENSUAL',
                targetCop: monthlyFuelTarget
            }
        },
        goalFullTank: {
            targetCop: targetTankCop,
            percentCovered
        },
        goalCommute: {
            targetCop: commuteTarget
        },
        goalMonthlyFuel: {
            targetCop: monthlyFuelTarget
        },
        kpis: {
            tarifaKm: {
                grossPerTripKm,
                netRealPerWorkKm,
                formattedTrip: `$${grossPerTripKm.toLocaleString('es-CO')}`,
                formattedReal: `REAL: $${netRealPerWorkKm.toLocaleString('es-CO')}/KM`
            },
            deadhead: {
                deadheadPct,
                deadheadRatio,
                formattedPct: `${deadheadPct}%`,
                formattedRatio: `RATIO ${deadheadRatio}X`,
                formattedFooter: `${Math.round(totalTripKm)}K CARRERAS · ${Math.round(totalDeadheadKm)}K RECOGIDA`
            },
            bestPlatform: {
                best: { name: bestPlatformName },
                formattedBest: bestPlatformName,
                formattedBestRate: `$${grossPerTripKm.toLocaleString('es-CO')} / KM`,
                formattedRunnerUp: ''
            },
            jornadas: {
                totalRides: totalRidesCount,
                totalDays: workingDaysSet.size,
                formattedRidesDays: `${totalRidesCount} CARRERAS`,
                formattedAvgDaily: ''
            }
        }
    };
}

/**
 * Format COP amount into Swiss compact style (e.g. $146K, $1.2M).
 * @param {number} amountCop
 * @returns {string}
 */
export function formatCompactCop(amountCop) {
    if (!Number.isFinite(amountCop)) return '$0';
    const abs = Math.abs(amountCop);
    const sign = amountCop < 0 ? '-' : '';
    if (abs >= 1000000) {
        return `${sign}$${(abs / 1000000).toFixed(1)}M`;
    }
    if (abs >= 1000) {
        return `${sign}$${Math.round(abs / 1000)}K`;
    }
    return `${sign}$${Math.round(abs)}`;
}

/**
 * Format COP amount with thousand separators and optional sign (e.g. +$126.769).
 * @param {number} amountCop
 * @param {boolean} [withSign=false]
 * @returns {string}
 */
export function formatCop(amountCop, withSign = false) {
    if (!Number.isFinite(amountCop)) return '$0';
    const sign = amountCop > 0 ? (withSign ? '+' : '') : (amountCop < 0 ? '-' : '');
    const abs = Math.abs(Math.round(amountCop));
    return `${sign}$${abs.toLocaleString('es-CO')}`;
}
