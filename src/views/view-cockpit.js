/**
 * OCTANE // KINETIC — Main Cockpit View
 * Swiss Architectural Telemetry View:
 * - Block 00: Compact Chassis Telemetry Band (h-28 sm:h-32) with High-Contrast Engineering CAD
 * - Hairline Top Strip when 0 records: "0 LECTURAS EN MEMORIA" + [↑ IMPORTAR JSON] + [+ LECTURA]
 * - Stage 01: Liquid Sight-Glass Chamber + Kinetic Time-Warp Scrubber + 2x2 Architectural KPI Matrix
 * - Stage 02: Los Monolitos (Closed Full Cycles + Active Live Column)
 * - Stage 03: Frequency Horizon & 7-Day Weekday DNA
 * - Stage 04: Bitácora Raw (Search, Type Filters, Edit & Delete)
 * 
 * Silencio Verbal Absoluto: Zero <p> tags, zero drop shadows, max 3-4 words per static text block.
 */

import { confirmDialog } from '../components/dialogs/app-dialog.js';
import {
    calculateTelemetryModel,
    formatEff,
    formatVol,
    formatDateShort,
    formatDateWithWeekday,
    playHorologyTick,
    GAL_TO_L,
    DEFAULT_TANK_CAPACITY_GAL,
    DEFAULT_RESERVE_GAL
} from '../core/telemetry-engine.js';

import { sanitizeFuelCostCop } from '../core/number-utils.js';

import { getVehicleModel } from '../assets/vehicles-svg/catalog.js';
import { getInlineVehicleSvg } from '../assets/vehicles-svg/models-inline.js';
import store from '../core/state.js';
import { deleteTelemetryLog, bulkAddTelemetryLogs } from '../core/db-local.js';
import { getActiveAlerts, renderAlertsBadgeHtml } from '../core/alerts-engine.js';
import { openTelemetryDetailModal, initTelemetryDetailModal } from '../components/modals/modal-telemetry-detail.js';
import { todayLocalYmd } from '../core/date-utils.js';
import { openGpsTripsModal } from '../components/modals/modal-gps-trips.js';
import { syncGpsTelemetry } from '../core/iopgps-sync.js';
import { openKpiDetailModal, closeKpiDetailModal, renderMiniSparklineSvg, getToneColorVar } from '../components/modals/modal-kpi-detail.js';
import {
    computeEfficiencyTrend,
    computeCostPerKmTrend,
    computeMonthlyFuelMetrics,
    computeUsageRhythmTrend,
    computeCockpitGpsSummary
} from '../core/cockpit-analytics.js';
import { openGhostRaceModal, detectRecurrentRoute } from './modal-ghost-race.js';

export { detectRecurrentRoute } from './modal-ghost-race.js';

let cockpitState = {
    logs: [],
    vehicleProfile: {
        id: 'picanto-2017',
        name: 'Kia Picanto 1.0L',
        tankCapacityLiters: 35.0,
        tankCapacityGallons: 9.25,
        reserveLiters: 5.0,
        fuelPriceCop: 16000,
        gaugeStyle: 'spicy-arc',
        svgModel: 'picanto-2017'
    },
    scope: 'full_era',
    unit: 'gal',
    fuelPriceCop: 16000,
    selectedCycleIdx: null,
    selectedMonth: 'all',
    activeSynthIdx: -1,
    timeWarpKm: 0,
    sightGlassMode: 0, // 0: AUTONOMÍA, 1: TIEMPO DE TANQUE, 2: VALOR EN TANQUE
    model: null
};

// Canvas animation handle & state
let animFrameId = null;
let currentContainer = null;
let boundListeners = [];
let storeUnsubscribe = null;

const WEEKDAYS_ES = ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'];
const MONTHS_ES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

export { formatDateWithWeekday };

/**
 * Injects kinetic animations and micro-interaction keyframes for chassis and odometer.
 */
function ensureCockpitStyles() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('octane-cockpit-kinetics-styles')) return;
    const style = document.createElement('style');
    style.id = 'octane-cockpit-kinetics-styles';
    style.textContent = `
        @keyframes wheel-burnout-3s {
            0% { transform: rotate(0deg); }
            35% { transform: rotate(-1440deg); }
            46% { transform: rotate(-1600deg); }
            80% { transform: rotate(-3200deg); }
            100% { transform: rotate(-3600deg); }
        }
        .animate-wheel-burnout-3s {
            animation: wheel-burnout-3s 3.0s cubic-bezier(0.25, 1, 0.4, 1) forwards;
        }
        @keyframes chassis-launch-3s {
            0% { transform: translateY(0) rotate(0deg); }
            10% { transform: translateY(-3px) rotate(1.2deg); }
            40% { transform: translateY(-2px) rotate(0.9deg); }
            47% { transform: translateY(1.2px) rotate(-0.6deg); }
            55% { transform: translateY(-2px) rotate(0.8deg); }
            85% { transform: translateY(-0.5px) rotate(0.2deg); }
            100% { transform: translateY(0) rotate(0deg); }
        }
        .animate-chassis-launch-3s {
            animation: chassis-launch-3s 3.0s cubic-bezier(0.25, 1, 0.4, 1) forwards;
        }
        @keyframes chassis-idle-vibe {
            0%, 100% { transform: translateY(0) rotate(0deg); }
            15% { transform: translateY(-0.8px) rotate(0.12deg); }
            30% { transform: translateY(0.5px) rotate(-0.1deg); }
            45% { transform: translateY(-0.6px) rotate(0.08deg); }
            60% { transform: translateY(0.7px) rotate(-0.15deg); }
            75% { transform: translateY(-1.1px) rotate(0.2deg); }
            90% { transform: translateY(0.4px) rotate(-0.06deg); }
        }
        .animate-chassis-idle {
            animation: chassis-idle-vibe 0.3s ease-in-out infinite;
        }
        .headlight-cone {
            position: absolute;
            left: 2%;
            top: 25%;
            width: 32%;
            height: 48%;
            background: radial-gradient(ellipse at 100% 50%, rgba(255, 255, 255, 0.85) 0%, rgba(254, 240, 138, 0.4) 40%, rgba(255, 255, 255, 0) 75%);
            clip-path: polygon(100% 46%, 0% 15%, 0% 85%, 100% 54%);
            pointer-events: none;
            mix-blend-mode: screen;
            opacity: 0;
            z-index: 25;
        }
        @keyframes headlight-flash-double {
            0% { opacity: 0; transform: scaleX(0.8); }
            6% { opacity: 1; transform: scaleX(1); }
            18% { opacity: 1; }
            24% { opacity: 0; }
            32% { opacity: 0; }
            38% { opacity: 1; transform: scaleX(1); }
            58% { opacity: 1; }
            70% { opacity: 0; transform: scaleX(0.9); }
            100% { opacity: 0; }
        }
        .animate-headlight-flash {
            animation: headlight-flash-double 1.8s ease-out forwards;
        }
        @keyframes rear-stop-flash {
            0% { filter: drop-shadow(0 0 2px #F43F5E); }
            8% { filter: drop-shadow(0 0 16px #F43F5E) drop-shadow(0 0 30px #EF4444); }
            68% { filter: drop-shadow(0 0 16px #F43F5E) drop-shadow(0 0 30px #EF4444); }
            100% { filter: drop-shadow(0 0 0 transparent); }
        }
        .animate-rear-stop-flash {
            animation: rear-stop-flash 1.8s ease-out forwards;
        }
        @keyframes drum-settle {
            0% { transform: translateY(-5px); }
            40% { transform: translateY(2px); }
            75% { transform: translateY(-1px); }
            100% { transform: translateY(0); }
        }
        .animate-drum-settle {
            animation: drum-settle 0.3s cubic-bezier(0.2, 1.4, 0.4, 1) forwards;
        }
    `;
    document.head.appendChild(style);
}
if (typeof document !== 'undefined') {
    ensureCockpitStyles();
}

function getAudioContext() {
    if (typeof window === 'undefined') return null;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!window.__OCTANE_AUDIO_CTX__ || window.__OCTANE_AUDIO_CTX__.state === 'closed') {
        window.__OCTANE_AUDIO_CTX__ = new AudioContextClass();
    }
    const ctx = window.__OCTANE_AUDIO_CTX__;
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
}

/**
 * Synthesizes a refined mechanical engine rev roar via Web Audio API.
 * High-precision analog lowpass sweep with low-frequency engine harmonics.
 */
function playEngineRevSound() {
    try {
        const ctx = getAudioContext();
        if (!ctx) return;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();

        osc.type = 'sawtooth';
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(170, ctx.currentTime);
        filter.frequency.exponentialRampToValueAtTime(460, ctx.currentTime + 0.35);
        filter.frequency.exponentialRampToValueAtTime(110, ctx.currentTime + 0.78);

        osc.frequency.setValueAtTime(52, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(165, ctx.currentTime + 0.35);
        osc.frequency.exponentialRampToValueAtTime(56, ctx.currentTime + 0.78);

        gain.gain.setValueAtTime(0.001, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 0.1);
        gain.gain.exponentialRampToValueAtTime(0.0005, ctx.currentTime + 0.78);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);

        osc.start();
        osc.stop(ctx.currentTime + 0.79);
    } catch {
        // Safe audio fallback
    }
}

/**
 * Web Audio API Synthesis: Modo 0 (Acelerón a Fondo ~3.0s).
 * 1ra marcha (55Hz -> 220Hz), corte a 2da a 1.4s, desaceleración grave hasta 3.0s.
 */
function playBurnoutSound3s() {
    try {
        const ctx = getAudioContext();
        if (!ctx) return;

        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();

        osc.type = 'sawtooth';
        filter.type = 'lowpass';

        // 1ra marcha (0s - 1.4s): 55Hz sube a 220Hz
        osc.frequency.setValueAtTime(55, now);
        osc.frequency.exponentialRampToValueAtTime(220, now + 1.35);

        // Corte y cambio a 2da marcha a los 1.4s
        osc.frequency.setValueAtTime(115, now + 1.42);

        // 2da marcha sube a 185Hz y desacelera grave hasta 3.0s
        osc.frequency.exponentialRampToValueAtTime(185, now + 1.95);
        osc.frequency.exponentialRampToValueAtTime(48, now + 2.95);

        // Barrido del filtro lowpass
        filter.frequency.setValueAtTime(180, now);
        filter.frequency.exponentialRampToValueAtTime(700, now + 1.35);
        filter.frequency.setValueAtTime(290, now + 1.42);
        filter.frequency.exponentialRampToValueAtTime(540, now + 1.95);
        filter.frequency.exponentialRampToValueAtTime(110, now + 2.95);

        // Curva de ganancia con caída de corte en 1.4s
        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.065, now + 0.12);
        gain.gain.setValueAtTime(0.065, now + 1.35);
        gain.gain.linearRampToValueAtTime(0.012, now + 1.42);
        gain.gain.linearRampToValueAtTime(0.06, now + 1.55);
        gain.gain.setValueAtTime(0.05, now + 2.3);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.98);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 3.0);
    } catch {
        // Fallback
    }
}

/**
 * Web Audio API Synthesis: Modo 1 (Relé electromecánico de luces).
 * Doble clic nítido de alta frecuencia táctil.
 */
function playRelayClickSound(delaySec = 0) {
    try {
        const ctx = getAudioContext();
        if (!ctx) return;

        const t = ctx.currentTime + delaySec;
        [0, 0.035].forEach((offset, idx) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            const filter = ctx.createBiquadFilter();

            osc.type = 'triangle';
            osc.frequency.setValueAtTime(idx === 0 ? 3400 : 2750, t + offset);
            osc.frequency.exponentialRampToValueAtTime(1200, t + offset + 0.014);

            filter.type = 'bandpass';
            filter.frequency.setValueAtTime(2900, t + offset);
            filter.Q.setValueAtTime(5.0, t + offset);

            gain.gain.setValueAtTime(0.001, t + offset);
            gain.gain.linearRampToValueAtTime(0.075, t + offset + 0.002);
            gain.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.016);

            osc.connect(filter);
            filter.connect(gain);
            gain.connect(ctx.destination);

            osc.start(t + offset);
            osc.stop(t + offset + 0.018);
        });
    } catch {}
}

/**
 * Web Audio API Synthesis: Modo 2 (Ralentí Mecánico / Acelerón en Neutro).
 * Ronroneo grave de escape a bajas revoluciones (sub-bass 42-65Hz modulado).
 */
function playEngineIdleSound() {
    try {
        const ctx = getAudioContext();
        if (!ctx) return;

        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();

        osc.type = 'sawtooth';
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(115, now);

        // Sub-bass 42Hz a 65Hz modulado
        osc.frequency.setValueAtTime(42, now);
        osc.frequency.linearRampToValueAtTime(54, now + 0.35);
        osc.frequency.linearRampToValueAtTime(45, now + 0.7);
        osc.frequency.linearRampToValueAtTime(65, now + 1.25);
        osc.frequency.linearRampToValueAtTime(48, now + 1.65);
        osc.frequency.linearRampToValueAtTime(42, now + 2.15);

        filter.frequency.linearRampToValueAtTime(155, now + 1.25);
        filter.frequency.linearRampToValueAtTime(95, now + 2.15);

        gain.gain.setValueAtTime(0.001, now);
        gain.gain.linearRampToValueAtTime(0.055, now + 0.15);
        gain.gain.setValueAtTime(0.055, now + 1.8);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.18);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 2.2);
    } catch {}
}

const fluidPhysics = {
    targetPct: 0,
    currentPct: 0,
    basePct: 0,
    wavePhase1: 0,
    wavePhase2: 0,
    sloshEnergy: 0,
    sloshVelocity: 0,
    warpKm: 0,
    bubbles: Array.from({ length: 18 }, (_, i) => ({
        x: Math.random(),
        y: Math.random(),
        r: 1.0 + Math.random() * 2.8,
        speed: 0.0025 + Math.random() * 0.005,
        depth: i % 3
    }))
};

function disturbFluid(impulse = 1.0) {
    fluidPhysics.sloshVelocity += impulse;
}

/**
 * High-Contrast Engineering CAD Blueprint SVG (Teenage Engineering CAD aesthetic).
 * Uses canonical stylized vehicle silhouettes in "Bold Industrial Silhouette" style.
 * Renders live vehicle color via CSS variable --car-paint.
 */
export function renderInlineCadSvg(modelId = 'kia-picanto', colorHex = '#FF5500') {
    let svg = getInlineVehicleSvg(modelId, colorHex);
    if (svg) {
        svg = svg.replace('class="w-full h-auto"', 'class="max-h-full max-w-full h-full w-auto object-contain mx-auto" preserveAspectRatio="xMidYMid meet"');
    }
    return svg;
}
if (typeof window !== 'undefined') {
    window.renderInlineCadSvg = renderInlineCadSvg;
}

/**
 * Clean Swiss Notification Toast
 */
