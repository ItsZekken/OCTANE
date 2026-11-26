/**
 * OCTANE // KINETIC — Main Application Bootstrap & Client Router
 * Modular PWA Shell: Vanilla JS (ES Modules) + IndexedDB + Firebase Auth & Firestore.
 * Zero dummy data, 5 architectural views, precision Web Audio, and modal coordination.
 */

import './style/tokens.css';
import { store, playHorologyTick, showToast } from './core/state.js';
import {
  openDB,
  getVehicleProfile,
  saveVehicleProfile,
  getTelemetryLogs,
  getMaintenanceItems,
  DEFAULT_VEHICLE_PROFILE
} from './core/db-local.js';
import {
  initFirebase,
  getCurrentUser,
  onAuthChange,
  syncToCloud
} from './core/firebase-sync.js';
import { calculateTelemetryModel } from './core/telemetry-engine.js';
import { syncGpsTelemetry } from './core/iopgps-sync.js';
import { renderHeader, setHeaderUser, setHeaderVehicleTag } from './components/header-bar.js';
import { renderNavDock, setActiveNavTab } from './components/nav-dock.js';
import { renderFabContextual, updateFabContext } from './components/fab-contextual.js';
import { openReadingModal, initReadingModal } from './components/modals/modal-reading.js';
import { openRefuelModal, initRefuelModal } from './components/modals/modal-refuel.js';
import { openOnboardingModal, initOnboardingModal } from './components/modals/modal-onboarding.js';
import { openMaintenanceModal, initMaintenanceModal } from './components/modals/modal-maintenance.js';
import { openLegalDocModal, initLegalDocModal } from './components/modals/modal-legal-doc.js';
import { openRideEntryModal, initRideEntryModal } from './components/modals/modal-ride-entry.js';
import { initMovementDetailModal } from './components/modals/modal-movement-detail.js';
import { initTelemetryDetailModal } from './components/modals/modal-telemetry-detail.js';
import { openDiagnosticModal, initDiagnosticModal } from './components/modals/modal-diagnostic.js';
import { initGpsIntelligenceModal } from './components/modals/modal-gps-intelligence.js';
import { initViewportManager } from './core/viewport-manager.js';
import { initMicroTooltips } from './components/micro-tooltip.js';
import { refreshAlerts, initAlertsEngine } from './core/alerts-engine.js';
import {
  initNavigationManager,
  pushOverlayLayer,
  removeOverlayLayer,
  hasBlockingOverlay
} from './core/navigation-manager.js';
import { maybeShowReleaseNotes } from './components/modals/modal-release-notes.js';
import { renderCockpit, destroyCockpit, refreshCockpit } from './views/view-cockpit.js';
import { renderClusterView, destroyClusterView } from './views/view-cluster.js';
import { renderGloveboxView, destroyGloveboxView } from './views/view-glovebox.js';
import { renderRidesView, destroyRidesView } from './views/view-rides.js';
import { renderSettingsView, destroySettingsView } from './views/view-settings.js';

let appRoot = null;
let headerContainer = null;
let mainContainer = null;
let navContainer = null;
let currentActiveView = 'cockpit';
const viewScrollPositions = new Map();

/**
 * Valid view IDs supported by the OCTANE router
 */
const VALID_VIEWS = ['cockpit', 'cluster', 'glovebox', 'rides', 'settings'];

/**
 * Mounts the view associated with viewId into the main application container.
 * @param {string} viewId
 * @param {Object} [options={}]
 */
