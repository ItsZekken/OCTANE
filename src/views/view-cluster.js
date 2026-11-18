/**
 * OCTANE // KINETIC — Cluster View ("Clúster Técnico")
 * Architectural Wear Telemetry Matrix & Mechanical Instrumentation.
 * 
 * Strict specifications:
 * - Clean title: "CLÚSTER" (zero "//" and zero numeric prefixes).
 * - Section Header: "DESGASTE MECÁNICO" (zero "01 /").
 * - Matrix of 240° SVG Wear Dials with Protagonist Vector Iconography.
 * - Reactive calculation against currentOdo (highest odometer from telemetry_logs).
 * - Component actions: [EDITAR ✎], [HISTORIAL] and [↻ RESET].
 * - Instant recalculation on store mutation.
 * - Mounts "Bitácora Abierta" (free-notes-board).
 * - Silencio Verbal Absoluto: Prohibidos <p> tags, zero blur, zero drop shadows.
 */

import { store, playHorologyTick } from '../core/state.js';
import { getMaintenanceItems } from '../core/db-local.js';
import { analyzeElectricalHealth } from '../core/vehicle-health-engine.js';
import { renderWearDialCard } from '../components/cluster/wear-dial-card.js';
import {
    openResetMaintenanceModal,
    openAddComponentModal,
    openEditComponentModal,
    openHistoryMaintenanceModal,
} from '../components/modals/modal-maintenance.js';

let storeUnsubscribe = null;
let currentActiveContainer = null;

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
 * Renders the Wear Dial Matrix inside container.
 * @param {HTMLElement} gridContainer
 * @param {Array<Object>} items
 * @param {number} currentOdo
 * @param {Object|null} [gpsContext=null]
 */
function renderDialsGrid(gridContainer, items, currentOdo, gpsContext = null) {
    if (!gridContainer) return;

    if (!items || items.length === 0) {
        gridContainer.innerHTML = `
          <div class="col-span-full p-8 text-center font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)] bg-[var(--bg-surface)]">
            SIN COMPONENTES DE DESGASTE REGISTRADOS
          </div>
        `;
        return;
    }

    gridContainer.innerHTML = items
        .map(item => renderWearDialCard(item, currentOdo, gpsContext))
        .join('');
}

/**
 * Dynamically mounts the Free Notes Board if available.
 * @param {HTMLElement} container
 */
