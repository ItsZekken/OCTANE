/**
 * OCTANE // KINETIC — Interactive KPI Timeline & Detail Modal ("modal-kpi-detail.js")
 *
 * Full-screen (100dvh mobile / generous sheet desktop) Swiss instrument inspector
 * opened when tapping any Cockpit KPI tile:
 * - 'efficiency': Rendimiento por ciclo + media histórica + evolución temporal
 * - 'cost': Costo por KM + precio histórico del galón en tanqueadas
 * - 'monthly': Gasto mensual real (llevado) vs proyección de cierre + historial
 * - 'usage': Ritmo diario de rodaje (últimos 7 / 30 días) + telemetría de uso
 *
 * Strict compliance with AGENTS.md & DESIGN_GUIDELINES.md:
 * - Zero <p> tags, zero nested boxes, flat hairline dividers (divide-x / divide-y).
 * - Full Dark (Modo Carbón) & Light (Modo Papel) compatibility via CSS variables.
 */

import { playHorologyTick } from '../../core/state.js';
import { formatDateShort, formatEff, formatVol } from '../../core/telemetry-engine.js';

let kpiModalRoot = null;
let activeState = {
    type: 'efficiency',
    unit: 'gal',
    fuelPriceCop: 16000,
    efficiency: null,
    cost: null,
    monthly: null,
    usage: null,
    selectedIdx: -1,
    usageWindow: '30d' // '7d' | '30d'
};

function ensureKpiModalRoot() {
    if (typeof document === 'undefined') return null;
    if (document.getElementById('octane-kpi-detail-modal')) {
        kpiModalRoot = document.getElementById('octane-kpi-detail-modal');
        return kpiModalRoot;
    }

    kpiModalRoot = document.createElement('div');
    kpiModalRoot.id = 'octane-kpi-detail-modal';
    kpiModalRoot.className = 'fixed inset-0 z-50 hidden select-none';
    document.body.appendChild(kpiModalRoot);

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && kpiModalRoot && !kpiModalRoot.classList.contains('hidden')) {
            closeKpiDetailModal();
        }
    });

    return kpiModalRoot;
}

/**
 * Generates an inline micro-sparkline SVG for Cockpit KPI cells.
 *
 * @param {Array<number>} values
 * @param {string} [strokeColor='var(--accent-volt)']
 * @param {boolean} [invertY=false] - True when lower values are visually better (optional; false keeps mathematical up=up)
 * @returns {string} SVG markup
 */
export function renderMiniSparklineSvg(values = [], strokeColor = 'var(--accent-volt)') {
    if (!Array.isArray(values) || values.length < 2) return '';
    const clean = values.map(v => Number(v)).filter(v => Number.isFinite(v));
    if (clean.length < 2) return '';

    const w = 68;
    const h = 22;
    const padX = 2;
    const padY = 3;
    const min = Math.min(...clean);
    const max = Math.max(...clean);
    const span = max - min || 1;

    const coords = clean.map((v, i) => {
        const x = padX + (i / (clean.length - 1)) * (w - padX * 2);
        const y = h - padY - ((v - min) / span) * (h - padY * 2);
        return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) };
    });

    const linePath = coords.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    const areaPath = `${linePath} L ${coords[coords.length - 1].x} ${h} L ${coords[0].x} ${h} Z`;
    const lastPt = coords[coords.length - 1];

    return `
        <svg viewBox="0 0 ${w} ${h}" class="w-14 sm:w-16 h-5 sm:h-6 shrink-0 overflow-visible" preserveAspectRatio="none" aria-hidden="true">
            <path d="${areaPath}" fill="${strokeColor}" fill-opacity="0.12" stroke="none" />
            <path d="${linePath}" fill="none" stroke="${strokeColor}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
            <circle cx="${lastPt.x}" cy="${lastPt.y}" r="2.2" fill="${strokeColor}" />
        </svg>
    `;
}

/**
 * Resolves CSS color token for a semantic trend tone.
 * @param {'volt'|'amber'|'crimson'|'cyan'|'neutral'} tone
 * @returns {string}
 */
export function getToneColorVar(tone) {
    if (tone === 'volt') return 'var(--accent-volt)';
    if (tone === 'crimson') return 'var(--accent-crimson)';
    if (tone === 'amber') return 'var(--accent-amber)';
    if (tone === 'cyan') return 'var(--accent-cyan)';
    return 'var(--text-secondary)';
}

/**
 * Opens the interactive KPI Detail & Timeline Modal.
 *
 * @param {'efficiency'|'cost'|'monthly'|'usage'} kpiType
 * @param {Object} payload - Precomputed analytics bundles + unit
 */
export function openKpiDetailModal(kpiType = 'efficiency', payload = {}) {
    const root = ensureKpiModalRoot();
    if (!root) return;

    playHorologyTick(1250, 0.015, 0.03);

    activeState = {
        type: kpiType || 'efficiency',
        unit: payload.unit || 'gal',
        fuelPriceCop: Number(payload.fuelPriceCop) || 16000,
        efficiency: payload.efficiency || null,
        cost: payload.cost || null,
        monthly: payload.monthly || null,
        usage: payload.usage || null,
        selectedIdx: -1,
        usageWindow: '30d'
    };

    resetSelectedIndexForType();
    root.classList.remove('hidden');
    renderModalContent();
}

