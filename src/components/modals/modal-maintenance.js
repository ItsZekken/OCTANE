/**
 * OCTANE // KINETIC — Modal de Mantenimiento Táctil ("modal-maintenance.js")
 * Minimalist tactical maintenance modals (Braun / Teenage Engineering aesthetics).
 * 
 * Strict specifications:
 * 1. Reset / Update Maintenance Modal:
 *    - Clean title: "Actualizar Mantenimiento" (zero "//").
 *    - Modifiable execution date (past or current) and service odometer.
 *    - Underline inputs without enclosed boxes or "EJ. ..." placeholders.
 * 2. Add Component Modal:
 *    - Clean title: "Nuevo Componente".
 *    - 12-icon interactive visual selector grid.
 *    - Underline inputs.
 * 3. Edit Component Modal:
 *    - Clean title: "Editar Componente".
 *    - Edit component name, icon, interval KM, or delete component.
 * 4. History Viewer Modal:
 *    - Clean title: "Historial de Relevos".
 * 
 * Silencio Verbal Absoluto: Zero <p> tags, zero blur, 1px precision hairlines.
 */

import { confirmDialog } from '../dialogs/app-dialog.js';
import { todayLocalYmd } from '../../core/date-utils.js';
import { store, playHorologyTick, showToast } from '../../core/state.js';
import { saveMaintenanceItem, deleteMaintenanceItem, getMaintenanceItems } from '../../core/db-local.js';
import { triggerCloudSync } from '../../core/firebase-sync.js';
import { AVAILABLE_ICONS, ICONS_CATALOG, resolveIconId, renderComponentIconSvg } from '../cluster/icons-catalog.js';
import { parseIntegerMetric, formatThousandsLive, setCursorAtEnd } from '../../core/number-utils.js';

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
 * Ensures the singleton modal container element exists in the DOM.
 */
export function initMaintenanceModal() {
    if (document.getElementById('octane-maintenance-modal-container')) {
        modalRootEl = document.getElementById('octane-maintenance-modal-container');
        return;
    }

    modalRootEl = document.createElement('div');
    modalRootEl.id = 'octane-maintenance-modal-container';
    modalRootEl.className = 'fixed inset-0 z-50 hidden select-none';
    document.body.appendChild(modalRootEl);

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modalRootEl && !modalRootEl.classList.contains('hidden')) {
            closeMaintenanceModal();
        }
    });
}

/**
 * Closes and hides the maintenance modal dialog.
 */
export function closeMaintenanceModal() {
    if (!modalRootEl) return;
    modalRootEl.classList.add('hidden');
    modalRootEl.innerHTML = '';
}

/**
 * Unified entry point to open maintenance modals.
 * @param {Object} options
 */
export function openMaintenanceModal(options = {}) {
    const { mode = 'reset', item, currentOdo = 0, onSave, onReset, onDelete } = options;
    if (mode === 'create' || mode === 'add') {
        return openAddComponentModal({ currentOdo, onSave });
    } else if (mode === 'edit') {
        return openEditComponentModal({ item, onSave, onDelete });
    } else if (mode === 'history') {
        return openHistoryMaintenanceModal({ item, currentOdo, onReset, onDelete, onSave });
    } else {
        return openResetMaintenanceModal({ item, currentOdo, onSave });
    }
}

/**
 * Generates the HTML for the 12-icon interactive selection grid.
 * @param {string} selectedIconId
 * @returns {string}
 */
function renderIconsSelectorGrid(selectedIconId = 'oil') {
    return `
      <div class="grid grid-cols-4 sm:grid-cols-6 gap-1.5 pt-1" id="maint-icons-grid">
        ${AVAILABLE_ICONS.map(icon => {
          const isSelected = icon.id === selectedIconId;
          return `
            <button
              type="button"
              data-icon-id="${icon.id}"
              class="maint-icon-btn p-2 flex flex-col items-center justify-center gap-1 border transition-all cursor-pointer rounded-xs ${
                isSelected 
                  ? 'border-[var(--accent-amber)] bg-[var(--accent-amber)]/10 text-[var(--accent-amber)]' 
                  : 'border-[var(--line-hair)] bg-[var(--bg-void)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--line-strong)]'
              }"
              title="${icon.label}"
            >
              <div class="w-5 h-5 flex items-center justify-center pointer-events-none">
                ${renderComponentIconSvg(icon.id, 'w-4 h-4')}
              </div>
              <span class="font-mono text-[8px] uppercase tracking-tighter truncate w-full text-center pointer-events-none">
                ${icon.id}
              </span>
            </button>
          `;
        }).join('')}
      </div>
    `;
}

/**
 * Attaches selection listener to icons grid.
 * @param {HTMLElement} root
 * @param {Function} onSelect
 */
