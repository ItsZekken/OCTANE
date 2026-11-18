/**
 * OCTANE // KINETIC — Rediseño Total del Módulo Carreras ("view-rides.js")
 * 
 * Filosofía de Diseño Industrial (DESIGN_GUIDELINES.md):
 * - Nombre directo: "Carreras" (cero jerga, cero "//", cero prefijos numéricos "01 /").
 * - Silencio Verbal Absoluto: Prohibidos párrafos <p>, títulos ruidosos, cajas dentro de cajas.
 * - Selector de Ciclo en Header: "Cada 3 días" | "Semanal" | "Quincenal" | "Mensual" | "Ciclo actual".
 * - 4 Tarjetas Limpias sobre un único contenedor plano dividido por hairlines:
 *     1. GANANCIA NETA LIBRE (Bruto - Egresos - Combustible extra)
 *     2. GASOLINA CUBIERTA (% del tanque o gasto de combustible pagado por carreras)
 *     3. KILÓMETROS EXTRA TOTALES (KM de carreras + KM estimados de recogida/desvío)
 *     4. FONDO DE DESGASTE SUGERIDO ($ COP y % sugerido a apartar)
 * - Lista Unificada de Movimientos con opción de editar y eliminar.
 */

import { playHorologyTick, store } from '../core/state.js';
import { todayLocalYmd } from '../core/date-utils.js';
import { getRideSessions, getPlatformPasses, getVehicleProfile, getTelemetryLogs } from '../core/db-local.js';
import { calculateTelemetryModel } from '../core/telemetry-engine.js';
import {
  calculateRidesCycleSummary,
  calculateCostPerKm,
  formatCop,
  formatCompactCop
} from '../core/rides-engine.js';
import { renderRideSessionLog } from '../components/rides/ride-session-log.js';
import { openDiagnosticModal } from '../components/modals/modal-diagnostic.js';

let currentContainer = null;
let boundListeners = [];
let currentCycleOffset = 0;

const CYCLES = [
  { id: 'day', label: 'Diaria' },
  { id: 'week', label: 'Semanal' },
  { id: '15d', label: 'Quincenal' },
  { id: 'month', label: 'Mensual' },
  { id: 'tank_cycle', label: 'Ciclo de tanque' }
];

const CYCLE_STORAGE_KEY = 'octane_rides_cycle';

/**
 * Destroys view listeners when unmounting.
 */
export function destroyRidesView() {
  boundListeners.forEach(({ event, handler }) => {
    window.removeEventListener(event, handler);
  });
  boundListeners = [];
  currentContainer = null;
  try { store.setState({ ridesContextDate: null }); } catch (_) {}
}

/**
 * Renders the clean Swiss Carreras view.
 * @param {HTMLElement} container
 */
