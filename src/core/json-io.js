/**
 * OCTANE // KINETIC — Master Import / Export & AI Digest Orchestrator
 *
 * Dual-purpose export architecture:
 *   1. AI / Human-Readable Exports (zero GPS trackPoints, zero raw coordinates, zero credentials):
 *      - Structured JSON digest (`exportLlmAnalysisJson`)
 *      - Readable Markdown report (`exportLlmMarkdownReport`)
 *      - One-click clipboard copy (`copyLlmReportToClipboard`)
 *   2. Restorable Full Backup (`exportMasterBackup`):
 *      - All 7 IndexedDB stores + tombstones + manifest
 *      - Scrubs `gpsConfig.password` by default
 *      - Optional `includeGpsTracks` toggle to include or omit heavy route polylines
 *   3. Safe Pre-Restore Inspection & Import (`inspectBackupFile`, `importFromJSONString`, `importFromFile`):
 *      - Blocks accidental restoration of AI-only exports
 *      - Preserves local `gpsConfig.password` when restoring a scrubbed backup
 */

import { localYmd } from './date-utils.js';
import {
    exportAllStores,
    importAllStores,
    bulkAddTelemetryLogs,
    getTelemetryLogs,
    getVehicleProfile,
    saveVehicleProfile,
    getMaintenanceItems,
    normalizeTelemetryLog
} from './db-local.js';
import {
    buildFullBackupPayload,
    buildLlmAnalysisExport,
    buildLlmMarkdownReport,
    inspectBackupPayload,
    estimateExportSizes,
    formatByteSize,
    estimateUtf8Bytes,
    countSnapshotManifest
} from './export-engine.js';
import { store, showToast } from './state.js';
import { triggerCloudSync } from './firebase-sync.js';

export {
    buildFullBackupPayload,
    buildLlmAnalysisExport,
    buildLlmMarkdownReport,
    inspectBackupPayload,
    estimateExportSizes,
    formatByteSize,
    countSnapshotManifest
};

function triggerBrowserDownload(content, fileName, mimeType) {
    if (typeof document === 'undefined') return;
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function copyTextToClipboard(text) {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
        return true;
    }
    if (typeof document !== 'undefined') {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) return true;
    }
    throw new Error('Portapapeles no disponible en este navegador.');
}

async function readFileAsText(file) {
    if (!file) throw new Error('No se seleccionó ningún archivo.');
    if (typeof file.text === 'function') {
        return file.text();
    }
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(e.target.error);
        reader.readAsText(file);
    });
}

/**
 * Computes live export sizes and record counts from IndexedDB without downloading anything.
 * @returns {Promise<Object>}
 */
export async function getExportMetricsSummary() {
    const snapshot = await exportAllStores();
    return {
        manifest: countSnapshotManifest(snapshot),
        sizes: estimateExportSizes(snapshot)
    };
}

/**
 * Downloads a compact, privacy-safe, AI/LLM-optimized structured JSON digest
 * (zero GPS trackPoints, zero raw coordinates, zero credentials).
 * @returns {Promise<{ payload: Object, bytes: number, sizeLabel: string }>}
 */
export async function exportLlmAnalysisJson() {
    try {
        const snapshot = await exportAllStores();
        const payload = buildLlmAnalysisExport(snapshot);
        const jsonString = JSON.stringify(payload, null, 2);
        const bytes = estimateUtf8Bytes(jsonString);
        const sizeLabel = formatByteSize(bytes);

        const dateStr = localYmd(new Date()).replace(/-/g, '');
        triggerBrowserDownload(jsonString, `octane_analisis_ia_${dateStr}.json`, 'application/json;charset=utf-8');

        showToast(`INFORME IA DESCARGADO · ${sizeLabel}`);
        return { payload, bytes, sizeLabel };
    } catch (err) {
        console.error('[OCTANE IO] Failed to export AI analysis JSON:', err);
        showToast('ERROR AL EXPORTAR INFORME');
        throw err;
    }
}

/**
 * Downloads a readable Markdown telemetry report for humans and LLMs.
 * @returns {Promise<{ markdown: string, bytes: number, sizeLabel: string }>}
 */
export async function exportLlmMarkdownReport() {
    try {
        const snapshot = await exportAllStores();
        const markdown = buildLlmMarkdownReport(snapshot);
        const bytes = estimateUtf8Bytes(markdown);
        const sizeLabel = formatByteSize(bytes);

        const dateStr = localYmd(new Date()).replace(/-/g, '');
        triggerBrowserDownload(markdown, `octane_informe_ia_${dateStr}.md`, 'text/markdown;charset=utf-8');

        showToast(`RESUMEN DESCARGADO · ${sizeLabel}`);
        return { markdown, bytes, sizeLabel };
    } catch (err) {
        console.error('[OCTANE IO] Failed to export AI Markdown report:', err);
        showToast('ERROR AL EXPORTAR RESUMEN');
        throw err;
    }
}

/**
 * Copies the compact readable Markdown report directly to the system clipboard
 * for instant pasting into any LLM chat.
 * @returns {Promise<{ markdown: string, bytes: number, sizeLabel: string }>}
 */
export async function copyLlmReportToClipboard() {
    try {
        const snapshot = await exportAllStores();
        const markdown = buildLlmMarkdownReport(snapshot);
        const bytes = estimateUtf8Bytes(markdown);
        const sizeLabel = formatByteSize(bytes);

        await copyTextToClipboard(markdown);
        showToast(`RESUMEN COPIADO · ${sizeLabel}`);
        return { markdown, bytes, sizeLabel };
    } catch (err) {
        console.error('[OCTANE IO] Failed to copy AI report:', err);
        showToast('NO SE PUDO COPIAR AL PORTAPAPELES');
        throw err;
    }
}

