/**
 * OCTANE — Diálogos propios (reemplazo de window.confirm / window.prompt).
 * Estilo plano: hairlines, mono, un único contenedor, sin párrafos.
 *
 *   await confirmDialog({ title: '¿Eliminar esta nota?', danger: true })  -> boolean
 *   await promptDialog({ label: 'Nueva categoría', maxLength: 15 })        -> string | null
 */

import { playHorologyTick } from '../../core/state.js';

const ROOT_ID = 'octane-app-dialog';
let pendingResolve = null;

function getRoot() {
  let el = document.getElementById(ROOT_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = ROOT_ID;
    el.className = 'fixed inset-0 z-[60] hidden select-none';
    document.body.appendChild(el);
  }
  return el;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Cierra el diálogo abierto resolviendo con el valor de cancelación.
 * También lo usa el botón atrás del navegador (ver main.js).
 */
export function closeAppDialog() {
  const root = document.getElementById(ROOT_ID);
  if (root) {
    root.classList.add('hidden');
    root.innerHTML = '';
  }
  if (pendingResolve) {
    const r = pendingResolve;
    pendingResolve = null;
    r.cleanup && r.cleanup();
    r.resolve(r.cancelValue);
  }
}

function open({ title, bodyHtml, confirmLabel, danger, cancelValue, readValue }) {
  // Un diálogo a la vez: cancela el anterior si quedó abierto
  if (pendingResolve) closeAppDialog();

  return new Promise((resolve) => {
    const root = getRoot();
    const accent = danger ? 'var(--accent-crimson)' : 'var(--accent-amber)';
    pendingResolve = { resolve, cancelValue, cleanup: () => document.removeEventListener('keydown', onKey, true) };

    root.innerHTML = `
      <div data-dialog-backdrop class="fixed inset-0 bg-black/85"></div>
      <div class="fixed inset-0 flex items-center justify-center p-4 z-10 pointer-events-none">
        <div role="dialog" aria-modal="true" class="pointer-events-auto w-full max-w-sm bg-[var(--bg-surface)] border border-[var(--line-hair)] text-[var(--text-primary)] divide-y divide-[var(--line-hair)]">
          <div class="px-5 py-5 space-y-4">
            <div class="font-mono text-xs uppercase tracking-widest font-semibold">${esc(title)}</div>
            ${bodyHtml || ''}
          </div>
          <div class="grid grid-cols-2 divide-x divide-[var(--line-hair)]">
            <button type="button" data-dialog-cancel class="h-12 font-mono text-xs uppercase tracking-widest text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer transition-colors">Cancelar</button>
            <button type="button" data-dialog-ok class="h-12 font-mono text-xs uppercase tracking-widest font-semibold cursor-pointer transition-colors hover:bg-[var(--bg-elevated)]" style="color:${accent}">${esc(confirmLabel)}</button>
          </div>
        </div>
      </div>
    `;
    root.classList.remove('hidden');

    const finish = (value) => {
      pendingResolve = null;
      root.classList.add('hidden');
      root.innerHTML = '';
      document.removeEventListener('keydown', onKey, true);
      resolve(value);
    };
    const accept = () => {
      playHorologyTick(1300, 0.015, 0.03);
      finish(readValue ? readValue(root) : true);
    };
    const cancel = () => {
      playHorologyTick(900, 0.012, 0.02);
      document.removeEventListener('keydown', onKey, true);
      finish(cancelValue);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
      else if (e.key === 'Enter' && !(e.target && e.target.tagName === 'TEXTAREA')) { e.preventDefault(); e.stopPropagation(); accept(); }
    };
    document.addEventListener('keydown', onKey, true);

    root.querySelector('[data-dialog-ok]').addEventListener('click', accept);
    root.querySelector('[data-dialog-cancel]').addEventListener('click', cancel);
    root.querySelector('[data-dialog-backdrop]').addEventListener('click', cancel);

    const input = root.querySelector('[data-dialog-input]');
    if (input) { input.focus(); input.select(); }
    else root.querySelector('[data-dialog-cancel]').focus();
  });
}

/**
 * @param {{ title: string, confirmLabel?: string, danger?: boolean }} opts
 * @returns {Promise<boolean>}
 */
export function confirmDialog({ title, confirmLabel = 'Confirmar', danger = false } = {}) {
  return open({ title, confirmLabel, danger, cancelValue: false });
}

/**
 * @param {{ label: string, initial?: string|number, maxLength?: number, inputMode?: string, confirmLabel?: string }} opts
 * @returns {Promise<string|null>} Texto ingresado, o null si se cancela.
 */
export function promptDialog({ label, initial = '', maxLength = 60, inputMode = 'text', confirmLabel = 'Aceptar' } = {}) {
  const bodyHtml = `
    <input data-dialog-input type="text" inputmode="${esc(inputMode)}" maxlength="${Number(maxLength) || 60}" value="${esc(initial)}"
      class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors font-mono text-sm text-[var(--text-primary)] focus:outline-none py-2" />
  `;
  return open({
    title: label,
    bodyHtml,
    confirmLabel,
    danger: false,
    cancelValue: null,
    readValue: (root) => root.querySelector('[data-dialog-input]')?.value ?? ''
  });
}
