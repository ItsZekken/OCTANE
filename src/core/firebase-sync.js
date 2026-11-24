/**
 * OCTANE // KINETIC — Firebase Auth & Offline-First Firestore Sync
 * Provides Google Sign-In and 1.5s debounced cloud backup/restore.
 * Safe fallback: if Firebase config is omitted or incomplete, the app operates
 * 100% offline without crashing or throwing unhandled errors.
 */

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore';
import { store, showToast } from './state.js';
import {
    exportAllStores,
    importAllStores,
    getVehicleProfile,
    getTelemetryLogs,
    getMaintenanceItems,
} from './db-local.js';

// Read config from Vite environment variables
const firebaseConfig = {
    apiKey: import.meta.env?.VITE_FIREBASE_API_KEY || '',
    authDomain: import.meta.env?.VITE_FIREBASE_AUTH_DOMAIN || '',
    projectId: import.meta.env?.VITE_FIREBASE_PROJECT_ID || '',
    storageBucket: import.meta.env?.VITE_FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: import.meta.env?.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
    appId: import.meta.env?.VITE_FIREBASE_APP_ID || '',
};

let app = null;
let auth = null;
let firestore = null;
let googleProvider = null;
let debounceSyncTimer = null;
let retryTimer = null;
let retryAttempt = 0;
let activeSyncPromise = null;
const RETRY_DELAYS_MS = [5000, 30000, 120000];
const SYNC_DEBOUNCE_MS = 1500;

function buildStoreFingerprint(stores = {}) {
    const keys = [
        'telemetry_logs',
        'maintenance_items',
        'free_notes',
        'legal_docs',
        'ride_sessions',
        'platform_passes',
    ];
    return JSON.stringify(keys.map((k) => {
        const list = Array.isArray(stores[k]) ? stores[k] : [];
        return list
            .map((r) => `${r?.id || ''}|${r?.updatedAt || ''}|${Array.isArray(r?.history) ? r.history.length : ''}|${r?.lastServiceOdo || ''}`)
            .sort();
    }));
}

/**
 * Checks if Firebase environment variables are provided and non-empty.
 * @returns {boolean}
 */
export function isFirebaseConfigured() {
    return Boolean(
        firebaseConfig.apiKey &&
        firebaseConfig.apiKey !== 'YOUR_API_KEY' &&
        firebaseConfig.projectId &&
        firebaseConfig.projectId !== 'YOUR_PROJECT_ID'
    );
}

/**
 * Initializes Firebase App, Auth, and Firestore instances if configured.
 * @returns {boolean} True if initialized successfully, false otherwise.
 */
export function initFirebase() {
    if (!isFirebaseConfigured()) {
        store.setState({ syncStatus: 'offline' });
        return false;
    }

    try {
        if (!getApps().length) {
            app = initializeApp(firebaseConfig);
        } else {
            app = getApp();
        }

        auth = getAuth(app);
        firestore = getFirestore(app);
        googleProvider = new GoogleAuthProvider();
        googleProvider.setCustomParameters({ prompt: 'select_account' });

        // Listen for Auth changes and update store
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                store.setState({
                    user: {
                        uid: user.uid,
                        displayName: user.displayName || 'Conductor',
                        email: user.email,
                        photoURL: user.photoURL,
                    },
                    syncStatus: 'syncing',
                });
                // Attempt initial cloud sync on login
                try {
                    await pullFromCloud();
                } catch (pullErr) {
                    console.warn('[OCTANE SYNC] Pull on login skipped or failed:', pullErr.message);
                }
            } else {
                store.setState({ user: null, syncStatus: 'offline' });
            }
        });

        // Los avisos de conexión online/offline viven solo en main.js (antes se mostraban duplicados)

        return true;
    } catch (err) {
        console.warn('[OCTANE SYNC] Firebase initialization warning:', err.message);
        store.setState({ syncStatus: 'offline' });
        return false;
    }
}

/**
 * Signs in user via Google Popup.
 * @returns {Promise<Object|null>}
 */
