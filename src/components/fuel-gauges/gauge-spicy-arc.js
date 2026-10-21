/**
 * OCTANE // KINETIC — Spicy Arc Fuel Gauge (Style 1)
 * Inspired by SPICY dashboard: Vertical right arc gauge with pivot needle,
 * Swiss hairline aesthetics, amber 1/4 mark, crimson 0-15% reserve, and unified pointer dragging.
 */

import {
  createGaugePointerController,
  clamp,
  calculateFuelVolume
} from './gauge-controller.js';

/**
 * Helper to compute point on arc
 */
function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad)
  };
}

/**
 * Creates SVG arc path string
 */
function describeArc(cx, cy, r, startAngleDeg, endAngleDeg) {
  const start = polarToCartesian(cx, cy, r, startAngleDeg);
  const end = polarToCartesian(cx, cy, r, endAngleDeg);
  const diff = Math.abs(endAngleDeg - startAngleDeg);
  const largeArcFlag = diff > 180 ? 1 : 0;
  // Sweep flag 0 for counter-clockwise (since in SVG Y-down, going from +60 to -60 is decreasing angle)
  const sweepFlag = endAngleDeg < startAngleDeg ? 0 : 1;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} ${sweepFlag} ${end.x} ${end.y}`;
}

/**
 * Renders the Spicy Arc Gauge into the specified container.
 * @param {HTMLElement} container - DOM element to render into
 * @param {Object} options
 * @param {number} [options.initialValue=50] - Initial percent [0..100]
 * @param {number} [options.tankCapacityLiters=35.0]
 * @param {number} [options.tankCapacityGallons=9.25]
 * @param {boolean} [options.interactive=true]
 * @param {Function} [options.onChange] - Callback ({ percent, liters, gallons })
 * @returns {Object} Gauge instance with { setValue, getValue, destroy }
 */
export function renderSpicyArcGauge(container, options = {}) {
  const {
    initialValue = 50,
    tankCapacityLiters = 35.0,
    tankCapacityGallons = 9.25,
    interactive = true,
    hideReadout = false,
    notchStep = 1,
    onChange = () => {}
  } = options;

  let currentPercent = clamp(Number(initialValue), 0, 100);

  // SVG Geometry Parameters
  const cx = 100;
  const cy = 130;
  const radius = 95;
  const startAngle = 55;   // 0% at bottom-right (+55 deg)
  const endAngle = -55;    // 100% at top-right (-55 deg)
  const totalSweep = startAngle - endAngle; // 110 deg

  function percentToAngle(pct) {
    const safe = clamp(pct, 0, 100);
    return startAngle - (safe / 100) * totalSweep;
  }

  function angleToPercent(angleDeg) {
    const raw = ((startAngle - angleDeg) / totalSweep) * 100;
    return clamp(raw, 0, 100);
  }

  // Build ticks and labels
  const marks = [
    { pct: 0, label: 'E', major: true, color: 'var(--accent-crimson, #F43F5E)' },
    { pct: 12.5, label: '', major: false },
    { pct: 25, label: '1/4', major: true, color: 'var(--accent-amber, #FF5500)' },
    { pct: 37.5, label: '', major: false },
    { pct: 50, label: '1/2', major: true, color: 'var(--text-secondary, #8A8A93)' },
    { pct: 62.5, label: '', major: false },
    { pct: 75, label: '3/4', major: true, color: 'var(--text-secondary, #8A8A93)' },
    { pct: 87.5, label: '', major: false },
    { pct: 100, label: 'F', major: true, color: 'var(--text-primary, #F4F4F6)' }
  ];

  let tickMarkup = '';
  marks.forEach(m => {
    const ang = percentToAngle(m.pct);
    const innerR = m.major ? radius - 10 : radius - 5;
    const outerR = radius + 2;
    const pIn = polarToCartesian(cx, cy, innerR, ang);
    const pOut = polarToCartesian(cx, cy, outerR, ang);
    const strokeColor = m.pct <= 15 ? 'var(--accent-crimson, #F43F5E)' : (m.pct === 25 ? 'var(--accent-amber, #FF5500)' : 'var(--line-strong, #3E3E48)');
    const strokeW = m.major ? '1.5' : '1.0';

    tickMarkup += `<line x1="${pIn.x}" y1="${pIn.y}" x2="${pOut.x}" y2="${pOut.y}" stroke="${strokeColor}" stroke-width="${strokeW}" stroke-linecap="round" />`;

    if (m.label) {
      const pLabel = polarToCartesian(cx, cy, radius + 18, ang);
      const fontColor = m.color || 'var(--text-secondary, #8A8A93)';
      const fontWeight = m.pct === 0 || m.pct === 100 ? '700' : '500';
      tickMarkup += `<text x="${pLabel.x}" y="${pLabel.y + 4}" fill="${fontColor}" font-family="JetBrains Mono, monospace" font-size="10" font-weight="${fontWeight}" text-anchor="middle" class="select-none pointer-events-none">${m.label}</text>`;
    }
  });

  const bgArcPath = describeArc(cx, cy, radius, startAngle, endAngle);
  const reserveArcPath = describeArc(cx, cy, radius, startAngle, percentToAngle(15));

  container.innerHTML = `
    <div class="spicy-arc-gauge select-none relative w-full max-w-[280px] mx-auto flex flex-col items-center">
      <svg viewBox="0 0 250 260" class="w-full h-auto overflow-visible cursor-grab active:cursor-grabbing" id="spicy-arc-svg">
        <defs>
          <linearGradient id="spicy-active-grad" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#F43F5E" />
            <stop offset="25%" stop-color="#FF5500" />
            <stop offset="100%" stop-color="#10B981" />
          </linearGradient>
        </defs>

        <!-- Background Track -->
        <path d="${bgArcPath}" fill="none" stroke="var(--line-hair, #2E2E38)" stroke-width="4" stroke-linecap="round" />
        
        <!-- Red Reserve Zone (0-15%) -->
        <path d="${reserveArcPath}" fill="none" stroke="var(--accent-crimson, #F43F5E)" stroke-width="4" stroke-opacity="0.5" stroke-linecap="round" />

        <!-- Dynamic Fill Arc -->
        <path id="spicy-active-arc" d="${bgArcPath}" fill="none" stroke="url(#spicy-active-grad)" stroke-width="4" stroke-linecap="round" />

        <!-- Tick Marks & Labels -->
        <g id="spicy-ticks">${tickMarkup}</g>

        <!-- Center Fuel Icon -->
        <g transform="translate(${cx + 14}, ${cy - 8}) scale(0.7)" opacity="0.6">
          <path d="M4 4v16a1 1 0 001 1h8a1 1 0 001-1v-6h1a1 1 0 011 1v4a2 2 0 002 2h0a2 2 0 002-2V9.8a3 3 0 00-.88-2.12L17.5 5" fill="none" stroke="var(--text-secondary, #8A8A93)" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M4 10h10M7 4V2a1 1 0 011-1h2a1 1 0 011 1v2" fill="none" stroke="var(--text-secondary, #8A8A93)" stroke-width="1.5" stroke-linecap="round" />
        </g>

        <!-- Pivoting Needle Assembly -->
        <g id="spicy-needle-group">
          <!-- Main Needle Line -->
          <line id="spicy-needle-line" x1="${cx}" y1="${cy}" x2="${cx + radius - 6}" y2="${cy}" stroke="var(--accent-amber, #FF5500)" stroke-width="2.5" stroke-linecap="round" />
          
          <!-- Needle Arrow Head Point -->
          <circle id="spicy-needle-tip" cx="${cx + radius - 6}" cy="${cy}" r="3.5" fill="var(--accent-amber, #FF5500)" />

          <!-- Center Pivot Hub (Multi-ring precision chronometer) -->
          <circle cx="${cx}" cy="${cy}" r="12" fill="var(--bg-elevated, #141418)" stroke="var(--line-strong, #3E3E48)" stroke-width="1.5" />
          <circle cx="${cx}" cy="${cy}" r="6" fill="var(--bg-surface, #0E0E11)" stroke="var(--accent-amber, #FF5500)" stroke-width="1.5" />
          <circle cx="${cx}" cy="${cy}" r="2" fill="var(--accent-amber, #FF5500)" />
        </g>

        <!-- Touch Target Overlay Arc for Fluid Dragging -->
        <path d="${bgArcPath}" fill="none" stroke="transparent" stroke-width="48" class="cursor-pointer" id="spicy-touch-zone" />
      </svg>

      <!-- Live Digital Output Pill Underneath (Optional) -->
      ${hideReadout ? '' : `
      <div class="mt-1 flex items-center gap-3 px-3 py-1 bg-[var(--bg-elevated,#141418)] border border-[var(--line-hair,#1E1E24)] rounded-sm font-mono text-[11px]">
        <span class="flex items-center gap-1.5">
          <span id="spicy-status-dot" class="w-1.5 h-1.5 rounded-full bg-[var(--accent-volt,#10B981)]"></span>
          <span id="spicy-pct-text" class="font-bold tabular-nums text-[var(--text-primary,#F4F4F6)]">50%</span>
        </span>
        <span class="text-[var(--line-strong,#2E2E38)]">|</span>
        <span id="spicy-vol-text" class="text-[var(--text-secondary,#8A8A93)] tabular-nums">17.5 L / 4.63 GAL</span>
      </div>
      `}
    </div>
  `;

  const svg = container.querySelector('#spicy-arc-svg');
  const activeArc = container.querySelector('#spicy-active-arc');
  const needleGroup = container.querySelector('#spicy-needle-group');
  const needleLine = container.querySelector('#spicy-needle-line');
  const needleTip = container.querySelector('#spicy-needle-tip');
  const statusDot = container.querySelector('#spicy-status-dot');
  const pctText = container.querySelector('#spicy-pct-text');
  const volText = container.querySelector('#spicy-vol-text');
  const touchZone = container.querySelector('#spicy-touch-zone');

  function updateVisuals(pct) {
    const angle = percentToAngle(pct);
    const rad = (angle * Math.PI) / 180;
    const isReserve = pct < 14;
    const isAmber = pct >= 14 && pct <= 25;

    // 1. Update Active Fill Arc
    if (pct <= 0.5) {
      activeArc.setAttribute('d', '');
    } else {
      activeArc.setAttribute('d', describeArc(cx, cy, radius, startAngle, angle));
    }

    const themeColor = isReserve
      ? 'var(--accent-crimson, #F43F5E)'
      : (isAmber ? 'var(--accent-amber, #FF5500)' : 'var(--accent-volt, #10B981)');

    activeArc.setAttribute('stroke', themeColor);

    // 2. Rotate Needle
    const tipR = radius - 8;
    const nx = cx + tipR * Math.cos(rad);
    const ny = cy + tipR * Math.sin(rad);

    needleLine.setAttribute('x2', nx);
    needleLine.setAttribute('y2', ny);
    needleLine.setAttribute('stroke', themeColor);

    needleTip.setAttribute('cx', nx);
    needleTip.setAttribute('cy', ny);
    needleTip.setAttribute('fill', themeColor);

    // 3. Update Text readouts
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
  }

  // Initial render
  updateVisuals(currentPercent);

  let controller = null;

  if (interactive && svg) {
    controller = createGaugePointerController(svg, {
      initialValue: currentPercent,
      tankCapacityLiters,
      tankCapacityGallons,
      notchStep,
      coordinateToPercent: (e, rect) => {
        // Map pointer position to SVG viewBox coordinates
        const scaleX = 250 / rect.width;
        const scaleY = 260 / rect.height;
        const px = (e.clientX - rect.left) * scaleX;
        const py = (e.clientY - rect.top) * scaleY;

        const dx = px - cx;
        const dy = py - cy;
        const angleRad = Math.atan2(dy, dx);
        let angleDeg = (angleRad * 180) / Math.PI;

        return angleToPercent(angleDeg);
      },
      onChange: (state) => {
        currentPercent = state.percent;
        updateVisuals(currentPercent);
        onChange(state);
      }
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
      if (controller) {
        controller.destroy();
      }
      container.innerHTML = '';
    }
  };
}