function showToast(msg) {
    let pill = document.getElementById('toast-pill');
    if (!pill) {
        pill = document.createElement('div');
        pill.id = 'toast-pill';
        pill.className = 'fixed top-16 left-1/2 -translate-x-1/2 z-50 pointer-events-none opacity-0 -translate-y-2 transition-all duration-200';
        pill.innerHTML = `
            <div class="px-3 py-1 bg-[var(--text-primary)] text-[var(--bg-void)] flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest border border-[var(--line-strong)] rounded-sm">
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
    }, 2200);
}

/**
 * Loads logs from available stores or storage without hardcoded dummy data.
 */
function loadInitialLogs() {
    if (store && typeof store.getState === 'function') {
        const ss = store.getState();
        if (Array.isArray(ss.telemetryLogs) && ss.telemetryLogs.length > 0) {
            return ss.telemetryLogs;
        }
    }
    if (typeof window !== 'undefined') {
        if (window.__OCTANE_LOGS__ && Array.isArray(window.__OCTANE_LOGS__)) {
            return window.__OCTANE_LOGS__;
        }
        try {
            const saved = localStorage.getItem('octane_kinetic_v1') || localStorage.getItem('octane_telemetry_logs');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed)) return parsed;
                if (parsed.telemetry_logs && Array.isArray(parsed.telemetry_logs)) return parsed.telemetry_logs;
            }
        } catch {
            // Ignore parse errors
        }
    }
    return [];
}

/**
 * Main Cockpit Render Function.
 * ALWAYS renders Stages 01 to 04 (Cockpit Siempre Visible - LEY 5).
 * @param {HTMLElement} container - DOM mount container
 * @param {Object} options - Configuration overrides
 */
export function renderCockpit(container, options = {}) {
    if (!container) return;
    currentContainer = container;

    // Pull from reactive store defaults if available
    if (store && typeof store.getState === 'function') {
        const ss = store.getState();
        if (ss.vehicleProfile) {
            cockpitState.vehicleProfile = { ...cockpitState.vehicleProfile, ...ss.vehicleProfile };
        }
        if (ss.scopeFilter) cockpitState.scope = ss.scopeFilter;
        if (ss.currentUnit) cockpitState.unit = ss.currentUnit;
        if (ss.fuelPriceCop) cockpitState.fuelPriceCop = Number(ss.fuelPriceCop);
        if (Array.isArray(ss.telemetryLogs)) {
            cockpitState.logs = ss.telemetryLogs;
        }
    }

    // Apply options if provided
    if (options.logs !== undefined) {
        cockpitState.logs = options.logs;
    } else if (!cockpitState.logs || cockpitState.logs.length === 0) {
        cockpitState.logs = loadInitialLogs();
    }

    if (options.vehicleProfile) {
        cockpitState.vehicleProfile = { ...cockpitState.vehicleProfile, ...options.vehicleProfile };
    }
    if (options.scope !== undefined) cockpitState.scope = options.scope;
    if (options.unit !== undefined) cockpitState.unit = options.unit;
    if (options.fuelPriceCop !== undefined) cockpitState.fuelPriceCop = Number(options.fuelPriceCop);

    // Compute mathematical model (gracefully handles empty logs)
    cockpitState.model = calculateTelemetryModel(cockpitState.logs || [], cockpitState.vehicleProfile, {
        scope: cockpitState.scope,
        unit: cockpitState.unit,
        fuelPriceCop: cockpitState.fuelPriceCop
    });

    ensureCockpitStyles();
    renderActiveCockpit(container);
    setupGlobalEvents();
}

/**
 * Split-Roller / Drum Counter mechanical odometer component
 * Renders individual digits in precision horology vertical drum capsules.
 */
function renderDrumOdometer(odo) {
    const val = Math.round(Number(odo) || 0);
    const str = String(val).padStart(6, '0');
    return str.split('').map((d, idx) => `
        <div class="drum-digit relative w-7 sm:w-9 md:w-11 h-10 sm:h-13 md:h-15 bg-[var(--bg-void)] border border-[var(--line-strong)] flex items-center justify-center font-mono text-xl sm:text-2xl md:text-3xl font-medium tabular-nums text-[var(--text-primary)] overflow-hidden shadow-inner select-none transition-transform" data-drum-idx="${idx}">
            <div class="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[1px] bg-white/10 pointer-events-none"></div>
            <div class="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/40 pointer-events-none"></div>
            <span class="relative z-10">${d}</span>
        </div>
    `).join('');
}

/**
 * Returns the price per gallon from the most recent refuel, or default.
 */
export function getLastRefuelPrice(logs, defaultPrice = 16000) {
    if (!Array.isArray(logs) || logs.length === 0) return defaultPrice;
    for (let i = logs.length - 1; i >= 0; i--) {
        const l = logs[i];
        const gals = Number(l.gallons_added) || 0;
        if ((l.refuels_count > 0 || l.is_full_tank || l.isFullTank) && gals > 0) {
            const sanitizedCost = sanitizeFuelCostCop(l.total_cost_cop, gals, defaultPrice);
            const p = Math.round(sanitizedCost / gals);
            if (p > 5000 && p < 45000) return p;
        }
    }
    return defaultPrice;
}

/**
 * Computes fuel expenditure for the current month vs previous month.
 */
export function getMonthlyFuelStats(logs, priceCop = 16000) {
    return computeMonthlyFuelMetrics(logs, null, priceCop);
}

/**
 * Formats a flat GPS DATA telemetry module directly in the Cockpit.
 * Keeps zero nested boxes and zero fake labels; adapts cleanly when disconnected.
 */
function renderCockpitGpsBand(gpsSummary) {
    if (!gpsSummary || !gpsSummary.isConnected) {
        return `
            <section class="flat-frame bg-[var(--bg-surface)] border border-[var(--line-hair)] px-4 py-3 flex items-center justify-between gap-4">
                <div class="flex items-center gap-2.5 min-w-0">
                    <span class="w-1.5 h-1.5 rounded-full bg-[var(--text-muted)] shrink-0"></span>
                    <span class="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-primary)]">GPS DATA</span>
                </div>
                <button id="cockpit-gps-settings-btn" type="button" class="font-mono text-[10px] uppercase tracking-widest text-[var(--accent-amber)] hover:text-[var(--text-primary)] transition-colors cursor-pointer shrink-0">
                    CONECTAR →
                </button>
            </section>
        `;
    }

    const phys = gpsSummary.activePhys;
    const sentinel = gpsSummary.parkingSentinel || null;
    const statusDotClass = gpsSummary.accStatus
        ? 'bg-[var(--accent-volt)] animate-pulse'
        : (gpsSummary.hasLive ? 'bg-[var(--accent-volt)]' : 'bg-[var(--accent-amber)]');

    const parkedHeaderText = sentinel?.isParked
        ? (sentinel.parkedDurationLabel
            ? `PARQUEADO · ${sentinel.parkedDurationLabel} · ${sentinel.placeLabel}`
            : `PARQUEADO · ${sentinel.placeLabel}`)
        : '';

    const headerStatusText = gpsSummary.accStatus
        ? `EN MARCHA · ${gpsSummary.liveSpeed} KM/H`
        : (parkedHeaderText || (gpsSummary.address ? gpsSummary.address.toUpperCase() : (gpsSummary.syncedAgo || 'ENLAZADO')));

    const voltageText = gpsSummary.voltage > 0 ? `${gpsSummary.voltage.toFixed(1)} V` : '—';
    const voltageColor = gpsSummary.voltage > 0 ? getToneColorVar(gpsSummary.batteryTone) : 'var(--text-secondary)';
    const trip = gpsSummary.latestTrip;

    return `
        <section id="cockpit-gps-panel" class="flat-frame bg-[var(--bg-surface)] border border-[var(--line-hair)] divide-y divide-[var(--line-hair)] overflow-hidden">
            <!-- Header Row -->
            <div class="px-3.5 sm:px-4 py-2 bg-[var(--bg-void)] flex items-center justify-between gap-3">
                <div id="cockpit-gps-data-trigger" class="flex items-center gap-2 min-w-0 flex-1 cursor-pointer">
                    <span class="w-1.5 h-1.5 rounded-full shrink-0 ${statusDotClass}"></span>
                    <span class="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-primary)] shrink-0">GPS DATA</span>
                    <span class="text-[var(--line-strong)]">·</span>
                    <span class="font-mono text-[10px] uppercase tracking-wider text-[var(--text-secondary)] truncate">${headerStatusText}</span>
                </div>

                <div class="flex items-center gap-2.5 shrink-0">
                    ${gpsSummary.isConfigured ? `
                        <button id="cockpit-gps-sync-btn" type="button" title="Sincronizar GPS" class="w-7 h-7 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer">
                            <svg id="cockpit-gps-sync-icon" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                        </button>
                    ` : ''}
                    <button id="cockpit-gps-intel-btn" type="button" class="font-mono text-[10px] text-[var(--text-secondary)] hover:text-[var(--accent-amber)] uppercase tracking-widest cursor-pointer transition-colors">
                        ANÁLISIS
                    </button>
                    <span class="text-[var(--line-strong)] font-mono text-[10px]">·</span>
                    <button id="cockpit-gps-open-btn" type="button" class="flex items-center gap-1 font-mono text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] uppercase tracking-widest cursor-pointer transition-colors">
                        <span>VIAJES</span>
                        <span class="text-[var(--accent-amber)] font-bold">→</span>
                    </button>
                </div>
            </div>

            <!-- 4 Minimal Telemetry Cells -->
            <div id="cockpit-gps-body" class="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-[var(--line-hair)] cursor-pointer hover:bg-[var(--bg-elevated)]/30 transition-colors">
                <div class="px-3.5 py-2.5 min-w-0">
                    <span class="block font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--text-secondary)] truncate">HOY</span>
                    <div class="flex items-baseline gap-1 mt-0.5">
                        <strong class="font-sans font-light text-lg sm:text-xl tracking-tight tabular-nums text-[var(--text-primary)]">${gpsSummary.todayKm}</strong>
                        <span class="font-mono text-[9px] text-[var(--accent-amber)]">KM</span>
                    </div>
                </div>

                <div class="px-3.5 py-2.5 min-w-0">
                    <span class="block font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--text-secondary)] truncate">VEL. MEDIA</span>
                    <div class="flex items-baseline gap-1 mt-0.5">
                        <strong class="font-sans font-light text-lg sm:text-xl tracking-tight tabular-nums text-[var(--text-primary)]">${phys ? phys.avgSpeedKmh : '—'}</strong>
                        <span class="font-mono text-[9px] text-[var(--text-secondary)]">${phys ? 'KM/H' : ''}</span>
                    </div>
                </div>

                <div class="px-3.5 py-2.5 min-w-0">
                    <span class="block font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--text-secondary)] truncate">RALENTÍ</span>
                    <div class="flex items-baseline gap-1 mt-0.5">
                        <strong class="font-sans font-light text-lg sm:text-xl tracking-tight tabular-nums ${phys && phys.idleAccOnMin >= 20 ? 'text-[var(--accent-amber)]' : 'text-[var(--text-primary)]'}">${phys ? phys.idleAccOnMin : '0'}</strong>
                        <span class="font-mono text-[9px] text-[var(--text-secondary)]">MIN</span>
                    </div>
                </div>

                <div class="px-3.5 py-2.5 min-w-0">
                    <span class="block font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--text-secondary)] truncate">BATERÍA</span>
                    <div class="flex items-baseline gap-1 mt-0.5">
                        <strong class="font-sans font-light text-lg sm:text-xl tracking-tight tabular-nums" style="color: ${voltageColor}">${voltageText}</strong>
                    </div>
                </div>
            </div>

            ${trip ? `
                <!-- Compact Latest Trip Ribbon -->
                <div id="cockpit-gps-trip-row" class="px-3.5 sm:px-4 py-2 bg-[var(--bg-void)] hover:bg-[var(--bg-elevated)]/40 transition-colors cursor-pointer flex items-center justify-between gap-3">
                    <div class="flex items-center gap-2.5 min-w-0 flex-1">
                        ${trip.routeGlyph ? `
                            <svg viewBox="0 0 76 26" class="w-12 h-5 shrink-0" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
                                <path d="${trip.routeGlyph}" fill="none" stroke="var(--accent-amber)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                            </svg>
                        ` : ''}
                        <span class="font-mono text-[10px] text-[var(--text-secondary)] uppercase truncate">
                            ${trip.startLabel || trip.startAddress || 'Origen'} → ${trip.endLabel || trip.endAddress || 'Destino'}
                        </span>
                    </div>
                    <div class="flex items-center gap-1.5 font-mono text-[10px] tabular-nums shrink-0">
                        <span class="font-semibold text-[var(--text-primary)]">${trip.distanceKm} KM</span>
                        <span class="text-[var(--text-secondary)]">›</span>
                    </div>
                </div>
            ` : `
                <div id="cockpit-gps-trip-row" class="hidden"></div>
            `}
        </section>
    `;
}

/**
 * Renders the Full Cockpit with All Stages + Compact Chassis Band.
 * NEVER hides the cockpit behind an empty state box (LEY 5).
 */
function renderActiveCockpit(container) {
    const { model, vehicleProfile, unit, fuelPriceCop } = cockpitState;
    const hasData = Array.isArray(cockpitState.logs) && cockpitState.logs.length > 0;
    const activeTankState = model?.activeTankState || {
        activePct: 0,
        activeGal: 0,
        autonomyKm: 0,
        kmDriven: 0,
        isReserve: false,
        reserveKm: 0,
        latest: null
    };
    const fullEraAvgEff = model?.fullEraAvgEff || 0;
    const profile = getVehicleModel(vehicleProfile.svgModel || vehicleProfile.id);

    const latestOdo = Math.max(
        Number(activeTankState?.liveOdometer) || 0,
        Number(activeTankState?.latest?.odometer_reading) || 0,
        Number(vehicleProfile?.gpsCache?.live?.totalMile) || 0
    );
    const autonomy = hasData ? (activeTankState?.autonomyKm || 0) : 0;
    const activeGal = hasData ? (activeTankState?.activeGal || 0) : 0;
    const activePct = hasData ? (activeTankState?.activePct || 0) : 0;
    const kmDriven = hasData ? (activeTankState?.kmDriven || 0) : 0;
    const isReserve = hasData ? (activeTankState?.isReserve || false) : false;

    const lastRefuelPrice = getLastRefuelPrice(cockpitState.logs, vehicleProfile.fuelPriceCop || fuelPriceCop || 16000);

    // Contextual Interactive KPIs & GPS Summary
    const effTrend = computeEfficiencyTrend(model, unit);
    const costTrend = computeCostPerKmTrend(cockpitState.logs, model, lastRefuelPrice);
    const monthlyTrend = computeMonthlyFuelMetrics(cockpitState.logs, model, lastRefuelPrice, new Date(), vehicleProfile);
    const usageTrend = computeUsageRhythmTrend(model, vehicleProfile);
    const gpsSummary = computeCockpitGpsSummary(vehicleProfile, model);

    cockpitState.kpiAnalytics = {
        unit,
        fuelPriceCop: lastRefuelPrice,
        efficiency: effTrend,
        cost: costTrend,
        monthly: monthlyTrend,
        usage: usageTrend
    };

    // Initialize fluid level target
    fluidPhysics.targetPct = activePct;
    fluidPhysics.basePct = activePct;

    // Discretionary Top Hairline Strip when 0 records
    const zeroStripHtml = !hasData ? `
        <div class="h-10 border-b border-[var(--line-hair)] bg-[var(--bg-surface)] px-4 flex items-center justify-between">
            <span class="font-mono text-[10px] tracking-widest uppercase text-[var(--text-secondary)]">0 LECTURAS EN MEMORIA</span>
            <div class="flex items-center gap-2">
                <button id="zero-strip-import" type="button" class="flat-pill px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-[var(--text-primary)] hover:border-[var(--line-strong)]">
                    IMPORTAR COPIA DE SEGURIDAD
                </button>
                <button id="zero-strip-reading" type="button" class="flat-pill px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-[var(--accent-amber)] hover:border-[var(--accent-amber)]">
                    + LECTURA
                </button>
                <input type="file" id="zero-strip-file" accept=".json" class="hidden">
            </div>
        </div>
    ` : '';

    const effSparkHtml = hasData && effTrend.series.length >= 2
        ? renderMiniSparklineSvg(effTrend.series.slice(-10).map(s => s.value), getToneColorVar(effTrend.delta.tone === 'neutral' ? 'volt' : effTrend.delta.tone))
        : '';
    const costSparkHtml = hasData && costTrend.series.length >= 2
        ? renderMiniSparklineSvg(costTrend.series.slice(-10).map(s => s.value), 'var(--accent-amber)')
        : '';
    const monthlySparkHtml = hasData && monthlyTrend.series.length >= 2
        ? renderMiniSparklineSvg(monthlyTrend.series.slice(-8).map(s => s.isCurrent ? s.projectedCop : s.value), 'var(--accent-volt)')
        : '';
    const usageSparkHtml = (hasData || gpsSummary.hasDays) && usageTrend.series.length >= 2
        ? renderMiniSparklineSvg(usageTrend.series.slice(-14).map(s => s.km), 'var(--accent-cyan)')
        : '';

    container.innerHTML = `
        ${zeroStripHtml}
        <div class="w-full space-y-4 sm:space-y-6 relative z-10">

            <!-- =================================================================
                 BLOCK 00: COMPACT CHASSIS TELEMETRY BAND (h-24 sm:h-28 lg:h-32 xl:h-36)
                 ================================================================= -->
            <section class="flat-frame bg-[var(--bg-surface)] border border-[var(--line-hair)] grid grid-cols-12 divide-x divide-[var(--line-hair)] overflow-hidden h-24 sm:h-28 lg:h-32 xl:h-36">
                <!-- Left (7 cols mobile / 5 cols sm / 4 cols lg): Specs -->
                <div class="col-span-7 sm:col-span-5 lg:col-span-4 p-2.5 sm:p-4 lg:p-5 flex flex-col justify-between h-full">
                    <div class="font-mono text-[9px] sm:text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">CHASIS</div>
                    <div class="truncate">
                        <h1 class="font-sans font-light text-base sm:text-2xl lg:text-2xl xl:text-3xl tracking-tight text-[var(--text-primary)] leading-tight truncate">${profile.name.toUpperCase()}</h1>
                    </div>
                    <div class="flex items-center gap-1.5 font-mono text-[9px] sm:text-[10px] uppercase tracking-widest text-[var(--text-secondary)] min-h-[14px]">
                        ${isReserve ? `
                            <span class="w-1.5 h-1.5 rounded-full bg-[var(--accent-crimson)]"></span>
                            <span class="text-[var(--accent-crimson)]">RESERVA</span>
                        ` : ''}
                    </div>
                </div>

                <!-- Right (5 cols mobile / 7 cols sm / 8 cols lg): CAD Engineering Blueprint with Live Vehicle Paint strictly contained -->
                <div id="chassis-cad-stage" class="col-span-5 sm:col-span-7 lg:col-span-8 relative bg-[var(--bg-void)] h-full flex items-center justify-center overflow-hidden p-1.5 sm:p-2.5 lg:p-3 cursor-pointer select-none group" style="--car-paint: ${vehicleProfile.vehicleColor || '#FF5500'}">
                    <div id="cad-vehicle-wrapper" class="h-full w-full max-w-full flex items-center justify-center transition-transform duration-300 [&_svg]:max-h-full [&_svg]:max-w-full [&_svg]:h-full [&_svg]:w-auto [&_svg]:object-contain">
                        ${renderInlineCadSvg(vehicleProfile.svgModel || profile.svgModel || profile.id, vehicleProfile.vehicleColor || '#FF5500')}
                    </div>
                    <!-- Exhaust smoke particles container -->
                    <div id="exhaust-smoke-container" class="absolute inset-0 pointer-events-none overflow-hidden"></div>
                </div>
            </section>

            <!-- =================================================================
                 STAGE 01: SIGHT-GLASS CANVAS + CONTEXTUAL INTERACTIVE 2x2 KPI MATRIX
                 ================================================================= -->
            <section id="stage-chamber" class="flat-frame grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-[var(--line-hair)]">
                
                <!-- LEFT (6 COLS LG): OPTICAL FLUID SIGHT-GLASS & MECHANICAL ODOMETER -->
                <div class="lg:col-span-6 xl:col-span-6 p-3 sm:p-5 lg:p-5 xl:p-6 flex flex-col justify-between">
                    
                    <!-- Top Technical Header -->
                    <div class="w-full flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">
                        <span class="flex items-center gap-2">
                            <span id="chamber-pulse-dot" class="w-1.5 h-1.5 rounded-full ${isReserve ? 'bg-[var(--accent-crimson)]' : 'bg-[var(--accent-amber)]'}"></span>
                            <span id="chamber-cycle-tag">${activeTankState?.startDate ? `DESDE ${formatDateShort(activeTankState.startDate)}` : 'TANQUE ACTIVO'} · +${kmDriven} KM</span>
                        </span>
                        <span id="chamber-needle-delta" class="tabular-nums cursor-help" data-tip="FÍSICO VS AGUJA · Nivel real en tanque vs aguja del tablero">
                            ${hasData ? `FÍSICO ${activePct.toFixed(0)}% · AGUJA ${(activeTankState?.latest?.fuel_level_percent || 0).toFixed(0)}%` : '0% · CALIBRADO'}
                        </span>
                    </div>

                    <!-- Optical Depth-of-Field Liquid Canvas -->
                    <div class="relative w-full max-w-[240px] sm:max-w-[260px] lg:max-w-[250px] xl:max-w-[270px] aspect-square mx-auto my-2 sm:my-3 lg:my-3 flex items-center justify-center">
                        <canvas id="liquid-chamber-canvas" class="w-full h-full cursor-pointer touch-pan-y"></canvas>

                        <!-- Readout inside Sight-Glass (Silencio Verbal: Zero P-tags) -->
                        <div class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                            <span id="chamber-top-label" class="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">AUTONOMÍA</span>
                            <div class="flex items-baseline justify-center mt-0.5">
                                <span id="chamber-hero-km" class="font-sans font-light text-5xl sm:text-6xl tracking-tighter tabular-nums text-[var(--text-primary)] leading-none">${autonomy}</span>
                                <span id="chamber-hero-unit" class="font-mono text-xs font-medium text-[var(--accent-amber)] ml-1.5">KM</span>
                            </div>
                            <div id="chamber-sub-vol" class="font-mono text-[11px] font-medium tabular-nums text-[var(--text-primary)] mt-1.5">
                                ${activeGal.toFixed(2)} GAL  ·  ${(activeGal * GAL_TO_L).toFixed(1)} L
                            </div>
                            <div id="chamber-reserve-tag" class="font-mono text-[10px] text-[var(--text-secondary)] mt-1 tracking-widest uppercase whitespace-nowrap">
                                ${hasData ? (activeTankState?.reserveKm > 0 ? `${activeTankState.reserveKm} KM · ${(activeTankState.reserveDateLabel ? activeTankState.reserveDateLabel.split(' ').slice(0, 2).join(' ') : 'RESERVA')}` : 'EN RESERVA') : 'RESERVA 5.0L'}
                            </div>
                            <!-- 3 Discrete Mode Indicators (• • •) -->
                            <div id="chamber-mode-dots" class="flex items-center justify-center gap-1.5 mt-2">
                                <span class="w-1.5 h-1.5 rounded-full transition-all bg-[var(--accent-amber)] opacity-100" data-mode-dot="0"></span>
                                <span class="w-1 h-1 rounded-full transition-all bg-[var(--text-muted)] opacity-40" data-mode-dot="1"></span>
                                <span class="w-1 h-1 rounded-full transition-all bg-[var(--text-muted)] opacity-40" data-mode-dot="2"></span>
                            </div>
                        </div>
                    </div>

                    <!-- Split-Roller / Drum Counter Mechanical Odometer (Protagonista debajo del lente) -->
                    <div id="drum-odometer-container" class="w-full pt-2.5 sm:pt-3.5 border-t border-[var(--line-hair)] select-none cursor-pointer">
                        <div class="flex items-center justify-between mb-2">
                            <span class="font-mono text-[9px] sm:text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">KILOMETRAJE ACTUAL</span>
                            <span class="font-mono text-[9px] sm:text-[10px] text-[var(--accent-volt)] uppercase tracking-wider tabular-nums">
                                ${hasData && model?.stats?.avgKmPerDay ? `${model.stats.avgKmPerDay} KM/DÍA` : '— KM/DÍA'}
                            </span>
                        </div>
                        <div id="drum-odometer-rollers" class="flex items-center justify-center gap-1 sm:gap-1.5 py-1.5 sm:py-2.5">
                            ${renderDrumOdometer(latestOdo)}
                            <span class="font-mono text-xs sm:text-sm font-semibold text-[var(--accent-amber)] ml-1">KM</span>
                        </div>
                    </div>
                </div>

                <!-- RIGHT (6 COLS LG): 2x2 MINIMAL INTERACTIVE KPI MATRIX -->
                <div class="lg:col-span-6 xl:col-span-6 grid grid-cols-2 divide-x divide-y divide-[var(--line-hair)]">

                    <!-- KPI 1: RENDIMIENTO -->
                    <div data-kpi-card="efficiency" role="button" tabindex="0" class="flat-cell p-3 sm:p-4 lg:p-5 flex flex-col justify-between min-h-[126px] sm:min-h-[145px] lg:min-h-[160px] overflow-hidden cursor-pointer hover:bg-[var(--bg-elevated)]/40 active:bg-[var(--bg-elevated)]/70 transition-colors group">
                        <div class="flex items-center justify-between gap-1 font-mono text-[9px] sm:text-[10px] uppercase tracking-[0.16em] text-[var(--text-secondary)]">
                            <span class="truncate">RENDIMIENTO</span>
                            <span class="font-semibold tabular-nums shrink-0" style="color: ${hasData ? getToneColorVar(effTrend.delta.tone) : 'var(--text-secondary)'}">
                                ${hasData && effTrend.delta.text !== '—' ? effTrend.delta.text : '›'}
                            </span>
                        </div>
                        <div class="my-2 min-w-0">
                            <div class="flex items-center justify-between gap-2">
                                <div id="kpi-eff-num" class="font-sans font-light text-2xl sm:text-3xl lg:text-4xl xl:text-5xl tracking-tighter tabular-nums text-[var(--text-primary)] leading-none truncate">
                                    ${hasData ? effTrend.heroFormatted : '—'}
                                </div>
                                ${effSparkHtml}
                            </div>
                            <div id="kpi-eff-unit" class="font-mono text-[9px] sm:text-[10px] font-medium tabular-nums text-[var(--accent-volt)] uppercase tracking-widest mt-1.5 truncate">
                                ${effTrend.unitLabel}
                            </div>
                        </div>
                        <div class="font-mono text-[9px] sm:text-[10px] tabular-nums text-[var(--text-secondary)] pt-2 border-t border-[var(--line-hair)] truncate">
                            <span id="kpi-eff-alt1">MEDIA ${hasData ? effTrend.avgFormatted : '—'}</span>
                        </div>
                    </div>

                    <!-- KPI 2: COSTO POR KM -->
                    <div data-kpi-card="cost" role="button" tabindex="0" class="flat-cell p-3 sm:p-4 lg:p-5 flex flex-col justify-between min-h-[126px] sm:min-h-[145px] lg:min-h-[160px] overflow-hidden cursor-pointer hover:bg-[var(--bg-elevated)]/40 active:bg-[var(--bg-elevated)]/70 transition-colors group">
                        <div class="flex items-center justify-between gap-1 font-mono text-[9px] sm:text-[10px] uppercase tracking-[0.16em] text-[var(--text-secondary)]">
                            <span class="truncate">COSTO / KM</span>
                            <span class="font-semibold tabular-nums shrink-0" style="color: ${hasData ? getToneColorVar(costTrend.delta.tone) : 'var(--text-secondary)'}">
                                ${hasData && costTrend.delta.text !== '—' ? costTrend.delta.text : '›'}
                            </span>
                        </div>
                        <div class="my-2 min-w-0">
                            <div class="flex items-center justify-between gap-2">
                                <div id="kpi-cost-km" class="font-sans font-light text-2xl sm:text-3xl lg:text-4xl xl:text-5xl tracking-tighter tabular-nums text-[var(--text-primary)] leading-none truncate">
                                    ${hasData && costTrend.currentCostPerKm > 0 ? '$' + costTrend.currentCostPerKm.toLocaleString('es-CO') : '—'}
                                </div>
                                ${costSparkHtml}
                            </div>
                            <div class="font-mono text-[9px] sm:text-[10px] font-medium tabular-nums text-[var(--accent-amber)] uppercase tracking-widest mt-1.5 truncate">
                                COP / KM
                            </div>
                        </div>
                        <div class="font-mono text-[9px] sm:text-[10px] tabular-nums text-[var(--text-secondary)] pt-2 border-t border-[var(--line-hair)] truncate">
                            <span id="kpi-full-price">GAL $${Math.round(costTrend.lastRefuelPrice / 1000).toLocaleString('es-CO')}K</span>
                        </div>
                    </div>

                    <!-- KPI 3: GASTO MES -->
                    <div data-kpi-card="monthly" role="button" tabindex="0" class="flat-cell p-3 sm:p-4 lg:p-5 flex flex-col justify-between min-h-[126px] sm:min-h-[145px] lg:min-h-[160px] overflow-hidden cursor-pointer hover:bg-[var(--bg-elevated)]/40 active:bg-[var(--bg-elevated)]/70 transition-colors group">
                        <div class="flex items-center justify-between gap-1 font-mono text-[9px] sm:text-[10px] uppercase tracking-[0.16em] text-[var(--text-secondary)]">
                            <span class="truncate">GASTO MES</span>
                            <span class="font-semibold tabular-nums shrink-0" style="color: ${hasData ? getToneColorVar(monthlyTrend.delta.tone) : 'var(--text-secondary)'}">
                                ${hasData && monthlyTrend.delta.text !== '—' ? monthlyTrend.delta.text : '›'}
                            </span>
                        </div>
                        <div class="my-2 min-w-0">
                            <div class="flex items-center justify-between gap-2">
                                <div id="kpi-monthly-spent" class="font-sans font-light text-2xl sm:text-3xl lg:text-4xl xl:text-5xl tracking-tighter tabular-nums text-[var(--text-primary)] leading-none truncate">
                                    ${hasData ? '$' + Math.round(monthlyTrend.currentMonthSpent / 1000).toLocaleString('es-CO') + 'K' : '—'}
                                </div>
                                ${monthlySparkHtml}
                            </div>
                            <div class="font-mono text-[9px] sm:text-[10px] font-medium tabular-nums text-[var(--accent-volt)] uppercase tracking-widest mt-1.5 truncate">
                                LLEVADO
                            </div>
                        </div>
                        <div class="flex items-center justify-between gap-1 font-mono text-[9px] sm:text-[10px] tabular-nums text-[var(--text-secondary)] pt-2 border-t border-[var(--line-hair)]">
                            <span class="truncate">PROY.</span>
                            <strong id="kpi-month-diff" class="font-mono font-semibold tabular-nums text-[var(--accent-amber)] shrink-0">
                                ${hasData && monthlyTrend.projectedMonthSpent > 0 ? `~$${Math.round(monthlyTrend.projectedMonthSpent / 1000).toLocaleString('es-CO')}K` : '—'}
                            </strong>
                        </div>
                    </div>

                    <!-- KPI 4: RITMO DE USO -->
                    <div data-kpi-card="usage" role="button" tabindex="0" class="flat-cell p-3 sm:p-4 lg:p-5 flex flex-col justify-between min-h-[126px] sm:min-h-[145px] lg:min-h-[160px] overflow-hidden cursor-pointer hover:bg-[var(--bg-elevated)]/40 active:bg-[var(--bg-elevated)]/70 transition-colors group">
                        <div class="flex items-center justify-between gap-1 font-mono text-[9px] sm:text-[10px] uppercase tracking-[0.16em] text-[var(--text-secondary)]">
                            <span class="truncate">RITMO USO</span>
                            <span class="font-semibold tabular-nums shrink-0" style="color: ${usageTrend.hasUsageData ? getToneColorVar(usageTrend.delta.tone) : 'var(--text-secondary)'}">
                                ${usageTrend.hasUsageData && usageTrend.delta.text !== '—' ? usageTrend.delta.text : '›'}
                            </span>
                        </div>
                        <div class="my-2 min-w-0">
                            <div class="flex items-center justify-between gap-2">
                                <div id="kpi-usage-rate" class="font-sans font-light text-2xl sm:text-3xl lg:text-4xl xl:text-5xl tracking-tighter tabular-nums text-[var(--text-primary)] leading-none truncate">
                                    ${usageTrend.hasUsageData ? usageTrend.displayKmDay : '—'}
                                </div>
                                ${usageSparkHtml}
                            </div>
                            <div class="font-mono text-[9px] sm:text-[10px] font-medium tabular-nums text-[var(--accent-cyan)] uppercase tracking-widest mt-1.5 truncate">
                                KM / DÍA · 7D
                            </div>
                        </div>
                        <div class="font-mono text-[9px] sm:text-[10px] tabular-nums text-[var(--text-secondary)] pt-2 border-t border-[var(--line-hair)] truncate">
                            <span>MES ${usageTrend.kmThisMonth} KM</span>
                        </div>
                    </div>

                </div>
            </section>

            <!-- =================================================================
                 GPS DATA — TELEMETRÍA CINEMÁTICA EN VIVO
                 ================================================================= -->
            ${renderCockpitGpsBand(gpsSummary)}

            <!-- =================================================================
                 STAGE 02: THE MONOLITHS (CICLOS DE CONSUMO — 3 ANTERIORES + 1 ACTUAL)
                 ================================================================= -->
            <section id="stage-monoliths" class="flat-frame p-3.5 sm:p-6 lg:p-6 space-y-3.5 sm:space-y-4">
                <div class="flex flex-wrap items-end justify-between gap-3 pb-4 border-b border-[var(--line-hair)]">
                    <div>
                        <div class="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">CICLOS DE CONSUMO</div>
                        <h2 id="monolith-title" class="font-sans font-light text-2xl tracking-tight text-[var(--text-primary)] mt-0.5">
                            RENDIMIENTO POR CICLO
                        </h2>
                    </div>

                    <!-- Flat Telemetry Readout Strip -->
                    <div id="monolith-hud" class="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
                        <span id="mono-stat-eff" class="px-2.5 py-1 rounded-sm flat-pill-active font-medium tabular-nums cursor-help" data-tip="PROMEDIO · Rendimiento medio de tanqueadas completas">${hasData && fullEraAvgEff > 0 ? formatEff(fullEraAvgEff, unit, true) : '— KM/GAL'}</span>
                        <span id="mono-stat-km" class="px-2.5 py-1 rounded-sm flat-pill tabular-nums cursor-help" data-tip="RECORRIDO · Kilómetros sumados en estos ciclos">+${(model?.stats?.totalKm || 0).toLocaleString()} KM</span>
                        <span id="mono-stat-vol" class="px-2.5 py-1 rounded-sm flat-pill tabular-nums cursor-help" data-tip="CONSUMO · Galones usados en estos ciclos">${formatVol(model?.stats?.totalGallons || 0, unit, true)}</span>
                        <span id="mono-stat-cost" class="px-2.5 py-1 rounded-sm flat-pill text-[var(--accent-amber)] tabular-nums cursor-help" data-tip="GASTO · Dinero total en gasolina en estos ciclos">$${Math.round((model?.stats?.totalCostCop || 0) / 1000)}K</span>
                    </div>
                </div>

                <!-- Architectural Columns Grid (Single Row: 3 Closed + 1 Active) -->
                <div id="monoliths-container" class="grid grid-cols-4 gap-2 lg:gap-2.5">
                    <!-- Populated dynamically -->
                </div>

                <!-- Benchmark Hairline Strip -->
                <div class="grid grid-cols-3 divide-x divide-[var(--line-hair)] border border-[var(--line-hair)] bg-[var(--bg-void)] font-mono text-[10px]">
                    <div class="py-2.5 px-3 flex flex-col sm:flex-row sm:items-center justify-between gap-1 cursor-help" data-tip="MÍNIMO · Ciclo con menor rendimiento">
                        <span class="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">MÍNIMO</span>
                        <strong id="bench-min" class="font-mono text-[11px] font-medium text-[var(--text-primary)] tabular-nums" data-tip="MÍNIMO · Ciclo con menor rendimiento">—</strong>
                    </div>
                    <div class="py-2.5 px-3 flex flex-col sm:flex-row sm:items-center justify-between gap-1 cursor-help" data-tip="MEDIA REAL · Promedio general de tus ciclos">
                        <span class="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">MEDIA REAL</span>
                        <strong id="bench-avg" class="font-mono text-[11px] font-medium text-[var(--accent-volt)] tabular-nums" data-tip="MEDIA REAL · Promedio general de tus ciclos">${hasData && fullEraAvgEff > 0 ? formatEff(fullEraAvgEff, unit, true) : '—'}</strong>
                    </div>
                    <div class="py-2.5 px-3 flex flex-col sm:flex-row sm:items-center justify-between gap-1 cursor-help" data-tip="RÉCORD · Ciclo con mayor rendimiento">
                        <span class="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">RÉCORD</span>
                        <strong id="bench-max" class="font-mono text-[11px] font-medium text-[var(--accent-amber)] tabular-nums" data-tip="RÉCORD · Ciclo con mayor rendimiento">—</strong>
                    </div>
                </div>

                <!-- Collapsible Cycle Detail Panel -->
                <div id="cycle-detail-panel" class="border border-[var(--line-hair)] bg-[var(--bg-void)]">
                    <!-- Populated dynamically -->
                </div>
            </section>

            <!-- =================================================================
                 STAGE 03: THE FREQUENCY HORIZON & WEEKDAY DNA
                 ================================================================= -->
            <section id="stage-horizon" class="flat-frame p-3.5 sm:p-6 lg:p-6 space-y-3.5 sm:space-y-4">
                <div class="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[var(--line-hair)]">
                    <div>
                        <div class="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">ESPECTRO DIARIO</div>
                        <h2 class="font-sans font-light text-2xl tracking-tight text-[var(--text-primary)] mt-0.5">HORIZONTE DE RODAJE</h2>
                    </div>

                    <!-- Dynamic Month Selector Pills -->
                    <div id="horizon-month-pills" class="flex items-center gap-1 font-mono text-[10px] flex-wrap">
                        <!-- Populated dynamically -->
                    </div>
                </div>

                <!-- Flat Precision Day Readout Bar -->
                <div class="p-3 sm:p-4 bg-[var(--bg-void)] border border-[var(--line-hair)] border-l-2 border-l-[var(--accent-amber)] flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
                    <div class="flex items-center gap-3 sm:gap-3.5">
                        <div id="synth-date-badge" class="font-sans font-light text-xl sm:text-3xl tracking-tight tabular-nums text-[var(--text-primary)] leading-none">
                            --
                        </div>
                        <div class="border-l border-[var(--line-hair)] pl-3">
                            <div id="synth-odo-badge" class="font-mono text-xs font-medium text-[var(--text-primary)] tabular-nums">-- KM</div>
                            <div id="synth-refuel-tag" class="font-mono text-[10px] text-[var(--accent-amber)] uppercase tracking-wider">RODAJE</div>
                        </div>
                    </div>

                    <!-- 3-Column Compact Metrics Strip -->
                    <div class="grid grid-cols-3 divide-x divide-[var(--line-hair)] border-t border-[var(--line-hair)] pt-2.5 sm:border-t-0 sm:pt-0 sm:flex sm:items-center sm:gap-8 sm:divide-x-0 w-full sm:w-auto font-mono text-left">
                        <div class="pr-2 sm:pr-0">
                            <span class="font-mono text-[9px] sm:text-[10px] uppercase tracking-[0.15em] sm:tracking-[0.2em] text-[var(--text-secondary)] block truncate">RECORRIDO</span>
                            <strong id="synth-km-val" class="font-mono text-[11px] font-medium tabular-nums text-[var(--text-primary)]">-- KM</strong>
                        </div>
                        <div class="px-2 sm:px-0">
                            <span class="font-mono text-[9px] sm:text-[10px] uppercase tracking-[0.15em] sm:tracking-[0.2em] text-[var(--text-secondary)] block truncate">CONSUMO</span>
                            <strong id="synth-fuel-val" class="font-mono text-[11px] font-medium text-[var(--accent-volt)] tabular-nums">-- GAL</strong>
                        </div>
                        <div class="pl-2 sm:pl-0">
                            <span class="font-mono text-[9px] sm:text-[10px] uppercase tracking-[0.15em] sm:tracking-[0.2em] text-[var(--text-secondary)] block truncate">COSTO</span>
                            <strong id="synth-cost-val" class="font-mono text-[11px] font-medium text-[var(--accent-amber)] tabular-nums">$0</strong>
                        </div>
                    </div>
                </div>

                <!-- Needles Stage -->
                <div class="relative pt-3 pb-1">
                    <div id="synth-bars-stage" class="h-36 sm:h-40 w-full flex items-end gap-[2px] sm:gap-[3px] touch-none cursor-crosshair select-none border-b border-[var(--line-hair)] pb-2">
                        <!-- Populated dynamically -->
                    </div>
                    <div class="flex justify-between font-mono text-[9px] text-[var(--text-secondary)] mt-2 uppercase tracking-widest">
                        <span id="synth-start-lbl">--</span>
                        <span>★ TANQUEADAS · INSPECCIÓN</span>
                        <span id="synth-end-lbl">--</span>
                    </div>
                </div>

                <!-- 7-Day Weekday DNA Strip -->
                <div id="weekday-dna-strip" class="grid grid-cols-7 divide-x divide-[var(--line-hair)] border border-[var(--line-hair)] bg-[var(--bg-void)] font-mono text-center">
                    <!-- Populated dynamically -->
                </div>
            </section>

        </div>
    `;

    // Initialize interactive modules
    initLiquidCanvas();
    renderMonolithsStage();
    renderDynamicMonthPills();
    renderFrequencyHorizon();
    renderWeekdayDNA();
    renderCycleDetail();
    bindActiveCockpitEvents();
}

/**
 * Initializes Canvas-based Optical Depth-of-Field Liquid Sight-Glass.
 */
function initLiquidCanvas() {
    const canvas = document.getElementById('liquid-chamber-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    function triggerSightGlassCycle() {
        cockpitState.sightGlassMode = ((cockpitState.sightGlassMode || 0) + 1) % 3;
        // Kinetic ascending bubble burst
        fluidPhysics.bubbles.forEach(b => {
            b.y = 0.92 + Math.random() * 0.12;
            b.speed = 0.012 + Math.random() * 0.018;
        });
        disturbFluid(1.6);
        playHorologyTick(720, 0.016, 0.03);
        updateSightGlassAndWarp();
    }

    canvas.onpointerdown = triggerSightGlassCycle;
    canvas.onpointermove = () => {
        if (Math.random() < 0.25) disturbFluid(0.16);
    };

    if (animFrameId) cancelAnimationFrame(animFrameId);

    function renderLoop() {
        if (!canvas.isConnected) return;

        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
            if (canvas.isConnected) {
                animFrameId = requestAnimationFrame(renderLoop);
            }
            return;
        }

        if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
            canvas.width = Math.round(rect.width * dpr);
            canvas.height = Math.round(rect.height * dpr);
        }

        ctx.save();
        ctx.scale(dpr, dpr);
        const w = rect.width;
        const h = rect.height;
        const cx = w / 2;
        const cy = h / 2;
        const radius = Math.min(w, h) * 0.45;

        ctx.clearRect(0, 0, w, h);

        // Spring physics for level and sloshing
        fluidPhysics.currentPct += (fluidPhysics.targetPct - fluidPhysics.currentPct) * 0.08;
        fluidPhysics.sloshVelocity *= 0.92;
        fluidPhysics.sloshEnergy += (fluidPhysics.sloshVelocity - fluidPhysics.sloshEnergy) * 0.15;
        fluidPhysics.wavePhase1 += 0.038 + Math.abs(fluidPhysics.sloshEnergy) * 0.035;
        fluidPhysics.wavePhase2 -= 0.028;

        const isLight = document.documentElement.getAttribute('data-theme') === 'light';
        const isReserve = fluidPhysics.currentPct <= 14.5;
        const primaryColor = isReserve ? '#F43F5E' : '#FF5500';

        // 1. Outer Ring
        ctx.beginPath();
        ctx.arc(cx, cy, radius + 6, 0, Math.PI * 2);
        ctx.strokeStyle = isLight ? 'rgba(17, 17, 19, 0.12)' : 'rgba(255, 255, 255, 0.09)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // 2. Active Arc Progress
        const startArc = -Math.PI / 2;
        const endArc = startArc + (Math.max(0, fluidPhysics.currentPct) / 100) * (Math.PI * 2);
        ctx.beginPath();
        ctx.arc(cx, cy, radius + 6, startArc, endArc);
        ctx.strokeStyle = primaryColor;
        ctx.lineWidth = 2;
        ctx.stroke();

        // 3. Clip Sight-Glass Chamber
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.clip();

        // Cavity background
        ctx.fillStyle = isLight ? '#EAE7E0' : '#060608';
        ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);

        if (fluidPhysics.currentPct > 0) {
            const fillTopY = (cy + radius) - (Math.max(2, fluidPhysics.currentPct) / 100) * (radius * 2);
            const amp = 3.8 + Math.min(13, Math.abs(fluidPhysics.sloshEnergy) * 8.5);

            // Subsurface Optical Glow
            ctx.save();
            const subGrad = ctx.createRadialGradient(cx, fillTopY + radius * 0.35, radius * 0.05, cx, cy + radius * 0.2, radius * 1.1);
            if (isReserve) {
                subGrad.addColorStop(0, 'rgba(244, 63, 94, 0.55)');
                subGrad.addColorStop(1, 'rgba(244, 63, 94, 0.0)');
            } else {
                subGrad.addColorStop(0, 'rgba(255, 115, 0, 0.52)');
                subGrad.addColorStop(0.6, 'rgba(255, 65, 0, 0.22)');
                subGrad.addColorStop(1, 'rgba(255, 55, 0, 0.0)');
            }
            ctx.fillStyle = subGrad;
            ctx.beginPath();
            ctx.moveTo(cx - radius - 20, cy + radius + 20);
            for (let x = cx - radius - 20; x <= cx + radius + 20; x += 8) {
                const nx = (x - (cx - radius)) / (radius * 2);
                const y = fillTopY - 6 + Math.sin(nx * Math.PI * 2.2 + fluidPhysics.wavePhase2) * (amp * 1.1);
                ctx.lineTo(x, y);
            }
            ctx.lineTo(cx + radius + 20, cy + radius + 20);
            ctx.closePath();
            ctx.fill();
            ctx.restore();

            // Foreground Fluid Body
            ctx.beginPath();
            ctx.moveTo(cx - radius, cy + radius);
            for (let x = cx - radius; x <= cx + radius; x += 3) {
                const nx = (x - (cx - radius)) / (radius * 2);
                const y = fillTopY + Math.sin(nx * Math.PI * 2.4 + fluidPhysics.wavePhase1) * amp
                                   + Math.cos(nx * Math.PI * 4.2 - fluidPhysics.wavePhase2) * (amp * 0.3);
                ctx.lineTo(x, y);
            }
            ctx.lineTo(cx + radius, cy + radius);
            ctx.closePath();

            const bodyGrad = ctx.createLinearGradient(0, fillTopY, 0, cy + radius);
            if (isReserve) {
                bodyGrad.addColorStop(0, 'rgba(244, 63, 94, 0.68)');
                bodyGrad.addColorStop(0.5, 'rgba(190, 18, 60, 0.42)');
                bodyGrad.addColorStop(1, 'rgba(80, 10, 25, 0.25)');
            } else {
                bodyGrad.addColorStop(0, 'rgba(255, 110, 20, 0.65)');
                bodyGrad.addColorStop(0.45, 'rgba(235, 75, 0, 0.38)');
                bodyGrad.addColorStop(1, 'rgba(120, 30, 0, 0.18)');
            }
            ctx.fillStyle = bodyGrad;
            ctx.fill();

            // Draw Kinetic Rising Bubbles
            ctx.save();
            ctx.fillStyle = isReserve ? 'rgba(255, 200, 215, 0.45)' : 'rgba(255, 230, 195, 0.52)';
            fluidPhysics.bubbles.forEach(b => {
                b.y -= b.speed;
                if (b.speed > 0.006) b.speed *= 0.97;
                if (b.y < (fillTopY - (cy - radius)) / (radius * 2)) {
                    b.y = 1.0 + Math.random() * 0.06;
                    b.x = 0.15 + Math.random() * 0.7;
                    b.speed = 0.0025 + Math.random() * 0.004;
                }
                const bx = cx - radius + b.x * (radius * 2);
                const by = cy - radius + b.y * (radius * 2);
                if (by >= fillTopY && by <= cy + radius) {
                    ctx.beginPath();
                    ctx.arc(bx, by, b.r, 0, Math.PI * 2);
                    ctx.fill();
                }
            });
            ctx.restore();

            // Meniscus Line
            ctx.save();
            ctx.beginPath();
            for (let x = cx - radius; x <= cx + radius; x += 3) {
                const nx = (x - (cx - radius)) / (radius * 2);
                const y = fillTopY + Math.sin(nx * Math.PI * 2.4 + fluidPhysics.wavePhase1) * amp
                                   + Math.cos(nx * Math.PI * 4.2 - fluidPhysics.wavePhase2) * (amp * 0.3);
                if (x === cx - radius) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.strokeStyle = isReserve ? 'rgba(255, 180, 195, 0.85)' : 'rgba(255, 200, 140, 0.85)';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.restore();
        }

        // Hairlines for 75%, 50%, 25%
        [75, 50, 25].forEach(lvl => {
            const ly = (cy + radius) - (lvl / 100) * (radius * 2);
            ctx.beginPath();
            ctx.moveTo(cx - 12, ly);
            ctx.lineTo(cx + 12, ly);
            ctx.strokeStyle = isLight ? 'rgba(17, 17, 19, 0.12)' : 'rgba(255, 255, 255, 0.08)';
            ctx.lineWidth = 1;
            ctx.stroke();
        });

        // Reserve 14.3% (5L) Dashed Reference Line
        const rsvY = (cy + radius) - 0.143 * (radius * 2);
        ctx.beginPath();
        ctx.setLineDash([3, 3]);
        ctx.moveTo(cx - radius, rsvY);
        ctx.lineTo(cx + radius, rsvY);
        ctx.strokeStyle = 'rgba(244, 63, 94, 0.45)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.restore(); // Clip end

        // Aperture Border Hairline
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.strokeStyle = isLight ? 'rgba(17, 17, 19, 0.22)' : 'rgba(255, 255, 255, 0.14)';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.restore();
        animFrameId = requestAnimationFrame(renderLoop);
    }

    updateSightGlassAndWarp();
    animFrameId = requestAnimationFrame(renderLoop);
}

/**
 * Updates Sight-Glass readouts and Time-Warp simulation bar.
 * Supports 3 switchable operational modes:
 * Mode 0: AUTONOMÍA (KM)
 * Mode 1: TIEMPO DE TANQUE (~XX DÍAS)
 * Mode 2: VALOR EN TANQUE ($XXX.XXX)
 */
function updateSightGlassAndWarp() {
    const { model, unit, fuelPriceCop } = cockpitState;
    const activeTankState = model?.activeTankState || { activePct: 0, activeGal: 0, autonomyKm: 0, reserveKm: 0 };
    const fullEraAvgEff = model?.fullEraAvgEff || 0;
    const tankMaxGal = activeTankState.tankMaxGal || DEFAULT_TANK_CAPACITY_GAL;
    const reserveGal = activeTankState.reserveGal || DEFAULT_RESERVE_GAL;
    const warpKm = cockpitState.timeWarpKm;

    fluidPhysics.basePct = activeTankState.activePct || 0;
    fluidPhysics.warpKm = warpKm;

    const baseEff = Number(activeTankState?.adaptiveEff || fullEraAvgEff) || 33.71;
    const sevFactor = Number(activeTankState?.physicalTelemetry?.severityFactor) || 1.0;
    const projEff = sevFactor > 0 ? (baseEff / sevFactor) : baseEff;
    const burnedSimGal = projEff > 0 ? (warpKm / projEff) : 0;
    const remGal = Math.max(0, (activeTankState.activeGal || 0) - burnedSimGal);
    const remPct = tankMaxGal > 0 ? (remGal / tankMaxGal) * 100 : 0;
    fluidPhysics.targetPct = remPct;

    const remRangeKm = Math.round(remGal * projEff);
    const remReserveKm = Math.max(0, Math.round(Math.max(0, remGal - reserveGal) * projEff));

    const topLbl = document.getElementById('chamber-top-label');
    const heroKm = document.getElementById('chamber-hero-km');
    const heroUnit = document.getElementById('chamber-hero-unit');
    const subVol = document.getElementById('chamber-sub-vol');
    const rsvTag = document.getElementById('chamber-reserve-tag');
    const dots = document.querySelectorAll('[data-mode-dot]');

    const mode = cockpitState.sightGlassMode || 0;

    // Update 3 discrete mode dots
    dots.forEach(dot => {
        const dotMode = parseInt(dot.dataset.modeDot, 10);
        if (dotMode === mode) {
            dot.className = 'w-1.5 h-1.5 rounded-full transition-all bg-[var(--accent-amber)] opacity-100';
        } else {
            dot.className = 'w-1 h-1 rounded-full transition-all bg-[var(--text-muted)] opacity-40';
        }
    });

    const avgKmDay = Number(model?.stats?.avgKmPerDay) > 0 ? Number(model.stats.avgKmPerDay) : 25;
    const daysAutonomy = (warpKm === 0 && activeTankState?.autonomyDays !== undefined)
        ? activeTankState.autonomyDays
        : Math.max(0, Math.round(remRangeKm / avgKmDay));
    const daysToReserve = (warpKm === 0 && activeTankState?.reserveDays !== undefined)
        ? activeTankState.reserveDays
        : Math.max(0, Math.round(remReserveKm / avgKmDay));

    if (mode === 0) {
        // Mode 0: AUTONOMÍA (KM)
        if (topLbl) topLbl.innerText = warpKm > 0 ? `TRAS +${warpKm} KM` : 'AUTONOMÍA';
        if (heroKm) heroKm.innerText = remRangeKm;
        if (heroUnit) heroUnit.innerText = 'KM';
        if (subVol) subVol.innerText = `${remGal.toFixed(2)} GAL  ·  ${(remGal * GAL_TO_L).toFixed(1)} L`;
        if (rsvTag) {
            const compactReserveDate = activeTankState?.reserveDateLabel
                ? activeTankState.reserveDateLabel.split(' ').slice(0, 2).join(' ')
                : '';
            if (remReserveKm > 0) {
                rsvTag.innerText = (warpKm === 0 && compactReserveDate)
                    ? `${remReserveKm} KM · ${compactReserveDate}`
                    : `${remReserveKm} KM A RESERVA`;
            } else {
                rsvTag.innerText = remGal > 0 ? 'EN RESERVA' : 'RESERVA 5.0L';
            }
        }
    } else if (mode === 1) {
        // Mode 1: TIEMPO DE TANQUE (~XX DÍAS)
        if (topLbl) topLbl.innerText = 'TIEMPO DE TANQUE';
        if (heroKm) heroKm.innerText = `~${daysAutonomy}`;
        if (heroUnit) heroUnit.innerText = 'DÍAS';
        if (subVol) subVol.innerText = `RITMO: ${avgKmDay.toFixed(0)} KM/DÍA`;
        if (rsvTag) {
            const compactReserveDate = activeTankState?.reserveDateLabel
                ? activeTankState.reserveDateLabel.split(' ').slice(0, 2).join(' ')
                : '';
            if (warpKm === 0 && compactReserveDate) {
                rsvTag.innerText = activeTankState.reserveKm > 0
                    ? `RESERVA · ${compactReserveDate}`
                    : 'EN RESERVA';
            } else {
                rsvTag.innerText = daysToReserve > 0
                    ? `RESERVA EN ~${daysToReserve} DÍAS`
                    : 'EN RESERVA';
            }
        }
    } else if (mode === 2) {
        // Mode 2: VALOR EN TANQUE ($XXX.XXX)
        if (topLbl) topLbl.innerText = 'VALOR EN TANQUE';
        if (heroKm) heroKm.innerText = `$${Math.round(remGal * fuelPriceCop).toLocaleString('es-CO')}`;
        if (heroUnit) heroUnit.innerText = '';
        if (subVol) subVol.innerText = `${remPct.toFixed(0)}% CAPACIDAD`;
        if (rsvTag) {
            const needlePct = Math.round(activeTankState?.latest?.fuel_level_percent || 0);
            rsvTag.innerText = `FÍSICO ${remPct.toFixed(0)}% vs AGUJA ${needlePct}%`;
        }
    }

    // Time-Warp Sub-Strip
    const warpDist = document.getElementById('warp-dist-label');
    const warpFuel = document.getElementById('warp-fuel-val');
    const warpCost = document.getElementById('warp-cost-val');
    const warpArrival = document.getElementById('warp-arrival-val');

    if (warpDist) warpDist.innerText = `+${warpKm} KM`;
    if (warpFuel) warpFuel.innerText = formatVol(burnedSimGal, unit, true);
    if (warpCost) warpCost.innerText = `$${Math.round(burnedSimGal * fuelPriceCop).toLocaleString('es-CO')}`;
    if (warpArrival) warpArrival.innerText = `${remPct.toFixed(0)}% (${formatVol(remGal, unit, true)})`;
}

/**
 * Formats a start and end date into a compact human range for cycle headers.
 * Example: ("2026-10-07", "2026-10-14") -> "07–14 OCT"
 *          ("2026-09-23", "2026-10-07") -> "23 SEP–07 OCT"
 */
function formatCycleRangeCompact(startDate, endDate) {
    const s = formatDateShort(startDate); // "07 OCT"
    const e = formatDateShort(endDate);   // "14 OCT"
    if (!s && !e) return '—';
    if (!s) return e;
    if (!e || s === e) return s;
    const [sDay, sMonth] = s.split(' ');
    const [eDay, eMonth] = e.split(' ');
    if (sMonth && sMonth === eMonth) {
        return `${sDay}–${eDay} ${eMonth}`;
    }
    return `${s}–${e}`;
}

/**
 * Stage 02: Los Monolitos Rendering.
 */
function renderMonolithsStage() {
    const container = document.getElementById('monoliths-container');
    if (!container) return;
    container.innerHTML = '';

    const { model, unit } = cockpitState;
    const allCycles = model?.fullEraCycles || [];
    const cycles = allCycles.slice(-3);
    const activeState = model?.activeTankState;

    if (allCycles.length === 0) {
        // Render 4 silent placeholder columns (single row)
        for (let i = 1; i <= 4; i++) {
            const col = document.createElement('div');
            col.className = 'monolith-bar rounded-sm p-2.5 sm:p-3 h-40 sm:h-44 flex flex-col justify-between opacity-40';
            col.innerHTML = `
                <div class="flex items-center justify-between font-mono text-[9px] sm:text-[10px]">
                    <span class="font-medium text-[var(--text-secondary)]">—</span>
                    <span class="text-[9px] text-[var(--text-muted)]">—</span>
                </div>
                <div class="relative flex-1 flex items-end my-2 bg-[var(--bg-void)] p-1">
                    <div class="w-full bg-[var(--line-strong)]" style="height: 4%"></div>
                </div>
                <div class="leading-tight">
                    <div class="font-sans font-light text-sm sm:text-base tracking-tight tabular-nums">—</div>
                    <div class="font-mono text-[9px] text-[var(--text-secondary)] tabular-nums mt-0.5">0 KM</div>
                </div>
            `;
            container.appendChild(col);
        }
        return;
    }

    const maxEff = Math.max(...cycles.map(c => c.eff), 42);
    const minEff = 20;

    cycles.forEach(c => {
        const isSelected = cockpitState.selectedCycleIdx === c.cycleIndex;
        const heightPct = Math.min(100, Math.max(18, ((c.eff - minEff) / (maxEff - minEff)) * 100));
        const isRecord = c.eff >= 38;
        const barFill = isSelected
            ? 'bg-[var(--accent-amber)]'
            : (isRecord ? 'bg-[var(--accent-volt)]' : 'bg-[var(--text-primary)] opacity-80');

        const rangeLabel = formatCycleRangeCompact(c.startDate, c.endDate);
        const daysLabel = `${c.days || 1}D`;

        const col = document.createElement('div');
        col.className = `monolith-bar rounded-sm p-2.5 sm:p-3 h-40 sm:h-44 flex flex-col justify-between cursor-pointer ${isSelected ? 'active' : ''}`;
        col.setAttribute('data-tip', `${formatDateShort(c.startDate)} AL ${formatDateShort(c.endDate)} · ${formatEff(c.eff, unit, true)} · +${c.dist} KM`);
        col.onclick = () => {
            playHorologyTick(1100, 0.016, 0.03);
            cockpitState.selectedCycleIdx = cockpitState.selectedCycleIdx === c.cycleIndex ? null : c.cycleIndex;
            disturbFluid(0.5);
            renderMonolithsStage();
            updateMonolithSpotlight();
            renderCycleDetail();
        };

        const effUnitLabel = unit === 'gal' ? 'KM/G' : (unit === 'l100' ? 'L/100' : 'KM/L');

        col.innerHTML = `
            <div class="flex items-center justify-between gap-1 font-mono text-[9px] sm:text-[10px]">
                <span class="font-medium text-[var(--text-primary)] truncate tabular-nums">${rangeLabel}</span>
                <span class="text-[9px] text-[var(--text-muted)] shrink-0 tabular-nums hidden sm:inline">${daysLabel}</span>
            </div>

            <div class="relative flex-1 flex items-end my-2 bg-[var(--bg-void)] p-1">
                <div class="w-full transition-all duration-300 ${barFill}" style="height: ${heightPct}%"></div>
            </div>

            <div class="leading-tight">
                <div class="font-sans font-normal text-sm sm:text-lg tracking-tight tabular-nums flex items-baseline justify-between">
                    <span>${formatEff(c.eff, unit, false)}</span>
                    <span class="font-mono text-[8px] sm:text-[9px] text-[var(--text-secondary)] ml-0.5">${effUnitLabel}</span>
                </div>
                <div class="font-mono text-[9px] text-[var(--text-secondary)] tabular-nums mt-0.5">+${c.dist} KM</div>
            </div>
        `;
        container.appendChild(col);
    });

    // Active Live Column
    if (activeState && cockpitState.logs.length > 0) {
        const lastClosed = cycles.length > 0 ? cycles[cycles.length - 1] : null;
        const activeStartStr = activeState.startDate || (lastClosed ? lastClosed.endDate : cockpitState.logs[0]?.date);
        const activeStartShort = activeStartStr ? formatDateShort(activeStartStr) : 'HOY';
        const isLiveSelected = cockpitState.selectedCycleIdx === 'active';

        const liveCol = document.createElement('div');
        liveCol.className = `monolith-bar rounded-sm p-2.5 sm:p-3 h-40 sm:h-44 flex flex-col justify-between cursor-pointer ${
            isLiveSelected
                ? 'active border border-[var(--accent-amber)] ring-1 ring-[var(--accent-amber)] bg-[var(--bg-elevated)]/30'
                : 'border-dashed border-[var(--line-strong)]'
        }`;
        liveCol.setAttribute('data-tip', `DESDE ${activeStartShort} · +${activeState.kmDriven} KM`);
        liveCol.onclick = () => {
            playHorologyTick(950, 0.016, 0.03);
            cockpitState.selectedCycleIdx = cockpitState.selectedCycleIdx === 'active' ? null : 'active';
            renderMonolithsStage();
            updateMonolithSpotlight();
            renderCycleDetail();
        };
        liveCol.innerHTML = `
            <div class="flex items-center justify-between gap-1 font-mono text-[9px] sm:text-[10px]">
                <span class="font-medium text-[var(--accent-amber)] truncate tabular-nums">${activeStartShort}</span>
                <span class="w-1.5 h-1.5 shrink-0 rounded-full bg-[var(--accent-amber)] animate-pulse"></span>
            </div>
            <div class="relative flex-1 flex items-end my-2 bg-[var(--bg-void)] p-1">
                <div class="w-full bg-[var(--accent-amber)] ${isLiveSelected ? 'opacity-90' : 'opacity-60'}" style="height: ${activeState.activePct}%"></div>
            </div>
            <div class="leading-tight">
                <div class="font-sans font-normal text-sm sm:text-lg text-[var(--accent-amber)] tracking-tight tabular-nums flex items-baseline justify-between">
                    <span>+${activeState.kmDriven}</span>
                    <span class="font-mono text-[8px] sm:text-[9px] text-[var(--accent-amber)] ml-0.5">KM</span>
                </div>
                <div class="font-mono text-[9px] text-[var(--text-secondary)] uppercase mt-0.5">${isLiveSelected ? 'SEL.' : 'ACTIVO'}</div>
            </div>
        `;
        container.appendChild(liveCol);
    }

    // Fill remaining slots up to 4 (single 4-column Swiss row)
    const currentCols = cycles.length + (activeState && cockpitState.logs.length > 0 ? 1 : 0);
    for (let i = currentCols + 1; i <= 4; i++) {
        const col = document.createElement('div');
        col.className = 'monolith-bar rounded-sm p-2.5 sm:p-3 h-40 sm:h-44 flex flex-col justify-between opacity-20';
        col.innerHTML = `
            <div class="flex items-center justify-between font-mono text-[9px] sm:text-[10px]">
                <span class="font-medium text-[var(--text-secondary)]">—</span>
                <span class="text-[9px] text-[var(--text-muted)]">—</span>
            </div>
            <div class="relative flex-1 flex items-end my-2 bg-[var(--bg-void)] p-1">
                <div class="w-full bg-[var(--line-strong)]" style="height: 4%"></div>
            </div>
            <div class="leading-tight">
                <div class="font-sans font-light text-sm sm:text-base tracking-tight tabular-nums text-[var(--text-secondary)]">—</div>
                <div class="font-mono text-[9px] text-[var(--text-secondary)] tabular-nums mt-0.5">—</div>
            </div>
        `;
        container.appendChild(col);
    }

    // Benchmark hairlines (computed across fullEraCycles for accuracy)
    if (allCycles.length > 0) {
        const effs = allCycles.map(x => x.eff);
        const minEl = document.getElementById('bench-min');
        const avgEl = document.getElementById('bench-avg');
        const maxEl = document.getElementById('bench-max');
        if (minEl) minEl.innerText = formatEff(Math.min(...effs), unit, true);
        if (avgEl) avgEl.innerText = formatEff(model.fullEraAvgEff, unit, true);
        if (maxEl) maxEl.innerText = formatEff(Math.max(...effs), unit, true);
    }

    renderCycleDetail();
}

function updateMonolithSpotlight() {
    const { model, unit, fuelPriceCop } = cockpitState;
    if (!model) return;

    const titleEl = document.getElementById('monolith-title');
    const effEl = document.getElementById('mono-stat-eff');
    const kmEl = document.getElementById('mono-stat-km');
    const volEl = document.getElementById('mono-stat-vol');
    const costEl = document.getElementById('mono-stat-cost');

    const cycles = model.fullEraCycles || [];
    const activeState = model.activeTankState;

    if (cockpitState.selectedCycleIdx === 'active') {
        const lastClosed = cycles.length > 0 ? cycles[cycles.length - 1] : null;
        const activeStartStr = activeState?.startDate || (lastClosed ? lastClosed.endDate : cockpitState.logs[0]?.date);
        const activeStartShort = activeStartStr ? formatDateShort(activeStartStr) : 'HOY';

        const safeEff = Number(activeState?.adaptiveEff) || Number(model.fullEraAvgEff) || 34.54;
        const kmDriven = Number(activeState?.kmDriven) || 0;
        const consumedGals = safeEff > 0 ? (kmDriven / safeEff) : 0;
        const consumedCostCop = Math.round(consumedGals * fuelPriceCop);

        if (titleEl) titleEl.innerText = `CICLO ACTIVO · DESDE ${activeStartShort}`;
        if (effEl) effEl.innerText = formatEff(safeEff, unit, true);
        if (kmEl) kmEl.innerText = `+${kmDriven} KM`;
        if (volEl) volEl.innerText = formatVol(consumedGals, unit, true);
        if (costEl) costEl.innerText = `$${consumedCostCop.toLocaleString('es-CO')}`;
    } else if (cockpitState.selectedCycleIdx === null) {
        const totKm = cycles.reduce((a, b) => a + b.dist, 0);
        const totGal = cycles.reduce((a, b) => a + b.gals, 0);
        if (titleEl) titleEl.innerText = 'RENDIMIENTO POR CICLO';
        if (effEl) effEl.innerText = formatEff(model.fullEraAvgEff, unit, true);
        if (kmEl) kmEl.innerText = `+${totKm.toLocaleString()} KM`;
        if (volEl) volEl.innerText = formatVol(totGal, unit, true);
        if (costEl) costEl.innerText = `$${Math.round((totGal * fuelPriceCop) / 1000)}K`;
    } else {
        const c = cycles.find(x => x.cycleIndex === cockpitState.selectedCycleIdx);
        if (!c) return;
        if (titleEl) titleEl.innerText = `${formatDateShort(c.startDate)} — ${formatDateShort(c.endDate)}  ·  ${c.days || 1} DÍAS`;
        if (effEl) effEl.innerText = formatEff(c.eff, unit, true);
        if (kmEl) kmEl.innerText = `+${c.dist} KM (${c.kmPerDay.toFixed(0)} KM/D)`;
        if (volEl) volEl.innerText = formatVol(c.gals, unit, true);
        if (costEl) costEl.innerText = `$${Math.round(c.gals * fuelPriceCop).toLocaleString('es-CO')}`;
    }

    renderCycleDetail();
}

/**
 * Stage 03: Dynamic Month Pills Generator.
 */
function renderDynamicMonthPills() {
    const container = document.getElementById('horizon-month-pills');
    if (!container) return;
    container.innerHTML = '';

    const series = cockpitState.model?.dailySeries || [];
    if (series.length === 0) return;

    const monthSet = new Set();
    series.forEach(d => {
        if (d.date && d.date.length >= 7) {
            monthSet.add(d.date.substring(0, 7));
        }
    });

    const monthKeys = Array.from(monthSet).sort();
    const monthNames = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.dataset.mo = 'all';
    allBtn.className = `mo-pill px-2.5 py-1 rounded-sm font-medium ${cockpitState.selectedMonth === 'all' ? 'flat-pill-active' : 'flat-pill text-[var(--text-secondary)]'}`;
    allBtn.innerText = `${monthKeys.length}M`;
    allBtn.onclick = () => selectHorizonMonth('all');
    container.appendChild(allBtn);

    monthKeys.forEach(ym => {
        const [, monthNum] = ym.split('-');
        const idx = parseInt(monthNum, 10) - 1;
        const label = monthNames[idx] || ym;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.mo = ym;
        btn.className = `mo-pill px-2.5 py-1 rounded-sm font-medium ${cockpitState.selectedMonth === ym ? 'flat-pill-active' : 'flat-pill text-[var(--text-secondary)]'}`;
        btn.innerText = label;
        btn.onclick = () => selectHorizonMonth(ym);
        container.appendChild(btn);
    });
}

function selectHorizonMonth(monthKey) {
    playHorologyTick(1000, 0.015, 0.025);
    cockpitState.selectedMonth = monthKey;
    renderDynamicMonthPills();
    renderFrequencyHorizon();
}

/**
 * Stage 03: Frequency Horizon Needles Stage.
 */
function renderFrequencyHorizon() {
    const stage = document.getElementById('synth-bars-stage');
    if (!stage) return;
    stage.innerHTML = '';

    const series = cockpitState.model?.dailySeries || [];
    const filtered = cockpitState.selectedMonth === 'all'
        ? series
        : series.filter(d => d.date.startsWith(cockpitState.selectedMonth));

    if (filtered.length === 0) {
        // Render 28 silent hairlines
        for (let i = 0; i < 28; i++) {
            const pin = document.createElement('div');
            pin.className = 'synth-pin flex-1 bg-[var(--line-hair)]';
            pin.style.height = '8%';
            stage.appendChild(pin);
        }
        return;
    }

    const startLbl = document.getElementById('synth-start-lbl');
    const endLbl = document.getElementById('synth-end-lbl');
    if (startLbl) startLbl.innerText = formatDateShort(filtered[0].date);
    if (endLbl) endLbl.innerText = formatDateShort(filtered[filtered.length - 1].date);

    const maxKm = Math.max(...filtered.map(d => d.km), 1);

    filtered.forEach((d, idx) => {
        const ratio = d.km / maxKm;
        const baseH = Math.max(6, Math.round(ratio * 100));
        const pin = document.createElement('div');
        pin.dataset.idx = idx;
        pin.dataset.baseh = baseH;

        let colorClass = 'bg-[var(--line-strong)]';
        if (d.refuelGal > 0) {
            colorClass = 'bg-[var(--accent-amber)]';
        } else if (ratio > 0.65) {
            colorClass = 'bg-[var(--text-primary)]';
        } else if (ratio > 0.3) {
            colorClass = 'bg-[var(--text-secondary)]';
        }

        pin.className = `synth-pin flex-1 ${colorClass}`;
        pin.style.height = `${baseH}%`;
        stage.appendChild(pin);
    });

    function scrubAtClientX(clientX) {
        const rect = stage.getBoundingClientRect();
        const relX = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        const targetIdx = Math.min(filtered.length - 1, Math.floor(relX * filtered.length));

        if (targetIdx !== cockpitState.activeSynthIdx) {
            cockpitState.activeSynthIdx = targetIdx;
            playHorologyTick(800 + targetIdx * 6, 0.009, 0.018);
            inspectHorizonDay(filtered[targetIdx]);
        }

        const pins = stage.children;
        for (let i = 0; i < pins.length; i++) {
            const baseH = parseFloat(pins[i].dataset.baseh || '8');
            const dist = Math.abs(i - targetIdx);
            const boost = dist < 5 ? Math.exp(-(dist * dist) / 6) * 24 : 0;
            pins[i].style.height = `${Math.min(100, baseH + boost)}%`;
            pins[i].style.opacity = dist === 0 ? '1' : (dist < 4 ? '0.85' : '0.45');
        }
    }

    stage.onpointermove = (e) => scrubAtClientX(e.clientX);
    stage.onpointerdown = (e) => scrubAtClientX(e.clientX);
    stage.onpointerleave = () => {
        const pins = stage.children;
        for (let i = 0; i < pins.length; i++) {
            pins[i].style.height = `${pins[i].dataset.baseh || 8}%`;
            pins[i].style.opacity = '1';
        }
    };

    inspectHorizonDay(filtered[filtered.length - 1]);
}

function inspectHorizonDay(dayObj) {
    if (!dayObj) return;
    const { model, unit, fuelPriceCop } = cockpitState;
    const safeEff = model?.fullEraAvgEff || 33.71;
    const fuelGal = safeEff > 0 ? (dayObj.km / safeEff) : 0;
    const cost = fuelGal * fuelPriceCop;

    const dtBadge = document.getElementById('synth-date-badge');
    const odoBadge = document.getElementById('synth-odo-badge');
    const rflTag = document.getElementById('synth-refuel-tag');
    const kmVal = document.getElementById('synth-km-val');
    const fuelVal = document.getElementById('synth-fuel-val');
    const costVal = document.getElementById('synth-cost-val');

    if (dtBadge) dtBadge.innerText = formatDateWithWeekday(dayObj.date);
    if (odoBadge) odoBadge.innerText = dayObj.odo ? `${dayObj.odo.toLocaleString()} KM` : (dayObj.isGpsReal ? 'TELEMETRÍA GPS' : 'INTERPOLADO');
    if (rflTag) {
        rflTag.innerText = dayObj.refuelGal > 0
            ? `★ ${dayObj.isFull ? 'FULL' : 'RECARGA'} +${formatVol(dayObj.refuelGal, unit, true)}`
            : 'RODAJE URBANO';
    }
    if (kmVal) kmVal.innerText = `${dayObj.km.toFixed(1)} KM`;
    if (fuelVal) fuelVal.innerText = formatVol(fuelGal, unit, true);
    if (costVal) costVal.innerText = `$${Math.round(cost).toLocaleString('es-CO')}`;
}

/**
 * Stage 03: 7-Day Weekday DNA Strip.
 */
function renderWeekdayDNA() {
    const strip = document.getElementById('weekday-dna-strip');
    if (!strip) return;
    const dna = cockpitState.model?.weekdayDNA || [];

    if (dna.length === 0) {
        const days = ['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM'];
        strip.innerHTML = days.map(d => `
            <div class="py-2.5 px-1">
                <span class="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)] block">${d}</span>
                <strong class="font-mono text-[11px] font-medium text-[var(--text-secondary)] tabular-nums">0 KM</strong>
            </div>
        `).join('');
        return;
    }

    strip.innerHTML = dna.map(d => `
        <div class="py-2.5 px-1">
            <span class="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)] block">${d.name}</span>
            <strong class="font-mono text-[11px] font-medium ${d.isPeak ? 'text-[var(--accent-amber)]' : 'text-[var(--text-primary)]'} tabular-nums">${d.avgKm.toFixed(0)} KM</strong>
        </div>
    `).join('');
}

/**
 * Stage 02 Detalle: Panel de Detalle del Ciclo (Fusión de Bitácora).
 * Muestra las lecturas y tanqueadas del ciclo seleccionado o activo,
 * donde cada fila en sí misma actúa como el tanque horizontal.
 */
function renderCycleDetail() {
    const container = document.getElementById('cycle-detail-panel');
    if (!container) return;

    initTelemetryDetailModal();

    const { model, unit, fuelPriceCop, vehicleProfile } = cockpitState;
    const cycles = model?.fullEraCycles || [];
    const processed = model?.processedData && model.processedData.length > 0
        ? model.processedData
        : [...(cockpitState.logs || [])].sort((a, b) => (a.date > b.date ? 1 : -1));

    if (processed.length === 0) {
        container.innerHTML = `
            <div class="p-4 text-center font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">
                0 REGISTROS EN ESTE CICLO
            </div>
        `;
        return;
    }

    const tankMaxGal = Number(vehicleProfile?.tankCapacityGallons) || DEFAULT_TANK_CAPACITY_GAL;
    let cycleTitle = '';
    let cycleLogs = [];
    let cycleStartDate = '';
    let cycleEndDate = '';
    let cyclePhys = null;

    if (cockpitState.selectedCycleIdx === 'active') {
        const lastRefuelIdx = (model?.lastRefuelIndex !== undefined && model.lastRefuelIndex >= 0)
            ? model.lastRefuelIndex
            : processed.map(x => Boolean(x.isFullTank || x.is_full_tank || (Number(x.gallons_added) > 0))).lastIndexOf(true);
        const activeStart = model?.activeTankState?.startDate || (lastRefuelIdx >= 0 ? processed[lastRefuelIdx].date : processed[0]?.date);
        cycleTitle = `CICLO ACTIVO · DESDE ${activeStart ? formatDateShort(activeStart) : 'HOY'}`;
        cycleLogs = lastRefuelIdx >= 0 ? processed.slice(lastRefuelIdx + 1) : processed;
        cycleStartDate = activeStart || '';
        cycleEndDate = vehicleProfile?.gpsCache?.live?.date || new Date().toISOString().slice(0, 10);
        cyclePhys = model?.activeTankState?.physicalTelemetry || null;
    } else if (cockpitState.selectedCycleIdx !== null) {
        const c = cycles.find(x => x.cycleIndex === cockpitState.selectedCycleIdx);
        if (c) {
            cycleTitle = `CICLO DEL ${formatDateShort(c.startDate)} AL ${formatDateShort(c.endDate)} · ${c.days || 1} DÍAS`;
            if (c.startIndex !== undefined && c.endIndex !== undefined) {
                cycleLogs = processed.slice(c.startIndex + 1, c.endIndex + 1);
            } else {
                cycleLogs = processed.filter(l => Number(l.odometer_reading) > c.startOdo && Number(l.odometer_reading) <= c.endOdo);
            }
            cycleStartDate = c.startDate || '';
            cycleEndDate = c.endDate || '';
            cyclePhys = c.physicalTelemetry || null;
        }
    }

    if (!cycleTitle) {
        cycleTitle = 'HISTORIAL GENERAL · TODOS LOS REGISTROS';
        cycleLogs = processed;
        if (cycles.length > 0) {
            const lastC = cycles[cycles.length - 1];
            cycleStartDate = lastC.startDate || '';
            cycleEndDate = lastC.endDate || '';
            cyclePhys = lastC.physicalTelemetry || null;
        }
    }

    const displayRows = [...cycleLogs].reverse();

    const pumpSvg = `<svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 22L15 22"/><path d="M4 9L14 9"/><path d="M14 22V4a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v18"/><path d="M14 13h2a2 2 0 0 1 2 2v2a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V9.83a2 2 0 0 0-.59-1.42L18 5"/></svg>`;
    const needleSvg = `<svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/></svg>`;

    const tax = cyclePhys?.invisibleTax?.hasData ? cyclePhys.invisibleTax : null;
    const taxHairlineHtml = tax ? `
        <div class="h-0.5 w-full flex overflow-hidden bg-[var(--line-hair)]" aria-hidden="true">
            <div style="width: ${tax.pctBase}%; background-color: var(--text-muted);"></div>
            <div style="width: ${tax.pctTraffic}%; background-color: var(--accent-amber);"></div>
            <div style="width: ${tax.pctIdle}%; background-color: var(--accent-cyan);"></div>
            <div style="width: ${tax.pctDynamicsCold}%; background-color: var(--accent-crimson);"></div>
        </div>
    ` : '';

    container.innerHTML = `
        <div class="border-b border-[var(--line-hair)]">
            <div class="px-4 py-3 flex flex-wrap items-center justify-between gap-2 font-mono text-xs">
                <div class="flex items-center gap-2 min-w-0">
                    <span class="w-1.5 h-1.5 rounded-full bg-[var(--accent-amber)] shrink-0"></span>
                    <span class="font-semibold text-[var(--text-primary)] uppercase tracking-wider truncate">${cycleTitle}</span>
                </div>
                <div class="flex items-center gap-3 shrink-0">
                    <span class="text-[10px] text-[var(--text-secondary)] uppercase tracking-widest tabular-nums">${displayRows.length} ${displayRows.length === 1 ? 'REGISTRO' : 'REGISTROS'}</span>
                    <button id="cycle-detail-open-intel" type="button" class="text-[10px] font-semibold uppercase tracking-widest text-[var(--accent-amber)] hover:text-[var(--text-primary)] transition-colors cursor-pointer">
                        ANÁLISIS →
                    </button>
                </div>
            </div>
            ${taxHairlineHtml}
        </div>

        <div class="divide-y divide-[var(--line-hair)] max-h-80 overflow-y-auto font-mono text-xs">
            ${displayRows.map(r => {
                const isFull = Boolean(r.is_full_tank || r.isFullTank);
                const galsAdded = Number(r.gallons_added) || 0;
                const hasFuel = (galsAdded > 0 || Number(r.refuels_count) > 0 || Number(r.total_cost_cop) > 0);
                const isRefuel = hasFuel || (isFull && galsAdded > 0);
                const isPartial = !isFull && hasFuel;

                // Resolve fuel level percentage in tank for this event
                let fuelPct = 0;
                if (r.fuel_level_percent !== null && r.fuel_level_percent !== undefined && r.fuel_level_percent !== '') {
                    fuelPct = Math.round(Number(r.fuel_level_percent));
                } else if (isFull) {
                    fuelPct = 100;
                } else if (r.v_after !== undefined && tankMaxGal > 0) {
                    fuelPct = Math.round((Number(r.v_after) / tankMaxGal) * 100);
                }
                fuelPct = Math.min(100, Math.max(0, fuelPct));
                const tankGalAtRecord = Number(((fuelPct / 100) * tankMaxGal).toFixed(2));
                const isLowReserve = fuelPct <= 15;

                // Left accent border
                const borderClass = isFull && hasFuel
                    ? 'border-l-[3px] border-l-[var(--accent-volt)]'
                    : (isPartial
                        ? 'border-l-[3px] border-l-[var(--accent-amber)]'
                        : (isLowReserve ? 'border-l-[3px] border-l-[var(--accent-crimson)]' : 'border-l-[3px] border-l-[var(--line-strong)]'));

                // Explicit inline RGBA gradient so the horizontal tank fill is clearly visible in all themes
                const tankFillStyle = isLowReserve
                    ? `width: ${fuelPct}%; background: linear-gradient(90deg, rgba(244, 63, 94, 0.14) 0%, rgba(244, 63, 94, 0.24) 100%); border-right: 2px solid rgba(244, 63, 94, 0.65);`
                    : (isRefuel
                        ? `width: ${fuelPct}%; background: linear-gradient(90deg, rgba(16, 185, 129, 0.12) 0%, rgba(16, 185, 129, 0.22) 100%); border-right: 2px solid rgba(16, 185, 129, 0.65);`
                        : `width: ${fuelPct}%; background: linear-gradient(90deg, rgba(255, 85, 0, 0.10) 0%, rgba(255, 85, 0, 0.20) 100%); border-right: 2px solid rgba(255, 85, 0, 0.55);`);

                const cost = hasFuel ? sanitizeFuelCostCop(r.total_cost_cop, galsAdded, fuelPriceCop) : 0;
                const pricePerGal = (galsAdded > 0 && cost > 0) ? Math.round(cost / galsAdded) : fuelPriceCop;
                const deltaKm = Number(r.distance_km !== undefined ? r.distance_km : r.delta_km) || 0;

                // Flat typographic label (no nested boxes)
                let typeLabelHtml = '';
                if (isFull && hasFuel) {
                    typeLabelHtml = `
                        <span class="inline-flex items-center gap-1.5 text-[var(--accent-volt)] font-mono text-[11px] font-semibold uppercase tracking-wider shrink-0">
                            ${pumpSvg}
                            <span>TANQUEADA FULL · +${formatVol(galsAdded, unit, true)}</span>
                        </span>
                    `;
                } else if (isPartial) {
                    typeLabelHtml = `
                        <span class="inline-flex items-center gap-1.5 text-[var(--accent-amber)] font-mono text-[11px] font-semibold uppercase tracking-wider shrink-0">
                            ${pumpSvg}
                            <span>RECARGA · +${formatVol(galsAdded, unit, true)}</span>
                        </span>
                    `;
                } else if (isFull && !hasFuel) {
                    typeLabelHtml = `
                        <span class="inline-flex items-center gap-1.5 text-[var(--accent-volt)] font-mono text-[11px] font-semibold uppercase tracking-wider shrink-0">
                            ${needleSvg}
                            <span>TANQUE LLENO</span>
                        </span>
                    `;
                } else {
                    typeLabelHtml = `
                        <span class="inline-flex items-center gap-1.5 text-[var(--text-secondary)] font-mono text-[10px] font-medium uppercase tracking-wider shrink-0">
                            ${needleSvg}
                            <span>MEDICIÓN</span>
                        </span>
                    `;
                }

                const recId = r.id || r.date;
                const pctTextColor = isLowReserve
                    ? 'text-[var(--accent-crimson)]'
                    : (fuelPct >= 80 ? 'text-[var(--accent-volt)]' : 'text-[var(--text-primary)]');

                // Right column: for refuels, use the space for the refuel cost instead of redundant "100%"
                let rightReadoutHtml = '';
                if (isRefuel && cost > 0) {
                    rightReadoutHtml = `
                        <div class="text-right leading-none">
                            <div class="flex items-baseline justify-end gap-1">
                                <span class="font-sans font-normal text-lg sm:text-xl tracking-tight tabular-nums ${isFull ? 'text-[var(--accent-volt)]' : 'text-[var(--accent-amber)]'}">
                                    $${Math.round(cost).toLocaleString('es-CO')}
                                </span>
                            </div>
                            <span class="font-mono text-[9px] uppercase tracking-wider text-[var(--text-secondary)] tabular-nums block mt-0.5">
                                ${isFull ? `$${pricePerGal.toLocaleString('es-CO')} / GAL` : `${fuelPct}% · ${formatVol(tankGalAtRecord, unit, true)}`}
                            </span>
                        </div>
                    `;
                } else {
                    rightReadoutHtml = `
                        <div class="text-right leading-none">
                            <div class="flex items-baseline justify-end gap-1">
                                <span class="font-sans font-normal text-lg sm:text-xl tracking-tight tabular-nums ${pctTextColor}">${fuelPct}%</span>
                            </div>
                            <span class="font-mono text-[9px] uppercase tracking-wider text-[var(--text-secondary)] tabular-nums block mt-0.5">
                                ${formatVol(tankGalAtRecord, unit, true)}
                            </span>
                        </div>
                    `;
                }

                return `
                    <div data-log-id="${recId}" class="cycle-tank-row relative overflow-hidden px-3.5 sm:px-4 py-3 ${borderClass} bg-[var(--bg-void)] hover:bg-[var(--bg-elevated)]/40 active:bg-[var(--bg-elevated)]/70 transition-colors cursor-pointer select-none">
                        <!-- Fondo Horizontal del Tanque (Nivel de Gasolina real en la fila) -->
                        <div class="cycle-tank-fill pointer-events-none absolute inset-y-0 left-0 transition-all duration-500" style="${tankFillStyle}"></div>

                        <!-- Contenido en primer plano con legibilidad total -->
                        <div class="relative z-10 flex items-center justify-between gap-2 sm:gap-4">
                            
                            <!-- Izquierda: Tipo de Evento + Fecha y Odómetro -->
                            <div class="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 min-w-0">
                                ${typeLabelHtml}
                                <div class="flex items-center gap-2 flex-wrap">
                                    <span class="font-mono text-xs font-semibold text-[var(--text-primary)] uppercase tracking-wider">${formatDateWithWeekday(r.date)}</span>
                                    <span class="text-[var(--line-strong)]">·</span>
                                    <span class="font-mono text-xs text-[var(--text-secondary)] tabular-nums">${Number(r.odometer_reading || 0).toLocaleString('es-CO')} KM</span>
                                    ${deltaKm > 0 ? `<span class="font-mono text-[11px] font-semibold text-[var(--accent-volt)] tabular-nums">+${deltaKm} KM</span>` : ''}
                                </div>
                            </div>

                            <!-- Derecha: Precio de Tanqueada (en cargas) o Nivel de Tanque (en mediciones) -->
                            <div class="flex items-center gap-2 ml-auto shrink-0">
                                ${rightReadoutHtml}
                            </div>

                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;

    // Bind 1-tap fuel intelligence trigger
    const cycleIntelBtn = container.querySelector('#cycle-detail-open-intel');
    if (cycleIntelBtn) {
        cycleIntelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            playHorologyTick(1200, 0.014, 0.024);
            window.dispatchEvent(new CustomEvent('octane:open-gps-intelligence', {
                detail: { tab: 'fuel', fuelScope: 'cycle', cycleIndex: cockpitState.selectedCycleIdx }
            }));
        });
    }

    // Bind row tap to open Telemetry Detail Modal
    container.querySelectorAll('.cycle-tank-row').forEach(row => {
        row.addEventListener('click', () => {
            const id = row.dataset.logId;
            const rawItem = cockpitState.logs.find(x => (x.id && String(x.id) === String(id)) || x.date === id);
            const processedItem = displayRows.find(x => (x.id && String(x.id) === String(id)) || x.date === id);
            const targetLog = rawItem ? { ...processedItem, ...rawItem } : processedItem;
            if (targetLog) {
                openTelemetryDetailModal(targetLog, {
                    unit,
                    fuelPriceCop,
                    tankMaxGal
                });
            }
        });
    });

}

