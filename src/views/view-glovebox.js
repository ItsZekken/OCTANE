/**
 * OCTANE // KINETIC — Glovebox View ("GUANTERA")
 * Swiss Precision Legal & Documentation Matrix.
 * 
 * Strict specifications:
 * - Clean title: "GUANTERA" (zero "//" and zero numeric prefixes).
 * - Vertical Stack of Horizontal Cards (`space-y-3`):
 *     * Left: 3px vertical status bar (#10B981, #FF5500, #F43F5E)
 *             Large document title ("SOAT", "Tecnomecánica", "Impuesto Vehicular")
 *             Discreet subtitle in JetBrains Mono ("Vence: 14 Feb 2027").
 *     * Right: GIGANTIC countdown number (text-4xl sm:text-5xl font-light tabular-nums + "DÍAS" in 10px mono).
 *              If unregistered: clean "+ Configurar" button.
 * - Accordion Drawer: Expands on tap to reveal secondary metadata:
 *     * N° Póliza / Ref with 1-touch copy button.
 *     * Entidad aseguradora, Valor pagado, Notas.
 *     * Action buttons: [EDITAR] and [ELIMINAR].
 * - Silencio Verbal Absoluto: Prohibidos <p> tags, zero blur, zero drop shadows.
 */

import { playHorologyTick, showToast } from '../core/state.js';
import { getLegalDocs, deleteLegalDoc } from '../core/db-local.js';
import { evaluateLegalDoc, calculateActiveAlerts } from '../core/alerts-engine.js';
import { triggerCloudSync } from '../core/firebase-sync.js';
import { openLegalDocModal } from '../components/modals/modal-legal-doc.js';

let currentContainer = null;
let boundListeners = [];
let openAccordionId = null;
let renderToken = 0;

function normalizeDocType(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const MONTH_NAMES = Object.freeze([
    'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
    'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'
]);

/**
 * Formats YYYY-MM-DD to clean "14 Feb 2027".
 * @param {string} dateStr
 * @returns {string}
 */
export function formatLegalDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return '—';
    const clean = dateStr.slice(0, 10);
    const parts = clean.split('-');
    if (parts.length !== 3) return dateStr;

    const year = parts[0];
    const monthIdx = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);

    if (isNaN(monthIdx) || monthIdx < 0 || monthIdx > 11 || isNaN(day)) {
        return dateStr;
    }

    return `${day} ${MONTH_NAMES[monthIdx]} ${year}`;
}

/**
 * Formats COP cost into concise architectural format e.g. "$487.000", "$1.2M", "$0".
 * @param {number|string} cost
 * @returns {string}
 */
export function formatCostCop(cost) {
    if (cost === undefined || cost === null || cost === '' || isNaN(Number(cost))) {
        return '—';
    }
    const num = Number(cost);
    if (num <= 0) return '$0';

    if (num >= 1000000) {
        const m = num / 1000000;
        return `$${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M COP`;
    }
    return `$${num.toLocaleString('es-CO')} COP`;
}

export const formatCompactCop = formatCostCop;

/**
 * Copies reference or policy string to clipboard with tactile audio feedback.
 * @param {string} text
 */
async function copyToClipboard(text) {
    if (!text || text === '—') return;
    try {
        if (navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
        } else {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        }
        playHorologyTick(1600, 0.015, 0.03);
        showToast(`COPIADO: ${text}`);
    } catch {
        showToast(`COPIA NO DISPONIBLE`);
    }
}

/**
 * Loads documents from storage and builds the canonical list.
 * Guarantees SOAT, Tecnomecánica, and Impuesto Vehicular + all additional/custom docs.
 * @returns {Promise<Array<Object>>}
 */
