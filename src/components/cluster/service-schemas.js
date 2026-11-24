/**
 * OCTANE — System Categories & Tailored Maintenance Service Schemas
 *
 * Defines:
 * 1. MAINTENANCE_GROUPS: 5 clean automotive system categories for Clúster accordions.
 * 2. SERVICE_SCHEMAS: Component-specific optional fields (e.g., viscosity, base oil,
 *    filter changed for oil; tire size, work type, alignment/balancing for tires; etc.).
 * 3. Summary helpers to render concise technical spec tags on component rows & history.
 */

import { resolveIconId } from './icons-catalog.js';

export const MAINTENANCE_GROUPS = Object.freeze([
    {
        id: 'motor',
        label: 'Motor y Fluidos',
        icon: 'oil',
        icons: ['oil', 'engine', 'belt', 'coolant', 'fuel'],
    },
    {
        id: 'rodaje',
        label: 'Llantas y Frenos',
        icon: 'tires',
        icons: ['tires', 'brakes', 'suspension'],
    },
    {
        id: 'cabina',
        label: 'Cabina y Eléctrico',
        icon: 'filter',
        icons: ['filter', 'battery'],
    },
    {
        id: 'transmision',
        label: 'Transmisión',
        icon: 'transmission',
        icons: ['transmission'],
    },
    {
        id: 'general',
        label: 'General y Otros',
        icon: 'general',
        icons: ['general'],
    },
]);

export const GROUP_BY_ID = Object.freeze(
    MAINTENANCE_GROUPS.reduce((acc, g) => {
        acc[g.id] = g;
        return acc;
    }, {})
);

/**
 * Resolves the canonical accordion system group for a maintenance item.
 * Respects explicit `item.group` if valid, otherwise infers cleanly from icon/category/name.
 * @param {Object} item
 * @returns {string} Group ID ('motor' | 'rodaje' | 'cabina' | 'transmision' | 'general')
 */
export function resolveMaintenanceGroup(item = {}) {
    if (item?.group && GROUP_BY_ID[item.group]) {
        return item.group;
    }

    const iconId = resolveIconId(item);
    for (const group of MAINTENANCE_GROUPS) {
        if (group.icons.includes(iconId)) {
            return group.id;
        }
    }

    const cat = String(item?.category || '').toLowerCase();
    if (cat === 'cabin') return 'cabina';
    if (cat === 'engine' || cat === 'fuel' || cat === 'oil') return 'motor';
    if (cat === 'tires' || cat === 'brakes' || cat === 'suspension') return 'rodaje';
    if (cat === 'transmission') return 'transmision';

    return 'general';
}

/**
 * Tailored optional specification fields per component type (keyed by icon ID).
 * Field types:
 *  - 'chips': single-select quick chips (toggleable off; optional allowCustom text input)
 *  - 'text': clean underline text input
 *  - 'toggles': multi-select boolean chips (saved as boolean keys in specs)
 */
