/**
 * OCTANE // KINETIC — Free Notes Board Component ("BITÁCORA ABIERTA")
 * 
 * Swiss Precision Telemetry Notes Board:
 * - Wide multiline textarea (rows="3") without lateral borders, single hairline underline.
 * - Interactive bottom chips:
 *     1. Date chip: Defaults to today ("Hoy · 21 Oct"), opens date picker for past notes.
 *     2. Mileage chip: Active with current odometer, editable or toggleable.
 *     3. Dynamic Category Manager: 100% user-manageable tags with "+ Categoría", select, and "×" remove.
 * - Clean titles: "BITÁCORA ABIERTA" (zero "//", zero "02 /").
 * - Precision hairline cards grid with pinning and deleting.
 * - Silencio Verbal Absoluto: Strict zero <p> tags, purely micro-labels, macro-numbers, and hairline borders.
 */

import { playHorologyTick, showToast } from '../../core/state.js';
import {
  CATEGORY_THEMES,
  getAllNotes,
  createNote,
  removeNote,
  togglePinNote,
  filterNotes,
  getCurrentOdometer,
  formatSealedOdometer,
  formatNoteDate,
  onNotesChange
} from '../../core/notes-service.js';

const STORAGE_KEY_CATEGORIES = 'octane_user_note_categories';
const DEFAULT_CATEGORIES = ['GENERAL', 'MECÁNICA', 'REPUESTO', 'RUIDO'];

function loadUserCategories() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CATEGORIES);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map(c => String(c).toUpperCase().trim()).filter(Boolean);
      }
    }
  } catch {
    // Fallback to default
  }
  return [...DEFAULT_CATEGORIES];
}

function saveUserCategories(categories) {
  try {
    localStorage.setItem(STORAGE_KEY_CATEGORIES, JSON.stringify(categories));
  } catch {
    // Ignore storage errors
  }
}

let boardState = {
  activeFilterCategory: 'ALL',
  selectedComposerCategory: 'GENERAL',
  categories: loadUserCategories(),
  isDated: true,
  selectedDate: new Date().toISOString().slice(0, 10),
  isOdoSealed: true,
  customOdo: null,
  currentOdo: 0,
  notes: []
};

let activeContainer = null;
let notesUnsubscribe = null;

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Formats a date string into compact label: e.g. "Hoy (21 Oct)" or "15 Feb 2026".
 * @param {string} dateStr 'YYYY-MM-DD'
 * @returns {string}
 */
function formatComposerDateLabel(dateStr) {
  if (!dateStr) return 'SIN FECHA';
  const today = new Date().toISOString().slice(0, 10);
  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const month = months[parseInt(parts[1], 10) - 1] || parts[1];
    const day = parseInt(parts[2], 10);
    if (dateStr === today) {
      return `HOY (${day} ${month})`;
    }
    return `${day} ${month} ${parts[0]}`;
  }
  return dateStr;
}

/**
 * Resolves theme styling for any category (canonical or custom).
 * @param {string} tag
 * @returns {Object}
 */
function getCategoryTheme(tag) {
  const upper = String(tag || '').toUpperCase();
  if (CATEGORY_THEMES[upper]) {
    return CATEGORY_THEMES[upper];
  }
  // Generic theme for user-defined tags
  return {
    tag: upper,
    color: 'var(--accent-amber)',
    bg: 'rgba(255, 85, 0, 0.1)',
    border: 'var(--line-strong)',
    dot: 'bg-[var(--accent-amber)]'
  };
}

/**
 * Generates the HTML for a single note card.
 * @param {Object} note 
 * @returns {string} HTML markup
 */
