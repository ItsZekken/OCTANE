/**
 * OCTANE // KINETIC — Lista Unificada de Movimientos ("ride-session-log.js")
 * Bitácora cronológica pura donde conviven las carreras y las deducciones/egresos.
 * 
 * Formato unificado:
 * - Carrera: "+ $15.000 · 8.3 km · En ruta · [Plataforma] · Fecha"
 * - Egreso:  "- $10.500 · Comisión/Tarifa · [Plataforma] · Fecha"
 * - Acciones: [EDITAR] y [ELIMINAR] con confirmación táctil inline.
 * 
 * Silencio Verbal Absoluto: Prohibidos <p> tags, únicamente micro-labels y macro-números.
 */

import { playHorologyTick, showToast } from '../../core/state.js';
import {
  getRideSessions,
  deleteRideSession,
  getPlatformPasses,
  deletePlatformPass
} from '../../core/db-local.js';
import { formatDateShort } from '../../core/telemetry-engine.js';
import { openRideEntryModal } from '../modals/modal-ride-entry.js';
import { openMovementDetailModal } from '../modals/modal-movement-detail.js';
import { syncToCloud } from '../../core/firebase-sync.js';

let activeContainer = null;
let lastRenderOptions = {};
let updateListenerAttached = false;

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
 * Normalizes and merges sessions and passes into a single chronological array.
 * @param {Array} sessions
 * @param {Array} passes
 * @param {string|null} [startDate=null]
 * @param {string|null} [endDate=null]
 * @returns {Array<Object>}
 */
export function normalizeMovements(sessions = [], passes = [], startDate = null, endDate = null) {
  const list = [];

  (sessions || []).forEach(s => {
    if (!s) return;
    const dateStr = String(s.date || '').slice(0, 10);
    if (!dateStr) return;

    if (startDate && endDate && (dateStr < startDate || dateStr > endDate)) {
      return;
    }

    // Individual ride or summary session
    if (Array.isArray(s.rides) && s.rides.length > 0) {
      s.rides.forEach(r => {
        const fare = Number(r.fareCop || r.netValue || 0);
        const km = Number(r.distanceKm || r.km || 0);
        const isEnRoute = Boolean(r.isEnRoute || r.tripType === 'en_route');
        list.push({
          id: r.id || s.id,
          parentId: s.id,
          store: 'ride_sessions',
          type: 'ride',
          date: dateStr,
          amountCop: fare,
          km: km,
          isEnRoute: isEnRoute,
          platform: r.app || s.platform || 'Directo',
          notes: r.notes || s.notes || '',
          createdAt: s.createdAt || s.updatedAt || dateStr,
          raw: s
        });
      });
    } else {
      const fare = Number(s.grossEarnings || s.grossRevenueCop || s.grossIncomeCop || s.fareCop || 0);
      const km = Number(s.workKm || s.distanceKm || s.tripKmTotal || 0);
      const isEnRoute = Boolean(s.isEnRoute || s.tripType === 'en_route');
      list.push({
        id: s.id,
        store: 'ride_sessions',
        type: 'ride',
        date: dateStr,
        amountCop: fare,
        km: km,
        isEnRoute: isEnRoute,
        platform: s.platform || 'Directo',
        notes: s.notes || '',
        createdAt: s.createdAt || s.updatedAt || dateStr,
        raw: s
      });
    }
  });

  (passes || []).forEach(p => {
    if (!p) return;
    const dateStr = String(p.date || p.startDate || '').slice(0, 10);
    if (!dateStr) return;

    if (startDate && endDate && (dateStr < startDate || dateStr > endDate)) {
      return;
    }

    const amount = Number(p.amountCop || p.costCop || 0);
    list.push({
      id: p.id,
      store: 'platform_passes',
      type: 'expense',
      date: dateStr,
      amountCop: amount,
      km: 0,
      isEnRoute: false,
      platform: p.platform || p.concept || 'General',
      concept: p.concept || p.platform || 'Deducción',
      notes: p.notes || '',
      createdAt: p.createdAt || p.updatedAt || dateStr,
      raw: p
    });
  });

  // Sort chronologically descending (newest first)
  list.sort((a, b) => {
    const da = String(a.date).slice(0, 10);
    const db = String(b.date).slice(0, 10);
    if (da !== db) return db.localeCompare(da);
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  });

  return list;
}

