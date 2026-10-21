/**
 * OCTANE // KINETIC — Vehicle Taxonomy Validation & Quality Assurance Test Suite
 * 
 * Verifies completeness, schema adherence, mathematical consistency, and
 * source provenance across the Colombian vehicle fleet dataset.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TAXONOMY_PATH = path.join(__dirname, 'taxonomy-data.json');

const REQUIRED_BRANDS = [
  'Renault', 'Kia', 'Chevrolet', 'Mazda', 'Suzuki',
  'Nissan', 'Toyota', 'Hyundai', 'Volkswagen', 'Ford',
  'BYD', 'JAC', 'Chery', 'Changan', 'Foton'
];

const VALID_GAUGES = ['spicy-arc', 'analog-180', 'digital-lcd', 'sight-glass'];
const VALID_USAGES = ['didi', 'indrive', 'uber', 'taxi_amarillo', 'particular', 'trabajo'];

export function runValidation() {
  console.log('===============================================================');
  console.log('OCTANE // KINETIC — VEHICLE TAXONOMY VALIDATION ENGINE');
  console.log('===============================================================\n');

  if (!fs.existsSync(TAXONOMY_PATH)) {
    throw new Error(`CRITICAL: Taxonomy file missing at ${TAXONOMY_PATH}`);
  }

  const raw = fs.readFileSync(TAXONOMY_PATH, 'utf-8');
  const dataset = JSON.parse(raw);
  const vehicles = dataset.vehicles;

  const errors = [];
  const warnings = [];

  // 1. Metric: Total vehicle count
  console.log(`[TEST 01] Total Vehicle Count Assessment...`);
  if (!Array.isArray(vehicles) || vehicles.length < 120) {
    errors.push(`Requirement failed: Found ${vehicles?.length || 0} vehicles, expected >= 120.`);
  } else {
    console.log(`  ✓ Passed: Found ${vehicles.length} verified vehicles (Target: 120+).`);
  }

  // 2. Metric: Required Brands Check
  console.log(`\n[TEST 02] Mandatory Brand Coverage (15 Brands)...`);
  const foundBrands = new Set(vehicles.map(v => v.brand));
  for (const brand of REQUIRED_BRANDS) {
    if (!foundBrands.has(brand)) {
      errors.push(`Missing mandatory brand: ${brand}`);
    } else {
      const count = vehicles.filter(v => v.brand === brand).length;
      console.log(`  ✓ Brand "${brand}": ${count} models/generations.`);
    }
  }

  // 3. Metric: Key Models & Generations
  console.log(`\n[TEST 03] Key Model Verification...`);
  const keyModelChecks = [
    { brand: 'Renault', models: ['Logan', 'Sandero', 'Stepway', 'Duster', 'Kwid', 'Twingo', 'Clio'] },
    { brand: 'Kia', models: ['Picanto', 'Rio', 'Cerato', 'Sonet', 'Sportage'] },
    { brand: 'Chevrolet', models: ['Spark', 'Beat', 'Sail', 'Aveo', 'Optra', 'Onix', 'Tracker', 'D-Max'] },
    { brand: 'Mazda', models: ['Mazda 2', 'Mazda 3', 'CX-30', 'CX-5'] },
    { brand: 'Suzuki', models: ['Swift', 'Dzire', 'Alto', 'S-Presso', 'Baleno', 'Vitara'] },
    { brand: 'Nissan', models: ['March', 'Versa', 'Sentra', 'Kicks', 'Frontier'] },
    { brand: 'Toyota', models: ['Corolla', 'Corolla Cross', 'Yaris', 'Hilux', 'Land Cruiser Prado'] },
    { brand: 'Hyundai', models: ['Atos', 'Grand i10', 'Accent', 'HB20', 'Tucson'] },
    { brand: 'Volkswagen', models: ['Gol', 'Voyage', 'Polo', 'Virtus', 'Jetta', 'T-Cross', 'Nivus'] },
    { brand: 'Ford', models: ['Fiesta', 'EcoSport', 'Escape', 'Ranger'] }
  ];

  for (const check of keyModelChecks) {
    const brandVehicles = vehicles.filter(v => v.brand === check.brand);
    for (const model of check.models) {
      const match = brandVehicles.find(v => v.model.toLowerCase().includes(model.toLowerCase()));
      if (!match) {
        errors.push(`Required model not found: ${check.brand} ${model}`);
      } else {
        console.log(`  ✓ Key Model: ${check.brand} ${model}`);
      }
    }
  }

  // 4. Metric: Platforms & Taxis Check
  console.log(`\n[TEST 04] Fleet Use Case Suitability (DiDi, InDrive, Taxis, Particulares)...`);
  const didiCount = vehicles.filter(v => v.usageSuitability?.includes('didi')).length;
  const indriveCount = vehicles.filter(v => v.usageSuitability?.includes('indrive')).length;
  const taxiCount = vehicles.filter(v => v.usageSuitability?.includes('taxi_amarillo')).length;
  const particularCount = vehicles.filter(v => v.usageSuitability?.includes('particular')).length;

  console.log(`  ✓ DiDi Compatible: ${didiCount} vehicles`);
  console.log(`  ✓ InDrive Compatible: ${indriveCount} vehicles`);
  console.log(`  ✓ Taxi Amarillo Servicio Público: ${taxiCount} vehicles`);
  console.log(`  ✓ Particular / Privado: ${particularCount} vehicles`);

  if (didiCount < 50) errors.push(`Too few DiDi platform vehicles (${didiCount})`);
  if (taxiCount < 10) errors.push(`Too few yellow taxi models (${taxiCount})`);

  // 5. Metric: Deep Specification Integrity
  console.log(`\n[TEST 05] Technical Specs & Physical Mathematical Integrity...`);
  const seenIds = new Set();

  vehicles.forEach((v, idx) => {
    // Unique ID
    if (!v.id || seenIds.has(v.id)) {
      errors.push(`Vehicle #${idx}: Duplicate or missing ID "${v.id}"`);
    }
    seenIds.add(v.id);

    // Year range
    if (!v.yearRange || !v.yearRange.includes('20')) {
      errors.push(`Vehicle "${v.id}": Invalid yearRange "${v.yearRange}"`);
    }

    // Gauge style
    if (!VALID_GAUGES.includes(v.defaultGauge)) {
      errors.push(`Vehicle "${v.id}": Invalid defaultGauge "${v.defaultGauge}". Must be one of ${VALID_GAUGES.join(', ')}`);
    }

    // Usage tags
    if (!Array.isArray(v.usageSuitability) || v.usageSuitability.length === 0) {
      errors.push(`Vehicle "${v.id}": usageSuitability must be a non-empty array.`);
    }

    // Physical fuel parameters
    if (v.fuelType === 'electrico') {
      if (!v.batteryCapacityKwh || v.batteryCapacityKwh <= 0) {
        errors.push(`EV "${v.id}": Missing batteryCapacityKwh.`);
      }
      if (!v.rangeKm || v.rangeKm <= 0) {
        errors.push(`EV "${v.id}": Missing rangeKm.`);
      }
    } else {
      if (v.tankCapacityLiters <= 0) {
        errors.push(`ICE/Hybrid "${v.id}": tankCapacityLiters must be > 0.`);
      }
      const expectedGallons = Number((v.tankCapacityLiters / 3.78541).toFixed(2));
      const diff = Math.abs(v.tankCapacityGallons - expectedGallons);
      if (diff > 0.08) {
        warnings.push(`Vehicle "${v.id}": Gallons discrepancy (Liters: ${v.tankCapacityLiters}, Gallons: ${v.tankCapacityGallons}, Expected: ${expectedGallons})`);
      }
      if (v.reserveLiters <= 0 || v.reserveLiters >= v.tankCapacityLiters) {
        errors.push(`Vehicle "${v.id}": Invalid reserveLiters (${v.reserveLiters}) for tank ${v.tankCapacityLiters}L.`);
      }
    }

    // Sources verification
    if (!Array.isArray(v.sources) || v.sources.length < 2) {
      warnings.push(`Vehicle "${v.id}": Should cite at least 2 verified sources (Found: ${v.sources?.length || 0}).`);
    }
  });

  console.log(`\n===============================================================`);
  console.log(`VALIDATION SUMMARY:`);
  console.log(`  - Total Entities Tested: ${vehicles.length}`);
  console.log(`  - Errors: ${errors.length}`);
  console.log(`  - Warnings: ${warnings.length}`);
  console.log(`===============================================================\n`);

  if (errors.length > 0) {
    console.error('FAILED VALIDATIONS:');
    errors.forEach(e => console.error(`  ✖ ${e}`));
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.warn('WARNINGS:');
    warnings.forEach(w => console.warn(`  ⚠ ${w}`));
  }

  console.log('✓ TAXONOMY TEST SUITE PASSED WITH 100% SUCCESS.');
  return {
    success: true,
    totalVehicles: vehicles.length,
    brandCount: foundBrands.size,
    didiCount,
    indriveCount,
    taxiCount,
    particularCount
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runValidation();
}
