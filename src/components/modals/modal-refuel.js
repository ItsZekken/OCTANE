/**
 * OCTANE // KINETIC — Modal 02 / TANQUEADA
 * Dedicated Universal Refueling Modal (Teenage Engineering / Braun style).
 * 
 * Strict specifications:
 * - Header with 02 / TANQUEADA title + ✕ close.
 * - 3 Habit Tabs: A FULL (100%), GALONES EXACTOS, POR MONTO ($).
 * - Preselects tab according to vehicleProfile.refuelHabit.
 * - Hero numeric entry adapted to active tab.
 * - Live fuel level transition preview bar (XX% → YY%).
 * - 3 Bottom cells: ODÓMETRO (prefilled), $ / GALÓN (prefilled), COSTO TOTAL (synced).
 * - Single full-width action button: REGISTRAR TANQUEADA.
 * - Silencio Verbal Absoluto: Zero <p> tags, zero blur, zero shadows.
 * - Zero mention of "Pistola Pita".
 */

import { store, playHorologyTick, showToast } from '../../core/state.js';
import { addTelemetryLog, getTelemetryLogs, getVehicleProfile, saveVehicleProfile } from '../../core/db-local.js';
import { recalculateTelemetry } from '../../core/telemetry-engine.js';
import { syncToCloud } from '../../core/firebase-sync.js';
import { clamp } from '../fuel-gauges/gauge-controller.js';

let modalRootEl = null;
const GAL_TO_L = 3.78541;

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
 * @param {Object} [options]
 */
