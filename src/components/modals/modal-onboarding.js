/**
 * OCTANE // KINETIC — Mobile-First Minimalist Onboarding Flow (v2)
 * 
 * Ultraclean 4-step linear flow optimized for mobile viewports:
 * - Zero heavy headers, zero "PASO 0N // " labels, 2px hairline progress at top.
 * - Paso 1: Buscador prioritario + "¿No encuentras tu modelo?" manual con 12 colores de carro + color picker.
 *           Opción "Restaurar backup JSON" situada inmediatamente al inicio.
 * - Paso 2: Odómetro monumental con formateo automático de miles en vivo (ej. 97.395).
 * - Paso 3: Carrusel horizontal de medidor a escala completa sin desbordes.
 * - Paso 4: Silueta SVG del vehículo con el color elegido y botón de entrada directo.
 */

import { todayLocalYmd } from '../../core/date-utils.js';
import { playHorologyTick } from '../../core/telemetry-engine.js';
import { store, showToast } from '../../core/state.js';
import {
    saveVehicleProfile,
    getVehicleProfile,
    addTelemetryLog,
    getTelemetryLogs,
    bulkAddTelemetryLogs,
    importAllStores
} from '../../core/db-local.js';
import { renderSpicyArcGauge } from '../fuel-gauges/gauge-spicy-arc.js';
import { renderAnalog180Gauge } from '../fuel-gauges/gauge-analog-180.js';
import { renderDigitalLcdGauge } from '../fuel-gauges/gauge-digital-lcd.js';
import { renderSightGlassGauge } from '../fuel-gauges/gauge-sight-glass.js';
import { renderVehicleSearchBox, mapBodySilhouette } from '../vehicles/vehicle-search-box.js';
import { getInlineVehicleSvg } from '../../assets/vehicles-svg/models-inline.js';

const GAL_TO_L = 3.78541;
const L_TO_GAL = 1 / 3.78541;

// 12 Real Automotive Paint Colors
export const CAR_COLORS = [
    { id: 'white', name: 'Blanco Polar', hex: '#F8F9FA' },
    { id: 'silver', name: 'Plata Mercurio', hex: '#B8B9BB' },
    { id: 'graphite', name: 'Gris Grafito', hex: '#494D52' },
    { id: 'black', name: 'Negro Obsidiana', hex: '#141416' },
    { id: 'red', name: 'Rojo Carmesí', hex: '#B91C1C' },
    { id: 'orange', name: 'Naranja Octane', hex: '#FF5500' },
    { id: 'blue', name: 'Azul Océano', hex: '#1D4ED8' },
    { id: 'midnight', name: 'Azul Medianoche', hex: '#0F172A' },
    { id: 'green', name: 'Verde Oliva', hex: '#365314' },
    { id: 'sand', name: 'Arena Titanio', hex: '#C2B280' },
    { id: 'mocha', name: 'Café Moka', hex: '#45322E' },
    { id: 'yellow', name: 'Amarillo Sport', hex: '#EAB308' }
];

let modalContainer = null;
let isOpen = false;
let currentStep = 1;
let isManualMode = false;
let activeGaugeCarouselIdx = 0;
let activeGaugeInstance = null;

let onboardingState = {
    vehicleName: '',
    tankCapacityLiters: 0,
    tankCapacityGallons: 0,
    reserveLiters: 0,
    initialOdometer: 0,
    chassisType: 'hatchback', // 'hatchback' | 'sedan' | 'suv'
    vehicleColor: '#F8F9FA',
    gaugeStyle: 'spicy-arc',
    refuelHabit: 'always_full', // 'always_full' | 'variable_amount'
    ridesModuleEnabled: false,   // boolean
    routineDailyKm: 24,         // number
    svgModel: ''
};

const GAUGE_OPTIONS = [
    { id: 'spicy-arc', title: 'ARCO SPICY', sub: 'Arco lateral vertical de alta precisión' },
    { id: 'analog-180', title: 'DIAL 180°', sub: 'Semicírculo clásico de aguja central' },
    { id: 'digital-lcd', title: 'BARRAS LCD', sub: 'Matriz segmentada de bloques digitales' },
    { id: 'sight-glass', title: 'LENTE FLUIDO', sub: 'Cilindro óptico de nivel hidrostático' }
];

/**
 * Initializes container in DOM.
 */
export function initOnboardingModal() {
    if (document.getElementById('modal-onboarding-root')) return;

    modalContainer = document.createElement('div');
    modalContainer.id = 'modal-onboarding-root';
    modalContainer.className = 'fixed inset-0 z-50 bg-[var(--bg-void)] text-[var(--text-primary)] flex flex-col justify-between opacity-0 pointer-events-none transition-opacity duration-200 overflow-y-auto select-none';
    document.body.appendChild(modalContainer);

    window.addEventListener('octane:open-onboarding', (e) => {
        openOnboardingModal(e.detail || {});
    });
}

/**
 * Opens fullscreen onboarding.
 */
export function openOnboardingModal(options = {}) {
    if (!modalContainer) initOnboardingModal();
    isOpen = true;
    currentStep = options.step || 1;
    isManualMode = false;

    // Load from existing profile ONLY if explicitly requested in edit mode
    const existing = store.getState().vehicleProfile;
    if (options.isEdit && existing && (existing.isConfigured || existing.onboardingCompleted)) {
        onboardingState = {
            vehicleName: existing.name || '',
            tankCapacityLiters: Number(existing.tankCapacityLiters) || 0,
            tankCapacityGallons: Number(existing.tankCapacityGallons) || 0,
            reserveLiters: Number(existing.reserveLiters) || 0,
            initialOdometer: Number(existing.initialOdometer) || 0,
            gaugeStyle: existing.gaugeStyle || 'spicy-arc',
            vehicleColor: existing.vehicleColor || '#F8F9FA',
            chassisType: existing.chassisType || 'hatchback',
            svgModel: existing.svgModel || '',
            refuelHabit: existing.refuelHabit || 'always_full',
            ridesModuleEnabled: Boolean(existing.ridesModuleEnabled),
            routineDailyKm: Number(existing.routineDailyKm) || 24
        };
    } else {
        // Zero preselection on first-run or reset
        onboardingState = {
            vehicleName: '',
            tankCapacityLiters: 0,
            tankCapacityGallons: 0,
            reserveLiters: 0,
            initialOdometer: 0,
            chassisType: 'hatchback',
            vehicleColor: '#F8F9FA',
            gaugeStyle: 'spicy-arc',
            refuelHabit: 'always_full',
            ridesModuleEnabled: false,
            routineDailyKm: Number(onboardingState.routineDailyKm) || 24,
            svgModel: ''
        };
    }

    const idx = GAUGE_OPTIONS.findIndex(g => g.id === onboardingState.gaugeStyle);
    activeGaugeCarouselIdx = idx >= 0 ? idx : 0;

    renderStep();
    modalContainer.classList.remove('opacity-0', 'pointer-events-none');
    modalContainer.classList.add('opacity-100', 'pointer-events-auto');
    playHorologyTick(1200, 0.02, 0.04);
}