export const SERVICE_SCHEMAS = Object.freeze({
    oil: {
        sectionLabel: 'Especificaciones del aceite (opcional)',
        fields: [
            {
                key: 'viscosity',
                label: 'Viscosidad',
                type: 'chips',
                options: ['0W-20', '5W-20', '5W-30', '5W-40', '10W-30', '10W-40', '15W-40', '20W-50'],
                allowCustom: true,
            },
            {
                key: 'oilType',
                label: 'Base del aceite',
                type: 'chips',
                options: ['Sintético', 'Semi-sintético', 'Mineral'],
            },
            {
                key: 'brand',
                label: 'Marca / Línea',
                type: 'text',
                half: true,
                maxLength: 40,
            },
            {
                key: 'quantity',
                label: 'Cantidad (L / cuartos)',
                type: 'text',
                half: true,
                maxLength: 20,
            },
            {
                key: 'filterRef',
                label: 'Referencia filtro aceite',
                type: 'text',
                maxLength: 40,
            },
            {
                key: 'extras',
                label: 'Incluyó en el servicio',
                type: 'toggles',
                options: [
                    { key: 'filterChanged', label: 'Filtro de aceite', defaultOn: true },
                    { key: 'drainWasher', label: 'Arandela tapón' },
                    { key: 'additive', label: 'Aditivo' },
                ],
            },
        ],
    },

    tires: {
        sectionLabel: 'Especificaciones de llantas (opcional)',
        fields: [
            {
                key: 'workType',
                label: 'Tipo de trabajo',
                type: 'chips',
                options: ['Cambio (4)', 'Cambio par (2)', 'Cambio (1)', 'Rotación', 'Alineación y balanceo', 'Reparación'],
            },
            {
                key: 'position',
                label: 'Posición / Eje',
                type: 'chips',
                options: ['Todas (4)', 'Delanteras', 'Traseras', 'Individual'],
            },
            {
                key: 'brand',
                label: 'Marca / Modelo',
                type: 'text',
                half: true,
                maxLength: 40,
            },
            {
                key: 'size',
                label: 'Medida (ancho/perfil rin)',
                type: 'text',
                half: true,
                maxLength: 25,
            },
            {
                key: 'pressurePsi',
                label: 'Presión calibrada (PSI)',
                type: 'text',
                half: true,
                maxLength: 15,
            },
            {
                key: 'dotCode',
                label: 'Fecha fabricación (DOT)',
                type: 'text',
                half: true,
                maxLength: 16,
            },
            {
                key: 'extras',
                label: 'Incluyó en el servicio',
                type: 'toggles',
                options: [
                    { key: 'alignment', label: 'Alineación' },
                    { key: 'balancing', label: 'Balanceo' },
                    { key: 'newValves', label: 'Válvulas nuevas' },
                ],
            },
        ],
    },

    brakes: {
        sectionLabel: 'Especificaciones de frenos (opcional)',
        fields: [
            {
                key: 'serviceType',
                label: 'Trabajo realizado',
                type: 'chips',
                options: ['Pastillas del.', 'Pastillas tras.', 'Bandas / Zapatas', 'Discos', 'Líquido frenos', 'Rectificación'],
            },
            {
                key: 'fluidSpec',
                label: 'Líquido (si aplica)',
                type: 'chips',
                options: ['DOT 3', 'DOT 4', 'DOT 5.1'],
            },
            {
                key: 'brand',
                label: 'Marca / Compuesto',
                type: 'text',
                maxLength: 40,
            },
            {
                key: 'extras',
                label: 'Incluyó en el servicio',
                type: 'toggles',
                options: [
                    { key: 'bleed', label: 'Purga / Sangrado' },
                    { key: 'cleaning', label: 'Limpieza mordazas' },
                ],
            },
        ],
    },

    filter: {
        sectionLabel: 'Especificaciones del filtro (opcional)',
        fields: [
            {
                key: 'filterType',
                label: 'Tipo de filtro',
                type: 'chips',
                options: ['Cabina A/C', 'Carbón activado', 'Aire motor'],
            },
            {
                key: 'brand',
                label: 'Marca',
                type: 'text',
                half: true,
                maxLength: 35,
            },
            {
                key: 'partCode',
                label: 'Código / Referencia',
                type: 'text',
                half: true,
                maxLength: 35,
            },
        ],
    },

    fuel: {
        sectionLabel: 'Especificaciones de combustible (opcional)',
        fields: [
            {
                key: 'serviceType',
                label: 'Trabajo realizado',
                type: 'chips',
                options: ['Filtro gasolina', 'Limpieza inyectores', 'Cuerpo aceleración', 'Bomba combustible'],
            },
            {
                key: 'brand',
                label: 'Marca',
                type: 'text',
                half: true,
                maxLength: 35,
            },
            {
                key: 'partCode',
                label: 'Código / Referencia',
                type: 'text',
                half: true,
                maxLength: 35,
            },
        ],
    },

    engine: {
        sectionLabel: 'Especificaciones de encendido / motor (opcional)',
        fields: [
            {
                key: 'plugType',
                label: 'Tipo de bujía',
                type: 'chips',
                options: ['Iridio', 'Platino', 'Cobre / Estándar'],
            },
            {
                key: 'quantity',
                label: 'Cantidad',
                type: 'chips',
                options: ['3', '4', '6', '8'],
            },
            {
                key: 'brand',
                label: 'Marca / Código',
                type: 'text',
                maxLength: 40,
            },
            {
                key: 'extras',
                label: 'Incluyó en el servicio',
                type: 'toggles',
                options: [
                    { key: 'cablesChanged', label: 'Cables / Bobinas' },
                    { key: 'throttleClean', label: 'Sincronización' },
                ],
            },
        ],
    },

    belt: {
        sectionLabel: 'Especificaciones de correas (opcional)',
        fields: [
            {
                key: 'beltType',
                label: 'Tipo de correa',
                type: 'chips',
                options: ['Repartición', 'Accesorios', 'Kit completo', 'Cadena'],
            },
            {
                key: 'brand',
                label: 'Marca / Referencia',
                type: 'text',
                maxLength: 40,
            },
            {
                key: 'extras',
                label: 'Incluyó en el servicio',
                type: 'toggles',
                options: [
                    { key: 'tensioner', label: 'Tensor incluido' },
                    { key: 'waterPump', label: 'Bomba de agua' },
                ],
            },
        ],
    },

    battery: {
        sectionLabel: 'Especificaciones de batería (opcional)',
        fields: [
            {
                key: 'brand',
                label: 'Marca / Modelo',
                type: 'text',
                half: true,
                maxLength: 40,
            },
            {
                key: 'capacity',
                label: 'Amperaje / CCA',
                type: 'text',
                half: true,
                maxLength: 25,
            },
            {
                key: 'warrantyMonths',
                label: 'Garantía (meses)',
                type: 'text',
                half: true,
                maxLength: 15,
            },
            {
                key: 'voltage',
                label: 'Voltaje medido (V)',
                type: 'text',
                half: true,
                maxLength: 10,
            },
        ],
    },

    coolant: {
        sectionLabel: 'Especificaciones de refrigerante (opcional)',
        fields: [
            {
                key: 'coolantType',
                label: 'Tipo de refrigerante',
                type: 'chips',
                options: ['Orgánico (OAT)', 'Híbrido (HOAT)', '50/50 Listo', 'Concentrado'],
            },
            {
                key: 'brand',
                label: 'Marca / Color',
                type: 'text',
                half: true,
                maxLength: 35,
            },
            {
                key: 'quantity',
                label: 'Cantidad (L)',
                type: 'text',
                half: true,
                maxLength: 15,
            },
            {
                key: 'extras',
                label: 'Incluyó en el servicio',
                type: 'toggles',
                options: [
                    { key: 'systemFlush', label: 'Limpieza / Flush' },
                    { key: 'thermostat', label: 'Termostato' },
                ],
            },
        ],
    },

    suspension: {
        sectionLabel: 'Especificaciones de suspensión (opcional)',
        fields: [
            {
                key: 'position',
                label: 'Posición',
                type: 'chips',
                options: ['Delanteros', 'Traseros', 'Todos (4)'],
            },
            {
                key: 'partType',
                label: 'Componente',
                type: 'chips',
                options: ['Amortiguadores', 'Bujes / Tijeras', 'Terminales', 'Copelas', 'Espirales'],
            },
            {
                key: 'brand',
                label: 'Marca / Referencia',
                type: 'text',
                maxLength: 40,
            },
            {
                key: 'extras',
                label: 'Incluyó en el servicio',
                type: 'toggles',
                options: [
                    { key: 'alignment', label: 'Alineación posterior' },
                ],
            },
        ],
    },

    transmission: {
        sectionLabel: 'Especificaciones de transmisión (opcional)',
        fields: [
            {
                key: 'serviceType',
                label: 'Tipo de trabajo',
                type: 'chips',
                options: ['Aceite caja', 'Kit embrague', 'Guaya / Bomba', 'Filtro ATF'],
            },
            {
                key: 'fluidSpec',
                label: 'Fluido (si aplica)',
                type: 'chips',
                options: ['75W-85', '75W-90', '80W-90', 'ATF', 'CVT'],
            },
            {
                key: 'brand',
                label: 'Marca / Referencia',
                type: 'text',
                maxLength: 40,
            },
        ],
    },

    general: {
        sectionLabel: 'Detalles técnicos (opcional)',
        fields: [
            {
                key: 'brand',
                label: 'Marca / Repuesto',
                type: 'text',
                half: true,
                maxLength: 40,
            },
            {
                key: 'partCode',
                label: 'Código / Referencia',
                type: 'text',
                half: true,
                maxLength: 35,
            },
            {
                key: 'warranty',
                label: 'Garantía',
                type: 'text',
                maxLength: 30,
            },
        ],
    },
});

