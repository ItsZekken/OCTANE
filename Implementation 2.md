# PLAN DE IMPLEMENTACIÓN 2: CLÚSTER TÉCNICO, NOTAS LIBRES Y GUANTERA LEGAL (MINIMALISMO PURO)

## 1. Regla Rectora de Diseño: Silencio Verbal Absoluto
Las pestañas `Clúster` (`src/views/view-cluster.js`) y `Guantera` (`src/views/view-glovebox.js`) deben construirse como **instrumentos de precisión silenciosos**, inspirados en la funcionalidad de las capturas de `SPICY`[cite: 5, 6] y la estética `OCTANE // KINETIC` (`image_18661a.png`)[cite: 3, 11]:

* **Prohibición Estricta de Textos Descriptivos**:
  * Prohibido incluir subtítulos o párrafos como *"Cubre daños físicos del conductor..."*, *"Certificación ambiental..."* o *"Diales de desgaste en tiempo real basados en..."*[cite: 5, 6, 8, 9].
  * Cada celda habla exclusivamente a través de **Micro-Labels (`10px JetBrains Mono uppercase`)**, **Macro-Números (`Inter font-light tabular-nums`)** y **Arcos/Barras de `1px`**[cite: 3, 11].

---

## 2. Pestaña `Clúster`: Instrumentación de Desgaste (`src/views/view-cluster.js`)

### 2.1. Arquitectura Visual de la Grilla de Diales
* **Header de Sección (`h-12 flat-frame px-5 flex items-center justify-between`)**:
  * Izquierda: `01 / DESGASTE MECÁNICO` (`10px mono text-[var(--text-secondary)]`).
  * Derecha: Botón `.flat-pill` `+ COMPONENTE` para añadir nuevos ítems al clúster.
* **Matriz de Celdas (`grid-cols-2 lg:grid-cols-3 divide-x divide-y divide-[var(--line-hair)] border border-[var(--line-hair)]`)**[cite: 3, 11]:
  * Ítems por defecto en `maintenance_items`:
    1. `ACEITE + FILTRO` (Intervalo base: `5,000 KM`)[cite: 6]
    2. `FILTRO CABINA A/C` (Intervalo base: `15,000 KM`)[cite: 6]
    3. `LÍQUIDO FRENOS` (Intervalo base: `30,000 KM`)[cite: 6]
    4. `FILTRO GASOLINA` (Intervalo base: `90,000 KM`)[cite: 6]
    5. `ROTACIÓN LLANTAS` (Intervalo base: `10,000 KM`)[cite: 6]
    6. `BUJÍAS / CORREA` (Intervalo base: `40,000 KM`)

### 2.2. Anatomía Interna de Cada Celda de Desgaste (`wear-dial-card.js`)
Cada celda `.flat-cell p-5 flex flex-col justify-between min-h-[210px]` contiene únicamente 4 elementos visuales:
1. **Top Row**: Nombre del ítem (`ACEITE + FILTRO` en `10px mono uppercase tracking-widest text-[var(--text-secondary)]`)[cite: 6] + punto indicador de estado (`w-1.5 h-1.5 rounded-full` en `--accent-volt`, `--accent-amber` o `--accent-crimson`)[cite: 3, 11].
2. **Center Instrument (Arco SVG de 240° + Aguja Minimalista)**[cite: 6]:
   * Arco de fondo en `stroke="var(--line-strong)"` (`stroke-width="2"`) y arco activo coloreado según el `%` de vida restante:
     * `> 30%`: `--accent-volt` (`#10B981`)[cite: 3, 6]
     * `10% – 30%`: `--accent-amber` (`#FF5500`)[cite: 3, 6]
     * `< 10%`: `--accent-crimson` (`#F43F5E`)[cite: 3]
   * Dentro o justo debajo del arco:
     * Número grande: `3,838` (`font-sans font-light text-3xl sm:text-4xl tracking-tighter tabular-nums`)[cite: 3, 6].
     * Unidad: `KM REST.` (`font-mono text-[10px] text-[var(--text-secondary)]`)[cite: 6].
3. **Bottom Telemetry Strip (`pt-2.5 border-t border-[var(--line-hair)] flex items-center justify-between font-mono text-[10px]`)**[cite: 3, 11]:
   * Izquierda: `ÚLT: 93,733 KM`[cite: 6].
   * Derecha: Dos micro-botones táctiles: `[HISTORIAL]`[cite: 6] y `[↻ RESET]`.
4. **Cálculo Reactivo**:
   * Toma siempre el `odometer_reading` más alto de `telemetry_logs` (`currentOdo`)[cite: 2, 3]:
     $$\text{KM Restantes} = \max\left(0, (\text{lastServiceOdo} + \text{intervalKm}) - \text{currentOdo}\right)$$
   * Al pulsar `[↻ RESET]`, abre un mini-modal plano con `ODÓMETRO ACTUAL` precargado, `COSTO ($)` y `REFERENCIA / NOTA` (ej. `10W-30 Sintético`), guardando el cambio anterior en el arreglo `history[]` del ítem.

---