/**
 * Closes onboarding and cleans up any preview gauge instances.
 */
export function closeOnboardingModal() {
    if (!modalContainer) return;
    isOpen = false;
    teardownActiveGaugePreview();
    modalContainer.classList.remove('opacity-100', 'pointer-events-auto');
    modalContainer.classList.add('opacity-0', 'pointer-events-none');
    modalContainer.innerHTML = ''; // Complete DOM and canvas teardown
    playHorologyTick(700, 0.015, 0.02);
}

function teardownActiveGaugePreview() {
    if (activeGaugeInstance && typeof activeGaugeInstance.destroy === 'function') {
        try {
            activeGaugeInstance.destroy();
        } catch (_) {}
        activeGaugeInstance = null;
    }
}

/**
 * Formats integer with thousands dot separator (e.g. 97395 -> 97.395).
 */
function formatThousands(num) {
    if (!num && num !== 0) return '';
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * Parses raw input string into integer.
 */
function parseThousands(str) {
    const raw = String(str || '').replace(/\D/g, '');
    return raw ? parseInt(raw, 10) : 0;
}

/**
 * Renders the top 2px hairline progress and floating close button.
 */
function renderTopHairlineProgress() {
    const pct = ((currentStep - 1) / 4) * 100;
    return `
        <!-- TOP 2PX PROGRESS HAIRLINE -->
        <div class="fixed top-0 left-0 right-0 h-0.5 bg-[var(--line-hair)] z-50">
            <div class="h-full bg-[var(--accent-amber)] transition-all duration-300" style="width: ${Math.max(10, pct)}%;"></div>
        </div>

        <!-- FLOATING TOP CLOSE BUTTON -->
        <div class="w-full max-w-xl mx-auto px-4 pt-4 flex items-center justify-between text-xs font-mono">
            ${currentStep === 1 ? `
                <button id="onboard-top-json-btn" type="button" class="text-[11px] text-[var(--text-secondary)] hover:text-[var(--accent-amber)] uppercase tracking-wider flex items-center gap-1.5 cursor-pointer">
                    <span>↑</span>
                    <span>Restaurar copia de seguridad</span>
                </button>
            ` : `
                <span class="text-[10px] text-[var(--text-muted)] tracking-widest uppercase">0${currentStep} / 05</span>
            `}
            <input type="file" id="onboard-json-file" accept=".json" class="hidden" />
            <button id="onboarding-close-btn" type="button" class="h-8 w-8 rounded-sm flat-pill flex items-center justify-center text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer" title="Cerrar">
                ✕
            </button>
        </div>
    `;
}

/**
 * Main render function for step.
 */
function renderStep() {
    if (!modalContainer) return;
    teardownActiveGaugePreview();

    modalContainer.innerHTML = `
        ${renderTopHairlineProgress()}

        <!-- STEP BODY (CENTERED & AIRY) -->
        <main class="w-full max-w-lg mx-auto px-4 py-6 sm:py-10 flex-1 flex flex-col justify-center">
            ${renderStepContent()}
        </main>

        <!-- BOTTOM ACTION STRIP -->
        <footer class="w-full max-w-lg mx-auto px-4 py-5 flex items-center justify-between font-mono">
            ${currentStep > 1 ? `
                <button id="onboarding-prev-btn" type="button" class="h-10 px-4 rounded-sm flat-pill text-xs uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer">
                    ← ANTERIOR
                </button>
            ` : `
                <div></div>
            `}

            ${currentStep < 5 ? `
                <button
                    id="onboarding-next-btn"
                    type="button"
                    ${currentStep === 1 && (!onboardingState.vehicleName || !onboardingState.tankCapacityLiters) ? 'disabled' : ''}
                    class="h-10 px-6 rounded-sm bg-[var(--accent-amber)] text-[var(--bg-void)] text-xs font-semibold tracking-widest uppercase transition-all ${
                        currentStep === 1 && (!onboardingState.vehicleName || !onboardingState.tankCapacityLiters)
                            ? 'opacity-30 cursor-not-allowed pointer-events-none'
                            : 'hover:opacity-90 active:scale-95 cursor-pointer'
                    }">
                    CONTINUAR →
                </button>
            ` : `
                <button id="onboarding-finish-btn" type="button" class="h-10 px-6 rounded-sm bg-[var(--accent-volt)] text-[var(--bg-void)] text-xs font-semibold tracking-widest uppercase hover:opacity-90 active:scale-95 transition-all cursor-pointer">
                    ENTRAR AL COCKPIT ✓
                </button>
            `}
        </footer>
    `;

    bindStepEvents();
}

function renderStepContent() {
    switch (currentStep) {
        case 1:
            return renderStep1Vehicle();
        case 2:
            return renderStep2Odometer();
        case 3:
            return renderStep3ProfileUsage();
        case 4:
            return renderStep4GaugesCarousel();
        case 5:
        default:
            return renderStep5Ready();
    }
}

/**
 * STEP 1: Search-first + collapsible manual inputs with 12 car colors + color picker.
 */
