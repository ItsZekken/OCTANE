/**
 * OCTANE // KINETIC — Ghost Race Full-Screen Native Modal ("modal-ghost-race.js")
 * 
 * Embeds the high-framerate Ghost Race 2D canvas (/ghost-race.html) inside a native
 * full-screen container with precision horology styling:
 * - Top control bar: Brand, Recurrent Route Badge, and Close [ESC / ✕] trigger
 * - Smooth fade transitions and defensive lifecycle management
 * - Listens for window 'message' (OCTANE_CLOSE_GHOST_RACE) and 'Escape' key
 * - Recurrent Route Clustering Engine: Detects commute patterns by origin/dest (<= 300m)
 *   and departure window (+- 45 min).
 * 
 * Silencio Verbal Absoluto: Zero <p> tags, zero boxes inside boxes.
 */

import { playHorologyTick } from '../core/telemetry-engine.js';
import store from '../core/state.js';

let modalRootEl = null;
let isModalActive = false;
let boundMessageListener = null;
let boundKeyDownListener = null;

/**
 * Calculates Haversine distance in meters between two lat/lng coordinates.
 * 
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @returns {number} Distance in meters
 */
export function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth's mean radius in meters
    const toRad = Math.PI / 180;
    const dLat = (lat2 - lat1) * toRad;
    const dLon = (lon2 - lon1) * toRad;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Calculates absolute departure time difference in minutes between two times of day,
 * taking into account 24-hour circular wrap-around.
 * 
 * @param {number} minA - Minutes from midnight [0..1439]
 * @param {number} minB - Minutes from midnight [0..1439]
 * @returns {number} Difference in minutes [0..720]
 */
export function departureTimeDiffMinutes(minA, minB) {
    let diff = Math.abs(minA - minB);
    if (diff > 720) {
        diff = 1440 - diff;
    }
    return diff;
}

/**
 * Clusters point-to-point trips by origin and destination (<= 300m) and departure window (+- 45 min)
 * to detect habitual or recurrent routes (e.g. daily commute).
 * 
 * @param {Object|Array} [sourceTrips] - gpsCache.tripsByDate map or flat array of trip objects
 * @returns {Object|null} Recurrent route descriptor or null if no cluster with >= 2 trips found
 */
