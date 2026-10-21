/**
 * OCTANE // KINETIC — Adversarial Geometric Validator & SVG Gallery Generator
 * 
 * Subagente Crítico Adversario:
 * 1. Inspects every vehicle SVG in `src/assets/vehicles-svg/models/`
 * 2. Checks strict mathematical constraints:
 *    - viewBox="0 0 800 280"
 *    - Ground contact at Y=250 (cy + r in [246, 250])
 *    - Body path arcs 'A' centered over wheel coordinates cx1 and cx2
 *    - Car paint variable fill="var(--car-paint, #FF5500)" without circular CSS bugs
 *    - Required 6 elements present (ground, body, highlight, window+B-pillar, headlight, taillight, 2 wheels)
 * 3. Builds `svg-gallery.html` with interactive palette & telemetry inspection HUD.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const MODELS_DIR = path.join(ROOT_DIR, 'src/assets/vehicles-svg/models');
const GALLERY_PATH = path.join(ROOT_DIR, 'svg-gallery.html');

const REQUIRED_FILES = [
  // 10 Hatchbacks
  'kia-picanto.svg',
  'chevrolet-spark-gt.svg',
  'renault-kwid.svg',
  'renault-twingo.svg',
  'mazda-2-hatch.svg',
  'suzuki-swift.svg',
  'renault-sandero.svg',
  'chevrolet-onix-hatch.svg',
  'volkswagen-gol.svg',
  'nissan-march.svg',
  // 8 Sedanes
  'mazda-3.svg',
  'renault-logan.svg',
  'chevrolet-sail.svg',
  'chevrolet-onix-sedan.svg',
  'nissan-versa.svg',
  'toyota-corolla.svg',
  'chevrolet-aveo.svg',
  'hyundai-accent.svg',
  // 10 SUVs & Pickups
  'renault-duster.svg',
  'mazda-cx30.svg',
  'chevrolet-tracker.svg',
  'suzuki-vitara.svg',
  'kia-sportage.svg',
  'toyota-fortuner.svg',
  'toyota-prado.svg',
  'toyota-hilux.svg',
  'nissan-frontier.svg',
  'toyota-tundra.svg'
];

console.log('--- STARTING ADVERSARIAL GEOMETRIC VALIDATION ---');
let errors = 0;
let validatedModels = [];

for (const filename of REQUIRED_FILES) {
  const filePath = path.join(MODELS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    console.error(`❌ MISSING FILE: ${filename}`);
    errors++;
    continue;
  }

  const content = fs.readFileSync(filePath, 'utf8');

  // 1. viewBox verification
  if (!content.includes('viewBox="0 0 800 280"')) {
    console.error(`❌ ${filename}: Invalid or missing viewBox="0 0 800 280"`);
    errors++;
  }

  // 2. Car paint variable verification
  if (!content.includes('fill="var(--car-paint, #FF5500)"')) {
    console.error(`❌ ${filename}: Missing fill="var(--car-paint, #FF5500)" on body or wheels`);
    errors++;
  }

  // 3. Prohibit circular CSS reference
  if (content.includes('style="--car-paint: var(--car-paint)"') || content.includes('--car-paint: var(--car-paint)')) {
    console.error(`❌ ${filename}: PROHIBITED circular CSS reference detected`);
    errors++;
  }

  // 4. Ground datum line verification at Y=250
  if (!content.includes('y1="250"') || !content.includes('y2="250"')) {
    console.error(`❌ ${filename}: Ground line at Y=250 missing`);
    errors++;
  }

  // 5. Wheel extraction & Ground contact check (cy + r ≈ 248-250)
  const wheelRegex = /<g\s+transform="translate\(\s*(\d+)\s*,\s*(\d+)\s*\)"[\s\S]*?<circle\s+r="(\d+)"/g;
  const wheels = [];
  let match;
  while ((match = wheelRegex.exec(content)) !== null) {
    wheels.push({
      cx: parseInt(match[1], 10),
      cy: parseInt(match[2], 10),
      r: parseInt(match[3], 10)
    });
  }

  if (wheels.length < 2) {
    console.error(`❌ ${filename}: Expected at least 2 wheels, found ${wheels.length}`);
    errors++;
  } else {
    for (const [idx, w] of wheels.entries()) {
      const bottom = w.cy + w.r;
      if (bottom < 246 || bottom > 250) {
        console.error(`❌ ${filename}: Wheel #${idx + 1} at (${w.cx}, ${w.cy}) r=${w.r} has bottom=${bottom}, out of tolerance [246, 250]`);
        errors++;
      }
    }
  }

  // 6. Wheel Arches 'A' centering verification
  // Match path d containing arcs like: L (startX) (startY) A (rx) (ry) 0 0 0 (endX) (endY)
  // or L 602 218 A 48 48 0 0 0 508 218
  const archRegex = /L\s+(\d+)\s+\d+\s+A\s+(\d+)\s+\d+\s+0\s+0\s+0\s+(\d+)\s+\d+/g;
  const arches = [];
  let archMatch;
  while ((archMatch = archRegex.exec(content)) !== null) {
    arches.push({
      startX: parseInt(archMatch[1], 10),
      rx: parseInt(archMatch[2], 10),
      endX: parseInt(archMatch[3], 10),
      center: (parseInt(archMatch[1], 10) + parseInt(archMatch[3], 10)) / 2
    });
  }

  if (arches.length >= 2 && wheels.length >= 2) {
    // Rear arch is first in path (going counter-clockwise from rear to front)
    const rearArch = arches[0];
    const frontArch = arches[1];
    const rearWheel = wheels[1];
    const frontWheel = wheels[0];

    const rearDelta = Math.abs(rearArch.center - rearWheel.cx);
    const frontDelta = Math.abs(frontArch.center - frontWheel.cx);

    if (rearDelta > 1) {
      console.error(`❌ ${filename}: Rear wheel arch center (${rearArch.center}) does not match rear wheel cx (${rearWheel.cx}) delta=${rearDelta}`);
      errors++;
    }
    if (frontDelta > 1) {
      console.error(`❌ ${filename}: Front wheel arch center (${frontArch.center}) does not match front wheel cx (${frontWheel.cx}) delta=${frontDelta}`);
      errors++;
    }
  }

  // 7. Check greenhouse and lights
  if (!content.includes('fill="#111116"')) {
    console.error(`❌ ${filename}: Greenhouse fill="#111116" missing`);
    errors++;
  }
  if (!content.includes('fill="#F8FAFC"')) {
    console.error(`❌ ${filename}: Headlight fill="#F8FAFC" missing`);
    errors++;
  }
  if (!content.includes('fill="#F43F5E"')) {
    console.error(`❌ ${filename}: Taillight fill="#F43F5E" missing`);
    errors++;
  }
  if (!content.includes('stroke-opacity="0.28"')) {
    console.error(`❌ ${filename}: Highlight stroke-opacity="0.28" missing`);
    errors++;
  }

  validatedModels.push({
    filename,
    id: filename.replace('.svg', ''),
    wheels,
    svgContent: content
  });
}

console.log(`\nAdversarial QA check completed: ${errors === 0 ? 'ALL CHECKS PASSED ✓' : `${errors} ERRORS FOUND ✗`}`);

if (errors > 0) {
  process.exit(1);
}

// ==========================================
// BUILD svg-gallery.html
// ==========================================
console.log('Generating interactive svg-gallery.html...');

const galleryHtml = `<!DOCTYPE html>
<html lang="es" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OCTANE // KINETIC — Galería de Siluetas de Vehículos (28 Modelos)</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    :root {
      --car-paint: #FF5500;
      --bg-void: #09090B;
      --bg-surface: #121216;
      --bg-elevated: #18181E;
      --line-hair: #27272A;
      --line-strong: #3F3F46;
      --text-primary: #FAFAFA;
      --text-secondary: #A1A1AA;
      --accent-amber: #FF5500;
    }
    body {
      background-color: var(--bg-void);
      color: var(--text-primary);
      font-family: 'Plus Jakarta Sans', sans-serif;
    }
    .font-mono {
      font-family: 'JetBrains Mono', monospace;
    }
    .grid-bg {
      background-image: linear-gradient(to right, rgba(255, 255, 255, 0.03) 1px, transparent 1px),
                        linear-gradient(to bottom, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
      background-size: 20px 20px;
    }
    .hud-line {
      position: absolute;
      left: 0;
      right: 0;
      pointer-events: none;
      display: none;
    }
    .show-hud .hud-line {
      display: block;
    }
  </style>
</head>
<body class="min-h-screen p-4 sm:p-8 grid-bg">
  <header class="max-w-7xl mx-auto border-b border-[var(--line-hair)] pb-6 mb-8 flex flex-col md:flex-row md:items-end justify-between gap-6">
    <div>
      <div class="flex items-center gap-3 mb-2">
        <span class="w-2.5 h-2.5 rounded-full bg-[var(--accent-amber)] animate-pulse"></span>
        <span class="font-mono text-xs uppercase tracking-[0.25em] text-[var(--accent-amber)]">OCTANE // KINETIC BLUEPRINT LAB</span>
      </div>
      <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-[var(--text-primary)]">Librería de Siluetas Geométricas</h1>
      <p class="font-mono text-xs text-[var(--text-secondary)] mt-1">28 Modelos Canónicos de Colombia · Estilo "Bold Industrial Silhouette" · viewBox 0 0 800 280</p>
    </div>

    <!-- Color Switcher & Telemetry HUD Controls -->
    <div class="flex flex-wrap items-center gap-4 bg-[var(--bg-surface)] p-3 border border-[var(--line-hair)] rounded-md font-mono text-xs">
      <div class="flex items-center gap-2">
        <span class="text-[var(--text-secondary)] uppercase">PINTURA:</span>
        <input type="color" id="colorPicker" value="#FF5500" class="w-7 h-7 bg-transparent border-0 cursor-pointer rounded">
      </div>

      <!-- Quick Preset Swatches -->
      <div class="flex items-center gap-1.5 border-x border-[var(--line-hair)] px-3">
        <button class="w-5 h-5 rounded-full border border-black/40 hover:scale-110 transition-transform" style="background-color: #FF5500" title="Classic Orange" onclick="setColor('#FF5500')"></button>
        <button class="w-5 h-5 rounded-full border border-black/40 hover:scale-110 transition-transform" style="background-color: #10B981" title="Volt Neon" onclick="setColor('#10B981')"></button>
        <button class="w-5 h-5 rounded-full border border-black/40 hover:scale-110 transition-transform" style="background-color: #F59E0B" title="Amber" onclick="setColor('#F59E0B')"></button>
        <button class="w-5 h-5 rounded-full border border-black/40 hover:scale-110 transition-transform" style="background-color: #EF4444" title="Crimson" onclick="setColor('#EF4444')"></button>
        <button class="w-5 h-5 rounded-full border border-black/40 hover:scale-110 transition-transform" style="background-color: #06B6D4" title="Electric Cyan" onclick="setColor('#06B6D4')"></button>
        <button class="w-5 h-5 rounded-full border border-black/40 hover:scale-110 transition-transform" style="background-color: #F8FAFC" title="Pure White" onclick="setColor('#F8FAFC')"></button>
        <button class="w-5 h-5 rounded-full border border-black/40 hover:scale-110 transition-transform" style="background-color: #64748B" title="Slate Carbon" onclick="setColor('#64748B')"></button>
      </div>

      <!-- Laser HUD Alignment Toggle -->
      <label class="flex items-center gap-2 cursor-pointer select-none">
        <input type="checkbox" id="hudToggle" class="accent-[var(--accent-amber)]" onchange="toggleHud(this.checked)">
        <span class="text-[var(--text-secondary)]">LÁSER GUÍA (Y=250)</span>
      </label>
    </div>
  </header>

  <!-- Segment Filter Buttons -->
  <div class="max-w-7xl mx-auto flex items-center gap-2 mb-6 font-mono text-xs overflow-x-auto pb-2">
    <button class="filter-btn px-3 py-1.5 border border-[var(--accent-amber)] bg-[var(--bg-elevated)] text-[var(--accent-amber)] rounded-sm" onclick="filterSegment('all', this)">TODOS (28)</button>
    <button class="filter-btn px-3 py-1.5 border border-[var(--line-hair)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-white rounded-sm" onclick="filterSegment('hatchback', this)">HATCHBACKS (10)</button>
    <button class="filter-btn px-3 py-1.5 border border-[var(--line-hair)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-white rounded-sm" onclick="filterSegment('sedan', this)">SEDANES (8)</button>
    <button class="filter-btn px-3 py-1.5 border border-[var(--line-hair)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-white rounded-sm" onclick="filterSegment('suv-pickup', this)">SUVS & PICKUPS (10)</button>
  </div>

  <!-- Models Grid -->
  <main class="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6" id="modelsGrid">
${validatedModels.map(m => {
  let segment = 'hatchback';
  let badge = 'CITY HATCH';
  if (['mazda-2-hatch', 'suzuki-swift', 'renault-sandero', 'chevrolet-onix-hatch', 'volkswagen-gol'].includes(m.id)) {
    segment = 'hatchback';
    badge = 'COMPACT HATCH';
  } else if (['mazda-3', 'renault-logan', 'chevrolet-sail', 'chevrolet-onix-sedan', 'nissan-versa', 'toyota-corolla', 'chevrolet-aveo', 'hyundai-accent'].includes(m.id)) {
    segment = 'sedan';
    badge = 'SEDÁN';
  } else if (['toyota-hilux', 'nissan-frontier', 'toyota-tundra'].includes(m.id)) {
    segment = 'suv-pickup';
    badge = 'PICKUP';
  } else if (['renault-duster', 'mazda-cx30', 'chevrolet-tracker', 'suzuki-vitara', 'kia-sportage', 'toyota-fortuner', 'toyota-prado'].includes(m.id)) {
    segment = 'suv-pickup';
    badge = 'SUV';
  }

  const cleanName = m.id.split('-').map(s => s.toUpperCase()).join(' ');

  return `    <div class="model-card bg-[var(--bg-surface)] border border-[var(--line-hair)] hover:border-[var(--line-strong)] rounded-md p-5 flex flex-col justify-between transition-all" data-segment="${segment}">
      <div class="flex items-center justify-between border-b border-[var(--line-hair)] pb-3 mb-4 font-mono text-xs">
        <div>
          <span class="font-bold text-[var(--text-primary)] tracking-wide">${cleanName}</span>
          <span class="text-[var(--text-secondary)] ml-2 text-[10px]">${m.filename}</span>
        </div>
        <span class="px-2 py-0.5 rounded bg-[var(--bg-elevated)] border border-[var(--line-hair)] text-[10px] text-[var(--accent-amber)] font-semibold uppercase tracking-wider">${badge}</span>
      </div>

      <!-- SVG Stage Container with Alignment Laser Guide -->
      <div class="relative w-full aspect-[800/280] bg-[var(--bg-void)] border border-[var(--line-hair)] rounded overflow-hidden flex items-center justify-center p-2">
        <div class="hud-line border-b border-red-500/80 z-20" style="top: calc(250 / 280 * 100%);"></div>
        <div class="w-full h-full flex items-center justify-center">
          ${m.svgContent}
        </div>
      </div>

      <!-- Technical Telemetry Footer -->
      <div class="flex items-center justify-between font-mono text-[10px] text-[var(--text-secondary)] pt-3 mt-3 border-t border-[var(--line-hair)]">
        <span>RUEDAS: CX [${m.wheels.map(w => w.cx).join(', ')}] · CY ${m.wheels[0]?.cy || 204}</span>
        <span class="text-emerald-400 font-medium">SUELO Y=250 ✓</span>
      </div>
    </div>`;
}).join('\n')}
  </main>

  <footer class="max-w-7xl mx-auto border-t border-[var(--line-hair)] pt-6 mt-12 text-center font-mono text-xs text-[var(--text-secondary)]">
    OCTANE // KINETIC VECTOR AUTOMOTIVE BLUEPRINTS · VERIFICACIÓN MATEMÁTICA AUTOMATIZADA
  </footer>

  <script>
    function setColor(color) {
      document.documentElement.style.setProperty('--car-paint', color);
      document.getElementById('colorPicker').value = color;
    }

    document.getElementById('colorPicker').addEventListener('input', (e) => {
      setColor(e.target.value);
    });

    function toggleHud(enabled) {
      document.body.classList.toggle('show-hud', enabled);
    }

    function filterSegment(segment, btn) {
      document.querySelectorAll('.filter-btn').forEach(b => {
        b.className = 'filter-btn px-3 py-1.5 border border-[var(--line-hair)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-white rounded-sm';
      });
      btn.className = 'filter-btn px-3 py-1.5 border border-[var(--accent-amber)] bg-[var(--bg-elevated)] text-[var(--accent-amber)] rounded-sm';

      document.querySelectorAll('.model-card').forEach(card => {
        if (segment === 'all' || card.dataset.segment === segment) {
          card.style.display = 'flex';
        } else {
          card.style.display = 'none';
        }
      });
    }
  </script>
</body>
</html>
`;

fs.writeFileSync(GALLERY_PATH, galleryHtml, 'utf8');
console.log(`✓ svg-gallery.html created successfully at ${GALLERY_PATH}`);
