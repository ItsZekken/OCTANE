/**
 * OCTANE // KINETIC — Pure Export, AI Analysis & Backup Engine
 *
 * 100% pure mathematical & serialization core (zero DOM, zero IndexedDB, zero network).
 * Separates two distinct export purposes:
 *   1. AI / Human-Readable Analysis Export (JSON + Markdown):
 *      - Zero GPS trackPoints breadcrumbs, zero raw lat/lng coordinates, zero credentials/secrets.
 *      - Enriched with computed telemetry intelligence (closed cycles, empirical gauge curve,
 *        fuel physics calibration, electrical health, physical wear, rides profitability,
 *        station honesty ranking & optimal corridors).
 *   2. Restorable Full Backup:
 *      - Lossless 7-store master snapshot with manifest metadata & schema version.
 *      - Scrubs `gpsConfig.password` by default so plaintext credentials never leak to disk.
 *      - Optional `includeGpsTracks: false` mode for lightweight restorable backups.
 *   3. Pre-Restore Payload Inspector:
 *      - Detects & blocks accidental restoration of AI-only exports before touching IndexedDB.
 *      - Returns structured manifest counts for user confirmation.
 */

import { localYmd } from './date-utils.js';
import { calculateTelemetryModel, DEFAULT_TANK_CAPACITY_GAL } from './telemetry-engine.js';
import { analyzeElectricalHealth, computePhysicalWear } from './vehicle-health-engine.js';
import {
    detectSemanticPlaces,
    resolvePlaceLabel,
    computeStationHonestyIndex,
    analyzeOptimalDeparture
} from './geospatial-intelligence.js';
import { calculateRidesCycleSummary } from './rides-engine.js';

export const EXPORT_SCHEMA_VERSION = 2;
export const AI_EXPORT_FORMAT = 'octane_ai_analysis';
export const FULL_BACKUP_TYPE = 'octane_full_backup';

const WEEKDAY_NAMES_ES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

function roundNum(val, decimals = 2) {
    const n = Number(val);
    if (!Number.isFinite(n)) return null;
    const factor = Math.pow(10, decimals);
    return Math.round(n * factor) / factor;
}

function roundInt(val) {
    const n = Number(val);
    return Number.isFinite(n) ? Math.round(n) : null;
}

function cleanStr(val) {
    if (val === null || val === undefined) return '';
    return String(val).trim();
}

function stripEmpty(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (v === undefined || v === null || v === '') continue;
        if (Array.isArray(v) && v.length === 0) continue;
        out[k] = v;
    }
    return out;
}

