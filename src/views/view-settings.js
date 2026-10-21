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

import { store } from '../core/state.js';
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
import { exportMasterBackup, importJSONFile } from '../core/json-io.js';
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
  try {
    if (typeof getCurrentUser === 'function') {
      currentUser = getCurrentUser();
    } else if (store && typeof store.getState === 'function') {
      currentUser = store.getState().currentUser || null;
    }
  } catch (e) {}

  container.innerHTML = `
    <div class="view-settings max-w-5xl mx-auto space-y-6 pb-20 select-none">
      
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
            <div class="max-h-24 w-auto mx-auto object-contain overflow-hidden flex items-center justify-center [&>svg]:max-h-20 [&>svg]:w-auto [&>svg]:object-contain" style="--car-paint: ${profile.vehicleColor || '#FF5500'}">
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

      <!-- SECTION 4: COPIA DE SEGURIDAD -->
      <section class="flat-frame bg-[var(--bg-surface)] border border-[var(--line-hair)] p-5 space-y-4">
        <div class="flex items-center justify-between border-b border-[var(--line-hair)] pb-3">
          <span class="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">COPIA DE SEGURIDAD</span>
          <span class="font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">RESPALDO</span>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button id="export-backup-btn" type="button" class="h-10 px-4 bg-[var(--bg-void)] hover:bg-[var(--bg-elevated)] border border-[var(--line-hair)] hover:border-[var(--line-strong)] text-[var(--text-primary)] text-xs font-mono uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer">
            <svg class="w-4 h-4 text-[var(--accent-amber)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            <span>Exportar copia de seguridad</span>
          </button>

          <input type="file" id="json-file-input" accept=".json,application/json" class="hidden" />

          <button id="import-json-btn" type="button" class="h-10 px-4 bg-[var(--bg-void)] hover:bg-[var(--bg-elevated)] border border-[var(--line-hair)] hover:border-[var(--line-strong)] text-[var(--text-primary)] text-xs font-mono uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer">
            <svg class="w-4 h-4 text-[var(--accent-volt)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            <span>Importar copia de seguridad</span>
          </button>
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

  function openVehicleModal() {
    playHorologyTick(1200, 0.015, 0.03);
    const confirmed = confirm('Cambiar las especificaciones del vehículo recalculará todas las métricas de autonomía y consumo. ¿Deseas continuar?');
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
      await saveVehicleProfile(profile);
      if (store && typeof store.setState === 'function') {
        store.setState({ vehicleProfile: profile });
      }
      if (typeof syncToCloud === 'function') syncToCloud();
      showToast('VEHÍCULO ACTUALIZADO');
      closeVehicleModal();
      renderSettingsView(container);
    } catch (err) {
      alert('Error guardando vehículo: ' + err.message);
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
      await saveVehicleProfile(profile);
      if (store && typeof store.setState === 'function') {
        store.setState({ vehicleProfile: profile });
      }
      showToast(`ESTILO: ${getGaugeLabel(pendingGauge).toUpperCase()}`);
      closeGaugeModal();
      renderSettingsView(container);
    } catch (err) {
      alert('Error guardando estilo de medidor: ' + err.message);
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
      await saveVehicleProfile(updated);
      profile = updated;
      if (store && typeof store.setState === 'function') {
        store.setState({ vehicleProfile: profile, fuelPriceCop: updated.fuelPriceCop });
      }
      if (typeof syncToCloud === 'function') syncToCloud();
      showToast('AJUSTES GUARDADOS');
    } catch (err) {
      alert('Error guardando ajustes: ' + err.message);
    }
  });

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
          alert('Firebase Auth no disponible');
        }
      } catch (err) {
        alert('Error auth Google: ' + err.message);
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
        alert('Error al cerrar sesión: ' + err.message);
      }
    });
  }

  // Export Backup
  container.querySelector('#export-backup-btn').addEventListener('click', async () => {
    playHorologyTick(1350, 0.015, 0.03);
    try {
      if (typeof exportMasterBackup === 'function') {
        await exportMasterBackup();
      } else {
        const logs = await getTelemetryLogs();
        const exportObj = {
          version: '1.0',
          exportedAt: new Date().toISOString(),
          vehicle_profile: profile,
          telemetry_logs: logs
        };
        const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const now = new Date().toISOString().substring(0, 10);
        a.href = url;
        a.download = `octane_copia_seguridad_${now}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
      showToast('COPIA DE SEGURIDAD EXPORTADA');
    } catch (err) {
      alert('Error exportando copia: ' + err.message);
    }
  });

  // Import Backup
  const fileInput = container.querySelector('#json-file-input');
  const importBtn = container.querySelector('#import-json-btn');

  importBtn.addEventListener('click', () => {
    playHorologyTick(1100, 0.012, 0.02);
    fileInput.click();
  });

  fileInput.addEventListener('change', async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;

    try {
      if (typeof importJSONFile === 'function') {
        await importJSONFile(file);
      } else {
        const text = await file.text();
        const parsed = JSON.parse(text);

        if (Array.isArray(parsed)) {
          await saveTelemetryLogs(parsed);
          if (store && typeof store.setState === 'function') {
            store.setState({ telemetryLogs: parsed });
          }
        } else if (parsed && typeof parsed === 'object') {
          if (parsed.vehicle_profile) {
            await saveVehicleProfile(parsed.vehicle_profile);
          }
          if (Array.isArray(parsed.telemetry_logs)) {
            await saveTelemetryLogs(parsed.telemetry_logs);
            if (store && typeof store.setState === 'function') {
              store.setState({ telemetryLogs: parsed.telemetry_logs });
            }
          }
        }
      }
      playHorologyTick(1600, 0.02, 0.04);
      showToast('COPIA RESTAURADA');
      renderSettingsView(container);
    } catch (err) {
      alert('Error importando copia de seguridad: ' + err.message);
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
        alert('Error al borrar: ' + err.message);
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
