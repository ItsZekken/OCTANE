/**
 * OCTANE — KINETIC — Modal de Informe Financiero y de Consumo ("modal-diagnostic.js")
 * 
 * Dirección de Arte Suizo-Japonesa (Bento Monolítico de Alta Precisión):
 * - Cero barras de desplazamiento nativas (scrollbar-width: none, ::-webkit-scrollbar: none).
 * - Lienzo de Cero Fricción: División con líneas arquitectónicas de 1px (divide-x, divide-y).
 * - Hero Statement: Macro-balance de bolsillo a escala monumental (+-$XX.XXX).
 * - Espectro Visual de Combustible: Barra segmentada proporcional (Rutina, En Viaje, Recogida).
 * - Tarjetas de Telemetría por Canal: Filas estilo podio con split bar bicolor (% En Ruta vs % Libre).
 * - Silencio Verbal Absoluto: Cero etiquetas <p>, cero símbolos "//", máximo 3 palabras por etiqueta.
 * - Exportación a PDF/Impresión en 1 página A4 mediante #print-mount y window.print().
 */

import { playHorologyTick, showToast } from '../../core/state.js';
import {
  getRideSessions,
  getPlatformPasses,
  getVehicleProfile,
  getTelemetryLogs,
  getMaintenanceItems,
  deleteRideSession
} from '../../core/db-local.js';
import { calculateTelemetryModel, formatNumber } from '../../core/telemetry-engine.js';
import {
  generateOperationalDiagnostic,
  fmtCop,
  fmtCompact
} from '../../core/diagnostic-engine.js';
import { pushOverlayLayer, removeOverlayLayer } from '../../core/navigation-manager.js';

const LAYER_ID = 'modal:diagnostic';
let modalContainer = null;
let currentPeriodKey = 'this_month';
let ignoredAnomalies = new Set();

/**
 * Inicializa el contenedor DOM para el modal de diagnóstico.
 */
export function initDiagnosticModal() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('modal-diagnostic-root')) {
    modalContainer = document.getElementById('modal-diagnostic-root');
    return;
  }

  modalContainer = document.createElement('div');
  modalContainer.id = 'modal-diagnostic-root';
  modalContainer.className = 'fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-5 bg-black/85 opacity-0 pointer-events-none transition-opacity duration-150 select-none';
  document.body.appendChild(modalContainer);

  modalContainer.addEventListener('click', (e) => {
    if (e.target === modalContainer && !modalContainer.classList.contains('pointer-events-none')) {
      closeDiagnosticModal();
    }
  });

  window.addEventListener('octane:open-diagnostic-modal', (e) => {
    openDiagnosticModal(e.detail?.periodFilter || 'this_month');
  });
}

/**
 * Cierra el modal de informe financiero.
 */
export function closeDiagnosticModal() {
  removeOverlayLayer(LAYER_ID);
  if (modalContainer && !modalContainer.classList.contains('pointer-events-none')) {
    playHorologyTick(850, 0.012, 0.02);
    modalContainer.classList.remove('opacity-100', 'pointer-events-auto');
    modalContainer.classList.add('opacity-0', 'pointer-events-none');
    modalContainer.innerHTML = '';
  }
}

/**
 * Abre el modal y renderiza el informe financiero con los datos actuales.
 * @param {string|Object} [periodFilter='this_month']
 */
export async function openDiagnosticModal(periodFilter = 'this_month') {
  if (!modalContainer) initDiagnosticModal();
  currentPeriodKey = (typeof periodFilter === 'string') ? periodFilter : 'this_month';

  playHorologyTick(1400, 0.02, 0.035);

  modalContainer.classList.remove('opacity-0', 'pointer-events-none');
  modalContainer.classList.add('opacity-100', 'pointer-events-auto');
  pushOverlayLayer(LAYER_ID, () => closeDiagnosticModal());

  await renderDiagnosticContent();
}

/**
 * Monta el documento de impresión en #print-mount y dispara window.print().
 * Formato editorial suizo monocromático de 1 sola página A4.
 * 
 * @param {Object} diag
 * @param {Object} profile
 */
