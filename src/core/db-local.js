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

import { parseFuelVolume, parseIntegerMetric, sanitizeFuelCostCop } from './number-utils.js';

export const DB_NAME = 'OctaneKineticDB';
export const DB_VERSION = 3;
export const DELETED_STORE = 'deleted_records';
const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

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
    learnedGasStations: [],
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

            // 8. deleted_records: marcas de borrado para que la sincronización no resucite registros
            if (!db.objectStoreNames.contains(DELETED_STORE)) {
                db.createObjectStore(DELETED_STORE, { keyPath: 'key' });
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
        let result;

        // Resolver solo cuando la transacción quedó confirmada en disco (no al encolar la escritura),
        // para que la UI nunca anuncie 'guardado' antes de que lo esté.
        req.onsuccess = () => { result = req.result; };
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error || req.error);
        tx.onabort = () => reject(tx.error || new Error('Transaction aborted while saving'));
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
        const trackable = storeName !== DELETED_STORE && storeName !== STORES.VEHICLE_PROFILE
            && db.objectStoreNames.contains(DELETED_STORE);
        const tx = db.transaction(trackable ? [storeName, DELETED_STORE] : storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.delete(key);
        if (trackable) {
            // Misma transacción: o se borra y se marca, o ninguna de las dos
            tx.objectStore(DELETED_STORE).put({
                key: storeName + ':' + key,
                store: storeName,
                id: key,
                deletedAt: new Date().toISOString(),
            });
        }

        req.onerror = () => reject(req.error);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || req.error);
        tx.onabort = () => reject(tx.error || new Error('Transaction aborted while deleting'));
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

        req.onerror = () => reject(req.error);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || req.error);
        tx.onabort = () => reject(tx.error || new Error('Transaction aborted while clearing'));
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
    const mergedGpsCache = (current?.gpsCache || profile?.gpsCache)
        ? {
            ...(current?.gpsCache || {}),
            ...(profile?.gpsCache || {}),
        }
        : undefined;
    const updated = {
        ...current,
        ...profile,
        ...(mergedGpsCache !== undefined ? { gpsCache: mergedGpsCache } : {}),
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
 * @param {Object} [vehicleProfile=null]
 * @returns {Object}
 */
export function normalizeTelemetryLog(raw, vehicleProfile = null) {
    if (!raw || typeof raw !== 'object') {
        throw new Error('Invalid telemetry log object');
    }

    const dateStr = String(raw.date || raw.id || '').trim();
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
        throw new Error(`Invalid date format for telemetry record: "${dateStr}". Must begin with YYYY-MM-DD.`);
    }

    // Extract canonical YYYY-MM-DD
    const date = dateStr.slice(0, 10);
    const tankCap = vehicleProfile?.tankCapacityGallons || DEFAULT_VEHICLE_PROFILE.tankCapacityGallons || 25;
    const odometer_reading = parseIntegerMetric(raw.odometer_reading);
    const fuel_level_percent = Math.min(100, Math.max(0, Number(raw.fuel_level_percent) || 0));
    const refuels_count = Number(raw.refuels_count) || 0;
    const gallons_added = parseFuelVolume(raw.gallons_added, tankCap);
    const price_per_gallon = raw.price_per_gallon !== undefined
        ? (Number(raw.price_per_gallon) || 0)
        : (raw.pricePerGallon !== undefined ? (Number(raw.pricePerGallon) || 0) : 0);

    // Detect full tank: explicit bool takes absolute precedence.
    // Only infer from decimal refuel or >=99.5% fuel level if is_full_tank is undefined.
    let is_full_tank = false;
    if (raw.is_full_tank !== undefined) {
        is_full_tank = Boolean(raw.is_full_tank);
    } else {
        const hasDecimalGallons = gallons_added > 0 && Math.abs(gallons_added - Math.round(gallons_added)) > 0.0001;
        is_full_tank = Boolean(hasDecimalGallons || fuel_level_percent >= 99.5);
    }

    const defaultPrice = Number(vehicleProfile?.fuelPriceCop) || DEFAULT_VEHICLE_PROFILE.fuelPriceCop || 16000;
    const total_cost_cop = sanitizeFuelCostCop(raw.total_cost_cop, gallons_added, defaultPrice);
    const notes = raw.notes !== undefined ? String(raw.notes) : '';

    const createdAt = raw.createdAt || (raw.timestamp ? new Date(raw.timestamp).toISOString() : raw.updatedAt || new Date().toISOString());
    let time = raw.time || null;
    if (!time && raw.createdAt) {
        try {
            const d = new Date(raw.createdAt);
            if (!isNaN(d.getTime())) {
                time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            }
        } catch (_) {}
    } else if (!time && raw.updatedAt && String(raw.updatedAt).slice(0, 10) === date) {
        try {
            const d = new Date(raw.updatedAt);
            if (!isNaN(d.getTime())) {
                time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            }
        } catch (_) {}
    }

    let pre_refuel_gauge_pct = null;
    if (
        raw.pre_refuel_gauge_pct !== undefined &&
        raw.pre_refuel_gauge_pct !== null &&
        raw.pre_refuel_gauge_pct !== ''
    ) {
        const parsedPre = Number(raw.pre_refuel_gauge_pct);
        if (Number.isFinite(parsedPre) && parsedPre > 0 && parsedPre < 100) {
            pre_refuel_gauge_pct = Number(parsedPre.toFixed(1));
        }
    }

    return {
        id: raw.id || date,
        date,
        time,
        createdAt,
        odometer_reading,
        fuel_level_percent,
        ...(pre_refuel_gauge_pct !== null ? { pre_refuel_gauge_pct } : {}),
        refuels_count,
        gallons_added,
        is_full_tank,
        price_per_gallon,
        total_cost_cop,
        notes,
        distance_km: raw.distance_km !== undefined ? Number(raw.distance_km) : null,
        duration_seconds: raw.duration_seconds !== undefined ? Number(raw.duration_seconds) : null,
        idle_seconds: raw.idle_seconds !== undefined ? Number(raw.idle_seconds) : null,
        idle_ratio: raw.idle_ratio !== undefined ? Number(raw.idle_ratio) : null,
        acceleration_variance: raw.acceleration_variance !== undefined ? Number(raw.acceleration_variance) : null,
        max_speed_kmh: raw.max_speed_kmh !== undefined ? Number(raw.max_speed_kmh) : null,
        thermal_stress_score: raw.thermal_stress_score !== undefined ? Number(raw.thermal_stress_score) : null,
        ...(raw.stationId ? { stationId: String(raw.stationId) } : {}),
        ...(raw.stationName ? { stationName: String(raw.stationName) } : {}),
        updatedAt: raw.updatedAt || new Date().toISOString(),
    };
}

