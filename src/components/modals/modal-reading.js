/**
 * OCTANE // KINETIC — Modal 01 / LECTURA
 * Industrial Minimalist Fuel Reading Modal (Teenage Engineering / Braun style).
 * 
 * Strict specifications:
 * - Direct tactile gauge drag with precision horology tick on 1% notch change.
 * - Dynamic needle color (--accent-volt >25%, --accent-amber 14-25%, --accent-crimson <14%).
 * - Big typographic readout: 24% + 8.2 L · 2.17 GAL.
 * - Dedicated horizontal FECHA strip (no mobile cutoff).
 * - Full 12-col ODOMETER with live +XX KM badge.
 * - Memory of state from IndexedDB (loads latest odometer & fuel percent).
 * - Full edit mode support (prefilling existing log date, odometer, fuel percent).
 * - Live precision thousands dot formatting on odometer entry.
 * - Single full-width action button: GUARDAR LECTURA / GUARDAR CAMBIOS.
 * - Zero <p> tags. All labels under 4 words.
 */

import { todayLocalYmd } from '../../core/date-utils.js';
import { store, playHorologyTick, showToast } from '../../core/state.js';
import {
  addTelemetryLog,
  updateTelemetryLog,
  deleteTelemetryLog,
  getTelemetryLogs,
  getVehicleProfile
} from '../../core/db-local.js';
import { recalculateTelemetry } from '../../core/telemetry-engine.js';
import { syncToCloud } from '../../core/firebase-sync.js';
import { calibrateGpsOdometer } from '../../core/iopgps-sync.js';
import { calculateFuelVolume, clamp } from '../fuel-gauges/gauge-controller.js';
import { renderSpicyArcGauge } from '../fuel-gauges/gauge-spicy-arc.js';
import { renderAnalog180Gauge } from '../fuel-gauges/gauge-analog-180.js';
import { renderDigitalLcdGauge } from '../fuel-gauges/gauge-digital-lcd.js';
import { renderSightGlassGauge } from '../fuel-gauges/gauge-sight-glass.js';
import { parseIntegerMetric, formatThousandsLive, setCursorAtEnd } from '../../core/number-utils.js';
import { createNumericKeypad } from '../keypad/numeric-keypad.js';

let modalRootEl = null;
let activeGauge = null;
let currentLevelPct = 50;

/**
 * Initializes the Reading modal root element in the DOM.
 */
export function initReadingModal() {
  if (document.getElementById('octane-reading-modal-container')) {
    modalRootEl = document.getElementById('octane-reading-modal-container');
    return;
  }

  modalRootEl = document.createElement('div');
  modalRootEl.id = 'octane-reading-modal-container';
  modalRootEl.className = 'fixed inset-0 z-50 hidden select-none';
  document.body.appendChild(modalRootEl);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalRootEl && !modalRootEl.classList.contains('hidden')) {
      closeReadingModal();
    }
  });
}

/**
 * Opens the Reading Modal with state memory from IndexedDB.
 * Supports creating a new reading or editing an existing one.
 * @param {Object} [options]
 * @param {Object} [options.log] - Log to edit
 * @param {Object} [options.reading] - Alias for log
 * @param {number} [options.initialOdo]
 * @param {number} [options.initialPct]
 * @param {string} [options.initialDate]
 * @param {Function} [options.onSave]
 */
