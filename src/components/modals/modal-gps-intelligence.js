/**
 * OCTANE // KINETIC — Full-Screen GPS Intelligence Detail Modal ("modal-gps-intelligence.js")
 *
 * Progressive-disclosure 100dvh inspector housing deep automotive telemetry cleanly
 * across 3 uncluttered tabs: COMBUSTIBLE | SALUD | RUTAS.
 *
 * Strict Dieter Rams / Swiss Horology compliance:
 * - Zero <p> HTML tags
 * - Zero nested boxes (flat sections separated by hairline dividers)
 * - Zero technical jargon in user-facing labels
 * - Zero decorative prefixes
 */

import { store, playHorologyTick } from '../../core/state.js';
import { computeMonthlyFuelMetrics } from '../../core/cockpit-analytics.js';
import { analyzeElectricalHealth, computePhysicalWear } from '../../core/vehicle-health-engine.js';
import {
  detectSemanticPlaces,
  computeStationHonestyIndex,
  analyzeOptimalDeparture,
  computeParkingSentinel
} from '../../core/geospatial-intelligence.js';

const ROOT_ID = 'octane-gps-intelligence-modal';
const VALID_TABS = ['fuel', 'health', 'routes'];

let modalRoot = null;
let listenersBound = false;
let activeTab = 'fuel';
let activeFuelScope = 'cycle'; // 'cycle' | 'month'
let activeCycleIndex = null; // null | 'active' | number

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toneColorVar(tone) {
  if (tone === 'volt') return 'var(--accent-volt)';
  if (tone === 'amber') return 'var(--accent-amber)';
  if (tone === 'crimson') return 'var(--accent-crimson)';
  if (tone === 'cyan') return 'var(--accent-cyan)';
  return 'var(--text-secondary)';
}

function resolveCurrentOdo(logs = [], profile = null) {
  const liveOdo = Number(profile?.gpsCache?.live?.totalMile) || 0;
  if (!Array.isArray(logs) || logs.length === 0) return liveOdo;
  const maxLog = logs.reduce((acc, l) => {
    const odo = Number(l?.odometer_reading) || 0;
    return odo > acc ? odo : acc;
  }, 0);
  return Math.max(maxLog, liveOdo);
}

function ensureModalRoot() {
  if (typeof document === 'undefined') return null;
  const existing = document.getElementById(ROOT_ID);
  if (existing) {
    modalRoot = existing;
    return modalRoot;
  }

  modalRoot = document.createElement('div');
  modalRoot.id = ROOT_ID;
  modalRoot.className = 'fixed inset-0 z-50 hidden select-none';
  document.body.appendChild(modalRoot);
  return modalRoot;
}

/**
 * Initializes global listeners for the GPS Intelligence detail modal.
 */
export function initGpsIntelligenceModal() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  ensureModalRoot();

  if (listenersBound) return;
  listenersBound = true;

  window.addEventListener('octane:open-gps-intelligence', (e) => {
    openGpsIntelligenceModal(e.detail || {});
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalRoot && !modalRoot.classList.contains('hidden')) {
      closeGpsIntelligenceModal();
    }
  });
}

/**
 * Opens the full-screen GPS Intelligence detail modal on the requested tab.
 *
 * @param {Object} [options={}] - { tab: 'fuel' | 'health' | 'routes', fuelScope?: 'cycle' | 'month' }
 */
export function openGpsIntelligenceModal(options = { tab: 'fuel' }) {
  const root = ensureModalRoot();
  if (!root) return;

  playHorologyTick(1220, 0.014, 0.028);

  const reqTab = options?.tab;
  activeTab = VALID_TABS.includes(reqTab) ? reqTab : 'fuel';
  if (options?.fuelScope === 'cycle' || options?.fuelScope === 'month') {
    activeFuelScope = options.fuelScope;
  } else {
    activeFuelScope = 'cycle';
  }
  activeCycleIndex = (options?.cycleIndex !== undefined && options?.cycleIndex !== null)
    ? options.cycleIndex
    : null;

  root.classList.remove('hidden');
  renderModal();
}

/**
 * Closes and clears the GPS Intelligence detail modal.
 */
export function closeGpsIntelligenceModal() {
  if (modalRoot && !modalRoot.classList.contains('hidden')) {
    playHorologyTick(850, 0.012, 0.02);
    modalRoot.classList.add('hidden');
    modalRoot.innerHTML = '';
  }
}

