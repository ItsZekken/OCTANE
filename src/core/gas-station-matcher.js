/**
 * OCTANE // KINETIC — Gas Station Geofence Matcher & Learning Engine
 * 
 * Industrial, Zero-Overhead Geofencing Engine:
 * - Learns gas station locations automatically from refueling events.
 * - Clusters nearby stops within 80m into existing stations using weighted running average.
 * - Detects vehicle stops (duration >= 120s) within 60m radius of learned stations.
 * - Dispatches low-friction PWA / browser notifications with unique stopId tags to prevent duplicate alerts.
 * - Silencio Verbal Absoluto: Zero paragraph HTML tags, zero technical noise.
 */

const EARTH_RADIUS_METERS = 6371000;

/**
 * Calculates great-circle distance between two geographic coordinates using the Haversine formula.
 * @param {number} lat1 
 * @param {number} lon1 
 * @param {number} lat2 
 * @param {number} lon2 
 * @returns {number} Distance in meters
 */
export function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const rLat1 = toRad(lat1);
  const rLat2 = toRad(lat2);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rLat1) * Math.cos(rLat2) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

/**
 * Learns or updates a gas station geofence in the vehicle profile.
 * If coords are within 80m of an existing station, increments refuelCount
 * and applies a weighted running average to lat/lng. Otherwise, creates a new station.
 * 
 * @param {Object} profile - Vehicle profile containing learnedGasStations array
 * @param {Object|Array} coords - { lat, lng } or { latitude, longitude } or [lat, lng]
 * @param {string} [name] - Station name label
 * @returns {Object|null} The learned or updated station object
 */
