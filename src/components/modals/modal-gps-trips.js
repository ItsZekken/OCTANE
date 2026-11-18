/**
 * OCTANE // KINETIC — GPS DATA: Inspector de Jornadas & Trayectos ("modal-gps-trips.js")
 * 
 * Experiencia Mobile-First Unificada en 3 Niveles con Navegación Espacial:
 * - Nivel 0 (Días): Macro-valor protagonista, selector de alcance discreto y lista de días con glifo de ruta SVG.
 * - Nivel 1 (Día): El mapa muestra todos los recorridos del día completo; hoja inferior lista los viajes.
 * - Nivel 2 (Viaje): El mismo mapa vuela al viaje enfocado y atenúa el resto; desglose limpio de origen, destino y cifras maestras.
 * 
 * Principios:
 * - Dieter Rams / Teenage Engineering: Cero píldoras ruidosas, cero etiquetas inventadas (sin A/C solar), cero <p>.
 * - Velocidad codificada en el trazo del mapa (lento = ámbar denso, crucero = oro brillante).
 * - Cero latencia (lectura instantánea de la caché por fecha).
 */

import { todayLocalYmd, localYmd } from '../../core/date-utils.js';
import { playHorologyTick, store } from '../../core/state.js';
import { getVehicleProfile } from '../../core/db-local.js';
import { formatDateWithWeekday } from '../../core/telemetry-engine.js';
import {
    fetchGpsCycleTrips,
    getCachedGpsTrips,
    groupTripsByDay,
    computeTripsSummary,
    IOPGPS_INSTALL_DATE
} from '../../core/iopgps-sync.js';
import { createRouteMap } from '../gps/gps-route-map.js';

let modalRootEl = null;
let currentScope = 'cycle'; // 'cycle' | '7days' | 'all'
let scopeCycleStart = '';
let scopeCycleEnd = '';
let currentTrips = [];
let currentDays = [];
let currentSummary = null;
let routeMapController = null;

// Navigation state: 'days' (0) | 'day' (1) | 'trip' (2)
let currentLevel = 'days';
let activeDay = null;
let activeTrip = null;

let isRefreshing = false;
let isLoading = false;

/**
 * Resolves start and end YYYY-MM-DD dates for a given scope.
 */
function resolveScopeDates(scope) {
    const today = todayLocalYmd();

    if (scope === '7days') {
        const d = new Date();
        d.setDate(d.getDate() - 6);
        return { start: localYmd(d), end: today };
    }

    if (scope === 'all') {
        return { start: IOPGPS_INSTALL_DATE || '2026-02-01', end: today };
    }

    // Default 'cycle': active tank cycle
    let start = scopeCycleStart;
    if (!start) {
        try {
            const logs = store.getState()?.telemetryLogs || [];
            for (let i = logs.length - 1; i >= 0; i--) {
                const log = logs[i];
                if (log && (log.is_full_tank || log.isFullTank) && log.date) {
                    start = log.date;
                    break;
                }
            }
            if (!start && logs.length > 0 && logs[0]?.date) {
                start = logs[0].date;
            }
        } catch (_) {}
    }
    if (!start) {
        start = IOPGPS_INSTALL_DATE || '2026-02-01';
    }

    const end = scopeCycleEnd || today;
    return { start, end };
}

/**
 * Formats date into a short, elegant day label (e.g. "Lun 09 nov").
 */
function formatShortDayLabel(dateStr) {
    if (!dateStr) return '';
    try {
        const parts = dateStr.split('-');
        if (parts.length === 3) {
            const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
            const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
            const monthNames = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
            return `${dayNames[d.getDay()]} ${parts[2]} ${monthNames[d.getMonth()]}`;
        }
    } catch (_) {}
    return dateStr;
}

/**
 * Initializes the root DOM container singleton for the modal.
 */
function initModalRoot() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('octane-gps-trips-modal')) {
        modalRootEl = document.getElementById('octane-gps-trips-modal');
        return;
    }

    modalRootEl = document.createElement('div');
    modalRootEl.id = 'octane-gps-trips-modal';
    modalRootEl.className = 'fixed inset-0 z-50 hidden bg-[#09090b] text-[var(--text-primary)] select-none overflow-hidden';
    document.body.appendChild(modalRootEl);

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modalRootEl && !modalRootEl.classList.contains('hidden')) {
            handleBackAction();
        }
    });

    window.addEventListener('popstate', (e) => {
        if (modalRootEl && !modalRootEl.classList.contains('hidden')) {
            handleBackAction(true);
        }
    });
}

