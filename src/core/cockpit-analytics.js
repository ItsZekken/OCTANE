/**
 * OCTANE // KINETIC — Pure Cockpit KPI & GPS Analytics Engine
 *
 * Computes contextualized, comparative KPI metrics, month-to-date vs projected
 * fuel expenditure, timeline data series for interactive SVG charts, and live
 * IOPGPS Cockpit summaries.
 *
 * Zero DOM dependencies — 100% unit-testable in Node.js.
 */

import { localYmd, todayLocalYmd } from './date-utils.js';
import { sanitizeFuelCostCop } from './number-utils.js';
import {
    GAL_TO_L,
    DEFAULT_BENCHMARK_EFF,
    formatEff,
    formatDateShort,
    computeCyclePhysicalTelemetry
} from './telemetry-engine.js';
import { buildRouteGlyph, getGpsConfig } from './iopgps-sync.js';
import { decomposeFuelCost } from './fuel-physics-engine.js';

const MONTHS_ES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

/**
 * Converts efficiency from base KM/GAL to the active display unit.
 * @param {number} effKmGal
 * @param {'gal'|'l100'|'kml'} unit
 * @returns {number}
 */
export function convertEffValue(effKmGal, unit = 'gal') {
    const val = Number(effKmGal) || 0;
    if (val <= 0 || !Number.isFinite(val)) return 0;
    if (unit === 'l100') return Number((378.541 / val).toFixed(2));
    if (unit === 'kml') return Number((val / GAL_TO_L).toFixed(2));
    return Number(val.toFixed(2));
}

/**
 * Returns the short display unit label for efficiency.
 * @param {'gal'|'l100'|'kml'} unit
 * @returns {string}
 */
export function getEffUnitLabel(unit = 'gal') {
    if (unit === 'l100') return 'L / 100 KM';
    if (unit === 'kml') return 'KM / LITRO';
    return 'KM / GAL';
}

/**
 * Formats relative time from an ISO timestamp or epoch ms in concise Spanish telemetry style.
 * @param {string|number} ts
 * @param {Date} [now=new Date()]
 * @returns {string}
 */
export function formatRelativeSyncTime(ts, now = new Date()) {
    if (!ts) return '';
    const ms = typeof ts === 'number' ? ts : Date.parse(ts);
    if (!Number.isFinite(ms) || ms <= 0) return '';
    const diffSec = Math.max(0, Math.round((now.getTime() - ms) / 1000));
    if (diffSec < 90) return 'AHORA';
    const diffMin = Math.round(diffSec / 60);
    if (diffMin < 60) return `HACE ${diffMin} MIN`;
    const diffHr = Math.round(diffMin / 60);
    if (diffHr < 24) return `HACE ${diffHr} H`;
    const diffDays = Math.round(diffHr / 24);
    if (diffDays === 1) return 'AYER';
    return `HACE ${diffDays} D`;
}

/**
 * Resolves the price per gallon paid for each refuel log and returns the most recent valid price
 * along with its predecessor.
 * @param {Array} logs
 * @param {number} defaultPrice
 * @returns {{ lastPrice: number, prevPrice: number|null, refuelPrices: Array<{ date: string, odo: number, pricePerGal: number, gals: number, cost: number }> }}
 */
export function extractRefuelPriceHistory(logs = [], defaultPrice = 16000) {
    const fallback = Number(defaultPrice) || 16000;
    if (!Array.isArray(logs) || logs.length === 0) {
        return { lastPrice: fallback, prevPrice: null, refuelPrices: [] };
    }

    const sorted = [...logs].sort((a, b) => {
        if ((a.date || '') !== (b.date || '')) return (a.date || '') > (b.date || '') ? 1 : -1;
        return (Number(a.odometer_reading) || 0) - (Number(b.odometer_reading) || 0);
    });

    const refuelPrices = [];
    for (const l of sorted) {
        const gals = Number(l.gallons_added) || 0;
        const hasRefuel = gals > 0 && (Number(l.refuels_count) > 0 || l.is_full_tank || l.isFullTank || Number(l.total_cost_cop) > 0 || gals > 0);
        if (!hasRefuel || gals <= 0) continue;

        const rawCost = Number(l.total_cost_cop) || 0;
        const cost = rawCost > 0 ? sanitizeFuelCostCop(rawCost, gals, fallback) : Math.round(gals * fallback);
        const pricePerGal = Math.round(cost / gals);
        if (pricePerGal > 5000 && pricePerGal < 45000) {
            refuelPrices.push({
                id: l.id || `${l.date}_${l.odometer_reading}`,
                date: l.date || '',
                odo: Number(l.odometer_reading) || 0,
                gals: Number(gals.toFixed(3)),
                cost: Math.round(cost),
                pricePerGal
            });
        }
    }

    const lastPrice = refuelPrices.length > 0 ? refuelPrices[refuelPrices.length - 1].pricePerGal : fallback;
    const prevPrice = refuelPrices.length > 1 ? refuelPrices[refuelPrices.length - 2].pricePerGal : null;

    return { lastPrice, prevPrice, refuelPrices };
}

