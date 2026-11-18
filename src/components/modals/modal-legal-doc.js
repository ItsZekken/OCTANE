/**
 * OCTANE // KINETIC — Legal Document Modal ("modal-legal-doc.js")
 * Minimalist tactical legal document modal.
 * 
 * Strict specifications:
 * - Clean titles: "Nuevo Documento" or "Editar Documento" (zero "//").
 * - Underline inputs without enclosed boxes or "EJ. ..." placeholders.
 * - Single-line hairline dividers, zero paragraph tags, zero blur.
 * - Tactile feedback and instant IndexedDB persistence.
 */

import { confirmDialog } from '../dialogs/app-dialog.js';
import { playHorologyTick, showToast } from '../../core/state.js';
import { saveLegalDoc, deleteLegalDoc } from '../../core/db-local.js';
import { calculateActiveAlerts } from '../../core/alerts-engine.js';
import { triggerCloudSync } from '../../core/firebase-sync.js';
import { parseIntegerMetric, formatThousandsLive } from '../../core/number-utils.js';

let modalContainer = null;
let currentDoc = null;

const DOC_TYPE_DEFAULT_TITLES = Object.freeze({
  soat: 'SOAT',
  tecnomecanica: 'Tecnomecánica',
  impuesto: 'Impuesto Vehicular',
  poliza: 'Póliza Todo Riesgo',
  otro: 'Otro Documento',
});

function normalizeDocType(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function resolveCanonicalDocType(value) {
  const norm = normalizeDocType(value);
  if (norm === 'soat') return 'soat';
  if (norm.includes('tecnomec')) return 'tecnomecanica';
  if (norm.includes('impuesto')) return 'impuesto';
  if (norm.includes('poliza')) return 'poliza';
  if (norm === 'otro') return 'otro';
  return 'otro';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Initializes the modal root container in the DOM.
 */
export function initLegalDocModal() {
  if (document.getElementById('modal-legal-doc-root')) {
    modalContainer = document.getElementById('modal-legal-doc-root');
    return;
  }

  modalContainer = document.createElement('div');
  modalContainer.id = 'modal-legal-doc-root';
  modalContainer.className = 'fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/85 opacity-0 pointer-events-none transition-opacity duration-150 select-none';
  document.body.appendChild(modalContainer);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalContainer && !modalContainer.classList.contains('pointer-events-none')) {
      closeLegalDocModal();
    }
  });

  window.addEventListener('octane:open-legal-doc-modal', (e) => {
    openLegalDocModal(e.detail || null);
  });
}

/**
 * Opens the legal doc modal.
 * @param {Object|null} doc
 */
export function openLegalDocModal(doc = null) {
  if (!modalContainer) initLegalDocModal();

  currentDoc = doc ? { ...doc } : null;

  playHorologyTick(1400, 0.02, 0.04);
  renderModal();

  modalContainer.classList.remove('opacity-0', 'pointer-events-none');
  modalContainer.classList.add('opacity-100', 'pointer-events-auto');
}

/**
 * Closes the legal doc modal.
 */
export function closeLegalDocModal() {
  if (!modalContainer) return;
  modalContainer.classList.remove('opacity-100', 'pointer-events-auto');
  modalContainer.classList.add('opacity-0', 'pointer-events-none');
  modalContainer.innerHTML = '';
  playHorologyTick(900, 0.015, 0.02);
}

/**
 * Renders modal markup.
 */
