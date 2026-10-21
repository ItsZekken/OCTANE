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
import { exportAllStores, importAllStores, getVehicleProfile, getTelemetryLogs } from './db-local.js';

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
const SYNC_DEBOUNCE_MS = 1500;

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
                    syncStatus: 'synced',
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

        // Listen for online/offline events
        if (typeof window !== 'undefined') {
            window.addEventListener('online', () => {
                showToast('CONEXIÓN RESTAURADA');
                triggerCloudSync();
            });
            window.addEventListener('offline', () => {
                store.setState({ syncStatus: 'offline' });
                showToast('MODO SIN CONEXIÓN');
            });
        }

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
 * Triggers a debounced (1.5s) synchronization to Firestore.
 * Call this after every local write in IndexedDB.
 */
export function triggerCloudSync() {
    if (debounceSyncTimer) {
        clearTimeout(debounceSyncTimer);
    }

    debounceSyncTimer = setTimeout(async () => {
        debounceSyncTimer = null;
        await syncToCloud();
    }, SYNC_DEBOUNCE_MS);
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

    try {
        store.setState({ syncStatus: 'syncing' });

        const snapshot = await exportAllStores();
        const docRef = doc(firestore, 'users', user.uid, 'snapshots', 'master');

        await setDoc(docRef, {
            ...snapshot,
            uid: user.uid,
            userEmail: user.email,
            syncedAt: new Date().toISOString(),
            clientAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'OCTANE/1.0',
        }, { merge: true });

        const now = Date.now();
        store.setState({
            syncStatus: 'synced',
            lastSyncTimestamp: now,
        });

        return true;
    } catch (err) {
        console.warn('[OCTANE SYNC] Cloud sync failed:', err.message);
        store.setState({ syncStatus: 'error' });
        return false;
    }
}

/**
 * Pulls the latest snapshot from Cloud Firestore and updates local IndexedDB & store state.
 * @returns {Promise<boolean>}
 */
export async function pullFromCloud() {
    const user = store.getState().user;
    if (!user || !user.uid || !isFirebaseConfigured() || !firestore) {
        return false;
    }

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
            await importAllStores(cloudData, { merge: true });

            // Refresh store state with imported values
            const [profile, logs] = await Promise.all([
                getVehicleProfile(),
                getTelemetryLogs(),
            ]);

            store.setState({
                vehicleProfile: profile,
                telemetryLogs: logs,
                fuelPriceCop: profile.fuelPriceCop || store.getState().fuelPriceCop,
                syncStatus: 'synced',
                lastSyncTimestamp: Date.now(),
            });

            showToast('NUBE SINCRONIZADA');
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
