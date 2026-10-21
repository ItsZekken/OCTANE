/**
 * Test Suite: Guantera Legal & Semáforo de Alertas (SUBAGENTE 2C)
 */

import {
    calculateDaysRemaining,
    evaluateLegalDoc,
    evaluateMaintenanceItem,
    calculateActiveAlerts,
    renderAlertsBadgeHtml
} from '../src/core/alerts-engine.js';

import {
    formatLegalDate,
    formatCostCop
} from '../src/views/view-glovebox.js';

import fs from 'fs';
import path from 'path';

console.log('--- STARTING SUBAGENTE 2C TESTS (GUANTERA & ALERTS) ---');

// TEST 1: Date countdown calculations
console.log('[TEST 1] calculateDaysRemaining logic...');
const fixedBase = new Date(2026, 9, 20); // 2026-10-20

const daysIn10 = calculateDaysRemaining('2026-10-30', fixedBase);
if (daysIn10 !== 10) throw new Error(`Expected 10 days, got ${daysIn10}`);

const daysToday = calculateDaysRemaining('2026-10-20', fixedBase);
if (daysToday !== 0) throw new Error(`Expected 0 days, got ${daysToday}`);

const daysPast = calculateDaysRemaining('2026-10-15', fixedBase);
if (daysPast !== -5) throw new Error(`Expected -5 days, got ${daysPast}`);

const invalidDays = calculateDaysRemaining('invalid-date', fixedBase);
if (invalidDays !== null) throw new Error(`Expected null for invalid date`);
console.log('✓ calculateDaysRemaining passed.');

// TEST 2: Legal Doc evaluation (Critical < 15, Warning < 30, Nominal >= 30, Expired <= 0)
console.log('[TEST 2] evaluateLegalDoc classifications...');

const expiredDoc = evaluateLegalDoc({ id: '1', title: 'SOAT', expiryDate: '2026-10-10' }, fixedBase);
if (expiredDoc.status !== 'VENCIDO' || expiredDoc.severity !== 'critical') {
    throw new Error(`Expired doc failed: ${JSON.stringify(expiredDoc)}`);
}

const criticalDoc = evaluateLegalDoc({ id: '2', title: 'SOAT', expiryDate: '2026-10-28' }, fixedBase); // 8 days
if (criticalDoc.severity !== 'critical' || criticalDoc.daysRemaining !== 8) {
    throw new Error(`Critical doc failed: ${JSON.stringify(criticalDoc)}`);
}

const warningDoc = evaluateLegalDoc({ id: '3', title: 'TECNOMECÁNICA', expiryDate: '2026-11-10' }, fixedBase); // 21 days
if (warningDoc.severity !== 'warning' || warningDoc.daysRemaining !== 21) {
    throw new Error(`Warning doc failed: ${JSON.stringify(warningDoc)}`);
}

const nominalDoc = evaluateLegalDoc({ id: '4', title: 'IMPUESTO', expiryDate: '2027-02-14' }, fixedBase);
if (nominalDoc.severity !== 'nominal' || nominalDoc.daysRemaining < 30) {
    throw new Error(`Nominal doc failed: ${JSON.stringify(nominalDoc)}`);
}

const unregDoc = evaluateLegalDoc({ id: '5', title: 'PÓLIZA' });
if (unregDoc.severity !== 'none' || unregDoc.status !== 'SIN REGISTRO') {
    throw new Error(`Unregistered doc failed: ${JSON.stringify(unregDoc)}`);
}
console.log('✓ evaluateLegalDoc classifications passed.');

// TEST 3: Maintenance Wear evaluation (< 500 km critical, < 1000 km warning)
console.log('[TEST 3] evaluateMaintenanceItem classifications...');

// Last service 90,000, interval 5,000 -> target 95,000
// Current odo: 94,800 -> 200 km remaining (< 500 km) -> critical
const maintCritical = evaluateMaintenanceItem({ name: 'ACEITE + FILTRO', lastServiceOdo: 90000, intervalKm: 5000 }, 94800);
if (maintCritical.severity !== 'critical' || maintCritical.kmRemaining !== 200) {
    throw new Error(`Maintenance critical failed: ${JSON.stringify(maintCritical)}`);
}