function buildVoltageSparklineSvg(series = [], strokeColor = 'var(--accent-volt)') {
  const clean = Array.isArray(series)
    ? series.filter(pt => pt && Number.isFinite(Number(pt.v)) && Number(pt.v) > 0)
    : [];

  if (clean.length < 2) {
    return `
      <div class="h-28 flex items-center justify-center font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
        RECOPILANDO HISTORIAL DE VOLTAJE
      </div>
    `;
  }

  const w = 500;
  const h = 112;
  const padL = 6;
  const padR = 6;
  const padT = 16;
  const padB = 18;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const vals = clean.map(p => Number(p.v));
  const minRaw = Math.min(...vals, 12.1);
  const maxRaw = Math.max(...vals, 12.8);
  const minV = Math.max(10.5, minRaw - 0.15);
  const maxV = maxRaw + 0.15;
  const span = maxV - minV || 1;

  const toX = (idx) => padL + (idx / (clean.length - 1)) * plotW;
  const toY = (v) => padT + plotH - ((v - minV) / span) * plotH;

  const coords = clean.map((p, idx) => ({
    x: Number(toX(idx).toFixed(1)),
    y: Number(toY(Number(p.v)).toFixed(1)),
    v: Number(p.v),
    date: p.date || ''
  }));

  const pathD = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ');
  const areaD = `${pathD} L ${coords[coords.length - 1].x} ${padT + plotH} L ${coords[0].x} ${padT + plotH} Z`;
  const ref124Y = Number(toY(12.4).toFixed(1));
  const last = coords[coords.length - 1];
  const minPointV = Math.min(...vals);
  const maxPointV = Math.max(...vals);

  return `
    <svg viewBox="0 0 ${w} ${h}" class="w-full h-28 overflow-visible select-none" aria-hidden="true">
      <defs>
        <linearGradient id="intelVoltGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${strokeColor}" stop-opacity="0.22" />
          <stop offset="100%" stop-color="${strokeColor}" stop-opacity="0.01" />
        </linearGradient>
      </defs>
      <line x1="${padL}" y1="${ref124Y}" x2="${w - padR}" y2="${ref124Y}" stroke="var(--line-strong)" stroke-width="1" stroke-dasharray="4 4" />
      <text x="${w - padR}" y="${ref124Y - 4}" text-anchor="end" fill="var(--text-muted)" font-family="JetBrains Mono, monospace" font-size="10">12.4V REF</text>
      <text x="${padL}" y="${padT - 3}" fill="var(--text-muted)" font-family="JetBrains Mono, monospace" font-size="10">MÁX ${maxPointV.toFixed(2)}V</text>
      <text x="${padL}" y="${h - 2}" fill="var(--text-muted)" font-family="JetBrains Mono, monospace" font-size="10">MÍN ${minPointV.toFixed(2)}V</text>
      <path d="${areaD}" fill="url(#intelVoltGrad)" />
      <path d="${pathD}" fill="none" stroke="${strokeColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      <circle cx="${last.x}" cy="${last.y}" r="3.5" fill="${strokeColor}" />
    </svg>
  `;
}