/**
 * Handles back navigation across the 3 levels (Level 2 -> Level 1 -> Level 0 -> Close).
 */
function handleBackAction(fromPopState = false) {
    if (currentLevel === 'trip') {
        playHorologyTick(900, 0.01, 0.02);
        currentLevel = 'day';
        activeTrip = null;
        renderLevelDay();
    } else if (currentLevel === 'day') {
        playHorologyTick(850, 0.01, 0.02);
        currentLevel = 'days';
        activeDay = null;
        activeTrip = null;
        if (routeMapController) {
            routeMapController.destroy();
            routeMapController = null;
        }
        renderLevelDays();
    } else {
        closeGpsTripsModal();
    }
}

/**
 * Opens the GPS DATA Inspector.
 * 
 * @param {Object} [options={}] - { initialScope, cycleStartDate, cycleEndDate }
 */
export async function openGpsTripsModal(options = {}) {
    if (typeof document === 'undefined') return;
    initModalRoot();
    if (!modalRootEl) return;

    playHorologyTick(1200, 0.015, 0.03);

    currentScope = options.initialScope || 'cycle';
    scopeCycleStart = options.cycleStartDate || '';
    scopeCycleEnd = options.cycleEndDate || '';
    currentLevel = 'days';
    activeDay = null;
    activeTrip = null;

    modalRootEl.classList.remove('hidden');

    // 1. Instant zero-latency cache load
    const { start, end } = resolveScopeDates(currentScope);
    const profile = await getVehicleProfile().catch(() => null);
    const cached = getCachedGpsTrips(start, end, profile);
    const fuelPriceCop = Number(profile?.fuelPriceCop) || 16000;
    const baseEff = Number(profile?.benchmarkEff) || Number(profile?.defaultEfficiencyKmGal) || 33.71;

    currentTrips = cached;
    currentDays = groupTripsByDay(cached, { fuelPriceCop, baseEff });
    currentSummary = computeTripsSummary(cached, [], { fuelPriceCop, baseEff });

    renderView();

    // 2. Fetch from network only if cache was empty for this range
    if (cached.length === 0) {
        await loadTripsData({ forceRefresh: false });
    }
}

/**
 * Closes and resets the modal.
 */
export function closeGpsTripsModal() {
    if (routeMapController) {
        try { routeMapController.destroy(); } catch (_) {}
        routeMapController = null;
    }
    if (modalRootEl) {
        playHorologyTick(800, 0.01, 0.02);
        modalRootEl.classList.add('hidden');
        modalRootEl.innerHTML = '';
    }
    currentLevel = 'days';
    activeDay = null;
    activeTrip = null;
}

/**
 * Loads trips for the current scope with optional forceRefresh.
 */
async function loadTripsData(opts = {}) {
    if (isLoading || isRefreshing) return;
    const force = Boolean(opts.forceRefresh);

    if (force) {
        isRefreshing = true;
    } else {
        isLoading = true;
    }
    renderHeaderControls();

    try {
        const { start, end } = resolveScopeDates(currentScope);
        const res = await fetchGpsCycleTrips(start, end, { forceRefresh: force });
        const trips = Array.isArray(res?.trips) ? res.trips : [];
        const profile = await getVehicleProfile().catch(() => null);
        const fuelPriceCop = Number(profile?.fuelPriceCop) || 16000;
        const baseEff = Number(profile?.benchmarkEff) || Number(profile?.defaultEfficiencyKmGal) || 33.71;

        currentTrips = trips;
        currentDays = groupTripsByDay(trips, { fuelPriceCop, baseEff });
        currentSummary = res?.summary || computeTripsSummary(trips, [], { fuelPriceCop, baseEff });

        // If currently viewing a specific day, update it
        if (activeDay) {
            activeDay = currentDays.find(d => d.date === activeDay.date) || null;
            if (!activeDay) currentLevel = 'days';
        }
        if (activeTrip && activeDay) {
            activeTrip = activeDay.trips.find(t => t.id === activeTrip.id) || null;
            if (!activeTrip) currentLevel = 'day';
        }
    } catch (err) {
        console.warn('[OCTANE GPS] Error loading trips:', err?.message);
    } finally {
        isLoading = false;
        isRefreshing = false;
        renderView();
    }
}

