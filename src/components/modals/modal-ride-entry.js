/**
 * OCTANE // KINETIC — Modal Ultrarrápido de Carrera y Egreso ("modal-ride-entry.js")
 * Captura táctil sin cajas dentro de cajas (Underline Inputs, sin placeholders ruidosos).
 * 
 * Modos:
 * - "+ Carrera":
 *     1. Input Gigante 1: Valor Bruto ($)
 *     2. Input Gigante 2: Distancia (KM)
 *     3. Switch 2 estados: Libre vs En ruta
 *     4. Selector de Plataforma Personalizable (Chips con botón + para añadir y × para borrar)
 *     5. Nota opcional y Fecha editable
 * - "- Egreso":
 *     1. Input Gigante: Monto ($)
 *     2. Concepto / Plataforma
 *     3. Fecha editable
 * 
 * Silencio Verbal Absoluto: Prohibidos <p> tags, placeholders "EJ. ...", bordes pesados.
 */

import { promptDialog } from '../dialogs/app-dialog.js';
import { todayLocalYmd, shortHumanDate } from '../../core/date-utils.js';
import { playHorologyTick, showToast } from '../../core/state.js';
import {
  getVehicleProfile,
  getTelemetryLogs,
  saveRideSession,
  savePlatformPass,
  deleteRideSession,
  deletePlatformPass
} from '../../core/db-local.js';
import { syncToCloud } from '../../core/firebase-sync.js';
import { calculateCostPerKm, formatCop, formatCompactCop } from '../../core/rides-engine.js';
import { parseIntegerMetric, formatThousandsLive, parseDistanceKm } from '../../core/number-utils.js';
import { createNumericKeypad } from '../keypad/numeric-keypad.js';
import { ensureFieldInView } from '../../core/viewport-manager.js';

let modalRootEl = null;

const PLATFORMS_STORAGE_KEY = 'octane_custom_platforms';
const DEFAULT_PLATFORMS = ['Directo', 'App 1', 'App 2'];

/**
 * Loads user platforms from localStorage.
 * @returns {Array<string>}
 */
function getStoredPlatforms() {
  try {
    const raw = localStorage.getItem(PLATFORMS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (_) {}
  return [...DEFAULT_PLATFORMS];
}

/**
 * Saves user platforms to localStorage.
 * @param {Array<string>} list
 */
function setStoredPlatforms(list) {
  try {
    localStorage.setItem(PLATFORMS_STORAGE_KEY, JSON.stringify(list));
  } catch (_) {}
}

/**
 * Ensures singleton modal container exists in the DOM.
 */
export function initRideEntryModal() {
  if (document.getElementById('octane-ride-entry-modal-container')) {
    modalRootEl = document.getElementById('octane-ride-entry-modal-container');
    return modalRootEl;
  }

  modalRootEl = document.createElement('div');
  modalRootEl.id = 'octane-ride-entry-modal-container';
  modalRootEl.className = 'fixed inset-0 z-50 hidden select-none';
  document.body.appendChild(modalRootEl);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalRootEl && !modalRootEl.classList.contains('hidden')) {
      closeRideEntryModal();
    }
  });

  return modalRootEl;
}

/**
 * Closes the ride entry modal dialog.
 */
export function closeRideEntryModal() {
  if (!modalRootEl) return;
  modalRootEl.classList.add('hidden');
  modalRootEl.innerHTML = '';
}

/**
 * Opens the ultra-fast Ride / Expense entry modal.
 * @param {Object} [options]
 * @param {'ride'|'expense'} [options.mode='ride'] - Initial mode
 * @param {Object} [options.item] - Item to edit
 * @param {Object} [options.session] - Alias for item
 * @param {Function} [options.onSave] - Callback
 */