async function deleteLogRecord(id) {
    playHorologyTick(600, 0.02, 0.04);
    const item = cockpitState.logs.find(x => (x.id && String(x.id) === String(id)) || x.date === id);
    const dateLabel = item?.date ? formatDateWithWeekday(item.date) : id;
    if (!(await confirmDialog({ title: `¿Eliminar la lectura de ${dateLabel}?`, confirmLabel: 'Eliminar', danger: true }))) return;

    cockpitState.logs = cockpitState.logs.filter(x => !((x.id && String(x.id) === String(id)) || x.date === id));
    
    try {
        await deleteTelemetryLog(item?.id || item?.date || id);
    } catch {}

    try {
        localStorage.setItem('octane_kinetic_v1', JSON.stringify(cockpitState.logs));
    } catch {}

    if (store && typeof store.setState === 'function') {
        store.setState({ telemetryLogs: cockpitState.logs });
    }

    showToast(`LECTURA ELIMINADA`);
    window.dispatchEvent(new CustomEvent('octane:delete-log', { detail: { id, date: item?.date } }));
    window.dispatchEvent(new CustomEvent('octane:logs-updated', { detail: { logs: cockpitState.logs } }));
    renderCockpit(currentContainer);
}

/**
 * Binds DOM event listeners for the active Cockpit.
 */
