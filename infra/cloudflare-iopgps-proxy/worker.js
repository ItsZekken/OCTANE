/**
 * OCTANE // KINETIC — Private Cloudflare Worker Proxy for IOPGPS
 *
 * Implements the exact /iopgps-api/* protocol used in vite.config.js:
 * - POST /iopgps-api/login  -> https://iopgps.com/login (extracts Set-Cookie USER_TOKEN)
 * - *    /iopgps-api/open/* -> https://open.iopgps.com/*
 * - *    /iopgps-api/*      -> https://iopgps.com/*
 *
 * Zero credentials are stored on the Worker. Passwords are hashed client-side
 * before transport (isPreHashed: true).
 *
 * Environment Variables (optional):
 * - ALLOWED_ORIGINS: Comma-separated allowed CORS origins (default: "*")
 */

function md5Hex(input) {
  const bytes = Array.from(new TextEncoder().encode(String(input ?? '')));
  const bitLen = bytes.length * 8;
  const words = [];

  bytes.push(0x80);
  while (bytes.length % 64 !== 56) {
    bytes.push(0);
  }
  for (let i = 0; i < bytes.length; i++) {
    words[i >> 2] = (words[i >> 2] ?? 0) | (bytes[i] << ((i % 4) * 8));
  }
  words.push(bitLen & 0xffffffff);
  words.push(Math.floor(bitLen / 0x100000000));

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const s = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
  ];
  const K = Array.from({ length: 64 }, (_, idx) =>
    Math.floor(Math.abs(Math.sin(idx + 1)) * 0x100000000)
  );

  const add32 = (...vals) => vals.reduce((acc, v) => (acc + v) >>> 0, 0);
  const rotl32 = (val, shift) => ((val << shift) | (val >>> (32 - shift))) >>> 0;
  const toHexLE = (word) =>
    [0, 8, 16, 24].map((sh) => ((word >>> sh) & 0xff).toString(16).padStart(2, '0')).join('');

  for (let offset = 0; offset < words.length; offset += 16) {
    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;

    for (let i = 0; i < 64; i++) {
      let F = 0;
      let g = 0;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }

      const dTemp = D;
      D = C;
      C = B;
      B = add32(B, rotl32(add32(A, F, K[i], words[offset + g] ?? 0), s[i]));
      A = dTemp;
    }

    a0 = add32(a0, A);
    b0 = add32(b0, B);
    c0 = add32(c0, C);
    d0 = add32(d0, D);
  }

  return [a0, b0, c0, d0].map(toHexLE).join('');
}

function randomSalt(len = 10) {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function resolveCorsHeaders(request, env) {
  const requestOrigin = request.headers.get('Origin') || '';
  const rawAllowed = String(env?.ALLOWED_ORIGINS || '*').trim();

  let allowOrigin = '*';
  let allowed = true;

  if (rawAllowed && rawAllowed !== '*') {
    const allowedList = rawAllowed
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (requestOrigin) {
      if (allowedList.includes(requestOrigin)) {
        allowOrigin = requestOrigin;
      } else {
        allowOrigin = allowedList[0] || '';
        allowed = false;
      }
    } else {
      allowOrigin = allowedList[0] || '*';
    }
  }

  const headers = {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-iopgps-token, x-iopgps-zone',
    'Access-Control-Max-Age': '86400'
  };

  if (allowOrigin !== '*') {
    headers['Vary'] = 'Origin';
  }

  return { headers, allowed };
}

function extractUserToken(upstreamHeaders) {
  const setCookies = typeof upstreamHeaders.getSetCookie === 'function'
    ? upstreamHeaders.getSetCookie()
    : [upstreamHeaders.get('set-cookie') || ''];

  for (const cookieStr of setCookies) {
    const match = String(cookieStr || '').match(/USER_TOKEN=([^;,\s]+)/);
    if (match && match[1]) {
      return match[1];
    }
  }
  return '';
}

export default {
  async fetch(request, env) {
    const { headers: corsHeaders, allowed } = resolveCorsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      if (!allowed) {
        return new Response(null, { status: 403, headers: corsHeaders });
      }
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (!allowed) {
      return new Response(JSON.stringify({ code: 403, message: 'Origin not allowed' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    const url = new URL(request.url);
    if (!url.pathname.startsWith('/iopgps-api')) {
      return new Response(JSON.stringify({ code: 404, message: 'Not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    try {
      const subPath = url.pathname.slice('/iopgps-api'.length) || '/';
      const zoneId = request.headers.get('x-iopgps-zone') || 'America/Bogota';

      // 1. Special Login Endpoint: POST /iopgps-api/login
      if (subPath === '/login' && request.method === 'POST') {
        const rawBody = await request.text();
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
          return new Response(JSON.stringify({ code: 400, message: 'Credenciales incompletas' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' }
          });
        }

        const isPreHashed = parsed.isPreHashed === true || parsed.isPreHashed === 'true';
        const hashedPassword = isPreHashed
          ? password
          : md5Hex(password) + md5Hex(randomSalt(10));

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

        const userToken = extractUserToken(upstreamRes.headers);
        const data = await upstreamRes.json().catch(() => ({}));
        const code = data?.resultBean?.code ?? data?.code ?? -1;

        return new Response(JSON.stringify({
          code,
          accessToken: userToken || data.accessToken || '',
          accountId: data.accountId || null,
          accountName: data.accountName || username,
          realUserId: data.realUserId || null,
          raw: data
        }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' }
        });
      }

      // 2. General Proxy to https://iopgps.com/* or https://open.iopgps.com/*
      const token = request.headers.get('x-iopgps-token') || url.searchParams.get('accessToken') || '';
      const isOpenApi = subPath.startsWith('/open/');
      const targetBase = isOpenApi ? 'https://open.iopgps.com' : 'https://iopgps.com';
      const targetPath = isOpenApi ? subPath.replace(/^\/open/, '') : subPath;
      const targetUrl = `${targetBase}${targetPath}${url.search}`;

      const upstreamHeaders = {
        'Accept': 'application/json',
        'Cookie': token ? `USER_TOKEN=${token}; zoneId=${zoneId}` : `zoneId=${zoneId}`
      };
      if (token) {
        upstreamHeaders['accessToken'] = String(token);
      }
      const reqContentType = request.headers.get('content-type');
      if (reqContentType) {
        upstreamHeaders['Content-Type'] = reqContentType;
      }

      const fetchOpts = {
        method: request.method || 'GET',
        headers: upstreamHeaders
      };

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        fetchOpts.body = await request.text();
      }

      const upstream = await fetch(targetUrl, fetchOpts);
      const text = await upstream.text();

      return new Response(text, {
        status: upstream.status,
        headers: {
          ...corsHeaders,
          'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8'
        }
      });
    } catch (err) {
      return new Response(JSON.stringify({ code: 502, message: err?.message || 'Error de enlace GPS' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' }
      });
    }
  }
};
