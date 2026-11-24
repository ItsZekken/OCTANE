/**
 * OCTANE — Cluster View ("CLÚSTER")
 * Categorized Mechanical Systems Accordion Matrix, Physical Wear Telemetry,
 * Electrical Health Trigger & Collapsible Technical Logbook.
 *
 * Design & Trust Specifications:
 * - Clean title: "CLÚSTER" (zero "//" and zero numeric prefixes).
 * - Components organized into clean System Category Accordions (Motor y Fluidos,
 *   Llantas y Frenos, Cabina y Eléctrico, Transmisión, General y Otros).
 * - Integrates GPS physical equivalent wear (stressMultiplier) and clickable
 *   30d electrical health trigger in header.
 * - Honest state: uncalibrated components show "SIN BASE" instead of fake red "0 KM REST.".
 * - Explicit proof of saved records: last date, odometer, cost, spec highlights, and record count.
 * - Unambiguous action labels: "+ REGISTRAR" and "HISTORIAL (N)" (zero "RESET").
 * - Live clickable sync status indicator in header for immediate cloud verification.
 * - Collapsible "Bitácora Abierta" below systems, wired to FAB "Nueva nota".
 * - Silencio Verbal Absoluto: Zero <p> tags, zero nested boxes, 1px hairline dividers.
 */

import { store, playHorologyTick, showToast } from '../core/state.js';
import { getMaintenanceItems, getFreeNotes } from '../core/db-local.js';
import { pullFromCloud, syncToCloud } from '../core/firebase-sync.js';
import { analyzeElectricalHealth } from '../core/vehicle-health-engine.js';
import { calculateWearDialTelemetry } from '../components/cluster/wear-dial-card.js';
import { renderComponentIconSvg } from '../components/cluster/icons-catalog.js';
import {
    MAINTENANCE_GROUPS,
    resolveMaintenanceGroup,
    formatCompactSpecSummary,
} from '../components/cluster/service-schemas.js';
import {
    openRegisterServiceModal,
    openAddComponentModal,
    openEditComponentModal,
    openHistoryMaintenanceModal,
} from '../components/modals/modal-maintenance.js';

let storeUnsubscribe = null;
let currentActiveContainer = null;
let boundWindowCleanups = [];

// Persist accordion open states during the session
const expandedGroups = new Set();
let hasInitializedAccordions = false;
let isNotesExpanded = false;
let notesBoardMounted = false;

const MONTHS_ES = Object.freeze([
    'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
    'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
]);

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatShortDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return '';
    const parts = dateStr.slice(0, 10).split('-');
    if (parts.length !== 3) return dateStr;
    const mIdx = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    if (isNaN(mIdx) || mIdx < 0 || mIdx > 11 || isNaN(day)) return dateStr;
    return `${day} ${MONTHS_ES[mIdx]} ${parts[0]}`;
}

function formatCompactCop(val) {
    const num = Number(val) || 0;
    if (num <= 0) return '';
    return `$${Math.round(num).toLocaleString('es-CO')}`;
}

/**
 * Computes the highest odometer reading from telemetry logs and live GPS odometer.
 * @param {Array<Object>} logs
 * @param {Object} [vehicleProfile=null]
 * @returns {number}
 */
export function getCurrentOdometer(logs = [], vehicleProfile = null) {
    const gpsOdo = Number(vehicleProfile?.gpsCache?.live?.totalMile) || 0;
    if (!Array.isArray(logs) || logs.length === 0) return gpsOdo;
    const maxLogOdo = logs.reduce((max, log) => {
        const odo = Number(log.odometer_reading) || 0;
        return odo > max ? odo : max;
    }, 0);
    return Math.max(maxLogOdo, gpsOdo);
}

/**
 * Builds the GPS physical-wear context from vehicleProfile.
 * @param {Object|null} vehicleProfile
 * @returns {{ gpsDays: Object|null, tripsByDate: Object|null }|null}
 */
function buildClusterGpsContext(vehicleProfile) {
    const cache = vehicleProfile?.gpsCache;
    if (!cache || (!cache.days && !cache.tripsByDate)) return null;
    return {
        gpsDays: cache.days || null,
        tripsByDate: cache.tripsByDate || null,
    };
}

/**
 * Formats the compact header battery trigger readout from live GPS and 30d electrical health.
 * @param {Object|null} vehicleProfile
 * @returns {{ visible: boolean, text: string, colorClass: string }}
 */
