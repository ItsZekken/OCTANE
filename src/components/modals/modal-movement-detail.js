/**
 * OCTANE // KINETIC — Modal de Detalle de Movimiento ("modal-movement-detail.js")
 * Minimalist Inspection Modal for Ride / Expense Records (Swiss / Horology aesthetic).
 * 
 * Rules:
 * - Zero <p> tags.
 * - Flat 1px hairlines, zero blur, zero heavy shadows.
 * - Full detail display including attached notes without truncation.
 * - Direct transition to edit mode via "EDITAR MOVIMIENTO".
 */

import { playHorologyTick } from '../../core/state.js';
import { formatDateShort } from '../../core/telemetry-engine.js';
import { openRideEntryModal } from './modal-ride-entry.js';

let modalRootEl = null;

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
 * Formats full date in Spanish (e.g. "26 de Octubre, 2026")
 * @param {string} dateStr
 * @returns {string}
 */
function formatFullDate(dateStr) {
  if (!dateStr) return '';
  try {
    const parts = dateStr.slice(0, 10).split('-');
    if (parts.length === 3) {
      const year = parts[0];
      const monthIdx = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
      return `${day} de ${months[monthIdx] || ''}, ${year}`;
    }
  } catch (_) {}
  return dateStr;
}

/**
 * Initializes singleton container for the detail modal.
 */
export function initMovementDetailModal() {
  if (document.getElementById('octane-movement-detail-modal-container')) {
    modalRootEl = document.getElementById('octane-movement-detail-modal-container');
    return modalRootEl;
  }

  modalRootEl = document.createElement('div');
  modalRootEl.id = 'octane-movement-detail-modal-container';
  modalRootEl.className = 'fixed inset-0 z-50 hidden select-none';
  document.body.appendChild(modalRootEl);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalRootEl && !modalRootEl.classList.contains('hidden')) {
      closeMovementDetailModal();
    }
  });

  return modalRootEl;
}

/**
 * Closes the detail modal.
 */
export function closeMovementDetailModal() {
  if (!modalRootEl) return;
  modalRootEl.classList.add('hidden');
  modalRootEl.innerHTML = '';
}

/**
 * Opens the Minimalist Movement Detail Modal.
 * @param {Object} movement - Normalized movement item
 * @param {Object} [options] - Optional callbacks
 * @param {Function} [options.onMovementChanged] - Callback when movement edited or deleted
 */