export async function signInWithGoogle() {
    if (!isFirebaseConfigured()) {
        showToast('FIREBASE NO CONFIGURADO (.ENV)');
        return null;
    }

    try {
        if (!auth) initFirebase();
        const result = await signInWithPopup(auth, googleProvider);
        const user = result.user;
        const userPayload = {
            uid: user.uid,
            displayName: user.displayName || 'Conductor',
            email: user.email,
            photoURL: user.photoURL,
        };
        store.setState({ user: userPayload });
        showToast(`HOLA, ${userPayload.displayName.toUpperCase()}`);
        return userPayload;
    } catch (err) {
        if (err.code === 'auth/popup-closed-by-user') {
            showToast('LOGIN CANCELADO');
            return null;
        }
        console.error('[OCTANE AUTH] Error in signInWithGoogle:', err);
        showToast(`ERROR AUTH: ${err.message || 'FALLO'}`);
        return null;
    }
}

/**
 * Signs out current user.
 * @returns {Promise<void>}
 */
export async function signOutUser() {
    if (!auth) {
        store.setState({ user: null, syncStatus: 'offline' });
        return;
    }
    try {
        await signOut(auth);
        store.setState({ user: null, syncStatus: 'offline' });
        showToast('SESIÓN CERRADA');
    } catch (err) {
        console.error('[OCTANE AUTH] Error in signOutUser:', err);
        showToast('ERROR AL CERRAR SESIÓN');
    }
}

/**
 * Returns current authenticated user or null.
 * @returns {Object|null}
 */
export function getCurrentUser() {
    return store.getState().user;
}

/**
 * Registers an auth observer.
 * @param {Function} callback
 * @returns {Function} Unsubscribe callback
 */
export function onAuthChange(callback) {
    return store.subscribe((state, prevState) => {
        if (state.user !== prevState.user) {
            callback(state.user);
        }
    });
}

/**
 * Triggers a debounced (1.5s) or immediate synchronization to Firestore.
 * Call this after every local write in IndexedDB.
 * @param {Object} [options]
 * @param {boolean} [options.immediate=false]
 */
export function triggerCloudSync(options = {}) {
    if (debounceSyncTimer) {
        clearTimeout(debounceSyncTimer);
        debounceSyncTimer = null;
    }

    if (options && options.immediate) {
        return syncToCloud();
    }

    debounceSyncTimer = setTimeout(async () => {
        debounceSyncTimer = null;
        await syncToCloud();
    }, SYNC_DEBOUNCE_MS);
}

const CLOUD_MAX_BYTES = 850000;
const CLOUD_VOLTAGE_HISTORY_CAP = 180;
const CLOUD_NOTIFIED_STOPS_CAP = 60;
const CLOUD_MAX_TRIPS_DATES = 120;

/**
 * Sanitizes an IndexedDB snapshot before uploading to Cloud Firestore:
 * - Deep-clones snapshot safely without mutating the original object
 * - Strips heavy `trackPoints` arrays from `gpsCache.tripsByDate[dateKey]`
 * - Caps `gpsCache.voltageHistory` (latest 180) and `gpsCache.notifiedStopIds` (latest 60)
 * - Clears `gpsConfig.password` so GPS credentials stay exclusively local
 * - Prunes oldest `tripsByDate` keys (keeping latest 120 dates) if UTF-8 payload exceeds 850,000 bytes
 *
 * @param {Object} snapshot
 * @returns {Object}
 */
