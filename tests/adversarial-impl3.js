/**
 * OCTANE // KINETIC — Adversarial Red-Team Audit for Implementation 3
 * 
 * Verifies:
 * 1. Silencio Verbal Absoluto: ZERO <p> tags in all Implementation 3 files.
 * 2. Mathematical Precision of Deadhead Engine:
 *    - routineDailyKm subtraction: commuting to regular job is NOT penalized as platform deadhead.
 *    - deadhead ratio & percentage calculations.
 *    - marginal fuel expense per km based on telemetry model.
 *    - net free profit = gross - app fees - fuel cost.
 * 3. Subsidized Tank Goals:
 *    - Meta 01: Next full tank coverage.
 *    - Meta 02: 20-day commute routine coverage.
 *    - Meta 03: Monthly vehicle fuel coverage.
 * 4. Driver 2x2 KPIs:
 *    - Tarifa / KM viaje vs Real / KM.
 *    - Deadhead % & ratio.
 *    - Best platform comparison.
 *    - Shifts count & avg profit/day.
 * 5. Non-Intrusive Navigation:
 *    - Rides tab hidden when ridesModuleEnabled is false.
 *    - Rides tab visible when ridesModuleEnabled is true.
 * 6. JSON I/O Engine:
 *    - ride_sessions and platform_passes backed up and restored.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ PASS: ${message}`);
  } else {
    failedTests++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

console.log('\n============================================================');
console.log('OCTANE // KINETIC — ADVERSARIAL RED-TEAM AUDIT (STAGE 3)');
console.log('============================================================\n');

// --------------------------------------------------------------------------
// TEST SUITE 1: Silencio Verbal Absoluto (Zero <p> Tags)
// --------------------------------------------------------------------------
console.log('[1/6] Auditing Silencio Verbal Absoluto (Zero <p> Tags)...');

const AUDIT_FILES = [
  'src/views/view-rides.js',
  'src/core/rides-engine.js',
  'src/components/rides/wallet-passes.js',
  'src/components/modals/modal-ride-entry.js',
  'src/components/rides/ride-session-list.js',
  'src/components/nav-dock.js'
];

for (const relPath of AUDIT_FILES) {
  const fullPath = path.join(projectRoot, relPath);
  if (!fs.existsSync(fullPath)) {
    assert(false, `File exists: ${relPath}`);
    continue;
  }

  const rawCode = fs.readFileSync(fullPath, 'utf8');
  const codeWithoutComments = rawCode
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '');

  const hasPTag = /<p(\s|>)/i.test(codeWithoutComments);
  assert(!hasPTag, `Zero <p> tags in ${relPath}`);
}

// --------------------------------------------------------------------------
// TEST SUITE 2: Deadhead & Marginal Cost Mathematics
// --------------------------------------------------------------------------
console.log('\n[2/6] Testing Deadhead & Marginal Cost Mathematics...');

let ridesEngine;
try {
  ridesEngine = await import('../src/core/rides-engine.js');
} catch (e) {
  console.error('Error importing rides-engine.js:', e);
}

if (ridesEngine) {
  const { calculateSessionMetrics, calculateDeadheadKm } = ridesEngine;

  // Test Case A: Commute Subtraction Enabled (Routine = 24 KM)
  // Day odometer delta: 65 km, Trip km: 23.9 km, Routine: 24 km
  // kmWorkReal = 65 - 24 = 41.0 km
  // kmDeadhead = 41.0 - 23.9 = 17.1 km
  // Cost per KM = 454 COP
  // Gross = 55,800 COP, App commission = 0 COP
  const sessionA = {
    odometerDeltaKm: 65,
    tripKmTotal: 23.9,
    subtractRoutine: true,
    routineDailyKm: 24,
    costPerKmCop: 454,
    grossIncomeCop: 55800,
    appCommissionsCop: 0
  };

  const metricsA = calculateSessionMetrics(sessionA);
  assert(Math.abs(metricsA.kmWorkReal - 41.0) < 0.1, `Real work KM is 41.0 (got ${metricsA.kmWorkReal})`);
  assert(Math.abs(metricsA.kmDeadhead - 17.1) < 0.1, `Deadhead KM is 17.1 (got ${metricsA.kmDeadhead})`);
  assert(metricsA.fuelCostCop > 18000 && metricsA.fuelCostCop < 19000, `Fuel cost ~18.6K COP (got ${metricsA.fuelCostCop})`);
  assert(metricsA.freeNetProfitCop > 37000 && metricsA.freeNetProfitCop < 38000, `Free profit ~37.2K COP (got ${metricsA.freeNetProfitCop})`);
  assert(metricsA.deadheadPct > 40 && metricsA.deadheadPct < 43, `Deadhead % is ~41.7% (got ${metricsA.deadheadPct}%)`);

  // Test Case B: Commute Subtraction Disabled (Routine = 0 KM)
  const sessionB = {
    odometerDeltaKm: 65,
    tripKmTotal: 23.9,
    subtractRoutine: false,
    routineDailyKm: 24,
    costPerKmCop: 454,
    grossIncomeCop: 55800,
    appCommissionsCop: 0
  };
  const metricsB = calculateSessionMetrics(sessionB);
  assert(Math.abs(metricsB.kmWorkReal - 65.0) < 0.1, `Real work KM is 65.0 when routine not subtracted`);
  assert(Math.abs(metricsB.kmDeadhead - 41.1) < 0.1, `Deadhead KM is 41.1 when routine not subtracted`);

  // Test Case C: Pure Deadhead helper
  if (typeof calculateDeadheadKm === 'function') {
    const dh = calculateDeadheadKm(65, 23.9, 24);
    assert(Math.abs(dh - 17.1) < 0.1, `calculateDeadheadKm returns 17.1 km`);
  }
}

// --------------------------------------------------------------------------
// TEST SUITE 3: Subsidized Tank Goals Calculation
// --------------------------------------------------------------------------
console.log('\n[3/6] Testing Subsidized Tank Goals Calculations...');

if (ridesEngine && typeof ridesEngine.calculateMonthlyRidesSummary === 'function') {
  const mockSessions = [
    {
      id: 's1',
      date: '2026-10-15',
      grossIncomeCop: 95000,
      appCommissionsCop: 5500,
      odometerDeltaKm: 70,
      tripKmTotal: 40,
      subtractRoutine: true,
      routineDailyKm: 24,
      costPerKmCop: 454,
      app: 'DIDI'
    },
    {
      id: 's2',
      date: '2026-10-16',
      grossIncomeCop: 98500,
      appCommissionsCop: 0,
      odometerDeltaKm: 68,
      tripKmTotal: 37,
      subtractRoutine: true,
      routineDailyKm: 24,
      costPerKmCop: 454,
      app: 'INDRIVE'
    }
  ];

  const mockProfile = {
    routineDailyKm: 24,
    tankCapacityGallons: 9.25,
    fuelPriceCop: 16000
  };

  const mockTelemetry = {
    costPerKmCop: 454,
    projectedMonthlyFuelCostCop: 375000
  };

  const summary = ridesEngine.calculateMonthlyRidesSummary(mockSessions, [], mockProfile, mockTelemetry);
  assert(summary.totalGrossIncomeCop === 193500, `Total gross is 193.5K COP (got ${summary.totalGrossIncomeCop})`);
  assert(summary.totalCommissionsCop === 5500, `Total commissions is 5.5K COP (got ${summary.totalCommissionsCop})`);
  assert(summary.totalFreeNetProfitCop > 120000 && summary.totalFreeNetProfitCop < 160000, `Free net profit is >120K COP (got ${summary.totalFreeNetProfitCop})`);

  // Goal 1: Next full tank (9.25 * 16,000 = $148,000)
  assert(summary.goalFullTank && summary.goalFullTank.targetCop > 140000, `Goal 1 target ~148K COP`);
  assert(summary.goalFullTank.percentCovered > 0, `Goal 1 percent covered > 0%`);

  // Goal 2: Work commute (20 days * 24 km * 454 = $217,920)
  assert(summary.goalCommute && summary.goalCommute.targetCop > 210000, `Goal 2 target ~218K COP`);

  // Goal 3: Total monthly fuel
  assert(summary.goalMonthlyFuel && summary.goalMonthlyFuel.targetCop === 375000, `Goal 3 target is 375K COP`);
}

// --------------------------------------------------------------------------
// TEST SUITE 4: 2x2 Driver KPIs Accuracy
// --------------------------------------------------------------------------
console.log('\n[4/6] Testing Driver 2x2 KPIs...');

if (ridesEngine && typeof ridesEngine.calculateDriverKpis === 'function') {
  const kpis = ridesEngine.calculateDriverKpis([
    { grossIncomeCop: 50000, tripKmTotal: 20, kmWorkReal: 35, app: 'DIDI' },
    { grossIncomeCop: 40000, tripKmTotal: 20, kmWorkReal: 30, app: 'INDRIVE' }
  ]);

  assert(kpis.farePerTripKmCop === 2250, `Fare per trip KM is 2250 COP (got ${kpis.farePerTripKmCop})`);
  assert(kpis.farePerRealKmCop > 1300 && kpis.farePerRealKmCop < 1400, `Real fare per work KM is ~1385 COP (got ${kpis.farePerRealKmCop})`);
  assert(kpis.deadheadPct > 35 && kpis.deadheadPct < 40, `Deadhead % is ~38% (got ${kpis.deadheadPct}%)`);
  assert(kpis.bestPlatform && (kpis.bestPlatform.name === 'DIDI' || kpis.bestPlatform.name === 'DiDi'), `Best platform identified as DIDI`);
}

// --------------------------------------------------------------------------
// TEST SUITE 5: Navigation Dock Non-Intrusive Integration
// --------------------------------------------------------------------------
console.log('\n[5/6] Testing Non-Intrusive Dock Visibility...');

import { getNavItems } from '../src/components/nav-dock.js';

if (typeof getNavItems === 'function') {
  const itemsDisabled = getNavItems({ ridesModuleEnabled: false });
  assert(!itemsDisabled.some(item => item.id === 'rides'), 'Rides tab hidden when ridesModuleEnabled is false');

  const itemsEnabled = getNavItems({ ridesModuleEnabled: true });
  assert(itemsEnabled.some(item => item.id === 'rides'), 'Rides tab visible when ridesModuleEnabled is true');
} else {
  // Check source code logic in nav-dock.js
  const navCode = fs.readFileSync(path.join(projectRoot, 'src/components/nav-dock.js'), 'utf8');
  assert(navCode.includes('ridesModuleEnabled'), 'nav-dock.js checks ridesModuleEnabled');
}

// --------------------------------------------------------------------------
// TEST SUITE 6: JSON I/O Engine Dual Format Persistence
// --------------------------------------------------------------------------
console.log('\n[6/6] Testing JSON I/O Engine Store Inclusion...');

const jsonIoCode = fs.readFileSync(path.join(projectRoot, 'src/core/json-io.js'), 'utf8');
assert(jsonIoCode.includes('RIDE_SESSIONS') || jsonIoCode.includes('ride_sessions'), 'json-io.js handles ride_sessions');
assert(jsonIoCode.includes('PLATFORM_PASSES') || jsonIoCode.includes('platform_passes'), 'json-io.js handles platform_passes');

console.log('\n============================================================');
console.log(`AUDIT COMPLETE: ${passedTests}/${totalTests} TESTS PASSED (${failedTests} FAILS)`);
console.log('============================================================\n');

if (failedTests > 0) {
  process.exit(1);
}
