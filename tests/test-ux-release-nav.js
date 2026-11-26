import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  APP_VERSION,
  RELEASE_NOTES_STORAGE_KEY,
  RELEASES,
  getCurrentRelease,
  getSeenReleaseVersion,
  markReleaseNotesSeen,
  shouldShowReleaseNotes
} from '../src/core/release-notes.js';
import { createNavigationManager } from '../src/core/navigation-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

function createMockStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); }
  };
}

function createMockBrowserEnv() {
  const listeners = new Map();
  const stack = [{ state: null, url: '/' }];
  let idx = 0;
  let scheduledTimers = [];
  let timerSeq = 1;

  const classSetHtml = new Set();
  const classSetBody = new Set();

  const makeClassList = (set) => ({
    add(c) { set.add(c); },
    remove(c) { set.delete(c); },
    toggle(c, force) {
      if (force === true) set.add(c);
      else if (force === false) set.delete(c);
      else if (set.has(c)) set.delete(c);
      else set.add(c);
    },
    contains(c) { return set.has(c); }
  });

  const history = {
    get state() { return stack[idx]?.state ?? null; },
    get length() { return stack.length; },
    get index() { return idx; },
    pushState(state, _title, url = '') {
      stack.splice(idx + 1);
      stack.push({ state, url });
      idx = stack.length - 1;
    },
    replaceState(state, _title, url = '') {
      stack[idx] = { state, url: url || stack[idx]?.url || '/' };
    },
    go(delta) {
      const target = idx + Number(delta || 0);
      if (target < 0 || target >= stack.length) return;
      idx = target;
      emit('popstate', { state: stack[idx].state });
    },
    back() {
      this.go(-1);
    }
  };

  function emit(type, event) {
    const list = listeners.get(type) || [];
    for (const fn of [...list]) fn(event);
  }

  const win = {
    location: { pathname: '/', search: '' },
    history,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      if (!listeners.has(type)) return;
      listeners.set(type, listeners.get(type).filter((x) => x !== fn));
    }
  };

  const doc = {
    documentElement: { classList: makeClassList(classSetHtml) },
    body: { classList: makeClassList(classSetBody) }
  };

  function flushTimers() {
    while (scheduledTimers.length > 0) {
      const batch = scheduledTimers;
      scheduledTimers = [];
      for (const t of batch) {
        if (!t.cancelled) t.fn();
      }
    }
  }

  const nav = createNavigationManager({
    window: win,
    document: doc,
    history,
    setTimeout(fn) {
      const entry = { id: timerSeq++, fn, cancelled: false };
      scheduledTimers.push(entry);
      return entry.id;
    },
    clearTimeout(id) {
      for (const t of scheduledTimers) {
        if (t.id === id) t.cancelled = true;
      }
    }
  });

  return {
    nav,
    win,
    doc,
    history,
    flushTimers,
    pressHardwareBack() {
      history.back();
    },
    pressEscape() {
      let prevented = false;
      emit('keydown', {
        key: 'Escape',
        preventDefault() { prevented = true; },
        stopPropagation() {}
      });
      return prevented;
    },
    isScrollLocked() {
      return classSetHtml.has('octane-scroll-locked') && classSetBody.has('octane-scroll-locked');
    }
  };
}

