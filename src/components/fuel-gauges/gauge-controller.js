/**
 * OCTANE // KINETIC — Unified Fuel Gauge Controller
 * Handles pointer/touch drag tracking, setPointerCapture, notch resistance,
 * precision haptic audio ticks, and L / GAL volume calculations.
 */

let audioCtx = null;
let soundMuted = false;

/**
 * High-precision horology tick generator using Web Audio API.
 * Emulates the mechanical click of high-end chronographs and technical rotary switches.
 * @param {number} freq - Pitch frequency in Hz (e.g. 1200)
 * @param {number} dur - Duration in seconds (e.g. 0.012)
 * @param {number} gainVal - Amplitude gain (e.g. 0.025)
 */
export function playHorologyTick(freq = 1200, dur = 0.012, gainVal = 0.025) {
  if (soundMuted) return;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!audioCtx) {
      audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(180, audioCtx.currentTime + dur);
    gain.gain.setValueAtTime(gainVal, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + dur);
  } catch (err) {
    // Graceful fallback for environments with blocked autoplay/audio policy
  }
}

/**
 * Toggles global audio state for the gauge controllers.
 * @param {boolean} muted
 */
export function setAudioMuted(muted) {
  soundMuted = Boolean(muted);
  if (typeof window !== 'undefined') {
    window.__OCTANE_SOUND_MUTED__ = soundMuted;
  }
}

/**
 * Returns whether sound is currently muted.
 * @returns {boolean}
 */
export function isAudioMuted() {
  return soundMuted;
}

/**
 * Clamps a number between min and max.
 * @param {number} val
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(val, min = 0, max = 100) {
  return Math.min(Math.max(val, min), max);
}

/**
 * Calculates fuel volumes from tank capacities and percentage level.
 * @param {number} percent - 0 to 100
 * @param {number} tankCapacityLiters - e.g. 35.0
 * @param {number} tankCapacityGallons - e.g. 9.25
 * @returns {{ liters: number, gallons: number }}
 */
export function calculateFuelVolume(percent, tankCapacityLiters = 35.0, tankCapacityGallons = 9.25) {
  const safePct = clamp(percent, 0, 100);
  const liters = (safePct / 100) * Number(tankCapacityLiters);
  const gallons = (safePct / 100) * Number(tankCapacityGallons);
  return {
    liters: Number(liters.toFixed(2)),
    gallons: Number(gallons.toFixed(3))
  };
}

/**
 * Formats fuel volume for display in both Liters and Gallons.
 * @param {number} liters
 * @param {number} gallons
 * @returns {string} e.g. "14.7 L / 3.89 GAL"
 */
export function formatFuelReadout(liters, gallons) {
  return `${Number(liters).toFixed(1)} L / ${Number(gallons).toFixed(2)} GAL`;
}

/**
 * Creates an interactive pointer controller for fuel gauges.
 * Supports setPointerCapture, notch snap, haptic audio thresholds, and drag callbacks.
 *
 * @param {HTMLElement|SVGElement} targetElement - DOM element to attach listeners to
 * @param {Object} options
 * @param {number} options.initialValue - Initial percent (0-100)
 * @param {number} options.tankCapacityLiters - Vehicle tank capacity in Liters
 * @param {number} options.tankCapacityGallons - Vehicle tank capacity in Gallons
 * @param {Function} options.coordinateToPercent - (event, rect) => percent [0..100]
 * @param {Function} options.onChange - ({ percent, liters, gallons, isDragging, rawEvent }) => void
 * @param {boolean} [options.enableNotches=true] - Play ticks at 5% / 25% / 50% / 75% / 100%
 * @param {number} [options.notchStep=5] - Step threshold for haptic tick
 * @param {boolean} [options.magneticSnap=false] - Snap gently to notches if within range
 * @returns {Object} Controller instance with { getValue(), setValue(), destroy() }
 */