export function exportReportToPrint(diag, profile) {
  let printMount = document.getElementById('print-mount');
  if (!printMount) {
    printMount = document.createElement('div');
    printMount.id = 'print-mount';
    document.body.appendChild(printMount);
  }

  const { cashFlow, fuelBreakdown, pocketBalance, platformBreakdown, periodRange, vehicleProfile } = diag;

  printMount.innerHTML = `
    <div style="font-family: 'JetBrains Mono', monospace; color: #000; padding: 4mm 0; line-height: 1.3; font-size: 10px;">
      
      <!-- Encabezado Editorial A4 -->
      <div style="border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: flex-end;">
        <div>
          <div style="font-size: 14px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;">
            OCTANE — INFORME FINANCIERO
          </div>
          <div style="font-size: 9px; color: #555; text-transform: uppercase; margin-top: 3px;">
            ${vehicleProfile.name} · ODÓMETRO: ${formatNumber(vehicleProfile.currentOdometer)} KM · TANQUE: ${vehicleProfile.tankCapacityGallons} GAL
          </div>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 11px; font-weight: 600;">${periodRange.label}: ${periodRange.displayRange}</div>
          <div style="font-size: 8.5px; color: #666;">GENERADO EL ${new Date().toLocaleDateString('es-CO')}</div>
        </div>
      </div>

      <!-- Hero Statement Impreso -->
      <div style="border: 1px solid #000; padding: 14px; margin-bottom: 12px; text-align: center; background: #fafafa;">
        <div style="font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #555;">
          BALANCE FINAL TRAS GASOLINA TOTAL
        </div>
        <div style="font-size: 26px; font-weight: 700; margin: 6px 0;">
          ${pocketBalance.isFinalPocketPositive ? `+${fmtCop(pocketBalance.finalPocketCop)}` : `-${fmtCop(pocketBalance.outOfPocketCop)}`}
        </div>
        <div style="display: inline-block; border: 1px solid #000; padding: 3px 8px; font-size: 9px; font-weight: 600;">
          ${pocketBalance.totalFuelCoveredPct}% DE TU GASOLINA TOTAL CUBIERTA
        </div>
      </div>

      <!-- 4 Celdas de Flujo de Caja -->
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid #000; margin-bottom: 12px;">
        <div style="padding: 8px; border-right: 1px solid #000;">
          <div style="font-size: 8px; text-transform: uppercase; color: #555;">INGRESO NETO</div>
          <div style="font-size: 15px; font-weight: 700; margin: 3px 0;">${fmtCop(cashFlow.netAppRevenueCop)}</div>
          <div style="font-size: 8px; color: #666;">Comisiones: -${fmtCompact(cashFlow.totalExpensesCop)}</div>
        </div>
        <div style="padding: 8px; border-right: 1px solid #000;">
          <div style="font-size: 8px; text-transform: uppercase; color: #555;">POR SALIDA</div>
          <div style="font-size: 15px; font-weight: 700; margin: 3px 0;">${fmtCop(cashFlow.avgProfitPerShift)}</div>
          <div style="font-size: 8px; color: #666;">${cashFlow.activeDaysCount} ${cashFlow.activeDaysCount === 1 ? 'día activo' : 'días activos'}</div>
        </div>
        <div style="padding: 8px; border-right: 1px solid #000;">
          <div style="font-size: 8px; text-transform: uppercase; color: #555;">${cashFlow.card3Label}</div>
          <div style="font-size: 15px; font-weight: 700; margin: 3px 0;">${fmtCop(cashFlow.card3Value)}</div>
          <div style="font-size: 8px; color: #666;">${cashFlow.card3SubLabel}</div>
        </div>
        <div style="padding: 8px;">
          <div style="font-size: 8px; text-transform: uppercase; color: #555;">RESERVA DESGASTE</div>
          <div style="font-size: 15px; font-weight: 700; margin: 3px 0;">${fmtCop(cashFlow.wearReserveCop)}</div>
          <div style="font-size: 8px; color: #666;">10% sugerido</div>
        </div>
      </div>

      <!-- Distribución de Combustible -->
      <div style="border: 1px solid #000; padding: 10px; margin-bottom: 12px;">
        <div style="display: flex; justify-content: space-between; border-bottom: 1px solid #ccc; padding-bottom: 4px; margin-bottom: 8px;">
          <span style="font-size: 9px; font-weight: 700; text-transform: uppercase;">DISTRIBUCIÓN DE COMBUSTIBLE</span>
          <span style="font-size: 9px; font-weight: 700;">${fmtCop(fuelBreakdown.totalCarFuelCop)}</span>
        </div>
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">
          <div>
            <div style="font-size: 8px; text-transform: uppercase; color: #555;">RUTINA</div>
            <div style="font-size: 13px; font-weight: 700; margin: 2px 0;">${fmtCop(fuelBreakdown.fuelBaseCop)}</div>
            <div style="font-size: 8px; color: #666;">${fuelBreakdown.kmBase} KM</div>
          </div>
          <div>
            <div style="font-size: 8px; text-transform: uppercase; color: #555;">EN VIAJE</div>
            <div style="font-size: 13px; font-weight: 700; margin: 2px 0;">${fmtCop(fuelBreakdown.fuelRidesCop)}</div>
            <div style="font-size: 8px; color: #666;">${fuelBreakdown.kmRides} KM</div>
          </div>
          <div>
            <div style="font-size: 8px; text-transform: uppercase; color: #555;">RECOGIDA</div>
            <div style="font-size: 13px; font-weight: 700; margin: 2px 0;">${fmtCop(fuelBreakdown.fuelPickupCop)}</div>
            <div style="font-size: 8px; color: #666;">${fuelBreakdown.kmPickup} KM</div>
          </div>
        </div>
      </div>

      <!-- Ranking de Canales Simplificado -->
      <div style="border: 1px solid #000; margin-bottom: 10px;">
        <div style="font-size: 9px; font-weight: 700; text-transform: uppercase; background: #eee; padding: 5px 8px; border-bottom: 1px solid #000; display: flex; justify-content: space-between;">
          <span>EFICIENCIA POR CANAL</span>
          <span style="color: #666;">ORDENADO POR TARIFA $/KM</span>
        </div>
        <div>
          ${platformBreakdown.length > 0 ? platformBreakdown.map((p) => `
            <div style="padding: 6px 8px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <div style="font-weight: 700; font-size: 11px;">${p.platform}</div>
                <div style="font-size: 8px; color: #666;">${p.tripsCount} ${p.tripsCount === 1 ? 'viaje' : 'viajes'} · ${p.totalKm} km</div>
              </div>
              <div style="text-align: right;">
                <div style="font-size: 11px; font-weight: 700;">${fmtCop(p.ratePerKmCop)} / km</div>
                <div style="font-size: 8px; color: #666;">${fmtCop(p.grossRevenueCop)} total</div>
              </div>
            </div>
          `).join('') : `
            <div style="padding: 12px; text-align: center; color: #777; font-size: 9px;">SIN REGISTROS EN ESTE PERIODO</div>
          `}
        </div>
      </div>

      <!-- Pie Editorial -->
      <div style="display: flex; justify-content: space-between; font-size: 8px; color: #666; border-top: 1px solid #ccc; padding-top: 4px;">
        <span>OCTANE TELEMETRÍA VEHICULAR</span>
        <span>HOJA DE BALANCE OPERATIVO · PÁGINA 1 DE 1</span>
      </div>

    </div>
  `;

  setTimeout(() => {
    window.print();
  }, 100);
}

