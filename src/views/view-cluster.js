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
 * Computes the highest odometer reading from telemetry logs.
 * @param {Array<Object>} logs
 * @returns {number}
 */
export function getCurrentOdometer(logs = []) {
    if (!Array.isArray(logs) || logs.length === 0) return 0;
    return logs.reduce((max, log) => {
        const odo = Number(log.odometer_reading) || 0;
        return odo > max ? odo : max;
    }, 0);
}

/**
 * Renders the Wear Dial Matrix inside container.
 * @param {HTMLElement} gridContainer
 * @param {Array<Object>} items
 * @param {number} currentOdo
 */
function renderDialsGrid(gridContainer, items, currentOdo) {
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
        .map(item => renderWearDialCard(item, currentOdo))
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
    let currentOdo = getCurrentOdometer(logs);

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
      <div class="view-cluster max-w-5xl mx-auto space-y-6 pb-20 select-none">
        
        <!-- Top View Header -->
        <div class="border-b border-[var(--line-hair)] pb-3 flex items-center justify-between">
          <div class="flex items-center gap-2.5">
            <span class="w-2 h-2 bg-[var(--accent-amber)]"></span>
            <span class="font-mono text-xs uppercase tracking-widest text-[var(--text-primary)] font-semibold">CLÚSTER</span>
          </div>
          <div class="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">
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

    // Initial render of dials
    renderDialsGrid(dialsGrid, items, currentOdo);

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
                        renderDialsGrid(dialsGrid, items, currentOdo);
                    },
                    onDelete: async () => {
                        items = await getMaintenanceItems();
                        renderDialsGrid(dialsGrid, items, currentOdo);
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
                        renderDialsGrid(dialsGrid, items, currentOdo);
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
                                renderDialsGrid(dialsGrid, items, currentOdo);
                            }
                        });
                    },
                    onDelete: async () => {
                        items = await getMaintenanceItems();
                        renderDialsGrid(dialsGrid, items, currentOdo);
                    },
                    onSave: async () => {
                        items = await getMaintenanceItems();
                        renderDialsGrid(dialsGrid, items, currentOdo);
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
                renderDialsGrid(dialsGrid, items, currentOdo);
            }
        });
    });

    // 6. Reactive Store Subscription (Instant Recalculation on Telemetry Log or Item Change)
    storeUnsubscribe = store.subscribe((newState, prevState) => {
        if (!currentActiveContainer) return;

        let odoChanged = false;
        let itemsChanged = false;

        if (newState.telemetryLogs !== prevState.telemetryLogs) {
            const newOdo = getCurrentOdometer(newState.telemetryLogs || []);
            if (newOdo !== currentOdo) {
                currentOdo = newOdo;
                odoChanged = true;
            }
        }

        if (newState.maintenanceItems !== prevState.maintenanceItems && Array.isArray(newState.maintenanceItems)) {
            items = newState.maintenanceItems;
            itemsChanged = true;
        }

        if (odoChanged || itemsChanged) {
            if (topOdoReadout) {
                topOdoReadout.textContent = `ODÓMETRO: ${currentOdo.toLocaleString('en-US')} KM`;
            }
            renderDialsGrid(dialsGrid, items, currentOdo);
        }
    });

    // 7. Mount Bitácora Abierta
    mountNotesBoard(container);
}