/**
 * Builds a semantic delta descriptor where arrow reflects mathematical direction of the displayed number
 * and tone reflects whether that change is favorable ('volt') or unfavorable ('amber'|'crimson'|'neutral').
 *
 * @param {number|null} currentVal
 * @param {number|null} compareVal
 * @param {'higher_is_better'|'lower_is_better'|'neutral'} polarity
 * @returns {{ pct: number|null, absDiff: number|null, arrow: string, text: string, tone: 'volt'|'amber'|'crimson'|'neutral' }}
 */
export function buildTrendDelta(currentVal, compareVal, polarity = 'higher_is_better') {
    if (
        currentVal === null || currentVal === undefined || !Number.isFinite(currentVal) ||
        compareVal === null || compareVal === undefined || !Number.isFinite(compareVal) || compareVal === 0
    ) {
        return { pct: null, absDiff: null, arrow: '', text: '—', tone: 'neutral' };
    }

    const absDiff = currentVal - compareVal;
    const rawPct = ((currentVal - compareVal) / Math.abs(compareVal)) * 100;
    const pct = Number(rawPct.toFixed(1));

    if (Math.abs(pct) < 0.2) {
        return { pct: 0, absDiff: 0, arrow: '=', text: '= 0%', tone: 'neutral' };
    }

    const isUp = pct > 0;
    const arrow = isUp ? '▲' : '▼';
    const roundedPct = Math.abs(pct) >= 10 ? Math.round(pct) : Number(pct.toFixed(1));
    const text = `${arrow} ${roundedPct > 0 ? '+' : ''}${roundedPct}%`;

    let tone = 'neutral';
    if (polarity === 'higher_is_better') {
        tone = isUp ? 'volt' : (Math.abs(pct) >= 6 ? 'crimson' : 'amber');
    } else if (polarity === 'lower_is_better') {
        tone = !isUp ? 'volt' : (Math.abs(pct) >= 6 ? 'crimson' : 'amber');
    } else {
        tone = isUp ? 'amber' : 'cyan';
    }

    return { pct, absDiff, arrow, text, tone };
}

/**
 * Computes Efficiency KPI context & timeline series across closed cycles.
 *
 * @param {Object} model - Telemetry engine result
 * @param {'gal'|'l100'|'kml'} [unit='gal']
 * @returns {Object}
 */
export function computeEfficiencyTrend(model, unit = 'gal') {
    const rawCycles = Array.isArray(model?.allCycles)
        ? model.allCycles
        : (Array.isArray(model?.fullEraCycles) ? model.fullEraCycles : []);
    const validCycles = rawCycles.filter(c => c && c.isValid && Number(c.eff) > 0);

    const avgKmGal = Number(model?.fullEraAvgEff) || DEFAULT_BENCHMARK_EFF;
    const emaKmGal = Number(model?.emaEff) || avgKmGal;
    const hasCycles = validCycles.length > 0;

    const latest = hasCycles ? validCycles[validCycles.length - 1] : null;
    const prev = validCycles.length > 1 ? validCycles[validCycles.length - 2] : null;

    const heroKmGal = latest ? latest.eff : avgKmGal;
    const heroConverted = convertEffValue(heroKmGal, unit);
    const prevConverted = prev ? convertEffValue(prev.eff, unit) : null;
    const avgConverted = convertEffValue(avgKmGal, unit);
    const emaConverted = convertEffValue(emaKmGal, unit);

    // Polarity depends on unit: for L/100km, lower is better!
    const polarity = unit === 'l100' ? 'lower_is_better' : 'higher_is_better';
    const deltaVsPrev = prev
        ? buildTrendDelta(heroConverted, prevConverted, polarity)
        : (hasCycles && avgConverted > 0 ? buildTrendDelta(heroConverted, avgConverted, polarity) : buildTrendDelta(null, null, polarity));
    const deltaVsAvg = hasCycles ? buildTrendDelta(heroConverted, avgConverted, polarity) : buildTrendDelta(null, null, polarity);

    const series = validCycles.map((c, idx) => {
        const val = convertEffValue(c.eff, unit);
        const prevItem = idx > 0 ? convertEffValue(validCycles[idx - 1].eff, unit) : null;
        const pointDelta = prevItem ? buildTrendDelta(val, prevItem, polarity) : null;
        return {
            cycleIndex: c.cycleIndex || (idx + 1),
            date: c.endDate,
            startDate: c.startDate,
            label: formatDateShort(c.endDate) || c.endDate,
            value: val,
            formatted: formatEff(c.eff, unit, true),
            effKmGal: c.eff,
            dist: c.dist,
            gals: c.gals,
            days: c.days || 1,
            isFull: Boolean(c.isFull),
            delta: pointDelta,
            physicalTelemetry: c.physicalTelemetry || null
        };
    });

    const values = series.map(s => s.value).filter(v => v > 0);
    const bestValue = values.length > 0 ? (unit === 'l100' ? Math.min(...values) : Math.max(...values)) : heroConverted;
    const worstValue = values.length > 0 ? (unit === 'l100' ? Math.max(...values) : Math.min(...values)) : heroConverted;

    return {
        hasCycles,
        cycleCount: validCycles.length,
        heroKmGal,
        heroValue: heroConverted,
        heroFormatted: formatEff(heroKmGal, unit, false),
        unitLabel: getEffUnitLabel(unit),
        prevKmGal: prev ? prev.eff : null,
        prevFormatted: prev ? formatEff(prev.eff, unit, false) : null,
        avgKmGal,
        avgValue: avgConverted,
        avgFormatted: formatEff(avgKmGal, unit, false),
        emaValue: emaConverted,
        emaFormatted: formatEff(emaKmGal, unit, false),
        bestValue,
        worstValue,
        delta: deltaVsPrev,
        deltaVsAvg,
        compareTargetLabel: prev ? 'VS CICLO ANT' : 'VS MEDIA',
        latestCycle: latest,
        series
    };
}

