/**
 * OCTANE // KINETIC — Local IndexedDB Persistence Layer
 * Database Name: OctaneKineticDB (v1)
 * 7 Object Stores:
 *   - vehicle_profile
 *   - telemetry_logs
 *   - maintenance_items
 *   - free_notes
 *   - legal_docs
 *   - ride_sessions
 *   - platform_passes
 *
 * Strict ZERO dummy data: returns clean empty arrays when no user records exist.
 */

export const DB_NAME = 'OctaneKineticDB';
export const DB_VERSION = 2;

export const STORES = Object.freeze({
    VEHICLE_PROFILE: 'vehicle_profile',
    TELEMETRY_LOGS: 'telemetry_logs',
    MAINTENANCE_ITEMS: 'maintenance_items',
    FREE_NOTES: 'free_notes',
    LEGAL_DOCS: 'legal_docs',
    RIDE_SESSIONS: 'ride_sessions',
    PLATFORM_PASSES: 'platform_passes',
});

export const DEFAULT_VEHICLE_PROFILE = Object.freeze({
    id: 'main',
    name: 'Kia Picanto 1.0L',
    tankCapacityLiters: 35.0,
    tankCapacityGallons: 9.25,
    reserveLiters: 5.0,
    fuelPriceCop: 16000,
    gaugeStyle: 'spicy-arc',
    svgModel: 'picanto-2017',
    chassisType: 'hatchback',
    vehicleColor: '#F8F9FA',
    routineDailyKm: 24,
    ridesModuleEnabled: true,
    isConfigured: false,
    onboardingCompleted: false,
    updatedAt: new Date().toISOString(),
});

let dbInstancePromise = null;

function getIDBFactory() {
    if (typeof indexedDB !== 'undefined') return indexedDB;
    if (typeof window !== 'undefined' && window.indexedDB) return window.indexedDB;
    if (typeof globalThis !== 'undefined' && globalThis.indexedDB) return globalThis.indexedDB;
    return null;
}

/**
 * Opens or retrieves the singleton IndexedDB connection.
 * @returns {Promise<IDBDatabase>}
 */
export function openDB() {
    if (dbInstancePromise) {
        return dbInstancePromise;
    }

    dbInstancePromise = new Promise((resolve, reject) => {
        const idb = getIDBFactory();
        if (!idb) {
            return reject(new Error('IndexedDB is not supported in this runtime environment.'));
        }

        const request = idb.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            const oldVersion = event.oldVersion;

            // If migrating from v1 where telemetry_logs used { keyPath: 'date' }, recreate with keyPath: 'id'
            if (oldVersion > 0 && oldVersion < 2 && db.objectStoreNames.contains(STORES.TELEMETRY_LOGS)) {
                try {
                    db.deleteObjectStore(STORES.TELEMETRY_LOGS);
                } catch {
                    // Ignore deletion issue
                }
            }

            // 1. vehicle_profile (keyPath: 'id')
            if (!db.objectStoreNames.contains(STORES.VEHICLE_PROFILE)) {
                db.createObjectStore(STORES.VEHICLE_PROFILE, { keyPath: 'id' });
            }

            // 2. telemetry_logs (keyPath: 'id') with date index
            if (!db.objectStoreNames.contains(STORES.TELEMETRY_LOGS)) {
                const logsStore = db.createObjectStore(STORES.TELEMETRY_LOGS, { keyPath: 'id' });
                logsStore.createIndex('date', 'date', { unique: false });
                logsStore.createIndex('odometer_reading', 'odometer_reading', { unique: false });
                logsStore.createIndex('updatedAt', 'updatedAt', { unique: false });
            }

            // 3. maintenance_items (keyPath: 'id')
            if (!db.objectStoreNames.contains(STORES.MAINTENANCE_ITEMS)) {
                const maintStore = db.createObjectStore(STORES.MAINTENANCE_ITEMS, { keyPath: 'id' });
                maintStore.createIndex('category', 'category', { unique: false });
            }

            // 4. free_notes (keyPath: 'id')
            if (!db.objectStoreNames.contains(STORES.FREE_NOTES)) {
                const notesStore = db.createObjectStore(STORES.FREE_NOTES, { keyPath: 'id' });
                notesStore.createIndex('date', 'date', { unique: false });
                notesStore.createIndex('isPinned', 'isPinned', { unique: false });
                notesStore.createIndex('categoryTag', 'categoryTag', { unique: false });
            }

            // 5. legal_docs (keyPath: 'id')
            if (!db.objectStoreNames.contains(STORES.LEGAL_DOCS)) {
                const docsStore = db.createObjectStore(STORES.LEGAL_DOCS, { keyPath: 'id' });
                docsStore.createIndex('docType', 'docType', { unique: false });
            }

            // 6. ride_sessions (keyPath: 'id')
            if (!db.objectStoreNames.contains(STORES.RIDE_SESSIONS)) {
                const ridesStore = db.createObjectStore(STORES.RIDE_SESSIONS, { keyPath: 'id' });
                ridesStore.createIndex('date', 'date', { unique: false });
            }

            // 7. platform_passes (keyPath: 'id')
            if (!db.objectStoreNames.contains(STORES.PLATFORM_PASSES)) {
                const passesStore = db.createObjectStore(STORES.PLATFORM_PASSES, { keyPath: 'id' });
                passesStore.createIndex('platform', 'platform', { unique: false });
                passesStore.createIndex('startDate', 'startDate', { unique: false });
            }
        };

        request.onsuccess = (event) => {
            const db = event.target.result;
            db.onversionchange = () => {
                db.close();
                dbInstancePromise = null;
            };
            resolve(db);
        };

        request.onerror = (event) => {
            dbInstancePromise = null;
            reject(new Error(`Failed to open IndexedDB: ${event.target.error?.message || 'Unknown error'}`));
        };

        request.onblocked = () => {
            console.warn('[OCTANE DB] Database open blocked by older connection.');
        };
    });

    return dbInstancePromise;
}