export async function navigateTo(viewId, options = {}) {
  if (!VALID_VIEWS.includes(viewId)) {
    viewId = 'cockpit';
  }

  if (viewId === currentActiveView && mainContainer.firstElementChild) {
    return;
  }

  // Remember scroll position of the view we are leaving
  if (mainContainer.firstElementChild && typeof window !== 'undefined') {
    viewScrollPositions.set(currentActiveView, window.scrollY || 0);
  }

  // Cleanup active view if leaving previous view
  if (currentActiveView === 'cockpit' && viewId !== 'cockpit') {
    try {
      destroyCockpit();
    } catch (err) {
      // Defensive cleanup
    }
  } else if (currentActiveView === 'settings' && viewId !== 'settings') {
    try {
      destroySettingsView();
    } catch (err) {
      // Defensive cleanup
    }
  } else if (currentActiveView === 'cluster' && viewId !== 'cluster') {
    try {
      destroyClusterView();
    } catch (err) {
      // Defensive cleanup
    }
  } else if (currentActiveView === 'glovebox' && viewId !== 'glovebox') {
    try {
      destroyGloveboxView();
    } catch (err) {
      // Defensive cleanup
    }
  } else if (currentActiveView === 'rides' && viewId !== 'rides') {
    try {
      destroyRidesView();
    } catch (err) {
      // Defensive cleanup
    }
  }

  currentActiveView = viewId;

  // Update store and keep Back-button return-to-Cockpit state synced for non-home views
  store.setState({ currentView: viewId });
  if (viewId !== 'cockpit') {
    pushOverlayLayer('nav:tab', () => {
      navigateTo('cockpit', { fromBack: true });
    }, { lockScroll: false, closeOnEscape: false, blocking: false });
  } else if (!options.fromBack) {
    removeOverlayLayer('nav:tab');
  }

  try {
    if (typeof window !== 'undefined' && window.history && typeof window.history.replaceState === 'function') {
      const currentState = (window.history.state && typeof window.history.state === 'object') ? window.history.state : {};
      window.history.replaceState({ ...currentState, view: viewId }, '', window.location.pathname + window.location.search);
    }
  } catch (_) {}

  // Update navigation dock active tab indicator
  setActiveNavTab(viewId);

  // Update contextual FAB
  updateFabContext(viewId);

  // Clear main container
  mainContainer.innerHTML = '';

  // Render target view
  switch (viewId) {
    case 'cluster':
      renderClusterView(mainContainer);
      break;
    case 'glovebox':
      renderGloveboxView(mainContainer);
      break;
    case 'rides':
      renderRidesView(mainContainer);
      break;
    case 'settings':
      await renderSettingsView(mainContainer);
      break;
    case 'cockpit':
    default:
      renderCockpit(mainContainer);
      break;
  }

  // Restore saved scroll position for this view (0 on first visit)
  const targetScrollY = viewScrollPositions.get(viewId) || 0;
  window.scrollTo({ top: targetScrollY, behavior: 'instant' });
  if (targetScrollY > 0 && typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => window.scrollTo({ top: targetScrollY, behavior: 'instant' }));
  }
}

/**
 * Initializes the application layout, database, state, and router.
 */
