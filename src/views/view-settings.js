/**
 * OCTANE — Settings View ("Ajustes")
 * Swiss Industrial Architectural Calibration View
 * 
 * Directives:
 * - Silent Verbal Manifesto: Zero <p> tags, zero double slash (//), zero technical jargon.
 * - Symmetrical Clean Architecture with Underline Inputs.
 * - Intelligent Price per Gallon for simulations.
 * - Modals for "Cambiar vehículo" and "Cambiar estilo de medidor".
 * - Human language for cloud & backup: "Guardado en este dispositivo", "Exportar copia de seguridad", "Importar copia de seguridad", "Borrar todos los datos".
 */

import { confirmDialog } from '../components/dialogs/app-dialog.js';
import { todayLocalYmd } from '../core/date-utils.js';
import { store } from '../core/state.js';
import { isSoundEnabled, setSoundEnabled } from '../core/telemetry-engine.js';
import {
  getVehicleProfile,
  saveVehicleProfile,
  clearAllData,
  getTelemetryLogs,
  saveTelemetryLogs
} from '../core/db-local.js';
import {
  signInWithGoogle,
  signOutUser,
  syncToCloud,
  getCurrentUser
} from '../core/firebase-sync.js';
import {
  exportMasterBackup,
  exportLlmAnalysisJson,
  exportLlmMarkdownReport,
  copyLlmReportToClipboard,
  getExportMetricsSummary,
  inspectBackupFile,
  importFromJSONString
} from '../core/json-io.js';
import { syncGpsTelemetry, DEFAULT_GPS_CONFIG, getGpsConfig, saveRememberedGpsCreds, resolveProxyMode } from '../core/iopgps-sync.js';
import { CAR_COLORS } from '../components/modals/modal-onboarding.js';
import { playHorologyTick } from '../components/fuel-gauges/gauge-controller.js';
import { renderSpicyArcGauge } from '../components/fuel-gauges/gauge-spicy-arc.js';
import { renderAnalog180Gauge } from '../components/fuel-gauges/gauge-analog-180.js';
import { renderDigitalLcdGauge } from '../components/fuel-gauges/gauge-digital-lcd.js';
import { renderSightGlassGauge } from '../components/fuel-gauges/gauge-sight-glass.js';
import { AVAILABLE_MODELS, getInlineVehicleSvg } from '../assets/vehicles-svg/models-inline.js';

let modalGaugePreviewInstance = null;
const GAL_TO_L = 3.78541;

function showToast(text) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('octane:toast', { detail: { message: text } }));
  }
}

/**
 * Curated brand models for accordion selection
 */
const BRAND_MODELS = [
  {
    brand: 'Kia',
    models: [
      { name: 'Kia Picanto 1.0L', liters: 35.0, gallons: 9.25, reserve: 5.0, svgModel: 'kia-picanto' },
      { name: 'Kia Rio 1.4L', liters: 45.0, gallons: 11.9, reserve: 6.0, svgModel: 'kia-picanto' },
      { name: 'Kia Soluto 1.4L', liters: 43.0, gallons: 11.36, reserve: 6.0, svgModel: 'kia-picanto' },
      { name: 'Kia Sportage 2.0L', liters: 54.0, gallons: 14.27, reserve: 7.0, svgModel: 'kia-sportage' }
    ]
  },
  {
    brand: 'Renault',
    models: [
      { name: 'Renault Kwid 1.0L', liters: 35.0, gallons: 9.25, reserve: 5.0, svgModel: 'renault-kwid' },
      { name: 'Renault Sandero 1.6L', liters: 50.0, gallons: 13.21, reserve: 6.0, svgModel: 'renault-sandero' },
      { name: 'Renault Stepway 1.6L', liters: 50.0, gallons: 13.21, reserve: 6.0, svgModel: 'renault-sandero' },
      { name: 'Renault Logan 1.6L', liters: 50.0, gallons: 13.21, reserve: 6.0, svgModel: 'renault-logan' },
      { name: 'Renault Duster 1.6L/2.0L', liters: 50.0, gallons: 13.21, reserve: 6.5, svgModel: 'renault-duster' },
      { name: 'Renault Twingo 1.2L', liters: 40.0, gallons: 10.57, reserve: 5.0, svgModel: 'renault-twingo' }
    ]
  },
  {
    brand: 'Chevrolet',
    models: [
      { name: 'Chevrolet Spark GT 1.2L', liters: 35.0, gallons: 9.25, reserve: 4.5, svgModel: 'chevrolet-spark-gt' },
      { name: 'Chevrolet Beat 1.2L', liters: 35.0, gallons: 9.25, reserve: 4.5, svgModel: 'chevrolet-spark-gt' },
      { name: 'Chevrolet Onix Hatchback 1.0T', liters: 44.0, gallons: 11.62, reserve: 6.0, svgModel: 'chevrolet-onix-hatch' },
      { name: 'Chevrolet Onix Sedán 1.0T', liters: 44.0, gallons: 11.62, reserve: 6.0, svgModel: 'chevrolet-onix-sedan' },
      { name: 'Chevrolet Sail 1.4L', liters: 42.0, gallons: 11.1, reserve: 5.5, svgModel: 'chevrolet-sail' },
      { name: 'Chevrolet Aveo 1.6L', liters: 45.0, gallons: 11.9, reserve: 6.0, svgModel: 'chevrolet-aveo' },
      { name: 'Chevrolet Tracker 1.2T', liters: 44.0, gallons: 11.62, reserve: 6.0, svgModel: 'chevrolet-tracker' }
    ]
  },
  {
    brand: 'Mazda',
    models: [
      { name: 'Mazda 2 Hatchback 1.5L', liters: 44.0, gallons: 11.62, reserve: 6.0, svgModel: 'mazda-2-hatch' },
      { name: 'Mazda 2 Sedán 1.5L', liters: 44.0, gallons: 11.62, reserve: 6.0, svgModel: 'mazda-2-hatch' },
      { name: 'Mazda 3 Sedán 2.0L', liters: 51.0, gallons: 13.47, reserve: 7.0, svgModel: 'mazda-3' },
      { name: 'Mazda CX-30 2.0L', liters: 51.0, gallons: 13.47, reserve: 7.0, svgModel: 'mazda-cx30' }
    ]
  },
  {
    brand: 'Suzuki',
    models: [
      { name: 'Suzuki Swift 1.2L', liters: 37.0, gallons: 9.77, reserve: 5.0, svgModel: 'suzuki-swift' },
      { name: 'Suzuki S-Presso 1.0L', liters: 27.0, gallons: 7.13, reserve: 4.0, svgModel: 'suzuki-swift' },
      { name: 'Suzuki Vitara 1.6L', liters: 47.0, gallons: 12.42, reserve: 6.0, svgModel: 'suzuki-vitara' }
    ]
  },
  {
    brand: 'Toyota',
    models: [
      { name: 'Toyota Corolla 2.0L', liters: 50.0, gallons: 13.21, reserve: 6.5, svgModel: 'toyota-corolla' },
      { name: 'Toyota Yaris 1.5L', liters: 42.0, gallons: 11.1, reserve: 5.5, svgModel: 'toyota-corolla' },
      { name: 'Toyota Hilux 2.7L/2.4D', liters: 80.0, gallons: 21.13, reserve: 10.0, svgModel: 'toyota-hilux' },
      { name: 'Toyota Fortuner 2.7L/2.8D', liters: 80.0, gallons: 21.13, reserve: 10.0, svgModel: 'toyota-fortuner' },
      { name: 'Toyota Prado TXL', liters: 87.0, gallons: 22.98, reserve: 11.0, svgModel: 'toyota-prado' }
    ]
  },
  {
    brand: 'Nissan',
    models: [
      { name: 'Nissan March 1.6L', liters: 41.0, gallons: 10.83, reserve: 5.5, svgModel: 'nissan-march' },
      { name: 'Nissan Versa 1.6L', liters: 41.0, gallons: 10.83, reserve: 5.5, svgModel: 'nissan-versa' },
      { name: 'Nissan Kicks 1.6L', liters: 41.0, gallons: 10.83, reserve: 5.5, svgModel: 'nissan-versa' },
      { name: 'Nissan Frontier 2.5D', liters: 80.0, gallons: 21.13, reserve: 10.0, svgModel: 'nissan-frontier' }
    ]
  },
  {
    brand: 'Hyundai',
    models: [
      { name: 'Hyundai Grand i10 1.2L', liters: 43.0, gallons: 11.36, reserve: 5.5, svgModel: 'kia-picanto' },
      { name: 'Hyundai Accent 1.4L', liters: 45.0, gallons: 11.9, reserve: 6.0, svgModel: 'hyundai-accent' },
      { name: 'Hyundai Tucson 2.0L', liters: 54.0, gallons: 14.27, reserve: 7.0, svgModel: 'kia-sportage' }
    ]
  },
  {
    brand: 'Volkswagen',
    models: [
      { name: 'Volkswagen Gol 1.6L', liters: 55.0, gallons: 14.53, reserve: 7.0, svgModel: 'volkswagen-gol' },
      { name: 'Volkswagen Voyage 1.6L', liters: 55.0, gallons: 14.53, reserve: 7.0, svgModel: 'volkswagen-gol' },
      { name: 'Volkswagen Polo 1.6L', liters: 50.0, gallons: 13.21, reserve: 6.5, svgModel: 'volkswagen-gol' }
    ]
  }
];

function getGaugeLabel(style) {
  switch (style) {
    case 'analog-180': return 'Dial 180°';
    case 'digital-lcd': return 'Barras digitales';
    case 'sight-glass': return 'Cilindro óptico';
    case 'spicy-arc':
    default: return 'Arco vertical';
  }
}

/**
 * Renders the Settings View into the provided container element.
 * @param {HTMLElement} container
 */