/**
 * Initiates browser download of a restorable full master backup containing all 7 stores.
 * Scrubs `gpsConfig.password` by default so credentials never leak to disk.
 *
 * @param {Object} [options={}]
 * @param {boolean} [options.includeGpsTracks=true]
 * @returns {Promise<Object>}
 */
export async function exportMasterBackup(options = {}) {
    try {
        const includeGpsTracks = options.includeGpsTracks !== false;
        const snapshot = await exportAllStores();
        const backup = buildFullBackupPayload(snapshot, {
            includeGpsTracks,
            scrubCredentials: true
        });
        const jsonString = includeGpsTracks
            ? JSON.stringify(backup)
            : JSON.stringify(backup, null, 2);
        const bytes = estimateUtf8Bytes(jsonString);
        const sizeLabel = formatByteSize(bytes);

        const now = new Date();
        const dateStr = localYmd(now).replace(/-/g, '');
        const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '');
        const prefix = includeGpsTracks ? 'octane_respaldo_completo' : 'octane_respaldo_ligero';
        const fileName = `${prefix}_${dateStr}_${timeStr}.json`;

        triggerBrowserDownload(jsonString, fileName, 'application/json;charset=utf-8');
        showToast(`RESPALDO DESCARGADO · ${sizeLabel}`);
        return backup;
    } catch (err) {
        console.error('[OCTANE IO] Failed to export master backup:', err);
        showToast('ERROR AL EXPORTAR RESPALDO');
        throw err;
    }
}

/**
 * Reads an uploaded file and inspects its structure/manifest before applying any restore.
 * @param {File} file
 * @returns {Promise<{ content: string, inspection: Object }>}
 */
export async function inspectBackupFile(file) {
    const content = await readFileAsText(file);
    const inspection = inspectBackupPayload(content);
    return { content, inspection };
}

/**
 * Parses a JSON string, validates it with `inspectBackupPayload`, and applies it to IndexedDB and State.
 * Blocks accidental restoration of AI-only exports and preserves local GPS password if backup scrubbed it.
 *
 * @param {string} jsonString
 * @returns {Promise<Object>} { type: string, count: number }
 */
export async function importFromJSONString(jsonString) {
    const inspection = inspectBackupPayload(jsonString);
    if (!inspection.ok) {
        throw new Error(inspection.error || 'Archivo de respaldo inválido.');
    }

    const parsed = inspection.parsed;

    if (inspection.kind === 'full_backup') {
        // Capture local GPS password before overwrite so restoring a scrubbed backup keeps GPS working
        let existingLocalGpsPassword = '';
        try {
            const currentProfile = await getVehicleProfile();
            existingLocalGpsPassword = currentProfile?.gpsConfig?.password || '';
        } catch (_) {}

        await importAllStores(parsed);

        let [profile, logs, maintenanceItems] = await Promise.all([
            getVehicleProfile(),
            getTelemetryLogs(),
            getMaintenanceItems()
        ]);

        if (existingLocalGpsPassword && profile && profile.gpsConfig && !profile.gpsConfig.password) {
            profile = {
                ...profile,
                gpsConfig: {
                    ...profile.gpsConfig,
                    password: existingLocalGpsPassword
                }
            };
            await saveVehicleProfile(profile);
        }

        store.setState({
            vehicleProfile: profile,
            telemetryLogs: logs,
            maintenanceItems,
            fuelPriceCop: profile.fuelPriceCop || store.getState().fuelPriceCop,
            selectedCycleIdx: null,
            warpKm: 0
        });

        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('octane:maintenance-updated', { detail: { items: maintenanceItems } }));
            window.dispatchEvent(new CustomEvent('octane:notes-changed'));
            window.dispatchEvent(new CustomEvent('octane:update-state', { detail: { restored: true } }));
        }

        triggerCloudSync();
        showToast('RESPALDO COMPLETO RESTAURADO');
        return {
            type: 'master_backup',
            count: logs.length,
            version: inspection.version || 1,
            manifest: inspection.manifest
        };
    }

    if (inspection.kind === 'legacy_array') {
        const rawList = Array.isArray(parsed)
            ? parsed
            : (parsed.records || parsed.data || parsed.telemetry_logs || []);

        const state = store.getState();
        const fuelPrice = state.fuelPriceCop || 16000;

        const normalizedList = rawList.map((item) => {
            const record = normalizeTelemetryLog(item);
            if ((!record.total_cost_cop || record.total_cost_cop <= 0) && record.gallons_added > 0) {
                record.total_cost_cop = Math.round(record.gallons_added * fuelPrice);
            }
            return record;
        });

        const count = await bulkAddTelemetryLogs(normalizedList);
        const updatedLogs = await getTelemetryLogs();

        store.setState({
            telemetryLogs: updatedLogs,
            selectedCycleIdx: null,
            warpKm: 0
        });

        triggerCloudSync();
        showToast(`${count} LECTURAS IMPORTADAS`);
        return {
            type: 'legacy_array',
            count
        };
    }

    throw new Error('Estructura no reconocida.');
}

/**
 * Imports data from an HTML File object.
 * @param {File} file
 * @returns {Promise<Object>}
 */
export async function importFromFile(file) {
    try {
        const content = await readFileAsText(file);
        return await importFromJSONString(content);
    } catch (err) {
        console.error('[OCTANE IO] Error importing file:', err);
        showToast(err.message || 'ERROR EN COPIA DE SEGURIDAD');
        throw err;
    }
}

/** Alias for importFromFile */
export const importJSONFile = importFromFile;