/**
 * Computes Cost per KM trend across closed cycles using historical per-refuel fuel prices.
 *
 * @param {Array} logs
 * @param {Object} model
 * @param {number} [fallbackPriceCop=16000]
 * @returns {Object}
 */
export function computeCostPerKmTrend(logs = [], model = null, fallbackPriceCop = 16000) {
    const { lastPrice, prevPrice, refuelPrices } = extractRefuelPriceHistory(logs, fallbackPriceCop);

    // Map logs by id and date to resolve exact fuel price paid at cycle closure
    const logById = new Map();
    const logByDate = new Map();
    if (Array.isArray(logs)) {
        logs.forEach(l => {
            if (!l) return;
            if (l.id) logById.set(String(l.id), l);
            if (l.date) logByDate.set(l.date, l);
        });
    }

    const resolveLogPrice = (logId, date) => {
        const match = (logId && logById.get(String(logId))) || (date && logByDate.get(date));
        if (match) {
            const gals = Number(match.gallons_added) || 0;
            const rawCost = Number(match.total_cost_cop) || 0;
            if (gals > 0 && rawCost > 0) {
                const cleanCost = sanitizeFuelCostCop(rawCost, gals, lastPrice);
                const p = Math.round(cleanCost / gals);
                if (p > 5000 && p < 45000) return p;
            }
        }
        // Fallback: latest known refuel price on or before cycle date
        if (date && refuelPrices.length > 0) {
            for (let i = refuelPrices.length - 1; i >= 0; i--) {
                if (refuelPrices[i].date <= date) return refuelPrices[i].pricePerGal;
            }
        }
        return lastPrice;
    };

    const rawCycles = Array.isArray(model?.allCycles)
        ? model.allCycles
        : (Array.isArray(model?.fullEraCycles) ? model.fullEraCycles : []);
    const validCycles = rawCycles.filter(c => c && c.isValid && Number(c.eff) > 0);

    const series = validCycles.map((c, idx) => {
        const pricePerGal = resolveLogPrice(c.endLogId, c.endDate);
        const costPerKm = Math.round((1 / c.eff) * pricePerGal);
        return {
            cycleIndex: c.cycleIndex || (idx + 1),
            date: c.endDate,
            startDate: c.startDate,
            label: formatDateShort(c.endDate) || c.endDate,
            value: costPerKm,
            formatted: `$${costPerKm.toLocaleString('es-CO')}`,
            pricePerGal,
            effKmGal: c.eff,
            dist: c.dist,
            totalCycleCost: Math.round(c.gals * pricePerGal)
        };
    });

    // Compute per-point delta
    series.forEach((pt, idx) => {
        pt.delta = idx > 0 ? buildTrendDelta(pt.value, series[idx - 1].value, 'lower_is_better') : null;
    });

    const avgEff = Number(model?.fullEraAvgEff) || DEFAULT_BENCHMARK_EFF;
    const avgCostPerKm = series.length > 0
        ? Math.round(series.reduce((s, p) => s + p.value, 0) / series.length)
        : (avgEff > 0 ? Math.round((1 / avgEff) * lastPrice) : 0);

    const latestPt = series.length > 0 ? series[series.length - 1] : null;
    const prevPt = series.length > 1 ? series[series.length - 2] : null;

    const currentCostPerKm = latestPt ? latestPt.value : avgCostPerKm;
    const delta = prevPt
        ? buildTrendDelta(currentCostPerKm, prevPt.value, 'lower_is_better')
        : buildTrendDelta(null, null, 'lower_is_better');

    const priceDelta = prevPrice
        ? buildTrendDelta(lastPrice, prevPrice, 'lower_is_better')
        : buildTrendDelta(null, null, 'lower_is_better');

    const values = series.map(s => s.value).filter(v => v > 0);
    const minCostPerKm = values.length > 0 ? Math.min(...values) : currentCostPerKm;
    const maxCostPerKm = values.length > 0 ? Math.max(...values) : currentCostPerKm;

    return {
        hasCycles: series.length > 0,
        currentCostPerKm,
        prevCostPerKm: prevPt ? prevPt.value : null,
        avgCostPerKm,
        minCostPerKm,
        maxCostPerKm,
        lastRefuelPrice: lastPrice,
        prevRefuelPrice: prevPrice,
        priceDelta,
        delta,
        refuelPrices,
        series
    };
}