function bindActiveCockpitEvents() {
    if (!currentContainer) return;

    // Cockpit Alerts Badge interaction
    const alertsPill = currentContainer.querySelector('#cockpit-alerts-pill');
    if (alertsPill) {
        alertsPill.addEventListener('click', () => {
            playHorologyTick(1200, 0.015, 0.03);
            const alerts = getActiveAlerts();
            const targetView = (alerts?.topAlert?.category === 'maintenance') ? 'cluster' : 'glovebox';
            window.dispatchEvent(new CustomEvent('octane:navigate', { detail: { view: targetView } }));
        });
    }

    // Discretionary Zero Hairline Strip buttons
    const zeroReadingBtn = currentContainer.querySelector('#zero-strip-reading');
    if (zeroReadingBtn) {
        zeroReadingBtn.addEventListener('click', () => {
            playHorologyTick(1200, 0.015, 0.03);
            if (store) store.setState({ isReadingModalOpen: true, isSyncModalOpen: true });
            window.dispatchEvent(new CustomEvent('octane:open-reading'));
            window.dispatchEvent(new CustomEvent('octane:open-modal', { detail: { modal: 'reading' } }));
        });
    }

    const zeroImportBtn = currentContainer.querySelector('#zero-strip-import');
    const zeroFileInput = currentContainer.querySelector('#zero-strip-file');
    if (zeroImportBtn && zeroFileInput) {
        zeroImportBtn.addEventListener('click', () => zeroFileInput.click());
        zeroFileInput.addEventListener('change', (ev) => handleJsonImportFile(ev.target.files?.[0]));
    }

    // Time-Warp Scrubber & Chips
    const slider = currentContainer.querySelector('#warp-slider');
    if (slider) {
        slider.addEventListener('input', () => {
            playHorologyTick(720, 0.008, 0.015);
            cockpitState.timeWarpKm = parseFloat(slider.value) || 0;
            disturbFluid(0.35);
            updateSightGlassAndWarp();
        });
    }

    currentContainer.querySelectorAll('.warp-chip').forEach(btn => {
        btn.addEventListener('click', function() {
            playHorologyTick(1150, 0.015, 0.03);
            const val = parseFloat(this.dataset.warp) || 0;
            cockpitState.timeWarpKm = val;
            if (slider) slider.value = val;
            disturbFluid(0.9);
            updateSightGlassAndWarp();
        });
    });

    // Kinetic Car Rev Launch Tap & Ghost Race 5-Tap Easter Egg
    const chassisStage = currentContainer.querySelector('#chassis-cad-stage');
    if (chassisStage) {
        chassisStage.addEventListener('click', () => {
            handleChassisStageTap(chassisStage);
        });
    }

    // Interactive KPI Cards -> Open KPI Timeline Detail Modal
    currentContainer.querySelectorAll('[data-kpi-card]').forEach(card => {
        const launchKpi = () => {
            const kpiType = card.dataset.kpiCard;
            if (!kpiType || !cockpitState.kpiAnalytics) return;
            openKpiDetailModal(kpiType, cockpitState.kpiAnalytics);
        };
        card.addEventListener('click', launchKpi);
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                launchKpi();
            }
        });
    });

    // GPS Data Triggers (Header, Telemetry Body & Last Trip Ribbon)
    const openCockpitGps = () => {
        playHorologyTick(1200, 0.015, 0.025);
        const activeTank = cockpitState.model?.activeTankState;
        const activeStart = activeTank?.startDate || '';
        const today = todayLocalYmd();
        openGpsTripsModal({
            initialScope: 'cycle',
            cycleStartDate: activeStart,
            cycleEndDate: today
        });
    };

    ['#cockpit-gps-data-trigger', '#cockpit-gps-open-btn', '#cockpit-gps-body', '#cockpit-gps-trip-row'].forEach(sel => {
        const el = currentContainer.querySelector(sel);
        if (el) el.addEventListener('click', openCockpitGps);
    });

    // GPS Intelligence Detail Trigger (ANÁLISIS)
    const gpsIntelBtn = currentContainer.querySelector('#cockpit-gps-intel-btn');
    if (gpsIntelBtn) {
        gpsIntelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            playHorologyTick(1200, 0.014, 0.025);
            window.dispatchEvent(new CustomEvent('octane:open-gps-intelligence', { detail: { tab: 'fuel' } }));
        });
    }

    // Quick GPS Sync button inside Cockpit GPS Panel
    const gpsSyncBtn = currentContainer.querySelector('#cockpit-gps-sync-btn');
    if (gpsSyncBtn) {
        gpsSyncBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            playHorologyTick(1250, 0.015, 0.03);
            const icon = currentContainer?.querySelector('#cockpit-gps-sync-icon');
            if (icon) icon.classList.add('animate-spin', 'text-[var(--accent-amber)]');
            try {
                await syncGpsTelemetry({ silent: false });
            } finally {
                if (icon) icon.classList.remove('animate-spin', 'text-[var(--accent-amber)]');
            }
        });
    }

    // Disconnected GPS -> Navigate to Settings
    const gpsSettingsBtn = currentContainer.querySelector('#cockpit-gps-settings-btn');
    if (gpsSettingsBtn) {
        gpsSettingsBtn.addEventListener('click', () => {
            playHorologyTick(1100, 0.015, 0.025);
            window.dispatchEvent(new CustomEvent('octane:navigate', { detail: { view: 'settings' } }));
        });
    }

    // Kinetic Drum Counter Mechanical Odometer Tap
    const drumContainer = currentContainer.querySelector('#drum-odometer-container');
    if (drumContainer) {
        drumContainer.addEventListener('click', () => {
            triggerDrumCascade();
        });
    }

}

