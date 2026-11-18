/**
 * OCTANE // KINETIC — Trip Detail Compatibility Bridge
 * 
 * Journey inspection is now seamlessly unified inside modal-gps-trips.js (Level 2).
 * This module preserves openTripDetailModal and closeTripDetailModal signatures for backwards compatibility.
 */

import { openGpsTripsModal, closeGpsTripsModal } from './modal-gps-trips.js';

export function openTripDetailModal(trip, options = {}) {
    // Delegates to unified modal
    openGpsTripsModal({ initialScope: 'cycle', ...options });
}

export function closeTripDetailModal() {
    closeGpsTripsModal();
}
