# PLAN DE IMPLEMENTACIÓN 1.5: SILENCIO VERBAL, ONBOARDING TÁCTIL Y MOTOR UNIVERSAL DE TANQUEO

## 1. Purga de Jerga y Defectos Críticos (Auditoría de Fase 1)
Esta fase corrige de raíz la verbosidad, los controles redundantes y la jerga personalizada que un usuario nuevo no entendería:

1. **Eliminación Total de Jerga Interna (`FULL•ERA` y `Pistola Pita`)**:
   * Eliminar el botón `FULL•ERA` de la barra superior (`header-bar.js`)[cite: 3, 7, 11].
   * En el Stage 02 (`view-cockpit.js`), reemplazar el subtítulo `02 / MÉTODO PISTOLA PITA` por `02 / CICLOS DE CONSUMO` y el título `X CICLOS CERRADOS` por `RENDIMIENTO POR CICLO`[cite: 3, 11].
   * En los modales, reemplazar cualquier mención a `Pistola Pita` por `TANQUE LLENO (100%)`.
2. **Erradicación de Verbosidad (Prohibidos los Párrafos `<p>`)**:
   * Eliminar todas las cajas con párrafos explicativos en `Cockpit`, `Clúster` y `Guantera`[cite: 7, 8, 9]. Ninguna etiqueta estática de la UI puede superar **3 o 4 palabras**.
3. **Eliminación del Resplandor Neón en el Dock**:
   * Remover todo `box-shadow`, `filter: drop-shadow` o gradiente difuminado del dock inferior[cite: 7, 8, 9]. Todo el sistema es plano con bordes de `1px solid var(--line-hair)`[cite: 3].
4. **Separación de `Lectura` y `Tanqueada` con Memoria de Estado**:
   * El botón central `+` del dock[cite: 7] ya no abre un formulario mixto, sino un selector geométrico plano con dos acciones independientes: `01 / LECTURA` y `02 / TANQUEADA`.
   * El modal `01 / LECTURA` elimina los 13 botones redundantes (`ARCO | 180° | LCD | LENTE`, `0%..100%`, `-0.5..+10`)[cite: 10], opera con control **100% táctil sobre la aguja** y precarga siempre el último `%` de tanque y el último odómetro guardados en `IndexedDB`[cite: 2, 4].

---

## 2. Flujo de Onboarding Visual (4 Pasos Cero-Verbosidad)
Cuando `IndexedDB` no tiene un perfil configurado (`vehicle_profile` vacío), o cuando el usuario pulsa `RECALIBRAR PERFIL` en `Ajustes`, se despliega un asistente de pantalla completa (`src/components/modals/modal-onboarding.js`) basado en tarjetas interactivas grandes, sin párrafos:

* **PASO 01 / CHASIS & TANQUE**:
  * Selector visual con siluetas SVG CAD: `HATCHBACK (35L)` (Picanto/Spark/Kwid)[cite: 3], `SEDÁN / COMPACTO (45L)` (Mazda 2/Onix/Sandero), `SUV / CROSSOVER (50L)` (Duster/Tracker), o `PERSONALIZADO`.
  * Input limpio de `CAPACIDAD TANQUE (L / GAL)` y `ODÓMETRO INICIAL (KM)`.
* **PASO 02 / MEDIDOR DE TABLERO**:
  * Cuadrícula 2x2 con previsualización animada en vivo de los 4 medidores para que el usuario elija el idéntico a su carro:
    1. `ARCO VERTICAL` (Estilo analógico lateral `F` a `E`)[cite: 4, 10]
    2. `DIAL 180°` (Semicírculo clásico central)[cite: 10]
    3. `BARRAS LCD` (Segmentos digitales de 8/10/12 bloques)[cite: 10]
    4. `CILINDRO ÓPTICO` (Lente de fluido continuo)[cite: 3, 10]
