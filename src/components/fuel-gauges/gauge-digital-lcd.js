/**
 * OCTANE // KINETIC — Digital LCD Fuel Gauge (Style 3)
 * Modern multi-segment block LCD display with 10 discrete backlit segments,
 * clickable & drag-to-fill interaction, crimson reserve alert, and precision volume readout.
 */

import {
  createGaugePointerController,
  playHorologyTick,
  clamp,
  calculateFuelVolume
} from './gauge-controller.js';

/**
 * Renders the Digital Segmented LCD Gauge into the container.
 * @param {HTMLElement} container
 * @param {Object} options
 * @returns {Object} Gauge instance with { setValue, getValue, destroy }
 */
export function renderDigitalLcdGauge(container, options = {}) {
  const {
    initialValue = 50,
    tankCapacityLiters = 35.0,
    tankCapacityGallons = 9.25,
    interactive = true,
    numSegments = 10,
    hideReadout = false,
    hideToolbar = false,
    onChange = () => {}
  } = options;

  let currentPercent = clamp(Number(initialValue), 0, 100);

  container.innerHTML = `
    <div class="digital-lcd-gauge select-none relative w-full max-w-[320px] mx-auto flex flex-col gap-3 p-3 bg-[var(--bg-surface,#0E0E11)] border border-[var(--line-hair,#1E1E24)] rounded-sm font-mono">
      
      <!-- Top Diagnostic LCD Header -->
      <div class="flex items-center justify-between text-[10px] text-[var(--text-secondary,#8A8A93)] uppercase tracking-wider border-b border-[var(--line-hair,#1E1E24)] pb-2">
        <div class="flex items-center gap-1.5">
          <span class="w-1.5 h-1.5 bg-[var(--accent-amber,#FF5500)]"></span>
          <span>CLÚSTER DIGITAL · MATRIZ DE COMBUSTIBLE</span>
        </div>
        <div id="lcd-segment-count" class="tabular-nums text-[var(--text-primary,#F4F4F6)] font-bold">
          5 / 10 BARS
        </div>
      </div>

      <!-- Main Segment Bar Container -->
      <div class="relative py-2">
        <!-- Interactive Segment Strip -->
        <div id="lcd-bars-container" class="grid grid-cols-10 gap-1.5 h-12 p-1.5 bg-[var(--bg-void,#09090B)] border border-[var(--line-hair,#1E1E24)] rounded-sm cursor-pointer select-none">
          <!-- 10 Segments dynamically populated -->
        </div>

        <!-- Scale Labels -->
        <div class="flex justify-between items-center px-1 pt-1.5 text-[9px] text-[var(--text-muted,#4A4A52)] uppercase font-mono">
          <span class="text-[var(--accent-crimson,#F43F5E)] font-bold">0% [E]</span>
          <span>1/4</span>
          <span>1/2</span>
          <span>3/4</span>
          <span class="text-[var(--text-primary,#F4F4F6)] font-bold">[F] 100%</span>
        </div>
      </div>

      <!-- Live Readout Row (Optional) -->
      ${hideReadout ? '' : `
      <div class="flex items-center justify-between bg-[var(--bg-elevated,#141418)] px-3 py-2 border border-[var(--line-hair,#1E1E24)] rounded-sm">
        <div class="flex items-baseline gap-2">
          <span id="lcd-pct-val" class="text-xl font-bold tabular-nums tracking-tight text-[var(--text-primary,#F4F4F6)]">50%</span>
          <span id="lcd-reserve-pill" class="hidden text-[9px] px-1.5 py-0.5 bg-[var(--accent-crimson,#F43F5E)]/20 text-[var(--accent-crimson,#F43F5E)] border border-[var(--accent-crimson,#F43F5E)]/40 rounded-sm uppercase tracking-widest font-bold">
            RESERVA
          </span>
        </div>
        <div id="lcd-vol-val" class="text-xs text-[var(--text-secondary,#8A8A93)] tabular-nums">
          17.5 L / 4.63 GAL
        </div>
      </div>
      `}

      <!-- Quick Step Adjustment Micro-Toolbar (Optional) -->
      ${hideToolbar ? '' : `
      <div class="grid grid-cols-6 gap-1 pt-0.5">
        <button type="button" data-step="-10" class="lcd-step-btn h-7 bg-[var(--bg-elevated,#141418)] hover:bg-[var(--line-hair,#1E1E24)] border border-[var(--line-hair,#1E1E24)] rounded-sm text-[10px] text-[var(--text-secondary,#8A8A93)] hover:text-[var(--text-primary,#F4F4F6)] transition-all font-mono">-10%</button>
        <button type="button" data-step="-5" class="lcd-step-btn h-7 bg-[var(--bg-elevated,#141418)] hover:bg-[var(--line-hair,#1E1E24)] border border-[var(--line-hair,#1E1E24)] rounded-sm text-[10px] text-[var(--text-secondary,#8A8A93)] hover:text-[var(--text-primary,#F4F4F6)] transition-all font-mono">-5%</button>
        <button type="button" data-set="25" class="lcd-preset-btn h-7 bg-[var(--bg-elevated,#141418)] hover:bg-[var(--line-hair,#1E1E24)] border border-[var(--line-hair,#1E1E24)] rounded-sm text-[10px] text-[var(--text-secondary,#8A8A93)] hover:text-[var(--text-primary,#F4F4F6)] transition-all font-mono">1/4</button>
        <button type="button" data-set="50" class="lcd-preset-btn h-7 bg-[var(--bg-elevated,#141418)] hover:bg-[var(--line-hair,#1E1E24)] border border-[var(--line-hair,#1E1E24)] rounded-sm text-[10px] text-[var(--text-secondary,#8A8A93)] hover:text-[var(--text-primary,#F4F4F6)] transition-all font-mono">1/2</button>
        <button type="button" data-step="+5" class="lcd-step-btn h-7 bg-[var(--bg-elevated,#141418)] hover:bg-[var(--line-hair,#1E1E24)] border border-[var(--line-hair,#1E1E24)] rounded-sm text-[10px] text-[var(--text-secondary,#8A8A93)] hover:text-[var(--text-primary,#F4F4F6)] transition-all font-mono">+5%</button>
        <button type="button" data-step="+10" class="lcd-step-btn h-7 bg-[var(--bg-elevated,#141418)] hover:bg-[var(--line-hair,#1E1E24)] border border-[var(--line-hair,#1E1E24)] rounded-sm text-[10px] text-[var(--text-secondary,#8A8A93)] hover:text-[var(--text-primary,#F4F4F6)] transition-all font-mono">+10%</button>
      </div>
      `}
    </div>
  `;

  const barsContainer = container.querySelector('#lcd-bars-container');
  const segmentCount = container.querySelector('#lcd-segment-count');
  const pctVal = container.querySelector('#lcd-pct-val');
  const volVal = container.querySelector('#lcd-vol-val');
  const reservePill = container.querySelector('#lcd-reserve-pill');

  // Create segments
  const segmentEls = [];
  for (let i = 0; i < numSegments; i++) {
    const el = document.createElement('div');
    el.className = 'lcd-segment relative flex flex-col justify-end overflow-hidden rounded-[1px] border border-[var(--line-hair,#1E1E24)] bg-[var(--bg-elevated,#141418)] transition-all duration-150';
    el.dataset.index = i;
    
    // Inner fill bar
    const fill = document.createElement('div');
    fill.className = 'w-full h-full opacity-0 transition-opacity duration-150';
    el.appendChild(fill);

    barsContainer.appendChild(el);
    segmentEls.push({ container: el, fill });
  }

  function updateVisuals(pct) {
    const activeBlocksCount = Math.round((pct / 100) * numSegments);
    const isReserve = pct <= 15;

    segmentEls.forEach((seg, idx) => {
      const isActive = idx < activeBlocksCount;
      const isSegmentReserve = idx === 0 || (idx === 1 && numSegments >= 10);
      const isMid = idx >= 1 && idx < 4;

      if (isActive) {
        seg.fill.classList.remove('opacity-0');
        seg.fill.classList.add('opacity-100');
        if (isReserve && isSegmentReserve) {
          seg.fill.style.backgroundColor = 'var(--accent-crimson, #F43F5E)';
          seg.container.style.borderColor = 'var(--accent-crimson, #F43F5E)';
        } else if (isMid) {
          seg.fill.style.backgroundColor = 'var(--accent-amber, #FF5500)';
          seg.container.style.borderColor = 'var(--accent-amber, #FF5500)';
        } else {
          seg.fill.style.backgroundColor = 'var(--accent-volt, #10B981)';
          seg.container.style.borderColor = 'var(--accent-volt, #10B981)';
        }
      } else {
        seg.fill.classList.remove('opacity-100');
        seg.fill.classList.add('opacity-0');
        seg.fill.style.backgroundColor = 'transparent';
        seg.container.style.borderColor = 'var(--line-hair, #1E1E24)';
      }
    });

    const vols = calculateFuelVolume(pct, tankCapacityLiters, tankCapacityGallons);
    if (pctVal) {
      pctVal.innerText = `${Math.round(pct)}%`;
      pctVal.style.color = isReserve ? 'var(--accent-crimson, #F43F5E)' : 'var(--text-primary, #F4F4F6)';
    }
    if (volVal) {
      volVal.innerText = `${vols.liters.toFixed(1)} L / ${vols.gallons.toFixed(2)} GAL`;
    }
    if (segmentCount) {
      segmentCount.innerText = `${activeBlocksCount} / ${numSegments} BARS`;
    }

    if (reservePill) {
      if (isReserve) {
        reservePill.classList.remove('hidden');
      } else {
        reservePill.classList.add('hidden');
      }
    }
  }

  updateVisuals(currentPercent);

  let controller = null;

  if (interactive && barsContainer) {
    controller = createGaugePointerController(barsContainer, {
      initialValue: currentPercent,
      tankCapacityLiters,
      tankCapacityGallons,
      enableNotches: true,
      notchStep: 10,
      coordinateToPercent: (e, rect) => {
        const x = e.clientX - rect.left;
        const ratio = clamp(x / rect.width, 0, 1);
        return ratio * 100;
      },
      onChange: (state) => {
        currentPercent = state.percent;
        updateVisuals(currentPercent);
        onChange(state);
      }
    });

    // Step adjustment listeners
    container.querySelectorAll('.lcd-step-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        playHorologyTick(1100, 0.012, 0.025);
        const step = parseFloat(btn.dataset.step);
        const next = clamp(currentPercent + step, 0, 100);
        controller.setValue(next);
      });
    });

    container.querySelectorAll('.lcd-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        playHorologyTick(1250, 0.015, 0.03);
        const val = parseFloat(btn.dataset.set);
        controller.setValue(val);
      });
    });
  }

  return {
    setValue: (val, silent = false) => {
      currentPercent = clamp(Number(val), 0, 100);
      if (controller) {
        controller.setValue(currentPercent, silent);
      } else {
        updateVisuals(currentPercent);
        if (!silent) {
          const vols = calculateFuelVolume(currentPercent, tankCapacityLiters, tankCapacityGallons);
          onChange({
            percent: currentPercent,
            liters: vols.liters,
            gallons: vols.gallons,
            isDragging: false,
            rawEvent: null
          });
        }
      }
    },
    getValue: () => currentPercent,
    destroy: () => {
      if (controller) controller.destroy();
      container.innerHTML = '';
    }
  };
}