function renderFuelTab(state) {
  const model = state.telemetryEngineResults || null;
  const profile = state.vehicleProfile || {};
  const logs = Array.isArray(state.telemetryLogs) ? state.telemetryLogs : [];
  const fuelPriceCop = Number(profile.fuelPriceCop || state.fuelPriceCop) || 16000;

  const closedCycles = Array.isArray(model?.allCycles)
    ? model.allCycles
    : (Array.isArray(model?.fullEraCycles) ? model.fullEraCycles : []);
  const latestClosed = closedCycles.length > 0 ? closedCycles[closedCycles.length - 1] : null;
  const requestedClosed = typeof activeCycleIndex === 'number'
    ? closedCycles.find(c => c.cycleIndex === activeCycleIndex) || null
    : null;

  let cyclePhys = null;
  let cycleScopeLabel = 'CICLO ACTIVO';
  if (requestedClosed) {
    cyclePhys = requestedClosed.physicalTelemetry || null;
    cycleScopeLabel = `CICLO #${requestedClosed.cycleIndex}`;
  } else if (model?.activeTankState?.physicalTelemetry) {
    cyclePhys = model.activeTankState.physicalTelemetry;
    cycleScopeLabel = 'CICLO ACTIVO';
  } else if (latestClosed?.physicalTelemetry) {
    cyclePhys = latestClosed.physicalTelemetry;
    cycleScopeLabel = `CICLO #${latestClosed.cycleIndex}`;
  }
  const cycleTax = cyclePhys?.invisibleTax?.hasData ? cyclePhys.invisibleTax : null;

  const monthly = computeMonthlyFuelMetrics(logs, model, fuelPriceCop, new Date(), profile);
  const monthTax = monthly?.invisibleTax?.hasData ? monthly.invisibleTax : null;

  const hasBoth = Boolean(cycleTax && monthTax);
  let selectedScope = activeFuelScope;
  if (selectedScope === 'cycle' && !cycleTax && monthTax) selectedScope = 'month';
  if (selectedScope === 'month' && !monthTax && cycleTax) selectedScope = 'cycle';

  const tax = selectedScope === 'month' ? monthTax : cycleTax;
  const scopeTitle = selectedScope === 'month' ? 'MES ACTUAL' : cycleScopeLabel;

  const physicsModel = model?.fuelPhysicsModel || null;
  const isCalibrated = physicsModel?.mode === 'ridge';
  const eligibleCount = Number(physicsModel?.eligibleCount) || 0;
  const anomaly = physicsModel?.anomalyAlert || null;

  const buckets = tax ? [
    { label: 'CONDUCCIÓN BASE', pct: tax.pctBase, cop: tax.baseCop, dotColor: 'var(--text-muted)' },
    { label: 'TRANCÓN', pct: tax.pctTraffic, cop: tax.trafficCop, dotColor: 'var(--accent-amber)' },
    { label: 'RALENTÍ', pct: tax.pctIdle, cop: tax.idleCop, dotColor: 'var(--accent-cyan)' },
    { label: 'FRÍO Y DINÁMICA', pct: tax.pctDynamicsCold, cop: tax.dynamicsColdCop, dotColor: 'var(--accent-crimson)' }
  ] : [];

  return `
    <!-- Hero Fuel Breakdown -->
    <div class="px-5 py-6 bg-[var(--bg-void)] space-y-4">
      <div class="flex items-center justify-between gap-3">
        <span class="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-secondary)]">
          DESGLOSE · ${scopeTitle}
        </span>
        ${hasBoth ? `
          <div class="flex items-center gap-1 font-mono text-[10px]">
            <button type="button" data-fuel-scope="cycle" class="px-2.5 py-1 cursor-pointer ${selectedScope === 'cycle' ? 'flat-pill-active' : 'flat-pill text-[var(--text-secondary)]'}">CICLO</button>
            <button type="button" data-fuel-scope="month" class="px-2.5 py-1 cursor-pointer ${selectedScope === 'month' ? 'flat-pill-active' : 'flat-pill text-[var(--text-secondary)]'}">MES</button>
          </div>
        ` : ''}
      </div>

      ${tax ? `
        <div class="flex items-baseline justify-between gap-3">
          <strong class="font-sans font-light text-4xl sm:text-5xl tracking-tighter tabular-nums leading-none text-[var(--text-primary)]">
            $${tax.totalCostCop.toLocaleString('es-CO')}
          </strong>
          <span class="font-mono text-xs uppercase tracking-wider text-[var(--text-secondary)] tabular-nums">
            ${tax.totalGallons} GAL
          </span>
        </div>

        <div class="h-1 w-full flex overflow-hidden bg-[var(--line-hair)]">
          <div style="width: ${tax.pctBase}%; background-color: var(--text-muted);"></div>
          <div style="width: ${tax.pctTraffic}%; background-color: var(--accent-amber);"></div>
          <div style="width: ${tax.pctIdle}%; background-color: var(--accent-cyan);"></div>
          <div style="width: ${tax.pctDynamicsCold}%; background-color: var(--accent-crimson);"></div>
        </div>
      ` : `
        <div class="py-4 font-mono text-xs uppercase tracking-[0.16em] text-[var(--text-secondary)]">
          SIN TELEMETRÍA GPS SUFICIENTE EN ESTE PERIODO
        </div>
      `}
    </div>

    ${tax ? `
      <!-- 4 Spacious Breakdown Rows -->
      <div class="bg-[var(--bg-surface)] divide-y divide-[var(--line-hair)] font-mono">
        ${buckets.map(b => `
          <div class="px-5 py-3.5 flex items-center justify-between gap-4">
            <div class="flex items-center gap-2.5 min-w-0">
              <span class="w-2 h-2 rounded-full shrink-0" style="background-color: ${b.dotColor}"></span>
              <span class="text-xs uppercase tracking-wider text-[var(--text-primary)] truncate">${b.label}</span>
            </div>
            <div class="flex items-center gap-4 shrink-0 tabular-nums">
              <span class="text-[11px] text-[var(--text-secondary)]">${b.pct}%</span>
              <span class="text-xs font-semibold text-[var(--text-primary)] w-20 text-right">$${b.cop.toLocaleString('es-CO')}</span>
            </div>
          </div>
        `).join('')}
      </div>
    ` : ''}

    ${cyclePhys ? `
      <!-- Physical Operating Summary -->
      <div class="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-[var(--line-hair)] bg-[var(--bg-void)] font-mono">
        <div class="px-4 py-3.5 min-w-0">
          <span class="block text-[9px] uppercase tracking-[0.16em] text-[var(--text-secondary)]">VEL. MEDIA</span>
          <strong class="block text-sm font-semibold tabular-nums text-[var(--text-primary)] mt-1">${cyclePhys.avgSpeedKmh} KM/H</strong>
        </div>
        <div class="px-4 py-3.5 min-w-0">
          <span class="block text-[9px] uppercase tracking-[0.16em] text-[var(--text-secondary)]">USO MOTOR</span>
          <strong class="block text-sm font-semibold tabular-nums text-[var(--text-primary)] mt-1">${cyclePhys.runTimeHours} H · ${cyclePhys.runNo} TR</strong>
        </div>
        <div class="px-4 py-3.5 min-w-0">
          <span class="block text-[9px] uppercase tracking-[0.16em] text-[var(--text-secondary)]">RALENTÍ</span>
          <strong class="block text-sm font-semibold tabular-nums mt-1 ${cyclePhys.idleAccOnMin >= 20 ? 'text-[var(--accent-amber)]' : 'text-[var(--text-primary)]'}">${cyclePhys.idleAccOnMin} MIN</strong>
        </div>
        <div class="px-4 py-3.5 min-w-0">
          <span class="block text-[9px] uppercase tracking-[0.16em] text-[var(--text-secondary)]">RÉGIMEN</span>
          <strong class="block text-sm font-semibold tabular-nums mt-1 ${cyclePhys.severityFactor >= 1.08 ? 'text-[var(--accent-amber)]' : 'text-[var(--accent-volt)]'}">${escapeHtml(cyclePhys.regimeLabel)}</strong>
        </div>
      </div>
    ` : ''}

    <!-- Calibration & Anomaly Status -->
    <div class="bg-[var(--bg-surface)] divide-y divide-[var(--line-hair)] font-mono">
      <div class="px-5 py-3.5 flex items-center justify-between gap-3">
        <span class="text-[10px] uppercase tracking-[0.16em] text-[var(--text-secondary)]">MODELO DE CONSUMO</span>
        <span class="text-[11px] font-semibold uppercase tracking-wider tabular-nums ${isCalibrated ? 'text-[var(--accent-volt)]' : 'text-[var(--text-secondary)]'}">
          ${isCalibrated ? 'MODELO AUTO-CALIBRADO' : `CALIBRANDO · ${Math.min(5, eligibleCount)}/5 CICLOS`}
        </span>
      </div>
      ${anomaly ? `
        <div class="px-5 py-3.5 flex items-center justify-between gap-3 bg-[var(--bg-void)]">
          <div class="flex items-center gap-2 min-w-0">
            <span class="w-2 h-2 rounded-full bg-[var(--accent-amber)] shrink-0"></span>
            <span class="text-[11px] font-semibold uppercase tracking-wider text-[var(--accent-amber)] truncate">
              CONSUMO +${anomaly.avgExcessPct}% SOBRE LO ESPERADO
            </span>
          </div>
          <span class="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] tabular-nums shrink-0">
            ${anomaly.consecutiveCount} CICLOS
          </span>
        </div>
      ` : ''}
    </div>
  `;
}