export function closeKpiDetailModal() {
    if (kpiModalRoot && !kpiModalRoot.classList.contains('hidden')) {
        playHorologyTick(850, 0.012, 0.02);
        kpiModalRoot.classList.add('hidden');
        kpiModalRoot.innerHTML = '';
    }
}

function resetSelectedIndexForType() {
    const pts = getActiveSeries();
    activeState.selectedIdx = pts.length > 0 ? pts.length - 1 : -1;
}

function getActiveSeries() {
    if (activeState.type === 'efficiency') return activeState.efficiency?.series || [];
    if (activeState.type === 'cost') return activeState.cost?.series || [];
    if (activeState.type === 'monthly') return activeState.monthly?.series || [];
    if (activeState.type === 'usage') {
        return activeState.usageWindow === '7d'
            ? (activeState.usage?.last7Series || [])
            : (activeState.usage?.series || []);
    }
    return [];
}

function buildLineChartSvg(points, options = {}) {
    const {
        valueKey = 'value',
        benchmarkVal = null,
        benchmarkLabel = 'MEDIA',
        accentColor = 'var(--accent-volt)',
        selectedIdx = points.length - 1,
        unitSuffix = '',
        isCurrency = false
    } = options;

    if (!Array.isArray(points) || points.length === 0) {
        return `
            <div class="h-48 sm:h-56 flex items-center justify-center font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">
                SIN HISTORIAL SUFICIENTE PARA GRAFICAR
            </div>
        `;
    }

    const w = 640;
    const h = 210;
    const padL = 14;
    const padR = 14;
    const padT = 22;
    const padB = 26;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    const vals = points.map(p => Number(p[valueKey]) || 0);
    if (benchmarkVal !== null && Number.isFinite(benchmarkVal) && benchmarkVal > 0) {
        vals.push(benchmarkVal);
    }

    let minV = Math.min(...vals);
    let maxV = Math.max(...vals);
    if (minV === maxV) {
        minV = Math.max(0, minV * 0.85);
        maxV = maxV * 1.15 || 10;
    } else {
        const margin = (maxV - minV) * 0.16;
        minV = Math.max(0, minV - margin);
        maxV = maxV + margin;
    }
    const span = maxV - minV || 1;

    const toX = (idx) => {
        if (points.length === 1) return padL + plotW / 2;
        return padL + (idx / (points.length - 1)) * plotW;
    };
    const toY = (v) => padT + plotH - ((v - minV) / span) * plotH;

    const coords = points.map((p, i) => {
        const v = Number(p[valueKey]) || 0;
        return {
            idx: i,
            x: Number(toX(i).toFixed(1)),
            y: Number(toY(v).toFixed(1)),
            v,
            label: p.label || p.date || ''
        };
    });

    const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ');
    const areaPath = coords.length > 1
        ? `${linePath} L ${coords[coords.length - 1].x} ${padT + plotH} L ${coords[0].x} ${padT + plotH} Z`
        : '';

    const gridLines = [0, 0.5, 1].map(frac => {
        const gy = Number((padT + frac * plotH).toFixed(1));
        const gVal = maxV - frac * span;
        const txt = isCurrency
            ? `$${Math.round(gVal).toLocaleString('es-CO')}`
            : `${gVal >= 100 ? Math.round(gVal) : gVal.toFixed(1)}${unitSuffix ? ' ' + unitSuffix : ''}`;
        return `
            <line x1="${padL}" y1="${gy}" x2="${w - padR}" y2="${gy}" stroke="var(--line-hair)" stroke-width="1" />
            <text x="${padL + 2}" y="${gy - 4}" fill="var(--text-muted)" font-family="JetBrains Mono, monospace" font-size="9">${txt}</text>
        `;
    }).join('');

    let benchHtml = '';
    if (benchmarkVal !== null && Number.isFinite(benchmarkVal) && benchmarkVal > 0) {
        const by = Number(toY(benchmarkVal).toFixed(1));
        benchHtml = `
            <line x1="${padL}" y1="${by}" x2="${w - padR}" y2="${by}" stroke="var(--text-secondary)" stroke-width="1" stroke-dasharray="4 4" opacity="0.7" />
            <text x="${w - padR - 2}" y="${by - 4}" text-anchor="end" fill="var(--text-secondary)" font-family="JetBrains Mono, monospace" font-size="9">${benchmarkLabel}</text>
        `;
    }

    const activeCoord = coords[Math.max(0, Math.min(coords.length - 1, selectedIdx))];
    const xLabelStep = Math.max(1, Math.ceil(coords.length / 5));

    const xAxisLabels = coords
        .filter((_, idx) => idx === 0 || idx === coords.length - 1 || idx % xLabelStep === 0)
        .map(c => `<text x="${c.x}" y="${h - 6}" text-anchor="${c.idx === 0 ? 'start' : (c.idx === coords.length - 1 ? 'end' : 'middle')}" fill="var(--text-secondary)" font-family="JetBrains Mono, monospace" font-size="9">${c.label}</text>`)
        .join('');

    const showAllDots = coords.length <= 18;
    const dotsHtml = coords.map(c => {
        const isSel = c.idx === activeCoord.idx;
        if (!showAllDots && !isSel) return '';
        return `
            <circle cx="${c.x}" cy="${c.y}" r="${isSel ? 5 : 2.8}"
                fill="${isSel ? accentColor : 'var(--bg-void)'}"
                stroke="${accentColor}" stroke-width="${isSel ? 2 : 1.5}" />
        `;
    }).join('');

    return `
        <div class="relative w-full">
            <svg id="kpi-timeline-svg" viewBox="0 0 ${w} ${h}" class="w-full h-48 sm:h-56 touch-none cursor-crosshair select-none overflow-visible">
                <defs>
                    <linearGradient id="kpiAreaGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="${accentColor}" stop-opacity="0.26" />
                        <stop offset="100%" stop-color="${accentColor}" stop-opacity="0.01" />
                    </linearGradient>
                </defs>
                ${gridLines}
                ${benchHtml}
                ${areaPath ? `<path d="${areaPath}" fill="url(#kpiAreaGrad)" />` : ''}
                ${coords.length > 1 ? `<path d="${linePath}" fill="none" stroke="${accentColor}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />` : ''}
                <line x1="${activeCoord.x}" y1="${padT}" x2="${activeCoord.x}" y2="${padT + plotH}" stroke="${accentColor}" stroke-width="1" stroke-dasharray="2 3" opacity="0.65" />
                ${dotsHtml}
                ${xAxisLabels}
            </svg>
        </div>
    `;
}

function buildMonthlyBarsSvg(series = [], selectedIdx = series.length - 1) {
    if (!Array.isArray(series) || series.length === 0) {
        return `
            <div class="h-48 sm:h-56 flex items-center justify-center font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">
                SIN REGISTROS MENSUALES
            </div>
        `;
    }

    const w = 640;
    const h = 215;
    const padL = 16;
    const padR = 16;
    const padT = 26;
    const padB = 28;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    const maxVal = Math.max(...series.map(m => Math.max(m.value || 0, m.projectedCop || 0)), 50000);
    const colW = plotW / series.length;
    const barW = Math.min(48, Math.max(18, colW * 0.52));

    const barsHtml = series.map((m, idx) => {
        const cx = padL + idx * colW + colW / 2;
        const bx = cx - barW / 2;
        const baseY = padT + plotH;

        const actualVal = Number(m.value) || 0;
        const projVal = m.isCurrent ? Math.max(actualVal, Number(m.projectedCop) || 0) : actualVal;
        const actualH = actualVal > 0 ? Math.max(4, (actualVal / maxVal) * plotH) : 2;
        const projH = projVal > 0 ? Math.max(actualH, (projVal / maxVal) * plotH) : 2;

        const actualY = baseY - actualH;
        const projY = baseY - projH;
        const isSel = idx === selectedIdx;

        const actualColor = m.isCurrent
            ? 'var(--accent-volt)'
            : (isSel ? 'var(--accent-amber)' : 'var(--text-primary)');

        const topLabel = m.isCurrent && projVal > actualVal
            ? `~${Math.round(projVal / 1000)}K`
            : `$${Math.round(actualVal / 1000)}K`;

        return `
            <g class="kpi-month-bar cursor-pointer" data-pt-idx="${idx}">
                ${m.isCurrent && projH > actualH ? `
                    <rect x="${bx}" y="${projY}" width="${barW}" height="${projH - actualH}"
                        fill="var(--accent-amber)" fill-opacity="0.16"
                        stroke="var(--accent-amber)" stroke-width="1.2" stroke-dasharray="3 2" />
                ` : ''}
                <rect x="${bx}" y="${actualY}" width="${barW}" height="${actualH}"
                    fill="${actualColor}" fill-opacity="${isSel ? '0.95' : '0.72'}" />
                ${isSel ? `
                    <rect x="${bx - 3}" y="${baseY + 2}" width="${barW + 6}" height="2" fill="var(--accent-amber)" />
                ` : ''}
                <text x="${cx}" y="${Math.max(12, projY - 6)}" text-anchor="middle"
                    fill="${m.isCurrent ? 'var(--accent-amber)' : (isSel ? 'var(--text-primary)' : 'var(--text-secondary)')}"
                    font-family="JetBrains Mono, monospace" font-size="9.5" font-weight="${isSel ? '600' : '400'}">
                    ${topLabel}
                </text>
                <text x="${cx}" y="${h - 8}" text-anchor="middle"
                    fill="${isSel ? 'var(--text-primary)' : 'var(--text-secondary)'}"
                    font-family="JetBrains Mono, monospace" font-size="10" font-weight="${isSel ? '700' : '500'}">
                    ${m.label}${m.isCurrent ? '•' : ''}
                </text>
            </g>
        `;
    }).join('');

    return `
        <div class="relative w-full">
            <svg id="kpi-monthly-svg" viewBox="0 0 ${w} ${h}" class="w-full h-48 sm:h-56 select-none overflow-visible">
                <line x1="${padL}" y1="${padT + plotH}" x2="${w - padR}" y2="${padT + plotH}" stroke="var(--line-strong)" stroke-width="1" />
                <line x1="${padL}" y1="${padT + plotH * 0.5}" x2="${w - padR}" y2="${padT + plotH * 0.5}" stroke="var(--line-hair)" stroke-width="1" />
                ${barsHtml}
            </svg>
        </div>
    `;
}

function renderInspectHud(series) {
    const idx = Math.max(0, Math.min(series.length - 1, activeState.selectedIdx));
    const pt = series[idx];
    if (!pt) {
        return `<div class="font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">SIN PUNTOS EN LÍNEA DE TIEMPO</div>`;
    }

    if (activeState.type === 'efficiency') {
        const dTxt = pt.delta ? pt.delta.text : 'INICIO';
        const dColor = pt.delta ? getToneColorVar(pt.delta.tone) : 'var(--text-secondary)';
        return `
            <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex items-baseline gap-2.5">
                    <span class="font-sans font-light text-2xl sm:text-3xl tracking-tight tabular-nums text-[var(--text-primary)]">${pt.formatted}</span>
                    <span class="font-mono text-[11px] font-semibold tabular-nums" style="color: ${dColor}">${dTxt}</span>
                </div>
                <div class="font-mono text-[10px] uppercase tracking-wider text-[var(--text-secondary)] tabular-nums">
                    ${formatDateShort(pt.startDate)}–${pt.label} · +${pt.dist} KM · ${pt.gals} GAL
                </div>
            </div>
        `;
    }

    if (activeState.type === 'cost') {
        const dTxt = pt.delta ? pt.delta.text : 'INICIO';
        const dColor = pt.delta ? getToneColorVar(pt.delta.tone) : 'var(--text-secondary)';
        return `
            <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex items-baseline gap-2.5">
                    <span class="font-sans font-light text-2xl sm:text-3xl tracking-tight tabular-nums text-[var(--text-primary)]">${pt.formatted}/KM</span>
                    <span class="font-mono text-[11px] font-semibold tabular-nums" style="color: ${dColor}">${dTxt}</span>
                </div>
                <div class="font-mono text-[10px] uppercase tracking-wider text-[var(--text-secondary)] tabular-nums">
                    ${pt.label} · $${pt.pricePerGal.toLocaleString('es-CO')}/GAL · +${pt.dist} KM
                </div>
            </div>
        `;
    }

    if (activeState.type === 'monthly') {
        const badge = pt.isCurrent ? `LLEVADO · PROY ~$${Math.round(pt.projectedCop / 1000)}K` : `${pt.refuelCount} TANQUEOS`;
        return `
            <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="flex items-baseline gap-2.5">
                    <span class="font-sans font-light text-2xl sm:text-3xl tracking-tight tabular-nums text-[var(--text-primary)]">$${pt.value.toLocaleString('es-CO')}</span>
                    <span class="font-mono text-[10px] uppercase tracking-wider ${pt.isCurrent ? 'text-[var(--accent-amber)]' : 'text-[var(--text-secondary)]'}">${badge}</span>
                </div>
                <div class="font-mono text-[10px] uppercase tracking-wider text-[var(--text-secondary)] tabular-nums">
                    ${pt.ym} · ${pt.gallons} GAL · ${pt.km.toLocaleString('es-CO')} KM
                </div>
            </div>
        `;
    }

    // usage
    return `
        <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-baseline gap-2.5">
                <span class="font-sans font-light text-2xl sm:text-3xl tracking-tight tabular-nums text-[var(--text-primary)]">${pt.km.toFixed(1)} KM</span>
                <span class="font-mono text-[10px] uppercase tracking-wider ${pt.isGpsReal ? 'text-[var(--accent-volt)]' : 'text-[var(--text-secondary)]'}">
                    ${pt.isGpsReal ? 'GPS REAL' : 'ESTIMADO'}
                </span>
            </div>
            <div class="font-mono text-[10px] uppercase tracking-wider text-[var(--text-secondary)] tabular-nums">
                ${pt.date}
            </div>
        </div>
    `;
}

function renderModalContent() {
    if (!kpiModalRoot) return;

    const { type, unit, efficiency, cost, monthly, usage } = activeState;
    const tabs = [
        { id: 'efficiency', label: 'RENDIMIENTO' },
        { id: 'cost', label: 'COSTO / KM' },
        { id: 'monthly', label: 'GASTO MES' },
        { id: 'usage', label: 'RITMO USO' }
    ];

    let heroTitle = '';
    let heroValue = '—';
    let heroSub = '';
    let deltaText = '';
    let deltaColor = 'var(--text-secondary)';
    let summaryCells = [];
    let chartHtml = '';
    let historyListHtml = '';
    const series = getActiveSeries();

    if (type === 'efficiency' && efficiency) {
        heroTitle = 'RENDIMIENTO POR CICLO';
        heroValue = efficiency.heroFormatted;
        heroSub = `${efficiency.unitLabel} · ÚLTIMO CICLO`;
        deltaText = efficiency.delta?.text !== '—' ? `${efficiency.delta.text} ${efficiency.compareTargetLabel}` : 'BASE INICIAL';
        deltaColor = getToneColorVar(efficiency.delta?.tone || 'neutral');

        summaryCells = [
            { label: 'MEDIA HISTÓRICA', value: `${efficiency.avgFormatted}`, tone: 'volt' },
            { label: 'RÉCORD', value: `${efficiency.bestValue > 0 ? efficiency.bestValue.toFixed(2) : '—'}`, tone: 'amber' },
            { label: 'MÍNIMO', value: `${efficiency.worstValue > 0 ? efficiency.worstValue.toFixed(2) : '—'}`, tone: 'neutral' },
            { label: 'CICLOS VÁLIDOS', value: `${efficiency.cycleCount}`, tone: 'neutral' }
        ];

        chartHtml = buildLineChartSvg(series, {
            valueKey: 'value',
            benchmarkVal: efficiency.avgValue,
            benchmarkLabel: `MEDIA ${efficiency.avgFormatted}`,
            accentColor: 'var(--accent-volt)',
            selectedIdx: activeState.selectedIdx,
            unitSuffix: ''
        });

        historyListHtml = [...series].reverse().map(c => `
            <div class="px-4 py-3 flex items-center justify-between gap-3">
                <div class="min-w-0">
                    <div class="font-mono text-xs font-semibold text-[var(--text-primary)] uppercase tabular-nums">
                        ${formatDateShort(c.startDate)} – ${c.label}
                    </div>
                    <div class="font-mono text-[10px] text-[var(--text-secondary)] tabular-nums mt-0.5">
                        +${c.dist} KM · ${c.gals} GAL · ${c.days} D
                    </div>
                </div>
                <div class="text-right shrink-0">
                    <div class="font-mono text-sm font-semibold tabular-nums text-[var(--text-primary)]">${c.formatted}</div>
                    ${c.delta ? `<div class="font-mono text-[10px] font-semibold tabular-nums" style="color: ${getToneColorVar(c.delta.tone)}">${c.delta.text}</div>` : ''}
                </div>
            </div>
        `).join('');
    } else if (type === 'cost' && cost) {
        heroTitle = 'COSTO OPERATIVO POR KILÓMETRO';
        heroValue = cost.currentCostPerKm > 0 ? `$${cost.currentCostPerKm.toLocaleString('es-CO')}` : '—';
        heroSub = 'COP / KM · ÚLTIMO CICLO';
        deltaText = cost.delta?.text !== '—' ? `${cost.delta.text} VS CICLO ANT` : 'BASE ACTUAL';
        deltaColor = getToneColorVar(cost.delta?.tone || 'neutral');

        summaryCells = [
            { label: 'PROMEDIO / KM', value: cost.avgCostPerKm > 0 ? `$${cost.avgCostPerKm.toLocaleString('es-CO')}` : '—', tone: 'neutral' },
            { label: 'ÚLT. GALÓN', value: `$${cost.lastRefuelPrice.toLocaleString('es-CO')}`, tone: 'amber' },
            { label: 'MÁS BARATO', value: cost.minCostPerKm > 0 ? `$${cost.minCostPerKm.toLocaleString('es-CO')}` : '—', tone: 'volt' },
            { label: 'MÁS ALTO', value: cost.maxCostPerKm > 0 ? `$${cost.maxCostPerKm.toLocaleString('es-CO')}` : '—', tone: 'crimson' }
        ];

        chartHtml = buildLineChartSvg(series, {
            valueKey: 'value',
            benchmarkVal: cost.avgCostPerKm,
            benchmarkLabel: `PROM $${cost.avgCostPerKm}`,
            accentColor: 'var(--accent-amber)',
            selectedIdx: activeState.selectedIdx,
            isCurrency: true
        });

        historyListHtml = [...series].reverse().map(c => `
            <div class="px-4 py-3 flex items-center justify-between gap-3">
                <div class="min-w-0">
                    <div class="font-mono text-xs font-semibold text-[var(--text-primary)] uppercase tabular-nums">
                        ${formatDateShort(c.startDate)} – ${c.label}
                    </div>
                    <div class="font-mono text-[10px] text-[var(--text-secondary)] tabular-nums mt-0.5">
                        GALÓN $${c.pricePerGal.toLocaleString('es-CO')} · ${c.effKmGal.toFixed(1)} KM/G
                    </div>
                </div>
                <div class="text-right shrink-0">
                    <div class="font-mono text-sm font-semibold tabular-nums text-[var(--text-primary)]">${c.formatted}/KM</div>
                    ${c.delta ? `<div class="font-mono text-[10px] font-semibold tabular-nums" style="color: ${getToneColorVar(c.delta.tone)}">${c.delta.text}</div>` : ''}
                </div>
            </div>
        `).join('');
    } else if (type === 'monthly' && monthly) {
        heroTitle = 'GASTO MENSUAL: LLEVADO VS PROYECTADO';
        heroValue = `$${monthly.currentMonthSpent.toLocaleString('es-CO')}`;
        heroSub = `GASTADO HASTA HOY · DÍA ${monthly.dayOfMonth} DE ${monthly.daysInMonth}`;
        deltaText = monthly.delta?.text !== '—' ? `${monthly.delta.text} PROY VS MES ANT` : 'PRIMER MES';
        deltaColor = getToneColorVar(monthly.delta?.tone || 'neutral');

        summaryCells = [
            { label: 'LLEVADO HOY', value: `$${monthly.currentMonthSpent.toLocaleString('es-CO')}`, tone: 'volt' },
            { label: 'PROY. CIERRE MES', value: `~$${monthly.projectedMonthSpent.toLocaleString('es-CO')}`, tone: 'amber' },
            { label: 'MES ANTERIOR', value: monthly.prevMonthSpent > 0 ? `$${monthly.prevMonthSpent.toLocaleString('es-CO')}` : '—', tone: 'neutral' },
            { label: 'RITMO DIARIO', value: `$${monthly.dailySpendPace.toLocaleString('es-CO')}/D`, tone: 'neutral' }
        ];

        chartHtml = buildMonthlyBarsSvg(series, activeState.selectedIdx);

        const activeMonth = series[Math.max(0, Math.min(series.length - 1, activeState.selectedIdx))];
        const monthRefuels = activeMonth?.refuels || [];
        historyListHtml = monthRefuels.length > 0
            ? monthRefuels.map(r => `
                <div class="px-4 py-3 flex items-center justify-between gap-3">
                    <div class="min-w-0">
                        <div class="font-mono text-xs font-semibold text-[var(--text-primary)] uppercase tabular-nums">
                            ${formatDateShort(r.date)} · ${r.isFull ? 'TANQUEADA FULL' : 'RECARGA'}
                        </div>
                        <div class="font-mono text-[10px] text-[var(--text-secondary)] tabular-nums mt-0.5">
                            +${r.gals} GAL · ${r.odo.toLocaleString('es-CO')} KM
                        </div>
                    </div>
                    <div class="font-mono text-sm font-semibold tabular-nums text-[var(--text-primary)] shrink-0">
                        $${r.cost.toLocaleString('es-CO')}
                    </div>
                </div>
            `).join('')
            : `<div class="px-4 py-8 text-center font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">0 TANQUEADAS EN ${activeMonth?.ym || 'ESTE MES'}</div>`;
    } else if (type === 'usage' && usage) {
        heroTitle = 'RITMO DE USO Y RECORRIDO';
        heroValue = `${usage.displayKmDay}`;
        heroSub = `KM / DÍA (ÚLTIMOS 7 DÍAS · ${usage.kmLast7d} KM)`;
        deltaText = usage.delta?.text !== '—' ? `${usage.delta.text} VS MEDIA ${usage.baselineKmDay}` : 'RITMO BASE';
        deltaColor = getToneColorVar(usage.delta?.tone || 'neutral');

        summaryCells = [
            { label: 'HOY', value: `${usage.kmToday} KM`, tone: 'amber' },
            { label: 'ÚLT. 7 DÍAS', value: `${usage.kmLast7d} KM`, tone: 'volt' },
            { label: 'ESTE MES', value: `${usage.kmThisMonth.toLocaleString('es-CO')} KM`, tone: 'neutral' },
            { label: 'MEDIA DIARIA', value: `${usage.baselineKmDay} KM/D`, tone: 'neutral' }
        ];

        chartHtml = buildLineChartSvg(series, {
            valueKey: 'km',
            benchmarkVal: usage.baselineKmDay,
            benchmarkLabel: `MEDIA ${usage.baselineKmDay} KM/D`,
            accentColor: 'var(--accent-cyan)',
            selectedIdx: activeState.selectedIdx,
            unitSuffix: 'KM'
        });

        historyListHtml = [...series].filter(d => d.km > 0).reverse().slice(0, 15).map(d => `
            <div class="px-4 py-2.5 flex items-center justify-between gap-3">
                <div class="flex items-center gap-2">
                    <span class="w-1.5 h-1.5 rounded-full ${d.isGpsReal ? 'bg-[var(--accent-volt)]' : 'bg-[var(--line-strong)]'}"></span>
                    <span class="font-mono text-xs font-semibold text-[var(--text-primary)] uppercase tabular-nums">${d.label}</span>
                    <span class="font-mono text-[9px] text-[var(--text-secondary)] uppercase">${d.isGpsReal ? 'GPS' : 'EST'}</span>
                </div>
                <div class="font-mono text-xs font-semibold tabular-nums text-[var(--text-primary)]">${d.km.toFixed(1)} KM</div>
            </div>
        `).join('') || `<div class="px-4 py-8 text-center font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">0 KM REGISTRADOS EN ESTA VENTANA</div>`;
    }

    const usageWindowToggleHtml = type === 'usage' ? `
        <div class="flex items-center gap-1 font-mono text-[10px]">
            <button data-usage-win="7d" type="button" class="px-2.5 py-1 ${activeState.usageWindow === '7d' ? 'flat-pill-active' : 'flat-pill text-[var(--text-secondary)]'}">7D</button>
            <button data-usage-win="30d" type="button" class="px-2.5 py-1 ${activeState.usageWindow === '30d' ? 'flat-pill-active' : 'flat-pill text-[var(--text-secondary)]'}">30D</button>
        </div>
    ` : '';

    kpiModalRoot.innerHTML = `
        <div class="kpi-modal-backdrop fixed inset-0 bg-black/80 transition-opacity"></div>

        <div class="fixed inset-0 z-10 flex items-center justify-center sm:p-4">
            <div class="w-full h-[100dvh] sm:h-[92dvh] sm:max-w-3xl bg-[var(--bg-void)] sm:border sm:border-[var(--line-hair)] text-[var(--text-primary)] flex flex-col overflow-hidden">

                <!-- Header -->
                <header class="px-4 h-12 border-b border-[var(--line-hair)] bg-[var(--bg-surface)] flex items-center justify-between gap-2 shrink-0">
                    <div class="flex items-center gap-2 min-w-0">
                        <span class="w-2 h-2 shrink-0" style="background-color: ${deltaColor}"></span>
                        <span class="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-primary)] truncate">${heroTitle}</span>
                    </div>
                    <button id="kpi-detail-close-btn" type="button" class="w-8 h-8 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--line-hair)] transition-colors cursor-pointer shrink-0" aria-label="Cerrar">
                        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </header>

                <!-- 4-Tab Switcher -->
                <div class="grid grid-cols-4 divide-x divide-[var(--line-hair)] border-b border-[var(--line-hair)] bg-[var(--bg-surface)] shrink-0">
                    ${tabs.map(t => `
                        <button type="button" data-kpi-tab="${t.id}"
                            class="py-2.5 px-1 font-mono text-[9px] sm:text-[10px] uppercase tracking-[0.14em] transition-colors cursor-pointer truncate ${type === t.id ? 'bg-[var(--bg-void)] text-[var(--accent-amber)] font-semibold' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}">
                            ${t.label}
                        </button>
                    `).join('')}
                </div>

                <!-- Scrollable Instrument Body -->
                <div class="flex-1 overflow-y-auto divide-y divide-[var(--line-hair)] overscroll-contain">

                    <!-- Hero Readout -->
                    <div class="px-4 sm:px-6 py-4 sm:py-5 bg-[var(--bg-void)] flex flex-wrap items-end justify-between gap-3">
                        <div>
                            <div class="font-sans font-light text-4xl sm:text-5xl tracking-tighter tabular-nums leading-none text-[var(--text-primary)]">
                                ${heroValue}
                            </div>
                            <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-secondary)] mt-2">
                                ${heroSub}
                            </div>
                        </div>
                        <div class="text-right">
                            <span class="font-mono text-xs sm:text-sm font-semibold tabular-nums" style="color: ${deltaColor}">
                                ${deltaText}
                            </span>
                        </div>
                    </div>

                    <!-- 4-Cell Benchmark Strip -->
                    <div class="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-[var(--line-hair)] bg-[var(--bg-surface)]">
                        ${summaryCells.map(c => `
                            <div class="px-3.5 py-3">
                                <span class="block font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--text-secondary)] truncate">${c.label}</span>
                                <span class="block font-mono text-sm font-semibold tabular-nums mt-1 truncate" style="color: ${c.tone === 'neutral' ? 'var(--text-primary)' : getToneColorVar(c.tone)}">${c.value}</span>
                            </div>
                        `).join('')}
                    </div>

                    <!-- Interactive Timeline Chart -->
                    <div class="px-4 sm:px-6 py-4 bg-[var(--bg-void)] space-y-3">
                        <div class="flex items-center justify-between gap-2">
                            <span class="font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">
                                LÍNEA DE TIEMPO · TOCA PARA INSPECCIONAR
                            </span>
                            ${usageWindowToggleHtml}
                        </div>

                        <div id="kpi-inspect-hud" class="py-2 border-y border-[var(--line-hair)]">
                            ${renderInspectHud(series)}
                        </div>

                        <div id="kpi-chart-stage">
                            ${chartHtml}
                        </div>
                    </div>

                    <!-- Chronological Log List -->
                    <div class="bg-[var(--bg-surface)]">
                        <div class="px-4 py-2.5 border-b border-[var(--line-hair)] font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--text-secondary)] flex items-center justify-between">
                            <span>${type === 'monthly' ? 'TANQUEOS DEL MES SELECCIONADO' : (type === 'usage' ? 'DÍAS RECIENTES' : 'HISTORIAL POR CICLO')}</span>
                            <span class="tabular-nums">${series.length}</span>
                        </div>
                        <div id="kpi-history-list" class="divide-y divide-[var(--line-hair)]">
                            ${historyListHtml || `<div class="px-4 py-8 text-center font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">SIN REGISTROS</div>`}
                        </div>
                    </div>

                </div>
            </div>
        </div>
    `;

    bindModalEvents(series);
}

function updateChartInteractionInPlace(series) {
    if (!kpiModalRoot) return;
    const { type, efficiency, cost, usage } = activeState;

    const hud = kpiModalRoot.querySelector('#kpi-inspect-hud');
    if (hud) hud.innerHTML = renderInspectHud(series);

    const chartStage = kpiModalRoot.querySelector('#kpi-chart-stage');
    if (chartStage) {
        if (type === 'efficiency' && efficiency) {
            chartStage.innerHTML = buildLineChartSvg(series, {
                valueKey: 'value',
                benchmarkVal: efficiency.avgValue,
                benchmarkLabel: `MEDIA ${efficiency.avgFormatted}`,
                accentColor: 'var(--accent-volt)',
                selectedIdx: activeState.selectedIdx
            });
        } else if (type === 'cost' && cost) {
            chartStage.innerHTML = buildLineChartSvg(series, {
                valueKey: 'value',
                benchmarkVal: cost.avgCostPerKm,
                benchmarkLabel: `PROM $${cost.avgCostPerKm}`,
                accentColor: 'var(--accent-amber)',
                selectedIdx: activeState.selectedIdx,
                isCurrency: true
            });
        } else if (type === 'usage' && usage) {
            chartStage.innerHTML = buildLineChartSvg(series, {
                valueKey: 'km',
                benchmarkVal: usage.baselineKmDay,
                benchmarkLabel: `MEDIA ${usage.baselineKmDay} KM/D`,
                accentColor: 'var(--accent-cyan)',
                selectedIdx: activeState.selectedIdx,
                unitSuffix: 'KM'
            });
        } else if (type === 'monthly') {
            chartStage.innerHTML = buildMonthlyBarsSvg(series, activeState.selectedIdx);
            bindMonthlyBarTaps(series);
            const historyList = kpiModalRoot.querySelector('#kpi-history-list');
            if (historyList) {
                const activeMonth = series[Math.max(0, Math.min(series.length - 1, activeState.selectedIdx))];
                const monthRefuels = activeMonth?.refuels || [];
                historyList.innerHTML = monthRefuels.length > 0
                    ? monthRefuels.map(r => `
                        <div class="px-4 py-3 flex items-center justify-between gap-3">
                            <div class="min-w-0">
                                <div class="font-mono text-xs font-semibold text-[var(--text-primary)] uppercase tabular-nums">
                                    ${formatDateShort(r.date)} · ${r.isFull ? 'TANQUEADA FULL' : 'RECARGA'}
                                </div>
                                <div class="font-mono text-[10px] text-[var(--text-secondary)] tabular-nums mt-0.5">
                                    +${r.gals} GAL · ${r.odo.toLocaleString('es-CO')} KM
                                </div>
                            </div>
                            <div class="font-mono text-sm font-semibold tabular-nums text-[var(--text-primary)] shrink-0">
                                $${r.cost.toLocaleString('es-CO')}
                            </div>
                        </div>
                    `).join('')
                    : `<div class="px-4 py-8 text-center font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">0 TANQUEADAS EN ${activeMonth?.ym || 'ESTE MES'}</div>`;
            }
        }
    }
}

function bindMonthlyBarTaps(series) {
    if (!kpiModalRoot) return;
    kpiModalRoot.querySelectorAll('.kpi-month-bar').forEach(bar => {
        bar.addEventListener('click', () => {
            const idx = parseInt(bar.dataset.ptIdx, 10);
            if (!isNaN(idx) && idx !== activeState.selectedIdx) {
                playHorologyTick(1050, 0.012, 0.02);
                activeState.selectedIdx = idx;
                updateChartInteractionInPlace(series);
            }
        });
    });
}

function bindModalEvents(series) {
    if (!kpiModalRoot) return;

    kpiModalRoot.querySelector('#kpi-detail-close-btn')?.addEventListener('click', closeKpiDetailModal);
    kpiModalRoot.querySelector('.kpi-modal-backdrop')?.addEventListener('click', closeKpiDetailModal);

    kpiModalRoot.querySelectorAll('[data-kpi-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
            const nextType = btn.dataset.kpiTab;
            if (nextType && nextType !== activeState.type) {
                playHorologyTick(1100, 0.012, 0.025);
                activeState.type = nextType;
                resetSelectedIndexForType();
                renderModalContent();
            }
        });
    });

    kpiModalRoot.querySelectorAll('[data-usage-win]').forEach(btn => {
        btn.addEventListener('click', () => {
            const win = btn.dataset.usageWin;
            if (win && win !== activeState.usageWindow) {
                playHorologyTick(1050, 0.012, 0.02);
                activeState.usageWindow = win;
                resetSelectedIndexForType();
                renderModalContent();
            }
        });
    });

    // Interactive Scrubbing on persistent #kpi-chart-stage for smooth touch drag
    const chartStage = kpiModalRoot.querySelector('#kpi-chart-stage');
    if (chartStage && activeState.type !== 'monthly' && series.length > 0) {
        const updateFromPointer = (clientX) => {
            const rect = chartStage.getBoundingClientRect();
            if (!rect.width) return;
            const rel = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
            const nextIdx = series.length === 1 ? 0 : Math.round(rel * (series.length - 1));
            if (nextIdx !== activeState.selectedIdx) {
                activeState.selectedIdx = nextIdx;
                playHorologyTick(820 + nextIdx * 12, 0.008, 0.015);
                updateChartInteractionInPlace(series);
            }
        };

        chartStage.addEventListener('pointerdown', (e) => {
            try { chartStage.setPointerCapture(e.pointerId); } catch (_) {}
            updateFromPointer(e.clientX);
        });
        chartStage.addEventListener('pointermove', (e) => {
            if (e.buttons > 0 || e.pointerType === 'mouse' || e.pressure > 0) {
                updateFromPointer(e.clientX);
            }
        });
    }

    bindMonthlyBarTaps(series);
}
