/**
 * OCTANE // KINETIC — Tactile In-App Numeric Keypad ("numeric-keypad.js")
 * Minimal Swiss / Teenage Engineering Aesthetic (Hairline 1px, tabular mono, horology acoustic ticks).
 * 
 * Rules:
 * - Zero <p> tags.
 * - Suppresses OS virtual keyboard via inputmode="none".
 * - Atomic 1-by-1 digit backspace, with long-press full clear.
 * - Instant live formatting (formatThousandsLive) and cursor stabilization at string end.
 */

import { playHorologyTick } from '../../core/state.js';
import { formatThousandsLive, parseIntegerMetric, setCursorAtEnd } from '../../core/number-utils.js';

/**
 * Creates and mounts an in-app tactile numeric keypad.
 * @param {Object} config
 * @param {HTMLElement} config.container - Container element to mount the keypad into
 * @param {Array<HTMLInputElement>} config.inputs - Inputs controlled by this keypad
 * @param {Function} [config.onConfirm] - Callback when confirm / submit is clicked
 * @param {Function} [config.onInput] - Callback on every keystroke
 * @param {boolean} [config.compact=false] - Whether to use compact height
 * @returns {Object} Keypad controller with methods { setActiveInput, destroy, focusNext }
 */
export function createNumericKeypad(config) {
  const { container, inputs = [], onConfirm, onInput, compact = false } = config;
  if (!container) return null;

  let activeInput = inputs[0] || null;
  let backspaceTimer = null;
  let isLongPress = false;

  // Render keypad DOM
  container.innerHTML = `
    <div class="octane-numeric-keypad w-full bg-[var(--bg-void)] border-t border-[var(--line-hair)] select-none">
      <div class="grid grid-cols-4 divide-x divide-y divide-[var(--line-hair)] border-b border-[var(--line-hair)] text-center font-mono">
        <!-- Row 1 -->
        <button type="button" data-key="1" class="keypad-btn h-12 flex items-center justify-center text-lg text-[var(--text-primary)] hover:bg-[var(--bg-surface)] active:bg-[var(--bg-elevated)] cursor-pointer">1</button>
        <button type="button" data-key="2" class="keypad-btn h-12 flex items-center justify-center text-lg text-[var(--text-primary)] hover:bg-[var(--bg-surface)] active:bg-[var(--bg-elevated)] cursor-pointer">2</button>
        <button type="button" data-key="3" class="keypad-btn h-12 flex items-center justify-center text-lg text-[var(--text-primary)] hover:bg-[var(--bg-surface)] active:bg-[var(--bg-elevated)] cursor-pointer">3</button>
        <button type="button" data-key="backspace" class="keypad-btn h-12 flex items-center justify-center text-base text-[var(--accent-crimson)] hover:bg-[var(--bg-surface)] active:bg-[var(--bg-elevated)] cursor-pointer">⌫</button>

        <!-- Row 2 -->
        <button type="button" data-key="4" class="keypad-btn h-12 flex items-center justify-center text-lg text-[var(--text-primary)] hover:bg-[var(--bg-surface)] active:bg-[var(--bg-elevated)] cursor-pointer">4</button>
        <button type="button" data-key="5" class="keypad-btn h-12 flex items-center justify-center text-lg text-[var(--text-primary)] hover:bg-[var(--bg-surface)] active:bg-[var(--bg-elevated)] cursor-pointer">5</button>
        <button type="button" data-key="6" class="keypad-btn h-12 flex items-center justify-center text-lg text-[var(--text-primary)] hover:bg-[var(--bg-surface)] active:bg-[var(--bg-elevated)] cursor-pointer">6</button>
        <button type="button" data-key="next" class="keypad-btn h-12 flex items-center justify-center text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] active:bg-[var(--bg-elevated)] cursor-pointer">⇥ SIG</button>

        <!-- Row 3 -->
        <button type="button" data-key="7" class="keypad-btn h-12 flex items-center justify-center text-lg text-[var(--text-primary)] hover:bg-[var(--bg-surface)] active:bg-[var(--bg-elevated)] cursor-pointer">7</button>
        <button type="button" data-key="8" class="keypad-btn h-12 flex items-center justify-center text-lg text-[var(--text-primary)] hover:bg-[var(--bg-surface)] active:bg-[var(--bg-elevated)] cursor-pointer">8</button>
        <button type="button" data-key="9" class="keypad-btn h-12 flex items-center justify-center text-lg text-[var(--text-primary)] hover:bg-[var(--bg-surface)] active:bg-[var(--bg-elevated)] cursor-pointer">9</button>
        <button type="button" data-key="clear" class="keypad-btn h-12 flex items-center justify-center text-[10px] uppercase text-[var(--text-secondary)] hover:text-[var(--accent-crimson)] hover:bg-[var(--bg-surface)] active:bg-[var(--bg-elevated)] cursor-pointer">CLR</button>

        <!-- Row 4 -->
        <button type="button" data-key="dot" id="keypad-dyn-key" class="keypad-btn h-12 flex items-center justify-center text-sm font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] active:bg-[var(--bg-elevated)] cursor-pointer">.</button>
        <button type="button" data-key="0" class="keypad-btn h-12 flex items-center justify-center text-lg text-[var(--text-primary)] hover:bg-[var(--bg-surface)] active:bg-[var(--bg-elevated)] cursor-pointer">0</button>
        <button type="button" data-key="triple-zero" class="keypad-btn h-12 flex items-center justify-center text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] active:bg-[var(--bg-elevated)] cursor-pointer">000</button>
        <button type="button" data-key="confirm" class="keypad-btn h-12 flex items-center justify-center text-sm font-bold text-[var(--accent-volt)] hover:bg-[var(--bg-surface)] active:bg-[var(--bg-elevated)] cursor-pointer">✓</button>
      </div>
    </div>
  `;

  const dynKey = container.querySelector('#keypad-dyn-key');

  // Configure input mode & attach focus events
  function setupInputs() {
    inputs.forEach((input, index) => {
      if (!input) return;

      // Prevent native keyboard on mobile
      input.setAttribute('inputmode', 'none');
      input.setAttribute('autocomplete', 'off');

      // Style indication for active input
      input.addEventListener('focus', () => {
        setActiveInput(input);
      });

      // Avoid long-press context menu on Android
      input.addEventListener('contextmenu', (e) => e.preventDefault());

      // If user clicks, keep cursor at end instead of selecting all
      input.addEventListener('click', () => {
        setCursorAtEnd(input);
      });
    });
  }

  function updateDynamicKey() {
    if (!dynKey || !activeInput) return;
    const isDecimalAllowed = activeInput.dataset.decimal === 'true' || 
                             activeInput.id.includes('km') || 
                             activeInput.id.includes('gal') ||
                             activeInput.dataset.mode === 'decimal';
    if (isDecimalAllowed) {
      dynKey.textContent = '.';
      dynKey.dataset.key = 'dot';
    } else {
      dynKey.textContent = '+1K';
      dynKey.dataset.key = 'plus-1k';
    }
  }

  function setActiveInput(input) {
    if (!input) return;
    activeInput = input;
    inputs.forEach(inp => {
      if (!inp) return;
      if (inp === activeInput) {
        inp.classList.add('border-b-[var(--accent-volt)]');
        inp.classList.remove('border-b-[var(--line-hair)]');
      } else {
        inp.classList.remove('border-b-[var(--accent-volt)]');
        inp.classList.add('border-b-[var(--line-hair)]');
      }
    });
    updateDynamicKey();
    setCursorAtEnd(activeInput);
  }

  function focusNext() {
    const currentIndex = inputs.indexOf(activeInput);
    if (currentIndex >= 0 && currentIndex < inputs.length - 1) {
      const nextInput = inputs[currentIndex + 1];
      if (nextInput) {
        nextInput.focus();
        setActiveInput(nextInput);
      }
    } else if (inputs.length > 0) {
      // Loop or trigger confirm
      if (typeof onConfirm === 'function') {
        onConfirm();
      }
    }
  }

  function handleKey(key) {
    if (!activeInput) return;

    playHorologyTick(1200, 0.012, 0.025);

    const isDecimal = activeInput.dataset.decimal === 'true' || 
                      activeInput.id.includes('km') || 
                      activeInput.id.includes('gal');
    const isIntegerFormatted = activeInput.dataset.format === 'thousands' || 
                               activeInput.id.includes('odo') || 
                               activeInput.id.includes('gross') || 
                               activeInput.id.includes('amount') || 
                               activeInput.id.includes('price') || 
                               activeInput.id.includes('total');

    let currentVal = activeInput.value || '';

    if (key >= '0' && key <= '9') {
      if (isIntegerFormatted) {
        const raw = currentVal.replace(/[^\d]/g, '') + key;
        activeInput.value = formatThousandsLive(raw);
      } else if (isDecimal) {
        // Prevent multiple decimals
        activeInput.value = currentVal + key;
      } else {
        activeInput.value = currentVal + key;
      }
    } else if (key === 'triple-zero') {
      if (isIntegerFormatted) {
        const raw = currentVal.replace(/[^\d]/g, '');
        if (raw.length > 0) {
          activeInput.value = formatThousandsLive(raw + '000');
        }
      } else {
        activeInput.value = currentVal + '000';
      }
    } else if (key === 'plus-1k') {
      const currentInt = parseIntegerMetric(currentVal) || 0;
      activeInput.value = formatThousandsLive(currentInt + 1000);
    } else if (key === 'dot') {
      if (isDecimal && !currentVal.includes('.')) {
        activeInput.value = (currentVal || '0') + '.';
      }
    } else if (key === 'backspace') {
      if (isIntegerFormatted) {
        const digits = currentVal.replace(/[^\d]/g, '');
        if (digits.length <= 1) {
          activeInput.value = '';
        } else {
          activeInput.value = formatThousandsLive(digits.slice(0, -1));
        }
      } else {
        activeInput.value = currentVal.slice(0, -1);
      }
    } else if (key === 'clear') {
      playHorologyTick(800, 0.02, 0.035);
      activeInput.value = '';
    } else if (key === 'next') {
      focusNext();
      return;
    } else if (key === 'confirm') {
      playHorologyTick(1600, 0.02, 0.04);
      if (typeof onConfirm === 'function') {
        onConfirm();
      }
      return;
    }

    // Trigger synthetic input event for reactive calculation bindings
    activeInput.dispatchEvent(new Event('input', { bubbles: true }));
    setCursorAtEnd(activeInput);

    if (typeof onInput === 'function') {
      onInput(activeInput.value, key, activeInput);
    }
  }

  // Keypad button click handlers
  container.querySelectorAll('.keypad-btn').forEach(btn => {
    const key = btn.dataset.key;

    if (key === 'backspace') {
      // Support long press to clear
      btn.addEventListener('pointerdown', (e) => {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        isLongPress = false;
        backspaceTimer = setTimeout(() => {
          isLongPress = true;
          handleKey('clear');
        }, 400);
      });

      btn.addEventListener('pointerup', (e) => {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        clearTimeout(backspaceTimer);
        if (!isLongPress) {
          handleKey('backspace');
        }
        isLongPress = false;
      });

      btn.addEventListener('pointercancel', () => {
        clearTimeout(backspaceTimer);
        isLongPress = false;
      });
    } else {
      btn.addEventListener('click', (e) => {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        const currentKey = btn.dataset.key;
        handleKey(currentKey);
      });
    }
  });

  setupInputs();
  if (activeInput) {
    setActiveInput(activeInput);
  }

  return {
    setActiveInput,
    focusNext,
    destroy() {
      container.innerHTML = '';
    }
  };
}