export function renderNoteCardHtml(note) {
  const theme = getCategoryTheme(note.categoryTag);
  const formattedDate = formatNoteDate(note.date, note.isDated);
  const sealedOdoLabel = note.isOdoSealed && note.odometer ? formatSealedOdometer(note.odometer) : null;
  const isPinned = Boolean(note.isPinned);

  return `
    <div class="flat-cell note-card p-4 sm:p-5 flex flex-col justify-between min-h-[110px] bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] transition-colors relative ${isPinned ? 'border-l-2 border-l-[var(--accent-amber)]' : ''}" data-id="${note.id}">
      
      <!-- Top strip (10px mono) -->
      <div class="flex items-center justify-between font-mono text-[10px] tracking-wider pb-2.5 border-b border-[var(--line-hair)]">
        
        <!-- Left: Tag + Date + Sealed Odometer -->
        <div class="flex items-center gap-2 flex-wrap min-w-0">
          <span 
            class="px-1.5 py-0.5 rounded-xs font-semibold text-[9px] uppercase tracking-widest border shrink-0" 
            style="color: ${theme.color}; background-color: ${theme.bg}; border-color: ${theme.border}"
          >
            ${escapeHtml(note.categoryTag)}
          </span>

          <span class="text-[var(--text-secondary)] uppercase shrink-0">
            ${formattedDate}
          </span>

          ${sealedOdoLabel ? `
            <span class="text-[var(--accent-volt)] tabular-nums font-medium shrink-0">
              ${sealedOdoLabel}
            </span>
          ` : ''}
        </div>

        <!-- Right: Tactile Buttons [PIN] y [×] -->
        <div class="flex items-center gap-1.5 shrink-0 ml-2">
          <button 
            type="button" 
            class="note-pin-btn h-5 px-1.5 flat-pill text-[9px] font-mono uppercase tracking-wider flex items-center gap-1 cursor-pointer transition-colors ${isPinned ? 'text-[var(--accent-amber)] border-[var(--accent-amber)] bg-[var(--accent-amber)]/10 font-bold' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}"
            data-action="pin"
            data-id="${note.id}"
            title="${isPinned ? 'Desfijar' : 'Fijar al inicio'}"
          >
            <svg class="w-2.5 h-2.5" fill="${isPinned ? 'currentColor' : 'none'}" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
            </svg>
            <span>PIN</span>
          </button>

          <button 
            type="button" 
            class="note-delete-btn h-5 w-5 flat-pill text-[12px] font-mono leading-none text-[var(--text-muted)] hover:text-[var(--accent-crimson)] hover:border-[var(--accent-crimson)] flex items-center justify-center cursor-pointer transition-colors"
            data-action="delete"
            data-id="${note.id}"
            title="Eliminar"
          >
            ×
          </button>
        </div>

      </div>

      <!-- Cuerpo: Título + Nota concisa -->
      <div class="pt-3 flex-1 flex flex-col justify-start">
        <div class="font-sans font-medium text-sm text-[var(--text-primary)] leading-snug break-words">
          ${escapeHtml(note.title)}
        </div>
        ${note.text ? `
          <div class="font-mono text-xs text-[var(--text-secondary)] leading-relaxed break-words mt-1.5">
            ${escapeHtml(note.text)}
          </div>
        ` : ''}
      </div>

    </div>
  `;
}

/**
 * Renders the collection of notes inside the grid container.
 * @param {HTMLElement} gridContainer 
 */
function renderNotesList(gridContainer) {
  if (!gridContainer) return;

  const filtered = filterNotes(boardState.notes, {
    category: boardState.activeFilterCategory
  });

  if (filtered.length === 0) {
    gridContainer.className = 'bg-[var(--bg-surface)]';
    gridContainer.innerHTML = `
      <div class="p-8 text-center border-t border-[var(--line-hair)]">
        <span class="font-mono text-[10px] uppercase tracking-widest text-[var(--text-muted)]">0 REGISTROS</span>
      </div>
    `;
    return;
  }

  // Multi-row 2-column precision grid with 1px hairlines
  gridContainer.className = 'grid grid-cols-1 md:grid-cols-2 gap-px bg-[var(--line-hair)] border-t border-[var(--line-hair)]';
  gridContainer.innerHTML = filtered.map(renderNoteCardHtml).join('');
}

/**
 * Updates filter pills active state and note counters.
 * @param {HTMLElement} rootContainer 
 */
function updateFilterPills(rootContainer) {
  if (!rootContainer) return;
  const pills = rootContainer.querySelectorAll('.note-filter-pill');
  pills.forEach(pill => {
    const cat = pill.getAttribute('data-category');
    if (cat === boardState.activeFilterCategory) {
      pill.classList.add('flat-pill-active');
      pill.classList.remove('text-[var(--text-secondary)]');
    } else {
      pill.classList.remove('flat-pill-active');
      pill.classList.add('text-[var(--text-secondary)]');
    }
  });

  const totalCounter = rootContainer.querySelector('#notes-total-counter');
  if (totalCounter) {
    const totalCount = boardState.notes.length;
    totalCounter.textContent = `${totalCount} ${totalCount === 1 ? 'REGISTRO' : 'REGISTROS'}`;
  }
}

