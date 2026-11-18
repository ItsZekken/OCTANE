/**
 * OCTANE // KINETIC — Modal 02 / TANQUEADA
 * Dedicated Universal Refueling Modal (Teenage Engineering / Braun style).
 * 
 * Strict specifications:
 * - Header with 02 / TANQUEADA title + ✕ close.
 * - 3 Habit Tabs: A FULL (100%), GALONES EXACTOS, POR MONTO ($).
 * - Preselects tab according to vehicleProfile.refuelHabit or edit record.
 * - Hero numeric entry adapted to active tab (text decimal for comma & dot support).
 * - Physical tank capacity validation with subtle indicator.
 * - Live fuel level transition preview bar (XX% → YY%).
 * - Date picker strip for registration/editing timestamp.
 * - 3 Bottom cells: ODÓMETRO, $ / GALÓN, COSTO TOTAL with live thousands dots.
 * - Single full-width action button: REGISTRAR TANQUEADA / GUARDAR CAMBIOS.
 * - Silencio Verbal Absoluto: Zero paragraph HTML tags, zero blur, zero shadows.
 */

import { todayLocalYmd } from '../../core/date-utils.js';
import { store, playHorologyTick, showToast } from '../../core/state.js';
import {
  addTelemetryLog,
  updateTelemetryLog,
  deleteTelemetryLog,
  getTelemetryLogs,
  getVehicleProfile,
  saveVehicleProfile
} from '../../core/db-local.js';
import { recalculateTelemetry } from '../../core/telemetry-engine.js';
import { syncToCloud } from '../../core/firebase-sync.js';
import { calibrateGpsOdometer } from '../../core/iopgps-sync.js';
import { learnGasStation } from '../../core/gas-station-matcher.js';
import { clamp } from '../fuel-gauges/gauge-controller.js';
import {
  parseFuelVolume,
  parseIntegerMetric,
  formatThousandsLive,
  setCursorAtEnd
} from '../../core/number-utils.js';
import { createNumericKeypad } from '../keypad/numeric-keypad.js';

let modalRootEl = null;
const GAL_TO_L = 3.78541;

/**
 * Aggregates GPS cycle telemetry from `gpsCache.days` and `gpsCache.tripsByDate`
 * between `prevLog?.date` and `refuelDate` to populate real refuel telemetry metrics.
 * Returns zeros if no GPS data covers the window.
 *
 * @param {Object} [params={}]
 * @param {Object|null} [params.prevLog=null]
 * @param {string} [params.refuelDate='']
 * @param {Object|null} [params.gpsCache=null]
 * @param {Object|null} [params.matchedStation=null]
 * @returns {Object}
 */
export function buildRefuelTelemetryEnrichment({
  prevLog = null,
  refuelDate = '',
  gpsCache = null,
  matchedStation = null
} = {}) {
  const endDate = String(refuelDate || '').slice(0, 10);
  const startDate = prevLog?.date ? String(prevLog.date).slice(0, 10) : endDate;

  const base = {
    duration_seconds: 0,
    idle_seconds: 0,
    idle_ratio: 0,
    acceleration_variance: 0,
    max_speed_kmh: 0,
    thermal_stress_score: 0,
    ...(matchedStation?.id ? { stationId: matchedStation.id } : {}),
    ...(matchedStation?.name ? { stationName: matchedStation.name } : {})
  };

  if (!gpsCache || typeof gpsCache !== 'object' || !endDate || startDate > endDate) {
    return base;
  }

  const daysMap = (gpsCache.days && typeof gpsCache.days === 'object') ? gpsCache.days : {};
  const tripsByDate = (gpsCache.tripsByDate && typeof gpsCache.tripsByDate === 'object') ? gpsCache.tripsByDate : {};

  let dayRunSec = 0;
  let dayIdleSec = 0;
  for (const dateKey of Object.keys(daysMap)) {
    if (dateKey >= startDate && dateKey <= endDate) {
      const rec = daysMap[dateKey];
      if (!rec) continue;
      dayRunSec += Number(rec.runTimeSec) || 0;
      dayIdleSec += Number(rec.idleAccOnSec) || 0;
    }
  }

  let tripRunSec = 0;
  let tripIdleSec = 0;
  let maxSpeed = 0;
  const accelVariances = [];
  const thermalScores = [];

  for (const dateKey of Object.keys(tripsByDate)) {
    if (dateKey >= startDate && dateKey <= endDate) {
      const dayTrips = tripsByDate[dateKey];
      if (!Array.isArray(dayTrips)) continue;
      for (const trip of dayTrips) {
        if (!trip || typeof trip !== 'object') continue;
        tripRunSec += Number(trip.durationSec ?? trip.tripTimeSec) || 0;
        tripIdleSec += Number(trip.stoppedTimeSec) || 0;
        const tMax = Number(trip.maxSpeedKmh ?? trip.speedMax) || 0;
        if (tMax > maxSpeed) maxSpeed = tMax;
        const tVar = Number(trip.accelVariance);
        if (Number.isFinite(tVar) && tVar > 0) {
          accelVariances.push(tVar);
        }
        const coldPct = Number(trip.coldPenaltyPct);
        if (Number.isFinite(coldPct) && coldPct >= 0) {
          thermalScores.push(coldPct);
        } else if (Number.isFinite(Number(trip.tripSeverity)) && Number(trip.tripSeverity) > 1) {
          thermalScores.push((Number(trip.tripSeverity) - 1) * 100);
        }
      }
    }
  }

  const duration_seconds = Math.round(dayRunSec > 0 ? dayRunSec : tripRunSec);
  const idle_seconds = Math.round(dayIdleSec > 0 ? dayIdleSec : tripIdleSec);
  const idle_ratio = duration_seconds > 0
    ? Number(Math.min(1, idle_seconds / duration_seconds).toFixed(3))
    : 0;
  const acceleration_variance = accelVariances.length > 0
    ? Number((accelVariances.reduce((a, b) => a + b, 0) / accelVariances.length).toFixed(4))
    : 0;
  const max_speed_kmh = Math.round(maxSpeed);
  const thermal_stress_score = thermalScores.length > 0
    ? Number((thermalScores.reduce((a, b) => a + b, 0) / thermalScores.length).toFixed(2))
    : 0;

  return {
    duration_seconds,
    idle_seconds,
    idle_ratio,
    acceleration_variance,
    max_speed_kmh,
    thermal_stress_score,
    ...(matchedStation?.id ? { stationId: matchedStation.id } : {}),
    ...(matchedStation?.name ? { stationName: matchedStation.name } : {})
  };
}