/**
 * Main render router based on currentLevel ('days' | 'day' | 'trip').
 */
function renderView() {
    if (!modalRootEl) return;

    if (currentLevel === 'days') {
        renderLevelDays();
    } else if (currentLevel === 'day') {
        renderLevelDay();
    } else if (currentLevel === 'trip') {
        renderLevelTrip();
    }
}

/**
 * LEVEL 0: Lista de Días (Mobile-First, Silenciosa, Minimalista)
 */
function renderLevelDays() {
    const totalKm = currentSummary?.totalKm || 0;
    const totalDaysCount = currentDays.length;

    const scopeLabels = {
        cycle: 'CICLO ACTIVO',
        '7days': '7 DÍAS',
        all: 'HISTORIAL COMPLETO'
    };
    const activeScopeText = scopeLabels[currentScope] || 'CICLO ACTIVO';

    modalRootEl.innerHTML = `
        <div class="w-full h-[100dvh] flex flex-col bg-[#09090b] text-[var(--text-primary)] font-mono">
            <!-- Barra Superior Táctica -->
            <div class="px-5 py-3.5 border-b border-[var(--line-hair)] flex items-center justify-between shrink-0">
                <button id="gps-modal-close-btn" class="w-9 h-9 -ml-2 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] active:scale-95 transition-all cursor-pointer" aria-label="Cerrar">
                    <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
                <div class="flex items-center gap-2">
                    <span class="w-2 h-2 rounded-full bg-[var(--accent-volt)] animate-pulse"></span>
                    <span class="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-[var(--text-primary)]">GPS DATA</span>
                </div>
                <button id="gps-modal-refresh-btn" class="w-9 h-9 -mr-2 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] active:scale-95 transition-all cursor-pointer ${isRefreshing ? 'animate-spin text-[var(--accent-amber)]' : ''}" aria-label="Actualizar">
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                </button>
            </div>

            <!-- Macro-Valor Protagonista & Selector de Alcance Discreto -->
            <div class="px-6 pt-6 pb-4 text-center shrink-0 border-b border-[var(--line-hair)] bg-[var(--bg-void)]">
                <div class="font-sans font-light text-5xl sm:text-6xl tracking-tighter tabular-nums text-[var(--text-primary)] leading-none">
                    ${totalKm.toLocaleString('es-CO')} <span class="text-sm font-mono tracking-widest text-[var(--accent-amber)] font-normal uppercase">KM</span>
                </div>
                <!-- Menú Selector de Alcance Discreto (Dropdown) & Ghost Race Launcher -->
                <div class="mt-3 flex items-center justify-center gap-2">
                    <div class="relative inline-block">
                        <button id="gps-scope-trigger" type="button" class="inline-flex items-center gap-1.5 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--line-hair)] rounded-full bg-[var(--bg-elevated)]/30 active:scale-95 transition-all cursor-pointer">
                            <span>${activeScopeText}</span>
                            <span class="text-[var(--accent-amber)] text-[10px]">▾</span>
                        </button>
                        <div id="gps-scope-dropdown" class="hidden absolute top-full left-1/2 -translate-x-1/2 mt-1.5 w-44 bg-[#09090b] border border-[var(--line-strong)] rounded shadow-2xl py-1 z-30 font-mono text-xs">
                            <button data-scope-opt="cycle" class="w-full text-left px-3 py-2 text-[11px] uppercase tracking-wider hover:bg-white/5 ${currentScope === 'cycle' ? 'text-[var(--accent-amber)] font-bold' : 'text-[var(--text-secondary)]'}">Ciclo Activo</button>
                            <button data-scope-opt="7days" class="w-full text-left px-3 py-2 text-[11px] uppercase tracking-wider hover:bg-white/5 ${currentScope === '7days' ? 'text-[var(--accent-amber)] font-bold' : 'text-[var(--text-secondary)]'}">Últimos 7 Días</button>
                            <button data-scope-opt="all" class="w-full text-left px-3 py-2 text-[11px] uppercase tracking-wider hover:bg-white/5 ${currentScope === 'all' ? 'text-[var(--accent-amber)] font-bold' : 'text-[var(--text-secondary)]'}">Historial Completo</button>
                        </div>
                    </div>

                    <a href="/ghost-race.html" target="_blank" class="inline-flex items-center gap-1.5 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-[var(--accent-amber)] hover:text-white border border-[var(--accent-amber)]/40 hover:border-[var(--accent-amber)] rounded-full bg-[var(--accent-amber)]/10 active:scale-95 transition-all cursor-pointer">
                        <span>🏁 GHOST RACE</span>
                    </a>
                </div>
            </div>

            <!-- Lista de Días con Glifo Cartográfico (Mobile First) -->
            <div class="flex-1 overflow-y-auto divide-y divide-[var(--line-hair)] overscroll-contain">
                ${currentDays.length === 0 ? `
                    <div class="px-6 py-16 text-center text-[var(--text-secondary)] text-xs tracking-widest uppercase">
                        ${isLoading ? 'CONSULTANDO TELEMETRÍA GPS...' : 'CERO TRAYECTOS EN ESTE ALCANCE'}
                    </div>
                ` : currentDays.map(day => `
                    <div data-day-date="${day.date}" class="gps-day-row min-h-[64px] px-5 sm:px-6 py-3.5 flex items-center justify-between gap-4 bg-[var(--bg-void)] hover:bg-[var(--bg-elevated)]/30 active:bg-[var(--bg-elevated)]/60 cursor-pointer transition-colors select-none">
                        <!-- Izquierda: Fecha Limpia y Conteo de Trayectos -->
                        <div class="min-w-0 flex-1">
                            <span class="font-mono text-sm font-semibold text-[var(--text-primary)] block">
                                ${formatShortDayLabel(day.date)}
                            </span>
                            <span class="font-mono text-[10px] text-[var(--text-secondary)] uppercase tracking-wider block mt-0.5">
                                ${day.tripCount} ${day.tripCount === 1 ? 'TRAYECTO' : 'TRAYECTOS'}
                            </span>
                        </div>

                        <!-- Centro: Glifo de Ruta SVG (Firma visual abstracta de la ruta del día) -->
                        <div class="w-14 h-7 shrink-0 flex items-center justify-center opacity-85">
                            ${day.routeGlyph ? `
                                <svg viewBox="0 0 56 28" class="w-full h-full block" preserveAspectRatio="xMidYMid meet">
                                    <path d="${day.routeGlyph}" fill="none" stroke="#FF5500" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                                </svg>
                            ` : `
                                <div class="w-4 h-[2px] bg-white/20"></div>
                            `}
                        </div>

                        <!-- Derecha: Kilómetros Totales del Día -->
                        <div class="flex items-center gap-2 shrink-0">
                            <span class="font-mono text-sm font-semibold tabular-nums text-[var(--text-primary)]">
                                ${day.totalKm} <span class="text-[10px] text-[var(--accent-amber)] font-normal">KM</span>
                            </span>
                            <span class="text-[var(--text-secondary)] text-sm">›</span>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;

    bindLevelDaysEvents();
}

