/**
 * OCTANE // KINETIC — Top Architectural Header Bar
 * 
 * Swiss flat 1px grid header with:
 * - Brand identity & active vehicle indicator
 * - Tactical audio haptics mute/unmute
 * - High-contrast theme toggle (Dark / Light)
 * 
 * Silencio visual y elegancia: Controles de parametrización (precio y unidad) 
 * y gestión de cuenta delegados a Ajustes. Sin alertas rojas redundantes.
 */

import { playHorologyTick, isSoundEnabled, toggleSound, setSoundEnabled } from '../core/telemetry-engine.js';
import store from '../core/state.js';
import { syncToCloud } from '../core/firebase-sync.js';

let headerState = {
    scope: 'full_era',
    unit: 'gal', // 'gal' | 'l100' | 'kml'
    fuelPriceCop: 16000,
    soundEnabled: true,
    theme: 'dark',
    user: null,
    vehicleName: '',
    alerts: null
};

let currentContainer = null;
let storeUnsubscribe = null;

function showToast(msg) {
    let pill = document.getElementById('toast-pill');
    if (!pill) {
        pill = document.createElement('div');
        pill.id = 'toast-pill';
        pill.className = 'fixed top-16 left-1/2 -translate-x-1/2 z-50 pointer-events-none opacity-0 -translate-y-2 transition-all duration-200';
        pill.innerHTML = `
            <div class="px-3.5 py-1.5 bg-[var(--text-primary)] text-[var(--bg-void)] flex items-center gap-2 text-[11px] font-mono font-medium tracking-wider uppercase border border-[var(--line-strong)]">
                <span class="w-1.5 h-1.5 bg-[var(--accent-amber)]"></span>
                <span id="toast-text">SYNC</span>
            </div>
        `;
        document.body.appendChild(pill);
    }
    const label = document.getElementById('toast-text');
    if (label) label.innerText = msg;
    pill.classList.remove('opacity-0', '-translate-y-2');
    pill.classList.add('opacity-100', 'translate-y-0');
    clearTimeout(pill._timer);
    pill._timer = setTimeout(() => {
        pill.classList.remove('opacity-100', 'translate-y-0');
        pill.classList.add('opacity-0', '-translate-y-2');
    }, 2000);
}

/**
 * Dispatches an event to notify the application of header control changes and syncs store.
 */
function dispatchStateChange(key, value) {
    headerState[key] = value;
    
    // Sync with reactive store
    if (store && typeof store.setState === 'function') {
        if (key === 'scope') store.setState({ scopeFilter: value });
        if (key === 'soundEnabled') store.setState({ soundEnabled: value });
        if (key === 'theme') store.setState({ theme: value });
    }

    window.dispatchEvent(new CustomEvent('octane:header-change', {
        detail: { key, value, state: { ...headerState } }
    }));
    window.dispatchEvent(new CustomEvent('octane:update-state', {
        detail: { [key]: value }
    }));
}

/**
 * Renders the top architectural bar into the designated container.
 * @param {HTMLElement} container - Header container element
 * @param {Object} options - Initial configuration options
 */
export function renderHeader(container, options = {}) {
    if (!container) return;
    currentContainer = container;

    // Pull from reactive store if available
    if (store && typeof store.getState === 'function') {
        const ss = store.getState();
        if (ss.scopeFilter) headerState.scope = ss.scopeFilter;
        if (ss.currentUnit) headerState.unit = ss.currentUnit;
        if (ss.fuelPriceCop) headerState.fuelPriceCop = Number(ss.fuelPriceCop);
        if (ss.soundEnabled !== undefined) {
            headerState.soundEnabled = ss.soundEnabled;
            setSoundEnabled(ss.soundEnabled);
        }
        if (ss.theme) headerState.theme = ss.theme;
        if (ss.user !== undefined) headerState.user = ss.user;
        if (ss.vehicleProfile?.name && ss.vehicleProfile?.isConfigured) headerState.vehicleName = ss.vehicleProfile.name;
        else headerState.vehicleName = '';
        if (ss.activeAlerts !== undefined) headerState.alerts = ss.activeAlerts;
    }

    // Merge options overrides
    if (options.scope !== undefined) headerState.scope = options.scope;
    if (options.soundEnabled !== undefined) {
        headerState.soundEnabled = Boolean(options.soundEnabled);
        setSoundEnabled(headerState.soundEnabled);
    }
    if (options.theme !== undefined) headerState.theme = options.theme;
    if (options.user !== undefined) headerState.user = options.user;
    if (options.vehicleName !== undefined) headerState.vehicleName = options.vehicleName;

    // Ensure initial document theme matches
    const currentTheme = document.documentElement.getAttribute('data-theme') || headerState.theme;
    headerState.theme = currentTheme;

    container.innerHTML = `
        <header class="sticky top-0 z-40 bg-[var(--bg-void)]/95 backdrop-blur-md border-b border-[var(--line-hair)]">
            <div class="max-w-5xl lg:max-w-6xl xl:max-w-7xl mx-auto px-4 h-12 flex items-center justify-between gap-4">
                
                <!-- Brand Identity (Swiss Flat Typography) -->
                <div class="flex items-center gap-2.5 cursor-pointer shrink-0" id="header-brand-logo" title="OCTANE">
                    <div class="w-2.5 h-2.5 bg-[var(--accent-amber)]"></div>
                    <span class="font-sans font-semibold text-sm tracking-tight text-[var(--text-primary)]">OCTANE</span>
                </div>

                <!-- Estado de guardado: solo un punto, sin texto permanente -->
                <button id="header-save-dot" type="button" class="w-8 h-8 flex items-center justify-center cursor-pointer" aria-label="Estado de guardado">
                    <span id="header-save-dot-led" class="w-1.5 h-1.5 rounded-full transition-colors"></span>
                </button>

            </div>
        </header>
    `;

    bindHeaderEvents();
    bindSaveDot();
    subscribeToStore();
}

