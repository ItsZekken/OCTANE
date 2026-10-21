/**
 * OCTANE // KINETIC — Sight Glass Fluid Tube Gauge (Style 4)
 * Interactive vertical cylindrical fluid tube rendered in HTML5 Canvas
 * with live fluid dynamics, wave simulation, rising bubbles, meniscus refraction,
 * and unified vertical pointer drag calibration.
 */

import {
  createGaugePointerController,
  playHorologyTick,
  clamp,
  calculateFuelVolume
} from './gauge-controller.js';

/**
 * Renders the interactive Sight Glass Canvas Gauge into the container.
 * @param {HTMLElement} container
 * @param {Object} options
 * @returns {Object} Gauge instance with { setValue, getValue, destroy }
 */
export function renderSightGlassGauge(container, options = {}) {
  const {
    initialValue = 50,
    tankCapacityLiters = 35.0,
    tankCapacityGallons = 9.25,
    interactive = true,
    hideReadout = false,
    onChange = () => {}
  } = options;

  let targetPercent = clamp(Number(initialValue), 0, 100);
  let currentPercent = targetPercent;
  let animFrameId = null;
  let isDestroyed = false;

  // Fluid physics state
  const physics = {
    wavePhase1: 0,
    wavePhase2: 0,
    sloshEnergy: 0,
    sloshVelocity: 0,
    bubbles: Array.from({ length: 16 }, (_, i) => ({
      x: 0.2 + Math.random() * 0.6,
      y: Math.random(),
      r: 1.0 + Math.random() * 2.4,
      speed: 0.003 + Math.random() * 0.006,
      depth: i % 3
    }))
  };

  function disturbFluid(impulse = 0.8) {
    physics.sloshVelocity += impulse;
  }

  container.innerHTML = `
    <div class="sight-glass-gauge select-none relative w-full max-w-[280px] mx-auto flex flex-col items-center">
      
      <!-- Outer Mechanical Chamber Shell -->
      <div class="relative w-full h-[220px] flex items-center justify-center">
        
        <!-- Vertical Calibration Scale (Left) -->
        <div class="absolute left-2 top-4 bottom-4 flex flex-col justify-between items-end text-[9px] font-mono text-[var(--text-muted,#4A4A52)] select-none pointer-events-none pr-2 border-r border-[var(--line-hair,#1E1E24)]">
          <span class="text-[var(--text-primary,#F4F4F6)] font-semibold">100 F</span>
          <span>75</span>
          <span>50</span>
          <span class="text-[var(--accent-amber,#FF5500)]">25</span>
          <span class="text-[var(--accent-crimson,#F43F5E)] font-semibold">0 E</span>
        </div>

        <!-- Cylindrical Glass Canvas Mount -->
        <div class="relative w-[120px] h-[200px] border border-[var(--line-strong,#2E2E38)] bg-[var(--bg-void,#09090B)] rounded-sm overflow-hidden cursor-ns-resize" id="sight-glass-wrapper">
          
          <!-- Top Brass / Hairline Collar Flange -->
          <div class="absolute top-0 left-0 right-0 h-2 bg-[var(--bg-elevated,#141418)] border-b border-[var(--line-hair,#1E1E24)] z-20 pointer-events-none"></div>

          <!-- Live Fluid Canvas -->
          <canvas id="sight-glass-canvas" class="w-full h-full block z-10"></canvas>

          <!-- Glass Refraction Specular Highlight -->
          <div class="absolute inset-y-0 left-2 w-1.5 bg-white/[0.04] pointer-events-none z-20"></div>
          <div class="absolute inset-y-0 right-3 w-1 bg-black/20 pointer-events-none z-20"></div>

          <!-- Bottom Flange Collar -->
          <div class="absolute bottom-0 left-0 right-0 h-2 bg-[var(--bg-elevated,#141418)] border-t border-[var(--line-hair,#1E1E24)] z-20 pointer-events-none"></div>
        </div>

        <!-- Draggable Indicator Pointer (Right) -->
        <div class="absolute right-4 top-4 bottom-4 w-6 flex items-center justify-center select-none pointer-events-none">
          <div id="sight-glass-pointer" class="w-full flex items-center transition-all duration-75">
            <div class="w-0 h-0 border-t-[4px] border-t-transparent border-b-[4px] border-b-transparent border-l-[6px] border-l-[var(--accent-amber,#FF5500)]"></div>
            <div class="h-[1px] flex-1 bg-[var(--accent-amber,#FF5500)]"></div>
          </div>
        </div>
      </div>

      <!-- Live Digital Readout Pill (Optional) -->
      ${hideReadout ? '' : `
      <div class="mt-2 flex items-center gap-3 px-3 py-1 bg-[var(--bg-elevated,#141418)] border border-[var(--line-hair,#1E1E24)] rounded-sm font-mono text-[11px]">
        <span class="flex items-center gap-1.5">
          <span id="glass-status-dot" class="w-1.5 h-1.5 rounded-full bg-[var(--accent-volt,#10B981)]"></span>
          <span id="glass-pct-text" class="font-bold tabular-nums text-[var(--text-primary,#F4F4F6)]">50%</span>
        </span>
        <span class="text-[var(--line-strong,#2E2E38)]">|</span>
        <span id="glass-vol-text" class="text-[var(--text-secondary,#8A8A93)] tabular-nums">17.5 L / 4.63 GAL</span>
      </div>
      `}
    </div>
  `;

  const canvas = container.querySelector('#sight-glass-canvas');
  const wrapper = container.querySelector('#sight-glass-wrapper');
  const pointer = container.querySelector('#sight-glass-pointer');
  const pctText = container.querySelector('#glass-pct-text');
  const volText = container.querySelector('#glass-vol-text');
  const statusDot = container.querySelector('#glass-status-dot');

  const ctx = canvas.getContext('2d');

  function updateReadouts(pct) {
    const isReserve = pct < 14;
    const isAmber = pct >= 14 && pct <= 25;
    const themeColor = isReserve
      ? 'var(--accent-crimson, #F43F5E)'
      : (isAmber ? 'var(--accent-amber, #FF5500)' : 'var(--accent-volt, #10B981)');

    const vols = calculateFuelVolume(pct, tankCapacityLiters, tankCapacityGallons);
    if (pctText) {
      pctText.innerText = `${Math.round(pct)}%`;
      pctText.style.color = isReserve ? 'var(--accent-crimson, #F43F5E)' : 'var(--text-primary, #F4F4F6)';
    }
    if (volText) {
      volText.innerText = `${vols.liters.toFixed(1)} L / ${vols.gallons.toFixed(2)} GAL`;
    }
    if (statusDot) {
      statusDot.style.backgroundColor = themeColor;
    }

    // Position pointer along vertical scale (0% bottom, 100% top)
    if (pointer) {
      const normalizedY = 1 - (pct / 100);
      const parentH = 200 - 16; // subtract collars
      const offsetPx = normalizedY * parentH;
      pointer.style.transform = `translateY(${offsetPx - parentH / 2}px)`;
    }
  }

  function renderFrame() {
    if (isDestroyed || !canvas.isConnected) {
      if (animFrameId) cancelAnimationFrame(animFrameId);
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      if (canvas.isConnected) {
        animFrameId = requestAnimationFrame(renderFrame);
      }
      return;
    }

    if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    const w = rect.width;
    const h = rect.height;

    ctx.clearRect(0, 0, w, h);

    // Spring interpolation towards target percent
    currentPercent += (targetPercent - currentPercent) * 0.12;

    // Physics update
    physics.sloshVelocity *= 0.90;
    physics.sloshEnergy += (physics.sloshVelocity - physics.sloshEnergy) * 0.18;
    physics.wavePhase1 += 0.042 + Math.abs(physics.sloshEnergy) * 0.04;
    physics.wavePhase2 -= 0.032;

    const isReserve = currentPercent <= 15;
    const primaryColor = isReserve ? '#F43F5E' : '#FF5500';

    // Cavity background
    ctx.fillStyle = '#060608';
    ctx.fillRect(0, 0, w, h);

    // Liquid Level Y (0% at bottom h - 8, 100% at top 8)
    const marginY = 8;
    const effectiveH = h - marginY * 2;
    const fillTopY = (h - marginY) - (clamp(currentPercent, 0, 100) / 100) * effectiveH;
    const amp = 1.5 + Math.min(8, Math.abs(physics.sloshEnergy) * 6);

    // 1. Deep Subsurface Scattering Glow
    ctx.save();
    const glowGrad = ctx.createLinearGradient(0, fillTopY, 0, h);
    if (isReserve) {
      glowGrad.addColorStop(0, 'rgba(244, 63, 94, 0.5)');
      glowGrad.addColorStop(1, 'rgba(244, 63, 94, 0.05)');
    } else {
      glowGrad.addColorStop(0, 'rgba(255, 85, 0, 0.45)');
      glowGrad.addColorStop(1, 'rgba(255, 85, 0, 0.06)');
    }
    ctx.fillStyle = glowGrad;
    ctx.fillRect(0, fillTopY, w, h - fillTopY);
    ctx.restore();

    // 2. Rising Bubbles
    physics.bubbles.forEach(b => {
      b.y -= b.speed;
      if (b.y < 0) b.y = 1;
      const bx = b.x * w;
      const by = fillTopY + b.y * (h - fillTopY);
      if (by > fillTopY && by < h - marginY) {
        ctx.beginPath();
        ctx.arc(bx, by, b.r, 0, Math.PI * 2);
        ctx.fillStyle = isReserve ? 'rgba(244, 63, 94, 0.35)' : 'rgba(255, 200, 150, 0.4)';
        ctx.fill();
      }
    });

    // 3. Fluid Body with Waves
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += 2) {
      const nx = x / w;
      const y = fillTopY + Math.sin(nx * Math.PI * 2.5 + physics.wavePhase1) * amp
                         + Math.cos(nx * Math.PI * 4.0 - physics.wavePhase2) * (amp * 0.35);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();

    const bodyGrad = ctx.createLinearGradient(0, fillTopY, 0, h);
    if (isReserve) {
      bodyGrad.addColorStop(0, 'rgba(244, 63, 94, 0.85)');
      bodyGrad.addColorStop(0.5, 'rgba(190, 18, 60, 0.55)');
      bodyGrad.addColorStop(1, 'rgba(80, 10, 25, 0.35)');
    } else {
      bodyGrad.addColorStop(0, 'rgba(255, 110, 20, 0.82)');
      bodyGrad.addColorStop(0.5, 'rgba(235, 75, 0, 0.52)');
      bodyGrad.addColorStop(1, 'rgba(120, 30, 0, 0.28)');
    }
    ctx.fillStyle = bodyGrad;
    ctx.fill();

    // 4. Optical Meniscus Light Refraction Line
    ctx.beginPath();
    for (let x = 0; x <= w; x += 2) {
      const nx = x / w;
      const y = fillTopY + Math.sin(nx * Math.PI * 2.5 + physics.wavePhase1) * amp
                         + Math.cos(nx * Math.PI * 4.0 - physics.wavePhase2) * (amp * 0.35);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = isReserve ? '#FF8096' : '#FFB266';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.restore();
    animFrameId = requestAnimationFrame(renderFrame);
  }

  // Start render loop
  renderFrame();
  updateReadouts(targetPercent);

  let controller = null;

  if (interactive && wrapper) {
    controller = createGaugePointerController(wrapper, {
      initialValue: targetPercent,
      tankCapacityLiters,
      tankCapacityGallons,
      enableNotches: true,
      notchStep: 5,
      coordinateToPercent: (e, rect) => {
        const y = e.clientY - rect.top;
        const marginY = 8;
        const effectiveH = rect.height - marginY * 2;
        const normalizedY = clamp(y - marginY, 0, effectiveH) / effectiveH;
        // Invert Y: top is 100%, bottom is 0%
        const pct = (1 - normalizedY) * 100;
        disturbFluid(0.4);
        return pct;
      },
      onChange: (state) => {
        targetPercent = state.percent;
        updateReadouts(targetPercent);
        onChange(state);
      }
    });
  }

  return {
    setValue: (val, silent = false) => {
      targetPercent = clamp(Number(val), 0, 100);
      disturbFluid(0.7);
      if (controller) {
        controller.setValue(targetPercent, silent);
      } else {
        updateReadouts(targetPercent);
        if (!silent) {
          const vols = calculateFuelVolume(targetPercent, tankCapacityLiters, tankCapacityGallons);
          onChange({
            percent: targetPercent,
            liters: vols.liters,
            gallons: vols.gallons,
            isDragging: false,
            rawEvent: null
          });
        }
      }
    },
    getValue: () => targetPercent,
    destroy: () => {
      isDestroyed = true;
      if (animFrameId) {
        cancelAnimationFrame(animFrameId);
      }
      if (controller) controller.destroy();
      container.innerHTML = '';
    }
  };
}
