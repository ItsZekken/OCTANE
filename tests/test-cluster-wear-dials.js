/**
 * OCTANE // KINETIC — Test Suite for Subagent 2A
 * Wear Dial Matrix, 240° SVG Arc Geometry, Maintenance Modal & IndexedDB Auto-seeding.
 */

import assert from 'node:assert/strict';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';

// Provide global indexedDB environment for Node
globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;

import {
    calculateWearDialTelemetry,
    renderWearDialCard,
    buildArcPath,
    polarToCartesian,
    getWearStatusColor,
    calculateWear,
} from '../src/components/cluster/wear-dial-card.js';

import {
    DEFAULT_MAINTENANCE_ITEMS,
    seedDefaultMaintenanceItems,
    getMaintenanceItems,
    saveMaintenanceItem,
    clearAllData,
    openDB
} from '../src/core/db-local.js';

import { getCurrentOdometer } from '../src/views/view-cluster.js';

async function runTests() {
    console.log('--- STARTING SUBAGENT 2A: CLUSTER WEAR DIALS & MAINTENANCE MODAL TESTS ---');

    // TEST 1: Wear Dial Mathematical Telemetry Calculation
    console.log('[TEST 1] Wear Dial Mathematical Formula & Telemetry Calculation...');
    const itemA = {
        id: 'oil',
        name: 'ACEITE + FILTRO',
        intervalKm: 5000,
        lastServiceOdo: 93733,
    };

    // Current odometer: 94895 (spec example)
    // Formula: Math.max(0, (93733 + 5000) - 94895) = 98733 - 94895 = 3838 KM Restantes
    const calc1 = calculateWearDialTelemetry(itemA, 94895);
    assert.equal(calc1.kmRemaining, 3838);
    assert.equal(calc1.intervalKm, 5000);
    assert.equal(calc1.lastServiceOdo, 93733);
    const expectedPct1 = (3838 / 5000) * 100;
    assert.ok(Math.abs(calc1.lifePct - expectedPct1) < 0.001);
    assert.equal(calc1.status, 'nominal');
    assert.equal(calc1.colorVar, 'var(--accent-volt)');
    assert.equal(calc1.hex, '#10B981');
    assert.equal(calc1.isCritical, false);
    assert.equal(calc1.isWarning, false);

    // Overdue/depleted: Current odometer exceeds (lastServiceOdo + intervalKm)
    const calc2 = calculateWearDialTelemetry(itemA, 99000);
    assert.equal(calc2.kmRemaining, 0); // Clamped at 0
    assert.equal(calc2.lifePct, 0);
    assert.equal(calc2.status, 'critical');
    assert.equal(calc2.colorVar, 'var(--accent-crimson)');
    assert.equal(calc2.hex, '#F43F5E');
    assert.equal(calc2.isCritical, true);

    // Warning range (10% - 30%): remaining = 1000 km (20%)
    const calc3 = calculateWearDialTelemetry(itemA, 97733);
    assert.equal(calc3.kmRemaining, 1000);
    assert.equal(calc3.lifePct, 20);
    assert.equal(calc3.status, 'warning');
    assert.equal(calc3.colorVar, 'var(--accent-amber)');
    assert.equal(calc3.hex, '#FF5500');
    assert.equal(calc3.isWarning, true);
    assert.equal(calc3.isCritical, false);

    // Critical range (<10%): remaining = 350 km (7%)
    const calc4 = calculateWearDialTelemetry(itemA, 98383);
    assert.equal(calc4.kmRemaining, 350);
    assert.ok(Math.abs(calc4.lifePct - 7) < 0.001);
    assert.equal(calc4.status, 'critical');
    assert.equal(calc4.colorVar, 'var(--accent-crimson)');
    assert.equal(calc4.isCritical, true);

    console.log('✓ Wear Dial telemetry calculation passed.');

    // TEST 2: SVG 240° Arc Trigonometry
    console.log('[TEST 2] SVG 240° Arc Trigonometry & Coordinates...');
    const cx = 65;
    const cy = 46;
    const radius = 38;

    // Start angle is 150° (bottom-left)
    const ptStart = polarToCartesian(cx, cy, radius, 150);
    // cos(150°) = -0.866025, sin(150°) = 0.5
    assert.ok(Math.abs(ptStart.x - (65 - 38 * 0.866025)) < 0.1);
    assert.ok(Math.abs(ptStart.y - (46 + 38 * 0.5)) < 0.1);

    // End angle is 390° (bottom-right)
    const ptEnd = polarToCartesian(cx, cy, radius, 390);
    assert.ok(Math.abs(ptEnd.x - (65 + 38 * 0.866025)) < 0.1);
    assert.ok(Math.abs(ptEnd.y - (46 + 38 * 0.5)) < 0.1);

    // Full 240° arc path
    const fullArc = buildArcPath(cx, cy, radius, 150, 390);
    assert.ok(fullArc.startsWith('M'));
    assert.ok(fullArc.includes('A 38 38 0 1 1')); // largeArcFlag = 1 for 240°
    console.log('✓ SVG 240° Arc Trigonometry passed.');

    // TEST 3: HTML Markup Verification & Zero <p> Tags
    console.log('[TEST 3] HTML Markup Verification & Absolute Verbal Silence...');
    const cardHtml = renderWearDialCard(itemA, 94895);
    
    // Check required structural elements
    assert.ok(cardHtml.includes('ACEITE + FILTRO'), 'Missing item name');
    assert.ok(cardHtml.includes('3,838'), 'Missing formatted macro-number');
    assert.ok(cardHtml.includes('KM REST.'), 'Missing KM REST. label');
    assert.ok(cardHtml.includes('ÚLT: 93,733 KM'), 'Missing last service odo');
    assert.ok(cardHtml.includes('data-action="history"'), 'Missing history button');
    assert.ok(cardHtml.includes('data-action="reset"'), 'Missing reset button');
    assert.ok(cardHtml.includes('var(--accent-volt)'), 'Missing active volt color');
    assert.ok(cardHtml.includes('var(--line-strong)'), 'Missing background arc line-strong');

    // SILENCIO VERBAL ABSOLUTO: Must contain ZERO <p> tags
    const pTagMatches = cardHtml.match(/<\/?p\b[^>]*>/gi);
    assert.equal(pTagMatches, null, `Forbidden <p> tag detected in wear dial card: ${pTagMatches}`);
    console.log('✓ HTML Markup verified with Silencio Verbal Absoluto (Zero <p> tags).');

    // TEST 4: Auto-seeding of the 6 Default Items in IndexedDB
    console.log('[TEST 4] IndexedDB Auto-Seeding of 6 Canonical Items...');
    await clearAllData();

    // Verify DEFAULT_MAINTENANCE_ITEMS contains exactly the 6 required items
    assert.equal(DEFAULT_MAINTENANCE_ITEMS.length, 6);
    const itemNames = DEFAULT_MAINTENANCE_ITEMS.map(i => i.name);
    assert.ok(itemNames.includes('ACEITE + FILTRO'));
    assert.ok(itemNames.includes('FILTRO CABINA A/C'));
    assert.ok(itemNames.includes('LÍQUIDO FRENOS'));
    assert.ok(itemNames.includes('FILTRO GASOLINA'));
    assert.ok(itemNames.includes('ROTACIÓN LLANTAS'));
    assert.ok(itemNames.includes('BUJÍAS / CORREA'));

    // Check intervals
    const oil = DEFAULT_MAINTENANCE_ITEMS.find(i => i.name === 'ACEITE + FILTRO');
    assert.equal(oil.intervalKm, 5000);
    const cabin = DEFAULT_MAINTENANCE_ITEMS.find(i => i.name === 'FILTRO CABINA A/C');
    assert.equal(cabin.intervalKm, 15000);
    const brake = DEFAULT_MAINTENANCE_ITEMS.find(i => i.name === 'LÍQUIDO FRENOS');
    assert.equal(brake.intervalKm, 30000);
    const fuel = DEFAULT_MAINTENANCE_ITEMS.find(i => i.name === 'FILTRO GASOLINA');
    assert.equal(fuel.intervalKm, 90000);
    const tires = DEFAULT_MAINTENANCE_ITEMS.find(i => i.name === 'ROTACIÓN LLANTAS');
    assert.equal(tires.intervalKm, 10000);
    const plugs = DEFAULT_MAINTENANCE_ITEMS.find(i => i.name === 'BUJÍAS / CORREA');
    assert.equal(plugs.intervalKm, 40000);

    // Call getMaintenanceItems(true) on empty DB -> triggers auto-seeding
    const seeded = await getMaintenanceItems(true);
    assert.equal(seeded.length, 6);
    
    // Check that items are persisted in DB
    const fetched = await getMaintenanceItems();
    assert.equal(fetched.length, 6);

    console.log('✓ IndexedDB auto-seeding of 6 canonical items passed.');

    // TEST 5: Maintenance Item Reset & History Preservation
    console.log('[TEST 5] Maintenance Item Reset & History Array...');
    const oilItem = fetched.find(i => i.name === 'ACEITE + FILTRO');
    assert.ok(oilItem);

    // Simulate reset at 93,733 km with 120,000 COP cost and synthetic oil note
    oilItem.history = oilItem.history || [];
    oilItem.history.unshift({
        id: 'hist_test_1',
        date: '2026-06-15',
        odometer: 93733,
        costCop: 120000,
        notes: '10W-30 SINTÉTICO MOBIL 1',
        previousOdo: 0,
        createdAt: new Date().toISOString()
    });
    oilItem.lastServiceOdo = 93733;
    oilItem.lastServiceDate = '2026-06-15';

    await saveMaintenanceItem(oilItem);

    const reloaded = await getMaintenanceItems();
    const updatedOil = reloaded.find(i => i.id === oilItem.id);
    assert.equal(updatedOil.lastServiceOdo, 93733);
    assert.equal(updatedOil.history.length, 1);
    assert.equal(updatedOil.history[0].odometer, 93733);
    assert.equal(updatedOil.history[0].costCop, 120000);

    console.log('✓ Maintenance reset & history array verified.');

    // TEST 6: Highest Odometer Calculation from Telemetry Logs
    console.log('[TEST 6] Highest Current Odometer Helper...');
    const testLogs = [
        { date: '2026-06-01', odometer_reading: 93000 },
        { date: '2026-06-15', odometer_reading: 94895 },
        { date: '2026-06-10', odometer_reading: 93500 },
    ];
    const highestOdo = getCurrentOdometer(testLogs);
    assert.equal(highestOdo, 94895);
    assert.equal(getCurrentOdometer([]), 0);
    console.log('✓ Highest Current Odometer calculation passed.');

    console.log('===========================================================');
    console.log(' ALL SUBAGENT 2A TESTS PASSED SUCCESSFULLY! ');
    console.log('===========================================================');
}

runTests().catch(err => {
    console.error('Test failed with error:', err);
    process.exit(1);
});