/**
 * Event bindings for Level 0.
 */
function bindLevelDaysEvents() {
    const closeBtn = modalRootEl.querySelector('#gps-modal-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', closeGpsTripsModal);

    const refreshBtn = modalRootEl.querySelector('#gps-modal-refresh-btn');
    if (refreshBtn) refreshBtn.addEventListener('click', () => loadTripsData({ forceRefresh: true }));

    // Scope dropdown toggle
    const scopeTrigger = modalRootEl.querySelector('#gps-scope-trigger');
    const scopeDropdown = modalRootEl.querySelector('#gps-scope-dropdown');
    if (scopeTrigger && scopeDropdown) {
        scopeTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            scopeDropdown.classList.toggle('hidden');
        });

        modalRootEl.querySelectorAll('[data-scope-opt]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const newScope = btn.dataset.scopeOpt;
                scopeDropdown.classList.add('hidden');
                if (newScope !== currentScope) {
                    currentScope = newScope;
                    playHorologyTick(1100, 0.01, 0.02);
                    await loadTripsData({ forceRefresh: false });
                }
            });
        });

        document.addEventListener('click', () => scopeDropdown.classList.add('hidden'), { once: true });
    }

    // Row click -> Level 1 (Día)
    modalRootEl.querySelectorAll('.gps-day-row').forEach(row => {
        row.addEventListener('click', () => {
            const dateStr = row.dataset.dayDate;
            const dayObj = currentDays.find(d => d.date === dateStr);
            if (dayObj) {
                playHorologyTick(1100, 0.015, 0.025);
                activeDay = dayObj;
                currentLevel = 'day';
                renderView();
            }
        });
    });
}