export async function openRideEntryModal(options = {}) {
  initRideEntryModal();
  playHorologyTick(1400, 0.018, 0.035);

  const editItem = options.item || options.session || null;
  const isEditing = Boolean(editItem);

  // Determine mode
  let activeMode = options.mode || 'ride';
  if (editItem) {
    if (editItem.type === 'expense' || editItem.store === 'platform_passes' || (editItem.costCop && !editItem.distanceKm)) {
      activeMode = 'expense';
    } else {
      activeMode = 'ride';
    }
  }

  // Fetch profile & telemetry
  let profile = { routineDailyKm: 24, fuelPriceCop: 16000 };
  try {
    const p = await getVehicleProfile();
    if (p) profile = { ...profile, ...p };
  } catch (_) {}

  let logs = [];
  try {
    logs = await getTelemetryLogs();
  } catch (_) {}

  const costPerKm = calculateCostPerKm({
    fuelPriceCop: profile.fuelPriceCop,
    vehicleProfile: profile
  });

  const todayStr = todayLocalYmd();
  let platforms = getStoredPlatforms();

  // Initial form values
  const isValidYmd = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  let selectedDate = editItem?.date || editItem?.startDate || (isValidYmd(options.initialDate) ? options.initialDate : todayStr);
  let grossAmount = editItem ? (parseIntegerMetric(editItem.grossEarnings || editItem.grossRevenueCop || editItem.amountCop || editItem.fareCop || 0) || '') : '';
  let distanceKm = editItem ? (parseDistanceKm(editItem.distanceKm || editItem.workKm || editItem.km || 0) || '') : '';
  let isEnRoute = editItem ? Boolean(editItem.isEnRoute || editItem.tripType === 'en_route') : false;
  let selectedPlatform = editItem?.platform || platforms[0] || 'Directo';
  let noteText = editItem?.notes || '';

  // Expense specific initial values
  let expenseAmount = (activeMode === 'expense' && editItem) ? (parseIntegerMetric(editItem.amountCop || editItem.costCop || 0) || '') : '';
  let expenseConcept = editItem?.concept || editItem?.platform || 'Comisión';

  const commonConcepts = ['Comisión', 'Tarifa', 'Recarga', 'Peaje', 'Lavada', 'Otro'];

  renderModal();

  function renderModal() {
    const isRide = activeMode === 'ride';
    const titleText = isEditing 
      ? (isRide ? 'EDITAR CARRERA' : 'EDITAR EGRESO')
      : (isRide ? '+ CARRERA' : '- EGRESO');

    modalRootEl.innerHTML = `
      <!-- Backdrop Overlay (Flat hairline style, zero blur) -->
      <div id="ride-modal-backdrop" class="fixed inset-0 bg-black/85 transition-opacity duration-150"></div>

      <!-- Modal Dialog Frame -->
      <div class="fixed inset-0 overflow-y-auto flex items-end sm:items-center justify-center p-0 sm:p-4 z-10">
        <div class="relative w-full max-w-md bg-[var(--bg-surface)] border-t sm:border border-[var(--line-hair)] text-[var(--text-primary)] rounded-t-sm sm:rounded-none flex flex-col max-h-[96vh] sm:max-h-[90vh] overflow-hidden shadow-none">
          
          <!-- Header Directo -->
          <header class="flex items-center justify-between px-4 h-12 border-b border-[var(--line-hair)] bg-[var(--bg-void)] shrink-0">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 ${isRide ? 'bg-[var(--accent-volt)]' : 'bg-[var(--accent-crimson)]'}"></span>
              <span class="font-mono text-xs tracking-widest uppercase font-semibold">
                ${titleText}
              </span>
            </div>
            
            <button id="modal-close-btn" type="button" class="w-8 h-8 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer" title="Cerrar">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </header>

          <!-- Mode Switcher (Solo visible si no se está editando un registro existente) -->
          ${!isEditing ? `
            <div class="grid grid-cols-2 border-b border-[var(--line-hair)] bg-[var(--bg-void)] text-center font-mono text-[10px] tracking-wider uppercase divide-x divide-[var(--line-hair)] shrink-0">
              <button 
                type="button" 
                id="tab-mode-ride" 
                class="py-2.5 px-3 cursor-pointer transition-colors ${isRide ? 'bg-[var(--bg-surface)] text-[var(--accent-volt)] font-bold border-b-2 border-b-[var(--accent-volt)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}"
              >
                + CARRERA
              </button>
              <button 
                type="button" 
                id="tab-mode-expense" 
                class="py-2.5 px-3 cursor-pointer transition-colors ${!isRide ? 'bg-[var(--bg-surface)] text-[var(--accent-crimson)] font-bold border-b-2 border-b-[var(--accent-crimson)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}"
              >
                - EGRESO
              </button>
            </div>
          ` : ''}

          <!-- Form Body (Underline inputs, flat, no nested closed boxes) -->
          <div class="p-5 space-y-5 flex-1 overflow-y-auto">
            ${isRide ? renderRideFields() : renderExpenseFields()}
          </div>

          <!-- Live Readout / Impact Footer -->
          <div id="modal-live-footer" class="border-t border-[var(--line-hair)] bg-[var(--bg-void)] p-3 shrink-0">
            ${isRide ? renderRideFooterReadout() : renderExpenseFooterReadout()}
          </div>

          <!-- In-App Tactile Numeric Keypad Slot -->
          <div id="ride-keypad-slot" class="shrink-0"></div>

          <!-- Bottom Action Area -->
          ${isEditing ? `
            <div id="modal-edit-action-container" class="grid grid-cols-12 divide-x divide-[var(--line-hair)] border-t border-[var(--line-hair)] shrink-0 bg-[var(--bg-void)]">
              <button 
                id="modal-delete-action-btn" 
                type="button" 
                class="col-span-4 h-12 bg-transparent hover:bg-[var(--accent-crimson)]/10 text-[var(--accent-crimson)] font-mono text-xs uppercase tracking-wider font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                title="Eliminar registro permanentemente"
              >
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                <span>BORRAR</span>
              </button>
              
              <button 
                id="modal-submit-action-btn" 
                type="button" 
                class="col-span-8 h-12 ${isRide ? 'bg-[var(--accent-volt)] text-[var(--bg-void)]' : 'bg-[var(--accent-crimson)] text-white'} font-mono text-xs font-semibold uppercase tracking-widest transition-opacity hover:opacity-90 flex items-center justify-center cursor-pointer"
              >
                GUARDAR CAMBIOS
              </button>
            </div>
          ` : `
            <button 
              id="modal-submit-action-btn" 
              type="button" 
              class="h-12 w-full ${isRide ? 'bg-[var(--accent-volt)] text-[var(--bg-void)]' : 'bg-[var(--accent-crimson)] text-white'} font-mono text-xs font-semibold uppercase tracking-widest transition-opacity hover:opacity-90 flex items-center justify-center cursor-pointer shrink-0"
            >
              ${isRide ? 'REGISTRAR CARRERA' : 'REGISTRAR EGRESO'}
            </button>
          `}

        </div>
      </div>
    `;

    modalRootEl.classList.remove('hidden');
    bindModalEvents();
  }

  function renderRideFields() {
    return `
      <!-- Input Gigante 1: Valor Bruto ($) -->
      <div class="space-y-1 text-center">
        <label for="input-ride-gross" class="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">
          VALOR BRUTO ($ COP)
        </label>
        <div class="relative flex items-center justify-center">
          <input 
            id="input-ride-gross" 
            type="text" 
            inputmode="none" 
            data-format="thousands" 
            placeholder="0" 
            value="${grossAmount ? formatThousandsLive(grossAmount) : ''}" 
            class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-volt)] font-sans font-light text-5xl tracking-tighter tabular-nums text-center text-[var(--text-primary)] focus:outline-none py-1 placeholder:text-[var(--text-muted)]" 
          />
        </div>
      </div>

      <!-- Input Gigante 2: Distancia (KM) -->
      <div class="space-y-1 text-center">
        <label for="input-ride-km" class="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">
          DISTANCIA (KM)
        </label>
        <div class="relative flex items-center justify-center">
          <input 
            id="input-ride-km" 
            type="text" 
            inputmode="none" 
            data-decimal="true" 
            placeholder="0.0" 
            value="${distanceKm || ''}" 
            class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-volt)] font-sans font-light text-4xl tracking-tighter tabular-nums text-center text-[var(--text-primary)] focus:outline-none py-1 placeholder:text-[var(--text-muted)]" 
          />
        </div>
      </div>

      <!-- Switch de 2 Estados: Libre vs En ruta -->
      <div class="space-y-1.5 pt-1">
        <div class="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">
          <span>TIPO DE TRAYECTO</span>
          <span class="text-[9px] text-[var(--text-muted)]">COSTO MARGINAL</span>
        </div>
        
        <div class="grid grid-cols-2 gap-2">
          <button 
            type="button" 
            id="btn-type-free" 
            class="py-2.5 px-3 border rounded-none font-mono text-xs uppercase tracking-wider text-center cursor-pointer transition-colors ${!isEnRoute ? 'border-[var(--accent-volt)] bg-[var(--accent-volt)]/15 text-[var(--text-primary)] font-bold' : 'border-[var(--line-hair)] bg-[var(--bg-void)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}"
          >
            LIBRE
          </button>
          
          <button 
            type="button" 
            id="btn-type-enroute" 
            class="py-2.5 px-3 border rounded-none font-mono text-xs uppercase tracking-wider text-center cursor-pointer transition-colors ${isEnRoute ? 'border-[var(--accent-volt)] bg-[var(--accent-volt)]/15 text-[var(--text-primary)] font-bold' : 'border-[var(--line-hair)] bg-[var(--bg-void)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}"
          >
            EN RUTA
          </button>
        </div>

        <div class="text-[9px] font-mono text-[var(--text-muted)] text-center pt-0.5">
          ${isEnRoute ? 'Hacia tu destino programado (gasolina $0 hasta cuota de ruta diaria)' : 'Carrera normal de trabajo'}
        </div>
      </div>

      <!-- Selector de Plataforma Personalizable (Chips) -->
      <div class="space-y-1.5 pt-1">
        <div class="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">
          <span>PLATAFORMA</span>
          <span class="text-[9px] text-[var(--text-muted)]">PERSONALIZABLE</span>
        </div>

        <div class="flex flex-wrap items-center gap-1.5" id="platforms-chips-container">
          ${platforms.map(plat => {
            const isSel = plat.toLowerCase() === selectedPlatform.toLowerCase();
            const isProtected = plat.toLowerCase() === 'directo';
            return `
              <div class="inline-flex items-center border ${isSel ? 'border-[var(--accent-volt)] bg-[var(--accent-volt)]/15 text-[var(--accent-volt)] font-semibold' : 'border-[var(--line-hair)] bg-[var(--bg-void)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'} transition-colors">
                <button 
                  type="button" 
                  class="btn-select-platform px-2.5 py-1 font-mono text-[10px] uppercase cursor-pointer"
                  data-platform="${plat}"
                >
                  ${plat}
                </button>
                ${!isProtected ? `
                  <button 
                    type="button" 
                    class="btn-remove-platform px-1.5 py-1 text-[var(--text-muted)] hover:text-[var(--accent-crimson)] font-mono text-[10px] cursor-pointer"
                    data-platform="${plat}"
                    title="Eliminar plataforma"
                  >
                    ×
                  </button>
                ` : ''}
              </div>
            `;
          }).join('')}

          <!-- Botón + Nueva Plataforma -->
          <button 
            type="button" 
            id="btn-add-platform" 
            class="px-2 py-1 border border-dashed border-[var(--line-hair)] hover:border-[var(--accent-volt)] text-[var(--text-secondary)] hover:text-[var(--accent-volt)] font-mono text-[10px] uppercase tracking-wider transition-colors cursor-pointer"
          >
            + AÑADIR
          </button>
        </div>
      </div>

      <!-- Fecha & Nota Opcional (Underline Inputs) -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-[var(--line-hair)]">
        <!-- Fecha -->
        <div class="space-y-1">
          <label for="input-ride-date" class="font-mono text-[9px] uppercase tracking-wider text-[var(--text-secondary)]">
            FECHA
          </label>
          <input 
            id="input-ride-date" 
            type="date" 
            value="${selectedDate}" 
            class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-volt)] font-mono text-xs tabular-nums text-[var(--text-primary)] focus:outline-none py-1.5 cursor-pointer"
          />
        </div>

        <!-- Nota Opcional -->
        <div class="space-y-1">
          <label for="input-ride-note" class="font-mono text-[9px] uppercase tracking-wider text-[var(--text-secondary)]">
            NOTA (OPCIONAL)
          </label>
          <input 
            id="input-ride-note" 
            type="text" 
            placeholder="—" 
            value="${noteText}" 
            class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-volt)] font-mono text-xs text-[var(--text-primary)] focus:outline-none py-1.5 placeholder:text-[var(--text-muted)]"
          />
        </div>
      </div>
    `;
  }

  function renderExpenseFields() {
    return `
      <!-- Input Gigante 1: Monto Egreso ($) -->
      <div class="space-y-1 text-center">
        <label for="input-expense-amount" class="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">
          MONTO DEL EGRESO ($ COP)
        </label>
        <div class="relative flex items-center justify-center">
          <input 
            id="input-expense-amount" 
            type="text" 
            inputmode="none" 
            data-format="thousands" 
            placeholder="0" 
            value="${expenseAmount ? formatThousandsLive(expenseAmount) : ''}" 
            class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-crimson)] font-sans font-light text-5xl tracking-tighter tabular-nums text-center text-[var(--accent-crimson)] focus:outline-none py-1 placeholder:text-[var(--text-muted)]" 
          />
        </div>
      </div>

      <!-- Conceptos Rápidos -->
      <div class="space-y-1.5 pt-1">
        <div class="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">
          <span>CONCEPTO RÁPIDO</span>
          <span class="text-[9px] text-[var(--text-muted)]">DEDUCCIÓN</span>
        </div>

        <div class="flex flex-wrap gap-1.5" id="expense-chips-container">
          ${commonConcepts.map(c => {
            const isSel = c.toLowerCase() === expenseConcept.toLowerCase();
            return `
              <button 
                type="button" 
                class="btn-select-concept px-2.5 py-1 border font-mono text-[10px] uppercase cursor-pointer transition-colors ${isSel ? 'border-[var(--accent-crimson)] bg-[var(--accent-crimson)]/15 text-[var(--accent-crimson)] font-semibold' : 'border-[var(--line-hair)] bg-[var(--bg-void)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}"
                data-concept="${c}"
              >
                ${c}
              </button>
            `;
          }).join('')}
        </div>
      </div>

      <!-- Detalle / Plataforma (Underline Input) -->
      <div class="space-y-1">
        <label for="input-expense-detail" class="font-mono text-[9px] uppercase tracking-wider text-[var(--text-secondary)]">
          DETALLE / PLATAFORMA
        </label>
        <input 
          id="input-expense-detail" 
          type="text" 
          placeholder="—" 
          value="${expenseConcept}" 
          class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-crimson)] font-mono text-xs text-[var(--text-primary)] focus:outline-none py-1.5 placeholder:text-[var(--text-muted)]"
        />
      </div>

      <!-- Fecha -->
      <div class="space-y-1 border-t border-[var(--line-hair)] pt-2">
        <label for="input-expense-date" class="font-mono text-[9px] uppercase tracking-wider text-[var(--text-secondary)]">
          FECHA
        </label>
        <input 
          id="input-expense-date" 
          type="date" 
          value="${selectedDate}" 
          class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-crimson)] font-mono text-xs tabular-nums text-[var(--text-primary)] focus:outline-none py-1.5 cursor-pointer"
        />
      </div>
    `;
  }

  function renderRideFooterReadout() {
    const gross = parseIntegerMetric(grossAmount);
    const km = parseDistanceKm(distanceKm);

    // Fuel calculation: If en route, 0 extra fuel up to credit; otherwise km * costPerKm
    let fuelCost = 0;
    if (isEnRoute) {
      // In route has 0 marginal fuel cost up to the routine commute quota
      fuelCost = 0;
    } else {
      fuelCost = Math.round(km * costPerKm);
    }

    const wearReserve = Math.round(gross * 0.10);
    const estimatedNet = Math.max(0, gross - fuelCost - wearReserve);

    return `
      <div class="grid grid-cols-3 divide-x divide-[var(--line-hair)] text-center font-mono">
        <!-- Gasolina Marginal -->
        <div class="px-1">
          <div class="text-[9px] uppercase text-[var(--text-secondary)]">GASOLINA</div>
          <div class="font-sans font-light text-sm sm:text-base tabular-nums ${fuelCost > 0 ? 'text-[var(--accent-crimson)]' : 'text-[var(--accent-volt)]'} mt-0.5">
            ${fuelCost > 0 ? `-$${formatThousandsLive(fuelCost)}` : '$0 (EN RUTA)'}
          </div>
        </div>

        <!-- Reserva Desgaste -->
        <div class="px-1">
          <div class="text-[9px] uppercase text-[var(--text-secondary)]">DESGASTE (10%)</div>
          <div class="font-sans font-light text-sm sm:text-base tabular-nums text-[var(--accent-amber)] mt-0.5">
            -$${formatThousandsLive(wearReserve)}
          </div>
        </div>

        <!-- Margen Libre -->
        <div class="px-1">
          <div class="text-[9px] uppercase text-[var(--text-secondary)]">BOLSILLO ESTIMADO</div>
          <div class="font-sans font-light text-sm sm:text-base tabular-nums ${estimatedNet > 0 ? 'text-[var(--accent-volt)]' : 'text-[var(--text-secondary)]'} mt-0.5">
            +$${formatThousandsLive(estimatedNet)}
          </div>
        </div>
      </div>
    `;
  }

  function renderExpenseFooterReadout() {
    const amount = parseIntegerMetric(expenseAmount);
    return `
      <div class="flex items-center justify-between font-mono text-xs px-2">
        <span class="text-[var(--text-secondary)] uppercase text-[10px]">TOTAL EGRESO A DEDUCIR:</span>
        <span class="font-sans font-light text-lg tabular-nums text-[var(--accent-crimson)]">
          -$${formatThousandsLive(amount) || '0'}
        </span>
      </div>
    `;
  }

  function updateFooter() {
    const footerEl = modalRootEl.querySelector('#modal-live-footer');
    if (!footerEl) return;
    if (activeMode === 'ride') {
      footerEl.innerHTML = renderRideFooterReadout();
    } else {
      footerEl.innerHTML = renderExpenseFooterReadout();
    }
  }

  function bindModalEvents() {
    // Backdrop & Close
    modalRootEl.querySelector('#modal-close-btn')?.addEventListener('click', () => {
      playHorologyTick(900, 0.015, 0.02);
      closeRideEntryModal();
    });

    modalRootEl.querySelector('#ride-modal-backdrop')?.addEventListener('click', () => {
      closeRideEntryModal();
    });

    // Mode tabs
    const tabRide = modalRootEl.querySelector('#tab-mode-ride');
    const tabExpense = modalRootEl.querySelector('#tab-mode-expense');

    if (tabRide) {
      tabRide.addEventListener('click', () => {
        if (activeMode !== 'ride') {
          playHorologyTick(1200, 0.012, 0.02);
          activeMode = 'ride';
          renderModal();
        }
      });
    }

    if (tabExpense) {
      tabExpense.addEventListener('click', () => {
        if (activeMode !== 'expense') {
          playHorologyTick(1200, 0.012, 0.02);
          activeMode = 'expense';
          renderModal();
        }
      });
    }

    if (activeMode === 'ride') {
      bindRideEvents();
    } else {
      bindExpenseEvents();
    }

    // Submit Action
    const submitBtn = modalRootEl.querySelector('#modal-submit-action-btn');
    if (submitBtn) {
      submitBtn.addEventListener('click', handleSave);
    }

    // Delete Action (Only active when editing an existing record)
    const deleteBtn = modalRootEl.querySelector('#modal-delete-action-btn');
    const actionContainer = modalRootEl.querySelector('#modal-edit-action-container');
    if (deleteBtn && actionContainer && editItem) {
      deleteBtn.addEventListener('click', () => {
        playHorologyTick(1000, 0.015, 0.02);
        const isRide = activeMode === 'ride';
        actionContainer.innerHTML = `
          <div class="col-span-12 h-12 flex items-center justify-between px-3 bg-[var(--bg-void)] border-t border-[var(--line-hair)] text-[var(--text-primary)] font-mono text-xs">
            <span class="text-[var(--accent-crimson)] font-semibold tracking-wider uppercase text-[10px] sm:text-[11px]">
              ¿ELIMINAR ${isRide ? 'CARRERA' : 'EGRESO'}?
            </span>
            <div class="flex items-center gap-1.5">
              <button 
                id="modal-delete-cancel-btn" 
                type="button" 
                class="h-8 px-2.5 border border-[var(--line-hair)] bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] uppercase text-[10px] tracking-wider font-semibold cursor-pointer transition-colors"
              >
                CANCELAR
              </button>
              <button 
                id="modal-delete-confirm-btn" 
                type="button" 
                class="h-8 px-2.5 bg-[var(--accent-crimson)] text-white hover:bg-[var(--accent-crimson)]/90 uppercase text-[10px] tracking-wider font-bold cursor-pointer transition-colors"
              >
                SÍ, BORRAR
              </button>
            </div>
          </div>
        `;

        actionContainer.querySelector('#modal-delete-cancel-btn')?.addEventListener('click', () => {
          playHorologyTick(1100, 0.012, 0.02);
          renderModal();
        });

        actionContainer.querySelector('#modal-delete-confirm-btn')?.addEventListener('click', async () => {
          playHorologyTick(800, 0.025, 0.04);
          try {
            if (isRide) {
              await deleteRideSession(editItem.id);
              showToast('CARRERA ELIMINADA');
            } else {
              await deletePlatformPass(editItem.id);
              showToast('EGRESO ELIMINADO');
            }

            try {
              if (typeof syncToCloud === 'function') syncToCloud();
            } catch (_) {}

            window.dispatchEvent(new CustomEvent('octane:rides-updated', { detail: { deletedId: editItem.id } }));
            if (typeof options.onDelete === 'function') options.onDelete(editItem);
            if (typeof options.onMovementChanged === 'function') options.onMovementChanged();
            closeRideEntryModal();
          } catch (err) {
            console.error('[OCTANE] Error deleting entry:', err);
            showToast('ERROR AL ELIMINAR');
          }
        });
      });
    }
  }

  function bindRideEvents() {
    const grossInput = modalRootEl.querySelector('#input-ride-gross');
    const kmInput = modalRootEl.querySelector('#input-ride-km');
    const btnFree = modalRootEl.querySelector('#btn-type-free');
    const btnEnRoute = modalRootEl.querySelector('#btn-type-enroute');
    const dateInput = modalRootEl.querySelector('#input-ride-date');
    const noteInput = modalRootEl.querySelector('#input-ride-note');
    const addPlatBtn = modalRootEl.querySelector('#btn-add-platform');
    const keypadSlot = modalRootEl.querySelector('#ride-keypad-slot');

    if (keypadSlot && grossInput && kmInput) {
      createNumericKeypad({
        container: keypadSlot,
        inputs: [grossInput, kmInput],
        onConfirm: handleSave,
        onInput: () => {
          grossAmount = parseIntegerMetric(grossInput.value);
          distanceKm = parseDistanceKm(kmInput.value);
          updateFooter();
        }
      });
    }

    grossInput?.addEventListener('input', () => {
      grossInput.value = formatThousandsLive(grossInput.value);
      grossAmount = parseIntegerMetric(grossInput.value);
      updateFooter();
    });

    kmInput?.addEventListener('input', () => {
      distanceKm = parseDistanceKm(kmInput.value);
      updateFooter();
    });

    btnFree?.addEventListener('click', () => {
      playHorologyTick(1100, 0.012, 0.02);
      isEnRoute = false;
      renderModal();
    });

    btnEnRoute?.addEventListener('click', () => {
      playHorologyTick(1100, 0.012, 0.02);
      isEnRoute = true;
      renderModal();
    });

    dateInput?.addEventListener('change', () => {
      selectedDate = dateInput.value;
    });

    noteInput?.addEventListener('focus', () => {
      ensureFieldInView(noteInput);
    });

    noteInput?.addEventListener('input', () => {
      noteText = noteInput.value;
    });

    // Platform selection chips
    modalRootEl.querySelectorAll('.btn-select-platform').forEach(btn => {
      btn.addEventListener('click', () => {
        playHorologyTick(1100, 0.01, 0.02);
        selectedPlatform = btn.dataset.platform;
        renderModal();
      });
    });

    // Platform removal
    modalRootEl.querySelectorAll('.btn-remove-platform').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        playHorologyTick(900, 0.015, 0.02);
        const toRemove = btn.dataset.platform;
        platforms = platforms.filter(p => p.toLowerCase() !== toRemove.toLowerCase());
        setStoredPlatforms(platforms);
        if (selectedPlatform.toLowerCase() === toRemove.toLowerCase()) {
          selectedPlatform = platforms[0] || 'Directo';
        }
        renderModal();
      });
    });

    // Add new platform
    addPlatBtn?.addEventListener('click', async () => {
      playHorologyTick(1200, 0.015, 0.025);
      const name = await promptDialog({ label: 'Nueva plataforma', maxLength: 20 });
      if (name && name.trim()) {
        const cleanName = name.trim();
        if (!platforms.some(p => p.toLowerCase() === cleanName.toLowerCase())) {
          platforms.push(cleanName);
          setStoredPlatforms(platforms);
          selectedPlatform = cleanName;
          renderModal();
        }
      }
    });
  }

  function bindExpenseEvents() {
    const amountInput = modalRootEl.querySelector('#input-expense-amount');
    const detailInput = modalRootEl.querySelector('#input-expense-detail');
    const dateInput = modalRootEl.querySelector('#input-expense-date');
    const keypadSlot = modalRootEl.querySelector('#ride-keypad-slot');

    if (keypadSlot && amountInput) {
      createNumericKeypad({
        container: keypadSlot,
        inputs: [amountInput],
        onConfirm: handleSave,
        onInput: () => {
          expenseAmount = parseIntegerMetric(amountInput.value);
          updateFooter();
        }
      });
    }

    amountInput?.addEventListener('input', () => {
      amountInput.value = formatThousandsLive(amountInput.value);
      expenseAmount = parseIntegerMetric(amountInput.value);
      updateFooter();
    });

    detailInput?.addEventListener('focus', () => {
      ensureFieldInView(detailInput);
    });

    detailInput?.addEventListener('input', () => {
      expenseConcept = detailInput.value;
    });

    dateInput?.addEventListener('change', () => {
      selectedDate = dateInput.value;
    });

    modalRootEl.querySelectorAll('.btn-select-concept').forEach(btn => {
      btn.addEventListener('click', () => {
        playHorologyTick(1100, 0.01, 0.02);
        expenseConcept = btn.dataset.concept;
        if (detailInput) detailInput.value = expenseConcept;
        renderModal();
      });
    });
  }

  async function handleSave() {
    playHorologyTick(1600, 0.02, 0.04);

    try {
      if (activeMode === 'ride') {
        const grossInputEl = modalRootEl.querySelector('#input-ride-gross');
        const kmInputEl = modalRootEl.querySelector('#input-ride-km');
        const dateInputEl = modalRootEl.querySelector('#input-ride-date');
        const noteInputEl = modalRootEl.querySelector('#input-ride-note');

        const grossVal = parseIntegerMetric(grossInputEl ? grossInputEl.value : grossAmount) || 0;
        const kmVal = parseDistanceKm(kmInputEl ? kmInputEl.value : distanceKm) || 0;
        const curDate = dateInputEl ? dateInputEl.value : selectedDate;
        const curNote = noteInputEl ? noteInputEl.value : noteText;

        if (grossVal <= 0 && kmVal <= 0) {
          showToast('INGRESA VALOR O DISTANCIA');
          return;
        }

        const payload = {
          id: editItem?.id || `ride_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          type: 'ride',
          date: curDate,
          grossEarnings: grossVal,
          grossRevenueCop: grossVal,
          distanceKm: kmVal,
          workKm: kmVal,
          tripKmTotal: kmVal,
          tripType: isEnRoute ? 'en_route' : 'free',
          isEnRoute: Boolean(isEnRoute),
          platform: selectedPlatform || 'Directo',
          notes: String(curNote || '').trim(),
          createdAt: editItem?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        await saveRideSession(payload);
        showToast((isEditing ? 'CARRERA ACTUALIZADA' : 'CARRERA REGISTRADA') + (curDate && curDate !== todayStr ? ' · ' + shortHumanDate(curDate) : ''));
        window.dispatchEvent(new CustomEvent('octane:rides-updated', { detail: { item: payload } }));
        if (typeof options.onSave === 'function') options.onSave(payload);
      } else {
        // Mode Expense
        const amountInputEl = modalRootEl.querySelector('#input-expense-amount');
        const detailInputEl = modalRootEl.querySelector('#input-expense-detail');
        const dateInputEl = modalRootEl.querySelector('#input-expense-date');

        const expenseVal = parseIntegerMetric(amountInputEl ? amountInputEl.value : expenseAmount) || 0;
        const curDate = dateInputEl ? dateInputEl.value : selectedDate;
        const curConcept = detailInputEl ? detailInputEl.value : expenseConcept;

        if (expenseVal <= 0) {
          showToast('INGRESA MONTO DEL EGRESO');
          return;
        }

        const payload = {
          id: editItem?.id || `pass_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          type: 'expense',
          date: curDate,
          startDate: curDate,
          amountCop: expenseVal,
          costCop: expenseVal,
          concept: String(curConcept || 'Comisión').trim(),
          platform: String(curConcept || 'General').trim(),
          createdAt: editItem?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        await savePlatformPass(payload);
        showToast((isEditing ? 'EGRESO ACTUALIZADO' : 'EGRESO REGISTRADO') + (curDate && curDate !== todayStr ? ' · ' + shortHumanDate(curDate) : ''));
        window.dispatchEvent(new CustomEvent('octane:rides-updated', { detail: { item: payload } }));
        if (typeof options.onSave === 'function') options.onSave(payload);
      }

      // Background cloud sync
      try {
        if (typeof syncToCloud === 'function') syncToCloud();
      } catch (_) {}

      closeRideEntryModal();
    } catch (err) {
      console.error('[OCTANE] Error saving ride/expense entry:', err);
      showToast('ERROR AL GUARDAR');
    }
  }
}
