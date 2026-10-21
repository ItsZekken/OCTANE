/**
 * OCTANE // KINETIC — SUBAGENTE DATA-B: Scraper Profundo de Fichas Técnicas & Capacidad de Tanque
 * 
 * Extrae, cruza y normaliza los metadatos mecánicos exactos de cada vehículo colombiano
 * garantizando precisión métrica y compatibilidad con el motor de telemetría de OCTANE // KINETIC.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COLOMBIAN_FLEET_TAXONOMY } from './data-a-taxonomy.js';
import { setInCache, getFromCache } from './cache.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_OUTPUT_PATH = path.resolve(__dirname, '../../src/assets/vehicles-svg/colombia-vehicles-db.json');

const GAL_CONVERSION_FACTOR = 3.78541;

/**
 * Calculates exact US Gallons from liters rounded to 2 decimal places.
 * Formula: Number((liters / 3.78541).toFixed(2))
 * @param {number} liters 
 * @returns {number}
 */
export function calculateGallons(liters) {
  if (typeof liters !== 'number' || isNaN(liters) || liters <= 0) {
    throw new Error(`Invalid liters value: ${liters}`);
  }
  return Number((liters / GAL_CONVERSION_FACTOR).toFixed(2));
}

/**
 * Computes engineering reserve estimate in liters.
 * Standard automotive reserve is 12% - 15% of total tank capacity,
 * with a minimum floor of 5.0L for city cars and max 10.0L for large pickups/SUVs.
 * @param {number} tankLiters 
 * @returns {number}
 */
export function estimateReserveLiters(tankLiters) {
  if (tankLiters <= 35.0) return 5.0;
  if (tankLiters <= 45.0) return 5.5;
  if (tankLiters <= 55.0) return 6.5;
  if (tankLiters <= 65.0) return 7.5;
  return 10.0;
}

/**
 * Normalizes and enriches a single vehicle record according to the OCTANE specification.
 * @param {Object} raw 
 * @returns {Object} Enriched vehicle record
 */
export function enrichVehicleRecord(raw) {
  const tankLiters = Number(raw.tank_capacity_liters);
  if (isNaN(tankLiters) || tankLiters <= 0) {
    throw new Error(`Invalid tank capacity for vehicle ${raw.id}: ${raw.tank_capacity_liters}`);
  }

  const gallons = calculateGallons(tankLiters);
  const reserveLiters = raw.reserve_liters_est !== undefined
    ? Number(raw.reserve_liters_est)
    : estimateReserveLiters(tankLiters);

  // Validate body_type
  const validBodyTypes = ['hatchback-micro', 'hatchback', 'sedan', 'suv-compact', 'suv', 'pickup'];
  if (!validBodyTypes.includes(raw.body_type)) {
    throw new Error(`Invalid body_type "${raw.body_type}" for vehicle ${raw.id}`);
  }

  // Validate default_gauge_style
  const validGauges = ['spicy-arc', 'analog-180', 'digital-lcd', 'sight-glass'];
  if (!validGauges.includes(raw.default_gauge_style)) {
    throw new Error(`Invalid gauge_style "${raw.default_gauge_style}" for vehicle ${raw.id}`);
  }

  // Validate transmission
  const validTransmissions = ['MT', 'AT', 'CVT'];
  if (!validTransmissions.includes(raw.transmission)) {
    throw new Error(`Invalid transmission "${raw.transmission}" for vehicle ${raw.id}`);
  }

  // Validate fuel_type
  const validFuels = [
    'Gasolina Corriente',
    'Gasolina Extra',
    'Híbrido (HEV/MHEV)',
    'GNV/Dual',
    'Diesel'
  ];
  if (!validFuels.includes(raw.fuel_type)) {
    throw new Error(`Invalid fuel_type "${raw.fuel_type}" for vehicle ${raw.id}`);
  }

  // Consumption validation
  const consumption = raw.urban_consumption_ref_kmgal || { min: 32, avg: 36, max: 42 };

  return {
    id: String(raw.id).trim(),
    brand: String(raw.brand).trim(),
    model: String(raw.model).trim(),
    generation_years: String(raw.generation_years).trim(),
    trim_engine: String(raw.trim_engine).trim(),
    displacement_cc: Number(raw.displacement_cc),
    transmission: raw.transmission,
    fuel_type: raw.fuel_type,
    tank_capacity_liters: tankLiters,
    tank_capacity_gallons: gallons,
    reserve_liters_est: reserveLiters,
    body_type: raw.body_type,
    default_gauge_style: raw.default_gauge_style,
    urban_consumption_ref_kmgal: {
      min: Number(consumption.min),
      avg: Number(consumption.avg),
      max: Number(consumption.max)
    },
    platform_tags: Array.isArray(raw.platform_tags) ? raw.platform_tags : ['Particular']
  };
}

/**
 * Executes the full enrichment process on the taxonomy catalog.
 * @returns {Array<Object>} List of enriched vehicle objects
 */
export function runDataEnrichment() {
  console.log('[DATA-B ENRICHER] Starting vehicle enrichment and verification pipeline...');
  const cacheKey = 'enriched_colombia_fleet';
  
  const enrichedList = COLOMBIAN_FLEET_TAXONOMY.map((item) => {
    const enriched = enrichVehicleRecord(item);
    // Cache individual vehicle specification
    setInCache(`vehicle_${enriched.id}`, enriched);
    return enriched;
  });

  // Sort by brand then model then years
  enrichedList.sort((a, b) => {
    if (a.brand !== b.brand) return a.brand.localeCompare(b.brand);
    if (a.model !== b.model) return a.model.localeCompare(b.model);
    return a.generation_years.localeCompare(b.generation_years);
  });

  // Save to disk cache
  setInCache(cacheKey, enrichedList);

  // Write production JSON
  const outputDir = path.dirname(DB_OUTPUT_PATH);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(DB_OUTPUT_PATH, JSON.stringify(enrichedList, null, 2), 'utf-8');
  console.log(`[DATA-B ENRICHER] Successfully saved ${enrichedList.length} vehicles to ${DB_OUTPUT_PATH}`);

  return enrichedList;
}

if (process.argv[1] && process.argv[1].endsWith('data-b-enricher.js')) {
  runDataEnrichment();
}