// Kinematics state tracking
let lastChassisMode = -1;
let isChassisAnimating = false;
let chassisTimeoutIds = [];

// Ghost Race Easter Egg tap state
let chassisTapTimestamps = [];
const CAD_5_TAP_THRESHOLD = 5;
const CAD_5_TAP_WINDOW_MS = 2200; // 2.2s

/**
 * Triggers a subtle amber flash overlay on the CAD blueprint stage.
 */
function triggerAmberFlash(stageEl) {
    if (!stageEl) return;
    const flash = document.createElement('div');
    flash.className = 'absolute inset-0 bg-[var(--accent-amber)]/25 pointer-events-none transition-opacity duration-500 z-30';
    flash.style.opacity = '1';
    stageEl.appendChild(flash);
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            flash.style.opacity = '0';
            setTimeout(() => {
                try { flash.remove(); } catch (_) {}
            }, 520);
        });
    });
}

/**
 * Handles clicks on the CAD chassis stage:
 * - Maintains single-tap rev animation on every tap
 * - Counts 5 taps within 2.2s to trigger Ghost Race Easter Egg
 */
function handleChassisStageTap(stageEl) {
    // 1. Maintain single-tap rev animation on every tap
    triggerChassisRev();

    // 2. 5-tap counter within 2.2s window
    const now = Date.now();
    chassisTapTimestamps = chassisTapTimestamps.filter(t => (now - t) <= CAD_5_TAP_WINDOW_MS);
    chassisTapTimestamps.push(now);

    if (chassisTapTimestamps.length >= CAD_5_TAP_THRESHOLD) {
        chassisTapTimestamps = []; // Reset counter

        // 3. Haptic vibration
        try {
            if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
                navigator.vibrate([30, 20, 60]);
            }
        } catch (_) {}

        // 4. Subtle amber flash
        triggerAmberFlash(stageEl);

        // 5. Open Ghost Race modal (re-scans full accumulated GPS archive in IndexedDB + store)
        openGhostRaceModal();
    }
}