/**
 * Initializes the global update listener for the movements list.
 */
export function initRideSessionLog() {
  if (updateListenerAttached) return;
  updateListenerAttached = true;

  window.addEventListener('octane:rides-updated', () => {
    if (activeContainer && document.body.contains(activeContainer)) {
      renderRideSessionLog(activeContainer, lastRenderOptions);
    }
  });
}

/**
 * Renders the Unified Movements List (Carreras + Egresos).
 * @param {HTMLElement} container
 * @param {Object} [options]
 * @param {Array} [options.sessions]
 * @param {Array} [options.passes]
 * @param {string} [options.startDate]
 * @param {string} [options.endDate]
 * @param {Function} [options.onMovementChanged]
 */
export async function renderRideSessionLog(container, options = {}) {
  if (!container) return;
  activeContainer = container;
  lastRenderOptions = { ...options };
  initRideSessionLog();

  let sessions = options.sessions;
  let passes = options.passes;

  if (!sessions || !passes) {
    try {
      const [dbSessions, dbPasses] = await Promise.all([
        getRideSessions().catch(() => []),
        getPlatformPasses().catch(() => [])
      ]);
      if (!sessions) sessions = dbSessions;
      if (!passes) passes = dbPasses;
    } catch (_) {
      sessions = sessions || [];
      passes = passes || [];
    }
  }

  const movements = normalizeMovements(sessions, passes, options.startDate, options.endDate);
  const totalCount = movements.length;

  container.innerHTML = `
    <div class="space-y-3 select-none">
      
      <!-- Section Bar -->
      <div class="flex items-center justify-between border-b border-[var(--line-hair)] pb-2.5">
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 bg-[var(--accent-volt)]"></span>
          <span class="font-mono text-xs uppercase tracking-widest text-[var(--text-primary)] font-semibold">
            MOVIMIENTOS
          </span>
        </div>
        <span class="font-mono text-[10px] text-[var(--text-secondary)] uppercase tracking-widest tabular-nums">
          ${totalCount} ${totalCount === 1 ? 'REGISTRO' : 'REGISTROS'}
        </span>
      </div>

      <!-- Main Frame -->
      <div id="movements-list-frame" class="flat-frame bg-[var(--bg-surface)] border border-[var(--line-hair)] divide-y divide-[var(--line-hair)]">
        <!-- Rendered below -->
      </div>

    </div>
  `;

  const frameEl = container.querySelector('#movements-list-frame');
  if (!frameEl) return;

  // Render Empty State
  if (totalCount === 0) {
    frameEl.className = 'flat-frame bg-[var(--bg-surface)] border border-[var(--line-hair)]';
    frameEl.innerHTML = `
      <div class="p-8 sm:p-10 flex flex-col items-center justify-center text-center">
        <span class="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)] mb-1">
          SIN MOVIMIENTOS
        </span>
        <div class="font-sans font-light text-2xl tracking-tight text-[var(--text-muted)] my-1">
          NINGÚN REGISTRO EN ESTE PERIODO
        </div>
      </div>
    `;
    return;
  }

  // Render Movements Rows
  frameEl.innerHTML = movements.map(item => {
    const isRide = item.type === 'ride';
    const formattedDate = formatDateShort(item.date);
    const amountFormatted = isRide 
      ? `+$${Number(item.amountCop).toLocaleString('es-CO')}`
      : `-$${Number(item.amountCop).toLocaleString('es-CO')}`;

    return `
      <div 
        class="movement-row p-3 sm:p-3.5 flex flex-col gap-1.5 hover:bg-[var(--bg-elevated)]/30 active:bg-[var(--bg-elevated)]/50 transition-colors cursor-pointer" 
        data-id="${item.id}" 
        data-store="${item.store}"
      >
        <!-- Line 1: Primary Metrics & Status / Action -->
        <div class="flex items-center justify-between gap-2">
          
          <!-- Left: Amount + Concept/Distance -->
          <div class="flex items-center gap-2 min-w-0">
            <span class="font-sans font-light text-lg sm:text-xl tracking-tight tabular-nums ${isRide ? 'text-[var(--accent-volt)]' : 'text-[var(--accent-crimson)]'} font-semibold">
              ${amountFormatted}
            </span>

            <span class="text-[var(--line-strong)] text-xs">·</span>

            ${isRide ? `
              <span class="font-mono text-xs tabular-nums text-[var(--text-primary)] font-semibold">
                ${Number(item.km).toFixed(1)} KM
              </span>
            ` : `
              <span class="font-mono text-xs uppercase text-[var(--text-primary)] font-semibold truncate">
                ${escapeHtml(item.concept || 'DEDUCCIÓN')}
              </span>
            `}
          </div>

          <!-- Right: Fixed Trajectory Badge -->
          <div class="flex items-center shrink-0">
            <!-- Trajectory Badge (Distinct geometry & colors, separate from platforms) -->
            ${isRide ? (
              item.isEnRoute ? `
                <span class="px-2 py-0.5 border border-[var(--accent-volt)]/40 bg-[var(--accent-volt)]/10 text-[var(--accent-volt)] font-mono text-[9px] uppercase tracking-wider font-semibold inline-flex items-center gap-1.5">
                  <span class="w-1.5 h-1.5 bg-[var(--accent-volt)]"></span>
                  EN RUTA
                </span>
              ` : `
                <span class="px-2 py-0.5 border border-[var(--line-strong)] bg-transparent text-[var(--text-secondary)] font-mono text-[9px] uppercase tracking-wider inline-flex items-center gap-1.5 font-medium">
                  <span class="w-1.5 h-1.5 border border-[var(--text-secondary)]"></span>
                  LIBRE
                </span>
              `
            ) : `
              <span class="px-2 py-0.5 border border-[var(--accent-crimson)]/30 bg-[var(--accent-crimson)]/10 text-[var(--accent-crimson)] font-mono text-[9px] uppercase tracking-wider font-semibold inline-flex items-center gap-1.5">
                <span class="w-1.5 h-1.5 bg-[var(--accent-crimson)]"></span>
                EGRESO
              </span>
            `}
          </div>

        </div>

        <!-- Line 2: Entity Platform Tag + Date + Note Snippet -->
        <div class="flex items-center gap-2 font-mono text-[10px] text-[var(--text-secondary)] min-w-0">
          <span class="tabular-nums text-[var(--text-muted)] shrink-0">${formattedDate}</span>
          
          <span class="text-[var(--line-strong)]">·</span>

          <!-- Platform Entity Chip -->
          <span class="px-1.5 py-0.2 border border-[var(--line-hair)] bg-[var(--bg-void)] text-[var(--text-primary)] font-mono text-[9px] uppercase tracking-wider font-medium shrink-0">
            ${escapeHtml(item.platform || 'DIRECTO')}
          </span>

          ${item.notes ? `
            <span class="text-[var(--line-strong)]">·</span>
            <span class="text-[var(--text-muted)] italic truncate max-w-[180px] sm:max-w-md">
              ${escapeHtml(item.notes)}
            </span>
          ` : ''}
        </div>

      </div>
    `;
  }).join('');

  // Bind Row Click -> Open Minimalist Detail Modal (with Edit/Delete flow inside)
  const rows = frameEl.querySelectorAll('.movement-row');
  rows.forEach(row => {
    const id = row.dataset.id;
    const movement = movements.find(m => m.id === id);
    if (!movement) return;

    // Row Click: opens the Minimalist Movement Detail Modal
    row.addEventListener('click', () => {
      openMovementDetailModal(movement, {
        onMovementChanged: () => {
          if (typeof options.onMovementChanged === 'function') options.onMovementChanged();
          renderRideSessionLog(container, options);
        }
      });
    });
  });
}
