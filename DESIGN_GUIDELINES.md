# OCTANE — SISTEMA DE DISEÑO INDUSTRIAL Y ESPECIFICACIÓN MAESTRA V2

## 1. Manifiesto de Diseño: Minimalismo Transgresor y Silencio Verbal

OCTANE es un instrumento automotriz de precisión inspirado en la relojería contemporánea, Dieter Rams (Braun) y Teenage Engineering. No es un dashboard corporativo ni una plantilla llena de cajas.

### 1.1. Reglas de Oro del Lenguaje Visual y Verbal
1. **Marca y Nomenclatura Única**:
   * La marca principal en el encabezado es **OCTANE** acompañada del subtítulo discreto `TELEMETRÍA VEHICULAR`.
   * **Prohibido el uso de `//` y de prefijos numéricos (`00 /`, `01 /`, `STAGE 02`)**: Quedan erradicados títulos compuestos como `CLÚSTER // INSTRUMENTACIÓN`, `GUANTERA // VIGILANCIA LEGAL`, `CARRERAS // CONTABILIDAD & ROI` o `REGISTRAR // DOCUMENTO LEGAL`. Cada sección, tarjeta o modal lleva **un único nombre directo** (`Clúster`, `Guantera`, `Carreras`, `Ajustes`, `Nueva Lectura`, `Nueva Tanqueada`).
2. **Cero Jerga Técnica de Programación**:
   * El usuario final jamás debe leer términos internos como `"IndexedDB"`, `"JSON"`, `"RAW"`, `"STAGE"`, `"FASE 3"`, `"FULL•ERA"` o `"MODO LOCAL OFFLINE"`.
   * Traducciones obligatorias a lenguaje humano:
     * `"Datos guardados en IndexedDB"` -> `"Guardado en este dispositivo"`
     * `"EXPORTAR BACKUP"` / `"IMPORTAR JSON"` -> `"EXPORTAR COPIA DE SEGURIDAD"` / `"IMPORTAR COPIA DE SEGURIDAD"`
     * `"REINICIAR APP"` -> `"BORRAR TODOS LOS DATOS"`
3. **Silencio Verbal Absoluto**:
   * Prohibidos los párrafos explicativos (`<p>`), subtítulos redundantes y estados vacíos verbosos (`"BITÁCORA // CERO REGISTROS"`).
   * La jerarquía se construye exclusivamente mediante el contraste entre **Micro-Labels** (`font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-secondary)]`) y **Macro-Valores** (`font-sans font-light text-5xl sm:text-6xl tracking-tighter tabular-nums text-[var(--text-primary)]`).
4. **Erradicación de "Cajas dentro de Cajas" y Placeholders Ruidosos en Modales**:
   * En todos los modales y formularios queda prohibido encerrar cada input dentro de un recuadro con borde completo (`.flat-cell` anidado en `.flat-frame`).
   * **Inputs de Línea Inferior Única (Underline Inputs)**: Todo campo de texto o número debe ser transparente (`bg-transparent`), sin bordes laterales ni superiores, con únicamente una línea inferior de `1px` (`border-b border-[var(--line-hair)] focus:border-[var(--accent-amber)] transition-colors py-2`).
   * **Prohibidos los placeholders de ejemplo**: Eliminar textos como `EJ. #849201`, `EJ. SEGUROS SURA / CDA`, `EJ. COBERTURA ASISTENCIA GRÚA 24/7`. El campo vacío debe estar completamente limpio o mostrar un guion sutil `—` con opacidad `0.2`.

---

## 2. Navegación Simétrica y FAB Contextual Flotante

1. **Dock Inferior Centrado de 5 Pestañas (`nav-dock.js`)**:
   * El botón naranja `+` se retira del dock inferior para eliminar la asimetría.
   * El dock inferior contiene únicamente las 5 vistas con ancho idéntico (`grid-cols-5` o `grid-cols-4` si el módulo de carreras está desactivado): `Cockpit`, `Clúster`, `Guantera`, `Carreras`, `Ajustes`.