export async function openRefuelModal(options = {}) {
  initRefuelModal();
  playHorologyTick(1400, 0.018, 0.035);

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
    console.warn('[OCTANE] Refuel modal log fetch issue:', err);
  }

  const startingOdo = options.initialOdo !== undefined
    ? options.initialOdo
    : (hasLogs ? latestOdo : 0);

  const tankGallons = profile.tankCapacityGallons || 9.25;
  const currentPrice = profile.fuelPriceCop || 16000;

  // Determine initial habit tab
  let activeTab = 'full';
  if (profile.refuelHabit === 'exact_gallons') {
    activeTab = 'exact';
  } else if (profile.refuelHabit === 'fixed_amount') {
    activeTab = 'amount';
  }

  modalRootEl.innerHTML = `
    <!-- Flat Backdrop Overlay (Zero Blur) -->
    <div class="refuel-backdrop fixed inset-0 bg-black/85 transition-opacity duration-150"></div>

    <!-- Modal Dialog Card -->
    <div class="fixed inset-0 overflow-y-auto flex items-center justify-center p-3 sm:p-4 z-10">
      <div class="refuel-card relative w-full max-w-sm bg-[var(--bg-surface)] border border-[var(--line-hair)] text-[var(--text-primary)] rounded-none flex flex-col overflow-hidden">
        
        <!-- Header Plano (h-12) -->
        <header class="flex items-center justify-between px-4 h-12 border-b border-[var(--line-hair)] bg-[var(--bg-void)]">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 bg-[var(--accent-amber)]"></span>
            <span class="font-mono text-xs tracking-widest uppercase font-semibold">Nueva Tanqueada</span>
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
        <div class="p-6 bg-[var(--bg-void)] flex flex-col items-center justify-center text-center">
          <span id="refuel-hero-label" class="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)] mb-2">
            GALONES SUMINISTRADOS
          </span>
          
          <input 
            id="refuel-hero-input" 
            type="number" 
            step="0.001" 
            inputmode="decimal" 
            placeholder="0.000" 
            class="w-full font-sans font-light text-6xl tracking-tighter tabular-nums text-center bg-transparent border-0 border-b border-transparent focus:border-[var(--accent-amber)] transition-colors outline-none text-[var(--text-primary)] placeholder:text-[var(--text-muted)]" 
            autofocus 
          />

          <!-- Sub-readout Liters / Gallons equivalent -->
          <span id="refuel-sub-readout" class="font-mono text-xs text-[var(--text-secondary)] tabular-nums mt-1">
            0.00 L
          </span>

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

        <!-- Franja Inferior de 3 Celdas -->
        <div class="grid grid-cols-3 border-t border-[var(--line-hair)] divide-x divide-[var(--line-hair)] bg-[var(--bg-surface)]">
          <!-- Celda 1: ODÓMETRO -->
          <div class="p-3 flex flex-col justify-between">
            <span class="block text-[10px] font-mono uppercase tracking-[0.2em] text-[var(--text-secondary)] mb-1">ODÓMETRO</span>
            <input 
              id="refuel-odo-input" 
              type="number" 
              step="0.1" 
              inputmode="numeric" 
              value="${startingOdo}" 
              class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-1.5 font-sans font-light text-2xl tracking-tighter tabular-nums outline-none text-[var(--text-primary)]" 
            />
          </div>

          <!-- Celda 2: $ / GALÓN -->
          <div class="p-3 flex flex-col justify-between">
            <span class="block text-[10px] font-mono uppercase tracking-[0.2em] text-[var(--text-secondary)] mb-1">$ / GALÓN</span>
            <input 
              id="refuel-price-input" 
              type="number" 
              step="100" 
              value="${currentPrice}" 
              class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-1.5 font-sans font-light text-2xl tracking-tighter tabular-nums outline-none text-[var(--text-primary)]" 
            />
          </div>

          <!-- Celda 3: COSTO TOTAL -->
          <div class="p-3 flex flex-col justify-between">
            <span class="block text-[10px] font-mono uppercase tracking-[0.2em] text-[var(--text-secondary)] mb-1">COSTO TOTAL</span>
            <input 
              id="refuel-total-input" 
              type="number" 
              step="100" 
              placeholder="0" 
              class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-1.5 font-sans font-light text-2xl tracking-tighter tabular-nums outline-none text-[var(--accent-amber)]" 
            />
          </div>
        </div>

        <!-- Footer de Acción Única -->
        <button 
          id="refuel-submit-btn" 
          type="button" 
          class="h-12 w-full bg-[var(--accent-amber)] hover:bg-[var(--accent-amber)]/90 text-[var(--bg-void)] font-mono text-xs font-semibold uppercase tracking-widest transition-colors flex items-center justify-center cursor-pointer"
        >
          REGISTRAR TANQUEADA
        </button>

      </div>
    </div>
  `;

  modalRootEl.classList.remove('hidden');

  const tabBtns = modalRootEl.querySelectorAll('.refuel-tab-btn');
  const heroLabel = modalRootEl.querySelector('#refuel-hero-label');
  const heroInput = modalRootEl.querySelector('#refuel-hero-input');
  const subReadout = modalRootEl.querySelector('#refuel-sub-readout');
  const previewText = modalRootEl.querySelector('#refuel-preview-text');
  const previewBar = modalRootEl.querySelector('#refuel-preview-bar');
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
      heroInput.step = '0.001';
      heroInput.placeholder = '0.000';
    } else if (activeTab === 'exact') {
      heroLabel.innerText = 'GALONES EXACTOS';
      heroInput.step = '0.001';
      heroInput.placeholder = '0.000';
    } else if (activeTab === 'amount') {
      heroLabel.innerText = 'MONTO EN PESOS (COP)';
      heroInput.step = '1000';
      heroInput.placeholder = '0';
    }

    recalcAll();
  }

  function recalcAll() {
    const rawVal = parseFloat(heroInput.value) || 0;
    const price = parseFloat(priceInput.value) || currentPrice;

    let computedGallons = 0;
    let computedTotal = 0;
    let targetPct = 100;

    if (activeTab === 'full') {
      computedGallons = rawVal;
      computedTotal = Math.round(computedGallons * price);
      totalInput.value = computedGallons > 0 ? computedTotal : '';
      subReadout.innerText = computedGallons > 0 ? `${(computedGallons * GAL_TO_L).toFixed(2)} L` : '0.00 L';
      targetPct = 100;

      previewText.innerText = `${Math.round(latestPct)}% → 100% (LLENO)`;
      previewBar.style.width = '100%';
      previewBar.style.backgroundColor = 'var(--accent-volt)';
    } else if (activeTab === 'exact') {
      computedGallons = rawVal;
      computedTotal = Math.round(computedGallons * price);
      totalInput.value = computedGallons > 0 ? computedTotal : '';
      subReadout.innerText = computedGallons > 0 ? `${(computedGallons * GAL_TO_L).toFixed(2)} L` : '0.00 L';

      const addedPct = tankGallons > 0 ? (computedGallons / tankGallons) * 100 : 0;
      targetPct = clamp(Math.round(latestPct + addedPct), 0, 100);

      previewText.innerText = `${Math.round(latestPct)}% → ${targetPct}%`;
      previewBar.style.width = `${targetPct}%`;
      previewBar.style.backgroundColor = targetPct > 25 ? 'var(--accent-volt)' : 'var(--accent-amber)';
    } else if (activeTab === 'amount') {
      computedTotal = rawVal;
      computedGallons = price > 0 ? (computedTotal / price) : 0;
      totalInput.value = computedTotal > 0 ? computedTotal : '';
      subReadout.innerText = computedTotal > 0 
        ? `${computedGallons.toFixed(3)} GAL · ${(computedGallons * GAL_TO_L).toFixed(1)} L` 
        : '0.000 GAL · 0.00 L';

      const addedPct = tankGallons > 0 ? (computedGallons / tankGallons) * 100 : 0;
      targetPct = clamp(Math.round(latestPct + addedPct), 0, 100);

      previewText.innerText = `${Math.round(latestPct)}% → ${targetPct}%`;
      previewBar.style.width = `${targetPct}%`;
      previewBar.style.backgroundColor = targetPct > 25 ? 'var(--accent-volt)' : 'var(--accent-amber)';
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
  heroInput.addEventListener('input', recalcAll);

  priceInput.addEventListener('input', () => {
    const price = parseFloat(priceInput.value) || 0;
    if (activeTab === 'amount') {
      recalcAll();
    } else {
      const gal = parseFloat(heroInput.value) || 0;
      if (gal > 0 && price > 0) {
        totalInput.value = Math.round(gal * price);
      }
    }
  });

  totalInput.addEventListener('input', () => {
    const total = parseFloat(totalInput.value) || 0;
    const price = parseFloat(priceInput.value) || currentPrice;

    if (activeTab === 'amount') {
      heroInput.value = total > 0 ? total : '';
      recalcAll();
    } else {
      const gal = parseFloat(heroInput.value) || 0;
      if (total > 0 && gal > 0) {
        priceInput.value = Math.round(total / gal);
      }
    }
  });

  // Focus ergonomics
  heroInput.addEventListener('focus', () => heroInput.select());
  odoInput.addEventListener('focus', () => odoInput.select());
  priceInput.addEventListener('focus', () => priceInput.select());
  totalInput.addEventListener('focus', () => totalInput.select());

  // Dismiss listeners
  closeX.addEventListener('click', closeRefuelModal);
  backdrop.addEventListener('click', closeRefuelModal);

  // Submit Handler
  submitBtn.addEventListener('click', async () => {
    const heroVal = parseFloat(heroInput.value) || 0;
    const odoVal = parseFloat(odoInput.value);
    const priceVal = parseFloat(priceInput.value) || currentPrice;

    let galVal = 0;
    let totalVal = 0;

    if (activeTab === 'amount') {
      totalVal = heroVal;
      galVal = priceVal > 0 ? (totalVal / priceVal) : 0;
    } else {
      galVal = heroVal;
      totalVal = parseFloat(totalInput.value) || Math.round(galVal * priceVal);
    }

    if (galVal <= 0) {
      heroInput.focus();
      return;
    }

    if (isNaN(odoVal) || odoVal < 0) {
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

      const deltaKm = (hasLogs && latestOdo > 0) ? Math.max(0, odoVal - latestOdo) : 0;
      const todayDate = new Date().toISOString().substring(0, 10);

      const newLog = {
        date: todayDate,
        odometer_reading: odoVal,
        fuel_level_percent: resultingPct,
        refuels_count: 1,
        gallons_added: Number(galVal.toFixed(3)),
        is_full_tank: isFullTank,
        total_cost_cop: Math.round(totalVal),
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

      // Update vehicle profile fuel price if modified
      if (priceVal > 0 && priceVal !== profile.fuelPriceCop) {
        profile.fuelPriceCop = priceVal;
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

      playHorologyTick(1650, 0.025, 0.04);
      showToast('TANQUEADA REGISTRADA');
      closeRefuelModal();
    } catch (err) {
      console.error('[OCTANE] Error saving refuel:', err);
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
