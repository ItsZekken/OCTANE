# OCTANE // KINETIC

> Minimalist Progressive Web App (PWA) for vehicular telemetry, operational logging, fuel economics, maintenance, legal records, and trip management.

---

## Overview

OCTANE is engineered following the Swiss & Teenage Engineering design philosophy:
- **Silent, high-density instrumentation** with typographic hierarchy (JetBrains Mono).
- **Dual visual modes**: Carbon Mode (`dark`) and Paper Mode (`light`).
- **Offline-first architecture**: Local storage with IndexedDB and optional Firebase Firestore synchronization.
- **PWA ready**: Installable on mobile and desktop devices with full offline service worker caching.

---

## Core Modules

- **Cockpit**: Primary telemetry display, odometer tracking, dynamic range estimations, and operational status.
- **Cluster**: Maintenance item schedules, component wear status, and replacement interval tracking.
- **Guantera (Glovebox)**: Digital legal documentation registry (SOAT, RTM, taxes, insurance) and freehand canvas notes.
- **Rides**: Trip and fuel pass logging, segment economics, and fuel consumption analytics.
- **Settings**: System configurations, unit conversion (`km/l`, `l/100km`, `km/gal`), fuel cost rates, audio haptic horology, and data export/import (JSON snapshot).

---

## Getting Started

### Prerequisites

- Node.js 18+
- npm or pnpm

### Installation

```bash
# Clone the repository
git clone https://github.com/ItsZekken/OCTANE.git
cd OCTANE

# Install dependencies
npm install

# Start development server
npm run dev
```

### Production Build

```bash
# Generate production bundle
npm run build

# Preview build locally
npm run preview
```

---

## Project Structure

```text
OCTANE/
├── public/              # Static assets, PWA icons, manifest, service worker
├── scripts/             # Vehicle taxonomy scrapers and icon generators
├── src/
│   ├── assets/          # SVG silhouettes, vehicle catalog database
│   ├── components/      # UI components (gauges, modals, header, nav-dock)
│   ├── core/            # State store, IndexedDB, telemetry engine, Firebase sync
│   ├── style/           # Tailwind CSS styles and font configurations
│   ├── views/           # Views: Cockpit, Cluster, Glovebox, Rides, Settings
│   └── main.js          # Application entry point and router
├── AGENTS.md            # Guidelines and development rules
├── DESIGN_GUIDELINES.md # Architectural and design specification
├── index.html           # HTML shell
├── package.json         # Dependencies and scripts
└── vite.config.js       # Vite configuration
```

---

## License

Private / Personal Project.