/**
 * Renders the dynamic category pills selector inside composer.
 * @returns {string}
 */
function renderComposerCategoryChips() {
  return `
    <div class="flex items-center gap-1.5 overflow-x-auto max-w-full py-0.5" id="composer-categories-list">
      ${boardState.categories.map(cat => {
        const isSelected = cat === boardState.selectedComposerCategory;
        return `
          <div class="flex items-center shrink-0">
            <button
              type="button"
              class="composer-cat-chip h-7 px-2 flat-pill font-mono text-[9px] uppercase tracking-wider cursor-pointer transition-all flex items-center gap-1 ${
                isSelected ? 'flat-pill-active font-semibold' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }"
              data-category="${cat}"
            >
              <span>${cat}</span>
              ${boardState.categories.length > 1 ? `
                <span class="delete-cat-btn ml-0.5 text-[11px] text-[var(--text-muted)] hover:text-[var(--accent-crimson)] transition-colors" data-delete-cat="${cat}" title="Eliminar categoría">×</span>
              ` : ''}
            </button>
          </div>
        `;
      }).join('')}

      <!-- Add Category Button -->
      <button
        type="button"
        id="btn-add-category"
        class="h-7 px-2 border border-dashed border-[var(--line-strong)] text-[var(--text-secondary)] hover:text-[var(--accent-amber)] hover:border-[var(--accent-amber)] font-mono text-[9px] uppercase tracking-wider cursor-pointer transition-colors rounded-xs shrink-0 flex items-center gap-1"
        title="Crear nueva categoría"
      >
        <span>+</span> CATEGORÍA
      </button>
    </div>
  `;
}

/**
 * Initializes and mounts the Free Notes Board into a target DOM container.
 * @param {HTMLElement} container 
 */
