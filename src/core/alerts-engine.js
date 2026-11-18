/**
 * OCTANE // KINETIC — Tactical Alerts Engine ("Semáforo de Alertas")
 * Swiss Precision Safety Monitor for Legal Deadlines & Mechanical Wear.
 * 
 * Rules:
 * - Legal Documents:
 *   * Critical (Crimson): Days remaining <= 15 days (or expired <= 0)
 *   * Warning (Amber): Days remaining <= 30 days
 *   * Nominal (Volt): Days remaining > 30 days
 *   * Unregistered (Muted): No record or missing expiry date
 * - Maintenance Wear:
 *   * Critical (Crimson): Remaining KM <= 0 or < 500 KM (or lifePct < 10%)
 *   * Warning (Amber): Remaining KM < 1,000 KM (or lifePct <= 30%)
 *   * Nominal (Volt): Remaining KM >= 1,000 KM (and lifePct > 30%)
 * 
 * Silencio Verbal Absoluto: Prohibidos parrafos y etiquetas p, purely structured telemetry metrics.
 */

import { store } from './state.js';
import { getMaintenanceItems, getLegalDocs, getTelemetryLogs, getVehicleProfile } from './db-local.js';
import { calculateWearDialTelemetry } from '../components/cluster/wear-dial-card.js';

export const ALERT_THRESHOLDS = Object.freeze({
    LEGAL_CRITICAL_DAYS: 15,
    LEGAL_WARNING_DAYS: 30,
    MAINT_CRITICAL_KM: 500,
    MAINT_WARNING_KM: 1000,
});

let cachedAlerts = {
    criticalCount: 0,
    warningCount: 0,
    totalCount: 0,
    hasCritical: false,
    hasWarning: false,
    statusSummary: 'NOMINAL',
    statusColor: 'var(--accent-volt)',
    criticalAlerts: [],
    critical: [],
    warningAlerts: [],
    warning: [],
    allAlerts: [],
    all: [],
    topAlert: null,
    lastEvaluatedAt: null,
};

let isInitialized = false;

/**
 * Calculates remaining calendar days until expiration.
 * Normalizes to start of day (midnight) to prevent timezone errors.
 * @param {string|Date} expiryDateStr - YYYY-MM-DD or ISO string
 * @param {Date} [fromDate=new Date()]
 * @returns {number|null} Days remaining, or null if invalid
 */
