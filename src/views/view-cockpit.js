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

import {
    calculateTelemetryModel,
    formatEff,
    formatVol,
    formatDateShort,
    playHorologyTick,
    GAL_TO_L,
    DEFAULT_TANK_CAPACITY_GAL,
    DEFAULT_RESERVE_GAL
} from '../core/telemetry-engine.js';

import { getVehicleModel } from '../assets/vehicles-svg/catalog.js';
import { getInlineVehicleSvg } from '../assets/vehicles-svg/models-inline.js';
import store from '../core/state.js';
import { deleteTelemetryLog, bulkAddTelemetryLogs } from '../core/db-local.js';
import { getActiveAlerts, renderAlertsBadgeHtml } from '../core/alerts-engine.js';

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
    model: null
};

// Canvas animation handle & state
let animFrameId = null;
let currentContainer = null;
let boundListeners = [];
let storeUnsubscribe = null;

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
    return getInlineVehicleSvg(modelId, colorHex);
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
    return str.split('').map(d => `
        <div class="relative w-8 sm:w-10 md:w-12 h-12 sm:h-14 md:h-16 bg-[var(--bg-void)] border border-[var(--line-strong)] flex items-center justify-center font-mono text-2xl sm:text-3xl md:text-4xl font-medium tabular-nums text-[var(--text-primary)] overflow-hidden shadow-inner select-none">
            <div class="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[1px] bg-white/10 pointer-events-none"></div>
            <div class="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/40 pointer-events-none"></div>
            <span class="relative z-10">${d}</span>
        </div>
    `).join('');
}

/**
 * Returns the price per gallon from the most recent refuel, or default.
 */
function getLastRefuelPrice(logs, defaultPrice) {
    if (!Array.isArray(logs) || logs.length === 0) return defaultPrice;
    for (let i = logs.length - 1; i >= 0; i--) {
        const l = logs[i];
        if ((l.refuels_count > 0 || l.is_full_tank || l.isFullTank) && Number(l.gallons_added) > 0 && Number(l.total_cost_cop) > 0) {
            const p = Math.round(Number(l.total_cost_cop) / Number(l.gallons_added));
            if (p > 5000 && p < 45000) return p;
        }
    }
    return defaultPrice;
}

/**
 * Computes fuel expenditure for the current month vs previous month.
 */
function getMonthlyFuelStats(logs, priceCop) {
    if (!Array.isArray(logs) || logs.length === 0) {
        return { currentMonthSpent: 0, prevMonthSpent: 0, diffPct: null };
    }
    const now = new Date();
    const curYear = now.getFullYear();
    const curMonth = String(now.getMonth() + 1).padStart(2, '0');
    const curKey = `${curYear}-${curMonth}`;

    const prevDate = new Date(curYear, now.getMonth() - 1, 1);
    const prevKey = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

    let currentMonthSpent = 0;
    let prevMonthSpent = 0;

    logs.forEach(l => {
        if (!l.date) return;
        const cost = Number(l.total_cost_cop) || (Number(l.gallons_added) > 0 ? Math.round(Number(l.gallons_added) * priceCop) : 0);
        if (l.date.startsWith(curKey)) {
            currentMonthSpent += cost;
        } else if (l.date.startsWith(prevKey)) {
            prevMonthSpent += cost;
        }
    });

    let diffPct = null;
    if (prevMonthSpent > 0) {
        diffPct = Math.round(((currentMonthSpent - prevMonthSpent) / prevMonthSpent) * 100);
    }

    return { currentMonthSpent, prevMonthSpent, diffPct };
}

