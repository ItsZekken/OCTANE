/**
 * OCTANE // KINETIC — Viewport & Mobile Keyboard Manager ("viewport-manager.js")
 * Prevents jarring layout jumps and clipping when Android virtual keyboards open.
 * 
 * Rules:
 * - Zero <p> tags.
 * - Reactive tracking of visualViewport height.
 * - Smooth centering of focused open text inputs (notes, concepts).
 */

let isInitialized = false;

/**
 * Initializes the visual viewport watcher.
 */
export function initViewportManager() {
  if (isInitialized || typeof window === 'undefined') return;
  isInitialized = true;

  if (window.visualViewport) {
    const handleViewportChange = () => {
      const vh = window.visualViewport.height;
      const windowH = window.innerHeight;
      const keyboardHeight = Math.max(0, windowH - vh);
      const isKeyboardOpen = keyboardHeight > 120;

      if (document.documentElement) {
        document.documentElement.style.setProperty(
          '--virtual-keyboard-height',
          `${isKeyboardOpen ? keyboardHeight : 0}px`
        );
        document.body.classList.toggle('keyboard-active', isKeyboardOpen);
      }
    };

    window.visualViewport.addEventListener('resize', handleViewportChange);
    window.visualViewport.addEventListener('scroll', handleViewportChange);
  }
}

/**
 * Smoothly centers an active input into the visible viewport.
 * @param {HTMLElement} element - Focused text input or textarea
 */
export function ensureFieldInView(element) {
  if (!element || typeof element.scrollIntoView !== 'function') return;
  setTimeout(() => {
    try {
      element.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest'
      });
    } catch (_) {}
  }, 120);
}
