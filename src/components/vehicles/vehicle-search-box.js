/**
 * OCTANE // KINETIC — Terminal Autocomplete Vehicle Search Component
 * 
 * Estética Suiza Teenage Engineering:
 * - 10px JetBrains Mono
 * - Cero parrafos (etiquetas p estrictamente prohibidas)
 * - Bordes planos de 1px con hairlines
 * - Despacho de haptic / horology tick
 * - Autocompletado instantáneo de especificaciones de tanque, medidor y chasis CAD
 */

import colombiaFleetData from '../../assets/vehicles-svg/colombia-vehicles-db.json' with { type: 'json' };
import { playHorologyTick } from '../../core/telemetry-engine.js';
import { showToast } from '../../core/state.js';

/**
 * Maps a vehicle specification to one of the 28 stylized SVG body silhouettes:
 * - 10 Hatchbacks: kia-picanto, chevrolet-spark-gt, renault-kwid, renault-twingo, mazda-2-hatch,
 *   suzuki-swift, renault-sandero, chevrolet-onix-hatch, volkswagen-gol, nissan-march
 * - 8 Sedanes: mazda-3, renault-logan, chevrolet-sail, chevrolet-onix-sedan, nissan-versa,
 *   toyota-corolla, chevrolet-aveo, hyundai-accent
 * - 10 SUVs & Pickups: renault-duster, mazda-cx30, chevrolet-tracker, suzuki-vitara,
 *   kia-sportage, toyota-fortuner, toyota-prado, toyota-hilux, nissan-frontier, toyota-tundra
 * 
 * @param {Object|string} vehicle 
 * @returns {string} Model identifier (e.g. 'toyota-hilux')
 */
