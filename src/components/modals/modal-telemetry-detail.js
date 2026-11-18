/**
 * OCTANE // KINETIC — Modal de Detalle de Registro de Telemetría (Tanqueada / Medición)
 * 
 * Modal de inspección rápida en modo lectura al tocar una fila del historial de ciclo.
 * 
 * Especificaciones de Diseño:
 * - Superficie plana (bg-[var(--bg-surface)]) con líneas divisorias de 1px (divide-y / divide-x).
 * - Cero etiquetas <p>, cero sombras pesadas, cero cajas anidadas.
 * - Muestra datos clave del evento (Fecha, Odómetro, Recorrido, Nivel en Tanque, Galones/Costo si aplica).
 * - Botón principal "EDITAR REGISTRO" que transiciona suavemente al modal de edición (donde habita BORRAR).
 */

import { todayLocalYmd, localYmd } from '../../core/date-utils.js';
import { playHorologyTick } from '../../core/state.js';
import { formatVol, formatDateWithWeekday, GAL_TO_L, DEFAULT_TANK_CAPACITY_GAL } from '../../core/telemetry-engine.js';
import { sanitizeFuelCostCop } from '../../core/number-utils.js';

let detailModalRoot = null;

/**
 * Inicializa el contenedor DOM para el modal de detalle de telemetría.
 */
export function initTelemetryDetailModal() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('octane-telemetry-detail-modal')) {
    detailModalRoot = document.getElementById('octane-telemetry-detail-modal');
    return;
  }

  detailModalRoot = document.createElement('div');
  detailModalRoot.id = 'octane-telemetry-detail-modal';
  detailModalRoot.className = 'fixed inset-0 z-50 hidden select-none';
  document.body.appendChild(detailModalRoot);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && detailModalRoot && !detailModalRoot.classList.contains('hidden')) {
      closeTelemetryDetailModal();
    }
  });
}

/**
 * Cierra el modal de detalle de telemetría.
 */
export function closeTelemetryDetailModal() {
  if (detailModalRoot) {
    playHorologyTick(850, 0.01, 0.02);
    detailModalRoot.classList.add('hidden');
    detailModalRoot.innerHTML = '';
  }
}

/**
 * Extrae y formatea la hora en formato legible (e.g. "03:45 PM" o "15:45")
 * a partir del registro de telemetría (time, createdAt o updatedAt si coincide la fecha).
 * @param {Object} log
 * @returns {string}
 */