// --------------------------------------------------------------------------
// Generic Low-Level Store Operations
// --------------------------------------------------------------------------

/**
 * Retrieves all records from an object store.
 * @param {string} storeName
 * @returns {Promise<Array>}
 */
export async function getAllFromStore(storeName) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.getAll();

        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Retrieves a single record by primary key.
 * @param {string} storeName
 * @param {*} key
 * @returns {Promise<*|null>}
 */
export async function getFromStore(storeName, key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.get(key);

        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Puts (inserts or updates) a record in an object store.
 * @param {string} storeName
 * @param {Object} item
 * @returns {Promise<*>}
 */
export async function saveToStore(storeName, item) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.put(item);

        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Deletes a record from an object store by primary key.
 * @param {string} storeName
 * @param {*} key
 * @returns {Promise<void>}
 */
export async function deleteFromStore(storeName, key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.delete(key);

        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

/**
 * Clears all records from a specified store.
 * @param {string} storeName
 * @returns {Promise<void>}
 */
export async function clearStore(storeName) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.clear();

        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

// --------------------------------------------------------------------------
// Vehicle Profile API
// --------------------------------------------------------------------------

/**
 * Gets the active vehicle profile. If none exists, seeds and returns the default profile.
 * @returns {Promise<Object>}
 */
export async function getVehicleProfile() {
    const profile = await getFromStore(STORES.VEHICLE_PROFILE, 'main');
    if (profile) {
        return profile;
    }
    // Seed default profile if empty
    const initial = { ...DEFAULT_VEHICLE_PROFILE, updatedAt: new Date().toISOString() };
    await saveToStore(STORES.VEHICLE_PROFILE, initial);
    return initial;
}

/**
 * Saves or updates the vehicle profile.
 * @param {Object} profile
 * @returns {Promise<Object>}
 */
export async function saveVehicleProfile(profile) {
    const current = await getVehicleProfile();
    const updated = {
        ...current,
        ...profile,
        id: 'main',
        updatedAt: new Date().toISOString(),
    };
    await saveToStore(STORES.VEHICLE_PROFILE, updated);
    return updated;
}

export const getUserProfile = getVehicleProfile;

// --------------------------------------------------------------------------
// Telemetry Logs API (Strict ZERO dummy data)
// --------------------------------------------------------------------------

/**
 * Normalizes a telemetry record for persistence and calculation consistency.
 * @param {Object} raw
 * @returns {Object}
 */
export function normalizeTelemetryLog(raw) {
    if (!raw || typeof raw !== 'object') {
        throw new Error('Invalid telemetry log object');
    }

    const dateStr = String(raw.date || raw.id || '').trim();
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
        throw new Error(`Invalid date format for telemetry record: "${dateStr}". Must begin with YYYY-MM-DD.`);
    }

    // Extract canonical YYYY-MM-DD
    const date = dateStr.slice(0, 10);
    const odometer_reading = Number(raw.odometer_reading) || 0;
    const fuel_level_percent = Number(raw.fuel_level_percent) || 0;
    const refuels_count = Number(raw.refuels_count) || 0;
    const gallons_added = Number(raw.gallons_added) || 0;

    // Detect full tank: explicit bool takes absolute precedence.
    // Only infer from decimal refuel or >=99.5% fuel level if is_full_tank is undefined.
    let is_full_tank = false;
    if (raw.is_full_tank !== undefined) {
        is_full_tank = Boolean(raw.is_full_tank);
    } else {
        const hasDecimalGallons = gallons_added > 0 && Math.abs(gallons_added - Math.round(gallons_added)) > 0.0001;
        is_full_tank = Boolean(hasDecimalGallons || fuel_level_percent >= 99.5);
    }

    const total_cost_cop = Number(raw.total_cost_cop) || 0;

    return {
        id: raw.id || date,
        date,
        odometer_reading,
        fuel_level_percent,
        refuels_count,
        gallons_added,
        is_full_tank,
        total_cost_cop,
        distance_km: raw.distance_km !== undefined ? Number(raw.distance_km) : null,
        duration_seconds: raw.duration_seconds !== undefined ? Number(raw.duration_seconds) : null,
        idle_seconds: raw.idle_seconds !== undefined ? Number(raw.idle_seconds) : null,
        idle_ratio: raw.idle_ratio !== undefined ? Number(raw.idle_ratio) : null,
        acceleration_variance: raw.acceleration_variance !== undefined ? Number(raw.acceleration_variance) : null,
        max_speed_kmh: raw.max_speed_kmh !== undefined ? Number(raw.max_speed_kmh) : null,
        thermal_stress_score: raw.thermal_stress_score !== undefined ? Number(raw.thermal_stress_score) : null,
        updatedAt: raw.updatedAt || new Date().toISOString(),
    };
}

/**
 * Returns all telemetry logs sorted chronologically ascending by date.
 * Returns empty array [] when no logs exist (strict ZERO defaultRawData).
 * @returns {Promise<Array>}
 */
export async function getTelemetryLogs() {
    const rawList = await getAllFromStore(STORES.TELEMETRY_LOGS);
    if (!Array.isArray(rawList) || rawList.length === 0) {
        return [];
    }
    return rawList.sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        return (Number(a.odometer_reading) || 0) - (Number(b.odometer_reading) || 0);
    });
}