export function sanitizeSnapshotForCloud(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
        return {};
    }

    const cloned = JSON.parse(JSON.stringify(snapshot));
    const stores = cloned.stores;
    const profiles = [];

    if (stores && typeof stores === 'object') {
        if (Array.isArray(stores.vehicle_profile)) {
            for (const p of stores.vehicle_profile) {
                if (p && typeof p === 'object') profiles.push(p);
            }
        } else if (stores.vehicle_profile && typeof stores.vehicle_profile === 'object') {
            profiles.push(stores.vehicle_profile);
        }
    }

    for (const profile of profiles) {
        if (profile.gpsConfig && typeof profile.gpsConfig === 'object') {
            profile.gpsConfig.password = '';
        }

        const gpsCache = profile.gpsCache;
        if (gpsCache && typeof gpsCache === 'object') {
            if (gpsCache.tripsByDate && typeof gpsCache.tripsByDate === 'object') {
                for (const dateKey of Object.keys(gpsCache.tripsByDate)) {
                    const dayTrips = gpsCache.tripsByDate[dateKey];
                    if (Array.isArray(dayTrips)) {
                        for (const trip of dayTrips) {
                            if (trip && typeof trip === 'object' && 'trackPoints' in trip) {
                                delete trip.trackPoints;
                            }
                        }
                    }
                }
            }

            if (Array.isArray(gpsCache.voltageHistory) && gpsCache.voltageHistory.length > CLOUD_VOLTAGE_HISTORY_CAP) {
                gpsCache.voltageHistory = gpsCache.voltageHistory.slice(-CLOUD_VOLTAGE_HISTORY_CAP);
            }

            if (Array.isArray(gpsCache.notifiedStopIds) && gpsCache.notifiedStopIds.length > CLOUD_NOTIFIED_STOPS_CAP) {
                gpsCache.notifiedStopIds = gpsCache.notifiedStopIds.slice(-CLOUD_NOTIFIED_STOPS_CAP);
            }
        }
    }

    const encoder = new TextEncoder();
    const byteLength = (obj) => encoder.encode(JSON.stringify(obj)).length;

    if (byteLength(cloned) > CLOUD_MAX_BYTES) {
        for (const profile of profiles) {
            const tripsByDate = profile?.gpsCache?.tripsByDate;
            if (tripsByDate && typeof tripsByDate === 'object') {
                const sortedDates = Object.keys(tripsByDate).sort();
                if (sortedDates.length > CLOUD_MAX_TRIPS_DATES) {
                    const toPrune = sortedDates.slice(0, sortedDates.length - CLOUD_MAX_TRIPS_DATES);
                    for (const dateKey of toPrune) {
                        delete tripsByDate[dateKey];
                    }
                }
            }
        }
    }

    return cloned;
}

/**
 * Executes immediate synchronization of all IndexedDB stores to Cloud Firestore.
 * @returns {Promise<boolean>}
 */
export async function syncToCloud() {
    const user = store.getState().user;
    if (!user || !user.uid || !isFirebaseConfigured() || !firestore) {
        return false;
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
        store.setState({ syncStatus: 'offline' });
        return false;
    }

    if (activeSyncPromise) {
        try { await activeSyncPromise; } catch (_) {}
    }

    const run = (async () => {
        try {
            store.setState({ syncStatus: 'syncing' });

            const docRef = doc(firestore, 'users', user.uid, 'snapshots', 'master');

            // Fusionar primero lo que haya en la nube (p. ej. registros del celular) para no pisarlo con datos viejos
            try {
                const cloudSnap = await getDoc(docRef);
                if (cloudSnap.exists() && cloudSnap.data()?.stores) {
                    await importAllStores(cloudSnap.data(), { merge: true });
                    await refreshFromLocal();
                }
            } catch (mergeErr) {
                console.warn('[OCTANE SYNC] Pre-push merge skipped:', mergeErr.message);
            }

            const rawSnapshot = await exportAllStores();
            const snapshot = sanitizeSnapshotForCloud(rawSnapshot);

            await setDoc(docRef, {
                ...snapshot,
                uid: user.uid,
                userEmail: user.email,
                syncedAt: new Date().toISOString(),
                clientAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'OCTANE/1.0',
            }, { merge: true });

            const now = Date.now();
            retryAttempt = 0;
            if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
            store.setState({
                syncStatus: 'synced',
                lastSyncTimestamp: now,
            });

            return true;
        } catch (err) {
            console.warn('[OCTANE SYNC] Cloud sync failed:', err.message);
            store.setState({ syncStatus: 'error' });
            // Reintento automático con espera creciente (5 s, 30 s, 2 min); luego queda el reintento manual
            if (!retryTimer && retryAttempt < RETRY_DELAYS_MS.length) {
                const delay = RETRY_DELAYS_MS[retryAttempt++];
                retryTimer = setTimeout(() => { retryTimer = null; syncToCloud(); }, delay);
            }
            return false;
        }
    })();

    activeSyncPromise = run;
    try {
        return await run;
    } finally {
        if (activeSyncPromise === run) activeSyncPromise = null;
    }
}