function renderModal() {
  if (!modalContainer) return;

  const isEdit = Boolean(currentDoc && currentDoc.id && !currentDoc.id.startsWith('template_'));
  const rawType = currentDoc?.docType || currentDoc?.defaultDocType || 'soat';
  const canonicalType = resolveCanonicalDocType(rawType);
  const name = currentDoc?.name || currentDoc?.title || currentDoc?.defaultTitle || (isEdit ? '' : DOC_TYPE_DEFAULT_TITLES[canonicalType]);
  const docNumber = currentDoc?.docNumber || '';
  const expiryDate = currentDoc?.expiryDate || '';
  const costCop = currentDoc?.costCop || '';
  const entity = currentDoc?.entity || '';
  const notes = currentDoc?.notes || '';

  const titleText = isEdit ? 'Editar Documento' : 'Nuevo Documento';

  modalContainer.innerHTML = `
    <div class="relative w-full max-w-md bg-[var(--bg-surface)] border border-[var(--line-hair)] text-[var(--text-primary)] rounded-none flex flex-col overflow-hidden max-h-[92vh]">
      
      <!-- Top Bar (Clean, Zero //) -->
      <header class="h-12 px-4 border-b border-[var(--line-hair)] bg-[var(--bg-void)] flex items-center justify-between shrink-0">
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 ${isEdit ? 'bg-[var(--accent-amber)]' : 'bg-[var(--accent-volt)]'}"></span>
          <span class="font-mono text-xs font-semibold tracking-widest uppercase text-[var(--text-primary)]">${titleText}</span>
        </div>
        
        <button id="legal-close-btn" type="button" class="w-8 h-8 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--line-hair)] transition-colors cursor-pointer" title="Cerrar">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </header>

      <!-- Body Form (Underline Inputs, Zero Boxes) -->
      <div class="p-5 space-y-4 overflow-y-auto flex-1 font-mono text-[10px]">
        
        <!-- Doc Type & Name -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label for="legal-input-type" class="block text-[9px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">
              TIPO DE DOCUMENTO *
            </label>
            <select 
              id="legal-input-type" 
              class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-2 text-[var(--text-primary)] text-xs font-mono uppercase outline-none cursor-pointer"
            >
              <option value="soat" ${canonicalType === 'soat' ? 'selected' : ''}>SOAT</option>
              <option value="tecnomecanica" ${canonicalType === 'tecnomecanica' ? 'selected' : ''}>TECNOMECÁNICA</option>
              <option value="impuesto" ${canonicalType === 'impuesto' ? 'selected' : ''}>IMPUESTO VEHICULAR</option>
              <option value="poliza" ${canonicalType === 'poliza' ? 'selected' : ''}>PÓLIZA TODO RIESGO</option>
              <option value="otro" ${canonicalType === 'otro' ? 'selected' : ''}>OTRO DOCUMENTO</option>
            </select>
          </div>

          <div>
            <label for="legal-input-name" class="block text-[9px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">
              NOMBRE / ROTULADO *
            </label>
            <input 
              id="legal-input-name" 
              type="text" 
              value="${escapeHtml(name)}" 
              placeholder="—" 
              class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-2 text-[var(--text-primary)] text-xs font-mono uppercase outline-none placeholder:text-[var(--text-muted)]"
            />
          </div>
        </div>

        <!-- Expiry Date & Policy Number -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label for="legal-input-expiry" class="block text-[9px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">
              FECHA DE VENCIMIENTO *
            </label>
            <input 
              id="legal-input-expiry" 
              type="date" 
              value="${escapeHtml(expiryDate)}" 
              class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-1.5 text-[var(--text-primary)] text-xs font-mono outline-none cursor-pointer"
            />
          </div>

          <div>
            <label for="legal-input-number" class="block text-[9px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">
              N° PÓLIZA / REFERENCIA
            </label>
            <input 
              id="legal-input-number" 
              type="text" 
              value="${escapeHtml(docNumber)}" 
              placeholder="—" 
              class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-2 text-[var(--text-primary)] text-xs font-mono uppercase outline-none placeholder:text-[var(--text-muted)] tabular-nums"
            />
          </div>
        </div>

        <!-- Cost COP & Entity -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label for="legal-input-cost" class="block text-[9px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">
              COSTO ($ COP)
            </label>
            <input 
              id="legal-input-cost" 
              type="text" 
              inputmode="numeric" 
              value="${costCop ? formatThousandsLive(costCop) : ''}" 
              placeholder="0" 
              class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-2 text-[var(--text-primary)] text-xs font-mono outline-none placeholder:text-[var(--text-muted)] tabular-nums"
            />
          </div>

          <div>
            <label for="legal-input-entity" class="block text-[9px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">
              ENTIDAD / ASEGURADORA
            </label>
            <input 
              id="legal-input-entity" 
              type="text" 
              value="${escapeHtml(entity)}" 
              placeholder="—" 
              class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-2 text-[var(--text-primary)] text-xs font-mono uppercase outline-none placeholder:text-[var(--text-muted)]"
            />
          </div>
        </div>

        <!-- Notes -->
        <div>
          <label for="legal-input-notes" class="block text-[9px] uppercase tracking-wider text-[var(--text-secondary)] mb-1">
            NOTAS / OBSERVACIONES
          </label>
          <input 
            id="legal-input-notes" 
            type="text" 
            value="${escapeHtml(notes)}" 
            placeholder="—" 
            class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-2 text-[var(--text-primary)] text-xs font-mono uppercase outline-none placeholder:text-[var(--text-muted)]"
          />
        </div>

      </div>

      <!-- Action Footer -->
      <footer class="p-3 bg-[var(--bg-void)] border-t border-[var(--line-hair)] flex items-center justify-between gap-2 shrink-0">
        <div>
          ${isEdit ? `
            <button 
              id="legal-delete-btn" 
              type="button" 
              class="px-3 py-2.5 flat-pill text-[var(--accent-crimson)] hover:border-[var(--accent-crimson)] font-mono text-[10px] uppercase tracking-wider transition-colors cursor-pointer"
            >
              ELIMINAR
            </button>
          ` : ''}
        </div>

        <div class="flex items-center gap-2">
          <button 
            id="legal-cancel-btn" 
            type="button" 
            class="px-3 py-2.5 flat-pill text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-mono text-[10px] uppercase tracking-wider transition-colors cursor-pointer"
          >
            CANCELAR
          </button>
          
          <button 
            id="legal-save-btn" 
            type="button" 
            class="px-4 py-2.5 bg-[var(--text-primary)] text-[var(--bg-void)] font-mono text-[10px] uppercase tracking-widest font-semibold hover:opacity-90 transition-opacity cursor-pointer"
          >
            GUARDAR DOCUMENTO
          </button>
        </div>
      </footer>

    </div>
  `;

  bindModalEvents(isEdit, canonicalType);
}