## 3. Pizarra de Notas Libres en `Clúster` (`src/components/cluster/free-notes-board.js`)
Debajo de la matriz de diales en `view-cluster.js`, se ubica el bloque `02 / BITÁCORA ABIERTA`:

* **Barra de Captura Rápida Inline (1 sola línea)**:
  * Input limpio `ESCRIBIR NOTA TÉCNICA O REFERENCIA...` + selector de etiqueta (`MECÁNICA` | `REPUESTO` | `RUIDO` | `GENERAL`) + toggle `[FECHA: ON/OFF]` + toggle `[SELLAR KM: 97,395]` + botón `+`.
* **Grilla de Tarjetas (`grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[var(--line-hair)]`)**:
  * Cada nota muestra únicamente:
    * Top strip (`10px mono`): Etiqueta de color + Fecha (si `isDated === true`, o `PERMANENTE` si `false`) + Odómetro sellado (`@ 97,395 KM` si aplica) + iconos `[PIN]` y `[×]`.
    * Cuerpo: Título en `font-sans font-medium text-sm text-[var(--text-primary)]` y nota concisa en `font-mono text-xs text-[var(--text-secondary)]`.

---

## 4. Pestaña `Guantera`: Vigilancia Legal (`src/views/view-glovebox.js`)

### 4.1. Grilla Arquitectónica de Documentos (`legal_docs` store)[cite: 5]
Reemplaza las tarjetas verbosas por una matriz técnica `.flat-frame` con 3 bloques principales por defecto + botón `+ PÓLIZA / DOC`:
1. **`01 / SOAT`**[cite: 5]
2. **`02 / TECNOMECÁNICA`**[cite: 5]
3. **`03 / IMPUESTO VEHICULAR`**[cite: 5]

### 4.2. Anatomía de Cada Celda Legal (Cero Párrafos)
Cada tarjeta se divide en una estructura horizontal de alta densidad inspirada en `image_18661a.png`[cite: 11]:
* **Header de Celda**:
  * Izquierda: Nombre (`SOAT` / `TECNOMECÁNICA` / `IMPUESTO ANUAL`)[cite: 5].
  * Derecha: Píldora de estado (`.flat-pill`): `VIGENTE` (`--accent-volt`), `POR VENCER` (`--accent-amber`), `VENCIDO` (`--accent-crimson`) o `SIN REGISTRO` (`--text-muted`)[cite: 3, 5].
* **Cuerpo Principal (Cuenta Regresiva Gigante)**:
  * Si tiene registro: Número gigante con los **Días Restantes** (ej. `142` en `font-sans font-light text-5xl sm:text-6xl tabular-nums`) + `DÍAS RESTANTES` (`10px mono`)[cite: 3, 11].
  * Si no tiene registro: Mostrar `—` en `text-5xl font-light text-[var(--text-muted)]` y botón centrado `[+ REGISTRAR FECHA]`[cite: 5].
* **Barra Lineal de Vigencia (`h-1 bg-[var(--line-strong)] my-3`)**:
  * Relleno proporcional a `(díasRestantes / 365) * 100%`.
* **Footer de Metadatos (`grid-cols-3 divide-x divide-[var(--line-hair)] border-t border-[var(--line-hair)] pt-2.5 font-mono text-[10px]`)**:
  * Col 1: `VENCE` -> `14 FEB 2027`.
  * Col 2: `REF / PÓLIZA` -> `#849201 [COPIAR]`.
  * Col 3: `COSTO` -> `$487K` + botón `[EDITAR]`[cite: 5].

---

## 5. Orquestación de Subagentes (Plan 2)
* **SUBAGENTE 2A — Matriz de Diales de Desgaste (`Clúster`)**:
  * **Archivos**: `src/views/view-cluster.js`, `src/components/cluster/wear-dial-card.js`, `src/components/modals/modal-maintenance.js`.
  * **Misión**: Construir la grilla de diales SVG de 240° reactivos al odómetro (`KM REST.` y `ÚLT: XX,XXX KM`)[cite: 6] con modal de reset e historial.
* **SUBAGENTE 2B — Bitácora de Notas Libres**:
  * **Archivos**: `src/components/cluster/free-notes-board.js`, `src/core/notes-service.js`.
  * **Misión**: Construir el módulo de notas fechadas y permanentes con sello de odómetro, pines y filtros por categoría.
* **SUBAGENTE 2C — Guantera Legal & Semáforo de Alertas**:
  * **Archivos**: `src/views/view-glovebox.js`, `src/components/modals/modal-legal-doc.js`, `src/core/alerts-engine.js`.
  * **Misión**: Construir las celdas de SOAT, Tecnomecánica e Impuesto[cite: 5] basadas en cuenta regresiva de días y conectar alertas críticas (`<15 días` o `<500 km`) al header del `Cockpit`.
* **SUBAGENTE CRÍTICO ADVERSARIO**:
  * **Misión**: Verificar que no exista ni un solo párrafo explicativo en `Clúster` ni `Guantera`, que los diales se recalculen instantáneamente al cambiar el odómetro en `Lectura`, y que todos los datos persistan en `IndexedDB` y `Firestore`.