export const getLogs = getTelemetryLogs;

/**
 * Retrieves a single telemetry log by id or date string.
 * @param {string} idOrDate - Primary key id or 'YYYY-MM-DD'
 * @returns {Promise<Object|null>}
 */
export async function getTelemetryLog(idOrDate) {
    if (!idOrDate) return null;
    const direct = await getFromStore(STORES.TELEMETRY_LOGS, idOrDate);
    if (direct) return direct;

    const db = await openDB();
    const dateKey = String(idOrDate).slice(0, 10);
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.TELEMETRY_LOGS, 'readonly');
        const store = tx.objectStore(STORES.TELEMETRY_LOGS);
        if (!store.indexNames.contains('date')) {
            return resolve(null);
        }
        const index = store.index('date');
        const req = index.get(dateKey);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Adds or updates a telemetry log.
 * Prevents key collision on same-day logs while preserving record updates.
 * @param {Object} log
 * @returns {Promise<Object>}
 */
export async function addTelemetryLog(log) {
    const normalized = normalizeTelemetryLog(log);

    // Collision guard: if log has no explicit id, and a record with id === normalized.id already exists,
    // generate a collision-safe ID so multiple records on the same day are preserved
    if (!log.id) {
        const existing = await getFromStore(STORES.TELEMETRY_LOGS, normalized.id);
        if (existing) {
            const isSameReading = existing.odometer_reading === normalized.odometer_reading &&
                                  existing.fuel_level_percent === normalized.fuel_level_percent &&
                                  existing.gallons_added === normalized.gallons_added;
            if (!isSameReading) {
                normalized.id = `${normalized.date}_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
            }
        }
    }

    await saveToStore(STORES.TELEMETRY_LOGS, normalized);
    return normalized;
}

/**
 * Updates an existing telemetry log.
 * @param {Object} log
 * @returns {Promise<Object>}
 */
export async function updateTelemetryLog(log) {
    return addTelemetryLog(log);
}

/**
 * Deletes a telemetry log by id or date.
 * @param {string} idOrDate
 * @returns {Promise<void>}
 */
export async function deleteTelemetryLog(idOrDate) {
    if (!idOrDate) return;
    const direct = await getFromStore(STORES.TELEMETRY_LOGS, idOrDate);
    if (direct) {
        return deleteFromStore(STORES.TELEMETRY_LOGS, idOrDate);
    }

    const db = await openDB();
    const dateKey = String(idOrDate).slice(0, 10);
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.TELEMETRY_LOGS, 'readwrite');
        const store = tx.objectStore(STORES.TELEMETRY_LOGS);
        if (!store.indexNames.contains('date')) {
            return resolve();
        }
        const index = store.index('date');
        const req = index.getAllKeys(dateKey);
        req.onsuccess = () => {
            const keys = req.result || [];
            for (const k of keys) {
                store.delete(k);
            }
            resolve();
        };
        req.onerror = () => reject(req.error);
    });
}

/**
 * Adds or updates multiple telemetry logs within a single atomic readwrite transaction.
 * @param {Array<Object>} logs
 * @returns {Promise<number>} Number of records inserted/updated
 */
export async function bulkAddTelemetryLogs(logs) {
    if (!Array.isArray(logs) || logs.length === 0) return 0;

    const db = await openDB();
    const dateSeen = new Set();
    const normalizedLogs = logs.map((raw, idx) => {
        const norm = normalizeTelemetryLog(raw);
        if (!raw.id) {
            if (dateSeen.has(norm.date)) {
                norm.id = `${norm.date}_${Date.now()}_${idx}_${Math.random().toString(36).substr(2, 4)}`;
            } else {
                dateSeen.add(norm.date);
            }
        }
        return norm;
    });

    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.TELEMETRY_LOGS, 'readwrite');
        const store = tx.objectStore(STORES.TELEMETRY_LOGS);

        for (const log of normalizedLogs) {
            store.put(log);
        }

        tx.oncomplete = () => resolve(normalizedLogs.length);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(new Error('Transaction aborted during bulkAddTelemetryLogs'));
    });
}

/** Alias for bulkAddTelemetryLogs */
export const saveTelemetryLogs = bulkAddTelemetryLogs;

// --------------------------------------------------------------------------
// Phase 2 Stores: Maintenance Items & Free Notes & Legal Docs
// --------------------------------------------------------------------------

export const DEFAULT_MAINTENANCE_ITEMS = Object.freeze([
    {
        id: 'maint_oil_filter',
        name: 'ACEITE + FILTRO',
        intervalKm: 5000,
        lastServiceOdo: 0,
        lastServiceDate: '',
        category: 'engine',
        history: [],
    },
    {
        id: 'maint_cabin_filter',
        name: 'FILTRO CABINA A/C',
        intervalKm: 15000,
        lastServiceOdo: 0,
        lastServiceDate: '',
        category: 'cabin',
        history: [],
    },
    {
        id: 'maint_brake_fluid',
        name: 'LÍQUIDO FRENOS',
        intervalKm: 30000,
        lastServiceOdo: 0,
        lastServiceDate: '',
        category: 'brakes',
        history: [],
    },
    {
        id: 'maint_fuel_filter',
        name: 'FILTRO GASOLINA',
        intervalKm: 90000,
        lastServiceOdo: 0,
        lastServiceDate: '',
        category: 'fuel',
        history: [],
    },
    {
        id: 'maint_tire_rotation',
        name: 'ROTACIÓN LLANTAS',
        intervalKm: 10000,
        lastServiceOdo: 0,
        lastServiceDate: '',
        category: 'tires',
        history: [],
    },
    {
        id: 'maint_spark_plugs',
        name: 'BUJÍAS / CORREA',
        intervalKm: 40000,
        lastServiceOdo: 0,
        lastServiceDate: '',
        category: 'engine',
        history: [],
    },
]);

/**
 * Seeds default 6 maintenance items into IndexedDB if the store is empty.
 * @param {boolean} [force=false]
 * @returns {Promise<Array>}
 */
export async function seedDefaultMaintenanceItems(force = false) {
    const existing = await getAllFromStore(STORES.MAINTENANCE_ITEMS);
    if (!force && existing && existing.length > 0) {
        return existing;
    }
    const now = new Date().toISOString();
    const seeded = [];
    for (const item of DEFAULT_MAINTENANCE_ITEMS) {
        const record = { ...item, updatedAt: now };
        await saveToStore(STORES.MAINTENANCE_ITEMS, record);
        seeded.push(record);
    }
    return seeded;
}

/**
 * Retrieves all maintenance items from the object store.
 * If optionsOrAutoSeed is true (or { autoSeed: true }) and store is empty, auto-seeds the 6 defaults.
 * @param {boolean|Object} [optionsOrAutoSeed=false]
 * @returns {Promise<Array>}
 */
export async function getMaintenanceItems(optionsOrAutoSeed = false) {
    const autoSeed = typeof optionsOrAutoSeed === 'boolean'
        ? optionsOrAutoSeed
        : Boolean(optionsOrAutoSeed && optionsOrAutoSeed.autoSeed);

    const items = await getAllFromStore(STORES.MAINTENANCE_ITEMS);
    if (autoSeed && (!items || items.length === 0)) {
        return seedDefaultMaintenanceItems();
    }
    return items || [];
}

/**
 * Normalizes a maintenance item record for storage and calculation consistency.
 * @param {Object} raw
 * @returns {Object}
 */
export function normalizeMaintenanceItem(raw) {
    if (!raw || typeof raw !== 'object') {
        throw new Error('Invalid maintenance item');
    }
    return {
        id: raw.id || `maint_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        name: String(raw.name || raw.title || 'COMPONENTE').trim().toUpperCase(),
        intervalKm: Math.max(1, Number(raw.intervalKm) || 5000),
        lastServiceOdo: Number(raw.lastServiceOdo) || 0,
        lastServiceDate: raw.lastServiceDate || '',
        category: raw.category || 'general',
        history: Array.isArray(raw.history) ? raw.history : [],
        updatedAt: raw.updatedAt || new Date().toISOString(),
    };
}

export async function saveMaintenanceItem(item) {
    const normalized = normalizeMaintenanceItem(item);
    normalized.updatedAt = new Date().toISOString();
    await saveToStore(STORES.MAINTENANCE_ITEMS, normalized);
    return normalized;
}

export async function deleteMaintenanceItem(id) {
    return deleteFromStore(STORES.MAINTENANCE_ITEMS, id);
}

export async function getFreeNotes() {
    const notes = await getAllFromStore(STORES.FREE_NOTES);
    // Sort pinned first, then by date descending or creation
    return notes.sort((a, b) => {
        if (a.isPinned && !b.isPinned) return -1;
        if (!a.isPinned && b.isPinned) return 1;
        return (b.date || b.updatedAt || '') < (a.date || a.updatedAt || '') ? -1 : 1;
    });
}

export async function saveFreeNote(note) {
    if (!note.id) note.id = `note_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    note.updatedAt = new Date().toISOString();
    await saveToStore(STORES.FREE_NOTES, note);
    return note;
}

export async function deleteFreeNote(id) {
    return deleteFromStore(STORES.FREE_NOTES, id);
}

export async function getLegalDocs() {
    return getAllFromStore(STORES.LEGAL_DOCS);
}

export async function saveLegalDoc(doc) {
    if (!doc.id) doc.id = `doc_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    doc.updatedAt = new Date().toISOString();
    await saveToStore(STORES.LEGAL_DOCS, doc);
    return doc;
}

export async function deleteLegalDoc(id) {
    return deleteFromStore(STORES.LEGAL_DOCS, id);
}

// --------------------------------------------------------------------------
// Phase 3 Stores: Ride Sessions & Platform Passes
// --------------------------------------------------------------------------

export async function getRideSessions() {
    return getAllFromStore(STORES.RIDE_SESSIONS);
}

export async function saveRideSession(session) {
    if (!session.id) session.id = `ride_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    session.updatedAt = new Date().toISOString();
    await saveToStore(STORES.RIDE_SESSIONS, session);
    return session;
}

export async function deleteRideSession(id) {
    return deleteFromStore(STORES.RIDE_SESSIONS, id);
}

export async function getPlatformPasses() {
    return getAllFromStore(STORES.PLATFORM_PASSES);
}

export async function savePlatformPass(pass) {
    if (!pass.id) pass.id = `pass_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    pass.updatedAt = new Date().toISOString();
    await saveToStore(STORES.PLATFORM_PASSES, pass);
    return pass;
}

export async function deletePlatformPass(id) {
    return deleteFromStore(STORES.PLATFORM_PASSES, id);
}

// --------------------------------------------------------------------------
// Full System Wipe & Reset
// --------------------------------------------------------------------------

/**
 * Completely clears all 7 object stores and restores the default vehicle profile.
 * Does NOT re-populate dummy data.
 * @returns {Promise<void>}
 */
export async function clearAllData() {
    const storeNames = Object.values(STORES);
    for (const name of storeNames) {
        await clearStore(name);
    }
    // Re-seed default vehicle profile (unconfigured for onboarding)
    await saveVehicleProfile({ ...DEFAULT_VEHICLE_PROFILE, isConfigured: false, onboardingCompleted: false });
}

// --------------------------------------------------------------------------
// Master Snapshot Export / Import
// --------------------------------------------------------------------------

/**
 * Returns a complete master snapshot of all 7 object stores in a single atomic transaction.
 * @returns {Promise<Object>}
 */
export async function exportAllStores() {
    const db = await openDB();
    const storeNames = Object.values(STORES);

    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeNames, 'readonly');
        const snapshot = {
            version: 1,
            exportedAt: new Date().toISOString(),
            stores: {}
        };

        let pending = storeNames.length;
        for (const storeName of storeNames) {
            const store = tx.objectStore(storeName);
            const req = store.getAll();
            req.onsuccess = () => {
                snapshot.stores[storeName] = req.result || [];
                pending--;
                if (pending === 0) {
                    resolve(snapshot);
                }
            };
            req.onerror = () => reject(req.error);
        }

        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(new Error('Transaction aborted during exportAllStores'));
    });
}