/**
 * Returns all telemetry logs sorted chronologically ascending by date.
 * Returns empty array [] when no logs exist (strict ZERO defaultRawData).
 * Automatically heals corrupt entries retroactively.
 * @param {Object} [vehicleProfile=null]
 * @returns {Promise<Array>}
 */
export async function getTelemetryLogs(vehicleProfile = null) {
    const rawList = await getAllFromStore(STORES.TELEMETRY_LOGS);
    if (!Array.isArray(rawList) || rawList.length === 0) {
        return [];
    }
    let profile = vehicleProfile;
    if (!profile) {
        try {
            profile = await getFromStore(STORES.VEHICLE_PROFILE, 'main');
        } catch {
            // fallback
        }
    }
    const normalizedList = [];
    for (const raw of rawList) {
        const normalized = normalizeTelemetryLog(raw, profile);

        // Auto-heal corrupt or distorted fields permanently in IndexedDB:
        const isCorruptCost = raw.total_cost_cop !== undefined && raw.total_cost_cop !== null && raw.total_cost_cop !== normalized.total_cost_cop;
        const isCorruptGal = raw.gallons_added !== undefined && raw.gallons_added !== null && raw.gallons_added !== normalized.gallons_added;
        const isCorruptOdo = raw.odometer_reading !== undefined && raw.odometer_reading !== null && raw.odometer_reading !== normalized.odometer_reading;

        if (isCorruptCost || isCorruptGal || isCorruptOdo) {
            try {
                await saveToStore(STORES.TELEMETRY_LOGS, normalized);
            } catch {
                // silent healing failover in read-only / test contexts
            }
        }
        normalizedList.push(normalized);
    }
    return normalizedList.sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        if (a.odometer_reading !== b.odometer_reading) {
            return (Number(a.odometer_reading) || 0) - (Number(b.odometer_reading) || 0);
        }
        const timeA = a.time || (a.createdAt ? String(a.createdAt).slice(11, 16) : '');
        const timeB = b.time || (b.createdAt ? String(b.createdAt).slice(11, 16) : '');
        if (timeA && timeB && timeA !== timeB) return timeA < timeB ? -1 : 1;
        return String(a.id || '').localeCompare(String(b.id || ''));
    });
}