async function bootstrapApp() {
  appRoot = document.getElementById('app');
  if (!appRoot) {
    console.error('[OCTANE] Fatal: #app root element missing.');
    return;
  }

  // Ensure strict viewport containment on root
  appRoot.classList.add('overflow-x-hidden', 'w-full', 'max-w-full');

  // Build Shell Layout
  appRoot.innerHTML = `
    <!-- Sticky Architectural Header Container -->
    <div id="header-container" class="sticky top-0 z-40"></div>

    <!-- Dynamic Router Content Mount -->
    <main id="main-content" class="flex-1 w-full max-w-full sm:max-w-5xl lg:max-w-6xl xl:max-w-7xl mx-auto px-3 sm:px-4 pt-3 sm:pt-4 pb-28 sm:pb-32 overflow-x-hidden"></main>

    <!-- Fixed Bottom Navigation Dock Container -->
    <div id="nav-dock-container"></div>
  `;

  headerContainer = document.getElementById('header-container');
  mainContainer = document.getElementById('main-content');
  navContainer = document.getElementById('nav-dock-container');

  // 1. Initialize IndexedDB
  try {
    await openDB();
  } catch (err) {
    console.warn('[OCTANE] IndexedDB initialization issue:', err);
  }

  // 2. Load or seed vehicle profile
  let vehicleProfile = null;
  try {
    vehicleProfile = await getVehicleProfile();
    if (!vehicleProfile) {
      vehicleProfile = { ...DEFAULT_VEHICLE_PROFILE };
      await saveVehicleProfile(vehicleProfile);
    }
  } catch (err) {
    console.warn('[OCTANE] Could not load vehicle profile from DB:', err);
    vehicleProfile = { ...DEFAULT_VEHICLE_PROFILE };
  }

  // 3. Load Telemetry Logs
  let telemetryLogs = [];
  try {
    telemetryLogs = await getTelemetryLogs();
  } catch (err) {
    console.warn('[OCTANE] Could not load telemetry logs from DB:', err);
    telemetryLogs = [];
  }

  // 3b. Load Maintenance Items (Auto-seed if store is empty)
  let maintenanceItems = [];
  try {
    maintenanceItems = await getMaintenanceItems(true);
  } catch (err) {
    console.warn('[OCTANE] Could not load maintenance items from DB:', err);
    maintenanceItems = [];
  }

  // 4. Run Telemetry Engine on loaded logs
  const stateSnapshot = store.getState();
  const engineResults = calculateTelemetryModel(telemetryLogs, vehicleProfile, {
    scopeFilter: stateSnapshot.scopeFilter,
    fuelPriceCop: vehicleProfile.fuelPriceCop || stateSnapshot.fuelPriceCop
  });

  // 5. Update Reactive Store
  store.setState({
    vehicleProfile,
    telemetryLogs,
    maintenanceItems,
    telemetryEngineResults: engineResults,
    fuelPriceCop: vehicleProfile.fuelPriceCop || 16000
  });

  // 6. Mount Header Bar
  renderHeader(headerContainer, {
    scope: stateSnapshot.scopeFilter,
    unit: stateSnapshot.currentUnit,
    fuelPriceCop: vehicleProfile.fuelPriceCop || 16000,
    soundEnabled: stateSnapshot.soundEnabled,
    theme: stateSnapshot.theme,
    vehicleName: (vehicleProfile?.isConfigured && vehicleProfile?.name) ? `${vehicleProfile.name.toUpperCase()} • ${vehicleProfile.tankCapacityLiters}L` : '',
    user: getCurrentUser()
  });

  // 7. Mount Navigation Dock & Contextual FAB
  renderNavDock(navContainer, {
    activeTab: currentActiveView
  });
  renderFabContextual();
  updateFabContext(currentActiveView);

  // 8. Initialize Modals Overlay (Reading, Refuel, Onboarding, Maintenance, Legal Doc, Ride Entry, Details)
  initReadingModal();
  initRefuelModal();
  initOnboardingModal();
  initMaintenanceModal();
  initLegalDocModal();
  initRideEntryModal();
  initMovementDetailModal();
  initTelemetryDetailModal();
  initDiagnosticModal();
  initGpsIntelligenceModal();
  initAlertsEngine();
  initMicroTooltips();
  initViewportManager();

  // Evaluate initial legal and maintenance alerts
  try {
    await refreshAlerts();
  } catch (err) {
    console.warn('[OCTANE] Alerts initial evaluation issue:', err);
  }

  // 9. Initialize Firebase & Auth state listener
  try {
    initFirebase();
    onAuthChange((user) => {
      store.setState({ user });
      setHeaderUser(user);
      if (user) {
        showToast(`GOOGLE: ${user.displayName || user.email}`);
      }
    });
  } catch (err) {
    console.warn('[OCTANE] Firebase initialization skipped or unavailable:', err);
  }

  // 10. Bind Global Event Listeners
  setupGlobalListeners();

  // 11. Initial Route Resolution: Always start in Cockpit
  try {
    if (window.location.hash) {
      const currentState = (window.history.state && typeof window.history.state === 'object') ? window.history.state : {};
      window.history.replaceState({ ...currentState, view: 'cockpit' }, '', window.location.pathname + window.location.search);
    }
  } catch (_) {}
  await navigateTo('cockpit');

  // 12. Check first-time calibration / onboarding
  const hasTelemetry = Array.isArray(telemetryLogs) && telemetryLogs.length > 0;
  const isProfileConfigured = Boolean(vehicleProfile && (vehicleProfile.isConfigured === true || vehicleProfile.onboardingCompleted === true));
  const isFirstTimeOnboarding = !hasTelemetry && !isProfileConfigured;

  if (isFirstTimeOnboarding) {
    setTimeout(() => {
      openOnboardingModal();
    }, 150);
  } else if (vehicleProfile && !vehicleProfile.isConfigured) {
    vehicleProfile.isConfigured = true;
    vehicleProfile.onboardingCompleted = true;
    saveVehicleProfile(vehicleProfile).catch(() => {});
  }

  // 12b. One-time human-readable release notes popup per update version
  maybeShowReleaseNotes({ isFirstTimeOnboarding, delayMs: 320 });

  // 13. Background IOPGPS Telemetry Sync (live odometer, voltage & incremental daily backfill from 2026-02-01)
  setTimeout(() => {
    syncGpsTelemetry({ silent: true }).catch((err) => {
      console.warn('[OCTANE GPS] Background sync skipped:', err);
    });
  }, 600);
}

/**
 * Sets up global custom event, hash, and keyboard listeners.
 */