function renderHealthTab(state) {
  const profile = state.vehicleProfile || {};
  const logs = Array.isArray(state.telemetryLogs) ? state.telemetryLogs : [];
  const items = Array.isArray(state.maintenanceItems) ? state.maintenanceItems : [];
  const gpsCache = profile?.gpsCache || {};

  const health = analyzeElectricalHealth(
    gpsCache.voltageHistory || [],
    gpsCache.days || null,
    gpsCache.live || null
  );

  const currentOdo = resolveCurrentOdo(logs, profile);
  const wearRows = items.map(item => ({
    item,
    wear: computePhysicalWear(item, {
      currentOdo,
      gpsDays: gpsCache.days || null,
      tripsByDate: gpsCache.tripsByDate || null
    })
  }));

  const slope = Number(health.slopeVPer30d) || 0;
  const slopeSign = slope > 0 ? '+' : '';
  const slopeColor = slope <= -0.15 ? 'var(--accent-amber)' : 'var(--text-secondary)';
  const restingColor = toneColorVar(health.restingTone);
  const chargingColor = toneColorVar(health.chargingTone);

  return `
    <!-- 2 Hero Electrical Cells -->
    <div class="grid grid-cols-2 divide-x divide-[var(--line-hair)] bg-[var(--bg-void)]">
      <div class="px-5 py-6 min-w-0">
        <span class="block font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-secondary)]">BATERÍA EN REPOSO</span>
        <div class="flex items-baseline gap-1 mt-2">
          <strong class="font-sans font-light text-4xl sm:text-5xl tracking-tighter tabular-nums leading-none text-[var(--text-primary)]">
            ${health.restingAvgV > 0 ? health.restingAvgV.toFixed(1) : '—'}
          </strong>
          <span class="font-mono text-xs text-[var(--text-secondary)]">V</span>
        </div>
        <span class="block font-mono text-[11px] font-semibold uppercase tracking-widest mt-2" style="color: ${restingColor}">
          ${escapeHtml(health.restingStatus)}
        </span>
      </div>

      <div class="px-5 py-6 min-w-0">
        <span class="block font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-secondary)]">ALTERNADOR</span>
        <div class="flex items-baseline gap-1 mt-2">
          <strong class="font-sans font-light text-4xl sm:text-5xl tracking-tighter tabular-nums leading-none text-[var(--text-primary)]">
            ${health.chargingAvgV > 0 ? health.chargingAvgV.toFixed(1) : '—'}
          </strong>
          <span class="font-mono text-xs text-[var(--text-secondary)]">V</span>
        </div>
        <span class="block font-mono text-[11px] font-semibold uppercase tracking-widest mt-2" style="color: ${chargingColor}">
          ${escapeHtml(health.chargingStatus)}
        </span>
      </div>
    </div>

    <!-- 30-Day Resting Voltage Sparkline -->
    <div class="px-5 py-5 bg-[var(--bg-void)] space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-wider">
        <span class="text-[var(--text-secondary)] tracking-[0.16em]">TENDENCIA 30 DÍAS</span>
        <div class="flex items-center gap-3 tabular-nums">
          <span style="color: ${slopeColor}">${slopeSign}${slope.toFixed(2)}V / 30D</span>
          <span class="text-[var(--line-strong)]">·</span>
          <span class="text-[var(--text-primary)]">${health.ignitions30d} ARRANQUES</span>
        </div>
      </div>
      <div>
        ${buildVoltageSparklineSvg(health.sparklineSeries, restingColor)}
      </div>
    </div>

    <!-- Physical Mechanical Wear List -->
    <div class="bg-[var(--bg-surface)] divide-y divide-[var(--line-hair)] font-mono">
      <div class="px-5 py-3 bg-[var(--bg-void)] flex items-center justify-between">
        <span class="text-[10px] uppercase tracking-[0.18em] text-[var(--text-secondary)]">DESGASTE POR USO REAL</span>
        <span class="text-[10px] uppercase tracking-wider text-[var(--text-muted)] tabular-nums">${currentOdo.toLocaleString('es-CO')} KM</span>
      </div>
      ${wearRows.length > 0 ? wearRows.map(({ item, wear }) => {
        const multColor = wear.stressMultiplier >= 1.15
          ? 'text-[var(--accent-amber)]'
          : (wear.stressMultiplier <= 0.96 ? 'text-[var(--accent-volt)]' : 'text-[var(--text-secondary)]');
        return `
          <div class="px-5 py-3.5 flex items-center justify-between gap-4">
            <div class="min-w-0 flex-1">
              <span class="block text-xs font-semibold uppercase text-[var(--text-primary)] truncate">${escapeHtml(item.name || 'COMPONENTE')}</span>
              <span class="block text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mt-0.5">${escapeHtml(wear.basisLabel)}</span>
            </div>
            <div class="text-right shrink-0 tabular-nums">
              <span class="block text-xs font-semibold text-[var(--text-primary)]">${wear.remainingEquivalentKm.toLocaleString('es-CO')} KM REST.</span>
              <span class="block text-[10px] ${multColor} mt-0.5">${wear.stressMultiplier.toFixed(2)}×</span>
            </div>
          </div>
        `;
      }).join('') : `
        <div class="px-5 py-6 text-center text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">
          SIN COMPONENTES REGISTRADOS
        </div>
      `}
    </div>
  `;
}

