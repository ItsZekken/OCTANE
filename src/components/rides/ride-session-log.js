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

let activeContainer = null;
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
      renderRideSessionLog(activeContainer);
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
          <span class="font-mono text-[10px] text-[var(--text-secondary)] tabular-nums">
            (${totalCount})
          </span>
        </div>

        <div class="flex items-center gap-2">
          <button 
            id="btn-log-add-ride" 
            type="button" 
            class="h-7 px-2.5 border border-[var(--line-hair)] hover:border-[var(--accent-volt)] bg-[var(--bg-void)] hover:bg-[var(--bg-elevated)] font-mono text-[10px] uppercase font-semibold text-[var(--accent-volt)] flex items-center gap-1 transition-colors cursor-pointer"
          >
            <span>+ CARRERA</span>
          </button>
          
          <button 
            id="btn-log-add-expense" 
            type="button" 
            class="h-7 px-2.5 border border-[var(--line-hair)] hover:border-[var(--accent-crimson)] bg-[var(--bg-void)] hover:bg-[var(--bg-elevated)] font-mono text-[10px] uppercase font-semibold text-[var(--accent-crimson)] flex items-center gap-1 transition-colors cursor-pointer"
          >
            <span>- EGRESO</span>
          </button>
        </div>
      </div>

      <!-- Main Frame -->
      <div id="movements-list-frame" class="flat-frame bg-[var(--bg-surface)] border border-[var(--line-hair)] divide-y divide-[var(--line-hair)]">
        <!-- Rendered below -->
      </div>

    </div>
  `;

  // Bind Quick Add Buttons
  container.querySelector('#btn-log-add-ride')?.addEventListener('click', () => {
    playHorologyTick(1200, 0.015, 0.025);
    openRideEntryModal({
      mode: 'ride',
      onSave: () => {
        if (typeof options.onMovementChanged === 'function') options.onMovementChanged();
        renderRideSessionLog(container, options);
      }
    });
  });

  container.querySelector('#btn-log-add-expense')?.addEventListener('click', () => {
    playHorologyTick(1200, 0.015, 0.025);
    openRideEntryModal({
      mode: 'expense',
      onSave: () => {
        if (typeof options.onMovementChanged === 'function') options.onMovementChanged();
        renderRideSessionLog(container, options);
      }
    });
  });

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
        <div class="font-sans font-light text-2xl tracking-tight text-[var(--text-muted)] my-2">
          NINGÚN REGISTRO EN ESTE CICLO
        </div>
        <div class="flex items-center gap-3 mt-3">
          <button 
            id="btn-empty-add-ride" 
            type="button" 
            class="h-9 px-4 bg-[var(--accent-volt)] hover:bg-[var(--accent-volt)]/90 text-[var(--bg-void)] font-mono text-[10px] font-semibold uppercase tracking-wider transition-colors cursor-pointer"
          >
            + REGISTRAR CARRERA
          </button>
          <button 
            id="btn-empty-add-expense" 
            type="button" 
            class="h-9 px-4 border border-[var(--line-hair)] hover:border-[var(--accent-crimson)] text-[var(--text-primary)] hover:text-[var(--accent-crimson)] bg-[var(--bg-void)] font-mono text-[10px] font-semibold uppercase tracking-wider transition-colors cursor-pointer"
          >
            - REGISTRAR EGRESO
          </button>
        </div>
      </div>
    `;

    frameEl.querySelector('#btn-empty-add-ride')?.addEventListener('click', () => {
      openRideEntryModal({
        mode: 'ride',
        onSave: () => {
          if (typeof options.onMovementChanged === 'function') options.onMovementChanged();
          renderRideSessionLog(container, options);
        }
      });
    });

    frameEl.querySelector('#btn-empty-add-expense')?.addEventListener('click', () => {
      openRideEntryModal({
        mode: 'expense',
        onSave: () => {
          if (typeof options.onMovementChanged === 'function') options.onMovementChanged();
          renderRideSessionLog(container, options);
        }
      });
    });
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
      <div class="movement-row p-3.5 sm:p-4 flex items-center justify-between gap-3 hover:bg-[var(--bg-elevated)]/25 transition-colors" data-id="${item.id}" data-store="${item.store}">
        
        <!-- Left: Macro Amount + Metadata -->
        <div class="min-w-0 space-y-1">
          <div class="flex items-center gap-2 flex-wrap">
            <!-- Amount -->
            <span class="font-sans font-light text-xl sm:text-2xl tracking-tight tabular-nums ${isRide ? 'text-[var(--accent-volt)]' : 'text-[var(--accent-crimson)]'} font-medium">
              ${amountFormatted}
            </span>

            <span class="text-[var(--line-strong)]">·</span>

            <!-- Distance or Concept -->
            ${isRide ? `
              <span class="font-mono text-xs tabular-nums text-[var(--text-primary)] font-semibold">
                ${Number(item.km).toFixed(1)} KM
              </span>
            ` : `
              <span class="font-mono text-xs uppercase text-[var(--text-primary)] font-semibold">
                ${escapeHtml(item.concept || 'DEDUCCIÓN')}
              </span>
            `}

            <!-- Badge En ruta vs Libre -->
            ${isRide ? (
              item.isEnRoute 
                ? `<span class="px-1.5 py-0.5 border border-[var(--accent-volt)]/40 bg-[var(--accent-volt)]/10 text-[var(--accent-volt)] font-mono text-[9px] uppercase tracking-wider">EN RUTA</span>`
                : `<span class="px-1.5 py-0.5 border border-[var(--line-hair)] bg-[var(--bg-void)] text-[var(--text-secondary)] font-mono text-[9px] uppercase tracking-wider">LIBRE</span>`
            ) : ''}

            <!-- Platform Tag -->
            <span class="px-1.5 py-0.5 border border-[var(--line-hair)] bg-[var(--bg-void)] text-[var(--text-secondary)] font-mono text-[9px] uppercase tracking-wider">
              ${escapeHtml(item.platform || 'DIRECTO')}
            </span>
          </div>

          <!-- Subline: Date + Note if any -->
          <div class="flex items-center gap-2 font-mono text-[10px] text-[var(--text-secondary)] truncate">
            <span class="tabular-nums text-[var(--text-muted)]">${formattedDate}</span>
            ${item.notes ? `
              <span class="text-[var(--line-strong)]">·</span>
              <span class="text-[var(--text-muted)] truncate max-w-xs">${escapeHtml(item.notes)}</span>
            ` : ''}
          </div>
        </div>

        <!-- Right Actions: [EDITAR] and [ELIMINAR] -->
        <div class="flex items-center gap-2 shrink-0" data-actions-for="${item.id}">
          <button 
            type="button" 
            class="btn-edit-movement px-2.5 py-1 border border-[var(--line-hair)] hover:border-[var(--text-primary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] bg-[var(--bg-void)] font-mono text-[10px] uppercase transition-colors cursor-pointer"
          >
            EDITAR
          </button>
          
          <button 
            type="button" 
            class="btn-delete-movement px-2.5 py-1 border border-[var(--line-hair)] hover:border-[var(--accent-crimson)] text-[var(--text-secondary)] hover:text-[var(--accent-crimson)] bg-[var(--bg-void)] font-mono text-[10px] uppercase transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>

      </div>
    `;
  }).join('');

  // Bind Actions (Edit & Delete)
  const rows = frameEl.querySelectorAll('.movement-row');
  rows.forEach(row => {
    const id = row.dataset.id;
    const storeName = row.dataset.store;
    const movement = movements.find(m => m.id === id);
    if (!movement) return;

    // Edit
    const editBtn = row.querySelector('.btn-edit-movement');
    editBtn?.addEventListener('click', () => {
      playHorologyTick(1200, 0.015, 0.025);
      openRideEntryModal({
        mode: movement.type,
        item: movement.raw || movement,
        onSave: () => {
          if (typeof options.onMovementChanged === 'function') options.onMovementChanged();
          renderRideSessionLog(container, options);
        }
      });
    });

    // Delete with inline confirmation
    const delBtn = row.querySelector('.btn-delete-movement');
    delBtn?.addEventListener('click', () => {
      playHorologyTick(1000, 0.015, 0.02);
      const actionsEl = row.querySelector(`[data-actions-for="${id}"]`);
      if (!actionsEl) return;

      actionsEl.innerHTML = `
        <div class="flex items-center gap-1.5">
          <span class="text-[var(--accent-crimson)] font-mono text-[9px] font-bold">¿BORRAR?</span>
          <button 
            type="button" 
            class="btn-confirm-del px-2 py-0.5 bg-[var(--accent-crimson)] text-white hover:bg-[var(--accent-crimson)]/90 font-mono text-[9px] uppercase font-bold cursor-pointer"
          >
            SÍ
          </button>
          <button 
            type="button" 
            class="btn-cancel-del px-2 py-0.5 border border-[var(--line-hair)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-mono text-[9px] uppercase cursor-pointer"
          >
            NO
          </button>
        </div>
      `;

      actionsEl.querySelector('.btn-confirm-del')?.addEventListener('click', async () => {
        playHorologyTick(800, 0.025, 0.04);
        try {
          if (storeName === 'ride_sessions') {
            await deleteRideSession(id);
            showToast('CARRERA ELIMINADA');
          } else {
            await deletePlatformPass(id);
            showToast('EGRESO ELIMINADO');
          }
          window.dispatchEvent(new CustomEvent('octane:rides-updated', { detail: { deletedId: id } }));
          if (typeof options.onMovementChanged === 'function') options.onMovementChanged();
          renderRideSessionLog(container, options);
        } catch (err) {
          console.error('[OCTANE] Error deleting movement:', err);
          showToast('ERROR AL ELIMINAR');
        }
      });

      actionsEl.querySelector('.btn-cancel-del')?.addEventListener('click', () => {
        playHorologyTick(1100, 0.012, 0.02);
        renderRideSessionLog(container, options);
      });
    });
  });
}