async function loadLegalGridItems() {
    let rawDocs = [];
    try {
        rawDocs = await getLegalDocs();
    } catch (err) {
        console.warn('[OCTANE GLOVEBOX] Error loading legal docs:', err);
        rawDocs = [];
    }

    const defaultTemplates = [
        { docType: 'soat', defaultTitle: 'SOAT' },
        { docType: 'tecnomecanica', defaultTitle: 'Tecnomecánica' },
        { docType: 'impuesto', defaultTitle: 'Impuesto Vehicular' },
    ];

    const matchedIds = new Set();

    const matchedDefaultDocs = defaultTemplates.map((template) => {
        const targetType = normalizeDocType(template.docType);
        const found = rawDocs.find((d) => {
            if (matchedIds.has(d.id)) return false;
            const dType = normalizeDocType(d.docType);
            const dId = normalizeDocType(d.id);
            return (
                dType === targetType ||
                (targetType === 'tecnomecanica' && dType.includes('tecnomec')) ||
                dId === `doc_${targetType}` ||
                dId === targetType ||
                (targetType === 'tecnomecanica' && dId === 'doc_tecnomec_nica')
            );
        });
        if (found?.id) {
            matchedIds.add(found.id);
        }
        return {
            isDefault: true,
            docType: template.docType,
            title: found?.name || found?.title || template.defaultTitle,
            doc: found || null,
        };
    });

    const customDocs = rawDocs
        .filter((d) => !matchedIds.has(d.id))
        .map((doc) => ({
            isDefault: false,
            docType: normalizeDocType(doc.docType) || 'otro',
            title: doc.name || doc.title || 'Documento',
            doc,
        }));

    return [...matchedDefaultDocs, ...customDocs];
}

/**
 * Renders the Silent Swiss Glovebox view.
 * @param {HTMLElement} container
 */
export async function renderGloveboxView(container) {
    if (!container) return;
    currentContainer = container;
    playHorologyTick(1100, 0.015, 0.025);

    cleanupListeners();

    await renderGlovebox();

    const onUpdated = () => renderGlovebox();
    window.addEventListener('octane:legal-docs-updated', onUpdated);
    boundListeners.push(
        () => window.removeEventListener('octane:legal-docs-updated', onUpdated)
    );
}

/**
 * Internal render function for updating view content.
 */
async function renderGlovebox() {
    if (!currentContainer) return;
    const token = ++renderToken;

    const items = await loadLegalGridItems();
    if (!currentContainer || token !== renderToken) return;

    const allDocs = items.map(i => i.doc).filter(Boolean);
    const alerts = calculateActiveAlerts({ legalDocs: allDocs });

    currentContainer.innerHTML = `
        <div class="view-glovebox max-w-4xl mx-auto space-y-6 pb-20 select-none">
            
            <!-- Top Header: Clean, Zero // -->
            <div class="border-b border-[var(--line-hair)] pb-3 flex items-center justify-between">
                <div class="flex items-center gap-2.5">
                    <span class="w-2 h-2 bg-[var(--accent-amber)]"></span>
                    <h1 class="font-mono text-xs uppercase tracking-widest text-[var(--text-primary)] font-semibold">GUANTERA</h1>
                </div>
                <div class="flex items-center gap-2">
                    <button id="glovebox-add-btn" type="button" class="flat-pill px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-[var(--text-primary)] hover:border-[var(--line-strong)] hover:bg-[var(--line-hair)] flex items-center gap-1 transition-colors cursor-pointer" title="Agregar nuevo documento">
                        <span>+</span>
                        <span>DOCUMENTO</span>
                    </button>
                </div>
            </div>

            <!-- Pila Vertical de Tarjetas Horizontales (space-y-3) -->
            <div class="space-y-3" id="glovebox-stack">
                ${items.map(item => renderDocumentRowHtml(item)).join('')}
            </div>

            <!-- Silent Status Bar -->
            <div class="px-4 py-2.5 bg-[var(--bg-surface)] border border-[var(--line-hair)] flex items-center justify-between font-mono text-[10px] text-[var(--text-secondary)]">
                <div class="flex items-center gap-2">
                    <span class="w-1.5 h-1.5 rounded-full ${alerts.hasCritical ? 'bg-[var(--accent-crimson)] animate-pulse' : (alerts.hasWarning ? 'bg-[var(--accent-amber)]' : 'bg-[var(--accent-volt)]')}"></span>
                    <span>ESTADO: ${alerts.statusSummary}</span>
                </div>
                <span class="text-[var(--text-primary)] tabular-nums">${allDocs.length} REGISTROS ACTIVOS</span>
            </div>

        </div>
    `;

    bindCardInteractions();
}