function fmtCopPlain(val) {
    const n = Number(val);
    if (!Number.isFinite(n)) return '$0';
    const sign = n < 0 ? '-' : '';
    const abs = Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${sign}$${abs}`;
}

/**
 * Estimates exact UTF-8 byte length of a string or JSON-serializable object.
 * @param {string|Object} value
 * @returns {number}
 */
export function estimateUtf8Bytes(value) {
    const str = typeof value === 'string' ? value : JSON.stringify(value ?? '');
    if (typeof TextEncoder !== 'undefined') {
        return new TextEncoder().encode(str).length;
    }
    return str.length;
}

/**
 * Formats a byte size into a compact human-readable label (B, KB, MB).
 * @param {number} bytes
 * @returns {string}
 */
export function formatByteSize(bytes) {
    const n = Math.max(0, Number(bytes) || 0);
    if (n < 1024) return `${Math.round(n)} B`;
    if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Extracts normalized store arrays from any OCTANE snapshot shape (v1, v2, or flat).
 * @param {Object} snapshot
 * @returns {Object}
 */
export function extractSnapshotStores(snapshot) {
    const raw = (snapshot && typeof snapshot === 'object') ? (snapshot.stores || snapshot) : {};
    const profileArr = Array.isArray(raw.vehicle_profile)
        ? raw.vehicle_profile
        : (raw.vehicle_profile && typeof raw.vehicle_profile === 'object' ? [raw.vehicle_profile] : []);

    return {
        vehicleProfile: profileArr[0] || null,
        telemetryLogs: Array.isArray(raw.telemetry_logs) ? raw.telemetry_logs : [],
        maintenanceItems: Array.isArray(raw.maintenance_items) ? raw.maintenance_items : [],
        freeNotes: Array.isArray(raw.free_notes) ? raw.free_notes : [],
        legalDocs: Array.isArray(raw.legal_docs) ? raw.legal_docs : [],
        rideSessions: Array.isArray(raw.ride_sessions) ? raw.ride_sessions : [],
        platformPasses: Array.isArray(raw.platform_passes) ? raw.platform_passes : [],
        deleted: Array.isArray(snapshot?.deleted) ? snapshot.deleted : []
    };
}

/**
 * Counts records and GPS track geometry volume in a snapshot.
 * @param {Object} snapshot
 * @returns {Object}
 */
export function countSnapshotManifest(snapshot) {
    const {
        vehicleProfile,
        telemetryLogs,
        maintenanceItems,
        freeNotes,
        legalDocs,
        rideSessions,
        platformPasses
    } = extractSnapshotStores(snapshot);

    const gpsCache = vehicleProfile?.gpsCache || {};
    const gpsDays = gpsCache.days && typeof gpsCache.days === 'object'
        ? Object.keys(gpsCache.days).length
        : 0;

    let gpsTrips = 0;
    let gpsTrackPoints = 0;
    if (gpsCache.tripsByDate && typeof gpsCache.tripsByDate === 'object') {
        for (const dayTrips of Object.values(gpsCache.tripsByDate)) {
            if (!Array.isArray(dayTrips)) continue;
            gpsTrips += dayTrips.length;
            for (const t of dayTrips) {
                if (t && Array.isArray(t.trackPoints)) {
                    gpsTrackPoints += t.trackPoints.length;
                }
            }
        }
    }

    const maintenanceServices = maintenanceItems.reduce(
        (sum, item) => sum + (Array.isArray(item?.history) ? item.history.length : 0),
        0
    );

    return {
        vehicleName: cleanStr(vehicleProfile?.name) || 'Vehículo',
        exportedAt: snapshot?.exportedAt || null,
        telemetryLogs: telemetryLogs.length,
        maintenanceItems: maintenanceItems.length,
        maintenanceServices,
        rideSessions: rideSessions.length,
        platformPasses: platformPasses.length,
        legalDocs: legalDocs.length,
        freeNotes: freeNotes.length,
        gpsDays,
        gpsTrips,
        gpsTrackPoints
    };
}

/**
 * Builds a clean, restorable full backup payload from an IndexedDB snapshot.
 * Never mutates the input snapshot.
 *
 * @param {Object} snapshot
 * @param {Object} [options={}]
 * @param {boolean} [options.includeGpsTracks=true] - Include GPS route polylines (`trackPoints`)
 * @param {boolean} [options.scrubCredentials=true] - Scrub `gpsConfig.password` before writing to disk
 * @returns {Object}
 */
export function buildFullBackupPayload(snapshot, options = {}) {
    const includeGpsTracks = options.includeGpsTracks !== false;
    const scrubCredentials = options.scrubCredentials !== false;
    const nowIso = options.exportedAt || new Date().toISOString();

    const cloned = snapshot && typeof snapshot === 'object'
        ? JSON.parse(JSON.stringify(snapshot))
        : { version: EXPORT_SCHEMA_VERSION, stores: {}, deleted: [] };

    const storesObj = cloned.stores && typeof cloned.stores === 'object'
        ? cloned.stores
        : {
            vehicle_profile: Array.isArray(cloned.vehicle_profile)
                ? cloned.vehicle_profile
                : (cloned.vehicle_profile ? [cloned.vehicle_profile] : []),
            telemetry_logs: Array.isArray(cloned.telemetry_logs) ? cloned.telemetry_logs : [],
            maintenance_items: Array.isArray(cloned.maintenance_items) ? cloned.maintenance_items : [],
            free_notes: Array.isArray(cloned.free_notes) ? cloned.free_notes : [],
            legal_docs: Array.isArray(cloned.legal_docs) ? cloned.legal_docs : [],
            ride_sessions: Array.isArray(cloned.ride_sessions) ? cloned.ride_sessions : [],
            platform_passes: Array.isArray(cloned.platform_passes) ? cloned.platform_passes : []
        };

    const profiles = Array.isArray(storesObj.vehicle_profile)
        ? storesObj.vehicle_profile
        : (storesObj.vehicle_profile ? [storesObj.vehicle_profile] : []);

    for (const profile of profiles) {
        if (!profile || typeof profile !== 'object') continue;
        if (scrubCredentials && profile.gpsConfig && typeof profile.gpsConfig === 'object') {
            profile.gpsConfig.password = '';
        }
        if (!includeGpsTracks && profile.gpsCache?.tripsByDate && typeof profile.gpsCache.tripsByDate === 'object') {
            for (const dayTrips of Object.values(profile.gpsCache.tripsByDate)) {
                if (!Array.isArray(dayTrips)) continue;
                for (const trip of dayTrips) {
                    if (trip && typeof trip === 'object' && 'trackPoints' in trip) {
                        delete trip.trackPoints;
                    }
                }
            }
        }
    }

    const basePayload = {
        backupType: FULL_BACKUP_TYPE,
        app: 'OCTANE',
        version: EXPORT_SCHEMA_VERSION,
        exportedAt: nowIso,
        restorable: true,
        includesGpsTracks: includeGpsTracks,
        credentialsScrubbed: scrubCredentials,
        stores: storesObj,
        deleted: Array.isArray(cloned.deleted) ? cloned.deleted : []
    };

    basePayload.manifest = countSnapshotManifest(basePayload);
    return basePayload;
}

/**
 * Resolves the highest known odometer reading from telemetry logs and GPS cache.
 */
function resolveCurrentOdometer(telemetryLogs, vehicleProfile) {
    let maxOdo = 0;
    for (const log of telemetryLogs) {
        const o = Number(log?.odometer_reading);
        if (Number.isFinite(o) && o > maxOdo) maxOdo = o;
    }
    const gpsMile = Number(vehicleProfile?.gpsCache?.live?.totalMile);
    if (Number.isFinite(gpsMile) && gpsMile > maxOdo) maxOdo = Math.round(gpsMile);
    return maxOdo;
}

/**
 * Strips raw GPS coordinates and noisy fields from a trip while preserving rich kinematic,
 * semantic origin/destination, and calibrated fuel metrics for LLM analysis.
 */
function compactTripForLlm(trip, dateKey, semanticPlaces) {
    if (!trip || typeof trip !== 'object') return null;

    const origin = resolvePlaceLabel(
        trip.startLat ?? trip.startLatitude,
        trip.startLng ?? trip.startLongitude,
        trip.startAddress || '',
        semanticPlaces
    );
    const destination = resolvePlaceLabel(
        trip.endLat ?? trip.endLatitude,
        trip.endLng ?? trip.endLongitude,
        trip.endAddress || '',
        semanticPlaces
    );

    const isCalibrated = Boolean(trip.isCalibrated && Number(trip.calibratedGallons) > 0);
    const gallons = isCalibrated
        ? roundNum(trip.calibratedGallons, 3)
        : roundNum(trip.estGallons ?? trip.predictedGallons, 3);
    const costCop = isCalibrated
        ? roundInt(trip.calibratedCostCop)
        : roundInt(trip.estCostCop ?? trip.predictedCostCop);

    return stripEmpty({
        date: String(trip.date || dateKey || '').slice(0, 10),
        start: cleanStr(trip.startTimeHm),
        end: cleanStr(trip.endTimeHm),
        origin: origin || undefined,
        destination: destination || undefined,
        km: roundNum(trip.distanceKm ?? trip.km, 2),
        durationMin: roundNum(trip.durationMin, 1),
        stoppedMin: Number(trip.stoppedMin) > 0 ? roundNum(trip.stoppedMin, 1) : undefined,
        avgSpeedKmh: Number(trip.avgSpeedKmh) > 0 ? roundNum(trip.avgSpeedKmh, 1) : undefined,
        maxSpeedKmh: Number(trip.maxSpeedKmh) > 0 ? roundNum(trip.maxSpeedKmh, 1) : undefined,
        gallons,
        costCop,
        calibrated: isCalibrated || undefined,
        coldStart: Number(trip.coldPenaltyPct) >= 5 ? true : undefined,
        hardBrakes: Number(trip.hardBrakes) > 0 ? roundInt(trip.hardBrakes) : undefined
    });
}

/**
 * Builds a compact, privacy-safe, AI/LLM-optimized structured telemetry digest.
 * - Zero `trackPoints` arrays
 * - Zero raw `lat`/`lng` coordinates
 * - Zero GPS passwords, usernames, IMEIs, tokens, or proxy URLs
 * - Pre-computed intelligence across fuel physics, gauge calibration, electrical health,
 *   mechanical wear, rides profitability, stations, and corridors.
 *
 * @param {Object} snapshot
 * @param {Object} [options={}]
 * @returns {Object}
 */
export function buildLlmAnalysisExport(snapshot, options = {}) {
    const nowDate = options.now instanceof Date ? options.now : new Date();
    const nowIso = options.exportedAt || nowDate.toISOString();
    const todayYmd = localYmd(nowDate);

    const {
        vehicleProfile,
        telemetryLogs,
        maintenanceItems,
        freeNotes,
        legalDocs,
        rideSessions,
        platformPasses
    } = extractSnapshotStores(snapshot);

    const profile = vehicleProfile || {};
    const gpsCache = profile.gpsCache || {};
    const gpsDaysMap = gpsCache.days && typeof gpsCache.days === 'object' ? gpsCache.days : null;
    const tripsByDate = gpsCache.tripsByDate && typeof gpsCache.tripsByDate === 'object' ? gpsCache.tripsByDate : null;
    const learnedStations = Array.isArray(profile.learnedGasStations) ? profile.learnedGasStations : [];
    const fuelPriceCop = Number(profile.fuelPriceCop) > 0 ? Math.round(Number(profile.fuelPriceCop)) : 16000;
    const tankMaxGal = Number(profile.tankCapacityGallons) > 0
        ? Number(profile.tankCapacityGallons)
        : DEFAULT_TANK_CAPACITY_GAL;
    const currentOdo = resolveCurrentOdometer(telemetryLogs, profile);

    // 1. Run pure core engines safely
    let telemetryModel = null;
    try {
        telemetryModel = calculateTelemetryModel(telemetryLogs, profile, {
            fuelPriceCop,
            gpsDaysMap,
            tripsByDate
        });
    } catch (_) {
        telemetryModel = null;
    }

    let semanticPlaces = { home: null, work: null, stations: [], allPlaces: [] };
    try {
        if (tripsByDate) {
            semanticPlaces = detectSemanticPlaces(tripsByDate, learnedStations);
        }
    } catch (_) {}

    let electrical = null;
    try {
        electrical = analyzeElectricalHealth(
            gpsCache.voltageHistory || [],
            gpsDaysMap,
            gpsCache.live || null,
            nowDate.getTime()
        );
    } catch (_) {
        electrical = null;
    }

    const closedCycles = Array.isArray(telemetryModel?.closedCycles) ? telemetryModel.closedCycles : [];

    let stationHonesty = { rankedStations: [], totalQualifiedStations: 0 };
    try {
        stationHonesty = computeStationHonestyIndex(closedCycles, telemetryLogs, learnedStations);
    } catch (_) {}

    // Flatten raw trips (for corridor analyzer + compact export)
    const rawTripsFlat = [];
    const compactTrips = [];
    if (tripsByDate) {
        const sortedTripDates = Object.keys(tripsByDate).sort();
        for (const dateKey of sortedTripDates) {
            const dayTrips = tripsByDate[dateKey];
            if (!Array.isArray(dayTrips)) continue;
            for (const trip of dayTrips) {
                if (!trip || typeof trip !== 'object') continue;
                rawTripsFlat.push({ ...trip, date: trip.date || dateKey });
                const compact = compactTripForLlm(trip, dateKey, semanticPlaces);
                if (compact) compactTrips.push(compact);
            }
        }
    }

    let optimalCorridors = [];
    try {
        const corridors = analyzeOptimalDeparture(rawTripsFlat, { semanticPlaces });
        if (Array.isArray(corridors)) {
            optimalCorridors = corridors.slice(0, 5).map(c => stripEmpty({
                corridor: c.corridorLabel,
                bestWindow: c.bestWindowHm,
                bestDurationMin: roundNum(c.bestDurationMin, 1),
                savedMin: roundNum(c.savedMin, 1),
                savedCopPerTrip: roundInt(c.savedCopPerTrip),
                samples: c.sampleCount
            }));
        }
    } catch (_) {}

    // 2. Date range covered
    const allDates = [
        ...telemetryLogs.map(l => String(l?.date || '').slice(0, 10)),
        ...Object.keys(gpsDaysMap || {}),
        ...rideSessions.map(r => String(r?.date || '').slice(0, 10))
    ].filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();

    const periodFrom = allDates[0] || null;
    const periodTo = allDates[allDates.length - 1] || null;

    // 3. Executive summary
    const adaptiveEff = Number(telemetryModel?.adaptiveEff) || null;
    const activeTank = telemetryModel?.activeTankState || null;
    const gaugeCal = telemetryModel?.gaugeCalibration || null;
    const physics = telemetryModel?.fuelPhysicsModel || null;

    const executiveSummary = stripEmpty({
        efficiency: stripEmpty({
            adaptiveKmGal: roundNum(adaptiveEff, 2),
            historicalKmGal: roundNum(telemetryModel?.historicalEff, 2),
            fullEraAvgKmGal: roundNum(telemetryModel?.fullEraAvgEff, 2),
            emaKmGal: roundNum(telemetryModel?.emaEff, 2),
            estimatedCostPerKmCop: adaptiveEff > 0 ? Math.round(fuelPriceCop / adaptiveEff) : null,
            avgKmPerDay: roundNum(telemetryModel?.stats?.avgKmPerDay, 1),
            totalTrackedKm: roundInt(telemetryModel?.stats?.totalKm),
            closedCyclesCount: closedCycles.length
        }),
        activeTank: activeTank ? stripEmpty({
            estimatedGallons: roundNum(activeTank.estimatedGallons ?? activeTank.remainingGal, 2),
            estimatedPct: roundNum(activeTank.estimatedPct ?? activeTank.pct, 1),
            estimatedRangeKm: roundInt(activeTank.estimatedRangeKm ?? activeTank.autonomyKm),
            projectedDaysRemaining: roundNum(activeTank.projectedDaysRemaining ?? activeTank.daysRemaining, 1),
            source: cleanStr(activeTank.source)
        }) : undefined,
        gaugeCalibration: gaugeCal ? stripEmpty({
            status: gaugeCal.status || (gaugeCal.isCalibrated ? 'calibrated' : 'uncalibrated'),
            sampleCount: gaugeCal.sampleCount ?? 0,
            directAnchors: gaugeCal.anchorCount ?? 0,
            retroactivePoints: gaugeCal.retroactiveCount ?? 0,
            knots: Array.isArray(gaugeCal.knots)
                ? gaugeCal.knots.map(k => ({ pct: roundNum(k.pct, 1), gallons: roundNum(k.gallons, 2) }))
                : undefined
        }) : undefined,
        fuelPhysics: physics ? stripEmpty({
            calibrated: Boolean(physics.isCalibrated ?? physics.calibrated),
            sampleCycles: physics.sampleCount ?? physics.cycleCount ?? closedCycles.length,
            r2: roundNum(physics.r2, 3),
            coeffs: physics.coeffs ? stripEmpty({
                baseGalPerKm: roundNum(physics.coeffs.baseGalPerKm, 5),
                idleGalPerHour: roundNum(physics.coeffs.idleGalPerHour, 3),
                urbanPenalty: roundNum(physics.coeffs.urbanPenalty, 4),
                coldStartGal: roundNum(physics.coeffs.coldStartGal, 4)
            }) : undefined,
            anomalyAlert: physics.anomalyAlert ? stripEmpty({
                label: physics.anomalyAlert.label,
                avgExcessPct: roundNum(physics.anomalyAlert.avgExcessPct, 1),
                consecutiveCount: physics.anomalyAlert.consecutiveCount
            }) : undefined
        }) : undefined,
        electricalHealth: electrical && (electrical.restingAvgV > 0 || electrical.chargingAvgV > 0) ? stripEmpty({
            restingVoltageV: roundNum(electrical.restingAvgV, 2),
            restingStatus: electrical.restingStatus,
            chargingVoltageV: roundNum(electrical.chargingAvgV, 2),
            chargingStatus: electrical.chargingStatus,
            slopeVPer30d: roundNum(electrical.slopeVPer30d, 3),
            ignitions30d: electrical.ignitions30d || 0,
            alerts: Array.isArray(electrical.alerts) ? electrical.alerts.map(a => a.message || a.label) : undefined
        }) : undefined,
        weekdayPatternKm: Array.isArray(telemetryModel?.weekdayDNA)
            ? telemetryModel.weekdayDNA.reduce((acc, d, idx) => {
                const name = WEEKDAY_NAMES_ES[d?.dayIndex ?? idx] || `D${idx + 1}`;
                acc[name] = roundNum(d?.avgKm ?? 0, 1);
                return acc;
            }, {})
            : undefined,
        stationRanking: stationHonesty.rankedStations.length > 0
            ? stationHonesty.rankedStations.map(s => stripEmpty({
                station: s.stationName,
                cycles: s.cycleCount,
                avgEffKmGal: roundNum(s.avgEff, 2),
                residualPct: roundNum(s.residualPct, 1),
                verdict: s.label || s.verdict
            }))
            : undefined,
        optimalCorridors: optimalCorridors.length > 0 ? optimalCorridors : undefined,
        detectedSemanticPlaces: stripEmpty({
            hasHome: Boolean(semanticPlaces.home),
            homeDays: semanticPlaces.home?.daysCount || undefined,
            hasWork: Boolean(semanticPlaces.work),
            workDays: semanticPlaces.work?.daysCount || undefined,
            learnedStationsCount: learnedStations.length || undefined
        })
    });

    // 4. Closed fuel cycles (concise)
    const compactCycles = closedCycles.map((c, idx) => stripEmpty({
        cycle: c.cycleIndex ?? (idx + 1),
        startDate: c.startDate,
        endDate: c.endDate,
        days: roundInt(c.days),
        startOdoKm: roundInt(c.startOdo),
        endOdoKm: roundInt(c.endOdo),
        distanceKm: roundNum(c.dist ?? c.distanceKm, 1),
        gallons: roundNum(c.gal ?? c.gallons, 3),
        effKmGal: roundNum(c.eff, 2),
        pricePerGalCop: roundInt(c.pricePerGal || fuelPriceCop),
        totalCostCop: roundInt(c.totalCostCop ?? ((Number(c.gal) || 0) * (Number(c.pricePerGal) || fuelPriceCop))),
        valid: c.isValid !== false,
        station: cleanStr(c.stationName),
        gpsSeverity: roundNum(c.physicalTelemetry?.severityFactor, 2),
        idleHours: Number(c.physicalTelemetry?.idleHours) > 0 ? roundNum(c.physicalTelemetry.idleHours, 2) : undefined,
        coldStarts: Number(c.physicalTelemetry?.coldStarts) > 0 ? roundInt(c.physicalTelemetry.coldStarts) : undefined
    }));

    // 5. Telemetry logs (chronological, clean)
    const compactLogs = [...telemetryLogs]
        .filter(Boolean)
        .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || ((Number(a.odometer_reading) || 0) - (Number(b.odometer_reading) || 0)))
        .map(l => {
            const gal = Number(l.gallons_added) || 0;
            const cost = Number(l.total_cost_cop) || 0;
            return stripEmpty({
                date: String(l.date || '').slice(0, 10),
                type: gal > 0 ? 'refuel' : 'reading',
                odometerKm: roundInt(l.odometer_reading),
                gallonsAdded: gal > 0 ? roundNum(gal, 3) : undefined,
                totalCostCop: cost > 0 ? roundInt(cost) : undefined,
                pricePerGalCop: (gal > 0 && cost > 0) ? Math.round(cost / gal) : undefined,
                fullTank: gal > 0 ? Boolean(l.is_full_tank || l.isFullTank) : undefined,
                gaugePct: (l.fuel_level_percent !== null && l.fuel_level_percent !== undefined)
                    ? roundNum(l.fuel_level_percent, 1)
                    : undefined,
                preRefuelGaugePct: (l.pre_refuel_gauge_pct !== null && l.pre_refuel_gauge_pct !== undefined)
                    ? roundNum(l.pre_refuel_gauge_pct, 1)
                    : undefined,
                station: cleanStr(l.stationName),
                note: cleanStr(l.notes || l.note)
            });
        });

    // 6. GPS daily summary (zero coordinates)
    const gpsDailySummary = [];
    if (gpsDaysMap) {
        for (const dateKey of Object.keys(gpsDaysMap).sort()) {
            const d = gpsDaysMap[dateKey];
            if (!d || typeof d !== 'object') continue;
            const dayTrips = Array.isArray(tripsByDate?.[dateKey]) ? tripsByDate[dateKey] : [];
            let dayCalGal = 0;
            let dayCalCop = 0;
            let hasCal = false;
            for (const t of dayTrips) {
                if (t?.isCalibrated && Number(t.calibratedGallons) > 0) {
                    hasCal = true;
                    dayCalGal += Number(t.calibratedGallons) || 0;
                    dayCalCop += Number(t.calibratedCostCop) || 0;
                }
            }
            const km = Number(d.km) || 0;
            const estGal = hasCal
                ? dayCalGal
                : (adaptiveEff > 0 && km > 0 ? km / adaptiveEff : null);
            const estCostCop = hasCal
                ? dayCalCop
                : (estGal !== null ? estGal * fuelPriceCop : null);

            gpsDailySummary.push(stripEmpty({
                date: dateKey,
                km: roundNum(km, 2),
                trips: Number(d.runNo) || dayTrips.length || undefined,
                runMin: Number(d.runTimeSec) > 0 ? Math.round(Number(d.runTimeSec) / 60) : undefined,
                idleMin: Number(d.idleAccOnSec) > 0 ? Math.round(Number(d.idleAccOnSec) / 60) : undefined,
                avgSpeedKmh: Number(d.avgSpeed) > 0 ? roundNum(d.avgSpeed, 1) : undefined,
                maxSpeedKmh: Number(d.maxSpeed) > 0 ? roundNum(d.maxSpeed, 1) : undefined,
                gallons: estGal !== null ? roundNum(estGal, 3) : undefined,
                costCop: estCostCop !== null ? roundInt(estCostCop) : undefined,
                calibrated: hasCal || undefined
            }));
        }
    }

    // 7. Rides & finances summary
    let ridesBlock = undefined;
    if (rideSessions.length > 0 || platformPasses.length > 0) {
        let ridesSummary = null;
        try {
            ridesSummary = calculateRidesCycleSummary({
                sessions: rideSessions,
                passes: platformPasses,
                telemetryLogs,
                telemetryModel,
                vehicleProfile: profile,
                fuelPriceCop,
                gpsDaysMap,
                tripsByDate
            });
        } catch (_) {
            ridesSummary = null;
        }

        const byPlatform = {};
        const compactSessions = [...rideSessions]
            .filter(Boolean)
            .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
            .map(s => {
                const isExpense = s.type === 'expense' || s.type === 'pass';
                const platform = cleanStr(s.platform) || (isExpense ? 'Egreso' : 'Directo');
                const gross = isExpense ? 0 : (Number(s.grossEarnings ?? s.fareCop ?? s.grossRevenueCop ?? s.grossIncomeCop) || 0);
                const expense = isExpense ? (Number(s.amountCop ?? s.costCop ?? s.expenseCop ?? s.grossEarnings) || 0) : 0;
                const km = Number(s.distanceKm ?? s.workKm ?? s.tripKmTotal) || 0;

                if (!isExpense) {
                    if (!byPlatform[platform]) byPlatform[platform] = { rides: 0, grossCop: 0, km: 0 };
                    byPlatform[platform].rides += 1;
                    byPlatform[platform].grossCop += Math.round(gross);
                    byPlatform[platform].km = roundNum(byPlatform[platform].km + km, 1);
                }

                return stripEmpty({
                    date: String(s.date || '').slice(0, 10),
                    time: cleanStr(s.time || s.startTimeHm),
                    type: isExpense ? 'expense' : 'ride',
                    platform,
                    mode: !isExpense ? cleanStr(s.mode || (s.isEnRoute ? 'en_ruta' : 'libre')) : undefined,
                    grossCop: gross > 0 ? roundInt(gross) : undefined,
                    expenseCop: expense > 0 ? roundInt(expense) : undefined,
                    distanceKm: km > 0 ? roundNum(km, 1) : undefined,
                    note: cleanStr(s.note || s.notes || s.description)
                });
            });

        ridesBlock = stripEmpty({
            summary: ridesSummary ? stripEmpty({
                totalRides: ridesSummary.ridesCount ?? rideSessions.filter(s => s?.type !== 'expense' && s?.type !== 'pass').length,
                grossIncomeCop: roundInt(ridesSummary.totalGrossIncome ?? ridesSummary.grossIncomeCop),
                expensesAndPassesCop: roundInt(ridesSummary.totalExpenses ?? ridesSummary.expensesCop),
                rideFuelCostCop: roundInt(ridesSummary.totalFuelCost ?? ridesSummary.fuelCostCop),
                netFreeProfitCop: roundInt(ridesSummary.netProfit ?? ridesSummary.netFreeProfitCop),
                totalCarFuelCop: roundInt(ridesSummary.totalCarFuelCop),
                fuelCoveragePct: roundNum(ridesSummary.fuelCoveragePct, 1),
                declaredWorkKm: roundNum(ridesSummary.declaredKm ?? ridesSummary.effectiveKm, 1),
                estimatedPickupKm: roundNum(ridesSummary.pickupKm, 1),
                totalExtraWorkKm: roundNum(ridesSummary.totalExtraKm, 1),
                copPerExtraKm: roundInt(ridesSummary.copPerKm)
            }) : undefined,
            byPlatform: Object.keys(byPlatform).length > 0 ? byPlatform : undefined,
            passes: platformPasses.length > 0
                ? platformPasses.map(p => stripEmpty({
                    date: String(p.date || p.startDate || '').slice(0, 10),
                    platform: cleanStr(p.platform),
                    costCop: roundInt(p.costCop ?? p.amountCop),
                    days: roundInt(p.durationDays ?? p.days)
                }))
                : undefined,
            sessions: compactSessions
        });
    }

    // 8. Maintenance & physical wear
    const compactMaintenance = maintenanceItems.filter(Boolean).map(item => {
        let wear = null;
        try {
            wear = computePhysicalWear(item, { currentOdo, gpsDays: gpsDaysMap, tripsByDate });
        } catch (_) {}

        const history = Array.isArray(item.history)
            ? item.history.map(h => stripEmpty({
                date: String(h.date || '').slice(0, 10),
                odometerKm: roundInt(h.odometer),
                costCop: Number(h.costCop ?? h.cost) > 0 ? roundInt(h.costCop ?? h.cost) : undefined,
                workshop: cleanStr(h.workshop),
                specs: (h.specs && typeof h.specs === 'object') ? stripEmpty(h.specs) : undefined,
                note: cleanStr(h.note || h.notes)
            }))
            : [];

        const kmRemaining = wear
            ? roundInt(wear.remainingEquivalentKm)
            : (Number(item.lastServiceOdo) > 0 ? roundInt((Number(item.lastServiceOdo) + (Number(item.intervalKm) || 5000)) - currentOdo) : null);

        return stripEmpty({
            name: cleanStr(item.name),
            group: cleanStr(item.group || item.category),
            intervalKm: roundInt(item.intervalKm),
            lastServiceOdoKm: Number(item.lastServiceOdo) > 0 ? roundInt(item.lastServiceOdo) : undefined,
            lastServiceDate: cleanStr(item.lastServiceDate),
            realKmUsed: wear ? roundInt(wear.realKmUsed) : undefined,
            equivalentKmUsed: wear ? roundInt(wear.equivalentKmUsed) : undefined,
            stressMultiplier: wear && wear.stressMultiplier > 1 ? roundNum(wear.stressMultiplier, 2) : undefined,
            wearBasis: wear?.basisLabel,
            kmRemaining,
            historyCount: history.length,
            history: history.length > 0 ? history : undefined
        });
    });

    // 9. Legal docs
    const compactDocs = legalDocs.filter(Boolean).map(doc => {
        const exp = cleanStr(doc.expiryDate || doc.dueDate);
        let daysRemaining = null;
        if (/^\d{4}-\d{2}-\d{2}$/.test(exp)) {
            const diff = Math.ceil((Date.parse(`${exp}T23:59:59`) - nowDate.getTime()) / 86400000);
            if (Number.isFinite(diff)) daysRemaining = diff;
        }
        return stripEmpty({
            name: cleanStr(doc.name || doc.title || doc.type),
            expiryDate: exp,
            daysRemaining,
            costCop: Number(doc.costCop ?? doc.cost) > 0 ? roundInt(doc.costCop ?? doc.cost) : undefined,
            provider: cleanStr(doc.provider || doc.insurer),
            note: cleanStr(doc.note || doc.notes)
        });
    });

    // 10. Notes
    const compactNotes = freeNotes.filter(Boolean).map(n => stripEmpty({
        date: String(n.date || n.updatedAt || '').slice(0, 10),
        category: cleanStr(n.category),
        title: cleanStr(n.title),
        content: cleanStr(n.content || n.body || n.text),
        pinned: Boolean(n.isPinned) || undefined
    }));

    return stripEmpty({
        meta: {
            format: AI_EXPORT_FORMAT,
            app: 'OCTANE',
            schemaVersion: EXPORT_SCHEMA_VERSION,
            restorable: false,
            exportedAt: nowIso,
            referenceDate: todayYmd,
            currency: 'COP',
            periodCovered: stripEmpty({ from: periodFrom, to: periodTo }),
            omittedForPrivacyAndCompactness: [
                'gpsRoutePolylines',
                'rawLatitudeLongitudeCoordinates',
                'gpsCredentials',
                'internalSyncTombstones'
            ]
        },
        vehicle: stripEmpty({
            name: cleanStr(profile.name) || 'Vehículo',
            tankCapacityLiters: roundNum(profile.tankCapacityLiters, 1),
            tankCapacityGallons: roundNum(tankMaxGal, 2),
            reserveLiters: roundNum(profile.reserveLiters, 1),
            referenceFuelPriceCop: fuelPriceCop,
            routineDailyKm: roundNum(profile.routineDailyKm, 1),
            currentOdometerKm: currentOdo > 0 ? currentOdo : undefined,
            gpsLinked: Boolean(profile.gpsConfig?.enabled || gpsDaysMap)
        }),
        executiveSummary,
        fuelCycles: compactCycles,
        telemetryLogs: compactLogs,
        gpsDailySummary,
        gpsTrips: compactTrips,
        rides: ridesBlock,
        maintenance: compactMaintenance,
        legalDocs: compactDocs,
        notes: compactNotes
    });
}

/**
 * Builds a clean, human- & LLM-ready Markdown report from a snapshot (or pre-built analysis object).
 * Ideal for direct copy-paste into ChatGPT, Claude, or Gemini, or downloading as `.md`.
 *
 * @param {Object} snapshotOrAnalysis
 * @param {Object} [options={}]
 * @returns {string}
 */
export function buildLlmMarkdownReport(snapshotOrAnalysis, options = {}) {
    const analysis = snapshotOrAnalysis?.meta?.format === AI_EXPORT_FORMAT
        ? snapshotOrAnalysis
        : buildLlmAnalysisExport(snapshotOrAnalysis, options);

    const lines = [];
    const v = analysis.vehicle || {};
    const exec = analysis.executiveSummary || {};
    const eff = exec.efficiency || {};

    lines.push(`# OCTANE — Informe de Telemetría (${v.name || 'Vehículo'})`);
    lines.push('');
    lines.push(`- **Fecha de generación:** ${analysis.meta?.referenceDate || localYmd(new Date())}`);
    if (analysis.meta?.periodCovered?.from && analysis.meta?.periodCovered?.to) {
        lines.push(`- **Periodo cubierto:** ${analysis.meta.periodCovered.from} a ${analysis.meta.periodCovered.to}`);
    }
    if (v.currentOdometerKm) {
        lines.push(`- **Odómetro actual:** ${v.currentOdometerKm.toLocaleString('es-CO')} km`);
    }
    lines.push(`- **Tanque:** ${v.tankCapacityLiters ?? '--'} L (${v.tankCapacityGallons ?? '--'} gal) · Reserva: ${v.reserveLiters ?? '--'} L`);
    lines.push(`- **Precio referencia:** ${fmtCopPlain(v.referenceFuelPriceCop)} / gal · Rodaje rutina: ${v.routineDailyKm ?? '--'} km/día`);
    lines.push('');

    // Executive KPIs
    lines.push('## 1. Resumen Ejecutivo');
    if (eff.adaptiveKmGal) {
        lines.push(`- **Rendimiento adaptativo:** ${eff.adaptiveKmGal} km/gal (Histórico: ${eff.historicalKmGal ?? '--'} km/gal · Costo/km: ${fmtCopPlain(eff.estimatedCostPerKmCop)}/km)`);
    }
    if (eff.avgKmPerDay) {
        lines.push(`- **Rodaje promedio:** ${eff.avgKmPerDay} km/día · Ciclos cerrados: ${eff.closedCyclesCount ?? 0}`);
    }
    if (exec.activeTank) {
        lines.push(`- **Tanque activo:** ~${exec.activeTank.estimatedGallons ?? '--'} gal (${exec.activeTank.estimatedPct ?? '--'}%) · Autonomía: ~${exec.activeTank.estimatedRangeKm ?? '--'} km (~${exec.activeTank.projectedDaysRemaining ?? '--'} días)`);
    }
    if (exec.gaugeCalibration) {
        const gc = exec.gaugeCalibration;
        const knotsStr = Array.isArray(gc.knots)
            ? gc.knots.map(k => `${k.pct}%=${k.gallons}g`).join(', ')
            : '';
        lines.push(`- **Calibración aguja:** ${gc.status} (${gc.sampleCount} muestras: ${gc.directAnchors} anclas + ${gc.retroactivePoints} retroactivas)${knotsStr ? ` · Curva: ${knotsStr}` : ''}`);
    }
    if (exec.fuelPhysics?.coeffs) {
        const c = exec.fuelPhysics.coeffs;
        lines.push(`- **Física de consumo:** base=${c.baseGalPerKm ?? '--'} gal/km, ralentí=${c.idleGalPerHour ?? '--'} gal/h, arranque frío=${c.coldStartGal ?? '--'} gal${exec.fuelPhysics.r2 != null ? ` (R²=${exec.fuelPhysics.r2})` : ''}`);
        if (exec.fuelPhysics.anomalyAlert) {
            lines.push(`- **Alerta consumo:** ${exec.fuelPhysics.anomalyAlert.label} (+${exec.fuelPhysics.anomalyAlert.avgExcessPct}% en ${exec.fuelPhysics.anomalyAlert.consecutiveCount} ciclos)`);
        }
    }
    if (exec.electricalHealth) {
        const e = exec.electricalHealth;
        lines.push(`- **Salud eléctrica:** Batería reposo ${e.restingVoltageV ?? '--'}V (${e.restingStatus || '--'}) · Alternador ${e.chargingVoltageV ?? '--'}V (${e.chargingStatus || '--'}) · Encendidos 30d: ${e.ignitions30d ?? 0}`);
    }
    if (exec.weekdayPatternKm) {
        const dnaStr = Object.entries(exec.weekdayPatternKm).map(([d, km]) => `${d}: ${km} km`).join(' · ');
        lines.push(`- **Patrón semanal:** ${dnaStr}`);
    }
    lines.push('');

    // Closed fuel cycles
    if (Array.isArray(analysis.fuelCycles) && analysis.fuelCycles.length > 0) {
        lines.push('## 2. Ciclos de Combustible');
        lines.push('| # | Periodo | Días | Km | Gal | Km/Gal | $/Gal | Total | Estación | Severidad |');
        lines.push('|---|---|---:|---:|---:|---:|---:|---:|---|---:|');
        for (const c of analysis.fuelCycles) {
            lines.push(`| ${c.cycle} | ${c.startDate} → ${c.endDate} | ${c.days ?? '-'} | ${c.distanceKm ?? '-'} | ${c.gallons ?? '-'} | ${c.effKmGal ?? '-'} | ${fmtCopPlain(c.pricePerGalCop)} | ${fmtCopPlain(c.totalCostCop)} | ${c.station || '-'} | ${c.gpsSeverity ?? '-'} |`);
        }
        lines.push('');
    }

    // Station honesty & optimal corridors
    if (Array.isArray(exec.stationRanking) && exec.stationRanking.length > 0) {
        lines.push('## 3. Estaciones Evaluadas');
        for (const s of exec.stationRanking) {
            lines.push(`- **${s.station}:** ${s.avgEffKmGal} km/gal (${s.cycles} ciclos, desvío ajustado ${s.residualPct > 0 ? '+' : ''}${s.residualPct}%)`);
        }
        lines.push('');
    }
    if (Array.isArray(exec.optimalCorridors) && exec.optimalCorridors.length > 0) {
        lines.push('## 4. Corredores y Horario Óptimo');
        for (const c of exec.optimalCorridors) {
            lines.push(`- **${c.corridor}:** Mejor salida ${c.bestWindow} (${c.bestDurationMin} min, ahorra ${c.savedMin} min / ${fmtCopPlain(c.savedCopPerTrip)} por viaje, n=${c.samples})`);
        }
        lines.push('');
    }

    // Rides & finances
    if (analysis.rides) {
        const rs = analysis.rides.summary || {};
        lines.push('## 5. Carreras y Rentabilidad');
        lines.push(`- **Bruto:** ${fmtCopPlain(rs.grossIncomeCop)} · **Egresos/Pases:** ${fmtCopPlain(rs.expensesAndPassesCop)} · **Gasolina carreras:** ${fmtCopPlain(rs.rideFuelCostCop)} · **Ganancia neta libre:** ${fmtCopPlain(rs.netFreeProfitCop)}`);
        if (rs.totalExtraWorkKm) {
            lines.push(`- **Km trabajo:** ${rs.totalExtraWorkKm} km (${rs.declaredWorkKm ?? 0} efectivos + ${rs.estimatedPickupKm ?? 0} recogida) · Cobertura gasolina carro: ${rs.fuelCoveragePct ?? '--'}%`);
        }
        if (analysis.rides.byPlatform) {
            const pLine = Object.entries(analysis.rides.byPlatform)
                .map(([p, d]) => `${p}: ${d.rides} carreras, ${fmtCopPlain(d.grossCop)}, ${d.km} km`)
                .join(' · ');
            lines.push(`- **Por plataforma:** ${pLine}`);
        }
        if (Array.isArray(analysis.rides.sessions) && analysis.rides.sessions.length > 0) {
            const recentSessions = analysis.rides.sessions.slice(-40);
            lines.push('');
            lines.push(`### Movimientos recientes (${recentSessions.length} de ${analysis.rides.sessions.length})`);
            lines.push('| Fecha | Hora | Tipo | Plataforma | Modo | Monto | Km | Nota |');
            lines.push('|---|---|---|---|---|---:|---:|---|');
            for (const s of recentSessions) {
                const amt = s.type === 'expense' ? `-${fmtCopPlain(s.expenseCop)}` : fmtCopPlain(s.grossCop);
                lines.push(`| ${s.date} | ${s.time || '-'} | ${s.type} | ${s.platform || '-'} | ${s.mode || '-'} | ${amt} | ${s.distanceKm ?? '-'} | ${(s.note || '-').replace(/\|/g, '/')} |`);
            }
        }
        lines.push('');
    }

    // Maintenance
    if (Array.isArray(analysis.maintenance) && analysis.maintenance.length > 0) {
        lines.push('## 6. Mantenimiento y Desgaste');
        lines.push('| Componente | Intervalo | Último servicio | Km usados (equiv.) | Factor | Restantes |');
        lines.push('|---|---:|---|---:|---:|---:|');
        for (const m of analysis.maintenance) {
            const last = m.lastServiceOdoKm ? `${m.lastServiceOdoKm.toLocaleString('es-CO')} km (${m.lastServiceDate || '-'})` : 'Sin registro';
            const used = m.equivalentKmUsed != null && m.equivalentKmUsed !== m.realKmUsed
                ? `${m.realKmUsed ?? 0} (${m.equivalentKmUsed})`
                : `${m.realKmUsed ?? 0}`;
            lines.push(`| ${m.name} | ${m.intervalKm} km | ${last} | ${used} | ${m.stressMultiplier ? `${m.stressMultiplier}x` : '1.0x'} | ${m.kmRemaining != null ? `${m.kmRemaining} km` : '-'} |`);
        }
        lines.push('');
    }

    // GPS Daily Summary (latest 45 days for readable prompt length, full data in JSON)
    if (Array.isArray(analysis.gpsDailySummary) && analysis.gpsDailySummary.length > 0) {
        const recentDays = analysis.gpsDailySummary.slice(-45);
        lines.push(`## 7. Actividad Diaria GPS (${recentDays.length} de ${analysis.gpsDailySummary.length} días, sin coordenadas)`);
        lines.push('| Fecha | Km | Viajes | Marcha (min) | Ralentí (min) | Vel Prom | Gal | Costo | Calibrado |');
        lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---|');
        for (const d of recentDays) {
            lines.push(`| ${d.date} | ${d.km ?? 0} | ${d.trips ?? '-'} | ${d.runMin ?? '-'} | ${d.idleMin ?? 0} | ${d.avgSpeedKmh ?? '-'} | ${d.gallons ?? '-'} | ${d.costCop != null ? fmtCopPlain(d.costCop) : '-'} | ${d.calibrated ? 'Sí' : 'Est.'} |`);
        }
        lines.push('');
    }

    // Recent GPS trips (latest 40 trips without coordinates)
    if (Array.isArray(analysis.gpsTrips) && analysis.gpsTrips.length > 0) {
        const recentTrips = analysis.gpsTrips.slice(-40);
        lines.push(`## 8. Viajes Recientes (${recentTrips.length} de ${analysis.gpsTrips.length}, sin trazados)`);
        lines.push('| Fecha | Horario | Ruta | Km | Min | Gal | Costo |');
        lines.push('|---|---|---|---:|---:|---:|---:|');
        for (const t of recentTrips) {
            const route = `${t.origin || '?'} → ${t.destination || '?'}`.replace(/\|/g, '/');
            lines.push(`| ${t.date} | ${t.start || '--'}-${t.end || '--'} | ${route} | ${t.km ?? '-'} | ${t.durationMin ?? '-'} | ${t.gallons ?? '-'} | ${t.costCop != null ? fmtCopPlain(t.costCop) : '-'} |`);
        }
        lines.push('');
    }

    // Telemetry logs
    if (Array.isArray(analysis.telemetryLogs) && analysis.telemetryLogs.length > 0) {
        const recentLogs = analysis.telemetryLogs.slice(-30);
        lines.push(`## 9. Registro de Tanqueadas y Lecturas (${recentLogs.length} de ${analysis.telemetryLogs.length})`);
        lines.push('| Fecha | Tipo | Odómetro | Gal | Total | Full | Aguja | Pre-tanqueo | Estación |');
        lines.push('|---|---|---:|---:|---:|---|---:|---:|---|');
        for (const l of recentLogs) {
            lines.push(`| ${l.date} | ${l.type} | ${l.odometerKm ?? '-'} | ${l.gallonsAdded ?? '-'} | ${l.totalCostCop ? fmtCopPlain(l.totalCostCop) : '-'} | ${l.fullTank ? 'Sí' : '-'} | ${l.gaugePct != null ? `${l.gaugePct}%` : '-'} | ${l.preRefuelGaugePct != null ? `${l.preRefuelGaugePct}%` : '-'} | ${l.station || '-'} |`);
        }
        lines.push('');
    }

    // Legal docs & notes
    if (Array.isArray(analysis.legalDocs) && analysis.legalDocs.length > 0) {
        lines.push('## 10. Documentos Legales');
        for (const doc of analysis.legalDocs) {
            lines.push(`- **${doc.name}:** vence ${doc.expiryDate || 'sin fecha'}${doc.daysRemaining != null ? ` (${doc.daysRemaining} días)` : ''}`);
        }
        lines.push('');
    }

    if (Array.isArray(analysis.notes) && analysis.notes.length > 0) {
        lines.push('## 11. Notas');
        for (const n of analysis.notes.slice(0, 20)) {
            lines.push(`- **[${n.date || '-'}] ${n.title || n.category || 'Nota'}:** ${n.content || ''}`);
        }
        lines.push('');
    }

    return lines.join('\n').trim() + '\n';
}