/**
 * Computes Month-to-Date real fuel expenditure vs Calendar-Aware End-of-Month projection
 * and historical monthly expenditure timeline.
 *
 * @param {Array} logs
 * @param {Object} [model=null]
 * @param {number} [fallbackPriceCop=16000]
 * @param {Date} [now=new Date()]
 * @param {Object|null} [vehicleProfile=null]
 * @returns {Object}
 */
export function computeMonthlyFuelMetrics(logs = [], model = null, fallbackPriceCop = 16000, now = new Date(), vehicleProfile = null) {
    const curYear = now.getFullYear();
    const curMonthIdx = now.getMonth();
    const curMonth = String(curMonthIdx + 1).padStart(2, '0');
    const curKey = `${curYear}-${curMonth}`;

    const prevDate = new Date(curYear, curMonthIdx - 1, 1);
    const prevKey = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

    const daysInMonth = new Date(curYear, curMonthIdx + 1, 0).getDate();
    const dayOfMonth = Math.max(1, Math.min(daysInMonth, now.getDate()));
    const remainingDays = Math.max(0, daysInMonth - dayOfMonth);

    const safePrice = Number(fallbackPriceCop) || 16000;
    const safeEff = Number(model?.activeTankState?.adaptiveEff || model?.adaptiveEff || model?.fullEraAvgEff) || DEFAULT_BENCHMARK_EFF;
    const costPerKm = safeEff > 0 ? (safePrice / safeEff) : 475;

    // Aggregate refuel costs & gallons by calendar month (YYYY-MM)
    const monthMap = {};
    if (Array.isArray(logs)) {
        logs.forEach(l => {
            if (!l || !l.date || l.date.length < 7) return;
            const ym = l.date.slice(0, 7);
            const gals = Number(l.gallons_added) || 0;
            const cost = gals > 0 || Number(l.total_cost_cop) > 0
                ? sanitizeFuelCostCop(l.total_cost_cop, gals, safePrice)
                : 0;
            if (!monthMap[ym]) {
                monthMap[ym] = { ym, spentCop: 0, gallons: 0, refuelCount: 0, km: 0, refuels: [] };
            }
            if (cost > 0 || gals > 0) {
                monthMap[ym].spentCop += cost;
                monthMap[ym].gallons += gals;
                monthMap[ym].refuelCount += 1;
                monthMap[ym].refuels.push({
                    id: l.id || l.date,
                    date: l.date,
                    cost,
                    gals: Number(gals.toFixed(2)),
                    odo: Number(l.odometer_reading) || 0,
                    isFull: Boolean(l.is_full_tank || l.isFullTank)
                });
            }
        });
    }

    // Aggregate monthly KM from dailySeries
    const dailySeries = Array.isArray(model?.dailySeries) ? model.dailySeries : [];
    dailySeries.forEach(d => {
        if (!d || !d.date || d.date.length < 7) return;
        const ym = d.date.slice(0, 7);
        if (!monthMap[ym]) {
            monthMap[ym] = { ym, spentCop: 0, gallons: 0, refuelCount: 0, km: 0, refuels: [] };
        }
        monthMap[ym].km += Number(d.km) || 0;
    });

    if (!monthMap[curKey]) {
        monthMap[curKey] = { ym: curKey, spentCop: 0, gallons: 0, refuelCount: 0, km: 0, refuels: [] };
    }

    const currentMonthSpent = Math.round(monthMap[curKey]?.spentCop || 0);
    const currentMonthGallons = Number((monthMap[curKey]?.gallons || 0).toFixed(2));
    const currentMonthRefuels = monthMap[curKey]?.refuelCount || 0;
    const currentMonthKm = Math.round(monthMap[curKey]?.km || 0);
    const prevMonthSpent = Math.round(monthMap[prevKey]?.spentCop || 0);

    // Physical & Calendar-Aware consumption projection for end of current month
    const overallAvgKmDay = Number(model?.stats?.avgKmPerDay) || 0;
    const kmPerDayThisMonth = (dayOfMonth >= 3 && currentMonthKm > 0) ? (currentMonthKm / dayOfMonth) : overallAvgKmDay;
    const weightMonth = Math.min(1, dayOfMonth / 10);
    const effectiveDailyKm = overallAvgKmDay > 0
        ? (weightMonth * kmPerDayThisMonth + (1 - weightMonth) * overallAvgKmDay)
        : kmPerDayThisMonth;

    const gpsDays = vehicleProfile?.gpsCache?.days || null;
    const todayStr = localYmd(now);
    const todayKm = Number(gpsDays?.[todayStr]?.km ?? gpsDays?.[todayStr]?.miles ?? vehicleProfile?.gpsCache?.live?.todayMile) || 0;
    const weekdayDNA = Array.isArray(model?.weekdayDNA) ? model.weekdayDNA : null;
    const weekdaySeverity = Array.isArray(model?.activeTankState?.weekdaySeverity)
        ? model.activeTankState.weekdaySeverity
        : [1, 1, 1, 1, 1, 1, 1];

    let calendarRemainingGal = 0;
    const hasDnaKm = Boolean(weekdayDNA && weekdayDNA.some(d => (Number(d?.avgKm) || 0) > 0));
    if (hasDnaKm || effectiveDailyKm > 0) {
        // Remainder of today if GPS shows partial day
        if (gpsDays?.[todayStr] || todayKm > 0) {
            const wToday = now.getDay();
            const idxToday = wToday === 0 ? 6 : wToday - 1;
            const todayPlanned = (weekdayDNA?.[idxToday]?.avgKm > 0) ? weekdayDNA[idxToday].avgKm : effectiveDailyKm;
            const remTodayKm = Math.max(0, todayPlanned - todayKm);
            const effToday = safeEff / (weekdaySeverity[idxToday] || 1.0);
            if (effToday > 0 && remTodayKm > 0) {
                calendarRemainingGal += remTodayKm / effToday;
            }
        }

        for (let d = dayOfMonth + 1; d <= daysInMonth; d++) {
            const simDate = new Date(curYear, curMonthIdx, d, 12, 0, 0);
            const w = simDate.getDay();
            const idx = w === 0 ? 6 : w - 1;
            const plannedKm = (weekdayDNA?.[idx]?.avgKm > 0) ? weekdayDNA[idx].avgKm : effectiveDailyKm;
            const effDay = safeEff / (weekdaySeverity[idx] || 1.0);
            if (effDay > 0 && plannedKm > 0) {
                calendarRemainingGal += plannedKm / effDay;
            }
        }
    }
    calendarRemainingGal = Number(calendarRemainingGal.toFixed(3));
    const calendarRemainingCostCop = Math.round(calendarRemainingGal * safePrice);
    const calendarFullProjected = currentMonthSpent + calendarRemainingCostCop;

    const physicalFullMonthCost = effectiveDailyKm > 0 ? Math.round(effectiveDailyKm * daysInMonth * costPerKm) : 0;
    const cashPaceFullMonthCost = (dayOfMonth >= 6 && currentMonthSpent > 0)
        ? Math.round((currentMonthSpent / dayOfMonth) * daysInMonth)
        : 0;

    const dnaTotalCount = weekdayDNA ? weekdayDNA.reduce((acc, d) => acc + (Number(d?.count) || 0), 0) : 0;
    const gpsDaysCount = gpsDays && typeof gpsDays === 'object' ? Object.keys(gpsDays).length : 0;
    const hasRichCalendarHistory = hasDnaKm && (dailySeries.length >= 14 || dnaTotalCount >= 14 || gpsDaysCount >= 14);

    let rawProjected = 0;
    if (hasRichCalendarHistory && calendarFullProjected > 0) {
        rawProjected = calendarFullProjected;
    } else if (hasDnaKm && calendarRemainingCostCop > 0 && cashPaceFullMonthCost > 0) {
        rawProjected = Math.round(0.65 * calendarFullProjected + 0.35 * cashPaceFullMonthCost);
    } else if (cashPaceFullMonthCost > 0 && physicalFullMonthCost > 0) {
        rawProjected = Math.round(0.5 * cashPaceFullMonthCost + 0.5 * physicalFullMonthCost);
    } else if (cashPaceFullMonthCost > 0) {
        rawProjected = cashPaceFullMonthCost;
    } else {
        rawProjected = physicalFullMonthCost || calendarFullProjected;
    }

    const hasAnyBasis = currentMonthSpent > 0 || currentMonthKm > 0 || overallAvgKmDay > 0 || hasDnaKm;
    const projectedMonthSpent = hasAnyBasis ? Math.max(currentMonthSpent, rawProjected) : 0;
    const dailySpendPace = dayOfMonth > 0 ? Math.round((projectedMonthSpent || currentMonthSpent) / daysInMonth) : 0;

    // Monthly "Impuesto Invisible" fuel decomposition when GPS data covers current month
    let invisibleTax = null;
    if (gpsDays && typeof gpsDays === 'object') {
        const monthPhys = computeCyclePhysicalTelemetry(
            `${curKey}-01`,
            todayStr,
            gpsDays,
            Number(model?.learnedSensitivity || vehicleProfile?.gpsCache?.physicalSensitivity) || 1.0
        );
        if (monthPhys) {
            invisibleTax = decomposeFuelCost(monthPhys, {
                totalCostCop: currentMonthSpent > 0 ? currentMonthSpent : undefined,
                totalGallons: currentMonthGallons > 0 ? currentMonthGallons : undefined,
                fuelPriceCop: safePrice,
                priors: model?.fuelPhysicsModel?.coeffs
            });
            if (!invisibleTax.hasData) invisibleTax = null;
        }
    }

    // Apples-to-apples comparison: Projected current month end vs Full previous month
    let diffPct = null;
    if (prevMonthSpent > 0 && projectedMonthSpent > 0) {
        diffPct = Math.round(((projectedMonthSpent - prevMonthSpent) / prevMonthSpent) * 100);
    }
    const delta = (prevMonthSpent > 0 && projectedMonthSpent > 0)
        ? buildTrendDelta(projectedMonthSpent, prevMonthSpent, 'lower_is_better')
        : buildTrendDelta(null, null, 'lower_is_better');

    // Build chronological monthly series (last 8 months with activity)
    const sortedKeys = Object.keys(monthMap)
        .filter(ym => ym <= curKey)
        .sort();

    const series = sortedKeys.slice(-8).map(ym => {
        const entry = monthMap[ym];
        const [, mNum] = ym.split('-');
        const mIdx = Math.max(0, Math.min(11, parseInt(mNum, 10) - 1));
        const isCurrent = ym === curKey;
        const spentCop = Math.round(entry.spentCop);
        const projectedCop = isCurrent ? projectedMonthSpent : spentCop;
        return {
            ym,
            label: MONTHS_ES[mIdx] || ym,
            value: spentCop,
            projectedCop,
            gallons: Number(entry.gallons.toFixed(2)),
            refuelCount: entry.refuelCount,
            km: Math.round(entry.km),
            isCurrent,
            refuels: [...entry.refuels].sort((a, b) => (a.date < b.date ? 1 : -1))
        };
    });

    const historicalMonths = series.filter(m => !m.isCurrent && m.value > 0);
    const avgMonthlySpent = historicalMonths.length > 0
        ? Math.round(historicalMonths.reduce((acc, m) => acc + m.value, 0) / historicalMonths.length)
        : projectedMonthSpent;

    return {
        curKey,
        prevKey,
        dayOfMonth,
        daysInMonth,
        remainingDays,
        monthProgressPct: Math.round((dayOfMonth / daysInMonth) * 100),
        currentMonthSpent,
        currentMonthGallons,
        currentMonthRefuels,
        currentMonthKm,
        prevMonthSpent,
        projectedMonthSpent,
        calendarRemainingGal,
        calendarRemainingCostCop,
        invisibleTax,
        anomalyAlert: model?.fuelPhysicsModel?.anomalyAlert || null,
        avgMonthlySpent,
        dailySpendPace,
        diffPct,
        delta,
        series
    };
}

