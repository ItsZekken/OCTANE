/**
 * OCTANE // KINETIC — Micro-HUD Tooltip System
 * Industrial Minimalist floating micro-HUD (Teenage Engineering / Braun aesthetic).
 * 
 * Features:
 * - Event delegation for zero DOM overhead on `[data-tip]`.
 * - Responsive 1px HUD with amber indicator dot and hairline structure.
 * - Viewport-aware boundary clamping (guaranteed zero clipping on 360px mobile screens).
 * - Tactile acoustic horology feedback (1300 Hz tick).
 * - Automatic dismissal after 3.2s, on scroll, or on outside touch.
 * - Zero <p> tags, zero blur, zero heavy shadows (strict AGENTS.md compliance).
 */

import { playHorologyTick } from '../core/state.js';

let tooltipEl = null;
let dismissTimer = null;
let activeTarget = null;
let isInitialized = false;

/**
 * Escapes unsafe characters for safe innerHTML injection.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Parses raw data-tip content into title and optional explanation.
 * Recognizes " · " or ":" as structural separators.
 * Example: "RENDIMIENTO PROMEDIO · Eficiencia calculada de ciclos cerrados"
 * @param {string} rawTip
 * @returns {{ title: string, desc: string }}
 */
function parseTipContent(rawTip) {
  const trimmed = (rawTip || '').trim();
  if (!trimmed) return { title: '', desc: '' };

  if (trimmed.includes('·')) {
    const parts = trimmed.split('·');
    return {
      title: parts[0].trim(),
      desc: parts.slice(1).join('·').trim()
    };
  }

  if (trimmed.includes(':')) {
    const parts = trimmed.split(':');
    return {
      title: parts[0].trim(),
      desc: parts.slice(1).join(':').trim()
    };
  }

  return {
    title: trimmed,
    desc: ''
  };
}

/**
 * Positions the tooltip smartly relative to target element with viewport clamping.
 * Prevents horizontal or vertical cutoff on 360px mobile viewports.
 * @param {HTMLElement} targetEl
 * @param {HTMLElement} tipEl
 */
function positionTooltip(targetEl, tipEl) {
  // Prevent canvas expansion and ensure correct dimensions before measuring
  tipEl.style.left = '0px';
  tipEl.style.top = '0px';
  tipEl.style.whiteSpace = 'normal';
  tipEl.style.overflowWrap = 'break-word';
  tipEl.style.wordBreak = 'break-word';

  const rect = targetEl.getBoundingClientRect();
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const margin = 8;

  // Strict constraint for narrow devices (360px)
  const maxTipWidth = Math.min(260, viewportWidth - 24);
  tipEl.style.maxWidth = `${maxTipWidth}px`;
  tipEl.style.width = 'max-content';

  // Measure tooltip bounding box
  const tipWidth = tipEl.offsetWidth || 200;
  const tipHeight = tipEl.offsetHeight || 44;

  // Center horizontally relative to target element
  let left = rect.left + (rect.width / 2) - (tipWidth / 2);

  // Viewport clamping horizontally
  if (left < margin) {
    left = margin;
  } else if (left + tipWidth > viewportWidth - margin) {
    left = Math.max(margin, viewportWidth - margin - tipWidth);
  }

  // Vertical placement: prefer above target
  let top = rect.top - tipHeight - 6;

  // If clipping top boundary, position below target
  if (top < margin) {
    top = rect.bottom + 6;
    // If also clipping bottom boundary, keep inside viewport
    if (top + tipHeight > viewportHeight - margin) {
      top = Math.max(margin, viewportHeight - margin - tipHeight);
    }
  }

  tipEl.style.left = `${Math.round(left)}px`;
  tipEl.style.top = `${Math.round(top)}px`;
}

/**
 * Displays the Micro-HUD tooltip anchored to the given element.
 * @param {HTMLElement} targetEl
 * @param {string} [explicitText]
 */