/**
 * Inspects and validates an uploaded backup JSON string or parsed object BEFORE touching IndexedDB.
 * Blocks accidental restoration of non-restorable AI analysis exports and returns a clear manifest.
 *
 * @param {string|Object} rawInput
 * @returns {Object}
 */
export function inspectBackupPayload(rawInput) {
    let parsed = rawInput;
    if (typeof rawInput === 'string') {
        if (!rawInput.trim()) {
            return { ok: false, kind: 'invalid_json', error: 'El archivo está vacío.' };
        }
        try {
            parsed = JSON.parse(rawInput);
        } catch (err) {
            return { ok: false, kind: 'invalid_json', error: `El archivo no tiene formato válido (${err.message}).` };
        }
    }

    if (!parsed || typeof parsed !== 'object') {
        return { ok: false, kind: 'unknown', error: 'Estructura de archivo no reconocida.' };
    }

    // Explicitly block non-restorable AI analysis exports
    if (parsed.meta?.format === AI_EXPORT_FORMAT || parsed.restorable === false) {
        return {
            ok: false,
            kind: 'ai_analysis_export',
            error: 'Este archivo es un informe para IA (no restaurable). Selecciona un respaldo completo.'
        };
    }

    // Full master backup (v2 or v1 or legacy flat object with stores)
    const isFullBackup = Boolean(
        !Array.isArray(parsed) &&
        (
            parsed.backupType === FULL_BACKUP_TYPE ||
            parsed.stores ||
            parsed.version ||
            (parsed.vehicle_profile && parsed.telemetry_logs) ||
            parsed.ride_sessions ||
            parsed.platform_passes
        )
    );

    if (isFullBackup) {
        const manifest = countSnapshotManifest(parsed);
        return {
            ok: true,
            kind: 'full_backup',
            version: parsed.version || 1,
            includesGpsTracks: parsed.includesGpsTracks !== undefined
                ? Boolean(parsed.includesGpsTracks)
                : manifest.gpsTrackPoints > 0,
            manifest,
            parsed
        };
    }

    // Legacy flat array of telemetry readings
    const rawList = Array.isArray(parsed)
        ? parsed
        : (parsed.records || parsed.data || parsed.telemetry_logs || null);

    if (Array.isArray(rawList) && rawList.length > 0) {
        return {
            ok: true,
            kind: 'legacy_array',
            count: rawList.length,
            manifest: {
                vehicleName: 'Lecturas históricas',
                exportedAt: null,
                telemetryLogs: rawList.length,
                maintenanceItems: 0,
                maintenanceServices: 0,
                rideSessions: 0,
                platformPasses: 0,
                legalDocs: 0,
                freeNotes: 0,
                gpsDays: 0,
                gpsTrips: 0,
                gpsTrackPoints: 0
            },
            parsed
        };
    }

    return {
        ok: false,
        kind: 'unknown',
        error: 'Estructura no reconocida. Se esperaba un respaldo completo o un listado de lecturas.'
    };
}