* **PASO 03 / HÁBITO DE TANQUEO**:
  * El usuario elige cómo suele echar gasolina (define el comportamiento del modal `02 / TANQUEADA` y del motor matemático):
    * **Opción A — `SIEMPRE A FULL`**: Llena hasta que el surtidor se detiene (ej. baja a 25% o 50% y llena a 100%).
    * **Opción B — `GALONES EXACTOS`**: Pide siempre una cantidad exacta de galones (ej. 5 gal, 6 gal) sin llegar necesariamente al 100%.
    * **Opción C — `MONTO FIJO ($)`**: Pide un valor cerrado en pesos (ej. $40.000, $50.000, $80.000 COP).
    * **Opción D — `MIXTO / VARIABLE`**: Combina tanqueadas parciales y llenados a full.
* **PASO 04 / USO DEL VEHÍCULO**:
  * Dos tarjetas: `USO PERSONAL` (oculta el módulo de carreras) vs `PERSONAL + CARRERAS (APPS)` (activa la pestaña `Carreras` en el dock y pide `KM RUTINA DIARIA`, ej. `24 KM`).
  * Botón inferior alternativo en el Paso 1: `[↑ YA TENGO UN BACKUP JSON]` para saltar el onboarding importando datos directo.

---

## 3. Motor Matemático Universal de Consumo (`src/core/telemetry-engine.js`)
El motor ya no depende exclusivamente de que el usuario llene el tanque a full, sino que combina dos algoritmos de precisión según el tipo de recarga:

### 3.1. Algoritmo Dual (Anclas Full + Compensación por Delta de Aguja)
1. **Ciclos Cerrados `Full-to-Full` (Máxima Certeza)**:
   * Cuando existen dos recargas marcadas como `is_full_tank: true`, el consumo exacto del periodo es:
     $$\text{Galones Consumidos} = \sum \text{Galones añadidos desde el último Full}$$
     $$\text{Rendimiento} = \frac{\text{Odo}_{\text{Full Actual}} - \text{Odo}_{\text{Full Previo}}}{\text{Galones Consumidos}}$$
2. **Ciclos de Galones Exactos o Monto Fijo (`is_full_tank: false`)**:
   * Para usuarios que tanquean por galones exactos (ej. `6.00 gal`)[cite: 1, 2] o por monto en pesos sin llenar el tanque, el motor calcula el consumo real entre el estado antes de tanquear en el ciclo $i$ y el estado antes de tanquear en el ciclo $i+1$ compensando la diferencia de nivel del medidor:
     $$\Delta \text{Tanque Gal} = \left(\frac{\text{Nivel}_{i} - \text{Nivel}_{i+1}}{100}\right) \times \text{CapacidadTanqueGal}$$
     $$\text{Galones Consumidos} = \text{Galones Añadidos}_{i} + \Delta \text{Tanque Gal}$$
     $$\text{Rendimiento Ciclo Parcial} = \frac{\text{Odo}_{i+1} - \text{Odo}_{i}}{\text{Galones Consumidos}}$$
3. **Generación Unificada para el Stage 02 (`Monolitos`)**:
   * El Stage 02 muestra las últimas 7 barras de ciclos cerrados (sean `Full` o `Parciales Compensados`) más la 8.ª barra del ciclo activo en curso[cite: 3, 11], permitiendo que cualquier usuario vea sus barras de rendimiento desde su segunda tanqueada sin importar su hábito.

---

## 4. Especificación de Modales Táctiles (`Lectura` vs `Tanqueada`)

### 4.1. Modal `01 / LECTURA` (`src/components/modals/modal-reading.js`)
* **Propósito**: Actualizar dónde está la aguja hoy y qué marca el odómetro en 3 segundos.
* **Regla de Memoria**: Al abrirse, lee el último registro de `telemetry_logs` y posiciona la aguja exactamente en ese `fuel_level_percent` y el input en ese `odometer_reading`[cite: 2, 4].
* **Interfaz (Cero Botones Redundantes)**:
  * **Header**: `01 / LECTURA` + botón `✕`.
  * **Centro**: El medidor del usuario (ej. `Arco Vertical`)[cite: 4, 10] grande y limpio. El único control es **arrastrar directamente la aguja/barras con el dedo**.
  * **Readout Flotante**: `%` gigante (`font-sans font-light text-6xl tabular-nums`) + volumen equivalente (`8.2 L · 2.17 GAL`).
  * **Base Bipartita (`grid-cols-12 border-t border-[var(--line-hair)] divide-x divide-[var(--line-hair)]`)**:
    * Izquierda (8 cols): Label `ODÓMETRO` con delta en vivo (`+12 KM` en verde voltio) + input numérico directo en `text-4xl font-light tabular-nums`.
    * Derecha (4 cols): Label `FECHA` + fecha compacta (`20 OCT`).
  * **Acción**: Botón plano inferior de ancho completo `GUARDAR LECTURA`.

