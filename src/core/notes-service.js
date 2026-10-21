/**
 * OCTANE // KINETIC — Free Notes Service ("Bitácora de Notas Libres")
 * 
 * Swiss Precision Telemetry Notes Engine:
 * - Category classification: MECÁNICA, REPUESTO, RUIDO, GENERAL
 * - Persistence in IndexedDB (STORES.FREE_NOTES)
 * - Pinning / unpinning priority sorting (pinned notes first, then chronological)
 * - Dynamic odometer stamping (@ XX,XXX KM) based on highest recorded mileage
 * - Silencio Verbal Absoluto: Strict micro-labels, zero verbose text.
 */

import { getFreeNotes, saveFreeNote, deleteFreeNote, getTelemetryLogs } from './db-local.js';
import { store, playHorologyTick, showToast } from './state.js';

export const NOTE_CATEGORIES = Object.freeze([
  'MECÁNICA',
  'REPUESTO',
  'RUIDO',
  'GENERAL'
]);

export const CATEGORY_THEMES = Object.freeze({
  'MECÁNICA': {
    tag: 'MECÁNICA',
    color: 'var(--accent-amber)',
    bg: 'rgba(255, 85, 0, 0.12)',
    border: 'rgba(255, 85, 0, 0.35)',
    dot: 'bg-[var(--accent-amber)]'
  },
  'REPUESTO': {
    tag: 'REPUESTO',
    color: 'var(--accent-cyan)',
    bg: 'rgba(56, 189, 248, 0.12)',
    border: 'rgba(56, 189, 248, 0.35)',
    dot: 'bg-[var(--accent-cyan)]'
  },
  'RUIDO': {
    tag: 'RUIDO',
    color: 'var(--accent-crimson)',
    bg: 'rgba(244, 63, 94, 0.12)',
    border: 'rgba(244, 63, 94, 0.35)',
    dot: 'bg-[var(--accent-crimson)]'
  },
  'GENERAL': {
    tag: 'GENERAL',
    color: 'var(--accent-volt)',
    bg: 'rgba(16, 185, 129, 0.12)',
    border: 'rgba(16, 185, 129, 0.35)',
    dot: 'bg-[var(--accent-volt)]'
  }
});

export const CATEGORY_STYLES = CATEGORY_THEMES;

/**
 * Returns the highest recorded odometer reading from store or IndexedDB.
 * @returns {Promise<number>}
 */
export async function getCurrentOdometer() {
  const currentState = store ? store.getState() : null;
  let logs = currentState && Array.isArray(currentState.telemetryLogs) ? currentState.telemetryLogs : [];

  if (logs.length === 0) {
    try {
      logs = await getTelemetryLogs();
    } catch {
      logs = [];
    }
  }

  let maxOdo = 0;
  for (const log of logs) {
    const odo = Number(log.odometer_reading) || 0;
    if (odo > maxOdo) {
      maxOdo = odo;
    }
  }

  return maxOdo;
}

/**
 * Formats a sealed odometer integer into a compact Swiss technical badge string.
 * @param {number|null} odo 
 * @returns {string|null} e.g. "@ 97,395 KM" or null
 */
export function formatSealedOdometer(odo) {
  if (odo === null || odo === undefined || isNaN(odo) || odo <= 0) {
    return null;
  }
  return `@ ${Number(odo).toLocaleString('es-CO')} KM`;
}

/**
 * Formats a note date according to Swiss architectural conventions.
 * If isDated is false, returns 'PERMANENTE'.
 * @param {string|null} dateStr - 'YYYY-MM-DD'
 * @param {boolean} [isDated=true] 
 * @returns {string} e.g. '20 OCT 2026' or 'PERMANENTE'
 */