async function mountNotesBoard(container) {
    const notesMount = container.querySelector('#cluster-notes-mount');
    if (!notesMount) return;

    try {
        const notesModule = await import('../components/cluster/free-notes-board.js');
        if (typeof notesModule.renderFreeNotesBoard === 'function') {
            notesModule.renderFreeNotesBoard(notesMount);
        }
    } catch {
        // Module not yet loaded
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
    currentActiveContainer = null;
}

/**
 * Main entry point: Renders the Cluster View.
 * @param {HTMLElement} container
 */
export async function renderClusterView(container) {
    destroyClusterView();
    currentActiveContainer = container;

    playHorologyTick(1100, 0.015, 0.025);

    // 1. Fetch telemetry logs and calculate current vehicle odometer
    const state = store.getState();
    const logs = state.telemetryLogs || [];
    let currentOdo = getCurrentOdometer(logs, state.vehicleProfile);
    let gpsContext = buildClusterGpsContext(state.vehicleProfile);
    const batteryTrigger = formatClusterBatteryTrigger(state.vehicleProfile);

    // 2. Fetch or auto-seed maintenance items from IndexedDB
    let items = [];
    try {
        items = await getMaintenanceItems(true); // Auto-seeds 6 items if empty
    } catch (err) {
        console.warn('[OCTANE] Error loading maintenance items in cluster:', err);
        items = [];
    }

    // Update store with loaded items
    store.setState({ maintenanceItems: items });

    // 3. Render Outer Framework
    container.innerHTML = `
      <div class="view-cluster w-full space-y-6 pb-20 select-none">
        
        <!-- Top View Header -->
        <div class="border-b border-[var(--line-hair)] pb-3 flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2.5">
            <span class="w-2 h-2 bg-[var(--accent-amber)]"></span>
            <span class="font-mono text-xs uppercase tracking-widest text-[var(--text-primary)] font-semibold">CLÚSTER</span>
          </div>
          <div class="flex items-center gap-3 font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">
            <button
              id="cluster-top-voltage-readout"
              type="button"
              class="${batteryTrigger.visible ? '' : 'hidden '}tabular-nums cursor-pointer hover:opacity-80 transition-opacity ${batteryTrigger.colorClass}"
              title="Abrir salud eléctrica y desgaste físico"
            >${batteryTrigger.text}</button>
            <span id="cluster-top-voltage-sep" class="${batteryTrigger.visible ? '' : 'hidden '}text-[var(--line-strong)]">·</span>
            <span class="w-1.5 h-1.5 rounded-full bg-[var(--accent-volt)]"></span>
            <span id="cluster-top-odo-readout" class="tabular-nums">ODÓMETRO: ${currentOdo.toLocaleString('en-US')} KM</span>
          </div>
        </div>

        <!-- Section: Desgaste Mecánico Frame -->
        <div class="space-y-0">
          
          <!-- Header de Sección -->
          <div class="h-12 flat-frame px-4 sm:px-5 flex items-center justify-between border-b-0">
            <div class="flex items-center gap-2">
              <span class="font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">
                DESGASTE MECÁNICO
              </span>
            </div>
            
            <button 
              id="cluster-add-component-btn" 
              type="button" 
              class="flat-pill px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-[var(--text-primary)] hover:border-[var(--line-strong)] hover:bg-[var(--line-hair)] transition-colors cursor-pointer flex items-center gap-1"
              title="Añadir componente al clúster"
            >
              <span>+</span> COMPONENTE
            </button>
          </div>

          <!-- Matriz de Diales de Desgaste (2x3 Grid with Hairline Dividers) -->
          <div 
            id="cluster-dials-grid" 
            class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-[var(--line-hair)] border border-[var(--line-hair)]"
          >
            <!-- Dials injected here -->
          </div>
        </div>

        <!-- Section Mount: Bitácora Abierta -->
        <div id="cluster-notes-mount"></div>

      </div>
    `;

    const dialsGrid = container.querySelector('#cluster-dials-grid');
    const addCompBtn = container.querySelector('#cluster-add-component-btn');
    const topOdoReadout = container.querySelector('#cluster-top-odo-readout');
    const topVoltageBtn = container.querySelector('#cluster-top-voltage-readout');

    topVoltageBtn?.addEventListener('click', () => {
        playHorologyTick(1200, 0.012, 0.02);
        window.dispatchEvent(new CustomEvent('octane:open-gps-intelligence', { detail: { tab: 'health' } }));
    });

    // Initial render of dials
    renderDialsGrid(dialsGrid, items, currentOdo, gpsContext);

    // 4. Grid Event Delegation (Edit, Reset & History Buttons)
    dialsGrid?.addEventListener('click', (e) => {
        // Edit Action
        const editBtn = e.target.closest('[data-action="edit"]');
        if (editBtn) {
            const itemId = editBtn.getAttribute('data-id');
            const targetItem = items.find(i => i.id === itemId);
            if (targetItem) {
                openEditComponentModal({
                    item: targetItem,
                    onSave: async () => {
                        items = await getMaintenanceItems();
                        renderDialsGrid(dialsGrid, items, currentOdo, gpsContext);
                    },
                    onDelete: async () => {
                        items = await getMaintenanceItems();
                        renderDialsGrid(dialsGrid, items, currentOdo, gpsContext);
                    }
                });
            }
            return;
        }

        // Reset Action
        const resetBtn = e.target.closest('[data-action="reset"]');
        if (resetBtn) {
            const itemId = resetBtn.getAttribute('data-id');
            const targetItem = items.find(i => i.id === itemId);
            if (targetItem) {
                openResetMaintenanceModal({
                    item: targetItem,
                    currentOdo,
                    onSave: async () => {
                        items = await getMaintenanceItems();
                        renderDialsGrid(dialsGrid, items, currentOdo, gpsContext);
                    }
                });
            }
            return;
        }

        // History Action
        const historyBtn = e.target.closest('[data-action="history"]');
        if (historyBtn) {
            const itemId = historyBtn.getAttribute('data-id');
            const targetItem = items.find(i => i.id === itemId);
            if (targetItem) {
                openHistoryMaintenanceModal({
                    item: targetItem,
                    currentOdo,
                    onReset: () => {
                        openResetMaintenanceModal({
                            item: targetItem,
                            currentOdo,
                            onSave: async () => {
                                items = await getMaintenanceItems();
                                renderDialsGrid(dialsGrid, items, currentOdo, gpsContext);
                            }
                        });
                    },
                    onDelete: async () => {
                        items = await getMaintenanceItems();
                        renderDialsGrid(dialsGrid, items, currentOdo, gpsContext);
                    },
                    onSave: async () => {
                        items = await getMaintenanceItems();
                        renderDialsGrid(dialsGrid, items, currentOdo, gpsContext);
                    }
                });
            }
        }
    });

    // 5. Add Component Button
    addCompBtn?.addEventListener('click', () => {
        openAddComponentModal({
            currentOdo,
            onSave: async () => {
                items = await getMaintenanceItems();
                renderDialsGrid(dialsGrid, items, currentOdo, gpsContext);
            }
        });
    });

    // 6. Reactive Store Subscription (Instant Recalculation on Telemetry Log or Item Change)
    storeUnsubscribe = store.subscribe((newState, prevState) => {
        if (!currentActiveContainer) return;

        let odoChanged = false;
        let itemsChanged = false;
        let profileChanged = false;

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
                topOdoReadout.textContent = `ODÓMETRO: ${currentOdo.toLocaleString('en-US')} KM`;
            }
            renderDialsGrid(dialsGrid, items, currentOdo, gpsContext);
        }
    });

    // 7. Mount Bitácora Abierta
    mountNotesBoard(container);
}