2. **True FAB Flotante en Esquina Inferior Derecha (`fab-contextual.js`)**:
   * Botón flotante independiente (`fixed bottom-20 right-6 md:bottom-8 md:right-8 z-50 w-14 h-14 bg-[var(--accent-amber)] text-[var(--bg-void)] flex items-center justify-center border border-white/10 transition-transform active:scale-95`).
   * **Comportamiento Contextual según la Pestaña Activa**:
     * **En `Cockpit`**: Al tocarlo despliega 2 píldoras flotantes limpias encima del FAB: `Registrar lectura` y `Registrar tanqueada`.
     * **En `Clúster`**: Despliega `Nueva nota` y `Nuevo componente`.
     * **En `Guantera`**: Abre directamente el modal `Nuevo documento`.
     * **En `Carreras`**: Despliega `+ Carrera` y `- Egreso`.
     * **En `Ajustes`**: El FAB se oculta (`hidden`) para no estorbar la configuración.

---

## 3. Especificación por Módulo

### 3.1. COCKPIT (`src/views/view-cockpit.js`)

1. **Cabecera del Vehículo**:
   * Izquierda: Nombre del modelo (`Kia Picanto 1.0L`), capacidad (`35.0 L · 9.25 GAL`) y estado general.
   * Derecha: Silueta SVG del vehículo renderizada en el color elegido por el usuario (`var(--car-paint)`), estrictamente contenida dentro de su contenedor (`max-h-28 w-auto mx-auto object-contain overflow-hidden`) para que jamás se desborde ni toque los bordes.
2. **Prioridad #1 — El Kilometraje como Contador Mecánico Protagonista**:
   * En la columna izquierda del bloque principal, justo debajo del lente circular animado de combustible, se eliminan los textos pequeños `"ÚLTIMO REGISTRO 97.395 KM"` y `"NIVEL DISPONIBLE 35% · 3.25 GAL"`.
   * En ese espacio inferior completo, ocupando el 100% del ancho de la columna izquierda, se ubica el **Odómetro Principal con estética de Contador Mecánico de Precisión (Split-Roller / Drum Counter)**:
     * Micro-label centrado o superior izquierdo: `KILOMETRAJE ACTUAL` junto al badge de ritmo diario (`28.3 KM/DÍA`).
     * Hilera de dígitos individuales en celdas arquitectónicas (`flex items-center justify-center gap-1.5 py-3`): cada dígito (`0`–`9`) se aloja en una cápsula vertical (`w-10 sm:w-12 h-14 sm:h-16 bg-[var(--bg-void)] border border-[var(--line-strong)] flex items-center justify-center font-mono text-3xl sm:text-4xl font-medium tabular-nums text-[var(--text-primary)]`) con una sutil línea horizontal divisoria central o gradiente superior/inferior que evoca el tambor mecánico de un odómetro clásico, más la etiqueta `KM` en `--accent-amber`.
   * En la columna derecha (matriz de métricas secundarias), al haber pasado el Odómetro a ser el protagonista bajo el tanque, las 4 celdas limpias quedan dedicadas a:
     1. `RENDIMIENTO` (`36.02 KM/GAL` · `9.5 KM/L`).
     2. `COSTO POR KM` (`$444 COP/KM` · basado en el precio real del último tanqueo).
     3. `AUTONOMÍA TANQUE LLENO` (`333 KM` · `286 KM SIN RESERVA`).
     4. `GASTO COMBUSTIBLE MES` (Total invertido en el mes actual + comparativa porcentual frente al mes anterior).
3. **Fusión de `Bitácora Raw` dentro de `Rendimiento por Ciclo`**:
   * **Se elimina por completo la sección `04 / BITÁCORA RAW` del final del Cockpit**.
   * En la sección `Rendimiento por Ciclo`, las barras verticales representan cada ciclo de tanqueo (incluyendo el ciclo activo en color ámbar).
   * Debajo de las barras de ciclos se integra un **Panel Desplegable de Detalle del Ciclo**: al hacer clic en cualquier barra de ciclo (o por defecto mostrando el ciclo activo), se despliega una línea de tiempo limpia y minimalista con las lecturas de aguja y la tanqueada que componen ese ciclo, permitiendo editar o borrar cualquier registro sin tablas llenas de guiones (`—`).