/**
 * Ensures the persistent day container frame is mounted in modalRootEl.
 * Preserves the map container and Leaflet instance across Level 1 (full day) and Level 2 (single trip focus)
 * to prevent DOM re-flows, flickering, and tile re-fetching.
 */
function ensureTacticalDayFrame() {
    const existingFrame = modalRootEl.querySelector('#gps-tactical-frame');
    if (existingFrame && existingFrame.dataset.dayDate === activeDay.date) {
        return;
    }

    modalRootEl.innerHTML = `
        <div id="gps-tactical-frame" data-day-date="${activeDay.date}" class="w-full h-[100dvh] flex flex-col bg-[#09090b] text-[var(--text-primary)] font-mono">
            <!-- Barra Superior: Regresar -->
            <div class="px-4 py-3 border-b border-[var(--line-hair)] flex items-center justify-between shrink-0 bg-[var(--bg-void)]">
                <button id="gps-level-back-btn" class="flex items-center gap-2 py-1 px-2 -ml-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] active:scale-95 transition-all cursor-pointer font-mono text-xs">
                    <span class="text-[var(--accent-amber)] font-bold text-sm">←</span>
                    <span id="gps-level-back-title" class="font-semibold uppercase tracking-wider text-[var(--text-primary)]"></span>
                </button>
                <button id="gps-day-close-btn" class="w-8 h-8 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] active:scale-95 transition-all cursor-pointer" aria-label="Cerrar">
                    <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.75" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            <!-- Contenedor del Mapa Táctico: Ocupa ~44% de la altura en móvil -->
            <div id="gps-day-map-container" class="w-full h-[44vh] md:h-[48vh] shrink-0 border-b border-[var(--line-hair)] bg-[#09090b] relative"></div>

            <!-- Hoja Dinámica Inferior: Resumen y Lista o Ficha de Viaje -->
            <div id="gps-day-bottom-pane" class="flex-1 overflow-y-auto flex flex-col overscroll-contain bg-[var(--bg-void)]"></div>
        </div>
    `;

    const backBtn = modalRootEl.querySelector('#gps-level-back-btn');
    if (backBtn) backBtn.addEventListener('click', () => handleBackAction());

    const closeBtn = modalRootEl.querySelector('#gps-day-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', closeGpsTripsModal);

    const mapContainer = modalRootEl.querySelector('#gps-day-map-container');
    if (mapContainer && activeDay) {
        if (routeMapController) {
            routeMapController.destroy();
            routeMapController = null;
        }
        routeMapController = createRouteMap(mapContainer, { initialFocusTrip: activeTrip });
        routeMapController.showDay(activeDay.trips, activeDay.allTrackPoints);
    }
}

/**
 * LEVEL 1: Vista de Día Completo (Mapa de todo el día + Hoja inferior de viajes)
 */