export async function openReadingModal(options = {}) {
  initReadingModal();
  playHorologyTick(1400, 0.018, 0.035);

  const editLog = options.log || options.reading || null;
  const isEditing = Boolean(editLog && (editLog.id || editLog.date));
  const existingId = editLog?.id || editLog?.date || null;

  let profile = {
    tankCapacityLiters: 35.0,
    tankCapacityGallons: 9.25,
    fuelPriceCop: 16000,
    gaugeStyle: 'spicy-arc'
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

  try {
    const logs = await getTelemetryLogs();
    if (Array.isArray(logs) && logs.length > 0) {
      hasLogs = true;
      const sorted = [...logs].sort((a, b) => {
        if (a.date !== b.date) return a.date > b.date ? 1 : -1;
        return (Number(a.odometer_reading) || 0) - (Number(b.odometer_reading) || 0);
      });
      latestLog = sorted[sorted.length - 1];
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
    console.warn('[OCTANE] Reading modal log fetch issue:', err);
  }

  const gpsLiveOdo = Number(profile?.gpsCache?.live?.totalMile) || 0;
  const effectiveBaseOdo = Math.max(latestOdo, gpsLiveOdo);

  const startingOdo = (editLog && editLog.odometer_reading !== undefined)
    ? editLog.odometer_reading
    : (options.initialOdo !== undefined
        ? options.initialOdo
        : (hasLogs || gpsLiveOdo > 0 ? effectiveBaseOdo : 0));

  currentLevelPct = (editLog && editLog.fuel_level_percent !== undefined)
    ? clamp(Number(editLog.fuel_level_percent), 0, 100)
    : (options.initialPct !== undefined
        ? clamp(options.initialPct, 0, 100)
        : (hasLogs ? latestPct : 50));

  const todayDate = editLog?.date || options.initialDate || todayLocalYmd();
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
  const initialVols = calculateFuelVolume(currentLevelPct, profile.tankCapacityLiters, profile.tankCapacityGallons);

  modalRootEl.innerHTML = `
    <!-- Flat Backdrop Overlay (Zero Blur) -->
    <div class="reading-backdrop fixed inset-0 bg-black/85 transition-opacity duration-150"></div>

    <!-- Modal Dialog Card -->
    <div class="fixed inset-0 overflow-y-auto flex items-end sm:items-center justify-center p-0 sm:p-4 z-10">
      <div class="reading-card relative w-full max-w-sm bg-[var(--bg-surface)] border-t sm:border border-[var(--line-hair)] text-[var(--text-primary)] rounded-t-sm sm:rounded-none flex flex-col max-h-[96vh] sm:max-h-[90vh] overflow-hidden">
        
        <!-- Header Plano (h-12) -->
        <header class="flex items-center justify-between px-4 h-12 border-b border-[var(--line-hair)] bg-[var(--bg-void)]">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 bg-[var(--accent-amber)]"></span>
            <span class="font-mono text-xs tracking-widest uppercase font-semibold">
              ${isEditing ? 'Editar Lectura' : 'Nueva Lectura'}
            </span>
          </div>
          <button id="reading-close-x" type="button" class="w-8 h-8 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--line-hair)] transition-colors" title="Cerrar">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        <!-- Escenario Táctil Puro -->
        <div class="relative flex flex-col items-center justify-center pt-5 pb-4 px-4 bg-[var(--bg-void)]">
          <!-- Active Gauge Mount -->
          <div id="reading-gauge-stage" class="w-full flex items-center justify-center"></div>

          <!-- Big Typographic Readout -->
          <div class="flex flex-col items-center mt-2 text-center select-none">
            <span id="reading-hero-pct" class="font-sans font-light text-6xl tracking-tighter tabular-nums leading-none text-[var(--text-primary)]">
              ${Math.round(currentLevelPct)}%
            </span>
            <span id="reading-hero-vol" class="font-mono text-xs text-[var(--text-secondary)] tabular-nums mt-1.5">
              ${initialVols.liters.toFixed(1)} L · ${initialVols.gallons.toFixed(2)} GAL
            </span>
          </div>
        </div>

        <!-- Franja Dedicada — FECHA Y HORA -->
        <div class="flex items-center justify-between px-4 py-2 border-t border-[var(--line-hair)] bg-[var(--bg-void)] text-[10px] font-mono text-[var(--text-secondary)]">
          <span class="uppercase tracking-wider">FECHA Y HORA</span>
          <div class="flex items-center gap-2">
            <input 
              id="reading-date-input" 
              type="date" 
              value="${todayDate}" 
              class="bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] font-mono text-xs text-[var(--text-primary)] tabular-nums py-0.5 outline-none text-right cursor-pointer" 
            />
            <input 
              id="reading-time-input" 
              type="time" 
              value="${initialTime}" 
              class="bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] font-mono text-xs text-[var(--text-primary)] tabular-nums py-0.5 outline-none text-right cursor-pointer" 
            />
          </div>
        </div>

        <!-- Franja Inferior — ODÓMETRO (12 cols) -->
        <div class="grid grid-cols-12 border-t border-[var(--line-hair)] bg-[var(--bg-surface)]">
          <!-- Celda Completa (12 cols) — ODÓMETRO -->
          <div class="col-span-12 p-3 sm:p-4 flex flex-col justify-between overflow-hidden">
            <div class="flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.2em] text-[var(--text-secondary)] mb-1">
              <span>ODÓMETRO</span>
              <span id="reading-delta-badge" class="font-mono font-medium text-[10px] tabular-nums text-[var(--accent-volt)]">
                ${hasLogs ? '+0 KM' : 'BASE'}
              </span>
            </div>
            <input 
              id="reading-odo-input" 
              type="text" 
              inputmode="none" 
              data-format="thousands" 
              value="${formatThousandsLive(startingOdo)}" 
              class="font-sans font-light text-3xl sm:text-5xl tracking-tighter tabular-nums bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-1.5 outline-none w-full text-[var(--text-primary)] leading-none" 
            />
          </div>
        </div>

        <!-- In-App Keypad Mount Slot -->
        <div id="reading-keypad-slot" class="shrink-0"></div>

        <!-- Footer de Acción (Edición con Borrar vs Creación) -->
        ${isEditing ? `
          <div id="reading-edit-action-container" class="grid grid-cols-12 divide-x divide-[var(--line-hair)] border-t border-[var(--line-hair)] shrink-0 bg-[var(--bg-void)]">
            <button 
              id="reading-delete-btn" 
              type="button" 
              class="col-span-4 h-12 bg-transparent hover:bg-[var(--accent-crimson)]/10 text-[var(--accent-crimson)] font-mono text-xs uppercase tracking-wider font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
              title="Eliminar lectura permanentemente"
            >
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              <span>BORRAR</span>
            </button>
            <button 
              id="reading-submit-btn" 
              type="button" 
              class="col-span-8 h-12 bg-[var(--accent-amber)] hover:bg-[var(--accent-amber)]/90 text-[var(--bg-void)] font-mono text-xs font-semibold uppercase tracking-widest transition-colors flex items-center justify-center cursor-pointer"
            >
              GUARDAR CAMBIOS
            </button>
          </div>
        ` : `
          <button 
            id="reading-submit-btn" 
            type="button" 
            class="h-12 w-full bg-[var(--accent-amber)] hover:bg-[var(--accent-amber)]/90 text-[var(--bg-void)] font-mono text-xs font-semibold uppercase tracking-widest transition-colors flex items-center justify-center cursor-pointer shrink-0"
          >
            GUARDAR LECTURA
          </button>
        `}

      </div>
    </div>
  `;

  modalRootEl.classList.remove('hidden');

  const stageEl = modalRootEl.querySelector('#reading-gauge-stage');
  const heroPctEl = modalRootEl.querySelector('#reading-hero-pct');
  const heroVolEl = modalRootEl.querySelector('#reading-hero-vol');
  const odoInput = modalRootEl.querySelector('#reading-odo-input');
  const dateInput = modalRootEl.querySelector('#reading-date-input');
  const deltaBadge = modalRootEl.querySelector('#reading-delta-badge');
  const submitBtn = modalRootEl.querySelector('#reading-submit-btn');
  const closeX = modalRootEl.querySelector('#reading-close-x');
  const backdrop = modalRootEl.querySelector('.reading-backdrop');

  function updateHeroReadout(pct) {
    const vols = calculateFuelVolume(pct, profile.tankCapacityLiters, profile.tankCapacityGallons);
    heroPctEl.innerText = `${Math.round(pct)}%`;
    heroVolEl.innerText = `${vols.liters.toFixed(1)} L · ${vols.gallons.toFixed(2)} GAL`;

    if (pct < 14) {
      heroPctEl.style.color = 'var(--accent-crimson)';
    } else if (pct <= 25) {
      heroPctEl.style.color = 'var(--accent-amber)';
    } else {
      heroPctEl.style.color = 'var(--text-primary)';
    }
  }

  // Mount active gauge style
  const gaugeStyle = profile.gaugeStyle || 'spicy-arc';
  const gaugeOpts = {
    initialValue: currentLevelPct,
    tankCapacityLiters: profile.tankCapacityLiters,
    tankCapacityGallons: profile.tankCapacityGallons,
    interactive: true,
    hideReadout: true,
    hideToolbar: true,
    notchStep: 1,
    onChange: (state) => {
      currentLevelPct = state.percent;
      updateHeroReadout(currentLevelPct);
    }
  };

  if (activeGauge && typeof activeGauge.destroy === 'function') {
    activeGauge.destroy();
  }

  switch (gaugeStyle) {
    case 'analog-180':
      activeGauge = renderAnalog180Gauge(stageEl, gaugeOpts);
      break;
    case 'digital-lcd':
      activeGauge = renderDigitalLcdGauge(stageEl, gaugeOpts);
      break;
    case 'sight-glass':
      activeGauge = renderSightGlassGauge(stageEl, gaugeOpts);
      break;
    case 'spicy-arc':
    default:
      activeGauge = renderSpicyArcGauge(stageEl, gaugeOpts);
      break;
  }

  updateHeroReadout(currentLevelPct);

  // Live Odometer Delta
  function updateDelta() {
    const val = parseIntegerMetric(odoInput.value);
    if (!val || val <= 0) {
      deltaBadge.innerText = '—';
      deltaBadge.style.color = 'var(--text-secondary)';
      return;
    }
    if (hasLogs && latestOdo > 0) {
      const diff = val - latestOdo;
      const sign = diff >= 0 ? '+' : '';
      deltaBadge.innerText = `${sign}${formatThousandsLive(Math.round(diff))} KM`;
      deltaBadge.style.color = diff >= 0 ? 'var(--accent-volt)' : 'var(--accent-crimson)';
    } else {
      deltaBadge.innerText = 'BASE';
      deltaBadge.style.color = 'var(--text-secondary)';
    }
  }

  odoInput.addEventListener('input', () => {
    odoInput.value = formatThousandsLive(odoInput.value);
    updateDelta();
  });

  odoInput.addEventListener('focus', () => {
    setCursorAtEnd(odoInput);
  });
  odoInput.addEventListener('click', () => {
    setCursorAtEnd(odoInput);
  });

  // Attach In-App Numeric Keypad
  const readingKeypadSlot = modalRootEl.querySelector('#reading-keypad-slot');
  if (readingKeypadSlot) {
    createNumericKeypad({
      container: readingKeypadSlot,
      inputs: [odoInput],
      onConfirm: () => submitBtn.click(),
      onInput: () => updateDelta()
    });
  }

  updateDelta();

  // Dismiss listeners
  closeX.addEventListener('click', closeReadingModal);
  backdrop.addEventListener('click', closeReadingModal);

  // 2-step Delete Handler when editing an existing reading
  const deleteBtn = modalRootEl.querySelector('#reading-delete-btn');
  const actionContainer = modalRootEl.querySelector('#reading-edit-action-container');
  if (deleteBtn && actionContainer && isEditing && existingId) {
    deleteBtn.addEventListener('click', () => {
      playHorologyTick(1000, 0.015, 0.02);
      actionContainer.innerHTML = `
        <div class="col-span-12 h-12 flex items-center justify-between px-3 bg-[var(--bg-void)] text-[var(--text-primary)] font-mono text-xs">
          <span class="text-[var(--accent-crimson)] font-semibold tracking-wider uppercase text-[10px] sm:text-[11px]">
            ¿ELIMINAR LECTURA?
          </span>
          <div class="flex items-center gap-1.5">
            <button 
              id="reading-delete-cancel-btn" 
              type="button" 
              class="h-8 px-2.5 border border-[var(--line-hair)] bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] uppercase text-[10px] tracking-wider font-semibold cursor-pointer transition-colors"
            >
              CANCELAR
            </button>
            <button 
              id="reading-delete-confirm-btn" 
              type="button" 
              class="h-8 px-2.5 bg-[var(--accent-crimson)] text-white hover:bg-[var(--accent-crimson)]/90 uppercase text-[10px] tracking-wider font-bold cursor-pointer transition-colors"
            >
              SÍ, BORRAR
            </button>
          </div>
        </div>
      `;

      actionContainer.querySelector('#reading-delete-cancel-btn')?.addEventListener('click', () => {
        playHorologyTick(1100, 0.012, 0.02);
        openReadingModal(options);
      });

      actionContainer.querySelector('#reading-delete-confirm-btn')?.addEventListener('click', async () => {
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
          showToast('LECTURA ELIMINADA');
          closeReadingModal();
        } catch (err) {
          console.error('[OCTANE] Error deleting reading:', err);
          showToast('ERROR AL ELIMINAR');
        }
      });
    });
  }

  // Submit Handler
  submitBtn.addEventListener('click', async () => {
    const odoVal = parseIntegerMetric(odoInput.value);
    const dateVal = dateInput.value.trim();
    const timeInput = modalRootEl.querySelector('#reading-time-input');
    const timeVal = timeInput ? timeInput.value.trim() : '';

    if (isNaN(odoVal) || odoVal <= 0) {
      showToast('INGRESA EL KILOMETRAJE');
      odoInput.focus();
      return;
    }

    if (!dateVal) {
      showToast('ELIGE UNA FECHA');
      dateInput.focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.classList.add('opacity-70', 'pointer-events-none');

    try {
      const deltaKm = (editLog && editLog.distance_km !== undefined)
        ? editLog.distance_km
        : ((hasLogs && latestOdo > 0) ? Math.max(0, odoVal - latestOdo) : 0);

      const logPayload = {
        ...(editLog || {}),
        date: dateVal,
        time: timeVal || editLog?.time || undefined,
        createdAt: editLog?.createdAt || new Date().toISOString(),
        odometer_reading: odoVal,
        fuel_level_percent: Math.round(currentLevelPct),
        refuels_count: editLog?.refuels_count || 0,
        gallons_added: editLog?.gallons_added || 0,
        is_full_tank: editLog ? Boolean(editLog.is_full_tank) : false,
        total_cost_cop: editLog?.total_cost_cop || 0,
        distance_km: deltaKm,
        duration_seconds: editLog?.duration_seconds || 0,
        idle_seconds: editLog?.idle_seconds || 0,
        idle_ratio: editLog?.idle_ratio || 0,
        acceleration_variance: editLog?.acceleration_variance || 0,
        max_speed_kmh: editLog?.max_speed_kmh || 0,
        thermal_stress_score: editLog?.thermal_stress_score || 0,
        updatedAt: new Date().toISOString()
      };

      if (isEditing && existingId) {
        logPayload.id = existingId;
        await updateTelemetryLog(logPayload);
      } else {
        await addTelemetryLog(logPayload);
      }

      const updatedLogs = await getTelemetryLogs();
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
      showToast(isEditing ? 'LECTURA ACTUALIZADA' : 'LECTURA GUARDADA');
      closeReadingModal();
    } catch (err) {
      console.error('[OCTANE] Error saving reading:', err);
      showToast('NO SE PUDO GUARDAR · REINTENTA');
      submitBtn.disabled = false;
      submitBtn.classList.remove('opacity-70', 'pointer-events-none');
    }
  });
}

/**
 * Closes and unmounts the Reading Modal.
 */
export function closeReadingModal() {
  playHorologyTick(900, 0.012, 0.02);
  if (activeGauge && typeof activeGauge.destroy === 'function') {
    activeGauge.destroy();
    activeGauge = null;
  }
  if (modalRootEl) {
    modalRootEl.classList.add('hidden');
    modalRootEl.innerHTML = '';
  }
}