function bindIconsGrid(root, onSelect) {
    const grid = root.querySelector('#maint-icons-grid');
    if (!grid) return;

    grid.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-icon-id]');
        if (!btn) return;
        const iconId = btn.getAttribute('data-icon-id');
        
        // Update styling
        grid.querySelectorAll('.maint-icon-btn').forEach(b => {
            b.classList.remove('border-[var(--accent-amber)]', 'bg-[var(--accent-amber)]/10', 'text-[var(--accent-amber)]');
            b.classList.add('border-[var(--line-hair)]', 'bg-[var(--bg-void)]', 'text-[var(--text-secondary)]');
        });
        btn.classList.add('border-[var(--accent-amber)]', 'bg-[var(--accent-amber)]/10', 'text-[var(--accent-amber)]');
        btn.classList.remove('border-[var(--line-hair)]', 'bg-[var(--bg-void)]', 'text-[var(--text-secondary)]');

        playHorologyTick(1200, 0.012, 0.02);
        if (typeof onSelect === 'function') {
            onSelect(iconId);
        }
    });
}

/**
 * Opens the Reset / Update Maintenance Modal for a component.
 * Allows modifying execution date (past or current) and mileage freely.
 * 
 * @param {Object} options
 * @param {Object} options.item - The maintenance item to calibrate/reset
 * @param {number} [options.currentOdo=0] - The highest current vehicle odometer
 * @param {Function} [options.onSave] - Callback executed upon successful update
 */