function clearChassisAnimation() {
    chassisTimeoutIds.forEach(clearTimeout);
    chassisTimeoutIds = [];
    if (!currentContainer) return;
    const chassisStage = currentContainer.querySelector('#chassis-cad-stage');
    const wrapper = currentContainer.querySelector('#cad-vehicle-wrapper');
    const wheels = currentContainer.querySelectorAll('#cad-vehicle-wrapper .vehicle-wheel');
    const smokeContainer = currentContainer.querySelector('#exhaust-smoke-container');
    const cone = chassisStage?.querySelector('.headlight-cone');
    const rearGlow = chassisStage?.querySelector('.rear-stop-glow');
    const stopLights = currentContainer.querySelectorAll('#cad-vehicle-wrapper svg path[fill*="#F43F5E"], #cad-vehicle-wrapper svg path[fill*="#f43f5e"]');
    const headLights = currentContainer.querySelectorAll('#cad-vehicle-wrapper svg path[fill*="#F8FAFC"], #cad-vehicle-wrapper svg path[fill*="#f8fafc"]');

    if (wrapper) wrapper.classList.remove('animate-chassis-launch', 'animate-chassis-launch-3s', 'animate-chassis-idle');
    if (wheels) wheels.forEach(w => w.classList.remove('animate-wheel-burnout', 'animate-wheel-burnout-3s'));
    if (smokeContainer) smokeContainer.innerHTML = '';
    if (cone) cone.remove();
    if (rearGlow) rearGlow.remove();
    stopLights.forEach(sl => sl.classList.remove('animate-rear-stop-flash'));
    headLights.forEach(hl => hl.classList.remove('animate-headlight-flash'));
    isChassisAnimating = false;
}