export const getLogs = getTelemetryLogs;

/**
 * Retrieves a single telemetry log by id or date string.
 * @param {string} idOrDate - Primary key id or 'YYYY-MM-DD'
 * @param {Object} [vehicleProfile=null]
 * @returns {Promise<Object|null>}
 */
export async function getTelemetryLog(idOrDate, vehicleProfile = null) {
    if (!idOrDate) return null;
    let profile = vehicleProfile;
    if (!profile) {
        try {
            profile = await getFromStore(STORES.VEHICLE_PROFILE, 'main');
        } catch {}
    }
    const direct = await getFromStore(STORES.TELEMETRY_LOGS, idOrDate);
    if (direct) return normalizeTelemetryLog(direct, profile);

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
        req.onsuccess = () => resolve(req.result ? normalizeTelemetryLog(req.result, profile) : null);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Adds or updates a telemetry log.
 * Prevents key collision on same-day logs while preserving record updates.
 * @param {Object} log
 * @param {Object} [vehicleProfile=null]
 * @returns {Promise<Object>}
 */
export async function addTelemetryLog(log, vehicleProfile = null) {
    const normalized = normalizeTelemetryLog(log, vehicleProfile);

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
        const hasTomb = db.objectStoreNames.contains(DELETED_STORE);
        const tx = db.transaction(hasTomb ? [STORES.TELEMETRY_LOGS, DELETED_STORE] : STORES.TELEMETRY_LOGS, 'readwrite');
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
                if (hasTomb) {
                    tx.objectStore(DELETED_STORE).put({
                        key: STORES.TELEMETRY_LOGS + ':' + k,
                        store: STORES.TELEMETRY_LOGS,
                        id: k,
                        deletedAt: new Date().toISOString(),
                    });
                }
            }
        };
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || req.error);
        tx.onabort = () => reject(tx.error || new Error('Transaction aborted while deleting'));
    });
}

/** Lista las marcas de borrado vigentes (descarta las de más de 90 días). */
export async function getDeletedRecords() {
    const db = await openDB();
    if (!db.objectStoreNames.contains(DELETED_STORE)) return [];
    const all = await getAllFromStore(DELETED_STORE);
    const cutoff = Date.now() - TOMBSTONE_TTL_MS;
    return all.filter(r => Date.parse(r.deletedAt) >= cutoff);
}
/**
 * Adds or updates multiple telemetry logs within a single atomic readwrite transaction.
 * @param {Array<Object>} logs
 * @param {Object} [vehicleProfile=null]
 * @returns {Promise<number>} Number of records inserted/updated
 */
export async function bulkAddTelemetryLogs(logs, vehicleProfile = null) {
    if (!Array.isArray(logs) || logs.length === 0) return 0;

    const db = await openDB();
    const dateSeen = new Set();
    const normalizedLogs = logs.map((raw, idx) => {
        const norm = normalizeTelemetryLog(raw, vehicleProfile);
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
        category: 'oil',
        icon: 'oil',
        group: 'motor',
        history: [],
    },
    {
        id: 'maint_cabin_filter',
        name: 'FILTRO CABINA A/C',
        intervalKm: 15000,
        lastServiceOdo: 0,
        lastServiceDate: '',
        category: 'filter',
        icon: 'filter',
        group: 'cabina',
        history: [],
    },
    {
        id: 'maint_brake_fluid',
        name: 'LÍQUIDO FRENOS',
        intervalKm: 30000,
        lastServiceOdo: 0,
        lastServiceDate: '',
        category: 'brakes',
        icon: 'brakes',
        group: 'rodaje',
        history: [],
    },
    {
        id: 'maint_fuel_filter',
        name: 'FILTRO GASOLINA',
        intervalKm: 90000,
        lastServiceOdo: 0,
        lastServiceDate: '',
        category: 'fuel',
        icon: 'fuel',
        group: 'motor',
        history: [],
    },
    {
        id: 'maint_tire_rotation',
        name: 'LLANTAS / ROTACIÓN',
        intervalKm: 10000,
        lastServiceOdo: 0,
        lastServiceDate: '',
        category: 'tires',
        icon: 'tires',
        group: 'rodaje',
        history: [],
    },
    {
        id: 'maint_spark_plugs',
        name: 'BUJÍAS / CORREA',
        intervalKm: 40000,
        lastServiceOdo: 0,
        lastServiceDate: '',
        category: 'engine',
        icon: 'engine',
        group: 'motor',
        history: [],
    },
]);