function renderRoutesTab(state) {
  const model = state.telemetryEngineResults || null;
  const profile = state.vehicleProfile || {};
  const logs = Array.isArray(state.telemetryLogs) ? state.telemetryLogs : [];
  const gpsCache = profile?.gpsCache || {};
  const tripsByDate = gpsCache.tripsByDate || {};
  const learnedStations = Array.isArray(profile?.learnedGasStations) ? profile.learnedGasStations : [];

  const semanticPlaces = detectSemanticPlaces(tripsByDate, learnedStations);
  const sentinel = computeParkingSentinel(gpsCache.live || null, gpsCache.voltageHistory || [], semanticPlaces);
  const optimalDeparture = analyzeOptimalDeparture(tripsByDate, { semanticPlaces });

  const closedCycles = Array.isArray(model?.allCycles)
    ? model.allCycles
    : (Array.isArray(model?.fullEraCycles) ? model.fullEraCycles : []);
  const stationHonesty = computeStationHonestyIndex(closedCycles, logs, learnedStations);

  const driftSign = sentinel.voltageDeltaV > 0 ? '+' : '';
  const sentinelMainText = !sentinel.hasData
    ? 'SIN SEÑAL EN VIVO'
    : (sentinel.isParked
      ? `PARQUEADO · ${sentinel.parkedDurationLabel || '0M'} · ${sentinel.placeLabel}`
      : `EN MARCHA · ${sentinel.liveSpeed} KM/H · ${sentinel.placeLabel}`);

  return `
    <!-- Parking Sentinel -->
    <div class="px-5 py-5 bg-[var(--bg-void)] space-y-2 font-mono">
      <span class="block text-[10px] uppercase tracking-[0.18em] text-[var(--text-secondary)]">CENTINELA DE PARQUEO</span>
      <div class="flex items-center gap-2.5 min-w-0">
        <span class="w-2 h-2 rounded-full shrink-0 ${sentinel.hasData ? (sentinel.isParked ? 'bg-[var(--accent-volt)]' : 'bg-[var(--accent-amber)] animate-pulse') : 'bg-[var(--text-muted)]'}"></span>
        <strong class="text-sm font-semibold uppercase tracking-wider text-[var(--text-primary)] truncate">
          ${escapeHtml(sentinelMainText)}
        </strong>
      </div>
      ${sentinel.hasData && sentinel.currentVoltage > 0 ? `
        <div class="flex items-center gap-3 text-[11px] text-[var(--text-secondary)] tabular-nums pt-0.5">
          <span>VOLTAJE ${sentinel.currentVoltage.toFixed(2)}V</span>
          ${sentinel.isParked && Math.abs(sentinel.voltageDeltaV) >= 0.01 ? `
            <span class="text-[var(--line-strong)]">·</span>
            <span class="${sentinel.voltageDeltaV <= -0.15 ? 'text-[var(--accent-amber)]' : 'text-[var(--text-secondary)]'}">
              DERIVA ${driftSign}${sentinel.voltageDeltaV.toFixed(2)}V
            </span>
          ` : ''}
        </div>
      ` : ''}
    </div>

    <!-- Detected Semantic Places -->
    <div class="bg-[var(--bg-surface)] divide-y divide-[var(--line-hair)] font-mono">
      <div class="px-5 py-3 bg-[var(--bg-void)] flex items-center justify-between">
        <span class="text-[10px] uppercase tracking-[0.18em] text-[var(--text-secondary)]">LUGARES DETECTADOS</span>
        <span class="text-[10px] text-[var(--text-muted)] tabular-nums">${semanticPlaces.allPlaces.length}</span>
      </div>
      ${semanticPlaces.allPlaces.length > 0 ? semanticPlaces.allPlaces.map(place => {
        const meta = place.type === 'home'
          ? `${place.daysCount} NOCHES`
          : (place.type === 'work'
            ? `${place.daysCount} DÍAS`
            : `${place.refuelCount} ${place.refuelCount === 1 ? 'TANQUEO' : 'TANQUEOS'}`);
        const dotColor = place.type === 'home'
          ? 'var(--accent-volt)'
          : (place.type === 'work' ? 'var(--accent-cyan)' : 'var(--accent-amber)');
        return `
          <div class="px-5 py-3.5 flex items-center justify-between gap-3">
            <div class="flex items-center gap-2.5 min-w-0">
              <span class="w-2 h-2 rounded-full shrink-0" style="background-color: ${dotColor}"></span>
              <span class="text-xs font-semibold uppercase text-[var(--text-primary)] truncate">${escapeHtml(place.label)}</span>
            </div>
            <span class="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] tabular-nums shrink-0">${meta}</span>
          </div>
        `;
      }).join('') : `
        <div class="px-5 py-5 text-[10px] uppercase tracking-[0.16em] text-[var(--text-secondary)]">
          APRENDIENDO RUTAS...
        </div>
      `}
    </div>

    <!-- Optimal Departure Windows -->
    <div class="bg-[var(--bg-surface)] divide-y divide-[var(--line-hair)] font-mono">
      <div class="px-5 py-3 bg-[var(--bg-void)] flex items-center justify-between">
        <span class="text-[10px] uppercase tracking-[0.18em] text-[var(--text-secondary)]">MEJOR HORA DE SALIDA</span>
        ${optimalDeparture.length > 0 ? `<span class="text-[10px] text-[var(--text-muted)] tabular-nums">${optimalDeparture.length}</span>` : ''}
      </div>
      ${optimalDeparture.length > 0 ? optimalDeparture.slice(0, 4).map(corridor => `
        <div class="px-5 py-3.5 flex items-center justify-between gap-3">
          <div class="min-w-0 flex-1">
            <span class="block text-xs font-semibold uppercase text-[var(--text-primary)] truncate">${escapeHtml(corridor.corridorLabel)}</span>
            <span class="block text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mt-0.5 tabular-nums">
              SALIDA ${corridor.bestWindowHm} · ${corridor.sampleCount} VIAJES
            </span>
          </div>
          <div class="text-right shrink-0 tabular-nums">
            <span class="block text-xs font-semibold ${corridor.savedMin > 0 ? 'text-[var(--accent-volt)]' : 'text-[var(--text-primary)]'}">
              ${corridor.savedMin > 0 ? `-${corridor.savedMin} MIN` : `${corridor.bestDurationMin} MIN`}
            </span>
            ${corridor.savedCopPerTrip > 0 ? `
              <span class="block text-[10px] text-[var(--text-secondary)] mt-0.5">-$${corridor.savedCopPerTrip.toLocaleString('es-CO')}</span>
            ` : ''}
          </div>
        </div>
      `).join('') : `
        <div class="px-5 py-5 text-[10px] uppercase tracking-[0.16em] text-[var(--text-secondary)]">
          DISPONIBLE AL ACUMULAR 6 VIAJES EN UNA RUTA
        </div>
      `}
    </div>

    <!-- Station Honesty Ranking -->
    <div class="bg-[var(--bg-surface)] divide-y divide-[var(--line-hair)] font-mono">
      <div class="px-5 py-3 bg-[var(--bg-void)] flex items-center justify-between">
        <span class="text-[10px] uppercase tracking-[0.18em] text-[var(--text-secondary)]">CALIDAD POR ESTACIÓN</span>
        ${stationHonesty.totalQualifiedStations > 0 ? `<span class="text-[10px] text-[var(--text-muted)] tabular-nums">${stationHonesty.totalQualifiedStations}</span>` : ''}
      </div>
      ${stationHonesty.rankedStations.length > 0 ? stationHonesty.rankedStations.map(st => {
        const resSign = st.residualPct > 0 ? '+' : '';
        const resColor = st.residualPct >= 0 ? 'var(--accent-volt)' : (st.residualPct <= -3 ? 'var(--accent-crimson)' : 'var(--accent-amber)');
        return `
          <div class="px-5 py-3.5 flex items-center justify-between gap-3">
            <div class="min-w-0 flex-1">
              <span class="block text-xs font-semibold uppercase text-[var(--text-primary)] truncate">${escapeHtml(st.stationName)}</span>
              <span class="block text-[10px] uppercase tracking-wider text-[var(--text-secondary)] mt-0.5 tabular-nums">${st.cyclesCount} CICLOS · ${st.avgEff} KM/G</span>
            </div>
            <span class="text-xs font-semibold tabular-nums shrink-0" style="color: ${resColor}">
              ${resSign}${st.residualPct.toFixed(1)}%
            </span>
          </div>
        `;
      }).join('') : `
        <div class="px-5 py-5 text-[10px] uppercase tracking-[0.16em] text-[var(--text-secondary)]">
          DISPONIBLE AL CERRAR 2 CICLOS POR ESTACIÓN
        </div>
      `}
    </div>
  `;
}

