/**
 * OCTANE — Modales de Mantenimiento del Clúster ("modal-maintenance.js")
 * Industrial Swiss precision modals (Braun / Teenage Engineering aesthetics).
 *
 * Modules:
 * 1. Registrar / Editar Servicio:
 *    - Clear non-ambiguous naming ("Registrar servicio" / "Editar servicio", zero "Reset").
 *    - Core fields: Odómetro, Fecha, Costo ($ COP), Taller / Lugar.
 *    - Dynamic component-specific optional specs (oil viscosity/type/filter, tire size/work/alignment, etc.).
 *    - Immediate IndexedDB persistence + immediate cloud sync feedback.
 * 2. Historial de Servicios:
 *    - Full readout of every logged service with specs, workshop, cost, and notes.
 *    - Individual record Edit & Delete (with history tombstone tracking for cross-device sync).
 * 3. Nuevo / Editar Componente:
 *    - Name, Interval KM, System Category (accordion group), and 12-icon selector grid.
 *
 * Silencio Verbal Absoluto: Zero <p> tags, zero "EJ." placeholders, underline inputs,
 * zero nested boxes within boxes.
 */

import { confirmDialog } from '../dialogs/app-dialog.js';
import { todayLocalYmd } from '../../core/date-utils.js';
import { store, playHorologyTick, showToast } from '../../core/state.js';
import {
    saveMaintenanceItem,
    deleteMaintenanceItem,
    sortMaintenanceHistory,
} from '../../core/db-local.js';
import { triggerCloudSync } from '../../core/firebase-sync.js';
import { AVAILABLE_ICONS, resolveIconId, renderComponentIconSvg } from '../cluster/icons-catalog.js';
import {
    MAINTENANCE_GROUPS,
    resolveMaintenanceGroup,
    getServiceSchemaForItem,
    extractSpecReadouts,
} from '../cluster/service-schemas.js';
import { parseIntegerMetric, formatThousandsLive, setCursorAtEnd } from '../../core/number-utils.js';
import { pushOverlayLayer, removeOverlayLayer } from '../../core/navigation-manager.js';

const LAYER_ID = 'modal:maintenance';
let modalRootEl = null;

const MONTHS_ES = Object.freeze([
    'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
    'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
]);

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatServiceDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return '—';
    const clean = dateStr.slice(0, 10);
    const parts = clean.split('-');
    if (parts.length !== 3) return dateStr;
    const mIdx = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    if (isNaN(mIdx) || mIdx < 0 || mIdx > 11 || isNaN(day)) return dateStr;
    return `${day} ${MONTHS_ES[mIdx]} ${parts[0]}`;
}

function formatCopFull(val) {
    const num = Number(val) || 0;
    if (num <= 0) return '—';
    return `$${Math.round(num).toLocaleString('es-CO')}`;
}

/**
 * Fires immediate cloud sync after saving a maintenance record and gives honest toast confirmation.
 * @param {string} localSavedMsg
 * @param {string} cloudSyncedMsg
 */
function syncMaintenanceImmediate(localSavedMsg, cloudSyncedMsg) {
    const state = store.getState();
    const hasCloud = Boolean(state.user && state.user.uid) && (typeof navigator === 'undefined' || navigator.onLine);

    if (!hasCloud) {
        showToast(`${localSavedMsg} · GUARDADO LOCAL`);
        triggerCloudSync();
        return;
    }

    showToast(`${localSavedMsg} · SINCRONIZANDO`);
    Promise.resolve(triggerCloudSync({ immediate: true }))
        .then((ok) => {
            if (ok) {
                showToast(cloudSyncedMsg);
            }
        })
        .catch(() => {});
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
}

/**
 * Shows the maintenance modal root and registers it on the Back-button stack.
 */
function activateMaintenanceOverlay() {
    if (!modalRootEl) return;
    modalRootEl.classList.remove('hidden');
    pushOverlayLayer(LAYER_ID, () => closeMaintenanceModal());
    modalRootEl.onclick = (e) => {
        if (!e.target || !e.target.isConnected) return;
        const wrap = modalRootEl.querySelector('.z-10');
        if (e.target === wrap) {
            closeMaintenanceModal();
        }
    };
}

/**
 * Closes and hides the maintenance modal dialog.
 */
export function closeMaintenanceModal() {
    removeOverlayLayer(LAYER_ID);
    if (!modalRootEl || modalRootEl.classList.contains('hidden')) return;
    modalRootEl.classList.add('hidden');
    modalRootEl.innerHTML = '';
}

/**
 * Unified entry point to open maintenance modals.
 * @param {Object} options
 */
export function openMaintenanceModal(options = {}) {
    const {
        mode = 'register',
        item,
        currentOdo = 0,
        entryToEdit = null,
        defaultGroup = null,
        onSave,
        onRegister,
        onReset,
        onDelete,
    } = options;

    if (mode === 'create' || mode === 'add') {
        return openAddComponentModal({ currentOdo, defaultGroup, onSave });
    }
    if (mode === 'edit') {
        return openEditComponentModal({ item, onSave, onDelete });
    }
    if (mode === 'history') {
        return openHistoryMaintenanceModal({
            item,
            currentOdo,
            onRegister: onRegister || onReset,
            onDelete,
            onSave,
        });
    }
    return openRegisterServiceModal({ item, currentOdo, entryToEdit, onSave });
}

/**
 * Renders the 12-icon interactive selection grid.
 * @param {string} selectedIconId
 * @returns {string}
 */