---

### 3.2. CLÚSTER (`src/views/view-cluster.js`)

1. **Diales con Iconografía Diferenciada y Edición Completa**:
   * Se mantienen los medidores semicirculares de desgaste (`KM REST.`), pero cada tarjeta incorpora un **Ícono Vectorial Protagonista** en la parte superior/central del arco para que el usuario identifique el componente de un vistazo sin tener que leer primero el título.
   * **Librería de Íconos Integrada (`src/components/cluster/icons-catalog.js`)**: Incluir al menos 12 íconos SVG minimalistas de trazo fino: `Aceite (Gota/Alcuza)`, `Filtro de Aire/Cabina (Rejilla/Viento)`, `Frenos (Disco/Pastilla)`, `Gasolina (Surtidor)`, `Llantas (Neumático)`, `Bujías/Motor (Chispa/Rayo)`, `Correa/Cadena (Engranajes)`, `Batería`, `Refrigerante (Termómetro)`, `Suspensión (Amortiguador)`, `Transmisión/Caja`, `General (Llave inglesa)`.
   * **Acciones por Componente**:
     * Al tocar el botón de edición (`✎` o menú del componente), abre un modal limpio donde el usuario puede: **Cambiar el nombre**, **Elegir otro ícono de la grilla**, **Modificar el intervalo de kilómetros**, o **Eliminar el componente**.
     * Al registrar un cambio/mantenimiento (`Actualizar`), el formulario permite **modificar libremente la fecha y el kilometraje** para poder registrar mantenimientos pasados.
2. **Bitácora Abierta (Rediseño de Captura y Categorías Editables)**:
   * **Área de Texto Amplia**: Reemplazar el input estrecho de una sola línea por un `<textarea rows="3">` limpio, sin bordes laterales, de ancho completo, que invite a escribir notas extensas sin sensación de límite.
   * **Chips Interactivos Inferiores**:
     * **Chip de Fecha Modificable**: Muestra por defecto `Hoy (21 Oct)` pero al tocarlo abre el selector de fecha para registrar notas o mantenimientos de días pasados.
     * **Chip de Kilometraje Modificable**: Activo por defecto con el kilometraje actual (`97.395 KM`), editable al tocarlo o desactivable si es una nota atemporal.
     * **Gestor de Categorías Dinámico**: Las etiquetas (`Mecánica`, `Repuesto`, `Ruido`, `General`) son completamente gestionables por el usuario: incluir un botón `+ Categoría` que permita agregar nuevas etiquetas, renombrar las existentes o eliminarlas con una `×`.

---

### 3.3. GUANTERA (`src/views/view-glovebox.js`)

1. **Layout Vertical Minimalista de Alta Jerarquía**:
   * Eliminar la grilla apretada de 3 columnas llenas de guiones.
   * Diseñar una **Pila Vertical de Tarjetas Horizontales (`space-y-3`)** donde cada documento ocupa todo el ancho del contenedor:
     * **Izquierda**: Nombre del documento en tamaño grande (`SOAT`, `Revisión Tecnomecánica`, `Impuesto Vehicular`) + subtítulo discreto en `JetBrains Mono` con la fecha exacta de vencimiento (`Vence: 14 Feb 2027`) y una barra lateral vertical de `3px` que indica el estado (`#10B981` vigente, `#FF5500` próximo a vencer, `#F43F5E` vencido).
     * **Derecha**: El **Conteo Regresivo Gigante** (`142` en `text-4xl sm:text-5xl font-light tabular-nums` + `DÍAS` en `10px mono`). Si aún no tiene registro, muestra un único botón limpio `+ Configurar`.