function renderModal() {
  if (!modalRoot) return;
  const state = store.getState() || {};

  const tabs = [
    { id: 'fuel', label: 'COMBUSTIBLE' },
    { id: 'health', label: 'SALUD' },
    { id: 'routes', label: 'RUTAS' }
  ];

  let bodyHtml = '';
  if (activeTab === 'health') {
    bodyHtml = renderHealthTab(state);
  } else if (activeTab === 'routes') {
    bodyHtml = renderRoutesTab(state);
  } else {
    bodyHtml = renderFuelTab(state);
  }

  modalRoot.innerHTML = `
    <div class="intel-modal-backdrop fixed inset-0 bg-black/80 transition-opacity"></div>

    <div class="fixed inset-0 z-10 flex items-center justify-center sm:p-4">
      <div class="w-full h-[100dvh] sm:h-[88dvh] sm:max-w-2xl bg-[var(--bg-void)] sm:border sm:border-[var(--line-hair)] text-[var(--text-primary)] flex flex-col overflow-hidden">
        <!-- Top 3-Tab Header -->
        <header class="border-b border-[var(--line-hair)] bg-[var(--bg-surface)] flex items-stretch shrink-0">
          <div class="flex-1 grid grid-cols-3 divide-x divide-[var(--line-hair)]">
            ${tabs.map(t => `
              <button type="button" data-intel-tab="${t.id}"
                class="py-3.5 px-2 font-mono text-[10px] uppercase tracking-[0.16em] transition-colors cursor-pointer truncate ${activeTab === t.id ? 'bg-[var(--bg-void)] text-[var(--accent-amber)] font-semibold' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}">
                ${t.label}
              </button>
            `).join('')}
          </div>
          <button id="intel-detail-close-btn" type="button" class="w-11 border-l border-[var(--line-hair)] flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--line-hair)] transition-colors cursor-pointer shrink-0" aria-label="Cerrar">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        <!-- Scrollable Flat Body -->
        <div class="flex-1 overflow-y-auto divide-y divide-[var(--line-hair)] overscroll-contain">
          ${bodyHtml}
        </div>
      </div>
    </div>
  `;

  bindModalEvents();
}

function bindModalEvents() {
  if (!modalRoot) return;

  modalRoot.querySelector('#intel-detail-close-btn')?.addEventListener('click', closeGpsIntelligenceModal);
  modalRoot.querySelector('.intel-modal-backdrop')?.addEventListener('click', closeGpsIntelligenceModal);

  modalRoot.querySelectorAll('[data-intel-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const nextTab = btn.dataset.intelTab;
      if (nextTab && nextTab !== activeTab) {
        playHorologyTick(1120, 0.012, 0.024);
        activeTab = nextTab;
        renderModal();
      }
    });
  });

  modalRoot.querySelectorAll('[data-fuel-scope]').forEach(btn => {
    btn.addEventListener('click', () => {
      const nextScope = btn.dataset.fuelScope;
      if ((nextScope === 'cycle' || nextScope === 'month') && nextScope !== activeFuelScope) {
        playHorologyTick(1050, 0.01, 0.02);
        activeFuelScope = nextScope;
        renderModal();
      }
    });
  });
}