export async function renderFreeNotesBoard(container) {
  if (!container) return;
  activeContainer = container;

  try {
    boardState.currentOdo = await getCurrentOdometer();
    boardState.notes = await getAllNotes();
  } catch (err) {
    console.warn('[OCTANE NOTES] Failed loading notes or odometer:', err);
    boardState.currentOdo = 0;
    boardState.notes = [];
  }

  const effectiveOdo = boardState.customOdo !== null ? boardState.customOdo : boardState.currentOdo;
  const formattedOdo = effectiveOdo > 0 ? effectiveOdo.toLocaleString('es-CO') : '0';
  const dateLabel = boardState.isDated ? formatComposerDateLabel(boardState.selectedDate) : 'SIN FECHA';

  container.innerHTML = `
    <div class="free-notes-board flat-frame border border-[var(--line-hair)] bg-[var(--bg-surface)] select-none">
      
      <!-- 1. Header de Sección: BITÁCORA ABIERTA + Filtros de Categoría -->
      <div class="min-h-12 px-4 sm:px-5 py-2.5 border-b border-[var(--line-hair)] flex flex-wrap items-center justify-between gap-3 bg-[var(--bg-surface)]">
        
        <div class="flex items-center gap-2.5">
          <span class="w-1.5 h-1.5 rounded-full bg-[var(--accent-volt)]"></span>
          <span class="font-mono text-[10px] uppercase tracking-widest text-[var(--text-primary)] font-semibold">BITÁCORA ABIERTA</span>
          <span id="notes-total-counter" class="font-mono text-[9px] uppercase tracking-wider text-[var(--text-muted)] border-l border-[var(--line-hair)] pl-2.5">
            ${boardState.notes.length} REGISTROS
          </span>
        </div>

        <!-- Category Filter Pills -->
        <div class="flex items-center gap-1 overflow-x-auto py-0.5 max-w-full" id="notes-filter-bar">
          <button 
            type="button" 
            class="note-filter-pill h-6 px-2 flat-pill font-mono text-[9px] uppercase tracking-wider cursor-pointer transition-all ${boardState.activeFilterCategory === 'ALL' ? 'flat-pill-active' : 'text-[var(--text-secondary)]'}" 
            data-category="ALL"
          >
            TODAS
          </button>
          ${boardState.categories.map(cat => `
            <button 
              type="button" 
              class="note-filter-pill h-6 px-2 flat-pill font-mono text-[9px] uppercase tracking-wider cursor-pointer transition-all ${boardState.activeFilterCategory === cat ? 'flat-pill-active' : 'text-[var(--text-secondary)]'}" 
              data-category="${cat}"
            >
              ${cat}
            </button>
          `).join('')}
        </div>

      </div>

      <!-- 2. Textarea de Captura Abierta y Chips Táctiles -->
      <form id="free-notes-form" class="bg-[var(--bg-surface)] flex flex-col" autocomplete="off">
        
        <!-- Textarea Amplio de Ancho Completo sin bordes laterales -->
        <div class="px-4 pt-3 pb-1">
          <textarea 
            id="free-note-textarea" 
            name="noteRaw" 
            rows="3" 
            placeholder="Escribe una nota técnica, mantenimiento o referencia..." 
            class="bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-2 outline-none w-full text-[var(--text-primary)] placeholder:text-[var(--text-muted)] font-mono text-xs resize-none"
            required
          ></textarea>
        </div>

        <!-- Barra Inferior de Chips Interactivos: Fecha, Kilometraje, Categorías y Enviar -->
        <div class="px-4 py-3 flex flex-wrap items-center justify-between gap-2.5">
          
          <div class="flex flex-wrap items-center gap-2">
            
            <!-- Chip de Fecha Modificable -->
            <div class="relative flex items-center">
              <button 
                type="button" 
                id="free-note-date-chip" 
                class="h-7 px-2.5 flat-pill font-mono text-[9px] uppercase tracking-wider flex items-center gap-1.5 cursor-pointer select-none transition-colors border ${boardState.isDated ? 'border-[var(--line-strong)] text-[var(--text-primary)]' : 'border-[var(--line-hair)] text-[var(--text-muted)]'}"
                title="Cambiar fecha de la nota"
              >
                <span class="w-1.5 h-1.5 rounded-full ${boardState.isDated ? 'bg-[var(--accent-volt)]' : 'bg-[var(--text-muted)]'}"></span>
                <span id="label-note-date">${dateLabel}</span>
              </button>
              <input 
                type="date" 
                id="free-note-date-picker" 
                class="absolute inset-0 opacity-0 cursor-pointer w-full h-full" 
                value="${boardState.selectedDate}" 
              />
            </div>

            <!-- Chip de Kilometraje Modificable -->
            <div class="flex items-center gap-1">
              <button 
                type="button" 
                id="free-note-odo-chip" 
                class="h-7 px-2.5 flat-pill font-mono text-[9px] uppercase tracking-wider flex items-center gap-1.5 cursor-pointer select-none transition-colors border ${boardState.isOdoSealed ? 'border-[var(--line-strong)] text-[var(--text-primary)]' : 'border-[var(--line-hair)] text-[var(--text-muted)]'}"
                title="Alternar odómetro en la nota"
              >
                <span class="w-1.5 h-1.5 rounded-full ${boardState.isOdoSealed ? 'bg-[var(--accent-amber)]' : 'bg-[var(--text-muted)]'}"></span>
                <span id="label-note-odo">${boardState.isOdoSealed ? `${formattedOdo} KM` : 'SIN KM'}</span>
              </button>

              <button 
                type="button" 
                id="free-note-edit-odo-btn" 
                class="h-7 px-2 flat-pill font-mono text-[9px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                title="Personalizar kilometraje"
              >
                ✎
              </button>
            </div>

            <!-- Gestor de Categorías Dinámico -->
            <div id="composer-categories-container" class="border-l border-[var(--line-hair)] pl-2">
              ${renderComposerCategoryChips()}
            </div>

          </div>

          <!-- Botón de Envío -->
          <button 
            type="submit" 
            id="free-note-submit-btn" 
            class="h-7 px-3 bg-[var(--text-primary)] hover:opacity-90 active:scale-95 text-[var(--bg-void)] font-mono text-[10px] font-semibold uppercase tracking-wider flex items-center justify-center rounded-xs cursor-pointer transition-all ml-auto"
            title="Registrar nota en bitácora"
          >
            + GUARDAR NOTA
          </button>

        </div>

      </form>

      <!-- 3. Grilla de Tarjetas -->
      <div id="free-notes-grid"></div>

    </div>
  `;

  const gridContainer = container.querySelector('#free-notes-grid');
  renderNotesList(gridContainer);
  attachEventListeners(container);

  if (notesUnsubscribe) {
    notesUnsubscribe();
    notesUnsubscribe = null;
  }

  notesUnsubscribe = onNotesChange(async () => {
    boardState.notes = await getAllNotes();
    boardState.currentOdo = await getCurrentOdometer();
    const currentGrid = container.querySelector('#free-notes-grid');
    if (currentGrid) {
      renderNotesList(currentGrid);
      updateFilterPills(container);
    }
  });
}

