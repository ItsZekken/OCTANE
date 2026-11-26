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
    classifyTripDatesToFetch,
    getGpsConfig,
    IOPGPS_INSTALL_DATE
} from '../../core/iopgps-sync.js';
import { createRouteMap } from '../gps/gps-route-map.js';
import {
    detectSemanticPlaces,
    resolvePlaceLabel,
    analyzeOptimalDeparture
} from '../../core/geospatial-intelligence.js';
import {
    pushOverlayLayer,
    removeOverlayLayer,
    removeOverlayLayersByPrefix
} from '../../core/navigation-manager.js';

const LAYER_ROOT = 'gps-trips';
const LAYER_DAY = 'gps-trips:day';
const LAYER_TRIP = 'gps-trips:trip';

let modalRootEl = null;
let currentScope = 'cycle'; // 'cycle' | '7days' | 'all'
let scopeCycleStart = '';
let scopeCycleEnd = '';
let currentTrips = [];
let currentDays = [];
let currentSummary = null;
let currentSemanticPlaces = null;
let currentOptimalDeparture = [];
let routeMapController = null;

// Navigation state: 'days' (0) | 'day' (1) | 'trip' (2)
let currentLevel = 'days';
let activeDay = null;
let activeTrip = null;

// Scroll memory per navigation level
let savedDaysScrollTop = 0;
let savedDayTripsScrollTop = 0;
let lastDayScrollDate = '';

let isRefreshing = false;
let isLoading = false;
let loadRequestToken = 0;
let archiveProgressLabel = '';
let modalStoreUnsub = null;

function captureCurrentLevelScroll() {
    if (!modalRootEl) return;
    if (currentLevel === 'days') {
        const listEl = modalRootEl.querySelector('#gps-days-list-scroll');
        if (listEl) savedDaysScrollTop = Math.max(0, Number(listEl.scrollTop) || 0);
    } else if (currentLevel === 'day') {
        const tripsEl = modalRootEl.querySelector('#gps-day-trips-scroll');
        if (tripsEl) {
            savedDayTripsScrollTop = Math.max(0, Number(tripsEl.scrollTop) || 0);
            lastDayScrollDate = activeDay?.date || '';
        }
    }
}

function restoreLevelScroll(selector, targetTop) {
    if (!modalRootEl || !selector) return;
    const safeTop = Math.max(0, Number(targetTop) || 0);
    const apply = () => {
        const el = modalRootEl?.querySelector(selector);
        if (el) el.scrollTop = safeTop;
    };
    apply();
    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(apply);
    }
}

function resolveTripPlaceLabel(trip, endType = 'start', preferRaw = false) {
    if (!trip) return endType === 'start' ? 'Origen' : 'Destino';
    const track = Array.isArray(trip.trackPoints) ? trip.trackPoints : [];
    const lat = endType === 'start'
        ? (trip.startLat ?? track[0]?.lat)
        : (trip.endLat ?? track[track.length - 1]?.lat);
    const lng = endType === 'start'
        ? (trip.startLng ?? track[0]?.lng)
        : (trip.endLng ?? track[track.length - 1]?.lng);
    const fallback = endType === 'start'
        ? ((preferRaw ? trip.rawStartAddress : null) || trip.startAddress || 'Origen')
        : ((preferRaw ? trip.rawEndAddress : null) || trip.endAddress || 'Destino');
    return resolvePlaceLabel(lat, lng, fallback, currentSemanticPlaces);
}

function refreshGeospatialContext(profile, fallbackTrips = []) {
    const tripsByDate = profile?.gpsCache?.tripsByDate || null;
    const stations = Array.isArray(profile?.learnedGasStations) ? profile.learnedGasStations : [];
    const hasMap = tripsByDate && Object.keys(tripsByDate).length > 0;
    currentSemanticPlaces = detectSemanticPlaces(hasMap ? tripsByDate : {}, stations);
    currentOptimalDeparture = analyzeOptimalDeparture(hasMap ? tripsByDate : fallbackTrips, {
        semanticPlaces: currentSemanticPlaces
    });
}

