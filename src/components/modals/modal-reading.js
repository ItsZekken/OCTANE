/**
 * OCTANE // KINETIC — Modal 01 / LECTURA
 * Industrial Minimalist Fuel Reading Modal (Teenage Engineering / Braun style).
 * 
 * Strict specifications:
 * - Direct tactile gauge drag with precision horology tick on 1% notch change.
 * - Dynamic needle color (--accent-volt >25%, --accent-amber 14-25%, --accent-crimson <14%).
 * - Big typographic readout: 24% + 8.2 L · 2.17 GAL.
 * - Bottom split: 8-col ODOMETER with live +XX KM badge, 4-col DATE.
 * - Memory of state from IndexedDB (loads latest odometer & fuel percent).
 * - Single full-width action button: GUARDAR LECTURA.
 * - Zero <p> tags. All labels under 4 words.
 */

import { store, playHorologyTick, showToast } from '../../core/state.js';
import { addTelemetryLog, getTelemetryLogs, getVehicleProfile } from '../../core/db-local.js';
import { recalculateTelemetry } from '../../core/telemetry-engine.js';
import { syncToCloud } from '../../core/firebase-sync.js';
import { calculateFuelVolume, clamp } from '../fuel-gauges/gauge-controller.js';
import { renderSpicyArcGauge } from '../fuel-gauges/gauge-spicy-arc.js';
import { renderAnalog180Gauge } from '../fuel-gauges/gauge-analog-180.js';
import { renderDigitalLcdGauge } from '../fuel-gauges/gauge-digital-lcd.js';
import { renderSightGlassGauge } from '../fuel-gauges/gauge-sight-glass.js';

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
 * @param {Object} [options]
 */
export async function openReadingModal(options = {}) {
  initReadingModal();
  playHorologyTick(1400, 0.018, 0.035);

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

  const startingOdo = options.initialOdo !== undefined
    ? options.initialOdo
    : (hasLogs ? latestOdo : 0);

  currentLevelPct = options.initialPct !== undefined
    ? clamp(options.initialPct, 0, 100)
    : (hasLogs ? latestPct : 50);

  const todayDate = options.initialDate || new Date().toISOString().substring(0, 10);
  const initialVols = calculateFuelVolume(currentLevelPct, profile.tankCapacityLiters, profile.tankCapacityGallons);

  modalRootEl.innerHTML = `
    <!-- Flat Backdrop Overlay (Zero Blur) -->
    <div class="reading-backdrop fixed inset-0 bg-black/85 transition-opacity duration-150"></div>

    <!-- Modal Dialog Card -->
    <div class="fixed inset-0 overflow-y-auto flex items-center justify-center p-3 sm:p-4 z-10">
      <div class="reading-card relative w-full max-w-sm bg-[var(--bg-surface)] border border-[var(--line-hair)] text-[var(--text-primary)] rounded-none flex flex-col overflow-hidden">
        
        <!-- Header Plano (h-12) -->
        <header class="flex items-center justify-between px-4 h-12 border-b border-[var(--line-hair)] bg-[var(--bg-void)]">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 bg-[var(--accent-amber)]"></span>
            <span class="font-mono text-xs tracking-widest uppercase font-semibold">Nueva Lectura</span>
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

        <!-- Franja Inferior de 2 Celdas -->
        <div class="grid grid-cols-12 border-t border-[var(--line-hair)] divide-x divide-[var(--line-hair)] bg-[var(--bg-surface)]">
          <!-- Celda Izquierda (8 cols) — ODÓMETRO -->
          <div class="col-span-8 p-3 flex flex-col justify-between">
            <div class="flex items-center justify-between text-[10px] font-mono uppercase tracking-[0.2em] text-[var(--text-secondary)] mb-1">
              <span>ODÓMETRO</span>
              <span id="reading-delta-badge" class="font-mono font-medium text-[10px] tabular-nums text-[var(--accent-volt)]">
                ${hasLogs ? '+0.0 KM' : 'BASE'}
              </span>
            </div>
            <input 
              id="reading-odo-input" 
              type="number" 
              step="0.1" 
              inputmode="numeric" 
              value="${startingOdo}" 
              class="font-sans font-light text-3xl sm:text-4xl tracking-tighter tabular-nums bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-2 outline-none w-full text-[var(--text-primary)] leading-none" 
            />
          </div>

          <!-- Celda Derecha (4 cols) — FECHA -->
          <div class="col-span-4 p-3 flex flex-col justify-between">
            <span class="block text-[10px] font-mono uppercase tracking-[0.2em] text-[var(--text-secondary)] mb-1">FECHA</span>
            <input 
              id="reading-date-input" 
              type="date" 
              value="${todayDate}" 
              class="font-mono text-xs tabular-nums bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-2 text-[var(--text-primary)] w-full outline-none" 
            />
          </div>
        </div>

        <!-- Footer de Acción Única -->
        <button 
          id="reading-submit-btn" 
          type="button" 
          class="h-12 w-full bg-[var(--accent-amber)] hover:bg-[var(--accent-amber)]/90 text-[var(--bg-void)] font-mono text-xs font-semibold uppercase tracking-widest transition-colors flex items-center justify-center cursor-pointer"
        >
          GUARDAR LECTURA
        </button>

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
    const val = parseFloat(odoInput.value);
    if (isNaN(val)) {
      deltaBadge.innerText = '—';
      deltaBadge.style.color = 'var(--text-secondary)';
      return;
    }
    if (hasLogs && latestOdo > 0) {
      const diff = val - latestOdo;
      const sign = diff >= 0 ? '+' : '';
      deltaBadge.innerText = `${sign}${diff.toFixed(1)} KM`;
      deltaBadge.style.color = diff >= 0 ? 'var(--accent-volt)' : 'var(--accent-crimson)';
    } else {
      deltaBadge.innerText = 'BASE';
      deltaBadge.style.color = 'var(--text-secondary)';
    }
  }

  odoInput.addEventListener('input', updateDelta);
  odoInput.addEventListener('focus', () => {
    // Convenience: Select all on focus for quick entry
    odoInput.select();
  });

  updateDelta();

  // Dismiss listeners
  closeX.addEventListener('click', closeReadingModal);
  backdrop.addEventListener('click', closeReadingModal);

  // Submit Handler
  submitBtn.addEventListener('click', async () => {
    const odoVal = parseFloat(odoInput.value);
    const dateVal = dateInput.value.trim();

    if (isNaN(odoVal) || odoVal < 0) {
      odoInput.focus();
      return;
    }

    if (!dateVal) {
      dateInput.focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.classList.add('opacity-70', 'pointer-events-none');

    try {
      const deltaKm = (hasLogs && latestOdo > 0) ? Math.max(0, odoVal - latestOdo) : 0;

      const newLog = {
        date: dateVal,
        odometer_reading: odoVal,
        fuel_level_percent: Math.round(currentLevelPct),
        refuels_count: 0,
        gallons_added: 0,
        is_full_tank: false,
        total_cost_cop: 0,
        distance_km: deltaKm,
        duration_seconds: 0,
        idle_seconds: 0,
        idle_ratio: 0,
        acceleration_variance: 0,
        max_speed_kmh: 0,
        thermal_stress_score: 0,
        updatedAt: new Date().toISOString()
      };

      await addTelemetryLog(newLog);

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

      playHorologyTick(1650, 0.025, 0.04);
      showToast('LECTURA GUARDADA');
      closeReadingModal();
    } catch (err) {
      console.error('[OCTANE] Error saving reading:', err);
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