function renderStep1Vehicle() {
    return `
        <div class="space-y-6">
            <div>
                <h1 class="font-sans font-light text-2xl sm:text-3xl tracking-tight text-[var(--text-primary)]">Tu vehículo</h1>
            </div>

            <!-- Instant Search Input (Central protagonist) -->
            <div id="onboarding-vehicle-search" class="relative"></div>

            <!-- Selected Active Confirmation Strip (Zero boxes, flat hairline) -->
            <div id="onboard-selected-summary" class="${(onboardingState.vehicleName && onboardingState.tankCapacityLiters > 0) ? '' : 'hidden '}flex items-center justify-between text-xs font-mono border-b border-[var(--line-hair)] pb-2 pt-1">
                <div class="flex items-center gap-2 truncate">
                    <span class="w-1.5 h-1.5 bg-[var(--accent-volt)] flex-shrink-0"></span>
                    <span id="onboard-summary-title" class="font-bold text-[var(--accent-amber)] truncate">${onboardingState.vehicleName}</span>
                </div>
                <span id="onboard-summary-cap" class="text-[var(--text-primary)] tabular-nums font-semibold flex-shrink-0 ml-2">${onboardingState.tankCapacityLiters}L (${onboardingState.tankCapacityGallons.toFixed(2)}G)</span>
            </div>

            <!-- Manual Toggle Button -->
            <div class="pt-2 text-center">
                <button id="toggle-manual-btn" type="button" class="text-xs font-mono text-[var(--accent-amber)] hover:underline inline-flex items-center gap-1 cursor-pointer">
                    <span>${isManualMode ? '▲ Ocultar configuración manual' : '¿No encuentras tu modelo? Configuración manual'}</span>
                </button>
            </div>

            <!-- Collapsible Manual Specification Form -->
            <div id="manual-spec-form" class="${isManualMode ? '' : 'hidden '}space-y-5 pt-3 border-t border-[var(--line-hair)] font-mono text-xs">
                
                <!-- Alias & Tank Liters -->
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div class="space-y-1">
                        <label class="block text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">NOMBRE / MODELO</label>
                        <input id="manual-veh-name" type="text" value="${onboardingState.vehicleName}" placeholder="Renault Sandero" class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-2 text-xs focus:outline-none text-[var(--text-primary)]" />
                    </div>
                    <div class="space-y-1">
                        <div class="flex items-center justify-between text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">
                            <label>CAPACIDAD (LITROS)</label>
                            <span id="manual-gal-readout" class="text-[var(--accent-amber)] tabular-nums">${onboardingState.tankCapacityGallons.toFixed(2)} GAL</span>
                        </div>
                        <input id="manual-veh-liters" type="number" step="0.5" min="10" max="150" value="${onboardingState.tankCapacityLiters > 0 ? onboardingState.tankCapacityLiters : ''}" placeholder="45" class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-2 text-xs focus:outline-none text-[var(--text-primary)] tabular-nums" />
                    </div>
                </div>

                <!-- Chassis Type Selector -->
                <div class="space-y-1.5">
                    <label class="block text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">TIPO DE VEHÍCULO</label>
                    <div class="grid grid-cols-3 gap-2 text-[11px]" id="chassis-type-group">
                        <button type="button" data-chassis="hatchback" class="chassis-btn h-9 rounded-sm border ${onboardingState.chassisType === 'hatchback' ? 'border-[var(--accent-amber)] bg-[var(--bg-elevated)] text-[var(--accent-amber)] font-bold' : 'border-[var(--line-hair)] text-[var(--text-secondary)] hover:border-[var(--line-strong)]'} transition-all cursor-pointer">
                            Hatchback
                        </button>
                        <button type="button" data-chassis="sedan" class="chassis-btn h-9 rounded-sm border ${onboardingState.chassisType === 'sedan' ? 'border-[var(--accent-amber)] bg-[var(--bg-elevated)] text-[var(--accent-amber)] font-bold' : 'border-[var(--line-hair)] text-[var(--text-secondary)] hover:border-[var(--line-strong)]'} transition-all cursor-pointer">
                            Sedán
                        </button>
                        <button type="button" data-chassis="suv" class="chassis-btn h-9 rounded-sm border ${onboardingState.chassisType === 'suv' ? 'border-[var(--accent-amber)] bg-[var(--bg-elevated)] text-[var(--accent-amber)] font-bold' : 'border-[var(--line-hair)] text-[var(--text-secondary)] hover:border-[var(--line-strong)]'} transition-all cursor-pointer">
                            SUV / Pickup
                        </button>
                    </div>
                </div>

                <!-- 12 Car Colors Palette + Native Color Picker -->
                <div class="space-y-2">
                    <div class="flex items-center justify-between text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">
                        <span>COLOR DE CARROCERÍA</span>
                        <span id="selected-color-name" class="text-[var(--text-primary)] font-semibold">Blanco</span>
                    </div>
                    <div class="flex flex-wrap items-center gap-2 pt-1" id="car-color-palette">
                        ${CAR_COLORS.map(c => `
                            <button
                                type="button"
                                data-color="${c.hex}"
                                data-name="${c.name}"
                                class="color-dot-btn w-6 h-6 rounded-full border transition-all ${
                                    onboardingState.vehicleColor.toLowerCase() === c.hex.toLowerCase()
                                        ? 'scale-110 border-white ring-2 ring-[var(--accent-amber)]'
                                        : 'border-[var(--line-hair)] hover:scale-105'
                                }"
                                style="background-color: ${c.hex};"
                                title="${c.name}"
                            ></button>
                        `).join('')}

                        <!-- Native Color Picker Extra Option -->
                        <label class="w-6 h-6 rounded-full border border-dashed border-[var(--line-strong)] hover:border-[var(--text-primary)] flex items-center justify-center cursor-pointer relative overflow-hidden" title="Elegir color personalizado">
                            <input type="color" id="custom-color-picker" value="${onboardingState.vehicleColor}" class="opacity-0 absolute inset-0 cursor-pointer" />
                            <span class="text-[10px] leading-none text-[var(--text-secondary)]">+</span>
                        </label>
                    </div>
                </div>

            </div>
        </div>
    `;
}

/**
 * STEP 2: Odometer reading with real-time thousands formatting.
 */