function formatClusterBatteryTrigger(vehicleProfile) {
    const cache = vehicleProfile?.gpsCache || {};
    const live = cache.live || null;
    const health = analyzeElectricalHealth(cache.voltageHistory || [], cache.days || null, live);
    const liveV = Number(live?.externalVoltage) || 0;
    const accOn = Boolean(live?.accStatus);
    const displayV = liveV > 0 ? liveV : (accOn ? health.chargingAvgV : health.restingAvgV);

    if (!(displayV > 0)) {
        return { visible: false, text: '', colorClass: 'text-[var(--text-secondary)]' };
    }

    let statusLabel = 'ÓPTIMA';
    let tone = 'volt';
    if (accOn && health.chargingStatus !== 'SIN DATO') {
        statusLabel = health.chargingStatus;
        tone = health.chargingTone;
    } else if (health.restingStatus !== 'SIN DATO') {
        statusLabel = health.restingStatus;
        tone = health.restingTone;
    } else if (displayV < 12.15) {
        statusLabel = 'CRÍTICA';
        tone = 'crimson';
    } else if (displayV < 12.45) {
        statusLabel = 'DESGASTE';
        tone = 'amber';
    }

    const colorClass = tone === 'crimson'
        ? 'text-[var(--accent-crimson)]'
        : tone === 'amber'
            ? 'text-[var(--accent-amber)]'
            : tone === 'volt'
                ? 'text-[var(--accent-volt)]'
                : 'text-[var(--text-secondary)]';

    return {
        visible: true,
        text: `BATERÍA: ${displayV.toFixed(1)}V · ${statusLabel} →`,
        colorClass,
    };
}

/**
 * Resolves the live cloud sync pill appearance from global store state.
 */
function resolveClusterSyncMeta() {
    const s = store.getState();
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (!s.user) {
        return { label: 'LOCAL', dot: 'bg-[var(--text-muted)]', text: 'text-[var(--text-muted)]', canSync: false };
    }
    if (offline || s.syncStatus === 'offline') {
        return { label: 'SIN RED', dot: 'bg-[var(--text-muted)]', text: 'text-[var(--text-muted)]', canSync: false };
    }
    if (s.syncStatus === 'syncing') {
        return { label: 'SINCRONIZANDO', dot: 'bg-[var(--accent-amber)] animate-pulse', text: 'text-[var(--accent-amber)]', canSync: false };
    }
    if (s.syncStatus === 'error') {
        return { label: 'REINTENTAR SYNC', dot: 'bg-[var(--accent-crimson)]', text: 'text-[var(--accent-crimson)]', canSync: true };
    }
    return { label: 'SINCRONIZADO', dot: 'bg-[var(--accent-volt)]', text: 'text-[var(--text-secondary)]', canSync: true };
}

/**
 * Groups maintenance items into canonical system accordions and computes summary stats.
 * @param {Array<Object>} items
 * @param {number} currentOdo
 * @param {Object|null} [gpsContext=null]
 */
function buildGroupedCatalog(items = [], currentOdo = 0, gpsContext = null) {
    const buckets = new Map();
    for (const g of MAINTENANCE_GROUPS) {
        buckets.set(g.id, { ...g, items: [] });
    }

    let attentionCount = 0;
    let nominalCount = 0;
    let totalServicesCount = 0;
    let totalInvestedCop = 0;

    for (const item of items) {
        const groupId = resolveMaintenanceGroup(item);
        const telemetry = calculateWearDialTelemetry(item, currentOdo, gpsContext);
        const history = Array.isArray(item.history) ? item.history : [];
        const itemSpent = history.reduce((acc, h) => acc + (Number(h.costCop) || 0), 0);

        totalServicesCount += history.length;
        totalInvestedCop += itemSpent;

        if (!telemetry.isUncalibrated) {
            if (telemetry.isCritical || telemetry.isWarning) attentionCount++;
            else nominalCount++;
        }

        const bucket = buckets.get(groupId) || buckets.get('general');
        bucket.items.push({ item, telemetry, history, latestEntry: history[0] || null });
    }

    const activeGroups = [];
    for (const bucket of buckets.values()) {
        if (bucket.items.length === 0) continue;

        const priority = (t) => {
            if (t.isCritical) return 0;
            if (t.isWarning) return 1;
            if (!t.isUncalibrated) return 2;
            return 3;
        };
        bucket.items.sort((a, b) => {
            const pDiff = priority(a.telemetry) - priority(b.telemetry);
            if (pDiff !== 0) return pDiff;
            return (a.telemetry.kmRemaining ?? Infinity) - (b.telemetry.kmRemaining ?? Infinity);
        });

        const critCount = bucket.items.filter((x) => x.telemetry.isCritical).length;
        const warnCount = bucket.items.filter((x) => x.telemetry.isWarning).length;
        const calibrated = bucket.items.filter((x) => !x.telemetry.isUncalibrated);
        const groupServices = bucket.items.reduce((acc, x) => acc + x.history.length, 0);

        let statusColor = 'var(--text-muted)';
        let summaryBadge = 'SIN REGISTROS';
        let summaryClass = 'text-[var(--text-muted)]';

        if (critCount > 0) {
            statusColor = 'var(--accent-crimson)';
            summaryBadge = `${critCount} ${critCount === 1 ? 'URGENTE' : 'URGENTES'}`;
            summaryClass = 'text-[var(--accent-crimson)] font-semibold';
        } else if (warnCount > 0) {
            statusColor = 'var(--accent-amber)';
            summaryBadge = `${warnCount} ${warnCount === 1 ? 'PRÓXIMO' : 'PRÓXIMOS'}`;
            summaryClass = 'text-[var(--accent-amber)] font-semibold';
        } else if (calibrated.length > 0) {
            statusColor = 'var(--accent-volt)';
            const nextDueItem = calibrated[0];
            summaryBadge = `AL DÍA · ${Number(nextDueItem.telemetry.kmRemaining).toLocaleString('es-CO')} KM`;
            summaryClass = 'text-[var(--accent-volt)]';
        }

        activeGroups.push({
            ...bucket,
            critCount,
            warnCount,
            groupServices,
            statusColor,
            summaryBadge,
            summaryClass,
        });
    }

    return {
        groups: activeGroups,
        attentionCount,
        nominalCount,
        totalServicesCount,
        totalInvestedCop,
    };
}