/**
 * Relee IndexedDB, actualiza el store y avisa a las vistas abiertas para que se repinten.
 * @returns {Promise<Array>} logs actuales
 */
async function refreshFromLocal() {
    const [profile, logs, maintenanceItems] = await Promise.all([
        getVehicleProfile(),
        getTelemetryLogs(),
        getMaintenanceItems(),
    ]);
    store.setState({
        vehicleProfile: profile,
        telemetryLogs: logs,
        maintenanceItems,
        fuelPriceCop: profile.fuelPriceCop || store.getState().fuelPriceCop,
    });
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('octane:logs-updated', { detail: { logs } }));
        window.dispatchEvent(new CustomEvent('octane:maintenance-updated', { detail: { items: maintenanceItems } }));
        window.dispatchEvent(new CustomEvent('octane:notes-changed'));
        window.dispatchEvent(new CustomEvent('octane:legal-docs-updated'));
        window.dispatchEvent(new CustomEvent('octane:rides-updated'));
        window.dispatchEvent(new CustomEvent('octane:profile-updated'));
    }
    return logs;
}

let lastAutoPull = 0;
function autoPull() {
    const now = Date.now();
    if (now - lastAutoPull < 10000 || document.visibilityState === 'hidden') return;
    lastAutoPull = now;
    pullFromCloud({ silent: true });
}

function flushPendingSync() {
    if (debounceSyncTimer) {
        clearTimeout(debounceSyncTimer);
        debounceSyncTimer = null;
        syncToCloud();
    }
}

if (typeof window !== 'undefined') {
    // Traer cambios de otros dispositivos al volver a la pestaña, recuperar conexión o cada 60 s
    // y empujar escrituras pendientes antes de cerrar o bloquear el móvil
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            flushPendingSync();
        } else {
            autoPull();
        }
    });
    window.addEventListener('pagehide', flushPendingSync);
    window.addEventListener('focus', autoPull);
    window.addEventListener('online', () => {
        flushPendingSync();
        autoPull();
    });
    setInterval(autoPull, 60000);
}

/**
 * Pulls the latest snapshot from Cloud Firestore, merges into local IndexedDB,
 * updates all views, and pushes back sanitized snapshot if local had unsynced changes.
 * @returns {Promise<boolean>}
 */
export async function pullFromCloud({ silent = false } = {}) {
    const user = store.getState().user;
    if (!user || !user.uid || !isFirebaseConfigured() || !firestore) {
        return false;
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) return false;

    try {
        store.setState({ syncStatus: 'syncing' });

        const docRef = doc(firestore, 'users', user.uid, 'snapshots', 'master');
        const docSnap = await getDoc(docRef);

        if (!docSnap.exists()) {
            // First time user in cloud: push local data to seed cloud
            await syncToCloud();
            return true;
        }

        const cloudData = docSnap.data();
        if (cloudData && cloudData.stores) {
            const beforeSnap = await exportAllStores();
            const beforeFp = buildStoreFingerprint(beforeSnap.stores);

            await importAllStores(cloudData, { merge: true });
            await refreshFromLocal();

            const afterSnap = await exportAllStores();
            const afterFp = buildStoreFingerprint(afterSnap.stores);
            const cloudFp = buildStoreFingerprint(cloudData.stores);
            const changed = beforeFp !== afterFp;

            // Si este dispositivo tenía registros locales no subidos aún, empujarlos sanitizados a Firestore
            if (afterFp !== cloudFp) {
                const sanitized = sanitizeSnapshotForCloud(afterSnap);
                await setDoc(docRef, {
                    ...sanitized,
                    uid: user.uid,
                    userEmail: user.email,
                    syncedAt: new Date().toISOString(),
                    clientAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'OCTANE/1.0',
                }, { merge: true });
            }

            // En pulls automáticos solo avisar cuando realmente llegaron datos nuevos
            store.setState({ syncStatus: 'synced', lastSyncTimestamp: Date.now() });
            if (changed || !silent) showToast('NUBE SINCRONIZADA');
            return true;
        }

        store.setState({ syncStatus: 'synced' });
        return false;
    } catch (err) {
        console.warn('[OCTANE SYNC] Cloud pull failed:', err.message);
        store.setState({ syncStatus: 'error' });
        return false;
    }
}