2. **Acordeón de Detalles bajo Demanda**:
   * Los metadatos secundarios (`Número de póliza/referencia`, `Entidad aseguradora`, `Valor pagado`, `Notas`) permanecen ocultos en la vista principal para mantener limpieza visual y se despliegan suavemente al tocar la fila del documento, mostrando ahí el botón de `Copiar póliza` en un toque y `Editar / Eliminar`.

---

### 3.4. CARRERAS (`src/views/view-rides.js`) — Rediseño Total Centrado en Velocidad

1. **Filosofía Cero Fricción y Agnóstica de Plataformas**:
   * **Eliminar toda mención quemada a `DiDi` o `InDrive`**, así como las cajas de `DIDI BILLETE / PASE` e `INDRIVE SALDO`. La app jamás asume en qué plataformas trabaja el usuario ni cómo le cobran.
2. **Flujo Ultrarrápido para Registrar una Carrera (`+ Carrera` en el FAB)**:
   * Un modal minimalista diseñado para completarse en menos de 4 segundos:
     1. **Input Gigante 1 — `Valor Bruto ($)`**: Teclado numérico directo.
     2. **Input Gigante 2 — `Distancia (KM)`**: Teclado decimal directo (ej. `3.2`).
     3. **Switch de 2 Estados (`Tipo de Trayecto`)**:
        * **`Libre`**: Carrera normal de trabajo.
        * **`En ruta`**: Carrera que lleva al usuario hacia un destino al que ya necesitaba ir (casa, trabajo, visita).
     4. **Selector de Plataforma Personalizable (Opcional)**: Chips rápidos creados por el usuario (con un botón `+` para añadir o borrar nombres de plataformas en un toque).
     5. **Nota Libre (Opcional)** y **Fecha editable** (por defecto hoy).
3. **Flujo Simple de Deducciones (`- Egreso` en el FAB)**:
   * Cuando la plataforma le cobra una comisión, recarga o tarifa al usuario, este simplemente toca `- Egreso` y registra: **Monto ($)**, **Concepto / Plataforma (opcional)** y **Fecha**. Ese monto entra a la lista de movimientos y se resta directamente de las ganancias brutas del ciclo.
4. **Inteligencia Matemática del Ciclo (Combustible, `En ruta`, Recogidas y Desgaste)**:
   * **Selector de Ciclo en el Header de `Carreras`**: El usuario elige la ventana temporal con la que quiere evaluar su bolsillo: `Cada 3 días` | `Semanal` | `Quincenal` | `Mensual` | `Ciclo de tanque actual`.
   * **Kilometraje Habitual Base ($KM_{\text{rutina}}$)**: Se define en el onboarding/ajustes con la pregunta *"¿Cuántos kilómetros diarios recorres habitualmente sin hacer carreras?"* (ej. `24 km/día`) y se refina analizando el promedio histórico de los días sin carreras registradas.
   * **Tratamiento Inteligente de Carreras `En ruta` vs `Libres`**:
     * Si el usuario hace una o varias carreras `En ruta` en un día, los primeros kilómetros equivalentes a su trayecto habitual de regreso ($\text{Crédito de Ruta} = 0.5 \times KM_{\text{rutina}}$, ej. `12 km`) tienen **costo marginal de gasolina $0**, porque el usuario ya iba a gastar esa gasolina para ir a su destino.
     * Si la suma de kilómetros de las carreras `En ruta` de ese día supera ese trayecto directo (por ejemplo, tomó 3 carreras `En ruta` que sumaron `24 km` en vez de los `12 km` habituales), el excedente (`12 km` de desvío) **sí se suma a los Kilómetros Extra de Trabajo** y descuenta gasolina.
   * **Estimación Automática del Factor de Recogida (Kilómetros No Declarados)**:
     * Cruzando el odómetro general del vehículo en los días trabajados contra los kilómetros declarados en las carreras:
       $$\text{KM Trabajo Real del Día} = \max\left(0, \Delta\text{Odo}_{\text{día}} - KM_{\text{rutina}}\right)$$
       $$\text{KM de Recogida Estimados} = \max\left(0, \text{KM Trabajo Real del Día} - \text{KM Efectivos Declarados en Carreras}\right)$$
     * Si aún no se ha actualizado el odómetro del día, aplica el factor histórico promedio de recogida aprendido del usuario.
   * **Desgaste Obligatorio en TODAS las Carreras**:
     * Toda carrera (`Libre`, `En ruta` y kilómetros de recogida) genera desgaste real del vehículo (mayor peso, aire acondicionado más exigido, lavadas más frecuentes, llantas y aceite).
     * El motor calcula y muestra la **Reserva Sugerida por Desgaste** (configurable, por defecto `10%` del ingreso bruto o un factor por kilómetro total de carreras) para que el usuario sepa cuánto apartar.
   * **Tarjetas Limpias del Tablero de `Carreras`**:
     1. **Ganancia Neta Libre del Ciclo** (Bruto $-$ Egresos declarados $-$ Gasolina extra).
     2. **Gasolina Cubierta** (Qué porcentaje de su tanque o de su gasto de gasolina del ciclo ya está pagado por las carreras).
     3. **Kilómetros Extra Totales** (Desglosado en: `KM en carreras` + `KM estimados de recogida/desvío`).
     4. **Fondo de Desgaste Sugerido** (`$ COP` y `%` recomendado a ahorrar en este ciclo).
   * **Lista Unificada de Movimientos**: Debajo de las métricas, una lista cronológica limpia donde conviven las carreras (`+ $15.000 · 8.3 km · En ruta`) y las deducciones (`- $10.500 · Comisión/Recarga`) con opción de editar o eliminar.

