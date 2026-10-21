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

import { playHorologyTick } from '../core/state.js';
import { getRideSessions, getPlatformPasses, getVehicleProfile, getTelemetryLogs } from '../core/db-local.js';
import { calculateTelemetryModel } from '../core/telemetry-engine.js';
import {
  calculateRidesCycleSummary,
  calculateCostPerKm,
  formatCop,
  formatCompactCop
} from '../core/rides-engine.js';
import { renderRideSessionLog } from '../components/rides/ride-session-log.js';
import { openRideEntryModal } from '../components/modals/modal-ride-entry.js';

let currentContainer = null;
let boundListeners = [];

const CYCLES = [
  { id: '3d', label: 'Cada 3 días' },
  { id: 'week', label: 'Semanal' },
  { id: '15d', label: 'Quincenal' },
  { id: 'month', label: 'Mensual' },
  { id: 'tank_cycle', label: 'Ciclo actual' }
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
    cycleType: activeCycle
  });

  const costPerKm = calculateCostPerKm({
    telemetryModel,
    vehicleProfile: profile
  });

  const freeProfitFormatted = formatCop(summary.freeNetProfitCop, true);
  const grossShort = formatCompactCop(summary.grossRevenueCop);
  const expShort = formatCompactCop(summary.totalExpensesCop);
  const fuelShort = formatCompactCop(summary.fuelExpenseCop);

  container.innerHTML = `
    <div class="view-rides max-w-5xl mx-auto space-y-5 pb-20 select-none font-mono">
      
      <!-- Top Header con Selector de Ciclo (Cero // ni prefijos numéricos) -->
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

        <!-- Selector de Ciclo Horizontal -->
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

      <!-- Barra de Acciones Rápidas (+ Carrera y - Egreso) -->
      <div class="flex items-center justify-between px-4 py-2.5 bg-[var(--bg-void)] border border-[var(--line-hair)]">
        <div class="flex items-center gap-2 text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">
          <span class="w-1.5 h-1.5 rounded-full ${summary.sessionCount > 0 ? 'bg-[var(--accent-volt)] animate-pulse' : 'bg-[var(--text-muted)]'}"></span>
          <span class="tabular-nums">${summary.startDate} — ${summary.endDate}</span>
        </div>

        <div class="flex items-center gap-2">
          <button 
            id="btn-header-add-ride" 
            type="button" 
            class="h-7 px-3 border border-[var(--line-hair)] hover:border-[var(--accent-volt)] bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--accent-volt)] transition-colors cursor-pointer flex items-center gap-1"
          >
            <span>+</span>
            <span>CARRERA</span>
          </button>
          
          <button 
            id="btn-header-add-expense" 
            type="button" 
            class="h-7 px-3 border border-[var(--line-hair)] hover:border-[var(--accent-crimson)] bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--accent-crimson)] transition-colors cursor-pointer flex items-center gap-1"
          >
            <span>-</span>
            <span>EGRESO</span>
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
            <div class="font-sans font-light text-3xl sm:text-4xl tracking-tighter tabular-nums ${summary.fuelCoveredPct > 0 ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'} leading-none">
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
            ${summary.totalDeclaredKm.toFixed(1)}K CARRERAS · ${summary.totalPickupKm.toFixed(1)}K RECOGIDA
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
        try {
          localStorage.setItem(CYCLE_STORAGE_KEY, selected);
        } catch (_) {}
        renderRidesView(container);
      }
    });
  });

  // Bind Quick Add Buttons
  container.querySelector('#btn-header-add-ride')?.addEventListener('click', () => {
    openRideEntryModal({
      mode: 'ride',
      onSave: () => renderRidesView(container)
    });
  });

  container.querySelector('#btn-header-add-expense')?.addEventListener('click', () => {
    openRideEntryModal({
      mode: 'expense',
      onSave: () => renderRidesView(container)
    });
  });

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