function renderStep2Odometer() {
    const formattedVal = onboardingState.initialOdometer > 0 ? formatThousands(onboardingState.initialOdometer) : '';
    return `
        <div class="space-y-6 text-center">
            <div>
                <h1 class="font-sans font-light text-2xl sm:text-3xl tracking-tight text-[var(--text-primary)]">Kilometraje actual</h1>
            </div>

            <!-- Big Format Numeric Input with Real-Time Thousands Separator -->
            <div class="py-10 flex flex-col items-center justify-center">
                <div class="flex items-baseline justify-center gap-2">
                    <input
                        id="onboard-odo-formatted"
                        type="text"
                        inputmode="numeric"
                        value="${formattedVal}"
                        placeholder="0"
                        autofocus
                        class="bg-transparent text-center font-sans font-light text-5xl sm:text-6xl tabular-nums text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none border-b border-[var(--line-strong)] focus:border-[var(--accent-amber)] transition-colors max-w-xs"
                    />
                    <span class="font-mono text-base font-semibold text-[var(--accent-amber)]">KM</span>
                </div>
            </div>
        </div>
    `;
}

/**
 * STEP 3: Usage Profile (Refuel habits, Ride-hailing toggle & Routine commute KM).
 */
function renderStep3ProfileUsage() {
    return `
        <div class="space-y-6">
            <div>
                <h1 class="font-sans font-light text-2xl sm:text-3xl tracking-tight text-[var(--text-primary)]">Perfil de uso</h1>
            </div>

            <!-- 1. Hábito de Tanqueo -->
            <div class="space-y-2 font-mono">
                <span class="block text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">HÁBITO DE TANQUEO</span>
                <div class="grid grid-cols-2 gap-2 text-xs" id="habit-btn-group">
                    <button
                        type="button"
                        data-habit="always_full"
                        class="habit-btn py-3 px-3 rounded-sm border ${
                            onboardingState.refuelHabit === 'always_full'
                                ? 'border-[var(--accent-amber)] bg-[var(--bg-elevated)] text-[var(--accent-amber)] font-bold'
                                : 'border-[var(--line-hair)] text-[var(--text-secondary)] hover:border-[var(--line-strong)]'
                        } transition-all text-left cursor-pointer"
                    >
                        <span class="block font-bold">Tanque Lleno</span>
                        <span class="block text-[10px] text-[var(--text-secondary)] mt-0.5">Siempre lleno total</span>
                    </button>
                    <button
                        type="button"
                        data-habit="variable_amount"
                        class="habit-btn py-3 px-3 rounded-sm border ${
                            onboardingState.refuelHabit === 'variable_amount'
                                ? 'border-[var(--accent-amber)] bg-[var(--bg-elevated)] text-[var(--accent-amber)] font-bold'
                                : 'border-[var(--line-hair)] text-[var(--text-secondary)] hover:border-[var(--line-strong)]'
                        } transition-all text-left cursor-pointer"
                    >
                        <span class="block font-bold">Monto Variable</span>
                        <span class="block text-[10px] text-[var(--text-secondary)] mt-0.5">Fracciones o monto fijo</span>
                    </button>
                </div>
            </div>

            <!-- 2. Plataformas de Transporte / Carreras -->
            <div class="space-y-2 font-mono pt-2 border-t border-[var(--line-hair)]">
                <span class="block text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">¿TRABAJAS EN PLATAFORMAS DE TRANSPORTE?</span>
                <div class="grid grid-cols-2 gap-2 text-xs" id="rides-btn-group">
                    <button
                        type="button"
                        data-rides="true"
                        class="rides-btn py-3 px-3 rounded-sm border ${
                            onboardingState.ridesModuleEnabled
                                ? 'border-[var(--accent-volt)] bg-[var(--bg-elevated)] text-[var(--accent-volt)] font-bold'
                                : 'border-[var(--line-hair)] text-[var(--text-secondary)] hover:border-[var(--line-strong)]'
                        } transition-all text-left cursor-pointer"
                    >
                        <span class="block font-bold">Sí, hago carreras</span>
                        <span class="block text-[10px] text-[var(--text-secondary)] mt-0.5">Plataformas digitales o trabajo</span>
                    </button>
                    <button
                        type="button"
                        data-rides="false"
                        class="rides-btn py-3 px-3 rounded-sm border ${
                            !onboardingState.ridesModuleEnabled
                                ? 'border-[var(--accent-amber)] bg-[var(--bg-elevated)] text-[var(--accent-amber)] font-bold'
                                : 'border-[var(--line-hair)] text-[var(--text-secondary)] hover:border-[var(--line-strong)]'
                        } transition-all text-left cursor-pointer"
                    >
                        <span class="block font-bold">No, uso personal</span>
                        <span class="block text-[10px] text-[var(--text-secondary)] mt-0.5">Particular o familiar</span>
                    </button>
                </div>
            </div>

            <!-- 3. Kilómetros de Rutina Diario -->
            <div id="routine-km-group" class="${onboardingState.ridesModuleEnabled ? '' : 'opacity-40 pointer-events-none '}space-y-2 font-mono pt-2 border-t border-[var(--line-hair)] transition-opacity">
                <div class="flex items-center justify-between text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">
                    <span>KILÓMETROS DE RUTINA DIARIO</span>
                    <span id="routine-km-val" class="text-[var(--accent-amber)] tabular-nums font-bold text-xs">${onboardingState.routineDailyKm} KM/DÍA</span>
                </div>
                <input
                    id="onboard-routine-km"
                    type="range"
                    min="0"
                    max="80"
                    step="2"
                    value="${onboardingState.routineDailyKm}"
                    class="w-full accent-[var(--accent-amber)] cursor-pointer"
                />
                <div class="flex justify-between text-[9px] text-[var(--text-secondary)]">
                    <span>0 KM</span>
                    <span>24 KM (Promedio)</span>
                    <span>80 KM</span>
                </div>
            </div>
        </div>
    `;
}

/**
 * STEP 4: Fullscreen horizontal swipe carousel of gauges (ZERO BOXES, OPEN FLOATING STAGE).
 */