function setupGlobalListeners() {
  // Navigation event from nav-dock or other views
  window.addEventListener('octane:navigate', (e) => {
    if (e.detail && e.detail.view) {
      navigateTo(e.detail.view);
    }
  });

  // Modal open events (from Split Launcher, FAB or edit triggers)
  window.addEventListener('octane:open-reading', (e) => {
    openReadingModal(e.detail || {});
  });

  window.addEventListener('octane:open-refuel', (e) => {
    openRefuelModal(e.detail || {});
  });

  // Geofence gas station refuel suggestion or notification click
  window.addEventListener('octane:suggest-refuel', (e) => {
    const detail = e.detail || {};
    openRefuelModal({
      initialOdo: detail.initialOdo,
      defaultFull: detail.defaultFull !== undefined ? detail.defaultFull : true,
      stop: detail.stop,
      coords: detail.coords || detail.stop?.coords
    });
  });

  window.addEventListener('octane:open-onboarding', () => {
    openOnboardingModal();
  });

  window.addEventListener('octane:open-legal-doc', (e) => {
    openLegalDocModal(e.detail || {});
  });

  window.addEventListener('octane:open-maintenance', (e) => {
    openMaintenanceModal(e.detail || {});
  });

  window.addEventListener('octane:open-ride-entry', (e) => {
    openRideEntryModal(e.detail || {});
  });

  window.addEventListener('octane:open-diagnostic', (e) => {
    openDiagnosticModal(e.detail?.periodFilter || 'month');
  });

  window.addEventListener('octane:open-modal', (e) => {
    if (!e.detail) return;
    if (e.detail.modal === 'reading') {
      openReadingModal(e.detail.options || e.detail || {});
    } else if (e.detail.modal === 'refuel') {
      openRefuelModal(e.detail.options || e.detail || {});
    } else if (e.detail.modal === 'onboarding') {
      openOnboardingModal();
    } else if (e.detail.modal === 'legal-doc' || e.detail.modal === 'legal') {
      openLegalDocModal(e.detail.options || {});
    } else if (e.detail.modal === 'maintenance') {
      openMaintenanceModal(e.detail.options || {});
    } else if (e.detail.modal === 'ride-entry' || e.detail.modal === 'rides') {
      openRideEntryModal(e.detail.options || {});
    } else if (e.detail.modal === 'sync-fuel') {
      openReadingModal();
    }
  });

  // Re-sync header and cockpit on onboarding completion
  window.addEventListener('octane:profile-configured', (e) => {
    if (e.detail && e.detail.profile) {
      setHeaderVehicleTag(e.detail.profile.name);
      if (currentActiveView === 'cockpit') {
        try {
          refreshCockpit();
        } catch (_) {}
      }
    }
  });

  // Toast events
  window.addEventListener('octane:toast', (e) => {
    if (e.detail && e.detail.message) {
      showToast(e.detail.message);
    }
  });

  // Unified Overlay Back-Button, Escape & Scroll-Lock Manager
  initNavigationManager({ getCurrentView: () => currentActiveView });

  // Network Online / Offline Detection
  window.addEventListener('online', () => {
    store.setState({ syncStatus: 'idle' });
    showToast('CONEXIÓN RESTABLECIDA');
    if (typeof syncToCloud === 'function') syncToCloud();
  });

  window.addEventListener('offline', () => {
    store.setState({ syncStatus: 'offline' });
    showToast('MODO SIN CONEXIÓN');
  });

  // Keyboard Shortcuts (Power user ergonomics — disabled while any modal is open)
  window.addEventListener('keydown', (e) => {
    if (hasBlockingOverlay()) {
      return;
    }
    // Avoid capturing inside inputs or textareas
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) {
      return;
    }

    if (e.key === 's' || e.key === 'S' || e.key === 'l' || e.key === 'L') {
      e.preventDefault();
      openReadingModal();
    } else if (e.key === 't' || e.key === 'T') {
      e.preventDefault();
      openRefuelModal();
    } else if (e.key === '1') {
      navigateTo('cockpit');
    } else if (e.key === '2') {
      navigateTo('cluster');
    } else if (e.key === '3') {
      navigateTo('glovebox');
    } else if (e.key === '4') {
      navigateTo('rides');
    } else if (e.key === '5') {
      navigateTo('settings');
    }
  });

  // Listen to profile updates to keep header tag synced
  store.subscribe((state, prevState) => {
    if (state.vehicleProfile && state.vehicleProfile !== prevState.vehicleProfile) {
      setHeaderVehicleTag(state.vehicleProfile.name);
    }
  });

  // PWA Service Worker Registration & Install Prompt Capture
  if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then((registration) => {
        // Automatically check for updates on each page focus
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                showToast('OCTANE ACTUALIZADO');
              }
            });
          }
        });
      }).catch((err) => {
        console.warn('[OCTANE PWA] Service worker registration issue:', err);
      });
    });

    // Listen for notificationclick messages forwarded by Service Worker
    navigator.serviceWorker.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg) return;
      if (msg.type === 'octane:suggest-refuel' || msg.action === 'suggest-refuel' || msg.type === 'notificationclick') {
        const payload = msg.data || msg;
        openRefuelModal({
          initialOdo: payload.initialOdo,
          defaultFull: payload.defaultFull !== undefined ? payload.defaultFull : true,
          stop: payload.stop,
          coords: payload.coords
        });
      }
    });

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      window.deferredOctaneInstallPrompt = e;
      window.dispatchEvent(new CustomEvent('octane:installable'));
    });
  }
}

// Kick off app once DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrapApp);
} else {
  bootstrapApp();
}