export function detectRecurrentRoute(sourceTrips = null) {
    let trips = [];

    if (Array.isArray(sourceTrips)) {
        trips = sourceTrips;
    } else if (sourceTrips && typeof sourceTrips === 'object') {
        for (const dayTrips of Object.values(sourceTrips)) {
            if (Array.isArray(dayTrips)) {
                for (const t of dayTrips) {
                    if (t) trips.push(t);
                }
            }
        }
    } else {
        try {
            const profile = store.getState()?.vehicleProfile;
            const tripsByDate = profile?.gpsCache?.tripsByDate || {};
            for (const dayTrips of Object.values(tripsByDate)) {
                if (Array.isArray(dayTrips)) {
                    for (const t of dayTrips) {
                        if (t) trips.push(t);
                    }
                }
            }
        } catch (_) {}
    }

    if (!trips || trips.length === 0) {
        return null;
    }

    // Extract normalized trip coordinates and departure minute
    const normalized = [];
    for (const t of trips) {
        let origLat = null, origLng = null, destLat = null, destLng = null;

        if (Array.isArray(t.trackPoints) && t.trackPoints.length > 0) {
            const first = t.trackPoints[0];
            const last = t.trackPoints[t.trackPoints.length - 1];
            origLat = Number(first.lat);
            origLng = Number(first.lng);
            destLat = Number(last.lat);
            destLng = Number(last.lng);
        } else if (Array.isArray(t.pts) && t.pts.length > 0) {
            const first = t.pts[0];
            const last = t.pts[t.pts.length - 1];
            origLat = Number(first[1]);
            origLng = Number(first[2]);
            destLat = Number(last[1]);
            destLng = Number(last[2]);
        } else if (t.startLat !== undefined && t.endLat !== undefined) {
            origLat = Number(t.startLat);
            origLng = Number(t.startLng);
            destLat = Number(t.endLat);
            destLng = Number(t.endLng);
        }

        if (origLat === null || destLat === null || isNaN(origLat) || isNaN(destLat)) {
            continue;
        }
        if (origLat === 0 && origLng === 0 && destLat === 0 && destLng === 0) {
            continue;
        }

        // Departure minute of the day [0..1439]
        let depMin = null;
        if (typeof t.startTimeHm === 'string' && t.startTimeHm.includes(':')) {
            const [h, m] = t.startTimeHm.split(':').map(Number);
            if (!isNaN(h) && !isNaN(m)) depMin = h * 60 + m;
        } else if (t.startTimeMs) {
            const d = new Date(Number(t.startTimeMs));
            depMin = d.getHours() * 60 + d.getMinutes();
        } else if (t.startSecOfDay !== undefined) {
            depMin = Math.round(Number(t.startSecOfDay) / 60);
        } else if (typeof t.startTime === 'string' && t.startTime.includes(':')) {
            const [h, m] = t.startTime.split(':').map(Number);
            if (!isNaN(h) && !isNaN(m)) depMin = h * 60 + m;
        }

        if (depMin === null || isNaN(depMin)) {
            continue;
        }

        normalized.push({
            rawTrip: t,
            origLat,
            origLng,
            destLat,
            destLng,
            depMin,
            startAddress: t.startAddress || t.rawStartAddress || '',
            endAddress: t.endAddress || t.rawEndAddress || '',
            distanceKm: Number(t.distanceKm ?? t.mileageKm ?? t.distKm) || 0
        });
    }

    if (normalized.length === 0) return null;

    // Cluster trips by origin/destination (<= 300m) and departure window (+- 45 min)
    const clusters = [];

    for (const item of normalized) {
        let matchedCluster = null;

        for (const cluster of clusters) {
            const origDist = calculateDistanceMeters(item.origLat, item.origLng, cluster.centroidOrig.lat, cluster.centroidOrig.lng);
            const destDist = calculateDistanceMeters(item.destLat, item.destLng, cluster.centroidDest.lat, cluster.centroidDest.lng);
            const timeDiff = departureTimeDiffMinutes(item.depMin, cluster.avgDepMin);

            if (origDist <= 300 && destDist <= 300 && timeDiff <= 45) {
                matchedCluster = cluster;
                break;
            }
        }

        if (matchedCluster) {
            const n = matchedCluster.items.length;
            matchedCluster.items.push(item);
            // Running average of centroid and departure time
            matchedCluster.centroidOrig.lat = (matchedCluster.centroidOrig.lat * n + item.origLat) / (n + 1);
            matchedCluster.centroidOrig.lng = (matchedCluster.centroidOrig.lng * n + item.origLng) / (n + 1);
            matchedCluster.centroidDest.lat = (matchedCluster.centroidDest.lat * n + item.destLat) / (n + 1);
            matchedCluster.centroidDest.lng = (matchedCluster.centroidDest.lng * n + item.destLng) / (n + 1);
            matchedCluster.avgDepMin = Math.round((matchedCluster.avgDepMin * n + item.depMin) / (n + 1));
            if (!matchedCluster.startAddress && item.startAddress) matchedCluster.startAddress = item.startAddress;
            if (!matchedCluster.endAddress && item.endAddress) matchedCluster.endAddress = item.endAddress;
        } else {
            clusters.push({
                items: [item],
                centroidOrig: { lat: item.origLat, lng: item.origLng },
                centroidDest: { lat: item.destLat, lng: item.destLng },
                avgDepMin: item.depMin,
                startAddress: item.startAddress,
                endAddress: item.endAddress
            });
        }
    }

    // Filter clusters with >= 2 trips (recurrence)
    const recurrentClusters = clusters
        .filter(c => c.items.length >= 2)
        .sort((a, b) => b.items.length - a.items.length);

    if (recurrentClusters.length === 0) {
        return null;
    }

    const best = recurrentClusters[0];
    const formatHm = (minutes) => {
        const norm = ((minutes % 1440) + 1440) % 1440;
        const h = String(Math.floor(norm / 60)).padStart(2, '0');
        const m = String(norm % 60).padStart(2, '0');
        return `${h}:${m}`;
    };

    const startLabel = best.startAddress || 'Origen habitual';
    const endLabel = best.endAddress || 'Destino habitual';
    const name = `${startLabel} ➔ ${endLabel}`;

    const totalDist = best.items.reduce((acc, x) => acc + x.distanceKm, 0);
    const avgDist = Number((totalDist / best.items.length).toFixed(2));

    return {
        id: `recurrent_${best.items[0].rawTrip.id || Date.now()}`,
        name,
        startAddress: startLabel,
        endAddress: endLabel,
        origin: {
            lat: Number(best.centroidOrig.lat.toFixed(6)),
            lng: Number(best.centroidOrig.lng.toFixed(6))
        },
        destination: {
            lat: Number(best.centroidDest.lat.toFixed(6)),
            lng: Number(best.centroidDest.lng.toFixed(6))
        },
        departureWindow: `${formatHm(best.avgDepMin - 45)} - ${formatHm(best.avgDepMin + 45)}`,
        avgDepartureHm: formatHm(best.avgDepMin),
        tripsCount: best.items.length,
        avgDistanceKm: avgDist,
        tripIds: best.items.map(x => x.rawTrip.id || x.rawTrip.startTimeMs),
        detectedAt: new Date().toISOString()
    };
}