/**
 * Renders the Full Cockpit with All 4 Stages + Compact Chassis Band.
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
    const fullEraCycles = model?.fullEraCycles || [];
    const profile = getVehicleModel(vehicleProfile.svgModel || vehicleProfile.id);

    const latestOdo = activeTankState?.latest?.odometer_reading || 0;
    const autonomy = hasData ? (activeTankState?.autonomyKm || 0) : 0;
    const activeGal = hasData ? (activeTankState?.activeGal || 0) : 0;
    const activePct = hasData ? (activeTankState?.activePct || 0) : 0;
    const kmDriven = hasData ? (activeTankState?.kmDriven || 0) : 0;
    const isReserve = hasData ? (activeTankState?.isReserve || false) : false;

    const lastRefuelPrice = getLastRefuelPrice(cockpitState.logs, vehicleProfile.fuelPriceCop || cockpitState.fuelPriceCop || 16000);
    const monthlyStats = getMonthlyFuelStats(cockpitState.logs, lastRefuelPrice);

    // Initialize fluid level target
    fluidPhysics.targetPct = activePct;
    fluidPhysics.basePct = activePct;

    const activeAlerts = getActiveAlerts();

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

    container.innerHTML = `
        ${zeroStripHtml}
        <div class="max-w-5xl mx-auto px-4 pt-6 pb-24 md:pb-16 space-y-6 relative z-10">

            <!-- =================================================================
                 BLOCK 00: COMPACT CHASSIS TELEMETRY BAND (h-28)
                 ================================================================= -->
            <section class="flat-frame bg-[var(--bg-surface)] border border-[var(--line-hair)] grid grid-cols-12 divide-y sm:divide-y-0 sm:divide-x divide-[var(--line-hair)] overflow-hidden">
                <!-- Left (4 cols) -->
                <div class="col-span-12 sm:col-span-4 p-4 flex flex-col justify-between h-28">
                    <div class="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">CHASIS</div>
                    <div>
                        <h1 class="font-sans font-light text-2xl tracking-tight text-[var(--text-primary)] leading-none">${profile.name.toUpperCase()}</h1>
                        <div class="font-mono text-[10px] text-[var(--text-secondary)] tracking-widest uppercase mt-1">
                            ${profile.tankCapacityLiters.toFixed(1)}L (${profile.tankCapacityGallons}G) · MANUAL
                        </div>
                    </div>
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-2">
                            <span class="w-1.5 h-1.5 rounded-full ${isReserve ? 'bg-[var(--accent-crimson)]' : 'bg-[var(--accent-volt)]'}"></span>
                            <span class="font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">${isReserve ? 'RESERVA' : 'NOMINAL'}</span>
                        </div>
                    </div>
                </div>

                <!-- Right (8 cols): CAD Engineering Blueprint with Live Vehicle Paint strictly contained -->
                <div class="col-span-12 sm:col-span-8 relative bg-[var(--bg-void)] h-28 flex items-center justify-center overflow-hidden p-2" style="--car-paint: ${vehicleProfile.vehicleColor || '#FF5500'}">
                    <div class="max-h-28 w-auto mx-auto object-contain overflow-hidden flex items-center justify-center [&>svg]:max-h-24 [&>svg]:w-auto [&>svg]:object-contain">
                        ${renderInlineCadSvg(vehicleProfile.svgModel || profile.svgModel || profile.id, vehicleProfile.vehicleColor || '#FF5500')}
                    </div>
                </div>
            </section>

            <!-- =================================================================
                 STAGE 01: SIGHT-GLASS CANVAS + TIME-WARP + 2x2 ARCHITECTURAL MATRIX
                 ================================================================= -->
            <section id="stage-chamber" class="flat-frame grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-[var(--line-hair)]">
                
                <!-- LEFT (7 COLS): OPTICAL FLUID SIGHT-GLASS & MECHANICAL ODOMETER -->
                <div class="lg:col-span-7 p-5 sm:p-7 flex flex-col justify-between">
                    
                    <!-- Top Technical Header -->
                    <div class="w-full flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">
                        <span class="flex items-center gap-2">
                            <span id="chamber-pulse-dot" class="w-1.5 h-1.5 rounded-full ${isReserve ? 'bg-[var(--accent-crimson)]' : 'bg-[var(--accent-amber)]'}"></span>
                            <span id="chamber-cycle-tag">CICLO #${fullEraCycles.length + 1} · +${kmDriven} KM</span>
                        </span>
                        <span id="chamber-needle-delta" class="tabular-nums">
                            ${hasData ? `FÍSICO ${activePct.toFixed(0)}% · AGUJA ${(activeTankState?.latest?.fuel_level_percent || 0).toFixed(0)}%` : '0% · CALIBRADO'}
                        </span>
                    </div>

                    <!-- Optical Depth-of-Field Liquid Canvas -->
                    <div class="relative w-full max-w-[300px] aspect-square mx-auto my-4 flex items-center justify-center">
                        <canvas id="liquid-chamber-canvas" class="w-full h-full cursor-pointer touch-pan-y"></canvas>

                        <!-- Readout inside Sight-Glass (Silencio Verbal: Zero <p> tags) -->
                        <div class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                            <span id="chamber-top-label" class="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">AUTONOMÍA</span>
                            <div class="flex items-baseline justify-center mt-0.5">
                                <span id="chamber-hero-km" class="font-sans font-light text-5xl sm:text-6xl tracking-tighter tabular-nums text-[var(--text-primary)] leading-none">${autonomy}</span>
                                <span class="font-mono text-xs font-medium text-[var(--accent-amber)] ml-1.5">KM</span>
                            </div>
                            <div id="chamber-sub-vol" class="font-mono text-[11px] font-medium tabular-nums text-[var(--text-primary)] mt-1.5">
                                ${activeGal.toFixed(2)} GAL  ·  ${(activeGal * GAL_TO_L).toFixed(1)} L
                            </div>
                            <div id="chamber-reserve-tag" class="font-mono text-[10px] text-[var(--text-secondary)] mt-1 tracking-widest uppercase">
                                ${hasData ? (activeTankState?.reserveKm > 0 ? `${activeTankState.reserveKm} KM A RESERVA` : 'EN RESERVA') : 'RESERVA 5.0L'}
                            </div>
                        </div>
                    </div>

                    <!-- Split-Roller / Drum Counter Mechanical Odometer (Protagonista debajo del lente) -->
                    <div class="w-full pt-4 border-t border-[var(--line-hair)] select-none">
                        <div class="flex items-center justify-between mb-2">
                            <span class="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">KILOMETRAJE ACTUAL</span>
                            <span class="font-mono text-[10px] text-[var(--accent-volt)] uppercase tracking-wider tabular-nums">
                                ${hasData && model?.stats?.avgKmPerDay ? `${model.stats.avgKmPerDay} KM/DÍA` : '— KM/DÍA'}
                            </span>
                        </div>
                        <div class="flex items-center justify-center gap-1 sm:gap-1.5 py-3">
                            ${renderDrumOdometer(latestOdo)}
                            <span class="font-mono text-sm font-semibold text-[var(--accent-amber)] ml-1">KM</span>
                        </div>
                    </div>
                </div>

                <!-- RIGHT (5 COLS): 2x2 SWISS ARCHITECTURAL KPI MATRIX -->
                <div class="lg:col-span-5 grid grid-cols-2 divide-x divide-y divide-[var(--line-hair)]">
                    
                    <!-- KPI 1: RENDIMIENTO REAL -->
                    <div class="flat-cell p-5 sm:p-6 flex flex-col justify-between min-h-[170px] lg:min-h-[200px]">
                        <div class="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">
                            <span>RENDIMIENTO</span>
                            <span class="w-1.5 h-1.5 rounded-full bg-[var(--accent-volt)]"></span>
                        </div>
                        <div class="my-3">
                            <div id="kpi-eff-num" class="font-sans font-light text-5xl sm:text-6xl tracking-tighter tabular-nums text-[var(--text-primary)] leading-none">
                                ${hasData ? formatEff(fullEraAvgEff, unit, false) : '—'}
                            </div>
                            <div id="kpi-eff-unit" class="font-mono text-[11px] font-medium tabular-nums text-[var(--accent-volt)] uppercase tracking-widest mt-2">
                                ${unit === 'gal' ? 'KM / GAL' : (unit === 'l100' ? 'L / 100 KM' : 'KM / LITRO')}
                            </div>
                        </div>
                        <div class="flex items-center justify-between font-mono text-[11px] font-medium tabular-nums text-[var(--text-secondary)] pt-2.5 border-t border-[var(--line-hair)]">
                            <span id="kpi-eff-alt1">${hasData && fullEraAvgEff > 0 ? (378.541 / fullEraAvgEff).toFixed(1) + ' L/100' : '— L/100'}</span>
                            <span id="kpi-eff-alt2">${hasData && fullEraAvgEff > 0 ? (fullEraAvgEff / GAL_TO_L).toFixed(1) + ' KM/L' : '— KM/L'}</span>
                        </div>
                    </div>

                    <!-- KPI 2: COSTO POR KM -->
                    <div class="flat-cell p-5 sm:p-6 flex flex-col justify-between min-h-[170px] lg:min-h-[200px]">
                        <div class="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">
                            <span>COSTO POR KM</span>
                            <span class="text-[var(--accent-amber)]">$</span>
                        </div>
                        <div class="my-3">
                            <div id="kpi-cost-km" class="font-sans font-light text-5xl sm:text-6xl tracking-tighter tabular-nums text-[var(--text-primary)] leading-none">
                                ${hasData && fullEraAvgEff > 0 ? '$' + Math.round((1 / fullEraAvgEff) * lastRefuelPrice).toLocaleString('es-CO') : '—'}
                            </div>
                            <div class="font-mono text-[11px] font-medium tabular-nums text-[var(--accent-amber)] uppercase tracking-widest mt-2">COP / KM</div>
                        </div>
                        <div class="flex items-center justify-between font-mono text-[11px] font-medium tabular-nums text-[var(--text-secondary)] pt-2.5 border-t border-[var(--line-hair)]">
                            <span>ÚLTIMO TANQUEO</span>
                            <strong id="kpi-full-price" class="font-mono text-[11px] font-medium tabular-nums text-[var(--text-primary)]">
                                $${Math.round(lastRefuelPrice).toLocaleString('es-CO')}/G
                            </strong>
                        </div>
                    </div>

                    <!-- KPI 3: AUTONOMÍA TANQUE LLENO -->
                    <div class="flat-cell p-5 sm:p-6 flex flex-col justify-between min-h-[170px] lg:min-h-[200px]">
                        <div class="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">
                            <span>AUTONOMÍA FULL</span>
                            <span class="text-[var(--text-secondary)]">MAX</span>
                        </div>
                        <div class="my-3">
                            <div id="kpi-tank-max" class="font-sans font-light text-5xl sm:text-6xl tracking-tighter tabular-nums text-[var(--text-primary)] leading-none">
                                ${hasData && fullEraAvgEff > 0 ? Math.round(profile.tankCapacityGallons * fullEraAvgEff) : '—'}
                            </div>
                            <div class="font-mono text-[11px] font-medium tabular-nums text-[var(--text-secondary)] uppercase tracking-widest mt-2">KM / FULL</div>
                        </div>
                        <div class="flex items-center justify-between font-mono text-[11px] font-medium tabular-nums text-[var(--text-secondary)] pt-2.5 border-t border-[var(--line-hair)]">
                            <span>SIN RESERVA</span>
                            <strong id="kpi-tank-safe" class="font-mono text-[11px] font-medium tabular-nums text-[var(--text-primary)]">
                                ${hasData && fullEraAvgEff > 0 ? Math.round((profile.tankCapacityGallons - (profile.reserveLiters * (1 / GAL_TO_L))) * fullEraAvgEff) + ' KM' : '—'}
                            </strong>
                        </div>
                    </div>

                    <!-- KPI 4: GASTO COMBUSTIBLE MES -->
                    <div class="flat-cell p-5 sm:p-6 flex flex-col justify-between min-h-[170px] lg:min-h-[200px]">
                        <div class="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">
                            <span>GASTO MES</span>
                            <span class="text-[var(--accent-volt)]">MES</span>
                        </div>
                        <div class="my-3">
                            <div id="kpi-monthly-spent" class="font-sans font-light text-5xl sm:text-6xl tracking-tighter tabular-nums text-[var(--text-primary)] leading-none">
                                ${hasData && monthlyStats.currentMonthSpent > 0 ? '$' + Math.round(monthlyStats.currentMonthSpent / 1000).toLocaleString('es-CO') + 'K' : (hasData ? '$0' : '—')}
                            </div>
                            <div class="font-mono text-[11px] font-medium tabular-nums text-[var(--accent-volt)] uppercase tracking-widest mt-2">COP MES ACTUAL</div>
                        </div>
                        <div class="flex items-center justify-between font-mono text-[11px] font-medium tabular-nums text-[var(--text-secondary)] pt-2.5 border-t border-[var(--line-hair)]">
                            <span>VS MES ANTERIOR</span>
                            <strong id="kpi-month-diff" class="font-mono text-[11px] font-medium tabular-nums ${monthlyStats.diffPct !== null && monthlyStats.diffPct > 0 ? 'text-[var(--accent-amber)]' : 'text-[var(--accent-volt)]'}">
                                ${monthlyStats.diffPct !== null ? `${monthlyStats.diffPct >= 0 ? '+' : ''}${monthlyStats.diffPct}%` : (hasData && monthlyStats.prevMonthSpent > 0 ? '$' + Math.round(monthlyStats.prevMonthSpent / 1000) + 'K' : '—')}
                            </strong>
                        </div>
                    </div>

                </div>
            </section>

            <!-- =================================================================
                 STAGE 02: THE MONOLITHS (CICLOS DE CONSUMO)
                 ================================================================= -->
            <section id="stage-monoliths" class="flat-frame p-5 sm:p-7 space-y-5">
                <div class="flex flex-wrap items-end justify-between gap-3 pb-4 border-b border-[var(--line-hair)]">
                    <div>
                        <div class="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">CICLOS DE CONSUMO</div>
                        <h2 id="monolith-title" class="font-sans font-light text-2xl tracking-tight text-[var(--text-primary)] mt-0.5">
                            RENDIMIENTO POR CICLO
                        </h2>
                    </div>

                    <!-- Flat Telemetry Readout Strip -->
                    <div id="monolith-hud" class="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
                        <span id="mono-stat-eff" class="px-2.5 py-1 rounded-sm flat-pill-active font-medium tabular-nums">${hasData && fullEraAvgEff > 0 ? formatEff(fullEraAvgEff, unit, true) : '— KM/GAL'}</span>
                        <span id="mono-stat-km" class="px-2.5 py-1 rounded-sm flat-pill tabular-nums">+${(model?.stats?.totalKm || 0).toLocaleString()} KM</span>
                        <span id="mono-stat-vol" class="px-2.5 py-1 rounded-sm flat-pill tabular-nums">${formatVol(model?.stats?.totalGallons || 0, unit, true)}</span>
                        <span id="mono-stat-cost" class="px-2.5 py-1 rounded-sm flat-pill text-[var(--accent-amber)] tabular-nums">$${Math.round((model?.stats?.totalCostCop || 0) / 1000)}K</span>
                    </div>
                </div>

                <!-- Architectural Columns Grid -->
                <div id="monoliths-container" class="grid grid-cols-4 sm:grid-cols-8 gap-2">
                    <!-- Populated dynamically -->
                </div>

                <!-- Benchmark Hairline Strip -->
                <div class="grid grid-cols-3 divide-x divide-[var(--line-hair)] border border-[var(--line-hair)] bg-[var(--bg-void)] font-mono text-[10px]">
                    <div class="py-2.5 px-3 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                        <span class="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">MÍNIMO</span>
                        <strong id="bench-min" class="font-mono text-[11px] font-medium text-[var(--text-primary)] tabular-nums">—</strong>
                    </div>
                    <div class="py-2.5 px-3 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                        <span class="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">MEDIA REAL</span>
                        <strong id="bench-avg" class="font-mono text-[11px] font-medium text-[var(--accent-volt)] tabular-nums">${hasData && fullEraAvgEff > 0 ? formatEff(fullEraAvgEff, unit, true) : '—'}</strong>
                    </div>
                    <div class="py-2.5 px-3 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                        <span class="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">RÉCORD</span>
                        <strong id="bench-max" class="font-mono text-[11px] font-medium text-[var(--accent-amber)] tabular-nums">—</strong>
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
            <section id="stage-horizon" class="flat-frame p-5 sm:p-7 space-y-5">
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
                <div class="p-4 bg-[var(--bg-void)] border border-[var(--line-hair)] border-l-2 border-l-[var(--accent-amber)] flex flex-wrap items-center justify-between gap-4">
                    <div class="flex items-center gap-3.5">
                        <div id="synth-date-badge" class="font-sans font-light text-2xl sm:text-3xl tracking-tight tabular-nums">
                            --
                        </div>
                        <div class="border-l border-[var(--line-hair)] pl-3.5">
                            <div id="synth-odo-badge" class="font-mono text-xs font-medium text-[var(--text-primary)] tabular-nums">-- KM</div>
                            <div id="synth-refuel-tag" class="font-mono text-[10px] text-[var(--accent-amber)] uppercase tracking-wider">RODAJE</div>
                        </div>
                    </div>

                    <div class="flex items-center gap-5 sm:gap-8 font-mono">
                        <div>
                            <span class="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)] block">RECORRIDO</span>
                            <strong id="synth-km-val" class="font-mono text-[11px] font-medium tabular-nums">-- KM</strong>
                        </div>
                        <div>
                            <span class="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)] block">CONSUMO</span>
                            <strong id="synth-fuel-val" class="font-mono text-[11px] font-medium text-[var(--accent-volt)] tabular-nums">-- GAL</strong>
                        </div>
                        <div>
                            <span class="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)] block">COSTO</span>
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

    function triggerRipple() {
        disturbFluid(0.9);
        playHorologyTick(680, 0.015, 0.02);
    }

    canvas.onpointerdown = triggerRipple;
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

    const safeEff = fullEraAvgEff > 0 ? fullEraAvgEff : 33.71;
    const burnedSimGal = warpKm / safeEff;
    const remGal = Math.max(0, (activeTankState.activeGal || 0) - burnedSimGal);
    const remPct = tankMaxGal > 0 ? (remGal / tankMaxGal) * 100 : 0;
    fluidPhysics.targetPct = remPct;

    const remRangeKm = Math.round(remGal * safeEff);
    const remReserveKm = Math.max(0, Math.round(Math.max(0, remGal - reserveGal) * safeEff));

    const topLbl = document.getElementById('chamber-top-label');
    const heroKm = document.getElementById('chamber-hero-km');
    const subVol = document.getElementById('chamber-sub-vol');
    const rsvTag = document.getElementById('chamber-reserve-tag');

    if (topLbl) topLbl.innerText = warpKm > 0 ? `TRAS +${warpKm} KM` : 'AUTONOMÍA';
    if (heroKm) heroKm.innerText = remRangeKm;
    if (subVol) subVol.innerText = `${remGal.toFixed(2)} GAL  ·  ${(remGal * GAL_TO_L).toFixed(1)} L`;
    if (rsvTag) {
        rsvTag.innerText = remReserveKm > 0
            ? `${remReserveKm} KM A RESERVA`
            : (remGal > 0 ? 'EN RESERVA' : 'RESERVA 5.0L');
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
 * Stage 02: Los Monolitos Rendering.
 */