function renderIconsSelectorGrid(selectedIconId = 'oil') {
    return `
      <div class="grid grid-cols-4 sm:grid-cols-6 gap-1.5 pt-1" id="maint-icons-grid">
        ${AVAILABLE_ICONS.map((icon) => {
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
                title="${escapeHtml(icon.label)}"
              >
                <div class="w-5 h-5 flex items-center justify-center pointer-events-none">
                  ${renderComponentIconSvg(icon.id, 'w-4 h-4')}
                </div>
                <span class="font-mono text-[8px] uppercase tracking-tighter truncate w-full text-center pointer-events-none">
                  ${escapeHtml(icon.label.split('/')[0].trim())}
                </span>
              </button>
            `;
        }).join('')}
      </div>
    `;
}

/**
 * Renders the System Category selector chips (accordion group).
 * @param {string} selectedGroupId
 * @returns {string}
 */
function renderGroupSelectorChips(selectedGroupId = 'motor') {
    return `
      <div class="flex flex-wrap gap-1.5 pt-1" id="maint-groups-grid">
        ${MAINTENANCE_GROUPS.map((g) => {
            const isSelected = g.id === selectedGroupId;
            return `
              <button
                type="button"
                data-group-id="${g.id}"
                class="maint-group-btn px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider border transition-colors cursor-pointer ${
                    isSelected
                        ? 'border-[var(--accent-amber)] bg-[var(--accent-amber)]/12 text-[var(--accent-amber)] font-semibold'
                        : 'border-[var(--line-hair)] bg-[var(--bg-void)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--line-strong)]'
                }"
              >
                ${escapeHtml(g.label)}
              </button>
            `;
        }).join('')}
      </div>
    `;
}

function bindIconsGrid(root, onSelect) {
    const grid = root.querySelector('#maint-icons-grid');
    if (!grid) return;

    grid.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-icon-id]');
        if (!btn) return;
        const iconId = btn.getAttribute('data-icon-id');

        grid.querySelectorAll('.maint-icon-btn').forEach((b) => {
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

function bindGroupsGrid(root, onSelect) {
    const grid = root.querySelector('#maint-groups-grid');
    if (!grid) return;

    grid.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-group-id]');
        if (!btn) return;
        const groupId = btn.getAttribute('data-group-id');

        grid.querySelectorAll('.maint-group-btn').forEach((b) => {
            b.classList.remove('border-[var(--accent-amber)]', 'bg-[var(--accent-amber)]/12', 'text-[var(--accent-amber)]', 'font-semibold');
            b.classList.add('border-[var(--line-hair)]', 'bg-[var(--bg-void)]', 'text-[var(--text-secondary)]');
        });
        btn.classList.add('border-[var(--accent-amber)]', 'bg-[var(--accent-amber)]/12', 'text-[var(--accent-amber)]', 'font-semibold');
        btn.classList.remove('border-[var(--line-hair)]', 'bg-[var(--bg-void)]', 'text-[var(--text-secondary)]');

        playHorologyTick(1200, 0.012, 0.02);
        if (typeof onSelect === 'function') {
            onSelect(groupId);
        }
    });
}

/**
 * Renders the dynamic optional specification fields for a component's service form.
 * Uses clean underline inputs and tactile quick-select chips. Zero nested boxes.
 * @param {Object} schema
 * @param {Object} initialSpecs
 * @param {boolean} isEdit
 * @returns {string}
 */
function renderSchemaFieldsHtml(schema, initialSpecs = {}, isEdit = false) {
    const rows = [];
    const fields = schema.fields || [];
    let i = 0;

    while (i < fields.length) {
        const field = fields[i];

        // Pair consecutive half-width text fields cleanly in a 2-col grid
        if (field.type === 'text' && field.half && fields[i + 1]?.type === 'text' && fields[i + 1]?.half) {
            const f1 = field;
            const f2 = fields[i + 1];
            rows.push(`
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                ${renderSingleTextField(f1, initialSpecs[f1.key])}
                ${renderSingleTextField(f2, initialSpecs[f2.key])}
              </div>
            `);
            i += 2;
            continue;
        }

        if (field.type === 'text') {
            rows.push(renderSingleTextField(field, initialSpecs[field.key]));
        } else if (field.type === 'chips') {
            rows.push(renderChipsField(field, initialSpecs[field.key]));
        } else if (field.type === 'toggles') {
            rows.push(renderTogglesField(field, initialSpecs, isEdit));
        }

        i += 1;
    }

    return rows.join('');
}

function renderSingleTextField(field, value = '') {
    const safeVal = escapeHtml(value || '');
    const maxLen = field.maxLength || 50;
    return `
      <div>
        <label for="spec-input-${field.key}" class="block uppercase tracking-wider text-[var(--text-secondary)] mb-1 text-[9px]">
          ${escapeHtml(field.label)}
        </label>
        <input
          id="spec-input-${field.key}"
          data-spec-key="${field.key}"
          type="text"
          maxlength="${maxLen}"
          value="${safeVal}"
          placeholder="—"
          class="spec-text-input w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-1.5 text-[var(--text-primary)] text-xs font-mono focus:outline-none placeholder:text-[var(--text-muted)]"
        />
      </div>
    `;
}

function renderChipsField(field, initialValue = '') {
    const current = String(initialValue || '').trim();
    const isPresetMatch = (field.options || []).includes(current);
    const customVal = !isPresetMatch && current ? current : '';

    return `
      <div data-spec-chip-group="${field.key}">
        <span class="block uppercase tracking-wider text-[var(--text-secondary)] mb-2 text-[9px]">
          ${escapeHtml(field.label)}
        </span>
        <div class="flex flex-wrap gap-1.5">
          ${(field.options || []).map((opt) => {
              const active = current === opt;
              return `
                <button
                  type="button"
                  data-spec-chip="${field.key}"
                  data-value="${escapeHtml(opt)}"
                  class="spec-chip-btn px-2.5 py-1.5 font-mono text-[10px] tracking-wider border transition-colors cursor-pointer ${
                      active
                          ? 'border-[var(--accent-amber)] bg-[var(--accent-amber)]/15 text-[var(--accent-amber)] font-semibold'
                          : 'border-[var(--line-hair)] bg-[var(--bg-void)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--line-strong)]'
                  }"
                >
                  ${escapeHtml(opt)}
                </button>
              `;
          }).join('')}
        </div>
        ${field.allowCustom ? `
          <input
            type="text"
            data-spec-custom="${field.key}"
            maxlength="24"
            value="${escapeHtml(customVal)}"
            placeholder="Otra especificación"
            class="spec-custom-input mt-2 w-full sm:w-48 bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-1 text-[var(--text-primary)] text-[11px] font-mono uppercase focus:outline-none placeholder:text-[var(--text-muted)]"
          />
        ` : ''}
      </div>
    `;
}

function renderTogglesField(field, initialSpecs = {}, isEdit = false) {
    return `
      <div>
        <span class="block uppercase tracking-wider text-[var(--text-secondary)] mb-2 text-[9px]">
          ${escapeHtml(field.label)}
        </span>
        <div class="flex flex-wrap gap-2">
          ${(field.options || []).map((opt) => {
              const isOn = isEdit
                  ? Boolean(initialSpecs[opt.key])
                  : (initialSpecs[opt.key] !== undefined ? Boolean(initialSpecs[opt.key]) : Boolean(opt.defaultOn));
              return `
                <button
                  type="button"
                  data-spec-toggle="${opt.key}"
                  data-active="${isOn ? 'true' : 'false'}"
                  class="spec-toggle-btn px-2.5 py-1.5 font-mono text-[10px] tracking-wider border transition-colors cursor-pointer flex items-center gap-1.5 ${
                      isOn
                          ? 'border-[var(--accent-volt)] bg-[var(--accent-volt)]/12 text-[var(--text-primary)] font-medium'
                          : 'border-[var(--line-hair)] bg-[var(--bg-void)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--line-strong)]'
                  }"
                >
                  <span class="spec-toggle-dot w-1.5 h-1.5 rounded-full ${isOn ? 'bg-[var(--accent-volt)]' : 'bg-[var(--text-muted)]'}"></span>
                  <span>${escapeHtml(opt.label)}</span>
                </button>
              `;
          }).join('')}
        </div>
      </div>
    `;
}

/**
 * Updates store with updated maintenance item array cleanly.
 * @param {Object} savedItem
 */
function syncItemIntoStore(savedItem) {
    const currentItems = store.getState().maintenanceItems || [];
    const idx = currentItems.findIndex((i) => i.id === savedItem.id);
    const updatedList = idx >= 0
        ? currentItems.map((i, k) => (k === idx ? savedItem : i))
        : [...currentItems, savedItem];
    store.setState({ maintenanceItems: updatedList });
}

function estimateOdometerAtDate(targetDate, telemetryLogs = []) {
    if (!targetDate || !Array.isArray(telemetryLogs) || telemetryLogs.length === 0) return null;
    const targetClean = String(targetDate).slice(0, 10);
    const valid = telemetryLogs
        .filter((l) => l && l.date && Number(l.odometer_reading) > 0)
        .map((l) => ({ date: String(l.date).slice(0, 10), odo: Number(l.odometer_reading) }))
        .sort((a, b) => a.date.localeCompare(b.date) || a.odo - b.odo);
    if (valid.length === 0) return null;

    const exact = valid.find((l) => l.date === targetClean);
    if (exact) return Math.round(exact.odo);

    let before = null;
    let after = null;
    for (const l of valid) {
        if (l.date < targetClean) before = l;
        else if (l.date > targetClean && !after) after = l;
    }

    if (before && after) {
        const t0 = Date.parse(`${before.date}T12:00:00`);
        const t1 = Date.parse(`${after.date}T12:00:00`);
        const tTarget = Date.parse(`${targetClean}T12:00:00`);
        if (Number.isFinite(t0) && Number.isFinite(t1) && t1 > t0 && Number.isFinite(tTarget)) {
            const frac = (tTarget - t0) / (t1 - t0);
            return Math.round(before.odo + frac * (after.odo - before.odo));
        }
    }
    return before ? Math.round(before.odo) : (after ? Math.round(after.odo) : null);
}

/**
 * Opens the Register / Edit Service Modal for a mechanical component.
 * Replaces the ambiguous "Reset" flow with an explicit, trustworthy service record form.
 *
 * @param {Object} options
 * @param {Object} options.item - The maintenance component
 * @param {number} [options.currentOdo=0] - Highest current vehicle odometer
 * @param {Object|null} [options.entryToEdit=null] - Existing history entry when editing
 * @param {Function} [options.onSave]
 */
export function openRegisterServiceModal({ item, currentOdo = 0, entryToEdit = null, onSave }) {
    if (!item) return;
    initMaintenanceModal();
    playHorologyTick(1400, 0.018, 0.035);

    const isEdit = Boolean(entryToEdit && typeof entryToEdit === 'object');
    const safeName = escapeHtml(item.name || 'COMPONENTE');
    const intervalKm = Math.max(1, Number(item.intervalKm) || 5000);
    const lastServiceOdo = Number(item.lastServiceOdo) || 0;
    const todayStr = todayLocalYmd();
    const iconSvg = renderComponentIconSvg(item, 'w-4 h-4 text-[var(--accent-amber)]');
    const schema = getServiceSchemaForItem(item);

    const initialOdo = isEdit
        ? (Number(entryToEdit.odometer) || lastServiceOdo || 0)
        : (currentOdo > 0 ? currentOdo : (lastServiceOdo > 0 ? lastServiceOdo + intervalKm : 0));
    const initialDate = isEdit ? (entryToEdit.date || todayStr) : todayStr;
    const initialCost = isEdit && Number(entryToEdit.costCop) > 0 ? formatThousandsLive(entryToEdit.costCop) : '';
    const initialWorkshop = isEdit ? (entryToEdit.workshop || '') : '';
    const initialNotes = isEdit ? (entryToEdit.notes || '') : '';
    const initialSpecs = isEdit && entryToEdit.specs ? { ...entryToEdit.specs } : {};

    modalRootEl.innerHTML = `
      <div id="maint-modal-backdrop" class="fixed inset-0 bg-black/85 transition-opacity duration-150"></div>

      <div class="fixed inset-0 flex items-end sm:items-center justify-center sm:p-4 z-10">
        <div class="relative w-full h-[100dvh] sm:h-auto sm:max-h-[90dvh] sm:max-w-lg bg-[var(--bg-surface)] sm:border border-[var(--line-hair)] text-[var(--text-primary)] rounded-none flex flex-col overflow-hidden">

          <!-- Sticky Header -->
          <header class="flex items-center justify-between px-4 sm:px-5 h-13 min-h-[3.25rem] border-b border-[var(--line-hair)] bg-[var(--bg-void)] shrink-0">
            <div class="flex items-center gap-2.5 min-w-0">
              ${iconSvg}
              <span class="font-mono text-xs tracking-widest uppercase font-semibold truncate">
                ${isEdit ? 'Editar servicio' : 'Registrar servicio'}
              </span>
            </div>

            <button id="maint-close-x" type="button" class="w-8 h-8 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--line-hair)] transition-colors cursor-pointer shrink-0" title="Cerrar">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </header>

          <!-- Component Identification Strip -->
          <div class="px-4 sm:px-5 py-2.5 bg-[var(--bg-surface)] border-b border-[var(--line-hair)] flex items-center justify-between gap-2 font-mono text-[10px] tracking-wider uppercase shrink-0">
            <span class="text-[var(--text-primary)] font-semibold truncate">${safeName}</span>
            <span class="text-[var(--text-secondary)] tabular-nums shrink-0">CADA ${intervalKm.toLocaleString('es-CO')} KM</span>
          </div>

          <!-- Scrollable Form Body -->
          <div class="flex-1 overflow-y-auto divide-y divide-[var(--line-hair)]">

            <!-- 1. Hero Odometer Block -->
            <div class="px-5 py-5 bg-[var(--bg-void)] flex flex-col items-center text-center">
              <label for="maint-odo-input" class="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-secondary)] mb-1">
                KILOMETRAJE DEL SERVICIO (KM)
              </label>

              <input
                id="maint-odo-input"
                type="text"
                inputmode="numeric"
                value="${initialOdo > 0 ? formatThousandsLive(initialOdo) : ''}"
                placeholder="0"
                class="w-full max-w-xs font-sans font-light text-4xl sm:text-5xl tracking-tighter tabular-nums text-center bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-1.5 focus:outline-none text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
                autofocus
              />

              <div id="maint-delta-preview" class="font-mono text-[10px] text-[var(--accent-volt)] tabular-nums tracking-widest mt-2.5 uppercase"></div>
            </div>

            <!-- 2. Core Service Metadata -->
            <div class="px-5 py-4 space-y-4 font-mono text-[10px] bg-[var(--bg-surface)]">
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label for="maint-date-input" class="block uppercase tracking-wider text-[var(--text-secondary)] mb-1 text-[9px]">
                    FECHA DEL SERVICIO *
                  </label>
                  <input
                    id="maint-date-input"
                    type="date"
                    value="${escapeHtml(initialDate)}"
                    class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-1.5 text-[var(--text-primary)] text-xs font-mono focus:outline-none cursor-pointer"
                  />
                </div>

                <div>
                  <label for="maint-cost-input" class="block uppercase tracking-wider text-[var(--text-secondary)] mb-1 text-[9px]">
                    COSTO TOTAL ($ COP)
                  </label>
                  <input
                    id="maint-cost-input"
                    type="text"
                    inputmode="numeric"
                    value="${escapeHtml(initialCost)}"
                    placeholder="—"
                    class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-1.5 text-[var(--text-primary)] text-xs font-mono tabular-nums focus:outline-none placeholder:text-[var(--text-muted)]"
                  />
                </div>
              </div>

              <div>
                <label for="maint-workshop-input" class="block uppercase tracking-wider text-[var(--text-secondary)] mb-1 text-[9px]">
                  TALLER / LUGAR (OPCIONAL)
                </label>
                <input
                  id="maint-workshop-input"
                  type="text"
                  maxlength="60"
                  value="${escapeHtml(initialWorkshop)}"
                  placeholder="—"
                  class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-1.5 text-[var(--text-primary)] text-xs font-mono focus:outline-none placeholder:text-[var(--text-muted)]"
                />
              </div>
            </div>

            <!-- 3. Tailored Optional Component Specs -->
            <div class="px-5 py-4 space-y-4 font-mono text-[10px] bg-[var(--bg-surface)]" id="maint-specs-section">
              <div class="flex items-center justify-between">
                <span class="uppercase tracking-[0.16em] text-[var(--accent-amber)] text-[9px] font-semibold">
                  ${escapeHtml(schema.sectionLabel)}
                </span>
              </div>

              ${renderSchemaFieldsHtml(schema, initialSpecs, isEdit)}
            </div>

            <!-- 4. Free Technical Notes -->
            <div class="px-5 py-4 font-mono text-[10px] bg-[var(--bg-surface)]">
              <label for="maint-notes-input" class="block uppercase tracking-wider text-[var(--text-secondary)] mb-1 text-[9px]">
                NOTA TÉCNICA (OPCIONAL)
              </label>
              <textarea
                id="maint-notes-input"
                rows="2"
                maxlength="240"
                placeholder="—"
                class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-1.5 text-[var(--text-primary)] text-xs font-mono focus:outline-none placeholder:text-[var(--text-muted)] resize-none"
              >${escapeHtml(initialNotes)}</textarea>
            </div>

          </div>

          <!-- Sticky Action Footer -->
          <div class="p-3 sm:px-5 bg-[var(--bg-void)] border-t border-[var(--line-hair)] flex gap-2 shrink-0 pb-safe">
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
              class="flex-1 py-3 bg-[var(--text-primary)] text-[var(--bg-void)] font-mono text-[11px] uppercase tracking-widest font-semibold hover:opacity-90 transition-opacity cursor-pointer flex items-center justify-center gap-2"
            >
              <span>${isEdit ? 'ACTUALIZAR SERVICIO' : 'GUARDAR SERVICIO'}</span>
            </button>
          </div>

        </div>
      </div>
    `;

    activateMaintenanceOverlay();

    const odoInput = document.getElementById('maint-odo-input');
    const costInput = document.getElementById('maint-cost-input');
    const dateInput = document.getElementById('maint-date-input');
    const workshopInput = document.getElementById('maint-workshop-input');
    const notesInput = document.getElementById('maint-notes-input');
    const deltaPreview = document.getElementById('maint-delta-preview');
    const specsSection = document.getElementById('maint-specs-section');
    const closeX = document.getElementById('maint-close-x');
    const backdrop = document.getElementById('maint-modal-backdrop');
    const cancelBtn = document.getElementById('maint-cancel-btn');
    const submitBtn = document.getElementById('maint-submit-btn');

    // Track chip selections in memory for clean read on submit
    const selectedChips = {};
    for (const field of schema.fields || []) {
        if (field.type === 'chips') {
            selectedChips[field.key] = String(initialSpecs[field.key] || '').trim();
        }
    }

    // Bind chip & toggle interactions inside specs section
    specsSection?.addEventListener('click', (e) => {
        const chipBtn = e.target.closest('.spec-chip-btn');
        if (chipBtn) {
            const key = chipBtn.getAttribute('data-spec-chip');
            const val = chipBtn.getAttribute('data-value');
            const groupEl = specsSection.querySelector(`[data-spec-chip-group="${key}"]`);
            const wasSelected = selectedChips[key] === val;
            selectedChips[key] = wasSelected ? '' : val;

            groupEl?.querySelectorAll('.spec-chip-btn').forEach((b) => {
                const isNow = b.getAttribute('data-value') === selectedChips[key];
                b.classList.toggle('border-[var(--accent-amber)]', isNow);
                b.classList.toggle('bg-[var(--accent-amber)]/15', isNow);
                b.classList.toggle('text-[var(--accent-amber)]', isNow);
                b.classList.toggle('font-semibold', isNow);
                b.classList.toggle('border-[var(--line-hair)]', !isNow);
                b.classList.toggle('bg-[var(--bg-void)]', !isNow);
                b.classList.toggle('text-[var(--text-secondary)]', !isNow);
            });

            // Clear custom input when selecting a preset chip
            const customInput = groupEl?.querySelector(`[data-spec-custom="${key}"]`);
            if (customInput && !wasSelected) {
                customInput.value = '';
            }
            playHorologyTick(1200, 0.01, 0.02);
            return;
        }

        const toggleBtn = e.target.closest('.spec-toggle-btn');
        if (toggleBtn) {
            const isNow = toggleBtn.getAttribute('data-active') !== 'true';
            toggleBtn.setAttribute('data-active', isNow ? 'true' : 'false');
            toggleBtn.classList.toggle('border-[var(--accent-volt)]', isNow);
            toggleBtn.classList.toggle('bg-[var(--accent-volt)]/12', isNow);
            toggleBtn.classList.toggle('text-[var(--text-primary)]', isNow);
            toggleBtn.classList.toggle('font-medium', isNow);
            toggleBtn.classList.toggle('border-[var(--line-hair)]', !isNow);
            toggleBtn.classList.toggle('bg-[var(--bg-void)]', !isNow);
            toggleBtn.classList.toggle('text-[var(--text-secondary)]', !isNow);
            const dot = toggleBtn.querySelector('.spec-toggle-dot');
            if (dot) {
                dot.classList.toggle('bg-[var(--accent-volt)]', isNow);
                dot.classList.toggle('bg-[var(--text-muted)]', !isNow);
            }
            playHorologyTick(1300, 0.01, 0.02);
        }
    });

    // If user types in a custom chip input (e.g., unusual oil viscosity), clear preset chips
    specsSection?.addEventListener('input', (e) => {
        const customInput = e.target.closest('.spec-custom-input');
        if (!customInput) return;
        const key = customInput.getAttribute('data-spec-custom');
        const val = customInput.value.trim();
        selectedChips[key] = val;
        if (val) {
            const groupEl = specsSection.querySelector(`[data-spec-chip-group="${key}"]`);
            groupEl?.querySelectorAll('.spec-chip-btn').forEach((b) => {
                b.classList.remove('border-[var(--accent-amber)]', 'bg-[var(--accent-amber)]/15', 'text-[var(--accent-amber)]', 'font-semibold');
                b.classList.add('border-[var(--line-hair)]', 'bg-[var(--bg-void)]', 'text-[var(--text-secondary)]');
            });
        }
    });

    let odoManuallyEdited = isEdit;
    const telemetryLogs = store.getState().telemetryLogs || [];

    const updatePreview = (estimatedHint = false) => {
        const val = parseIntegerMetric(odoInput.value);
        if (val <= 0) {
            deltaPreview.className = 'font-mono text-[10px] text-[var(--accent-volt)] tabular-nums tracking-widest mt-2.5 uppercase';
            deltaPreview.textContent = `PRÓXIMO CAMBIO CADA ${formatThousandsLive(intervalKm)} KM`;
            return;
        }
        const dateVal = (dateInput?.value || '').trim();
        const historicalEst = dateVal && dateVal < todayStr ? estimateOdometerAtDate(dateVal, telemetryLogs) : null;
        if (estimatedHint && historicalEst) {
            deltaPreview.className = 'font-mono text-[10px] text-[var(--accent-amber)] tabular-nums tracking-widest mt-2.5 uppercase';
            deltaPreview.textContent = `ODÓMETRO ESTIMADO PARA ${dateVal} · EDITABLE`;
            return;
        }
        if (historicalEst && currentOdo > 0 && Math.abs(val - currentOdo) <= 50 && (currentOdo - historicalEst) >= 500) {
            deltaPreview.className = 'font-mono text-[10px] text-[var(--accent-amber)] tabular-nums tracking-widest mt-2.5 uppercase';
            deltaPreview.textContent = `VERIFICAR KM · EN ${dateVal} RONDABA ${formatThousandsLive(historicalEst)} KM`;
            return;
        }
        deltaPreview.className = 'font-mono text-[10px] text-[var(--accent-volt)] tabular-nums tracking-widest mt-2.5 uppercase';
        const nextDue = val + intervalKm;
        if (!isEdit && lastServiceOdo > 0 && val < lastServiceOdo) {
            deltaPreview.textContent = `REGISTRO HISTÓRICO · ÚLTIMO ACTUAL: ${formatThousandsLive(lastServiceOdo)} KM`;
        } else {
            deltaPreview.textContent = `PRÓXIMO SERVICIO A LOS ${formatThousandsLive(nextDue)} KM`;
        }
    };

    updatePreview();

    odoInput?.addEventListener('input', () => {
        odoManuallyEdited = true;
        odoInput.value = formatThousandsLive(odoInput.value);
        updatePreview();
    });
    dateInput?.addEventListener('change', () => {
        const chosenDate = (dateInput.value || '').trim();
        if (!isEdit && !odoManuallyEdited && chosenDate && chosenDate < todayStr) {
            const est = estimateOdometerAtDate(chosenDate, telemetryLogs);
            if (est && est > 0) {
                odoInput.value = formatThousandsLive(est);
                updatePreview(true);
                return;
            }
        }
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
        const workshopVal = (workshopInput.value || '').trim();
        const notesVal = (notesInput.value || '').trim();

        if (isNaN(odoVal) || odoVal <= 0) {
            showToast('INGRESA EL KILOMETRAJE DEL SERVICIO');
            odoInput.focus();
            return;
        }

        // Collect all non-empty optional specs
        const specs = {};
        for (const [k, v] of Object.entries(selectedChips)) {
            if (v && String(v).trim()) {
                specs[k] = String(v).trim();
            }
        }
        specsSection?.querySelectorAll('.spec-text-input').forEach((input) => {
            const key = input.getAttribute('data-spec-key');
            const val = (input.value || '').trim();
            if (key && val) specs[key] = val;
        });
        specsSection?.querySelectorAll('.spec-toggle-btn').forEach((btn) => {
            const key = btn.getAttribute('data-spec-toggle');
            if (key && btn.getAttribute('data-active') === 'true') {
                specs[key] = true;
            }
        });

        submitBtn.disabled = true;
        submitBtn.classList.add('opacity-70', 'pointer-events-none');

        try {
            const nowIso = new Date().toISOString();
            const existingHistory = Array.isArray(item.history) ? [...item.history] : [];

            const record = {
                id: (isEdit && entryToEdit.id) ? entryToEdit.id : `hist_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                date: dateVal,
                odometer: odoVal,
                costCop: costVal,
                workshop: workshopVal,
                notes: notesVal,
                specs,
                previousOdo: isEdit ? (entryToEdit.previousOdo ?? lastServiceOdo) : lastServiceOdo,
                intervalKm,
                createdAt: isEdit ? (entryToEdit.createdAt || nowIso) : nowIso,
                updatedAt: nowIso,
            };

            let nextHistory;
            if (isEdit) {
                let idx = entryToEdit.id ? existingHistory.findIndex((h) => h.id === entryToEdit.id) : -1;
                if (idx < 0) {
                    idx = existingHistory.findIndex((h) =>
                        h && h.date === entryToEdit.date && Number(h.odometer) === Number(entryToEdit.odometer)
                    );
                }
                if (idx >= 0) {
                    nextHistory = existingHistory.map((h, k) => (k === idx ? record : h));
                } else {
                    nextHistory = [record, ...existingHistory];
                }
            } else {
                nextHistory = [record, ...existingHistory];
            }

            const sortedHistory = sortMaintenanceHistory(nextHistory);
            const updatedItem = {
                ...item,
                history: sortedHistory,
                lastServiceOdo: sortedHistory.length > 0 ? Number(sortedHistory[0].odometer) || odoVal : odoVal,
                lastServiceDate: sortedHistory.length > 0 ? (sortedHistory[0].date || dateVal) : dateVal,
                isDefaultSeed: false,
                updatedAt: nowIso,
            };

            const savedItem = await saveMaintenanceItem(updatedItem);
            syncItemIntoStore(savedItem);

            window.dispatchEvent(new CustomEvent('octane:maintenance-updated', {
                detail: { item: savedItem, action: isEdit ? 'edit-service' : 'register-service' },
            }));

            playHorologyTick(1600, 0.02, 0.04);
            closeMaintenanceModal();

            syncMaintenanceImmediate(
                isEdit ? 'SERVICIO ACTUALIZADO' : 'SERVICIO GUARDADO',
                isEdit ? 'SERVICIO ACTUALIZADO EN LA NUBE' : 'SERVICIO SINCRONIZADO EN LA NUBE'
            );

            if (typeof onSave === 'function') {
                onSave(savedItem);
            }
        } catch (err) {
            console.error('[OCTANE] Error saving maintenance service:', err);
            showToast('ERROR AL GUARDAR SERVICIO');
            submitBtn.disabled = false;
            submitBtn.classList.remove('opacity-70', 'pointer-events-none');
        }
    });
}

