/**
 * OCTANE — Carreras View ("view-rides.js")
 * Transparent GPS-Reconciled Financial Accounting for Urban Rides.
 *
 * Features:
 * - Accounting Mode Switch (persisted):
 *     * "GAS TOTAL": Net pocket profit after covering 100% of the vehicle's real fuel in the period.
 *     * "SOLO CARRERAS": Operating margin discounting only fuel attributed to rides + pickup.
 *   Both figures remain visible simultaneously for total financial transparency.
 * - Fuel Coverage always compared against exact GPS calibrated vehicle fuel (matching GPS Data).
 * - GPS Reconciliation Bar conserving 100% of distance (Carreras + Recogida + Rutina/Personal)
 *   and 100% of fuel cost, with 1-tap jump to the GPS map inspector.
 * - Silencio Verbal Absoluto: Zero <p> tags, zero nested boxes, 1px hairline dividers.
 */

import { playHorologyTick, store } from '../core/state.js';
import { todayLocalYmd } from '../core/date-utils.js';
import { getRideSessions, getPlatformPasses, getVehicleProfile, getTelemetryLogs } from '../core/db-local.js';
import { calculateTelemetryModel } from '../core/telemetry-engine.js';
import {
  calculateRidesCycleSummary,
  formatCop,
  formatCompactCop
} from '../core/rides-engine.js';
import { renderRideSessionLog } from '../components/rides/ride-session-log.js';
import { openDiagnosticModal } from '../components/modals/modal-diagnostic.js';
import { openGpsTripsModal } from '../components/modals/modal-gps-trips.js';

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
const ACCOUNTING_MODE_KEY = 'octane_rides_accounting_mode';

function getStoredAccountingMode() {
  try {
    const saved = localStorage.getItem(ACCOUNTING_MODE_KEY);
    if (saved === 'total_fuel' || saved === 'marginal') return saved;
  } catch (_) {}
  return 'total_fuel';
}

