/**
 * OCTANE // KINETIC — Minimal Interactive KPI Detail Modal ("modal-kpi-detail.js")
 *
 * Full-screen (100dvh mobile) Swiss timeline inspector with zero visual clutter:
 * - Tabs: RENDIMIENTO | COSTO / KM | GASTO MES | RITMO USO
 * - Compact Hero + Single Reference Anchor
 * - Large, high-legibility interactive SVG chart (scrubbing + monthly projected bar)
 * - Compact 1-line recent history (up to 6 entries)
 */

import { playHorologyTick } from '../../core/state.js';
import { formatDateShort } from '../../core/telemetry-engine.js';

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
    usageWindow: '30d'
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
 */
export function renderMiniSparklineSvg(values = [], strokeColor = 'var(--accent-volt)') {
    if (!Array.isArray(values) || values.length < 2) return '';
    const clean = values.map(v => Number(v)).filter(v => Number.isFinite(v));
    if (clean.length < 2) return '';

    const w = 64;
    const h = 20;
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
    const lastPt = coords[coords.length - 1];

    return `
        <svg viewBox="0 0 ${w} ${h}" class="w-12 sm:w-14 h-5 shrink-0 overflow-visible" preserveAspectRatio="none" aria-hidden="true">
            <path d="${linePath}" fill="none" stroke="${strokeColor}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.85" />
            <circle cx="${lastPt.x}" cy="${lastPt.y}" r="2" fill="${strokeColor}" />
        </svg>
    `;
}

/**
 * Resolves CSS color token for a semantic trend tone.
 */