export function formatNoteDate(dateStr, isDated = true) {
  if (!isDated || !dateStr) {
    return 'PERMANENTE';
  }
  const clean = String(dateStr).substring(0, 10);
  const d = new Date(clean + 'T12:00:00');
  if (isNaN(d.getTime())) return String(dateStr).toUpperCase();
  const months = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
  return `${String(d.getDate()).padStart(2, '0')} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Parses raw inline note input into structured title and concise text.
 * Handles single-line delimiter formats (e.g. "TÍTULO // NOTA DETALLADA" or "TÍTULO: NOTA")
 * or multiline and sentence splits.
 * @param {string} rawInput 
 * @returns {{ title: string, text: string }}
 */
export function parseNoteInput(rawInput = '') {
  const clean = String(rawInput || '').trim();
  if (!clean) {
    return { title: '', text: '' };
  }

  // Multiline input
  if (clean.includes('\n')) {
    const lines = clean.split('\n').map(l => l.trim()).filter(Boolean);
    const title = lines[0] || '';
    const text = lines.slice(1).join(' · ');
    return { title, text };
  }

  // Inline delimiter: "//"
  if (clean.includes('//')) {
    const parts = clean.split('//').map(p => p.trim()).filter(Boolean);
    return {
      title: parts[0] || '',
      text: parts.slice(1).join(' · ')
    };
  }

  // Inline delimiter: " - " or ": "
  if (clean.includes(': ')) {
    const parts = clean.split(': ').map(p => p.trim()).filter(Boolean);
    return {
      title: parts[0] || '',
      text: parts.slice(1).join(': ')
    };
  }

  // Single sentence / short reference
  if (clean.length > 50) {
    const splitIdx = clean.lastIndexOf(' ', 45);
    if (splitIdx > 15) {
      return {
        title: clean.substring(0, splitIdx).trim(),
        text: clean.substring(splitIdx).trim()
      };
    }
  }

  return { title: clean, text: '' };
}

/**
 * Retrieves all notes from persistence, sorted with pinned notes first,
 * followed by newest date or update timestamp descending.
 * @returns {Promise<Array<Object>>}
 */
export async function getAllNotes() {
  const notes = await getFreeNotes();
  return sortNotes(notes);
}

/**
 * Sorts an array of notes: pinned first, then newest date/updatedAt first.
 * @param {Array<Object>} notes 
 * @returns {Array<Object>}
 */
export function sortNotes(notes = []) {
  return [...notes].sort((a, b) => {
    // 1. Pinned priority
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;

    // 2. Date priority
    const timeA = new Date(a.date || a.updatedAt || a.createdAt || 0).getTime();
    const timeB = new Date(b.date || b.updatedAt || b.createdAt || 0).getTime();
    return timeB - timeA;
  });
}

/**
 * Filters notes by category and optional query string.
 * @param {Array<Object>} notes 
 * @param {Object} [filterOptions]
 * @param {'ALL'|'MECÁNICA'|'REPUESTO'|'RUIDO'|'GENERAL'} [filterOptions.category='ALL']
 * @param {string} [filterOptions.search='']
 * @returns {Array<Object>}
 */
export function filterNotes(notes = [], { category = 'ALL', search = '' } = {}) {
  const targetCategory = String(category || 'ALL').toUpperCase();
  const query = String(search || '').trim().toLowerCase();

  return notes.filter((note) => {
    // Category match
    if (targetCategory !== 'ALL') {
      const tag = String(note.categoryTag || '').toUpperCase();
      if (tag !== targetCategory) {
        return false;
      }
    }

    // Search query match
    if (query) {
      const matchTitle = String(note.title || '').toLowerCase().includes(query);
      const matchText = String(note.text || '').toLowerCase().includes(query);
      const matchOdo = note.odometer ? String(note.odometer).includes(query) : false;
      const matchTag = String(note.categoryTag || '').toLowerCase().includes(query);
      if (!matchTitle && !matchText && !matchOdo && !matchTag) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Creates and persists a new technical note.
 * @param {Object} params
 * @param {string} [params.raw] - Raw input to parse if title is not provided
 * @param {string} [params.title]
 * @param {string} [params.text]
 * @param {'MECÁNICA'|'REPUESTO'|'RUIDO'|'GENERAL'} [params.categoryTag='GENERAL']
 * @param {boolean} [params.isDated=true]
 * @param {string|null} [params.date]
 * @param {boolean} [params.isOdoSealed=false]
 * @param {number|null} [params.odometer]
 * @param {boolean} [params.isPinned=false]
 * @returns {Promise<Object>} The persisted note record
 */
export async function createNote(params = {}) {
  let title = (params.title || '').trim();
  let text = (params.text || '').trim();

  if (!title && params.raw) {
    const parsed = parseNoteInput(params.raw);
    title = parsed.title;
    text = parsed.text;
  }

  if (!title) {
    title = 'NOTA TÉCNICA';
  }

  // Normalize category tag (supports canonical and user-defined categories)
  const upperCategory = String(params.categoryTag || 'GENERAL').toUpperCase().trim();
  const validCategory = upperCategory || 'GENERAL';

  // Date stamping
  const isDated = params.isDated !== undefined ? Boolean(params.isDated) : true;
  const date = isDated ? (params.date || new Date().toISOString().substring(0, 10)) : null;

  // Odometer sealing
  const isOdoSealed = Boolean(params.isOdoSealed);
  let odometer = null;
  if (isOdoSealed) {
    if (params.odometer !== undefined && params.odometer !== null && !isNaN(params.odometer)) {
      odometer = Number(params.odometer);
    } else {
      odometer = await getCurrentOdometer();
    }
  }

  const nowIso = new Date().toISOString();
  const newNote = {
    id: `note_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    title,
    text,
    categoryTag: validCategory,
    isDated,
    date,
    isOdoSealed,
    odometer,
    isPinned: Boolean(params.isPinned),
    createdAt: nowIso,
    updatedAt: nowIso
  };

  await saveFreeNote(newNote);
  notifyNotesChange();
  return newNote;
}

