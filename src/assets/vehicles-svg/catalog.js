/**
 * OCTANE // KINETIC — Vehicle Wireframe Catalog & Technical Blueprint Registry
 * 
 * Defines vehicle specifications, tank capacities, default gauge styles,
 * and wireframe blueprint assets for 28 Colombian models + Master Fleet.
 */

import { COLOMBIA_FLEET } from './colombia-fleet.js';
import { AVAILABLE_MODELS } from './models-inline.js';
import { mapBodySilhouette } from '../../components/vehicles/vehicle-search-box.js';

// Build registry for all 28 canonical models
const CANONICAL_28_MODELS = {};
for (const m of AVAILABLE_MODELS) {
  CANONICAL_28_MODELS[m.id] = {
    id: m.id,
    name: m.name,
    category: m.type === 'suv' ? 'SUV / Crossover' : (m.type === 'pickup' ? 'Camioneta Pickup' : (m.type === 'sedan' ? 'Sedán Segmento B/C' : 'Hatchback Subcompacto')),
    tankCapacityLiters: m.type === 'pickup' ? 70.0 : (m.type === 'suv' ? 55.0 : (m.type === 'sedan' ? 45.0 : 35.0)),
    tankCapacityGallons: m.type === 'pickup' ? 18.5 : (m.type === 'suv' ? 14.5 : (m.type === 'sedan' ? 11.9 : 9.25)),
    reserveLiters: m.type === 'pickup' ? 8.0 : (m.type === 'suv' ? 7.0 : (m.type === 'sedan' ? 6.0 : 5.0)),
    reserveGallons: m.type === 'pickup' ? 2.1 : (m.type === 'suv' ? 1.85 : (m.type === 'sedan' ? 1.58 : 1.32)),
    defaultGauge: m.type === 'pickup' ? 'analog-180' : (m.type === 'suv' ? 'sight-glass' : 'spicy-arc'),
    defaultEfficiencyKmGal: m.type === 'pickup' ? 32.0 : (m.type === 'suv' ? 38.0 : (m.type === 'sedan' ? 45.0 : 50.0)),
    svgModel: m.id,
    svgPath: `/src/assets/vehicles-svg/models/${m.id}.svg`,
    highlights: [
      `Silueta Industrial de Alta Precisión: ${m.name}`,
      `Blueprint CAD Vectorial estándar viewBox 0 0 800 280`,
      `Geometría canónica probada con suelo a Y=250`
    ]
  };
}

export const VEHICLE_CATALOG = {
    ...COLOMBIA_FLEET,
    ...CANONICAL_28_MODELS,
    'picanto-2017': {
        ...CANONICAL_28_MODELS['kia-picanto'],
        id: 'picanto-2017',
        name: 'Kia Picanto 1.0L',
        svgModel: 'kia-picanto',
        svgPath: '/src/assets/vehicles-svg/models/kia-picanto.svg'
    },
    'generic-hatch': {
        ...CANONICAL_28_MODELS['volkswagen-gol'],
        id: 'generic-hatch',
        name: 'Hatchback Genérico',
        svgModel: 'volkswagen-gol',
        svgPath: '/src/assets/vehicles-svg/models/volkswagen-gol.svg'
    }
};

/**
 * Returns the entire registered vehicle catalog.
 * @returns {Array<Object>} List of vehicle models
 */
export function getVehicleCatalog() {
    return Object.values(VEHICLE_CATALOG);
}

/**
 * Retrieves a vehicle model by its unique ID.
 * Falls back to 'kia-picanto' if not found.
 * Dynamically resolves svgModel and svgPath if not already present.
 * @param {string} id - Vehicle ID
 * @returns {Object} Vehicle metadata
 */
export function getVehicleModel(id) {
    const defaultModel = VEHICLE_CATALOG['kia-picanto'] || VEHICLE_CATALOG['picanto-2017'];
    if (!id) return defaultModel;

    let match = VEHICLE_CATALOG[id];

    if (!match) {
        // Try mapping the id as a model string or vehicle name
        const mappedId = mapBodySilhouette({ id, model: id });
        match = VEHICLE_CATALOG[mappedId];
    }

    if (!match) {
        return defaultModel;
    }

    // Ensure svgModel and svgPath resolve to stylized models
    const silhouette = match.svgModel || mapBodySilhouette(match);
    return {
        ...match,
        svgModel: silhouette,
        svgPath: match.svgPath && match.svgPath.includes('/models/') ? match.svgPath : `/src/assets/vehicles-svg/models/${silhouette}.svg`
    };
}

/**
 * Register or update a custom vehicle model in the registry.
 * @param {Object} model - Vehicle model object
 * @returns {Object} Registered model
 */
export function registerVehicleModel(model) {
    if (!model || !model.id) {
        throw new Error('registerVehicleModel requires an object with an "id" property');
    }
    const silhouette = mapBodySilhouette(model);
    VEHICLE_CATALOG[model.id] = {
        ...VEHICLE_CATALOG['generic-hatch'],
        svgModel: silhouette,
        svgPath: `/src/assets/vehicles-svg/models/${silhouette}.svg`,
        ...model
    };
    return VEHICLE_CATALOG[model.id];
}

export { mapBodySilhouette, formatVehicleTitle, formatVehicleFullName, searchColombiaVehicles } from '../../components/vehicles/vehicle-search-box.js';