function renderLevelDay() {
    if (!activeDay) {
        currentLevel = 'days';
        renderView();
        return;
    }

    ensureTacticalDayFrame();

    const titleEl = modalRootEl.querySelector('#gps-level-back-title');
    if (titleEl) {
        titleEl.textContent = formatDateWithWeekday(activeDay.date);
    }

    const bottomPane = modalRootEl.querySelector('#gps-day-bottom-pane');
    if (bottomPane) {
        bottomPane.innerHTML = `
            <!-- Resumen Macro del Día: Solo 2 datos limpios (Kilómetros y Costo) -->
            <div class="px-5 py-3 border-b border-[var(--line-hair)] bg-[var(--bg-void)] flex items-center justify-between shrink-0">
                <div class="flex items-baseline gap-1.5">
                    <span class="font-sans font-light text-2xl tracking-tight tabular-nums text-[var(--text-primary)]">${activeDay.totalKm}</span>
                    <span class="font-mono text-[10px] uppercase text-[var(--accent-amber)]">KM</span>
                </div>
                <div class="flex items-baseline gap-1.5 font-mono text-xs text-[var(--text-secondary)]">
                    <span class="tabular-nums font-semibold text-[var(--text-primary)]">$${activeDay.totalEstCostCop.toLocaleString('es-CO')}</span>
                    <span class="text-[10px] text-[var(--text-muted)]">· ${activeDay.totalEstGallons} GAL</span>
                </div>
            </div>

            <!-- Hoja / Lista Inferior: Viajes de este día -->
            <div class="flex-1 overflow-y-auto divide-y divide-[var(--line-hair)] overscroll-contain">
                ${activeDay.trips.map((t) => `
                    <div data-trip-id="${t.id}" class="gps-trip-row px-5 py-3.5 flex items-center justify-between gap-3 bg-[var(--bg-void)] hover:bg-[var(--bg-elevated)]/30 active:bg-[var(--bg-elevated)]/60 cursor-pointer transition-colors select-none">
                        <!-- Origen y Destino con hora -->
                        <div class="min-w-0 flex-1">
                            <div class="flex items-center gap-1.5 text-xs font-mono font-medium text-[var(--text-primary)] truncate">
                                <span>${t.startTimeHm}</span>
                                <span class="text-[var(--text-muted)]">·</span>
                                <span class="truncate">${t.startAddress || 'Origen'}</span>
                                <span class="text-[var(--accent-amber)]">→</span>
                                <span class="truncate">${t.endAddress || 'Destino'}</span>
                            </div>
                        </div>

                        <!-- Cifras del viaje: Kilómetros y Duración -->
                        <div class="text-right shrink-0">
                            <span class="font-mono text-xs font-semibold tabular-nums text-[var(--text-primary)] block">
                                ${t.distanceKm} KM
                            </span>
                            <span class="font-mono text-[10px] text-[var(--text-secondary)] tabular-nums block">
                                ${t.durationMin} MIN
                            </span>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;

        bottomPane.querySelectorAll('.gps-trip-row').forEach(row => {
            row.addEventListener('click', () => {
                const tripId = row.dataset.tripId;
                const tripObj = activeDay.trips.find(t => t.id === tripId);
                if (tripObj) {
                    playHorologyTick(1150, 0.015, 0.025);
                    activeTrip = tripObj;
                    currentLevel = 'trip';
                    renderLevelTrip();
                }
            });
        });
    }

    if (routeMapController) {
        routeMapController.unfocusTrip();
    }
}

/**
 * LEVEL 2: Vista de Viaje Enfocado (Mismo mapa con zoom suave + Hoja de detalles limpios)
 */