/**
 * Resuelve el estado visible de guardado a partir del store.
 * @returns {{ color: string, message: string, retry: boolean }}
 */
function resolveSaveState() {
    const s = store.getState();
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (!s.user) return { color: 'var(--text-muted)', message: 'GUARDADO EN ESTE DISPOSITIVO', retry: false };
    if (offline || s.syncStatus === 'offline') return { color: 'var(--text-muted)', message: 'SIN CONEXIÓN · GUARDADO EN ESTE DISPOSITIVO', retry: false };
    if (s.syncStatus === 'syncing') return { color: 'var(--accent-amber)', message: 'SINCRONIZANDO', retry: false };
    if (s.syncStatus === 'error') return { color: 'var(--accent-crimson)', message: 'NO SE PUDO SINCRONIZAR · REINTENTANDO', retry: true };
    return { color: 'var(--accent-volt)', message: 'SINCRONIZADO', retry: false };
}

let saveDotUnsub = null;
function bindSaveDot() {
    if (!currentContainer) return;
    const dot = currentContainer.querySelector('#header-save-dot');
    const led = currentContainer.querySelector('#header-save-dot-led');
    if (!dot || !led) return;

    const paint = () => { led.style.backgroundColor = resolveSaveState().color; };
    paint();
    if (saveDotUnsub) saveDotUnsub();
    saveDotUnsub = store.subscribe((state, prev) => {
        if (state.syncStatus !== prev.syncStatus || state.user !== prev.user) paint();
    });
    window.addEventListener('online', paint);
    window.addEventListener('offline', paint);

    dot.addEventListener('click', () => {
        playHorologyTick(1000, 0.012, 0.02);
        const st = resolveSaveState();
        showToast(st.message);
        if (st.retry) syncToCloud();
    });
}

function bindHeaderEvents() {
    if (!currentContainer) return;

    // Brand click -> navigate home/cockpit
    const brand = currentContainer.querySelector('#header-brand-logo');
    if (brand) {
        brand.addEventListener('click', () => {
            playHorologyTick(900, 0.015, 0.02);
            if (store) store.setState({ currentView: 'cockpit' });
            window.dispatchEvent(new CustomEvent('octane:navigate', { detail: { view: 'cockpit' } }));
        });
    }

    // Audio Haptics Toggle
    const soundBtn = currentContainer.querySelector('#sound-btn');
    const onIcon = currentContainer.querySelector('#sound-on-icon');
    const offIcon = currentContainer.querySelector('#sound-off-icon');
    if (soundBtn) {
        soundBtn.addEventListener('click', () => {
            const active = toggleSound();
            headerState.soundEnabled = active;
            if (onIcon) onIcon.classList.toggle('hidden', !active);
            if (offIcon) offIcon.classList.toggle('hidden', active);
            showToast(active ? 'AUDIO TÁCTIL ON' : 'MUTE');
            dispatchStateChange('soundEnabled', active);
        });
    }

    // Theme Toggle
    const themeBtn = currentContainer.querySelector('#theme-btn');
    if (themeBtn) {
        themeBtn.addEventListener('click', () => {
            playHorologyTick(900, 0.02, 0.03);
            const current = document.documentElement.getAttribute('data-theme') || 'dark';
            const next = current === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            headerState.theme = next;
            showToast(next === 'dark' ? 'MODO CARBÓN' : 'MODO PAPEL');
            dispatchStateChange('theme', next);
        });
    }
}

function subscribeToStore() {
    if (!store || typeof store.subscribe !== 'function') return;
    if (storeUnsubscribe) storeUnsubscribe();

    storeUnsubscribe = store.subscribe((state, prevState) => {
        if (!currentContainer) return;

        // Vehicle profile change
        if (state.vehicleProfile?.name && state.vehicleProfile.name !== headerState.vehicleName) {
            headerState.vehicleName = state.vehicleProfile.name;
            const tag = currentContainer.querySelector('#header-vehicle-tag');
            if (tag) tag.innerText = headerState.vehicleName;
        }
    });
}

/**
 * Updates the user profile state in the header.
 */
export function setHeaderUser(user) {
    headerState.user = user;
}

/**
 * Updates the vehicle tag in the header.
 */
export function setHeaderVehicleTag(vehicleName) {
    headerState.vehicleName = vehicleName || 'VEHÍCULO';
    if (currentContainer) {
        const tag = currentContainer.querySelector('#header-vehicle-tag');
        if (tag) {
            tag.innerText = headerState.vehicleName;
        }
    }
}

/**
 * Clean up header listeners and timers.
 */
export function destroyHeader() {
    if (storeUnsubscribe) {
        storeUnsubscribe();
        storeUnsubscribe = null;
    }
    currentContainer = null;
}
