# PLAN DE IMPLEMENTACIÓN 1: CORE, PERSISTENCIA HÍBRIDA, COCKPIT SVG Y MEDIDORES INTERACTIVOS

## 1. Contexto y Objetivo de la Fase 1
Transformar el archivo monolítico `kia_picanto_1_0l_telemetry_dashboard.html`[cite: 3] en una aplicación web progresiva (PWA) modular basada en **Vite + Tailwind CSS + Vanilla JS (ES Modules) + IndexedDB + Firebase (Google Auth & Firestore)**. 

Esta Fase 1 establece la arquitectura base, migra toda la estética oscura y el motor matemático de `OCTANE // KINETIC`[cite: 3], elimina los datos preestablecidos (`defaultRawData`)[cite: 3], integra la pantalla principal (`Cockpit`) con el wireframe SVG del vehículo e implementa el modal interactivo **"Sincronizar Medidor + KM"**[cite: 4] con 4 estilos de aguja/medidor seleccionables para adaptarse a cualquier modelo de vehículo.

---

## 2. Reglas de Diseño e Identidad Visual Innegociables (`OCTANE // KINETIC`)
Todo componente nuevo debe respetar estrictamente el sistema de diseño suizo de grilla plana de `1px` definido en el HTML base[cite: 3]:

* **Paleta de Colores (`data-theme="dark"` por defecto y soporte `light`)**[cite: 3]:
  * `--bg-void: #09090B` (Fondo principal)[cite: 3]
  * `--bg-surface: #0E0E11` (Superficie de paneles `.flat-frame` y `.flat-cell`)[cite: 3]
  * `--bg-elevated: #141418` (Elementos interactivos y píldoras `.flat-pill`)[cite: 3]
  * `--text-primary: #F4F4F6`, `--text-secondary: #8A8A93`, `--text-muted: #4A4A52`[cite: 3]
  * `--line-hair: #1E1E24`, `--line-strong: #2E2E38`[cite: 3]
  * `--accent-amber: #FF5500`, `--accent-volt: #10B981`, `--accent-crimson: #F43F5E`, `--accent-cyan: #38BDF8`[cite: 3]
* **Tipografía y Geometría**[cite: 3]:
  * Fuentes: `Inter` para encabezados y lecturas principales; `JetBrains Mono` con `.tabular-nums` (`font-variant-numeric: tabular-nums; letter-spacing: -0.04em;`) para toda métrica, odómetro, porcentaje y dinero[cite: 3].
  * Cero sombras (`box-shadow: none`), cero biseles, bordes rectos o `rounded-sm` (`2px`), y separadores `border-[var(--line-hair)]` de `1px`[cite: 3].
* **Audio Táctil**:
  * Conservar y exportar la función `playHorologyTick(freq, dur, gainVal)` basada en Web Audio API para retroalimentación háptica sonora en botones, *scrubbers* y agujas[cite: 3].

---

## 3. Estructura del Proyecto (Contrato de Archivos para Subagentes)

    octane-kinetic-pwa/
    ├── index.html
    ├── package.json
    ├── vite.config.js
    ├── tailwind.config.js
    ├── firebase.json
    └── src/
        ├── main.js                      # Inicializador, estado global reactivo y router de las 5 vistas
        ├── style/
        │   └── tokens.css               # Variables CSS de OCTANE // KINETIC y clases .flat-frame, .flat-pill, .kinetic-scrubber
        ├── core/
        │   ├── state.js                 # Store reactivo (Pub/Sub) compartido entre vistas
        │   ├── db-local.js              # Wrapper asíncrono de IndexedDB (OctaneKineticDB v1)
        │   ├── firebase-sync.js         # Firebase Auth (Google Sign-In) + Sincronización Firestore Offline-First
        │   ├── json-io.js               # Importación/Exportación de JSON (compatible con formato legacy y snapshot completo)
        │   └── telemetry-engine.js      # Motor matemático: Método Pistola Pita, ciclos cerrados, interpolación diaria y ADN semanal
        ├── assets/
        │   └── vehicles-svg/
        │       ├── catalog.js           # Registro de modelos y metadatos (tanque en litros/galones, tipo de aguja por defecto)
        │       ├── picanto-2017.svg     # Wireframe técnico del Kia Picanto 1.0L (35L / 9.25 gal)
        │       └── generic-hatch.svg    # Wireframes base adicionales (Sedán, SUV, Hatchback)
        ├── components/
        │   ├── header-bar.js            # Barra superior con estado de Auth, selector KM/G - L/100 - KM/L, precio galón, audio y tema
        │   ├── nav-dock.js              # Navegación inferior/lateral: Cockpit, Clúster, Guantera, Carga (Modal), Ajustes (+ Carreras)
        │   ├── fuel-gauges/
        │   │   ├── gauge-controller.js  # Interfaz unificada de arrastre táctil/mouse (retorna 0% a 100% y volumen en L/Gal)
        │   │   ├── gauge-spicy-arc.js   # Estilo 1: Arco vertical derecho (F a E con marca 1/4 en naranja/rojo estilo SPICY)
        │   │   ├── gauge-analog-180.js  # Estilo 2: Semicírculo analógico horizontal de 180°
        │   │   ├── gauge-digital-lcd.js # Estilo 3: Barras digitales segmentadas (8/10/12 bloques LCD interactivos)
        │   │   └── gauge-sight-glass.js # Estilo 4: Lente óptico cilíndrico de fluido en Canvas
        │   └── modals/
        │       └── modal-sync-fuel.js   # Modal "Sincronizar Medidor + KM" + Registro de tanqueada
        └── views/
            ├── view-cockpit.js          # Vista 1: Hero SVG del carro + Lente Fluido + Simulador + Monolitos + Espectro + Bitácora
            ├── view-cluster.js          # Placeholder en Fase 1 (Implementación completa en Fase 2)
            ├── view-glovebox.js         # Placeholder en Fase 1 (Implementación completa en Fase 2)
            ├── view-rides.js            # Placeholder en Fase 1 (Implementación completa en Fase 3)
            └── view-settings.js         # Perfil del carro, Google Sign-In, selector de aguja, backup JSON y reset