export function openResetMaintenanceModal({ item, currentOdo = 0, onSave }) {
    initMaintenanceModal();
    playHorologyTick(1400, 0.018, 0.035);

    const safeName = escapeHtml(item.name || 'COMPONENTE');
    const intervalKm = Math.max(1, Number(item.intervalKm) || 5000);
    const lastServiceOdo = Number(item.lastServiceOdo) || 0;
    const initialOdo = currentOdo > 0 ? currentOdo : (lastServiceOdo + intervalKm);
    const todayStr = todayLocalYmd();
    const iconSvg = renderComponentIconSvg(item, 'w-4 h-4 text-[var(--accent-volt)]');

    modalRootEl.innerHTML = `
      <!-- Backdrop Plano -->
      <div id="maint-modal-backdrop" class="fixed inset-0 bg-black/85 transition-opacity duration-150"></div>

      <!-- Modal Dialog Card -->
      <div class="fixed inset-0 overflow-y-auto flex items-center justify-center p-3 sm:p-4 z-10">
        <div class="relative w-full max-w-sm bg-[var(--bg-surface)] border border-[var(--line-hair)] text-[var(--text-primary)] rounded-none flex flex-col overflow-hidden">
          
          <!-- Header Plano -->
          <header class="flex items-center justify-between px-4 h-12 border-b border-[var(--line-hair)] bg-[var(--bg-void)]">
            <div class="flex items-center gap-2">
              ${iconSvg}
              <span class="font-mono text-xs tracking-widest uppercase font-semibold">Actualizar Mantenimiento</span>
            </div>
            
            <button id="maint-close-x" type="button" class="w-8 h-8 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--line-hair)] transition-colors cursor-pointer" title="Cerrar">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </header>

          <!-- Component Metadata Strip -->
          <div class="px-4 py-2 bg-[var(--bg-surface)] border-b border-[var(--line-hair)] flex items-center justify-between font-mono text-[10px] tracking-wider uppercase">
            <span class="text-[var(--text-primary)] font-medium truncate">${safeName}</span>
            <span class="text-[var(--text-secondary)] tabular-nums shrink-0">INT: ${intervalKm.toLocaleString('en-US')} KM</span>
          </div>

          <!-- Hero Numeric Entry: Odómetro Actual (Underline) -->
          <div class="p-5 bg-[var(--bg-void)] flex flex-col items-center justify-center text-center border-b border-[var(--line-hair)]">
            <span class="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)] mb-1">
              KILOMETRAJE DEL SERVICIO
            </span>
            
            <input 
              id="maint-odo-input" 
              type="text" 
              inputmode="numeric" 
              value="${formatThousandsLive(initialOdo)}"
              class="w-full font-sans font-light text-5xl tracking-tighter tabular-nums text-center bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-2 focus:outline-none text-[var(--text-primary)]" 
              autofocus 
            />

            <!-- Sub-telemetry Delta Indicator -->
            <div id="maint-delta-preview" class="font-mono text-[10px] text-[var(--accent-volt)] tabular-nums tracking-widest mt-2">
              DIAL REINICIARÁ A ${intervalKm.toLocaleString('en-US')} KM
            </div>
          </div>

          <!-- Form Fields (Clean Underlines, Zero Boxes) -->
          <div class="p-5 space-y-4 bg-[var(--bg-surface)] text-[var(--text-primary)] font-mono text-[10px]">
            
            <!-- Row: Fecha y Costo -->
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label for="maint-date-input" class="block uppercase tracking-wider text-[var(--text-secondary)] mb-1 text-[9px]">
                  FECHA EJECUCIÓN
                </label>
                <input 
                  id="maint-date-input" 
                  type="date" 
                  value="${todayStr}" 
                  class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-1.5 text-[var(--text-primary)] text-xs font-mono focus:outline-none cursor-pointer"
                />
              </div>

              <div>
                <label for="maint-cost-input" class="block uppercase tracking-wider text-[var(--text-secondary)] mb-1 text-[9px]">
                  COSTO ($ COP)
                </label>
                <input 
                  id="maint-cost-input" 
                  type="text" 
                  inputmode="numeric" 
                  placeholder="0" 
                  class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-1.5 text-[var(--text-primary)] text-xs font-mono tabular-nums focus:outline-none placeholder:text-[var(--text-muted)]"
                />
              </div>
            </div>

            <!-- Referencia / Nota Técnica -->
            <div>
              <label for="maint-notes-input" class="block uppercase tracking-wider text-[var(--text-secondary)] mb-1 text-[9px]">
                REFERENCIA / NOTA TÉCNICA
              </label>
              <input 
                id="maint-notes-input" 
                type="text" 
                maxlength="80" 
                placeholder="—" 
                class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-1.5 text-[var(--text-primary)] text-xs font-mono uppercase focus:outline-none placeholder:text-[var(--text-muted)]"
              />
            </div>
          </div>

          <!-- Action Button Strip -->
          <div class="p-3 bg-[var(--bg-void)] border-t border-[var(--line-hair)] flex gap-2">
            <button 
              id="maint-cancel-btn" 
              type="button" 
              class="w-1/3 py-3 flat-pill text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-mono text-[10px] uppercase tracking-wider transition-colors cursor-pointer text-center"
            >
              CANCELAR
            </button>
            
            <button 
              id="maint-submit-btn" 
              type="button" 
              class="flex-1 py-3 bg-[var(--text-primary)] text-[var(--bg-void)] font-mono text-[11px] uppercase tracking-widest font-semibold hover:opacity-90 transition-opacity cursor-pointer flex items-center justify-center gap-1.5"
            >
              <span class="text-xs">↻</span> GUARDAR RELEVO
            </button>
          </div>

        </div>
      </div>
    `;

    modalRootEl.classList.remove('hidden');

    const odoInput = document.getElementById('maint-odo-input');
    const costInput = document.getElementById('maint-cost-input');
    const dateInput = document.getElementById('maint-date-input');
    const notesInput = document.getElementById('maint-notes-input');
    const deltaPreview = document.getElementById('maint-delta-preview');
    const closeX = document.getElementById('maint-close-x');
    const backdrop = document.getElementById('maint-modal-backdrop');
    const cancelBtn = document.getElementById('maint-cancel-btn');
    const submitBtn = document.getElementById('maint-submit-btn');

    const updatePreview = () => {
        const val = parseIntegerMetric(odoInput.value);
        if (lastServiceOdo > 0 && val > lastServiceOdo) {
            const diff = val - lastServiceOdo;
            deltaPreview.textContent = `+${formatThousandsLive(diff)} KM DESDE ÚLTIMO RELEVO`;
        } else {
            deltaPreview.textContent = `DIAL REINICIARÁ A ${formatThousandsLive(intervalKm)} KM`;
        }
    };
    odoInput.addEventListener('input', () => {
        odoInput.value = formatThousandsLive(odoInput.value);
        updatePreview();
    });
    costInput?.addEventListener('input', () => {
        costInput.value = formatThousandsLive(costInput.value);
    });

    setTimeout(() => {
        if (odoInput) {
            odoInput.focus();
            setCursorAtEnd(odoInput);
        }
    }, 40);

    closeX?.addEventListener('click', closeMaintenanceModal);
    backdrop?.addEventListener('click', closeMaintenanceModal);
    cancelBtn?.addEventListener('click', closeMaintenanceModal);

    submitBtn?.addEventListener('click', async () => {
        const odoVal = parseIntegerMetric(odoInput.value);
        const costVal = parseIntegerMetric(costInput.value);
        const dateVal = (dateInput.value || '').trim() || todayStr;
        const notesVal = (notesInput.value || '').trim();

        if (isNaN(odoVal) || odoVal < 0) {
            odoInput.focus();
            return;
        }

        submitBtn.disabled = true;
        submitBtn.classList.add('opacity-70', 'pointer-events-none');

        try {
            if (!Array.isArray(item.history)) {
                item.history = [];
            }

            const historyRecord = {
                id: `hist_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
                date: dateVal,
                odometer: odoVal,
                costCop: costVal,
                notes: notesVal,
                previousOdo: lastServiceOdo,
                intervalKm: intervalKm,
                createdAt: new Date().toISOString(),
            };

            item.history.unshift(historyRecord);
            item.lastServiceOdo = odoVal;
            item.lastServiceDate = dateVal;
            item.updatedAt = new Date().toISOString();

            await saveMaintenanceItem(item);

            const currentItems = store.getState().maintenanceItems || [];
            const itemIdx = currentItems.findIndex(i => i.id === item.id);
            let updatedList;
            if (itemIdx >= 0) {
                updatedList = [...currentItems];
                updatedList[itemIdx] = item;
            } else {
                updatedList = [...currentItems, item];
            }
            store.setState({ maintenanceItems: updatedList });

            triggerCloudSync();

            window.dispatchEvent(new CustomEvent('octane:maintenance-updated', { detail: { item } }));

            playHorologyTick(1600, 0.02, 0.04);
            showToast('RELEVO REGISTRADO · DIAL CALIBRADO');

            closeMaintenanceModal();

            if (typeof onSave === 'function') {
                onSave(item);
            }
        } catch (err) {
            console.error('[OCTANE] Error saving maintenance reset:', err);
            submitBtn.disabled = false;
            submitBtn.classList.remove('opacity-70', 'pointer-events-none');
        }
    });
}

/**
 * Opens the Edit Component Modal.
 * Allows changing name, icon from catalog, interval KM, or deleting component.
 * 
 * @param {Object} options
 * @param {Object} options.item - Maintenance item to edit
 * @param {Function} [options.onSave]
 * @param {Function} [options.onDelete]
 */
export function openEditComponentModal({ item, onSave, onDelete }) {
    initMaintenanceModal();
    playHorologyTick(1300, 0.015, 0.03);

    const safeName = escapeHtml(item.name || 'COMPONENTE');
    const intervalKm = Math.max(1, Number(item.intervalKm) || 5000);
    let selectedIcon = resolveIconId(item);

    modalRootEl.innerHTML = `
      <div id="maint-modal-backdrop" class="fixed inset-0 bg-black/85 transition-opacity duration-150"></div>

      <div class="fixed inset-0 overflow-y-auto flex items-center justify-center p-3 sm:p-4 z-10">
        <div class="relative w-full max-w-sm bg-[var(--bg-surface)] border border-[var(--line-hair)] text-[var(--text-primary)] rounded-none flex flex-col overflow-hidden max-h-[92vh]">
          
          <!-- Header -->
          <header class="flex items-center justify-between px-4 h-12 border-b border-[var(--line-hair)] bg-[var(--bg-void)] shrink-0">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 bg-[var(--accent-amber)]"></span>
              <span class="font-mono text-xs tracking-widest uppercase font-semibold">Editar Componente</span>
            </div>
            
            <button id="maint-close-x" type="button" class="w-8 h-8 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--line-hair)] transition-colors cursor-pointer" title="Cerrar">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </header>

          <!-- Form Fields (Scrollable) -->
          <div class="p-5 space-y-4 overflow-y-auto flex-1 font-mono text-[10px]">
            
            <!-- Nombre del Componente -->
            <div>
              <label for="edit-comp-name" class="block uppercase tracking-wider text-[var(--text-secondary)] mb-1 text-[9px]">
                NOMBRE DEL COMPONENTE *
              </label>
              <input 
                id="edit-comp-name" 
                type="text" 
                maxlength="40" 
                value="${safeName}" 
                placeholder="—"
                class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-2 text-[var(--text-primary)] text-xs font-mono uppercase focus:outline-none placeholder:text-[var(--text-muted)]"
                autofocus 
              />
            </div>

            <!-- Intervalo de Servicio (KM) -->
            <div>
              <label for="edit-comp-interval" class="block uppercase tracking-wider text-[var(--text-secondary)] mb-1 text-[9px]">
                INTERVALO DE RELEVO (KM) *
              </label>
              <input 
                id="edit-comp-interval" 
                type="text" 
                inputmode="numeric" 
                value="${formatThousandsLive(intervalKm)}" 
                class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-2 text-[var(--text-primary)] text-xs font-mono tabular-nums focus:outline-none"
              />
            </div>

            <!-- Ícono Vectorial del Catálogo -->
            <div>
              <label class="block uppercase tracking-wider text-[var(--text-secondary)] mb-1.5 text-[9px]">
                ÍCONO DEL INSTRUMENTO
              </label>
              ${renderIconsSelectorGrid(selectedIcon)}
            </div>

          </div>

          <!-- Action Footer -->
          <div class="p-3 bg-[var(--bg-void)] border-t border-[var(--line-hair)] flex items-center justify-between gap-2 shrink-0">
            <button 
              id="edit-comp-delete-btn" 
              type="button" 
              class="px-3 py-2.5 flat-pill text-[var(--accent-crimson)] hover:border-[var(--accent-crimson)] font-mono text-[10px] uppercase tracking-wider transition-colors cursor-pointer"
              title="Eliminar este componente"
            >
              ELIMINAR
            </button>
            
            <div class="flex items-center gap-2">
              <button 
                id="maint-cancel-btn" 
                type="button" 
                class="px-3 py-2.5 flat-pill text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-mono text-[10px] uppercase tracking-wider transition-colors cursor-pointer"
              >
                CANCELAR
              </button>
              
              <button 
                id="edit-comp-submit-btn" 
                type="button" 
                class="px-4 py-2.5 bg-[var(--text-primary)] text-[var(--bg-void)] font-mono text-[10px] uppercase tracking-widest font-semibold hover:opacity-90 transition-opacity cursor-pointer text-center"
              >
                GUARDAR
              </button>
            </div>
          </div>

        </div>
      </div>
    `;

    modalRootEl.classList.remove('hidden');

    const nameInput = document.getElementById('edit-comp-name');
    const intervalInput = document.getElementById('edit-comp-interval');
    const closeX = document.getElementById('maint-close-x');
    const backdrop = document.getElementById('maint-modal-backdrop');
    const cancelBtn = document.getElementById('maint-cancel-btn');
    const deleteBtn = document.getElementById('edit-comp-delete-btn');
    const submitBtn = document.getElementById('edit-comp-submit-btn');

    bindIconsGrid(modalRootEl, (iconId) => {
        selectedIcon = iconId;
    });

    intervalInput?.addEventListener('input', () => {
        intervalInput.value = formatThousandsLive(intervalInput.value);
    });

    closeX?.addEventListener('click', closeMaintenanceModal);
    backdrop?.addEventListener('click', closeMaintenanceModal);
    cancelBtn?.addEventListener('click', closeMaintenanceModal);

    // Delete handler
    deleteBtn?.addEventListener('click', async () => {
        const confirmed = await confirmDialog({ title: `¿ELIMINAR "${safeName}" DEL CLÚSTER?`, confirmLabel: 'Eliminar', danger: true });
        if (!confirmed) return;

        try {
            await deleteMaintenanceItem(item.id);
            const currentItems = store.getState().maintenanceItems || [];
            store.setState({ maintenanceItems: currentItems.filter(i => i.id !== item.id) });
            triggerCloudSync();

            window.dispatchEvent(new CustomEvent('octane:maintenance-updated', { detail: { item, action: 'delete' } }));

            playHorologyTick(1100, 0.02, 0.03);
            showToast('COMPONENTE ELIMINADO');
            closeMaintenanceModal();

            if (typeof onDelete === 'function') {
                onDelete(item);
            }
        } catch (err) {
            console.error('[OCTANE] Error deleting maintenance item:', err);
        }
    });

    // Save handler
    submitBtn?.addEventListener('click', async () => {
        const rawName = (nameInput.value || '').trim();
        const intervalVal = parseIntegerMetric(intervalInput.value);

        if (!rawName) {
            nameInput.focus();
            return;
        }

        if (isNaN(intervalVal) || intervalVal <= 0) {
            intervalInput.focus();
            return;
        }

        submitBtn.disabled = true;
        submitBtn.classList.add('opacity-70', 'pointer-events-none');

        try {
            item.name = rawName.toUpperCase();
            item.intervalKm = Math.round(intervalVal);
            item.icon = selectedIcon;
            item.category = selectedIcon;
            item.updatedAt = new Date().toISOString();

            await saveMaintenanceItem(item);

            const currentItems = store.getState().maintenanceItems || [];
            const idx = currentItems.findIndex(i => i.id === item.id);
            if (idx >= 0) {
                currentItems[idx] = item;
                store.setState({ maintenanceItems: [...currentItems] });
            }

            triggerCloudSync();

            window.dispatchEvent(new CustomEvent('octane:maintenance-updated', { detail: { item, action: 'update' } }));

            playHorologyTick(1600, 0.02, 0.04);
            showToast('COMPONENTE ACTUALIZADO');
            closeMaintenanceModal();

            if (typeof onSave === 'function') {
                onSave(item);
            }
        } catch (err) {
            console.error('[OCTANE] Error updating component:', err);
            submitBtn.disabled = false;
            submitBtn.classList.remove('opacity-70', 'pointer-events-none');
        }
    });
}

/**
 * Opens the Add Component Modal (+ COMPONENTE).
 * Clean title, 12-icon interactive visual selector grid, underline inputs.
 * 
 * @param {Object} options
 * @param {number} [options.currentOdo=0]
 * @param {Function} [options.onSave]
 */
export function openAddComponentModal({ currentOdo = 0, onSave }) {
    initMaintenanceModal();
    playHorologyTick(1400, 0.018, 0.035);

    const todayStr = todayLocalYmd();
    let selectedIcon = 'general';

    modalRootEl.innerHTML = `
      <div id="maint-modal-backdrop" class="fixed inset-0 bg-black/85 transition-opacity duration-150"></div>

      <div class="fixed inset-0 overflow-y-auto flex items-center justify-center p-3 sm:p-4 z-10">
        <div class="relative w-full max-w-sm bg-[var(--bg-surface)] border border-[var(--line-hair)] text-[var(--text-primary)] rounded-none flex flex-col overflow-hidden max-h-[92vh]">
          
          <!-- Header -->
          <header class="flex items-center justify-between px-4 h-12 border-b border-[var(--line-hair)] bg-[var(--bg-void)] shrink-0">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 bg-[var(--accent-volt)]"></span>
              <span class="font-mono text-xs tracking-widest uppercase font-semibold">Nuevo Componente</span>
            </div>
            
            <button id="maint-close-x" type="button" class="w-8 h-8 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--line-hair)] transition-colors cursor-pointer" title="Cerrar">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </header>

          <!-- Form Fields (Scrollable) -->
          <div class="p-5 space-y-4 overflow-y-auto flex-1 font-mono text-[10px]">
            
            <!-- Nombre del Componente -->
            <div>
              <label for="new-comp-name" class="block uppercase tracking-wider text-[var(--text-secondary)] mb-1 text-[9px]">
                NOMBRE DEL COMPONENTE *
              </label>
              <input 
                id="new-comp-name" 
                type="text" 
                maxlength="40" 
                placeholder="—" 
                class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-2 text-[var(--text-primary)] text-xs font-mono uppercase focus:outline-none placeholder:text-[var(--text-muted)]"
                autofocus 
              />
            </div>

            <!-- Intervalo de Servicio (KM) -->
            <div>
              <label for="new-comp-interval" class="block uppercase tracking-wider text-[var(--text-secondary)] mb-1 text-[9px]">
                INTERVALO DE RELEVO (KM) *
              </label>
              <input 
                id="new-comp-interval" 
                type="text" 
                inputmode="numeric" 
                placeholder="10.000" 
                class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-2 text-[var(--text-primary)] text-xs font-mono tabular-nums focus:outline-none placeholder:text-[var(--text-muted)]"
              />
            </div>

            <!-- Odómetro Último Relevo (KM) -->
            <div>
              <label for="new-comp-odo" class="block uppercase tracking-wider text-[var(--text-secondary)] mb-1 text-[9px]">
                ODÓMETRO ÚLTIMO RELEVO (KM)
              </label>
              <input 
                id="new-comp-odo" 
                type="text" 
                inputmode="numeric" 
                value="${formatThousandsLive(currentOdo)}" 
                class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-2 text-[var(--text-primary)] text-xs font-mono tabular-nums focus:outline-none"
              />
            </div>

            <!-- Selector de Ícono -->
            <div>
              <label class="block uppercase tracking-wider text-[var(--text-secondary)] mb-1.5 text-[9px]">
                ÍCONO DEL INSTRUMENTO
              </label>
              ${renderIconsSelectorGrid(selectedIcon)}
            </div>

          </div>

          <!-- Action Button Strip -->
          <div class="p-3 bg-[var(--bg-void)] border-t border-[var(--line-hair)] flex gap-2 shrink-0">
            <button 
              id="maint-cancel-btn" 
              type="button" 
              class="w-1/3 py-3 flat-pill text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-mono text-[10px] uppercase tracking-wider transition-colors cursor-pointer text-center"
            >
              CANCELAR
            </button>
            
            <button 
              id="new-comp-submit-btn" 
              type="button" 
              class="flex-1 py-3 bg-[var(--text-primary)] text-[var(--bg-void)] font-mono text-[11px] uppercase tracking-widest font-semibold hover:opacity-90 transition-opacity cursor-pointer text-center"
            >
              + AÑADIR COMPONENTE
            </button>
          </div>

        </div>
      </div>
    `;

    modalRootEl.classList.remove('hidden');

    const nameInput = document.getElementById('new-comp-name');
    const intervalInput = document.getElementById('new-comp-interval');
    const odoInput = document.getElementById('new-comp-odo');
    const closeX = document.getElementById('maint-close-x');
    const backdrop = document.getElementById('maint-modal-backdrop');
    const cancelBtn = document.getElementById('maint-cancel-btn');
    const submitBtn = document.getElementById('new-comp-submit-btn');

    bindIconsGrid(modalRootEl, (iconId) => {
        selectedIcon = iconId;
    });

    intervalInput?.addEventListener('input', () => {
        intervalInput.value = formatThousandsLive(intervalInput.value);
    });

    odoInput?.addEventListener('input', () => {
        odoInput.value = formatThousandsLive(odoInput.value);
    });

    setTimeout(() => nameInput?.focus(), 40);

    closeX?.addEventListener('click', closeMaintenanceModal);
    backdrop?.addEventListener('click', closeMaintenanceModal);
    cancelBtn?.addEventListener('click', closeMaintenanceModal);

    submitBtn?.addEventListener('click', async () => {
        const rawName = (nameInput.value || '').trim();
        const intervalVal = parseIntegerMetric(intervalInput.value);
        const odoVal = parseIntegerMetric(odoInput.value);

        if (!rawName) {
            nameInput.focus();
            return;
        }

        if (isNaN(intervalVal) || intervalVal <= 0) {
            intervalInput.focus();
            return;
        }

        submitBtn.disabled = true;
        submitBtn.classList.add('opacity-70', 'pointer-events-none');

        try {
            const newItem = {
                id: `maint_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                name: rawName.toUpperCase(),
                intervalKm: Math.round(intervalVal),
                lastServiceOdo: Math.max(0, odoVal),
                lastServiceDate: todayStr,
                category: selectedIcon,
                icon: selectedIcon,
                history: [],
                updatedAt: new Date().toISOString(),
            };

            await saveMaintenanceItem(newItem);

            const currentItems = store.getState().maintenanceItems || [];
            store.setState({ maintenanceItems: [...currentItems, newItem] });

            triggerCloudSync();

            window.dispatchEvent(new CustomEvent('octane:maintenance-updated', { detail: { item: newItem, action: 'create' } }));

            playHorologyTick(1600, 0.02, 0.04);
            showToast('COMPONENTE AÑADIDO AL CLÚSTER');

            closeMaintenanceModal();

            if (typeof onSave === 'function') {
                onSave(newItem);
            }
        } catch (err) {
            console.error('[OCTANE] Error creating component:', err);
            submitBtn.disabled = false;
            submitBtn.classList.remove('opacity-70', 'pointer-events-none');
        }
    });
}

