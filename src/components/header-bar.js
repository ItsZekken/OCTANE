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
            <div class="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
                
                <!-- Brand Identity (Swiss Flat Typography) -->
                <div class="flex items-center gap-3 cursor-pointer shrink-0" id="header-brand-logo" title="OCTANE">
                    <div class="w-2.5 h-2.5 bg-[var(--accent-amber)]"></div>
                    <div class="flex flex-col sm:flex-row sm:items-baseline sm:gap-2.5">
                        <span class="font-sans font-semibold text-sm tracking-tight text-[var(--text-primary)]">OCTANE</span>
                        <span class="font-mono text-[9px] sm:text-[10px] text-[var(--text-secondary)] tracking-widest uppercase">TELEMETRÍA VEHICULAR</span>
                        <span id="header-vehicle-tag" class="hidden md:inline-block font-mono text-[10px] text-[var(--text-muted)] tracking-widest uppercase">${headerState.vehicleName}</span>
                    </div>
                </div>

                <!-- Flat Precision Controls (Sound + Theme) -->
                <div class="flex items-center gap-2">
                    <!-- Tactical Audio Haptics Toggle -->
                    <button id="sound-btn" type="button" class="h-8 w-8 rounded-sm flat-pill flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)]" title="Audio háptico táctil">
                        <svg id="sound-on-icon" class="w-3.5 h-3.5 ${isSoundEnabled() ? '' : 'hidden'}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/>
                        </svg>
                        <svg id="sound-off-icon" class="w-3.5 h-3.5 ${isSoundEnabled() ? 'hidden' : ''} opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15zM17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"/>
                        </svg>
                    </button>

                    <!-- Dark / Light Architectural Theme Switch -->
                    <button id="theme-btn" type="button" class="h-8 w-8 rounded-sm flat-pill flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)]" title="Modo Carbon / Papel">
                        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/>
                        </svg>
                    </button>
                </div>
            </div>
        </header>
    `;

    bindHeaderEvents();
    subscribeToStore();
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
