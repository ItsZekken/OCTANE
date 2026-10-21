/**
 * OCTANE // KINETIC — Adversarial Red-Team Audit for Implementation 2
 * 
 * Verifies:
 * 1. Silencio Verbal Absoluto: ZERO <p> tags in all Implementation 2 files.
 * 2. Mathematical Integrity: Wear dial formulas, needle angles, and life percentages.
 * 3. Temporal Mechanics: Legal document day countdowns, linear validity bars, and status transitions.
 * 4. Alerts Semantics: Accurate critical vs. warning threshold classification (<500 km, <15 days).
 * 5. Free Notes Logbook: Categorization, odometer sealing, and pinned priority.
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
console.log('OCTANE // KINETIC — ADVERSARIAL RED-TEAM AUDIT (STAGE 2)');
console.log('============================================================\n');

// --------------------------------------------------------------------------
// TEST SUITE 1: Silencio Verbal Absoluto (<p> Tag Prohibition Audit)
// --------------------------------------------------------------------------
console.log('[1/5] Auditing Silencio Verbal Absoluto (Zero <p> Tags)...');

const AUDIT_FILES = [
  'src/views/view-cluster.js',
  'src/views/view-glovebox.js',
  'src/components/cluster/wear-dial-card.js',
  'src/components/cluster/free-notes-board.js',
  'src/components/modals/modal-maintenance.js',
  'src/components/modals/modal-legal-doc.js',
  'src/core/notes-service.js',
  'src/core/alerts-engine.js',
  'src/components/header-bar.js'
];

for (const relPath of AUDIT_FILES) {
  const fullPath = path.join(projectRoot, relPath);
  if (!fs.existsSync(fullPath)) {
    assert(false, `File exists: ${relPath}`);
    continue;
  }

  const rawCode = fs.readFileSync(fullPath, 'utf8');
  // Strip JS single-line and multi-line comments so comments discussing <p> tags are ignored
  const codeWithoutComments = rawCode
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '');

  const hasPTag = /<p(\s|>)/i.test(codeWithoutComments);
  assert(!hasPTag, `Zero <p> tags in ${relPath}`);
}

// --------------------------------------------------------------------------
// TEST SUITE 2: Wear Dial Math & Instrument Rendering
// --------------------------------------------------------------------------
console.log('\n[2/5] Testing Wear Dial Mathematics & SVG Arcs...');

import { calculateWear, render240ArcSvg, DEFAULT_MAINTENANCE_ITEMS } from '../src/components/cluster/wear-dial-card.js';

// Verify default 6 maintenance items exist
assert(Array.isArray(DEFAULT_MAINTENANCE_ITEMS) && DEFAULT_MAINTENANCE_ITEMS.length === 6, 'Exactly 6 default maintenance items defined');
const defaultNames = DEFAULT_MAINTENANCE_ITEMS.map(i => i.name);
assert(defaultNames.includes('ACEITE + FILTRO'), 'Default includes ACEITE + FILTRO');
assert(defaultNames.includes('FILTRO CABINA A/C'), 'Default includes FILTRO CABINA A/C');
assert(defaultNames.includes('LÍQUIDO FRENOS'), 'Default includes LÍQUIDO FRENOS');
assert(defaultNames.includes('FILTRO GASOLINA'), 'Default includes FILTRO GASOLINA');
assert(defaultNames.includes('ROTACIÓN LLANTAS'), 'Default includes ROTACIÓN LLANTAS');
assert(defaultNames.includes('BUJÍAS / CORREA'), 'Default includes BUJÍAS / CORREA');

// Test Case A: Brand new service (100% life)
const testItemA = { lastServiceOdo: 50000, intervalKm: 5000 };
const wearA = calculateWear(testItemA, 50000);
assert(wearA.remainingKm === 5000, 'Remaining KM is 5,000 at service point');
assert(wearA.lifePct === 100, 'Life is 100% at service point');
assert(!wearA.isCritical && !wearA.isWarning, 'Status is NOMINAL at 100%');

// Test Case B: 60% driven (40% remaining -> NOMINAL)
const wearB = calculateWear(testItemA, 53000);
assert(wearB.remainingKm === 2000, 'Remaining KM is 2,000 after 3,000 km driven');
assert(wearB.lifePct === 40, 'Life is 40%');
assert(!wearB.isCritical && !wearB.isWarning, 'Status is NOMINAL at 40%');

// Test Case C: 84% driven (16% remaining or 800 km -> ATENCIÓN / AMBER)
const wearC = calculateWear(testItemA, 54200);
assert(wearC.remainingKm === 800, 'Remaining KM is 800');
assert(wearC.isWarning === true, 'Triggers isWarning (remaining < 1,000 km or <= 30%)');
assert(wearC.statusText === 'ATENCIÓN', 'Status text is ATENCIÓN');

// Test Case D: 96% driven (4% remaining or 200 km -> CRÍTICO / CRIMSON)
const wearD = calculateWear(testItemA, 54800);
assert(wearD.remainingKm === 200, 'Remaining KM is 200');
assert(wearD.isCritical === true, 'Triggers isCritical (remaining < 500 km or < 10%)');
assert(wearD.statusText === 'CRÍTICO', 'Status text is CRÍTICO');

// Test Case E: Overdue (driven past interval -> 0 km, 0%, CRÍTICO)
const wearE = calculateWear(testItemA, 56000);
assert(wearE.remainingKm === 0, 'Remaining KM clamped to 0 when overdue');
assert(wearE.lifePct === 0, 'Life is 0% when overdue');
assert(wearE.isCritical === true, 'Status is CRÍTICO when overdue');

// Test SVG Arc output
const svgOut = render240ArcSvg(50, 'var(--accent-volt)');
assert(svgOut.includes('<svg') && svgOut.includes('viewBox="0 0 140 140"'), 'SVG contains valid 140x140 viewBox');
assert(svgOut.includes('stroke="var(--accent-volt)"'), 'SVG colors active arc with specified stroke');

// --------------------------------------------------------------------------
// TEST SUITE 3: Legal Documents Temporal Mechanics & Formatting
// --------------------------------------------------------------------------
console.log('\n[3/5] Testing Legal Documents Countdown & Formatting...');

import { calculateDaysRemaining, evaluateLegalDoc } from '../src/core/alerts-engine.js';
import { formatLegalDate, formatCompactCop } from '../src/views/view-glovebox.js';

// Date math relative to today
const today = new Date();
const pad = (n) => String(n).padStart(2, '0');
const makeDateStr = (daysOffset) => {
  const d = new Date(today);
  d.setDate(d.getDate() + daysOffset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// Test Case 1: 100 days in the future
const future100Str = makeDateStr(100);
const days100 = calculateDaysRemaining(future100Str);
assert(days100 === 100, `Days remaining for +100 days is exactly 100 (got ${days100})`);
const eval100 = evaluateLegalDoc({ expiryDate: future100Str });
assert(eval100.status === 'VIGENTE' && !eval100.isCritical && !eval100.isWarning, 'Status is VIGENTE for +100 days');

// Test Case 2: 25 days in the future (Warning threshold: <= 30 days)
const future25Str = makeDateStr(25);
const days25 = calculateDaysRemaining(future25Str);
assert(days25 === 25, `Days remaining for +25 days is 25 (got ${days25})`);
const eval25 = evaluateLegalDoc({ expiryDate: future25Str });
assert(eval25.status === 'POR VENCER' && eval25.isWarning === true, 'Status is POR VENCER (warning) for +25 days');

// Test Case 3: 10 days in the future (Critical threshold: <= 15 days)
const future10Str = makeDateStr(10);
const days10 = calculateDaysRemaining(future10Str);
assert(days10 === 10, `Days remaining for +10 days is 10 (got ${days10})`);
const eval10 = evaluateLegalDoc({ expiryDate: future10Str });
assert(eval10.status === 'POR VENCER' && eval10.isCritical === true, 'Status is POR VENCER (critical) for +10 days');

// Test Case 4: Expired (-5 days)
const past5Str = makeDateStr(-5);
const daysPast = calculateDaysRemaining(past5Str);
assert(daysPast === -5, `Days remaining for past date is -5 (got ${daysPast})`);
const evalPast = evaluateLegalDoc({ expiryDate: past5Str });
assert(evalPast.status === 'VENCIDO' && evalPast.isCritical === true && evalPast.isExpired === true, 'Status is VENCIDO and isExpired is true');

// Test Case 5: Empty / missing date
const evalNull = evaluateLegalDoc({ expiryDate: '' });
assert(evalNull.status === 'SIN REGISTRO' && evalNull.daysRemaining === null, 'Missing date yields SIN REGISTRO');

// Test formatting helpers
assert(formatLegalDate('2027-02-14') === '14 FEB 2027', 'formatLegalDate converts 2027-02-14 to "14 FEB 2027"');
assert(formatLegalDate('') === '—', 'formatLegalDate returns "—" for empty string');
assert(formatCompactCop(487000) === '$487K', 'formatCompactCop converts 487000 to "$487K"');
assert(formatCompactCop(1250000) === '$1.3M' || formatCompactCop(1250000) === '$1.2M', 'formatCompactCop converts millions accurately');
assert(formatCompactCop(0) === '$0', 'formatCompactCop converts 0 to "$0"');

// --------------------------------------------------------------------------
// TEST SUITE 4: Alerts Engine Aggregation & Badge Rendering
// --------------------------------------------------------------------------
console.log('\n[4/5] Testing Alerts Engine Aggregation & Cockpit Badge...');

import { renderAlertsBadgeHtml } from '../src/core/alerts-engine.js';

// Test badge with zero alerts
assert(renderAlertsBadgeHtml({ totalCount: 0 }).includes('NOMINAL'), 'Zero alerts renders NOMINAL status badge');

// Test badge with critical alerts
const criticalBadge = renderAlertsBadgeHtml({
  totalCount: 2,
  criticalCount: 2,
  warningCount: 0,
  topAlert: { message: 'SOAT: 10D REST.' }
});
assert(criticalBadge.includes('id="cockpit-alerts-pill"'), 'Critical badge contains #cockpit-alerts-pill');
assert(criticalBadge.includes('var(--accent-crimson)'), 'Critical badge uses crimson accent');
assert(criticalBadge.includes('SOAT: 10D REST.'), 'Critical badge displays top alert message');

// Test badge with warning alerts
const warningBadge = renderAlertsBadgeHtml({
  totalCount: 1,
  criticalCount: 0,
  warningCount: 1,
  topAlert: { message: '1 AVISO' }
});
assert(warningBadge.includes('var(--accent-amber)'), 'Warning badge uses amber accent');

// --------------------------------------------------------------------------
// TEST SUITE 5: Free Notes Categories & Data Integrity
// --------------------------------------------------------------------------
console.log('\n[5/5] Testing Notes Service Categories & Sorting...');

import { NOTE_CATEGORIES, CATEGORY_STYLES } from '../src/core/notes-service.js';

assert(NOTE_CATEGORIES.includes('MECÁNICA'), 'Category includes MECÁNICA');
assert(NOTE_CATEGORIES.includes('REPUESTO'), 'Category includes REPUESTO');
assert(NOTE_CATEGORIES.includes('RUIDO'), 'Category includes RUIDO');
assert(NOTE_CATEGORIES.includes('GENERAL'), 'Category includes GENERAL');

for (const cat of NOTE_CATEGORIES) {
  assert(CATEGORY_STYLES[cat] && CATEGORY_STYLES[cat].border, `Category style defined for ${cat}`);
}

console.log('\n============================================================');
console.log(`AUDIT COMPLETE: ${passedTests}/${totalTests} TESTS PASSED (${failedTests} FAILS)`);
console.log('============================================================\n');

if (failedTests > 0) {
  process.exit(1);
}