/**
 * Returns the service form schema matching a maintenance item.
 * @param {Object} item
 * @returns {{ iconId: string, sectionLabel: string, fields: Array<Object> }}
 */
export function getServiceSchemaForItem(item = {}) {
    let iconId = resolveIconId(item);
    const name = String(item?.name || '').toLowerCase();
    // Extra safety: if user named a component with oil/tire/brake/etc. and left generic icon, match schema by name
    if (iconId === 'general' || (iconId === 'engine' && (name.includes('aceite') || name.includes('oil')))) {
        if (name.includes('aceite') || name.includes('oil')) iconId = 'oil';
        else if (name.includes('llanta') || name.includes('neumat') || name.includes('tire')) iconId = 'tires';
        else if (name.includes('freno') || name.includes('pastilla') || name.includes('brake')) iconId = 'brakes';
        else if (name.includes('bateria') || name.includes('batería')) iconId = 'battery';
        else if (name.includes('refrigerante') || name.includes('coolant')) iconId = 'coolant';
        else if (name.includes('filtro')) iconId = name.includes('gasolina') ? 'fuel' : 'filter';
        else if (name.includes('correa') || name.includes('distribuc')) iconId = 'belt';
        else if (name.includes('suspens') || name.includes('amortiguador')) iconId = 'suspension';
        else if (name.includes('transmis') || name.includes('caja') || name.includes('embrague')) iconId = 'transmission';
    }
    const schema = SERVICE_SCHEMAS[iconId] || SERVICE_SCHEMAS.general;
    return {
        iconId,
        ...schema,
    };
}