/**
 * Resolves start and end YYYY-MM-DD dates for a given scope.
 */
function resolveScopeDates(scope, profile = null) {
    const today = todayLocalYmd();

    if (scope === '7days') {
        const d = new Date();
        d.setDate(d.getDate() - 6);
        return { start: localYmd(d), end: today };
    }

    if (scope === 'all') {
        const activeProfile = profile || store.getState()?.vehicleProfile || null;
        const cfg = getGpsConfig(activeProfile);
        const candidates = [cfg.installDate || IOPGPS_INSTALL_DATE || '2026-02-01'];
        const daysObj = activeProfile?.gpsCache?.days;
        if (daysObj && typeof daysObj === 'object') {
            const firstDay = Object.keys(daysObj).sort()[0];
            if (firstDay) candidates.push(firstDay);
        }
        const start = candidates.filter(Boolean).sort()[0] || '2026-02-01';
        return { start, end: today };
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
    modalRootEl.className = 'fixed inset-0 z-50 hidden bg-[var(--bg-void)] text-[var(--text-primary)] select-none overflow-hidden';
    document.body.appendChild(modalRootEl);
}

/**
 * Transitions from Level 0 (Days) into Level 1 (Day) while preserving list scroll position.
 */
function enterLevelDay(dayObj) {
    if (!dayObj) return;
    captureCurrentLevelScroll();
    if (dayObj.date !== lastDayScrollDate) {
        savedDayTripsScrollTop = 0;
        lastDayScrollDate = dayObj.date || '';
    }
    playHorologyTick(1100, 0.015, 0.025);
    activeDay = dayObj;
    activeTrip = null;
    currentLevel = 'day';
    pushOverlayLayer(LAYER_DAY, () => stepBackToDays({ fromPopState: true }));
    renderLevelDay();
}

/**
 * Transitions from Level 1 (Day) into Level 2 (Trip) while preserving day trips scroll position.
 */
function enterLevelTrip(tripObj) {
    if (!tripObj || !activeDay) return;
    captureCurrentLevelScroll();
    playHorologyTick(1150, 0.015, 0.025);
    activeTrip = tripObj;
    currentLevel = 'trip';
    pushOverlayLayer(LAYER_TRIP, () => stepBackToDay({ fromPopState: true }));
    renderLevelTrip();
}

/**
 * Steps back from Level 2 (Trip) to Level 1 (Day), restoring saved day-trips scroll.
 */
function stepBackToDay({ fromPopState = false } = {}) {
    if (!fromPopState) {
        removeOverlayLayer(LAYER_TRIP);
    }
    playHorologyTick(900, 0.01, 0.02);
    currentLevel = 'day';
    activeTrip = null;
    renderLevelDay();
}

/**
 * Steps back from Level 1 (Day) to Level 0 (Days), restoring saved days-list scroll.
 */
function stepBackToDays({ fromPopState = false } = {}) {
    if (!fromPopState) {
        removeOverlayLayer(LAYER_TRIP);
        removeOverlayLayer(LAYER_DAY);
    }
    playHorologyTick(850, 0.01, 0.02);
    currentLevel = 'days';
    activeDay = null;
    activeTrip = null;
    if (routeMapController) {
        routeMapController.destroy();
        routeMapController = null;
    }
    renderLevelDays();
}

/**
 * Handles back navigation across the 3 levels (Level 2 -> Level 1 -> Level 0 -> Close).
 */
function handleBackAction(fromPopState = false) {
    if (currentLevel === 'trip') {
        stepBackToDay({ fromPopState });
    } else if (currentLevel === 'day') {
        stepBackToDays({ fromPopState });
    } else {
        closeGpsTripsModal({ fromPopState });
    }
}

/**
 * Hydrates in-memory modal state from local IndexedDB cache in 0 ms (no network).
 */
function hydrateFromCachedProfile(profile, scope) {
    const { start, end } = resolveScopeDates(scope, profile);
    const cached = getCachedGpsTrips(start, end, profile);
    const fuelPriceCop = Number(profile?.fuelPriceCop) || 16000;
    const baseEff = Number(profile?.benchmarkEff) || Number(profile?.defaultEfficiencyKmGal) || 33.71;

    currentTrips = cached;
    currentDays = groupTripsByDay(cached, { fuelPriceCop, baseEff });
    currentSummary = computeTripsSummary(cached, [], { fuelPriceCop, baseEff });
    refreshGeospatialContext(profile, cached);

    return { start, end, cached };
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
    savedDaysScrollTop = 0;
    savedDayTripsScrollTop = 0;
    lastDayScrollDate = '';
    archiveProgressLabel = '';

    modalRootEl.classList.remove('hidden');
    pushOverlayLayer(LAYER_ROOT, () => closeGpsTripsModal({ fromPopState: true }));

    // Subscribe to live store updates so background historical archiving updates Level 0 in real time
    if (modalStoreUnsub) {
        try { modalStoreUnsub(); } catch (_) {}
        modalStoreUnsub = null;
    }
    if (store && typeof store.subscribe === 'function') {
        modalStoreUnsub = store.subscribe((nextState, prevState) => {
            if (!modalRootEl || modalRootEl.classList.contains('hidden')) return;
            const nextTripsMap = nextState?.vehicleProfile?.gpsCache?.tripsByDate;
            const prevTripsMap = prevState?.vehicleProfile?.gpsCache?.tripsByDate;
            if (nextTripsMap && nextTripsMap !== prevTripsMap) {
                const prevCount = currentTrips.length;
                hydrateFromCachedProfile(nextState.vehicleProfile, currentScope);
                if (currentLevel === 'days' && currentTrips.length !== prevCount) {
                    captureCurrentLevelScroll();
                    renderLevelDays();
                }
            }
        });
    }

    // 1. Instant zero-latency cache load
    const profile = await getVehicleProfile().catch(() => null);
    const { start, end } = hydrateFromCachedProfile(profile, currentScope);

    renderView();

    // 2. Fetch from network ONLY for missing, unfinalized, missing-track, or stale-today dates
    const plan = classifyTripDatesToFetch(start, end, profile, { forceRefresh: false });
    if (plan.datesToFetch.length > 0 || plan.zeroActivityPastDays.length > 0) {
        await loadTripsData({ forceRefresh: false });
    }
}

/**
 * Closes and resets the modal.
 */
export function closeGpsTripsModal(options = {}) {
    loadRequestToken++;
    isLoading = false;
    isRefreshing = false;
    archiveProgressLabel = '';
    removeOverlayLayersByPrefix(LAYER_ROOT);
    if (modalStoreUnsub) {
        try { modalStoreUnsub(); } catch (_) {}
        modalStoreUnsub = null;
    }
    if (routeMapController) {
        try { routeMapController.destroy(); } catch (_) {}
        routeMapController = null;
    }
    if (modalRootEl && !modalRootEl.classList.contains('hidden')) {
        playHorologyTick(800, 0.01, 0.02);
        modalRootEl.classList.add('hidden');
        modalRootEl.innerHTML = '';
    }
    currentLevel = 'days';
    activeDay = null;
    activeTrip = null;
    savedDaysScrollTop = 0;
    savedDayTripsScrollTop = 0;
    lastDayScrollDate = '';
}

/**
 * Loads trips for the current scope incrementally (never re-fetching sealed past days).
 */
async function loadTripsData(opts = {}) {
    const force = Boolean(opts.forceRefresh);
    if ((isLoading || isRefreshing) && !opts.allowOverride) return;

    const reqToken = ++loadRequestToken;
    const requestedScope = currentScope;

    if (force) {
        isRefreshing = true;
    } else {
        isLoading = true;
    }
    archiveProgressLabel = requestedScope === 'all' ? 'ARCHIVANDO HISTORIAL...' : '';
    renderHeaderControls();

    try {
        const baseProfile = await getVehicleProfile().catch(() => null);
        const { start, end } = resolveScopeDates(requestedScope, baseProfile);
        const res = await fetchGpsCycleTrips(start, end, {
            forceRefresh: force,
            retryEmptyDrivenDays: Boolean(force && requestedScope === 'all'),
            onProgress: (prog) => {
                if (reqToken !== loadRequestToken || requestedScope !== currentScope) return;
                const progTrips = Array.isArray(prog?.trips) ? prog.trips : [];
                const snapProfile = store.getState()?.vehicleProfile || null;
                const fuelPriceCop = Number(snapProfile?.fuelPriceCop) || 16000;
                const baseEff = Number(snapProfile?.benchmarkEff) || Number(snapProfile?.defaultEfficiencyKmGal) || 33.71;

                currentTrips = progTrips;
                currentDays = groupTripsByDay(progTrips, { fuelPriceCop, baseEff });
                currentSummary = prog?.summary || computeTripsSummary(progTrips, [], { fuelPriceCop, baseEff });
                refreshGeospatialContext(snapProfile, progTrips);

                if (prog?.totalWindows > 1) {
                    archiveProgressLabel = `ARCHIVANDO · ${prog.completedWindows}/${prog.totalWindows}`;
                }

                // Stream updates cleanly on Level 0 without interrupting active scroll or map inspection
                if (currentLevel === 'days' && modalRootEl && !modalRootEl.classList.contains('hidden')) {
                    captureCurrentLevelScroll();
                    renderLevelDays();
                }
            }
        });

        if (reqToken !== loadRequestToken || requestedScope !== currentScope) return;

        const trips = Array.isArray(res?.trips) ? res.trips : [];
        const profile = await getVehicleProfile().catch(() => null);
        const fuelPriceCop = Number(profile?.fuelPriceCop) || 16000;
        const baseEff = Number(profile?.benchmarkEff) || Number(profile?.defaultEfficiencyKmGal) || 33.71;

        currentTrips = trips;
        currentDays = groupTripsByDay(trips, { fuelPriceCop, baseEff });
        currentSummary = res?.summary || computeTripsSummary(trips, [], { fuelPriceCop, baseEff });
        refreshGeospatialContext(profile, trips);

        // If currently viewing a specific day, update it
        if (activeDay) {
            activeDay = currentDays.find(d => d.date === activeDay.date) || null;
            if (!activeDay) {
                removeOverlayLayer(LAYER_TRIP);
                removeOverlayLayer(LAYER_DAY);
                currentLevel = 'days';
            }
        }
        if (activeTrip && activeDay) {
            activeTrip = activeDay.trips.find(t => t.id === activeTrip.id) || null;
            if (!activeTrip) {
                removeOverlayLayer(LAYER_TRIP);
                currentLevel = 'day';
            }
        }
    } catch (err) {
        console.warn('[OCTANE GPS] Error loading trips:', err?.message);
    } finally {
        if (reqToken === loadRequestToken) {
            isLoading = false;
            isRefreshing = false;
            archiveProgressLabel = '';
            if (modalRootEl && !modalRootEl.classList.contains('hidden')) {
                captureCurrentLevelScroll();
                renderView();
            }
        }
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
        <div class="w-full h-[100dvh] flex flex-col bg-[var(--bg-void)] text-[var(--text-primary)] font-mono">
            <!-- Barra Superior Táctica -->
            <div class="px-5 py-3.5 border-b border-[var(--line-hair)] flex items-center justify-between shrink-0 pt-safe">
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
                <!-- Menú Selector de Alcance Discreto (Dropdown) -->
                <div class="mt-3 flex flex-col items-center justify-center gap-1.5">
                    <div class="relative inline-block">
                        <button id="gps-scope-trigger" type="button" class="inline-flex items-center gap-1.5 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--line-hair)] rounded-full bg-[var(--bg-elevated)]/30 active:scale-95 transition-all cursor-pointer">
                            <span>${activeScopeText}</span>
                            <span class="text-[var(--accent-amber)] text-[10px]">▾</span>
                        </button>
                        <div id="gps-scope-dropdown" class="hidden absolute top-full left-1/2 -translate-x-1/2 mt-1.5 w-44 bg-[var(--bg-surface)] border border-[var(--line-strong)] py-1 z-30 font-mono text-xs">
                            <button data-scope-opt="cycle" class="w-full text-left px-3 py-2 text-[11px] uppercase tracking-wider hover:bg-[var(--bg-elevated)] ${currentScope === 'cycle' ? 'text-[var(--accent-amber)] font-bold' : 'text-[var(--text-secondary)]'}">Ciclo Activo</button>
                            <button data-scope-opt="7days" class="w-full text-left px-3 py-2 text-[11px] uppercase tracking-wider hover:bg-[var(--bg-elevated)] ${currentScope === '7days' ? 'text-[var(--accent-amber)] font-bold' : 'text-[var(--text-secondary)]'}">Últimos 7 Días</button>
                            <button data-scope-opt="all" class="w-full text-left px-3 py-2 text-[11px] uppercase tracking-wider hover:bg-[var(--bg-elevated)] ${currentScope === 'all' ? 'text-[var(--accent-amber)] font-bold' : 'text-[var(--text-secondary)]'}">Historial Completo</button>
                        </div>
                    </div>
                    <span id="gps-archive-progress" class="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--accent-amber)] tabular-nums ${(isLoading || isRefreshing) && archiveProgressLabel ? '' : 'hidden'}">
                        ${archiveProgressLabel}
                    </span>
                </div>
            </div>

            ${currentOptimalDeparture?.primary && currentOptimalDeparture.primary.savedMin >= 2 ? `
                <button id="gps-optimal-departure-ribbon" type="button" class="w-full px-5 py-2.5 border-b border-[var(--line-hair)] bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)]/40 transition-colors cursor-pointer flex items-center justify-between gap-3 shrink-0 font-mono text-[10px] uppercase tracking-wider">
                    <span class="text-[var(--accent-volt)] font-semibold truncate tabular-nums">
                        MEJOR SALIDA · ${currentOptimalDeparture.primary.bestWindowHm} · -${currentOptimalDeparture.primary.savedMin} MIN
                    </span>
                    <span class="text-[var(--text-secondary)] shrink-0">RUTAS →</span>
                </button>
            ` : ''}

            <!-- Lista de Días con Glifo Cartográfico (Mobile First) -->
            <div id="gps-days-list-scroll" class="flex-1 overflow-y-auto divide-y divide-[var(--line-hair)] overscroll-contain pb-safe">
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
                                <div class="w-4 h-[2px] bg-[var(--line-strong)]"></div>
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
    restoreLevelScroll('#gps-days-list-scroll', savedDaysScrollTop);
}

/**
 * Event bindings for Level 0.
 */
function bindLevelDaysEvents() {
    const closeBtn = modalRootEl.querySelector('#gps-modal-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', () => closeGpsTripsModal());

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
                    savedDaysScrollTop = 0;
                    savedDayTripsScrollTop = 0;
                    lastDayScrollDate = '';
                    playHorologyTick(1100, 0.01, 0.02);

                    // Instant 0 ms render from accumulated local cache
                    const profile = await getVehicleProfile().catch(() => null);
                    const { start, end } = hydrateFromCachedProfile(profile, currentScope);
                    renderView();

                    // Only hit API if this scope has missing/unfinalized/stale dates
                    const plan = classifyTripDatesToFetch(start, end, profile, { forceRefresh: false });
                    if (plan.datesToFetch.length > 0 || plan.zeroActivityPastDays.length > 0) {
                        await loadTripsData({ forceRefresh: false, allowOverride: true });
                    }
                }
            });
        });

        modalRootEl.onclick = (e) => {
            if (!scopeDropdown.classList.contains('hidden') && !scopeDropdown.contains(e.target) && !scopeTrigger.contains(e.target)) {
                scopeDropdown.classList.add('hidden');
            }
        };
    }

    const optRibbon = modalRootEl.querySelector('#gps-optimal-departure-ribbon');
    if (optRibbon) {
        optRibbon.addEventListener('click', () => {
            closeGpsTripsModal();
            window.dispatchEvent(new CustomEvent('octane:open-gps-intelligence', { detail: { tab: 'routes' } }));
        });
    }

    // Row click -> Level 1 (Día)
    modalRootEl.querySelectorAll('.gps-day-row').forEach(row => {
        row.addEventListener('click', () => {
            const dateStr = row.dataset.dayDate;
            const dayObj = currentDays.find(d => d.date === dateStr);
            if (dayObj) {
                enterLevelDay(dayObj);
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

    modalRootEl.onclick = null;
    modalRootEl.innerHTML = `
        <div id="gps-tactical-frame" data-day-date="${activeDay.date}" class="w-full h-[100dvh] flex flex-col bg-[var(--bg-void)] text-[var(--text-primary)] font-mono">
            <!-- Barra Superior: Regresar -->
            <div class="px-4 py-3 border-b border-[var(--line-hair)] flex items-center justify-between shrink-0 bg-[var(--bg-void)] pt-safe">
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
    if (closeBtn) closeBtn.addEventListener('click', () => closeGpsTripsModal());

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
        const hasCalibratedTrips = Array.isArray(activeDay.trips) && activeDay.trips.some(t => t?.isCalibrated);
        bottomPane.innerHTML = `
            <!-- Resumen Macro del Día: Solo 2 datos limpios (Kilómetros y Costo) -->
            <div class="px-5 py-3 border-b border-[var(--line-hair)] bg-[var(--bg-void)] flex items-center justify-between shrink-0">
                <div class="flex items-baseline gap-1.5">
                    <span class="font-sans font-light text-2xl tracking-tight tabular-nums text-[var(--text-primary)]">${activeDay.totalKm}</span>
                    <span class="font-mono text-[10px] uppercase text-[var(--accent-amber)]">KM</span>
                </div>
                <div class="flex items-baseline gap-1.5 font-mono text-xs text-[var(--text-secondary)]">
                    <span class="tabular-nums font-semibold text-[var(--text-primary)]">$${activeDay.totalEstCostCop.toLocaleString('es-CO')}</span>
                    <span class="text-[10px] text-[var(--text-muted)]">· ${activeDay.totalEstGallons} GAL${hasCalibratedTrips ? ' · CALIBRADO' : ''}</span>
                </div>
            </div>

            <!-- Hoja / Lista Inferior: Viajes de este día -->
            <div id="gps-day-trips-scroll" class="flex-1 overflow-y-auto divide-y divide-[var(--line-hair)] overscroll-contain pb-safe">
                ${activeDay.trips.map((t) => `
                    <div data-trip-id="${t.id}" class="gps-trip-row px-5 py-3.5 flex items-center justify-between gap-3 bg-[var(--bg-void)] hover:bg-[var(--bg-elevated)]/30 active:bg-[var(--bg-elevated)]/60 cursor-pointer transition-colors select-none">
                        <!-- Origen y Destino con hora -->
                        <div class="min-w-0 flex-1">
                            <div class="flex items-center gap-1.5 text-xs font-mono font-medium text-[var(--text-primary)] truncate">
                                <span>${t.startTimeHm}</span>
                                <span class="text-[var(--text-muted)]">·</span>
                                <span class="truncate">${resolveTripPlaceLabel(t, 'start', false)}</span>
                                <span class="text-[var(--accent-amber)]">→</span>
                                <span class="truncate">${resolveTripPlaceLabel(t, 'end', false)}</span>
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
                    enterLevelTrip(tripObj);
                }
            });
        });

        restoreLevelScroll('#gps-day-trips-scroll', activeDay.date === lastDayScrollDate ? savedDayTripsScrollTop : 0);
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
        const tripCostCop = Number(activeTrip.reconciledCostCop ?? activeTrip.estCostCop) || 0;
        const tripGallons = Number(activeTrip.reconciledGallons ?? activeTrip.estGallons) || 0;
        const coldPct = Math.max(0, Math.round(Number(activeTrip.coldPenaltyPct) || 0));
        const startPlace = resolveTripPlaceLabel(activeTrip, 'start', true);
        const endPlace = resolveTripPlaceLabel(activeTrip, 'end', true);

        bottomPane.innerHTML = `
            <div class="flex-1 overflow-y-auto px-5 py-4 flex flex-col justify-between overscroll-contain bg-[var(--bg-void)]">
                <div class="space-y-4">
                    <!-- Origen y Destino Completo -->
                    <div class="space-y-2 border-b border-[var(--line-hair)] pb-3">
                        <div class="flex items-start gap-2.5">
                            <span class="w-3.5 h-3.5 rounded-full bg-[var(--accent-volt)] text-[#09090b] font-mono text-[9px] font-bold flex items-center justify-center shrink-0 mt-0.5">A</span>
                            <span class="font-mono text-xs text-[var(--text-primary)] leading-snug">${startPlace}</span>
                        </div>
                        <div class="flex items-start gap-2.5">
                            <span class="w-3.5 h-3.5 rounded-full bg-[#EF4444] text-[#FFFFFF] font-mono text-[9px] font-bold flex items-center justify-center shrink-0 mt-0.5">B</span>
                            <span class="font-mono text-xs text-[var(--text-primary)] leading-snug">${endPlace}</span>
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
                            <span class="font-mono text-[10px] uppercase text-[var(--text-secondary)] tracking-wider block">GASOLINA${activeTrip.isCalibrated ? ' · CALIBRADO' : ''}</span>
                            <span class="font-sans font-light text-2xl tracking-tight tabular-nums text-[var(--text-primary)] block mt-0.5">$${tripCostCop.toLocaleString('es-CO')}</span>
                            <span class="font-mono text-[9px] uppercase text-[var(--text-secondary)] block">${tripGallons} GAL</span>
                        </div>
                    </div>

                    <!-- Métricas Secundarias Limpias (1 fila aireada de 3 columnas) -->
                    <div class="grid grid-cols-3 gap-2 text-xs font-mono text-[var(--text-secondary)] pt-1">
                        <div>
                            <span class="uppercase tracking-wider text-[10px]">MEDIA:</span>
                            <span class="text-[var(--text-primary)] font-semibold tabular-nums ml-1">${activeTrip.avgSpeedKmh} KM/H</span>
                        </div>
                        <div class="text-center">
                            <span class="uppercase tracking-wider text-[10px]">MÁX:</span>
                            <span class="text-[var(--text-primary)] font-semibold tabular-nums ml-1">${activeTrip.speedMax} KM/H</span>
                        </div>
                        <div class="text-right">
                            ${coldPct > 0 ? `
                                <span class="uppercase tracking-wider text-[10px]">FRÍO:</span>
                                <span class="text-[var(--text-primary)] font-semibold tabular-nums ml-1">${coldPct}%</span>
                            ` : `
                                <span class="uppercase tracking-wider text-[10px]">MOV:</span>
                                <span class="text-[var(--text-primary)] font-semibold tabular-nums ml-1">${activeTrip.movingTimeMin} MIN</span>
                            `}
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
    const progEl = modalRootEl?.querySelector('#gps-archive-progress');
    if (progEl) {
        if ((isLoading || isRefreshing) && archiveProgressLabel) {
            progEl.textContent = archiveProgressLabel;
            progEl.classList.remove('hidden');
        } else {
            progEl.textContent = '';
            progEl.classList.add('hidden');
        }
    }
}