function renderStep4GaugesCarousel() {
    const activeGauge = GAUGE_OPTIONS[activeGaugeCarouselIdx];

    return `
        <div class="space-y-6 text-center">
            <div>
                <h1 class="font-sans font-light text-2xl sm:text-3xl tracking-tight text-[var(--text-primary)]">Estilo de medidor</h1>
            </div>

            <!-- Active Instrument Title & Step Counter (Clean hairline) -->
            <div class="w-full max-w-sm mx-auto flex items-center justify-between font-mono text-xs border-b border-[var(--line-hair)] pb-2">
                <span class="font-bold text-[var(--accent-amber)] uppercase tracking-wider">${activeGauge.title}</span>
                <span class="text-[10px] text-[var(--text-secondary)] tracking-widest">${activeGaugeCarouselIdx + 1} / 4</span>
            </div>

            <!-- Floating Canvas Stage (Zero boxes, completely transparent, no overflow clipping) -->
            <div class="relative w-full max-w-sm mx-auto flex items-center justify-between py-2">
                <!-- Floating Prev Button -->
                <button id="carousel-prev-btn" type="button" class="w-9 h-9 rounded-full border border-[var(--line-hair)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--line-strong)] flex items-center justify-center text-xs font-mono cursor-pointer transition-all active:scale-90 flex-shrink-0 z-10" title="Anterior">
                    ←
                </button>

                <!-- Free-floating Canvas Mount Container (Spacious: h-56 sm:h-64, zero clipping) -->
                <div id="carousel-gauge-mount" class="flex-1 w-full h-56 sm:h-64 flex items-center justify-center mx-1 select-none"></div>

                <!-- Floating Next Button -->
                <button id="carousel-next-btn" type="button" class="w-9 h-9 rounded-full border border-[var(--line-hair)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--line-strong)] flex items-center justify-center text-xs font-mono cursor-pointer transition-all active:scale-90 flex-shrink-0 z-10" title="Siguiente">
                    →
                </button>
            </div>

            <!-- Dots and Subtitle -->
            <div class="space-y-2 font-mono">
                <div class="flex items-center justify-center gap-2">
                    ${GAUGE_OPTIONS.map((g, idx) => `
                        <button
                            type="button"
                            data-carousel-dot="${idx}"
                            class="h-1 rounded-full transition-all cursor-pointer ${
                                idx === activeGaugeCarouselIdx
                                    ? 'w-6 bg-[var(--accent-amber)]'
                                    : 'w-2 bg-[var(--line-hair)] hover:bg-[var(--line-strong)]'
                            }"
                            title="${g.title}"
                        ></button>
                    `).join('')}
                </div>
                <span class="block text-[11px] text-[var(--text-secondary)] tracking-wider uppercase">${activeGauge.sub}</span>
            </div>
        </div>
    `;
}

/**
 * Generates an architectural SVG silhouette representing the vehicle in the chosen color.
 * Uses the exact 28 stylized vehicle silhouettes (viewBox 0 0 800 280).
 */
function renderSilhouetteSvg(chassisType, colorHex) {
    const modelId = onboardingState.svgModel || (chassisType === 'sedan' ? 'mazda-3' : (chassisType === 'suv' ? 'renault-duster' : 'kia-picanto'));
    return getInlineVehicleSvg(modelId, colorHex);
}

/**
 * STEP 5: Ready & Summary with Colored Silhouette (Clean Hairlines, Zero Boxes).
 */
function renderStep5Ready() {
    const activeGauge = GAUGE_OPTIONS.find(g => g.id === onboardingState.gaugeStyle) || GAUGE_OPTIONS[0];

    return `
        <div class="space-y-6">
            <div>
                <h1 class="font-sans font-light text-2xl sm:text-3xl tracking-tight text-[var(--text-primary)]">Listo para rodar</h1>
            </div>

            <!-- Vehicle Silhouette SVG in Selected Color (Flat Hairline Container, Strictly Contained) -->
            <div class="w-full h-32 sm:h-36 bg-transparent border-y border-[var(--line-hair)] py-2 flex items-center justify-center overflow-hidden">
                <div class="max-h-28 w-auto mx-auto object-contain overflow-hidden flex items-center justify-center [&>svg]:max-h-28 [&>svg]:w-auto [&>svg]:object-contain">
                    ${renderSilhouetteSvg(onboardingState.chassisType, onboardingState.vehicleColor)}
                </div>
            </div>

            <!-- Clean Summary Rows (Simple hairlines, zero nested boxes) -->
            <div class="divide-y divide-[var(--line-hair)] border-y border-[var(--line-hair)] font-mono text-xs">
                <div class="py-2.5 flex items-center justify-between">
                    <span class="text-[var(--text-secondary)] uppercase">VEHÍCULO</span>
                    <div class="flex items-center gap-2">
                        <span class="w-2.5 h-2.5 rounded-full" style="background-color: ${onboardingState.vehicleColor};"></span>
                        <span class="font-semibold text-[var(--text-primary)]">${onboardingState.vehicleName}</span>
                    </div>
                </div>
                <div class="py-2.5 flex items-center justify-between">
                    <span class="text-[var(--text-secondary)] uppercase">CAPACIDAD</span>
                    <span class="font-semibold text-[var(--accent-amber)] tabular-nums">${onboardingState.tankCapacityLiters} L (${onboardingState.tankCapacityGallons.toFixed(2)} GAL)</span>
                </div>
                <div class="py-2.5 flex items-center justify-between">
                    <span class="text-[var(--text-secondary)] uppercase">ODÓMETRO BASE</span>
                    <span class="font-semibold text-[var(--text-primary)] tabular-nums">${formatThousands(onboardingState.initialOdometer || 0)} KM</span>
                </div>
                <div class="py-2.5 flex items-center justify-between">
                    <span class="text-[var(--text-secondary)] uppercase">PERFIL DE USO</span>
                    <span class="font-semibold text-[var(--text-primary)]">
                        ${onboardingState.refuelHabit === 'always_full' ? 'Tanque Lleno' : 'Monto Variable'} · ${onboardingState.ridesModuleEnabled ? `Carreras (${onboardingState.routineDailyKm}km)` : 'Personal'}
                    </span>
                </div>
                <div class="py-2.5 flex items-center justify-between">
                    <span class="text-[var(--text-secondary)] uppercase">MEDIDOR</span>
                    <span class="font-semibold text-[var(--accent-amber)] uppercase">${activeGauge.title}</span>
                </div>
            </div>
        </div>
    `;
}

/**
 * Binds interactivity for the active step.
 */
