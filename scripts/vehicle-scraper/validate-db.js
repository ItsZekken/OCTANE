/**
 * OCTANE // KINETIC — SUBAGENTE CRÍTICO ADVERSARIO (Red Teaming de Datos)
 * Auditor de Integridad Física, Consistencia Mecánica y Anti-Alucinación
 * 
 * Reglas de Rechazo Inmediato:
 * 1. Cero Nulos y Cero Placeholders: Ningún registro puede tener tank_capacity_liters null, 0, NaN o valores genéricos sin verificar.
 * 2. Límites Físicos Reales: City Cars (Picanto, Spark, Kwid, Alto, QQ, Atos, etc.) NO pueden superar 42L.
 *    SUVs (suv / suv-compact) NO pueden tener menos de 38L.
 * 3. Consistencia Matemática: tank_capacity_gallons DEBE ser exactamente Number((tank_capacity_liters / 3.78541).toFixed(2)) en el 100% de los registros.
 * 4. Cobertura Mínima: Al menos 100 configuraciones reales del mercado colombiano perfectamente tipadas.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.resolve(__dirname, '../../src/assets/vehicles-svg/colombia-vehicles-db.json');

const CITY_CAR_KEYWORDS = ['picanto', 'spark', 'kwid', 'alto', 's-presso', 'qq', 'atos', 'celerio'];
const REQUIRED_BRANDS = ['Renault', 'Kia', 'Chevrolet', 'Mazda', 'Suzuki', 'Nissan', 'Toyota', 'Hyundai', 'Volkswagen', 'Ford'];
const VALID_BODY_TYPES = ['hatchback-micro', 'hatchback', 'sedan', 'suv-compact', 'suv', 'pickup'];
const VALID_GAUGES = ['spicy-arc', 'analog-180', 'digital-lcd', 'sight-glass'];
const VALID_TRANSMISSIONS = ['MT', 'AT', 'CVT'];
const VALID_FUELS = ['Gasolina Corriente', 'Gasolina Extra', 'Híbrido (HEV/MHEV)', 'GNV/Dual', 'Diesel'];
const PLACEHOLDER_REGEX = /^(todo|tbd|placeholder|xxx|unknown|n\/a|test|null|undefined)$/i;

export function runAdversarialAudit() {
  console.log('================================================================');
  console.log('⚡ OCTANE // KINETIC — RED TEAMING DATA AUDITOR (CRÍTICO ADVERSARIO)');
  console.log('================================================================');

  if (!fs.existsSync(DB_PATH)) {
    console.error(`[AUDIT FAILED] Database file not found at ${DB_PATH}`);
    process.exit(1);
  }

  const rawData = fs.readFileSync(DB_PATH, 'utf-8');
  let vehicles = [];
  try {
    vehicles = JSON.parse(rawData);
  } catch (err) {
    console.error(`[AUDIT FAILED] JSON Parsing error: ${err.message}`);
    process.exit(1);
  }

  if (!Array.isArray(vehicles)) {
    console.error('[AUDIT FAILED] Database root is not an array.');
    process.exit(1);
  }

  const failures = [];
  const warnings = [];
  const seenIds = new Set();
  const brandCounts = {};

  console.log(`[AUDIT INFO] Loaded ${vehicles.length} vehicle configurations for adversarial stress testing.`);

  // Rule 4 Check: Minimum Coverage
  if (vehicles.length < 100) {
    failures.push(`REGLA 4 VIOLADA: Cobertura insuficiente (${vehicles.length} registros). Mínimo exigido: 100.`);
  }

  vehicles.forEach((v, index) => {
    const ref = `[#${index + 1} | ${v.brand || 'NO_BRAND'} ${v.model || 'NO_MODEL'} (${v.id || 'NO_ID'})]`;

    // 1. Slug uniqueness
    if (!v.id || typeof v.id !== 'string') {
      failures.push(`${ref} Campo "id" ausente o no es string.`);
    } else if (seenIds.has(v.id)) {
      failures.push(`${ref} ID duplicado detectado: "${v.id}".`);
    } else {
      seenIds.add(v.id);
    }

    // 2. Placeholder checks
    for (const key of ['brand', 'model', 'generation_years', 'trim_engine']) {
      const val = v[key];
      if (!val || typeof val !== 'string' || PLACEHOLDER_REGEX.test(val.trim())) {
        failures.push(`${ref} Placeholder o campo vacío detectado en "${key}": "${val}".`);
      }
    }

    // 3. Brand count tracking
    if (v.brand) {
      brandCounts[v.brand] = (brandCounts[v.brand] || 0) + 1;
    }

    // 4. Displacement bounds
    if (typeof v.displacement_cc !== 'number' || isNaN(v.displacement_cc) || v.displacement_cc < 600 || v.displacement_cc > 6500) {
      failures.push(`${ref} Cilindrada inválida (${v.displacement_cc} cc). Rango permitido: 600cc a 6500cc.`);
    }

    // 5. Enums
    if (!VALID_BODY_TYPES.includes(v.body_type)) {
      failures.push(`${ref} Tipo de carrocería inválido: "${v.body_type}".`);
    }
    if (!VALID_GAUGES.includes(v.default_gauge_style)) {
      failures.push(`${ref} Estilo de medidor inválido: "${v.default_gauge_style}".`);
    }
    if (!VALID_TRANSMISSIONS.includes(v.transmission)) {
      failures.push(`${ref} Transmisión inválida: "${v.transmission}".`);
    }
    if (!VALID_FUELS.includes(v.fuel_type)) {
      failures.push(`${ref} Tipo de combustible inválido: "${v.fuel_type}".`);
    }

    // 6. REGLA 1: Cero Nulos / Cero 0 / Cero NaN en capacidad
    const liters = v.tank_capacity_liters;
    if (liters === null || liters === undefined || typeof liters !== 'number' || isNaN(liters) || liters <= 0) {
      failures.push(`${ref} REGLA 1 VIOLADA: Capacidad de tanque nula, cero o NaN (${liters}).`);
    }

    // 7. REGLA 2: Límites Físicos Reales
    const isCityCar = v.body_type === 'hatchback-micro' || CITY_CAR_KEYWORDS.some(k => (v.model || '').toLowerCase().includes(k));
    if (isCityCar && liters > 42.0) {
      failures.push(`${ref} REGLA 2 VIOLADA: City Car supera el límite físico de 42L (${liters}L).`);
    }

    const isSuv = v.body_type === 'suv' || v.body_type === 'suv-compact';
    if (isSuv && liters < 38.0) {
      failures.push(`${ref} REGLA 2 VIOLADA: SUV con tanque inferior al límite físico de 38L (${liters}L).`);
    }

    if (liters < 25.0 || liters > 140.0) {
      failures.push(`${ref} Capacidad fuera de rango automotor global (25L - 140L): ${liters}L.`);
    }

    // 8. REGLA 3: Consistencia Matemática Exacta
    const expectedGallons = Number((liters / 3.78541).toFixed(2));
    if (v.tank_capacity_gallons !== expectedGallons) {
      failures.push(`${ref} REGLA 3 VIOLADA: Inconsistencia matemática. Declarado: ${v.tank_capacity_gallons} gal | Esperado: ${expectedGallons} gal para ${liters}L.`);
    }

    // 9. Reserva técnica bounds
    if (typeof v.reserve_liters_est !== 'number' || v.reserve_liters_est <= 0 || v.reserve_liters_est >= liters * 0.4) {
      failures.push(`${ref} Estimación de reserva incoherente: ${v.reserve_liters_est}L para tanque de ${liters}L.`);
    }

    // 10. Consumo urbano { min, avg, max }
    const c = v.urban_consumption_ref_kmgal;
    if (!c || typeof c.min !== 'number' || typeof c.avg !== 'number' || typeof c.max !== 'number') {
      failures.push(`${ref} urban_consumption_ref_kmgal incompleto.`);
    } else if (c.min >= c.avg || c.avg >= c.max) {
      failures.push(`${ref} Rango de consumo ilógico (min: ${c.min}, avg: ${c.avg}, max: ${c.max}).`);
    }
  });

  // Verify Required Brands
  for (const b of REQUIRED_BRANDS) {
    if (!brandCounts[b] || brandCounts[b] < 3) {
      failures.push(`REGLA 4 VIOLADA: Marca prioritaria "${b}" tiene representación insuficiente (${brandCounts[b] || 0} modelos). Mínimo 3.`);
    }
  }

  console.log('----------------------------------------------------------------');
  console.log(`[AUDIT SUMMARY] Total Registros Verificados: ${vehicles.length}`);
  console.log('[AUDIT SUMMARY] Marcas Cubiertas:');
  Object.entries(brandCounts).sort((a, b) => b[1] - a[1]).forEach(([brand, count]) => {
    console.log(`  - ${brand.padEnd(15)} : ${count} versiones`);
  });
  console.log('----------------------------------------------------------------');

  if (failures.length > 0) {
    console.error(`❌ [AUDIT REJECTED] Se encontraron ${failures.length} violaciones críticas:`);
    failures.forEach((f, i) => console.error(`  ${i + 1}. ${f}`));
    process.exit(1);
  }

  console.log('✅ [AUDIT APPROVED] 100% de los registros cumplen las 4 Reglas Estrictas del Crítico Adversario.');
  console.log('   - Cero nulos y cero placeholders.');
  console.log('   - Límites físicos reales verificados (City Cars <= 42L, SUVs >= 38L).');
  console.log('   - Consistencia matemática exacta en galones (liters / 3.78541).');
  console.log(`   - Cobertura total confirmada: ${vehicles.length} modelos colombianos.`);
  console.log('================================================================');
  return true;
}

if (process.argv[1] && process.argv[1].endsWith('validate-db.js')) {
  runAdversarialAudit();
}