function extractFormattedTime(log) {
  if (!log) return '';

  // 1. Si existe hora explícita en el registro (e.g. "14:30" o "02:30 PM")
  if (log.time && typeof log.time === 'string') {
    const t = log.time.trim();
    if (/^\d{1,2}:\d{2}/.test(t)) {
      const parts = t.split(':');
      let hours = parseInt(parts[0], 10);
      const minutes = parts[1].slice(0, 2);
      if (!isNaN(hours)) {
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12;
        hours = hours ? hours : 12;
        return `${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
      }
      return t;
    }
    return t;
  }

  // 2. Si existe createdAt o timestamp
  const ts = log.createdAt || log.timestamp;
  if (ts) {
    try {
      const d = new Date(ts);
      if (!isNaN(d.getTime())) {
        let hours = d.getHours();
        const minutes = String(d.getMinutes()).padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12;
        hours = hours ? hours : 12;
        return `${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
      }
    } catch (_) {}
  }

  // 3. Fallback a updatedAt solo si la fecha coincide con la del registro
  if (log.updatedAt && log.date) {
    try {
      const d = new Date(log.updatedAt);
      if (!isNaN(d.getTime())) {
        const logDateStr = String(log.date).slice(0, 10);
        const updatedDateStr = localYmd(d);
        if (logDateStr === updatedDateStr) {
          let hours = d.getHours();
          const minutes = String(d.getMinutes()).padStart(2, '0');
          const ampm = hours >= 12 ? 'PM' : 'AM';
          hours = hours % 12;
          hours = hours ? hours : 12;
          return `${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
        }
      }
    } catch (_) {}
  }

  return '';
}

/**
 * Abre el modal de detalle para un registro de telemetría (Tanqueada o Medición).
 * 
 * @param {Object} log - El registro de telemetría
 * @param {Object} [options={}]
 * @param {string} [options.unit='gal'] - Unidad activa ('gal' | 'l100' | 'kml')
 * @param {number} [options.fuelPriceCop=16000] - Precio de referencia por galón
 * @param {number} [options.tankMaxGal=9.25] - Capacidad del tanque en galones
 */
export function openTelemetryDetailModal(log, options = {}) {
  if (!log) return;
  initTelemetryDetailModal();
  playHorologyTick(1300, 0.015, 0.025);

  const unit = options.unit || 'gal';
  const fuelPriceCop = Number(options.fuelPriceCop) || 16000;
  const tankMaxGal = Number(options.tankMaxGal) || DEFAULT_TANK_CAPACITY_GAL;

  const isFull = Boolean(log.is_full_tank || log.isFullTank);
  const galsAdded = Number(log.gallons_added) || 0;
  const hasFuel = galsAdded > 0 || Number(log.refuels_count) > 0 || Number(log.total_cost_cop) > 0;
  const isRefuel = hasFuel || (isFull && galsAdded > 0);
  const isPartial = !isFull && hasFuel;

  let fuelPct = 0;
  if (log.fuel_level_percent !== null && log.fuel_level_percent !== undefined && log.fuel_level_percent !== '') {
    fuelPct = Math.round(Number(log.fuel_level_percent));
  } else if (isFull) {
    fuelPct = 100;
  } else if (log.v_after !== undefined && tankMaxGal > 0) {
    fuelPct = Math.round((Number(log.v_after) / tankMaxGal) * 100);
  }
  fuelPct = Math.min(100, Math.max(0, fuelPct));

  const tankGalAtRecord = Number(((fuelPct / 100) * tankMaxGal).toFixed(2));
  const tankLitersAtRecord = Number((tankGalAtRecord * GAL_TO_L).toFixed(1));
  const cost = hasFuel ? sanitizeFuelCostCop(log.total_cost_cop, galsAdded, fuelPriceCop) : 0;
  const pricePerGal = (galsAdded > 0 && cost > 0) ? Math.round(cost / galsAdded) : fuelPriceCop;
  const odoVal = Math.round(Number(log.odometer_reading) || 0);
  const deltaKm = Math.round(Number(log.distance_km !== undefined ? log.distance_km : log.delta_km) || 0);
  const timeFormatted = extractFormattedTime(log);
  const dateFormatted = log.date ? formatDateWithWeekday(log.date) : '—';
  const fullDateTimeDisplay = timeFormatted ? `${dateFormatted} · ${timeFormatted}` : dateFormatted;

  const isLowReserve = fuelPct <= 15;
  const accentColor = isRefuel
    ? 'var(--accent-volt)'
    : (isLowReserve ? 'var(--accent-crimson)' : 'var(--accent-amber)');

  const headerTitle = isFull && hasFuel
    ? 'DETALLE DE TANQUEADA FULL'
    : (isPartial ? 'DETALLE DE RECARGA' : 'DETALLE DE MEDICIÓN');

  detailModalRoot.innerHTML = `
    <!-- Backdrop Plano -->
    <div class="telemetry-detail-backdrop fixed inset-0 bg-black/85 transition-opacity"></div>

    <!-- Contenedor Modal -->
    <div class="fixed inset-0 overflow-y-auto flex items-end sm:items-center justify-center p-0 sm:p-4 z-10">
      <div class="relative w-full max-w-md bg-[var(--bg-surface)] border-t sm:border border-[var(--line-hair)] text-[var(--text-primary)] rounded-t-sm sm:rounded-none flex flex-col overflow-hidden">
        
        <!-- Header Plano (h-12) -->
        <header class="flex items-center justify-between px-4 h-12 border-b border-[var(--line-hair)] bg-[var(--bg-void)] shrink-0">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2" style="background-color: ${accentColor}"></span>
            <span class="font-mono text-xs tracking-widest uppercase font-semibold text-[var(--text-primary)]">
              ${headerTitle}
            </span>
          </div>
          
          <button id="telemetry-detail-close-btn" type="button" class="w-8 h-8 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--line-hair)] transition-colors cursor-pointer" title="Cerrar">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        <!-- Cuerpo de Inspección -->
        <div class="divide-y divide-[var(--line-hair)]">
          
          <!-- Bloque Hero -->
          <div class="p-5 bg-[var(--bg-void)] flex items-baseline justify-between gap-4">
            <div>
              <span class="block font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)] mb-1">
                ${isRefuel ? (cost > 0 ? 'COSTO DE TANQUEADA' : 'VOLUMEN SUMINISTRADO') : 'NIVEL EN TANQUE'}
              </span>
              <span class="font-sans font-light text-4xl sm:text-5xl tracking-tighter tabular-nums leading-none" style="color: ${accentColor}">
                ${isRefuel
                  ? (cost > 0 ? `$${Math.round(cost).toLocaleString('es-CO')}` : `+${formatVol(galsAdded, unit, true)}`)
                  : `${fuelPct}%`}
              </span>
            </div>

            <div class="text-right">
              <span class="block font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)] mb-1">
                ${isRefuel ? 'SUMINISTRADO' : 'VOLUMEN FÍSICO'}
              </span>
              <span class="font-mono text-base sm:text-lg font-medium text-[var(--text-primary)] tabular-nums">
                ${isRefuel
                  ? `+${galsAdded.toFixed(2)} GAL`
                  : `${tankGalAtRecord.toFixed(2)} GAL · ${tankLitersAtRecord} L`}
              </span>
            </div>
          </div>

          <!-- Matriz de Especificaciones (2 Columnas) -->
          <div class="grid grid-cols-2 divide-x divide-[var(--line-hair)] bg-[var(--bg-surface)]">
            <div class="p-3.5">
              <span class="block font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--text-secondary)] mb-1">
                FECHA
              </span>
              <span class="font-mono text-xs font-semibold text-[var(--text-primary)] uppercase tabular-nums">
                ${fullDateTimeDisplay}
              </span>
            </div>

            <div class="p-3.5">
              <span class="block font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--text-secondary)] mb-1">
                ODÓMETRO
              </span>
              <span class="font-mono text-xs font-semibold text-[var(--text-primary)] uppercase tabular-nums">
                ${odoVal.toLocaleString('es-CO')} KM ${deltaKm > 0 ? `<span class="text-[var(--accent-volt)]">(+${deltaKm} KM)</span>` : ''}
              </span>
            </div>
          </div>

          <!-- Fila Financiera / Estado del Tanque -->
          <div class="grid grid-cols-2 divide-x divide-[var(--line-hair)] bg-[var(--bg-surface)]">
            <div class="p-3.5">
              <span class="block font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--text-secondary)] mb-1">
                NIVEL EN TANQUE
              </span>
              <span class="font-mono text-xs font-semibold text-[var(--text-primary)] tabular-nums">
                ${fuelPct}% · ${formatVol(tankGalAtRecord, unit, true)}
              </span>
            </div>

            <div class="p-3.5">
              <span class="block font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--text-secondary)] mb-1">
                ${isRefuel ? 'PRECIO / GALÓN' : 'TIPO DE REGISTRO'}
              </span>
              <span class="font-mono text-xs font-semibold text-[var(--text-primary)] uppercase tabular-nums">
                ${isRefuel ? `$${pricePerGal.toLocaleString('es-CO')} / GAL` : 'LECTURA DE AGUJA'}
              </span>
            </div>
          </div>

        </div>

        <!-- Barra de Acciones Inferior: Cerrar vs Editar -->
        <div class="grid grid-cols-12 divide-x divide-[var(--line-hair)] border-t border-[var(--line-hair)] bg-[var(--bg-void)] shrink-0">
          <button 
            id="telemetry-detail-cancel-btn" 
            type="button" 
            class="col-span-4 h-12 bg-transparent hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-mono text-xs uppercase tracking-wider font-medium flex items-center justify-center cursor-pointer transition-colors"
          >
            VOLVER
          </button>
          
          <button 
            id="telemetry-detail-edit-btn" 
            type="button" 
            class="col-span-8 h-12 bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] text-[var(--text-primary)] font-mono text-xs font-semibold uppercase tracking-widest flex items-center justify-center gap-2 cursor-pointer transition-colors"
          >
            <svg class="w-3.5 h-3.5 text-[var(--accent-amber)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            <span>EDITAR REGISTRO</span>
          </button>
        </div>

      </div>
    </div>
  `;

  detailModalRoot.classList.remove('hidden');

  const closeBtn = detailModalRoot.querySelector('#telemetry-detail-close-btn');
  const cancelBtn = detailModalRoot.querySelector('#telemetry-detail-cancel-btn');
  const backdrop = detailModalRoot.querySelector('.telemetry-detail-backdrop');
  const editBtn = detailModalRoot.querySelector('#telemetry-detail-edit-btn');

  closeBtn?.addEventListener('click', closeTelemetryDetailModal);
  cancelBtn?.addEventListener('click', closeTelemetryDetailModal);
  backdrop?.addEventListener('click', closeTelemetryDetailModal);

  editBtn?.addEventListener('click', () => {
    closeTelemetryDetailModal();
    if (isRefuel) {
      window.dispatchEvent(new CustomEvent('octane:open-refuel', { detail: { log } }));
    } else {
      window.dispatchEvent(new CustomEvent('octane:open-reading', { detail: { log } }));
    }
    window.dispatchEvent(new CustomEvent('octane:edit-log', { detail: { log } }));
  });
}