export function mapBodySilhouette(vehicle) {
  if (!vehicle) return 'kia-picanto';
  
  let model = '';
  let brand = '';
  let body = '';
  let id = '';

  if (typeof vehicle === 'string') {
    model = vehicle.toLowerCase();
    id = vehicle.toLowerCase();
  } else {
    model = String(vehicle.model || '').toLowerCase();
    brand = String(vehicle.brand || '').toLowerCase();
    body = String(vehicle.body_type || vehicle.bodyType || '').toLowerCase();
    id = String(vehicle.id || '').toLowerCase();
  }

  const fullStr = `${id} ${brand} ${model} ${body}`.toLowerCase();

  // 1. Pickups (Highest priority to avoid SUV confusion)
  if (fullStr.includes('tundra') || fullStr.includes('tacoma') || fullStr.includes('f-150') || fullStr.includes('silverado') || fullStr.includes('ram')) {
    return 'toyota-tundra';
  }
  if (fullStr.includes('frontier') || fullStr.includes('np300') || fullStr.includes('navara')) {
    return 'nissan-frontier';
  }
  if (fullStr.includes('hilux') || fullStr.includes('d-max') || fullStr.includes('dmax') || fullStr.includes('ranger') || fullStr.includes('amarok') || body === 'pickup') {
    return 'toyota-hilux';
  }

  // 2. SUVs & Off-Roaders
  if (fullStr.includes('prado') || fullStr.includes('land cruiser') || fullStr.includes('montero') || fullStr.includes('pajero') || fullStr.includes('patrol')) {
    return 'toyota-prado';
  }
  if (fullStr.includes('fortuner') || fullStr.includes('sw4') || fullStr.includes('4runner')) {
    return 'toyota-fortuner';
  }
  if (fullStr.includes('sportage') || fullStr.includes('tucson') || fullStr.includes('seltos') || fullStr.includes('creta') || fullStr.includes('santa fe')) {
    return 'kia-sportage';
  }
  if (fullStr.includes('vitara') || fullStr.includes('jimny') || fullStr.includes('s-cross') || fullStr.includes('scross')) {
    return 'suzuki-vitara';
  }
  if (fullStr.includes('tracker') || fullStr.includes('trax') || fullStr.includes('groove') || fullStr.includes('captiva') || fullStr.includes('kicks') || fullStr.includes('qashqai')) {
    return 'chevrolet-tracker';
  }
  if (fullStr.includes('cx-30') || fullStr.includes('cx30') || fullStr.includes('cx-3') || fullStr.includes('cx-5') || fullStr.includes('cx5') || fullStr.includes('cx-50')) {
    return 'mazda-cx30';
  }
  if (fullStr.includes('duster') || fullStr.includes('oroch') || fullStr.includes('koleos') || fullStr.includes('ecosport') || fullStr.includes('escape') || body === 'suv' || body === 'crossover') {
    return 'renault-duster';
  }

  // 3. Sedanes
  if (fullStr.includes('mazda 3') || fullStr.includes('mazda3') || fullStr.includes('mazda 6') || (brand.includes('mazda') && body === 'sedan')) {
    return 'mazda-3';
  }
  if (fullStr.includes('logan') || fullStr.includes('symbol')) {
    return 'renault-logan';
  }
  if (fullStr.includes('sail')) {
    return 'chevrolet-sail';
  }
  if (fullStr.includes('onix sedan') || fullStr.includes('onix sedán') || fullStr.includes('onix plus') || fullStr.includes('prisma') || fullStr.includes('cobalt')) {
    return 'chevrolet-onix-sedan';
  }
  if (fullStr.includes('versa') || fullStr.includes('tiida') || fullStr.includes('sentra')) {
    return 'nissan-versa';
  }
  if (fullStr.includes('corolla') || (brand.includes('toyota') && (fullStr.includes('yaris') && body === 'sedan'))) {
    return 'toyota-corolla';
  }
  if (fullStr.includes('aveo') || fullStr.includes('optra')) {
    return 'chevrolet-aveo';
  }
  if (fullStr.includes('accent') || fullStr.includes('verna') || fullStr.includes('soluto') || (fullStr.includes('rio') && body === 'sedan')) {
    return 'hyundai-accent';
  }
  if (body === 'sedan') {
    return 'mazda-3';
  }

  // 4. Hatchbacks
  if (fullStr.includes('picanto') || fullStr.includes('alto') || fullStr.includes('celerio') || fullStr.includes('spresso') || fullStr.includes('i10') || fullStr.includes('atos') || fullStr.includes('mobi') || fullStr.includes('uno') || fullStr.includes('picanto-2017')) {
    return 'kia-picanto';
  }
  if (fullStr.includes('spark') || fullStr.includes('beat')) {
    return 'chevrolet-spark-gt';
  }
  if (fullStr.includes('kwid')) {
    return 'renault-kwid';
  }
  if (fullStr.includes('twingo')) {
    return 'renault-twingo';
  }
  if (fullStr.includes('mazda 2') || fullStr.includes('mazda2') || fullStr.includes('demio')) {
    return 'mazda-2-hatch';
  }
  if (fullStr.includes('swift') || fullStr.includes('dzire')) {
    return 'suzuki-swift';
  }
  if (fullStr.includes('sandero') || fullStr.includes('stepway') || fullStr.includes('clio')) {
    return 'renault-sandero';
  }
  if (fullStr.includes('onix')) {
    return 'chevrolet-onix-hatch';
  }
  if (fullStr.includes('gol') || fullStr.includes('polo') || fullStr.includes('fox') || fullStr.includes('up') || fullStr.includes('generic-hatch')) {
    return 'volkswagen-gol';
  }
  if (fullStr.includes('march') || fullStr.includes('micra')) {
    return 'nissan-march';
  }

  // Hatchback generic fallback
  if (body === 'hatchback-micro') return 'kia-picanto';
  if (body === 'hatchback') return 'mazda-2-hatch';

  return 'kia-picanto';
}

/**
 * Returns clean brand + model title avoiding duplicate brand names (e.g., 'Mazda 2' instead of 'Mazda Mazda 2').
 * @param {Object} vehicle 
 * @returns {string}
 */