export const DEFAULT_SEED_EPOCH = '1970-01-01T00:00:00.000Z';

/**
 * Checks whether a maintenance item contains actual user service records or mileage baseline.
 * Prevents untouched default seeds from ever overwriting real records during cloud merge.
 * @param {Object|null} item
 * @returns {boolean}
 */
export function hasMaintenanceServiceData(item) {
    if (!item || typeof item !== 'object') return false;
    return Boolean(
        Number(item.lastServiceOdo) > 0 ||
        (Array.isArray(item.history) && item.history.length > 0) ||
        Boolean(item.lastServiceDate)
    );
}

/**
 * Sorts a maintenance history array newest-first (by date desc, odometer desc, createdAt desc).
 * @param {Array<Object>} history
 * @returns {Array<Object>}
 */
export function sortMaintenanceHistory(history = []) {
    if (!Array.isArray(history)) return [];
    return [...history].sort((a, b) => {
        const dateA = String(a?.date || '');
        const dateB = String(b?.date || '');
        if (dateA !== dateB) return dateA > dateB ? -1 : 1;
        const odoA = Number(a?.odometer) || 0;
        const odoB = Number(b?.odometer) || 0;
        if (odoA !== odoB) return odoB - odoA;
        const tsA = Date.parse(a?.updatedAt || a?.createdAt || '') || 0;
        const tsB = Date.parse(b?.updatedAt || b?.createdAt || '') || 0;
        return tsB - tsA;
    });
}

/**
 * Merges two versions of the same maintenance item (local vs cloud) without losing history entries
 * and ensuring untouched default seeds never win over real service data.
 * @param {Object} local
 * @param {Object} incoming
 * @returns {Object}
 */
export function mergeMaintenanceItemRecords(local, incoming) {
    if (!local) return normalizeMaintenanceItem(incoming);
    if (!incoming) return normalizeMaintenanceItem(local);

    const localHasData = hasMaintenanceServiceData(local);
    const incomingHasData = hasMaintenanceServiceData(incoming);

    if (!localHasData && incomingHasData) {
        return normalizeMaintenanceItem(incoming);
    }
    if (localHasData && !incomingHasData) {
        return normalizeMaintenanceItem(local);
    }

    const localTs = local.updatedAt ? (Date.parse(local.updatedAt) || 0) : 0;
    const incomingTs = incoming.updatedAt ? (Date.parse(incoming.updatedAt) || 0) : 0;
    const primary = incomingTs >= localTs ? incoming : local;
    const secondary = incomingTs >= localTs ? local : incoming;

    const deletedHistorySet = new Set([
        ...(Array.isArray(local.deletedHistoryIds) ? local.deletedHistoryIds : []),
        ...(Array.isArray(incoming.deletedHistoryIds) ? incoming.deletedHistoryIds : []),
    ]);

    const historyMap = new Map();
    const addEntry = (entry) => {
        if (!entry || typeof entry !== 'object') return;
        if (entry.id && deletedHistorySet.has(entry.id)) return;
        const key = entry.id || `${entry.date || ''}_${entry.odometer || 0}_${entry.createdAt || ''}`;
        const existing = historyMap.get(key);
        if (!existing) {
            historyMap.set(key, { ...entry });
        } else {
            const exTs = Date.parse(existing.updatedAt || existing.createdAt || '') || 0;
            const enTs = Date.parse(entry.updatedAt || entry.createdAt || '') || 0;
            if (enTs >= exTs) historyMap.set(key, { ...existing, ...entry });
        }
    };

    (Array.isArray(secondary.history) ? secondary.history : []).forEach(addEntry);
    (Array.isArray(primary.history) ? primary.history : []).forEach(addEntry);

    const mergedHistory = sortMaintenanceHistory(Array.from(historyMap.values()));

    const merged = normalizeMaintenanceItem({
        ...secondary,
        ...primary,
        history: mergedHistory,
        deletedHistoryIds: Array.from(deletedHistorySet),
        isDefaultSeed: Boolean(local.isDefaultSeed && incoming.isDefaultSeed && !localHasData && !incomingHasData),
        updatedAt: new Date(Math.max(localTs, incomingTs) || 0).toISOString(),
    });

    if (mergedHistory.length > 0) {
        merged.lastServiceOdo = Number(mergedHistory[0].odometer) || merged.lastServiceOdo || 0;
        merged.lastServiceDate = mergedHistory[0].date || merged.lastServiceDate || '';
    }

    return merged;
}