export function showMicroTooltip(targetEl, explicitText) {
  if (!targetEl) return;
  const rawTip = explicitText || targetEl.getAttribute('data-tip');
  if (!rawTip || !rawTip.trim()) return;

  const { title, desc } = parseTipContent(rawTip);
  if (!title) return;

  // Clear existing dismissal timer
  if (dismissTimer) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }

  // Create or reuse tooltip element
  if (!tooltipEl) {
    tooltipEl = document.createElement('div');
    tooltipEl.id = 'octane-micro-tooltip';
    tooltipEl.setAttribute('role', 'tooltip');
    tooltipEl.className = 'fixed z-[9999] pointer-events-none p-2 bg-[var(--bg-void)] border border-[var(--accent-amber)] text-[var(--text-primary)] font-mono text-[10px] tracking-wider uppercase select-none transition-opacity duration-100 opacity-0 shadow-none';
    tooltipEl.style.whiteSpace = 'normal';
    tooltipEl.style.overflowWrap = 'break-word';
    tooltipEl.style.wordBreak = 'break-word';
    document.body.appendChild(tooltipEl);
  }

  // Render Micro-HUD layout (Amber dot + Title in bold up, explanation down)
  tooltipEl.innerHTML = `
    <div class="flex items-center gap-1.5 leading-none">
      <span class="w-1.5 h-1.5 bg-[var(--accent-amber)] shrink-0 inline-block"></span>
      <span class="font-bold text-[var(--text-primary)] tracking-wider uppercase">${escapeHtml(title)}</span>
    </div>
    ${desc ? `<div class="text-[var(--text-secondary)] text-[9px] sm:text-[10px] tracking-normal normal-case leading-snug mt-1 pt-1 border-t border-[var(--line-hair)]/40">${escapeHtml(desc)}</div>` : ''}
  `;

  activeTarget = targetEl;

  // Play subtle horology tick
  playHorologyTick(1300, 0.01, 0.015);

  // Position relative to target
  positionTooltip(targetEl, tooltipEl);

  // Make visible
  tooltipEl.classList.remove('opacity-0');
  tooltipEl.classList.add('opacity-100');

  // Auto-dismiss after 3.2 seconds
  dismissTimer = setTimeout(() => {
    hideMicroTooltip();
  }, 3200);
}

/**
 * Hides and cleans up the active Micro-HUD tooltip.
 */
export function hideMicroTooltip() {
  if (dismissTimer) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }

  if (tooltipEl) {
    tooltipEl.classList.remove('opacity-100');
    tooltipEl.classList.add('opacity-0');
    setTimeout(() => {
      if (tooltipEl && tooltipEl.classList.contains('opacity-0')) {
        tooltipEl.remove();
        tooltipEl = null;
      }
    }, 120);
  }

  activeTarget = null;
}

/**
 * Initializes global event delegation for all `[data-tip]` elements.
 * Call once during application bootstrap.
 */
export function initMicroTooltips() {
  if (isInitialized || typeof window === 'undefined') return;
  isInitialized = true;

  // Global delegation on pointerdown (touch and mouse clicks)
  document.addEventListener('pointerdown', (e) => {
    const tipTarget = e.target.closest ? e.target.closest('[data-tip]') : null;
    if (tipTarget) {
      if (tipTarget === activeTarget && tooltipEl) {
        // Toggle off if touched again
        hideMicroTooltip();
      } else {
        showMicroTooltip(tipTarget);
      }
    } else {
      hideMicroTooltip();
    }
  }, { passive: true });

  // Mouse hover support for desktop
  document.addEventListener('mouseover', (e) => {
    // Only trigger on mouse pointers, not touch synthetic mouse events
    if (e.pointerType === 'touch') return;
    const tipTarget = e.target.closest ? e.target.closest('[data-tip]') : null;
    if (tipTarget && tipTarget !== activeTarget) {
      showMicroTooltip(tipTarget);
    }
  }, { passive: true });

  document.addEventListener('mouseout', (e) => {
    if (!activeTarget) return;
    const tipTarget = e.target.closest ? e.target.closest('[data-tip]') : null;
    if (tipTarget === activeTarget) {
      const related = e.relatedTarget ? (e.relatedTarget.closest ? e.relatedTarget.closest('[data-tip]') : null) : null;
      if (related !== activeTarget) {
        hideMicroTooltip();
      }
    }
  }, { passive: true });

  // Immediate dismiss on window scroll (capture phase catches any scrolling container)
  window.addEventListener('scroll', () => {
    if (activeTarget || tooltipEl) {
      hideMicroTooltip();
    }
  }, { capture: true, passive: true });

  // Dismiss on viewport resize
  window.addEventListener('resize', () => {
    if (activeTarget || tooltipEl) {
      hideMicroTooltip();
    }
  }, { passive: true });
}
