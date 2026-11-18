# OCTANE // KINETIC — Reglas Obligatorias para Agentes y Desarrolladores

Cualquier agente de inteligencia artificial o desarrollador que modifique este repositorio **debe cumplir obligatoriamente** con las siguientes directrices y lineamientos de diseño:

---

## 1. Documentos Rectores
- Consultar y respetar siempre:
  1. [DESIGN_GUIDELINES.md](file:///c:/Users/jperaltac/OneDrive%20-%20Universidad%20del%20Norte/Juan%20Camilo/Proyectos/OCTANE/DESIGN_GUIDELINES.md) (Sistema de Diseño Industrial y Silencio Verbal).
  2. [ARCHITECTURE.md](file:///c:/Users/jperaltac/OneDrive%20-%20Universidad%20del%20Norte/Juan%20Camilo/Proyectos/OCTANE/ARCHITECTURE.md) (Arquitectura de Software y Persistencia).
  3. [README.md](file:///c:/Users/jperaltac/OneDrive%20-%20Universidad%20del%20Norte/Juan%20Camilo/Proyectos/OCTANE/README.md) (Visión General y Comandos).
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
6. ❌ **Prohibidos los modales flotantes pequeños para el Onboarding o Detalle de Viajes**:
   - El onboarding y las fichas cinemáticas deben presentarse a pantalla completa (`100dvh`), espaciosos, limpios y guiados paso a paso.
7. ❌ **Prohibidas las etiquetas inventadas o inferencias falsas**:
   - No añadir etiquetas ficticias como `"A/C SOLAR"` o `"RALENTÍ A/C"` basadas en conjeturas de la hora del día.
8. ❌ **Prohibido hardcodear credenciales en el código fuente**:
   - Cero usuarios, contraseñas, IMEIs o tokens en código (`JGN691`, `Spicy691`, etc.). Siempre leer de `localStorage` o `vehicleProfile.gpsConfig`.

---

## 3. Protocolo de Verificación Obligatorio
Antes de dar por completada una tarea o realizar un despliegue:
1. Comprobar que el build de producción finaliza sin errores: `npm run build`.
2. Ejecutar la suite completa de pruebas:
   ```bash
   node tests/test-core.js
   node tests/test-gps-trips-modal.js
   node tests/test-rides-engine.js
   ```
3. Validar la armonía visual en modo oscuro (`Modo Carbón`) y modo claro (`Modo Papel`).
4. Verificar que no se hayan introducido credenciales con `Select-String`.