/**
 * Generates the clean horizontal card HTML for each legal item.
 * Includes prominent countdown on right and hidden accordion metadata.
 * @param {Object} item
 * @returns {string}
 */
function renderDocumentRowHtml(item) {
    const doc = item.doc;
    const hasRecord = Boolean(doc && doc.expiryDate);
    const evaluation = evaluateLegalDoc(doc);
    const days = evaluation.daysRemaining;
    const docId = doc?.id || `template_${item.docType}`;
    const isExpanded = openAccordionId === docId;

    // Status vertical bar color & countdown styling
    let statusColor = '#52525B'; // Muted
    let countdownColorClass = 'text-[var(--text-muted)]';
    let subStatusText = 'SIN REGISTRO';
    let daysNum = '—';

    if (hasRecord && days !== null) {
        if (days <= 0) {
            statusColor = '#F43F5E'; // Crimson
            countdownColorClass = 'text-[var(--accent-crimson)]';
            subStatusText = days === 0 ? 'HOY' : 'VENCIDO';
            daysNum = Math.abs(days).toString();
        } else if (days < 15) {
            statusColor = '#F43F5E'; // Crimson
            countdownColorClass = 'text-[var(--accent-crimson)]';
            subStatusText = 'CRÍTICO';
            daysNum = days.toString();
        } else if (days < 30) {
            statusColor = '#FF5500'; // Amber
            countdownColorClass = 'text-[var(--accent-amber)]';
            subStatusText = 'PRÓXIMO';
            daysNum = days.toString();
        } else {
            statusColor = '#10B981'; // Volt Green
            countdownColorClass = 'text-[var(--text-primary)]';
            subStatusText = 'RESTANTES';
            daysNum = days.toString();
        }
    }

    const formattedVence = hasRecord ? `Vence: ${formatLegalDate(doc.expiryDate)}` : 'Sin registro de vencimiento';
    const docNumber = doc?.docNumber || '';
    const entity = doc?.entity || '';
    const formattedCost = doc ? formatCostCop(doc.costCop) : '—';
    const notes = doc?.notes || '';
    const safeTitle = escapeHtml(item.title);
    const safeDocId = escapeHtml(docId);
    const safeDocType = escapeHtml(item.docType);
    const safeDocNumber = escapeHtml(docNumber);
    const safeEntity = escapeHtml(entity);
    const safeNotes = escapeHtml(notes);

    return `
        <div class="glovebox-card flat-cell bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)]/30 transition-all border border-[var(--line-hair)] overflow-hidden" data-id="${safeDocId}" data-doctype="${safeDocType}">
            
            <!-- Main Horizontal Row -->
            <div class="card-clickable-header p-4 sm:p-5 flex items-center justify-between gap-4 cursor-pointer">
                
                <!-- Left: 3px Status Bar + Name + Expiry Date Subtitle -->
                <div class="flex items-center gap-3.5 min-w-0">
                    <div class="w-[3.5px] h-10 rounded-full shrink-0" style="background-color: ${statusColor};"></div>
                    
                    <div class="flex flex-col min-w-0">
                        <span class="font-sans font-medium text-base sm:text-lg text-[var(--text-primary)] leading-tight truncate">
                            ${safeTitle}
                        </span>
                        <span class="font-mono text-[11px] text-[var(--text-secondary)] mt-1 tracking-wider tabular-nums truncate">
                            ${escapeHtml(formattedVence)}
                        </span>
                    </div>
                </div>

                <!-- Right: Gigantic Countdown OR + Configurar Button -->
                <div class="flex items-center gap-3 shrink-0">
                    ${hasRecord ? `
                        <div class="flex items-baseline gap-2 text-right">
                            <span class="font-sans font-light text-4xl sm:text-5xl tracking-tighter tabular-nums leading-none ${countdownColorClass}">
                                ${daysNum}
                            </span>
                            <div class="flex flex-col items-start font-mono text-[9px] uppercase tracking-widest text-[var(--text-secondary)] leading-none">
                                <span>DÍAS</span>
                                <span class="text-[8px] opacity-70 mt-0.5">${subStatusText}</span>
                            </div>
                        </div>

                        <!-- Accordion Chevron Indicator -->
                        <span class="accordion-chevron text-[var(--text-muted)] text-[10px] transform transition-transform duration-200 ml-1 ${isExpanded ? 'rotate-180 text-[var(--text-primary)]' : ''}">
                            ▼
                        </span>
                    ` : `
                        <button 
                            type="button" 
                            class="btn-configure-action flat-pill px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--accent-amber)] hover:border-[var(--accent-amber)] hover:bg-[var(--accent-amber)]/10 transition-colors cursor-pointer"
                            data-doctype="${safeDocType}"
                            data-title="${safeTitle}"
                        >
                            + CONFIGURAR
                        </button>
                    `}
                </div>

            </div>

            <!-- Accordion Drawer (Secondary Metadata) -->
            ${hasRecord ? `
                <div class="accordion-drawer ${isExpanded ? '' : 'hidden'} border-t border-[var(--line-hair)] px-4 sm:px-6 py-4 bg-[var(--bg-void)] font-mono text-xs animate-in fade-in duration-150">
                    
                    <!-- Metadata Grid -->
                    <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 py-2 border-b border-[var(--line-hair)]">
                        
                        <!-- Col 1: Póliza con botón táctil copiar -->
                        <div>
                            <span class="text-[9px] uppercase tracking-wider text-[var(--text-secondary)] block mb-1">N° PÓLIZA / REFERENCIA</span>
                            <div class="flex items-center gap-2">
                                <span class="text-[var(--text-primary)] font-medium tabular-nums truncate">${safeDocNumber || '—'}</span>
                                ${docNumber ? `
                                    <button 
                                        type="button" 
                                        class="btn-copy-ref text-[10px] text-[var(--accent-amber)] hover:underline uppercase tracking-wider cursor-pointer shrink-0" 
                                        data-ref="${safeDocNumber}"
                                        title="Copiar póliza"
                                    >
                                        [COPIAR]
                                    </button>
                                ` : ''}
                            </div>
                        </div>

                        <!-- Col 2: Aseguradora -->
                        <div>
                            <span class="text-[9px] uppercase tracking-wider text-[var(--text-secondary)] block mb-1">ENTIDAD / ASEGURADORA</span>
                            <span class="text-[var(--text-primary)] font-medium truncate block">${safeEntity || '—'}</span>
                        </div>

                        <!-- Col 3: Costo -->
                        <div>
                            <span class="text-[9px] uppercase tracking-wider text-[var(--text-secondary)] block mb-1">VALOR PAGADO</span>
                            <span class="text-[var(--text-primary)] font-medium tabular-nums block">${escapeHtml(formattedCost)}</span>
                        </div>

                        <!-- Col 4: Notas -->
                        <div>
                            <span class="text-[9px] uppercase tracking-wider text-[var(--text-secondary)] block mb-1">NOTAS</span>
                            <span class="text-[var(--text-secondary)] truncate block" title="${safeNotes}">${safeNotes || '—'}</span>
                        </div>

                    </div>

                    <!-- Accordion Action Bar -->
                    <div class="flex items-center justify-between pt-3">
                        <button 
                            type="button" 
                            class="btn-delete-action flat-pill px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--accent-crimson)] hover:border-[var(--accent-crimson)] transition-colors cursor-pointer"
                            data-id="${escapeHtml(doc.id)}"
                            data-title="${safeTitle}"
                        >
                            ELIMINAR
                        </button>

                        <button 
                            type="button" 
                            class="btn-edit-action px-3 py-1.5 bg-[var(--text-primary)] text-[var(--bg-void)] font-mono text-[10px] uppercase tracking-wider font-semibold hover:opacity-90 transition-opacity cursor-pointer flex items-center gap-1"
                            data-id="${escapeHtml(doc.id)}"
                        >
                            <span>✎</span> EDITAR DOCUMENTO
                        </button>
                    </div>

                </div>
            ` : ''}

        </div>
    `;
}

