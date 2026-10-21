/**
 * OCTANE // KINETIC — Master Vehicle Scraper & Enrichment Orchestrator
 * 
 * Executes the complete end-to-end data pipeline:
 * 1. SUBAGENTE DATA-A: Taxonomy and Colombian automotive fleet catalog (170+ models)
 * 2. SUBAGENTE DATA-B: Mechanical spec enrichment, tank capacities and mathematical conversion
 * 3. SUBAGENTE CRÍTICO ADVERSARIO: Red Teaming validation against strict physical & mathematical bounds
 */

import { runDataEnrichment } from './data-b-enricher.js';
import { runAdversarialAudit } from './validate-db.js';

export async function runVehicleDataPipeline() {
  console.log('🚀 [ORCHESTRATOR] Starting OCTANE Colombia Automotive Data Pipeline...');
  const startTime = Date.now();

  try {
    // Step 1 & 2: Enrichment & Database Generation
    console.log('\n--- FASE 1 & 2: EXTRACCIÓN, CRUCE Y ENRIQUECIMIENTO (DATA-A & DATA-B) ---');
    const records = runDataEnrichment();
    console.log(`[ORCHESTRATOR] Generados ${records.length} registros enriquecidos.`);

    // Step 3: Adversarial Red-Teaming Validation
    console.log('\n--- FASE 3: AUDITORÍA ADVERSARIA Y RED TEAMING (CRÍTICO ADVERSARIO) ---');
    const isValid = runAdversarialAudit();

    if (!isValid) {
      throw new Error('Pipeline falló en la fase de validación adversaria.');
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n🎉 [PIPELINE SUCCESS] Pipeline completado exitosamente en ${duration}s.`);
    console.log(`📁 Base de datos lista en: src/assets/vehicles-svg/colombia-vehicles-db.json`);
    return records;
  } catch (err) {
    console.error(`\n💥 [PIPELINE ERROR] Error crítico en el pipeline:`, err.message);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('index.js')) {
  runVehicleDataPipeline();
}
