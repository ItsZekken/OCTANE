/**
 * OCTANE — Popup de Nueva Versión ("modal-release-notes.js")
 *
 * Presenta los cambios recientes en lenguaje humano, claro y breve:
 * - Aparece una única vez por versión instalada.
 * - Se cierra inmediatamente al tocar en cualquier parte de la pantalla.
 * - Armonía total en Modo Carbón y Modo Papel (superficie plana, hairlines de 1px, cero cajas anidadas).
 */

import { playHorologyTick } from '../../core/state.js';
import {
  getCurrentRelease,
  shouldShowReleaseNotes,
  markReleaseNotesSeen
} from '../../core/release-notes.js';
import {
  pushOverlayLayer,
  removeOverlayLayer
} from '../../core/navigation-manager.js';

const ROOT_ID = 'octane-release-notes-modal';
const LAYER_ID = 'modal:release-notes';

let modalRoot = null;
let isOpen = false;
let dismissTimer = null;

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function ensureRoot() {
  if (typeof document === 'undefined') return null;
  const existing = document.getElementById(ROOT_ID);
  if (existing) {
    modalRoot = existing;
    return modalRoot;
  }

  modalRoot = document.createElement('div');
  modalRoot.id = ROOT_ID;
  modalRoot.className = 'fixed inset-0 z-[70] hidden select-none cursor-pointer';
  document.body.appendChild(modalRoot);
  return modalRoot;
}

/**
 * Formats YYYY-MM-DD into a short human date in Spanish (e.g. "26 nov 2026").
 * @param {string} dateStr
 * @returns {string}
 */
function formatReleaseDate(dateStr) {
  if (!dateStr) return '';
  const parts = String(dateStr).slice(0, 10).split('-');
  if (parts.length !== 3) return String(dateStr);
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const day = parseInt(parts[2], 10);
  const month = months[parseInt(parts[1], 10) - 1] || '';
  return `${day} ${month} ${parts[0]}`;
}

/**
 * Closes the release notes popup smoothly.
 */
export function closeReleaseNotesModal() {
  if (!isOpen && (!modalRoot || modalRoot.classList.contains('hidden'))) {
    removeOverlayLayer(LAYER_ID);
    return;
  }

  isOpen = false;
  removeOverlayLayer(LAYER_ID);

  if (dismissTimer) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }

  if (!modalRoot) return;

  playHorologyTick(900, 0.012, 0.02);

  const backdrop = modalRoot.querySelector('#release-notes-backdrop');
  const card = modalRoot.querySelector('#release-notes-card');
  if (backdrop) {
    backdrop.classList.remove('opacity-100');
    backdrop.classList.add('opacity-0');
  }
  if (card) {
    card.classList.remove('opacity-100', 'scale-100', 'translate-y-0');
    card.classList.add('opacity-0', 'scale-[0.97]', 'translate-y-2');
  }

  dismissTimer = setTimeout(() => {
    dismissTimer = null;
    if (!isOpen && modalRoot) {
      modalRoot.classList.add('hidden');
      modalRoot.innerHTML = '';
    }
  }, 180);
}

/**
 * Opens the release notes popup for the current (or provided) release.
 * Tapping anywhere inside or outside the card dismisses it cleanly.
 *
 * @param {Object} [options={}]
 * @param {Object} [options.release] - Optional release override
 * @param {boolean} [options.markSeen=true] - Persist seen state for this version
 */
