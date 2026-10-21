# PLAN DE IMPLEMENTACIÓN 3: MÓDULO DE CARRERAS, DEADHEAD ENGINE Y TANQUE SUBSIDIADO (MINIMALISMO PURO)

## 1. Regla Rectora: Apartado Independiente, No Intrusivo y Silencioso
El módulo de carreras (`src/views/view-rides.js`) permite a los usuarios que manejan en plataformas (`DiDi`, `InDrive`, `Uber` o particulares) medir su ganancia neta real cruzando sus ingresos con el costo por kilómetro de su telemetría[cite: 3, 11], manteniendo el lenguaje visual de `image_18661a.png`[cite: 11] (cero párrafos explicativos, grillas de `1px`, tipografía `Inter Light` + `JetBrains Mono`)[cite: 3].

* **Activación No Intrusiva**: Solo aparece en el dock de navegación (`04 / CARRERAS`) si `ridesModuleEnabled === true` en el Onboarding o en `Ajustes`.

---

## 2. Arquitectura Visual de la Vista `Carreras` (`src/views/view-rides.js`)

### 2.1. Stage 01: Panel de Subsidio de Tanque + Matriz 2x2 de KPIs (Layout Idéntico al Cockpit)[cite: 3, 11]
Replica la grilla `grid-cols-1 lg:grid-cols-12` del Stage 01 del `Cockpit`[cite: 3, 11]:

* **Izquierda (7 Columnas) — INSTRUMENTO DE SUBSIDIO MENSUAL**:
  * **Top Bar (`10px mono`)**: `01 / RETORNO DE RUTA` a la izquierda · `COSTO BASE: $454 / KM` a la derecha.
  * **Readout Central Gigante**:
    * Micro-label: `GANANCIA LIBRE (MES)`.
    * Macro-número: `+$126.769` (`font-sans font-light text-5xl sm:text-6xl tracking-tighter tabular-nums text-[var(--accent-volt)]`).
    * Sub-readout: `BRUTO $193.5K  ·  COMISIÓN -$5.5K  ·  GASOLINA -$61.3K`.
  * **Barras de Progreso de Subsidio (3 Metas Automáticas)**:
    1. `META 01 / PRÓXIMO TANQUE FULL ($146K)`: Barra fina de `2px` en `--accent-amber` con porcentaje cubierto (ej. `87% PAGADO`).
    2. `META 02 / RUTA TRABAJO MES ($218K)`: Barra en `--accent-volt` (calculada como `20 días × routineDailyKm × Costo/KM`).
    3. `META 03 / GASOLINA TOTAL MES ($375K)`: Barra en `--accent-cyan` (calculada sobre el ritmo mensual total del vehículo).
  * **Tira Inferior de Billetera Operativa (`grid-cols-2 divide-x divide-[var(--line-hair)] border border-[var(--line-hair)]`)**:
    * **Celda DiDi**: Estado del pase activo (`PASE 3D · DÍA 2/3 · 0% COMISIÓN` o `SIN PASE ACTIVO`) + botón `[+ PASE]`.
    * **Celda InDrive**: Saldo prepago restante (`SALDO: $5,500 · ~4 CARRERAS`) + botón `[+ RECARGA]`.

* **Derecha (5 Columnas) — MATRIZ 2x2 DE KPIs DE CONDUCTOR (`grid-cols-2 divide-x divide-y divide-[var(--line-hair)]`)**[cite: 3, 11]:
  1. **KPI 1 — `TARIFA / KM`**:
     * Macro-número: `$2,438` (`COP / KM VIAJE`).
     * Footer: `REAL: $1,393/KM` (incluyendo km vacíos).
  2. **KPI 2 — `KM EN VACÍO (DEADHEAD)`**:
     * Macro-número: `42%` (`RATIO 1.71X`).
     * Footer: `77K VIAJE · 58K VACÍO`.
  3. **KPI 3 — `MEJOR PLATAFORMA`**:
     * Macro-número: `DIDI` (`$2,610 / KM`).
     * Footer: `INDRIVE: $1,890 / KM`.
  4. **KPI 4 — `JORNADAS MES`**:
     * Macro-número: `15` (`CARRERAS · 5 DÍAS`).
     * Footer: `PROM: +$25.3K / DÍA`.

---

## 3. Registro Dual de Sesiones (`src/components/modals/modal-ride-entry.js`)
Al pulsar `+ JORNADA` en la vista `Carreras`, se abre un modal plano con un selector superior de 2 modos según la preferencia del usuario:

### Modo A: `RESUMEN DÍA` (Para anotar rápido al final de la noche)
* **Inputs limpios en grilla**:
  * `FECHA` (hoy por defecto) + Switch `[✓] RESTAR MI RUTA HABITUAL (24 KM)`.
  * `INGRESO BRUTO DÍA ($ COP)` (input grande `tabular-nums`).
  * `COMISIONES / EGRESOS APP ($ COP)` (permite digitar el valor o marcar `[USAR PASE DIDI ACTIVO]`).
  * `KM TOTALES DE TRABAJO`: Se autocalcula leyendo el salto de odómetro de ese día en `telemetry_logs` menos los `24 km` de rutina ($\Delta\text{Odo}_{\text{día}} - 24$), o permite ingreso manual.
* **Readout Inferior en Vivo**: Muestra `GASOLINA EXTRA: -$XX,XXX` y `GANANCIA LIBRE: +$XX,XXX` antes de guardar.

### Modo B: `CARRERA × CARRERA` (Analítica de Kilómetros en Vacío)
* **Lista Dinámica de Carreras del Día**:
  * Cada fila es una tira horizontal plana de 4 celdas:
    1. Selector de App: `[DIDI]` | `[INDRIVE]` | `[DIRECTO]`.
    2. `VALOR NETO ($)`: Ej. `12321`, `19105`.
    3. `KM CARRERA`: Ej. `2.1`, `9.1`.
    4. Toggle `[PASE $10.5K]` (para indicar si en esa carrera DiDi cobró el pase de 3 días) o descuento automático de `$1,375` del saldo de InDrive.
  * Botón `[+ AÑADIR CARRERA]` para apilar todos los viajes de la noche en segundos.
* **Cálculo Automático de Kilómetros en Vacío (`Deadhead Engine` en `src/core/rides-engine.js`)**:
  * Cruza la suma de kilómetros de las carreras ($\sum \text{Km}_{\text{carrera}}$) contra el incremento real del odómetro del vehículo ese día ($\Delta\text{Odo}_{\text{día}}$):
    $$\text{Km}_{\text{trabajo\_real}} = \max\left(0, \Delta\text{Odo}_{\text{día}} - \text{Km}_{\text{rutina}}\right)$$
    $$\text{Km}_{\text{vacíos}} = \max\left(0, \text{Km}_{\text{trabajo\_real}} - \sum \text{Km}_{\text{carrera}}\right)$$
  * Si aún no hay lectura de cierre de odómetro para ese día, estima el costo de gasolina con los kilómetros en carrera y muestra un indicador `PENDIENTE LECTURA ODÓMETRO` que se actualiza solo apenas el usuario sincronice la aguja en `01 / LECTURA`.

---

## 4. Stage 02: Bitácora de Jornadas (`src/components/rides/ride-session-list.js`)
Debajo del Stage 01 en `view-rides.js`, se muestra la tabla arquitectónica de jornadas registradas:
* Cada fila muestra: `FECHA` (`19 OCT`), `CARRERAS` (`3 DIDI · 2 INDRIVE`), `KM VIAJE / KM EXTRA` (`23.9K / 41.0K`), `NETO APP` (`$55.8K`), `GASOLINA` (`-$18.6K`) y `LIBRE BOLSILLO` (`+$37.2K` en `--accent-volt`), con opción de expandir o editar la jornada en un toque.

---

## 5. Orquestación de Subagentes (Plan 3)
* **SUBAGENTE 3A — Deadhead Engine & Billetera de Pases (`DiDi` / `InDrive`)**:
  * **Archivos**: `src/core/rides-engine.js`, `src/components/rides/wallet-passes.js`.
  * **Misión**: Programar las ecuaciones de costo marginal, cruce con `telemetry_logs`, descuento de ruta habitual (`routineDailyKm`), cálculo de kilómetros vacíos y gestión de pases de 1/3 días de DiDi y bolsas de saldo de InDrive.
* **SUBAGENTE 3B — Modal Dual (`Resumen Día` vs `Carrera x Carrera`)**:
  * **Archivos**: `src/components/modals/modal-ride-entry.js`, `src/components/rides/ride-session-list.js`.
  * **Misión**: Construir el modal de captura rápida en ambos modos y la bitácora de jornadas con edición en vivo y sincronización en `IndexedDB` + `Firestore`.
* **SUBAGENTE 3C — Dashboard `Carreras` & Barras de Tanque Subsidiado**:
  * **Archivos**: `src/views/view-rides.js`, actualización de `src/core/json-io.js` y `src/components/nav-dock.js`.
  * **Misión**: Construir la vista principal de `Carreras` calcando la estética de `image_18661a.png`[cite: 11] con las 3 barras de subsidio de combustible y la matriz 2x2 de KPIs.
* **SUBAGENTE CRÍTICO ADVERSARIO**:
  * **Misión**: Auditar que las matemáticas de kilómetros vacíos no cuenten el trayecto habitual al trabajo como pérdida, que no exista ni un párrafo `<p>` en la vista, y que al actualizar el odómetro en `01 / LECTURA` se recalculen automáticamente las ganancias reales del día en `Carreras`.