/**
 * OCTANE // KINETIC — Master JSON Import / Export Engine
 * Dual-format support:
 *   1. Legacy Flat Telemetry Arrays (e.g., spicy_telemetry_pandas_dataset_2.json)
 *   2. Full System Master Snapshots (7 object stores + metadata):
 *      - vehicle_profile (STORES.VEHICLE_PROFILE)
 *      - telemetry_logs (STORES.TELEMETRY_LOGS)
 *      - maintenance_items (STORES.MAINTENANCE_ITEMS)
 *      - free_notes (STORES.FREE_NOTES)
 *      - legal_docs (STORES.LEGAL_DOCS)
 *      - ride_sessions (STORES.RIDE_SESSIONS)
 *      - platform_passes (STORES.PLATFORM_PASSES)
 */

import {
    STORES,
    exportAllStores,
    importAllStores,
    bulkAddTelemetryLogs,
    getTelemetryLogs,
    getVehicleProfile,
    normalizeTelemetryLog
} from './db-local.js';
import { store, showToast } from './state.js';
import { triggerCloudSync } from './firebase-sync.js';

/**
 * Initiates browser download of full master snapshot containing all 7 stores.
 * @returns {Promise<Object>}
 */
export async function exportMasterBackup() {
    try {
        const snapshot = await exportAllStores();
        const jsonString = JSON.stringify(snapshot, null, 2);

        if (typeof document !== 'undefined') {
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');

            const now = new Date();
            const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
            const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '');
            const fileName = `octane_kinetic_master_backup_${dateStr}_${timeStr}.json`;

            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }

        showToast('COPIA DE SEGURIDAD DESCARGADA');
        return snapshot;
    } catch (err) {
        console.error('[OCTANE IO] Failed to export master backup:', err);
        showToast('ERROR AL EXPORTAR');
        throw err;
    }
}

/**
 * Parses a JSON string, automatically detects whether it is a legacy flat array
 * or a master backup snapshot, and applies it to IndexedDB and State.
 * @param {string} jsonString
 * @returns {Promise<Object>} { type: string, count: number }
 */
export async function importFromJSONString(jsonString) {
    if (!jsonString || typeof jsonString !== 'string') {
        throw new Error('El contenido proporcionado no es una cadena JSON válida.');
    }

    let parsed;
    try {
        parsed = JSON.parse(jsonString);
    } catch (err) {
        throw new Error(`Error de sintaxis JSON: ${err.message}`);
    }

    // Determine payload format
    const isMasterSnapshot = Boolean(
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        (parsed.version || parsed.stores || (parsed.vehicle_profile && parsed.telemetry_logs) || parsed.ride_sessions || parsed.platform_passes)
    );

    if (isMasterSnapshot) {
        // CASE A: Full Master Snapshot
        await importAllStores(parsed);

        const [profile, logs] = await Promise.all([
            getVehicleProfile(),
            getTelemetryLogs(),
        ]);

        store.setState({
            vehicleProfile: profile,
            telemetryLogs: logs,
            fuelPriceCop: profile.fuelPriceCop || store.getState().fuelPriceCop,
        });

        triggerCloudSync();
        showToast('COPIA MAESTRA RESTAURADA');
        return {
            type: 'master_backup',
            count: logs.length,
            version: parsed.version || 1,
        };
    }

    // CASE B: Flat Array (Legacy Dataset / Pandas export)
    const rawList = Array.isArray(parsed)
        ? parsed
        : (parsed.records || parsed.data || parsed.telemetry_logs || null);

    if (Array.isArray(rawList) && rawList.length > 0) {
        const state = store.getState();
        const fuelPrice = state.fuelPriceCop || 16000;

        const normalizedList = rawList.map((item) => {
            const record = normalizeTelemetryLog(item);
            // If total_cost_cop is missing or zero but gallons were added, compute reasonable estimate
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
            warpKm: 0,
        });

        triggerCloudSync();
        showToast(`SYNC: ${count} LECTURAS IMPORTADAS`);
        return {
            type: 'legacy_array',
            count,
        };
    }

    throw new Error('Estructura JSON no reconocida. Se esperaba un arreglo de lecturas o un archivo de respaldo maestro.');
}

/**
 * Imports data from an HTML File object.
 * @param {File} file
 * @returns {Promise<Object>}
 */
export async function importFromFile(file) {
    if (!file) {
        throw new Error('No se seleccionó ningún archivo.');
    }

    try {
        let content = '';
        if (typeof file.text === 'function') {
            content = await file.text();
        } else {
            content = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.onerror = (e) => reject(e.target.error);
                reader.readAsText(file);
            });
        }

        return await importFromJSONString(content);
    } catch (err) {
        console.error('[OCTANE IO] Error importing file:', err);
        showToast(`ERROR EN COPIA DE SEGURIDAD: ${err.message}`);
        throw err;
    }
}

/** Alias for importFromFile */
export const importJSONFile = importFromFile;