export async function renderRidesView(container) {
  if (!container) return;
  currentContainer = container;
  destroyRidesView();
  playHorologyTick(1100, 0.015, 0.025);

  let activeCycle = 'month';
  try {
    const saved = localStorage.getItem(CYCLE_STORAGE_KEY);
    if (saved && CYCLES.some(c => c.id === saved)) {
      activeCycle = saved;
    }
  } catch (_) {}

  const [sessions, passes, profile, logs] = await Promise.all([
    getRideSessions().catch(() => []),
    getPlatformPasses().catch(() => []),
    getVehicleProfile().catch(() => ({})),
    getTelemetryLogs().catch(() => [])
  ]);

  const telemetryModel = calculateTelemetryModel(logs, profile);
  const summary = calculateRidesCycleSummary({
    sessions,
    passes,
    profile,
    telemetryLogs: logs,
    telemetryModel,
    cycleType: activeCycle,
    cycleOffset: currentCycleOffset
  });

  currentCycleOffset = summary.cycleOffset ?? currentCycleOffset;

  // Fecha contextual para el FAB: en el periodo actual es hoy; en uno pasado, el último día
  // del periodo (nunca futuro), para que lo registrado aparezca dentro de lo que se está viendo.
  {
    const today = todayLocalYmd();
    let ctxDate = today;
    if (!summary.isCurrentPeriod && summary.endDate) {
      ctxDate = String(summary.endDate).slice(0, 10);
      if (ctxDate > today) ctxDate = today;
    }
    store.setState({ ridesContextDate: ctxDate });
  }

  const costPerKm = calculateCostPerKm({
    telemetryModel,
    vehicleProfile: profile
  });

  const freeProfitFormatted = formatCop(summary.freeNetProfitCop, true);
  const grossShort = formatCompactCop(summary.grossRevenueCop);
  const expShort = formatCompactCop(summary.totalExpensesCop);
  const fuelShort = formatCompactCop(summary.fuelExpenseCop);

  const periodRangeText = summary.displayRange
    ? summary.displayRange
    : (summary.startDate === summary.endDate ? summary.startDate : `${summary.startDate} — ${summary.endDate}`);

  container.innerHTML = `
    <div id="rides-swipe-stage" class="view-rides max-w-5xl mx-auto space-y-5 pb-20 select-none font-mono">
      
      <!-- Top Header con Selector de División de Tiempo (Cero // ni prefijos numéricos) -->
      <header class="border-b border-[var(--line-hair)] pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div class="flex items-center gap-2.5">
          <span class="w-2.5 h-2.5 bg-[var(--accent-volt)]"></span>
          <h1 class="font-mono text-sm uppercase tracking-widest text-[var(--text-primary)] font-semibold">
            Carreras
          </h1>
          <span class="text-[10px] text-[var(--text-secondary)] font-normal tracking-wider">
            · $${costPerKm}/KM BASE
          </span>
        </div>

        <!-- Selector de División de Tiempo Horizontal -->
        <div class="flex items-center gap-1 overflow-x-auto py-0.5" id="rides-cycle-pills-bar">
          ${CYCLES.map(c => {
            const isSel = c.id === activeCycle;
            return `
              <button 
                type="button" 
                class="cycle-pill px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider border cursor-pointer transition-colors whitespace-nowrap ${isSel ? 'border-[var(--accent-volt)] bg-[var(--accent-volt)]/15 text-[var(--accent-volt)] font-bold' : 'border-[var(--line-hair)] bg-[var(--bg-void)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}"
                data-cycle="${c.id}"
              >
                ${c.label}
              </button>
            `;
          }).join('')}
        </div>
      </header>

      <!-- Barra de Periodo Calendario y Navegador con Flechas -->
      <div class="flex items-center justify-between px-4 py-2.5 bg-[var(--bg-void)] border border-[var(--line-hair)]">
        <div class="flex items-center gap-2 text-[10px] sm:text-[11px] uppercase tracking-wider text-[var(--text-primary)] font-medium min-w-0">
          <span class="w-1.5 h-1.5 shrink-0 rounded-full ${summary.sessionCount > 0 ? 'bg-[var(--accent-volt)] animate-pulse' : 'bg-[var(--text-muted)]'}"></span>
          <span id="rides-period-label" class="tabular-nums truncate">${periodRangeText}</span>
          <button 
            id="btn-rides-report" 
            type="button" 
            class="flat-pill px-2 sm:px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider border border-[var(--line-hair)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--accent-volt)] hover:border-[var(--accent-volt)] cursor-pointer transition-colors whitespace-nowrap flex items-center gap-1.5 shrink-0" 
            title="Informe Financiero y de Consumo"
          >
            <svg class="w-3 h-3 text-[var(--accent-volt)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            <span>INFORME</span>
          </button>
        </div>

        <div class="flex items-center gap-1.5 shrink-0">
          ${!summary.isCurrentPeriod ? `
            <button
              id="btn-cycle-today"
              type="button"
              class="h-7 px-2.5 border border-[var(--accent-volt)]/40 bg-[var(--accent-volt)]/10 text-[var(--accent-volt)] hover:bg-[var(--accent-volt)]/20 font-mono text-[10px] font-semibold uppercase tracking-wider transition-colors cursor-pointer"
            >
              ACTUAL
            </button>
          ` : ''}

          <button 
            id="btn-cycle-prev" 
            type="button" 
            ${!summary.canGoPrev ? 'disabled' : ''}
            class="w-8 h-7 border border-[var(--line-hair)] bg-[var(--bg-surface)] font-mono text-xs flex items-center justify-center transition-colors ${summary.canGoPrev ? 'text-[var(--text-primary)] hover:border-[var(--accent-volt)] hover:text-[var(--accent-volt)] cursor-pointer active:scale-95' : 'text-[var(--text-muted)] opacity-30 cursor-not-allowed'}"
            aria-label="Periodo anterior"
          >
            ←
          </button>
          
          <button 
            id="btn-cycle-next" 
            type="button" 
            ${!summary.canGoNext ? 'disabled' : ''}
            class="w-8 h-7 border border-[var(--line-hair)] bg-[var(--bg-surface)] font-mono text-xs flex items-center justify-center transition-colors ${summary.canGoNext ? 'text-[var(--text-primary)] hover:border-[var(--accent-volt)] hover:text-[var(--accent-volt)] cursor-pointer active:scale-95' : 'text-[var(--text-muted)] opacity-30 cursor-not-allowed'}"
            aria-label="Periodo siguiente"
          >
            →
          </button>
        </div>
      </div>

      <!-- =====================================================================
           4 TARJETAS LIMPIAS (Contenedor plano sin cajas dentro de cajas)
           1. GANANCIA NETA LIBRE
           2. GASOLINA CUBIERTA
           3. KILÓMETROS EXTRA TOTALES
           4. FONDO DE DESGASTE SUGERIDO
           ===================================================================== -->
      <section class="flat-frame bg-[var(--bg-surface)] border border-[var(--line-hair)] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[var(--line-hair)] overflow-hidden">
        
        <!-- Tarjeta 1: GANANCIA NETA LIBRE -->
        <div class="p-4 sm:p-5 flex flex-col justify-between min-h-[140px]">
          <div class="text-[10px] uppercase tracking-widest text-[var(--text-secondary)] font-medium">
            GANANCIA NETA LIBRE
          </div>
          <div class="my-auto py-2">
            <div class="font-sans font-light text-3xl sm:text-4xl tracking-tighter tabular-nums ${summary.freeNetProfitCop >= 0 ? 'text-[var(--accent-volt)]' : 'text-[var(--accent-crimson)]'} leading-none">
              ${freeProfitFormatted}
            </div>
          </div>
          <div class="pt-2 border-t border-[var(--line-hair)] text-[9px] uppercase tracking-wider text-[var(--text-secondary)] tabular-nums truncate">
            BRUTO ${grossShort} · EGRESOS -${expShort} · GAS -${fuelShort}
          </div>
        </div>

        <!-- Tarjeta 2: GASOLINA CUBIERTA -->
        <div class="p-4 sm:p-5 flex flex-col justify-between min-h-[140px]">
          <div class="text-[10px] uppercase tracking-widest text-[var(--text-secondary)] font-medium">
            GASOLINA CUBIERTA
          </div>
          <div class="my-auto py-2">
            <div class="font-sans font-light text-3xl sm:text-4xl tracking-tighter tabular-nums ${summary.fuelCoveredPct >= 100 ? 'text-[var(--accent-volt)]' : (summary.fuelCoveredPct > 0 ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]')} leading-none">
              ${Math.max(0, summary.fuelCoveredPct)}%
            </div>
          </div>
          <div class="pt-2 border-t border-[var(--line-hair)] text-[9px] uppercase tracking-wider text-[var(--text-secondary)] tabular-nums truncate">
            ${summary.fuelCoveredStatus}
          </div>
        </div>

        <!-- Tarjeta 3: KILÓMETROS EXTRA TOTALES -->
        <div class="p-4 sm:p-5 flex flex-col justify-between min-h-[140px]">
          <div class="text-[10px] uppercase tracking-widest text-[var(--text-secondary)] font-medium">
            KILÓMETROS EXTRA TOTALES
          </div>
          <div class="my-auto py-2">
            <div class="font-sans font-light text-3xl sm:text-4xl tracking-tighter tabular-nums text-[var(--text-primary)] leading-none">
              ${summary.totalExtraKm.toFixed(1)} <span class="text-xl sm:text-2xl text-[var(--text-secondary)]">KM</span>
            </div>
          </div>
          <div class="pt-2 border-t border-[var(--line-hair)] text-[9px] uppercase tracking-wider text-[var(--text-secondary)] tabular-nums truncate">
            ${summary.totalDeclaredKm.toFixed(1)} KM CARRERAS · ${summary.totalPickupKm.toFixed(1)} KM RECOGIDA
          </div>
        </div>

        <!-- Tarjeta 4: FONDO DE DESGASTE SUGERIDO -->
        <div class="p-4 sm:p-5 flex flex-col justify-between min-h-[140px]">
          <div class="text-[10px] uppercase tracking-widest text-[var(--text-secondary)] font-medium">
            FONDO DE DESGASTE SUGERIDO
          </div>
          <div class="my-auto py-2">
            <div class="font-sans font-light text-3xl sm:text-4xl tracking-tighter tabular-nums text-[var(--accent-amber)] leading-none">
              $${summary.wearReserveCop.toLocaleString('es-CO')}
            </div>
          </div>
          <div class="pt-2 border-t border-[var(--line-hair)] text-[9px] uppercase tracking-wider text-[var(--text-secondary)] tabular-nums truncate">
            ${summary.wearReservePct}% DEL INGRESO BRUTO
          </div>
        </div>

      </section>

      <!-- =====================================================================
           LISTA UNIFICADA DE MOVIMIENTOS
           ===================================================================== -->
      <section id="rides-unified-log-root"></section>

    </div>
  `;

  // Bind Cycle switcher pills
  const cyclePills = container.querySelectorAll('.cycle-pill');
  cyclePills.forEach(pill => {
    pill.addEventListener('click', () => {
      const selected = pill.dataset.cycle;
      if (selected && selected !== activeCycle) {
        playHorologyTick(1200, 0.012, 0.02);
        currentCycleOffset = 0;
        try {
          localStorage.setItem(CYCLE_STORAGE_KEY, selected);
        } catch (_) {}
        renderRidesView(container);
      }
    });
  });

  // Bind Period Navigation Buttons (← / → / ACTUAL)
  const navigatePeriod = (delta) => {
    if (delta < 0 && !summary.canGoPrev) return;
    if (delta > 0 && !summary.canGoNext) return;
    playHorologyTick(delta < 0 ? 960 : 1240, 0.014, 0.024);
    currentCycleOffset = Math.min(0, currentCycleOffset + delta);
    renderRidesView(container);
  };

  container.querySelector('#btn-cycle-prev')?.addEventListener('click', () => navigatePeriod(-1));
  container.querySelector('#btn-cycle-next')?.addEventListener('click', () => navigatePeriod(1));
  container.querySelector('#btn-rides-report')?.addEventListener('click', () => { openDiagnosticModal('this_month'); });
  container.querySelector('#btn-cycle-today')?.addEventListener('click', () => {
    playHorologyTick(1350, 0.014, 0.024);
    currentCycleOffset = 0;
    renderRidesView(container);
  });

  // Bind Horizontal Swipe Gestures (Swipe right -> previous period, Swipe left -> next period up to current)
  const swipeStage = container.querySelector('#rides-swipe-stage');
  if (swipeStage) {
    let touchStartX = null;
    let touchStartY = null;

    swipeStage.addEventListener('touchstart', (ev) => {
      const t = ev.touches?.[0];
      if (!t) return;
      touchStartX = t.clientX;
      touchStartY = t.clientY;
    }, { passive: true });

    swipeStage.addEventListener('touchend', (ev) => {
      if (touchStartX === null || touchStartY === null) return;
      const t = ev.changedTouches?.[0];
      if (!t) return;
      const dx = t.clientX - touchStartX;
      const dy = t.clientY - touchStartY;
      touchStartX = null;
      touchStartY = null;

      if (Math.abs(dx) >= 50 && Math.abs(dy) < 35) {
        if (dx > 0) {
          // Swipe right -> go back in time
          navigatePeriod(-1);
        } else {
          // Swipe left -> go forward towards current period
          navigatePeriod(1);
        }
      }
    }, { passive: true });
  }

  // Mount Unified Movements Log
  const logRoot = container.querySelector('#rides-unified-log-root');
  if (logRoot) {
    renderRideSessionLog(logRoot, {
      sessions,
      passes,
      startDate: summary.startDate,
      endDate: summary.endDate,
      onMovementChanged: () => renderRidesView(container)
    });
  }

  // Reactive updates
  const updateHandler = () => {
    // Nunca repintar Carreras si el usuario ya está en otra pestaña (pisaba la vista activa).
    if (store.getState().currentView !== 'rides') return;
    if (document.body.contains(container)) {
      renderRidesView(container);
    }
  };

  const addListener = (event) => {
    window.addEventListener(event, updateHandler);
    boundListeners.push({ event, handler: updateHandler });
  };

  addListener('octane:rides-updated');
  addListener('octane:logs-updated');
  addListener('octane:profile-updated');
}
