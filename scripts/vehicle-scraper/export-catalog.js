/**
 * OCTANE // KINETIC — Vehicle Catalog Exporter
 * 
 * Exports validated taxonomy dataset to frontend runtime modules.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TAXONOMY_PATH = path.join(__dirname, 'taxonomy-data.json');
const TARGET_CATALOG_PATH = path.join(__dirname, '../../src/assets/vehicles-svg/colombia-fleet.js');

export function exportCatalog() {
  const raw = fs.readFileSync(TAXONOMY_PATH, 'utf-8');
  const dataset = JSON.parse(raw);
  const vehicles = dataset.vehicles;

  const fleetMap = {};

  vehicles.forEach(v => {
    const isPicanto = v.model.toLowerCase().includes('picanto');
    const svgPath = isPicanto ? '/src/assets/vehicles-svg/picanto-2017.svg' : '/src/assets/vehicles-svg/generic-hatch.svg';

    fleetMap[v.id] = {
      id: v.id,
      name: `${v.brand} ${v.model} ${v.trim.split(' ')[0]}`,
      fullName: `${v.brand} ${v.model} ${v.trim}`,
      brand: v.brand,
      model: v.model,
      trim: v.trim,
      generation: v.generation,
      yearRange: v.yearRange,
      category: v.category,
      bodyType: v.bodyType,
      engine: v.engine,
      fuelType: v.fuelType,
      tankCapacityLiters: v.tankCapacityLiters,
      tankCapacityGallons: v.tankCapacityGallons,
      reserveLiters: v.reserveLiters,
      reserveGallons: v.reserveGallons,
      defaultGauge: v.defaultGauge,
      defaultEfficiencyKmGal: v.defaultEfficiencyKmGal,
      svgPath: svgPath,
      usageSuitability: v.usageSuitability,
      fasecoldaCode: v.fasecoldaCode,
      sources: v.sources,
      highlights: [
        `Capacidad tanque: ${v.tankCapacityLiters}L (${v.tankCapacityGallons} Gal)`,
        `Reserva técnica: ${v.reserveLiters}L (${v.reserveGallons} Gal)`,
        `Rendimiento estimado: ~${v.defaultEfficiencyKmGal} km/gal`,
        `Medidor recomendado: ${v.defaultGauge}`
      ]
    };
  });

  const fileContent = `/**
 * OCTANE // KINETIC — Master Colombian Fleet Registry (Auto-generated)
 * Total vehicles: ${Object.keys(fleetMap).length}
 * Generated: ${new Date().toISOString().split('T')[0]}
 */

export const COLOMBIA_FLEET = ${JSON.stringify(fleetMap, null, 2)};

export function getColombiaFleet() {
  return Object.values(COLOMBIA_FLEET);
}
`;

  fs.writeFileSync(TARGET_CATALOG_PATH, fileContent, 'utf-8');
  console.log(`✓ Successfully exported ${Object.keys(fleetMap).length} vehicles to ${TARGET_CATALOG_PATH}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  exportCatalog();
}
