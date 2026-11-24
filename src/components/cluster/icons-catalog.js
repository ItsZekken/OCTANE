/**
 * OCTANE // KINETIC — Component Icons Catalog ("icons-catalog.js")
 * Minimalist, thin-hairline SVG icon library for mechanical components.
 * 
 * Strict specifications:
 * - 12 canonical icons with fine lines (stroke="currentColor", stroke-width="1.5", fill="none")
 * - 24x24 viewBox, stroke-linecap="round", stroke-linejoin="round"
 * - 100% vector, responsive, dark/light theme compatible via currentColor.
 */

export const ICONS_CATALOG = Object.freeze({
  oil: {
    id: 'oil',
    label: 'Aceite / Motor',
    path: `
      <path d="M19 11v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5l4-3h6l3 2" />
      <path d="M4 12L2 10" />
      <path d="M19 13h2.5a1.5 1.5 0 0 1 1.5 1.5v1a1.5 1.5 0 0 1-1.5 1.5H19" />
      <path d="M12 4v4" />
      <path d="M10 4h4" />
      <circle cx="12" cy="15" r="1.25" fill="currentColor" />
    `
  },
  filter: {
    id: 'filter',
    label: 'Filtro Aire / Cabina',
    path: `
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 8l2.5 8 2.5-8 2.5 8 2.5-8" />
    `
  },
  brakes: {
    id: 'brakes',
    label: 'Frenos / Pastillas',
    path: `
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="M15 3.5a9 9 0 0 1 5.5 5.5l-3.5 1.5a5.5 5.5 0 0 0-3.5-3.5L15 3.5z" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    `
  },
  fuel: {
    id: 'fuel',
    label: 'Gasolina / Inyección',
    path: `
      <rect x="4" y="4" width="9" height="16" rx="1.5" />
      <line x1="4" y1="9.5" x2="13" y2="9.5" />
      <circle cx="8.5" cy="6.75" r="1" />
      <path d="M13 7.5h2a2 2 0 0 1 2 2v6.5a1.5 1.5 0 0 0 3 0v-4.5l-2-2" />
      <line x1="3" y1="20" x2="14" y2="20" />
    `
  },
  tires: {
    id: 'tires',
    label: 'Llantas / Rotación',
    path: `
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4l1.4-1.4M17 7l1.4-1.4" />
    `
  },
  engine: {
    id: 'engine',
    label: 'Bujías / Encendido',
    path: `
      <path d="M4 10V8a1 1 0 0 1 1-1h2V5h4v2h2V5h4v2h2a1 1 0 0 1 1 1v2h2v4h-2v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-4H2v-4h2z" />
      <circle cx="12" cy="13" r="2" />
      <path d="M12 9v1M12 16v1" />
    `
  },
  belt: {
    id: 'belt',
    label: 'Correas / Distribución',
    path: `
      <circle cx="8" cy="12" r="4" />
      <circle cx="16" cy="12" r="4" />
      <path d="M8 8h8M8 16h8" />
      <circle cx="8" cy="12" r="1.25" fill="currentColor" />
      <circle cx="16" cy="12" r="1.25" fill="currentColor" />
    `
  },
  battery: {
    id: 'battery',
    label: 'Batería / Eléctrico',
    path: `
      <rect x="3" y="6" width="18" height="14" rx="2" />
      <line x1="6" y1="3" x2="8" y2="3" />
      <line x1="6" y1="6" x2="8" y2="6" />
      <line x1="16" y1="3" x2="18" y2="3" />
      <line x1="16" y1="6" x2="18" y2="6" />
      <line x1="6" y1="11" x2="10" y2="11" />
      <line x1="8" y1="9" x2="8" y2="13" />
      <line x1="14" y1="11" x2="18" y2="11" />
    `
  },
  coolant: {
    id: 'coolant',
    label: 'Refrigerante / Temp.',
    path: `
      <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z" />
      <circle cx="11.5" cy="17.5" r="2" fill="currentColor" />
      <path d="M11.5 8v6" stroke-width="2" />
      <path d="M17 6h2M17 9h2" />
    `
  },
  suspension: {
    id: 'suspension',
    label: 'Suspensión / Amortiguador',
    path: `
      <line x1="12" y1="2" x2="12" y2="5" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <path d="M8 5h8M8 19h8" />
      <path d="M9 7l6 2-6 2 6 2-6 2 6 2-6 2" />
    `
  },
  transmission: {
    id: 'transmission',
    label: 'Transmisión / Caja',
    path: `
      <circle cx="6" cy="5" r="2" />
      <circle cx="12" cy="5" r="2" />
      <circle cx="18" cy="5" r="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="19" r="2" />
      <path d="M6 7v10M12 7v5M18 7v10M6 12h12" />
    `
  },
  general: {
    id: 'general',
    label: 'General / Taller',
    path: `
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    `
  }
});

