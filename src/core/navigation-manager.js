/**
 * OCTANE — Unified Overlay Navigation, Back-Button & Scroll-Lock Manager
 *
 * Keeps mobile hardware/gesture Back button, Escape key, and document scroll lock
 * deterministically synchronized across all modals, dialogs, multi-level drill-downs
 * (e.g. GPS Data Level 0 -> Level 1 -> Level 2), and non-home views.
 *
 * Guarantees:
 * - Pressing Back inside any modal closes ONLY that modal (or steps back 1 level)
 *   and NEVER exits the app prematurely.
 * - Closing a modal via UI controls cleans up its browser history entry without
 *   race conditions during modal-to-modal handoffs (sync or async via confirmDialog).
 * - Background page scrolling is locked while blocking overlays are open without
 *   losing the underlying view's scroll position.
 */

const DEPTH_KEY = 'octaneNavDepth';
const LAYER_KEY = 'octaneLayerId';

/**
 * Creates an isolated navigation stack manager (injectable for deterministic tests).
 * @param {Object} [env]
 */
export function createNavigationManager(env = {}) {
  const win = env.window !== undefined ? env.window : (typeof window !== 'undefined' ? window : null);
  const doc = env.document !== undefined ? env.document : (typeof document !== 'undefined' ? document : null);
  const hist = env.history !== undefined ? env.history : (win?.history || null);
  const scheduleTimer = env.setTimeout || ((fn, ms) => setTimeout(fn, ms));
  const cancelTimer = env.clearTimeout || ((id) => clearTimeout(id));

  /** @type {Array<{ id: string, onBack: Function, lockScroll: boolean, closeOnEscape: boolean, blocking: boolean }>} */
  const layerStack = [];
  let committedDepth = 0;
  let shrinkTimer = null;
  let initialized = false;
  let currentViewProvider = () => 'cockpit';

  function getBaseUrl() {
    if (!win || !win.location) return '';
    return `${win.location.pathname || ''}${win.location.search || ''}`;
  }

  function syncScrollLock() {
    if (!doc || !doc.documentElement) return;
    const shouldLock = layerStack.some((l) => l.lockScroll);
    doc.documentElement.classList.toggle('octane-scroll-locked', shouldLock);
    if (doc.body) {
      doc.body.classList.toggle('octane-scroll-locked', shouldLock);
    }
  }

  function clearPendingShrink() {
    if (shrinkTimer !== null) {
      cancelTimer(shrinkTimer);
      shrinkTimer = null;
    }
  }

  function buildHistoryState(depth, layerId = null) {
    return {
      view: currentViewProvider(),
      [DEPTH_KEY]: depth,
      ...(layerId ? { [LAYER_KEY]: layerId } : { octaneBase: true })
    };
  }

  function scheduleShrinkIfNeeded() {
    clearPendingShrink();
    if (!hist || typeof hist.go !== 'function') {
      committedDepth = layerStack.length;
      return;
    }

    shrinkTimer = scheduleTimer(() => {
      shrinkTimer = null;
      const delta = layerStack.length - committedDepth;
      if (delta < 0) {
        committedDepth = layerStack.length;
        try {
          hist.go(delta);
        } catch (_) {}
      } else if (delta === 0 && layerStack.length > 0) {
        const top = layerStack[layerStack.length - 1];
        try {
          hist.replaceState?.(buildHistoryState(committedDepth, top.id), '');
        } catch (_) {}
      }
    }, 0);
  }

  /**
   * Ensures the base browser history state is tagged with depth 0 and binds global
   * popstate + Escape listeners once.
   * @param {Object} [options={}]
   * @param {Function} [options.getCurrentView]
   */
  function init(options = {}) {
    if (typeof options.getCurrentView === 'function') {
      currentViewProvider = options.getCurrentView;
    }
    if (initialized) return;
    initialized = true;

    try {
      if (hist && typeof hist.replaceState === 'function') {
        const existingDepth = Number(hist.state?.[DEPTH_KEY]);
        if (!Number.isFinite(existingDepth) || existingDepth < 0) {
          hist.replaceState(buildHistoryState(0, null), '', getBaseUrl());
        }
        committedDepth = 0;
      }
    } catch (_) {}

    if (win && typeof win.addEventListener === 'function') {
      win.addEventListener('popstate', handlePopState);
      win.addEventListener('keydown', handleKeyDown);
    }
  }

  /**
   * Pushes (or updates in-place) a navigable overlay layer onto the stack.
   * @param {string} id - Unique identifier for the layer
   * @param {Function} onBack - Invoked when user presses Back or Escape for this layer
   * @param {Object} [options={}]
   * @param {boolean} [options.lockScroll=true]
   * @param {boolean} [options.closeOnEscape=true]
   * @param {boolean} [options.blocking=true]
   */
  function pushOverlayLayer(id, onBack, options = {}) {
    if (!id || typeof onBack !== 'function') return;

    const lockScroll = options.lockScroll !== false;
    const closeOnEscape = options.closeOnEscape !== false;
    const blocking = options.blocking !== false;

    clearPendingShrink();

    const existingIdx = layerStack.findIndex((l) => l.id === id);
    if (existingIdx !== -1) {
      layerStack[existingIdx].onBack = onBack;
      layerStack[existingIdx].lockScroll = lockScroll;
      layerStack[existingIdx].closeOnEscape = closeOnEscape;
      layerStack[existingIdx].blocking = blocking;
      syncScrollLock();
      return;
    }

    layerStack.push({ id, onBack, lockScroll, closeOnEscape, blocking });
    syncScrollLock();

    if (hist && typeof hist.pushState === 'function') {
      try {
        while (committedDepth < layerStack.length) {
          const entry = layerStack[committedDepth];
          committedDepth++;
          hist.pushState(buildHistoryState(committedDepth, entry.id), '');
        }
        if (committedDepth === layerStack.length) {
          const top = layerStack[layerStack.length - 1];
          hist.replaceState?.(buildHistoryState(committedDepth, top.id), '');
        } else if (committedDepth > layerStack.length) {
          scheduleShrinkIfNeeded();
        }
      } catch (_) {
        committedDepth = layerStack.length;
      }
    } else {
      committedDepth = layerStack.length;
    }
  }

  /**
   * Removes an overlay layer when closed via UI controls (X button, Save, backdrop).
   * Safe to call redundantly (idempotent) and safe during Back-button popstate.
   * @param {string} id
   */
  function removeOverlayLayer(id) {
    if (!id) return false;
    const idx = layerStack.findIndex((l) => l.id === id);
    if (idx === -1) return false;

    layerStack.splice(idx, 1);
    syncScrollLock();
    scheduleShrinkIfNeeded();
    return true;
  }

  /**
   * Removes all layers whose id starts with prefix (e.g. closing a 3-level modal via X).
   * @param {string} prefix
   * @returns {number} Count removed
   */
  function removeOverlayLayersByPrefix(prefix) {
    if (!prefix) return 0;
    let removed = 0;
    for (let i = layerStack.length - 1; i >= 0; i--) {
      if (layerStack[i].id === prefix || layerStack[i].id.startsWith(`${prefix}:`)) {
        layerStack.splice(i, 1);
        removed++;
      }
    }
    if (removed > 0) {
      syncScrollLock();
      scheduleShrinkIfNeeded();
    }
    return removed;
  }

  /**
   * Handles browser / Android hardware Back button (`popstate`).
   * Unwinds the topmost active layer(s) to match the popped history depth.
   * @param {PopStateEvent} event
   */
  function handlePopState(event) {
    clearPendingShrink();
    const rawDepth = event?.state?.[DEPTH_KEY];
    const targetDepth = Number.isFinite(Number(rawDepth)) ? Math.max(0, Number(rawDepth)) : 0;

    committedDepth = Math.min(committedDepth, targetDepth);

    if (layerStack.length <= targetDepth) {
      syncScrollLock();
      return;
    }

    // Pop layers above targetDepth in LIFO order and invoke each layer's onBack handler
    while (layerStack.length > targetDepth) {
      const popped = layerStack.pop();
      syncScrollLock();
      if (popped && typeof popped.onBack === 'function') {
        try {
          popped.onBack({ fromPopState: true, id: popped.id });
        } catch (err) {
          console.warn('[OCTANE NAV] Error unwinding layer:', popped.id, err);
        }
      }
    }
    syncScrollLock();
  }

  /**
   * Handles Escape key by closing ONLY the topmost Escape-dismissible overlay layer.
   * @param {KeyboardEvent} event
   */
  function handleKeyDown(event) {
    if (!event || event.key !== 'Escape') return;
    if (layerStack.length === 0) return;

    const top = layerStack[layerStack.length - 1];
    if (!top || !top.closeOnEscape) return;

    event.preventDefault();
    event.stopPropagation();

    layerStack.pop();
    syncScrollLock();
    scheduleShrinkIfNeeded();

    try {
      top.onBack({ fromEscape: true, id: top.id });
    } catch (err) {
      console.warn('[OCTANE NAV] Error handling Escape on layer:', top.id, err);
    }
  }

  function hasBlockingOverlay() {
    return layerStack.some((l) => l.blocking);
  }

  function hasOverlay(id) {
    return layerStack.some((l) => l.id === id);
  }

  function getStackSnapshot() {
    return layerStack.map((l) => l.id);
  }

  function getCommittedDepth() {
    return committedDepth;
  }

  function destroy() {
    clearPendingShrink();
    layerStack.length = 0;
    committedDepth = 0;
    syncScrollLock();
    if (initialized && win && typeof win.removeEventListener === 'function') {
      win.removeEventListener('popstate', handlePopState);
      win.removeEventListener('keydown', handleKeyDown);
    }
    initialized = false;
  }

  return {
    init,
    pushOverlayLayer,
    removeOverlayLayer,
    removeOverlayLayersByPrefix,
    hasBlockingOverlay,
    hasOverlay,
    getStackSnapshot,
    getCommittedDepth,
    handlePopState,
    handleKeyDown,
    destroy
  };
}

// Singleton instance for the application runtime
export const navigationManager = createNavigationManager();

export function initNavigationManager(options = {}) {
  return navigationManager.init(options);
}

export function pushOverlayLayer(id, onBack, options = {}) {
  return navigationManager.pushOverlayLayer(id, onBack, options);
}

export function removeOverlayLayer(id) {
  return navigationManager.removeOverlayLayer(id);
}

export function removeOverlayLayersByPrefix(prefix) {
  return navigationManager.removeOverlayLayersByPrefix(prefix);
}

export function hasBlockingOverlay() {
  return navigationManager.hasBlockingOverlay();
}