/**
 * Updates an existing note.
 * @param {Object} note 
 * @returns {Promise<Object>}
 */
export async function updateNote(note) {
  if (!note || !note.id) {
    throw new Error('Cannot update note without valid ID');
  }
  note.updatedAt = new Date().toISOString();
  await saveFreeNote(note);
  notifyNotesChange();
  return note;
}

/**
 * Toggles the pinned status of a note.
 * @param {string} noteId 
 * @returns {Promise<Object|null>}
 */
export async function togglePinNote(noteId) {
  if (!noteId) return null;
  const all = await getAllNotes();
  const note = all.find(n => n.id === noteId);
  if (!note) return null;

  note.isPinned = !note.isPinned;
  note.updatedAt = new Date().toISOString();
  await saveFreeNote(note);
  playHorologyTick(note.isPinned ? 1500 : 1000, 0.015, 0.03);
  notifyNotesChange();
  return note;
}

/**
 * Deletes a note by primary key ID.
 * @param {string} noteId 
 * @returns {Promise<boolean>}
 */
export async function removeNote(noteId) {
  if (!noteId) return false;
  await deleteFreeNote(noteId);
  playHorologyTick(800, 0.02, 0.025);
  showToast('NOTA ELIMINADA');
  notifyNotesChange();
  return true;
}

/**
 * Emits an internal custom event to notify mounted UI components.
 */
function notifyNotesChange() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('octane:notes-changed'));
  }
}

/**
 * Subscribes a callback to notes change events.
 * @param {Function} callback 
 * @returns {Function} Unsubscribe function
 */
export function onNotesChange(callback) {
  if (typeof window === 'undefined') return () => {};
  const handler = () => callback();
  window.addEventListener('octane:notes-changed', handler);
  return () => {
    window.removeEventListener('octane:notes-changed', handler);
  };
}
