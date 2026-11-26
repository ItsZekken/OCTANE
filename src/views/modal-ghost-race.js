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
import { getVehicleProfile, getCanonicalTripKey, mergeTripsByDateMaps } from '../core/db-local.js';
import { backfillMissingGpsTrips, getGpsConfig } from '../core/iopgps-sync.js';

export const GHOST_RACE_CORRIDOR_RADIUS_M = 450;
export const GHOST_RACE_DEPARTURE_WINDOW_MIN = 90;

let modalRootEl = null;
let isModalActive = false;
let boundMessageListener = null;
let boundKeyDownListener = null;
let boundStateListener = null;
let pendingInitPayload = null;
let hasSentInitPayload = false;
let openSessionToken = 0;

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

function parseTripEndpointsAndDeparture(t) {
    if (!t || typeof t !== 'object') return null;

    let origLat = null, origLng = null, destLat = null, destLng = null;
    let trackCount = 0;

    if (Array.isArray(t.trackPoints) && t.trackPoints.length > 0) {
        const first = t.trackPoints[0];
        const last = t.trackPoints[t.trackPoints.length - 1];
        origLat = Number(first.lat);
        origLng = Number(first.lng);
        destLat = Number(last.lat);
        destLng = Number(last.lng);
        trackCount = t.trackPoints.length;
    } else if (Array.isArray(t.pts) && t.pts.length > 0) {
        const first = t.pts[0];
        const last = t.pts[t.pts.length - 1];
        origLat = Number(first[1]);
        origLng = Number(first[2]);
        destLat = Number(last[1]);
        destLng = Number(last[2]);
        trackCount = t.pts.length;
    } else if (t.startLat !== undefined && t.endLat !== undefined) {
        origLat = Number(t.startLat);
        origLng = Number(t.startLng);
        destLat = Number(t.endLat);
        destLng = Number(t.endLng);
    }

    if (origLat === null || destLat === null || isNaN(origLat) || isNaN(destLat) || isNaN(origLng) || isNaN(destLng)) {
        return null;
    }
    if (origLat === 0 && origLng === 0 && destLat === 0 && destLng === 0) {
        return null;
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
        return null;
    }

    return {
        origLat,
        origLng,
        destLat,
        destLng,
        depMin,
        trackCount,
        startAddress: t.startAddress || t.rawStartAddress || '',
        endAddress: t.endAddress || t.rawEndAddress || '',
        distanceKm: Number(t.distanceKm ?? t.mileageKm ?? t.distKm) || 0
    };
}

/**
 * Clusters point-to-point trips by origin and destination (<= 450m) and departure window (+- 90 min)
 * across the entire accumulated GPS history to detect habitual or recurrent routes (e.g. daily commute).
 *
 * @param {Object|Array} [sourceTrips] - gpsCache.tripsByDate map or flat array of trip objects
 * @param {Object} [options={}] - { radiusMeters, departureWindowMin, minTrackPoints }
 * @returns {Object|null} Recurrent route descriptor or null if no cluster with >= 2 trips found
 */
