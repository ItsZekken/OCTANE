import { defineConfig } from 'vite';
import crypto from 'node:crypto';

function md5(str) {
  return crypto.createHash('md5').update(String(str)).digest('hex');
}

function randomSalt(len = 10) {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Vite Middleware Plugin that bridges /iopgps-api/* to https://iopgps.com/*
 * Handles the MD5+Salt login flow, extracts the Set-Cookie USER_TOKEN, and
 * forwards authenticated requests with zoneId=America/Bogota.
 */
function octaneIopgpsProxyPlugin() {
  const attachMiddleware = (middlewares) => {
    middlewares.use('/iopgps-api', async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-iopgps-token, x-iopgps-zone');

      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }

      try {
        const urlObj = new URL(req.url || '/', 'http://localhost');
        const subPath = urlObj.pathname;
        const zoneId = req.headers['x-iopgps-zone'] || 'America/Bogota';

        // 1. Special Login Endpoint: POST /iopgps-api/login
        if (subPath === '/login' && req.method === 'POST') {
          const rawBody = await readRawBody(req);
          let parsed = {};
          try {
            parsed = JSON.parse(rawBody || '{}');
          } catch {
            const sp = new URLSearchParams(rawBody);
            parsed = Object.fromEntries(sp.entries());
          }

          const username = String(parsed.username || '').trim();
          const password = String(parsed.password || '').trim();
          if (!username || !password) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ code: 400, message: 'Credenciales incompletas' }));
            return;
          }

          const hashedPassword = parsed.isPreHashed
            ? password
            : md5(password) + md5(randomSalt(10));

          const formBody = new URLSearchParams({
            username,
            password: hashedPassword,
            loginType: 'ADMIN',
            rememberMe: 'true',
            domain: 'iopgps.com'
          });

          const upstreamRes = await fetch(`https://iopgps.com/login?v=${Date.now()}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
              'Cookie': `zoneId=${zoneId}`
            },
            body: formBody.toString()
          });

          const setCookies = upstreamRes.headers.getSetCookie ? upstreamRes.headers.getSetCookie() : [];
          let userToken = '';
          for (const c of setCookies) {
            const match = c.match(/USER_TOKEN=([^;]+)/);
            if (match && match[1]) {
              userToken = match[1];
              break;
            }
          }

          const data = await upstreamRes.json().catch(() => ({}));
          const code = data?.resultBean?.code ?? data?.code ?? -1;

          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({
            code,
            accessToken: userToken || data.accessToken || '',
            accountId: data.accountId || null,
            accountName: data.accountName || username,
            realUserId: data.realUserId || null,
            raw: data
          }));
          return;
        }

        // 2. General Proxy to https://iopgps.com/rest/* or https://open.iopgps.com/api/*
        const token = req.headers['x-iopgps-token'] || urlObj.searchParams.get('accessToken') || '';
        const isOpenApi = subPath.startsWith('/open/');
        const targetBase = isOpenApi ? 'https://open.iopgps.com' : 'https://iopgps.com';
        const targetPath = isOpenApi ? subPath.replace(/^\/open/, '') : subPath;
        const targetUrl = `${targetBase}${targetPath}${urlObj.search}`;

        const headers = {
          'Accept': 'application/json',
          'Cookie': token ? `USER_TOKEN=${token}; zoneId=${zoneId}` : `zoneId=${zoneId}`
        };
        if (token) {
          headers['accessToken'] = String(token);
        }
        if (req.headers['content-type']) {
          headers['Content-Type'] = req.headers['content-type'];
        }

        const fetchOpts = {
          method: req.method || 'GET',
          headers
        };

        if (req.method !== 'GET' && req.method !== 'HEAD') {
          fetchOpts.body = await readRawBody(req);
        }

        const upstream = await fetch(targetUrl, fetchOpts);
        const text = await upstream.text();

        res.statusCode = upstream.status;
        res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json; charset=utf-8');
        res.end(text);
      } catch (err) {
        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ code: 502, message: err?.message || 'Error de enlace GPS' }));
      }
    });
  };

  return {
    name: 'octane-iopgps-proxy',
    configureServer(server) {
      attachMiddleware(server.middlewares);
    },
    configurePreviewServer(server) {
      attachMiddleware(server.middlewares);
    }
  };
}

export default defineConfig({
  root: '.',
  publicDir: 'public',
  plugins: [octaneIopgpsProxyPlugin()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore']
        }
      }
    }
  },
  server: {
    port: 3001,
    strictPort: false,
    open: false,
    host: true,
  },
  preview: {
    port: 4173,
    host: true,
  },
});