/**
 * Estimates exact payload sizes across all export modes so the UI can display live feedback.
 *
 * @param {Object} snapshot
 * @param {Object} [options={}]
 * @returns {Object}
 */
export function estimateExportSizes(snapshot, options = {}) {
    const aiAnalysis = buildLlmAnalysisExport(snapshot, options);
    const aiMarkdown = buildLlmMarkdownReport(aiAnalysis, options);
    const fullWithTracks = buildFullBackupPayload(snapshot, { ...options, includeGpsTracks: true, scrubCredentials: true });
    const fullWithoutTracks = buildFullBackupPayload(snapshot, { ...options, includeGpsTracks: false, scrubCredentials: true });

    const aiJsonBytes = estimateUtf8Bytes(JSON.stringify(aiAnalysis, null, 2));
    const aiMarkdownBytes = estimateUtf8Bytes(aiMarkdown);
    const fullWithTracksBytes = estimateUtf8Bytes(JSON.stringify(fullWithTracks));
    const fullWithoutTracksBytes = estimateUtf8Bytes(JSON.stringify(fullWithoutTracks));

    const trackBytesSaved = Math.max(0, fullWithTracksBytes - fullWithoutTracksBytes);
    const aiReductionPct = fullWithTracksBytes > 0
        ? Math.max(0, Math.round((1 - (aiJsonBytes / fullWithTracksBytes)) * 100))
        : 0;

    return {
        aiJsonBytes,
        aiJsonLabel: formatByteSize(aiJsonBytes),
        aiMarkdownBytes,
        aiMarkdownLabel: formatByteSize(aiMarkdownBytes),
        fullWithTracksBytes,
        fullWithTracksLabel: formatByteSize(fullWithTracksBytes),
        fullWithoutTracksBytes,
        fullWithoutTracksLabel: formatByteSize(fullWithoutTracksBytes),
        trackPointsCount: fullWithTracks.manifest?.gpsTrackPoints || 0,
        trackBytesSaved,
        trackBytesSavedLabel: formatByteSize(trackBytesSaved),
        aiReductionPct
    };
}
