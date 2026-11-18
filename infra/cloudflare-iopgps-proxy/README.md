# OCTANE // KINETIC — Private IOPGPS Proxy (Cloudflare Worker)

Proxy CORS privado y sin estado para conectar OCTANE (Firebase Hosting / PWA) directamente con `iopgps.com` y `open.iopgps.com` sin depender de puentes CORS públicos de terceros.

## Características de Seguridad
- **Cero credenciales almacenadas**: El Worker no guarda usuarios, contraseñas ni tokens.
- **Pre-hash en el cliente**: OCTANE calcula el hash `md5(password) + md5(salt)` localmente en el navegador y envía `isPreHashed: true`.
- **Orígenes restringidos (`ALLOWED_ORIGINS`)**: Permite limitar el acceso exclusivamente a tu dominio de Firebase Hosting y `localhost`.

## Despliegue en Cloudflare Workers (Gratis)

### Opción A — Panel Web de Cloudflare
1. Ingresa a [dash.cloudflare.com](https://dash.cloudflare.com) -> **Workers & Pages** -> **Create** -> **Create Worker**.
2. Asigna un nombre (ej. `octane-iopgps-proxy`) y haz clic en **Deploy**.
3. Haz clic en **Edit code**, pega el contenido completo de `worker.js` y pulsa **Deploy**.
4. Ve a **Settings -> Variables and Secrets** y agrega:
   - `ALLOWED_ORIGINS`: `https://tu-proyecto.web.app,https://tu-proyecto.firebaseapp.com,http://localhost:3001`
5. Copia la URL asignada (ej. `https://octane-iopgps-proxy.tu-subdominio.workers.dev`).

### Opción B — Wrangler CLI
```bash
npx wrangler deploy worker.js --name octane-iopgps-proxy
```

## Configuración en OCTANE
1. Abre **Ajustes -> Telemetría GPS**.
2. Pega la URL del Worker en **PROXY PRIVADO (OPCIONAL)** (ej. `https://octane-iopgps-proxy.tu-subdominio.workers.dev`).
3. Haz clic en **Guardar y sincronizar GPS**.

## Endpoints Soportados
- `POST /iopgps-api/login` — Autentica contra `https://iopgps.com/login`, extrae `USER_TOKEN` de `Set-Cookie` y devuelve JSON `{ code, accessToken, accountId, accountName, raw }`.
- `GET | POST | PUT /iopgps-api/open/*` — Reenvía hacia `https://open.iopgps.com/*`.
- `GET | POST | PUT /iopgps-api/*` — Reenvía hacia `https://iopgps.com/*` inyectando `Cookie: USER_TOKEN=...; zoneId=...` y `accessToken`.