export function createGaugePointerController(targetElement, options = {}) {
  const {
    initialValue = 50,
    tankCapacityLiters = 35.0,
    tankCapacityGallons = 9.25,
    coordinateToPercent = null,
    onChange = () => {},
    enableNotches = true,
    notchStep = 5,
    magneticSnap = false
  } = options;

  let currentValue = clamp(Number(initialValue), 0, 100);
  let isDragging = false;
  let lastNotchCrossed = Math.round(currentValue / notchStep) * notchStep;

  function triggerChange(val, dragging = false, rawEvent = null) {
    currentValue = clamp(val, 0, 100);
    const volumes = calculateFuelVolume(currentValue, tankCapacityLiters, tankCapacityGallons);

    if (enableNotches) {
      const currentNotch = Math.round(currentValue / notchStep) * notchStep;
      if (currentNotch !== lastNotchCrossed) {
        // Distinct audio pitch for key milestone marks (0, 25, 50, 75, 100)
        if (currentNotch === 100) {
          playHorologyTick(1600, 0.018, 0.035);
        } else if (currentNotch === 0) {
          playHorologyTick(580, 0.02, 0.04);
        } else if (currentNotch % 25 === 0) {
          playHorologyTick(1350, 0.014, 0.03);
        } else {
          playHorologyTick(950, 0.008, 0.018);
        }
        lastNotchCrossed = currentNotch;
      }
    }

    onChange({
      percent: currentValue,
      liters: volumes.liters,
      gallons: volumes.gallons,
      isDragging: dragging,
      rawEvent
    });
  }

  function handlePointerDown(e) {
    // Only respond to primary button (touch or left mouse click)
    if (e.button !== undefined && e.button !== 0) return;
    isDragging = true;

    try {
      if (typeof targetElement.setPointerCapture === 'function') {
        targetElement.setPointerCapture(e.pointerId);
      }
    } catch (err) {
      // Ignored if pointer capture is unsupported or element disconnected
    }

    playHorologyTick(1100, 0.012, 0.025);

    if (typeof coordinateToPercent === 'function') {
      const rect = targetElement.getBoundingClientRect();
      let calculated = coordinateToPercent(e, rect);
      if (magneticSnap) {
        const snap = Math.round(calculated / notchStep) * notchStep;
        if (Math.abs(calculated - snap) <= 1.5) calculated = snap;
      }
      triggerChange(calculated, true, e);
    }
  }

  function handlePointerMove(e) {
    if (!isDragging) return;
    if (typeof coordinateToPercent === 'function') {
      const rect = targetElement.getBoundingClientRect();
      let calculated = coordinateToPercent(e, rect);
      if (magneticSnap) {
        const snap = Math.round(calculated / notchStep) * notchStep;
        if (Math.abs(calculated - snap) <= 1.5) calculated = snap;
      }
      triggerChange(calculated, true, e);
    }
  }

  function handlePointerUp(e) {
    if (!isDragging) return;
    isDragging = false;
    try {
      if (typeof targetElement.releasePointerCapture === 'function' && targetElement.hasPointerCapture(e.pointerId)) {
        targetElement.releasePointerCapture(e.pointerId);
      }
    } catch (err) {
      // Release failed or not captured
    }
    triggerChange(currentValue, false, e);
  }

  function handlePointerCancel(e) {
    if (!isDragging) return;
    isDragging = false;
    triggerChange(currentValue, false, e);
  }

  function handleLostPointerCapture(e) {
    if (!isDragging) return;
    isDragging = false;
    triggerChange(currentValue, false, e);
  }

  // Attach touch and pointer listeners
  targetElement.addEventListener('pointerdown', handlePointerDown);
  targetElement.addEventListener('lostpointercapture', handleLostPointerCapture);
  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', handlePointerUp);
  window.addEventListener('pointercancel', handlePointerCancel);

  // Prevent default drag and scroll gestures when interacting on touch devices
  targetElement.style.touchAction = 'none';
  targetElement.style.userSelect = 'none';

  return {
    getValue: () => currentValue,
    setValue: (newVal, silent = false) => {
      const clamped = clamp(Number(newVal), 0, 100);
      currentValue = clamped;
      lastNotchCrossed = Math.round(currentValue / notchStep) * notchStep;
      if (!silent) {
        const volumes = calculateFuelVolume(currentValue, tankCapacityLiters, tankCapacityGallons);
        onChange({
          percent: currentValue,
          liters: volumes.liters,
          gallons: volumes.gallons,
          isDragging: false,
          rawEvent: null
        });
      }
    },
    destroy: () => {
      targetElement.removeEventListener('pointerdown', handlePointerDown);
      targetElement.removeEventListener('lostpointercapture', handleLostPointerCapture);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
    }
  };
}
