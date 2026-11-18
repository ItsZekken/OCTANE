/**
 * OCTANE // KINETIC — Master Geometric Vehicle SVG Generator
 * Generates 28 stylized vehicle silhouettes in "Bold Industrial Silhouette" style:
 * - 10 Hatchbacks
 * - 8 Sedans
 * - 10 SUVs & Pickups
 * 
 * Rules:
 * - viewBox="0 0 800 280" with ground at Y=250
 * - fill="var(--car-paint, #FF5500)" with stroke="#09090B" stroke-width="6" stroke-linejoin="round"
 * - Wheel contact at Y=250 (cy + r ≈ 248-250)
 * - Wheel arches A exactly centered on cx coordinates
 * - 6 canonical elements: ground line, body path, white highlight line, dark window with thick B-pillar,
 *   white headlight, crimson taillight, and two concentric wheels with car-paint center hubcap.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.resolve(__dirname, '../src/assets/vehicles-svg/models');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function renderWheel(cx, cy, rTire, rRim, spokeR, isOffRoad = false, wheelClass = 'vehicle-wheel') {
  const treadAttr = isOffRoad ? ' stroke-dasharray="14 6"' : '';
  return `  <g transform="translate(${cx}, ${cy})">
    <g class="${wheelClass}" style="transform-box: fill-box; transform-origin: center;">
      <circle r="${rTire}" fill="#141418" stroke="#09090B" stroke-width="6"${treadAttr}/>
      <circle r="${rRim}" fill="#09090B" stroke="#D4D4D8" stroke-width="5"/>
      <line x1="-${spokeR}" y1="0" x2="${spokeR}" y2="0" stroke="#D4D4D8" stroke-width="5"/>
      <line x1="0" y1="-${spokeR}" x2="0" y2="${spokeR}" stroke="#D4D4D8" stroke-width="5"/>
      <circle r="9" fill="var(--car-paint, #FF5500)" stroke="#09090B" stroke-width="4"/>
    </g>
  </g>`;
}

function buildSvg(v) {
  const {
    id,
    name,
    type,
    cx1,
    cx2,
    cy,
    rTire = 44,
    rRim = 27,
    spokeR = 24,
    shadowR = 50,
    groundLineX1 = 80,
    groundLineX2 = 720,
    contactX1 = 175,
    contactX2 = 625,
    bodyPath,
    highlightPath,
    windowPath,
    bPillar,
    headlightPath,
    taillightPath,
    extraElements = '',
    isOffRoad = false
  } = v;

  const svg = `<svg viewBox="0 0 800 280" class="w-full h-auto" xmlns="http://www.w3.org/2000/svg">
  <!-- Ground Datum & Contact Shadow (Y=250) -->
  <line x1="${groundLineX1}" y1="250" x2="${groundLineX2}" y2="250" stroke="#27272A" stroke-width="3" stroke-linecap="round"/>
  <line x1="${contactX1}" y1="250" x2="${contactX2}" y2="250" stroke="#000000" stroke-width="8" stroke-linecap="round"/>

  <!-- Wheel Arch Cutout Shadows -->
  <circle cx="${cx1}" cy="${cy}" r="${shadowR}" fill="#09090B"/>
  <circle cx="${cx2}" cy="${cy}" r="${shadowR}" fill="#09090B"/>

  <!-- Body Silhouette -->
  <path fill="var(--car-paint, #FF5500)" stroke="#09090B" stroke-width="6" stroke-linejoin="round" d="${bodyPath}"/>
${extraElements ? extraElements + '\n' : ''}  <!-- Roof Highlight Line -->
  <path d="${highlightPath}" fill="none" stroke="#FFFFFF" stroke-opacity="0.28" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>

  <!-- Greenhouse Glass & B-Pillar -->
  <path fill="#111116" stroke="#09090B" stroke-width="6" stroke-linejoin="round" d="${windowPath}"/>
  <line x1="${bPillar.x1}" y1="${bPillar.y1}" x2="${bPillar.x2}" y2="${bPillar.y2}" stroke="#09090B" stroke-width="${bPillar.width || 12}"/>

  <!-- Lighting: Front Headlight & Rear Stop -->
  <path d="${headlightPath}" fill="#F8FAFC" stroke="#09090B" stroke-width="4" stroke-linejoin="round"/>
  <path d="${taillightPath}" fill="#F43F5E" stroke="#09090B" stroke-width="5" stroke-linejoin="round"/>

  <!-- Front Wheel (Center: ${cx1}, ${cy}) -->
${renderWheel(cx1, cy, rTire, rRim, spokeR, isOffRoad, 'vehicle-wheel vehicle-wheel-front')}

  <!-- Rear Wheel (Center: ${cx2}, ${cy}) -->
${renderWheel(cx2, cy, rTire, rRim, spokeR, isOffRoad, 'vehicle-wheel vehicle-wheel-rear')}
</svg>
`;

  return svg;
}

export const VEHICLE_MODELS = [
  // ==========================================
  // HATCHBACKS (10 Models)
  // ==========================================
  {
    id: 'kia-picanto',
    name: 'Kia Picanto',
    type: 'hatchback',
    cx1: 255,
    cx2: 555,
    cy: 204,
    rTire: 44,
    rRim: 27,
    spokeR: 24,
    shadowR: 50,
    contactX1: 175,
    contactX2: 625,
    bodyPath: 'M 172 212 C 170 185, 178 160, 196 148 C 218 135, 248 128, 274 122 L 352 68 C 366 60, 382 58, 405 58 L 582 60 L 606 62 L 596 76 L 622 154 C 627 172, 628 194, 624 214 L 602 218 A 48 48 0 0 0 508 218 L 302 218 A 48 48 0 0 0 208 218 Z',
    highlightPath: 'M 200 148 C 222 136, 250 130, 274 124 L 354 70 L 580 64',
    windowPath: 'M 290 122 L 358 74 C 368 68, 382 67, 402 67 L 556 69 L 572 108 L 455 122 Z',
    bPillar: { x1: 436, y1: 68, x2: 432, y2: 122, width: 12 },
    headlightPath: 'M 182 162 L 222 148 L 214 166 Z',
    taillightPath: 'M 604 102 L 622 154 L 624 176 L 604 172 Z'
  },
  {
    id: 'chevrolet-spark-gt',
    name: 'Chevrolet Spark GT',
    type: 'hatchback',
    cx1: 255,
    cx2: 555,
    cy: 204,
    rTire: 44,
    rRim: 27,
    spokeR: 24,
    shadowR: 50,
    contactX1: 170,
    contactX2: 630,
    // Steep rising waistline, sharp wedge nose, rear window kicks up toward hidden vertical door handle, rear spoiler
    bodyPath: 'M 168 212 C 166 182, 175 156, 192 142 C 215 128, 252 124, 280 118 L 362 64 C 376 56, 394 56, 418 56 L 574 58 L 610 60 L 598 74 L 626 150 C 632 170, 630 196, 626 214 L 602 218 A 48 48 0 0 0 508 218 L 302 218 A 48 48 0 0 0 208 218 Z',
    highlightPath: 'M 195 142 C 220 128, 256 122, 282 118 L 364 66 L 572 60',
    windowPath: 'M 296 118 L 368 70 C 378 64, 392 64, 412 64 L 544 66 L 588 94 L 460 116 Z',
    bPillar: { x1: 442, y1: 65, x2: 438, y2: 118, width: 12 },
    // Long angular headlight sweeping up fender
    headlightPath: 'M 178 158 L 230 138 L 222 160 Z',
    taillightPath: 'M 606 100 L 626 148 L 628 174 L 608 168 Z'
  },
  {
    id: 'renault-kwid',
    name: 'Renault Kwid',
    type: 'hatchback',
    cx1: 255,
    cx2: 555,
    cy: 204,
    rTire: 44,
    rRim: 27,
    spokeR: 24,
    shadowR: 50,
    contactX1: 170,
    contactX2: 630,
    // "El SUV de los compactos": Higher squarer front nose (Y=134), boxy front rake, flatter roofline
    bodyPath: 'M 170 214 C 168 186, 172 162, 186 146 C 204 136, 238 132, 268 128 L 344 72 C 358 64, 378 62, 404 62 L 576 64 L 604 68 L 594 80 L 622 152 C 628 172, 628 196, 624 214 L 602 218 A 48 48 0 0 0 508 218 L 302 218 A 48 48 0 0 0 208 218 Z',
    highlightPath: 'M 188 146 C 206 136, 240 132, 270 128 L 346 74 L 574 66',
    windowPath: 'M 284 126 L 350 78 C 362 70, 380 69, 402 69 L 552 70 L 570 112 L 452 126 Z',
    bPillar: { x1: 434, y1: 70, x2: 430, y2: 126, width: 12 },
    headlightPath: 'M 176 156 L 218 144 L 212 164 Z',
    taillightPath: 'M 602 108 L 622 150 L 624 176 L 604 170 Z'
  },
  {
    id: 'renault-twingo',
    name: 'Renault Twingo',
    type: 'hatchback',
    cx1: 255,
    cx2: 555,
    cy: 204,
    rTire: 44,
    rRim: 27,
    spokeR: 24,
    shadowR: 50,
    contactX1: 175,
    contactX2: 625,
    // Iconic monovolume silhouette: continuous steep slope from front nose up through windshield into roof
    bodyPath: 'M 178 212 C 176 182, 186 154, 212 128 L 314 66 C 334 56, 362 54, 396 54 L 568 56 L 596 62 L 592 78 L 616 156 C 622 176, 622 196, 618 214 L 602 218 A 48 48 0 0 0 508 218 L 302 218 A 48 48 0 0 0 208 218 Z',
    highlightPath: 'M 214 128 L 316 68 C 336 58, 362 56, 398 56 L 566 58',
    // Large bubbly friendly window
    windowPath: 'M 252 118 L 324 72 C 342 63, 368 62, 398 62 L 544 64 L 566 112 L 440 120 Z',
    bPillar: { x1: 428, y1: 64, x2: 424, y2: 120, width: 12 },
    // Cute bubbly headlights
    headlightPath: 'M 190 148 C 206 138, 226 142, 226 156 C 226 166, 206 170, 192 162 Z',
    taillightPath: 'M 598 114 L 616 156 L 618 178 L 600 174 Z'
  },
  {
    id: 'mazda-2-hatch',
    name: 'Mazda 2 Hatchback',
    type: 'hatchback',
    cx1: 235,
    cx2: 575,
    cy: 203,
    rTire: 45,
    rRim: 28,
    spokeR: 25,
    shadowR: 51,
    contactX1: 150,
    contactX2: 650,
    // KODO design: long low sensual hood, cab-rearward stance, swept windshield, sloping roof into spoiler
    bodyPath: 'M 142 210 C 140 180, 150 152, 174 138 C 202 124, 250 118, 290 114 L 372 68 C 390 60, 412 58, 442 58 L 594 60 L 626 64 L 614 78 L 642 152 C 648 172, 648 196, 642 212 L 623 216 A 48 48 0 0 0 527 216 L 283 216 A 48 48 0 0 0 187 216 Z',
    highlightPath: 'M 176 138 C 204 124, 252 118, 292 114 L 374 70 L 592 64',
    windowPath: 'M 306 114 L 378 74 C 394 66, 414 65, 440 65 L 570 67 L 592 106 L 468 116 Z',
    bPillar: { x1: 454, y1: 66, x2: 448, y2: 116, width: 12 },
    headlightPath: 'M 152 154 L 202 138 L 194 158 Z',
    taillightPath: 'M 622 108 L 642 150 L 644 172 L 624 168 Z'
  },
  {
    id: 'suzuki-swift',
    name: 'Suzuki Swift',
    type: 'hatchback',
    cx1: 235,
    cx2: 575,
    cy: 203,
    rTire: 45,
    rRim: 28,
    spokeR: 25,
    shadowR: 51,
    contactX1: 155,
    contactX2: 645,
    // Iconic helmet roof: upright blacked-out A-pillar, flat floating roofline, muscular bulging fenders
    bodyPath: 'M 152 212 C 150 182, 160 156, 184 142 C 210 130, 254 126, 286 122 L 342 74 C 354 66, 372 64, 400 64 L 588 64 L 618 68 L 606 82 L 634 154 C 640 174, 638 196, 634 212 L 623 216 A 48 48 0 0 0 527 216 L 283 216 A 48 48 0 0 0 187 216 Z',
    highlightPath: 'M 186 142 C 212 130, 256 126, 288 122 L 344 76 L 586 68',
    windowPath: 'M 298 122 L 348 80 C 358 72, 374 71, 398 71 L 568 71 L 586 108 L 464 122 Z',
    bPillar: { x1: 444, y1: 71, x2: 440, y2: 122, width: 12 },
    headlightPath: 'M 164 156 L 210 142 L 204 162 Z',
    taillightPath: 'M 614 112 L 634 152 L 636 176 L 616 172 Z'
  },
  {
    id: 'renault-sandero',
    name: 'Renault Sandero',
    type: 'hatchback',
    cx1: 235,
    cx2: 575,
    cy: 203,
    rTire: 45,
    rRim: 28,
    spokeR: 25,
    shadowR: 51,
    contactX1: 150,
    contactX2: 650,
    // Robust European B-segment hatch: sturdy horizontal roofline, wide strong C-pillar, muscular squared stance
    bodyPath: 'M 146 212 C 144 182, 154 158, 178 144 C 204 132, 248 126, 282 122 L 358 70 C 374 62, 396 60, 424 60 L 588 62 L 618 66 L 606 80 L 636 154 C 642 174, 642 196, 638 212 L 623 216 A 48 48 0 0 0 527 216 L 283 216 A 48 48 0 0 0 187 216 Z',
    highlightPath: 'M 180 144 C 206 132, 250 126, 284 122 L 360 72 L 586 66',
    windowPath: 'M 294 122 L 364 76 C 378 68, 396 67, 420 67 L 562 68 L 580 110 L 460 122 Z',
    bPillar: { x1: 448, y1: 67, x2: 444, y2: 122, width: 12 },
    headlightPath: 'M 158 158 L 204 144 L 198 164 Z',
    taillightPath: 'M 616 110 L 636 152 L 638 176 L 618 172 Z'
  },
  {
    id: 'chevrolet-onix-hatch',
    name: 'Chevrolet Onix Hatchback',
    type: 'hatchback',
    cx1: 235,
    cx2: 575,
    cy: 203,
    rTire: 45,
    rRim: 28,
    spokeR: 25,
    shadowR: 51,
    contactX1: 150,
    contactX2: 650,
    // Sleek aerodynamic global hatch: low nose, dual-port grille angle, curved roof tapering into spoiler
    bodyPath: 'M 142 210 C 140 180, 150 152, 172 138 C 200 124, 246 118, 284 114 L 364 66 C 380 58, 404 56, 434 56 L 588 58 L 622 62 L 610 76 L 638 152 C 644 172, 644 196, 638 212 L 623 216 A 48 48 0 0 0 527 216 L 283 216 A 48 48 0 0 0 187 216 Z',
    highlightPath: 'M 174 138 C 202 124, 248 118, 286 114 L 366 68 L 586 62',
    windowPath: 'M 298 114 L 370 72 C 384 64, 404 63, 430 63 L 564 65 L 584 106 L 462 116 Z',
    bPillar: { x1: 450, y1: 64, x2: 444, y2: 116, width: 12 },
    headlightPath: 'M 152 154 L 198 138 L 192 158 Z',
    taillightPath: 'M 618 106 L 638 150 L 640 174 L 620 170 Z'
  },
  {
    id: 'volkswagen-gol',
    name: 'Volkswagen Gol',
    type: 'hatchback',
    cx1: 235,
    cx2: 575,
    cy: 203,
    rTire: 45,
    rRim: 28,
    spokeR: 25,
    shadowR: 51,
    contactX1: 150,
    contactX2: 650,
    // Teutonic horizontal lines: clean wedge beltline, sturdy trapezoidal C-pillar, balanced hood length
    bodyPath: 'M 144 212 C 142 182, 152 158, 176 144 C 204 132, 248 126, 284 122 L 360 70 C 376 62, 398 60, 426 60 L 586 62 L 616 66 L 604 80 L 634 154 C 640 174, 640 196, 636 212 L 623 216 A 48 48 0 0 0 527 216 L 283 216 A 48 48 0 0 0 187 216 Z',
    highlightPath: 'M 178 144 C 206 132, 250 126, 286 122 L 362 72 L 584 66',
    windowPath: 'M 296 122 L 366 76 C 380 68, 398 67, 422 67 L 558 68 L 576 110 L 458 122 Z',
    bPillar: { x1: 446, y1: 67, x2: 442, y2: 122, width: 12 },
    headlightPath: 'M 156 158 L 202 144 L 196 164 Z',
    taillightPath: 'M 614 110 L 634 152 L 636 176 L 616 172 Z'
  },
  {
    id: 'nissan-march',
    name: 'Nissan March',
    type: 'hatchback',
    cx1: 255,
    cx2: 555,
    cy: 204,
    rTire: 44,
    rRim: 27,
    spokeR: 24,
    shadowR: 50,
    contactX1: 175,
    contactX2: 625,
    // Iconic bubble dome roof: arch peaking above front seats and curving down, round friendly nose
    bodyPath: 'M 174 212 C 172 184, 180 158, 200 144 C 224 130, 256 124, 282 118 L 354 62 C 374 54, 400 52, 432 54 C 484 56, 542 64, 584 72 L 610 76 L 600 88 L 624 154 C 628 174, 628 196, 624 214 L 602 218 A 48 48 0 0 0 508 218 L 302 218 A 48 48 0 0 0 208 218 Z',
    highlightPath: 'M 202 144 C 226 130, 258 124, 284 120 L 356 64 C 376 56, 402 54, 434 56 C 484 58, 542 66, 582 74',
    // Bubble greenhouse
    windowPath: 'M 296 118 L 362 68 C 378 60, 400 58, 430 60 C 476 62, 526 70, 560 76 L 574 114 L 454 122 Z',
    bPillar: { x1: 438, y1: 61, x2: 434, y2: 122, width: 12 },
    headlightPath: 'M 184 158 L 226 142 L 220 164 Z',
    taillightPath: 'M 606 108 L 624 152 L 626 176 L 606 172 Z'
  },

  // ==========================================
  // SEDANES (8 Models)
  // Extended X: 95 to 710, wheels at cx=215, cx=585, cy=202, r=46
  // 3-box profile with distinct trunk (X ≈ 630 to 710)
  // ==========================================
  {
    id: 'mazda-3',
    name: 'Mazda 3 Sedán',
    type: 'sedan',
    cx1: 215,
    cx2: 585,
    cy: 202,
    rTire: 46,
    rRim: 28,
    spokeR: 25,
    shadowR: 52,
    contactX1: 120,
    contactX2: 670,
    // KODO sedan: long low sensual hood, fastback coupe roofline flowing into integrated ducktail trunk deck
    bodyPath: 'M 104 208 C 102 178, 114 150, 142 136 C 172 122, 224 116, 268 112 L 358 64 C 378 56, 404 54, 436 54 L 562 56 C 596 58, 626 72, 646 96 L 664 128 L 706 130 C 712 138, 712 164, 706 182 C 700 200, 688 206, 672 210 L 633 216 A 48 48 0 0 0 537 216 L 263 216 A 48 48 0 0 0 167 216 Z',
    highlightPath: 'M 144 136 C 174 122, 226 116, 270 112 L 360 66 L 560 58 C 594 60, 624 74, 644 98 L 662 130 L 704 132',
    windowPath: 'M 284 112 L 366 70 C 382 62, 406 60, 434 60 L 550 62 C 578 64, 606 74, 626 94 L 642 114 L 466 114 Z',
    bPillar: { x1: 456, y1: 61, x2: 450, y2: 114, width: 12 },
    headlightPath: 'M 116 150 L 170 134 L 162 154 Z',
    taillightPath: 'M 688 136 L 708 138 L 706 164 L 686 160 Z'
  },
  {
    id: 'renault-logan',
    name: 'Renault Logan',
    type: 'sedan',
    cx1: 215,
    cx2: 585,
    cy: 202,
    rTire: 46,
    rRim: 28,
    spokeR: 25,
    shadowR: 52,
    contactX1: 120,
    contactX2: 670,
    // High utilitarian boxy trunk deck (Y=126), tall spacious cabin, robust high beltline
    bodyPath: 'M 110 210 C 108 180, 118 156, 146 142 C 174 130, 222 124, 260 120 L 348 68 C 366 60, 390 58, 420 58 L 566 60 L 618 84 L 636 124 L 702 126 C 710 134, 710 162, 704 182 C 698 200, 686 208, 668 212 L 633 216 A 48 48 0 0 0 537 216 L 263 216 A 48 48 0 0 0 167 216 Z',
    highlightPath: 'M 148 142 C 176 130, 224 124, 262 120 L 350 70 L 564 62 L 616 86 L 634 126 L 700 128',
    windowPath: 'M 276 120 L 356 74 C 370 66, 392 65, 418 65 L 552 66 L 594 92 L 610 122 L 452 122 Z',
    bPillar: { x1: 444, y1: 65, x2: 440, y2: 122, width: 12 },
    headlightPath: 'M 122 156 L 172 142 L 166 162 Z',
    taillightPath: 'M 684 132 L 704 134 L 702 164 L 682 160 Z'
  },
  {
    id: 'chevrolet-sail',
    name: 'Chevrolet Sail',
    type: 'sedan',
    cx1: 215,
    cx2: 585,
    cy: 202,
    rTire: 46,
    rRim: 28,
    spokeR: 25,
    shadowR: 52,
    contactX1: 120,
    contactX2: 670,
    // Compact economical sedan: steep windshield, tall commuter cabin, high rear decklid (Y=130)
    bodyPath: 'M 112 210 C 110 180, 120 156, 146 142 C 174 130, 220 124, 258 120 L 344 68 C 362 60, 386 58, 416 58 L 562 60 L 614 84 L 634 128 L 700 130 C 708 138, 708 164, 702 184 C 696 200, 684 208, 668 212 L 633 216 A 48 48 0 0 0 537 216 L 263 216 A 48 48 0 0 0 167 216 Z',
    highlightPath: 'M 148 142 C 176 130, 222 124, 260 120 L 346 70 L 560 62 L 612 86 L 632 130 L 698 132',
    windowPath: 'M 274 120 L 352 74 C 366 66, 388 65, 414 65 L 548 66 L 590 92 L 608 122 L 450 122 Z',
    bPillar: { x1: 440, y1: 65, x2: 436, y2: 122, width: 12 },
    headlightPath: 'M 124 156 L 172 142 L 166 162 Z',
    taillightPath: 'M 682 136 L 702 138 L 700 166 L 680 162 Z'
  },
  {
    id: 'chevrolet-onix-sedan',
    name: 'Chevrolet Onix Sedán (Onix Plus)',
    type: 'sedan',
    cx1: 215,
    cx2: 585,
    cy: 202,
    rTire: 46,
    rRim: 28,
    spokeR: 25,
    shadowR: 52,
    contactX1: 120,
    contactX2: 670,
    // Modern flowing sedan: aerodynamic nose, sweeping roofline into short high decklid with sharp rear edge
    bodyPath: 'M 106 208 C 104 178, 114 152, 140 138 C 170 124, 220 118, 262 114 L 352 66 C 370 58, 396 56, 426 56 L 560 58 C 592 60, 622 74, 642 98 L 658 128 L 704 130 C 710 138, 710 164, 704 182 C 698 200, 686 206, 670 210 L 633 216 A 48 48 0 0 0 537 216 L 263 216 A 48 48 0 0 0 167 216 Z',
    highlightPath: 'M 142 138 C 172 124, 222 118, 264 114 L 354 68 L 558 60 C 590 62, 620 76, 640 100 L 656 130 L 702 132',
    windowPath: 'M 280 114 L 360 72 C 374 64, 398 63, 424 63 L 548 64 C 574 66, 602 76, 622 96 L 636 116 L 460 116 Z',
    bPillar: { x1: 450, y1: 63, x2: 444, y2: 116, width: 12 },
    headlightPath: 'M 118 152 L 168 136 L 162 156 Z',
    taillightPath: 'M 686 136 L 706 138 L 704 164 L 684 160 Z'
  },
  {
    id: 'nissan-versa',
    name: 'Nissan Versa',
    type: 'sedan',
    cx1: 215,
    cx2: 585,
    cy: 202,
    rTire: 46,
    rRim: 28,
    spokeR: 25,
    shadowR: 52,
    contactX1: 120,
    contactX2: 670,
    // V-motion front nose, floating roof C-pillar accent cutout, aerodynamic sedan profile
    bodyPath: 'M 106 208 C 104 178, 114 152, 140 138 C 170 124, 220 118, 262 114 L 350 66 C 368 58, 394 56, 424 56 L 562 58 L 618 84 L 642 124 L 704 126 C 710 134, 710 162, 704 182 C 698 200, 686 206, 670 210 L 633 216 A 48 48 0 0 0 537 216 L 263 216 A 48 48 0 0 0 167 216 Z',
    highlightPath: 'M 142 138 C 172 124, 222 118, 264 114 L 352 68 L 560 60 L 616 86 L 640 126 L 702 128',
    windowPath: 'M 280 114 L 358 72 C 372 64, 396 63, 422 63 L 550 64 L 594 90 L 616 120 L 458 120 Z',
    bPillar: { x1: 448, y1: 63, x2: 442, y2: 120, width: 12 },
    headlightPath: 'M 118 152 L 168 136 L 162 156 Z',
    taillightPath: 'M 686 132 L 706 134 L 704 162 L 684 158 Z'
  },
  {
    id: 'toyota-corolla',
    name: 'Toyota Corolla',
    type: 'sedan',
    cx1: 215,
    cx2: 585,
    cy: 202,
    rTire: 46,
    rRim: 28,
    spokeR: 25,
    shadowR: 52,
    contactX1: 120,
    contactX2: 670,
    // Executive balanced stance: chiseled bumper rake, streamlined roofline, balanced trunk deck with subtle lip
    bodyPath: 'M 104 208 C 102 178, 114 152, 140 138 C 170 124, 222 118, 264 114 L 354 66 C 372 58, 398 56, 428 56 L 564 58 L 620 84 L 644 126 L 706 128 C 712 136, 712 164, 706 182 C 700 200, 688 206, 672 210 L 633 216 A 48 48 0 0 0 537 216 L 263 216 A 48 48 0 0 0 167 216 Z',
    highlightPath: 'M 142 138 C 172 124, 224 118, 266 114 L 356 68 L 562 60 L 618 86 L 642 128 L 704 130',
    windowPath: 'M 282 114 L 362 72 C 376 64, 400 63, 426 63 L 552 64 L 596 90 L 618 120 L 460 120 Z',
    bPillar: { x1: 450, y1: 63, x2: 444, y2: 120, width: 12 },
    headlightPath: 'M 116 152 L 168 136 L 162 156 Z',
    taillightPath: 'M 688 134 L 708 136 L 706 164 L 686 160 Z'
  },
  {
    id: 'chevrolet-aveo',
    name: 'Chevrolet Aveo',
    type: 'sedan',
    cx1: 215,
    cx2: 585,
    cy: 202,
    rTire: 46,
    rRim: 28,
    spokeR: 25,
    shadowR: 52,
    contactX1: 120,
    contactX2: 670,
    // Iconic Colombian family sedan: upright stance, large headlights, traditional upright 3-box geometry
    bodyPath: 'M 112 210 C 110 180, 120 156, 146 142 C 174 130, 222 124, 260 120 L 346 68 C 364 60, 388 58, 418 58 L 564 60 L 616 84 L 636 128 L 702 130 C 710 138, 710 164, 704 184 C 698 200, 686 208, 670 212 L 633 216 A 48 48 0 0 0 537 216 L 263 216 A 48 48 0 0 0 167 216 Z',
    highlightPath: 'M 148 142 C 176 130, 224 124, 262 120 L 348 70 L 562 62 L 614 86 L 634 130 L 700 132',
    windowPath: 'M 276 120 L 354 74 C 368 66, 390 65, 416 65 L 550 66 L 592 92 L 610 122 L 452 122 Z',
    bPillar: { x1: 442, y1: 65, x2: 438, y2: 122, width: 12 },
    headlightPath: 'M 124 156 L 172 142 L 166 162 Z',
    taillightPath: 'M 684 136 L 704 138 L 702 166 L 682 162 Z'
  },
  {
    id: 'hyundai-accent',
    name: 'Hyundai Accent',
    type: 'sedan',
    cx1: 215,
    cx2: 585,
    cy: 202,
    rTire: 46,
    rRim: 28,
    spokeR: 25,
    shadowR: 52,
    contactX1: 120,
    contactX2: 670,
    // Fluidic sculpture sedan: low-slung front hood, cascading roofline flowing into sleek trunk
    bodyPath: 'M 106 208 C 104 178, 114 152, 140 138 C 170 124, 220 118, 262 114 L 352 66 C 370 58, 396 56, 426 56 L 560 58 C 592 60, 622 74, 642 98 L 658 128 L 704 130 C 710 138, 710 164, 704 182 C 698 200, 686 206, 670 210 L 633 216 A 48 48 0 0 0 537 216 L 263 216 A 48 48 0 0 0 167 216 Z',
    highlightPath: 'M 142 138 C 172 124, 222 118, 264 114 L 354 68 L 558 60 C 590 62, 620 76, 640 100 L 656 130 L 702 132',
    windowPath: 'M 280 114 L 360 72 C 374 64, 398 63, 424 63 L 548 64 C 574 66, 602 76, 622 96 L 636 116 L 460 116 Z',
    bPillar: { x1: 450, y1: 63, x2: 444, y2: 116, width: 12 },
    headlightPath: 'M 118 152 L 168 136 L 162 156 Z',
    taillightPath: 'M 686 136 L 706 138 L 704 164 L 684 160 Z'
  },

  // ==========================================
  // SUVS Y PICKUPS (10 Models)
  // ==========================================
  {
    id: 'renault-duster',
    name: 'Renault Duster',
    type: 'suv',
    cx1: 220,
    cx2: 580,
    cy: 199,
    rTire: 49,
    rRim: 30,
    spokeR: 26,
    shadowR: 54,
    contactX1: 120,
    contactX2: 670,
    // Flared muscular boxy wheel arches (blisters), upright high stance, roof bars, high ground clearance
    bodyPath: 'M 112 202 C 106 178, 116 154, 142 144 C 174 136, 222 132, 258 128 L 334 76 C 352 68, 376 66, 408 66 L 594 68 L 632 72 L 620 86 L 652 150 C 658 170, 658 194, 650 202 L 632 204 A 52 52 0 0 0 528 204 L 272 204 A 52 52 0 0 0 168 204 Z',
    highlightPath: 'M 144 144 C 176 136, 224 132, 260 128 L 336 78 L 592 70',
    windowPath: 'M 276 128 L 344 80 C 358 72, 380 71, 406 71 L 574 72 L 596 112 L 460 126 Z',
    bPillar: { x1: 442, y1: 71, x2: 438, y2: 126, width: 12 },
    headlightPath: 'M 122 158 L 170 146 L 164 166 Z',
    taillightPath: 'M 632 110 L 652 150 L 654 174 L 634 170 Z',
    extraElements: `  <!-- Rugged Roof Rails -->
  <line x1="360" y1="56" x2="580" y2="56" stroke="#09090B" stroke-width="6" stroke-linecap="round"/>
  <line x1="380" y1="56" x2="380" y2="66" stroke="#09090B" stroke-width="4"/>
  <line x1="560" y1="56" x2="560" y2="68" stroke="#09090B" stroke-width="4"/>
  <!-- Bold Industrial Wheel Arch Cladding -->
  <path d="M 166 204 A 54 54 0 0 1 274 204" stroke="#18181B" stroke-width="9" fill="none"/>
  <path d="M 526 204 A 54 54 0 0 1 634 204" stroke="#18181B" stroke-width="9" fill="none"/>`
  },
  {
    id: 'mazda-cx30',
    name: 'Mazda CX-30',
    type: 'suv',
    cx1: 220,
    cx2: 580,
    cy: 199,
    rTire: 49,
    rRim: 30,
    spokeR: 26,
    shadowR: 54,
    contactX1: 120,
    contactX2: 670,
    // Signature thick cladding, sleek coupe-SUV roofline, long low hood, slim headlights
    bodyPath: 'M 112 202 C 108 176, 118 150, 144 138 C 174 126, 226 120, 266 116 L 350 68 C 368 60, 392 58, 424 58 L 576 60 L 616 64 L 604 78 L 642 148 C 648 168, 648 194, 642 202 L 632 204 A 52 52 0 0 0 528 204 L 272 204 A 52 52 0 0 0 168 204 Z',
    highlightPath: 'M 146 138 C 176 126, 228 120, 268 116 L 352 70 L 574 64',
    windowPath: 'M 284 116 L 358 74 C 374 66, 396 65, 422 65 L 558 66 L 582 108 L 458 118 Z',
    bPillar: { x1: 446, y1: 65, x2: 440, y2: 118, width: 12 },
    headlightPath: 'M 124 154 L 176 138 L 168 158 Z',
    taillightPath: 'M 622 106 L 642 146 L 644 170 L 624 166 Z',
    extraElements: `  <!-- Ultra-Thick Kodo Wheel Arch Cladding -->
  <path d="M 166 204 A 54 54 0 0 1 274 204" stroke="#18181B" stroke-width="12" fill="none"/>
  <path d="M 526 204 A 54 54 0 0 1 634 204" stroke="#18181B" stroke-width="12" fill="none"/>`
  },
  {
    id: 'chevrolet-tracker',
    name: 'Chevrolet Tracker',
    type: 'suv',
    cx1: 220,
    cx2: 580,
    cy: 199,
    rTire: 49,
    rRim: 30,
    spokeR: 26,
    shadowR: 54,
    contactX1: 120,
    contactX2: 670,
    // Modern compact crossover: dual-level grille front, sculpted hood, roof rails, rear quarter glass
    bodyPath: 'M 114 202 C 110 178, 120 152, 146 140 C 176 130, 224 124, 262 120 L 344 70 C 362 62, 386 60, 416 60 L 580 62 L 618 66 L 606 80 L 644 148 C 650 168, 650 194, 644 202 L 632 204 A 52 52 0 0 0 528 204 L 272 204 A 52 52 0 0 0 168 204 Z',
    highlightPath: 'M 148 140 C 178 130, 226 124, 264 120 L 346 72 L 578 66',
    windowPath: 'M 280 120 L 352 76 C 368 68, 390 67, 414 67 L 562 68 L 586 110 L 460 120 Z',
    bPillar: { x1: 446, y1: 67, x2: 442, y2: 120, width: 12 },
    headlightPath: 'M 126 156 L 174 142 L 168 162 Z',
    taillightPath: 'M 624 108 L 644 146 L 646 170 L 626 166 Z',
    extraElements: `  <!-- Roof Rails & Cladding -->
  <line x1="370" y1="52" x2="570" y2="52" stroke="#09090B" stroke-width="5" stroke-linecap="round"/>
  <path d="M 166 204 A 54 54 0 0 1 274 204" stroke="#18181B" stroke-width="9" fill="none"/>
  <path d="M 526 204 A 54 54 0 0 1 634 204" stroke="#18181B" stroke-width="9" fill="none"/>`
  },
  {
    id: 'suzuki-vitara',
    name: 'Suzuki Vitara',
    type: 'suv',
    cx1: 220,
    cx2: 580,
    cy: 199,
    rTire: 49,
    rRim: 30,
    spokeR: 26,
    shadowR: 54,
    contactX1: 125,
    contactX2: 665,
    // Clamshell hood contour, contrasting roofline, athletic compact SUV silhouette with upright tailgate
    bodyPath: 'M 118 202 C 114 178, 124 154, 150 142 C 180 132, 226 126, 264 122 L 340 72 C 356 64, 380 62, 410 62 L 582 64 L 616 68 L 606 82 L 640 150 C 646 170, 646 194, 640 202 L 632 204 A 52 52 0 0 0 528 204 L 272 204 A 52 52 0 0 0 168 204 Z',
    highlightPath: 'M 152 142 C 182 132, 228 126, 266 122 L 342 74 L 580 68',
    windowPath: 'M 280 122 L 348 78 C 362 70, 384 69, 408 69 L 564 70 L 586 112 L 460 122 Z',
    bPillar: { x1: 442, y1: 69, x2: 438, y2: 122, width: 12 },
    headlightPath: 'M 130 156 L 176 142 L 170 162 Z',
    taillightPath: 'M 620 110 L 640 148 L 642 172 L 622 168 Z',
    extraElements: `  <!-- Compact Roof Rails & Cladding -->
  <line x1="365" y1="54" x2="575" y2="54" stroke="#09090B" stroke-width="5" stroke-linecap="round"/>
  <path d="M 166 204 A 54 54 0 0 1 274 204" stroke="#18181B" stroke-width="9" fill="none"/>
  <path d="M 526 204 A 54 54 0 0 1 634 204" stroke="#18181B" stroke-width="9" fill="none"/>`
  },
  {
    id: 'kia-sportage',
    name: 'Kia Sportage',
    type: 'suv',
    cx1: 220,
    cx2: 580,
    cy: 199,
    rTire: 49,
    rRim: 30,
    spokeR: 26,
    shadowR: 54,
    contactX1: 120,
    contactX2: 670,
    // Fastback-SUV stance: aggressive boom front rake, sweeping curved roofline into rear spoiler
    bodyPath: 'M 112 202 C 108 176, 118 150, 144 138 C 174 126, 224 120, 264 116 L 348 68 C 366 60, 390 58, 420 58 L 576 60 L 616 64 L 604 78 L 644 148 C 650 168, 650 194, 644 202 L 632 204 A 52 52 0 0 0 528 204 L 272 204 A 52 52 0 0 0 168 204 Z',
    highlightPath: 'M 146 138 C 176 126, 226 120, 266 116 L 350 70 L 574 64',
    windowPath: 'M 280 116 L 354 74 C 370 66, 394 65, 418 65 L 558 66 L 582 108 L 458 118 Z',
    bPillar: { x1: 444, y1: 65, x2: 440, y2: 118, width: 12 },
    headlightPath: 'M 124 154 L 174 138 L 168 158 Z',
    taillightPath: 'M 624 106 L 644 146 L 646 170 L 626 166 Z',
    extraElements: `  <!-- Aerodynamic Roof Rails & Cladding -->
  <line x1="375" y1="52" x2="570" y2="52" stroke="#09090B" stroke-width="5" stroke-linecap="round"/>
  <path d="M 166 204 A 54 54 0 0 1 274 204" stroke="#18181B" stroke-width="9" fill="none"/>
  <path d="M 526 204 A 54 54 0 0 1 634 204" stroke="#18181B" stroke-width="9" fill="none"/>`
  },
  {
    id: 'toyota-fortuner',
    name: 'Toyota Fortuner',
    type: 'suv',
    cx1: 220,
    cx2: 580,
    cy: 199,
    rTire: 49,
    rRim: 30,
    spokeR: 26,
    shadowR: 54,
    contactX1: 115,
    contactX2: 675,
    // Truck-based 7-seater SUV: massive aggressive bullnose, upswept rear quarter window, running board
    bodyPath: 'M 108 202 C 104 176, 114 148, 140 136 C 172 126, 224 122, 264 118 L 342 66 C 360 58, 386 56, 418 56 L 594 58 L 634 62 L 622 76 L 656 146 C 662 168, 662 194, 654 202 L 632 204 A 52 52 0 0 0 528 204 L 272 204 A 52 52 0 0 0 168 204 Z',
    highlightPath: 'M 142 136 C 174 126, 226 122, 266 118 L 344 68 L 592 62',
    // Distinctive upswept rear window kink
    windowPath: 'M 280 118 L 350 72 C 366 64, 390 63, 416 63 L 576 64 L 602 104 L 464 118 Z',
    bPillar: { x1: 446, y1: 63, x2: 442, y2: 118, width: 12 },
    headlightPath: 'M 120 152 L 172 136 L 164 156 Z',
    taillightPath: 'M 636 104 L 656 144 L 658 168 L 638 164 Z',
    extraElements: `  <!-- Heavy Duty Roof Rails & Rock Cladding -->
  <line x1="365" y1="48" x2="590" y2="48" stroke="#09090B" stroke-width="6" stroke-linecap="round"/>
  <path d="M 166 204 A 54 54 0 0 1 274 204" stroke="#18181B" stroke-width="9" fill="none"/>
  <path d="M 526 204 A 54 54 0 0 1 634 204" stroke="#18181B" stroke-width="9" fill="none"/>
  <!-- Side Step Running Board -->
  <line x1="282" y1="210" x2="518" y2="210" stroke="#09090B" stroke-width="6" stroke-linecap="round"/>`
  },
  {
    id: 'toyota-prado',
    name: 'Toyota Prado (Land Cruiser)',
    type: 'suv',
    cx1: 220,
    cx2: 580,
    cy: 199,
    rTire: 49,
    rRim: 30,
    spokeR: 26,
    shadowR: 54,
    contactX1: 115,
    contactX2: 675,
    // Indestructible square 4x4: towering square grille, flat roof with roof rails, vertical rear door
    bodyPath: 'M 106 202 C 102 174, 110 144, 136 132 C 168 122, 222 118, 262 116 L 334 62 C 352 54, 376 52, 408 52 L 608 54 L 642 58 L 634 74 L 660 146 C 666 168, 664 194, 656 202 L 632 204 A 52 52 0 0 0 528 204 L 272 204 A 52 52 0 0 0 168 204 Z',
    highlightPath: 'M 138 132 C 170 122, 224 118, 264 116 L 336 64 L 606 58',
    // Commanding upright square greenhouse
    windowPath: 'M 276 116 L 344 68 C 360 60, 382 59, 406 59 L 590 60 L 610 106 L 460 116 Z',
    bPillar: { x1: 442, y1: 59, x2: 438, y2: 116, width: 12 },
    headlightPath: 'M 118 148 L 168 132 L 160 152 Z',
    taillightPath: 'M 640 102 L 660 144 L 662 168 L 642 164 Z',
    extraElements: `  <!-- Massive Heavy-Duty Roof Rails -->
  <line x1="355" y1="44" x2="605" y2="44" stroke="#09090B" stroke-width="7" stroke-linecap="round"/>
  <path d="M 166 204 A 54 54 0 0 1 274 204" stroke="#18181B" stroke-width="10" fill="none"/>
  <path d="M 526 204 A 54 54 0 0 1 634 204" stroke="#18181B" stroke-width="10" fill="none"/>
  <!-- Heavy Duty Side Step -->
  <line x1="280" y1="210" x2="520" y2="210" stroke="#09090B" stroke-width="7" stroke-linecap="round"/>`
  },

  // Pickups:
  // Front square Y=105, cab-bed vertical divide line x1="538" x2="538", high clearance Y=192,
  // off-road wheels r=52, cy=194 (cy + r = 246-248) with stroke-dasharray="14 6"
  {
    id: 'toyota-hilux',
    name: 'Toyota Hilux',
    type: 'pickup',
    cx1: 220,
    cx2: 600,
    cy: 194,
    rTire: 52,
    rRim: 31,
    spokeR: 27,
    shadowR: 58,
    isOffRoad: true,
    contactX1: 115,
    contactX2: 690,
    // Angular aggressive front nose, double cab, horizontal flat cargo bed, rear bumper step
    bodyPath: 'M 106 192 C 102 166, 110 136, 134 122 C 166 112, 220 108, 260 104 L 336 58 C 354 50, 378 48, 410 48 L 526 50 C 538 56, 542 66, 542 80 L 542 128 L 682 128 L 702 134 C 708 142, 706 172, 698 190 L 656 194 A 56 56 0 0 0 544 194 L 276 194 A 56 56 0 0 0 164 194 Z',
    highlightPath: 'M 136 122 C 168 112, 222 108, 262 104 L 338 60 L 524 54',
    // Double cab window
    windowPath: 'M 276 104 L 344 64 C 358 56, 380 55, 408 55 L 512 56 L 524 104 L 444 104 Z',
    bPillar: { x1: 432, y1: 55, x2: 428, y2: 104, width: 12 },
    headlightPath: 'M 118 138 L 168 122 L 162 142 Z',
    taillightPath: 'M 682 134 L 702 136 L 700 168 L 680 164 Z',
    extraElements: `  <!-- Pickup Double-Cab / Bed Separation Seam -->
  <line x1="538" y1="56" x2="538" y2="194" stroke="#09090B" stroke-width="6"/>
  <!-- Bed Rail Tie-Down Top Lip -->
  <line x1="542" y1="126" x2="688" y2="126" stroke="#09090B" stroke-width="5" stroke-linecap="round"/>
  <!-- Heavy Duty Side Step -->
  <line x1="284" y1="202" x2="534" y2="202" stroke="#09090B" stroke-width="6" stroke-linecap="round"/>`
  },
  {
    id: 'nissan-frontier',
    name: 'Nissan Frontier',
    type: 'pickup',
    cx1: 220,
    cx2: 600,
    cy: 194,
    rTire: 52,
    rRim: 31,
    spokeR: 27,
    shadowR: 58,
    isOffRoad: true,
    contactX1: 115,
    contactX2: 690,
    // Muscular high hood bulges, chiseled front, wide double cab, vertical cab-to-bed divide, stamped bed lip
    bodyPath: 'M 108 192 C 104 166, 112 136, 136 122 C 168 112, 222 108, 262 104 L 338 58 C 356 50, 380 48, 412 48 L 528 50 C 540 56, 544 66, 544 80 L 544 128 L 684 128 L 704 134 C 710 142, 708 172, 700 190 L 656 194 A 56 56 0 0 0 544 194 L 276 194 A 56 56 0 0 0 164 194 Z',
    highlightPath: 'M 138 122 C 170 112, 224 108, 264 104 L 340 60 L 526 54',
    windowPath: 'M 278 104 L 346 64 C 360 56, 382 55, 410 55 L 514 56 L 526 104 L 446 104 Z',
    bPillar: { x1: 434, y1: 55, x2: 430, y2: 104, width: 12 },
    headlightPath: 'M 120 138 L 170 122 L 164 142 Z',
    taillightPath: 'M 684 134 L 704 136 L 702 168 L 682 164 Z',
    extraElements: `  <!-- Pickup Double-Cab / Bed Separation Seam -->
  <line x1="538" y1="56" x2="538" y2="194" stroke="#09090B" stroke-width="6"/>
  <!-- Bed Rail Tie-Down Top Lip -->
  <line x1="544" y1="126" x2="690" y2="126" stroke="#09090B" stroke-width="5" stroke-linecap="round"/>
  <!-- Heavy Duty Side Step -->
  <line x1="284" y1="202" x2="534" y2="202" stroke="#09090B" stroke-width="6" stroke-linecap="round"/>`
  },
  {
    id: 'toyota-tundra',
    name: 'Toyota Tundra',
    type: 'pickup',
    cx1: 220,
    cx2: 600,
    cy: 194,
    rTire: 52,
    rRim: 31,
    spokeR: 27,
    shadowR: 58,
    isOffRoad: true,
    contactX1: 110,
    contactX2: 700,
    // Massive towering blunt front grille, high horizontal hood, massive double cab, long deep bed
    bodyPath: 'M 102 192 C 98 162, 106 132, 130 118 C 164 108, 220 104, 262 100 L 340 54 C 358 46, 384 44, 416 44 L 530 46 C 542 52, 546 62, 546 76 L 546 126 L 690 126 L 710 132 C 716 140, 714 172, 706 190 L 656 194 A 56 56 0 0 0 544 194 L 276 194 A 56 56 0 0 0 164 194 Z',
    highlightPath: 'M 132 118 C 166 108, 222 104, 264 100 L 342 56 L 528 50',
    windowPath: 'M 280 100 L 348 60 C 362 52, 386 51, 414 51 L 516 52 L 528 100 L 448 100 Z',
    bPillar: { x1: 436, y1: 51, x2: 432, y2: 100, width: 12 },
    headlightPath: 'M 114 134 L 166 118 L 160 138 Z',
    taillightPath: 'M 690 130 L 710 132 L 708 166 L 688 162 Z',
    extraElements: `  <!-- Massive Full-Size Bed Separation Seam -->
  <line x1="538" y1="52" x2="538" y2="194" stroke="#09090B" stroke-width="6"/>
  <!-- Bed Top Rail -->
  <line x1="546" y1="124" x2="696" y2="124" stroke="#09090B" stroke-width="6" stroke-linecap="round"/>
  <!-- Heavy Duty Side Step -->
  <line x1="284" y1="202" x2="534" y2="202" stroke="#09090B" stroke-width="7" stroke-linecap="round"/>`
  }
];

console.log(`Generating ${VEHICLE_MODELS.length} vehicle SVGs...`);
const inlineMap = {};

for (const model of VEHICLE_MODELS) {
  const content = buildSvg(model);
  const filePath = path.join(OUTPUT_DIR, `${model.id}.svg`);
  fs.writeFileSync(filePath, content, 'utf8');
  inlineMap[model.id] = content;
  console.log(`✓ Created: ${model.id}.svg`);
}

// Aliases for backward compatibility
inlineMap['picanto-2017'] = inlineMap['kia-picanto'];
inlineMap['generic-hatch'] = inlineMap['volkswagen-gol'];

// Generate models-inline.js
const inlineJsPath = path.resolve(__dirname, '../src/assets/vehicles-svg/models-inline.js');
const inlineJsContent = `/**
 * OCTANE // KINETIC — Master Inlined Vehicle Blueprint Registry (28 Models)
 * Auto-generated by scripts/generate-all-vehicles.js
 */