export function openMovementDetailModal(movement, options = {}) {
  initMovementDetailModal();
  playHorologyTick(1200, 0.015, 0.025);

  const isRide = movement.type === 'ride';
  const amountFormatted = isRide 
    ? `+$${Number(movement.amountCop || 0).toLocaleString('es-CO')}`
    : `-$${Number(movement.amountCop || 0).toLocaleString('es-CO')}`;

  const fullDate = formatFullDate(movement.date);
  const titleText = isRide ? 'DETALLE DE CARRERA' : 'DETALLE DE EGRESO';

  modalRootEl.innerHTML = `
    <!-- Backdrop Overlay -->
    <div id="detail-modal-backdrop" class="fixed inset-0 bg-black/85 transition-opacity duration-150"></div>

    <!-- Modal Dialog Frame -->
    <div class="fixed inset-0 overflow-y-auto flex items-end sm:items-center justify-center p-0 sm:p-4 z-10">
      <div class="relative w-full max-w-sm sm:max-w-md bg-[var(--bg-surface)] border-t sm:border border-[var(--line-hair)] text-[var(--text-primary)] rounded-t-sm sm:rounded-none flex flex-col max-h-[96vh] sm:max-h-[90vh] overflow-hidden shadow-none">
        
        <!-- Header Directo -->
        <header class="flex items-center justify-between px-4 h-12 border-b border-[var(--line-hair)] bg-[var(--bg-void)] shrink-0">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 ${isRide ? 'bg-[var(--accent-volt)]' : 'bg-[var(--accent-crimson)]'}"></span>
            <span class="font-mono text-xs tracking-widest uppercase font-semibold">
              ${titleText}
            </span>
          </div>
          
          <button id="detail-close-btn" type="button" class="w-8 h-8 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer" title="Cerrar">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        <!-- Body Scrollable -->
        <div class="overflow-y-auto flex-1 divide-y divide-[var(--line-hair)]">
          
          <!-- Hero Section: Valor Macro -->
          <div class="p-6 bg-[var(--bg-void)] flex flex-col items-center justify-center text-center">
            <span class="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)] mb-1">
              ${isRide ? 'VALOR BRUTO DE LA CARRERA' : 'MONTO DEDUCIDO'}
            </span>
            <div class="font-sans font-light text-5xl tracking-tighter tabular-nums ${isRide ? 'text-[var(--accent-volt)]' : 'text-[var(--accent-crimson)]'} font-medium">
              ${amountFormatted}
            </div>

            <!-- Trajectory or Concept Tag -->
            <div class="mt-3 flex items-center gap-2">
              ${isRide ? (
                movement.isEnRoute ? `
                  <span class="px-2.5 py-0.5 border border-[var(--accent-volt)]/50 bg-[var(--accent-volt)]/15 text-[var(--accent-volt)] font-mono text-[10px] uppercase font-bold tracking-wider inline-flex items-center gap-1.5">
                    <span class="w-1.5 h-1.5 bg-[var(--accent-volt)]"></span>
                    EN RUTA
                  </span>
                ` : `
                  <span class="px-2.5 py-0.5 border border-[var(--line-hair)] bg-[var(--bg-surface)] text-[var(--text-secondary)] font-mono text-[10px] uppercase font-semibold tracking-wider inline-flex items-center gap-1.5">
                    <span class="w-1.5 h-1.5 border border-[var(--text-secondary)]"></span>
                    LIBRE
                  </span>
                `
              ) : `
                <span class="px-2.5 py-0.5 border border-[var(--accent-crimson)]/50 bg-[var(--accent-crimson)]/15 text-[var(--accent-crimson)] font-mono text-[10px] uppercase font-bold tracking-wider inline-flex items-center gap-1.5">
                  <span class="w-1.5 h-1.5 bg-[var(--accent-crimson)]"></span>
                  ${escapeHtml(movement.concept || 'DEDUCCIÓN')}
                </span>
              `}

              <!-- Platform Chip -->
              <span class="px-2.5 py-0.5 border border-[var(--line-hair)] bg-[var(--bg-surface)] font-mono text-[10px] uppercase tracking-wider text-[var(--text-primary)] font-medium">
                ${escapeHtml(movement.platform || 'DIRECTO')}
              </span>
            </div>
          </div>

          <!-- Spec Matrix (Hairline 1px) -->
          <div class="grid grid-cols-2 divide-x divide-[var(--line-hair)] bg-[var(--bg-surface)] font-mono text-xs">
            <!-- Fecha -->
            <div class="p-3.5 space-y-1">
              <span class="text-[9px] uppercase tracking-wider text-[var(--text-secondary)] block">FECHA${movement.time ? ' Y HORA' : ''}</span>
              <div class="text-[var(--text-primary)] font-medium tabular-nums">${fullDate}${movement.time ? ` · ${escapeHtml(movement.time)}` : ''}</div>
            </div>

            <!-- Distancia -->
            <div class="p-3.5 space-y-1">
              <span class="text-[9px] uppercase tracking-wider text-[var(--text-secondary)] block">DISTANCIA</span>
              <div class="text-[var(--text-primary)] font-medium tabular-nums">
                ${isRide ? `${Number(movement.km || 0).toFixed(1)} KM` : 'N/A'}
              </div>
            </div>
          </div>

          <!-- Secondary Row: Trajectory Details -->
          <div class="p-3.5 bg-[var(--bg-surface)] font-mono text-xs space-y-1">
            <span class="text-[9px] uppercase tracking-wider text-[var(--text-secondary)] block">DESCRIPCIÓN OPERATIVA</span>
            <div class="text-[var(--text-secondary)] text-[11px] leading-relaxed">
              ${isRide ? (
                movement.isEnRoute
                  ? 'Carrera en ruta habitual de regreso/desplazamiento. Gasolina cubierta dentro de la cuota diaria programada ($0 marginal).'
                  : 'Carrera libre comercial. Genera consumo marginal proporcional a la distancia recorrida.'
              ) : 'Egreso de operación o comisión de plataforma deducido de las utilidades libres del ciclo.'}
            </div>
          </div>

          <!-- Nota Adjunta Section -->
          <div class="p-4 bg-[var(--bg-surface)] space-y-2">
            <div class="flex items-center justify-between font-mono text-[9px] uppercase tracking-wider text-[var(--text-secondary)]">
              <span>NOTA ADJUNTA</span>
              <span class="text-[var(--text-muted)]">${movement.notes ? 'BITÁCORA' : 'SIN NOTA'}</span>
            </div>
            
            ${movement.notes ? `
              <div class="p-3 bg-[var(--bg-void)] border border-[var(--line-hair)] font-mono text-xs text-[var(--text-primary)] leading-relaxed select-text">
                ${escapeHtml(movement.notes)}
              </div>
            ` : `
              <div class="p-3 bg-[var(--bg-void)]/50 border border-dashed border-[var(--line-hair)] font-mono text-[11px] text-[var(--text-muted)] italic text-center">
                Sin notas registradas para este movimiento.
              </div>
            `}
          </div>

        </div>

        <!-- Bottom Action Bar -->
        <div class="grid grid-cols-12 divide-x divide-[var(--line-hair)] border-t border-[var(--line-hair)] shrink-0 bg-[var(--bg-void)]">
          <button 
            id="detail-close-btn-bottom" 
            type="button" 
            class="col-span-4 h-12 bg-transparent hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-mono text-xs uppercase tracking-wider font-semibold flex items-center justify-center cursor-pointer transition-colors"
          >
            VOLVER
          </button>
          <button 
            id="detail-edit-action-btn" 
            type="button" 
            class="col-span-8 h-12 bg-[var(--accent-volt)] text-[var(--bg-void)] hover:bg-[var(--accent-volt)]/90 font-mono text-xs font-semibold uppercase tracking-widest transition-opacity flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
            <span>EDITAR MOVIMIENTO</span>
          </button>
        </div>

      </div>
    </div>
  `;

  modalRootEl.classList.remove('hidden');

  // Bind close buttons
  modalRootEl.querySelector('#detail-close-btn')?.addEventListener('click', () => {
    playHorologyTick(900, 0.015, 0.02);
    closeMovementDetailModal();
  });

  modalRootEl.querySelector('#detail-close-btn-bottom')?.addEventListener('click', () => {
    playHorologyTick(900, 0.015, 0.02);
    closeMovementDetailModal();
  });

  modalRootEl.querySelector('#detail-modal-backdrop')?.addEventListener('click', () => {
    closeMovementDetailModal();
  });

  // Bind Edit Button
  modalRootEl.querySelector('#detail-edit-action-btn')?.addEventListener('click', () => {
    playHorologyTick(1400, 0.018, 0.035);
    closeMovementDetailModal();
    openRideEntryModal({
      mode: movement.type,
      item: movement.raw || movement,
      onSave: (saved) => {
        if (typeof options.onMovementChanged === 'function') {
          options.onMovementChanged(saved);
        }
      },
      onDelete: (deleted) => {
        if (typeof options.onMovementChanged === 'function') {
          options.onMovementChanged(null);
        }
      }
    });
  });
}
