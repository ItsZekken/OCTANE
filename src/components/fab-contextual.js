/**
 * OCTANE — Contextual Floating Action Button (FAB)
 * Industrial precision tactile launcher positioned at bottom-right corner.
 * 
 * Contextual behavior:
 * - Cockpit: Tapping reveals 2 floating pills: "Registrar lectura" & "Registrar tanqueada".
 * - Cluster: Tapping reveals 2 floating pills: "Nueva nota" & "Nuevo componente".
 * - Glovebox: Tapping opens directly "Nuevo documento" modal.
 * - Rides: Tapping reveals 2 floating pills: "+ Carrera" & "- Egreso".
 * - Settings: Hidden (FAB is completely hidden in settings).
 */

import { playHorologyTick } from '../core/telemetry-engine.js';
import store from '../core/state.js';
import { pushOverlayLayer, removeOverlayLayer } from '../core/navigation-manager.js';

const FAB_LAYER_ID = 'fab:menu';
let fabContainerEl = null;
let currentView = 'cockpit';
let isMenuOpen = false;

/**
 * Initializes and mounts the FAB into the document.
 */
export function renderFabContextual() {
  if (document.getElementById('octane-fab-contextual-root')) {
    fabContainerEl = document.getElementById('octane-fab-contextual-root');
    updateFabDisplay();
    return;
  }

  fabContainerEl = document.createElement('div');
  fabContainerEl.id = 'octane-fab-contextual-root';
  fabContainerEl.className = 'fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] right-4 sm:right-6 md:bottom-8 md:right-8 z-50 select-none';
  document.body.appendChild(fabContainerEl);

  updateFabDisplay();
  bindFabEvents();

  // Listen to store changes for view switching
  if (store && typeof store.subscribe === 'function') {
    store.subscribe((state) => {
      if (state.currentView && state.currentView !== currentView) {
        updateFabContext(state.currentView);
      }
    });
  }
}

/**
 * Updates the context of the FAB based on the current active view.
 * @param {string} viewId - 'cockpit' | 'cluster' | 'glovebox' | 'rides' | 'settings'
 */
export function updateFabContext(viewId) {
  currentView = viewId || 'cockpit';
  if (isMenuOpen) {
    isMenuOpen = false;
    removeOverlayLayer(FAB_LAYER_ID);
  }
  updateFabDisplay();
}

/**
 * Dismisses any open contextual menu options.
 */
export function closeFabOptions() {
  if (!isMenuOpen) return;
  isMenuOpen = false;
  removeOverlayLayer(FAB_LAYER_ID);
  updateMenuVisibility();
}

/**
 * Renders the HTML markup for the FAB and contextual menu options.
 */
function updateFabDisplay() {
  if (!fabContainerEl) return;

  if (currentView === 'settings') {
    fabContainerEl.classList.add('hidden');
    return;
  }
  fabContainerEl.classList.remove('hidden');

  let menuItemsHtml = '';

  if (currentView === 'cockpit') {
    menuItemsHtml = `
      <button 
        type="button" 
        data-action="reading" 
        class="fab-pill-action flex items-center gap-2.5 px-4 py-2.5 bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--line-strong)] font-mono text-xs uppercase tracking-wider hover:bg-[var(--bg-elevated)] transition-all cursor-pointer whitespace-nowrap shadow-lg active:scale-95"
      >
        <span class="w-2 h-2 rounded-full bg-[var(--accent-volt)]"></span>
        <span>Registrar lectura</span>
      </button>
      <button 
        type="button" 
        data-action="refuel" 
        class="fab-pill-action flex items-center gap-2.5 px-4 py-2.5 bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--line-strong)] font-mono text-xs uppercase tracking-wider hover:bg-[var(--bg-elevated)] transition-all cursor-pointer whitespace-nowrap shadow-lg active:scale-95"
      >
        <span class="w-2 h-2 rounded-full bg-[var(--accent-amber)]"></span>
        <span>Registrar tanqueada</span>
      </button>
    `;
  } else if (currentView === 'cluster') {
    menuItemsHtml = `
      <button 
        type="button" 
        data-action="note" 
        class="fab-pill-action flex items-center gap-2.5 px-4 py-2.5 bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--line-strong)] font-mono text-xs uppercase tracking-wider hover:bg-[var(--bg-elevated)] transition-all cursor-pointer whitespace-nowrap shadow-lg active:scale-95"
      >
        <svg class="w-3.5 h-3.5 text-[var(--accent-volt)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
        <span>Nueva nota</span>
      </button>
      <button 
        type="button" 
        data-action="maintenance" 
        class="fab-pill-action flex items-center gap-2.5 px-4 py-2.5 bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--line-strong)] font-mono text-xs uppercase tracking-wider hover:bg-[var(--bg-elevated)] transition-all cursor-pointer whitespace-nowrap shadow-lg active:scale-95"
      >
        <svg class="w-3.5 h-3.5 text-[var(--accent-amber)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <span>Nuevo componente</span>
      </button>
    `;
  } else if (currentView === 'rides') {
    menuItemsHtml = `
      <button 
        type="button" 
        data-action="ride" 
        class="fab-pill-action flex items-center gap-2.5 px-4 py-2.5 bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--line-strong)] font-mono text-xs uppercase tracking-wider hover:bg-[var(--bg-elevated)] transition-all cursor-pointer whitespace-nowrap shadow-lg active:scale-95"
      >
        <span class="font-mono text-sm font-bold text-[var(--accent-volt)]">+</span>
        <span>+ Carrera</span>
      </button>
      <button 
        type="button" 
        data-action="expense" 
        class="fab-pill-action flex items-center gap-2.5 px-4 py-2.5 bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--line-strong)] font-mono text-xs uppercase tracking-wider hover:bg-[var(--bg-elevated)] transition-all cursor-pointer whitespace-nowrap shadow-lg active:scale-95"
      >
        <span class="font-mono text-sm font-bold text-[var(--accent-crimson)]">-</span>
        <span>- Egreso</span>
      </button>
    `;
  }

  fabContainerEl.innerHTML = `
    <!-- Floating Contextual Pills Stack -->
    <div 
      id="fab-pills-stack" 
      class="${isMenuOpen ? 'flex' : 'hidden'} absolute bottom-full mb-3 right-0 flex-col items-end gap-2.5 transition-all duration-150"
    >
      ${menuItemsHtml}
    </div>

    <!-- Main Floating Action Button -->
    <button 
      id="fab-main-trigger" 
      type="button" 
      class="w-14 h-14 rounded-full bg-[var(--accent-amber)] text-[var(--bg-void)] flex items-center justify-center border border-white/10 transition-transform active:scale-95 shadow-lg cursor-pointer focus:outline-none"
      title="Acción rápida"
      aria-label="Acción contextual"
    >
      <svg id="fab-icon-glyph" class="w-6 h-6 transition-transform duration-200 ${isMenuOpen ? 'rotate-45' : 'rotate-0'}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
      </svg>
    </button>
  `;

  bindMenuActions();
}