/**
 * Triggers random vehicle kinematics among 3 discrete modes avoiding immediate repetition:
 * - Modo 0: Acelerón a Fondo ~3.0s (burnout, chassis launch pitch, 10-12 cascading smoke particles, 2-gear rev audio)
 * - Modo 1: Ráfaga de Luces Altas + Stop ~1.8s (headlight cone double flash, red stop glow, relay click audio)
 * - Modo 2: Ralentí Mecánico / Neutro ~2.2s (chassis idle rumble, 3 subtle smoke puffs, sub-bass idle audio)
 */
function triggerChassisRev() {
    if (!currentContainer) return;
    if (isChassisAnimating) return;
    isChassisAnimating = true;

    // Select randomly between 3 modes avoiding immediate repetition
    const availableModes = [0, 1, 2].filter(m => m !== lastChassisMode);
    const mode = availableModes[Math.floor(Math.random() * availableModes.length)];
    lastChassisMode = mode;

    const chassisStage = currentContainer.querySelector('#chassis-cad-stage');
    const wrapper = currentContainer.querySelector('#cad-vehicle-wrapper');
    const wheels = currentContainer.querySelectorAll('#cad-vehicle-wrapper .vehicle-wheel');
    const smokeContainer = currentContainer.querySelector('#exhaust-smoke-container');

    if (mode === 0) {
        // MODO 0: Acelerón a Fondo ~3.0s
        playBurnoutSound3s();

        if (wrapper) {
            wrapper.classList.remove('animate-chassis-launch-3s');
            void wrapper.offsetWidth;
            wrapper.classList.add('animate-chassis-launch-3s');
        }

        if (wheels && wheels.length > 0) {
            wheels.forEach(w => {
                w.classList.remove('animate-wheel-burnout-3s');
                void w.offsetWidth;
                w.classList.add('animate-wheel-burnout-3s');
            });
        }

        // Humo: ráfaga continua de 11 partículas exhaust-smoke emitidas en cascada durante 2.6s
        if (smokeContainer) {
            smokeContainer.innerHTML = '';
            const totalParticles = 11;
            for (let i = 0; i < totalParticles; i++) {
                const tId = setTimeout(() => {
                    if (!smokeContainer.isConnected) return;
                    const smoke = document.createElement('div');
                    smoke.className = 'exhaust-smoke';
                    const size = 16 + Math.random() * 18;
                    smoke.style.width = `${size}px`;
                    smoke.style.height = `${size}px`;
                    smoke.style.right = `${14 + (i % 3) * 5 + (Math.random() * 4 - 2)}%`;
                    smoke.style.bottom = `${20 + (i % 3) * 3 + (Math.random() * 4 - 2)}%`;
                    smokeContainer.appendChild(smoke);
                    setTimeout(() => smoke.remove(), 950);
                }, i * 235);
                chassisTimeoutIds.push(tId);
            }
        }

        const endTId = setTimeout(() => {
            if (wrapper) wrapper.classList.remove('animate-chassis-launch-3s');
            if (wheels) wheels.forEach(w => w.classList.remove('animate-wheel-burnout-3s'));
            if (smokeContainer) smokeContainer.innerHTML = '';
            isChassisAnimating = false;
        }, 3000);
        chassisTimeoutIds.push(endTId);

    } else if (mode === 1) {
        // MODO 1: Ráfaga de Luces Altas + Stop ~1.8s
        playRelayClickSound(0);
        const snd2 = setTimeout(() => playRelayClickSound(0), 480);
        chassisTimeoutIds.push(snd2);

        // Proyecta un elemento .headlight-cone frontal que destella dos veces
        if (chassisStage) {
            let cone = chassisStage.querySelector('.headlight-cone');
            if (!cone) {
                cone = document.createElement('div');
                cone.className = 'headlight-cone pointer-events-none';
                chassisStage.appendChild(cone);
            }
            cone.classList.remove('animate-headlight-flash');
            void cone.offsetWidth;
            cone.classList.add('animate-headlight-flash');

            let rearGlow = chassisStage.querySelector('.rear-stop-glow');
            if (!rearGlow) {
                rearGlow = document.createElement('div');
                rearGlow.className = 'rear-stop-glow pointer-events-none absolute right-[8%] top-[25%] w-16 h-16 rounded-full bg-[var(--accent-crimson)] filter blur-xl opacity-0 z-20';
                chassisStage.appendChild(rearGlow);
            }
            rearGlow.classList.remove('animate-rear-stop-flash');
            void rearGlow.offsetWidth;
            rearGlow.classList.add('animate-rear-stop-flash');
        }

        // Ilumina los stops traseros en rojo intenso en el SVG
        const stopLights = currentContainer.querySelectorAll('#cad-vehicle-wrapper svg path[fill*="#F43F5E"], #cad-vehicle-wrapper svg path[fill*="#f43f5e"]');
        stopLights.forEach(sl => {
            sl.classList.remove('animate-rear-stop-flash');
            void sl.offsetWidth;
            sl.classList.add('animate-rear-stop-flash');
        });

        // Faros delanteros destello
        const headLights = currentContainer.querySelectorAll('#cad-vehicle-wrapper svg path[fill*="#F8FAFC"], #cad-vehicle-wrapper svg path[fill*="#f8fafc"]');
        headLights.forEach(hl => {
            hl.classList.remove('animate-headlight-flash');
            void hl.offsetWidth;
            hl.classList.add('animate-headlight-flash');
        });

        const endTId = setTimeout(() => {
            const cone = chassisStage?.querySelector('.headlight-cone');
            if (cone) cone.remove();
            const rearGlow = chassisStage?.querySelector('.rear-stop-glow');
            if (rearGlow) rearGlow.remove();
            stopLights.forEach(sl => sl.classList.remove('animate-rear-stop-flash'));
            headLights.forEach(hl => hl.classList.remove('animate-headlight-flash'));
            isChassisAnimating = false;
        }, 1800);
        chassisTimeoutIds.push(endTId);

    } else if (mode === 2) {
        // MODO 2: Ralentí Mecánico / Acelerón en Neutro ~2.2s
        playEngineIdleSound();

        // Chasis: añade .animate-chassis-idle durante 2.2s
        if (wrapper) {
            wrapper.classList.remove('animate-chassis-idle');
            void wrapper.offsetWidth;
            wrapper.classList.add('animate-chassis-idle');
        }

        // 3 bocanadas sutiles de humo espaciadas
        if (smokeContainer) {
            smokeContainer.innerHTML = '';
            [200, 850, 1500].forEach((delay, idx) => {
                const tId = setTimeout(() => {
                    if (!smokeContainer.isConnected) return;
                    const smoke = document.createElement('div');
                    smoke.className = 'exhaust-smoke';
                    const size = 12 + idx * 3;
                    smoke.style.width = `${size}px`;
                    smoke.style.height = `${size}px`;
                    smoke.style.right = `${18 + idx * 4}%`;
                    smoke.style.bottom = `${22 + idx * 2}%`;
                    smoke.style.opacity = '0.5';
                    smokeContainer.appendChild(smoke);
                    setTimeout(() => smoke.remove(), 800);
                }, delay);
                chassisTimeoutIds.push(tId);
            });
        }

        const endTId = setTimeout(() => {
            if (wrapper) wrapper.classList.remove('animate-chassis-idle');
            if (smokeContainer) smokeContainer.innerHTML = '';
            isChassisAnimating = false;
        }, 2200);
        chassisTimeoutIds.push(endTId);
    }
}

