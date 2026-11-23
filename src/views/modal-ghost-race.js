/**
 * OCTANE // KINETIC — Ghost Race Full-Screen Native Modal ("modal-ghost-race.js")
 * 
 * Embeds the high-framerate Ghost Race 2D canvas (/ghost-race.html) inside a native
 * full-screen container with precision horology styling:
 * - Smooth fade transitions and defensive lifecycle management
 * - Listens for window 'message' (OCTANE_CLOSE_GHOST_RACE, OCTANE_GHOST_RACE_READY) and 'Escape' key
 * - Recurrent Route Clustering Engine: Detects commute patterns by origin/dest (<= 300m)
 *   and departure window (+- 45 min).
 */

import { playHorologyTick } from '../core/telemetry-engine.js';
import store from '../core/state.js';

let modalRootEl = null;
let isModalActive = false;
let boundMessageListener = null;
let boundKeyDownListener = null;
let boundStateListener = null;
let pendingInitPayload = null;
let hasSentInitPayload = false;

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
    modalRootEl.className = 'fixed inset-0 z-50 hidden bg-[var(--bg-void)] flex flex-col overflow-hidden text-[var(--text-primary)] select-none transition-all duration-200 opacity-0';
    document.body.appendChild(modalRootEl);
}

/**
 * Resolves the active OCTANE theme ('dark' | 'light').
 */
function resolveCurrentTheme() {
    if (typeof document !== 'undefined') {
        const attr = document.documentElement.getAttribute('data-theme');
        if (attr === 'light' || attr === 'dark') return attr;
    }
    try {
        const stored = store.getState()?.theme;
        if (stored === 'light' || stored === 'dark') return stored;
    } catch (_) {}
    return 'dark';
}

/**
 * Extracts normalized dynamic Ghost Race trips from gpsCache when a user's
 * recurrent route has at least 3 complete GPS tracks (>= 10 points each).
 */
function extractRecurrentDynamicTrips(activeRoute) {
    if (!activeRoute || !Array.isArray(activeRoute.tripIds) || activeRoute.tripIds.length < 3) {
        return null;
    }
    try {
        const profile = store.getState()?.vehicleProfile;
        const tripsByDate = profile?.gpsCache?.tripsByDate;
        if (!tripsByDate || typeof tripsByDate !== 'object') return null;

        const idSet = new Set(activeRoute.tripIds.map(String));
        const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
        const normalized = [];

        for (const [dateKey, dayTrips] of Object.entries(tripsByDate)) {
            if (!Array.isArray(dayTrips)) continue;
            for (const t of dayTrips) {
                if (!t) continue;
                const tid = String(t.id || t.startTimeMs || '');
                if (!idSet.has(tid)) continue;
                if (!Array.isArray(t.trackPoints) || t.trackPoints.length < 10) continue;

                const firstPt = t.trackPoints[0];
                const lastPt = t.trackPoints[t.trackPoints.length - 1];
                const t0 = Number(firstPt.time || firstPt.gpsTime || t.startTimeMs || 0);
                const tEnd = Number(lastPt.time || lastPt.gpsTime || t.endTimeMs || 0);
                const isMs = t0 > 1e11;
                const div = isMs ? 1000 : 1;
                const durationSec = Math.max(60, Math.round((tEnd - t0) / div) || Number(t.durationSec) || 0);
                if (durationSec <= 0) continue;

                const pts = [];
                let maxSpeed = 0;
                for (const p of t.trackPoints) {
                    const lat = Number(p.lat);
                    const lng = Number(p.lng);
                    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
                    const ptTime = Number(p.time || p.gpsTime || t0);
                    const rel = Math.max(0, Math.round((ptTime - t0) / div));
                    const spd = Math.max(0, Math.round(Number(p.speed) || 0));
                    const dir = Math.round(Number(p.course ?? p.heading ?? p.dir) || 0);
                    if (spd > maxSpeed) maxSpeed = spd;
                    pts.push([rel, lat, lng, spd, dir]);
                }
                if (pts.length < 10) continue;

                const dObj = new Date(`${dateKey}T12:00:00`);
                const startDateObj = t.startTimeMs ? new Date(Number(t.startTimeMs)) : null;
                const startSecOfDay = startDateObj
                    ? startDateObj.getHours() * 3600 + startDateObj.getMinutes() * 60 + startDateObj.getSeconds()
                    : 26100;
                const startHm = t.startTimeHm || (startDateObj
                    ? `${String(startDateObj.getHours()).padStart(2, '0')}:${String(startDateObj.getMinutes()).padStart(2, '0')}`
                    : '07:15');
                const distKm = Number((Number(t.distanceKm ?? t.mileageKm ?? 0)).toFixed(2));

                normalized.push({
                    id: tid,
                    date: t.date || dateKey,
                    dayName: Number.isNaN(dObj.getTime()) ? '' : dayNames[dObj.getDay()],
                    startTime: startHm,
                    startSecOfDay,
                    endSecOfDay: startSecOfDay + durationSec,
                    durationSec,
                    durationMin: Number((durationSec / 60).toFixed(1)),
                    distKm,
                    avgSpeed: durationSec > 0 && distKm > 0 ? Number(((distKm / durationSec) * 3600).toFixed(1)) : 0,
                    maxSpeed,
                    routeType: t.routeType || 'Ruta habitual',
                    pts
                });
            }
        }

        if (normalized.length < 3) return null;
        normalized.sort((a, b) => a.durationSec - b.durationSec);
        normalized.forEach((t, idx) => { t.rank = idx + 1; });
        return normalized;
    } catch (_) {
        return null;
    }
}