/**
 * Opens the History Modal for a wear dial item.
 * Clean titles, zero boxes within boxes.
 * 
 * @param {Object} options
 * @param {Object} options.item
 * @param {number} [options.currentOdo=0]
 * @param {Function} [options.onReset]
 * @param {Function} [options.onDelete]
 * @param {Function} [options.onSave]
 */
export function openHistoryMaintenanceModal({ item, currentOdo = 0, onReset, onDelete, onSave }) {
    initMaintenanceModal();
    playHorologyTick(1300, 0.015, 0.03);

    const safeName = escapeHtml(item.name || 'COMPONENTE');
    const intervalKm = Math.max(1, Number(item.intervalKm) || 5000);
    const historyList = Array.isArray(item.history) ? item.history : [];
    const iconSvg = renderComponentIconSvg(item, 'w-4 h-4 text-[var(--accent-volt)]');

    const historyItemsHtml = historyList.length > 0 
        ? historyList.map((entry, idx) => {
            const odoText = entry.odometer !== undefined ? `${Number(entry.odometer).toLocaleString('en-US')} KM` : '—';
            const costText = entry.costCop ? `$${Number(entry.costCop).toLocaleString('en-US')} COP` : '$0';
            const dateText = escapeHtml(entry.date || '—');
            const notesText = escapeHtml(entry.notes || '');

            return `
            <div class="p-3 bg-[var(--bg-void)] border border-[var(--line-hair)] flex flex-col gap-1">
              <div class="flex items-center justify-between font-mono text-[10px]">
                <div class="flex items-center gap-2">
                  <span class="text-[var(--text-secondary)]">#${historyList.length - idx}</span>
                  <span class="text-[var(--accent-volt)] font-semibold tabular-nums">${odoText}</span>
                </div>
                <span class="text-[var(--text-secondary)] tabular-nums">${dateText}</span>
              </div>
              
              <div class="flex items-center justify-between font-mono text-[10px] text-[var(--text-secondary)] pt-1 border-t border-[var(--line-hair)]">
                <span>COSTO: <span class="text-[var(--text-primary)] tabular-nums">${costText}</span></span>
                ${notesText ? `<span class="truncate max-w-[160px] text-[var(--text-secondary)]" title="${notesText}">${notesText}</span>` : '<span class="text-[var(--text-muted)]">SIN NOTA</span>'}
              </div>
            </div>
            `;
        }).join('')
        : `
        <div class="p-8 text-center font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)] border border-dashed border-[var(--line-hair)]">
          SIN RELEVOS PREVIOS REGISTRADOS
        </div>
        `;

    modalRootEl.innerHTML = `
      <div id="maint-modal-backdrop" class="fixed inset-0 bg-black/85 transition-opacity duration-150"></div>

      <div class="fixed inset-0 overflow-y-auto flex items-center justify-center p-3 sm:p-4 z-10">
        <div class="relative w-full max-w-md bg-[var(--bg-surface)] border border-[var(--line-hair)] text-[var(--text-primary)] rounded-none flex flex-col max-h-[90vh] overflow-hidden">
          
          <!-- Header -->
          <header class="flex items-center justify-between px-4 h-12 border-b border-[var(--line-hair)] bg-[var(--bg-void)] shrink-0">
            <div class="flex items-center gap-2">
              ${iconSvg}
              <span class="font-mono text-xs tracking-widest uppercase font-semibold">Historial · ${safeName}</span>
            </div>
            
            <button id="maint-close-x" type="button" class="w-8 h-8 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--line-hair)] transition-colors cursor-pointer" title="Cerrar">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </header>

          <!-- Top Telemetry Summary -->
          <div class="grid grid-cols-3 px-4 py-2 bg-[var(--bg-surface)] border-b border-[var(--line-hair)] font-mono text-[10px] tracking-wider uppercase divide-x divide-[var(--line-hair)] shrink-0">
            <div>
              <span class="text-[var(--text-secondary)]">INTERVALO:</span>
              <div class="text-[var(--text-primary)] tabular-nums font-semibold mt-0.5">${intervalKm.toLocaleString('en-US')} KM</div>
            </div>
            <div class="pl-3">
              <span class="text-[var(--text-secondary)]">TOTAL RELEVOS:</span>
              <div class="text-[var(--text-primary)] tabular-nums font-semibold mt-0.5">${historyList.length}</div>
            </div>
            <div class="pl-3">
              <span class="text-[var(--text-secondary)]">ÚLTIMO REG:</span>
              <div class="text-[var(--text-primary)] tabular-nums font-semibold mt-0.5">${item.lastServiceOdo ? `${Number(item.lastServiceOdo).toLocaleString('en-US')} KM` : '—'}</div>
            </div>
          </div>

          <!-- History Record Scroll Area -->
          <div class="p-4 space-y-2 overflow-y-auto flex-1">
            ${historyItemsHtml}
          </div>

          <!-- Footer Action Buttons -->
          <div class="p-3 bg-[var(--bg-void)] border-t border-[var(--line-hair)] flex items-center justify-between gap-2 shrink-0">
            <button 
              id="maint-delete-item-btn" 
              type="button" 
              class="px-3 py-2.5 flat-pill text-[var(--accent-crimson)] hover:border-[var(--accent-crimson)] font-mono text-[10px] uppercase tracking-wider transition-colors cursor-pointer"
              title="Eliminar este ítem"
            >
              ELIMINAR ÍTEM
            </button>

            <div class="flex items-center gap-2">
              <button 
                id="maint-history-reset-btn" 
                type="button" 
                class="px-4 py-2.5 bg-[var(--text-primary)] text-[var(--bg-void)] font-mono text-[10px] uppercase tracking-widest font-semibold hover:opacity-90 transition-opacity cursor-pointer flex items-center gap-1"
              >
                <span class="text-xs">↻</span> RELEVAR
              </button>
              
              <button 
                id="maint-close-btn" 
                type="button" 
                class="px-4 py-2.5 flat-pill text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-mono text-[10px] uppercase tracking-wider transition-colors cursor-pointer"
              >
                CERRAR
              </button>
            </div>
          </div>

        </div>
      </div>
    `;

    modalRootEl.classList.remove('hidden');

    const closeX = document.getElementById('maint-close-x');
    const backdrop = document.getElementById('maint-modal-backdrop');
    const closeBtn = document.getElementById('maint-close-btn');
    const resetBtn = document.getElementById('maint-history-reset-btn');
    const deleteBtn = document.getElementById('maint-delete-item-btn');

    closeX?.addEventListener('click', closeMaintenanceModal);
    backdrop?.addEventListener('click', closeMaintenanceModal);
    closeBtn?.addEventListener('click', closeMaintenanceModal);

    resetBtn?.addEventListener('click', () => {
        closeMaintenanceModal();
        openResetMaintenanceModal({ item, currentOdo, onSave });
    });

    deleteBtn?.addEventListener('click', async () => {
        const confirmed = await confirmDialog({ title: `¿ELIMINAR "${safeName}" DEL CLÚSTER?`, confirmLabel: 'Eliminar', danger: true });
        if (!confirmed) return;

        try {
            await deleteMaintenanceItem(item.id);

            const currentItems = store.getState().maintenanceItems || [];
            store.setState({ maintenanceItems: currentItems.filter(i => i.id !== item.id) });

            triggerCloudSync();

            playHorologyTick(1100, 0.02, 0.03);
            showToast('COMPONENTE ELIMINADO');

            closeMaintenanceModal();

            if (typeof onDelete === 'function') {
                onDelete(item);
            }
        } catch (err) {
            console.error('[OCTANE] Error deleting maintenance item:', err);
        }
    });
}