export function detectRecurrentRoute(sourceTrips = null, options = {}) {
    const radiusMeters = Number(options.radiusMeters) > 0 ? Number(options.radiusMeters) : GHOST_RACE_CORRIDOR_RADIUS_M;
    const depWindowMin = Number(options.departureWindowMin) > 0 ? Number(options.departureWindowMin) : GHOST_RACE_DEPARTURE_WINDOW_MIN;
    const minTrackPoints = Math.max(0, Number(options.minTrackPoints) || 0);

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

    // Deduplicate across all dates (preferring the version with richest trackPoints)
    const deduped = new Map();
    for (const t of trips) {
        if (!t || typeof t !== 'object') continue;
        const key = getCanonicalTripKey(t) || String(t.id || t.startTimeMs || Math.random());
        const prev = deduped.get(key);
        const prevPts = Array.isArray(prev?.trackPoints) ? prev.trackPoints.length : (Array.isArray(prev?.pts) ? prev.pts.length : 0);
        const curPts = Array.isArray(t.trackPoints) ? t.trackPoints.length : (Array.isArray(t.pts) ? t.pts.length : 0);
        if (!prev || curPts > prevPts) {
            deduped.set(key, t);
        }
    }

    // Extract normalized trip coordinates and departure minute
    const normalized = [];
    for (const t of deduped.values()) {
        const parsed = parseTripEndpointsAndDeparture(t);
        if (!parsed) continue;
        if (minTrackPoints > 0 && parsed.trackCount < minTrackPoints) continue;
        normalized.push({
            rawTrip: t,
            ...parsed
        });
    }

    if (normalized.length === 0) return null;

    // Sort chronologically so centroid formation is deterministic across all cycles
    normalized.sort((a, b) => (Number(a.rawTrip.startTimeMs) || 0) - (Number(b.rawTrip.startTimeMs) || 0));

    // Cluster trips by origin/destination (<= radiusMeters) and departure window (+- depWindowMin)
    const clusters = [];

    for (const item of normalized) {
        let matchedCluster = null;
        let bestScore = Infinity;

        for (const cluster of clusters) {
            const origDist = calculateDistanceMeters(item.origLat, item.origLng, cluster.centroidOrig.lat, cluster.centroidOrig.lng);
            const destDist = calculateDistanceMeters(item.destLat, item.destLng, cluster.centroidDest.lat, cluster.centroidDest.lng);
            const timeDiff = departureTimeDiffMinutes(item.depMin, cluster.avgDepMin);

            if (origDist <= radiusMeters && destDist <= radiusMeters && timeDiff <= depWindowMin) {
                const score = origDist + destDist + timeDiff * 3;
                if (score < bestScore) {
                    bestScore = score;
                    matchedCluster = cluster;
                }
            }
        }

        if (matchedCluster) {
            const n = matchedCluster.items.length;
            matchedCluster.items.push(item);
            if (item.trackCount >= 10) matchedCluster.playableCount++;
            // Running average of centroid and circular-safe departure time
            matchedCluster.centroidOrig.lat = (matchedCluster.centroidOrig.lat * n + item.origLat) / (n + 1);
            matchedCluster.centroidOrig.lng = (matchedCluster.centroidOrig.lng * n + item.origLng) / (n + 1);
            matchedCluster.centroidDest.lat = (matchedCluster.centroidDest.lat * n + item.destLat) / (n + 1);
            matchedCluster.centroidDest.lng = (matchedCluster.centroidDest.lng * n + item.destLng) / (n + 1);
            let deltaMin = item.depMin - matchedCluster.avgDepMin;
            if (deltaMin > 720) deltaMin -= 1440;
            if (deltaMin < -720) deltaMin += 1440;
            matchedCluster.avgDepMin = Math.round(((matchedCluster.avgDepMin + deltaMin / (n + 1)) % 1440 + 1440) % 1440);
            if (!matchedCluster.startAddress && item.startAddress) matchedCluster.startAddress = item.startAddress;
            if (!matchedCluster.endAddress && item.endAddress) matchedCluster.endAddress = item.endAddress;
        } else {
            clusters.push({
                items: [item],
                playableCount: item.trackCount >= 10 ? 1 : 0,
                centroidOrig: { lat: item.origLat, lng: item.origLng },
                centroidDest: { lat: item.destLat, lng: item.destLng },
                avgDepMin: item.depMin,
                startAddress: item.startAddress,
                endAddress: item.endAddress
            });
        }
    }

    // Filter clusters with >= 2 trips (recurrence); prefer clusters with most playable GPS tracks
    const recurrentClusters = clusters
        .filter(c => c.items.length >= 2)
        .sort((a, b) => {
            if (b.playableCount !== a.playableCount) return b.playableCount - a.playableCount;
            return b.items.length - a.items.length;
        });

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
        departureWindow: `${formatHm(best.avgDepMin - depWindowMin)} - ${formatHm(best.avgDepMin + depWindowMin)}`,
        avgDepartureHm: formatHm(best.avgDepMin),
        tripsCount: best.items.length,
        playableTripsCount: best.playableCount,
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
 * Extracts ALL normalized dynamic Ghost Race trips across the entire accumulated `tripsByDate`
 * archive matching a recurrent route (by trip ID OR spatial+temporal corridor match),
 * deduplicated by canonical trip key so past cycles continuously accumulate.
 *
 * @param {Object|null} [activeRoute=null]
 * @param {Object|null} [tripsByDateOverride=null]
 * @returns {Array<Object>|null}
 */
export function extractRecurrentDynamicTrips(activeRoute = null, tripsByDateOverride = null) {
    try {
        const profile = store.getState()?.vehicleProfile;
        const tripsByDate = tripsByDateOverride || profile?.gpsCache?.tripsByDate;
        if (!tripsByDate || typeof tripsByDate !== 'object') return null;

        const route = activeRoute || detectRecurrentRoute(tripsByDate, { minTrackPoints: 10 });
        if (!route) return null;

        const idSet = new Set(Array.isArray(route.tripIds) ? route.tripIds.map(String) : []);
        const hasGeoCorridor = Boolean(
            route.origin && route.destination &&
            Number.isFinite(Number(route.origin.lat)) && Number.isFinite(Number(route.origin.lng)) &&
            Number.isFinite(Number(route.destination.lat)) && Number.isFinite(Number(route.destination.lng))
        );
        let routeDepMin = null;
        if (typeof route.avgDepartureHm === 'string' && route.avgDepartureHm.includes(':')) {
            const [rh, rm] = route.avgDepartureHm.split(':').map(Number);
            if (!isNaN(rh) && !isNaN(rm)) routeDepMin = rh * 60 + rm;
        }

        const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
        const seenKeys = new Set();
        const normalized = [];

        for (const [dateKey, dayTrips] of Object.entries(tripsByDate)) {
            if (!Array.isArray(dayTrips)) continue;
            for (const t of dayTrips) {
                if (!t || !Array.isArray(t.trackPoints) || t.trackPoints.length < 10) continue;

                const tid = String(t.id || t.startTimeMs || '');
                const startMsStr = t.startTimeMs ? String(t.startTimeMs) : '';
                let matches = idSet.has(tid) || (startMsStr && idSet.has(startMsStr));

                if (!matches && hasGeoCorridor) {
                    const parsed = parseTripEndpointsAndDeparture(t);
                    if (parsed) {
                        const origDist = calculateDistanceMeters(parsed.origLat, parsed.origLng, Number(route.origin.lat), Number(route.origin.lng));
                        const destDist = calculateDistanceMeters(parsed.destLat, parsed.destLng, Number(route.destination.lat), Number(route.destination.lng));
                        const timeOk = routeDepMin === null || departureTimeDiffMinutes(parsed.depMin, routeDepMin) <= GHOST_RACE_DEPARTURE_WINDOW_MIN;
                        if (origDist <= GHOST_RACE_CORRIDOR_RADIUS_M && destDist <= GHOST_RACE_CORRIDOR_RADIUS_M && timeOk) {
                            matches = true;
                        }
                    }
                }

                if (!matches) continue;

                const dedupeKey = getCanonicalTripKey(t) || tid;
                if (seenKeys.has(dedupeKey)) continue;
                seenKeys.add(dedupeKey);

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

                const resolvedDate = String(t.date || dateKey).slice(0, 10);
                const dObj = new Date(`${resolvedDate}T12:00:00`);
                const startDateObj = t.startTimeMs ? new Date(Number(t.startTimeMs)) : null;

                let startSecOfDay = 26100;
                if (startDateObj && !Number.isNaN(startDateObj.getTime())) {
                    startSecOfDay = startDateObj.getHours() * 3600 + startDateObj.getMinutes() * 60 + startDateObj.getSeconds();
                } else if (typeof t.startTimeHm === 'string' && t.startTimeHm.includes(':')) {
                    const [hh, mm] = t.startTimeHm.split(':').map(Number);
                    if (!isNaN(hh) && !isNaN(mm)) startSecOfDay = hh * 3600 + mm * 60;
                }

                const startHm = t.startTimeHm || (startDateObj && !Number.isNaN(startDateObj.getTime())
                    ? `${String(startDateObj.getHours()).padStart(2, '0')}:${String(startDateObj.getMinutes()).padStart(2, '0')}`
                    : '07:15');
                const distKm = Number((Number(t.distanceKm ?? t.mileageKm ?? 0)).toFixed(2));

                normalized.push({
                    id: tid || dedupeKey,
                    date: resolvedDate,
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
 * Always reads the full accumulated GPS trip archive from IndexedDB + store so
 * all past cycles/months accumulate automatically instead of freezing on one cycle.
 *
 * @param {Object} [options={}] - Optional parameters { route }
 */
export async function openGhostRaceModal(options = {}) {
    if (typeof document === 'undefined') return;
    initModalRoot();
    if (!modalRootEl) return;

    const sessionToken = ++openSessionToken;

    try {
        playHorologyTick(1200, 0.015, 0.03);
    } catch (_) {}

    const theme = resolveCurrentTheme();

    // Merge freshest IndexedDB profile with reactive store so zero accumulated trips are missed
    const storeProfile = store.getState()?.vehicleProfile || null;
    const dbProfile = await getVehicleProfile().catch(() => null);
    if (sessionToken !== openSessionToken) return;

    const tripsByDate = mergeTripsByDateMaps(
        storeProfile?.gpsCache?.tripsByDate,
        dbProfile?.gpsCache?.tripsByDate
    );

    // Re-scan the entire accumulated trip archive (or use explicit caller route while still matching all accumulated trips)
    let activeRoute = options.route || detectRecurrentRoute(tripsByDate, { minTrackPoints: 10 });
    if (!activeRoute) {
        activeRoute = detectRecurrentRoute(tripsByDate);
    }

    try {
        if (activeRoute) {
            localStorage.setItem('octane_active_ghost_race', JSON.stringify(activeRoute));
        } else {
            localStorage.removeItem('octane_active_ghost_race');
        }
    } catch (_) {}

    const dynamicTrips = extractRecurrentDynamicTrips(activeRoute, tripsByDate);
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

    // Quietly ensure any remaining unarchived past days continue accumulating in IndexedDB
    try {
        const cfg = getGpsConfig(dbProfile || storeProfile);
        if (cfg.enabled && cfg.imei) {
            backfillMissingGpsTrips({ silent: true }).catch(() => {});
        }
    } catch (_) {}
}

/**
 * Closes and resets the Ghost Race modal smoothly.
 */
export function closeGhostRaceModal() {
    openSessionToken++;
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