/**
 * Attaches interaction listeners to the free notes board elements.
 * @param {HTMLElement} container 
 */
function attachEventListeners(container) {
  const form = container.querySelector('#free-notes-form');
  const textareaEl = container.querySelector('#free-note-textarea');
  const datePicker = container.querySelector('#free-note-date-picker');
  const labelDate = container.querySelector('#label-note-date');
  const odoChip = container.querySelector('#free-note-odo-chip');
  const editOdoBtn = container.querySelector('#free-note-edit-odo-btn');
  const labelOdo = container.querySelector('#label-note-odo');
  const gridContainer = container.querySelector('#free-notes-grid');

  // Date Picker Interaction
  if (datePicker) {
    datePicker.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val) {
        boardState.selectedDate = val;
        boardState.isDated = true;
        labelDate.textContent = formatComposerDateLabel(val);
        playHorologyTick(1200, 0.012, 0.02);
      }
    });
  }

  // Mileage Chip Toggle (ON/OFF)
  if (odoChip) {
    odoChip.addEventListener('click', () => {
      boardState.isOdoSealed = !boardState.isOdoSealed;
      playHorologyTick(1200, 0.012, 0.02);

      const effectiveOdo = boardState.customOdo !== null ? boardState.customOdo : boardState.currentOdo;
      const formattedOdo = effectiveOdo > 0 ? effectiveOdo.toLocaleString('es-CO') : '0';
      const dot = odoChip.querySelector('.rounded-full');

      if (boardState.isOdoSealed) {
        labelOdo.textContent = `${formattedOdo} KM`;
        odoChip.classList.remove('text-[var(--text-muted)]', 'border-[var(--line-hair)]');
        odoChip.classList.add('text-[var(--text-primary)]', 'border-[var(--line-strong)]');
        if (dot) dot.className = 'w-1.5 h-1.5 rounded-full bg-[var(--accent-amber)]';
      } else {
        labelOdo.textContent = 'SIN KM';
        odoChip.classList.remove('text-[var(--text-primary)]', 'border-[var(--line-strong)]');
        odoChip.classList.add('text-[var(--text-muted)]', 'border-[var(--line-hair)]');
        if (dot) dot.className = 'w-1.5 h-1.5 rounded-full bg-[var(--text-muted)]';
      }
    });
  }

  // Edit Mileage manually
  if (editOdoBtn) {
    editOdoBtn.addEventListener('click', () => {
      const current = boardState.customOdo !== null ? boardState.customOdo : boardState.currentOdo;
      const userPrompt = window.prompt('INGRESAR KILOMETRAJE PARA LA NOTA (KM):', current || '');
      if (userPrompt !== null) {
        const parsed = parseInt(userPrompt.replace(/[^0-9]/g, ''), 10);
        if (!isNaN(parsed) && parsed >= 0) {
          boardState.customOdo = parsed;
          boardState.isOdoSealed = true;
          labelOdo.textContent = `${parsed.toLocaleString('es-CO')} KM`;
          odoChip.classList.remove('text-[var(--text-muted)]', 'border-[var(--line-hair)]');
          odoChip.classList.add('text-[var(--text-primary)]', 'border-[var(--line-strong)]');
          const dot = odoChip.querySelector('.rounded-full');
          if (dot) dot.className = 'w-1.5 h-1.5 rounded-full bg-[var(--accent-amber)]';
          playHorologyTick(1300, 0.015, 0.03);
        }
      }
    });
  }

  // Categories delegation: select, add, and remove
  container.addEventListener('click', (e) => {
    // 1. Delete Category
    const delBtn = e.target.closest('[data-delete-cat]');
    if (delBtn) {
      e.stopPropagation();
      const catToDelete = delBtn.getAttribute('data-delete-cat');
      if (boardState.categories.length <= 1) {
        showToast('DEBE CONSERVAR AL MENOS 1 CATEGORÍA');
        return;
      }
      boardState.categories = boardState.categories.filter(c => c !== catToDelete);
      saveUserCategories(boardState.categories);
      if (boardState.selectedComposerCategory === catToDelete) {
        boardState.selectedComposerCategory = boardState.categories[0];
      }
      if (boardState.activeFilterCategory === catToDelete) {
        boardState.activeFilterCategory = 'ALL';
      }
      playHorologyTick(1100, 0.015, 0.02);
      renderFreeNotesBoard(container);
      return;
    }

    // 2. Select Category in Composer
    const catChip = e.target.closest('.composer-cat-chip');
    if (catChip) {
      const cat = catChip.getAttribute('data-category');
      boardState.selectedComposerCategory = cat;
      playHorologyTick(1100, 0.01, 0.02);
      const catList = container.querySelector('#composer-categories-container');
      if (catList) catList.innerHTML = renderComposerCategoryChips();
      return;
    }

    // 3. Add Category
    const addCatBtn = e.target.closest('#btn-add-category');
    if (addCatBtn) {
      const newCat = window.prompt('NUEVA CATEGORÍA (MÁX 15 CARACTERES):');
      if (newCat) {
        const cleanCat = newCat.toUpperCase().trim().slice(0, 15);
        if (cleanCat && !boardState.categories.includes(cleanCat)) {
          boardState.categories.push(cleanCat);
          boardState.selectedComposerCategory = cleanCat;
          saveUserCategories(boardState.categories);
          playHorologyTick(1400, 0.015, 0.03);
          showToast(`CATEGORÍA ${cleanCat} AÑADIDA`);
          renderFreeNotesBoard(container);
        }
      }
      return;
    }

    // 4. Filter Pills Clicking
    const filterPill = e.target.closest('.note-filter-pill');
    if (filterPill) {
      const selectedCat = filterPill.getAttribute('data-category');
      if (boardState.activeFilterCategory === selectedCat) return;
      boardState.activeFilterCategory = selectedCat;
      playHorologyTick(1100, 0.01, 0.02);
      updateFilterPills(container);
      renderNotesList(gridContainer);
      return;
    }
  });

  // Notes Form Submit
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const rawText = (textareaEl.value || '').trim();
      if (!rawText) {
        textareaEl.focus();
        return;
      }

      const categoryTag = boardState.selectedComposerCategory || 'GENERAL';
      const isDated = boardState.isDated;
      const date = isDated ? boardState.selectedDate : null;
      const isOdoSealed = boardState.isOdoSealed;
      const effectiveOdo = boardState.customOdo !== null ? boardState.customOdo : boardState.currentOdo;
      const odometer = isOdoSealed ? effectiveOdo : null;

      try {
        await createNote({
          raw: rawText,
          categoryTag,
          isDated,
          date,
          isOdoSealed,
          odometer
        });

        playHorologyTick(1500, 0.02, 0.04);
        showToast('NOTA REGISTRADA');
        textareaEl.value = '';
        textareaEl.focus();

        boardState.notes = await getAllNotes();
        renderNotesList(gridContainer);
        updateFilterPills(container);
      } catch (err) {
        console.error('[OCTANE NOTES] Error creating note:', err);
        showToast('ERROR AL GUARDAR NOTA');
      }
    });
  }

  // Grid Actions (PIN & DELETE)
  if (gridContainer) {
    gridContainer.addEventListener('click', async (e) => {
      const pinBtn = e.target.closest('[data-action="pin"]');
      if (pinBtn) {
        const id = pinBtn.getAttribute('data-id');
        try {
          await togglePinNote(id);
          playHorologyTick(1400, 0.015, 0.03);
          boardState.notes = await getAllNotes();
          renderNotesList(gridContainer);
          updateFilterPills(container);
        } catch (err) {
          console.error('[OCTANE NOTES] Pin toggle failed:', err);
        }
        return;
      }

      const delBtn = e.target.closest('[data-action="delete"]');
      if (delBtn) {
        const id = delBtn.getAttribute('data-id');
        const confirmed = window.confirm('¿ELIMINAR ESTA NOTA?');
        if (confirmed) {
          try {
            await removeNote(id);
            playHorologyTick(1100, 0.02, 0.03);
            showToast('NOTA ELIMINADA');
            boardState.notes = await getAllNotes();
            renderNotesList(gridContainer);
            updateFilterPills(container);
          } catch (err) {
            console.error('[OCTANE NOTES] Delete failed:', err);
          }
        }
      }
    });
  }
}