/**
 * Renders a single component row inside an expanded system accordion.
 * Zero nested boxes: pure 1px hairline row with clear status, proof of last service, and actions.
 */
function renderComponentRowHtml({ item, telemetry, history, latestEntry }) {
    const safeId = escapeHtml(item.id || '');
    const safeName = escapeHtml(item.name || 'COMPONENTE');
    const iconSvg = renderComponentIconSvg(item, 'w-4 h-4');
    const historyCount = history.length;

    const lastDateStr = formatShortDate(latestEntry?.date || item.lastServiceDate);
    const lastOdoStr = item.lastServiceOdo > 0 ? `${Number(item.lastServiceOdo).toLocaleString('es-CO')} KM` : '';
    const lastCostStr = formatCompactCop(latestEntry?.costCop);
    const specSummary = latestEntry ? formatCompactSpecSummary(latestEntry, item) : '';
    const workshopStr = latestEntry?.workshop ? escapeHtml(latestEntry.workshop) : '';

    const proofParts = [];
    if (lastDateStr) proofParts.push(lastDateStr);
    if (lastOdoStr) proofParts.push(lastOdoStr);
    if (lastCostStr) proofParts.push(lastCostStr);
    if (workshopStr) proofParts.push(workshopStr);

    const hasProof = proofParts.length > 0;
    const nextDueText = telemetry.nextDueOdo
        ? `PRÓXIMO: ${Number(telemetry.nextDueOdo).toLocaleString('es-CO')} KM`
        : `INTERVALO: ${Number(telemetry.intervalKm).toLocaleString('es-CO')} KM`;
    const stressSuffix = telemetry.stressMultiplier >= 1.10 ? ` · ${telemetry.stressMultiplier.toFixed(2)}×` : '';

    let rightReadoutHtml = '';
    if (telemetry.isUncalibrated) {
        rightReadoutHtml = `
          <div class="text-right shrink-0">
            <span class="font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)]">SIN BASE</span>
          </div>
        `;
    } else if (telemetry.kmOverdue > 0) {
        rightReadoutHtml = `
          <div class="text-right shrink-0">
            <div class="font-sans font-light text-2xl sm:text-3xl tracking-tighter tabular-nums leading-none text-[var(--accent-crimson)]">
              +${Number(telemetry.kmOverdue).toLocaleString('es-CO')}
            </div>
            <div class="font-mono text-[9px] uppercase tracking-widest text-[var(--accent-crimson)] mt-1">
              KM VENCIDO${stressSuffix}
            </div>
          </div>
        `;
    } else {
        rightReadoutHtml = `
          <div class="text-right shrink-0">
            <div class="font-sans font-light text-2xl sm:text-3xl tracking-tighter tabular-nums leading-none text-[var(--text-primary)]">
              ${Number(telemetry.kmRemaining).toLocaleString('es-CO')}
            </div>
            <div class="font-mono text-[9px] uppercase tracking-widest mt-1" style="color: ${telemetry.colorVar};">
              KM REST.${stressSuffix} · ${telemetry.statusText}
            </div>
          </div>
        `;
    }

    return `
      <div class="px-4 sm:px-5 py-4 bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)]/25 transition-colors space-y-3" data-item-id="${safeId}">
        
        <!-- Row 1: Status bar + Icon + Component identity & last service proof | Right: Remaining KM -->
        <div class="flex items-start justify-between gap-3">
          <div class="flex items-start gap-3 min-w-0">
            <div class="w-[3px] self-stretch min-h-[2.25rem] rounded-full shrink-0" style="background-color: ${telemetry.colorVar};"></div>
            <div class="min-w-0 space-y-1">
              <div class="flex items-center gap-2">
                <span class="text-[var(--text-secondary)] shrink-0">${iconSvg}</span>
                <span class="font-sans font-medium text-sm sm:text-base text-[var(--text-primary)] tracking-tight truncate">${safeName}</span>
                <button
                  type="button"
                  data-action="edit"
                  data-id="${safeId}"
                  class="w-6 h-6 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer shrink-0"
                  title="Configurar componente"
                >
                  <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                  </svg>
                </button>
              </div>

              <!-- Proof of last recorded service -->
              <div class="font-mono text-[10px] tracking-wider tabular-nums ${hasProof ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)]'}">
                ${hasProof ? escapeHtml(proofParts.join(' · ')) : 'SIN SERVICIOS REGISTRADOS'}
              </div>

              ${specSummary ? `
                <div class="font-mono text-[10px] tracking-wider text-[var(--accent-amber)] truncate">
                  ${escapeHtml(specSummary)}
                </div>
              ` : ''}
            </div>
          </div>

          ${rightReadoutHtml}
        </div>

        <!-- Precision 2px Wear Track (only when calibrated) -->
        ${!telemetry.isUncalibrated ? `
          <div class="h-[2px] w-full bg-[var(--line-hair)] overflow-hidden">
            <div class="h-full transition-all duration-300" style="width: ${Math.max(2, Math.round(telemetry.lifePct))}%; background-color: ${telemetry.colorVar};"></div>
          </div>
        ` : ''}

        <!-- Row 2: Next Due / Interval + Clear Actions -->
        <div class="flex flex-wrap items-center justify-between gap-2 pt-0.5 font-mono text-[10px]">
          <span class="text-[var(--text-muted)] uppercase tracking-wider tabular-nums">
            ${nextDueText}
          </span>

          <div class="flex items-center gap-2 shrink-0">
            <button
              type="button"
              data-action="history"
              data-id="${safeId}"
              class="px-2.5 py-1.5 flat-pill ${historyCount > 0 ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'} hover:border-[var(--line-strong)] transition-colors cursor-pointer uppercase tracking-wider"
            >
              HISTORIAL${historyCount > 0 ? ` (${historyCount})` : ''}
            </button>
            <button
              type="button"
              data-action="register"
              data-id="${safeId}"
              class="px-3 py-1.5 bg-[var(--text-primary)] text-[var(--bg-void)] font-semibold hover:opacity-90 transition-opacity cursor-pointer uppercase tracking-wider"
            >
              + REGISTRAR
            </button>
          </div>
        </div>

      </div>
    `;
}