export function getToneColorVar(tone) {
    if (tone === 'volt') return 'var(--accent-volt)';
    if (tone === 'crimson') return 'var(--accent-crimson)';
    if (tone === 'amber') return 'var(--accent-amber)';
    if (tone === 'cyan') return 'var(--accent-cyan)';
    return 'var(--text-secondary)';
}

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
        isCurrency = false
    } = options;

    if (!Array.isArray(points) || points.length === 0) {
        return `
            <div class="h-52 sm:h-60 flex items-center justify-center font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">
                SIN HISTORIAL
            </div>
        `;
    }

    const w = 500;
    const h = 210;
    const padL = 8;
    const padR = 8;
    const padT = 24;
    const padB = 28;
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
            : `${gVal >= 100 ? Math.round(gVal) : gVal.toFixed(1)}`;
        return `
            <line x1="${padL}" y1="${gy}" x2="${w - padR}" y2="${gy}" stroke="var(--line-hair)" stroke-width="1" />
            <text x="${padL + 2}" y="${gy - 5}" fill="var(--text-muted)" font-family="JetBrains Mono, monospace" font-size="11">${txt}</text>
        `;
    }).join('');

    let benchHtml = '';
    if (benchmarkVal !== null && Number.isFinite(benchmarkVal) && benchmarkVal > 0) {
        const by = Number(toY(benchmarkVal).toFixed(1));
        benchHtml = `
            <line x1="${padL}" y1="${by}" x2="${w - padR}" y2="${by}" stroke="var(--text-secondary)" stroke-width="1" stroke-dasharray="4 4" opacity="0.6" />
            <text x="${w - padR - 2}" y="${by - 5}" text-anchor="end" fill="var(--text-secondary)" font-family="JetBrains Mono, monospace" font-size="11">${benchmarkLabel}</text>
        `;
    }

    const activeCoord = coords[Math.max(0, Math.min(coords.length - 1, selectedIdx))];
    const xLabelStep = Math.max(1, Math.ceil(coords.length / 4));

    const xAxisLabels = coords
        .filter((_, idx) => idx === 0 || idx === coords.length - 1 || idx % xLabelStep === 0)
        .map(c => `<text x="${c.x}" y="${h - 6}" text-anchor="${c.idx === 0 ? 'start' : (c.idx === coords.length - 1 ? 'end' : 'middle')}" fill="var(--text-secondary)" font-family="JetBrains Mono, monospace" font-size="11">${c.label}</text>`)
        .join('');

    const showAllDots = coords.length <= 16;
    const dotsHtml = coords.map(c => {
        const isSel = c.idx === activeCoord.idx;
        if (!showAllDots && !isSel) return '';
        return `
            <circle cx="${c.x}" cy="${c.y}" r="${isSel ? 5 : 2.6}"
                fill="${isSel ? accentColor : 'var(--bg-void)'}"
                stroke="${accentColor}" stroke-width="${isSel ? 2 : 1.5}" />
        `;
    }).join('');

    return `
        <div class="relative w-full">
            <svg id="kpi-timeline-svg" viewBox="0 0 ${w} ${h}" class="w-full h-52 sm:h-60 touch-none cursor-crosshair select-none overflow-visible">
                <defs>
                    <linearGradient id="kpiAreaGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="${accentColor}" stop-opacity="0.22" />
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
            <div class="h-52 sm:h-60 flex items-center justify-center font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">
                SIN REGISTROS
            </div>
        `;
    }

    const w = 500;
    const h = 215;
    const padL = 10;
    const padR = 10;
    const padT = 30;
    const padB = 30;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    const maxVal = Math.max(...series.map(m => Math.max(m.value || 0, m.projectedCop || 0)), 50000);
    const colW = plotW / series.length;
    const barW = Math.min(46, Math.max(20, colW * 0.56));

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
                        stroke="var(--accent-amber)" stroke-width="1.4" stroke-dasharray="4 3" />
                ` : ''}
                <rect x="${bx}" y="${actualY}" width="${barW}" height="${actualH}"
                    fill="${actualColor}" fill-opacity="${isSel ? '0.95' : '0.75'}" />
                ${isSel ? `
                    <rect x="${bx - 3}" y="${baseY + 2}" width="${barW + 6}" height="2.5" fill="var(--accent-amber)" />
                ` : ''}
                <text x="${cx}" y="${Math.max(15, projY - 8)}" text-anchor="middle"
                    fill="${m.isCurrent ? 'var(--accent-amber)' : (isSel ? 'var(--text-primary)' : 'var(--text-secondary)')}"
                    font-family="JetBrains Mono, monospace" font-size="12.5" font-weight="${isSel ? '700' : '500'}">
                    ${topLabel}
                </text>
                <text x="${cx}" y="${h - 7}" text-anchor="middle"
                    fill="${isSel ? 'var(--text-primary)' : 'var(--text-secondary)'}"
                    font-family="JetBrains Mono, monospace" font-size="12.5" font-weight="${isSel ? '700' : '500'}">
                    ${m.label}${m.isCurrent ? '•' : ''}
                </text>
            </g>
        `;
    }).join('');

    return `
        <div class="relative w-full">
            <svg id="kpi-monthly-svg" viewBox="0 0 ${w} ${h}" class="w-full h-52 sm:h-60 select-none overflow-visible">
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
        return `<div class="font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">SIN DATOS</div>`;
    }

    if (activeState.type === 'efficiency') {
        const dTxt = pt.delta ? pt.delta.text : '';
        const dColor = pt.delta ? getToneColorVar(pt.delta.tone) : 'var(--text-secondary)';
        return `
            <div class="flex items-center justify-between gap-2">
                <div class="flex items-baseline gap-2.5">
                    <span class="font-sans font-light text-2xl tracking-tight tabular-nums text-[var(--text-primary)]">${pt.formatted}</span>
                    ${dTxt ? `<span class="font-mono text-[11px] font-semibold tabular-nums" style="color: ${dColor}">${dTxt}</span>` : ''}
                </div>
                <span class="font-mono text-[10px] uppercase tracking-wider text-[var(--text-secondary)] tabular-nums">${pt.label} · +${pt.dist} KM</span>
            </div>
        `;
    }

    if (activeState.type === 'cost') {
        const dTxt = pt.delta ? pt.delta.text : '';
        const dColor = pt.delta ? getToneColorVar(pt.delta.tone) : 'var(--text-secondary)';
        return `
            <div class="flex items-center justify-between gap-2">
                <div class="flex items-baseline gap-2.5">
                    <span class="font-sans font-light text-2xl tracking-tight tabular-nums text-[var(--text-primary)]">${pt.formatted}/KM</span>
                    ${dTxt ? `<span class="font-mono text-[11px] font-semibold tabular-nums" style="color: ${dColor}">${dTxt}</span>` : ''}
                </div>
                <span class="font-mono text-[10px] uppercase tracking-wider text-[var(--text-secondary)] tabular-nums">${pt.label} · GAL $${Math.round(pt.pricePerGal / 1000)}K</span>
            </div>
        `;
    }

    if (activeState.type === 'monthly') {
        return `
            <div class="flex items-center justify-between gap-2">
                <div class="flex items-baseline gap-2.5">
                    <span class="font-sans font-light text-2xl tracking-tight tabular-nums text-[var(--text-primary)]">$${pt.value.toLocaleString('es-CO')}</span>
                    ${pt.isCurrent && pt.projectedCop > pt.value ? `<span class="font-mono text-[11px] font-semibold text-[var(--accent-amber)] tabular-nums">PROY ~$${Math.round(pt.projectedCop / 1000)}K</span>` : ''}
                </div>
                <span class="font-mono text-[10px] uppercase tracking-wider text-[var(--text-secondary)] tabular-nums">${pt.label} · ${pt.gallons} GAL</span>
            </div>
        `;
    }

    return `
        <div class="flex items-center justify-between gap-2">
            <div class="flex items-baseline gap-2.5">
                <span class="font-sans font-light text-2xl tracking-tight tabular-nums text-[var(--text-primary)]">${pt.km.toFixed(1)} KM</span>
            </div>
            <span class="font-mono text-[10px] uppercase tracking-wider text-[var(--text-secondary)] tabular-nums">${pt.date}</span>
        </div>
    `;
}

function buildCompactHistoryList(type, series) {
    if (type === 'efficiency') {
        return [...series].reverse().slice(0, 6).map(c => `
            <div class="px-4 py-2.5 flex items-center justify-between gap-3">
                <span class="font-mono text-xs text-[var(--text-secondary)] uppercase tabular-nums">${formatDateShort(c.startDate)} – ${c.label}</span>
                <div class="flex items-center gap-3 shrink-0">
                    ${c.delta ? `<span class="font-mono text-[10px] font-semibold tabular-nums" style="color: ${getToneColorVar(c.delta.tone)}">${c.delta.text}</span>` : ''}
                    <span class="font-mono text-xs font-semibold tabular-nums text-[var(--text-primary)]">${c.formatted}</span>
                </div>
            </div>
        `).join('');
    }

    if (type === 'cost') {
        return [...series].reverse().slice(0, 6).map(c => `
            <div class="px-4 py-2.5 flex items-center justify-between gap-3">
                <span class="font-mono text-xs text-[var(--text-secondary)] uppercase tabular-nums">${c.label} · GAL $${Math.round(c.pricePerGal / 1000)}K</span>
                <div class="flex items-center gap-3 shrink-0">
                    ${c.delta ? `<span class="font-mono text-[10px] font-semibold tabular-nums" style="color: ${getToneColorVar(c.delta.tone)}">${c.delta.text}</span>` : ''}
                    <span class="font-mono text-xs font-semibold tabular-nums text-[var(--text-primary)]">${c.formatted}/KM</span>
                </div>
            </div>
        `).join('');
    }

    if (type === 'monthly') {
        const activeMonth = series[Math.max(0, Math.min(series.length - 1, activeState.selectedIdx))];
        const refuels = (activeMonth?.refuels || []).slice(0, 6);
        return refuels.length > 0
            ? refuels.map(r => `
                <div class="px-4 py-2.5 flex items-center justify-between gap-3">
                    <span class="font-mono text-xs text-[var(--text-secondary)] uppercase tabular-nums">${formatDateShort(r.date)} · +${r.gals} GAL</span>
                    <span class="font-mono text-xs font-semibold tabular-nums text-[var(--text-primary)]">$${r.cost.toLocaleString('es-CO')}</span>
                </div>
            `).join('')
            : `<div class="px-4 py-6 text-center font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">SIN TANQUEOS EN ${activeMonth?.label || 'ESTE MES'}</div>`;
    }

    const recentDays = [...series].filter(d => d.km > 0).reverse().slice(0, 6);
    return recentDays.length > 0
        ? recentDays.map(d => `
            <div class="px-4 py-2.5 flex items-center justify-between gap-3">
                <span class="font-mono text-xs text-[var(--text-secondary)] uppercase tabular-nums">${d.label}</span>
                <span class="font-mono text-xs font-semibold tabular-nums text-[var(--text-primary)]">${d.km.toFixed(1)} KM</span>
            </div>
        `).join('')
        : `<div class="px-4 py-6 text-center font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">0 KM REGISTRADOS</div>`;
}

function renderModalContent() {
    if (!kpiModalRoot) return;

    const { type, efficiency, cost, monthly, usage } = activeState;
    const tabs = [
        { id: 'efficiency', label: 'RENDIMIENTO' },
        { id: 'cost', label: 'COSTO / KM' },
        { id: 'monthly', label: 'GASTO MES' },
        { id: 'usage', label: 'RITMO USO' }
    ];

    let heroValue = '—';
    let heroSub = '';
    let anchorRight = '';
    let deltaText = '';
    let deltaColor = 'var(--text-secondary)';
    let chartHtml = '';
    const series = getActiveSeries();

    if (type === 'efficiency' && efficiency) {
        heroValue = efficiency.heroFormatted;
        heroSub = efficiency.unitLabel;
        anchorRight = `MEDIA ${efficiency.avgFormatted}`;
        deltaText = efficiency.delta?.text !== '—' ? efficiency.delta.text : '';
        deltaColor = getToneColorVar(efficiency.delta?.tone || 'neutral');

        chartHtml = buildLineChartSvg(series, {
            valueKey: 'value',
            benchmarkVal: efficiency.avgValue,
            benchmarkLabel: `MEDIA ${efficiency.avgValue}`,
            accentColor: 'var(--accent-volt)',
            selectedIdx: activeState.selectedIdx
        });
    } else if (type === 'cost' && cost) {
        heroValue = cost.currentCostPerKm > 0 ? `$${cost.currentCostPerKm.toLocaleString('es-CO')}` : '—';
        heroSub = 'COP / KM';
        anchorRight = `PROM $${cost.avgCostPerKm}`;
        deltaText = cost.delta?.text !== '—' ? cost.delta.text : '';
        deltaColor = getToneColorVar(cost.delta?.tone || 'neutral');

        chartHtml = buildLineChartSvg(series, {
            valueKey: 'value',
            benchmarkVal: cost.avgCostPerKm,
            benchmarkLabel: `PROM $${cost.avgCostPerKm}`,
            accentColor: 'var(--accent-amber)',
            selectedIdx: activeState.selectedIdx,
            isCurrency: true
        });
    } else if (type === 'monthly' && monthly) {
        heroValue = `$${monthly.currentMonthSpent.toLocaleString('es-CO')}`;
        heroSub = `LLEVADO · DÍA ${monthly.dayOfMonth}/${monthly.daysInMonth}`;
        anchorRight = monthly.projectedMonthSpent > 0 ? `PROY ~$${Math.round(monthly.projectedMonthSpent / 1000)}K` : '';
        deltaText = monthly.delta?.text !== '—' ? monthly.delta.text : '';
        deltaColor = getToneColorVar(monthly.delta?.tone || 'neutral');

        chartHtml = buildMonthlyBarsSvg(series, activeState.selectedIdx);
    } else if (type === 'usage' && usage) {
        heroValue = `${usage.displayKmDay}`;
        heroSub = 'KM / DÍA · ÚLT. 7D';
        anchorRight = `MEDIA ${usage.baselineKmDay} KM/D`;
        deltaText = usage.delta?.text !== '—' ? usage.delta.text : '';
        deltaColor = getToneColorVar(usage.delta?.tone || 'neutral');

        chartHtml = buildLineChartSvg(series, {
            valueKey: 'km',
            benchmarkVal: usage.baselineKmDay,
            benchmarkLabel: `MEDIA ${usage.baselineKmDay}`,
            accentColor: 'var(--accent-cyan)',
            selectedIdx: activeState.selectedIdx
        });
    }

    const historyListHtml = buildCompactHistoryList(type, series);

    const usageWindowToggleHtml = type === 'usage' ? `
        <div class="flex items-center gap-1 font-mono text-[10px]">
            <button data-usage-win="7d" type="button" class="px-2.5 py-1 ${activeState.usageWindow === '7d' ? 'flat-pill-active' : 'flat-pill text-[var(--text-secondary)]'}">7D</button>
            <button data-usage-win="30d" type="button" class="px-2.5 py-1 ${activeState.usageWindow === '30d' ? 'flat-pill-active' : 'flat-pill text-[var(--text-secondary)]'}">30D</button>
        </div>
    ` : '';

    const monthlyTax = (type === 'monthly' && monthly?.invisibleTax?.hasData) ? monthly.invisibleTax : null;
    const monthlyRemCop = (type === 'monthly' && monthly?.calendarRemainingCostCop > 0) ? monthly.calendarRemainingCostCop : 0;
    const monthlyPhysicsHtml = (type === 'monthly' && (monthlyTax || monthlyRemCop > 0)) ? `
        <div class="bg-[var(--bg-void)] divide-y divide-[var(--line-hair)] font-mono text-xs">
            ${monthlyTax ? `
                <div class="px-4 py-2.5 space-y-2">
                    <div class="flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-[var(--text-secondary)]">
                        <span>DESGLOSE DEL GASTO</span>
                        <span class="tabular-nums">${monthlyTax.totalGallons} GAL</span>
                    </div>
                    <div class="h-1 w-full flex overflow-hidden bg-[var(--line-hair)]">
                        <div style="width: ${monthlyTax.pctBase}%; background-color: #3F3F46;"></div>
                        <div style="width: ${monthlyTax.pctTraffic}%; background-color: var(--accent-amber);"></div>
                        <div style="width: ${monthlyTax.pctIdle}%; background-color: var(--accent-cyan);"></div>
                        <div style="width: ${monthlyTax.pctDynamicsCold}%; background-color: var(--accent-crimson);"></div>
                    </div>
                </div>
                <div class="px-4 py-2 flex items-center justify-between gap-3">
                    <span class="text-[11px] text-[var(--text-secondary)] uppercase">BASE · ${monthlyTax.pctBase}%</span>
                    <span class="text-xs font-semibold tabular-nums text-[var(--text-primary)]">$${monthlyTax.baseCop.toLocaleString('es-CO')}</span>
                </div>
                <div class="px-4 py-2 flex items-center justify-between gap-3">
                    <span class="text-[11px] text-[var(--accent-amber)] uppercase">TRANCÓN · ${monthlyTax.pctTraffic}%</span>
                    <span class="text-xs font-semibold tabular-nums text-[var(--text-primary)]">$${monthlyTax.trafficCop.toLocaleString('es-CO')}</span>
                </div>
                <div class="px-4 py-2 flex items-center justify-between gap-3">
                    <span class="text-[11px] text-[var(--accent-cyan)] uppercase">RALENTÍ · ${monthlyTax.pctIdle}%</span>
                    <span class="text-xs font-semibold tabular-nums text-[var(--text-primary)]">$${monthlyTax.idleCop.toLocaleString('es-CO')}</span>
                </div>
                <div class="px-4 py-2 flex items-center justify-between gap-3">
                    <span class="text-[11px] text-[var(--accent-crimson)] uppercase">FRÍO / DIN · ${monthlyTax.pctDynamicsCold}%</span>
                    <span class="text-xs font-semibold tabular-nums text-[var(--text-primary)]">$${monthlyTax.dynamicsColdCop.toLocaleString('es-CO')}</span>
                </div>
            ` : ''}
            ${monthlyRemCop > 0 ? `
                <div class="px-4 py-2.5 flex items-center justify-between gap-3 bg-[var(--bg-surface)]">
                    <span class="text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">RESTANTE CALENDARIO · ~${monthly.remainingDays} ${monthly.remainingDays === 1 ? 'DÍA' : 'DÍAS'}</span>
                    <span class="text-xs font-semibold tabular-nums text-[var(--accent-amber)]">+$${monthlyRemCop.toLocaleString('es-CO')}</span>
                </div>
            ` : ''}
        </div>
    ` : '';

    kpiModalRoot.innerHTML = `
        <div class="kpi-modal-backdrop fixed inset-0 bg-black/80 transition-opacity"></div>

        <div class="fixed inset-0 z-10 flex items-center justify-center sm:p-4">
            <div class="w-full h-[100dvh] sm:h-[88dvh] sm:max-w-2xl bg-[var(--bg-void)] sm:border sm:border-[var(--line-hair)] text-[var(--text-primary)] flex flex-col overflow-hidden">

                <!-- 4 Tabs + Close -->
                <header class="border-b border-[var(--line-hair)] bg-[var(--bg-surface)] flex items-stretch shrink-0">
                    <div class="flex-1 grid grid-cols-4 divide-x divide-[var(--line-hair)]">
                        ${tabs.map(t => `
                            <button type="button" data-kpi-tab="${t.id}"
                                class="py-3 px-1 font-mono text-[9px] sm:text-[10px] uppercase tracking-[0.14em] transition-colors cursor-pointer truncate ${type === t.id ? 'bg-[var(--bg-void)] text-[var(--accent-amber)] font-semibold' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}">
                                ${t.label}
                            </button>
                        `).join('')}
                    </div>
                    <button id="kpi-detail-close-btn" type="button" class="w-11 border-l border-[var(--line-hair)] flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--line-hair)] transition-colors cursor-pointer shrink-0" aria-label="Cerrar">
                        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </header>

                <!-- Scrollable Minimal Body -->
                <div class="flex-1 overflow-y-auto divide-y divide-[var(--line-hair)] overscroll-contain">

                    <!-- Hero Readout -->
                    <div class="px-5 py-5 bg-[var(--bg-void)] flex items-end justify-between gap-3">
                        <div>
                            <div class="flex items-baseline gap-2.5">
                                <span class="font-sans font-light text-4xl sm:text-5xl tracking-tighter tabular-nums leading-none text-[var(--text-primary)]">${heroValue}</span>
                                ${deltaText ? `<span class="font-mono text-xs font-semibold tabular-nums" style="color: ${deltaColor}">${deltaText}</span>` : ''}
                            </div>
                            <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-secondary)] mt-2">
                                ${heroSub}
                            </div>
                        </div>
                        <div class="flex flex-col items-end gap-2 shrink-0">
                            ${usageWindowToggleHtml}
                            ${anchorRight ? `<span class="font-mono text-[11px] font-medium uppercase tracking-wider text-[var(--accent-amber)] tabular-nums">${anchorRight}</span>` : ''}
                        </div>
                    </div>

                    <!-- Interactive Chart -->
                    <div class="px-4 sm:px-6 py-4 bg-[var(--bg-void)] space-y-3">
                        <div id="kpi-inspect-hud" class="pb-2 border-b border-[var(--line-hair)]">
                            ${renderInspectHud(series)}
                        </div>
                        <div id="kpi-chart-stage">
                            ${chartHtml}
                        </div>
                    </div>

                    <!-- Recent History (Max 6 compact rows) -->
                    <div id="kpi-history-list" class="bg-[var(--bg-surface)] divide-y divide-[var(--line-hair)]">
                        ${historyListHtml || `<div class="px-4 py-6 text-center font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">SIN REGISTROS</div>`}
                    </div>
                    ${monthlyPhysicsHtml}

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
                benchmarkLabel: `MEDIA ${efficiency.avgValue}`,
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
                benchmarkLabel: `MEDIA ${usage.baselineKmDay}`,
                accentColor: 'var(--accent-cyan)',
                selectedIdx: activeState.selectedIdx
            });
        } else if (type === 'monthly') {
            chartStage.innerHTML = buildMonthlyBarsSvg(series, activeState.selectedIdx);
            bindMonthlyBarTaps(series);
            const historyList = kpiModalRoot.querySelector('#kpi-history-list');
            if (historyList) {
                historyList.innerHTML = buildCompactHistoryList('monthly', series);
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
