/**
 * OCTANE // KINETIC — Comprehensive Unit Test Suite
 * Validates State, IndexedDB (7 Stores), JSON I/O, and Firebase Sync fallback.
 */

import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import { store, createStore, playHorologyTick, showToast, INITIAL_STATE } from '../src/core/state.js';
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
    getMaintenanceItems,
    saveMaintenanceItem,
    deleteMaintenanceItem,
    getFreeNotes,
    saveFreeNote,
    deleteFreeNote,
    getLegalDocs,
    saveLegalDoc,
    deleteLegalDoc,
    getRideSessions,
    saveRideSession,
    deleteRideSession,
    getPlatformPasses,
    savePlatformPass,
    deletePlatformPass,
    clearAllData,
    exportAllStores,
    importAllStores
} from '../src/core/db-local.js';
import { importFromJSONString } from '../src/core/json-io.js';
import { isFirebaseConfigured, initFirebase, signInWithGoogle, signOutUser, syncToCloud } from '../src/core/firebase-sync.js';

async function runTests() {
    console.log('--- STARTING OCTANE // KINETIC CORE TESTS ---');

    // 1. STATE STORE TEST
    console.log('[TEST 1] State Store Pub/Sub...');
    const localStore = createStore({ count: 0, label: 'test' });
    let notified = 0;
    const unsub = localStore.subscribe((state, prev) => {
        notified++;
        assert.equal(state.count, 1);
        assert.equal(prev.count, 0);
    });
    localStore.setState({ count: 1 });
    assert.equal(notified, 1);
    unsub();
    localStore.setState({ count: 2 });
    assert.equal(notified, 1); // Unsubscribed

    // Initial state check
    assert.deepEqual(INITIAL_STATE.telemetryLogs, [], 'telemetryLogs must be empty array by default');
    assert.equal(INITIAL_STATE.currentUnit, 'gal');
    assert.equal(INITIAL_STATE.fuelPriceCop, 16000);
    console.log('✓ State Store tests passed.');

    // 2. AUDIO & TOAST (DEFENSIVE CHECK)
    console.log('[TEST 2] Audio Tick & Toast Defensive execution...');
    playHorologyTick(1200, 0.012, 0.025); // Should not crash in Node
    showToast('TEST TOAST'); // Should not crash in Node
    console.log('✓ Audio & Toast tests passed.');

    // 3. INDEXEDDB INITIALIZATION & 7 STORES
    console.log('[TEST 3] IndexedDB 7 Stores Schema...');
    const db = await openDB();
    const expectedStores = [
        'vehicle_profile',
        'telemetry_logs',
        'maintenance_items',
        'free_notes',
        'legal_docs',
        'ride_sessions',
        'platform_passes'
    ];
    for (const name of expectedStores) {
        assert.ok(db.objectStoreNames.contains(name), `Missing store: ${name}`);
    }
    console.log('✓ All 7 stores exist in OctaneKineticDB.');

    // 4. VEHICLE PROFILE SEEDING
    console.log('[TEST 4] Vehicle Profile Default Seeding...');
    await clearAllData();
    const profile = await getVehicleProfile();
    assert.equal(profile.id, 'main');
    assert.equal(profile.name, 'Kia Picanto 1.0L');
    assert.equal(profile.tankCapacityLiters, 35.0);
    assert.equal(profile.tankCapacityGallons, 9.25);
    assert.equal(profile.reserveLiters, 5.0);
    assert.equal(profile.fuelPriceCop, 16000);
    assert.equal(profile.gaugeStyle, 'spicy-arc');

    // Update profile
    await saveVehicleProfile({ name: 'Kia Picanto GT-Line', fuelPriceCop: 16500 });
    const updatedProfile = await getVehicleProfile();
    assert.equal(updatedProfile.name, 'Kia Picanto GT-Line');
    assert.equal(updatedProfile.fuelPriceCop, 16500);
    console.log('✓ Vehicle Profile seeding and update passed.');

    // 5. TELEMETRY LOGS (ZERO DUMMY DATA CHECK)
    console.log('[TEST 5] Telemetry Logs CRUD & Zero Dummy Data...');
    const initialLogs = await getTelemetryLogs();
    assert.deepEqual(initialLogs, [], 'Must return empty array [] when empty, NO defaultRawData');

    // Add log
    const testLog1 = {
        date: '2026-06-02',
        odometer_reading: 93404,
        fuel_level_percent: 75.5,
        refuels_count: 0,
        gallons_added: 0
    };
    await addTelemetryLog(testLog1);
    const log1 = await getTelemetryLog('2026-06-02');
    assert.ok(log1);
    assert.equal(log1.odometer_reading, 93404);
    assert.equal(log1.is_full_tank, false);

    // Update log with refueling
    const testLog2 = {
        date: '2026-06-04',
        odometer_reading: 93415,
        fuel_level_percent: 100.0,
        refuels_count: 1,
        gallons_added: 7.087,
        total_cost_cop: 115000
    };
    await addTelemetryLog(testLog2);
    const log2 = await getTelemetryLog('2026-06-04');
    assert.ok(log2);
    assert.equal(log2.is_full_tank, true, '7.087 gallons should mark is_full_tank = true');

    const allLogs = await getTelemetryLogs();
    assert.equal(allLogs.length, 2);
    assert.equal(allLogs[0].date, '2026-06-02');
    assert.equal(allLogs[1].date, '2026-06-04');

    // Delete log
    await deleteTelemetryLog('2026-06-02');
    const remainingLogs = await getTelemetryLogs();
    assert.equal(remainingLogs.length, 1);
    assert.equal(remainingLogs[0].date, '2026-06-04');
    console.log('✓ Telemetry Logs CRUD passed.');

    // 6. BULK ADD LOGS
    console.log('[TEST 6] Bulk Add Telemetry Logs...');
    const bulk = [
        { date: '2026-06-10', odometer_reading: 93500, fuel_level_percent: 50 },
        { date: '2026-06-12', odometer_reading: 93580, fuel_level_percent: 30 },
        { date: '2026-06-15', odometer_reading: 93690, fuel_level_percent: 100, gallons_added: 8.5 }
    ];
    const insertedCount = await bulkAddTelemetryLogs(bulk);
    assert.equal(insertedCount, 3);
    const logsAfterBulk = await getTelemetryLogs();
    assert.equal(logsAfterBulk.length, 4); // 1 previous + 3 new
    console.log('✓ Bulk Add passed.');

    // 7. PHASE 2 & 3 STORES CRUD
    console.log('[TEST 7] Maintenance, Notes, Legal Docs, Rides & Passes CRUD...');
    // Maintenance
    const maint = await saveMaintenanceItem({ title: 'Aceite Motor + Filtro', intervalKm: 5000, lastServiceOdo: 93000 });
    assert.ok(maint.id);
    const maintList = await getMaintenanceItems();
    assert.equal(maintList.length, 1);
    await deleteMaintenanceItem(maint.id);
    assert.equal((await getMaintenanceItems()).length, 0);

    // Free Notes
    const note = await saveFreeNote({ title: 'Presión de llantas', content: '32 PSI delanteras y traseras', isPinned: true });
    assert.ok(note.id);
    const notesList = await getFreeNotes();
    assert.equal(notesList.length, 1);
    assert.equal(notesList[0].isPinned, true);
    await deleteFreeNote(note.id);
    assert.equal((await getFreeNotes()).length, 0);

    // Legal Docs
    const doc = await saveLegalDoc({ docType: 'SOAT', policyNumber: 'S-991203', expirationDate: '2027-04-15' });
    assert.ok(doc.id);
    const docsList = await getLegalDocs();
    assert.equal(docsList.length, 1);
    await deleteLegalDoc(doc.id);
    assert.equal((await getLegalDocs()).length, 0);

    // Ride Sessions
    const ride = await saveRideSession({ date: '2026-06-20', grossRevenueCop: 145000, appCommissionCop: 21000, workKm: 62 });
    assert.ok(ride.id);
    const ridesList = await getRideSessions();
    assert.equal(ridesList.length, 1);
    await deleteRideSession(ride.id);
    assert.equal((await getRideSessions()).length, 0);

    // Platform Passes
    const pass = await savePlatformPass({ platform: 'DiDi', costCop: 10500, days: 3, startDate: '2026-06-20' });
    assert.ok(pass.id);
    const passesList = await getPlatformPasses();
    assert.equal(passesList.length, 1);
    await deletePlatformPass(pass.id);
    assert.equal((await getPlatformPasses()).length, 0);
    console.log('✓ All Phase 2 & Phase 3 stores passed CRUD verification.');

    // 8. MASTER SNAPSHOT EXPORT & RESTORE
    console.log('[TEST 8] Master Snapshot Export & Restore...');
    const snapshot = await exportAllStores();
    assert.equal(snapshot.version, 1);
    assert.ok(snapshot.stores.vehicle_profile);
    assert.ok(snapshot.stores.telemetry_logs);
    assert.ok(snapshot.stores.maintenance_items);
    assert.ok(snapshot.stores.free_notes);
    assert.ok(snapshot.stores.legal_docs);
    assert.ok(snapshot.stores.ride_sessions);
    assert.ok(snapshot.stores.platform_passes);

    // Wipe and restore
    await clearAllData();
    assert.equal((await getTelemetryLogs()).length, 0);
    await importAllStores(snapshot);
    const restoredLogs = await getTelemetryLogs();
    assert.equal(restoredLogs.length, 4);
    console.log('✓ Snapshot export and restore passed.');

    // 9. JSON I/O ENGINE (LEGACY & MASTER BACKUP)
    console.log('[TEST 9] JSON I/O Engine (Dual Format)...');
    // Test legacy flat array
    const legacyArrayJSON = JSON.stringify([
        { date: '2026-07-01', odometer_reading: 94000, fuel_level_percent: 80, refuels_count: 0, gallons_added: 0 },
        { date: '2026-07-05', odometer_reading: 94350, fuel_level_percent: 15, refuels_count: 1, gallons_added: 7.23, total_cost_cop: 115000 }
    ]);
    const resA = await importFromJSONString(legacyArrayJSON);
    assert.equal(resA.type, 'legacy_array');
    assert.equal(resA.count, 2);

    const logJul5 = await getTelemetryLog('2026-07-05');
    assert.ok(logJul5);
    assert.equal(logJul5.odometer_reading, 94350);
    assert.equal(logJul5.is_full_tank, true);

    // Test master snapshot JSON
    const masterBackupJSON = JSON.stringify({
        version: 1,
        stores: {
            vehicle_profile: [{ id: 'main', name: 'Kia Picanto Test Machine', tankCapacityLiters: 35.0 }],
            telemetry_logs: [
                { date: '2026-08-01', odometer_reading: 95000, fuel_level_percent: 100 }
            ],
            maintenance_items: [],
            free_notes: [],
            legal_docs: [],
            ride_sessions: [],
            platform_passes: []
        }
    });
    const resB = await importFromJSONString(masterBackupJSON);
    assert.equal(resB.type, 'master_backup');
    const logsAfterMaster = await getTelemetryLogs();
    assert.equal(logsAfterMaster.length, 1);
    assert.equal(logsAfterMaster[0].date, '2026-08-01');
    const profileAfterMaster = await getVehicleProfile();
    assert.equal(profileAfterMaster.name, 'Kia Picanto Test Machine');
    console.log('✓ JSON I/O Dual Format tests passed.');

    // 10. FIREBASE OFFLINE-FIRST FALLBACK
    console.log('[TEST 10] Firebase Offline-First Fallback Safety...');
    assert.equal(isFirebaseConfigured(), false, 'Should safely report false when unconfigured');
    const initRes = initFirebase();
    assert.equal(initRes, false, 'initFirebase should gracefully return false when unconfigured');
    const userRes = await signInWithGoogle();
    assert.equal(userRes, null, 'signInWithGoogle should safely return null and not throw');
    await signOutUser();
    const syncRes = await syncToCloud();
    assert.equal(syncRes, false, 'syncToCloud should return false when unconfigured');
    console.log('✓ Firebase Sync defensive fallback passed.');

    console.log('==============================================');
    console.log(' ALL TESTS PASSED SUCCESSFULLY (10/10) ');
    console.log('==============================================');
}

runTests().catch(err => {
    console.error('TEST SUITE FAILED:', err);
    process.exit(1);
});