/**
 * Computes Daily Usage Rhythm (KPI #4 replacing redundant Autonomía Full).
 * Focuses on recent 7-day driving pace (KM/DÍA) vs historical baseline.
 *
 * @param {Object} model
 * @param {Object} [vehicleProfile={}]
 * @param {Date} [now=new Date()]
 * @returns {Object}
 */
export function computeUsageRhythmTrend(model = null, vehicleProfile = {}, now = new Date()) {
    const dailySeries = Array.isArray(model?.dailySeries) ? model.dailySeries : [];
    const gpsDaysMap = vehicleProfile?.gpsCache?.days || {};
    const gpsLive = vehicleProfile?.gpsCache?.live || null;

    const todayStr = localYmd(now);
    const curMonthKey = todayStr.slice(0, 7);

    // Merge GPS days & dailySeries into unified day -> km map (preferring dailySeries reconciled odometer,
    // augmented by live todayMile if today's entry is lower or absent)
    const dayKmMap = new Map();
    const dayGpsFlag = new Map();

    dailySeries.forEach(d => {
        if (!d || !d.date) return;
        dayKmMap.set(d.date, Number(d.km) || 0);
        if (d.isGpsReal) dayGpsFlag.set(d.date, true);
    });

    Object.keys(gpsDaysMap).forEach(k => {
        const rec = gpsDaysMap[k];
        if (!rec) return;
        const gpsKm = Number(rec.km ?? rec.miles) || 0;
        if (!dayKmMap.has(k) || gpsKm > (dayKmMap.get(k) || 0)) {
            dayKmMap.set(k, gpsKm);
        }
        dayGpsFlag.set(k, true);
    });

    if (gpsLive && Number(gpsLive.todayMile) >= 0) {
        const liveDate = gpsLive.date || todayStr;
        const existingToday = dayKmMap.get(liveDate) || 0;
        if (Number(gpsLive.todayMile) > existingToday) {
            dayKmMap.set(liveDate, Number(gpsLive.todayMile));
        }
        dayGpsFlag.set(liveDate, true);
    }

    // Last 7 days window [today - 6 days .. today]
    const last7Series = [];
    let kmLast7d = 0;
    let activeDays7d = 0;
    for (let i = 6; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        const ymd = localYmd(d);
        const km = Number((dayKmMap.get(ymd) || 0).toFixed(1));
        kmLast7d += km;
        if (km >= 0.5) activeDays7d++;
        last7Series.push({
            date: ymd,
            label: formatDateShort(ymd),
            km,
            isGpsReal: Boolean(dayGpsFlag.get(ymd))
        });
    }

    // Last 30 days timeline for interactive chart
    const last30Series = [];
    let kmLast30d = 0;
    for (let i = 29; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        const ymd = localYmd(d);
        const km = Number((dayKmMap.get(ymd) || 0).toFixed(1));
        kmLast30d += km;
        last30Series.push({
            date: ymd,
            label: formatDateShort(ymd),
            value: km,
            km,
            isGpsReal: Boolean(dayGpsFlag.get(ymd))
        });
    }

    // Monthly KM totals
    let kmThisMonth = 0;
    dayKmMap.forEach((km, ymd) => {
        if (ymd.startsWith(curMonthKey)) kmThisMonth += km;
    });

    const baselineKmDay = Number(model?.stats?.avgKmPerDay) || Number(vehicleProfile?.routineDailyKm) || 0;
    const avg7dKmDay = Number((kmLast7d / 7).toFixed(1));
    const avg30dKmDay = Number((kmLast30d / 30).toFixed(1));
    const kmToday = Number((dayKmMap.get(todayStr) || 0).toFixed(1));

    const hasUsageData = dailySeries.length > 0 || Object.keys(gpsDaysMap).length > 0 || Boolean(gpsLive?.syncedAt);
    const displayKmDay = kmLast7d > 0 ? avg7dKmDay : baselineKmDay;
    const delta = (hasUsageData && baselineKmDay > 0)
        ? buildTrendDelta(displayKmDay, baselineKmDay, 'neutral')
        : buildTrendDelta(null, null, 'neutral');

    const peakDay30 = last30Series.reduce((best, cur) => (cur.km > (best?.km || 0) ? cur : best), null);

    return {
        hasUsageData,
        kmToday,
        kmLast7d: Number(kmLast7d.toFixed(1)),
        kmLast30d: Number(kmLast30d.toFixed(1)),
        kmThisMonth: Math.round(kmThisMonth),
        activeDays7d,
        avg7dKmDay,
        avg30dKmDay,
        baselineKmDay: Number(baselineKmDay.toFixed(1)),
        displayKmDay: Number(displayKmDay.toFixed(1)),
        peakDay30,
        delta,
        last7Series,
        series: last30Series
    };
}