---

### 3.5. AJUSTES (`src/views/view-settings.js`)

1. **Precio del Galón Inteligente**:
   * Cada tanqueada guarda en la base de datos su propio precio por galón histórico.
   * Para las estimaciones en vivo de la app, el motor usa automáticamente el precio por galón de la **última tanqueada registrada**. En `Ajustes` solo queda un campo limpio llamado `Precio estimado por galón (para simulaciones)` que se actualiza solo al tanquear o puede ajustarse manualmente.
2. **Ocultamiento Seguro de `Cambiar vehículo` y `Cambiar estilo de medidor`**:
   * En la vista principal de `Ajustes` NO deben estar expuestos ni la lista de 28 carros ni el medidor interactivo abierto (para que el usuario no sienta que tocarlos altera sus datos actuales).
   * En su lugar, se muestra una tarjeta resumen del vehículo actual (con su SVG bien contenido en su caja y del color elegido) y dos botones de acción:
     * **Botón 1: `Cambiar vehículo`**: Antes de abrir el selector, muestra un aviso claro: *"Cambiar las especificaciones del vehículo recalculará todas las métricas de autonomía y consumo"*. Al confirmar, abre un modal con:
       * Previsualización superior del SVG del carro (perfectamente escalado sin salirse de los bordes) junto a la paleta de **Color de carrocería** para ver el cambio de pintura en tiempo real.
       * Lista de modelos organizada en **Acordeones por Marca** (`Kia`, `Renault`, `Chevrolet`, `Mazda`, `Suzuki`, `Toyota`, `Nissan`, `Hyundai`, `Volkswagen`, `Personalizado`) para encontrar cualquier modelo en dos toques.
     * **Botón 2: `Cambiar estilo de medidor`**: Abre un modal dedicado con las 4 opciones (`Arco vertical`, `Dial 180°`, `Barras digitales`, `Cilindro óptico`) y el área interactiva etiquetada con **`¡Pruébalo!`** para que el usuario juegue con la aguja antes de confirmar.
3. **Sección de Datos y Cuenta Cohesiva**:
   * Estado de nube: `"Guardado en este dispositivo"` (o `"Sincronizado con Google"` si inició sesión) + botón `Vincular cuenta de Google`.
   * Respaldo manual con nombres simétricos: `Exportar copia de seguridad` y `Importar copia de seguridad`.
   * Zona crítica: Botón en rojo carmesí con texto inequívoco: **`Borrar todos los datos`** (con confirmación de seguridad).