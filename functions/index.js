/**
 * OCTANE — Production Cloud Function Proxy for IOPGPS Telemetry
 * Bridges /iopgps-api/* on Firebase Hosting to https://iopgps.com/*
 */

const { onRequest } = require('firebase-functions/v2/https');
const crypto = require('node:crypto');

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

exports.iopgpsProxy = onRequest({ cors: true, region: 'us-central1' }, async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  try {
    const rawPath = req.path.replace(/^\/iopgps-api/, '') || '/';
    const zoneId = req.headers['x-iopgps-zone'] || 'America/Bogota';

    if (rawPath === '/login' && req.method === 'POST') {
      const body = typeof req.body === 'object' && req.body ? req.body : {};
      const username = String(body.username || '').trim();
      const password = String(body.password || '').trim();
      if (!username || !password) {
        res.status(400).json({ code: 400, message: 'Credenciales incompletas' });
        return;
      }

      const hashedPassword = body.isPreHashed
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

      res.status(200).json({
        code,
        accessToken: userToken || data.accessToken || '',
        accountId: data.accountId || null,
        accountName: data.accountName || username,
        realUserId: data.realUserId || null,
        raw: data
      });
      return;
    }

    const token = req.headers['x-iopgps-token'] || req.query.accessToken || '';
    const isOpenApi = rawPath.startsWith('/open/');
    const targetBase = isOpenApi ? 'https://open.iopgps.com' : 'https://iopgps.com';
    const targetPath = isOpenApi ? rawPath.replace(/^\/open/, '') : rawPath;
    const qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
    const targetUrl = `${targetBase}${targetPath}${qs}`;

    const headers = {
      'Accept': 'application/json',
      'Cookie': token ? `USER_TOKEN=${token}; zoneId=${zoneId}` : `zoneId=${zoneId}`
    };
    if (token) headers['accessToken'] = String(token);
    if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];

    const fetchOpts = {
      method: req.method || 'GET',
      headers
    };

    if (req.method !== 'GET' && req.method !== 'HEAD' && req.rawBody) {
      fetchOpts.body = req.rawBody;
    }

    const upstream = await fetch(targetUrl, fetchOpts);
    const text = await upstream.text();
    res.status(upstream.status)
      .set('Content-Type', upstream.headers.get('content-type') || 'application/json; charset=utf-8')
      .send(text);
  } catch (err) {
    res.status(502).json({ code: 502, message: err?.message || 'Error de enlace GPS' });
  }
});