function setStoredAccountingMode(mode) {
  try {
    localStorage.setItem(ACCOUNTING_MODE_KEY, mode);
  } catch (_) {}
}

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
 * Renders the transparent GPS-reconciled Carreras view.
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

  const accountingMode = getStoredAccountingMode();
  const isTotalFuelMode = accountingMode === 'total_fuel';

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
    cycleOffset: currentCycleOffset,
    accountingMode
  });

  currentCycleOffset = summary.cycleOffset ?? currentCycleOffset;

  // Contextual date for FAB: today in active period, last day of period in past periods
  {
    const today = todayLocalYmd();
    let ctxDate = today;
    if (!summary.isCurrentPeriod && summary.endDate) {
      ctxDate = String(summary.endDate).slice(0, 10);
      if (ctxDate > today) ctxDate = today;
    }
    store.setState({ ridesContextDate: ctxDate });
  }

  const primaryProfit = summary.activeNetProfitCop;
  const primaryProfitFormatted = formatCop(primaryProfit, true);

  const grossShort = formatCompactCop(summary.grossRevenueCop);
  const expShort = formatCompactCop(summary.totalExpensesCop);
  const activeFuelCost = isTotalFuelMode ? summary.periodCarFuelCop : summary.fuelExpenseCop;
  const activeFuelShort = formatCompactCop(activeFuelCost);
  const crossRefLabel = isTotalFuelMode
    ? `SOLO CARRERAS: ${formatCop(summary.marginalNetProfitCop, true)}`
    : `CON GAS TOTAL: ${formatCop(summary.totalFuelNetProfitCop, true)}`;

  const periodRangeText = summary.displayRange
    ? summary.displayRange
    : (summary.startDate === summary.endDate ? summary.startDate : `${summary.startDate} — ${summary.endDate}`);

  const rateSourceTag = summary.fuelSource === 'gps_calibrated' ? 'GPS' : 'BASE';
  const hourlyStr = summary.activeProfitPerHourCop !== null && summary.activeProfitPerHourCop !== undefined
    ? ` · ${formatCop(summary.activeProfitPerHourCop, false)}/H (${summary.totalGpsWorkHours.toFixed(1)}H)`
    : '';

  // Distance conservation breakdown
  const hasCarKm = summary.periodCarKm > 0;
  const nonWorkKm = Number(Math.max(0, summary.periodCarKm - summary.totalDeclaredKm - summary.totalPickupKm).toFixed(1));
  const declaredPct = hasCarKm ? Math.min(100, Math.round((summary.totalDeclaredKm / summary.periodCarKm) * 100)) : 0;
  const pickupPct = hasCarKm ? Math.min(100 - declaredPct, Math.round((summary.totalPickupKm / summary.periodCarKm) * 100)) : 0;
  const personalPct = hasCarKm ? Math.max(0, 100 - declaredPct - pickupPct) : 0;

  const declaredFuelEst = hasCarKm && summary.periodCarFuelCop > 0
    ? Math.round(summary.periodCarFuelCop * Math.min(1, summary.totalDeclaredKm / summary.periodCarKm))
    : 0;
  const pickupFuelEst = Math.max(0, summary.fuelExpenseCop - declaredFuelEst);
  const personalFuelEst = Math.max(0, summary.periodCarFuelCop - summary.fuelExpenseCop);

  const kmFooterLine2 = hasCarKm
    ? `TOTAL: ${summary.periodCarKm.toFixed(1)} KM · ${nonWorkKm.toFixed(1)} RUTINA`
    : (summary.deadheadSource === 'estimated' ? 'RECOGIDA ESTIMADA (SIN GPS/ODO)' : '');

  container.innerHTML = `
    <div id="rides-swipe-stage" class="view-rides max-w-5xl mx-auto space-y-5 pb-20 select-none font-mono">
      
      <!-- Top Header con Selector de División de Tiempo -->
      <header class="border-b border-[var(--line-hair)] pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div class="flex items-center gap-2.5 flex-wrap">
          <span class="w-2.5 h-2.5 bg-[var(--accent-volt)] shrink-0"></span>
          <h1 class="font-mono text-sm uppercase tracking-widest text-[var(--text-primary)] font-semibold">
            Carreras
          </h1>
          <span class="text-[10px] text-[var(--text-secondary)] font-normal tracking-wider tabular-nums">
            · $${summary.effectiveCostPerKmCop}/KM ${rateSourceTag}${hourlyStr}
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

      <!-- Barra de Periodo Calendario, Modo Contable y Navegador -->
      <div class="flex flex-wrap items-center justify-between gap-2.5 px-4 py-2.5 bg-[var(--bg-void)] border border-[var(--line-hair)]">
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

        <div class="flex items-center gap-2 flex-wrap sm:flex-nowrap shrink-0 ml-auto">
          <!-- Switch Contable: GAS TOTAL (100% gasolina carro) vs SOLO CARRERAS (marginal) -->
          <div class="inline-flex border border-[var(--line-hair)] bg-[var(--bg-surface)] divide-x divide-[var(--line-hair)]" role="group" aria-label="Modo de descuento de gasolina">
            <button
              type="button"
              data-accounting-mode="total_fuel"
              class="btn-accounting-mode px-2 py-1 font-mono text-[9px] uppercase tracking-wider cursor-pointer transition-colors ${isTotalFuelMode ? 'bg-[var(--text-primary)] text-[var(--bg-void)] font-bold' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}"
              title="Descuenta el 100% de la gasolina real usada por el vehículo en el periodo"
            >
              GAS TOTAL
            </button>
            <button
              type="button"
              data-accounting-mode="marginal"
              class="btn-accounting-mode px-2 py-1 font-mono text-[9px] uppercase tracking-wider cursor-pointer transition-colors ${!isTotalFuelMode ? 'bg-[var(--text-primary)] text-[var(--bg-void)] font-bold' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}"
              title="Descuenta únicamente la gasolina atribuida a las carreras y recogidas"
            >
              SOLO CARRERAS
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
      </div>

      <!-- 4 TARJETAS LIMPIAS (Contenedor plano sin cajas dentro de cajas) -->
      <section class="flat-frame bg-[var(--bg-surface)] border border-[var(--line-hair)] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[var(--line-hair)] overflow-hidden">
        
        <!-- Tarjeta 1: GANANCIA REAL (GAS TOTAL) o MARGEN CARRERAS -->
        <div class="p-4 sm:p-5 flex flex-col justify-between min-h-[152px]">
          <div class="flex items-center justify-between gap-2 text-[10px] uppercase tracking-widest text-[var(--text-secondary)] font-medium">
            <span>${isTotalFuelMode ? 'GANANCIA REAL' : 'MARGEN CARRERAS'}</span>
            <span class="text-[8px] px-1.5 py-0.5 border border-[var(--line-hair)] text-[var(--text-muted)]">
              ${isTotalFuelMode ? '100% GAS' : 'MARGINAL'}
            </span>
          </div>
          <div class="my-auto py-2">
            <div class="font-sans font-light text-3xl sm:text-4xl tracking-tighter tabular-nums ${primaryProfit >= 0 ? 'text-[var(--accent-volt)]' : 'text-[var(--accent-crimson)]'} leading-none">
              ${primaryProfitFormatted}
            </div>
          </div>
          <div class="pt-2 border-t border-[var(--line-hair)] space-y-1 text-[9px] uppercase tracking-wider tabular-nums">
            <div class="text-[var(--text-secondary)] truncate">
              BRUTO ${grossShort} · EGR -${expShort} · GAS -${activeFuelShort}
            </div>
            <div class="text-[var(--text-muted)] truncate">
              ${crossRefLabel}
            </div>
          </div>
        </div>

        <!-- Tarjeta 2: GASOLINA CUBIERTA (Reconciliada contra el gasto real del carro) -->
        <div class="p-4 sm:p-5 flex flex-col justify-between min-h-[152px]">
          <div class="flex items-center justify-between gap-2 text-[10px] uppercase tracking-widest text-[var(--text-secondary)] font-medium">
            <span>GASOLINA CUBIERTA</span>
            ${summary.fuelSource === 'gps_calibrated' ? `
              <span class="text-[8px] text-[var(--accent-volt)]">CALIBRADO</span>
            ` : ''}
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

        <!-- Tarjeta 3: KILÓMETROS EXTRA Y RECOGIDA (Conservados contra el total del carro) -->
        <div class="p-4 sm:p-5 flex flex-col justify-between min-h-[152px]">
          <div class="text-[10px] uppercase tracking-widest text-[var(--text-secondary)] font-medium">
            KILÓMETROS DE TRABAJO
          </div>
          <div class="my-auto py-2">
            <div class="font-sans font-light text-3xl sm:text-4xl tracking-tighter tabular-nums text-[var(--text-primary)] leading-none">
              ${summary.totalExtraKm.toFixed(1)} <span class="text-xl sm:text-2xl text-[var(--text-secondary)]">KM</span>
            </div>
          </div>
          <div class="pt-2 border-t border-[var(--line-hair)] space-y-1 text-[9px] uppercase tracking-wider tabular-nums">
            <div class="text-[var(--text-secondary)] truncate">
              ${summary.totalDeclaredKm.toFixed(1)} CARRERAS · ${summary.totalPickupKm.toFixed(1)} RECOGIDA
            </div>
            <div class="text-[var(--text-muted)] truncate">
              ${kmFooterLine2}
            </div>
          </div>
        </div>

        <!-- Tarjeta 4: FONDO DE DESGASTE SUGERIDO -->
        <div class="p-4 sm:p-5 flex flex-col justify-between min-h-[152px]">
          <div class="text-[10px] uppercase tracking-widest text-[var(--text-secondary)] font-medium">
            FONDO DE DESGASTE
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

      <!-- Barra de Auditoría GPS (conservación 100% de KM y gasolina real del periodo) -->
      ${hasCarKm ? `
        <section class="flat-frame bg-[var(--bg-surface)] border border-[var(--line-hair)] px-4 sm:px-5 py-3.5 space-y-2.5">
          <div class="flex flex-wrap items-center justify-between gap-2 text-[10px] uppercase tracking-wider">
            <div class="flex items-center gap-2 flex-wrap min-w-0">
              <span class="w-1.5 h-1.5 rounded-full ${summary.periodGpsDaysCount > 0 ? 'bg-[var(--accent-volt)]' : 'bg-[var(--text-muted)]'} shrink-0"></span>
              <span class="text-[var(--text-primary)] font-semibold">
                ${summary.periodGpsDaysCount > 0 ? 'AUDITORÍA GPS' : 'DESGLOSE DE RECORRIDO'}
              </span>
              <span class="text-[var(--text-secondary)] tabular-nums">
                · ${summary.periodCarKm.toFixed(1)} KM · $${summary.periodCarFuelCop.toLocaleString('es-CO')}
              </span>
              ${summary.workWindowLabel && activeCycle === 'day' ? `
                <span class="text-[var(--accent-amber)] tabular-nums">
                  · BLOQUE ${summary.workWindowLabel}
                </span>
              ` : ''}
            </div>

            ${summary.periodGpsDaysCount > 0 ? `
              <button
                id="btn-rides-open-gps"
                type="button"
                class="text-[10px] uppercase tracking-wider text-[var(--accent-amber)] hover:opacity-80 transition-opacity cursor-pointer shrink-0"
              >
                VER MAPA GPS →
              </button>
            ` : ''}
          </div>

          <!-- Barra proporcional 3px -->
          <div class="h-[3px] w-full flex bg-[var(--line-hair)] overflow-hidden">
            ${declaredPct > 0 ? `<div class="h-full bg-[var(--accent-volt)]" style="width: ${declaredPct}%"></div>` : ''}
            ${pickupPct > 0 ? `<div class="h-full bg-[var(--accent-amber)]" style="width: ${pickupPct}%"></div>` : ''}
            ${personalPct > 0 ? `<div class="h-full bg-[var(--line-strong)]" style="width: ${personalPct}%"></div>` : ''}
          </div>

          <!-- Leyenda exacta (suma 100% del kilometraje y del gasto del carro) -->
          <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[9px] uppercase tracking-wider tabular-nums text-[var(--text-secondary)]">
            <span class="inline-flex items-center gap-1.5">
              <span class="w-1.5 h-1.5 bg-[var(--accent-volt)]"></span>
              CARRERAS ${summary.totalDeclaredKm.toFixed(1)} KM (${formatCompactCop(declaredFuelEst)})
            </span>
            <span class="inline-flex items-center gap-1.5">
              <span class="w-1.5 h-1.5 bg-[var(--accent-amber)]"></span>
              RECOGIDA ${summary.totalPickupKm.toFixed(1)} KM (${formatCompactCop(pickupFuelEst)})
            </span>
            <span class="inline-flex items-center gap-1.5">
              <span class="w-1.5 h-1.5 bg-[var(--line-strong)]"></span>
              RUTINA ${nonWorkKm.toFixed(1)} KM (${formatCompactCop(personalFuelEst)})
            </span>
          </div>
        </section>
      ` : ''}

      <!-- LISTA UNIFICADA DE MOVIMIENTOS -->
      <section id="rides-unified-log-root"></section>

    </div>
  `;

  // Bind Cycle switcher pills
  container.querySelectorAll('.cycle-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const selected = pill.dataset.cycle;
      if (selected && selected !== activeCycle) {
        playHorologyTick(1200, 0.012, 0.02);
        currentCycleOffset = 0;
        try { localStorage.setItem(CYCLE_STORAGE_KEY, selected); } catch (_) {}
        renderRidesView(container);
      }
    });
  });

  // Bind Accounting Mode switch
  container.querySelectorAll('.btn-accounting-mode').forEach(btn => {
    btn.addEventListener('click', () => {
      const nextMode = btn.getAttribute('data-accounting-mode');
      if (nextMode && nextMode !== accountingMode) {
        playHorologyTick(1250, 0.012, 0.025);
        setStoredAccountingMode(nextMode);
        renderRidesView(container);
      }
    });
  });

  // Open GPS Map Inspector directly from Carreras
  container.querySelector('#btn-rides-open-gps')?.addEventListener('click', () => {
    playHorologyTick(1200, 0.012, 0.02);
    openGpsTripsModal({
      initialScope: 'cycle',
      cycleStartDate: summary.startDate,
      cycleEndDate: summary.endDate
    });
  });

  // Bind Period Navigation Buttons
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

  // Horizontal Swipe Gestures
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
        if (dx > 0) navigatePeriod(-1);
        else navigatePeriod(1);
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