export function calculateDaysRemaining(expiryDateStr, fromDate = new Date()) {
    if (!expiryDateStr) return null;
    let target;
    if (typeof expiryDateStr === 'string' && /^\d{4}-\d{2}-\d{2}/.test(expiryDateStr.trim())) {
        const parts = expiryDateStr.trim().slice(0, 10).split('-').map(Number);
        target = new Date(parts[0], parts[1] - 1, parts[2]);
    } else {
        target = new Date(expiryDateStr);
    }
    if (isNaN(target.getTime())) return null;

    let base;
    if (typeof fromDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(fromDate.trim())) {
        const parts = fromDate.trim().slice(0, 10).split('-').map(Number);
        base = new Date(parts[0], parts[1] - 1, parts[2]);
    } else {
        base = new Date(fromDate);
    }
    target.setHours(0, 0, 0, 0);
    base.setHours(0, 0, 0, 0);

    const diffMs = target.getTime() - base.getTime();
    return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Evaluates a single legal document and returns its classification metrics.
 * @param {Object} doc
 * @param {Date} [fromDate=new Date()]
 * @returns {Object}
 */
export function evaluateLegalDoc(doc, fromDate = new Date()) {
    if (!doc || !doc.expiryDate) {
        return {
            id: doc?.id || 'doc-unregistered',
            docType: doc?.docType || 'otro',
            title: doc?.title || 'DOCUMENTO',
            category: 'legal',
            status: 'SIN REGISTRO',
            severity: 'none',
            daysRemaining: null,
            label: 'SIN REGISTRO',
            color: 'var(--text-muted)',
            isExpired: false,
            isCritical: false,
            isWarning: false,
            message: 'SIN REGISTRO',
        };
    }

    const days = calculateDaysRemaining(doc.expiryDate, fromDate);
    const title = (doc.title || doc.docType || 'DOCUMENTO').toUpperCase();

    if (days === null) {
        return {
            id: doc.id,
            docType: doc.docType,
            title,
            category: 'legal',
            status: 'SIN REGISTRO',
            severity: 'none',
            daysRemaining: null,
            label: 'SIN REGISTRO',
            color: 'var(--text-muted)',
            isExpired: false,
            isCritical: false,
            isWarning: false,
            message: 'FECHA INVÁLIDA',
        };
    }

    if (days <= 0) {
        return {
            id: doc.id,
            docType: doc.docType,
            title,
            category: 'legal',
            status: 'VENCIDO',
            severity: 'critical',
            daysRemaining: days,
            label: 'VENCIDO',
            color: 'var(--accent-crimson)',
            isExpired: true,
            isCritical: true,
            isWarning: false,
            message: `${title}: VENCIDO`,
        };
    }

    if (days < ALERT_THRESHOLDS.LEGAL_CRITICAL_DAYS) {
        return {
            id: doc.id,
            docType: doc.docType,
            title,
            category: 'legal',
            status: 'POR VENCER',
            severity: 'critical',
            daysRemaining: days,
            label: 'POR VENCER',
            color: 'var(--accent-crimson)',
            isExpired: false,
            isCritical: true,
            isWarning: false,
            message: `${title}: ${days} DÍAS REST.`,
        };
    }

    if (days < ALERT_THRESHOLDS.LEGAL_WARNING_DAYS) {
        return {
            id: doc.id,
            docType: doc.docType,
            title,
            category: 'legal',
            status: 'POR VENCER',
            severity: 'warning',
            daysRemaining: days,
            label: 'POR VENCER',
            color: 'var(--accent-amber)',
            isExpired: false,
            isCritical: false,
            isWarning: true,
            message: `${title}: ${days} DÍAS REST.`,
        };
    }

    return {
        id: doc.id,
        docType: doc.docType,
        title,
        category: 'legal',
        status: 'VIGENTE',
        severity: 'nominal',
        daysRemaining: days,
        label: 'VIGENTE',
        color: 'var(--accent-volt)',
        isExpired: false,
        isCritical: false,
        isWarning: false,
        message: `${title}: ${days} DÍAS REST.`,
    };
}

/**
 * Evaluates a single maintenance item.
 * @param {Object} item
 * @param {number} [currentOdo=0]
 * @returns {Object}
 */
export function evaluateMaintenanceItem(item, currentOdo = 0) {
    if (!item) {
        return {
            id: 'maint-unknown',
            title: 'MANTENIMIENTO',
            category: 'maintenance',
            kmRemaining: 0,
            status: 'UNKNOWN',
            severity: 'none',
            label: 'SIN REGISTRO',
            color: 'var(--text-muted)',
            message: 'SIN REGISTRO',
        };
    }

    const wear = calculateWearDialTelemetry(item, currentOdo);
    const title = (item.name || item.title || 'COMPONENTE').toUpperCase();

    const isCritical = wear.status === 'critical' || wear.kmRemaining <= 0 || wear.kmRemaining < ALERT_THRESHOLDS.MAINT_CRITICAL_KM;
    const isWarning = !isCritical && (wear.status === 'warning' || wear.kmRemaining < ALERT_THRESHOLDS.MAINT_WARNING_KM);

    let severity = 'nominal';
    let label = 'NOMINAL';
    let color = 'var(--accent-volt)';

    if (isCritical) {
        severity = 'critical';
        label = wear.kmRemaining <= 0 ? 'VENCIDO' : 'CRÍTICO';
        color = 'var(--accent-crimson)';
    } else if (isWarning) {
        severity = 'warning';
        label = 'POR VENCER';
        color = 'var(--accent-amber)';
    }

    return {
        id: item.id || `maint_${title}`,
        title,
        category: 'maintenance',
        type: 'maintenance',
        name: title,
        kmRemaining: wear.kmRemaining,
        lifePct: wear.lifePct,
        lastServiceOdo: wear.lastServiceOdo,
        intervalKm: wear.intervalKm,
        status: wear.kmRemaining <= 0 ? 'VENCIDO' : (isCritical ? 'CRITICAL' : (isWarning ? 'WARNING' : 'NOMINAL')),
        severity,
        label,
        color,
        isCritical,
        isWarning,
        message: wear.kmRemaining <= 0 ? `${title}: VENCIDO` : `${title}: ${Math.round(wear.kmRemaining).toLocaleString('es-CO')} KM REST.`,
    };
}

/**
 * Pure evaluation helper for given arrays of items.
 * @param {Object} data
 * @returns {typeof cachedAlerts}
 */
function processAlertsData(data = {}) {
    const legalDocs = Array.isArray(data.legalDocs) ? data.legalDocs : [];
    const maintenanceItems = Array.isArray(data.maintenanceItems) ? data.maintenanceItems : [];
    const currentOdo = Number(data.currentOdo) || 0;
    const fromDate = data.fromDate || new Date();

    const criticalAlerts = [];
    const warningAlerts = [];
    const nominal = [];

    // 1. Evaluate Maintenance Items
    for (const item of maintenanceItems) {
        const evalItem = evaluateMaintenanceItem(item, currentOdo);
        if (evalItem.severity === 'critical') {
            criticalAlerts.push(evalItem);
        } else if (evalItem.severity === 'warning') {
            warningAlerts.push(evalItem);
        } else {
            nominal.push(evalItem);
        }
    }

    // 2. Evaluate Legal Documents
    for (const doc of legalDocs) {
        const evalDoc = evaluateLegalDoc(doc, fromDate);
        if (evalDoc.severity === 'critical') {
            criticalAlerts.push({
                ...evalDoc,
                type: 'legal',
                name: evalDoc.title,
            });
        } else if (evalDoc.severity === 'warning') {
            warningAlerts.push({
                ...evalDoc,
                type: 'legal',
                name: evalDoc.title,
            });
        } else {
            nominal.push(evalDoc);
        }
    }

    const allAlerts = [...criticalAlerts, ...warningAlerts];
    const topAlert = criticalAlerts[0] || warningAlerts[0] || null;
    const hasCritical = criticalAlerts.length > 0;
    const hasWarning = warningAlerts.length > 0;

    let statusSummary = 'NOMINAL';
    let statusColor = 'var(--accent-volt)';

    if (hasCritical) {
        statusSummary = 'CRÍTICO';
        statusColor = 'var(--accent-crimson)';
    } else if (hasWarning) {
        statusSummary = 'ADVERTENCIA';
        statusColor = 'var(--accent-amber)';
    }

    return {
        criticalCount: criticalAlerts.length,
        warningCount: warningAlerts.length,
        totalCount: allAlerts.length,
        hasCritical,
        hasWarning,
        statusSummary,
        statusColor,
        criticalAlerts,
        critical: criticalAlerts,
        warningAlerts,
        warning: warningAlerts,
        allAlerts,
        all: allAlerts,
        nominal,
        topAlert,
        lastEvaluatedAt: new Date().toISOString(),
    };
}

/**
 * Calculates active alerts.
 * If data object is provided with datasets, executes synchronously.
 * If called without datasets, loads from IndexedDB asynchronously.
 * @param {Object} [data]
 * @returns {Object|Promise<Object>}
 */
export function calculateActiveAlerts(data) {
    if (data && (data.legalDocs !== undefined || data.maintenanceItems !== undefined)) {
        return processAlertsData(data);
    }
    return refreshAlerts();
}

/**
 * Evaluates active alerts across maintenance items and legal documents from DB.
 * Dispatches 'octane:alerts-updated' event.
 * @returns {Promise<typeof cachedAlerts>}
 */
export async function refreshAlerts() {
    try {
        const [maintenanceItems, legalDocs, logs, profile] = await Promise.all([
            getMaintenanceItems().catch(() => []),
            getLegalDocs().catch(() => []),
            getTelemetryLogs().catch(() => []),
            getVehicleProfile().catch(() => null),
        ]);

        const logMaxOdo = Array.isArray(logs) && logs.length > 0
            ? Math.max(...logs.map(l => Number(l.odometer_reading) || 0))
            : 0;
        const profileOdo = Number(profile?.currentOdometer) || 0;
        const gpsOdo = Number(profile?.gpsCache?.live?.totalMile) || 0;
        const currentOdo = Math.max(logMaxOdo, profileOdo, gpsOdo, 0);

        cachedAlerts = processAlertsData({
            legalDocs,
            maintenanceItems,
            currentOdo,
            fromDate: new Date()
        });

        // Update global state store
        if (store && typeof store.setState === 'function') {
            store.setState({ activeAlerts: cachedAlerts });
        }

        // Dispatch update event
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('octane:alerts-updated', {
                detail: {
                    ...cachedAlerts,
                    alerts: cachedAlerts
                }
            }));
        }

        return cachedAlerts;
    } catch (err) {
        console.error('[OCTANE ALERTS] Error calculating alerts:', err);
        return cachedAlerts;
    }
}