/**
 * Formats a saved service entry's optional `specs` into an array of concise display badges
 * (e.g. ['5W-30', 'Sintético', 'Shell Helix', 'Filtro de aceite']).
 * @param {Object} entry - History entry object
 * @param {Object} [item] - Parent maintenance item (for toggle labels)
 * @returns {Array<{ label: string, value: string }>}
 */
export function extractSpecReadouts(entry = {}, item = {}) {
    const specs = entry?.specs;
    if (!specs || typeof specs !== 'object') return [];

    const schema = getServiceSchemaForItem(item);
    const readouts = [];
    const seenKeys = new Set();

    for (const field of schema.fields) {
        if (field.type === 'toggles') {
            for (const opt of field.options || []) {
                seenKeys.add(opt.key);
                if (specs[opt.key] === true) {
                    readouts.push({ label: opt.label, value: 'Sí', isToggle: true });
                }
            }
        } else {
            seenKeys.add(field.key);
            const raw = specs[field.key];
            if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
                readouts.push({ label: field.label, value: String(raw).trim(), isToggle: false });
            }
        }
    }

    // Preserve any extra custom spec keys not in current schema
    for (const [key, val] of Object.entries(specs)) {
        if (seenKeys.has(key)) continue;
        if (val === true) {
            readouts.push({ label: key, value: 'Sí', isToggle: true });
        } else if (val && typeof val !== 'boolean' && String(val).trim() !== '') {
            readouts.push({ label: key, value: String(val).trim(), isToggle: false });
        }
    }

    return readouts;
}

/**
 * Builds a concise inline summary string for a service entry (max 3 highlights)
 * suitable for the collapsed component row.
 * @param {Object} entry
 * @param {Object} [item]
 * @returns {string}
 */
export function formatCompactSpecSummary(entry = {}, item = {}) {
    const readouts = extractSpecReadouts(entry, item);
    if (readouts.length === 0) return '';
    const tokens = [];
    for (const r of readouts) {
        if (tokens.length >= 3) break;
        tokens.push(r.isToggle ? r.label : r.value);
    }
    return tokens.join(' · ');
}
