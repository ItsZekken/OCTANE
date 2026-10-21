/**
 * OCTANE // KINETIC — Adversarial Stress & Red Team Test Suite
 * Rigorously attacks Concurrency, Race Conditions, Mathematical Precision,
 * Boundary Conditions, Key Collisions, and Edge Cases.
 */

import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
    openDB,
    STORES,
    DEFAULT_VEHICLE_PROFILE,
    getVehicleProfile,
    saveVehicleProfile,
    getTelemetryLogs,
    getTelemetryLog,
    addTelemetryLog,
    updateTelemetryLog,
    deleteTelemetryLog,
    bulkAddTelemetryLogs,
    clearAllData,
    exportAllStores,
    importAllStores,
    normalizeTelemetryLog
} from '../src/core/db-local.js';

import {
    calculateTelemetryModel,
    formatEff,
    formatVol,
    formatCost,
    formatDateShort,
    isFullTankLog,
    buildInterpolatedDailySeries,
    getActiveTankState,
    calculateWeekdayDNA
} from '../src/core/telemetry-engine.js';

import {
    isFirebaseConfigured,
    initFirebase,
    signInWithGoogle,
    signOutUser,
    syncToCloud,
    pullFromCloud
} from '../src/core/firebase-sync.js';

import { store } from '../src/core/state.js';

const findings = [];

function recordFinding(severity, vector, title, detail) {
    findings.push({ severity, vector, title, detail });
    console.log(`[${severity}] [${vector}] ${title}: ${detail}`);
}