export const AVAILABLE_ICONS = Object.values(ICONS_CATALOG);

/**
 * Resolves the best icon ID for a maintenance item based on icon, category, or name.
 * @param {Object} item
 * @returns {string} Icon identifier key
 */
export function resolveIconId(item = {}) {
  const name = String(item?.name || item?.id || '').toLowerCase();
  const explicitIcon = item?.icon && ICONS_CATALOG[item.icon] ? item.icon : null;
  const cat = String(item?.category || '').toLowerCase();

  // Legacy migration guard: old default maint_oil_filter was saved with category: 'engine'
  if (
    (item?.id === 'maint_oil_filter' || name.includes('aceite') || name.includes('oil')) &&
    (!explicitIcon || explicitIcon === 'engine') &&
    (!cat || cat === 'engine' || cat === 'general')
  ) {
    return 'oil';
  }

  if (explicitIcon) {
    return explicitIcon;
  }

  if (ICONS_CATALOG[cat]) return cat;

  // Name heuristic mapping
  if (name.includes('aceite') || name.includes('oil')) return 'oil';
  if (name.includes('filtro cabina') || name.includes('aire') || name.includes('cabin')) return 'filter';
  if (name.includes('freno') || name.includes('pastilla') || name.includes('disco') || name.includes('brake')) return 'brakes';
  if (name.includes('gasolina') || name.includes('combustible') || name.includes('fuel')) return 'fuel';
  if (name.includes('llanta') || name.includes('rotacion') || name.includes('neumatico') || name.includes('tire')) return 'tires';
  if (name.includes('bujia') || name.includes('motor') || name.includes('chispa') || name.includes('spark')) return 'engine';
  if (name.includes('correa') || name.includes('cadena') || name.includes('distribucion') || name.includes('belt')) return 'belt';
  if (name.includes('bateria') || name.includes('battery')) return 'battery';
  if (name.includes('refrigerante') || name.includes('coolant') || name.includes('radiador')) return 'coolant';
  if (name.includes('suspension') || name.includes('amortiguador')) return 'suspension';
  if (name.includes('transmision') || name.includes('caja') || name.includes('embrague') || name.includes('clutch')) return 'transmission';

  return 'general';
}

/**
 * Generates an inline SVG element for the requested icon key.
 * @param {string|Object} iconKeyOrItem - Icon ID or item record
 * @param {string} [className='w-4 h-4'] - CSS class for sizing/styling
 * @returns {string} SVG markup string
 */
export function renderComponentIconSvg(iconKeyOrItem, className = 'w-4 h-4') {
  const iconId = typeof iconKeyOrItem === 'object' 
    ? resolveIconId(iconKeyOrItem)
    : (ICONS_CATALOG[iconKeyOrItem] ? iconKeyOrItem : resolveIconId({ category: iconKeyOrItem }));

  const iconDef = ICONS_CATALOG[iconId] || ICONS_CATALOG.general;

  return `
    <svg 
      class="${className} shrink-0 overflow-visible" 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      stroke-width="1.5" 
      stroke-linecap="round" 
      stroke-linejoin="round"
      aria-hidden="true"
    >
      ${iconDef.path}
    </svg>
  `.trim();
}