export function learnGasStation(profile, coords, name) {
  if (!profile) return null;

  if (!Array.isArray(profile.learnedGasStations)) {
    profile.learnedGasStations = [];
  }

  let lat = null;
  let lng = null;

  if (Array.isArray(coords)) {
    lat = Number(coords[0]);
    lng = Number(coords[1]);
  } else if (coords && typeof coords === 'object') {
    lat = Number(coords.lat ?? coords.latitude);
    lng = Number(coords.lng ?? coords.longitude ?? coords.lon);
  }

  if (lat === null || lng === null || isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) {
    return null;
  }

  // Find closest existing station within 80m threshold
  let closestStation = null;
  let minDistance = Infinity;

  for (const station of profile.learnedGasStations) {
    const sLat = Number(station.lat ?? station.latitude);
    const sLng = Number(station.lng ?? station.longitude);
    if (isNaN(sLat) || isNaN(sLng)) continue;

    const dist = calculateDistanceMeters(lat, lng, sLat, sLng);
    if (dist <= 80 && dist < minDistance) {
      minDistance = dist;
      closestStation = station;
    }
  }

  const nowIso = new Date().toISOString();

  if (closestStation) {
    // Weighted running average update
    const oldCount = Number(closestStation.refuelCount) || 1;
    const newCount = oldCount + 1;
    const prevLat = Number(closestStation.lat);
    const prevLng = Number(closestStation.lng);

    closestStation.lat = (prevLat * oldCount + lat) / newCount;
    closestStation.lng = (prevLng * oldCount + lng) / newCount;
    closestStation.refuelCount = newCount;
    closestStation.lastVisited = nowIso;
    if (name && (!closestStation.name || closestStation.name === 'Estación de Servicio')) {
      closestStation.name = name;
    }
    if (!closestStation.radiusMeters) {
      closestStation.radiusMeters = 60;
    }
    return closestStation;
  }

  // Register new learned gas station
  const newStation = {
    id: `station_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: name || 'Estación de Servicio',
    lat,
    lng,
    radiusMeters: 60,
    refuelCount: 1,
    lastVisited: nowIso
  };

  profile.learnedGasStations.push(newStation);
  return newStation;
}

/**
 * Checks if a vehicle stop (duration >= 120s) is within 60m of any learned station.
 * 
 * @param {Object} stop - Stop data { lat, lng, durationSeconds, ... }
 * @param {Array<Object>} stations - Array of learned gas stations
 * @returns {Object|null} Matched station or null if no station within 60m or duration < 120s
 */
export function checkStopNearStation(stop, stations) {
  if (!stop || !Array.isArray(stations) || stations.length === 0) {
    return null;
  }

  const duration = Number(
    stop.durationSeconds ??
    stop.duration ??
    stop.durationSec ??
    stop.stoppedTimeSec ??
    stop.stoppedSeconds ??
    stop.duration_seconds ??
    0
  );

  // Minimum stationary duration: 120 seconds (2 minutes)
  if (duration < 120) {
    return null;
  }

  const stopLat = Number(stop.lat ?? stop.latitude ?? stop.coords?.lat ?? stop.coords?.latitude);
  const stopLng = Number(stop.lng ?? stop.longitude ?? stop.lon ?? stop.coords?.lng ?? stop.coords?.longitude);

  if (isNaN(stopLat) || isNaN(stopLng) || (stopLat === 0 && stopLng === 0)) {
    return null;
  }

  let closestStation = null;
  let minDistance = Infinity;

  for (const station of stations) {
    const sLat = Number(station.lat ?? station.latitude);
    const sLng = Number(station.lng ?? station.longitude);
    if (isNaN(sLat) || isNaN(sLng)) continue;

    const radius = Number(station.radiusMeters) || 60;
    const dist = calculateDistanceMeters(stopLat, stopLng, sLat, sLng);

    if (dist <= radius && dist < minDistance) {
      minDistance = dist;
      closestStation = station;
    }
  }

  return closestStation;
}

/**
 * Dispatches a browser Notification or PWA notification for a stop near a learned station.
 * Uses a unique tag per stopId to prevent duplicate alerts for the same stop.
 * 
 * @param {Object} stop - Stop object with id/timestamp/coordinates
 * @param {Object} station - Learned station object
 * @returns {Promise<Notification|Object|null>}
 */
export async function notifyGasStationStop(stop, station) {
  if (!stop || !station) return null;

  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    return null;
  }

  const stopId = stop.id || stop.stopId || `${stop.lat}_${stop.lng}_${stop.startTime || stop.startTimeMs || stop.timestamp || 'stop'}`;
  const tag = `octane-refuel-stop-${stopId}`;

  const initialOdo = stop.odometer || stop.odometer_reading || stop.odo || stop.mileage || undefined;
  const stationName = station.name || 'Estación de Servicio';

  const title = 'OCTANE // REGISTRAR TANQUEADA';
  const notificationOptions = {
    body: `Detención en ${stationName}. Toca para registrar odómetro y galones.`,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon.svg',
    tag,
    renotify: false,
    data: {
      action: 'suggest-refuel',
      stopId,
      stationId: station.id,
      initialOdo: initialOdo !== undefined ? Number(initialOdo) : undefined,
      defaultFull: true
    }
  };

  // If Service Worker is active in PWA mode, prefer registration.showNotification
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && navigator.serviceWorker.controller) {
    try {
      const reg = await navigator.serviceWorker.ready;
      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification(title, notificationOptions);
        return { tag, handled: true, type: 'service-worker' };
      }
    } catch (_) {}
  }

  // Fallback to standard Notification API
  try {
    const notif = new Notification(title, notificationOptions);
    if (typeof window !== 'undefined') {
      notif.onclick = () => {
        if (typeof window.focus === 'function') window.focus();
        window.dispatchEvent(new CustomEvent('octane:suggest-refuel', {
          detail: {
            initialOdo: initialOdo !== undefined ? Number(initialOdo) : undefined,
            defaultFull: true,
            stop,
            station
          }
        }));
        if (typeof notif.close === 'function') notif.close();
      };
    }
    return notif;
  } catch (err) {
    console.warn('[OCTANE] Notification dispatch issue:', err);
    return null;
  }
}