/**
 * Toggles or updates the menu visibility.
 */
function updateMenuVisibility() {
  if (!fabContainerEl) return;
  const pillsStack = fabContainerEl.querySelector('#fab-pills-stack');
  const glyph = fabContainerEl.querySelector('#fab-icon-glyph');

  if (pillsStack) {
    if (isMenuOpen) {
      pillsStack.classList.remove('hidden');
      pillsStack.classList.add('flex');
    } else {
      pillsStack.classList.add('hidden');
      pillsStack.classList.remove('flex');
    }
  }

  if (glyph) {
    if (isMenuOpen) {
      glyph.classList.remove('rotate-0');
      glyph.classList.add('rotate-45');
    } else {
      glyph.classList.remove('rotate-45');
      glyph.classList.add('rotate-0');
    }
  }
}

/**
 * Binds click events to the contextual pills.
 */
function bindMenuActions() {
  if (!fabContainerEl) return;

  const pillBtns = fabContainerEl.querySelectorAll('.fab-pill-action');
  pillBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeFabOptions();
      const action = btn.dataset.action;

      playHorologyTick(1300, 0.015, 0.03);

      switch (action) {
        case 'reading':
          window.dispatchEvent(new CustomEvent('octane:open-reading'));
          break;
        case 'refuel':
          window.dispatchEvent(new CustomEvent('octane:open-refuel'));
          break;
        case 'note':
          window.dispatchEvent(new CustomEvent('octane:focus-note'));
          break;
        case 'maintenance':
          window.dispatchEvent(new CustomEvent('octane:open-maintenance', { detail: { mode: 'create' } }));
          break;
        case 'ride':
        case 'expense': {
          // Contexto temporal: si el usuario está viendo un periodo pasado en Carreras,
          // el nuevo registro nace en ese día y no en hoy.
          const ctx = store && typeof store.getState === 'function' ? store.getState().ridesContextDate : null;
          const detail = { mode: action };
          if (ctx) detail.initialDate = ctx;
          window.dispatchEvent(new CustomEvent('octane:open-ride-entry', { detail }));
          break;
        }
      }
    });
  });
}

/**
 * Binds global clicks and FAB main trigger clicks.
 */
function bindFabEvents() {
  if (!fabContainerEl) return;

  fabContainerEl.addEventListener('click', (e) => {
    const trigger = e.target.closest('#fab-main-trigger');
    if (trigger) {
      e.stopPropagation();
      playHorologyTick(1200, 0.015, 0.025);

      if (currentView === 'glovebox') {
        // Glovebox opens directly without menu
        window.dispatchEvent(new CustomEvent('octane:open-legal-doc'));
        return;
      }

      isMenuOpen = !isMenuOpen;
      if (isMenuOpen) {
        pushOverlayLayer(FAB_LAYER_ID, () => closeFabOptions(), { lockScroll: false, blocking: false });
      } else {
        removeOverlayLayer(FAB_LAYER_ID);
      }
      updateMenuVisibility();
    }
  });

  // Outside click closes menu
  window.addEventListener('click', (e) => {
    if (isMenuOpen && fabContainerEl && !fabContainerEl.contains(e.target)) {
      closeFabOptions();
    }
  });
}