/**
 * Dispatches the initial payload to the Ghost Race iframe once per session.
 */
function postInitPayloadToIframe() {
    if (hasSentInitPayload || !pendingInitPayload || !modalRootEl) return;
    const iframe = modalRootEl.querySelector('#ghost-race-iframe');
    if (!iframe?.contentWindow) return;
    try {
        iframe.contentWindow.postMessage(pendingInitPayload, '*');
        hasSentInitPayload = true;
        iframe.contentWindow.focus?.();
    } catch (_) {}
}

/**
 * Handles incoming postMessage from iframe.
 */
function handleWindowMessage(e) {
    if (!e.data || typeof e.data !== 'object') return;
    if (e.data.type === 'OCTANE_CLOSE_GHOST_RACE') {
        closeGhostRaceModal();
    } else if (e.data.type === 'OCTANE_GHOST_RACE_READY') {
        postInitPayloadToIframe();
    }
}

/**
 * Forwards runtime theme changes while the modal is open.
 */
function handleStateUpdate(e) {
    const nextTheme = e?.detail?.theme;
    if ((nextTheme === 'light' || nextTheme === 'dark') && modalRootEl && isModalActive) {
        const iframe = modalRootEl.querySelector('#ghost-race-iframe');
        try {
            iframe?.contentWindow?.postMessage({ type: 'OCTANE_THEME_CHANGE', theme: nextTheme }, '*');
        } catch (_) {}
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
 * Opens the Ghost Race full-screen modal (edge-to-edge, single unified chrome).
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

    const theme = resolveCurrentTheme();

    // Retrieve active recurrent route from options or localStorage
    let activeRoute = options.route || null;
    if (!activeRoute) {
        try {
            const raw = localStorage.getItem('octane_active_ghost_race');
            if (raw) activeRoute = JSON.parse(raw);
        } catch (_) {}
    }

    const dynamicTrips = extractRecurrentDynamicTrips(activeRoute);
    const iframeSrc = `/ghost-race.html?theme=${encodeURIComponent(theme)}`;

    hasSentInitPayload = false;
    pendingInitPayload = {
        type: 'OCTANE_GHOST_RACE_INIT',
        theme,
        route: dynamicTrips ? {
            name: activeRoute?.name || 'RUTA HABITUAL',
            startLabel: activeRoute?.startAddress || 'ORIGEN',
            endLabel: activeRoute?.endAddress || 'DESTINO'
        } : null,
        trips: dynamicTrips
    };

    modalRootEl.innerHTML = `
        <div class="relative flex-1 w-full h-full min-h-0 bg-[var(--bg-void)]">
            <iframe
                id="ghost-race-iframe"
                src="${iframeSrc}"
                class="w-full h-full border-0 block"
                title="OCTANE Ghost Race"
                allow="accelerometer; gyroscope"
            ></iframe>
        </div>
    `;

    const iframe = modalRootEl.querySelector('#ghost-race-iframe');
    if (iframe) {
        iframe.addEventListener('load', () => {
            postInitPayloadToIframe();
        }, { once: true });
    }

    if (!boundMessageListener) {
        boundMessageListener = handleWindowMessage;
        window.addEventListener('message', boundMessageListener);
    }

    if (!boundKeyDownListener) {
        boundKeyDownListener = handleKeyDown;
        window.addEventListener('keydown', boundKeyDownListener);
    }

    if (!boundStateListener) {
        boundStateListener = handleStateUpdate;
        window.addEventListener('octane:update-state', boundStateListener);
    }

    // Lock background scroll while full-screen instrument is active
    try {
        document.documentElement.style.overflow = 'hidden';
    } catch (_) {}

    // Smooth entry transition
    modalRootEl.classList.remove('hidden');
    modalRootEl.style.transform = 'scale(0.992)';
    requestAnimationFrame(() => {
        modalRootEl.classList.remove('opacity-0');
        modalRootEl.classList.add('opacity-100');
        modalRootEl.style.transform = 'scale(1)';
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
    pendingInitPayload = null;
    hasSentInitPayload = false;

    try {
        document.documentElement.style.overflow = '';
    } catch (_) {}

    if (modalRootEl) {
        modalRootEl.classList.remove('opacity-100');
        modalRootEl.classList.add('opacity-0');
        modalRootEl.style.transform = 'scale(0.992)';

        setTimeout(() => {
            if (modalRootEl && !isModalActive) {
                modalRootEl.classList.add('hidden');
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

    if (boundStateListener) {
        window.removeEventListener('octane:update-state', boundStateListener);
        boundStateListener = null;
    }
}
