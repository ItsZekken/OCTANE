/**
 * OCTANE — Flat Swiss Symmetrical Navigation Dock
 * Industrial minimal dock with zero shadows and symmetric view tabs.
 * 
 * Directives:
 * - Flat 1px architecture: bg-[var(--bg-void)] border-t border-[var(--line-hair)] divide-x divide-[var(--line-hair)].
 * - Symmetrical 4 or 5 tabs with identical widths (no central plus button).
 * - Cockpit, Clúster, Guantera, [Carreras], Ajustes.
 * - Zero <p> tags. All labels under 4 words.
 */

import { playHorologyTick } from '../core/telemetry-engine.js';
import store from '../core/state.js';

let activeTabId = 'cockpit';
let currentContainer = null;
let storeUnsubscribe = null;

/**
 * Returns dynamic navigation items based on profile and settings.
 * Non-Intrusive Activation Rule: 'rides' tab only exists if ridesModuleEnabled is true.
 * @param {Object} [options={}]
 * @returns {Array<Object>}
 */
export function getNavItems(options = {}) {
  let ridesEnabled = false;
  if (options && options.ridesModuleEnabled !== undefined) {
    ridesEnabled = Boolean(options.ridesModuleEnabled);
  } else if (options && options.vehicleProfile && options.vehicleProfile.ridesModuleEnabled !== undefined) {
    ridesEnabled = Boolean(options.vehicleProfile.ridesModuleEnabled);
  } else if (store && typeof store.getState === 'function') {
    const state = store.getState();
    ridesEnabled = Boolean(state?.vehicleProfile?.ridesModuleEnabled);
  }

  const items = [
    {
      id: 'cockpit',
      label: 'COCKPIT',
      icon: `
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      `
    },
    {
      id: 'cluster',
      label: 'CLÚSTER',
      icon: `
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      `
    },
    {
      id: 'glovebox',
      label: 'GUANTERA',
      icon: `
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      `
    }
  ];

  if (ridesEnabled) {
    items.push({
      id: 'rides',
      label: 'CARRERAS',
      icon: `
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75">
          <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      `
    });
  }

  items.push({
    id: 'settings',
    label: 'AJUSTES',
    icon: `
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75">
        <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    `
  });

  return items;
}

export const NAV_ITEMS = getNavItems();

/**
 * Renders the flat Swiss navigation dock.
 * @param {HTMLElement} container - DOM mount element
 * @param {Object} options - Navigation options
 */
export function renderNavDock(container, options = {}) {
  if (!container) return;
  currentContainer = container;

  if (options.activeTab) {
    activeTabId = options.activeTab;
  } else if (store && typeof store.getState === 'function') {
    const ss = store.getState();
    if (ss.currentView) activeTabId = ss.currentView;
  }

  const navItems = getNavItems(options);
  const colsCount = navItems.length;

  container.innerHTML = `
    <nav class="fixed bottom-0 inset-x-0 z-40 bg-[var(--bg-void)] border-t border-[var(--line-hair)] pb-[env(safe-area-inset-bottom,0px)]">
      <div class="relative max-w-md mx-auto h-14 flex items-stretch divide-x divide-[var(--line-hair)] border-x border-[var(--line-hair)]">
        ${navItems.map(item => {
          const isActive = activeTabId === item.id;
          const textClass = isActive 
            ? 'text-[var(--accent-amber)] font-semibold' 
            : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]';

          return `
            <button 
              type="button" 
              data-nav="${item.id}" 
              class="nav-tab-btn flex-1 flex flex-col items-center justify-center h-full py-1 gap-1 transition-colors ${textClass} cursor-pointer select-none"
            >
              <span class="transition-transform duration-150">${item.icon}</span>
              <span class="font-mono text-[9px] tracking-wider uppercase">${item.label}</span>
              ${isActive ? '<span class="w-1 h-1 bg-[var(--accent-amber)] mt-0.5"></span>' : '<span class="w-1 h-1 opacity-0 mt-0.5"></span>'}
            </button>
          `;
        }).join('')}
      </div>
    </nav>
  `;

  bindNavEvents();
  subscribeToStore();
}

/**
 * No-op fallback for backwards compatibility if called externally.
 */
export function closeSplitLauncher() {
  // Split launcher migrated to fab-contextual.js
}

function bindNavEvents() {
  if (!currentContainer) return;

  // View Navigation Tabs
  const tabBtns = currentContainer.querySelectorAll('.nav-tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.dataset.nav;

      if (tabId === activeTabId) return;

      playHorologyTick(950, 0.015, 0.03);
      activeTabId = tabId;

      if (store && typeof store.setState === 'function') {
        store.setState({ currentView: tabId });
      }

      renderNavDock(currentContainer, { activeTab: tabId });

      window.dispatchEvent(new CustomEvent('octane:navigate', {
        detail: { view: tabId }
      }));
    });
  });
}

function subscribeToStore() {
  if (!store || typeof store.subscribe !== 'function') return;
  if (storeUnsubscribe) storeUnsubscribe();

  let prevRidesEnabled = store.getState()?.vehicleProfile?.ridesModuleEnabled;

  storeUnsubscribe = store.subscribe((state) => {
    const currRidesEnabled = state?.vehicleProfile?.ridesModuleEnabled;
    const ridesChanged = currRidesEnabled !== prevRidesEnabled;
    prevRidesEnabled = currRidesEnabled;

    if ((state.currentView && state.currentView !== activeTabId) || ridesChanged) {
      if (state.currentView) activeTabId = state.currentView;
      if (currentContainer) {
        renderNavDock(currentContainer, { activeTab: activeTabId });
      }
    }
  });
}

/**
 * Sets active tab externally and updates indicator.
 * @param {string} tabId 
 */
export function setActiveNavTab(tabId) {
  activeTabId = tabId;
  if (store && typeof store.setState === 'function') {
    store.setState({ currentView: tabId });
  }
  if (currentContainer) {
    renderNavDock(currentContainer, { activeTab: tabId });
  }
}
