/**
 * OCTANE // KINETIC — Wear Dial Card ("Celda de Desgaste Mecánico")
 * Architectural 240° SVG Gauge with Swiss horology minimalism and protagonist iconography.
 * 
 * Strict specifications:
 * - 240° SVG dial with background arc (stroke-width 2, var(--line-strong)).
 * - Protagonist vector icon centered at the top of the gauge arc for instant recognition.
 * - Active arc colored by % life remaining:
 *     > 30%:   --accent-volt    (#10B981)
 *     10-30%:  --accent-amber   (#FF5500)
 *     < 10%:   --accent-crimson (#F43F5E)
 * - Minimalist needle pivoting from center and pointing at current life %.
 * - Macro-number (font-sans font-light text-3xl sm:text-4xl tabular-nums) + "KM REST." (10px mono).
 * - Top row: Name (10px mono uppercase tracking-widest) + Edit button + Status indicator dot.
 * - Bottom telemetry strip: "ÚLT: XX,XXX KM" + [HISTORIAL] + [↻ RESET].
 * - Reactive formula: KM Restantes = Math.max(0, (lastServiceOdo + intervalKm) - currentOdo).
 * - Silencio Verbal Absoluto: Prohibidos <p> tags, zero blur, zero drop shadows.
 */

import { renderComponentIconSvg } from './icons-catalog.js';

export { DEFAULT_MAINTENANCE_ITEMS } from '../../core/db-local.js';

/**
 * Escapes HTML characters for safe template interpolation.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Converts polar coordinates to SVG Cartesian coordinates.
 * Angle measured in degrees clockwise from East (0° = 3 o'clock).
 * @param {number} cx - Center X
 * @param {number} cy - Center Y
 * @param {number} radius - Radius in pixels
 * @param {number} angleInDegrees - Angle in degrees
 * @returns {{x: number, y: number}}
 */
export function polarToCartesian(cx, cy, radius, angleInDegrees) {
    const radians = (angleInDegrees * Math.PI) / 180.0;
    return {
        x: cx + radius * Math.cos(radians),
        y: cy + radius * Math.sin(radians),
    };
}

/**
 * Constructs an SVG path for a circular arc swept clockwise from startAngle to endAngle.
 * @param {number} cx
 * @param {number} cy
 * @param {number} radius
 * @param {number} startAngle
 * @param {number} endAngle
 * @returns {string} SVG Path 'd' attribute
 */
