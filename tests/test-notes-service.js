/**
 * OCTANE // KINETIC — Unit Tests for Notes Service & Free Notes Board
 * Validates persistence, categories, pinning priority, odometer sealing, and zero <p> tags.
 */

import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import {
  NOTE_CATEGORIES,
  CATEGORY_THEMES,
  getCurrentOdometer,
  formatSealedOdometer,
  formatNoteDate,
  parseNoteInput,
  getAllNotes,
  createNote,
  updateNote,
  togglePinNote,
  removeNote,
  filterNotes,
  sortNotes
} from '../src/core/notes-service.js';
import { renderNoteCardHtml } from '../src/components/cluster/free-notes-board.js';
import { clearAllData, addTelemetryLog } from '../src/core/db-local.js';

async function runNotesTests() {
  console.log('--- STARTING OCTANE NOTES SERVICE TESTS ---');

  // Clear DB
  await clearAllData();

  // 1. Categories & Themes
  console.log('[TEST 1] Note Categories & Themes...');
  assert.deepEqual(NOTE_CATEGORIES, ['MECÁNICA', 'REPUESTO', 'RUIDO', 'GENERAL']);
  for (const cat of NOTE_CATEGORIES) {
    assert.ok(CATEGORY_THEMES[cat], `Theme should exist for ${cat}`);
    assert.ok(CATEGORY_THEMES[cat].color, `Color should exist for ${cat}`);
    assert.ok(CATEGORY_THEMES[cat].dot, `Dot should exist for ${cat}`);
  }
  console.log('✓ Note categories and themes verified.');

  // 2. Parse Note Input helper
  console.log('[TEST 2] Parse Note Input...');
  const p1 = parseNoteInput('PASTILLAS BOSCH // REF BP-1204 INSTALADAS');
  assert.equal(p1.title, 'PASTILLAS BOSCH');
  assert.equal(p1.text, 'REF BP-1204 INSTALADAS');

  const p2 = parseNoteInput('RUIDO EN TREN DELANTERO');
  assert.equal(p2.title, 'RUIDO EN TREN DELANTERO');
  assert.equal(p2.text, '');

  const p3 = parseNoteInput('LÍQUIDO REFRIGERANTE: NIVEL RELLENADO AL MÁXIMO');
  assert.equal(p3.title, 'LÍQUIDO REFRIGERANTE');
  assert.equal(p3.text, 'NIVEL RELLENADO AL MÁXIMO');

  const p4 = parseNoteInput('LÍNEA 1\nLÍNEA 2 DETALLE');
  assert.equal(p4.title, 'LÍNEA 1');
  assert.equal(p4.text, 'LÍNEA 2 DETALLE');
  console.log('✓ Parse Note Input verified.');

  // 3. Format Date & Sealed Odometer
  console.log('[TEST 3] Format Date & Sealed Odometer...');
  assert.equal(formatNoteDate(null, false), 'PERMANENTE');
  assert.equal(formatNoteDate('2026-10-20', false), 'PERMANENTE');
  assert.equal(formatNoteDate('2026-10-20', true), '20 OCT 2026');
  assert.equal(formatSealedOdometer(97395), '@ 97.395 KM');
  assert.equal(formatSealedOdometer(null), null);
  assert.equal(formatSealedOdometer(0), null);
  console.log('✓ Formatting helpers verified.');

  // 4. Current Odometer Detection
  console.log('[TEST 4] Current Odometer Detection...');
  await addTelemetryLog({
    date: '2026-09-01',
    odometer_reading: 95000,
    fuel_level_percent: 50,
    gallons_added: 0
  });
  await addTelemetryLog({
    date: '2026-10-15',
    odometer_reading: 97395,
    fuel_level_percent: 100,
    gallons_added: 8.5
  });

  const currentOdo = await getCurrentOdometer();
  assert.equal(currentOdo, 97395, 'Should find highest odometer reading');
  console.log('✓ Highest odometer detection verified.');

  // 5. Create Notes & Persistence
  console.log('[TEST 5] Create Notes & Persistence...');
  const note1 = await createNote({
    raw: 'ACEITE MOTOR // MOTUL 8100 5W-30',
    categoryTag: 'MECÁNICA',
    isDated: true,
    isOdoSealed: true
  });

  assert.ok(note1.id.startsWith('note_'));
  assert.equal(note1.title, 'ACEITE MOTOR');
  assert.equal(note1.text, 'MOTUL 8100 5W-30');
  assert.equal(note1.categoryTag, 'MECÁNICA');
  assert.equal(note1.isDated, true);
  assert.equal(note1.isOdoSealed, true);
  assert.equal(note1.odometer, 97395, 'Sealed odometer should be 97395');
  assert.equal(note1.isPinned, false);

  const note2 = await createNote({
    title: 'LLAVE DE CRUZ',
    text: 'DEBAJO DEL ASIENTO COPILOTO',
    categoryTag: 'REPUESTO',
    isDated: false,
    isOdoSealed: false
  });
  assert.equal(note2.categoryTag, 'REPUESTO');
  assert.equal(note2.isDated, false);
  assert.equal(note2.date, null);
  assert.equal(note2.odometer, null);

  const note3 = await createNote({
    raw: 'CHILLIDO EN FRENO DERECHO',
    categoryTag: 'RUIDO',
    isDated: true,
    isOdoSealed: true
  });
  assert.equal(note3.categoryTag, 'RUIDO');

  const allNotes = await getAllNotes();
  assert.equal(allNotes.length, 3, 'Should have 3 notes in DB');
  console.log('✓ Create and persistence verified.');

  // 6. Pinning & Sorting
  console.log('[TEST 6] Pinning & Sorting...');
  assert.equal(allNotes[0].isPinned, false);
  const updatedNote2 = await togglePinNote(note2.id);
  assert.equal(updatedNote2.isPinned, true);

  const sortedNotes = await getAllNotes();
  assert.equal(sortedNotes[0].id, note2.id, 'Pinned note should be first in list');
  console.log('✓ Pinning and sorting verified.');

  // 7. Filtering by Category
  console.log('[TEST 7] Filtering by Category...');
  const mecaFiltered = filterNotes(sortedNotes, { category: 'MECÁNICA' });
  assert.equal(mecaFiltered.length, 1);
  assert.equal(mecaFiltered[0].categoryTag, 'MECÁNICA');

  const repFiltered = filterNotes(sortedNotes, { category: 'REPUESTO' });
  assert.equal(repFiltered.length, 1);
  assert.equal(repFiltered[0].categoryTag, 'REPUESTO');

  const ruidoFiltered = filterNotes(sortedNotes, { category: 'RUIDO' });
  assert.equal(ruidoFiltered.length, 1);
  assert.equal(ruidoFiltered[0].categoryTag, 'RUIDO');

  const allFiltered = filterNotes(sortedNotes, { category: 'ALL' });
  assert.equal(allFiltered.length, 3);
  console.log('✓ Filtering by category verified.');

  // 8. HTML Rendering & Silencio Verbal Absoluto
  console.log('[TEST 8] HTML Rendering & Silencio Verbal Absoluto...');
  const cardHtml = renderNoteCardHtml(note1);
  assert.ok(cardHtml.includes('MECÁNICA'));
  assert.ok(cardHtml.includes('ACEITE MOTOR'));
  assert.ok(cardHtml.includes('MOTUL 8100 5W-30'));
  assert.ok(cardHtml.includes('@ 97.395 KM'));
  assert.ok(cardHtml.includes('PIN'));
  assert.ok(!cardHtml.includes('<p>'), 'Card HTML must strictly contain ZERO <p> tags');
  assert.ok(!cardHtml.includes('</p>'), 'Card HTML must strictly contain ZERO </p> tags');
  console.log('✓ HTML Rendering and zero <p> tag silence verified.');

  // 9. Note Deletion
  console.log('[TEST 9] Note Deletion...');
  await removeNote(note3.id);
  const remainingNotes = await getAllNotes();
  assert.equal(remainingNotes.length, 2);
  assert.ok(!remainingNotes.some(n => n.id === note3.id));
  console.log('✓ Note deletion verified.');

  console.log('==============================================');
  console.log(' ALL NOTES SERVICE TESTS PASSED SUCCESSFULLY! ');
  console.log('==============================================');
}

runNotesTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