describe('Release Notes Policy & Version Sync', () => {
  test('APP_VERSION, package.json, and public/sw.js CACHE_NAME are strictly synchronized', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    const swSrc = fs.readFileSync(path.join(REPO_ROOT, 'public/sw.js'), 'utf8');
    const swMatch = swSrc.match(/const\s+CACHE_NAME\s*=\s*['"]octane-v([^'"]+)['"]/);

    assert.ok(APP_VERSION && /^\d+\.\d+\.\d+$/.test(APP_VERSION), 'APP_VERSION must be semver');
    assert.equal(pkg.version, APP_VERSION, 'package.json version must match APP_VERSION');
    assert.ok(swMatch, 'public/sw.js must define CACHE_NAME = octane-vX.Y.Z');
    assert.equal(swMatch[1], APP_VERSION, 'public/sw.js CACHE_NAME version must match APP_VERSION');
  });

  test('current release notes are non-technical, concise, and shown strictly once per version', () => {
    const current = getCurrentRelease();
    assert.equal(current.version, APP_VERSION);
    assert.ok(RELEASES.length >= 1);
    assert.ok(current.title && current.title.length > 0);
    assert.ok(Array.isArray(current.highlights) && current.highlights.length >= 2 && current.highlights.length <= 5);

    const technicalJargon = /\b(IndexedDB|JSON|API|Service Worker|popstate|localStorage|Ridge|Haversine|EMA|OLS|MJ|RAW|STAGE|DOM|CSS|HTML|commit|refactor)\b/i;
    const allCopy = [current.title, current.subtitle, ...current.highlights].join(' ');
    assert.equal(technicalJargon.test(allCopy), false, `Release notes must be non-technical: "${allCopy}"`);

    const storage = createMockStorage();
    assert.equal(getSeenReleaseVersion(storage), '');
    assert.equal(shouldShowReleaseNotes({ storage }), true, 'Must show once when version has not been seen');
    assert.equal(shouldShowReleaseNotes({ storage, isFirstTimeOnboarding: true }), false, 'Must skip during fresh onboarding');

    markReleaseNotesSeen(APP_VERSION, storage);
    assert.equal(storage.getItem(RELEASE_NOTES_STORAGE_KEY), APP_VERSION);
    assert.equal(shouldShowReleaseNotes({ storage }), false, 'Must NOT show again after seen');

    // Simulating a prior version triggers display for the newer version
    const oldStorage = createMockStorage({ [RELEASE_NOTES_STORAGE_KEY]: '1.0.14' });
    assert.equal(shouldShowReleaseNotes({ storage: oldStorage }), true, 'Must show once when upgrading from an older version');
  });

  test('AGENTS.md enforces mandatory non-technical release notes policy and modal-release-notes.js complies with design rules', () => {
    const agentsDoc = fs.readFileSync(path.join(REPO_ROOT, 'AGENTS.md'), 'utf8');
    assert.ok(agentsDoc.includes('src/core/release-notes.js'), 'AGENTS.md must reference release-notes.js');
    assert.ok(agentsDoc.includes('NO técnica'), 'AGENTS.md must mandate non-technical changelogs');
    assert.ok(agentsDoc.includes('una sola vez por versión'), 'AGENTS.md must mandate once-per-version display');

    const modalSrc = fs.readFileSync(path.join(REPO_ROOT, 'src/components/modals/modal-release-notes.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    assert.equal(/<p[\s>]/i.test(modalSrc), false, 'modal-release-notes.js must contain zero <p> tags');
    assert.ok(modalSrc.includes('root.onclick'), 'modal-release-notes.js must dismiss on tapping anywhere');
  });
});

describe('Unified Hardware Back-Button & Scroll-Lock Navigation Manager', () => {
  test('hardware Back closes an open modal without exiting the app and unlocks body scroll', () => {
    const env = createMockBrowserEnv();
    env.nav.init({ getCurrentView: () => 'cockpit' });

    let modalClosed = false;
    env.nav.pushOverlayLayer('modal:reading', () => {
      modalClosed = true;
    });

    assert.equal(env.history.index, 1);
    assert.equal(env.isScrollLocked(), true);
    assert.equal(env.nav.hasBlockingOverlay(), true);

    env.pressHardwareBack();
    assert.equal(modalClosed, true, 'Hardware Back must invoke modal close callback');
    assert.equal(env.history.index, 0, 'History must return cleanly to base depth 0');
    assert.equal(env.isScrollLocked(), false, 'Body scroll lock must release when modal closes');
    assert.equal(env.nav.hasBlockingOverlay(), false);
  });

  test('multi-level GPS Data stack unwinds step-by-step on Back: Trip -> Day -> Days -> Close -> Cockpit', () => {
    const env = createMockBrowserEnv();
    env.nav.init({ getCurrentView: () => 'rides' });

    const events = [];
    env.nav.pushOverlayLayer('nav:tab', () => events.push('to-cockpit'), { lockScroll: false, closeOnEscape: false, blocking: false });
    env.nav.pushOverlayLayer('gps-trips', () => events.push('close-gps'));
    env.nav.pushOverlayLayer('gps-trips:day', () => events.push('back-to-days'));
    env.nav.pushOverlayLayer('gps-trips:trip', () => events.push('back-to-day'));

    assert.deepEqual(env.nav.getStackSnapshot(), ['nav:tab', 'gps-trips', 'gps-trips:day', 'gps-trips:trip']);
    assert.equal(env.history.index, 4);

    env.pressHardwareBack();
    assert.deepEqual(events, ['back-to-day']);
    assert.equal(env.isScrollLocked(), true);

    env.pressHardwareBack();
    assert.deepEqual(events, ['back-to-day', 'back-to-days']);
    assert.equal(env.isScrollLocked(), true);

    env.pressHardwareBack();
    assert.deepEqual(events, ['back-to-day', 'back-to-days', 'close-gps']);
    assert.equal(env.isScrollLocked(), false, 'Scroll lock releases once only non-blocking nav:tab remains');

    env.pressHardwareBack();
    assert.deepEqual(events, ['back-to-day', 'back-to-days', 'close-gps', 'to-cockpit']);
    assert.equal(env.history.index, 0);
  });

  test('closing a 3-level modal via X button cleans up all history entries without firing back callbacks', () => {
    const env = createMockBrowserEnv();
    env.nav.init({ getCurrentView: () => 'cockpit' });

    let fired = 0;
    env.nav.pushOverlayLayer('gps-trips', () => { fired++; });
    env.nav.pushOverlayLayer('gps-trips:day', () => { fired++; });
    env.nav.pushOverlayLayer('gps-trips:trip', () => { fired++; });
    assert.equal(env.history.index, 3);

    const removed = env.nav.removeOverlayLayersByPrefix('gps-trips');
    assert.equal(removed, 3);
    assert.equal(env.isScrollLocked(), false);

    env.flushTimers();
    assert.equal(env.history.index, 0, 'All 3 history entries must be trimmed back to base depth 0');
    assert.equal(fired, 0, 'UI close via X must NOT re-trigger popstate onBack handlers');
  });

  test('modal-to-modal handoff (e.g. confirmDialog -> Change Vehicle, or Detail -> Edit) never suffers history.back() race', () => {
    const env = createMockBrowserEnv();
    env.nav.init({ getCurrentView: () => 'settings' });

    let secondModalClosed = false;

    // 1. Open dialog A
    env.nav.pushOverlayLayer('dialog:app', () => {});
    assert.equal(env.history.index, 1);

    // 2. Dialog A closes via confirm button (schedules deferred shrink) and immediately opens modal B
    env.nav.removeOverlayLayer('dialog:app');
    env.nav.pushOverlayLayer('settings:change-vehicle', () => {
      secondModalClosed = true;
    });

    // 3. Flush scheduled timers — modal B MUST stay open and history stays at depth 1
    env.flushTimers();
    assert.equal(secondModalClosed, false, 'Deferred shrink must NOT close the newly opened modal B');
    assert.deepEqual(env.nav.getStackSnapshot(), ['settings:change-vehicle']);
    assert.equal(env.history.index, 1);

    // 4. Now hardware Back cleanly closes modal B
    env.pressHardwareBack();
    assert.equal(secondModalClosed, true);
    assert.equal(env.history.index, 0);
  });

  test('Escape closes only the topmost Escape-dismissible overlay and ignores non-escape tab layers', () => {
    const env = createMockBrowserEnv();
    env.nav.init({ getCurrentView: () => 'cluster' });

    const closed = [];
    env.nav.pushOverlayLayer('nav:tab', () => closed.push('tab'), { lockScroll: false, closeOnEscape: false, blocking: false });
    env.nav.pushOverlayLayer('modal:maintenance', () => closed.push('maint'));
    env.nav.pushOverlayLayer('modal:release-notes', () => closed.push('notes'));

    assert.equal(env.pressEscape(), true);
    assert.deepEqual(closed, ['notes'], 'First Escape closes only topmost modal');

    assert.equal(env.pressEscape(), true);
    assert.deepEqual(closed, ['notes', 'maint'], 'Second Escape closes underlying modal');

    assert.equal(env.pressEscape(), false, 'Third Escape must NOT navigate away from current view tab');
    assert.deepEqual(closed, ['notes', 'maint']);
  });
});

describe('GPS Data Scroll Memory, Theme Harmony & Full Modal Coverage Audit', () => {
  test('modal-gps-trips.js preserves scroll across Level 0 & Level 1, supports Modo Papel, and uses navigation-manager', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'src/components/modals/modal-gps-trips.js'), 'utf8');

    assert.ok(src.includes('id="gps-days-list-scroll"'), 'Level 0 must have dedicated scrollable container id');
    assert.ok(src.includes('id="gps-day-trips-scroll"'), 'Level 1 must have dedicated scrollable container id');
    assert.ok(src.includes('captureCurrentLevelScroll'), 'Must capture scroll before navigating or live-updating');
    assert.ok(src.includes('restoreLevelScroll'), 'Must restore scroll when returning to Level 0 or Level 1');
    assert.ok(src.includes('pushOverlayLayer(LAYER_ROOT'), 'Must register Level 0 root on Back stack');
    assert.ok(src.includes('pushOverlayLayer(LAYER_DAY'), 'Must register Level 1 day on Back stack');
    assert.ok(src.includes('pushOverlayLayer(LAYER_TRIP'), 'Must register Level 2 trip on Back stack');
    assert.equal(src.includes("window.addEventListener('popstate'"), false, 'Must not register duplicate raw popstate listener');

    // Only the dark Leaflet map container (#gps-day-map-container) may keep bg-[#09090b]
    const bgDarkMatches = [...src.matchAll(/bg-\[#09090b\]/gi)];
    assert.equal(bgDarkMatches.length, 1, 'Only #gps-day-map-container should hardcode dark bg-[#09090b]; modal chrome must use var(--bg-void)');
  });

  test('every active modal and dialog in the application integrates navigation-manager.js', () => {
    const overlayFiles = [
      'src/components/dialogs/app-dialog.js',
      'src/components/fab-contextual.js',
      'src/components/modals/modal-diagnostic.js',
      'src/components/modals/modal-gps-intelligence.js',
      'src/components/modals/modal-gps-trips.js',
      'src/components/modals/modal-kpi-detail.js',
      'src/components/modals/modal-legal-doc.js',
      'src/components/modals/modal-maintenance.js',
      'src/components/modals/modal-movement-detail.js',
      'src/components/modals/modal-onboarding.js',
      'src/components/modals/modal-reading.js',
      'src/components/modals/modal-refuel.js',
      'src/components/modals/modal-release-notes.js',
      'src/components/modals/modal-ride-entry.js',
      'src/components/modals/modal-telemetry-detail.js',
      'src/views/modal-ghost-race.js',
      'src/views/view-settings.js'
    ];

    for (const rel of overlayFiles) {
      const content = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
      assert.ok(content.includes('navigation-manager.js'), `${rel} must integrate navigation-manager.js`);
      assert.ok(content.includes('pushOverlayLayer('), `${rel} must push overlay layer on open`);
      assert.ok(content.includes('removeOverlayLayer'), `${rel} must remove overlay layer on close`);
    }
  });
});
