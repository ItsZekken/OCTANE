/**
 * OCTANE // KINETIC — Export, AI Digest & Backup Unit Test Suite
 * Run with: node tests/test-export-backup.js
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    AI_EXPORT_FORMAT,
    FULL_BACKUP_TYPE,
    EXPORT_SCHEMA_VERSION,
    formatByteSize,
    countSnapshotManifest,
    buildFullBackupPayload,
    buildLlmAnalysisExport,
    buildLlmMarkdownReport,
    inspectBackupPayload,
    estimateExportSizes
} from '../src/core/export-engine.js';
import { analyzeElectricalHealth } from '../src/core/vehicle-health-engine.js';
import { analyzeOptimalDeparture } from '../src/core/geospatial-intelligence.js';
import { normalizePlatformName } from '../src/core/rides-engine.js';
import { normalizeMaintenanceItem } from '../src/core/db-local.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  ✓ ${name}`);
    } catch (err) {
        failed++;
        console.error(`  ✗ ${name}`);
        console.error('   ', err.message || err);
    }
}

function makeRichSnapshotWithHugeTracks() {
    const HOME = { lat: 10.9878, lng: -74.7889 };
    const WORK = { lat: 11.0155, lng: -74.8122 };
    const bigTrack = Array.from({ length: 1200 }, (_, i) => ({
        lat: Number((HOME.lat + (i * 0.00002)).toFixed(6)),
        lng: Number((HOME.lng - (i * 0.00002)).toFixed(6)),
        speed: 30 + (i % 25),
        ts: 1785500000000 + i * 5000
    }));

    const tripsByDate = {};
    const days = {};
    const dates = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07'];
    dates.forEach((d, idx) => {
        days[d] = { km: 28.5 + idx, runNo: 2, runTimeSec: 3600, idleAccOnSec: 420, avgSpeed: 28, maxSpeed: 64 };
        tripsByDate[d] = [
            {
                id: `trip_am_${idx}`,
                date: d,
                startTimeHm: '07:15',
                endTimeHm: '07:45',
                startTimeMs: Date.parse(`${d}T12:15:00Z`),
                endTimeMs: Date.parse(`${d}T12:45:00Z`),
                startLat: HOME.lat,
                startLng: HOME.lng,
                endLat: WORK.lat,
                endLng: WORK.lng,
                startAddress: 'Calle 56 #13-13',
                endAddress: 'Cra 53 #76-20',
                distanceKm: 12.2,
                durationMin: 30,
                stoppedMin: 4.5,
                avgSpeedKmh: 24.4,
                maxSpeedKmh: 58,
                calibratedGallons: 0.36,
                calibratedCostCop: 5760,
                isCalibrated: true,
                coldPenaltyPct: 8,
                hardBrakes: 2,
                trackPoints: bigTrack
            },
            {
                id: `trip_pm_${idx}`,
                date: d,
                startTimeHm: '17:30',
                endTimeHm: '18:05',
                startTimeMs: Date.parse(`${d}T22:30:00Z`),
                endTimeMs: Date.parse(`${d}T23:05:00Z`),
                startLat: WORK.lat,
                startLng: WORK.lng,
                endLat: HOME.lat,
                endLng: HOME.lng,
                startAddress: 'Cra 53 #76-20',
                endAddress: 'Calle 56 #13-13',
                distanceKm: 12.8,
                durationMin: 35,
                stoppedMin: 6.0,
                avgSpeedKmh: 21.9,
                maxSpeedKmh: 55,
                estGallons: 0.39,
                estCostCop: 6240,
                trackPoints: bigTrack
            }
        ];
    });

    return {
        version: 1,
        exportedAt: '2026-08-10T15:00:00.000Z',
        stores: {
            vehicle_profile: [{
                id: 'main',
                name: 'Kia Picanto 1.0L',
                tankCapacityLiters: 35.0,
                tankCapacityGallons: 9.25,
                reserveLiters: 5.0,
                fuelPriceCop: 16000,
                routineDailyKm: 24,
                gpsConfig: {
                    enabled: true,
                    username: 'demo_user_secret',
                    password: 'super_secret_password_123',
                    imei: '999888777666555',
                    accountId: 4242,
                    proxyUrl: 'https://private-worker.example.dev'
                },
                gpsCache: {
                    live: {
                        totalMile: 96350,
                        externalVoltage: 12.62,
                        accStatus: false,
                        lat: HOME.lat,
                        lng: HOME.lng,
                        address: 'Calle 56 #13-13'
                    },
                    days,
                    tripsByDate,
                    voltageHistory: [
                        { ts: Date.parse('2026-08-01T12:00:00Z'), v: 12.66, acc: false, speed: 0 },
                        { ts: Date.parse('2026-08-05T12:00:00Z'), v: 14.20, acc: true, speed: 40 },
                        { ts: Date.parse('2026-08-09T12:00:00Z'), v: 12.62, acc: false, speed: 0 }
                    ],
                    notifiedStopIds: ['stop_1', 'stop_2']
                },
                learnedGasStations: [
                    { id: 'st_terpel', name: 'Terpel Murillo', lat: 10.995, lng: -74.795, radiusMeters: 80 }
                ]
            }],
            telemetry_logs: [
                {
                    id: 'log_1',
                    date: '2026-07-29',
                    odometer_reading: 96000,
                    gallons_added: 6.2,
                    total_cost_cop: 99200,
                    is_full_tank: true,
                    fuel_level_percent: 100,
                    pre_refuel_gauge_pct: 32,
                    stationId: 'st_terpel',
                    stationName: 'Terpel Murillo'
                },
                {
                    id: 'log_2',
                    date: '2026-08-08',
                    odometer_reading: 96220,
                    gallons_added: 6.1,
                    total_cost_cop: 97600,
                    is_full_tank: true,
                    fuel_level_percent: 100,
                    pre_refuel_gauge_pct: 29,
                    stationId: 'st_terpel',
                    stationName: 'Terpel Murillo'
                }
            ],
            maintenance_items: [
                {
                    id: 'maint_oil_filter',
                    name: 'ACEITE + FILTRO',
                    category: 'oil',
                    group: 'motor',
                    intervalKm: 5000,
                    lastServiceOdo: 95000,
                    lastServiceDate: '2026-07-15',
                    history: [
                        {
                            id: 'h1',
                            date: '2026-07-15',
                            odometer: 95000,
                            costCop: 185000,
                            workshop: 'Lubricentro Norte',
                            specs: { viscosity: '5W-30', type: 'Sintético' }
                        }
                    ]
                }
            ],
            free_notes: [
                { id: 'n1', date: '2026-08-06', category: 'Taller', title: 'Presión llantas', content: '32 PSI en las cuatro', isPinned: true }
            ],
            legal_docs: [
                { id: 'd1', name: 'SOAT', expiryDate: '2026-12-15', costCop: 450000 }
            ],
            ride_sessions: [
                { id: 'r1', date: '2026-08-07', time: '19:10', platform: 'Uber', mode: 'libre', grossEarnings: 22000, distanceKm: 11.4 },
                { id: 'r2', date: '2026-08-07', type: 'expense', platform: 'Recarga', amountCop: 4000 }
            ],
            platform_passes: []
        },
        deleted: []
    };
}

console.log('\nOCTANE // Export, AI Digest & Backup Engine Tests\n');

test('buildLlmAnalysisExport strips 100% of trackPoints, raw coordinates, and GPS credentials', () => {
    const snapshot = makeRichSnapshotWithHugeTracks();
    const analysis = buildLlmAnalysisExport(snapshot, { now: new Date('2026-08-10T15:00:00Z') });
    const serialized = JSON.stringify(analysis);

    assert.equal(analysis.meta.format, AI_EXPORT_FORMAT);
    assert.equal(analysis.meta.restorable, false);
    assert.equal(analysis.meta.schemaVersion, EXPORT_SCHEMA_VERSION);

    // Zero trackPoints or raw coordinate keys
    assert.equal(serialized.includes('trackPoints'), false, 'trackPoints must never appear in AI export');
    assert.equal(serialized.includes('startLat'), false, 'startLat must never appear in AI export');
    assert.equal(serialized.includes('startLng'), false, 'startLng must never appear in AI export');
    assert.equal(serialized.includes('10.9878'), false, 'Raw home latitude must not leak into AI export');
    assert.equal(serialized.includes('-74.7889'), false, 'Raw home longitude must not leak into AI export');

    // Zero credentials or secrets
    assert.equal(serialized.includes('super_secret_password_123'), false, 'GPS password must not leak');
    assert.equal(serialized.includes('demo_user_secret'), false, 'GPS username must not leak');
    assert.equal(serialized.includes('999888777666555'), false, 'GPS IMEI must not leak');
    assert.equal(serialized.includes('private-worker.example.dev'), false, 'GPS proxy URL must not leak');
    assert.equal(serialized.includes('notifiedStopIds'), false, 'Internal notifiedStopIds noise must not appear');

    // Rich computed intelligence IS present
    assert.equal(analysis.vehicle.name, 'Kia Picanto 1.0L');
    assert.equal(analysis.fuelCycles.length, 1);
    assert.equal(analysis.telemetryLogs.length, 2);
    assert.equal(analysis.telemetryLogs[0].preRefuelGaugePct, 32);
    assert.equal(analysis.gpsDailySummary.length, 5);
    assert.equal(analysis.gpsTrips.length, 10);
    assert.equal(analysis.gpsTrips[0].origin, 'CASA');
    assert.equal(analysis.gpsTrips[0].destination, 'TRABAJO');
    assert.ok(analysis.executiveSummary.gaugeCalibration.sampleCount >= 2);
    assert.ok(analysis.executiveSummary.electricalHealth.restingVoltageV > 12);
    assert.equal(analysis.rides.sessions.length, 2);
    assert.equal(analysis.maintenance.length, 1);
    assert.equal(analysis.maintenance[0].history[0].specs.viscosity, '5W-30');
    assert.equal(analysis.legalDocs[0].name, 'SOAT');
    assert.equal(analysis.notes[0].title, 'Presión llantas');
});

test('estimateExportSizes proves massive size reduction (>95%) between full trackPoints snapshot and AI export', () => {
    const snapshot = makeRichSnapshotWithHugeTracks();
    const sizes = estimateExportSizes(snapshot, { now: new Date('2026-08-10T15:00:00Z') });

    assert.equal(sizes.trackPointsCount, 12000);
    assert.ok(sizes.fullWithTracksBytes > 500_000, `Expected full backup > 500KB, got ${sizes.fullWithTracksBytes}`);
    assert.ok(sizes.aiJsonBytes < 30_000, `Expected AI JSON < 30KB, got ${sizes.aiJsonBytes}`);
    assert.ok(sizes.aiMarkdownBytes < 20_000, `Expected AI Markdown < 20KB, got ${sizes.aiMarkdownBytes}`);
    assert.ok(sizes.aiReductionPct >= 95, `Expected >= 95% reduction, got ${sizes.aiReductionPct}%`);
    assert.ok(sizes.fullWithoutTracksBytes < sizes.fullWithTracksBytes * 0.1);
    assert.equal(formatByteSize(512), '512 B');
    assert.equal(formatByteSize(20480), '20 KB');
    assert.equal(formatByteSize(2 * 1024 * 1024), '2.00 MB');
});

test('buildLlmMarkdownReport generates clean Markdown tables with zero coordinates and zero secrets', () => {
    const snapshot = makeRichSnapshotWithHugeTracks();
    const md = buildLlmMarkdownReport(snapshot, { now: new Date('2026-08-10T15:00:00Z') });

    assert.ok(md.includes('# OCTANE — Informe de Telemetría (Kia Picanto 1.0L)'));
    assert.ok(md.includes('## 1. Resumen Ejecutivo'));
    assert.ok(md.includes('## 2. Ciclos de Combustible'));
    assert.ok(md.includes('## 5. Carreras y Rentabilidad'));
    assert.ok(md.includes('## 6. Mantenimiento y Desgaste'));
    assert.ok(md.includes('CASA → TRABAJO'));
    assert.equal(md.includes('super_secret_password_123'), false);
    assert.equal(md.includes('10.9878'), false);
    assert.equal(md.includes('trackPoints'), false);
});

test('buildFullBackupPayload scrubs GPS password, preserves full restore fidelity, never mutates input, and supports lightweight mode', () => {
    const snapshot = makeRichSnapshotWithHugeTracks();

    const full = buildFullBackupPayload(snapshot, { includeGpsTracks: true, scrubCredentials: true });
    assert.equal(full.backupType, FULL_BACKUP_TYPE);
    assert.equal(full.version, EXPORT_SCHEMA_VERSION);
    assert.equal(full.restorable, true);
    assert.equal(full.includesGpsTracks, true);
    assert.equal(full.credentialsScrubbed, true);
    assert.equal(full.stores.vehicle_profile[0].gpsConfig.password, '');
    assert.equal(full.stores.vehicle_profile[0].gpsConfig.username, 'demo_user_secret');
    assert.equal(full.manifest.gpsTrackPoints, 12000);
    assert.equal(full.manifest.telemetryLogs, 2);
    assert.equal(full.manifest.maintenanceServices, 1);

    // Input snapshot must remain completely untouched
    assert.equal(snapshot.stores.vehicle_profile[0].gpsConfig.password, 'super_secret_password_123');

    // Lightweight restorable mode strips trackPoints while keeping trips and all 7 stores
    const light = buildFullBackupPayload(snapshot, { includeGpsTracks: false, scrubCredentials: true });
    assert.equal(light.restorable, true);
    assert.equal(light.includesGpsTracks, false);
    assert.equal(light.manifest.gpsTrackPoints, 0);
    assert.equal(light.manifest.gpsTrips, 10);
    assert.equal(light.stores.telemetry_logs.length, 2);
    assert.equal(snapshot.stores.vehicle_profile[0].gpsCache.tripsByDate['2026-08-03'][0].trackPoints.length, 1200);
});

test('inspectBackupPayload blocks AI-only analysis exports and validates full v2, legacy v1, and legacy array files', () => {
    const snapshot = makeRichSnapshotWithHugeTracks();

    // 1. AI analysis export must be blocked from restore
    const aiExport = buildLlmAnalysisExport(snapshot);
    const aiCheck = inspectBackupPayload(JSON.stringify(aiExport));
    assert.equal(aiCheck.ok, false);
    assert.equal(aiCheck.kind, 'ai_analysis_export');
    assert.ok(aiCheck.error.toLowerCase().includes('no restaurable'));

    // 2. Full v2 backup passes with exact manifest
    const fullV2 = buildFullBackupPayload(snapshot, { includeGpsTracks: true });
    const v2Check = inspectBackupPayload(JSON.stringify(fullV2));
    assert.equal(v2Check.ok, true);
    assert.equal(v2Check.kind, 'full_backup');
    assert.equal(v2Check.version, 2);
    assert.equal(v2Check.includesGpsTracks, true);
    assert.equal(v2Check.manifest.vehicleName, 'Kia Picanto 1.0L');
    assert.equal(v2Check.manifest.telemetryLogs, 2);

    // 3. Legacy v1 snapshot passes
    const v1Check = inspectBackupPayload(JSON.stringify(snapshot));
    assert.equal(v1Check.ok, true);
    assert.equal(v1Check.kind, 'full_backup');
    assert.equal(v1Check.manifest.gpsDays, 5);

    // 4. Legacy flat array passes
    const arrayCheck = inspectBackupPayload(JSON.stringify([
        { date: '2026-08-01', odometer_reading: 95000, gallons_added: 5.5 }
    ]));
    assert.equal(arrayCheck.ok, true);
    assert.equal(arrayCheck.kind, 'legacy_array');
    assert.equal(arrayCheck.count, 1);

    // 5. Corrupt JSON fails gracefully
    const corruptCheck = inspectBackupPayload('{bad json');
    assert.equal(corruptCheck.ok, false);
    assert.equal(corruptCheck.kind, 'invalid_json');
});

test('countSnapshotManifest handles empty snapshot safely without throwing', () => {
    const manifest = countSnapshotManifest({});
    assert.equal(manifest.telemetryLogs, 0);
    assert.equal(manifest.gpsTrackPoints, 0);
    assert.equal(manifest.vehicleName, 'Vehículo');

    const emptyAi = buildLlmAnalysisExport({});
    assert.equal(emptyAi.meta.format, AI_EXPORT_FORMAT);
    const emptyMd = buildLlmMarkdownReport({});
    assert.ok(emptyMd.includes('# OCTANE — Informe de Telemetría'));
});

test('Regression 1: Healthy 12.97V resting battery with 14.41V alternator is ÓPTIMA (never false DESGASTE)', () => {
    const nowMs = Date.parse('2026-08-20T12:00:00Z');
    const dayMs = 86400000;
    const healthySurfaceDrop = [
        { ts: nowMs - 15 * dayMs, v: 13.15, acc: false, speed: 0 },
        { ts: nowMs - 8 * dayMs, v: 13.02, acc: false, speed: 0 },
        { ts: nowMs - 1 * dayMs, v: 12.97, acc: false, speed: 0 },
        { ts: nowMs - 2 * dayMs, v: 14.41, acc: true, speed: 45 }
    ];
    const health = analyzeElectricalHealth(healthySurfaceDrop, null, null, nowMs);
    assert.equal(health.restingStatus, 'ÓPTIMA');
    assert.equal(health.chargingStatus, 'NOMINAL');
    assert.equal(health.alerts.length, 0);

    // Genuine low resting voltage (< 12.30V) DOES flag DESGASTE
    const lowBattery = [
        { ts: nowMs - 5 * dayMs, v: 12.26, acc: false, speed: 0 },
        { ts: nowMs - 1 * dayMs, v: 12.24, acc: false, speed: 0 }
    ];
    const lowHealth = analyzeElectricalHealth(lowBattery, null, null, nowMs);
    assert.equal(lowHealth.restingStatus, 'DESGASTE');
    assert.equal(lowHealth.alerts.length, 1);
});

test('Regression 2 & 3: Report has zero "null" text, populates activeTank/physics/gallons, and excludes impossible >70 km/gal cycles', () => {
    const snapshot = makeRichSnapshotWithHugeTracks();
    // Inject a partial-residual impossible cycle (884 km/gal: 265 km / 0.30 gal -> 883 km/gal)
    snapshot.stores.telemetry_logs.unshift(
        {
            id: 'log_0a',
            date: '2026-06-06',
            odometer_reading: 95600,
            gallons_added: 0.3,
            total_cost_cop: 4800,
            is_full_tank: true,
            fuel_level_percent: 100
        },
        {
            id: 'log_0b',
            date: '2026-06-16',
            odometer_reading: 95865,
            gallons_added: 0.3,
            total_cost_cop: 4800,
            is_full_tank: true,
            fuel_level_percent: 100
        }
    );

    const analysis = buildLlmAnalysisExport(snapshot, { now: new Date('2026-08-10T15:00:00Z') });
    const md = buildLlmMarkdownReport(analysis, { now: new Date('2026-08-10T15:00:00Z') });

    // Zero broken "null" strings anywhere in Markdown!
    assert.equal(md.includes('null'), false, 'Markdown report must never contain literal "null"');
    assert.equal(md.includes('undefined'), false, 'Markdown report must never contain literal "undefined"');

    // Active tank, physics, gauge calibration, and cycle gallons all populated cleanly
    assert.ok(analysis.executiveSummary.activeTank.estimatedGallons > 0);
    assert.ok(analysis.executiveSummary.activeTank.estimatedPct > 0);
    assert.ok(analysis.executiveSummary.activeTank.estimatedRangeKm > 0);
    assert.ok(analysis.executiveSummary.fuelPhysics.coeffs.galPerKmBase > 0);
    assert.ok(analysis.executiveSummary.fuelPhysics.coeffs.galPerIdleHour > 0);
    assert.ok(analysis.executiveSummary.gaugeCalibration.knots.every(k => Number.isFinite(k.needlePct) && Number.isFinite(k.realGal)));

    // Impossible 883 km/gal cycle is excluded from valid fuelCycles and tracked in excludedAnomalousCycles
    assert.ok(analysis.fuelCycles.every(c => c.effKmGal <= 70 && c.gallons > 0));
    assert.ok(Array.isArray(analysis.excludedAnomalousCycles) && analysis.excludedAnomalousCycles.length >= 1);
    assert.equal(md.includes('883'), false, 'Impossible cycle must not pollute main Markdown cycle table');
    assert.ok(md.includes('6.1'), 'Real gallons (6.1) must appear in cycle table');
    assert.ok(md.includes('Terpel Murillo'), 'Station name must appear in cycle table');

    // Uncalibrated gauge model renders clean fallback without null knots
    const uncalSnapshot = makeRichSnapshotWithHugeTracks();
    uncalSnapshot.stores.telemetry_logs.forEach(l => { delete l.pre_refuel_gauge_pct; });
    const uncalMd = buildLlmMarkdownReport(uncalSnapshot, { now: new Date('2026-08-10T15:00:00Z') });
    assert.equal(uncalMd.includes('null'), false);
    assert.ok(uncalMd.includes('Sin calibrar aún'));
});

test('Regression 4: analyzeOptimalDeparture ignores parking micro-moves (< 3 km or CASA -> CASA)', () => {
    const HOME = { lat: 10.9878, lng: -74.7889 };
    const semanticPlaces = {
        home: { label: 'CASA', lat: HOME.lat, lng: HOME.lng },
        work: null,
        stations: []
    };
    const parkingMoves = Array.from({ length: 10 }, (_, i) => ({
        date: `2026-08-${String(i + 1).padStart(2, '0')}`,
        startTimeHm: '08:05',
        durationMin: 1,
        distanceKm: 0.08,
        estCostCop: 120,
        startLat: HOME.lat,
        startLng: HOME.lng,
        endLat: HOME.lat + 0.0001,
        endLng: HOME.lng - 0.0001
    }));
    const corridors = analyzeOptimalDeparture(parkingMoves, { semanticPlaces });
    assert.equal(corridors.length, 0, 'Parking moves (< 3 km / CASA -> CASA) must be ignored');
});

test('Regression 5: Rides unifies platform casing (Uber/UBER, DiDi/DIDI, InDrive/INDRIVE, Gyhsell/GYHSELL), populates expenses/net/km, and aligns historical totals', () => {
    assert.equal(normalizePlatformName('UBER'), 'Uber');
    assert.equal(normalizePlatformName('uber'), 'Uber');
    assert.equal(normalizePlatformName('GYHSELL'), 'Gyhsell');
    assert.equal(normalizePlatformName('INDRIVE'), 'InDrive');
    assert.equal(normalizePlatformName('DIDI'), 'DiDi');

    const snapshot = makeRichSnapshotWithHugeTracks();
    snapshot.stores.ride_sessions = [
        // Previous month
        { id: 'r_old_1', date: '2026-07-15', platform: 'UBER', mode: 'libre', grossEarnings: 30000, distanceKm: 15 },
        { id: 'r_old_2', date: '2026-07-16', platform: 'GYHSELL', mode: 'libre', grossEarnings: 25000, distanceKm: 12 },
        // Current month (August)
        { id: 'r_cur_1', date: '2026-08-07', platform: 'Uber', mode: 'libre', grossEarnings: 40000, distanceKm: 18 },
        { id: 'r_cur_2', date: '2026-08-07', platform: 'Gyhsell', mode: 'libre', grossEarnings: 20000, distanceKm: 10 },
        { id: 'r_cur_3', date: '2026-08-07', platform: 'DIDI', mode: 'libre', grossEarnings: 15000, distanceKm: 8 },
        { id: 'r_cur_4', date: '2026-08-07', platform: 'DiDi', mode: 'libre', grossEarnings: 10000, distanceKm: 5 },
        { id: 'r_cur_5', date: '2026-08-07', platform: 'INDRIVE', mode: 'libre', grossEarnings: 12000, distanceKm: 6 },
        { id: 'r_cur_6', date: '2026-08-07', platform: 'InDrive', mode: 'libre', grossEarnings: 8000, distanceKm: 4 },
        { id: 'r_exp_1', date: '2026-08-07', type: 'expense', platform: 'Recarga', amountCop: 6000 }
    ];
    snapshot.stores.platform_passes = [
        { id: 'p_1', date: '2026-08-07', platform: 'DIDI', costCop: 4000 }
    ];

    const analysis = buildLlmAnalysisExport(snapshot, { now: new Date('2026-08-10T15:00:00Z') });
    const rs = analysis.rides.summary;
    const platKeys = Object.keys(analysis.rides.byPlatform).sort();

    // Unified platform keys — zero case duplicates!
    assert.deepEqual(platKeys, ['DiDi', 'Gyhsell', 'InDrive', 'Uber']);

    // Historical summary gross === exact sum of byPlatform gross ($160,000)
    const sumPlatGross = Object.values(analysis.rides.byPlatform).reduce((s, p) => s + p.grossCop, 0);
    assert.equal(rs.grossIncomeCop, 160000);
    assert.equal(sumPlatGross, rs.grossIncomeCop, 'Historical summary gross must match byPlatform sum');

    // Non-zero expenses ($10,000), net profit, declared km (78 km), fuel coverage
    assert.equal(rs.expensesAndPassesCop, 10000);
    assert.ok(rs.netFreeProfitCop > 0, `Expected netFreeProfitCop > 0, got ${rs.netFreeProfitCop}`);
    assert.equal(rs.declaredWorkKm, 78);
    assert.ok(rs.totalExtraWorkKm >= 78);
    assert.ok(rs.fuelCoveragePct > 0);

    // Current month is reported separately and accurately ($105,000)
    assert.ok(analysis.rides.currentMonth);
    assert.equal(analysis.rides.currentMonth.summary.grossIncomeCop, 105000);

    const md = buildLlmMarkdownReport(analysis, { now: new Date('2026-08-10T15:00:00Z') });
    assert.ok(md.includes('Histórico total:'));
    assert.ok(md.includes('Mes actual (2026-08-01 a 2026-08-31):'));
    assert.equal(md.includes('UBER:'), false);
    assert.equal(md.includes('GYHSELL:'), false);
});

test('Regression 6: normalizeMaintenanceItem preserves historical lastServiceOdo and assigns deterministic IDs to legacy history entries', () => {
    const legacyCabin = normalizeMaintenanceItem({
        id: 'maint_cabin_filter',
        name: 'FILTRO CABINA A/C',
        category: 'cabin',
        intervalKm: 15000,
        lastServiceOdo: 93733,
        lastServiceDate: '2026-06-19',
        history: [{ date: '2026-06-19', odometer: 93733, costCop: 45000 }]
    });
    assert.equal(legacyCabin.lastServiceOdo, 93733);
    assert.equal(legacyCabin.lastServiceDate, '2026-06-19');
    assert.ok(legacyCabin.history[0].id, 'Legacy history entry must receive a stable ID so editing never resets odometer');
});

test('view-settings.js export/backup markup contains zero <p> tags and zero technical jargon (JSON/IndexedDB/etc.)', () => {
    const settingsPath = path.join(REPO_ROOT, 'src/views/view-settings.js');
    const raw = fs.readFileSync(settingsPath, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');

    assert.equal(/<p[\s>]/i.test(raw), false, 'view-settings.js must not contain <p> HTML tags');

    const templateTexts = [...raw.matchAll(/`([\s\S]*?)`/g)]
        .map(m => m[1])
        .filter(s => s.includes('<') && s.includes('>'))
        .map(s => s.replace(/\$\{[\s\S]*?\}/g, ' ').replace(/<[^>]+>/g, ' '))
        .join(' ');

    assert.equal(/\b(Ridge|Haversine|IndexedDB|EMA|OLS|MJ|JSON|Markdown)\b/i.test(templateTexts), false,
        'view-settings.js UI markup must not leak technical jargon');
});

console.log(`\nSummary: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