/**
 * Carga datos locales y renderiza el árbol HTML del modal interactivo.
 */
async function renderDiagnosticContent() {
  if (!modalContainer) return;

  const [sessions, passes, profile, logs, maintenance] = await Promise.all([
    getRideSessions().catch(() => []),
    getPlatformPasses().catch(() => []),
    getVehicleProfile().catch(() => ({})),
    getTelemetryLogs().catch(() => []),
    getMaintenanceItems(true).catch(() => [])
  ]);

  const telemetryModel = calculateTelemetryModel(logs, profile);

  const diag = generateOperationalDiagnostic({
    telemetryLogs: logs,
    rideSessions: sessions,
    platformPasses: passes,
    maintenanceItems: maintenance,
    vehicleProfile: profile,
    telemetryModel
  }, currentPeriodKey);

  const activeAnomalies = diag.dataAnomalies.filter(a => !ignoredAnomalies.has(a.signature));
  const { cashFlow, fuelBreakdown, pocketBalance, platformBreakdown, periodRange } = diag;

  const periods = [
    { key: 'this_month', label: 'ESTE MES' },
    { key: 'prev_month', label: 'MES ANTERIOR' },
    { key: 'all_time', label: 'DESDE INICIO' }
  ];

  modalContainer.innerHTML = `
    <div id="modal-diagnostic-sheet" class="relative w-full max-w-5xl max-h-[92vh] overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden bg-[var(--bg-surface)] border border-[var(--line-hair)] text-[var(--text-primary)] font-mono flex flex-col shadow-2xl select-none divide-y divide-[var(--line-hair)]">
      
      <!-- Cabecera Principal del Informe Financiero (2 Filas) -->
      <header class="bg-[var(--bg-void)]">
        
        <!-- Fila Superior: Título, Rango de Fechas y Acciones -->
        <div class="px-5 sm:px-7 py-4 flex items-center justify-between gap-3 border-b border-[var(--line-hair)]">
          <div class="flex items-center gap-3 min-w-0">
            <span class="w-2.5 h-2.5 bg-[var(--accent-volt)] shrink-0"></span>
            <div class="truncate">
              <h2 class="text-sm sm:text-base font-semibold uppercase tracking-widest text-[var(--text-primary)] leading-none">
                INFORME FINANCIERO
              </h2>
              <span class="text-[10px] sm:text-[11px] text-[var(--text-secondary)] uppercase tracking-wider block tabular-nums mt-1">
                ${periodRange.displayRange} · ${periodRange.label}
              </span>
            </div>
          </div>

          <div class="flex items-center gap-2 shrink-0">
            <button 
              id="btn-report-export" 
              type="button" 
              class="px-2.5 sm:px-3 py-1.5 border border-[var(--line-hair)] bg-[var(--bg-surface)] text-[10px] uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--accent-volt)] hover:border-[var(--accent-volt)] transition-colors cursor-pointer flex items-center gap-1.5 shrink-0"
              title="Exportar a PDF / Imprimir"
            >
              <svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              <span>IMPRIMIR</span>
            </button>
            
            <button 
              id="btn-report-close" 
              type="button" 
              class="w-8 h-8 border border-[var(--line-hair)] bg-[var(--bg-surface)] text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-primary)] flex items-center justify-center transition-colors cursor-pointer shrink-0"
              aria-label="Cerrar modal"
            >
              ✕
            </button>
          </div>
        </div>

        <!-- Fila Inferior: Tira Selector de Periodo de Ancho Completo -->
        <div class="grid grid-cols-3 divide-x divide-[var(--line-hair)] bg-[var(--bg-surface)]">
          ${periods.map(p => {
            const isSel = currentPeriodKey === p.key;
            return `
              <button 
                type="button" 
                class="btn-period-switch py-2.5 sm:py-3 text-[10px] sm:text-xs uppercase tracking-wider transition-colors cursor-pointer text-center font-mono ${isSel ? 'bg-[var(--accent-volt)]/15 text-[var(--accent-volt)] font-bold' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]/30'}"
                data-period="${p.key}"
              >
                ${p.label}
              </button>
            `;
          }).join('')}
        </div>
      </header>

      <!-- =====================================================================
           ZONA 1: HERO DEL BOLSILLO (Centrado con mucho aire)
           ===================================================================== -->
      <section class="py-8 sm:py-12 px-6 text-center bg-[var(--bg-void)]">
        <span class="text-[10px] sm:text-xs uppercase tracking-[0.2em] text-[var(--text-secondary)] font-semibold block">
          BALANCE FINAL TRAS GASOLINA TOTAL
        </span>

        <div class="my-3">
          <div class="text-5xl sm:text-7xl font-light tracking-tighter tabular-nums leading-none ${pocketBalance.isFinalPocketPositive ? 'text-[var(--accent-volt)]' : 'text-[var(--accent-amber)]'}">
            ${pocketBalance.isFinalPocketPositive ? `+${fmtCop(pocketBalance.finalPocketCop)}` : `-${fmtCop(pocketBalance.outOfPocketCop)}`}
          </div>
        </div>

        <div class="inline-flex items-center justify-center mt-2">
          <span class="px-3 py-1 text-[10px] sm:text-[11px] uppercase tracking-wider font-mono font-medium ${pocketBalance.totalFuelCoveredPct >= 100 ? 'text-[var(--accent-volt)] bg-[var(--accent-volt)]/15 border border-[var(--accent-volt)]/40' : 'text-[var(--text-secondary)] bg-[var(--bg-elevated)] border border-[var(--line-hair)]'}">
            ${pocketBalance.totalFuelCoveredPct}% DE TU GASOLINA TOTAL CUBIERTA
          </span>
        </div>
      </section>

      <!-- =====================================================================
           ZONA 2: 4 MÉTRICAS CLAVE EN GRILLA 2X2 AIREADA
           ===================================================================== -->
      <section class="grid grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 divide-x divide-[var(--line-hair)] border-b border-[var(--line-hair)] bg-[var(--bg-surface)]">
        
        <!-- Celda 1: Ingreso Neto -->
        <div class="p-6 sm:p-7 flex flex-col justify-between">
          <span class="text-[10px] uppercase tracking-[0.16em] text-[var(--text-secondary)] block">
            INGRESO NETO
          </span>
          <div class="my-2">
            <span class="text-2xl sm:text-3xl font-light tabular-nums text-[var(--text-primary)]">
              ${fmtCop(cashFlow.netAppRevenueCop)}
            </span>
          </div>
          <span class="text-[11px] text-[var(--text-secondary)] tracking-wider truncate font-mono">
            Comisiones: -${fmtCompact(cashFlow.totalExpensesCop)}
          </span>
        </div>

        <!-- Celda 2: Por Salida -->
        <div class="p-6 sm:p-7 flex flex-col justify-between">
          <span class="text-[10px] uppercase tracking-[0.16em] text-[var(--text-secondary)] block">
            POR SALIDA
          </span>
          <div class="my-2">
            <span class="text-2xl sm:text-3xl font-light tabular-nums text-[var(--text-primary)]">
              ${fmtCop(cashFlow.avgProfitPerShift)}
            </span>
          </div>
          <span class="text-[11px] text-[var(--text-secondary)] tracking-wider font-mono">
            ${cashFlow.activeDaysCount} ${cashFlow.activeDaysCount === 1 ? 'día activo' : 'días activos'}${cashFlow.hourlyProfitCop !== null && cashFlow.hourlyProfitCop !== undefined ? ` · ${fmtCop(cashFlow.hourlyProfitCop)}/H REAL` : ''}
          </span>
        </div>

        <!-- Celda 3: Proyección o Ganancia Neta según periodo -->
        <div class="p-6 sm:p-7 flex flex-col justify-between">
          <span class="text-[10px] uppercase tracking-[0.16em] text-[var(--text-secondary)] block">
            ${cashFlow.card3Label}
          </span>
          <div class="my-2">
            <span class="text-2xl sm:text-3xl font-light tabular-nums text-[var(--text-primary)]">
              ${fmtCop(cashFlow.card3Value)}
            </span>
          </div>
          <span class="text-[11px] text-[var(--text-secondary)] tracking-wider truncate font-mono">
            ${cashFlow.card3SubLabel}
          </span>
        </div>

        <!-- Celda 4: Reserva Desgaste -->
        <div class="p-6 sm:p-7 flex flex-col justify-between">
          <span class="text-[10px] uppercase tracking-[0.16em] text-[var(--text-secondary)] block">
            RESERVA DESGASTE
          </span>
          <div class="my-2">
            <span class="text-2xl sm:text-3xl font-light tabular-nums text-[var(--text-primary)]">
              ${fmtCop(cashFlow.wearReserveCop)}
            </span>
          </div>
          <span class="text-[11px] text-[var(--text-secondary)] tracking-wider truncate font-mono">
            10% sugerido
          </span>
        </div>

      </section>

      <!-- =====================================================================
           ZONA 3: ANATOMÍA DEL COMBUSTIBLE (Bloque de ancho completo)
           ===================================================================== -->
      <section class="p-6 sm:p-8 bg-[var(--bg-void)]">
        <!-- Encabezado Limpio -->
        <div class="flex items-center justify-between pb-2 border-b border-[var(--line-hair)]">
          <span class="text-[10px] sm:text-xs uppercase tracking-[0.2em] text-[var(--text-secondary)] font-semibold">
            DISTRIBUCIÓN DE COMBUSTIBLE
          </span>
          <span class="text-sm sm:text-base font-light tabular-nums text-[var(--text-primary)] font-mono">
            ${fmtCop(fuelBreakdown.totalCarFuelCop)}${fuelBreakdown.gpsIdleFuelCop > 0 ? ` <span class="text-[10px] text-[var(--text-secondary)]">· RALENTÍ GPS ${fmtCop(fuelBreakdown.gpsIdleFuelCop)}</span>` : ''}
          </span>
        </div>

        <!-- Barra de Espectro Táctil -->
        <div class="h-3 rounded-sm overflow-hidden flex gap-0.5 my-5 bg-[var(--line-hair)]">
          <div style="width: ${fuelBreakdown.pctBase}%; background-color: #3F3F46;" title="Rutina: ${fuelBreakdown.pctBase}%"></div>
          <div style="width: ${fuelBreakdown.pctRides}%; background-color: var(--accent-amber);" title="En Viaje: ${fuelBreakdown.pctRides}%"></div>
          <div style="width: ${fuelBreakdown.pctPickup}%; background-color: var(--accent-cyan);" title="Recogida: ${fuelBreakdown.pctPickup}%"></div>
        </div>

        <!-- 3 Celdas Limpias -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 pt-2">
          <div>
            <div class="flex items-center gap-2 mb-1.5">
              <span class="w-2 h-2 rounded-full bg-[#71717A] shrink-0"></span>
              <span class="text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">RUTINA</span>
            </div>
            <div class="text-2xl font-light tabular-nums text-[var(--text-primary)]">
              ${fmtCop(fuelBreakdown.fuelBaseCop)}
            </div>
            <span class="text-xs text-[var(--text-secondary)] font-mono tabular-nums block mt-1">
              ${fuelBreakdown.kmBase} KM
            </span>
          </div>

          <div>
            <div class="flex items-center gap-2 mb-1.5">
              <span class="w-2 h-2 rounded-full bg-[var(--accent-amber)] shrink-0"></span>
              <span class="text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">EN VIAJE</span>
            </div>
            <div class="text-2xl font-light tabular-nums text-[var(--text-primary)]">
              ${fmtCop(fuelBreakdown.fuelRidesCop)}
            </div>
            <span class="text-xs text-[var(--text-secondary)] font-mono tabular-nums block mt-1">
              ${fuelBreakdown.kmRides} KM
            </span>
          </div>

          <div>
            <div class="flex items-center gap-2 mb-1.5">
              <span class="w-2 h-2 rounded-full bg-[var(--accent-cyan)] shrink-0"></span>
              <span class="text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">RECOGIDA</span>
            </div>
            <div class="text-2xl font-light tabular-nums text-[var(--text-primary)]">
              ${fmtCop(fuelBreakdown.fuelPickupCop)}
            </div>
            <span class="text-xs text-[var(--text-secondary)] font-mono tabular-nums block mt-1">
              ${fuelBreakdown.kmPickup} KM
            </span>
          </div>
        </div>
      </section>

      <!-- =====================================================================
           ZONA 4: RANKING DE CANALES SIMPLIFICADO
           ===================================================================== -->
      <section class="bg-[var(--bg-void)] flex-1">
        
        <div class="px-6 py-3 border-b border-[var(--line-hair)] flex items-center justify-between bg-[var(--bg-surface)]">
          <span class="text-[10px] uppercase tracking-[0.18em] text-[var(--text-secondary)] font-semibold">
            EFICIENCIA POR CANAL
          </span>
          <span class="text-[10px] text-[var(--text-secondary)] tracking-wider font-mono">
            ORDENADO POR TARIFA $/KM
          </span>
        </div>

        <div class="divide-y divide-[var(--line-hair)]">
          ${platformBreakdown.length > 0 ? platformBreakdown.map((p) => `
            <div class="py-5 px-6 flex items-center justify-between gap-4 hover:bg-[var(--bg-elevated)]/30 transition-colors">
              
              <!-- Izquierda: Nombre y Conteo/KM -->
              <div class="min-w-0">
                <span class="text-base sm:text-lg font-medium text-[var(--text-primary)] block">
                  ${p.platform}
                </span>
                <span class="text-[11px] font-mono text-[var(--text-secondary)] block mt-0.5">
                  ${p.tripsCount} ${p.tripsCount === 1 ? 'viaje' : 'viajes'} · ${p.totalKm} km
                </span>
              </div>

              <!-- Derecha: Tarifa $/KM y Total Bruto -->
              <div class="text-right shrink-0">
                <span class="text-xl sm:text-2xl font-light tabular-nums text-[var(--accent-volt)] block leading-tight font-mono">
                  ${fmtCop(p.ratePerKmCop)} / km
                </span>
                <span class="text-[11px] font-mono tabular-nums text-[var(--text-secondary)] block mt-0.5">
                  ${fmtCop(p.grossRevenueCop)} total
                </span>
              </div>

            </div>
          `).join('') : `
            <div class="py-12 px-6 text-center text-xs uppercase tracking-widest text-[var(--text-muted)] font-mono">
              SIN REGISTROS EN ESTE PERIODO
            </div>
          `}
        </div>

      </section>

      ${diag.timeSlotMatrix?.hasTimestampedData ? `
      <!-- =====================================================================
           ZONA 5: FRANJAS HORARIAS (Matriz plana divide-y sin cajas anidadas)
           ===================================================================== -->
      <section class="bg-[var(--bg-void)] border-t border-[var(--line-hair)]">
        <div class="px-6 py-3 border-b border-[var(--line-hair)] flex items-center justify-between bg-[var(--bg-surface)]">
          <span class="text-[10px] uppercase tracking-[0.18em] text-[var(--text-secondary)] font-semibold">
            FRANJAS HORARIAS
          </span>
          <span class="text-[10px] text-[var(--text-secondary)] tracking-wider font-mono">
            POR BLOQUE DE HORA
          </span>
        </div>
        <div class="divide-y divide-[var(--line-hair)]">
          ${diag.timeSlotMatrix.slots.map(slot => `
            <div class="py-3.5 px-6 flex items-center justify-between gap-4">
              <div class="min-w-0">
                <span class="text-xs sm:text-sm font-medium text-[var(--text-primary)] block">
                  ${slot.label} <span class="text-[10px] text-[var(--text-secondary)] font-normal ml-1">${slot.range}</span>
                </span>
                <span class="text-[10px] font-mono text-[var(--text-secondary)] block mt-0.5 tabular-nums">
                  ${slot.tripsCount} ${slot.tripsCount === 1 ? 'viaje' : 'viajes'}${slot.km > 0 ? ` · ${slot.km} km` : ''}
                </span>
              </div>
              <div class="text-right shrink-0">
                <span class="text-base sm:text-lg font-light tabular-nums ${slot.grossCop > 0 ? 'text-[var(--accent-volt)]' : 'text-[var(--text-muted)]'} block font-mono">
                  ${fmtCop(slot.grossCop)}
                </span>
                <span class="text-[10px] font-mono tabular-nums text-[var(--text-secondary)] block mt-0.5">
                  ${slot.ratePerHourCop !== null ? `${fmtCop(slot.ratePerHourCop)}/H` : (slot.tripsCount > 0 ? `${fmtCop(slot.avgFareCop)} PROM` : 'SIN ACTIVIDAD')}
                </span>
              </div>
            </div>
          `).join('')}
        </div>
      </section>
      ` : ''}

      <!-- =====================================================================
           AVISO DE INTEGRIDAD (Condicional: Duplicados)
           ===================================================================== -->
      ${activeAnomalies.length > 0 ? `
        <section class="border-t border-[var(--accent-crimson)]/40 bg-[var(--accent-crimson)]/5 px-4 sm:px-6 py-3 space-y-2">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full bg-[var(--accent-crimson)] animate-pulse shrink-0"></span>
              <span class="text-[10px] uppercase tracking-[0.16em] text-[var(--accent-crimson)] font-semibold">
                AVISO DE INTEGRIDAD · ${activeAnomalies.length} ${activeAnomalies.length === 1 ? 'DUPLICADO DETECTADO' : 'DUPLICADOS DETECTADOS'}
              </span>
            </div>
            <span class="text-[9px] text-[var(--text-secondary)] uppercase tracking-wider">
              ACCIÓN REQUERIDA
            </span>
          </div>

          <div class="space-y-1.5">
            ${activeAnomalies.map(anom => `
              <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2 border border-[var(--line-hair)] bg-[var(--bg-surface)] text-xs">
                <div class="space-y-0.5 min-w-0">
                  <span class="font-medium text-[var(--text-primary)] block text-xs">
                    ${anom.date} · ${anom.platform} · ${fmtCop(anom.amountCop)} · ${anom.km} KM
                  </span>
                  <span class="text-[9px] text-[var(--text-secondary)] block font-mono">
                    ${anom.count} REGISTROS CON VALORES IDÉNTICOS
                  </span>
                </div>

                <div class="flex items-center gap-2 shrink-0">
                  <button 
                    type="button" 
                    class="btn-delete-duplicate px-2 py-1 border border-[var(--accent-crimson)] text-[var(--accent-crimson)] hover:bg-[var(--accent-crimson)] hover:text-white transition-colors cursor-pointer text-[9px] uppercase font-semibold"
                    data-id="${anom.candidateToDeleteId}"
                  >
                    ELIMINAR DUPLICADO
                  </button>
                  <button 
                    type="button" 
                    class="btn-ignore-anomaly px-2 py-1 border border-[var(--line-hair)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer text-[9px] uppercase"
                    data-sig="${anom.signature}"
                  >
                    IGNORAR
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
        </section>
      ` : ''}

      <!-- Pie de Modal -->
      <footer class="px-6 py-3 flex items-center justify-between text-[10px] text-[var(--text-secondary)] bg-[var(--bg-surface)]">
        <span class="tracking-widest uppercase">OCTANE TELEMETRÍA VEHICULAR</span>
        <span class="tracking-widest uppercase font-mono">HOJA DE BALANCE OPERATIVO</span>
      </footer>

    </div>
  `;

  // Bind Event Listeners
  const printBtn = modalContainer.querySelector('#btn-report-export');
  const closeBtn = modalContainer.querySelector('#btn-report-close');

  printBtn?.addEventListener('click', () => {
    playHorologyTick(1200, 0.015, 0.03);
    exportReportToPrint(diag, profile);
  });

  closeBtn?.addEventListener('click', () => {
    closeDiagnosticModal();
  });

  // Switch de periodos rápidos
  const periodButtons = modalContainer.querySelectorAll('.btn-period-switch');
  periodButtons.forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const pKey = e.currentTarget.getAttribute('data-period');
      if (pKey && pKey !== currentPeriodKey) {
        playHorologyTick(1100, 0.012, 0.02);
        currentPeriodKey = pKey;
        await renderDiagnosticContent();
      }
    });
  });

  // Action: Eliminar Duplicado
  const deleteButtons = modalContainer.querySelectorAll('.btn-delete-duplicate');
  deleteButtons.forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const targetId = e.currentTarget.getAttribute('data-id');
      if (!targetId) return;

      const prevScroll = modalContainer.querySelector('#modal-diagnostic-sheet')?.scrollTop || 0;
      playHorologyTick(900, 0.03, 0.05);
      try {
        await deleteRideSession(targetId);
        showToast('REGISTRO DUPLICADO ELIMINADO');
        window.dispatchEvent(new CustomEvent('octane:rides-updated', { detail: { deletedId: targetId } }));
        await renderDiagnosticContent();
        const sheet = modalContainer.querySelector('#modal-diagnostic-sheet');
        if (sheet) sheet.scrollTop = prevScroll;
      } catch (err) {
        showToast('ERROR AL ELIMINAR REGISTRO');
      }
    });
  });

  // Action: Ignorar Anomalía
  const ignoreButtons = modalContainer.querySelectorAll('.btn-ignore-anomaly');
  ignoreButtons.forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const sig = e.currentTarget.getAttribute('data-sig');
      if (!sig) return;

      const prevScroll = modalContainer.querySelector('#modal-diagnostic-sheet')?.scrollTop || 0;
      playHorologyTick(1100, 0.015, 0.02);
      ignoredAnomalies.add(sig);
      await renderDiagnosticContent();
      const sheet = modalContainer.querySelector('#modal-diagnostic-sheet');
      if (sheet) sheet.scrollTop = prevScroll;
    });
  });
}
