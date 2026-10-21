/**
 * OCTANE // KINETIC — Bridge / Re-export to Unified Movement Log
 */

import { renderRideSessionLog, normalizeMovements, initRideSessionLog } from './ride-session-log.js';

export { renderRideSessionLog, normalizeMovements, initRideSessionLog };

/**
 * Backward compatibility alias for renderRideSessionList
 */
export async function renderRideSessionList(container, options = {}) {
  return renderRideSessionLog(container, options);
}

export function initRideSessionList() {
  return initRideSessionLog();
}