### 4.2. Modal `02 / TANQUEADA` (`src/components/modals/modal-refuel.js`)
* **Propósito**: Registrar compra de combustible adaptándose automáticamente al `refuelHabit` elegido por el usuario:
  * **Pestaña Rápida de Entrada Superior** (preseleccionada según el hábito del usuario):
    1. `A FULL (100%)`: El usuario ingresa los `GALONES` que entraron hasta el clic de la pistola (ej. `7.087`)[cite: 2]; el nivel del tanque se fija automáticamente en `100%`[cite: 2, 3].
    2. `GALONES EXACTOS`: El usuario ingresa los galones exactos (ej. `6.0`)[cite: 1, 2] y ajusta con el dedo en una mini-barra/aguja a qué nivel subió el medidor (se pre-calcula automáticamente sumando los galones al último `%` conocido).
    3. `POR MONTO ($)`: El usuario digita cuántos pesos echó (ej. `$50.000`), el sistema divide por `$/GAL` (`$15.750`) para obtener `3.175 GAL` y actualiza el nivel estimado del tanque.
  * **Base Tripartita (`grid-cols-3 border-t border-[var(--line-hair)] divide-x divide-[var(--line-hair)]`)**:
    * Celda 1: `ODÓMETRO` (precargado con el último odómetro).
    * Celda 2: `$ / GALÓN` (precargado con el último precio por galón).
    * Celda 3: `COSTO TOTAL` (autocalculado o editable).
  * **Acción**: Botón plano inferior de ancho completo `REGISTRAR TANQUEADA`.

---

## 5. Cockpit y Chasis CAD (`src/views/view-cockpit.js`)
* **El Cockpit NUNCA se oculta**: Eliminar el cartel `"Inicializa el Motor Matemático"`[cite: 7]. Los bloques Stage 01, Stage 02, Stage 03 y Stage 04 deben verse siempre como en la captura de referencia (`image_18661a.png`)[cite: 11].
* **Cabecera CAD Compacta (`h-28`)**:
  * Grilla `grid-cols-12 flat-frame`: 4 columnas a la izquierda con `00 / CHASIS`, nombre del modelo (`PICANTO 1.0L`) y capacidad (`35L · 9.25G`)[cite: 3, 7]; 8 columnas a la derecha con el plano técnico SVG en trazos visibles `#8A8A93`, líneas de cota en `#2E2E38` y 3 puntos de telemetría en `#FF5500`.

---

## 6. Orquestación de Subagentes (Plan 1.5)
* **SUBAGENTE 1.5-A (Motor Universal & Onboarding)**: Implementa el motor híbrido (Full + Parcial Compensado) en `telemetry-engine.js`, elimina `FULL•ERA` / `Pistola Pita` del Header y Cockpit, y construye `modal-onboarding.js`.
* **SUBAGENTE 1.5-B (Split Dock & Modales Táctiles)**: Purga el glow del dock en `nav-dock.js`, crea el lanzador `+` (`01 / LECTURA` y `02 / TANQUEADA`), reconstruye `modal-reading.js` con 0 botones extra y memoria de `IndexedDB`, y crea `modal-refuel.js` adaptable por hábito.
* **SUBAGENTE 1.5-C (Cockpit CAD & Purga Verbal)**: Asegura que el Cockpit renderice siempre los Stages 01–04 fieles a `image_18661a.png`[cite: 11], corrige la visibilidad del SVG CAD y elimina todos los párrafos `<p>` de todas las vistas.
* **SUBAGENTE CRÍTICO ADVERSARIO**: Audita que no exista ni una sola aparición de `"FULL•ERA"`, `"Pistola Pita"`, etiquetas `<p>` descriptivas, sombras en el dock o botones de porcentaje en el modal de lectura.