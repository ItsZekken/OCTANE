/**
 * OCTANE // KINETIC — Billetera y Deducciones Operativas (Agnóstica de Plataformas)
 * Elimina toda jerga quemada de DiDi / InDrive y cajas fijas.
 * Las plataformas son chips definidos y gestionados por el usuario.
 */

import { openRideEntryModal } from '../modals/modal-ride-entry.js';

/**
 * Agnostic wallet strip (no fixed platform boxes).
 * Can render custom deductions summary or be safely omitted.
 */
export function renderWalletPassesStrip(container, options = {}) {
  if (!container) return;
  // Agnostic design: No hardcoded platform boxes.
  container.innerHTML = '';
}

export function initWalletPassModalRoot() {
  return null;
}

export function closeWalletPassModal() {}

export function openWalletPassModal(options = {}) {
  openRideEntryModal({ mode: 'expense', ...options });
}