function bindStepEvents() {
    if (!modalContainer) return;

    // Close button
    const closeBtn = modalContainer.querySelector('#onboarding-close-btn');
    if (closeBtn) closeBtn.onclick = () => closeOnboardingModal();

    // JSON Import button (Available immediately on Step 1)
    const jsonBtn = modalContainer.querySelector('#onboard-top-json-btn');
    const jsonFile = modalContainer.querySelector('#onboard-json-file');
    if (jsonBtn && jsonFile) {
        jsonBtn.onclick = () => jsonFile.click();
        jsonFile.onchange = (e) => handleOnboardingJsonFile(e.target.files?.[0]);
    }

    // Navigation buttons
    const prevBtn = modalContainer.querySelector('#onboarding-prev-btn');
    if (prevBtn) {
        prevBtn.onclick = () => {
            if (currentStep > 1) {
                playHorologyTick(900, 0.015, 0.02);
                currentStep -= 1;
                renderStep();
            }
        };
    }

    const nextBtn = modalContainer.querySelector('#onboarding-next-btn');
    if (nextBtn) {
        nextBtn.onclick = () => {
            if (currentStep < 5) {
                playHorologyTick(1100, 0.015, 0.025);
                currentStep += 1;
                renderStep();
            }
        };
    }

    const finishBtn = modalContainer.querySelector('#onboarding-finish-btn');
    if (finishBtn) finishBtn.onclick = () => finishOnboarding();

    // STEP 1 Events
    if (currentStep === 1) {
        function updateStep1Validation() {
            const hasName = Boolean(onboardingState.vehicleName && onboardingState.vehicleName.trim().length > 0);
            const hasLiters = Boolean(Number(onboardingState.tankCapacityLiters) > 0);
            const valid = hasName && hasLiters;

            const nBtn = modalContainer.querySelector('#onboarding-next-btn');
            if (nBtn) {
                nBtn.disabled = !valid;
                if (valid) {
                    nBtn.classList.remove('opacity-30', 'cursor-not-allowed', 'pointer-events-none');
                    nBtn.classList.add('hover:opacity-90', 'active:scale-95', 'cursor-pointer');
                } else {
                    nBtn.classList.add('opacity-30', 'cursor-not-allowed', 'pointer-events-none');
                    nBtn.classList.remove('hover:opacity-90', 'active:scale-95', 'cursor-pointer');
                }
            }

            const summaryEl = modalContainer.querySelector('#onboard-selected-summary');
            if (summaryEl) {
                if (valid) {
                    summaryEl.classList.remove('hidden');
                } else {
                    summaryEl.classList.add('hidden');
                }
            }
        }

        const searchMount = modalContainer.querySelector('#onboarding-vehicle-search');
        if (searchMount) {
            renderVehicleSearchBox(searchMount, {
                idPrefix: 'onboard',
                placeholder: 'Buscar modelo (Picanto, Spark, Logan...)',
                initialValue: onboardingState.vehicleName,
                hideLabel: true,
                hideSelectedStrip: true,
                onSelect: (veh) => {
                    playHorologyTick(1400, 0.02, 0.04);
                    onboardingState.vehicleName = veh.name || `${veh.brand} ${veh.model}`;
                    onboardingState.tankCapacityLiters = Number(veh.tank_capacity_liters) || 35.0;
                    onboardingState.tankCapacityGallons = Number(veh.tank_capacity_gallons) || 9.25;
                    onboardingState.reserveLiters = Number(veh.reserve_liters) || 5.0;
                    onboardingState.chassisType = veh.body_type === 'sedan' ? 'sedan' : (veh.body_type === 'suv' || veh.body_type === 'pickup' ? 'suv' : 'hatchback');
                    onboardingState.svgModel = veh.svgModel || mapBodySilhouette(veh);
                    if (veh.default_gauge_style) {
                        onboardingState.gaugeStyle = veh.default_gauge_style;
                    }

                    // Update summary strip
                    const summaryTitle = modalContainer.querySelector('#onboard-summary-title');
                    const summaryCap = modalContainer.querySelector('#onboard-summary-cap');
                    if (summaryTitle) summaryTitle.innerText = onboardingState.vehicleName;
                    if (summaryCap) summaryCap.innerText = `${onboardingState.tankCapacityLiters}L (${onboardingState.tankCapacityGallons.toFixed(2)}G)`;

                    // Sync manual inputs if open
                    const nameInp = modalContainer.querySelector('#manual-veh-name');
                    const litInp = modalContainer.querySelector('#manual-veh-liters');
                    const galRead = modalContainer.querySelector('#manual-gal-readout');
                    if (nameInp) nameInp.value = onboardingState.vehicleName;
                    if (litInp) litInp.value = onboardingState.tankCapacityLiters;
                    if (galRead) galRead.innerText = `${onboardingState.tankCapacityGallons.toFixed(2)} GAL`;

                    updateStep1Validation();
                },
                onClear: () => {
                    if (!isManualMode) {
                        onboardingState.vehicleName = '';
                        onboardingState.tankCapacityLiters = 0;
                        onboardingState.tankCapacityGallons = 0;
                        updateStep1Validation();
                    }
                }
            });
        }

        // Toggle Manual Mode
        const toggleBtn = modalContainer.querySelector('#toggle-manual-btn');
        if (toggleBtn) {
            toggleBtn.onclick = () => {
                isManualMode = !isManualMode;
                playHorologyTick(1100, 0.015, 0.02);
                renderStep();
            };
        }

        // Manual form inputs
        const nameInp = modalContainer.querySelector('#manual-veh-name');
        if (nameInp) {
            nameInp.oninput = () => {
                onboardingState.vehicleName = nameInp.value.trim();
                const summaryTitle = modalContainer.querySelector('#onboard-summary-title');
                if (summaryTitle) summaryTitle.innerText = onboardingState.vehicleName;
                updateStep1Validation();
            };
        }

        const litInp = modalContainer.querySelector('#manual-veh-liters');
        const galRead = modalContainer.querySelector('#manual-gal-readout');
        if (litInp) {
            litInp.oninput = () => {
                const l = parseFloat(litInp.value) || 0;
                onboardingState.tankCapacityLiters = l;
                onboardingState.tankCapacityGallons = Number((l * L_TO_GAL).toFixed(2));
                if (galRead) galRead.innerText = `${onboardingState.tankCapacityGallons.toFixed(2)} GAL`;
                const summaryCap = modalContainer.querySelector('#onboard-summary-cap');
                if (summaryCap) summaryCap.innerText = `${onboardingState.tankCapacityLiters}L (${onboardingState.tankCapacityGallons.toFixed(2)}G)`;
                updateStep1Validation();
            };
        }

        updateStep1Validation();

        // Chassis buttons
        modalContainer.querySelectorAll('.chassis-btn').forEach(btn => {
            btn.onclick = () => {
                const ch = btn.dataset.chassis;
                playHorologyTick(1200, 0.012, 0.025);
                onboardingState.chassisType = ch;
                onboardingState.svgModel = ch === 'sedan' ? 'mazda-3' : (ch === 'suv' ? 'renault-duster' : 'kia-picanto');
                modalContainer.querySelectorAll('.chassis-btn').forEach(b => {
                    const isSelected = b.dataset.chassis === ch;
                    b.className = `chassis-btn h-9 rounded-sm border ${isSelected ? 'border-[var(--accent-amber)] bg-[var(--bg-elevated)] text-[var(--accent-amber)] font-bold' : 'border-[var(--line-hair)] text-[var(--text-secondary)] hover:border-[var(--line-strong)]'} transition-all cursor-pointer`;
                });
            };
        });

        // 12 Color Palette
        modalContainer.querySelectorAll('.color-dot-btn').forEach(btn => {
            btn.onclick = () => {
                const hex = btn.dataset.color;
                const name = btn.dataset.name;
                playHorologyTick(1250, 0.012, 0.025);
                onboardingState.vehicleColor = hex;
                const lbl = modalContainer.querySelector('#selected-color-name');
                if (lbl) lbl.innerText = name;

                modalContainer.querySelectorAll('.color-dot-btn').forEach(b => {
                    const isSelected = b.dataset.color.toLowerCase() === hex.toLowerCase();
                    b.className = `color-dot-btn w-6 h-6 rounded-full border transition-all ${
                        isSelected ? 'scale-110 border-white ring-2 ring-[var(--accent-amber)]' : 'border-[var(--line-hair)] hover:scale-105'
                    }`;
                });
            };
        });

        const colorPicker = modalContainer.querySelector('#custom-color-picker');
        if (colorPicker) {
            colorPicker.oninput = (e) => {
                const hex = e.target.value;
                onboardingState.vehicleColor = hex;
                const lbl = modalContainer.querySelector('#selected-color-name');
                if (lbl) lbl.innerText = 'Personalizado';
            };
        }
    }

    // STEP 2 Events (Real-time thousands dot formatting)
    if (currentStep === 2) {
        const odoInput = modalContainer.querySelector('#onboard-odo-formatted');
        if (odoInput) {
            odoInput.oninput = () => {
                const parsed = parseThousands(odoInput.value);
                onboardingState.initialOdometer = parsed;
                const formatted = parsed > 0 ? formatThousands(parsed) : '';
                odoInput.value = formatted;
            };
        }
    }

    // STEP 3 Events (Perfil de uso)
    if (currentStep === 3) {
        modalContainer.querySelectorAll('.habit-btn').forEach(btn => {
            btn.onclick = () => {
                const habit = btn.dataset.habit;
                playHorologyTick(1200, 0.015, 0.02);
                onboardingState.refuelHabit = habit;
                modalContainer.querySelectorAll('.habit-btn').forEach(b => {
                    const isSel = b.dataset.habit === habit;
                    b.className = `habit-btn py-3 px-3 rounded-sm border ${
                        isSel
                            ? 'border-[var(--accent-amber)] bg-[var(--bg-elevated)] text-[var(--accent-amber)] font-bold'
                            : 'border-[var(--line-hair)] text-[var(--text-secondary)] hover:border-[var(--line-strong)]'
                    } transition-all text-left cursor-pointer`;
                });
            };
        });

        modalContainer.querySelectorAll('.rides-btn').forEach(btn => {
            btn.onclick = () => {
                const isRides = btn.dataset.rides === 'true';
                playHorologyTick(1200, 0.015, 0.02);
                onboardingState.ridesModuleEnabled = isRides;
                modalContainer.querySelectorAll('.rides-btn').forEach(b => {
                    const isSel = (b.dataset.rides === 'true') === isRides;
                    const accent = isRides ? 'var(--accent-volt)' : 'var(--accent-amber)';
                    b.className = `rides-btn py-3 px-3 rounded-sm border ${
                        isSel
                            ? 'border-[' + accent + '] bg-[var(--bg-elevated)] text-[' + accent + '] font-bold'
                            : 'border-[var(--line-hair)] text-[var(--text-secondary)] hover:border-[var(--line-strong)]'
                    } transition-all text-left cursor-pointer`;
                });

                const routineGroup = modalContainer.querySelector('#routine-km-group');
                if (routineGroup) {
                    if (isRides) {
                        routineGroup.classList.remove('opacity-40', 'pointer-events-none');
                    } else {
                        routineGroup.classList.add('opacity-40', 'pointer-events-none');
                    }
                }
            };
        });

        const routineSlider = modalContainer.querySelector('#onboard-routine-km');
        const routineVal = modalContainer.querySelector('#routine-km-val');
        if (routineSlider) {
            routineSlider.oninput = (e) => {
                const km = parseInt(e.target.value, 10) || 0;
                onboardingState.routineDailyKm = km;
                if (routineVal) routineVal.innerText = `${km} KM/DÍA`;
            };
        }
    }

    // STEP 4 Events (Carousel navigation)
    if (currentStep === 4) {
        mountActiveCarouselGauge();

        const prevBtn = modalContainer.querySelector('#carousel-prev-btn');
        const nextBtn = modalContainer.querySelector('#carousel-next-btn');

        if (prevBtn) {
            prevBtn.onclick = () => {
                playHorologyTick(1200, 0.015, 0.025);
                activeGaugeCarouselIdx = (activeGaugeCarouselIdx - 1 + GAUGE_OPTIONS.length) % GAUGE_OPTIONS.length;
                onboardingState.gaugeStyle = GAUGE_OPTIONS[activeGaugeCarouselIdx].id;
                renderStep();
            };
        }

        if (nextBtn) {
            nextBtn.onclick = () => {
                playHorologyTick(1200, 0.015, 0.025);
                activeGaugeCarouselIdx = (activeGaugeCarouselIdx + 1) % GAUGE_OPTIONS.length;
                onboardingState.gaugeStyle = GAUGE_OPTIONS[activeGaugeCarouselIdx].id;
                renderStep();
            };
        }

        modalContainer.querySelectorAll('[data-carousel-dot]').forEach(btn => {
            btn.onclick = () => {
                const dotIdx = parseInt(btn.dataset.carouselDot, 10);
                if (!isNaN(dotIdx) && dotIdx !== activeGaugeCarouselIdx) {
                    playHorologyTick(1200, 0.015, 0.025);
                    activeGaugeCarouselIdx = dotIdx;
                    onboardingState.gaugeStyle = GAUGE_OPTIONS[activeGaugeCarouselIdx].id;
                    renderStep();
                }
            };
        });
    }
}