function renderLevelTrip() {
    if (!activeTrip || !activeDay) {
        currentLevel = 'day';
        renderView();
        return;
    }

    ensureTacticalDayFrame();

    const titleEl = modalRootEl.querySelector('#gps-level-back-title');
    if (titleEl) {
        titleEl.textContent = `${activeTrip.startTimeHm} a ${activeTrip.endTimeHm}`;
    }

    const bottomPane = modalRootEl.querySelector('#gps-day-bottom-pane');
    if (bottomPane) {
        bottomPane.innerHTML = `
            <div class="flex-1 overflow-y-auto px-5 py-4 flex flex-col justify-between overscroll-contain bg-[var(--bg-void)]">
                <div class="space-y-4">
                    <!-- Origen y Destino Completo -->
                    <div class="space-y-2 border-b border-[var(--line-hair)] pb-3">
                        <div class="flex items-start gap-2.5">
                            <span class="w-3.5 h-3.5 rounded-full bg-[var(--accent-volt)] text-[#09090b] font-mono text-[9px] font-bold flex items-center justify-center shrink-0 mt-0.5">A</span>
                            <span class="font-mono text-xs text-[var(--text-primary)] leading-snug">${activeTrip.rawStartAddress || activeTrip.startAddress || 'Origen'}</span>
                        </div>
                        <div class="flex items-start gap-2.5">
                            <span class="w-3.5 h-3.5 rounded-full bg-[#EF4444] text-[#FFFFFF] font-mono text-[9px] font-bold flex items-center justify-center shrink-0 mt-0.5">B</span>
                            <span class="font-mono text-xs text-[var(--text-primary)] leading-snug">${activeTrip.rawEndAddress || activeTrip.endAddress || 'Destino'}</span>
                        </div>
                    </div>

                    <!-- 3 Cifras Maestras: Distancia, Duración y Costo -->
                    <div class="grid grid-cols-3 gap-3 text-center border-b border-[var(--line-hair)] pb-4">
                        <div>
                            <span class="font-mono text-[10px] uppercase text-[var(--text-secondary)] tracking-wider block">DISTANCIA</span>
                            <span class="font-sans font-light text-2xl tracking-tight tabular-nums text-[var(--text-primary)] block mt-0.5">${activeTrip.distanceKm}</span>
                            <span class="font-mono text-[9px] uppercase text-[var(--accent-amber)] block">KM</span>
                        </div>
                        <div>
                            <span class="font-mono text-[10px] uppercase text-[var(--text-secondary)] tracking-wider block">TIEMPO</span>
                            <span class="font-sans font-light text-2xl tracking-tight tabular-nums text-[var(--text-primary)] block mt-0.5">${activeTrip.durationMin}</span>
                            <span class="font-mono text-[9px] uppercase text-[var(--text-secondary)] block">MIN</span>
                        </div>
                        <div>
                            <span class="font-mono text-[10px] uppercase text-[var(--text-secondary)] tracking-wider block">GASOLINA</span>
                            <span class="font-sans font-light text-2xl tracking-tight tabular-nums text-[var(--text-primary)] block mt-0.5">$${activeTrip.estCostCop.toLocaleString('es-CO')}</span>
                            <span class="font-mono text-[9px] uppercase text-[var(--text-secondary)] block">${activeTrip.estGallons} GAL</span>
                        </div>
                    </div>

                    <!-- Métricas Secundarias Limpias: Velocidades y Tiempo en Movimiento -->
                    <div class="flex items-center justify-between text-xs font-mono text-[var(--text-secondary)] pt-1">
                        <div>
                            <span class="uppercase tracking-wider text-[10px]">MEDIA:</span>
                            <span class="text-[var(--text-primary)] font-semibold tabular-nums ml-1">${activeTrip.avgSpeedKmh} KM/H</span>
                        </div>
                        <div>
                            <span class="uppercase tracking-wider text-[10px]">MÁX:</span>
                            <span class="text-[var(--text-primary)] font-semibold tabular-nums ml-1">${activeTrip.speedMax} KM/H</span>
                        </div>
                        <div>
                            <span class="uppercase tracking-wider text-[10px]">MOV:</span>
                            <span class="text-[var(--text-primary)] font-semibold tabular-nums ml-1">${activeTrip.movingTimeMin} MIN</span>
                        </div>
                    </div>
                </div>

                <!-- Botón de acción para volver a la lista del día -->
                <div class="pt-4">
                    <button id="gps-unfocus-btn" class="w-full py-2.5 px-4 font-mono text-xs uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--line-hair)] bg-[var(--bg-elevated)]/30 active:scale-98 transition-all cursor-pointer">
                        VER TODOS LOS VIAJES DEL DÍA
                    </button>
                </div>
            </div>
        `;

        const unfocusBtn = bottomPane.querySelector('#gps-unfocus-btn');
        if (unfocusBtn) unfocusBtn.addEventListener('click', () => handleBackAction());
    }

    if (routeMapController) {
        routeMapController.focusTrip(activeTrip);
    }
}

/**
 * Renders loading / spinning status on the refresh button without re-rendering the full view.
 */
function renderHeaderControls() {
    const refreshBtn = modalRootEl?.querySelector('#gps-modal-refresh-btn');
    if (refreshBtn) {
        if (isRefreshing || isLoading) {
            refreshBtn.classList.add('animate-spin', 'text-[var(--accent-amber)]');
        } else {
            refreshBtn.classList.remove('animate-spin', 'text-[var(--accent-amber)]');
        }
    }
}
