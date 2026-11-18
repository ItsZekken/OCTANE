/**
 * OCTANE // KINETIC — Reactive State Store & Horology Audio Synthesizer
 * High-performance, zero-dependency Pub/Sub architecture for Vanilla JS.
 */

// --------------------------------------------------------------------------
// Audio Tick Synthesizer (Web Audio API)
// --------------------------------------------------------------------------
let audioCtx = null;

/**
 * Synthesizes a precise, mechanical horology tick sound for tactile feedback.
 * @param {number} [freq=1200] - Base frequency in Hz
 * @param {number} [dur=0.012] - Duration in seconds
 * @param {number} [gainVal=0.025] - Audio gain/volume
 */
export function playHorologyTick(freq = 1200, dur = 0.012, gainVal = 0.025) {
    if (typeof window === 'undefined') return;
    const currentState = store ? store.getState() : null;
    if (currentState && currentState.soundEnabled === false) return;

    try {
        if (!audioCtx) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (AudioContextClass) {
                audioCtx = new AudioContextClass();
            }
        }
        if (!audioCtx) return;

        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }

        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now);
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * 0.15), now + dur);

        gain.gain.setValueAtTime(gainVal, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

        osc.connect(gain);
        gain.connect(audioCtx.destination);

        osc.start(now);
        osc.stop(now + dur);
    } catch {
        // Defensive: audio context blocked or unsupported
    }
}

// --------------------------------------------------------------------------
// Minimal Toast Notification Controller
// --------------------------------------------------------------------------
let toastTimer = null;

/**
 * Displays a minimal, non-blocking toast banner.
 * @param {string} msg - Message to display
 * @param {number} [durationMs=2200] - Display duration
 */
export function showToast(msg, durationMs = 2200) {
    if (typeof document === 'undefined') return;
    const pill = document.getElementById('toast-pill');
    const label = document.getElementById('toast-text');

    if (!pill || !label) {
        console.info(`[OCTANE TOAST] ${msg}`);
        return;
    }

    label.textContent = msg;

    if (toastTimer) {
        clearTimeout(toastTimer);
        toastTimer = null;
    }

    pill.classList.remove('opacity-0', '-translate-y-3');
    pill.classList.add('opacity-100', 'translate-y-0');

    toastTimer = setTimeout(() => {
        pill.classList.remove('opacity-100', 'translate-y-0');
        pill.classList.add('opacity-0', '-translate-y-3');
        toastTimer = null;
    }, durationMs);
}

// --------------------------------------------------------------------------
// Reactive Store Implementation
// --------------------------------------------------------------------------

/**
 * Creates an observable Pub/Sub store.
 * @param {Object} initialState
 */
export function createStore(initialState) {
    let state = { ...initialState };
    const listeners = new Set();

    return {
        /**
         * Get current snapshot of the state.
         * @returns {Object}
         */
        getState() {
            return { ...state };
        },

        /**
         * Updates state and notifies subscribers if values changed.
         * Accepts either a partial state object or an updater function.
         * @param {Object|Function} updater
         */
        setState(updater) {
            const prevState = state;
            const partial = typeof updater === 'function' ? updater(prevState) : updater;

            if (!partial || typeof partial !== 'object') return;

            // Check if any key actually changed
            let hasChanged = false;
            for (const key of Object.keys(partial)) {
                if (partial[key] !== prevState[key]) {
                    hasChanged = true;
                    break;
                }
            }

            if (!hasChanged) return;

            state = Object.freeze({ ...prevState, ...partial });

            // Notify all subscribers snapshot (prevents infinite loop if listener mutates Set)
            const currentListeners = Array.from(listeners);
            for (const listener of currentListeners) {
                try {
                    listener(state, prevState);
                } catch (err) {
                    console.error('[OCTANE STORE] Error in state listener:', err);
                }
            }
        },

        /**
         * Subscribe to state mutations.
         * @param {Function} listener - (state, prevState) => void
         * @returns {Function} Unsubscribe callback
         */
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },

        /**
         * Number of active subscribers.
         */
        get subscriberCount() {
            return listeners.size;
        }
    };
}

// Read persistent preferences if available
const savedTheme = typeof localStorage !== 'undefined' ? localStorage.getItem('octane_theme') || 'dark' : 'dark';
const savedSound = typeof localStorage !== 'undefined' ? localStorage.getItem('octane_sound_enabled') !== 'false' : true;

// Initial state definition — strict ZERO dummy data
export const INITIAL_STATE = Object.freeze({
    vehicleProfile: null,
    telemetryLogs: [],
    maintenanceItems: [],
    user: null,
    currentUnit: 'gal',              // 'gal' | 'l100' | 'kml'
    scopeFilter: 'full_era',         // 'full_era' | 'all'
    currentView: 'cockpit',          // 'cockpit' | 'cluster' | 'glovebox' | 'rides' | 'settings'
    ridesContextDate: null,          // 'YYYY-MM-DD' | null — fecha por defecto para nuevos registros en Carreras
    soundEnabled: savedSound,
    fuelPriceCop: 16000,
    theme: savedTheme,               // 'dark' | 'light'
    warpKm: 0,
    selectedCycleIdx: null,
    selectedMonth: 'all',
    isSyncModalOpen: false,
    syncStatus: 'idle',              // 'idle' | 'syncing' | 'synced' | 'error' | 'offline'
    lastSyncTimestamp: null,
});

// Singleton store instance
export const store = createStore(INITIAL_STATE);

// Synchronize theme with DOM on state change
store.subscribe((state, prevState) => {
    if (state.theme !== prevState.theme && typeof document !== 'undefined') {
        document.documentElement.setAttribute('data-theme', state.theme);
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('octane_theme', state.theme);
        }
    }
    if (state.soundEnabled !== prevState.soundEnabled && typeof localStorage !== 'undefined') {
        localStorage.setItem('octane_sound_enabled', state.soundEnabled ? 'true' : 'false');
    }
});

// Export default
export default store;