---

## 4. Especificaciones Técnicas por Módulo

### 4.1. Capa de Persistencia (`db-local.js`, `firebase-sync.js`, `json-io.js`)
1. **Eliminación de datos quemados**:
   * Remover por completo `defaultRawData`[cite: 3]. Al iniciar por primera vez sin datos en `IndexedDB`, renderizar un estado inicial limpio en el `Cockpit` con acceso directo a **"Importar JSON"** o **"Registrar Primera Lectura"**.
2. **Object Stores en `IndexedDB` (`OctaneKineticDB`, versión `1`)**:
   * `vehicle_profile`: `{ id: 'main', name: 'Kia Picanto 1.0L', tankCapacityLiters: 35.0, tankCapacityGallons: 9.25, reserveLiters: 5.0, fuelPriceCop: 15750, gaugeStyle: 'spicy-arc', svgModel: 'picanto-2017', routineDailyKm: 24, ridesModuleEnabled: true }`[cite: 3, 4, 5].
   * `telemetry_logs`:Clave primaria `date` (`YYYY-MM-DD`) o `id` autoincremental. Campos compatibles con el dataset original: `{ date, odometer_reading, fuel_level_percent, refuels_count, gallons_added, is_full_tank, total_cost_cop, distance_km, duration_seconds, idle_seconds, idle_ratio, acceleration_variance, max_speed_kmh, thermal_stress_score, updatedAt }`[cite: 2, 3].
   * `maintenance_items`, `free_notes`, `legal_docs`, `ride_sessions`, `platform_passes`: Crear los *stores* vacíos desde la Fase 1 para que las Fases 2 y 3 no requieran migración de versión de `IndexedDB`.
3. **Importador/Exportador JSON (`json-io.js`)**:
   * Si el usuario sube un archivo JSON plano de lecturas (como `spicy_telemetry_pandas_dataset_2.json`[cite: 2]), detectarlo con `Array.isArray(parsed)`[cite: 3], normalizarlo e insertarlo en `telemetry_logs`.
   * Si sube un Backup Maestro (`{ version, vehicle_profile, telemetry_logs, maintenance_items, free_notes, legal_docs, ride_sessions, platform_passes }`), restaurar todas las tablas.
4. **Firebase Auth & Firestore (`firebase-sync.js`)**:
   * Configurar `GoogleAuthProvider` con botón en el Header y en `Ajustes`.
   * Sincronización *Offline-First*: cualquier cambio en `IndexedDB` actualiza la UI de inmediato y dispara un `syncToCloud()` con *debounce* de 1.5 segundos hacia `users/{uid}/snapshots/master` o subcolecciones en Firestore.

### 4.2. Pantalla Principal (`view-cockpit.js`) y Motor (`telemetry-engine.js`)
1. **Tarjeta Hero del Vehículo con Blueprint SVG**:
   * Encabezado técnico en el `Cockpit` con el dibujo vectorial SVG de líneas precisas (`stroke-width="1.25"`) del modelo activo (`Kia Picanto 1.0L`[cite: 3, 5]), mostrando placa/alias, odómetro actual, autonomía restante y estado rápido de alertas.