/**
 * Extracts and summarizes all real IOPGPS telemetry available for the Cockpit GPS DATA module.
 * Never invents labels or fake metrics; falls back cleanly across active cycle -> 7 days -> cached.
 *
 * @param {Object} [vehicleProfile={}]
 * @param {Object} [model=null]
 * @param {Date} [now=new Date()]
 * @returns {Object}
 */
export function computeCockpitGpsSummary(vehicleProfile = {}, model = null, now = new Date()) {
    const gpsConfig = getGpsConfig(vehicleProfile);
    const gpsCache = vehicleProfile?.gpsCache || {};
    const live = gpsCache.live || null;
    const gpsDays = gpsCache.days || {};
    const tripsByDate = gpsCache.tripsByDate || {};

    const todayStr = localYmd(now);
    const hasDays = Object.keys(gpsDays).length > 0;
    const hasTripsCache = Object.keys(tripsByDate).some(k => Array.isArray(tripsByDate[k]) && tripsByDate[k].length > 0);
    const hasLive = Boolean(live && (live.syncedAt || live.totalMile > 0 || live.externalVoltage > 0));
    const isConnected = Boolean(gpsConfig.enabled || hasLive || hasDays || hasTripsCache);

    const todayDayRec = gpsDays[todayStr] || null;
    const todayTripsList = Array.isArray(tripsByDate[todayStr]) ? tripsByDate[todayStr] : [];
    const todayKm = Number(Math.max(Number(live?.todayMile) || 0, Number(todayDayRec?.km ?? todayDayRec?.miles) || 0).toFixed(1));
    const todayTripsCount = todayTripsList.length > 0 ? todayTripsList.length : (Number(todayDayRec?.runNo) || 0);
    const todayRunMin = Math.round((Number(todayDayRec?.runTimeSec) || 0) / 60);

    // Physical telemetry window: prefer active tank cycle; if empty, compute last 7 days
    const sensitivity = Number(model?.learnedSensitivity || gpsCache.physicalSensitivity) || 1.0;
    const activeStart = model?.activeTankState?.startDate || '';
    const cyclePhys = activeStart
        ? computeCyclePhysicalTelemetry(activeStart, todayStr, gpsDays, sensitivity)
        : null;

    const sevenDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
    const sevenDaysStart = localYmd(sevenDaysAgo);
    const phys7d = computeCyclePhysicalTelemetry(sevenDaysStart, todayStr, gpsDays, sensitivity);

    const activePhys = cyclePhys || phys7d || null;
    const physScopeLabel = cyclePhys ? 'CICLO ACTIVO' : (phys7d ? 'ÚLT. 7 DÍAS' : 'GPS');

    // External battery voltage assessment
    const voltage = Number(live?.externalVoltage) || 0;
    let batteryLabel = 'SIN DATO';
    let batteryTone = 'neutral';
    if (voltage > 0) {
        if (voltage >= 13.3) {
            batteryLabel = 'CARGANDO';
            batteryTone = 'volt';
        } else if (voltage >= 12.4) {
            batteryLabel = 'ÓPTIMA';
            batteryTone = 'volt';
        } else if (voltage >= 12.0) {
            batteryLabel = 'MEDIA';
            batteryTone = 'amber';
        } else {
            batteryLabel = 'BAJA';
            batteryTone = 'crimson';
        }
    }

    // Most recent cached trip with optional SVG route glyph
    let latestTrip = null;
    const tripDatesDesc = Object.keys(tripsByDate).sort().reverse();
    for (const d of tripDatesDesc) {
        const list = tripsByDate[d];
        if (Array.isArray(list) && list.length > 0) {
            const sortedDay = [...list].sort((a, b) => (Number(b.startTimeMs) || 0) - (Number(a.startTimeMs) || 0));
            const t = sortedDay[0];
            if (t) {
                latestTrip = {
                    ...t,
                    dateLabel: formatDateShort(t.date || d),
                    routeGlyph: buildRouteGlyph(t.trackPoints || [], 76, 26, 3)
                };
                break;
            }
        }
    }

    // Count total cached trips in active cycle or overall
    let cachedTripsCount = 0;
    Object.values(tripsByDate).forEach(arr => {
        if (Array.isArray(arr)) cachedTripsCount += arr.length;
    });

    const syncedAt = live?.syncedAt || gpsCache.lastSyncedAt || '';
    const syncedAgo = formatRelativeSyncTime(syncedAt, now);

    return {
        isConfigured: Boolean(gpsConfig.enabled),
        isConnected,
        hasLive,
        hasDays,
        hasTripsCache,
        cachedTripsCount,
        live,
        accStatus: Boolean(live?.accStatus),
        liveSpeed: Number(live?.speed) || 0,
        address: live?.address || '',
        syncedAt,
        syncedAgo,
        todayKm,
        todayTripsCount,
        todayRunMin,
        voltage,
        batteryLabel,
        batteryTone,
        activePhys,
        physScopeLabel,
        latestTrip
    };
}