export function formatVehicleTitle(vehicle) {
  if (!vehicle) return '';
  const brand = (vehicle.brand || '').trim();
  const model = (vehicle.model || '').trim();
  if (model.toLowerCase().startsWith(brand.toLowerCase())) {
    return model;
  }
  return `${brand} ${model}`;
}

/**
 * Returns formatted full title with trim engine (e.g., 'Kia Picanto 1.0L MPI 3-Cil (68 HP)').
 * @param {Object} vehicle 
 * @returns {string}
 */
export function formatVehicleFullName(vehicle) {
  if (!vehicle) return '';
  const title = formatVehicleTitle(vehicle);
  const trim = (vehicle.trim_engine || '').trim();
  return trim ? `${title} ${trim}` : title;
}

/**
 * Short technical badge for fuel gauge style.
 * @param {string} style 
 * @returns {string}
 */
export function getGaugeBadge(style) {
  switch (style) {
    case 'analog-180': return '180°';
    case 'digital-lcd': return 'LCD';
    case 'sight-glass': return 'FLUID';
    case 'spicy-arc':
    default: return 'ARC';
  }
}

/**
 * Normalizes text removing diacritics / accents and lowercasing.
 * @param {string} str 
 * @returns {string}
 */
function normalizeStr(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Searches the Colombia fleet database using multi-token matching and weighted scoring.
 * @param {string} query 
 * @param {Array<Object>} [fleet] 
 * @param {number} [limit=8] 
 * @returns {Array<Object>}
 */
export function searchColombiaVehicles(query, fleet = colombiaFleetData, limit = 8) {
  if (!query || typeof query !== 'string') return [];
  const qClean = normalizeStr(query.trim());
  if (!qClean) return [];

  const tokens = qClean.split(/\s+/).filter(Boolean);
  const scored = [];

  for (const v of fleet) {
    const brandClean = normalizeStr(v.brand);
    const modelClean = normalizeStr(v.model);
    const trimClean = normalizeStr(v.trim_engine);
    const titleClean = normalizeStr(formatVehicleTitle(v));
    const fullText = `${titleClean} ${brandClean} ${modelClean} ${trimClean} ${v.generation_years || ''} ${v.body_type || ''} ${(v.platform_tags || []).join(' ')}`.toLowerCase();

    // All tokens must be present in the vehicle text
    const matchesAll = tokens.every(token => fullText.includes(token));
    if (!matchesAll) continue;

    let score = 0;

    // Exact or prefix matches on full title or model
    if (titleClean === qClean || modelClean === qClean) {
      score += 1000;
    } else if (titleClean.startsWith(qClean) || modelClean.startsWith(qClean)) {
      score += 600;
    } else if (titleClean.includes(qClean) || modelClean.includes(qClean)) {
      score += 400;
    }

    // Weight individual tokens
    for (const t of tokens) {
      if (modelClean.includes(t)) score += 90;
      if (brandClean.includes(t)) score += 50;
      if (trimClean.includes(t)) score += 20;
    }

    // Boost platform tagged vehicles slightly (popular for rides/daily)
    if (v.platform_tags && v.platform_tags.length > 0) {
      score += 5;
    }

    scored.push({ vehicle: v, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(item => item.vehicle);
}

/**
 * Escapes HTML characters for safe template interpolation.
 * @param {string} str 
 * @returns {string}
 */
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Renders the Terminal Autocomplete Vehicle Search Box into the given container.
 * 
 * @param {HTMLElement} container 
 * @param {Object} options 
 * @param {string} [options.idPrefix='octane']
 * @param {string} [options.placeholder]
 * @param {string} [options.initialValue='']
 * @param {Function} [options.onSelect] Callback with vehicle data
 * @param {Function} [options.onClear] Callback when cleared
 * @returns {Object} Search box controller instance
 */
export function renderVehicleSearchBox(container, options = {}) {
  const idPrefix = options.idPrefix || 'octane';
  const placeholder = options.placeholder || 'Buscar por marca o modelo (Picanto, Spark, Logan...)';
  const initialValue = options.initialValue || '';
  const onSelect = typeof options.onSelect === 'function' ? options.onSelect : () => {};
  const onClear = typeof options.onClear === 'function' ? options.onClear : () => {};
  const hideLabel = Boolean(options.hideLabel);
  const hideSelectedStrip = Boolean(options.hideSelectedStrip);

  container.innerHTML = `
    <div class="vehicle-search-box w-full font-mono text-[10px] space-y-1.5 relative select-none">
      
      <!-- Top Micro Label Bar (Optional) -->
      ${hideLabel ? '' : `
      <div class="flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-[var(--text-secondary)]">
        <div class="flex items-center gap-1.5">
          <span class="w-1.5 h-1.5 bg-[var(--accent-volt)]"></span>
          <span class="font-medium text-[var(--text-secondary)]">BUSCADOR DE VEHÍCULO</span>
        </div>
      </div>
      `}

      <!-- Terminal Input Frame -->
      <div class="relative flex items-center bg-[var(--bg-void)] border border-[var(--line-hair)] hover:border-[var(--line-strong)] focus-within:border-[var(--accent-amber)] rounded-sm transition-all">
        <span class="pl-3 text-[var(--accent-volt)] font-bold select-none text-[11px]">&gt;</span>
        <input
          type="text"
          id="${idPrefix}-veh-search-input"
          class="w-full bg-transparent px-2.5 py-2 text-[11px] font-mono text-[var(--text-primary)] placeholder-[var(--text-secondary)]/50 focus:outline-none"
          placeholder="${placeholder}"
          autocomplete="off"
          spellcheck="false"
          value="${escapeHtml(initialValue)}"
        />
        <div class="flex items-center gap-1 pr-2">
          <button
            type="button"
            id="${idPrefix}-veh-search-clear"
            class="${initialValue ? '' : 'hidden '}h-5 w-5 rounded-sm flat-pill flex items-center justify-center text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--line-strong)] cursor-pointer"
            title="Limpiar búsqueda"
          >
            ✕
          </button>
        </div>
      </div>

      <!-- Selected Active Confirmation Strip (Optional) -->
      ${hideSelectedStrip ? '' : `
      <div id="${idPrefix}-veh-selected-strip" class="hidden flex items-center justify-between px-2.5 py-1.5 bg-[var(--bg-elevated)] border border-[var(--accent-amber)]/40 rounded-sm text-[9px]">
        <div class="flex items-center gap-1.5 truncate">
          <span class="w-1.5 h-1.5 bg-[var(--accent-volt)] flex-shrink-0"></span>
          <span class="text-[var(--text-secondary)] uppercase">ACTIVO:</span>
          <span id="${idPrefix}-veh-selected-title" class="font-bold text-[var(--accent-amber)] truncate"></span>
        </div>
        <div id="${idPrefix}-veh-selected-meta" class="flex items-center gap-2 flex-shrink-0 tabular-nums text-[var(--text-secondary)]"></div>
      </div>
      `}

      <!-- Autocomplete Dropdown List -->
      <div
        id="${idPrefix}-veh-dropdown"
        class="hidden absolute left-0 right-0 top-full mt-1 z-40 bg-[var(--bg-surface)] border border-[var(--line-strong)] rounded-sm shadow-2xl max-h-64 overflow-y-auto divide-y divide-[var(--line-hair)] font-mono text-[10px]"
      ></div>

    </div>
  `;

  const inputEl = container.querySelector(`#${idPrefix}-veh-search-input`);
  const clearBtn = container.querySelector(`#${idPrefix}-veh-search-clear`);
  const dropdownEl = container.querySelector(`#${idPrefix}-veh-dropdown`);
  const selectedStrip = container.querySelector(`#${idPrefix}-veh-selected-strip`);
  const selectedTitle = container.querySelector(`#${idPrefix}-veh-selected-title`);
  const selectedMeta = container.querySelector(`#${idPrefix}-veh-selected-meta`);

  let currentResults = [];
  let activeIndex = -1;

  function showDropdown(results) {
    currentResults = results;
    activeIndex = -1;

    if (!results || results.length === 0) {
      dropdownEl.innerHTML = `
        <div class="p-3 text-[10px] text-[var(--text-secondary)] uppercase tracking-wider text-center border border-dashed border-[var(--line-hair)] m-2 select-none">
          SIN COINCIDENCIAS // ESCRIBE MARCA O MODELO (EJ: PICANTO, SPARK, LOGAN)
        </div>
      `;
      dropdownEl.classList.remove('hidden');
      return;
    }

    dropdownEl.innerHTML = results.map((v, idx) => {
      const title = formatVehicleTitle(v);
      const gaugeBadge = getGaugeBadge(v.default_gauge_style);
      const isHybrid = (v.fuel_type || '').includes('Híbrido');
      const isTaxi = (v.platform_tags || []).includes('Taxi');

      return `
        <div
          data-index="${idx}"
          class="veh-result-row cursor-pointer px-3 py-2 flex items-center justify-between gap-3 hover:bg-[var(--bg-elevated)] transition-colors select-none"
        >
          <div class="flex items-center gap-2 overflow-hidden">
            <span class="w-1.5 h-1.5 flex-shrink-0 ${isHybrid ? 'bg-[var(--accent-cyan)]' : (isTaxi ? 'bg-[var(--accent-volt)]' : 'bg-[var(--accent-amber)]')}"></span>
            <div class="truncate">
              <span class="font-bold text-[var(--text-primary)]">${escapeHtml(title.toUpperCase())}</span>
              <span class="text-[var(--text-secondary)] ml-1">${escapeHtml(v.trim_engine || '')}</span>
              <span class="text-[9px] text-[var(--text-secondary)] ml-1 tracking-wider">[${v.generation_years || ''} · ${v.transmission || 'MT'}]</span>
            </div>
          </div>
          <div class="flex items-center gap-2 flex-shrink-0 text-right">
            <span class="text-[var(--accent-amber)] font-bold tabular-nums">
              ${v.tank_capacity_liters}L
              <span class="text-[9px] font-normal text-[var(--text-secondary)]">(${v.tank_capacity_gallons}G)</span>
            </span>
            <span class="text-[9px] px-1.5 py-0.5 border border-[var(--line-hair)] uppercase text-[var(--text-secondary)]">
              ${gaugeBadge}
            </span>
          </div>
        </div>
      `;
    }).join('');

    dropdownEl.querySelectorAll('.veh-result-row').forEach(row => {
      row.addEventListener('click', () => {
        const idx = parseInt(row.dataset.index, 10);
        if (currentResults[idx]) {
          selectVehicle(currentResults[idx]);
        }
      });
    });

    dropdownEl.classList.remove('hidden');
  }

  function hideDropdown() {
    dropdownEl.classList.add('hidden');
    dropdownEl.innerHTML = '';
    currentResults = [];
    activeIndex = -1;
  }

  function highlightRow(index) {
    const rows = dropdownEl.querySelectorAll('.veh-result-row');
    rows.forEach((row, i) => {
      if (i === index) {
        row.classList.add('bg-[var(--bg-elevated)]', 'border-l-2', 'border-[var(--accent-amber)]');
        row.scrollIntoView({ block: 'nearest' });
      } else {
        row.classList.remove('bg-[var(--bg-elevated)]', 'border-l-2', 'border-[var(--accent-amber)]');
      }
    });
  }

  function selectVehicle(vehicle) {
    if (!vehicle) return;

    playHorologyTick(1400, 0.02, 0.04);

    const fullName = formatVehicleFullName(vehicle);
    inputEl.value = fullName;
    clearBtn.classList.remove('hidden');

    // Update active strip if present
    const title = formatVehicleTitle(vehicle);
    if (selectedTitle) selectedTitle.innerText = title;
    if (selectedMeta) {
      selectedMeta.innerHTML = `
        <span class="text-[var(--accent-amber)] font-bold">${vehicle.tank_capacity_liters}L (${vehicle.tank_capacity_gallons}G)</span>
        <span>·</span>
        <span>RES ${vehicle.reserve_liters_est}L</span>
        <span>·</span>
        <span class="uppercase text-[var(--text-primary)]">${getGaugeBadge(vehicle.default_gauge_style)}</span>
      `;
    }
    if (selectedStrip) selectedStrip.classList.remove('hidden');

    hideDropdown();

    const resultData = {
      name: fullName,
      vehicleName: fullName,
      brand: vehicle.brand,
      model: vehicle.model,
      trimEngine: vehicle.trim_engine,
      tankCapacityLiters: Number(vehicle.tank_capacity_liters),
      tankCapacityGallons: Number(vehicle.tank_capacity_gallons),
      reserveLiters: Number(vehicle.reserve_liters_est),
      gaugeStyle: vehicle.default_gauge_style || 'spicy-arc',
      svgModel: mapBodySilhouette(vehicle),
      svgPath: `/src/assets/vehicles-svg/models/${mapBodySilhouette(vehicle)}.svg`,
      bodyType: vehicle.body_type,
      fuelType: vehicle.fuel_type,
      transmission: vehicle.transmission,
      generationYears: vehicle.generation_years,
      urbanConsumptionRef: vehicle.urban_consumption_ref_kmgal,
      raw: vehicle
    };

    onSelect(resultData);

    // Global event notification
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('octane:vehicle-selected', { detail: resultData }));
    }
  }

  // Input event handler for ultrafast search
  inputEl.addEventListener('input', () => {
    const q = inputEl.value;
    if (q.trim()) {
      clearBtn.classList.remove('hidden');
      const results = searchColombiaVehicles(q);
      showDropdown(results);
    } else {
      clearBtn.classList.add('hidden');
      hideDropdown();
      if (selectedStrip) selectedStrip.classList.add('hidden');
      onClear();
    }
  });

  // Focus event handler to show results or top models if empty
  inputEl.addEventListener('focus', () => {
    const q = inputEl.value.trim();
    if (q) {
      const results = searchColombiaVehicles(q);
      showDropdown(results);
    }
  });

  // Keyboard navigation
  inputEl.addEventListener('keydown', (e) => {
    if (dropdownEl.classList.contains('hidden') || currentResults.length === 0) {
      if (e.key === 'ArrowDown') {
        const q = inputEl.value.trim();
        const results = searchColombiaVehicles(q || 'Kia');
        showDropdown(results);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % currentResults.length;
      highlightRow(activeIndex);
      playHorologyTick(1100, 0.008, 0.015);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = (activeIndex - 1 + currentResults.length) % currentResults.length;
      highlightRow(activeIndex);
      playHorologyTick(1100, 0.008, 0.015);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && currentResults[activeIndex]) {
        selectVehicle(currentResults[activeIndex]);
      } else if (currentResults.length > 0) {
        selectVehicle(currentResults[0]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      hideDropdown();
    }
  });

  // Clear button click
  clearBtn.addEventListener('click', () => {
    playHorologyTick(900, 0.01, 0.02);
    inputEl.value = '';
    clearBtn.classList.add('hidden');
    selectedStrip.classList.add('hidden');
    hideDropdown();
    inputEl.focus();
    onClear();
  });

  // Close dropdown on outside click
  const documentClickHandler = (e) => {
    if (!container.contains(e.target)) {
      hideDropdown();
    }
  };
  document.addEventListener('click', documentClickHandler);

  return {
    selectVehicle,
    setValue: (val) => {
      inputEl.value = val || '';
      if (val) clearBtn.classList.remove('hidden');
      else clearBtn.classList.add('hidden');
    },
    destroy: () => {
      document.removeEventListener('click', documentClickHandler);
    }
  };
}