// Current odo: 94,200 -> 800 km remaining (< 1000 km) -> warning
const maintWarning = evaluateMaintenanceItem({ name: 'ACEITE + FILTRO', lastServiceOdo: 90000, intervalKm: 5000 }, 94200);
if (maintWarning.severity !== 'warning' || maintWarning.kmRemaining !== 800) {
    throw new Error(`Maintenance warning failed: ${JSON.stringify(maintWarning)}`);
}

// Current odo: 92,000 -> 3000 km remaining -> nominal
const maintNominal = evaluateMaintenanceItem({ name: 'ACEITE + FILTRO', lastServiceOdo: 90000, intervalKm: 5000 }, 92000);
if (maintNominal.severity !== 'nominal' || maintNominal.kmRemaining !== 3000) {
    throw new Error(`Maintenance nominal failed: ${JSON.stringify(maintNominal)}`);
}
console.log('✓ evaluateMaintenanceItem classifications passed.');

// TEST 4: calculateActiveAlerts aggregation
console.log('[TEST 4] calculateActiveAlerts pure aggregation...');
const aggregated = calculateActiveAlerts({
    legalDocs: [
        { id: '1', title: 'SOAT', expiryDate: '2026-10-25' }, // critical (5 days)
        { id: '2', title: 'TECNOMECÁNICA', expiryDate: '2026-11-05' }, // warning (16 days)
        { id: '3', title: 'IMPUESTO', expiryDate: '2027-02-14' }, // nominal
    ],
    maintenanceItems: [
        { name: 'ACEITE + FILTRO', lastServiceOdo: 90000, intervalKm: 5000 }, // 300 km left -> critical
        { name: 'ROTACIÓN', lastServiceOdo: 89300, intervalKm: 10000 }, // nominal
    ],
    currentOdo: 94700,
    fromDate: fixedBase
});

if (aggregated.criticalCount !== 2) throw new Error(`Expected 2 critical alerts, got ${aggregated.criticalCount}`);
if (aggregated.warningCount !== 1) throw new Error(`Expected 1 warning alert, got ${aggregated.warningCount}`);
if (!aggregated.hasCritical) throw new Error(`Expected hasCritical === true`);
if (aggregated.statusSummary !== 'CRÍTICO') throw new Error(`Expected CRÍTICO summary, got ${aggregated.statusSummary}`);
console.log('✓ calculateActiveAlerts passed.');

// TEST 5: Formatting helpers in Glovebox
console.log('[TEST 5] formatLegalDate & formatCostCop...');
const fDate = formatLegalDate('2027-02-14');
if (fDate !== '14 FEB 2027') throw new Error(`Expected '14 FEB 2027', got '${fDate}'`);

const fCost1 = formatCostCop(487000);
if (fCost1 !== '$487K') throw new Error(`Expected '$487K', got '${fCost1}'`);

const fCost2 = formatCostCop(1250000);
if (fCost2 !== '$1.3M' && fCost2 !== '$1.25M' && fCost2 !== '$1.2M') {
    throw new Error(`Cost format issue: got '${fCost2}'`);
}

const fCostZero = formatCostCop(0);
if (fCostZero !== '$0') throw new Error(`Expected '$0', got '${fCostZero}'`);
console.log('✓ Glovebox formatters passed.');

// TEST 6: Silencio Verbal Absoluto (<p> tag prohibition audit)
console.log('[TEST 6] Silencio Verbal Absoluto (<p> tag audit)...');
const filesToAudit = [
    'src/core/alerts-engine.js',
    'src/components/modals/modal-legal-doc.js',
    'src/views/view-glovebox.js'
];

for (const relPath of filesToAudit) {
    const fullPath = path.resolve(process.cwd(), relPath);
    const content = fs.readFileSync(fullPath, 'utf8');
    const pTagRegex = /<p\b[^>]*>|<\/p>/i;
    if (pTagRegex.test(content)) {
        throw new Error(`VIOLATION OF SILENCIO VERBAL ABSOLUTO: <p> tag found in ${relPath}`);
    }
}
console.log('✓ Silencio Verbal Absoluto (<p> tag audit) passed: ZERO <p> tags found.');

console.log('==============================================');
console.log(' ALL SUBAGENTE 2C TESTS PASSED SUCCESSFULLY!  ');
console.log('==============================================');