async function runAdversarialAudit() {
    console.log('===============================================================');
    console.log('   OCTANE // KINETIC — ADVERSARIAL RED TEAM AUDIT SUITE       ');
    console.log('===============================================================');

    // ------------------------------------------------------------------------
    // VECTOR 1: CONCURRENCY & RACE CONDITIONS AUDIT
    // ------------------------------------------------------------------------
    console.log('\n>>> AUDITING VECTOR 1: Concurrency & Race Conditions...');

    // Test 1.1: Concurrent openDB calls during app boot
    console.log('Test 1.1: 50 Concurrent openDB() calls...');
    await clearAllData();
    const openPromises = Array.from({ length: 50 }, () => openDB());
    const openResults = await Promise.all(openPromises);
    for (const db of openResults) {
        assert.ok(db, 'openDB() must resolve successfully');
        assert.equal(db.name, 'OctaneKineticDB');
    }
    console.log('✓ 50 concurrent openDB() calls resolved safely.');

    // Test 1.2: 50 Parallel Rapid Mutations to addTelemetryLog
    console.log('Test 1.2: 50 Parallel addTelemetryLog mutations on distinct dates...');
    const parallelWrites = Array.from({ length: 50 }, (_, i) => {
        const day = String(i + 1).padStart(2, '0');
        return addTelemetryLog({
            date: `2026-05-${day}`,
            odometer_reading: 90000 + i * 10,
            fuel_level_percent: 50 + (i % 50),
            refuels_count: 0,
            gallons_added: 0
        });
    });
    await Promise.all(parallelWrites);
    const logsAfterParallel = await getTelemetryLogs();
    assert.equal(logsAfterParallel.length, 50, 'All 50 distinct date records must be persisted');
    console.log('✓ 50 parallel writes with distinct dates succeeded.');

    // Test 1.3: PRIMARY KEY COLLISION & SAME-DAY REFUELS
    console.log('Test 1.3: Testing Key Collision on Same Date...');
    // What if a user records 2 entries on the same date (e.g. morning trip and afternoon refuel)?
    const entryMorning = {
        date: '2026-06-01',
        id: '2026-06-01_morning',
        odometer_reading: 91000,
        fuel_level_percent: 20,
        gallons_added: 0
    };
    const entryAfternoon = {
        date: '2026-06-01',
        id: '2026-06-01_afternoon',
        odometer_reading: 91050,
        fuel_level_percent: 100,
        gallons_added: 7.5,
        is_full_tank: true
    };
    await addTelemetryLog(entryMorning);
    await addTelemetryLog(entryAfternoon);
    const sameDayLogs = (await getTelemetryLogs()).filter(l => l.date === '2026-06-01');
    if (sameDayLogs.length < 2) {
        recordFinding(
            'CRITICAL',
            'VECTOR 1 (CONCURRENCY & DATA LOSS)',
            'Primary Key Collision on Same Date',
            `telemetry_logs uses { keyPath: 'date' } where date is 'YYYY-MM-DD'. Writing two records on the same day overwrote the first record! Morning entry was obliterated. Expected 2 records, got ${sameDayLogs.length}.`
        );
    } else {
        console.log('✓ Multiple entries on same day preserved.');
    }

    // Test 1.4: normalizeTelemetryLog overrides explicit is_full_tank: false
    console.log('Test 1.4: Explicit partial refuel is_full_tank: false override bug...');
    const partialRefuel = normalizeTelemetryLog({
        date: '2026-06-02',
        odometer_reading: 91100,
        fuel_level_percent: 40,
        gallons_added: 3.125, // Fractional gallons!
        is_full_tank: false   // EXPLICITLY FALSE!
    });
    if (partialRefuel.is_full_tank === true) {
        recordFinding(
            'CRITICAL',
            'VECTOR 1 (LOGIC VULNERABILITY)',
            'is_full_tank Flag Overwrite Bug',
            `normalizeTelemetryLog forces is_full_tank = true when gallons_added has decimals (3.125), completely ignoring user's explicit is_full_tank: false!`
        );
    } else {
        console.log('✓ Explicit is_full_tank: false respected.');
    }

    // Test 1.5: Concurrent bulkAdd and exportAllStores
    console.log('Test 1.5: Atomic integrity during simultaneous exportAllStores...');
    const bulkBatch = Array.from({ length: 30 }, (_, i) => ({
        date: `2026-07-${String(i + 1).padStart(2, '0')}`,
        odometer_reading: 92000 + i * 20,
        fuel_level_percent: 60
    }));
    const [exportResult, bulkCount] = await Promise.all([
        exportAllStores(),
        bulkAddTelemetryLogs(bulkBatch)
    ]);
    assert.equal(bulkCount, 30);
    assert.ok(exportResult.stores);
    console.log('✓ Concurrent export and bulkAdd completed without crashing.');

    // ------------------------------------------------------------------------
    // VECTOR 2: MATHEMATICAL PRECISION & EDGE CASES IN "PISTOLA PITA"
    // ------------------------------------------------------------------------
    console.log('\n>>> AUDITING VECTOR 2: Mathematical Precision & Edge Cases...');

    // Test 2.1: Empty array []
    console.log('Test 2.1: Empty logs array []...');
    const emptyModel = calculateTelemetryModel([], DEFAULT_VEHICLE_PROFILE);
    assert.equal(emptyModel.processedData.length, 0);
    assert.equal(emptyModel.fullEraCycles.length, 0);
    assert.equal(emptyModel.dailySeries.length, 0);
    assert.equal(emptyModel.activeTankState, null);
    assert.equal(emptyModel.stats.totalKm, 0);
    assert.equal(emptyModel.stats.totalGallons, 0);
    assert.equal(emptyModel.stats.totalCostCop, 0);
    console.log('✓ Empty array handled safely without throwing.');

    // Test 2.2: 1 single record (empty DB or single initial reading)
    console.log('Test 2.2: 1 single record...');
    const singleRecord = [{
        date: '2026-06-02',
        odometer_reading: 93404,
        fuel_level_percent: 75.5,
        refuels_count: 0,
        gallons_added: 0
    }];
    const singleModel = calculateTelemetryModel(singleRecord, DEFAULT_VEHICLE_PROFILE);
    assert.equal(singleModel.processedData.length, 1);
    assert.equal(singleModel.fullEraCycles.length, 0);
    assert.equal(singleModel.stats.totalKm, 0);
    assert.equal(singleModel.stats.cycleCount, 0);
    assert.ok(Number.isFinite(singleModel.fullEraAvgEff), 'Efficiency must be finite');
    assert.ok(singleModel.activeTankState, 'Active tank state should exist for 1 record');
    assert.equal(singleModel.dailySeries.length, 1, 'Daily series should have 1 entry');
    console.log('✓ Single record handled gracefully.');

    // Test 2.3: Backward and stationary odometer jumps
    console.log('Test 2.3: Odometer jump backward (odometer replacement / typo)...');
    const backwardLogs = [
        { date: '2026-06-01', odometer_reading: 95000, fuel_level_percent: 50 },
        { date: '2026-06-02', odometer_reading: 94000, fuel_level_percent: 50 }, // -1000 km!
        { date: '2026-06-03', odometer_reading: 94000, fuel_level_percent: 50 }  // stationary
    ];
    const backwardModel = calculateTelemetryModel(backwardLogs, DEFAULT_VEHICLE_PROFILE);
    assert.equal(backwardModel.processedData[1].delta_km, 0, 'Negative delta_km must be clamped to 0');
    assert.equal(backwardModel.processedData[2].delta_km, 0, 'Stationary delta_km must be 0');
    console.log('✓ Backward and stationary odometer handled safely.');

    // Test 2.4: 0 gallons refuel and negative gallons
    console.log('Test 2.4: Refuels with 0 gallons or negative gallons...');
    const zeroGalLogs = [
        { date: '2026-07-28', odometer_reading: 95000, fuel_level_percent: 100, gallons_added: 0, is_full_tank: true },
        { date: '2026-07-30', odometer_reading: 95300, fuel_level_percent: 100, gallons_added: -2, is_full_tank: true }
    ];
    const zeroGalModel = calculateTelemetryModel(zeroGalLogs, DEFAULT_VEHICLE_PROFILE);
    assert.equal(zeroGalModel.fullEraCycles.length, 0, 'Zero or negative gallons must NOT create a closed cycle');
    console.log('✓ Zero and negative gallons filtered out of cycles.');

    // Test 2.5: Consecutive refuels with 0 km driven between them
    console.log('Test 2.5: Consecutive refuels with 0 km driven between them...');
    const zeroKmRefuels = [
        { date: '2026-07-28', odometer_reading: 95000, fuel_level_percent: 100, gallons_added: 7.0, is_full_tank: true },
        { date: '2026-07-28', odometer_reading: 95000, fuel_level_percent: 100, gallons_added: 0.5, is_full_tank: true }
    ];
    const zeroKmModel = calculateTelemetryModel(zeroKmRefuels, DEFAULT_VEHICLE_PROFILE);
    if (zeroKmModel.fullEraCycles.length > 0) {
        const cycle = zeroKmModel.fullEraCycles[0];
        assert.equal(cycle.dist, 0);
        assert.equal(cycle.eff, 0);
        assert.ok(Number.isFinite(cycle.kmPerDay), 'kmPerDay must be finite, not NaN');
        console.log('✓ Consecutive refuels at same odometer resolved without division by zero.');
    }

    // Test 2.6: Dates out of order or invalid date strings
    console.log('Test 2.6: Non-chronological and invalid dates...');
    const unchronologicalLogs = [
        { date: '2026-08-15', odometer_reading: 96000, fuel_level_percent: 80 },
        { date: '2026-07-01', odometer_reading: 95000, fuel_level_percent: 90 },
        { date: '2026-07-20', odometer_reading: 95500, fuel_level_percent: 40 }
    ];
    const unchronoModel = calculateTelemetryModel(unchronologicalLogs, DEFAULT_VEHICLE_PROFILE);
    assert.equal(unchronoModel.processedData[0].date, '2026-07-01', 'Must sort chronologically ascending');
    assert.equal(unchronoModel.processedData[1].date, '2026-07-20');
    assert.equal(unchronoModel.processedData[2].date, '2026-08-15');
    console.log('✓ Sorting works correctly for unsorted input.');

    // Test 2.7: Extreme numbers (1,000,000 km, tiny decimal gallons)
    console.log('Test 2.7: Extreme numbers...');
    const extremeLogs = [
        { date: '2026-07-28', odometer_reading: 1000000, fuel_level_percent: 100, gallons_added: 0.001, is_full_tank: true },
        { date: '2026-07-29', odometer_reading: 1000500, fuel_level_percent: 100, gallons_added: 0.001, is_full_tank: true }
    ];
    const extremeModel = calculateTelemetryModel(extremeLogs, DEFAULT_VEHICLE_PROFILE);
    assert.ok(Number.isFinite(extremeModel.fullEraCycles[0].eff));
    console.log('✓ Extreme numbers handled without arithmetic overflow.');

    // Test 2.8: Real 92-reading dataset verification (consistency check)
    console.log('Test 2.8: Real 92-reading dataset telemetry verification...');
    const realSampleJson = fs.readFileSync('./tests/spicy_sample.json', 'utf-8');
    const realLogs = JSON.parse(realSampleJson);
    const realModel = calculateTelemetryModel(realLogs, DEFAULT_VEHICLE_PROFILE, { scope: 'full_era' });
    console.log(`Real dataset: ${realModel.fullEraCycles.length} closed full era cycles, fullEraAvgEff: ${realModel.fullEraAvgEff} KM/GAL`);
    assert.ok(realModel.fullEraCycles.length > 5, 'Should have multiple closed cycles');
    assert.ok(realModel.fullEraAvgEff > 25 && realModel.fullEraAvgEff < 45, `fullEraAvgEff ${realModel.fullEraAvgEff} must be in plausible range (25-45 KM/GAL)`);
    console.log('✓ Real dataset mathematical calculations consistent.');

    // ------------------------------------------------------------------------
    // VECTOR 3: CANVAS, DPI, TOUCH & MEMORY LEAKS
    // ------------------------------------------------------------------------
    console.log('\n>>> AUDITING VECTOR 3: Canvas, DPI, Touch & Memory Leaks...');

    // Test 3.1: Canvas requestAnimationFrame memory leak on view switch
    console.log('Test 3.1: Checking requestAnimationFrame leaks in view-cockpit.js and view-settings.js...');
    const cockpitSource = fs.readFileSync('./src/views/view-cockpit.js', 'utf-8');
    const settingsSource = fs.readFileSync('./src/views/view-settings.js', 'utf-8');
    const mainSource = fs.readFileSync('./src/main.js', 'utf-8');
    const sightGlassSource = fs.readFileSync('./src/components/fuel-gauges/gauge-sight-glass.js', 'utf-8');

    // Check if view-settings cleans up livePreviewGaugeInstance
    if (!settingsSource.includes('export function destroySettingsView') && !mainSource.includes('destroySettingsView')) {
        recordFinding(
            'HIGH',
            'VECTOR 3 (ANIMATION & MEMORY LEAK)',
            'Settings Gauge Animation Loop Leak on Navigation',
            'view-settings.js mounts livePreviewGaugeInstance (which runs requestAnimationFrame in sight-glass mode) but has NO destroy/cleanup function exported or invoked in main.js navigateTo(). Leaving settings leaves the canvas loop running forever.'
        );
    }

    // Check if view-cockpit cleans up properly
    assert.ok(cockpitSource.includes('cancelAnimationFrame'), 'view-cockpit.js must cancel animation frame in destroyCockpit');
    assert.ok(mainSource.includes('destroyCockpit()'), 'main.js must call destroyCockpit when leaving cockpit');

    // Check pointer events: lostpointercapture / pointercancel
    const controllerSource = fs.readFileSync('./src/components/fuel-gauges/gauge-controller.js', 'utf-8');
    if (!controllerSource.includes('lostpointercapture')) {
        recordFinding(
            'MEDIUM',
            'VECTOR 3 (POINTER EVENT ROBUSTNESS)',
            'Missing lostpointercapture listener',
            'gauge-controller.js attaches pointerdown/pointermove/pointerup/pointercancel but does not listen for lostpointercapture. If pointer capture is abruptly lost (e.g. system gesture, alt-tab), drag state may remain active.'
        );
    }

    // Check touch-action: none on all gauge components
    if (!controllerSource.includes('touchAction = \'none\'')) {
        recordFinding('HIGH', 'VECTOR 3 (TOUCH INTERACTION)', 'Missing touchAction none on gauge target', 'Touch scrolling is not prevented during gauge scrubbing.');
    } else {
        console.log('✓ touch-action: none is properly configured.');
    }

    // ------------------------------------------------------------------------
    // VECTOR 4: SWISS DESIGN SYSTEM & "OCTANE // KINETIC" COMPLIANCE
    // ------------------------------------------------------------------------
    console.log('\n>>> AUDITING VECTOR 4: Swiss Design System & Tokens Compliance...');
    const tokensCss = fs.readFileSync('./src/style/tokens.css', 'utf-8');

    // Check palette tokens
    const requiredTokens = [
        '--bg-void: #09090B',
        '--bg-surface: #0E0E11',
        '--bg-elevated: #141418',
        '--text-primary: #F4F4F6',
        '--accent-amber: #FF5500',
        '--accent-volt: #10B981',
        '--accent-crimson: #F43F5E',
        '--accent-cyan: #38BDF8'
    ];
    for (const token of requiredTokens) {
        assert.ok(tokensCss.includes(token), `Missing design token: ${token}`);
    }
    console.log('✓ All 8 core OCTANE color tokens present.');

    // Check for forbidden drop-shadows or bevels in gauge SVG code
    const arcGaugeSource = fs.readFileSync('./src/components/fuel-gauges/gauge-spicy-arc.js', 'utf-8');
    const analogGaugeSource = fs.readFileSync('./src/components/fuel-gauges/gauge-analog-180.js', 'utf-8');

    if (arcGaugeSource.includes('feDropShadow') || analogGaugeSource.includes('feDropShadow')) {
        recordFinding(
            'MEDIUM',
            'VECTOR 4 (SWISS DESIGN COMPLIANCE)',
            'feDropShadow SVG Filter in Gauges',
            'gauge-spicy-arc.js and gauge-analog-180.js use <feDropShadow> for needle glow. Swiss design strictly mandates zero box-shadows and flat hairline aesthetics.'
        );
    }

    if (sightGlassSource.includes('shadow-inner')) {
        recordFinding(
            'MEDIUM',
            'VECTOR 4 (SWISS DESIGN COMPLIANCE)',
            'shadow-inner in Sight Glass Gauge',
            'gauge-sight-glass.js uses Tailwind "shadow-inner" class. Swiss design rules prohibit box-shadows.'
        );
    }

    // ------------------------------------------------------------------------
    // VECTOR 5: BUILD & PACKAGING VERIFICATION
    // ------------------------------------------------------------------------
    console.log('\n>>> AUDITING VECTOR 5: Build & Packaging Verification...');
    const viteConfig = fs.readFileSync('./vite.config.js', 'utf-8');
    if (!viteConfig.includes('manualChunks')) {
        recordFinding(
            'HIGH',
            'VECTOR 5 (BUILD OPTIMIZATION)',
            'Missing Rollup manualChunks configuration',
            'Vite produces a single monolithic JS bundle >624kB with a warning (!) Some chunks are larger than 500 kB. Firebase should be isolated into a vendor chunk.'
        );
    }

    console.log('\n===============================================================');
    console.log(` AUDIT COMPLETE: ${findings.length} FINDINGS DETECTED`);
    console.log('===============================================================');
    return findings;
}

runAdversarialAudit().catch(err => {
    console.error('AUDIT RUNTIME CRASH:', err);
    process.exit(1);
});
