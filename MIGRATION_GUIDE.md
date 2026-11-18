# OCTANE // KINETIC — Guía de Migración a Proyecto Remoto de Antigravity

Esta guía describe el procedimiento paso a paso para trasladar el entorno de desarrollo local de **OCTANE** hacia un **Proyecto Remoto de Antigravity**, garantizando que:
1. La conexión con **Firebase** permanezca 100% activa e intacta.
2. **Ningún usuario en producción** sufra pérdidas de datos, cierres de sesión o interrupciones de servicio.
3. El nuevo espacio de trabajo remoto arranque con todo el historial de código, dependencias y pruebas al día.

---

## 1. Análisis de Impacto: ¿Qué se Afecta y Qué Permanece Intacto?

| Componente | ¿Se Afecta? | Diagnóstico Técnico y Garantía |
| :--- | :---: | :--- |
| **Usuarios Activos** | 🟢 **NO** | Los usuarios finales consumen la PWA desplegada en `https://octane-86001.web.app`. El traslado del entorno de desarrollo a un contenedor remoto de Antigravity no toca los dispositivos de los usuarios ni reinicia sus sesiones locales. |
| **Base de Datos Cloud Firestore** | 🟢 **NO** | Firestore vive en los servidores de Google Cloud bajo el proyecto `octane-86001`. Ningún dato de usuario ni perfil vehicular se altera por cambiar de máquina o contenedor de desarrollo. |
| **Cloud Functions (Proxy IOPGPS)** | 🟢 **NO** | La función backend en Node.js 20 permanece desplegada y operando de forma autónoma en la región configurada. |
| **Archivos Locales no Guardados en Git** | 🔴 **SÍ (Riesgo Crítico)** | Los proyectos remotos de Antigravity se clonan o sincronizan a partir de Git. Si hay archivos sin confirmar (`uncommitted`) o no rastreados (`untracked`), **no viajarán al proyecto remoto**. |
| **Archivo `.env` (Credenciales Firebase)** | 🟡 **Atención** | Por seguridad, `.env` está en `.gitignore`. En el nuevo entorno remoto, `.env` no existirá tras clonar y debe crearse manualmente antes del build. |
| **Sesión de Firebase CLI** | 🟡 **Atención** | Las credenciales de `firebase login` en la máquina local no viajan en el repositorio. En el entorno remoto habrá que autenticar la CLI para futuros despliegues (`firebase login --no-localhost`). |

---

## 2. Fase 1: Preparación Local Obligatoria (Antes de Crear el Remoto)

Para que el proyecto remoto reciba la totalidad de las funcionalidades desarrolladas (incluyendo el nuevo módulo de cartografía GPS, el odómetro drum-counter y los motores físicos), debes confirmar todos los cambios locales y subirlos al repositorio remoto:

### Paso 1.1. Verificar y Agregar Todos los Archivos
En la terminal local de este proyecto:
```bash
# 1. Asegurar que el build actual está limpio
npm run build

# 2. Ejecutar las pruebas para garantizar integridad
node tests/test-core.js
node tests/test-gps-trips-modal.js

# 3. Agregar todos los archivos modificados y nuevos componentes
git add .

# 4. Crear el commit maestro de consolidación
git commit -m "feat: consolidate OCTANE v1.0.8 - GPS cartography, 5-tier speed palette, drum counter & offline-first sync"

# 5. Si tu repositorio remoto en GitHub/GitLab ya está configurado, haz push:
git push origin main
```

> [!NOTE]
> Si tu `origin` aún apunta al marcador temporal `TU_USUARIO/OCTANE.git`, actualízalo con tu URL real antes de hacer push:
> ```bash
> git remote set-url origin https://github.com/<TU_USUARIO>/<TU_REPO>.git
> git push -u origin main
> ```

---

## 3. Fase 2: Configuración en el Proyecto Remoto de Antigravity

Al crear el nuevo Proyecto Remoto en Antigravity apuntando a tu repositorio de Git:

### Paso 2.1. Instalación de Dependencias
Una vez abierto el proyecto remoto:
```bash
npm install
```

### Paso 2.2. Recrear el Archivo `.env` (Imprescindible para Firebase)
Copia tus variables de Firebase en el archivo `.env` de la raíz del contenedor remoto:
```bash
cp .env.example .env
```
Edita `.env` con las claves oficiales del proyecto `octane-86001`:
```ini
VITE_FIREBASE_API_KEY=<TU_API_KEY_DE_FIREBASE>
VITE_FIREBASE_AUTH_DOMAIN=octane-86001.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=octane-86001
VITE_FIREBASE_STORAGE_BUCKET=octane-86001.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=<TU_MESSAGING_SENDER_ID>
VITE_FIREBASE_APP_ID=<TU_APP_ID>
```

> [!IMPORTANT]
> Si compilas el proyecto sin `.env`, Vite dejará las variables en blanco y la aplicación arrancará en modo local *offline*. Con `.env` presente, la conexión a `octane-86001` y la sincronización con Google Auth / Firestore quedarán 100% restauradas de inmediato.

### Paso 2.3. Autenticar Firebase CLI en el Remoto
Para poder ejecutar `npm run deploy` desde el entorno remoto de Antigravity:
```bash
npx firebase login --no-localhost
```
Sigue el enlace en tu navegador, concede los permisos de tu cuenta de Google y pega el código de autorización devuelto en la terminal remota.

---

## 4. Fase 3: Protocolo de Verificación Cero-Impacto

Antes de realizar cualquier nuevo despliegue desde el proyecto remoto hacia producción, ejecuta:

1. **Pruebas de Integridad de Núcleo**:
   ```bash
   node tests/test-core.js
   node tests/test-gps-trips-modal.js
   node tests/test-rides-engine.js
   ```
2. **Build de Producción**:
   ```bash
   npm run build
   ```
3. **Comprobar Destino del Despliegue**:
   Verifica que `.firebaserc` mantenga `"default": "octane-86001"`:
   ```bash
   npx firebase use
   # Debe responder: Active project: octane-86001
   ```

Al seguir este protocolo, el nuevo entorno remoto mantendrá la continuidad absoluta del desarrollo, el despliegue a `octane-86001.web.app` seguirá siendo idéntico y los usuarios conservarán todas sus sesiones, datos en IndexedDB y registros en Firestore sin el menor contratiempo.