/**
 * Mounts the single active gauge in the carousel stage with proper scale & containment.
 */
function mountActiveCarouselGauge() {
    teardownActiveGaugePreview();

    setTimeout(() => {
        const mount = modalContainer?.querySelector('#carousel-gauge-mount');
        if (!mount) return;
        mount.innerHTML = '';

        const styleId = GAUGE_OPTIONS[activeGaugeCarouselIdx].id;
        const opts = {
            initialValue: 65,
            interactive: true,
            hideReadout: true,
            tankCapacityLiters: onboardingState.tankCapacityLiters,
            tankCapacityGallons: onboardingState.tankCapacityGallons
        };

        try {
            if (styleId === 'spicy-arc') {
                activeGaugeInstance = renderSpicyArcGauge(mount, opts);
            } else if (styleId === 'analog-180') {
                activeGaugeInstance = renderAnalog180Gauge(mount, opts);
            } else if (styleId === 'digital-lcd') {
                activeGaugeInstance = renderDigitalLcdGauge(mount, { ...opts, hideToolbar: true });
            } else if (styleId === 'sight-glass') {
                activeGaugeInstance = renderSightGlassGauge(mount, opts);
            }
        } catch (_) {}
    }, 15);
}

/**
 * Completes Onboarding safely: Saves profile, seeds initial log once, updates store and navigates.
 */