/**
 * Initializes the Refuel modal root element in the DOM.
 */
export function initRefuelModal() {
  if (document.getElementById('octane-refuel-modal-container')) {
    modalRootEl = document.getElementById('octane-refuel-modal-container');
    return;
  }

  modalRootEl = document.createElement('div');
  modalRootEl.id = 'octane-refuel-modal-container';
  modalRootEl.className = 'fixed inset-0 z-50 hidden select-none';
  document.body.appendChild(modalRootEl);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalRootEl && !modalRootEl.classList.contains('hidden')) {
      closeRefuelModal();
    }
  });
}

/**
 * Opens the Refuel Modal with state memory from IndexedDB.
 * Supports creating a new refuel log or editing an existing one.
 * @param {Object} [options]
 * @param {Object} [options.log] - Log to edit
 * @param {Object} [options.reading] - Alias for log
 * @param {number} [options.initialOdo]
 * @param {string} [options.initialDate]
 * @param {Function} [options.onSave]
 */
export async function openRefuelModal(options = {}) {
  initRefuelModal();
  playHorologyTick(1400, 0.018, 0.035);

  const editLog = options.log || options.reading || null;
  const isEditing = Boolean(editLog && (editLog.id || editLog.date));
  const existingId = editLog?.id || editLog?.date || null;

  let profile = {
    tankCapacityLiters: 35.0,
    tankCapacityGallons: 9.25,
    fuelPriceCop: 16000,
    gaugeStyle: 'spicy-arc',
    refuelHabit: 'always_full'
  };

  try {
    if (store && typeof store.getState === 'function') {
      const state = store.getState();
      if (state.vehicleProfile) profile = { ...profile, ...state.vehicleProfile };
    } else {
      const dbProfile = await getVehicleProfile();
      if (dbProfile) profile = { ...profile, ...dbProfile };
    }
  } catch (_) {}

  let latestLog = null;
  let latestOdo = 0;
  let latestPct = 50;
  let hasLogs = false;
  let sortedLogs = [];

  try {
    const logs = await getTelemetryLogs();
    if (Array.isArray(logs) && logs.length > 0) {
      hasLogs = true;
      sortedLogs = [...logs].sort((a, b) => {
        if (a.date !== b.date) return a.date > b.date ? 1 : -1;
        return (Number(a.odometer_reading) || 0) - (Number(b.odometer_reading) || 0);
      });
      latestLog = sortedLogs[sortedLogs.length - 1];
      if (latestLog) {
        if (!isNaN(Number(latestLog.odometer_reading))) {
          latestOdo = Number(latestLog.odometer_reading);
        }
        if (latestLog.fuel_level_percent !== undefined && !isNaN(Number(latestLog.fuel_level_percent))) {
          latestPct = Number(latestLog.fuel_level_percent);
        }
      }
    }
  } catch (err) {
    console.warn('[OCTANE] Refuel modal log fetch issue:', err);
  }

  const gpsLiveOdo = Number(profile?.gpsCache?.live?.totalMile) || 0;
  const effectiveBaseOdo = Math.max(latestOdo, gpsLiveOdo);

  const startingOdo = (editLog && editLog.odometer_reading !== undefined)
    ? editLog.odometer_reading
    : (options.initialOdo !== undefined
        ? options.initialOdo
        : (hasLogs || gpsLiveOdo > 0 ? effectiveBaseOdo : 0));

  const tankGallons = profile.tankCapacityGallons || 9.25;

  let currentPrice = profile.fuelPriceCop || 16000;
  if (editLog && editLog.total_cost_cop && editLog.gallons_added > 0) {
    currentPrice = Math.round(editLog.total_cost_cop / editLog.gallons_added);
  }

  const todayStr = todayLocalYmd();
  const selectedDate = editLog?.date || options.initialDate || todayStr;

  const now = new Date();
  const defaultCurrentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  let initialTime = editLog?.time || '';
  if (!initialTime && editLog?.createdAt) {
    try {
      const d = new Date(editLog.createdAt);
      if (!isNaN(d.getTime())) {
        initialTime = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      }
    } catch (_) {}
  }
  if (!initialTime) {
    initialTime = defaultCurrentTime;
  }

  // Determine initial habit tab
  let activeTab = 'full';
  if (isEditing) {
    if (editLog.is_full_tank) {
      activeTab = 'full';
    } else if (editLog.gallons_added > 0) {
      activeTab = 'exact';
    } else if (editLog.total_cost_cop > 0) {
      activeTab = 'amount';
    }
  } else if (options.defaultFull === true) {
    activeTab = 'full';
  } else {
    if (profile.refuelHabit === 'exact_gallons') {
      activeTab = 'exact';
    } else if (profile.refuelHabit === 'fixed_amount') {
      activeTab = 'amount';
    }
  }

  let initialHeroVal = '';
  let initialTotalVal = '';

  if (isEditing) {
    if (activeTab === 'amount') {
      initialHeroVal = editLog.total_cost_cop ? formatThousandsLive(editLog.total_cost_cop) : '';
    } else {
      initialHeroVal = editLog.gallons_added ? String(editLog.gallons_added) : '';
    }
    initialTotalVal = editLog.total_cost_cop ? formatThousandsLive(editLog.total_cost_cop) : '';
  }

  modalRootEl.innerHTML = `
    <!-- Flat Backdrop Overlay (Zero Blur) -->
    <div class="refuel-backdrop fixed inset-0 bg-black/85 transition-opacity duration-150"></div>

    <!-- Modal Dialog Card -->
    <div class="fixed inset-0 overflow-y-auto flex items-end sm:items-center justify-center p-0 sm:p-4 z-10">
      <div class="refuel-card relative w-full max-w-sm bg-[var(--bg-surface)] border-t sm:border border-[var(--line-hair)] text-[var(--text-primary)] rounded-t-sm sm:rounded-none flex flex-col max-h-[96vh] sm:max-h-[90vh] overflow-hidden">
        
        <!-- Header Plano (h-12) -->
        <header class="flex items-center justify-between px-4 h-12 border-b border-[var(--line-hair)] bg-[var(--bg-void)]">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 bg-[var(--accent-amber)]"></span>
            <span class="font-mono text-xs tracking-widest uppercase font-semibold">
              ${isEditing ? 'Editar Tanqueada' : 'Nueva Tanqueada'}
            </span>
          </div>
          
          <button id="refuel-close-x" type="button" class="w-8 h-8 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--line-hair)] transition-colors cursor-pointer" title="Cerrar">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        <!-- 3 Habit Tabs -->
        <div class="grid grid-cols-3 border-b border-[var(--line-hair)] bg-[var(--bg-void)] text-center font-mono text-[10px] tracking-wider uppercase divide-x divide-[var(--line-hair)]">
          <button 
            type="button" 
            id="tab-btn-full" 
            data-tab="full" 
            class="refuel-tab-btn py-2.5 px-1 cursor-pointer transition-colors ${activeTab === 'full' ? 'bg-[var(--bg-surface)] text-[var(--accent-amber)] font-bold border-b-2 border-b-[var(--accent-amber)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]'}"
          >
            A FULL (100%)
          </button>
          
          <button 
            type="button" 
            id="tab-btn-exact" 
            data-tab="exact" 
            class="refuel-tab-btn py-2.5 px-1 cursor-pointer transition-colors ${activeTab === 'exact' ? 'bg-[var(--bg-surface)] text-[var(--accent-amber)] font-bold border-b-2 border-b-[var(--accent-amber)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]'}"
          >
            GALONES EXACTOS
          </button>
          
          <button 
            type="button" 
            id="tab-btn-amount" 
            data-tab="amount" 
            class="refuel-tab-btn py-2.5 px-1 cursor-pointer transition-colors ${activeTab === 'amount' ? 'bg-[var(--bg-surface)] text-[var(--accent-amber)] font-bold border-b-2 border-b-[var(--accent-amber)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]'}"
          >
            POR MONTO ($)
          </button>
        </div>

        <!-- Hero Input Area -->
        <div class="p-5 sm:p-6 bg-[var(--bg-void)] flex flex-col items-center justify-center text-center">
          <span id="refuel-hero-label" class="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)] mb-2">
            GALONES SUMINISTRADOS
          </span>
          
          <input 
            id="refuel-hero-input" 
            type="text" 
            inputmode="none" 
            data-decimal="true" 
            placeholder="0.000" 
            value="${initialHeroVal}"
            class="w-full font-sans font-light text-5xl sm:text-6xl tracking-tighter tabular-nums text-center bg-transparent border-0 border-b border-transparent focus:border-[var(--accent-amber)] transition-colors outline-none text-[var(--text-primary)] placeholder:text-[var(--text-muted)]" 
          />

          <!-- Sub-readout Liters / Gallons equivalent -->
          <span id="refuel-sub-readout" class="font-mono text-xs text-[var(--text-secondary)] tabular-nums mt-1">
            0.00 L
          </span>

          <!-- Capacity Warning -->
          <div id="refuel-capacity-warning" class="hidden font-mono text-[10px] text-[var(--accent-crimson)] tracking-wider mt-1 uppercase">
            SUPERA CAPACIDAD FÍSICA (${tankGallons} GAL)
          </div>

          <!-- Transition Preview Bar -->
          <div class="w-full max-w-[260px] mt-4 flex flex-col items-center gap-1.5">
            <div class="w-full flex items-center justify-between text-[10px] font-mono text-[var(--text-secondary)] tabular-nums">
              <span>NIVEL ESTIMADO</span>
              <span id="refuel-preview-text" class="text-[var(--accent-volt)] font-semibold">${Math.round(latestPct)}% → 100%</span>
            </div>
            <div class="w-full h-1 bg-[var(--line-hair)] overflow-hidden rounded-none">
              <div id="refuel-preview-bar" class="h-full bg-[var(--accent-volt)] transition-all duration-200" style="width: 100%"></div>
            </div>
          </div>
        </div>

        <!-- Fecha Strip -->
        <div class="flex items-center justify-between px-4 py-2 border-t border-[var(--line-hair)] bg-[var(--bg-void)] text-[10px] font-mono text-[var(--text-secondary)]">
          <span class="uppercase tracking-wider">FECHA Y HORA</span>
          <div class="flex items-center gap-2">
            <input 
              id="refuel-date-input" 
              type="date" 
              value="${selectedDate}" 
              class="bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] font-mono text-xs text-[var(--text-primary)] tabular-nums py-0.5 outline-none text-right cursor-pointer" 
            />
            <input 
              id="refuel-time-input" 
              type="time" 
              value="${initialTime}" 
              class="bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] font-mono text-xs text-[var(--text-primary)] tabular-nums py-0.5 outline-none text-right cursor-pointer" 
            />
          </div>
        </div>

        <!-- Franja Inferior de 3 Celdas (Responsive 360px+) -->
        <div class="grid grid-cols-3 border-t border-[var(--line-hair)] divide-x divide-[var(--line-hair)] bg-[var(--bg-surface)]">
          <!-- Celda 1: ODÓMETRO -->
          <div class="p-2 sm:p-3 flex flex-col justify-between overflow-hidden">
            <span class="block text-[9px] sm:text-[10px] font-mono uppercase tracking-wider text-[var(--text-secondary)] mb-1 truncate">ODÓMETRO</span>
            <input 
              id="refuel-odo-input" 
              type="text" 
              inputmode="none" 
              data-format="thousands" 
              value="${formatThousandsLive(startingOdo)}" 
              class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-1 sm:py-1.5 font-sans font-light text-lg sm:text-2xl tracking-tighter tabular-nums outline-none text-[var(--text-primary)]" 
            />
          </div>

          <!-- Celda 2: $ / GALÓN -->
          <div class="p-2 sm:p-3 flex flex-col justify-between overflow-hidden">
            <span class="block text-[9px] sm:text-[10px] font-mono uppercase tracking-wider text-[var(--text-secondary)] mb-1 truncate">$ / GALÓN</span>
            <input 
              id="refuel-price-input" 
              type="text" 
              inputmode="none" 
              data-format="thousands" 
              value="${formatThousandsLive(currentPrice)}" 
              class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-1 sm:py-1.5 font-sans font-light text-lg sm:text-2xl tracking-tighter tabular-nums outline-none text-[var(--text-primary)]" 
            />
          </div>

          <!-- Celda 3: COSTO TOTAL -->
          <div class="p-2 sm:p-3 flex flex-col justify-between overflow-hidden">
            <span class="block text-[9px] sm:text-[10px] font-mono uppercase tracking-wider text-[var(--text-secondary)] mb-1 truncate">COSTO TOTAL</span>
            <input 
              id="refuel-total-input" 
              type="text" 
              inputmode="none" 
              data-format="thousands" 
              placeholder="0" 
              value="${initialTotalVal}" 
              class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-1 sm:py-1.5 font-sans font-light text-lg sm:text-2xl tracking-tighter tabular-nums outline-none text-[var(--accent-amber)]" 
            />
          </div>
        </div>

        <!-- In-App Tactile Numeric Keypad Slot -->
        <div id="refuel-keypad-slot" class="shrink-0"></div>

        <!-- Footer de Acción (Edición con Borrar vs Creación) -->
        ${isEditing ? `
          <div id="refuel-edit-action-container" class="grid grid-cols-12 divide-x divide-[var(--line-hair)] border-t border-[var(--line-hair)] shrink-0 bg-[var(--bg-void)]">
            <button 
              id="refuel-delete-btn" 
              type="button" 
              class="col-span-4 h-12 bg-transparent hover:bg-[var(--accent-crimson)]/10 text-[var(--accent-crimson)] font-mono text-xs uppercase tracking-wider font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              title="Eliminar tanqueada permanentemente"
            >
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <span>BORRAR</span>
            </button>
            <button 
              id="refuel-submit-btn" 
              type="button" 
              class="col-span-8 h-12 bg-[var(--accent-amber)] hover:bg-[var(--accent-amber)]/90 text-[var(--bg-void)] font-mono text-xs font-semibold uppercase tracking-widest transition-colors flex items-center justify-center cursor-pointer"
            >
              GUARDAR CAMBIOS
            </button>
          </div>
        ` : `
          <button 
            id="refuel-submit-btn" 
            type="button" 
            class="h-12 w-full bg-[var(--accent-amber)] hover:bg-[var(--accent-amber)]/90 text-[var(--bg-void)] font-mono text-xs font-semibold uppercase tracking-widest transition-colors flex items-center justify-center cursor-pointer shrink-0"
          >
            REGISTRAR TANQUEADA
          </button>
        `}

      </div>
    </div>
  `;

  modalRootEl.classList.remove('hidden');

  const tabBtns = modalRootEl.querySelectorAll('.refuel-tab-btn');
  const heroLabel = modalRootEl.querySelector('#refuel-hero-label');
  const heroInput = modalRootEl.querySelector('#refuel-hero-input');
  const subReadout = modalRootEl.querySelector('#refuel-sub-readout');
  const capacityWarnEl = modalRootEl.querySelector('#refuel-capacity-warning');
  const previewText = modalRootEl.querySelector('#refuel-preview-text');
  const previewBar = modalRootEl.querySelector('#refuel-preview-bar');
  const dateInput = modalRootEl.querySelector('#refuel-date-input');
  const odoInput = modalRootEl.querySelector('#refuel-odo-input');
  const priceInput = modalRootEl.querySelector('#refuel-price-input');
  const totalInput = modalRootEl.querySelector('#refuel-total-input');
  const submitBtn = modalRootEl.querySelector('#refuel-submit-btn');
  const closeX = modalRootEl.querySelector('#refuel-close-x');
  const backdrop = modalRootEl.querySelector('.refuel-backdrop');

  function updateTabAppearance() {
    tabBtns.forEach(b => {
      const isCurrent = b.dataset.tab === activeTab;
      b.className = `refuel-tab-btn py-2.5 px-1 cursor-pointer transition-colors ${
        isCurrent 
          ? 'bg-[var(--bg-surface)] text-[var(--accent-amber)] font-bold border-b-2 border-b-[var(--accent-amber)]' 
          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]'
      }`;
    });

    if (activeTab === 'full') {
      heroLabel.innerText = 'GALONES HASTA EL TOPE';
      heroInput.placeholder = '0.000';
    } else if (activeTab === 'exact') {
      heroLabel.innerText = 'GALONES EXACTOS';
      heroInput.placeholder = '0.000';
    } else if (activeTab === 'amount') {
      heroLabel.innerText = 'MONTO EN PESOS (COP)';
      heroInput.placeholder = '0';
    }

    recalcAll();
  }

  function recalcAll() {
    const price = parseIntegerMetric(priceInput.value) || currentPrice;
    let computedGallons = 0;
    let computedTotal = 0;
    let targetPct = 100;

    if (activeTab === 'full' || activeTab === 'exact') {
      computedGallons = parseFuelVolume(heroInput.value, tankGallons);
      computedTotal = Math.round(computedGallons * price);
      if (document.activeElement !== totalInput) {
        totalInput.value = computedTotal > 0 ? formatThousandsLive(computedTotal) : '';
      }
      subReadout.innerText = computedGallons > 0 ? `${(computedGallons * GAL_TO_L).toFixed(2)} L` : '0.00 L';

      if (activeTab === 'full') {
        targetPct = 100;
        previewText.innerText = `${Math.round(latestPct)}% → 100% (LLENO)`;
        previewBar.style.width = '100%';
        previewBar.style.backgroundColor = 'var(--accent-volt)';
      } else {
        const addedPct = tankGallons > 0 ? (computedGallons / tankGallons) * 100 : 0;
        targetPct = clamp(Math.round(latestPct + addedPct), 0, 100);
        previewText.innerText = `${Math.round(latestPct)}% → ${targetPct}%`;
        previewBar.style.width = `${targetPct}%`;
        previewBar.style.backgroundColor = targetPct > 25 ? 'var(--accent-volt)' : 'var(--accent-amber)';
      }
    } else if (activeTab === 'amount') {
      computedTotal = parseIntegerMetric(heroInput.value);
      computedGallons = price > 0 ? Number((computedTotal / price).toFixed(3)) : 0;
      totalInput.value = computedTotal > 0 ? formatThousandsLive(computedTotal) : '';
      subReadout.innerText = computedTotal > 0 
        ? `${computedGallons.toFixed(3)} GAL · ${(computedGallons * GAL_TO_L).toFixed(1)} L` 
        : '0.000 GAL · 0.00 L';

      const addedPct = tankGallons > 0 ? (computedGallons / tankGallons) * 100 : 0;
      targetPct = clamp(Math.round(latestPct + addedPct), 0, 100);
      previewText.innerText = `${Math.round(latestPct)}% → ${targetPct}%`;
      previewBar.style.width = `${targetPct}%`;
      previewBar.style.backgroundColor = targetPct > 25 ? 'var(--accent-volt)' : 'var(--accent-amber)';
    }

    // Capacity physical boundary check
    const maxAllowed = tankGallons * 1.25;
    if (computedGallons > maxAllowed) {
      if (capacityWarnEl) {
        capacityWarnEl.classList.remove('hidden');
        capacityWarnEl.innerText = `SUPERA CAPACIDAD FÍSICA (${tankGallons} GAL MÁX)`;
      }
      heroInput.classList.add('text-[var(--accent-crimson)]');
    } else {
      if (capacityWarnEl) capacityWarnEl.classList.add('hidden');
      heroInput.classList.remove('text-[var(--accent-crimson)]');
    }
  }

  // Tab switching
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      playHorologyTick(1200, 0.012, 0.02);
      activeTab = btn.dataset.tab;
      heroInput.value = '';
      totalInput.value = '';
      updateTabAppearance();
      heroInput.focus();
    });
  });

  // Inputs listeners
  heroInput.addEventListener('input', () => {
    if (activeTab === 'amount') {
      heroInput.value = formatThousandsLive(heroInput.value);
    }
    recalcAll();
  });

  odoInput.addEventListener('input', () => {
    odoInput.value = formatThousandsLive(odoInput.value);
  });

  priceInput.addEventListener('input', () => {
    priceInput.value = formatThousandsLive(priceInput.value);
    const price = parseIntegerMetric(priceInput.value) || 0;
    if (activeTab === 'amount') {
      recalcAll();
    } else {
      const gal = parseFuelVolume(heroInput.value, tankGallons);
      if (gal > 0 && price > 0) {
        totalInput.value = formatThousandsLive(Math.round(gal * price));
      }
    }
  });

  totalInput.addEventListener('input', () => {
    totalInput.value = formatThousandsLive(totalInput.value);
    const total = parseIntegerMetric(totalInput.value);
    const price = parseIntegerMetric(priceInput.value) || currentPrice || 16000;

    if (activeTab === 'amount') {
      heroInput.value = total > 0 ? formatThousandsLive(total) : '';
      recalcAll();
    } else {
      const gal = parseFuelVolume(heroInput.value, tankGallons);
      if (total > 0 && gal > 0) {
        priceInput.value = formatThousandsLive(Math.round(total / gal));
      } else if (total > 0 && gal <= 0 && price > 0) {
        const autoGal = Number((total / price).toFixed(3));
        heroInput.value = String(autoGal);
        recalcAll();
      }
    }
  });

  // Focus ergonomics & Cursor stabilization
  [heroInput, odoInput, priceInput, totalInput].forEach(inp => {
    inp.addEventListener('focus', () => setCursorAtEnd(inp));
    inp.addEventListener('click', () => setCursorAtEnd(inp));
  });

  // Attach In-App Tactile Numeric Keypad
  const refuelKeypadSlot = modalRootEl.querySelector('#refuel-keypad-slot');
  if (refuelKeypadSlot) {
    createNumericKeypad({
      container: refuelKeypadSlot,
      inputs: [heroInput, odoInput, priceInput, totalInput],
      onConfirm: () => submitBtn.click(),
      onInput: () => recalcAll()
    });
  }

  // Dismiss listeners
  closeX.addEventListener('click', closeRefuelModal);
  backdrop.addEventListener('click', closeRefuelModal);

  // 2-step Delete Handler when editing an existing refuel
  const deleteBtn = modalRootEl.querySelector('#refuel-delete-btn');
  const actionContainer = modalRootEl.querySelector('#refuel-edit-action-container');
  if (deleteBtn && actionContainer && isEditing && existingId) {
    deleteBtn.addEventListener('click', () => {
      playHorologyTick(1000, 0.015, 0.02);
      actionContainer.innerHTML = `
        <div class="col-span-12 h-12 flex items-center justify-between px-3 bg-[var(--bg-void)] text-[var(--text-primary)] font-mono text-xs">
          <span class="text-[var(--accent-crimson)] font-semibold tracking-wider uppercase text-[10px] sm:text-[11px]">
            ¿ELIMINAR TANQUEADA?
          </span>
          <div class="flex items-center gap-1.5">
            <button 
              id="refuel-delete-cancel-btn" 
              type="button" 
              class="h-8 px-2.5 border border-[var(--line-hair)] bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] uppercase text-[10px] tracking-wider font-semibold cursor-pointer transition-colors"
            >
              CANCELAR
            </button>
            <button 
              id="refuel-delete-confirm-btn" 
              type="button" 
              class="h-8 px-2.5 bg-[var(--accent-crimson)] text-white hover:bg-[var(--accent-crimson)]/90 uppercase text-[10px] tracking-wider font-bold cursor-pointer transition-colors"
            >
              SÍ, BORRAR
            </button>
          </div>
        </div>
      `;

      actionContainer.querySelector('#refuel-delete-cancel-btn')?.addEventListener('click', () => {
        playHorologyTick(1100, 0.012, 0.02);
        openRefuelModal(options);
      });

      actionContainer.querySelector('#refuel-delete-confirm-btn')?.addEventListener('click', async () => {
        playHorologyTick(800, 0.025, 0.04);
        try {
          await deleteTelemetryLog(existingId);
          const updatedLogs = (await getTelemetryLogs()).filter(
            x => !((x.id && String(x.id) === String(existingId)) || x.date === existingId)
          );
          try {
            localStorage.setItem('octane_kinetic_v1', JSON.stringify(updatedLogs));
          } catch (_) {}

          let engineResults = null;
          if (typeof recalculateTelemetry === 'function') {
            engineResults = recalculateTelemetry(updatedLogs, profile);
          }
          if (store && typeof store.setState === 'function') {
            store.setState({
              telemetryLogs: updatedLogs,
              telemetryEngineResults: engineResults
            });
          }
          if (typeof syncToCloud === 'function') {
            syncToCloud();
          }
          window.dispatchEvent(new CustomEvent('octane:delete-log', { detail: { id: existingId, date: editLog?.date } }));
          window.dispatchEvent(new CustomEvent('octane:logs-updated', { detail: { logs: updatedLogs } }));
          showToast('TANQUEADA ELIMINADA');
          closeRefuelModal();
        } catch (err) {
          console.error('[OCTANE] Error deleting refuel:', err);
          showToast('ERROR AL ELIMINAR');
        }
      });
    });
  }

  // Submit Handler
  submitBtn.addEventListener('click', async () => {
    const priceVal = parseIntegerMetric(priceInput.value) || currentPrice || 16000;
    const odoVal = parseIntegerMetric(odoInput.value);
    const dateVal = dateInput?.value ? dateInput.value.trim() : todayStr;
    const timeInput = modalRootEl.querySelector('#refuel-time-input');
    const timeVal = timeInput ? timeInput.value.trim() : '';

    let galVal = 0;
    let totalVal = 0;

    if (activeTab === 'amount') {
      totalVal = parseIntegerMetric(heroInput.value) || parseIntegerMetric(totalInput.value);
      galVal = priceVal > 0 ? Number((totalVal / priceVal).toFixed(3)) : 0;
    } else {
      galVal = parseFuelVolume(heroInput.value, tankGallons);
      const userTotal = parseIntegerMetric(totalInput.value);
      totalVal = userTotal > 0 ? userTotal : Math.round(galVal * priceVal);
    }

    if (galVal <= 0 || (activeTab === 'amount' && totalVal <= 0)) {
      showToast(activeTab === 'amount' ? 'INGRESA EL MONTO' : 'INGRESA LOS GALONES');
      heroInput.focus();
      return;
    }

    const maxAllowed = tankGallons * 1.25;
    if (galVal > maxAllowed) {
      playHorologyTick(400, 0.04, 0.08);
      showToast(`MÁXIMO ${tankGallons} GAL`);
      heroInput.focus();
      return;
    }

    if (isNaN(odoVal) || odoVal < 0) {
      showToast('INGRESA EL KILOMETRAJE');
      odoInput.focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.classList.add('opacity-70', 'pointer-events-none');

    try {
      const isFullTank = activeTab === 'full' || ((latestPct + (galVal / tankGallons) * 100) >= 99);
      const resultingPct = isFullTank
        ? 100
        : clamp(Math.round(latestPct + (galVal / tankGallons) * 100), 0, 100);

      const deltaKm = (editLog && editLog.distance_km !== undefined)
        ? editLog.distance_km
        : ((hasLogs && latestOdo > 0) ? Math.max(0, odoVal - latestOdo) : 0);

      // Resolve previous log before this refuel to window GPS telemetry enrichment
      const priorLogs = sortedLogs.filter(l => (!existingId || l.id !== existingId) && l.date <= dateVal);
      const prevLog = priorLogs.length > 0 ? priorLogs[priorLogs.length - 1] : null;

      // Learn gas station geofence or resolve recent pendingStationMatch (within 6h) BEFORE building logPayload
      let matchedStation = null;
      let profileDirty = false;
      const rawCoords = options.coords || options.gpsStop || options.stop?.coords || options.stop || options.location || (
        profile?.gpsCache?.live?.lat && profile?.gpsCache?.live?.lng
          ? { lat: profile.gpsCache.live.lat, lng: profile.gpsCache.live.lng }
          : null
      );
      if (rawCoords) {
        const cLat = Number(rawCoords.lat ?? rawCoords.latitude);
        const cLng = Number(rawCoords.lng ?? rawCoords.longitude ?? rawCoords.lon);
        if (!isNaN(cLat) && !isNaN(cLng) && (cLat !== 0 || cLng !== 0)) {
          const stationName = options.stationName || options.stop?.name || options.name;
          matchedStation = learnGasStation(profile, { lat: cLat, lng: cLng }, stationName);
          profileDirty = true;
        }
      }
      if (!matchedStation && profile?.gpsCache?.pendingStationMatch) {
        const pending = profile.gpsCache.pendingStationMatch;
        const detectedMs = Date.parse(pending.detectedAt || '');
        if (Number.isFinite(detectedMs) && (Date.now() - detectedMs) <= 6 * 3600 * 1000) {
          matchedStation = {
            id: pending.stationId,
            name: pending.stationName
          };
        }
      }

      if (!isEditing && profile?.gpsCache?.pendingStationMatch) {
        profile.gpsCache = {
          ...profile.gpsCache,
          pendingStationMatch: null
        };
        profileDirty = true;
      }

      const enrichment = buildRefuelTelemetryEnrichment({
        prevLog,
        refuelDate: dateVal,
        gpsCache: profile?.gpsCache || null,
        matchedStation
      });

      const logPayload = {
        ...(editLog || {}),
        date: dateVal,
        time: timeVal || editLog?.time || undefined,
        createdAt: editLog?.createdAt || new Date().toISOString(),
        odometer_reading: odoVal,
        fuel_level_percent: resultingPct,
        refuels_count: 1,
        gallons_added: Number(galVal.toFixed(3)),
        is_full_tank: isFullTank,
        total_cost_cop: Math.round(totalVal),
        distance_km: deltaKm,
        duration_seconds: editLog?.duration_seconds || enrichment.duration_seconds,
        idle_seconds: editLog?.idle_seconds || enrichment.idle_seconds,
        idle_ratio: editLog?.idle_ratio || enrichment.idle_ratio,
        acceleration_variance: editLog?.acceleration_variance || enrichment.acceleration_variance,
        max_speed_kmh: editLog?.max_speed_kmh || enrichment.max_speed_kmh,
        thermal_stress_score: editLog?.thermal_stress_score || enrichment.thermal_stress_score,
        ...(enrichment.stationId ? { stationId: enrichment.stationId } : {}),
        ...(enrichment.stationName ? { stationName: enrichment.stationName } : {}),
        updatedAt: new Date().toISOString()
      };

      if (isEditing && existingId) {
        logPayload.id = existingId;
        await updateTelemetryLog(logPayload);
      } else {
        await addTelemetryLog(logPayload);
      }

      // Update vehicle profile fuel price if modified
      if (priceVal > 0 && priceVal !== profile.fuelPriceCop) {
        profile.fuelPriceCop = priceVal;
        profileDirty = true;
      }

      if (profileDirty) {
        try {
          await saveVehicleProfile(profile);
        } catch (_) {}
      }

      const updatedLogs = await getTelemetryLogs();
      let engineResults = null;
      if (typeof recalculateTelemetry === 'function') {
        engineResults = recalculateTelemetry(updatedLogs, profile);
      }

      if (store && typeof store.setState === 'function') {
        store.setState({
          telemetryLogs: updatedLogs,
          telemetryEngineResults: engineResults,
          vehicleProfile: profile,
          fuelPriceCop: priceVal
        });
      }

      if (typeof syncToCloud === 'function') {
        syncToCloud();
      }

      // Bidirectional odometer calibration: sync manual dashboard reading back to IOPGPS
      if (odoVal > 0 && typeof calibrateGpsOdometer === 'function') {
        calibrateGpsOdometer(odoVal).catch(() => {});
      }

      window.dispatchEvent(new CustomEvent('octane:telemetry-updated', { detail: { log: logPayload } }));
      window.dispatchEvent(new CustomEvent('octane:logs-updated', { detail: { logs: updatedLogs, log: logPayload } }));
      if (typeof options.onSave === 'function') {
        options.onSave(logPayload);
      }

      playHorologyTick(1650, 0.025, 0.04);
      showToast(isEditing ? 'CAMBIOS GUARDADOS' : 'TANQUEADA REGISTRADA');
      closeRefuelModal();
    } catch (err) {
      console.error('[OCTANE] Error saving refuel:', err);
      showToast('NO SE PUDO GUARDAR · REINTENTA');
      submitBtn.disabled = false;
      submitBtn.classList.remove('opacity-70', 'pointer-events-none');
    }
  });

  updateTabAppearance();
}

/**
 * Closes and unmounts the Refuel Modal.
 */
export function closeRefuelModal() {
  playHorologyTick(900, 0.012, 0.02);
  if (modalRootEl) {
    modalRootEl.classList.add('hidden');
    modalRootEl.innerHTML = '';
  }
}