/**
 * Restores or merges all 7 stores from a master snapshot object.
 * When options.merge is true (e.g. during cloud sync pull), existing local
 * entries are safely preserved and not wiped out.
 * @param {Object} snapshot
 * @param {Object} [options={ merge: false }]
 * @returns {Promise<void>}
 */
export async function importAllStores(snapshot, options = { merge: false }) {
    if (!snapshot || typeof snapshot !== 'object') {
        throw new Error('Invalid snapshot structure: expected object.');
    }

    const payload = snapshot.stores || snapshot;
    const db = await openDB();
    const isMerge = Boolean(options && options.merge);

    const storeNames = [
        STORES.VEHICLE_PROFILE,
        STORES.TELEMETRY_LOGS,
        STORES.MAINTENANCE_ITEMS,
        STORES.FREE_NOTES,
        STORES.LEGAL_DOCS,
        STORES.RIDE_SESSIONS,
        STORES.PLATFORM_PASSES
    ];

    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeNames, 'readwrite');

        for (const storeName of storeNames) {
            const rawItems = payload[storeName];
            if (Array.isArray(rawItems)) {
                const store = tx.objectStore(storeName);
                if (!isMerge) {
                    store.clear();
                }
                for (const item of rawItems) {
                    if (storeName === STORES.TELEMETRY_LOGS) {
                        store.put(normalizeTelemetryLog(item));
                    } else {
                        store.put(item);
                    }
                }
            }
        }

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(new Error('Transaction aborted during importAllStores.'));
    });
}