/**
 * Returns the currently cached active alerts synchronously.
 * @returns {typeof cachedAlerts}
 */
export function getActiveAlerts() {
    return cachedAlerts;
}

export const getCachedAlerts = getActiveAlerts;

/**
 * Subscribes to real-time alert updates.
 * @param {Function} callback - (alerts) => void
 * @returns {Function} Unsubscribe function
 */
export function subscribeToAlerts(callback) {
    if (typeof window === 'undefined' || typeof callback !== 'function') {
        return () => {};
    }

    const handler = (event) => {
        const alerts = event.detail?.alerts || event.detail;
        if (alerts) {
            callback(alerts);
        }
    };

    window.addEventListener('octane:alerts-updated', handler);
    return () => {
        window.removeEventListener('octane:alerts-updated', handler);
    };
}

/**
 * Renders HTML badge for cockpit top header.
 * Silencio Verbal Absoluto: Prohibidos parrafos y etiquetas p.
 * @param {Object} alerts
 * @returns {string}
 */
export function renderAlertsBadgeHtml(alerts) {
    if (!alerts || alerts.totalCount === 0) {
        return `
            <button id="cockpit-alerts-pill" type="button" class="h-6 px-2.5 rounded-sm border border-[var(--line-hair)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[var(--line-strong)] flex items-center gap-1.5 font-mono text-[9px] font-semibold uppercase tracking-wider cursor-pointer active:scale-95 transition-all select-none" title="Estado de Vigilancia">
                <span class="w-1.5 h-1.5 rounded-full bg-[var(--accent-volt)]"></span>
                <span>NOMINAL</span>
            </button>
        `;
    }

    if (alerts.hasCritical || alerts.criticalCount > 0) {
        const top = alerts.topAlert;
        const label = top?.message || `${alerts.criticalCount} CRÍTICA${alerts.criticalCount > 1 ? 'S' : ''}`;
        return `
            <button id="cockpit-alerts-pill" type="button" class="h-6 px-2.5 rounded-sm border border-[var(--accent-crimson)] bg-[var(--accent-crimson)]/10 text-[var(--accent-crimson)] flex items-center gap-1.5 font-mono text-[9px] font-bold uppercase tracking-wider cursor-pointer active:scale-95 transition-all select-none" title="Ver alertas críticas en Guantera / Clúster">
                <span class="w-1.5 h-1.5 rounded-full bg-[var(--accent-crimson)] animate-pulse"></span>
                <span>${label}</span>
            </button>
        `;
    }

    if (alerts.hasWarning || alerts.warningCount > 0) {
        const top = alerts.topAlert;
        const label = top?.message || `${alerts.warningCount} AVISO${alerts.warningCount > 1 ? 'S' : ''}`;
        return `
            <button id="cockpit-alerts-pill" type="button" class="h-6 px-2.5 rounded-sm border border-[var(--accent-amber)] bg-[var(--accent-amber)]/10 text-[var(--accent-amber)] flex items-center gap-1.5 font-mono text-[9px] font-bold uppercase tracking-wider cursor-pointer active:scale-95 transition-all select-none" title="Ver advertencias en Guantera / Clúster">
                <span class="w-1.5 h-1.5 rounded-full bg-[var(--accent-amber)]"></span>
                <span>${label}</span>
            </button>
        `;
    }

    return '';
}

/**
 * Initializes listeners to trigger automatic alert recalculations.
 */
export function initAlertsEngine() {
    if (isInitialized || typeof window === 'undefined') return;
    isInitialized = true;

    const trigger = () => {
        refreshAlerts();
    };

    window.addEventListener('octane:maintenance-updated', trigger);
    window.addEventListener('octane:legal-docs-updated', trigger);
    window.addEventListener('octane:legal-doc-saved', trigger);
    window.addEventListener('octane:legal-doc-deleted', trigger);
    window.addEventListener('octane:logs-updated', trigger);
    window.addEventListener('octane:profile-updated', trigger);
    window.addEventListener('octane:refuel-added', trigger);

    // Initial pass
    refreshAlerts();
}
