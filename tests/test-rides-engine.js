/**
 * OCTANE // KINETIC — Unit & Adversarial Tests for Deadhead Engine & Wallet Passes
 * Validates Subagent 3A implementation against Implementation 3.md specifications.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
    calculateCostPerKm,
    resolveDayOdometerDelta,
    calculateDaySummarySession,
    calculateRideByRideSession,
    getActiveDiDiPass,
    calculateInDriveBalance,
    calculateMonthlyRidesSummary,
    formatCompactCop,
    formatCop,
    DEFAULT_ROUTINE_DAILY_KM,
    DEFAULT_FUEL_PRICE_COP,
    DEFAULT_EFFICIENCY_KM_GAL,
    INDRIVE_ESTIMATED_COMMISSION_COP,
    DIDI_PASS_COST_1D,
    DIDI_PASS_COST_3D
} from '../src/core/rides-engine.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ✓ PASS: ${message}`);
        passed++;
    } else {
        console.error(`  ✗ FAIL: ${message}`);
        failed++;
    }
}

console.log('============================================================');
console.log('OCTANE // KINETIC — DEADHEAD ENGINE & WALLET PASSES TESTS');
console.log('============================================================');

// [1/7] Cost per KM Calculations
console.log('\n[1/7] Testing Marginal Cost Per KM (calculateCostPerKm)...');
{
    // Benchmark 16000 COP / 35.2 KM/GAL ≈ $454.55 -> $455
    const cost1 = calculateCostPerKm({ fuelPriceCop: 16000, efficiencyKmGal: 35.2 });
    assert(cost1 === 455, `16000 COP / 35.2 km/gal should yield 455 COP (got ${cost1})`);

    // Benchmark 16000 COP / 35.242 KM/GAL ≈ $454
    const costExact = calculateCostPerKm({ fuelPriceCop: 16000, efficiencyKmGal: 35.242, exact: true });
    assert(Math.round(costExact) === 454, `Cost rounded from 35.242 is 454 COP (got ${costExact})`);

    // From telemetry model
    const mockTelemetry = { fullEraAvgEff: 32.0, fuelPriceCop: 16000 };
    const costTelemetry = calculateCostPerKm({ telemetryModel: mockTelemetry });
    assert(costTelemetry === 500, `16000 COP / 32.0 km/gal from telemetry yields 500 COP (got ${costTelemetry})`);

    // From vehicle profile
    const mockProfile = { defaultEfficiencyKmGal: 40.0, fuelPriceCop: 16000 };
    const costProfile = calculateCostPerKm({ vehicleProfile: mockProfile });
    assert(costProfile === 400, `16000 COP / 40.0 km/gal from profile yields 400 COP (got ${costProfile})`);

    // Default fallback
    const costDefault = calculateCostPerKm();
    const expectedDefault = Math.round(DEFAULT_FUEL_PRICE_COP / DEFAULT_EFFICIENCY_KM_GAL);
    assert(costDefault === expectedDefault, `Default fallback matches expected benchmark (${expectedDefault})`);
}

// [2/7] Telemetry Odometer Resolution
console.log('\n[2/7] Testing Day Odometer Resolution (resolveDayOdometerDelta)...');
{
    const logs = [
        { id: '1', date: '2026-10-18', odometer_reading: 50000 },
        { id: '2', date: '2026-10-19', odometer_reading: 50020 },
        { id: '3', date: '2026-10-19', odometer_reading: 50085 },
        { id: '4', date: '2026-10-20', odometer_reading: 50120 }
    ];

    // Same day with 2 logs: delta = 50085 - 50020 = 65
    const resSameDay = resolveDayOdometerDelta('2026-10-19', logs);
    assert(resSameDay.hasClosing === true, 'Has closing reading on 2026-10-19');
    assert(resSameDay.deltaOdo === 65, `Delta odometer on 2026-10-19 is 65 km (got ${resSameDay.deltaOdo})`);
    assert(resSameDay.isPendingOdometer === false, 'isPendingOdometer is false when 2 logs exist');

    // Single log on day with prior log: delta = 50120 - 50085 = 35
    const resSingle = resolveDayOdometerDelta('2026-10-20', logs);
    assert(resSingle.hasClosing === true, 'Has closing reading resolved from previous day');
    assert(resSingle.deltaOdo === 35, `Delta odometer is 35 km (got ${resSingle.deltaOdo})`);

    // Day with no logs: pending
    const resMissing = resolveDayOdometerDelta('2026-10-21', logs);
    assert(resMissing.hasClosing === false, 'Missing closing reading on future date');
    assert(resMissing.isPendingOdometer === true, 'isPendingOdometer is true when no logs exist');

    // Fallback delta
    const resFallback = resolveDayOdometerDelta('2026-10-21', logs, 42);
    assert(resFallback.deltaOdo === 42, 'Uses fallback delta when explicitly supplied');
}

// [3/7] Modo A (Resumen Día)
console.log('\n[3/7] Testing Modo A: Resumen Día (calculateDaySummarySession)...');
{
    // Spec test case from Implementation 3.md:
    // delta = 65 km, routine = 24 km -> kmWorkReal = 41 km
    // tripKm = 23.9 km -> kmDeadhead = 17.1 km
    // deadheadPct = 17.1 / 41 = 41.7% (~42%)
    // deadheadRatio = 41 / 23.9 = 1.715 (~1.71X)
    // costPerKm = 454 COP -> fuelCost = 41 * 454 = 18614 COP
    // gross = 55800 COP, appCommissions = 0
    // freeNetProfit = 55800 - 0 - 18614 = 37186 COP (~+$37.2K)
    const summary = calculateDaySummarySession({
        date: '2026-10-19',
        grossIncomeCop: 55800,
        appCommissionsCop: 0,
        deltaOdo: 65,
        subtractRoutine: true,
        routineDailyKm: 24,
        tripKmTotal: 23.9,
        costPerKmCop: 454
    });

    assert(summary.kmWorkReal === 41, `kmWorkReal is 41 km (got ${summary.kmWorkReal})`);
    assert(summary.kmDeadhead === 17.1, `kmDeadhead is 17.1 km (got ${summary.kmDeadhead})`);
    assert(summary.deadheadPct === 41.7, `deadheadPct is 41.7% (got ${summary.deadheadPct})`);
    assert(summary.deadheadRatio === 1.72 || summary.deadheadRatio === 1.71, `deadheadRatio is ~1.71X (got ${summary.deadheadRatio})`);
    assert(summary.fuelCostCop === 18614, `fuelCostCop is 18,614 COP (got ${summary.fuelCostCop})`);
    assert(summary.freeNetProfitCop === 37186, `freeNetProfitCop is 37,186 COP (got ${summary.freeNetProfitCop})`);
    assert(summary.isPendingOdometer === false, 'isPendingOdometer is false when deltaOdo is supplied');

    // Without routine subtraction
    const noRoutine = calculateDaySummarySession({
        date: '2026-10-19',
        grossIncomeCop: 55800,
        deltaOdo: 65,
        subtractRoutine: false,
        tripKmTotal: 23.9,
        costPerKmCop: 454
    });
    assert(noRoutine.kmWorkReal === 65, `kmWorkReal without routine is 65 km (got ${noRoutine.kmWorkReal})`);

    // Pending odometer reading
    const pendingSummary = calculateDaySummarySession({
        date: '2026-10-19',
        grossIncomeCop: 55800,
        tripKmTotal: 23.9,
        costPerKmCop: 454
    });
    assert(pendingSummary.isPendingOdometer === true, 'Flag isPendingOdometer is true when no odometer is supplied');
    assert(pendingSummary.kmWorkReal === 23.9, 'Estimates work km with trip km when odometer is pending');
}

// [4/7] Modo B (Carrera x Carrera)
console.log('\n[4/7] Testing Modo B: Carrera x Carrera (calculateRideByRideSession)...');
{
    const rides = [
        { app: 'didi', fareCop: 12321, distanceKm: 2.1, isPassFee: false },
        { app: 'didi', fareCop: 19105, distanceKm: 9.1, isPassFee: false },
        { app: 'indrive', fareCop: 14000, distanceKm: 6.2, indriveDebit: 1375 },
        { app: 'direct', fareCop: 10374, distanceKm: 6.5 }
    ];

    // Total distance = 2.1 + 9.1 + 6.2 + 6.5 = 23.9 km
    // Total fare = 12321 + 19105 + 14000 + 10374 = 55800 COP
    const activePasses = [
        { platform: 'didi', startDate: '2026-10-18', endDate: '2026-10-20', durationDays: 3 }
    ];

    // With odometer closed (delta = 65 km)
    const sessionClosed = calculateRideByRideSession({
        date: '2026-10-19',
        rides,
        deltaOdo: 65,
        subtractRoutine: true,
        routineDailyKm: 24,
        costPerKmCop: 454,
        activePasses
    });

    assert(sessionClosed.tripKmTotal === 23.9, `tripKmTotal is 23.9 km (got ${sessionClosed.tripKmTotal})`);
    assert(sessionClosed.grossIncomeCop === 55800, `grossIncomeCop is 55,800 COP (got ${sessionClosed.grossIncomeCop})`);
    assert(sessionClosed.kmWorkReal === 41, `kmWorkReal is 41 km (got ${sessionClosed.kmWorkReal})`);
    assert(sessionClosed.kmDeadhead === 17.1, `kmDeadhead is 17.1 km (got ${sessionClosed.kmDeadhead})`);
    assert(sessionClosed.appCommissionsCop === 1375, `Commissions should be 1,375 COP (DiDi 0% + InDrive 1375) (got ${sessionClosed.appCommissionsCop})`);
    assert(sessionClosed.fuelCostCop === 18614, `fuelCostCop is 18,614 COP (got ${sessionClosed.fuelCostCop})`);
    assert(sessionClosed.isPendingOdometer === false, 'isPendingOdometer is false when delta is given');

    // Pending odometer closing
    const sessionPending = calculateRideByRideSession({
        date: '2026-10-19',
        rides,
        costPerKmCop: 454,
        activePasses
    });
    assert(sessionPending.isPendingOdometer === true, 'isPendingOdometer is true when closing reading missing');
    assert(sessionPending.kmWorkReal === 23.9, 'Work KM estimated with ride distance');
    assert(sessionPending.kmDeadhead === 0, 'Deadhead KM is 0 while pending');
}

// [5/7] Wallet Passes: DiDi & InDrive
console.log('\n[5/7] Testing Wallet Passes (DiDi & InDrive)...');
{
    const passes = [
        { id: 'p1', platform: 'didi', type: 'pass_3d', durationDays: 3, startDate: '2026-10-18', endDate: '2026-10-20', costCop: 10500 },
        { id: 'p2', platform: 'indrive', type: 'recharge', amountCop: 20000, date: '2026-10-15' }
    ];

    const rideSessions = [
        {
            rides: [
                { app: 'indrive', indriveDebit: 1375 },
                { app: 'indrive', indriveDebit: 1375 }
            ]
        }
    ];

    // DiDi Pass Day 2 of 3 (target 2026-10-19)
    const didiStatus = getActiveDiDiPass(passes, '2026-10-19');
    assert(didiStatus.active === true, 'DiDi pass is active on 2026-10-19');
    assert(didiStatus.currentDay === 2, `DiDi pass is day 2 (got ${didiStatus.currentDay})`);
    assert(didiStatus.label === 'PASE 3D · DÍA 2/3 · 0% COMISIÓN', `Label matches exact format (got ${didiStatus.label})`);

    // Inactive DiDi Pass
    const didiExpired = getActiveDiDiPass(passes, '2026-10-25');
    assert(didiExpired.active === false, 'DiDi pass is inactive on 2026-10-25');
    assert(didiExpired.label === 'SIN PASE ACTIVO', `Inactive label is 'SIN PASE ACTIVO' (got ${didiExpired.label})`);

    // InDrive Balance: 20,000 - 2,750 = 17,250 COP (~12 rides)
    const indriveStatus = calculateInDriveBalance(passes, rideSessions);
    assert(indriveStatus.balanceCop === 17250, `InDrive balance is 17,250 COP (got ${indriveStatus.balanceCop})`);
    assert(indriveStatus.estimatedTripsRemaining === 12, `Estimated trips remaining is 12 (got ${indriveStatus.estimatedTripsRemaining})`);
    assert(indriveStatus.label.includes('17.250') || indriveStatus.label.includes('17,250'), 'Label includes balance amount');
}

// [6/7] Monthly Rides Summary (Subsidies & 2x2 KPIs)
console.log('\n[6/7] Testing Monthly Rides Summary (calculateMonthlyRidesSummary)...');
{
    const sessions = [
        {
            date: '2026-10-15',
            grossIncomeCop: 60000,
            appCommissionsCop: 2000,
            fuelCostCop: 20000,
            tripKmTotal: 25.0,
            kmWorkReal: 44.0,
            kmDeadhead: 19.0,
            ridesCount: 5,
            rides: [
                { app: 'didi', fareCop: 35000, distanceKm: 12.0 },
                { app: 'indrive', fareCop: 25000, distanceKm: 13.0 }
            ]
        },
        {
            date: '2026-10-19',
            grossIncomeCop: 55800,
            appCommissionsCop: 1375,
            fuelCostCop: 18614,
            tripKmTotal: 23.9,
            kmWorkReal: 41.0,
            kmDeadhead: 17.1,
            ridesCount: 4,
            rides: [
                { app: 'didi', fareCop: 31426, distanceKm: 11.2 },
                { app: 'indrive', fareCop: 14000, distanceKm: 6.2 },
                { app: 'direct', fareCop: 10374, distanceKm: 6.5 }
            ]
        }
    ];

    const profile = {
        routineDailyKm: 24,
        fuelPriceCop: 16000,
        tankCapacityGallons: 9.25,
        defaultEfficiencyKmGal: 35.2
    };

    const telemetryModel = {
        fullEraAvgEff: 35.2,
        stats: { avgKmPerDay: 27.5 }
    };

    const summary = calculateMonthlyRidesSummary(sessions, [], profile, telemetryModel, '2026-10');

    // Net free profit: (60000 + 55800) - (2000 + 1375) - (20000 + 18614)
    // = 115800 - 3375 - 38614 = 73811 COP
    assert(summary.freeNetProfitCop === 73811, `freeNetProfitCop is 73,811 COP (got ${summary.freeNetProfitCop})`);
    assert(summary.totalRidesCount === 9, `Total rides count is 9 (got ${summary.totalRidesCount})`);
    assert(summary.totalWorkingDays === 2, `Total working days is 2 (got ${summary.totalWorkingDays})`);

    // Meta 1: Tank Capacity 9.25 gal * 16,000 COP = 148,000 COP
    assert(summary.subsidies.meta1.targetCop === 148000, `Meta 1 target is 148,000 COP (got ${summary.subsidies.meta1.targetCop})`);
    assert(summary.subsidies.meta1.progressPct > 49 && summary.subsidies.meta1.progressPct < 51, `Meta 1 progress is ~50% (got ${summary.subsidies.meta1.progressPct})`);

    // Meta 2: 20 days * 24 km * 455 COP/km = 218,400 COP
    assert(summary.subsidies.meta2.targetCop > 217000 && summary.subsidies.meta2.targetCop < 220000, `Meta 2 target is ~218K COP (got ${summary.subsidies.meta2.targetCop})`);

    // Meta 3: 27.5 km/day * 30 * 455 COP = 375,375 COP
    assert(summary.subsidies.meta3.targetCop > 370000 && summary.subsidies.meta3.targetCop < 380000, `Meta 3 target is ~375K COP (got ${summary.subsidies.meta3.targetCop})`);

    // Matriz 2x2
    assert(summary.kpis.tarifaKm.grossPerTripKm > 2300, `KPI 1 grossPerTripKm is > 2300 (got ${summary.kpis.tarifaKm.grossPerTripKm})`);
    assert(summary.kpis.deadhead.deadheadPct > 40, `KPI 2 deadheadPct is > 40% (got ${summary.kpis.deadhead.deadheadPct}%)`);
    assert(summary.kpis.bestPlatform.best.name === 'DIDI', `KPI 3 best platform is DIDI (got ${summary.kpis.bestPlatform.best.name})`);
    assert(summary.kpis.jornadas.totalRides === 9, `KPI 4 total rides is 9 (got ${summary.kpis.jornadas.totalRides})`);
}

// [7/7] Silencio Verbal Absoluto (Zero <p> tags)
console.log('\n[7/7] Auditing Silencio Verbal Absoluto (Zero <p> Tags)...');
{
    const filesToAudit = [
        'src/core/rides-engine.js',
        'src/components/rides/wallet-passes.js'
    ];

    for (const relPath of filesToAudit) {
        const fullPath = resolve(process.cwd(), relPath);
        const content = readFileSync(fullPath, 'utf-8');
        const pTagMatch = content.match(/<p\b[^>]*>/i);
        assert(!pTagMatch, `Zero <p> tags in ${relPath}`);
    }
}

console.log('============================================================');
console.log(`TEST RUN FINISHED: ${passed} PASSED, ${failed} FAILED`);
console.log('============================================================');

if (failed > 0) {
    process.exit(1);
}