// Odometer roulette state tracking
let drumCascadeIntervals = [];
let drumCascadeTimeouts = [];

function clearDrumCascade() {
    drumCascadeIntervals.forEach(clearInterval);
    drumCascadeIntervals = [];
    drumCascadeTimeouts.forEach(clearTimeout);
    drumCascadeTimeouts = [];
}

/**
 * Triggers mechanical roulette cascade on odometer drums:
 * - 6 drums spin rapidly changing numbers (0-9) every 45ms.
 * - Cascade stops sequentially:
 *   * Tambor 0: 350ms
 *   * Tambor 1: 490ms
 *   * Tambor 2: 630ms
 *   * Tambor 3: 770ms
 *   * Tambor 4: 910ms
 *   * Tambor 5: 1050ms
 * - On locking into true digit:
 *   * Displays true digit
 *   * Applies .animate-drum-settle for mechanical bounce
 *   * Emits playHorologyTick with increasing frequency (800 + idx * 70)
 */
function triggerDrumCascade() {
    if (!currentContainer) return;
    const rollers = currentContainer.querySelectorAll('.drum-digit');
    if (!rollers || rollers.length === 0) return;

    // Handle re-entry: clean existing intervals and timeouts
    clearDrumCascade();

    // Get current odometer reading formatted as 6-digit zero-padded string
    const activeTankState = cockpitState.model?.activeTankState;
    const latestOdo = Math.max(
        Number(activeTankState?.liveOdometer) || 0,
        Number(activeTankState?.latest?.odometer_reading) || 0,
        Number(cockpitState.vehicleProfile?.gpsCache?.live?.totalMile) || 0,
        (cockpitState.logs && cockpitState.logs.length > 0 ? Number(cockpitState.logs[cockpitState.logs.length - 1]?.odometer_reading) || 0 : 0)
    );
    const val = Math.round(Number(latestOdo) || 0);
    const targetStr = String(val).padStart(6, '0');

    const stopTimes = [350, 490, 630, 770, 910, 1050];

    rollers.forEach((drum, idx) => {
        if (idx >= 6) return;
        const span = drum.querySelector('span');
        if (!span) return;

        drum.classList.remove('animate-drum-settle', 'animate-drum-roll');

        // Fast random rolling every 45ms
        const intervalId = setInterval(() => {
            span.innerText = Math.floor(Math.random() * 10);
        }, 45);
        drumCascadeIntervals.push(intervalId);

        // Schedule sequential stop
        const stopTime = stopTimes[idx] ?? (350 + idx * 140);
        const timeoutId = setTimeout(() => {
            clearInterval(intervalId);
            span.innerText = targetStr[idx] ?? '0';

            drum.classList.remove('animate-drum-settle');
            void drum.offsetWidth;
            drum.classList.add('animate-drum-settle');

            playHorologyTick(800 + idx * 70, 0.016, 0.035);
        }, stopTime);
        drumCascadeTimeouts.push(timeoutId);
    });
}

async function handleJsonImportFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const parsed = JSON.parse(e.target.result);
            let arr = Array.isArray(parsed) ? parsed : (parsed.telemetry_logs || parsed.records || []);
            if (arr.length > 0) {
                try {
                    localStorage.setItem('octane_kinetic_v1', JSON.stringify(arr));
                } catch {}
                
                try {
                    await bulkAddTelemetryLogs(arr);
                } catch {}

                if (store) store.setState({ telemetryLogs: arr });
                cockpitState.logs = arr;
                showToast(`SYNC: ${arr.length} LECTURAS`);
                refreshCockpit();
                window.dispatchEvent(new CustomEvent('octane:logs-updated', { detail: { logs: arr } }));
            } else {
                showToast('COPIA VACÍA');
            }
        } catch {
            showToast('ERROR AL LEER ARCHIVO');
        }
    };
    reader.readAsText(file);
}

/**
 * Sets up global custom event listeners once for synchronization.
 */
function setupGlobalEvents() {
    if (boundListeners.length > 0) return;
    clearGlobalEvents();

    if (store && typeof store.subscribe === 'function') {
        storeUnsubscribe = store.subscribe((state, prevState) => {
            let needsRefresh = false;

            if (state.telemetryLogs !== prevState.telemetryLogs && Array.isArray(state.telemetryLogs)) {
                cockpitState.logs = state.telemetryLogs;
                needsRefresh = true;
            }
            if (state.vehicleProfile !== prevState.vehicleProfile && state.vehicleProfile) {
                cockpitState.vehicleProfile = { ...cockpitState.vehicleProfile, ...state.vehicleProfile };
                needsRefresh = true;
            }
            if (state.scopeFilter && state.scopeFilter !== cockpitState.scope) {
                cockpitState.scope = state.scopeFilter;
                needsRefresh = true;
            }
            if (state.currentUnit && state.currentUnit !== cockpitState.unit) {
                cockpitState.unit = state.currentUnit;
                needsRefresh = true;
            }
            if (state.fuelPriceCop && state.fuelPriceCop !== cockpitState.fuelPriceCop) {
                cockpitState.fuelPriceCop = state.fuelPriceCop;
                needsRefresh = true;
            }

            if (needsRefresh) {
                refreshCockpit();
            }
        });
    }

    const onHeaderChange = (e) => {
        const { key, value } = e.detail;
        if (key === 'scope') cockpitState.scope = value;
        if (key === 'unit') cockpitState.unit = value;
        if (key === 'fuelPriceCop') cockpitState.fuelPriceCop = Number(value);
        refreshCockpit();
    };

    const onLogsUpdated = (e) => {
        if (e.detail && Array.isArray(e.detail.logs)) {
            cockpitState.logs = e.detail.logs;
            refreshCockpit();
        }
    };

    const onProfileUpdated = (e) => {
        if (e.detail && e.detail.vehicleProfile) {
            cockpitState.vehicleProfile = { ...cockpitState.vehicleProfile, ...e.detail.vehicleProfile };
            refreshCockpit();
        }
    };

    const onAlertsUpdated = (e) => {
        const slot = currentContainer?.querySelector('#cockpit-alerts-slot');
        if (slot && e.detail?.alerts) {
            slot.innerHTML = renderAlertsBadgeHtml(e.detail.alerts);
            const pill = slot.querySelector('#cockpit-alerts-pill');
            if (pill) {
                pill.addEventListener('click', () => {
                    playHorologyTick(1200, 0.015, 0.03);
                    const targetView = (e.detail.alerts.topAlert?.category === 'maintenance') ? 'cluster' : 'glovebox';
                    window.dispatchEvent(new CustomEvent('octane:navigate', { detail: { view: targetView } }));
                });
            }
        }
    };

    window.addEventListener('octane:header-change', onHeaderChange);
    window.addEventListener('octane:logs-updated', onLogsUpdated);
    window.addEventListener('octane:profile-updated', onProfileUpdated);
    window.addEventListener('octane:alerts-updated', onAlertsUpdated);

    boundListeners.push(
        { type: 'octane:header-change', fn: onHeaderChange },
        { type: 'octane:logs-updated', fn: onLogsUpdated },
        { type: 'octane:profile-updated', fn: onProfileUpdated },
        { type: 'octane:alerts-updated', fn: onAlertsUpdated }
    );
}

function clearGlobalEvents() {
    if (storeUnsubscribe) {
        storeUnsubscribe();
        storeUnsubscribe = null;
    }
    boundListeners.forEach(({ type, fn }) => {
        window.removeEventListener(type, fn);
    });
    boundListeners = [];
}

/**
 * Refreshes the cockpit view with current state.
 */
export function refreshCockpit() {
    if (currentContainer) {
        renderCockpit(currentContainer, {
            logs: cockpitState.logs,
            vehicleProfile: cockpitState.vehicleProfile,
            scope: cockpitState.scope,
            unit: cockpitState.unit,
            fuelPriceCop: cockpitState.fuelPriceCop
        });
    }
}

/**
 * Tears down and cleans up resources.
 */
export function destroyCockpit() {
    chassisTapTimestamps = [];
    clearChassisAnimation();
    clearDrumCascade();
    closeKpiDetailModal();
    if (animFrameId) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
    }
    clearGlobalEvents();
    if (currentContainer) {
        currentContainer.innerHTML = '';
        currentContainer = null;
    }
}
