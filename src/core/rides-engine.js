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
 * Resolves the odometer delta for a specific calendar date from telemetry logs.
 * Returns closing status and delta.
 * 
 * @param {string} date - 'YYYY-MM-DD'
 * @param {Array} [telemetryLogs=[]]
 * @param {number|null} [fallbackDelta=null]
 * @returns {{ deltaOdo: number, hasClosing: boolean, isPendingOdometer: boolean, startOdo: number|null, endOdo: number|null }}
 */
export function resolveDayOdometerDelta(date, telemetryLogs = [], fallbackDelta = null) {
    if (fallbackDelta !== null && fallbackDelta !== undefined && !isNaN(Number(fallbackDelta))) {
        const d = Math.max(0, Number(fallbackDelta));
        return {
            deltaOdo: d,
            hasClosing: true,
            isPendingOdometer: false,
            startOdo: null,
            endOdo: null
        };
    }

    if (!date || !Array.isArray(telemetryLogs) || telemetryLogs.length === 0) {
        return {
            deltaOdo: 0,
            hasClosing: false,
            isPendingOdometer: true,
            startOdo: null,
            endOdo: null
        };
    }

    const targetDate = String(date).slice(0, 10);
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
            startOdo,
            endOdo
        };
    }

    // If only one reading exists on that date, check if a previous reading exists
    if (onDate.length === 1) {
        const targetReading = Number(onDate[0].odometer_reading) || 0;
        const prevLogs = sorted.filter(l => String(l.date).slice(0, 10) < targetDate);
        if (prevLogs.length > 0) {
            const prevReading = Number(prevLogs[prevLogs.length - 1].odometer_reading) || 0;
            return {
                deltaOdo: Math.max(0, targetReading - prevReading),
                hasClosing: true,
                isPendingOdometer: false,
                startOdo: prevReading,
                endOdo: targetReading
            };
        }
        return {
            deltaOdo: 0,
            hasClosing: false,
            isPendingOdometer: true,
            startOdo: targetReading,
            endOdo: null
        };
    }

    return {
        deltaOdo: 0,
        hasClosing: false,
        isPendingOdometer: true,
        startOdo: null,
        endOdo: null
    };
}

/**
 * Computes start and end date strings for a given cycle type.
 * Cycle Options: '3d' | 'week' | '15d' | 'month' | 'tank_cycle'
 * 
 * @param {string} cycleType
 * @param {Date|string} [refDate]
 * @param {Array} [telemetryLogs=[]]
 * @returns {{ startDate: string, endDate: string, label: string }}
 */