function renderMonolithsStage() {
    const container = document.getElementById('monoliths-container');
    if (!container) return;
    container.innerHTML = '';

    const { model, unit } = cockpitState;
    const cycles = model?.fullEraCycles || [];
    const activeState = model?.activeTankState;

    if (cycles.length === 0) {
        // Render 8 silent placeholder columns
        for (let i = 1; i <= 8; i++) {
            const col = document.createElement('div');
            col.className = 'monolith-bar rounded-sm p-3 h-44 flex flex-col justify-between opacity-40';
            col.innerHTML = `
                <div class="flex items-center justify-between font-mono text-[10px]">
                    <span class="font-medium text-[var(--text-secondary)]">0${i}</span>
                    <span class="text-[9px] text-[var(--text-muted)]">—</span>
                </div>
                <div class="relative flex-1 flex items-end my-2 bg-[var(--bg-void)] p-1">
                    <div class="w-full bg-[var(--line-strong)]" style="height: 4%"></div>
                </div>
                <div class="leading-tight">
                    <div class="font-sans font-light text-base tracking-tight tabular-nums">—</div>
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

        const col = document.createElement('div');
        col.className = `monolith-bar rounded-sm p-3 h-44 flex flex-col justify-between ${isSelected ? 'active' : ''}`;
        col.onclick = () => {
            playHorologyTick(1100, 0.016, 0.03);
            cockpitState.selectedCycleIdx = cockpitState.selectedCycleIdx === c.cycleIndex ? null : c.cycleIndex;
            disturbFluid(0.5);
            renderMonolithsStage();
            updateMonolithSpotlight();
            renderCycleDetail();
        };

        col.innerHTML = `
            <div class="flex items-center justify-between font-mono text-[10px]">
                <span class="font-medium text-[var(--text-secondary)]">0${c.cycleIndex}</span>
                <span class="text-[9px] text-[var(--text-muted)]">${formatDateShort(c.endDate).split(' ')[0]}</span>
            </div>

            <div class="relative flex-1 flex items-end my-2 bg-[var(--bg-void)] p-1">
                <div class="w-full transition-all duration-300 ${barFill}" style="height: ${heightPct}%"></div>
            </div>

            <div class="leading-tight">
                <div class="font-sans font-normal text-base sm:text-lg tracking-tight tabular-nums">${formatEff(c.eff, unit, false)}</div>
                <div class="font-mono text-[9px] text-[var(--text-secondary)] tabular-nums mt-0.5">+${c.dist} KM</div>
            </div>
        `;
        container.appendChild(col);
    });

    // Active Live Column
    if (activeState && cockpitState.logs.length > 0) {
        const liveCol = document.createElement('div');
        liveCol.className = `monolith-bar rounded-sm p-3 h-44 flex flex-col justify-between border-dashed border-[var(--line-strong)]`;
        liveCol.onclick = () => {
            playHorologyTick(950, 0.016, 0.03);
            cockpitState.selectedCycleIdx = null;
            renderMonolithsStage();
            updateMonolithSpotlight();
            renderCycleDetail();
        };
        liveCol.innerHTML = `
            <div class="flex items-center justify-between font-mono text-[10px]">
                <span class="font-medium text-[var(--accent-amber)]">0${cycles.length + 1}</span>
                <span class="w-1.5 h-1.5 rounded-full bg-[var(--accent-amber)] animate-pulse"></span>
            </div>
            <div class="relative flex-1 flex items-end my-2 bg-[var(--bg-void)] p-1">
                <div class="w-full bg-[var(--accent-amber)] opacity-60" style="height: ${activeState.activePct}%"></div>
            </div>
            <div class="leading-tight">
                <div class="font-sans font-normal text-base sm:text-lg text-[var(--accent-amber)] tracking-tight tabular-nums">+${activeState.kmDriven}K</div>
                <div class="font-mono text-[9px] text-[var(--text-secondary)] uppercase mt-0.5">ACTIVO</div>
            </div>
        `;
        container.appendChild(liveCol);
    }

    // Fill remaining slots up to 8 with silent hairline columns (8-column Swiss chassis balance)
    const currentCols = cycles.length + (activeState && cockpitState.logs.length > 0 ? 1 : 0);
    for (let i = currentCols + 1; i <= 8; i++) {
        const col = document.createElement('div');
        col.className = 'monolith-bar rounded-sm p-3 h-44 flex flex-col justify-between opacity-20 hidden sm:flex';
        col.innerHTML = `
            <div class="flex items-center justify-between font-mono text-[10px]">
                <span class="font-medium text-[var(--text-secondary)]">0${i}</span>
                <span class="text-[9px] text-[var(--text-muted)]">—</span>
            </div>
            <div class="relative flex-1 flex items-end my-2 bg-[var(--bg-void)] p-1">
                <div class="w-full bg-[var(--line-strong)]" style="height: 4%"></div>
            </div>
            <div class="leading-tight">
                <div class="font-sans font-light text-base tracking-tight tabular-nums text-[var(--text-secondary)]">—</div>
                <div class="font-mono text-[9px] text-[var(--text-secondary)] tabular-nums mt-0.5">STANDBY</div>
            </div>
        `;
        container.appendChild(col);
    }

    // Benchmark hairlines
    if (cycles.length > 0) {
        const effs = cycles.map(x => x.eff);
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

    if (cockpitState.selectedCycleIdx === null) {
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
        if (titleEl) titleEl.innerText = `CICLO #${c.cycleIndex}  ·  ${formatDateShort(c.startDate)} — ${formatDateShort(c.endDate)}`;
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

    if (dtBadge) dtBadge.innerText = formatDateShort(dayObj.date);
    if (odoBadge) odoBadge.innerText = dayObj.odo ? `${dayObj.odo.toLocaleString()} KM` : 'INTERPOLADO';
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
 * Muestra las lecturas y tanqueadas del ciclo seleccionado o activo.
 */
function renderCycleDetail() {
    const container = document.getElementById('cycle-detail-panel');
    if (!container) return;

    const { model, unit, fuelPriceCop } = cockpitState;
    const cycles = model?.fullEraCycles || [];
    const logs = [...(cockpitState.logs || [])].sort((a, b) => (a.date > b.date ? 1 : -1));

    if (logs.length === 0) {
        container.innerHTML = `
            <div class="p-4 text-center font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">
                0 REGISTROS EN ESTE CICLO
            </div>
        `;
        return;
    }

    let cycleTitle = '';
    let cycleLogs = [];

    if (cockpitState.selectedCycleIdx !== null) {
        const c = cycles.find(x => x.cycleIndex === cockpitState.selectedCycleIdx);
        if (c) {
            cycleTitle = `CICLO #${c.cycleIndex} · ${formatDateShort(c.startDate)} — ${formatDateShort(c.endDate)}`;
            cycleLogs = logs.filter(l => l.date >= c.startDate && l.date <= c.endDate);
        }
    }

    if (!cycleTitle) {
        const lastCycle = cycles.length > 0 ? cycles[cycles.length - 1] : null;
        if (lastCycle) {
            cycleTitle = `CICLO ACTIVO #${cycles.length + 1} · DESDE ${formatDateShort(lastCycle.endDate)}`;
            cycleLogs = logs.filter(l => l.date >= lastCycle.endDate);
        } else {
            cycleTitle = `CICLO ACTIVO #1`;
            cycleLogs = logs;
        }
    }

    const displayRows = [...cycleLogs].reverse();

    container.innerHTML = `
        <div class="px-4 py-3 border-b border-[var(--line-hair)] flex items-center justify-between font-mono text-xs">
            <div class="flex items-center gap-2">
                <span class="w-1.5 h-1.5 rounded-full bg-[var(--accent-amber)]"></span>
                <span class="font-semibold text-[var(--text-primary)] uppercase tracking-wider">${cycleTitle}</span>
            </div>
            <span class="text-[10px] text-[var(--text-secondary)] uppercase tracking-widest">${displayRows.length} REGISTROS</span>
        </div>

        <div class="divide-y divide-[var(--line-hair)] max-h-64 overflow-y-auto font-mono text-xs">
            ${displayRows.map(r => {
                const isRefuel = (r.refuels_count > 0 || r.is_full_tank || r.isFullTank || r.gallons_added > 0);
                const cost = r.total_cost_cop || (r.gallons_added > 0 ? Math.round(r.gallons_added * fuelPriceCop) : 0);
                const badge = isRefuel
                    ? `<span class="px-2 py-0.5 rounded-sm text-[10px] font-medium ${r.is_full_tank || r.isFullTank ? 'bg-[var(--accent-volt)]/15 text-[var(--accent-volt)] border border-[var(--accent-volt)]/30' : 'bg-[var(--accent-amber)]/15 text-[var(--accent-amber)] border border-[var(--accent-amber)]/30'}">★ +${Number(r.gallons_added || 0).toFixed(2)} GAL</span>`
                    : `<span class="text-[var(--text-muted)]">—</span>`;

                return `
                    <div class="px-4 py-2.5 flex items-center justify-between gap-2 hover:bg-[var(--bg-elevated)] transition-colors group">
                        <div class="flex items-center gap-3">
                            <span class="font-medium text-[var(--text-primary)] w-14">${formatDateShort(r.date)}</span>
                            <span class="text-[var(--text-secondary)] tabular-nums">${Number(r.odometer_reading).toLocaleString()} KM</span>
                            ${r.distance_km > 0 ? `<span class="text-[var(--accent-volt)] tabular-nums font-medium">+${r.distance_km} KM</span>` : ''}
                        </div>
                        <div class="flex items-center gap-3">
                            ${badge}
                            <span class="tabular-nums w-10 text-right text-[var(--text-secondary)]">${Math.round(r.fuel_level_percent || 0)}%</span>
                            ${cost > 0 ? `<span class="tabular-nums w-16 text-right text-[var(--text-primary)] hidden sm:inline">$${Math.round(cost / 1000)}K</span>` : ''}
                            <div class="flex items-center gap-1">
                                <button type="button" data-edit-date="${r.date}" class="cycle-edit-btn h-6 w-6 rounded-sm border border-[var(--line-hair)] hover:border-[var(--line-strong)] flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--accent-amber)]" title="Editar lectura">
                                    ✎
                                </button>
                                <button type="button" data-delete-date="${r.date}" class="cycle-delete-btn h-6 w-6 rounded-sm border border-[var(--line-hair)] hover:border-[var(--line-strong)] flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--accent-crimson)]" title="Eliminar lectura">
                                    ×
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;

    // Bind Edit & Delete actions
    container.querySelectorAll('.cycle-delete-btn').forEach(btn => {
        btn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const date = btn.dataset.deleteDate;
            deleteLogRecord(date);
        });
    });

    container.querySelectorAll('.cycle-edit-btn').forEach(btn => {
        btn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const date = btn.dataset.editDate;
            const item = cockpitState.logs.find(x => x.date === date);
            if (item) {
                playHorologyTick(1100, 0.015, 0.03);
                if (store) store.setState({ isReadingModalOpen: true, isSyncModalOpen: true });
                window.dispatchEvent(new CustomEvent('octane:edit-log', { detail: { log: item } }));
                window.dispatchEvent(new CustomEvent('octane:open-reading', { detail: { log: item } }));
                window.dispatchEvent(new CustomEvent('octane:open-modal', { detail: { modal: 'reading', log: item } }));
            }
        });
    });
}

async function deleteLogRecord(date) {
    playHorologyTick(600, 0.02, 0.04);
    if (!confirm(`¿Eliminar la lectura del ${formatDateShort(date)}?`)) return;

    cockpitState.logs = cockpitState.logs.filter(x => x.date !== date);
    
    try {
        await deleteTelemetryLog(date);
    } catch {}

    try {
        localStorage.setItem('octane_kinetic_v1', JSON.stringify(cockpitState.logs));
    } catch {}

    if (store && typeof store.setState === 'function') {
        store.setState({ telemetryLogs: cockpitState.logs });
    }

    showToast(`LECTURA ELIMINADA`);
    window.dispatchEvent(new CustomEvent('octane:delete-log', { detail: { date } }));
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