// Backward-compatible alias for legacy callers
export const openResetMaintenanceModal = openRegisterServiceModal;

/**
 * Opens the Edit Component Modal.
 * Allows changing name, system category, icon, interval KM, or deleting component.
 */
export function openEditComponentModal({ item, onSave, onDelete }) {
    if (!item) return;
    initMaintenanceModal();
    playHorologyTick(1300, 0.015, 0.03);

    const safeName = escapeHtml(item.name || 'COMPONENTE');
    const intervalKm = Math.max(1, Number(item.intervalKm) || 5000);
    let selectedIcon = resolveIconId(item);
    let selectedGroup = resolveMaintenanceGroup(item);

    modalRootEl.innerHTML = `
      <div id="maint-modal-backdrop" class="fixed inset-0 bg-black/85 transition-opacity duration-150"></div>

      <div class="fixed inset-0 flex items-end sm:items-center justify-center sm:p-4 z-10">
        <div class="relative w-full h-[100dvh] sm:h-auto sm:max-h-[90dvh] sm:max-w-md bg-[var(--bg-surface)] sm:border border-[var(--line-hair)] text-[var(--text-primary)] rounded-none flex flex-col overflow-hidden">

          <header class="flex items-center justify-between px-4 sm:px-5 h-12 border-b border-[var(--line-hair)] bg-[var(--bg-void)] shrink-0">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 bg-[var(--accent-amber)]"></span>
              <span class="font-mono text-xs tracking-widest uppercase font-semibold">Editar componente</span>
            </div>

            <button id="maint-close-x" type="button" class="w-8 h-8 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--line-hair)] transition-colors cursor-pointer" title="Cerrar">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </header>

          <div class="p-5 space-y-5 overflow-y-auto flex-1 font-mono text-[10px]">
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

            <div>
              <label for="edit-comp-interval" class="block uppercase tracking-wider text-[var(--text-secondary)] mb-1 text-[9px]">
                INTERVALO DE SERVICIO (KM) *
              </label>
              <input
                id="edit-comp-interval"
                type="text"
                inputmode="numeric"
                value="${formatThousandsLive(intervalKm)}"
                class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-2 text-[var(--text-primary)] text-xs font-mono tabular-nums focus:outline-none"
              />
            </div>

            <div>
              <span class="block uppercase tracking-wider text-[var(--text-secondary)] mb-1 text-[9px]">
                CATEGORÍA DEL CLÚSTER
              </span>
              ${renderGroupSelectorChips(selectedGroup)}
            </div>

            <div>
              <span class="block uppercase tracking-wider text-[var(--text-secondary)] mb-1 text-[9px]">
                TIPO DE COMPONENTE E ÍCONO
              </span>
              ${renderIconsSelectorGrid(selectedIcon)}
            </div>
          </div>

          <div class="p-3 sm:px-5 bg-[var(--bg-void)] border-t border-[var(--line-hair)] flex items-center justify-between gap-2 shrink-0 pb-safe">
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

    activateMaintenanceOverlay();

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
    bindGroupsGrid(modalRootEl, (groupId) => {
        selectedGroup = groupId;
    });

    intervalInput?.addEventListener('input', () => {
        intervalInput.value = formatThousandsLive(intervalInput.value);
    });

    closeX?.addEventListener('click', closeMaintenanceModal);
    backdrop?.addEventListener('click', closeMaintenanceModal);
    cancelBtn?.addEventListener('click', closeMaintenanceModal);

    deleteBtn?.addEventListener('click', async () => {
        const confirmed = await confirmDialog({
            title: `¿ELIMINAR "${safeName}" DEL CLÚSTER?`,
            confirmLabel: 'Eliminar',
            danger: true,
        });
        if (!confirmed) return;

        try {
            await deleteMaintenanceItem(item.id);
            const currentItems = store.getState().maintenanceItems || [];
            store.setState({ maintenanceItems: currentItems.filter((i) => i.id !== item.id) });

            window.dispatchEvent(new CustomEvent('octane:maintenance-updated', { detail: { item, action: 'delete' } }));

            playHorologyTick(1100, 0.02, 0.03);
            closeMaintenanceModal();
            syncMaintenanceImmediate('COMPONENTE ELIMINADO', 'ELIMINACIÓN SINCRONIZADA');

            if (typeof onDelete === 'function') {
                onDelete(item);
            }
        } catch (err) {
            console.error('[OCTANE] Error deleting maintenance item:', err);
        }
    });

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
            const savedItem = await saveMaintenanceItem({
                ...item,
                name: rawName.toUpperCase(),
                intervalKm: Math.round(intervalVal),
                icon: selectedIcon,
                category: selectedIcon,
                group: selectedGroup,
                isDefaultSeed: false,
                updatedAt: new Date().toISOString(),
            });

            syncItemIntoStore(savedItem);
            window.dispatchEvent(new CustomEvent('octane:maintenance-updated', { detail: { item: savedItem, action: 'update' } }));

            playHorologyTick(1600, 0.02, 0.04);
            closeMaintenanceModal();
            syncMaintenanceImmediate('COMPONENTE ACTUALIZADO', 'COMPONENTE SINCRONIZADO');

            if (typeof onSave === 'function') {
                onSave(savedItem);
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
 */
export function openAddComponentModal({ currentOdo = 0, defaultGroup = null, onSave }) {
    initMaintenanceModal();
    playHorologyTick(1400, 0.018, 0.035);

    let selectedIcon = 'general';
    let selectedGroup = defaultGroup || 'general';
    let groupManuallyChosen = Boolean(defaultGroup);

    modalRootEl.innerHTML = `
      <div id="maint-modal-backdrop" class="fixed inset-0 bg-black/85 transition-opacity duration-150"></div>

      <div class="fixed inset-0 flex items-end sm:items-center justify-center sm:p-4 z-10">
        <div class="relative w-full h-[100dvh] sm:h-auto sm:max-h-[90dvh] sm:max-w-md bg-[var(--bg-surface)] sm:border border-[var(--line-hair)] text-[var(--text-primary)] rounded-none flex flex-col overflow-hidden">

          <header class="flex items-center justify-between px-4 sm:px-5 h-12 border-b border-[var(--line-hair)] bg-[var(--bg-void)] shrink-0">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 bg-[var(--accent-volt)]"></span>
              <span class="font-mono text-xs tracking-widest uppercase font-semibold">Nuevo componente</span>
            </div>

            <button id="maint-close-x" type="button" class="w-8 h-8 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--line-hair)] transition-colors cursor-pointer" title="Cerrar">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </header>

          <div class="p-5 space-y-5 overflow-y-auto flex-1 font-mono text-[10px]">
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

            <div class="grid grid-cols-2 gap-4">
              <div>
                <label for="new-comp-interval" class="block uppercase tracking-wider text-[var(--text-secondary)] mb-1 text-[9px]">
                  INTERVALO (KM) *
                </label>
                <input
                  id="new-comp-interval"
                  type="text"
                  inputmode="numeric"
                  placeholder="10.000"
                  class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-2 text-[var(--text-primary)] text-xs font-mono tabular-nums focus:outline-none placeholder:text-[var(--text-muted)]"
                />
              </div>

              <div>
                <label for="new-comp-odo" class="block uppercase tracking-wider text-[var(--text-secondary)] mb-1 text-[9px]">
                  ÚLTIMO CAMBIO (KM, OPC.)
                </label>
                <input
                  id="new-comp-odo"
                  type="text"
                  inputmode="numeric"
                  placeholder="—"
                  class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-2 text-[var(--text-primary)] text-xs font-mono tabular-nums focus:outline-none placeholder:text-[var(--text-muted)]"
                />
              </div>
            </div>

            <div>
              <span class="block uppercase tracking-wider text-[var(--text-secondary)] mb-1 text-[9px]">
                TIPO DE COMPONENTE E ÍCONO
              </span>
              ${renderIconsSelectorGrid(selectedIcon)}
            </div>

            <div>
              <span class="block uppercase tracking-wider text-[var(--text-secondary)] mb-1 text-[9px]">
                CATEGORÍA DEL CLÚSTER
              </span>
              ${renderGroupSelectorChips(selectedGroup)}
            </div>
          </div>

          <div class="p-3 sm:px-5 bg-[var(--bg-void)] border-t border-[var(--line-hair)] flex gap-2 shrink-0 pb-safe">
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

    activateMaintenanceOverlay();

    const nameInput = document.getElementById('new-comp-name');
    const intervalInput = document.getElementById('new-comp-interval');
    const odoInput = document.getElementById('new-comp-odo');
    const closeX = document.getElementById('maint-close-x');
    const backdrop = document.getElementById('maint-modal-backdrop');
    const cancelBtn = document.getElementById('maint-cancel-btn');
    const submitBtn = document.getElementById('new-comp-submit-btn');

    const highlightGroupBtn = (groupId) => {
        const grid = modalRootEl.querySelector('#maint-groups-grid');
        grid?.querySelectorAll('.maint-group-btn').forEach((b) => {
            const isSel = b.getAttribute('data-group-id') === groupId;
            b.classList.toggle('border-[var(--accent-amber)]', isSel);
            b.classList.toggle('bg-[var(--accent-amber)]/12', isSel);
            b.classList.toggle('text-[var(--accent-amber)]', isSel);
            b.classList.toggle('font-semibold', isSel);
            b.classList.toggle('border-[var(--line-hair)]', !isSel);
            b.classList.toggle('bg-[var(--bg-void)]', !isSel);
            b.classList.toggle('text-[var(--text-secondary)]', !isSel);
        });
    };

    bindIconsGrid(modalRootEl, (iconId) => {
        selectedIcon = iconId;
        if (!groupManuallyChosen) {
            selectedGroup = resolveMaintenanceGroup({ icon: iconId });
            highlightGroupBtn(selectedGroup);
        }
    });

    bindGroupsGrid(modalRootEl, (groupId) => {
        selectedGroup = groupId;
        groupManuallyChosen = true;
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
            const newItem = await saveMaintenanceItem({
                id: `maint_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                name: rawName.toUpperCase(),
                intervalKm: Math.round(intervalVal),
                lastServiceOdo: Math.max(0, odoVal),
                lastServiceDate: odoVal > 0 ? todayLocalYmd() : '',
                category: selectedIcon,
                icon: selectedIcon,
                group: selectedGroup,
                history: [],
                isDefaultSeed: false,
                updatedAt: new Date().toISOString(),
            });

            syncItemIntoStore(newItem);
            window.dispatchEvent(new CustomEvent('octane:maintenance-updated', { detail: { item: newItem, action: 'create' } }));

            playHorologyTick(1600, 0.02, 0.04);
            closeMaintenanceModal();
            syncMaintenanceImmediate('COMPONENTE CREADO', 'COMPONENTE SINCRONIZADO');

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
 * Opens the Service History Modal for a component.
 * Displays rich technical specs, workshop, cost, notes, and allows editing/deleting any record.
 */
export function openHistoryMaintenanceModal({ item, currentOdo = 0, onRegister, onReset, onDelete, onSave }) {
    if (!item) return;
    initMaintenanceModal();
    playHorologyTick(1300, 0.015, 0.03);

    const safeName = escapeHtml(item.name || 'COMPONENTE');
    const intervalKm = Math.max(1, Number(item.intervalKm) || 5000);
    const historyList = sortMaintenanceHistory(Array.isArray(item.history) ? item.history : []);
    const iconSvg = renderComponentIconSvg(item, 'w-4 h-4 text-[var(--accent-amber)]');
    const totalSpent = historyList.reduce((acc, h) => acc + (Number(h.costCop) || 0), 0);

    const historyItemsHtml = historyList.length > 0
        ? historyList.map((entry, idx) => {
            const entryId = escapeHtml(entry.id || `idx_${idx}`);
            const odoText = entry.odometer !== undefined && Number(entry.odometer) > 0
                ? `${Number(entry.odometer).toLocaleString('es-CO')} KM`
                : '—';
            const costText = formatCopFull(entry.costCop);
            const dateText = formatServiceDate(entry.date);
            const workshopText = escapeHtml(entry.workshop || '');
            const notesText = escapeHtml(entry.notes || '');
            const specReadouts = extractSpecReadouts(entry, item);

            return `
              <div class="px-5 py-4 space-y-2.5 bg-[var(--bg-surface)]" data-entry-id="${entryId}">
                <!-- Top line: index + date + odometer + cost -->
                <div class="flex items-baseline justify-between gap-3">
                  <div class="flex items-baseline gap-2.5 min-w-0">
                    <span class="font-mono text-[10px] text-[var(--text-muted)] tabular-nums">#${historyList.length - idx}</span>
                    <span class="font-sans font-medium text-base text-[var(--text-primary)] tabular-nums">${odoText}</span>
                    <span class="font-mono text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">${dateText}</span>
                  </div>
                  <span class="font-mono text-xs tabular-nums ${Number(entry.costCop) > 0 ? 'text-[var(--text-primary)] font-medium' : 'text-[var(--text-muted)]'} shrink-0">
                    ${costText}
                  </span>
                </div>

                ${workshopText ? `
                  <div class="font-mono text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">
                    TALLER: <span class="text-[var(--text-primary)]">${workshopText}</span>
                  </div>
                ` : ''}

                ${specReadouts.length > 0 ? `
                  <div class="flex flex-wrap gap-1.5 pt-0.5">
                    ${specReadouts.map((r) => `
                      <span class="px-2 py-0.5 border border-[var(--line-hair)] bg-[var(--bg-void)] font-mono text-[10px] tracking-wider text-[var(--text-primary)]">
                        ${r.isToggle
                            ? `<span class="text-[var(--accent-volt)] mr-1">✓</span>${escapeHtml(r.label)}`
                            : `<span class="text-[var(--text-secondary)] mr-1 uppercase text-[9px]">${escapeHtml(r.label)}:</span>${escapeHtml(r.value)}`
                        }
                      </span>
                    `).join('')}
                  </div>
                ` : ''}

                ${notesText ? `
                  <div class="font-mono text-[11px] text-[var(--text-secondary)] leading-relaxed break-words">
                    ${notesText}
                  </div>
                ` : ''}

                <!-- Row Actions -->
                <div class="flex items-center justify-end gap-3 pt-1 font-mono text-[9px] uppercase tracking-widest">
                  <button
                    type="button"
                    data-history-action="edit"
                    data-entry-id="${entryId}"
                    class="text-[var(--text-secondary)] hover:text-[var(--accent-amber)] transition-colors cursor-pointer"
                  >
                    EDITAR
                  </button>
                  <button
                    type="button"
                    data-history-action="delete"
                    data-entry-id="${entryId}"
                    class="text-[var(--text-muted)] hover:text-[var(--accent-crimson)] transition-colors cursor-pointer"
                  >
                    ELIMINAR
                  </button>
                </div>
              </div>
            `;
        }).join('')
        : `
          <div class="px-5 py-12 text-center font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
            SIN SERVICIOS REGISTRADOS
          </div>
        `;

    modalRootEl.innerHTML = `
      <div id="maint-modal-backdrop" class="fixed inset-0 bg-black/85 transition-opacity duration-150"></div>

      <div class="fixed inset-0 flex items-end sm:items-center justify-center sm:p-4 z-10">
        <div class="relative w-full h-[100dvh] sm:h-auto sm:max-h-[90dvh] sm:max-w-lg bg-[var(--bg-surface)] sm:border border-[var(--line-hair)] text-[var(--text-primary)] rounded-none flex flex-col overflow-hidden">

          <header class="flex items-center justify-between px-4 sm:px-5 h-12 border-b border-[var(--line-hair)] bg-[var(--bg-void)] shrink-0">
            <div class="flex items-center gap-2 min-w-0">
              ${iconSvg}
              <span class="font-mono text-xs tracking-widest uppercase font-semibold truncate">Historial · ${safeName}</span>
            </div>

            <button id="maint-close-x" type="button" class="w-8 h-8 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--line-hair)] transition-colors cursor-pointer shrink-0" title="Cerrar">
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </header>

          <!-- Top Telemetry Summary (Flat Hairline Strip) -->
          <div class="grid grid-cols-3 px-4 sm:px-5 py-3 bg-[var(--bg-void)] border-b border-[var(--line-hair)] font-mono text-[10px] tracking-wider uppercase divide-x divide-[var(--line-hair)] shrink-0">
            <div class="pr-3">
              <span class="text-[var(--text-secondary)] text-[9px]">INTERVALO</span>
              <div class="text-[var(--text-primary)] tabular-nums font-semibold mt-0.5">${intervalKm.toLocaleString('es-CO')} KM</div>
            </div>
            <div class="px-3">
              <span class="text-[var(--text-secondary)] text-[9px]">SERVICIOS</span>
              <div class="text-[var(--text-primary)] tabular-nums font-semibold mt-0.5">${historyList.length}</div>
            </div>
            <div class="pl-3">
              <span class="text-[var(--text-secondary)] text-[9px]">INVERTIDO</span>
              <div class="text-[var(--text-primary)] tabular-nums font-semibold mt-0.5">${totalSpent > 0 ? formatCopFull(totalSpent) : '—'}</div>
            </div>
          </div>

          <!-- History Scroll Area (Flat divide-y) -->
          <div id="maint-history-list" class="overflow-y-auto flex-1 divide-y divide-[var(--line-hair)]">
            ${historyItemsHtml}
          </div>

          <!-- Footer Action Buttons -->
          <div class="p-3 sm:px-5 bg-[var(--bg-void)] border-t border-[var(--line-hair)] flex items-center justify-between gap-2 shrink-0 pb-safe">
            <button
              id="maint-edit-comp-btn"
              type="button"
              class="px-3 py-2.5 flat-pill text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-mono text-[10px] uppercase tracking-wider transition-colors cursor-pointer"
            >
              CONFIGURAR
            </button>

            <div class="flex items-center gap-2">
              <button
                id="maint-history-register-btn"
                type="button"
                class="px-4 py-2.5 bg-[var(--text-primary)] text-[var(--bg-void)] font-mono text-[10px] uppercase tracking-widest font-semibold hover:opacity-90 transition-opacity cursor-pointer"
              >
                + REGISTRAR
              </button>

              <button
                id="maint-close-btn"
                type="button"
                class="px-3 py-2.5 flat-pill text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-mono text-[10px] uppercase tracking-wider transition-colors cursor-pointer"
              >
                CERRAR
              </button>
            </div>
          </div>

        </div>
      </div>
    `;

    activateMaintenanceOverlay();

    const closeX = document.getElementById('maint-close-x');
    const backdrop = document.getElementById('maint-modal-backdrop');
    const closeBtn = document.getElementById('maint-close-btn');
    const registerBtn = document.getElementById('maint-history-register-btn');
    const editCompBtn = document.getElementById('maint-edit-comp-btn');
    const historyContainer = document.getElementById('maint-history-list');

    closeX?.addEventListener('click', closeMaintenanceModal);
    backdrop?.addEventListener('click', closeMaintenanceModal);
    closeBtn?.addEventListener('click', closeMaintenanceModal);

    registerBtn?.addEventListener('click', () => {
        closeMaintenanceModal();
        if (typeof onRegister === 'function') {
            onRegister();
        } else if (typeof onReset === 'function') {
            onReset();
        } else {
            openRegisterServiceModal({ item, currentOdo, onSave });
        }
    });

    editCompBtn?.addEventListener('click', () => {
        closeMaintenanceModal();
        openEditComponentModal({ item, onSave, onDelete });
    });

    // Individual history entry edit / delete
    historyContainer?.addEventListener('click', async (e) => {
        const actionBtn = e.target.closest('[data-history-action]');
        if (!actionBtn) return;

        const action = actionBtn.getAttribute('data-history-action');
        const entryId = actionBtn.getAttribute('data-entry-id');
        const targetEntry = historyList.find((h, idx) => (h.id || `idx_${idx}`) === entryId);
        if (!targetEntry) return;

        if (action === 'edit') {
            closeMaintenanceModal();
            openRegisterServiceModal({
                item,
                currentOdo,
                entryToEdit: targetEntry,
                onSave: (updatedItem) => {
                    if (typeof onSave === 'function') onSave(updatedItem);
                },
            });
            return;
        }

        if (action === 'delete') {
            const confirmed = await confirmDialog({
                title: `¿ELIMINAR SERVICIO DEL ${formatServiceDate(targetEntry.date).toUpperCase()}?`,
                confirmLabel: 'Eliminar',
                danger: true,
            });
            if (!confirmed) return;

            try {
                const remaining = historyList.filter((h, idx) => (h.id || `idx_${idx}`) !== entryId);
                const deletedHistoryIds = Array.isArray(item.deletedHistoryIds) ? [...item.deletedHistoryIds] : [];
                if (targetEntry.id && !deletedHistoryIds.includes(targetEntry.id)) {
                    deletedHistoryIds.push(targetEntry.id);
                }

                const sorted = sortMaintenanceHistory(remaining);
                const savedItem = await saveMaintenanceItem({
                    ...item,
                    history: sorted,
                    deletedHistoryIds,
                    lastServiceOdo: sorted.length > 0 ? (Number(sorted[0].odometer) || 0) : 0,
                    lastServiceDate: sorted.length > 0 ? (sorted[0].date || '') : '',
                    isDefaultSeed: false,
                    updatedAt: new Date().toISOString(),
                });

                syncItemIntoStore(savedItem);
                window.dispatchEvent(new CustomEvent('octane:maintenance-updated', {
                    detail: { item: savedItem, action: 'delete-service' },
                }));

                playHorologyTick(1000, 0.02, 0.03);
                syncMaintenanceImmediate('REGISTRO ELIMINADO', 'CAMBIO SINCRONIZADO');

                if (typeof onSave === 'function') onSave(savedItem);

                // Re-render history modal in place with updated item
                openHistoryMaintenanceModal({
                    item: savedItem,
                    currentOdo,
                    onRegister,
                    onReset,
                    onDelete,
                    onSave,
                });
            } catch (err) {
                console.error('[OCTANE] Error deleting history entry:', err);
                showToast('ERROR AL ELIMINAR REGISTRO');
            }
        }
    });
}