/**
 * Initializes the root DOM container singleton for the modal.
 */
function initModalRoot() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('octane-ghost-race-modal')) {
        modalRootEl = document.getElementById('octane-ghost-race-modal');
        return;
    }

    modalRootEl = document.createElement('div');
    modalRootEl.id = 'octane-ghost-race-modal';
    modalRootEl.className = 'fixed inset-0 z-50 hidden bg-[#09090B] flex flex-col overflow-hidden text-[#F4F4F6] select-none transition-opacity duration-200 opacity-0';
    document.body.appendChild(modalRootEl);
}

/**
 * Handles incoming postMessage from iframe.
 */
function handleWindowMessage(e) {
    if (e.data && e.data.type === 'OCTANE_CLOSE_GHOST_RACE') {
        closeGhostRaceModal();
    }
}

/**
 * Handles Escape key press on parent window.
 */
function handleKeyDown(e) {
    if (e.key === 'Escape' && isModalActive) {
        e.preventDefault();
        e.stopPropagation();
        closeGhostRaceModal();
    }
}

/**
 * Opens the Ghost Race full-screen modal.
 * 
 * @param {Object} [options={}] - Optional parameters { route }
 */
export function openGhostRaceModal(options = {}) {
    if (typeof document === 'undefined') return;
    initModalRoot();
    if (!modalRootEl) return;

    try {
        playHorologyTick(1200, 0.015, 0.03);
    } catch (_) {}

    // Retrieve active recurrent route from options, localStorage, or fallback
    let activeRoute = options.route || null;
    if (!activeRoute) {
        try {
            const raw = localStorage.getItem('octane_active_ghost_race');
            if (raw) activeRoute = JSON.parse(raw);
        } catch (_) {}
    }

    const routeTitle = activeRoute?.name || 'LA CEIBA ➔ UNINORTE';
    const routeCount = activeRoute?.tripsCount ? `${activeRoute.tripsCount} VUELTAS` : '84 TRAYECTOS';

    modalRootEl.innerHTML = `
        <header class="h-11 sm:h-12 bg-[#0E0E11] border-b border-[#1E1E24] px-3 sm:px-4 flex items-center justify-between shrink-0 select-none z-30">
            <div class="flex items-center gap-2.5 min-w-0">
                <div class="w-2 h-2 rounded-full bg-[#F59E0B] shadow-[0_0_8px_rgba(245,158,11,0.6)]"></div>
                <div class="flex items-baseline gap-2 min-w-0">
                    <span class="text-xs font-mono font-bold tracking-widest text-[#F59E0B]">OCTANE</span>
                    <span class="text-[11px] text-[#8A8A93] font-mono hidden xs:inline tracking-wider">GHOST RACE</span>
                </div>
            </div>

            <div id="ghost-race-recurrent-badge" class="flex items-center gap-1.5 px-2.5 py-0.5 sm:py-1 rounded-full bg-[#141418] border border-[#1E1E24] text-[10px] font-mono truncate max-w-[55%] sm:max-w-none">
                <span class="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse shrink-0"></span>
                <span class="text-[#F4F4F6] font-semibold uppercase tracking-wider truncate">${routeTitle}</span>
                <span class="text-[#8A8A93] text-[9px] uppercase tracking-wider hidden sm:inline">· ${routeCount}</span>
            </div>

            <button id="ghost-race-modal-close" class="h-7 px-2 sm:px-2.5 rounded-full bg-[#141418] border border-[#1E1E24] hover:border-[#EF4444] text-[10px] sm:text-[11px] font-mono text-[#8A8A93] hover:text-[#EF4444] transition-colors flex items-center gap-1.5 cursor-pointer shrink-0" title="Cerrar [ESC]">
                <span class="text-[9px] tracking-wider opacity-60 hidden sm:inline">ESC</span>
                <span class="font-bold">✕</span>
            </button>
        </header>

        <div class="relative flex-1 w-full min-h-0 bg-[#09090B]">
            <iframe id="ghost-race-iframe" src="/ghost-race.html" class="w-full h-full border-0 block" allow="accelerometer; gyroscope"></iframe>
        </div>
    `;

    const closeBtn = modalRootEl.querySelector('#ghost-race-modal-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            closeGhostRaceModal();
        });
    }

    if (!boundMessageListener) {
        boundMessageListener = handleWindowMessage;
        window.addEventListener('message', boundMessageListener);
    }

    if (!boundKeyDownListener) {
        boundKeyDownListener = handleKeyDown;
        window.addEventListener('keydown', boundKeyDownListener);
    }

    // Smooth entry transition
    modalRootEl.classList.remove('hidden');
    requestAnimationFrame(() => {
        modalRootEl.classList.remove('opacity-0');
        modalRootEl.classList.add('opacity-100');
    });

    isModalActive = true;
}

/**
 * Closes and resets the Ghost Race modal smoothly.
 */
export function closeGhostRaceModal() {
    if (!isModalActive && (!modalRootEl || modalRootEl.classList.contains('hidden'))) {
        return;
    }

    try {
        playHorologyTick(800, 0.01, 0.02);
    } catch (_) {}

    isModalActive = false;

    if (modalRootEl) {
        modalRootEl.classList.remove('opacity-100');
        modalRootEl.classList.add('opacity-0');

        setTimeout(() => {
            if (modalRootEl) {
                modalRootEl.classList.add('hidden');
                // Clear iframe src to release resources and stop background canvas rendering
                const iframe = modalRootEl.querySelector('#ghost-race-iframe');
                if (iframe) {
                    iframe.src = 'about:blank';
                }
                modalRootEl.innerHTML = '';
            }
        }, 220);
    }

    if (boundMessageListener) {
        window.removeEventListener('message', boundMessageListener);
        boundMessageListener = null;
    }

    if (boundKeyDownListener) {
        window.removeEventListener('keydown', boundKeyDownListener);
        boundKeyDownListener = null;
    }
}
