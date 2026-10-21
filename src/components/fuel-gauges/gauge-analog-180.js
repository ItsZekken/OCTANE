/**
 * OCTANE // KINETIC — Analog 180 Fuel Gauge (Style 2)
 * Classic 180° horizontal semicircular analog dial with pivot needle,
 * red reserve zone (0-15%), precision ticks, and unified pointer dragging.
 */

import {
  createGaugePointerController,
  clamp,
  calculateFuelVolume
} from './gauge-controller.js';

function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad)
  };
}

function describeArc180(cx, cy, r, startAngleDeg, endAngleDeg) {
  const start = polarToCartesian(cx, cy, r, startAngleDeg);
  const end = polarToCartesian(cx, cy, r, endAngleDeg);
  const diff = Math.abs(endAngleDeg - startAngleDeg);
  const largeArcFlag = diff > 180 ? 1 : 0;
  const sweepFlag = 1;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} ${sweepFlag} ${end.x} ${end.y}`;
}

/**
 * Renders the Analog 180 Gauge into the specified container.
 * @param {HTMLElement} container
 * @param {Object} options
 * @returns {Object} Gauge instance with { setValue, getValue, destroy }
 */
export function renderAnalog180Gauge(container, options = {}) {
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

  // Geometry
  const cx = 130;
  const cy = 135;
  const radius = 95;
  const startAngle = 180; // 0% Left (E)
  const endAngle = 360;   // 100% Right (F)

  function percentToAngle(pct) {
    return startAngle + (clamp(pct, 0, 100) / 100) * 180;
  }

  function angleToPercent(deg) {
    return clamp(((deg - 180) / 180) * 100, 0, 100);
  }

  // Generate Marks
  const marks = [
    { pct: 0, label: 'E', major: true, color: 'var(--accent-crimson, #F43F5E)' },
    { pct: 10, label: '', major: false },
    { pct: 15, label: '', major: false, isReserveEnd: true },
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
    const innerR = m.major ? radius - 12 : radius - 6;
    const outerR = radius + 2;
    const pIn = polarToCartesian(cx, cy, innerR, ang);
    const pOut = polarToCartesian(cx, cy, outerR, ang);
    const strokeColor = m.pct <= 15 ? 'var(--accent-crimson, #F43F5E)' : (m.pct === 25 ? 'var(--accent-amber, #FF5500)' : 'var(--line-strong, #3E3E48)');
    const strokeW = m.major ? '1.5' : '1.0';

    tickMarkup += `<line x1="${pIn.x}" y1="${pIn.y}" x2="${pOut.x}" y2="${pOut.y}" stroke="${strokeColor}" stroke-width="${strokeW}" stroke-linecap="round" />`;

    if (m.label) {
      const pLabel = polarToCartesian(cx, cy, radius - 24, ang);
      const fontColor = m.color || 'var(--text-secondary, #8A8A93)';
      const fontWeight = m.pct === 0 || m.pct === 100 ? '700' : '500';
      tickMarkup += `<text x="${pLabel.x}" y="${pLabel.y + 3}" fill="${fontColor}" font-family="JetBrains Mono, monospace" font-size="10" font-weight="${fontWeight}" text-anchor="middle" class="select-none pointer-events-none">${m.label}</text>`;
    }
  });

  const bgArc = describeArc180(cx, cy, radius, 180, 360);
  const reserveArc = describeArc180(cx, cy, radius, 180, percentToAngle(15));

  container.innerHTML = `
    <div class="analog-180-gauge select-none relative w-full max-w-[280px] mx-auto flex flex-col items-center">
      <svg viewBox="0 0 260 160" class="w-full h-auto overflow-visible cursor-grab active:cursor-grabbing" id="analog-180-svg">
        <!-- Dial Housing Backdrop -->
        <path d="${bgArc}" fill="none" stroke="var(--line-hair, #2E2E38)" stroke-width="4" stroke-linecap="round" />
        
        <!-- Reserve Danger Arc (0-15%) -->
        <path d="${reserveArc}" fill="none" stroke="var(--accent-crimson, #F43F5E)" stroke-width="4" stroke-linecap="round" stroke-opacity="0.6" />

        <!-- Dynamic Level Arc -->
        <path id="analog-active-arc" d="${bgArc}" fill="none" stroke="var(--accent-volt, #10B981)" stroke-width="4" stroke-linecap="round" />

        <!-- Hairline Ticks & Numerical Labels -->
        <g id="analog-ticks">${tickMarkup}</g>

        <!-- Swiss Fuel Dispenser Symbol -->
        <g transform="translate(${cx - 7}, ${cy - 48}) scale(0.65)" opacity="0.65">
          <path d="M4 4v16a1 1 0 001 1h8a1 1 0 001-1v-6h1a1 1 0 011 1v4a2 2 0 002 2h0a2 2 0 002-2V9.8a3 3 0 00-.88-2.12L17.5 5" fill="none" stroke="var(--text-secondary, #8A8A93)" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M4 10h10M7 4V2a1 1 0 011-1h2a1 1 0 011 1v2" fill="none" stroke="var(--text-secondary, #8A8A93)" stroke-width="1.5" stroke-linecap="round" />
        </g>

        <!-- Semicircle Baseline Flat Bar -->
        <line x1="${cx - radius}" y1="${cy}" x2="${cx + radius}" y2="${cy}" stroke="var(--line-hair, #1E1E24)" stroke-width="1" />

        <!-- Pivoting Needle Group -->
        <g id="analog-needle-group">
          <!-- Counter-balance Tail -->
          <line id="analog-needle-tail" x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy + 12}" stroke="var(--line-strong, #3E3E48)" stroke-width="2" stroke-linecap="round" />
          
          <!-- Needle Pointer -->
          <line id="analog-needle-pointer" x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - radius + 8}" stroke="var(--accent-amber, #FF5500)" stroke-width="2.5" stroke-linecap="round" />

          <!-- Center Pivot Bezel -->
          <circle cx="${cx}" cy="${cy}" r="12" fill="var(--bg-elevated, #141418)" stroke="var(--line-strong, #3E3E48)" stroke-width="1.5" />
          <circle cx="${cx}" cy="${cy}" r="6" fill="var(--bg-surface, #0E0E11)" stroke="var(--accent-amber, #FF5500)" stroke-width="1.5" />
          <circle cx="${cx}" cy="${cy}" r="2" fill="var(--accent-amber, #FF5500)" />
        </g>

        <!-- Touch / Drag Overlay -->
        <path d="${bgArc}" fill="none" stroke="transparent" stroke-width="50" class="cursor-pointer" />
      </svg>

      <!-- Digital Status Output Pill (Optional) -->
      ${hideReadout ? '' : `
      <div class="mt-2 flex items-center gap-3 px-3 py-1 bg-[var(--bg-elevated,#141418)] border border-[var(--line-hair,#1E1E24)] rounded-sm font-mono text-[11px]">
        <span class="flex items-center gap-1.5">
          <span id="analog-status-dot" class="w-1.5 h-1.5 rounded-full bg-[var(--accent-volt,#10B981)]"></span>
          <span id="analog-pct-text" class="font-bold tabular-nums text-[var(--text-primary,#F4F4F6)]">50%</span>
        </span>
        <span class="text-[var(--line-strong,#2E2E38)]">|</span>
        <span id="analog-vol-text" class="text-[var(--text-secondary,#8A8A93)] tabular-nums">17.5 L / 4.63 GAL</span>
      </div>
      `}
    </div>
  `;

  const svg = container.querySelector('#analog-180-svg');
  const activeArc = container.querySelector('#analog-active-arc');
  const needlePointer = container.querySelector('#analog-needle-pointer');
  const needleTail = container.querySelector('#analog-needle-tail');
  const statusDot = container.querySelector('#analog-status-dot');
  const pctText = container.querySelector('#analog-pct-text');
  const volText = container.querySelector('#analog-vol-text');

  function updateVisuals(pct) {
    const angle = percentToAngle(pct);
    const rad = (angle * Math.PI) / 180;
    const isReserve = pct < 14;
    const isAmber = pct >= 14 && pct <= 25;

    // 1. Dynamic Arc
    if (pct <= 0.5) {
      activeArc.setAttribute('d', '');
    } else {
      activeArc.setAttribute('d', describeArc180(cx, cy, radius, 180, angle));
    }

    const themeColor = isReserve
      ? 'var(--accent-crimson, #F43F5E)'
      : (isAmber ? 'var(--accent-amber, #FF5500)' : 'var(--accent-volt, #10B981)');

    activeArc.setAttribute('stroke', themeColor);

    // 2. Needle Orientation
    const tipR = radius - 8;
    const nx = cx + tipR * Math.cos(rad);
    const ny = cy + tipR * Math.sin(rad);

    needlePointer.setAttribute('x2', nx);
    needlePointer.setAttribute('y2', ny);
    needlePointer.setAttribute('stroke', themeColor);

    // Counter-weight moves opposite direction
    const tailR = 10;
    const tx = cx - tailR * Math.cos(rad);
    const ty = cy - tailR * Math.sin(rad);
    needleTail.setAttribute('x2', tx);
    needleTail.setAttribute('y2', ty);

    // 3. Readouts
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

  updateVisuals(currentPercent);

  let controller = null;

  if (interactive && svg) {
    controller = createGaugePointerController(svg, {
      initialValue: currentPercent,
      tankCapacityLiters,
      tankCapacityGallons,
      notchStep,
      coordinateToPercent: (e, rect) => {
        const scaleX = 260 / rect.width;
        const scaleY = 160 / rect.height;
        const px = (e.clientX - rect.left) * scaleX;
        const py = (e.clientY - rect.top) * scaleY;

        const dx = px - cx;
        const dy = py - cy;

        // If dragged below pivot line
        if (dy > 0) {
          return dx < 0 ? 0 : 100;
        }

        const angleRad = Math.atan2(dy, dx); // [-PI, 0]
        let deg = 360 + (angleRad * 180) / Math.PI; // [180, 360]
        return angleToPercent(deg);
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
      if (controller) controller.destroy();
      container.innerHTML = '';
    }
  };
}