/**
 * Binds interactions to the vertical stack cards.
 */
function bindCardInteractions() {
    if (!currentContainer) return;

    // 1. Top Add Doc button
    const addBtn = currentContainer.querySelector('#glovebox-add-btn');
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            playHorologyTick(1300, 0.015, 0.03);
            openLegalDocModal({
                defaultDocType: 'poliza',
                defaultTitle: 'Póliza Todo Riesgo'
            });
        });
    }

    // 2. Configure button (for empty templates)
    const configBtns = currentContainer.querySelectorAll('.btn-configure-action');
    configBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            playHorologyTick(1200, 0.012, 0.025);
            const docType = btn.getAttribute('data-doctype') || 'soat';
            const title = btn.getAttribute('data-title') || 'Documento';
            openLegalDocModal({
                defaultDocType: docType,
                defaultTitle: title
            });
        });
    });

    // 3. Card click accordion toggle
    const cards = currentContainer.querySelectorAll('.glovebox-card');
    cards.forEach(card => {
        const header = card.querySelector('.card-clickable-header');
        const drawer = card.querySelector('.accordion-drawer');
        const docId = card.getAttribute('data-id');

        if (header && drawer) {
            header.addEventListener('click', () => {
                playHorologyTick(1100, 0.012, 0.02);
                if (openAccordionId === docId) {
                    openAccordionId = null;
                } else {
                    openAccordionId = docId;
                }
                renderGlovebox();
            });
        }
    });

    // 4. Copy Reference button
    const copyBtns = currentContainer.querySelectorAll('.btn-copy-ref');
    copyBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const ref = btn.getAttribute('data-ref');
            copyToClipboard(ref);
        });
    });

    // 5. Edit Document button
    const editBtns = currentContainer.querySelectorAll('.btn-edit-action');
    editBtns.forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            playHorologyTick(1200, 0.012, 0.025);
            const docId = btn.getAttribute('data-id');
            if (!docId) return;

            try {
                const allDocs = await getLegalDocs();
                const target = allDocs.find(d => d.id === docId);
                if (target) {
                    openLegalDocModal(target);
                }
            } catch (err) {
                console.error('[OCTANE] Error opening doc for edit:', err);
            }
        });
    });

    // 6. Delete Document button
    const deleteBtns = currentContainer.querySelectorAll('.btn-delete-action');
    deleteBtns.forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const docId = btn.getAttribute('data-id');
            const title = btn.getAttribute('data-title') || 'DOCUMENTO';
            if (!docId) return;

            const confirmed = window.confirm(`¿ELIMINAR REGISTRO DE "${title.toUpperCase()}"?`);
            if (!confirmed) return;

            try {
                await deleteLegalDoc(docId);
                triggerCloudSync();
                playHorologyTick(1100, 0.02, 0.03);
                showToast('DOCUMENTO ELIMINADO');
                if (openAccordionId === docId) openAccordionId = null;
                window.dispatchEvent(new CustomEvent('octane:legal-doc-deleted'));
                window.dispatchEvent(new CustomEvent('octane:legal-docs-updated'));
            } catch (err) {
                console.error('[OCTANE] Error deleting legal doc:', err);
            }
        });
    });
}

/**
 * Cleans up global listeners when view unmounts.
 */
function cleanupListeners() {
    boundListeners.forEach(unsub => unsub());
    boundListeners = [];
}

/**
 * Destroys view resources.
 */
export function destroyGloveboxView() {
    cleanupListeners();
    currentContainer = null;
}