/**
 * Seeds default 6 maintenance items into IndexedDB if the store is empty.
 * Uses DEFAULT_SEED_EPOCH so untouched seeds never override real cloud records on merge.
 * @param {boolean} [force=false]
 * @returns {Promise<Array>}
 */
export async function seedDefaultMaintenanceItems(force = false) {
    const existing = await getAllFromStore(STORES.MAINTENANCE_ITEMS);
    if (!force && existing && existing.length > 0) {
        return existing;
    }
    const seeded = [];
    for (const item of DEFAULT_MAINTENANCE_ITEMS) {
        const record = {
            ...item,
            history: [],
            isDefaultSeed: true,
            updatedAt: DEFAULT_SEED_EPOCH,
        };
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
    return (items || []).map(item => normalizeMaintenanceItem(item));
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
    const sortedHistory = sortMaintenanceHistory(Array.isArray(raw.history) ? raw.history : []);
    const hasExplicitOdo = raw.lastServiceOdo !== undefined && raw.lastServiceOdo !== null;
    const derivedOdo = sortedHistory.length > 0
        ? (Number(sortedHistory[0].odometer) || 0)
        : (hasExplicitOdo ? (Number(raw.lastServiceOdo) || 0) : 0);
    const derivedDate = sortedHistory.length > 0
        ? (sortedHistory[0].date || '')
        : (raw.lastServiceDate || '');

    const upperName = String(raw.name || raw.title || 'COMPONENTE').trim().toUpperCase();
    const rawCat = String(raw.category || '').toLowerCase();
    const rawIcon = String(raw.icon || '').toLowerCase();

    // Heal legacy default categories from v1 seeds (e.g. maint_oil_filter saved with category: 'engine', maint_cabin_filter with 'cabin')
    let resolvedIcon = rawIcon || rawCat || 'general';
    let resolvedCategory = rawCat || rawIcon || 'general';
    let resolvedGroup = raw.group || '';

    if (
        (raw.id === 'maint_oil_filter' || upperName.includes('ACEITE') || upperName.includes('OIL')) &&
        (resolvedIcon === 'engine' || resolvedCategory === 'engine')
    ) {
        resolvedIcon = 'oil';
        resolvedCategory = 'oil';
        if (!resolvedGroup) resolvedGroup = 'motor';
    } else if (
        (raw.id === 'maint_cabin_filter' || rawCat === 'cabin') &&
        (!rawIcon || rawIcon === 'cabin')
    ) {
        resolvedIcon = 'filter';
        resolvedCategory = 'filter';
        if (!resolvedGroup) resolvedGroup = 'cabina';
    }

    return {
        id: raw.id || `maint_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        name: upperName,
        intervalKm: Math.max(1, Number(raw.intervalKm) || 5000),
        lastServiceOdo: derivedOdo,
        lastServiceDate: derivedDate,
        category: resolvedCategory,
        icon: resolvedIcon,
        group: resolvedGroup,
        history: sortedHistory,
        deletedHistoryIds: Array.isArray(raw.deletedHistoryIds) ? raw.deletedHistoryIds : [],
        isDefaultSeed: Boolean(raw.isDefaultSeed) && !hasMaintenanceServiceData(raw),
        updatedAt: raw.updatedAt || new Date().toISOString(),
    };
}

export async function saveMaintenanceItem(item) {
    const normalized = normalizeMaintenanceItem(item);
    normalized.isDefaultSeed = false;
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
    try { await clearStore(DELETED_STORE); } catch { /* store ausente en BD antigua */ }
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
        const hasTomb = db.objectStoreNames.contains(DELETED_STORE);
        const tx = db.transaction(hasTomb ? [...storeNames, DELETED_STORE] : storeNames, 'readonly');
        const snapshot = {
            version: 1,
            exportedAt: new Date().toISOString(),
            stores: {},
            deleted: []
        };
        if (hasTomb) {
            const dreq = tx.objectStore(DELETED_STORE).getAll();
            dreq.onsuccess = () => { snapshot.deleted = dreq.result || []; };
        }

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
 * Merges an incoming cloud vehicle_profile over a local vehicle_profile without losing
 * local-only secrets (`gpsConfig.password`), heavy geometry (`trackPoints`), or local caches
 * (`voltageHistory`, `notifiedStopIds`, older `tripsByDate` dates pruned from cloud).
 *
 * @param {Object} local
 * @param {Object} incoming
 * @returns {Object}
 */
export function mergeVehicleProfileRecords(local, incoming) {
    if (!local || typeof local !== 'object') return incoming;
    if (!incoming || typeof incoming !== 'object') return local;

    const merged = JSON.parse(JSON.stringify(incoming));

    // Preserve local GPS password when cloud payload scrubbed it
    if (local.gpsConfig && typeof local.gpsConfig === 'object' && local.gpsConfig.password) {
        merged.gpsConfig = {
            ...(merged.gpsConfig || {}),
            password: merged.gpsConfig?.password ? merged.gpsConfig.password : local.gpsConfig.password,
        };
    }

    const localCache = local.gpsCache;
    if (localCache && typeof localCache === 'object') {
        const incomingCache = (merged.gpsCache && typeof merged.gpsCache === 'object') ? merged.gpsCache : {};
        const nextCache = { ...incomingCache };

        // Preserve local trackPoints inside tripsByDate[date] and any pruned local dates
        if (localCache.tripsByDate && typeof localCache.tripsByDate === 'object') {
            const nextTripsByDate = (nextCache.tripsByDate && typeof nextCache.tripsByDate === 'object')
                ? { ...nextCache.tripsByDate }
                : {};

            for (const dateKey of Object.keys(localCache.tripsByDate)) {
                const localDayTrips = localCache.tripsByDate[dateKey];
                const incomingDayTrips = nextTripsByDate[dateKey];

                if (!Array.isArray(incomingDayTrips)) {
                    if (Array.isArray(localDayTrips)) {
                        nextTripsByDate[dateKey] = JSON.parse(JSON.stringify(localDayTrips));
                    }
                    continue;
                }

                if (Array.isArray(localDayTrips) && localDayTrips.length > 0) {
                    const localById = new Map();
                    for (const lt of localDayTrips) {
                        if (lt && lt.id) localById.set(lt.id, lt);
                    }

                    nextTripsByDate[dateKey] = incomingDayTrips.map((trip, idx) => {
                        if (!trip || typeof trip !== 'object') return trip;
                        if (Array.isArray(trip.trackPoints) && trip.trackPoints.length > 0) {
                            return trip;
                        }
                        let match = trip.id ? localById.get(trip.id) : null;
                        if (!match && trip.startTimeMs) {
                            match = localDayTrips.find(lt => lt && lt.startTimeMs === trip.startTimeMs);
                        }
                        if (!match && localDayTrips[idx] && Array.isArray(localDayTrips[idx].trackPoints)) {
                            match = localDayTrips[idx];
                        }
                        if (match && Array.isArray(match.trackPoints) && match.trackPoints.length > 0) {
                            return { ...trip, trackPoints: JSON.parse(JSON.stringify(match.trackPoints)) };
                        }
                        return trip;
                    });
                }
            }

            nextCache.tripsByDate = nextTripsByDate;
        }

        // Preserve local voltageHistory samples without dropping local history
        if (Array.isArray(localCache.voltageHistory) && localCache.voltageHistory.length > 0) {
            if (!Array.isArray(nextCache.voltageHistory) || nextCache.voltageHistory.length === 0) {
                nextCache.voltageHistory = JSON.parse(JSON.stringify(localCache.voltageHistory));
            } else {
                const seen = new Set();
                const combined = [];
                for (const sample of [...localCache.voltageHistory, ...nextCache.voltageHistory]) {
                    const key = (sample && typeof sample === 'object')
                        ? String(sample.t ?? sample.ts ?? sample.timestamp ?? sample.time ?? JSON.stringify(sample))
                        : String(sample);
                    if (!seen.has(key)) {
                        seen.add(key);
                        combined.push(sample);
                    }
                }
                nextCache.voltageHistory = combined;
            }
        }

        // Preserve local notifiedStopIds without dropping deduplication history
        if (Array.isArray(localCache.notifiedStopIds) && localCache.notifiedStopIds.length > 0) {
            if (!Array.isArray(nextCache.notifiedStopIds) || nextCache.notifiedStopIds.length === 0) {
                nextCache.notifiedStopIds = [...localCache.notifiedStopIds];
            } else {
                nextCache.notifiedStopIds = Array.from(new Set([...localCache.notifiedStopIds, ...nextCache.notifiedStopIds]));
            }
        }

        merged.gpsCache = nextCache;
    }

    return merged;
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
    const hasTomb = db.objectStoreNames.contains(DELETED_STORE);
    const incomingDeleted = Array.isArray(snapshot.deleted) ? snapshot.deleted : [];

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
        const tx = db.transaction(hasTomb ? [...storeNames, DELETED_STORE] : storeNames, 'readwrite');
        const tombStore = hasTomb ? tx.objectStore(DELETED_STORE) : null;

        // Aplica las marcas de borrado entrantes (solo en fusión): borra lo local que sea más viejo que la marca
        if (isMerge && tombStore) {
            for (const tomb of incomingDeleted) {
                if (!tomb || !tomb.store || tomb.id === undefined || !storeNames.includes(tomb.store)) continue;
                const dTs = Date.parse(tomb.deletedAt) || 0;
                const target = tx.objectStore(tomb.store);
                const lreq = target.get(tomb.id);
                lreq.onsuccess = () => {
                    const local = lreq.result;
                    const lTs = local && local.updatedAt ? Date.parse(local.updatedAt) : 0;
                    if (local && lTs <= dTs) target.delete(tomb.id);
                    const existing = tombStore.get(tomb.store + ':' + tomb.id);
                    existing.onsuccess = () => {
                        if (!existing.result || Date.parse(existing.result.deletedAt) < dTs) tombStore.put(tomb);
                    };
                };
            }
        }

        // En fusión (sincronización con la nube) gana siempre el registro más reciente por updatedAt:
        // antes, una copia vieja de la nube pisaba lo que acababas de registrar en el dispositivo.
        const putItem = (store, item) => {
            if (!isMerge || !item || item[store.keyPath] === undefined) {
                store.put(item);
                return;
            }
            const id = item[store.keyPath];
            const getReq = store.get(id);
            getReq.onsuccess = () => {
                const local = getReq.result;
                const localTs = local && local.updatedAt ? Date.parse(local.updatedAt) : 0;
                const incomingTs = item.updatedAt ? Date.parse(item.updatedAt) : 0;

                const writeRecord = (recordToSave) => {
                    if (!tombStore) { store.put(recordToSave); return; }
                    const tkey = store.name + ':' + id;
                    const treq = tombStore.get(tkey);
                    treq.onsuccess = () => {
                        const tomb = treq.result;
                        const tTs = tomb ? Date.parse(tomb.deletedAt) || 0 : 0;
                        if (tomb && tTs >= incomingTs) return; // borrado después de esa versión: no resucita
                        if (tomb) tombStore.delete(tkey); // editado después del borrado: gana el registro
                        store.put(recordToSave);
                    };
                };

                // Fusión inteligente para mantenimiento: semillas vacías nunca pisan datos reales e historiales se fusionan
                if (store.name === STORES.MAINTENANCE_ITEMS) {
                    const merged = local ? mergeMaintenanceItemRecords(local, item) : normalizeMaintenanceItem(item);
                    writeRecord(merged);
                    return;
                }

                if (local && localTs > incomingTs) return; // lo local es más nuevo: se conserva
                const itemToStore = (store.name === STORES.VEHICLE_PROFILE && local)
                    ? mergeVehicleProfileRecords(local, item)
                    : item;
                writeRecord(itemToStore);
            };
        };

        for (const storeName of storeNames) {
            const rawItems = payload[storeName];
            if (Array.isArray(rawItems)) {
                const store = tx.objectStore(storeName);
                if (!isMerge) {
                    store.clear();
                }
                for (const item of rawItems) {
                    if (storeName === STORES.TELEMETRY_LOGS) {
                        const norm = normalizeTelemetryLog(item);
                        // normalize rellena updatedAt con 'ahora' si falta; respetar el original
                        if (isMerge && !item.updatedAt) norm.updatedAt = '';
                        putItem(store, norm);
                    } else {
                        putItem(store, item);
                    }
                }
            }
        }

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(new Error('Transaction aborted during importAllStores.'));
    });
}