export async function renderSettingsView(container) {
  playHorologyTick(1200, 0.015, 0.03);

  let profile = {
    id: 'main',
    name: 'Kia Picanto 1.0L',
    tankCapacityLiters: 35.0,
    tankCapacityGallons: 9.25,
    reserveLiters: 5.0,
    fuelPriceCop: 16000,
    gaugeStyle: 'spicy-arc',
    svgModel: 'picanto-2017',
    routineDailyKm: 24,
    ridesModuleEnabled: true,
    vehicleColor: '#F8F9FA'
  };

  try {
    if (store && typeof store.getState === 'function') {
      const state = store.getState();
      if (state.vehicleProfile) {
        profile = { ...profile, ...state.vehicleProfile };
      }
    } else {
      const dbProfile = await getVehicleProfile();
      if (dbProfile) {
        profile = { ...profile, ...dbProfile };
      }
    }
  } catch (err) {
    console.warn('[OCTANE] Settings profile load issue:', err);
  }

  let currentUser = null;
  const currentUnit = (store && typeof store.getState === 'function') ? (store.getState().currentUnit || 'gal') : 'gal';
  const currentTheme = (typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme'))
    || ((store && typeof store.getState === 'function') ? (store.getState().theme || 'dark') : 'dark');
  const currentSound = isSoundEnabled();
  try {
    if (typeof getCurrentUser === 'function') {
      currentUser = getCurrentUser();
    } else if (store && typeof store.getState === 'function') {
      currentUser = store.getState().currentUser || null;
    }
  } catch (e) {}

  const gpsCfg = getGpsConfig(profile);
  const proxyInfo = resolveProxyMode(gpsCfg);
  const isTemporaryBridge = Boolean(gpsCfg.username && !gpsCfg.proxyUrl && proxyInfo.mode === 'public-bridge');

  container.innerHTML = `
    <div class="view-settings w-full space-y-6 pb-20 select-none">
      
      <!-- Top Title Header -->
      <div class="border-b border-[var(--line-hair)] pb-3 flex items-center justify-between">
        <div class="flex items-center gap-2.5">
          <span class="w-2 h-2 bg-[var(--accent-amber)]"></span>
          <h1 class="font-mono text-xs uppercase tracking-widest text-[var(--text-primary)]">AJUSTES</h1>
          <span class="font-mono text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">CONFIGURACIÓN</span>
        </div>
        <div class="flex items-center gap-2 font-mono text-[10px]">
          <span class="w-1.5 h-1.5 rounded-full ${navigator.onLine ? 'bg-[var(--accent-volt)]' : 'bg-[var(--accent-crimson)]'}"></span>
          <span class="text-[var(--text-secondary)] uppercase tracking-wider">${navigator.onLine ? 'EN LÍNEA' : 'SIN CONEXIÓN'}</span>
        </div>
      </div>

      <!-- SECTION 1: VEHÍCULO ACTUAL (TARJETA RESUMEN) -->
      <section class="flat-frame bg-[var(--bg-surface)] border border-[var(--line-hair)] p-5 space-y-5">
        <div class="flex items-center justify-between border-b border-[var(--line-hair)] pb-3">
          <span class="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">VEHÍCULO ACTUAL</span>
          <span class="font-mono text-[10px] uppercase tracking-widest text-[var(--accent-amber)] font-medium">CALIBRADO</span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
          <!-- Left details (7 cols) -->
          <div class="md:col-span-7 space-y-3 font-mono">
            <div>
              <div class="font-sans font-light text-2xl text-[var(--text-primary)] tracking-tight leading-none">${profile.name}</div>
              <div class="text-xs text-[var(--text-secondary)] mt-1.5 tabular-nums">
                ${profile.tankCapacityLiters.toFixed(1)} L · ${profile.tankCapacityGallons} GAL (Reserva: ${profile.reserveLiters.toFixed(1)} L)
              </div>
            </div>

            <div class="grid grid-cols-2 gap-3 pt-2 border-t border-[var(--line-hair)] text-xs">
              <div>
                <span class="block text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">ESTILO DE MEDIDOR</span>
                <span class="font-medium text-[var(--text-primary)] mt-0.5 block">${getGaugeLabel(profile.gaugeStyle)}</span>
              </div>
              <div>
                <span class="block text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">COLOR CARROCERÍA</span>
                <div class="flex items-center gap-2 mt-0.5">
                  <span class="w-3 h-3 rounded-full border border-white/20 inline-block" style="background-color: ${profile.vehicleColor || '#F8F9FA'};"></span>
                  <span class="font-medium text-[var(--text-primary)]">${CAR_COLORS.find(c => c.hex.toLowerCase() === (profile.vehicleColor || '').toLowerCase())?.name || 'Personalizado'}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Right vehicle CAD preview strictly contained (5 cols) -->
          <div class="md:col-span-5 bg-[var(--bg-void)] border border-[var(--line-hair)] p-3 h-28 flex items-center justify-center overflow-hidden">
            <div class="vehicle-cad-preview max-h-24 h-full w-full mx-auto object-contain overflow-hidden flex items-center justify-center" style="--car-paint: ${profile.vehicleColor || '#FF5500'}">
              ${getInlineVehicleSvg(profile.svgModel || 'kia-picanto', profile.vehicleColor || '#FF5500')}
            </div>
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-[var(--line-hair)]">
          <button 
            id="btn-open-change-vehicle" 
            type="button" 
            class="h-10 px-4 border border-[var(--line-strong)] hover:border-[var(--accent-amber)] hover:bg-[var(--bg-elevated)] text-[var(--text-primary)] font-mono text-xs font-semibold uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95"
          >
            <svg class="w-4 h-4 text-[var(--accent-amber)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            <span>Cambiar vehículo</span>
          </button>

          <button 
            id="btn-open-change-gauge" 
            type="button" 
            class="h-10 px-4 border border-[var(--line-strong)] hover:border-[var(--accent-amber)] hover:bg-[var(--bg-elevated)] text-[var(--text-primary)] font-mono text-xs font-semibold uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95"
          >
            <svg class="w-4 h-4 text-[var(--accent-amber)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>Cambiar estilo de medidor</span>
          </button>
        </div>
      </section>

      <!-- SECTION 2: PARÁMETROS OPERATIVOS -->
      <section class="flat-frame bg-[var(--bg-surface)] border border-[var(--line-hair)] p-5 space-y-4">
        <div class="flex items-center justify-between border-b border-[var(--line-hair)] pb-3">
          <span class="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">PARÁMETROS OPERATIVOS</span>
          <span class="font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">EN VIVO</span>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono">
          <!-- Precio Estimado por Galón -->
          <div class="space-y-1">
            <label class="block font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">PRECIO ESTIMADO POR GALÓN (COP)</label>
            <input 
              id="set-fuel-price" 
              type="number" 
              step="100" 
              value="${profile.fuelPriceCop || 16000}" 
              class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-2 outline-none text-[var(--text-primary)] font-mono text-sm tabular-nums" 
            />
            <span class="block text-[9px] text-[var(--text-muted)] tracking-tight">Utilizado para simulaciones; cada tanqueada guarda su precio histórico real.</span>
          </div>

          <!-- Rodaje Habitual Diario -->
          <div class="space-y-1">
            <label class="block font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">RODAJE HABITUAL DIARIO (KM)</label>
            <input 
              id="set-daily-km" 
              type="number" 
              step="1" 
              value="${profile.routineDailyKm || 24}" 
              class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-2 outline-none text-[var(--text-primary)] font-mono text-sm tabular-nums" 
            />
            <span class="block text-[9px] text-[var(--text-muted)] tracking-tight">Kilómetros diarios promedio sin carreras de trabajo.</span>
          </div>

          <!-- Unidad de Eficiencia -->
          <div class="space-y-1 sm:col-span-2 pt-2 border-t border-[var(--line-hair)]">
            <label class="block font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)] mb-2">UNIDAD DE RENDIMIENTO</label>
            <div class="grid grid-cols-3 gap-2 font-mono text-xs" id="set-unit-selector">
              <button type="button" data-unit="gal" class="unit-opt-btn h-9 border ${currentUnit === 'gal' ? 'border-[var(--accent-amber)] bg-[var(--bg-elevated)] text-[var(--accent-amber)] font-bold' : 'border-[var(--line-hair)] text-[var(--text-secondary)] hover:border-[var(--line-strong)]'} transition-all cursor-pointer">
                KM / GAL
              </button>
              <button type="button" data-unit="l100" class="unit-opt-btn h-9 border ${currentUnit === 'l100' ? 'border-[var(--accent-amber)] bg-[var(--bg-elevated)] text-[var(--accent-amber)] font-bold' : 'border-[var(--line-hair)] text-[var(--text-secondary)] hover:border-[var(--line-strong)]'} transition-all cursor-pointer">
                L / 100 KM
              </button>
              <button type="button" data-unit="kml" class="unit-opt-btn h-9 border ${currentUnit === 'kml' ? 'border-[var(--accent-amber)] bg-[var(--bg-elevated)] text-[var(--accent-amber)] font-bold' : 'border-[var(--line-hair)] text-[var(--text-secondary)] hover:border-[var(--line-strong)]'} transition-all cursor-pointer">
                KM / LITRO
              </button>
            </div>
          </div>

          <!-- Tema de Interfaz (Brillo / Modo) y Sonido Táctil -->
          <div class="space-y-1 pt-2 border-t border-[var(--line-hair)]">
            <label class="block font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)] mb-2">TEMA DE INTERFAZ</label>
            <div class="grid grid-cols-2 gap-2 font-mono text-xs" id="set-theme-selector">
              <button type="button" data-theme-opt="dark" class="theme-opt-btn h-9 border ${currentTheme !== 'light' ? 'border-[var(--accent-amber)] bg-[var(--bg-elevated)] text-[var(--accent-amber)] font-bold' : 'border-[var(--line-hair)] text-[var(--text-secondary)] hover:border-[var(--line-strong)]'} transition-all cursor-pointer">
                MODO CARBÓN
              </button>
              <button type="button" data-theme-opt="light" class="theme-opt-btn h-9 border ${currentTheme === 'light' ? 'border-[var(--accent-amber)] bg-[var(--bg-elevated)] text-[var(--accent-amber)] font-bold' : 'border-[var(--line-hair)] text-[var(--text-secondary)] hover:border-[var(--line-strong)]'} transition-all cursor-pointer">
                MODO PAPEL
              </button>
            </div>
          </div>

          <div class="space-y-1 pt-2 border-t border-[var(--line-hair)]">
            <label class="block font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)] mb-2">SONIDO TÁCTIL</label>
            <div class="grid grid-cols-2 gap-2 font-mono text-xs" id="set-sound-selector">
              <button type="button" data-sound-opt="on" class="sound-opt-btn h-9 border ${currentSound ? 'border-[var(--accent-amber)] bg-[var(--bg-elevated)] text-[var(--accent-amber)] font-bold' : 'border-[var(--line-hair)] text-[var(--text-secondary)] hover:border-[var(--line-strong)]'} transition-all cursor-pointer">
                ACTIVADO
              </button>
              <button type="button" data-sound-opt="off" class="sound-opt-btn h-9 border ${!currentSound ? 'border-[var(--accent-amber)] bg-[var(--bg-elevated)] text-[var(--accent-amber)] font-bold' : 'border-[var(--line-hair)] text-[var(--text-secondary)] hover:border-[var(--line-strong)]'} transition-all cursor-pointer">
                SILENCIADO
              </button>
            </div>
          </div>

          <!-- Módulo Carreras -->
          <div class="sm:col-span-2 pt-2 border-t border-[var(--line-hair)] flex items-center justify-between font-mono">
            <div>
              <span class="font-mono text-xs font-medium text-[var(--text-primary)] block">MÓDULO DE CARRERAS</span>
              <span class="text-[10px] text-[var(--text-secondary)] block">Habilita la pestaña de carreras y contabilidad de viajes en el dock.</span>
            </div>
            <input id="set-rides-toggle" type="checkbox" ${profile.ridesModuleEnabled ? 'checked' : ''} class="w-4 h-4 rounded-sm accent-[var(--accent-amber)] cursor-pointer" />
          </div>
        </div>

        <div class="flex justify-end pt-3 border-t border-[var(--line-hair)]">
          <button id="save-params-btn" type="button" class="h-10 px-6 bg-[var(--accent-amber)] hover:opacity-90 text-[var(--bg-void)] font-mono text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer active:scale-95">
            Guardar ajustes
          </button>
        </div>
      </section>

      <!-- SECTION 2B: TELEMETRÍA GPS -->
      <section class="flat-frame bg-[var(--bg-surface)] border border-[var(--line-hair)] p-5 space-y-4">
        <div class="flex items-center justify-between border-b border-[var(--line-hair)] pb-3">
          <span class="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">TELEMETRÍA GPS</span>
          <span id="gps-settings-status-badge" class="font-mono text-[10px] uppercase tracking-widest ${profile.gpsCache?.live?.totalMile ? 'text-[var(--accent-volt)]' : (isTemporaryBridge ? 'text-[var(--accent-amber)]' : 'text-[var(--text-secondary)]')}">
            ${profile.gpsCache?.live?.totalMile
              ? `${Number(profile.gpsCache.live.totalMile).toLocaleString('es-CO')} KM · ${Number(profile.gpsCache.live.externalVoltage || 0).toFixed(2)}V`
              : (isTemporaryBridge ? 'PUENTE TEMPORAL' : (gpsCfg.username ? 'CREDENCIALES GUARDADAS' : 'SIN VINCULAR'))}
          </span>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono">
          <div class="space-y-1">
            <label class="block font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">USUARIO IOPGPS</label>
            <input 
              id="set-gps-user" 
              type="text" 
              autocomplete="username"
              placeholder="Tu usuario o placa"
              value="${gpsCfg.username}" 
              class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-2 outline-none text-[var(--text-primary)] font-mono text-sm" 
            />
          </div>

          <div class="space-y-1">
            <label class="block font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">CONTRASEÑA IOPGPS</label>
            <input 
              id="set-gps-pass" 
              type="password" 
              autocomplete="current-password"
              placeholder="••••••••"
              value="${gpsCfg.password}" 
              class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-2 outline-none text-[var(--text-primary)] font-mono text-sm" 
            />
          </div>

          <div class="space-y-1">
            <label class="block font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">IMEI DEL DISPOSITIVO (OPCIONAL)</label>
            <input 
              id="set-gps-imei" 
              type="text" 
              placeholder="Auto-detectar de la cuenta"
              value="${gpsCfg.imei}" 
              class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-2 outline-none text-[var(--text-primary)] font-mono text-sm tabular-nums" 
            />
          </div>

          <div class="space-y-1">
            <label class="block font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">FECHA DE INSTALACIÓN GPS</label>
            <input 
              id="set-gps-start" 
              type="date" 
              value="${gpsCfg.installStartDate || DEFAULT_GPS_CONFIG.installStartDate}" 
              class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-2 outline-none text-[var(--text-primary)] font-mono text-sm tabular-nums" 
            />
          </div>

          <div class="space-y-1 sm:col-span-2">
            <label class="block font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">PROXY PRIVADO (OPCIONAL)</label>
            <input 
              id="set-gps-proxy-url" 
              type="url" 
              placeholder="https://tu-enlace.workers.dev"
              value="${gpsCfg.proxyUrl || ''}" 
              class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-2 outline-none text-[var(--text-primary)] font-mono text-sm" 
            />
            <span class="block text-[9px] text-[var(--text-muted)] tracking-tight">Enlace propio para sincronizar sin puente temporal.</span>
          </div>

          <div class="sm:col-span-2 pt-3 border-t border-[var(--line-hair)] flex items-center justify-between font-mono">
            <div>
              <span class="font-mono text-xs font-medium text-[var(--text-primary)] block">ALERTAS DE ESTACIÓN (NOTIFICACIONES)</span>
              <span class="text-[10px] text-[var(--text-secondary)] block">Avisa al detenerse en una estación conocida para registrar tanqueada.</span>
            </div>
            <input id="set-gps-station-alerts" type="checkbox" ${gpsCfg.stationAlertsEnabled ? 'checked' : ''} class="w-4 h-4 rounded-sm accent-[var(--accent-amber)] cursor-pointer" />
          </div>
        </div>

        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-[var(--line-hair)] font-mono">
          <span id="gps-settings-meta" class="text-[10px] text-[var(--text-secondary)] uppercase tracking-wider tabular-nums">
            ${isTemporaryBridge ? '<span class="text-[var(--accent-amber)]">PUENTE TEMPORAL</span> · ' : ''}${profile.gpsCache?.days ? `${Object.keys(profile.gpsCache.days).length} DÍAS EN MEMORIA` : 'SE RECUERDA AUTOMÁTICAMENTE AL GUARDAR'}${profile.gpsCache?.live?.address ? ` · ${String(profile.gpsCache.live.address).split(',')[0].toUpperCase()}` : ''}
          </span>
          <button id="sync-gps-now-btn" type="button" class="h-10 px-5 border border-[var(--accent-amber)] text-[var(--accent-amber)] hover:bg-[var(--accent-amber)] hover:text-[var(--bg-void)] font-mono text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer active:scale-95">
            Guardar y sincronizar GPS
          </button>
        </div>
      </section>

      <!-- SECTION 3: CUENTA Y SINCRONIZACIÓN -->
      <section class="flat-frame bg-[var(--bg-surface)] border border-[var(--line-hair)] p-5 space-y-4">
        <div class="flex items-center justify-between border-b border-[var(--line-hair)] pb-3">
          <span class="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">CUENTA Y SINCRONIZACIÓN</span>
          <span id="sync-status-badge" class="font-mono text-[10px] uppercase tracking-widest ${currentUser ? 'text-[var(--accent-volt)]' : 'text-[var(--text-secondary)]'}">
            ${currentUser ? 'Sincronizado con Google' : 'Guardado en este dispositivo'}
          </span>
        </div>

        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[var(--bg-void)] border border-[var(--line-hair)] p-4">
          <div class="flex items-center gap-3">
            <div id="auth-avatar" class="w-10 h-10 bg-[var(--bg-elevated)] border border-[var(--line-hair)] flex items-center justify-center text-sm font-mono font-bold text-[var(--text-primary)] overflow-hidden">
              ${currentUser && currentUser.photoURL ? `<img src="${currentUser.photoURL}" alt="" class="w-full h-full object-cover"/>` : (currentUser ? currentUser.displayName?.[0] || 'U' : 'G')}
            </div>
            <div>
              <div id="auth-name" class="font-mono text-xs font-bold text-[var(--text-primary)]">
                ${currentUser ? currentUser.displayName || 'Usuario Google' : 'Guardado en este dispositivo'}
              </div>
              <div id="auth-email" class="font-mono text-[10px] text-[var(--text-secondary)]">
                ${currentUser ? currentUser.email : 'Datos almacenados localmente de forma segura'}
              </div>
            </div>
          </div>

          <div>
            ${currentUser ? `
              <button id="auth-signout-btn" type="button" class="h-9 px-4 border border-[var(--line-hair)] hover:bg-[var(--line-hair)] text-[var(--accent-crimson)] text-xs font-mono uppercase tracking-wider transition-all cursor-pointer">
                Cerrar sesión
              </button>
            ` : `
              <button id="auth-signin-btn" type="button" class="h-9 px-4 bg-[var(--bg-elevated)] hover:bg-[var(--line-hair)] border border-[var(--line-hair)] text-[var(--text-primary)] text-xs font-mono uppercase tracking-wider transition-all flex items-center gap-2 cursor-pointer">
                <span>Vincular cuenta de Google</span>
              </button>
            `}
          </div>
        </div>
      </section>

      <!-- SECTION 4: DATOS Y RESPALDO -->
      <section class="flat-frame bg-[var(--bg-surface)] border border-[var(--line-hair)] p-5 space-y-4">
        <div class="flex items-center justify-between border-b border-[var(--line-hair)] pb-3">
          <span class="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">DATOS Y RESPALDO</span>
          <span class="font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">SIN CLAVES</span>
        </div>

        <div class="divide-y divide-[var(--line-hair)]">
          <!-- SUB-BLOCK A: INFORME PARA IA (COMPACTO Y LEGIBLE) -->
          <div class="pb-4 space-y-3">
            <div class="flex items-start justify-between gap-3 font-mono">
              <div>
                <span class="text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)] block">INFORME PARA IA</span>
                <span class="text-[10px] text-[var(--text-secondary)] block mt-0.5">Resumen compacto sin coordenadas ni claves, listo para análisis.</span>
              </div>
              <span id="export-ai-size" class="text-[10px] uppercase tracking-wider text-[var(--accent-amber)] tabular-nums whitespace-nowrap flex-shrink-0">CALCULANDO...</span>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button id="btn-copy-ai-report" type="button" class="h-10 px-3 bg-[var(--bg-void)] hover:bg-[var(--bg-elevated)] border border-[var(--accent-amber)]/60 hover:border-[var(--accent-amber)] text-[var(--accent-amber)] text-xs font-mono font-semibold uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95">
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <span>Copiar resumen</span>
              </button>

              <button id="btn-export-ai-md" type="button" class="h-10 px-3 bg-[var(--bg-void)] hover:bg-[var(--bg-elevated)] border border-[var(--line-hair)] hover:border-[var(--line-strong)] text-[var(--text-primary)] text-xs font-mono uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95">
                <svg class="w-3.5 h-3.5 text-[var(--accent-amber)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span>Descargar texto</span>
              </button>

              <button id="btn-export-ai-json" type="button" class="h-10 px-3 bg-[var(--bg-void)] hover:bg-[var(--bg-elevated)] border border-[var(--line-hair)] hover:border-[var(--line-strong)] text-[var(--text-primary)] text-xs font-mono uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95">
                <svg class="w-3.5 h-3.5 text-[var(--accent-amber)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                <span>Descargar datos</span>
              </button>
            </div>
          </div>

          <!-- SUB-BLOCK B: RESPALDO COMPLETO (RESTAURABLE) -->
          <div class="pt-4 space-y-3">
            <div class="flex items-start justify-between gap-3 font-mono">
              <div>
                <span class="text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)] block">RESPALDO COMPLETO</span>
                <span class="text-[10px] text-[var(--text-secondary)] block mt-0.5">Copia restaurable con todo tu historial. Excluye tu clave GPS.</span>
              </div>
              <span id="export-backup-size" class="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] tabular-nums whitespace-nowrap flex-shrink-0">CALCULANDO...</span>
            </div>

            <label class="flex items-center justify-between gap-3 py-1 font-mono cursor-pointer">
              <div class="flex items-center gap-2.5">
                <input id="toggle-backup-gps-tracks" type="checkbox" checked class="w-4 h-4 rounded-sm accent-[var(--accent-amber)] cursor-pointer" />
                <span class="text-[11px] uppercase tracking-wider text-[var(--text-primary)]">Incluir trazados de ruta GPS</span>
              </div>
              <span id="export-tracks-meta" class="text-[10px] text-[var(--text-muted)] uppercase tracking-wider tabular-nums">--</span>
            </label>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button id="export-backup-btn" type="button" class="h-10 px-4 bg-[var(--bg-void)] hover:bg-[var(--bg-elevated)] border border-[var(--line-hair)] hover:border-[var(--line-strong)] text-[var(--text-primary)] text-xs font-mono uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95">
                <svg class="w-4 h-4 text-[var(--accent-amber)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                <span>Exportar respaldo</span>
              </button>

              <input type="file" id="json-file-input" accept=".json,application/json" class="hidden" />

              <button id="import-json-btn" type="button" class="h-10 px-4 bg-[var(--bg-void)] hover:bg-[var(--bg-elevated)] border border-[var(--line-hair)] hover:border-[var(--line-strong)] text-[var(--text-primary)] text-xs font-mono uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95">
                <svg class="w-4 h-4 text-[var(--accent-volt)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                <span>Restaurar respaldo</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- SECTION 5: ZONA CRÍTICA -->
      <section class="flat-frame bg-[var(--bg-surface)] border border-[var(--accent-crimson)]/30 p-5 space-y-4">
        <div class="flex items-center justify-between border-b border-[var(--accent-crimson)]/20 pb-3 font-mono text-[10px]">
          <span class="uppercase tracking-[0.2em] text-[var(--accent-crimson)]">ZONA CRÍTICA</span>
          <span class="uppercase tracking-widest text-[var(--accent-crimson)]">IRREVERSIBLE</span>
        </div>

        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 font-mono">
          <div>
            <span class="text-xs font-bold text-[var(--text-primary)] block">BORRAR TODOS LOS DATOS</span>
            <span class="text-[10px] text-[var(--text-secondary)] block mt-0.5">Elimina odómetro, lecturas, tanqueadas, documentos y calibración de este dispositivo.</span>
          </div>

          <div id="reset-controls" class="flex items-center gap-2 flex-shrink-0">
            <button id="btn-request-reset" type="button" class="h-9 px-4 border border-[var(--accent-crimson)] text-[var(--accent-crimson)] hover:bg-[var(--accent-crimson)] hover:text-white font-semibold text-xs tracking-wider uppercase transition-all cursor-pointer">
              Borrar todos los datos
            </button>

            <!-- Inline 2-Step Confirmation Strip -->
            <div id="reset-confirm-strip" class="hidden flex items-center gap-2">
              <button id="btn-confirm-reset" type="button" class="h-9 px-4 bg-[var(--accent-crimson)] text-white font-bold text-xs tracking-wider uppercase hover:opacity-90 active:scale-95 transition-all cursor-pointer">
                Sí, borrar todo
              </button>
              <button id="btn-cancel-reset" type="button" class="h-9 px-3 border border-[var(--line-hair)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs tracking-wider uppercase transition-all cursor-pointer">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      </section>

    </div>

    <!-- MODAL 1: CAMBIAR VEHÍCULO (ACORDEONES POR MARCA) -->
    <div id="modal-change-vehicle" class="fixed inset-0 z-50 hidden select-none">
      <div class="fixed inset-0 bg-black/85 transition-opacity" id="backdrop-change-vehicle"></div>
      <div class="fixed inset-0 overflow-y-auto flex items-center justify-center p-3 sm:p-4 z-10">
        <div class="relative w-full max-w-lg bg-[var(--bg-surface)] border border-[var(--line-hair)] text-[var(--text-primary)] flex flex-col max-h-[90vh] overflow-hidden">
          
          <!-- Modal Header -->
          <header class="flex items-center justify-between px-4 h-12 border-b border-[var(--line-hair)] bg-[var(--bg-void)]">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 bg-[var(--accent-amber)]"></span>
              <span class="font-mono text-xs tracking-widest uppercase font-semibold">Cambiar Vehículo</span>
            </div>
            <button id="close-modal-vehicle-x" type="button" class="w-8 h-8 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--line-hair)] transition-colors cursor-pointer">
              ✕
            </button>
          </header>

          <!-- Modal Body Scrollable -->
          <div class="p-5 overflow-y-auto space-y-5">
            
            <!-- Live Preview strictly contained -->
            <div class="bg-[var(--bg-void)] border border-[var(--line-hair)] p-4 flex flex-col items-center">
              <div class="w-full flex items-center justify-between font-mono text-[10px] text-[var(--text-secondary)] pb-2 mb-2 border-b border-[var(--line-hair)]">
                <span id="modal-veh-name-tag" class="font-semibold text-[var(--text-primary)]">${profile.name}</span>
                <span id="modal-veh-specs-tag" class="text-[var(--accent-amber)] tabular-nums">${profile.tankCapacityLiters}L (${profile.tankCapacityGallons}G)</span>
              </div>
              <div id="modal-veh-preview" class="max-h-24 w-auto mx-auto object-contain overflow-hidden flex items-center justify-center [&>svg]:max-h-20 [&>svg]:w-auto [&>svg]:object-contain" style="--car-paint: ${profile.vehicleColor || '#FF5500'}">
                ${getInlineVehicleSvg(profile.svgModel || 'kia-picanto', profile.vehicleColor || '#FF5500')}
              </div>
            </div>

            <!-- Color de carrocería en vivo -->
            <div class="space-y-2 font-mono">
              <div class="flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">
                <span>COLOR DE CARROCERÍA</span>
                <span id="modal-color-name" class="text-[var(--text-primary)] font-semibold">${CAR_COLORS.find(c => c.hex.toLowerCase() === (profile.vehicleColor || '').toLowerCase())?.name || 'Personalizado'}</span>
              </div>
              <div class="flex flex-wrap items-center gap-2" id="modal-car-color-palette">
                ${CAR_COLORS.map(c => `
                  <button
                    type="button"
                    data-color="${c.hex}"
                    data-name="${c.name}"
                    class="modal-color-btn w-6 h-6 rounded-full border transition-all cursor-pointer ${
                      (profile.vehicleColor || '#F8F9FA').toLowerCase() === c.hex.toLowerCase()
                        ? 'scale-110 border-white ring-2 ring-[var(--accent-amber)]'
                        : 'border-[var(--line-hair)] hover:scale-105'
                    }"
                    style="background-color: ${c.hex};"
                    title="${c.name}"
                  ></button>
                `).join('')}
                <label class="w-6 h-6 rounded-full border border-dashed border-[var(--line-strong)] hover:border-[var(--text-primary)] flex items-center justify-center cursor-pointer relative overflow-hidden" title="Elegir color personalizado">
                  <input type="color" id="modal-custom-color-picker" value="${profile.vehicleColor || '#F8F9FA'}" class="opacity-0 absolute inset-0 cursor-pointer" />
                  <span class="text-[10px] leading-none text-[var(--text-secondary)]">+</span>
                </label>
              </div>
            </div>

            <!-- Brand Accordions -->
            <div class="space-y-2 font-mono" id="brand-accordions-container">
              <span class="block text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)] mb-2">SELECCIONAR MODELO POR MARCA</span>
              ${BRAND_MODELS.map((b, idx) => `
                <div class="border border-[var(--line-hair)] bg-[var(--bg-void)] overflow-hidden">
                  <button 
                    type="button" 
                    class="brand-accordion-trigger w-full px-3.5 py-2.5 flex items-center justify-between font-mono text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
                    data-brand-idx="${idx}"
                  >
                    <span>${b.brand.toUpperCase()}</span>
                    <span class="text-[var(--text-secondary)] text-[10px] tracking-widest">${b.models.length} MODELOS ▾</span>
                  </button>
                  <div class="brand-accordion-content hidden divide-y divide-[var(--line-hair)] border-t border-[var(--line-hair)] bg-[var(--bg-surface)]">
                    ${b.models.map(m => `
                      <button 
                        type="button" 
                        class="model-select-btn w-full px-4 py-2.5 flex items-center justify-between text-left hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer text-xs"
                        data-name="${m.name}"
                        data-liters="${m.liters}"
                        data-gallons="${m.gallons}"
                        data-reserve="${m.reserve}"
                        data-svg="${m.svgModel}"
                      >
                        <span class="font-medium text-[var(--text-primary)]">${m.name}</span>
                        <span class="text-[10px] text-[var(--text-secondary)] tabular-nums">${m.liters} L · ${m.gallons} GAL</span>
                      </button>
                    `).join('')}
                  </div>
                </div>
              `).join('')}

              <!-- Acordeón Personalizado -->
              <div class="border border-[var(--line-hair)] bg-[var(--bg-void)] overflow-hidden">
                <button 
                  type="button" 
                  class="brand-accordion-trigger w-full px-3.5 py-2.5 flex items-center justify-between font-mono text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
                  data-brand-idx="custom"
                >
                  <span>ESPECIFICACIÓN PERSONALIZADA</span>
                  <span class="text-[var(--text-secondary)] text-[10px] tracking-widest">EDITABLE ▾</span>
                </button>
                <div class="brand-accordion-content hidden p-4 space-y-3 border-t border-[var(--line-hair)] bg-[var(--bg-surface)]">
                  <div>
                    <label class="block text-[10px] uppercase text-[var(--text-secondary)]">NOMBRE / MODELO</label>
                    <input id="custom-veh-name" type="text" placeholder="Mi vehículo" value="${profile.name}" class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-1.5 outline-none text-xs text-[var(--text-primary)]" />
                  </div>
                  <div class="grid grid-cols-3 gap-3">
                    <div>
                      <label class="block text-[10px] uppercase text-[var(--text-secondary)]">LITROS</label>
                      <input id="custom-veh-liters" type="number" step="0.5" value="${profile.tankCapacityLiters}" class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-1.5 outline-none text-xs text-[var(--text-primary)] tabular-nums" />
                    </div>
                    <div>
                      <label class="block text-[10px] uppercase text-[var(--text-secondary)]">GALONES</label>
                      <input id="custom-veh-gal" type="number" step="0.01" value="${profile.tankCapacityGallons}" class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-1.5 outline-none text-xs text-[var(--text-primary)] tabular-nums" />
                    </div>
                    <div>
                      <label class="block text-[10px] uppercase text-[var(--text-secondary)]">RESERVA (L)</label>
                      <input id="custom-veh-reserve" type="number" step="0.5" value="${profile.reserveLiters}" class="w-full bg-transparent border-0 border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-1.5 outline-none text-xs text-[var(--text-primary)] tabular-nums" />
                    </div>
                  </div>
                  <button id="btn-apply-custom-veh" type="button" class="w-full h-8 mt-2 border border-[var(--line-strong)] hover:border-[var(--accent-amber)] text-xs text-[var(--accent-amber)] font-mono uppercase tracking-wider transition-all">
                    Aplicar especificación personalizada
                  </button>
                </div>
              </div>
            </div>

          </div>

          <!-- Modal Footer -->
          <footer class="p-4 border-t border-[var(--line-hair)] bg-[var(--bg-void)] flex items-center justify-between">
            <button id="btn-cancel-modal-vehicle" type="button" class="px-4 py-2 border border-[var(--line-hair)] text-xs font-mono text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all cursor-pointer">
              Cancelar
            </button>
            <button id="btn-confirm-modal-vehicle" type="button" class="px-5 py-2 bg-[var(--accent-amber)] text-[var(--bg-void)] text-xs font-mono font-semibold uppercase tracking-wider hover:opacity-90 transition-all cursor-pointer active:scale-95">
              Confirmar vehículo
            </button>
          </footer>

        </div>
      </div>
    </div>

    <!-- MODAL 2: CAMBIAR ESTILO DE MEDIDOR -->
    <div id="modal-change-gauge" class="fixed inset-0 z-50 hidden select-none">
      <div class="fixed inset-0 bg-black/85 transition-opacity" id="backdrop-change-gauge"></div>
      <div class="fixed inset-0 overflow-y-auto flex items-center justify-center p-3 sm:p-4 z-10">
        <div class="relative w-full max-w-md bg-[var(--bg-surface)] border border-[var(--line-hair)] text-[var(--text-primary)] flex flex-col overflow-hidden">
          
          <!-- Modal Header -->
          <header class="flex items-center justify-between px-4 h-12 border-b border-[var(--line-hair)] bg-[var(--bg-void)]">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 bg-[var(--accent-amber)]"></span>
              <span class="font-mono text-xs tracking-widest uppercase font-semibold">Estilo de Medidor</span>
            </div>
            <button id="close-modal-gauge-x" type="button" class="w-8 h-8 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--line-hair)] transition-colors cursor-pointer">
              ✕
            </button>
          </header>

          <!-- Modal Body -->
          <div class="p-5 space-y-4 font-mono">
            <!-- 4 Options -->
            <div class="grid grid-cols-2 gap-2" id="modal-gauge-options">
              <button type="button" data-gauge="spicy-arc" class="modal-gauge-btn text-left p-3 border ${profile.gaugeStyle === 'spicy-arc' ? 'border-[var(--accent-amber)] bg-[var(--bg-elevated)]' : 'border-[var(--line-hair)] bg-[var(--bg-void)]'} hover:border-[var(--line-strong)] transition-all cursor-pointer">
                <div class="text-xs font-bold text-[var(--text-primary)]">Arco vertical</div>
                <div class="text-[9px] text-[var(--text-secondary)] mt-0.5">Spicy Arc 120°</div>
              </button>
              <button type="button" data-gauge="analog-180" class="modal-gauge-btn text-left p-3 border ${profile.gaugeStyle === 'analog-180' ? 'border-[var(--accent-amber)] bg-[var(--bg-elevated)]' : 'border-[var(--line-hair)] bg-[var(--bg-void)]'} hover:border-[var(--line-strong)] transition-all cursor-pointer">
                <div class="text-xs font-bold text-[var(--text-primary)]">Dial 180°</div>
                <div class="text-[9px] text-[var(--text-secondary)] mt-0.5">Semicírculo clásico</div>
              </button>
              <button type="button" data-gauge="digital-lcd" class="modal-gauge-btn text-left p-3 border ${profile.gaugeStyle === 'digital-lcd' ? 'border-[var(--accent-amber)] bg-[var(--bg-elevated)]' : 'border-[var(--line-hair)] bg-[var(--bg-void)]'} hover:border-[var(--line-strong)] transition-all cursor-pointer">
                <div class="text-xs font-bold text-[var(--text-primary)]">Barras digitales</div>
                <div class="text-[9px] text-[var(--text-secondary)] mt-0.5">Matriz segmentada</div>
              </button>
              <button type="button" data-gauge="sight-glass" class="modal-gauge-btn text-left p-3 border ${profile.gaugeStyle === 'sight-glass' ? 'border-[var(--accent-amber)] bg-[var(--bg-elevated)]' : 'border-[var(--line-hair)] bg-[var(--bg-void)]'} hover:border-[var(--line-strong)] transition-all cursor-pointer">
                <div class="text-xs font-bold text-[var(--text-primary)]">Cilindro óptico</div>
                <div class="text-[9px] text-[var(--text-secondary)] mt-0.5">Lente fluido</div>
              </button>
            </div>

            <!-- Area interactiva ¡Pruébalo! -->
            <div class="bg-[var(--bg-void)] border border-[var(--line-hair)] p-4 flex flex-col items-center">
              <div class="w-full flex items-center justify-between text-[10px] text-[var(--text-secondary)] pb-2 mb-2 border-b border-[var(--line-hair)]">
                <span class="tracking-widest uppercase">¡PRUÉBALO!</span>
                <span class="text-[var(--accent-volt)] uppercase">ARRASTRE EN VIVO</span>
              </div>
              <div id="modal-gauge-interactive-mount" class="w-full min-h-[200px] flex items-center justify-center"></div>
            </div>
          </div>

          <!-- Modal Footer -->
          <footer class="p-4 border-t border-[var(--line-hair)] bg-[var(--bg-void)] flex items-center justify-between">
            <button id="btn-cancel-modal-gauge" type="button" class="px-4 py-2 border border-[var(--line-hair)] text-xs font-mono text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-all cursor-pointer">
              Cancelar
            </button>
            <button id="btn-confirm-modal-gauge" type="button" class="px-5 py-2 bg-[var(--accent-amber)] text-[var(--bg-void)] text-xs font-mono font-semibold uppercase tracking-wider hover:opacity-90 transition-all cursor-pointer active:scale-95">
              Confirmar estilo
            </button>
          </footer>

        </div>
      </div>
    </div>
  `;

  // Temporary selected vehicle in memory for Modal 1
  let pendingVehicle = { ...profile };
  let pendingGauge = profile.gaugeStyle || 'spicy-arc';

  // Modal 1: Open Vehicle Modal Handler with confirmation warning
  const btnOpenChangeVehicle = container.querySelector('#btn-open-change-vehicle');
  const modalChangeVehicle = container.querySelector('#modal-change-vehicle');
  const backdropChangeVehicle = container.querySelector('#backdrop-change-vehicle');
  const closeModalVehicleX = container.querySelector('#close-modal-vehicle-x');
  const btnCancelModalVehicle = container.querySelector('#btn-cancel-modal-vehicle');
  const btnConfirmModalVehicle = container.querySelector('#btn-confirm-modal-vehicle');

  async function openVehicleModal() {
    playHorologyTick(1200, 0.015, 0.03);
    const confirmed = await confirmDialog({ title: 'Cambiar el vehículo recalcula autonomía y consumo', confirmLabel: 'Continuar' });
    if (!confirmed) return;

    pendingVehicle = { ...profile };
    updateModalVehiclePreview();
    modalChangeVehicle.classList.remove('hidden');
  }

  function closeVehicleModal() {
    playHorologyTick(900, 0.012, 0.02);
    modalChangeVehicle.classList.add('hidden');
  }

  btnOpenChangeVehicle.addEventListener('click', openVehicleModal);
  backdropChangeVehicle.addEventListener('click', closeVehicleModal);
  closeModalVehicleX.addEventListener('click', closeVehicleModal);
  btnCancelModalVehicle.addEventListener('click', closeVehicleModal);

  function updateModalVehiclePreview() {
    const nameTag = container.querySelector('#modal-veh-name-tag');
    const specsTag = container.querySelector('#modal-veh-specs-tag');
    const previewMount = container.querySelector('#modal-veh-preview');

    if (nameTag) nameTag.innerText = pendingVehicle.name;
    if (specsTag) specsTag.innerText = `${pendingVehicle.tankCapacityLiters}L (${pendingVehicle.tankCapacityGallons}G)`;
    if (previewMount) {
      previewMount.style.setProperty('--car-paint', pendingVehicle.vehicleColor || '#FF5500');
      previewMount.innerHTML = getInlineVehicleSvg(pendingVehicle.svgModel || 'kia-picanto', pendingVehicle.vehicleColor || '#FF5500');
    }
  }

  // Accordion triggers
  container.querySelectorAll('.brand-accordion-trigger').forEach(trigger => {
    trigger.addEventListener('click', () => {
      playHorologyTick(950, 0.012, 0.02);
      const content = trigger.nextElementSibling;
      const isOpen = !content.classList.contains('hidden');
      container.querySelectorAll('.brand-accordion-content').forEach(c => c.classList.add('hidden'));
      if (!isOpen) {
        content.classList.remove('hidden');
      }
    });
  });

  // Model selection buttons
  container.querySelectorAll('.model-select-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      playHorologyTick(1100, 0.015, 0.03);
      pendingVehicle.name = btn.dataset.name;
      pendingVehicle.tankCapacityLiters = parseFloat(btn.dataset.liters);
      pendingVehicle.tankCapacityGallons = parseFloat(btn.dataset.gallons);
      pendingVehicle.reserveLiters = parseFloat(btn.dataset.reserve);
      pendingVehicle.svgModel = btn.dataset.svg;
      updateModalVehiclePreview();
      showToast(`${btn.dataset.name.toUpperCase()}`);
    });
  });

  // Custom vehicle apply button
  const btnApplyCustom = container.querySelector('#btn-apply-custom-veh');
  if (btnApplyCustom) {
    btnApplyCustom.addEventListener('click', () => {
      const cName = container.querySelector('#custom-veh-name').value.trim() || 'Vehículo Personalizado';
      const cLiters = parseFloat(container.querySelector('#custom-veh-liters').value) || 35.0;
      const cGal = parseFloat(container.querySelector('#custom-veh-gal').value) || (cLiters / GAL_TO_L);
      const cReserve = parseFloat(container.querySelector('#custom-veh-reserve').value) || 5.0;

      pendingVehicle.name = cName;
      pendingVehicle.tankCapacityLiters = cLiters;
      pendingVehicle.tankCapacityGallons = Number(cGal.toFixed(2));
      pendingVehicle.reserveLiters = cReserve;
      pendingVehicle.svgModel = 'generic-hatch';
      updateModalVehiclePreview();
      showToast('ESPECIFICACIÓN PERSONALIZADA APLICADA');
    });
  }

  // Color selection in Modal
  container.querySelectorAll('#modal-car-color-palette .modal-color-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const hex = btn.dataset.color;
      const name = btn.dataset.name;
      playHorologyTick(1200, 0.012, 0.025);
      pendingVehicle.vehicleColor = hex;
      const colorNameEl = container.querySelector('#modal-color-name');
      if (colorNameEl) colorNameEl.innerText = name;
      container.querySelectorAll('#modal-car-color-palette .modal-color-btn').forEach(b => {
        b.className = `modal-color-btn w-6 h-6 rounded-full border transition-all cursor-pointer ${
          b.dataset.color.toLowerCase() === hex.toLowerCase() ? 'scale-110 border-white ring-2 ring-[var(--accent-amber)]' : 'border-[var(--line-hair)] hover:scale-105'
        }`;
      });
      updateModalVehiclePreview();
    });
  });

  const modalCustomColor = container.querySelector('#modal-custom-color-picker');
  if (modalCustomColor) {
    modalCustomColor.addEventListener('input', (e) => {
      pendingVehicle.vehicleColor = e.target.value;
      const colorNameEl = container.querySelector('#modal-color-name');
      if (colorNameEl) colorNameEl.innerText = 'Personalizado';
      updateModalVehiclePreview();
    });
  }

  // Confirm Vehicle Modal
  btnConfirmModalVehicle.addEventListener('click', async () => {
    playHorologyTick(1400, 0.015, 0.03);
    profile = { ...profile, ...pendingVehicle };

    try {
      profile = await saveVehicleProfile(profile);
      if (store && typeof store.setState === 'function') {
        store.setState({ vehicleProfile: profile });
      }
      if (typeof syncToCloud === 'function') syncToCloud();
      showToast('VEHÍCULO ACTUALIZADO');
      closeVehicleModal();
      renderSettingsView(container);
    } catch (err) {
      showToast('ERROR · ' + (err && err.message ? err.message : 'Error guardando vehículo'));
    }
  });

  // Modal 2: Cambiar Estilo de Medidor
  const btnOpenChangeGauge = container.querySelector('#btn-open-change-gauge');
  const modalChangeGauge = container.querySelector('#modal-change-gauge');
  const backdropChangeGauge = container.querySelector('#backdrop-change-gauge');
  const closeModalGaugeX = container.querySelector('#close-modal-gauge-x');
  const btnCancelModalGauge = container.querySelector('#btn-cancel-modal-gauge');
  const btnConfirmModalGauge = container.querySelector('#btn-confirm-modal-gauge');
  const interactiveMount = container.querySelector('#modal-gauge-interactive-mount');

  function mountModalGaugePreview(styleName) {
    if (modalGaugePreviewInstance && typeof modalGaugePreviewInstance.destroy === 'function') {
      modalGaugePreviewInstance.destroy();
    }
    interactiveMount.innerHTML = '';

    const opts = {
      initialValue: 58,
      tankCapacityLiters: profile.tankCapacityLiters,
      tankCapacityGallons: profile.tankCapacityGallons,
      interactive: true,
      onChange: () => {}
    };

    switch (styleName) {
      case 'analog-180':
        modalGaugePreviewInstance = renderAnalog180Gauge(interactiveMount, opts);
        break;
      case 'digital-lcd':
        modalGaugePreviewInstance = renderDigitalLcdGauge(interactiveMount, opts);
        break;
      case 'sight-glass':
        modalGaugePreviewInstance = renderSightGlassGauge(interactiveMount, opts);
        break;
      case 'spicy-arc':
      default:
        modalGaugePreviewInstance = renderSpicyArcGauge(interactiveMount, opts);
        break;
    }
  }

  function openGaugeModal() {
    playHorologyTick(1200, 0.015, 0.03);
    pendingGauge = profile.gaugeStyle || 'spicy-arc';
    container.querySelectorAll('#modal-gauge-options .modal-gauge-btn').forEach(b => {
      const isSelected = b.dataset.gauge === pendingGauge;
      b.className = `modal-gauge-btn text-left p-3 border ${
        isSelected ? 'border-[var(--accent-amber)] bg-[var(--bg-elevated)]' : 'border-[var(--line-hair)] bg-[var(--bg-void)]'
      } hover:border-[var(--line-strong)] transition-all cursor-pointer`;
    });
    mountModalGaugePreview(pendingGauge);
    modalChangeGauge.classList.remove('hidden');
  }

  function closeGaugeModal() {
    playHorologyTick(900, 0.012, 0.02);
    if (modalGaugePreviewInstance && typeof modalGaugePreviewInstance.destroy === 'function') {
      modalGaugePreviewInstance.destroy();
      modalGaugePreviewInstance = null;
    }
    modalChangeGauge.classList.add('hidden');
  }

  btnOpenChangeGauge.addEventListener('click', openGaugeModal);
  backdropChangeGauge.addEventListener('click', closeGaugeModal);
  closeModalGaugeX.addEventListener('click', closeGaugeModal);
  btnCancelModalGauge.addEventListener('click', closeGaugeModal);

  container.querySelectorAll('#modal-gauge-options .modal-gauge-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      playHorologyTick(1100, 0.012, 0.02);
      pendingGauge = btn.dataset.gauge;
      container.querySelectorAll('#modal-gauge-options .modal-gauge-btn').forEach(b => {
        const isSelected = b.dataset.gauge === pendingGauge;
        b.className = `modal-gauge-btn text-left p-3 border ${
          isSelected ? 'border-[var(--accent-amber)] bg-[var(--bg-elevated)]' : 'border-[var(--line-hair)] bg-[var(--bg-void)]'
        } hover:border-[var(--line-strong)] transition-all cursor-pointer`;
      });
      mountModalGaugePreview(pendingGauge);
    });
  });

  btnConfirmModalGauge.addEventListener('click', async () => {
    playHorologyTick(1400, 0.015, 0.03);
    profile.gaugeStyle = pendingGauge;
    try {
      profile = await saveVehicleProfile(profile);
      if (store && typeof store.setState === 'function') {
        store.setState({ vehicleProfile: profile });
      }
      showToast(`ESTILO: ${getGaugeLabel(pendingGauge).toUpperCase()}`);
      closeGaugeModal();
      renderSettingsView(container);
    } catch (err) {
      showToast('ERROR · ' + (err && err.message ? err.message : 'Error guardando estilo de medidor'));
    }
  });

  // Unit Selector Handlers
  container.querySelectorAll('#set-unit-selector .unit-opt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const u = btn.dataset.unit;
      playHorologyTick(1200, 0.015, 0.025);
      if (store && typeof store.setState === 'function') {
        store.setState({ currentUnit: u });
      }
      if (typeof localStorage !== 'undefined') localStorage.setItem('octane_unit', u);
      container.querySelectorAll('#set-unit-selector .unit-opt-btn').forEach(b => {
        const isSelected = b.dataset.unit === u;
        b.className = `unit-opt-btn h-9 border ${isSelected ? 'border-[var(--accent-amber)] bg-[var(--bg-elevated)] text-[var(--accent-amber)] font-bold' : 'border-[var(--line-hair)] text-[var(--text-secondary)] hover:border-[var(--line-strong)]'} transition-all cursor-pointer`;
      });
      showToast(`UNIDAD: ${u === 'gal' ? 'KM/GAL' : (u === 'l100' ? 'L/100 KM' : 'KM/L')}`);
      window.dispatchEvent(new CustomEvent('octane:update-state', { detail: { unit: u } }));
    });
  });

  // Theme Selector Handlers
  container.querySelectorAll('#set-theme-selector .theme-opt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const nextTheme = btn.dataset.themeOpt || 'dark';
      playHorologyTick(900, 0.02, 0.03);
      if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('data-theme', nextTheme);
      }
      if (store && typeof store.setState === 'function') {
        store.setState({ theme: nextTheme });
      }
      container.querySelectorAll('#set-theme-selector .theme-opt-btn').forEach(b => {
        const isSelected = b.dataset.themeOpt === nextTheme;
        b.className = `theme-opt-btn h-9 border ${isSelected ? 'border-[var(--accent-amber)] bg-[var(--bg-elevated)] text-[var(--accent-amber)] font-bold' : 'border-[var(--line-hair)] text-[var(--text-secondary)] hover:border-[var(--line-strong)]'} transition-all cursor-pointer`;
      });
      showToast(nextTheme === 'dark' ? 'MODO CARBÓN' : 'MODO PAPEL');
      window.dispatchEvent(new CustomEvent('octane:update-state', { detail: { theme: nextTheme } }));
    });
  });

  // Sound Selector Handlers
  container.querySelectorAll('#set-sound-selector .sound-opt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const active = btn.dataset.soundOpt === 'on';
      setSoundEnabled(active);
      if (active) playHorologyTick(1100, 0.015, 0.025);
      if (store && typeof store.setState === 'function') {
        store.setState({ soundEnabled: active });
      }
      container.querySelectorAll('#set-sound-selector .sound-opt-btn').forEach(b => {
        const isSelected = (b.dataset.soundOpt === 'on') === active;
        b.className = `sound-opt-btn h-9 border ${isSelected ? 'border-[var(--accent-amber)] bg-[var(--bg-elevated)] text-[var(--accent-amber)] font-bold' : 'border-[var(--line-hair)] text-[var(--text-secondary)] hover:border-[var(--line-strong)]'} transition-all cursor-pointer`;
      });
      showToast(active ? 'AUDIO TÁCTIL ON' : 'SILENCIADO');
      window.dispatchEvent(new CustomEvent('octane:update-state', { detail: { soundEnabled: active } }));
    });
  });

  // Save Operating Parameters Button
  container.querySelector('#save-params-btn').addEventListener('click', async () => {
    playHorologyTick(1400, 0.015, 0.03);
    const updated = {
      ...profile,
      fuelPriceCop: parseFloat(container.querySelector('#set-fuel-price').value) || 16000,
      routineDailyKm: parseFloat(container.querySelector('#set-daily-km').value) || 24,
      ridesModuleEnabled: Boolean(container.querySelector('#set-rides-toggle').checked)
    };

    try {
      profile = await saveVehicleProfile(updated);
      if (store && typeof store.setState === 'function') {
        store.setState({ vehicleProfile: profile, fuelPriceCop: profile.fuelPriceCop });
      }
      if (typeof syncToCloud === 'function') syncToCloud();
      showToast('AJUSTES GUARDADOS');
    } catch (err) {
      showToast('ERROR · ' + (err && err.message ? err.message : 'Error guardando ajustes'));
    }
  });

  // Station Alerts Opt-In Toggle Handler (Notification permission requested ONLY on explicit user toggle ON)
  const stationAlertsToggle = container.querySelector('#set-gps-station-alerts');
  if (stationAlertsToggle) {
    stationAlertsToggle.addEventListener('change', async () => {
      const enabled = Boolean(stationAlertsToggle.checked);
      playHorologyTick(enabled ? 1300 : 900, 0.015, 0.025);

      if (enabled && typeof Notification !== 'undefined' && Notification.permission === 'default') {
        try {
          const permission = await Notification.requestPermission();
          if (permission === 'denied') {
            showToast('PERMISO DE NOTIFICACIONES DENEGADO');
          }
        } catch (_) {}
      }

      const gpsProxyUrl = container.querySelector('#set-gps-proxy-url')?.value.trim() || '';
      profile.gpsConfig = {
        ...(profile.gpsConfig || DEFAULT_GPS_CONFIG),
        proxyUrl: gpsProxyUrl,
        stationAlertsEnabled: enabled
      };
      saveRememberedGpsCreds({
        proxyUrl: gpsProxyUrl,
        stationAlertsEnabled: enabled
      });

      try {
        profile = await saveVehicleProfile(profile);
        if (store && typeof store.setState === 'function') {
          store.setState({ vehicleProfile: profile });
        }
        showToast(enabled ? 'ALERTAS DE ESTACIÓN ACTIVADAS' : 'ALERTAS DE ESTACIÓN DESACTIVADAS');
      } catch (err) {
        showToast('ERROR · ' + (err && err.message ? err.message : 'Error guardando alertas'));
      }
    });
  }

  // Private Proxy URL live persistence on change
  const gpsProxyInput = container.querySelector('#set-gps-proxy-url');
  if (gpsProxyInput) {
    gpsProxyInput.addEventListener('change', async () => {
      const gpsProxyUrl = gpsProxyInput.value.trim();
      const stationAlertsEnabled = Boolean(container.querySelector('#set-gps-station-alerts')?.checked);
      profile.gpsConfig = {
        ...(profile.gpsConfig || DEFAULT_GPS_CONFIG),
        proxyUrl: gpsProxyUrl,
        stationAlertsEnabled
      };
      saveRememberedGpsCreds({
        proxyUrl: gpsProxyUrl,
        stationAlertsEnabled
      });
      try {
        profile = await saveVehicleProfile(profile);
        if (store && typeof store.setState === 'function') {
          store.setState({ vehicleProfile: profile });
        }
        showToast(gpsProxyUrl ? 'PROXY PRIVADO GUARDADO' : 'PROXY PRIVADO REMOVIDO');
      } catch (_) {}
    });
  }

  // Sync GPS Telemetry Button Handler
  const syncGpsBtn = container.querySelector('#sync-gps-now-btn');
  if (syncGpsBtn) {
    syncGpsBtn.addEventListener('click', async () => {
      playHorologyTick(1350, 0.015, 0.03);
      const gpsUser = container.querySelector('#set-gps-user')?.value.trim() || '';
      const gpsPass = container.querySelector('#set-gps-pass')?.value || '';
      const gpsImei = container.querySelector('#set-gps-imei')?.value.trim() || '';
      const gpsStart = container.querySelector('#set-gps-start')?.value.trim() || DEFAULT_GPS_CONFIG.installStartDate;
      const gpsProxyUrl = container.querySelector('#set-gps-proxy-url')?.value.trim() || '';
      const stationAlertsEnabled = Boolean(container.querySelector('#set-gps-station-alerts')?.checked);

      if (!gpsUser || !gpsPass) {
        showToast('INGRESA USUARIO Y CONTRASEÑA GPS');
        return;
      }

      profile.gpsConfig = {
        ...(profile.gpsConfig || DEFAULT_GPS_CONFIG),
        enabled: true,
        username: gpsUser,
        password: gpsPass,
        imei: gpsImei,
        installDate: gpsStart,
        installStartDate: gpsStart,
        proxyUrl: gpsProxyUrl,
        stationAlertsEnabled
      };

      saveRememberedGpsCreds(profile.gpsConfig);

      syncGpsBtn.disabled = true;
      syncGpsBtn.innerText = 'SINCRONIZANDO...';

      try {
        profile = await saveVehicleProfile(profile);
        if (store && typeof store.setState === 'function') {
          store.setState({ vehicleProfile: profile });
        }
        const res = await syncGpsTelemetry({ forceFullBackfill: true, silent: false });
        if (res && res.ok) {
          renderSettingsView(container);
        } else {
          syncGpsBtn.disabled = false;
          syncGpsBtn.innerText = 'Guardar y sincronizar GPS';
        }
      } catch (err) {
        showToast('ERROR SINCRONIZANDO GPS');
        syncGpsBtn.disabled = false;
        syncGpsBtn.innerText = 'Guardar y sincronizar GPS';
      }
    });
  }

  // Auth Button Handlers
  const signinBtn = container.querySelector('#auth-signin-btn');
  const signoutBtn = container.querySelector('#auth-signout-btn');

  if (signinBtn) {
    signinBtn.addEventListener('click', async () => {
      playHorologyTick(1300, 0.015, 0.03);
      try {
        if (typeof signInWithGoogle === 'function') {
          await signInWithGoogle();
          showToast('SESIÓN INICIADA');
          renderSettingsView(container);
        } else {
          showToast('INICIO DE SESIÓN NO DISPONIBLE');
        }
      } catch (err) {
        showToast('ERROR · ' + (err && err.message ? err.message : 'Error auth Google'));
      }
    });
  }

  if (signoutBtn) {
    signoutBtn.addEventListener('click', async () => {
      playHorologyTick(900, 0.015, 0.03);
      try {
        if (typeof signOutUser === 'function') {
          await signOutUser();
          showToast('SESIÓN CERRADA');
          renderSettingsView(container);
        }
      } catch (err) {
        showToast('ERROR · ' + (err && err.message ? err.message : 'Error al cerrar sesión'));
      }
    });
  }

  // Live Export Size Estimator & Dual Export / Backup Handlers
  const aiSizeEl = container.querySelector('#export-ai-size');
  const backupSizeEl = container.querySelector('#export-backup-size');
  const tracksMetaEl = container.querySelector('#export-tracks-meta');
  const includeTracksCheckbox = container.querySelector('#toggle-backup-gps-tracks');
  let cachedExportMetrics = null;

  function renderExportSizeBadges() {
    if (!cachedExportMetrics) return;
    const { sizes } = cachedExportMetrics;
    const includeTracks = includeTracksCheckbox ? Boolean(includeTracksCheckbox.checked) : true;

    if (aiSizeEl) {
      const reductionSuffix = sizes.aiReductionPct >= 20 ? ` · -${sizes.aiReductionPct}%` : '';
      aiSizeEl.textContent = `${sizes.aiMarkdownLabel} / ${sizes.aiJsonLabel}${reductionSuffix}`;
    }
    if (backupSizeEl) {
      backupSizeEl.textContent = includeTracks ? sizes.fullWithTracksLabel : sizes.fullWithoutTracksLabel;
    }
    if (tracksMetaEl) {
      if (sizes.trackPointsCount > 0) {
        tracksMetaEl.textContent = includeTracks
          ? `${sizes.trackPointsCount.toLocaleString('es-CO')} PUNTOS`
          : `AHORRA ${sizes.trackBytesSavedLabel}`;
      } else {
        tracksMetaEl.textContent = 'SIN TRAZADOS';
      }
    }
  }

  getExportMetricsSummary()
    .then((metrics) => {
      cachedExportMetrics = metrics;
      renderExportSizeBadges();
    })
    .catch(() => {
      if (aiSizeEl) aiSizeEl.textContent = 'LISTO';
      if (backupSizeEl) backupSizeEl.textContent = 'LISTO';
    });

  if (includeTracksCheckbox) {
    includeTracksCheckbox.addEventListener('change', () => {
      playHorologyTick(1100, 0.012, 0.02);
      renderExportSizeBadges();
    });
  }

  // AI Export: Copy Readable Report to Clipboard
  const btnCopyAi = container.querySelector('#btn-copy-ai-report');
  if (btnCopyAi) {
    btnCopyAi.addEventListener('click', async () => {
      playHorologyTick(1400, 0.015, 0.03);
      try {
        await copyLlmReportToClipboard();
      } catch (err) {
        showToast('ERROR · ' + (err && err.message ? err.message : 'No se pudo copiar'));
      }
    });
  }

  // AI Export: Download Readable Text Report (.md)
  const btnExportAiMd = container.querySelector('#btn-export-ai-md');
  if (btnExportAiMd) {
    btnExportAiMd.addEventListener('click', async () => {
      playHorologyTick(1350, 0.015, 0.03);
      try {
        await exportLlmMarkdownReport();
      } catch (err) {
        showToast('ERROR · ' + (err && err.message ? err.message : 'Error exportando resumen'));
      }
    });
  }

  // AI Export: Download Compact Structured Data (.json without trackPoints)
  const btnExportAiJson = container.querySelector('#btn-export-ai-json');
  if (btnExportAiJson) {
    btnExportAiJson.addEventListener('click', async () => {
      playHorologyTick(1350, 0.015, 0.03);
      try {
        await exportLlmAnalysisJson();
      } catch (err) {
        showToast('ERROR · ' + (err && err.message ? err.message : 'Error exportando datos'));
      }
    });
  }

  // Full Restorable Backup Export
  container.querySelector('#export-backup-btn').addEventListener('click', async () => {
    playHorologyTick(1350, 0.015, 0.03);
    try {
      const includeGpsTracks = includeTracksCheckbox ? Boolean(includeTracksCheckbox.checked) : true;
      await exportMasterBackup({ includeGpsTracks });
    } catch (err) {
      showToast('ERROR · ' + (err && err.message ? err.message : 'Error exportando respaldo'));
    }
  });

  // Safe Pre-Validated Restore Backup
  const fileInput = container.querySelector('#json-file-input');
  const importBtn = container.querySelector('#import-json-btn');

  importBtn.addEventListener('click', () => {
    playHorologyTick(1100, 0.012, 0.02);
    fileInput.value = '';
    fileInput.click();
  });

  fileInput.addEventListener('change', async (ev) => {
    const file = ev.target.files?.[0];
    fileInput.value = '';
    if (!file) return;

    try {
      const { content, inspection } = await inspectBackupFile(file);
      if (!inspection.ok) {
        playHorologyTick(600, 0.02, 0.04);
        showToast(inspection.error || 'ARCHIVO NO VÁLIDO PARA RESTAURAR');
        return;
      }

      const m = inspection.manifest || {};
      const dateLabel = m.exportedAt
        ? String(m.exportedAt).slice(0, 10)
        : 'SIN FECHA';

      const details = inspection.kind === 'legacy_array'
        ? [
            { label: 'TIPO', value: 'Lecturas históricas' },
            { label: 'REGISTROS', value: String(m.telemetryLogs || inspection.count || 0) }
          ]
        : [
            { label: 'VEHÍCULO', value: m.vehicleName || 'Vehículo' },
            { label: 'FECHA RESPALDO', value: dateLabel },
            { label: 'LECTURAS / TANQUEADAS', value: String(m.telemetryLogs || 0) },
            { label: 'MANTENIMIENTO', value: `${m.maintenanceItems || 0} ítems (${m.maintenanceServices || 0} reg.)` },
            { label: 'CARRERAS', value: String(m.rideSessions || 0) },
            { label: 'DOCS / NOTAS', value: `${m.legalDocs || 0} / ${m.freeNotes || 0}` },
            { label: 'DÍAS GPS', value: `${m.gpsDays || 0} (${inspection.includesGpsTracks ? 'con trazados' : 'sin trazados'})` }
          ];

      const confirmed = await confirmDialog({
        title: '¿RESTAURAR RESPALDO?',
        subtitle: inspection.kind === 'legacy_array'
          ? 'Se añadirán las lecturas históricas a tu dispositivo.'
          : 'Reemplazará los datos actuales de este dispositivo.',
        details,
        confirmLabel: 'Restaurar',
        danger: inspection.kind !== 'legacy_array'
      });

      if (!confirmed) return;

      await importFromJSONString(content);
      playHorologyTick(1600, 0.02, 0.04);
      renderSettingsView(container);
    } catch (err) {
      showToast('ERROR · ' + (err && err.message ? err.message : 'Error restaurando respaldo'));
    }
  });

  // Factory Reset 2-Step Confirmation
  const btnRequestReset = container.querySelector('#btn-request-reset');
  const resetConfirmStrip = container.querySelector('#reset-confirm-strip');
  const btnConfirmReset = container.querySelector('#btn-confirm-reset');
  const btnCancelReset = container.querySelector('#btn-cancel-reset');

  if (btnRequestReset && resetConfirmStrip && btnConfirmReset && btnCancelReset) {
    btnRequestReset.addEventListener('click', () => {
      playHorologyTick(700, 0.025, 0.05);
      btnRequestReset.classList.add('hidden');
      resetConfirmStrip.classList.remove('hidden');
    });

    btnCancelReset.addEventListener('click', () => {
      playHorologyTick(900, 0.015, 0.02);
      resetConfirmStrip.classList.add('hidden');
      btnRequestReset.classList.remove('hidden');
    });

    btnConfirmReset.addEventListener('click', async () => {
      playHorologyTick(400, 0.05, 0.1);
      btnConfirmReset.innerText = 'BORRANDO...';
      btnConfirmReset.disabled = true;

      try {
        await clearAllData();
        if (store && typeof store.setState === 'function') {
          store.setState({
            vehicleProfile: null,
            telemetryLogs: [],
            telemetryEngineResults: null,
            maintenanceItems: []
          });
        }
        showToast('DATOS BORRADOS');
        setTimeout(() => {
          window.location.hash = '#cockpit';
          window.location.reload();
        }, 300);
      } catch (err) {
        showToast('ERROR · ' + (err && err.message ? err.message : 'Error al borrar'));
        btnConfirmReset.innerText = 'Sí, borrar todo';
        btnConfirmReset.disabled = false;
      }
    });
  }
}

/**
 * Tears down live gauge preview and background animation loops.
 */
export function destroySettingsView() {
  if (modalGaugePreviewInstance && typeof modalGaugePreviewInstance.destroy === 'function') {
    modalGaugePreviewInstance.destroy();
    modalGaugePreviewInstance = null;
  }
}