/**
 * Renders the categorized system accordions list inside `#cluster-accordions-mount`.
 */
function renderAccordions(container, items, currentOdo, gpsContext = null) {
    const mount = container.querySelector('#cluster-accordions-mount');
    const summaryEl = container.querySelector('#cluster-summary-strip');
    const toggleAllBtn = container.querySelector('#cluster-toggle-all-btn');
    if (!mount) return;

    const catalog = buildGroupedCatalog(items, currentOdo, gpsContext);

    if (!hasInitializedAccordions && catalog.groups.length > 0) {
        hasInitializedAccordions = true;
        const flagged = catalog.groups.filter((g) => g.critCount > 0 || g.warnCount > 0);
        if (flagged.length > 0) {
            flagged.forEach((g) => expandedGroups.add(g.id));
        } else {
            expandedGroups.add(catalog.groups[0].id);
        }
    }

    if (summaryEl) {
        const attColor = catalog.attentionCount > 0 ? 'text-[var(--accent-amber)]' : 'text-[var(--text-muted)]';
        const nomColor = catalog.nominalCount > 0 ? 'text-[var(--accent-volt)]' : 'text-[var(--text-muted)]';
        summaryEl.innerHTML = `
          <div class="px-4 py-3">
            <span class="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--text-secondary)] block">ATENCIÓN</span>
            <span class="font-sans font-light text-2xl sm:text-3xl tabular-nums leading-tight ${attColor}">${catalog.attentionCount}</span>
          </div>
          <div class="px-4 py-3">
            <span class="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--text-secondary)] block">AL DÍA</span>
            <span class="font-sans font-light text-2xl sm:text-3xl tabular-nums leading-tight ${nomColor}">${catalog.nominalCount}</span>
          </div>
          <div class="px-4 py-3">
            <span class="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--text-secondary)] block">SERVICIOS</span>
            <div class="flex items-baseline gap-2 flex-wrap">
              <span class="font-sans font-light text-2xl sm:text-3xl tabular-nums leading-tight text-[var(--text-primary)]">${catalog.totalServicesCount}</span>
              ${catalog.totalInvestedCop > 0 ? `
                <span class="font-mono text-[10px] text-[var(--text-secondary)] tabular-nums">${formatCompactCop(catalog.totalInvestedCop)}</span>
              ` : ''}
            </div>
          </div>
        `;
    }

    if (toggleAllBtn) {
        const allOpen = catalog.groups.length > 0 && catalog.groups.every((g) => expandedGroups.has(g.id));
        toggleAllBtn.textContent = allOpen ? 'CONTRAER' : 'EXPANDIR';
        toggleAllBtn.setAttribute('data-all-open', allOpen ? 'true' : 'false');
    }

    if (catalog.groups.length === 0) {
        mount.innerHTML = `
          <div class="p-8 text-center font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)] bg-[var(--bg-surface)]">
            SIN COMPONENTES REGISTRADOS
          </div>
        `;
        return;
    }

    mount.innerHTML = catalog.groups.map((group) => {
        const isOpen = expandedGroups.has(group.id);
        return `
          <section class="cluster-accordion-group bg-[var(--bg-surface)]" data-group-id="${group.id}">
            
            <!-- Accordion Header -->
            <button
              type="button"
              data-action="toggle-group"
              data-group-id="${group.id}"
              aria-expanded="${isOpen ? 'true' : 'false'}"
              class="w-full px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 hover:bg-[var(--bg-elevated)]/35 transition-colors cursor-pointer text-left"
            >
              <div class="flex items-center gap-2.5 min-w-0">
                <span class="w-2 h-2 rounded-full shrink-0" style="background-color: ${group.statusColor};"></span>
                <span class="text-[var(--text-secondary)] shrink-0">${renderComponentIconSvg(group.icon, 'w-4 h-4')}</span>
                <span class="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-primary)] font-semibold truncate">
                  ${escapeHtml(group.label)}
                </span>
                <span class="font-mono text-[10px] text-[var(--text-muted)] tabular-nums shrink-0">
                  ${group.items.length}
                </span>
              </div>

              <div class="flex items-center gap-3 shrink-0">
                <span class="font-mono text-[9px] uppercase tracking-wider tabular-nums ${group.summaryClass}">
                  ${escapeHtml(group.summaryBadge)}
                </span>
                <svg
                  class="w-3.5 h-3.5 text-[var(--text-secondary)] transition-transform duration-200 ${isOpen ? 'rotate-180 text-[var(--text-primary)]' : ''}"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>

            <!-- Accordion Body -->
            <div class="${isOpen ? '' : 'hidden'} border-t border-[var(--line-hair)] divide-y divide-[var(--line-hair)]">
              ${group.items.map((entry) => renderComponentRowHtml(entry)).join('')}
            </div>

          </section>
        `;
    }).join('');
}