export function openReleaseNotesModal(options = {}) {
  const root = ensureRoot();
  if (!root) return;

  const release = options.release || getCurrentRelease();
  if (!release || !Array.isArray(release.highlights) || release.highlights.length === 0) return;

  if (dismissTimer) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }

  if (options.markSeen !== false) {
    markReleaseNotesSeen(release.version);
  }

  const dateLabel = formatReleaseDate(release.date);

  root.innerHTML = `
    <div id="release-notes-backdrop" class="fixed inset-0 bg-black/75 backdrop-blur-[2px] opacity-0 transition-opacity duration-200"></div>

    <div class="fixed inset-0 z-10 flex items-center justify-center p-5 sm:p-6">
      <div
        id="release-notes-card"
        role="dialog"
        aria-modal="true"
        aria-label="${esc(release.title || 'Nueva versión')}"
        class="w-full max-w-md bg-[var(--bg-surface)] border border-[var(--line-strong)] text-[var(--text-primary)] overflow-hidden opacity-0 scale-[0.97] translate-y-2 transition-all duration-200 ease-out"
      >
        <div class="h-[2px] w-full bg-[var(--accent-amber)]"></div>

        <div class="px-6 pt-5 pb-4 border-b border-[var(--line-hair)] bg-[var(--bg-void)]">
          <div class="flex items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.2em]">
            <div class="flex items-center gap-2 text-[var(--accent-amber)] font-semibold">
              <span class="w-1.5 h-1.5 rounded-full bg-[var(--accent-amber)]"></span>
              <span>VERSIÓN ${esc(release.version)}</span>
            </div>
            ${dateLabel ? `<span class="text-[var(--text-muted)] tracking-[0.16em]">${esc(dateLabel)}</span>` : ''}
          </div>

          <h2 class="font-sans font-light text-2xl sm:text-[26px] tracking-tight text-[var(--text-primary)] leading-tight mt-2.5">
            ${esc(release.title || 'Nueva versión')}
          </h2>

          ${release.subtitle ? `
            <div class="font-sans text-xs text-[var(--text-secondary)] leading-relaxed mt-1">
              ${esc(release.subtitle)}
            </div>
          ` : ''}
        </div>

        <div class="px-6 py-4 divide-y divide-[var(--line-hair)] max-h-[55dvh] overflow-y-auto overscroll-contain">
          ${release.highlights.map((item) => `
            <div class="py-3 first:pt-1 last:pb-1 flex items-start gap-3">
              <span class="w-1.5 h-1.5 bg-[var(--accent-amber)] shrink-0 mt-1.5"></span>
              <span class="font-sans text-[13px] leading-relaxed text-[var(--text-primary)]">${esc(item)}</span>
            </div>
          `).join('')}
        </div>

        <div class="px-6 py-3 border-t border-[var(--line-hair)] bg-[var(--bg-void)] flex items-center justify-center">
          <span class="font-mono text-[9px] uppercase tracking-[0.22em] text-[var(--text-muted)]">
            TOCA EN CUALQUIER PARTE PARA CONTINUAR
          </span>
        </div>
      </div>
    </div>
  `;

  root.classList.remove('hidden');
  isOpen = true;

  playHorologyTick(1280, 0.014, 0.025);

  pushOverlayLayer(LAYER_ID, () => {
    closeReleaseNotesModal();
  });

  // Tap ANYWHERE on the overlay or card closes the popup immediately
  let armedAt = Date.now();
  const handleDismiss = (e) => {
    if (Date.now() - armedAt < 120) return;
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    closeReleaseNotesModal();
  };
  root.onclick = handleDismiss;

  requestAnimationFrame(() => {
    const backdrop = root.querySelector('#release-notes-backdrop');
    const card = root.querySelector('#release-notes-card');
    if (backdrop) {
      backdrop.classList.remove('opacity-0');
      backdrop.classList.add('opacity-100');
    }
    if (card) {
      card.classList.remove('opacity-0', 'scale-[0.97]', 'translate-y-2');
      card.classList.add('opacity-100', 'scale-100', 'translate-y-0');
    }
  });
}

/**
 * Checks on startup whether this release has not been presented yet; if so,
 * displays it once and persists acknowledgement so it will never reappear for this version.
 *
 * @param {Object} [options={}]
 * @param {boolean} [options.isFirstTimeOnboarding=false]
 * @param {number} [options.delayMs=280]
 * @returns {boolean} True if scheduled to show
 */
export function maybeShowReleaseNotes(options = {}) {
  const isOnboarding = Boolean(options.isFirstTimeOnboarding);
  if (isOnboarding) {
    // First-time users get onboarding instead of a "what changed" modal
    markReleaseNotesSeen();
    return false;
  }

  if (!shouldShowReleaseNotes({ isFirstTimeOnboarding: false })) {
    return false;
  }

  const delayMs = Number.isFinite(Number(options.delayMs)) ? Number(options.delayMs) : 280;
  if (delayMs <= 0) {
    openReleaseNotesModal({ markSeen: true });
  } else {
    setTimeout(() => {
      openReleaseNotesModal({ markSeen: true });
    }, delayMs);
  }
  return true;
}