export function getCycleDateRange(cycleType = 'month', refDate = new Date(), telemetryLogs = []) {
    const today = refDate instanceof Date ? refDate : new Date(refDate);
    const todayStr = today.toISOString().slice(0, 10);

    if (cycleType === '3d') {
        const start = new Date(today);
        start.setDate(today.getDate() - 2);
        return {
            startDate: start.toISOString().slice(0, 10),
            endDate: todayStr,
            label: 'CADA 3 DÍAS'
        };
    }

    if (cycleType === 'week') {
        const dayOfWeek = today.getDay(); // 0 is Sunday, 1 is Monday...
        const diffToMonday = (dayOfWeek === 0 ? -6 : 1) - dayOfWeek;
        const start = new Date(today);
        start.setDate(today.getDate() + diffToMonday);
        return {
            startDate: start.toISOString().slice(0, 10),
            endDate: todayStr,
            label: 'SEMANAL'
        };
    }

    if (cycleType === '15d') {
        const dayOfMonth = today.getDate();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        if (dayOfMonth <= 15) {
            return {
                startDate: `${year}-${month}-01`,
                endDate: `${year}-${month}-15`,
                label: 'QUINCENAL (1–15)'
            };
        } else {
            return {
                startDate: `${year}-${month}-16`,
                endDate: todayStr,
                label: 'QUINCENAL (16–FIN)'
            };
        }
    }

    if (cycleType === 'tank_cycle') {
        // Find latest refuel in telemetry logs
        let latestRefuelDate = null;
        if (Array.isArray(telemetryLogs) && telemetryLogs.length > 0) {
            const sortedLogs = [...telemetryLogs]
                .filter(l => l && l.date)
                .sort((a, b) => String(a.date).localeCompare(String(b.date)));
            
            const refuels = sortedLogs.filter(l => Number(l.refuels_count) > 0 || Number(l.gallons_added) > 0 || l.is_full_tank);
            if (refuels.length > 0) {
                latestRefuelDate = String(refuels[refuels.length - 1].date).slice(0, 10);
            }
        }

        if (latestRefuelDate) {
            return {
                startDate: latestRefuelDate,
                endDate: todayStr,
                label: 'CICLO TANQUE ACTUAL'
            };
        }
    }

    // Default: 'month'
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    return {
        startDate: `${year}-${month}-01`,
        endDate: todayStr,
        label: 'MENSUAL'
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
 * @param {string} [params.cycleType='month'] - '3d' | 'week' | '15d' | 'month' | 'tank_cycle'
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
        cycleType = 'month'
    } = params;

    const rawSessions = Array.isArray(sessions) ? sessions : [];
    const rawPasses = Array.isArray(passes) ? passes : [];
    const rawLogs = Array.isArray(telemetryLogs) ? telemetryLogs : [];

    // Resolve date window
    const dateRange = (params.startDate && params.endDate)
        ? { startDate: params.startDate, endDate: params.endDate, label: 'PERSONALIZADO' }
        : getCycleDateRange(cycleType, new Date(), rawLogs);

    const { startDate, endDate, label: cycleLabel } = dateRange;

    // Vehicle profile parameters
    const fuelPriceCop = Number(profile.fuelPriceCop) || (telemetryModel && Number(telemetryModel.fuelPriceCop)) || DEFAULT_FUEL_PRICE_COP;
    const routineDailyKm = Number(profile.routineDailyKm) || DEFAULT_ROUTINE_DAILY_KM;
    const routeCreditKm = Math.round((0.5 * routineDailyKm) * 10) / 10; // 0.5 * routineDailyKm (e.g. 12 km)
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

    // Compute historical pickup factor from all sessions with odometer readings
    let histOdoEffectiveKm = 0;
    let histOdoPickupKm = 0;

    rawSessions.forEach(s => {
        const d = String(s.date).slice(0, 10);
        const odo = resolveDayOdometerDelta(d, rawLogs);
        if (odo.hasClosing && odo.deltaOdo > 0) {
            const kmWorkReal = Math.max(0, odo.deltaOdo - routineDailyKm);
            const declared = Number(s.workKm || s.distanceKm || s.tripKmTotal || 0);
            if (declared > 0) {
                histOdoEffectiveKm += declared;
                histOdoPickupKm += Math.max(0, kmWorkReal - declared);
            }
        }
    });

    const learnedPickupFactor = histOdoEffectiveKm > 0
        ? (histOdoPickupKm / histOdoEffectiveKm)
        : 0.20; // Default: 20% estimated deadhead pickup if no prior data

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

        // Apply route credit to en_route km
        const creditUsed = Math.min(dayEnRouteKm, routeCreditKm);
        const enRouteDetourKm = Math.max(0, dayEnRouteKm - routeCreditKm); // Desvío excedente
        const dayEffectiveKm = dayFreeKm + enRouteDetourKm; // Km that require fuel

        // Resolve day odometer reading
        const odo = resolveDayOdometerDelta(dateStr, rawLogs);
        let dayPickupKm = 0;

        if (odo.hasClosing && odo.deltaOdo > 0) {
            const kmWorkReal = Math.max(0, odo.deltaOdo - routineDailyKm);
            dayPickupKm = Math.max(0, kmWorkReal - dayEffectiveKm);
        } else {
            dayPickupKm = Math.round((dayEffectiveKm * learnedPickupFactor) * 10) / 10;
        }

        const dayExtraKm = dayEffectiveKm + dayPickupKm;
        const dayFuelCost = Math.round(dayExtraKm * costPerKmCop);

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
        if (!s.type || s.type !== 'ride') {
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
    // Target reference: Full tank cost or cycle fuel
    const tankFuelCostCop = Math.round(tankCapacityGal * fuelPriceCop);
    let fuelCoveredPct = 0;
    if (tankFuelCostCop > 0) {
        fuelCoveredPct = Math.round((freeNetProfitCop / tankFuelCostCop) * 100);
    }

    // Status text for fuel coverage
    let fuelCoveredStatus = '';
    if (freeNetProfitCop <= 0) {
        fuelCoveredStatus = '0% CUBIERTO';
    } else {
        fuelCoveredStatus = `${fuelCoveredPct}% DE UN TANQUE ($${formatCompactCop(tankFuelCostCop)})`;
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

    return {
        cycleType,
        cycleLabel,
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
 * Backward-compatible wrapper for calculateMonthlyRidesSummary.
 */
export function calculateMonthlyRidesSummary(sessions = [], passes = [], profile = {}, telemetryModel = null, monthFilter = null) {
    const summary = calculateRidesCycleSummary({
        sessions,
        passes,
        profile,
        telemetryModel,
        cycleType: 'month'
    });

    // Attach KPI structures for existing callers if any
    const grossPerKm = summary.totalDeclaredKm > 0 ? Math.round(summary.grossRevenueCop / summary.totalDeclaredKm) : 0;
    const realPerKm = summary.totalExtraKm > 0 ? Math.round(summary.freeNetProfitCop / summary.totalExtraKm) : 0;
    const deadheadPct = summary.totalExtraKm > 0 ? Math.round((summary.totalPickupKm / summary.totalExtraKm) * 100) : 0;

    return {
        ...summary,
        totalGrossIncomeCop: summary.grossRevenueCop,
        totalCommissionsCop: summary.totalExpensesCop,
        totalFreeNetProfitCop: summary.freeNetProfitCop,
        kpis: {
            tarifaKm: {
                grossPerTripKm: grossPerKm,
                netRealPerWorkKm: realPerKm,
                formattedTrip: `$${grossPerKm.toLocaleString('es-CO')}`,
                formattedReal: `REAL: $${realPerKm.toLocaleString('es-CO')}/KM`
            },
            deadhead: {
                deadheadPct,
                deadheadRatio: summary.totalDeclaredKm > 0 ? Number((summary.totalExtraKm / summary.totalDeclaredKm).toFixed(2)) : 1,
                formattedPct: `${deadheadPct}%`,
                formattedRatio: `RATIO ${(summary.totalDeclaredKm > 0 ? (summary.totalExtraKm / summary.totalDeclaredKm).toFixed(2) : 1)}X`,
                formattedFooter: `${Math.round(summary.totalDeclaredKm)}K CARRERAS · ${Math.round(summary.totalPickupKm)}K RECOGIDA`
            },
            bestPlatform: {
                formattedBest: 'AGNOSTIC',
                formattedBestRate: `$${grossPerKm.toLocaleString('es-CO')} / KM`,
                formattedRunnerUp: ''
            },
            jornadas: {
                totalRides: summary.ridesCount,
                totalDays: Object.keys(summary.dailyBreakdown || {}).length,
                formattedRidesDays: `${summary.ridesCount} CARRERAS`,
                formattedAvgDaily: ''
            }
        },
        subsidies: {
            meta1: {
                label: 'TANQUE FULL',
                targetCop: summary.tankFuelCostCop,
                clampedPct: Math.min(100, Math.max(0, summary.fuelCoveredPct)),
                statusText: summary.fuelCoveredStatus
            }
        }
    };
}

/**
 * Single session metrics calculator alias.
 */
export function calculateSessionMetrics(session = {}) {
    return {
        grossEarnings: Number(session.grossEarnings || session.grossRevenueCop || 0),
        workKm: Number(session.workKm || session.distanceKm || 0),
        isEnRoute: Boolean(session.isEnRoute || session.tripType === 'en_route')
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