2. **Módulos de Telemetría (Migrados de `kia_picanto_1_0l_telemetry_dashboard.html`)**[cite: 3]:
   * **Stage 01 (Lente Óptico + Simulador + Matriz 2x2 KPIs)**: Mantener la animación de ondas y burbujas con profundidad de campo en `<canvas id="liquid-chamber-canvas">`, el deslizador lineal `.kinetic-scrubber` para simular rutas (`+0 KM`, `45K`, `RSV`, `MAX`) y los 4 KPIs (`Rendimiento`, `Costo / KM`, `Tanque 35L`, `Odómetro & Ritmo`)[cite: 3].
   * **Stage 02 (Los Monolitos - Método Pistola Pita)**: Columnas dinámicas para todos los ciclos cerrados a tanque lleno (`is_full_tank` o `gallons_added` con decimales desde `2026-07-28`) más la columna punteada del ciclo activo[cite: 2, 3].
   * **Stage 03 (Horizonte de Rodaje & ADN Semanal)**: Barras diarias interpoladas con filtro dinámico de meses (generar los botones de mes dinámicamente según las fechas presentes en `telemetry_logs`, incluyendo `OCT`[cite: 2], en lugar de dejarlos fijos de `JUN` a `SEP`[cite: 3]) y tira inferior de promedio por día de la semana (`LUN` a `DOM`)[cite: 3].
   * **Stage 04 (Bitácora Raw)**: Lista filtrable con botón para editar o eliminar una lectura mal ingresada[cite: 3].

### 4.3. Modal Interactivo "Sincronizar Medidor + KM" (`modal-sync-fuel.js`)[cite: 4]
Inspirado directamente en la funcionalidad de `SPICY`[cite: 4] pero renderizado con la estética `OCTANE // KINETIC`[cite: 3]:
1. **Control Táctil de Aguja / Nivel (`fuel-gauges/`)**:
   * El usuario arrastra con el dedo o el cursor la aguja/barra para reflejar el nivel real del tablero de su carro[cite: 4].
   * Renderiza el estilo seleccionado en el perfil del vehículo:
     * `spicy-arc`: Arco derecho con marcas `F`, divisiones intermedias, `1/4` en color ámbar y `E` en rojo con aguja roja/ámbar pivotante[cite: 4].
     * `analog-180`: Medidor semicircular horizontal clásico.
     * `digital-lcd`: Columnas o bloques digitales clicables/arrastrables (para tableros digitales).
     * `sight-glass`: Cilindro vertical interactivo[cite: 3].
2. **Lecturas e Inputs del Formulario**[cite: 4]:
   * Indicadores grandes en vivo debajo del medidor: **`XX%` Nivel de combustible** y **`XX.X L / X.XX GAL` Capacidad estimada en tanque** (calculado sobre los `35.0 L` configurables del vehículo)[cite: 3, 4].
   * Input numérico **`Kilometraje en tu odómetro (KM)`** con el último odómetro como valor base y botones de ajuste rápido (`-0.5`, `+0.5`, `+1`, `+10`)[cite: 4].
   * Selector de **`Fecha de Lectura`** (por defecto hoy en formato `YYYY-MM-DD`)[cite: 2, 4].
   * Sección desplegable **`+ Registrar Tanqueada (Suministro)`**:
     * `Galones añadidos` (con soporte de 3 decimales como `7.087`[cite: 2]) o `Litros añadidos`.
     * `Costo Total Suministro ($)`[cite: 4] (autocalcula el precio por galón o viceversa).
     * Checkbox `Tanqueo a Full (Pistola Pita)` (se marca automáticamente si el usuario ingresa decimales en los galones o pone el medidor al `100%`)[cite: 2, 3].

---

## 5. Orquestación de Subagentes (Sin Colisión de Archivos)

* **SUBAGENTE 1A — Core, IndexedDB, Firebase & JSON I/O**:
  * **Archivos asignados**: `package.json`, `vite.config.js`, `tailwind.config.js`, `index.html`, `src/style/tokens.css`, `src/core/state.js`, `src/core/db-local.js`, `src/core/firebase-sync.js`, `src/core/json-io.js`.
  * **Entregable**: Base de datos local operativa, login con Google, sincronización con Firestore e importación limpia de `spicy_telemetry_pandas_dataset_2.json`[cite: 2].
* **SUBAGENTE 1B — Motor de Telemetría, Cockpit & Catálogo SVG**:
  * **Archivos asignados**: `src/core/telemetry-engine.js`, `src/assets/vehicles-svg/*`, `src/views/view-cockpit.js`, `src/components/header-bar.js`, `src/components/nav-dock.js`.
  * **Entregable**: `Cockpit` funcional con el wireframe SVG del Picanto, Lente de Fluido, Simulador de Ruta, Monolitos dinámicos, Espectro con meses autogenerados y Bitácora editable[cite: 3, 4].
* **SUBAGENTE 1C — Medidores Interactivos Multi-Estilo & Modal de Sincronización**:
  * **Archivos asignados**: `src/components/fuel-gauges/*`, `src/components/modals/modal-sync-fuel.js`, `src/views/view-settings.js`, `src/main.js`.
  * **Entregable**: Los 4 medidores interactivos arrastrables (incluyendo el arco `SPICY`[cite: 4]), el modal de sincronización de nivel + odómetro + tanqueada[cite: 4] y la vista de Ajustes.