function paintSyncPill(container) {
    const btn = container?.querySelector('#cluster-sync-btn');
    if (!btn) return;
    const meta = resolveClusterSyncMeta();
    btn.innerHTML = `
      <span class="w-1.5 h-1.5 rounded-full ${meta.dot}"></span>
      <span class="${meta.text}">${meta.label}</span>
    `;
}

async function updateNotesCountBadge(container) {
    const badge = container?.querySelector('#cluster-notes-count-badge');
    if (!badge) return;
    try {
        const notes = await getFreeNotes();
        badge.textContent = `${notes.length} ${notes.length === 1 ? 'NOTA' : 'NOTAS'}`;
    } catch {
        badge.textContent = '0 NOTAS';
    }
}

async function ensureNotesBoardMounted(container, focusTextarea = false) {
    const notesMount = container.querySelector('#cluster-notes-mount');
    if (!notesMount) return;

    if (!notesBoardMounted) {
        try {
            const notesModule = await import('../components/cluster/free-notes-board.js');
            if (typeof notesModule.renderFreeNotesBoard === 'function') {
                await notesModule.renderFreeNotesBoard(notesMount, { embedded: true });
                notesBoardMounted = true;
            }
        } catch (err) {
            console.warn('[OCTANE] Could not mount Bitácora Abierta:', err);
        }
    }

    if (focusTextarea) {
        setTimeout(() => {
            const ta = container.querySelector('#free-note-textarea');
            ta?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            ta?.focus();
        }, 60);
    }
}

/**
 * Destroys active subscriptions and listeners for the Cluster view.
 */