async function finishOnboarding() {
    playHorologyTick(1600, 0.03, 0.05);

    const profile = {
        id: 'main',
        name: onboardingState.vehicleName || 'Mi Vehículo',
        tankCapacityLiters: Number(onboardingState.tankCapacityLiters) || 35.0,
        tankCapacityGallons: Number((onboardingState.tankCapacityLiters * L_TO_GAL).toFixed(2)),
        reserveLiters: Number(onboardingState.reserveLiters) || 5.0,
        fuelPriceCop: 16000,
        gaugeStyle: onboardingState.gaugeStyle || 'spicy-arc',
        svgModel: onboardingState.svgModel || 'kia-picanto',
        chassisType: onboardingState.chassisType || 'hatchback',
        vehicleColor: onboardingState.vehicleColor || '#F8F9FA',
        refuelHabit: onboardingState.refuelHabit || 'always_full',
        ridesModuleEnabled: Boolean(onboardingState.ridesModuleEnabled),
        routineDailyKm: Number(onboardingState.routineDailyKm) || 24,
        initialOdometer: Number(onboardingState.initialOdometer) || 0,
        isConfigured: true,
        onboardingCompleted: true,
        updatedAt: new Date().toISOString()
    };

    try {
        await saveVehicleProfile(profile);
    } catch (_) {}

    // Seed initial odometer baseline reading if store has no logs
    let finalLogs = [];
    if (profile.initialOdometer > 0) {
        try {
            const logs = await getTelemetryLogs();
            if (logs.length === 0) {
                const baselineLog = {
                    date: todayLocalYmd(),
                    odometer_reading: profile.initialOdometer,
                    fuel_level_percent: 100,
                    gallons_added: 0,
                    is_full_tank: true,
                    total_cost_cop: 0
                };
                await addTelemetryLog(baselineLog);
                finalLogs = await getTelemetryLogs();
            } else {
                finalLogs = logs;
            }
        } catch (_) {}
    }

    // Unified store mutation to prevent cascading refresh loops
    const stateUpdate = { vehicleProfile: profile };
    if (finalLogs.length > 0) {
        stateUpdate.telemetryLogs = finalLogs;
    }
    store.setState(stateUpdate);

    // Clean teardown and close
    closeOnboardingModal();
    showToast('CALIBRACIÓN COMPLETADA');

    // Notify app router once
    window.dispatchEvent(new CustomEvent('octane:profile-configured', { detail: { profile } }));
    window.dispatchEvent(new CustomEvent('octane:navigate', { detail: { view: 'cockpit' } }));
}

/**
 * Fast-forward JSON restore directly on Step 1.
 */
async function handleOnboardingJsonFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const parsed = JSON.parse(e.target.result);
            if (parsed.stores) {
                await importAllStores(parsed);
            } else {
                let arr = Array.isArray(parsed) ? parsed : (parsed.telemetry_logs || parsed.records || []);
                if (arr.length > 0) {
                    await bulkAddTelemetryLogs(arr);
                }
            }
            const logs = await getTelemetryLogs();
            let profile = await getVehicleProfile();
            if (profile && !profile.isConfigured) {
                profile.isConfigured = true;
                profile.onboardingCompleted = true;
                await saveVehicleProfile(profile);
            }
            store.setState({ telemetryLogs: logs, vehicleProfile: profile });
            window.dispatchEvent(new CustomEvent('octane:logs-updated', { detail: { logs } }));
            window.dispatchEvent(new CustomEvent('octane:profile-updated', { detail: { vehicleProfile: profile } }));

            showToast('COPIA RESTAURADA');
            closeOnboardingModal();
            window.dispatchEvent(new CustomEvent('octane:navigate', { detail: { view: 'cockpit' } }));
        } catch (_) {
            showToast('ERROR AL LEER COPIA DE SEGURIDAD');
        }
    };
    reader.readAsText(file);
}