export function buildArcPath(cx, cy, radius, startAngle, endAngle) {
    const start = polarToCartesian(cx, cy, radius, startAngle);
    const end = polarToCartesian(cx, cy, radius, endAngle);
    const delta = endAngle - startAngle;
    const largeArcFlag = delta > 180 ? 1 : 0;
    return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

/**
 * Resolves color tokens and status metadata based on life percentage.
 * @param {number} lifePct
 * @returns {{ status: string, colorVar: string, hex: string }}
 */
export function getWearStatusColor(lifePct) {
    if (lifePct < 10) {
        return {
            status: 'critical',
            colorVar: 'var(--accent-crimson)',
            hex: '#F43F5E',
        };
    }
    if (lifePct <= 30) {
        return {
            status: 'warning',
            colorVar: 'var(--accent-amber)',
            hex: '#FF5500',
        };
    }
    return {
        status: 'nominal',
        colorVar: 'var(--accent-volt)',
        hex: '#10B981',
    };
}

/**
 * Calculates remaining life, percentages, and telemetry status for a maintenance item.
 * @param {Object} item
 * @param {number} [currentOdo=0]
 * @returns {Object}
 */
export function calculateWearDialTelemetry(item, currentOdo = 0) {
    const odo = Number(currentOdo) || 0;
    const lastServiceOdo = Number(item.lastServiceOdo) || 0;
    const intervalKm = Math.max(1, Number(item.intervalKm) || 5000);

    // Strict formula: KM Restantes = Math.max(0, (lastServiceOdo + intervalKm) - currentOdo)
    const kmRemaining = Math.max(0, (lastServiceOdo + intervalKm) - odo);

    // Percentage of interval remaining (clamped between 0 and 100)
    const rawPct = (kmRemaining / intervalKm) * 100;
    const lifePct = Math.min(100, Math.max(0, rawPct));

    const statusMeta = getWearStatusColor(lifePct);

    const isCritical = statusMeta.status === 'critical' || kmRemaining <= 0 || kmRemaining < 500 || lifePct < 10;
    const isWarning = !isCritical && (statusMeta.status === 'warning' || kmRemaining < 1000 || lifePct <= 30);

    return {
        kmRemaining,
        remainingKm: kmRemaining,
        lifePct,
        status: statusMeta.status,
        statusText: isCritical ? 'CRÍTICO' : (isWarning ? 'ATENCIÓN' : 'NOMINAL'),
        colorVar: statusMeta.colorVar,
        hex: statusMeta.hex,
        isCritical,
        isWarning,
        lastServiceOdo,
        intervalKm,
        currentOdo: odo,
    };
}

export const calculateWear = calculateWearDialTelemetry;

/**
 * Renders standalone 240° SVG circular instrument dial.
 * @param {number} [lifePct=100]
 * @param {string} [strokeColor='var(--accent-volt)']
 * @returns {string} SVG markup
 */
export function render240ArcSvg(lifePct = 100, strokeColor = 'var(--accent-volt)') {
    const cx = 70;
    const cy = 70;
    const radius = 52;
    const startAngle = 150;
    const totalSweep = 240;
    const bgArcPath = buildArcPath(cx, cy, radius, startAngle, startAngle + totalSweep);
    const fraction = Math.max(0, Math.min(1, lifePct / 100));
    let activeArcPath = '';
    if (fraction > 0.005) {
        const activeEndAngle = startAngle + fraction * totalSweep;
        activeArcPath = buildArcPath(cx, cy, radius, startAngle, activeEndAngle);
    }
    const needleAngle = startAngle + fraction * totalSweep;
    const needleTip = polarToCartesian(cx, cy, radius - 10, needleAngle);
    return `
      <svg viewBox="0 0 140 140" class="w-28 h-28 mx-auto overflow-visible select-none pointer-events-none" fill="none">
        <path d="${bgArcPath}" stroke="var(--line-strong)" stroke-width="2.5" stroke-linecap="round" />
        ${activeArcPath ? `<path d="${activeArcPath}" stroke="${strokeColor}" stroke-width="3" stroke-linecap="round" />` : ''}
        <line x1="${cx}" y1="${cy}" x2="${needleTip.x.toFixed(2)}" y2="${needleTip.y.toFixed(2)}" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" />
        <circle cx="${cx}" cy="${cy}" r="2.5" fill="${strokeColor}" />
      </svg>
    `;
}

/**
 * Renders the HTML markup for a single wear dial card.
 * Guaranteed Silencio Verbal: Zero <p> tags.
 * 
 * @param {Object} item - Maintenance item record
 * @param {number} [currentOdo=0] - Highest current odometer from telemetry_logs
 * @returns {string} HTML string
 */
export function renderWearDialCard(item, currentOdo = 0) {
    const {
        kmRemaining,
        lifePct,
        colorVar,
        lastServiceOdo,
    } = calculateWearDialTelemetry(item, currentOdo);

    // Geometry definition for 240° Arc Dial
    // Arc spans 240°, starting from 150° (bottom-left) to 390° (bottom-right)
    const cx = 65;
    const cy = 46;
    const radius = 38;
    const needleLength = 29;
    const startAngle = 150;
    const totalSweep = 240;

    // 1. Background Arc (240°)
    const bgArcPath = buildArcPath(cx, cy, radius, startAngle, startAngle + totalSweep);

    // 2. Active Arc (fraction of 240°)
    const fraction = Math.max(0, Math.min(1, lifePct / 100));
    let activeArcPath = '';
    if (fraction > 0.005) {
        const activeEndAngle = startAngle + fraction * totalSweep;
        activeArcPath = buildArcPath(cx, cy, radius, startAngle, activeEndAngle);
    }

    // 3. Minimalist Needle Position
    const needleAngle = startAngle + fraction * totalSweep;
    const needleTip = polarToCartesian(cx, cy, needleLength, needleAngle);

    // 4. Numeric and Label Formatting
    const kmFormatted = Number(kmRemaining).toLocaleString('en-US');
    const lastOdoText = lastServiceOdo > 0 
        ? `${Number(lastServiceOdo).toLocaleString('en-US')} KM` 
        : '—';
    const safeName = escapeHtml(item.name || 'COMPONENTE');
    const safeId = escapeHtml(item.id || '');
    const iconSvg = renderComponentIconSvg(item, 'w-4 h-4');

    return `
    <div class="flat-cell p-5 flex flex-col justify-between min-h-[220px] bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)]/30 transition-colors" data-item-id="${safeId}">
      <!-- Top Row: Name + Edit Button + Status Dot -->
      <div class="flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">
        <span class="truncate pr-2 font-medium" title="${safeName}">${safeName}</span>
        
        <div class="flex items-center gap-2 shrink-0">
          <button 
            type="button" 
            data-action="edit" 
            data-id="${safeId}"
            class="w-6 h-6 -my-1 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--line-hair)] transition-colors cursor-pointer rounded-xs"
            title="Editar componente"
          >
            <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75">
              <path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
            </svg>
          </button>
          
          <span class="w-1.5 h-1.5 rounded-full shrink-0" style="background-color: ${colorVar};" title="${Math.round(lifePct)}% VIDA"></span>
        </div>
      </div>

      <!-- Center Instrument: 240° Arc Gauge with Protagonist Vector Icon -->
      <div class="my-auto py-2 flex flex-col items-center justify-center">
        <div class="relative w-36 flex flex-col items-center">
          
          <!-- Protagonist Vector Icon in Top-Center of Arc -->
          <div class="absolute top-1.5 left-1/2 -translate-x-1/2 flex items-center justify-center text-[var(--text-secondary)] pointer-events-none opacity-75">
            ${iconSvg}
          </div>

          <svg class="w-36 h-20 overflow-visible select-none pointer-events-none" viewBox="0 0 130 72" role="img" aria-label="${safeName} dial">
            <!-- Background Arc (240 deg) -->
            <path d="${bgArcPath}" fill="none" stroke="var(--line-strong)" stroke-width="2" stroke-linecap="round" />
            <!-- Active Arc -->
            ${activeArcPath ? `<path d="${activeArcPath}" fill="none" stroke="${colorVar}" stroke-width="2" stroke-linecap="round" />` : ''}
            <!-- Minimalist Needle -->
            <line x1="${cx}" y1="${cy}" x2="${needleTip.x.toFixed(2)}" y2="${needleTip.y.toFixed(2)}" stroke="${colorVar}" stroke-width="1.5" stroke-linecap="round" />
            <!-- Pivot Center Dot -->
            <circle cx="${cx}" cy="${cy}" r="2" fill="var(--text-primary)" />
          </svg>

          <!-- Macro-number and Label -->
          <div class="mt-0.5 flex flex-col items-center text-center">
            <span class="font-sans font-light text-3xl sm:text-4xl tracking-tighter tabular-nums text-[var(--text-primary)] leading-none">
              ${kmFormatted}
            </span>
            <span class="font-mono text-[10px] text-[var(--text-secondary)] tracking-widest uppercase mt-1">
              KM REST.
            </span>
          </div>
        </div>
      </div>

      <!-- Bottom Telemetry Strip -->
      <div class="pt-2.5 border-t border-[var(--line-hair)] flex items-center justify-between font-mono text-[10px]">
        <span class="text-[var(--text-secondary)] tabular-nums truncate mr-2">
          ÚLT: ${lastOdoText}
        </span>
        <div class="flex items-center gap-1.5 shrink-0">
          <button 
            type="button" 
            data-action="history" 
            data-id="${safeId}"
            class="px-2 py-1 flat-pill text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--line-strong)] transition-colors cursor-pointer"
            title="Ver Historial"
          >
            HISTORIAL
          </button>
          <button 
            type="button" 
            data-action="reset" 
            data-id="${safeId}"
            class="px-2 py-1 flat-pill text-[var(--text-primary)] hover:bg-[var(--line-hair)] hover:border-[var(--line-strong)] transition-colors cursor-pointer flex items-center gap-1"
            title="Calibrar Relevo"
          >
            <span class="text-xs leading-none">↻</span> RESET
          </button>
        </div>
      </div>
    </div>
    `;
}