export function destroyClusterView() {
    if (storeUnsubscribe) {
        storeUnsubscribe();
        storeUnsubscribe = null;
    }
    boundWindowCleanups.forEach((fn) => fn());
    boundWindowCleanups = [];
    notesBoardMounted = false;
    currentActiveContainer = null;
}

/**
 * Main entry point: Renders the redesigned Cluster View.
 * @param {HTMLElement} container
 */
export async function renderClusterView(container) {
    destroyClusterView();
    currentActiveContainer = container;

    playHorologyTick(1100, 0.015, 0.025);

    const state = store.getState();
    const logs = state.telemetryLogs || [];
    let currentOdo = getCurrentOdometer(logs, state.vehicleProfile);
    let gpsContext = buildClusterGpsContext(state.vehicleProfile);
    const batteryTrigger = formatClusterBatteryTrigger(state.vehicleProfile);

    let items = [];
    try {
        items = await getMaintenanceItems(true);
    } catch (err) {
        console.warn('[OCTANE] Error loading maintenance items in cluster:', err);
        items = [];
    }

    store.setState({ maintenanceItems: items });

    container.innerHTML = `
      <div class="view-cluster max-w-4xl mx-auto w-full space-y-5 pb-24 select-none">

        <!-- Top View Header -->
        <div class="border-b border-[var(--line-hair)] pb-3 flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2.5">
            <span class="w-2 h-2 bg-[var(--accent-amber)]"></span>
            <h1 class="font-mono text-xs uppercase tracking-widest text-[var(--text-primary)] font-semibold">CLÚSTER</h1>
          </div>

          <div class="flex flex-wrap items-center gap-3 font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">
            <button
              id="cluster-sync-btn"
              type="button"
              class="flex items-center gap-1.5 hover:text-[var(--text-primary)] transition-colors cursor-pointer"
              title="Sincronizar ahora con la nube"
            ></button>
            <span class="text-[var(--line-strong)]">·</span>
            <button
              id="cluster-top-voltage-readout"
              type="button"
              class="${batteryTrigger.visible ? '' : 'hidden '}tabular-nums cursor-pointer hover:opacity-80 transition-opacity ${batteryTrigger.colorClass}"
              title="Abrir salud eléctrica y desgaste físico"
            >${batteryTrigger.text}</button>
            <span id="cluster-top-voltage-sep" class="${batteryTrigger.visible ? '' : 'hidden '}text-[var(--line-strong)]">·</span>
            <span id="cluster-top-odo-readout" class="tabular-nums text-[var(--text-primary)]">
              ${currentOdo.toLocaleString('es-CO')} KM
            </span>
          </div>
        </div>

        <!-- Compact Status Summary Strip (Flat 3-col, zero nested boxes) -->
        <div id="cluster-summary-strip" class="flat-frame grid grid-cols-3 divide-x divide-[var(--line-hair)]"></div>

        <!-- Section: Categorized Mechanical Systems Accordions -->
        <div class="space-y-0">
          <div class="h-12 flat-frame px-4 sm:px-5 flex items-center justify-between border-b-0">
            <span class="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-secondary)]">
              SISTEMAS MECÁNICOS
            </span>

            <div class="flex items-center gap-2">
              <button
                id="cluster-toggle-all-btn"
                type="button"
                class="px-2.5 py-1 font-mono text-[9px] uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
              >
                EXPANDIR
              </button>
              <button
                id="cluster-add-component-btn"
                type="button"
                class="flat-pill px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-[var(--text-primary)] hover:border-[var(--line-strong)] hover:bg-[var(--line-hair)] transition-colors cursor-pointer flex items-center gap-1"
                title="Añadir componente al clúster"
              >
                <span>+</span> COMPONENTE
              </button>
            </div>
          </div>

          <div id="cluster-accordions-mount" class="flat-frame divide-y divide-[var(--line-hair)] overflow-hidden"></div>
        </div>

        <!-- Collapsible Section: Bitácora Abierta -->
        <div class="flat-frame overflow-hidden">
          <button
            id="cluster-notes-accordion-trigger"
            type="button"
            aria-expanded="${isNotesExpanded ? 'true' : 'false'}"
            class="w-full px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 hover:bg-[var(--bg-elevated)]/35 transition-colors cursor-pointer text-left"
          >
            <div class="flex items-center gap-2.5">
              <span class="w-1.5 h-1.5 rounded-full bg-[var(--accent-volt)]"></span>
              <span class="font-mono text-[11px] uppercase tracking-[0.14em] text-[var(--text-primary)] font-semibold">
                BITÁCORA ABIERTA
              </span>
            </div>

            <div class="flex items-center gap-3">
              <span id="cluster-notes-count-badge" class="font-mono text-[9px] uppercase tracking-wider text-[var(--text-secondary)] tabular-nums">
                —
              </span>
              <svg
                id="cluster-notes-chevron"
                class="w-3.5 h-3.5 text-[var(--text-secondary)] transition-transform duration-200 ${isNotesExpanded ? 'rotate-180 text-[var(--text-primary)]' : ''}"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
              >
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </button>

          <div id="cluster-notes-drawer" class="${isNotesExpanded ? '' : 'hidden'} border-t border-[var(--line-hair)]">
            <div id="cluster-notes-mount"></div>
          </div>
        </div>

      </div>
    `;

    const accordionsMount = container.querySelector('#cluster-accordions-mount');
    const addCompBtn = container.querySelector('#cluster-add-component-btn');
    const toggleAllBtn = container.querySelector('#cluster-toggle-all-btn');
    const syncBtn = container.querySelector('#cluster-sync-btn');
    const topOdoReadout = container.querySelector('#cluster-top-odo-readout');
    const topVoltageBtn = container.querySelector('#cluster-top-voltage-readout');
    const notesTrigger = container.querySelector('#cluster-notes-accordion-trigger');
    const notesDrawer = container.querySelector('#cluster-notes-drawer');
    const notesChevron = container.querySelector('#cluster-notes-chevron');

    const reloadAndPaint = async () => {
        items = await getMaintenanceItems();
        renderAccordions(container, items, currentOdo, gpsContext);
    };

    paintSyncPill(container);
    renderAccordions(container, items, currentOdo, gpsContext);
    updateNotesCountBadge(container);

    if (isNotesExpanded) {
        ensureNotesBoardMounted(container, false);
    }

    // Electrical health & physical wear modal trigger
    topVoltageBtn?.addEventListener('click', () => {
        playHorologyTick(1200, 0.012, 0.02);
        window.dispatchEvent(new CustomEvent('octane:open-gps-intelligence', { detail: { tab: 'health' } }));
    });

    // Manual cloud sync verification click
    syncBtn?.addEventListener('click', async () => {
        const s = store.getState();
        playHorologyTick(1200, 0.012, 0.025);
        if (!s.user) {
            showToast('INICIA SESIÓN EN AJUSTES PARA SINCRONIZAR');
            return;
        }
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            showToast('SIN CONEXIÓN · GUARDADO EN ESTE DISPOSITIVO');
            return;
        }
        await pullFromCloud({ silent: false });
        await syncToCloud();
        await reloadAndPaint();
    });

    // Expand / Collapse All categories
    toggleAllBtn?.addEventListener('click', () => {
        playHorologyTick(1100, 0.012, 0.02);
        const allOpen = toggleAllBtn.getAttribute('data-all-open') === 'true';
        const catalog = buildGroupedCatalog(items, currentOdo, gpsContext);
        if (allOpen) {
            expandedGroups.clear();
        } else {
            catalog.groups.forEach((g) => expandedGroups.add(g.id));
        }
        renderAccordions(container, items, currentOdo, gpsContext);
    });

    // Accordions & Component Actions Event Delegation
    accordionsMount?.addEventListener('click', (e) => {
        const toggleBtn = e.target.closest('[data-action="toggle-group"]');
        if (toggleBtn) {
            const groupId = toggleBtn.getAttribute('data-group-id');
            if (groupId) {
                playHorologyTick(1100, 0.012, 0.02);
                if (expandedGroups.has(groupId)) expandedGroups.delete(groupId);
                else expandedGroups.add(groupId);
                renderAccordions(container, items, currentOdo, gpsContext);
            }
            return;
        }

        const editBtn = e.target.closest('[data-action="edit"]');
        if (editBtn) {
            const itemId = editBtn.getAttribute('data-id');
            const targetItem = items.find((i) => i.id === itemId);
            if (targetItem) {
                openEditComponentModal({
                    item: targetItem,
                    onSave: reloadAndPaint,
                    onDelete: reloadAndPaint,
                });
            }
            return;
        }

        const registerBtn = e.target.closest('[data-action="register"], [data-action="reset"]');
        if (registerBtn) {
            const itemId = registerBtn.getAttribute('data-id');
            const targetItem = items.find((i) => i.id === itemId);
            if (targetItem) {
                openRegisterServiceModal({
                    item: targetItem,
                    currentOdo,
                    onSave: async (savedItem) => {
                        expandedGroups.add(resolveMaintenanceGroup(savedItem));
                        await reloadAndPaint();
                    },
                });
            }
            return;
        }

        const historyBtn = e.target.closest('[data-action="history"]');
        if (historyBtn) {
            const itemId = historyBtn.getAttribute('data-id');
            const targetItem = items.find((i) => i.id === itemId);
            if (targetItem) {
                openHistoryMaintenanceModal({
                    item: targetItem,
                    currentOdo,
                    onRegister: () => {
                        openRegisterServiceModal({
                            item: targetItem,
                            currentOdo,
                            onSave: reloadAndPaint,
                        });
                    },
                    onDelete: reloadAndPaint,
                    onSave: reloadAndPaint,
                });
            }
        }
    });

    // Add Component Button
    addCompBtn?.addEventListener('click', () => {
        openAddComponentModal({
            currentOdo,
            onSave: async (newItem) => {
                if (newItem) expandedGroups.add(resolveMaintenanceGroup(newItem));
                await reloadAndPaint();
            },
        });
    });

    // Collapsible Bitácora Abierta Trigger
    notesTrigger?.addEventListener('click', async () => {
        playHorologyTick(1100, 0.012, 0.02);
        isNotesExpanded = !isNotesExpanded;
        notesTrigger.setAttribute('aria-expanded', isNotesExpanded ? 'true' : 'false');
        notesDrawer?.classList.toggle('hidden', !isNotesExpanded);
        notesChevron?.classList.toggle('rotate-180', isNotesExpanded);
        notesChevron?.classList.toggle('text-[var(--text-primary)]', isNotesExpanded);
        if (isNotesExpanded) {
            await ensureNotesBoardMounted(container, false);
        }
    });

    const onFocusNote = async () => {
        isNotesExpanded = true;
        notesTrigger?.setAttribute('aria-expanded', 'true');
        notesDrawer?.classList.remove('hidden');
        notesChevron?.classList.add('rotate-180', 'text-[var(--text-primary)]');
        await ensureNotesBoardMounted(container, true);
    };
    const onMaintUpdated = async () => {
        if (!currentActiveContainer) return;
        await reloadAndPaint();
    };
    const onNotesUpdated = () => {
        if (!currentActiveContainer) return;
        updateNotesCountBadge(container);
    };
    const onOnlineOffline = () => paintSyncPill(container);

    window.addEventListener('octane:focus-note', onFocusNote);
    window.addEventListener('octane:maintenance-updated', onMaintUpdated);
    window.addEventListener('octane:notes-changed', onNotesUpdated);
    window.addEventListener('online', onOnlineOffline);
    window.addEventListener('offline', onOnlineOffline);

    boundWindowCleanups.push(
        () => window.removeEventListener('octane:focus-note', onFocusNote),
        () => window.removeEventListener('octane:maintenance-updated', onMaintUpdated),
        () => window.removeEventListener('octane:notes-changed', onNotesUpdated),
        () => window.removeEventListener('online', onOnlineOffline),
        () => window.removeEventListener('offline', onOnlineOffline)
    );

    // Reactive Store Subscription
    storeUnsubscribe = store.subscribe((newState, prevState) => {
        if (!currentActiveContainer) return;

        let odoChanged = false;
        let itemsChanged = false;
        let profileChanged = false;

        if (newState.syncStatus !== prevState.syncStatus || newState.user !== prevState.user) {
            paintSyncPill(container);
        }

        if (newState.telemetryLogs !== prevState.telemetryLogs || newState.vehicleProfile !== prevState.vehicleProfile) {
            const newOdo = getCurrentOdometer(newState.telemetryLogs || [], newState.vehicleProfile);
            if (newOdo !== currentOdo) {
                currentOdo = newOdo;
                odoChanged = true;
            }
            if (newState.vehicleProfile !== prevState.vehicleProfile) {
                gpsContext = buildClusterGpsContext(newState.vehicleProfile);
                profileChanged = true;
            }
            const voltEl = container.querySelector('#cluster-top-voltage-readout');
            const voltSep = container.querySelector('#cluster-top-voltage-sep');
            const nextTrigger = formatClusterBatteryTrigger(newState.vehicleProfile);
            if (voltEl) {
                voltEl.textContent = nextTrigger.text;
                voltEl.className = `${nextTrigger.visible ? '' : 'hidden '}tabular-nums cursor-pointer hover:opacity-80 transition-opacity ${nextTrigger.colorClass}`;
            }
            if (voltSep) {
                voltSep.className = `${nextTrigger.visible ? '' : 'hidden '}text-[var(--line-strong)]`;
            }
        }

        if (newState.maintenanceItems !== prevState.maintenanceItems && Array.isArray(newState.maintenanceItems)) {
            items = newState.maintenanceItems;
            itemsChanged = true;
        }

        if (odoChanged || itemsChanged || profileChanged) {
            if (topOdoReadout) {
                topOdoReadout.textContent = `${currentOdo.toLocaleString('es-CO')} KM`;
            }
            renderAccordions(container, items, currentOdo, gpsContext);
        }
    });
}
