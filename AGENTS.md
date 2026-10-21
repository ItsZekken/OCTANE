# OCTANE // KINETIC — Reglas Obligatorias para Agentes y Desarrolladores

Cualquier agente de inteligencia artificial o desarrollador que modifique este repositorio **debe cumplir obligatoriamente** con las siguientes directrices y lineamientos de diseño:

---

## 1. Documento Rector
- Consultar y respetar siempre [DESIGN_GUIDELINES.md](file:///c:/Users/jperaltac/OneDrive%20-%20Universidad%20del%20Norte/Juan%20Camilo/Proyectos/OCTANE/DESIGN_GUIDELINES.md).
- Ningún componente nuevo o refactorizado puede violar los principios de elegancia, minimalismo, silencio verbal o separación de responsabilidades.

---

## 2. Prohibiciones Estrictas (Lista Negra)
1. ❌ **Prohibido el antipatrón de cajas dentro de cajas**: No envuelvas elementos dentro de múltiples capas de `border`, `bg-surface`, `bg-elevated` y márgenes anidados. Utiliza líneas divisorias simples (`divide-x`, `divide-y`, `border-b`) sobre un único contenedor plano.
2. ❌ **Prohibida la sobrecarga verbal y el ruido técnico**:
   - No coloques párrafos largos `<p>` en pantallas de instrumentos ni en modales.
   - No muestres estadísticas innecesarias como `[170 MODELOS]`, `ESC`, o etiquetas de depuración en la interfaz final.
3. ❌ **Prohibido colocar controles de ajustes en el Cockpit**:
   - El precio del combustible (`$ 16.000`) y las unidades (`KM/G`, `L/100`, `KM/L`) pertenecen exclusivamente a la vista de `Ajustes`.
   - El Cockpit es un instrumento de visualización operativa, no un panel de configuración.
4. ❌ **Prohibidas las alertas redundantes o contradictorias en el Cockpit**:
   - No mostrar semáforos o pastillas rojas repetitivas en el encabezado ni en la tarjeta del chasis.
   - El estado de mantenimiento pertenece al `Clúster` y los documentos a la `Guantera`.
5. ❌ **Prohibido el desbordamiento visual de macro-números**:
   - Siempre verificar que números de 5 o 6 dígitos en el odómetro (`97.395`, `150.000`) se mantengan estrictamente dentro de los límites de su caja en cualquier resolución.
6. ❌ **Prohibidos los modales flotantes pequeños para el Onboarding**:
   - El onboarding debe presentarse a pantalla completa, espacioso, limpio y guiado paso a paso.

---

## 3. Protocolo de Verificación
Antes de dar por completada una tarea:
1. Comprobar que el build de producción finaliza sin errores: `npm run build`.
2. Ejecutar las pruebas automatizadas del proyecto: `node tests/test-core.js`.
3. Validar visualmente la armonía en modo oscuro (`Modo Carbón`) y modo claro (`Modo Papel`).