export const VEHICLE_SVGS = ${JSON.stringify(inlineMap, null, 2)};

export const AVAILABLE_MODELS = ${JSON.stringify(VEHICLE_MODELS.map(m => ({
  id: m.id,
  name: m.name,
  type: m.type,
  svgPath: `/src/assets/vehicles-svg/models/${m.id}.svg`
})), null, 2)};

/**
 * Returns inlined SVG string for a model, with optional vehicle color styling.
 * @param {string} modelId 
 * @param {string} [colorHex] 
 * @returns {string} SVG markup
 */
export function getInlineVehicleSvg(modelId = 'kia-picanto', colorHex = '#FF5500') {
  const svg = VEHICLE_SVGS[modelId] || VEHICLE_SVGS['kia-picanto'] || '';
  if (colorHex) {
    return \`<div class="w-full h-full flex items-center justify-center pointer-events-none select-none" style="--car-paint: \${colorHex}; width: 100%; height: 100%;">\${svg}</div>\`;
  }
  return svg;
}
`;

fs.writeFileSync(inlineJsPath, inlineJsContent, 'utf8');
console.log(`✓ Created: models-inline.js`);

console.log(`\nAll ${VEHICLE_MODELS.length} vehicle SVGs generated successfully in:`);
console.log(OUTPUT_DIR);