/**
 * Binds interactive events in modal.
 * @param {boolean} isEdit
 * @param {string} initialType
 */
function bindModalEvents(isEdit, initialType) {
  if (!modalContainer) return;

  const closeBtn = modalContainer.querySelector('#legal-close-btn');
  const cancelBtn = modalContainer.querySelector('#legal-cancel-btn');
  const saveBtn = modalContainer.querySelector('#legal-save-btn');
  const deleteBtn = modalContainer.querySelector('#legal-delete-btn');
  const typeSelect = modalContainer.querySelector('#legal-input-type');
  const nameInput = modalContainer.querySelector('#legal-input-name');
  const costInput = modalContainer.querySelector('#legal-input-cost');

  const close = () => closeLegalDocModal();
  if (closeBtn) closeBtn.onclick = close;
  if (cancelBtn) cancelBtn.onclick = close;

  if (costInput) {
    costInput.addEventListener('input', () => {
      costInput.value = formatThousandsLive(costInput.value);
    });
  }

  let lastAutoName = DOC_TYPE_DEFAULT_TITLES[initialType] || '';

  if (typeSelect && nameInput) {
    typeSelect.onchange = (e) => {
      const val = resolveCanonicalDocType(e.target.value);
      const currentVal = nameInput.value.trim();
      const isKnownDefault = Object.values(DOC_TYPE_DEFAULT_TITLES).some(
        (t) => normalizeDocType(t) === normalizeDocType(currentVal)
      );
      if (!currentVal || currentVal === lastAutoName || isKnownDefault) {
        const nextDefault = DOC_TYPE_DEFAULT_TITLES[val] || '';
        nameInput.value = nextDefault;
        lastAutoName = nextDefault;
      }
    };
  }

  // Delete Action
  if (deleteBtn && currentDoc?.id) {
    deleteBtn.onclick = async () => {
      const confirmed = await confirmDialog({ title: `¿ELIMINAR ESTE DOCUMENTO?`, confirmLabel: 'Eliminar', danger: true });
      if (!confirmed) return;

      try {
        await deleteLegalDoc(currentDoc.id);
        triggerCloudSync();
        playHorologyTick(600, 0.03, 0.06);
        showToast('DOCUMENTO ELIMINADO');
        closeLegalDocModal();
        window.dispatchEvent(new CustomEvent('octane:legal-doc-deleted'));
        window.dispatchEvent(new CustomEvent('octane:legal-docs-updated'));
        calculateActiveAlerts();
      } catch (err) {
        console.error('Error deleting doc:', err);
      }
    };
  }

  // Save Action
  if (saveBtn) {
    saveBtn.onclick = async () => {
      const type = resolveCanonicalDocType(typeSelect ? typeSelect.value : 'soat');
      const name = nameInput?.value?.trim() || DOC_TYPE_DEFAULT_TITLES[type] || 'Documento';
      const expiryDate = modalContainer.querySelector('#legal-input-expiry')?.value;
      const docNumber = modalContainer.querySelector('#legal-input-number')?.value?.trim() || '';
      const costCop = parseIntegerMetric(costInput?.value);
      const entity = modalContainer.querySelector('#legal-input-entity')?.value?.trim() || '';
      const notes = modalContainer.querySelector('#legal-input-notes')?.value?.trim() || '';

      if (!expiryDate) {
        showToast('INGRESE FECHA DE VENCIMIENTO');
        return;
      }

      saveBtn.disabled = true;
      saveBtn.classList.add('opacity-70', 'pointer-events-none');

      const docId = isEdit && currentDoc?.id && !currentDoc.id.startsWith('template_')
        ? currentDoc.id
        : `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      const docToSave = {
        id: docId,
        docType: type,
        name: name,
        title: name,
        docNumber: docNumber,
        expiryDate: expiryDate,
        costCop: costCop,
        entity: entity,
        notes: notes,
        updatedAt: new Date().toISOString()
      };

      try {
        await saveLegalDoc(docToSave);
        triggerCloudSync();
        playHorologyTick(1800, 0.02, 0.05);
        showToast('DOCUMENTO GUARDADO');
        closeLegalDocModal();
        window.dispatchEvent(new CustomEvent('octane:legal-doc-saved'));
        window.dispatchEvent(new CustomEvent('octane:legal-docs-updated'));
        calculateActiveAlerts();
      } catch (err) {
        console.error('Error saving doc:', err);
        showToast('ERROR AL GUARDAR');
        saveBtn.disabled = false;
        saveBtn.classList.remove('opacity-70', 'pointer-events-none');
      }
    };
  }

  // Backdrop click dismissal
  modalContainer.onclick = (e) => {
    if (e.target === modalContainer) close();
  };
}
