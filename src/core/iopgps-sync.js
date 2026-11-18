/**
 * OCTANE // KINETIC — IOPGPS Autonomous Telemetry Client & Physical Sync Engine
 *
 * Implements:
 * - Reverse-engineered MD5+Salt authentication (md5(password) + md5(salt10))
 * - Live Odometer, Today Mileage, Battery Voltage (V), ACC Status & Coordinates
 * - Incremental Historical Backfill from installation date (2026-02-01) in 30-day windows
 * - Bidirectional Odometer Calibration (PUT /rest/device/mileage)
 * - Point-to-Point Trip Kinematics (Δv/Δt accelerations, traffic congestion, A/C solar load, idling)
 */

import { todayLocalYmd } from './date-utils.js';
import { store, showToast } from './state.js';
import { getVehicleProfile, saveVehicleProfile, getTelemetryLogs } from './db-local.js';
import { calculateTelemetryModel } from './telemetry-engine.js';
import { triggerCloudSync } from './firebase-sync.js';
import { calculateDistanceMeters, checkStopNearStation, notifyGasStationStop } from './gas-station-matcher.js';
import { refreshAlerts } from './alerts-engine.js';
import { reconcileClosedCycleTrips } from './fuel-physics-engine.js';
import { recordVoltageSample } from './vehicle-health-engine.js';

export const IOPGPS_INSTALL_DATE = '2026-02-01';
export const GPS_LOCAL_CREDS_KEY = 'octane_iopgps_creds_v1';

export const DEFAULT_IOPGPS_CONFIG = Object.freeze({
    enabled: false,
    username: '',
    password: '',
    imei: '',
    accountId: null,
    zoneId: 'America/Bogota',
    installDate: IOPGPS_INSTALL_DATE,
    installStartDate: IOPGPS_INSTALL_DATE,
    proxyUrl: '',
    stationAlertsEnabled: false
});
export const DEFAULT_GPS_CONFIG = DEFAULT_IOPGPS_CONFIG;

const TOKEN_TTL_MS = 6 * 24 * 60 * 60 * 1000; // 6 days (server token lasts 7 days)
let activeSyncPromise = null;

/**
 * Pure JavaScript 32-bit lowercase MD5 implementation (RFC 1321).
 * Zero external dependencies — runs identically in browser and Node.js.
 * @param {string} input
 * @returns {string} 32-character hex MD5 digest
 */
export function md5Hex(input) {
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

/**
 * Generates the 64-character obfuscated login password required by https://iopgps.com/login
 * Formula: md5(rawPassword) + md5(random10Chars)
 * @param {string} rawPassword
 * @param {string} [fixedSalt]
 * @returns {string}
 */
export function buildIopgpsPasswordHash(rawPassword, fixedSalt = '') {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    let salt = fixedSalt;
    if (!salt || salt.length !== 10) {
        salt = '';
        for (let i = 0; i < 10; i++) {
            salt += chars[Math.floor(Math.random() * chars.length)];
        }
    }
    return md5Hex(rawPassword) + md5Hex(salt);
}

/**
 * Determines if running in a browser context vs Node.js CLI/test context.
 */
function isBrowserRuntime() {
    return typeof window !== 'undefined' && typeof document !== 'undefined';
}

/**
 * Reads remembered GPS credentials from localStorage so they survive even a profile reset.
 * @returns {Object}
 */
export function loadRememberedGpsCreds() {
    try {
        if (typeof localStorage === 'undefined') return {};
        const raw = localStorage.getItem(GPS_LOCAL_CREDS_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

/**
 * Persists GPS credentials in localStorage and IndexedDB vehicleProfile so the user only enters them once.
 * @param {Object} creds - { username, password, imei, accountId, installStartDate }
 */
export function saveRememberedGpsCreds(creds = {}) {
    try {
        if (typeof localStorage === 'undefined') return;
        const existing = loadRememberedGpsCreds();
        const merged = {
            ...existing,
            ...creds,
            updatedAt: new Date().toISOString()
        };
        localStorage.setItem(GPS_LOCAL_CREDS_KEY, JSON.stringify(merged));
    } catch {}
}

/**
 * Resolves the active GPS configuration from vehicleProfile or remembered localStorage credentials.
 * Zero hardcoded credentials in source code.
 * @param {Object} [profile]
 * @returns {Object}
 */
export function getGpsConfig(profile = null) {
    const p = profile || store.getState()?.vehicleProfile || {};
    const remembered = loadRememberedGpsCreds();
    const custom = { ...remembered, ...(p.gpsConfig || {}) };
    const username = String(custom.username || remembered.username || '').trim();
    const password = String(custom.password || remembered.password || '');
    const imei = String(custom.imei || remembered.imei || '').trim();
    const accountId = Number(custom.accountId || remembered.accountId) || null;
    const installDate = custom.installStartDate || custom.installDate || remembered.installStartDate || DEFAULT_IOPGPS_CONFIG.installDate;
    const proxyUrl = String(custom.proxyUrl ?? remembered.proxyUrl ?? '').trim();
    const stationAlertsEnabled = Boolean(
        custom.stationAlertsEnabled !== undefined
            ? custom.stationAlertsEnabled
            : remembered.stationAlertsEnabled
    );
    const hasCredentials = Boolean(username && password);

    return {
        ...DEFAULT_IOPGPS_CONFIG,
        ...custom,
        enabled: custom.enabled !== undefined ? Boolean(custom.enabled && hasCredentials) : hasCredentials,
        username,
        password,
        imei,
        accountId,
        installDate,
        installStartDate: installDate,
        proxyUrl,
        stationAlertsEnabled
    };
}

/**
 * Automatically discovers the first vehicle device IMEI associated with the IOPGPS account
 * when the user leaves the IMEI field blank.
 * @param {number|string} accountId
 * @param {string} [token]
 * @returns {Promise<string>}
 */
export async function discoverAccountImei(accountId, token = '') {
    try {
        const res = await fetchIopgps(
            `/rest/device/search/list?isTaskSub=1&accountId=${encodeURIComponent(accountId || '')}&currentPage=1&pageSize=20`,
            token ? { token } : {}
        );
        const list = Array.isArray(res?.data) ? res.data : (Array.isArray(res?.beanList) ? res.beanList : []);
        const first = list.find(d => d && d.imei);
        if (first?.imei) return String(first.imei).trim();

        const fallback = await fetchIopgps(
            `/rest/device/Search?accountId=${encodeURIComponent(accountId || '')}&currentPage=1&pageSize=20`,
            token ? { token } : {}
        );
        const fbList = Array.isArray(fallback?.data) ? fallback.data : (Array.isArray(fallback?.beanList) ? fallback.beanList : []);
        const fbFirst = fbList.find(d => d && d.imei);
        return fbFirst ? String(fbFirst.imei).trim() : '';
    } catch {
        return '';
    }
}

const SCALAR_CORS_BRIDGE = 'https://proxy.scalar.com/?scalar_url=';

/**
 * Normalizes a custom private proxy URL to a base prefix ending with `/iopgps-api`.
 * Accepts base origin ("https://my-worker.workers.dev") or full suffix (".../iopgps-api").
 * @param {string} rawUrl
 * @returns {string}
 */
export function normalizeProxyBaseUrl(rawUrl) {
    let clean = String(rawUrl || '').trim();
    if (!clean) return '';
    clean = clean.replace(/\/+$/, '');
    if (clean.endsWith('/iopgps-api')) {
        return clean;
    }
    return `${clean}/iopgps-api`;
}

/**
 * Resolves the active IOPGPS transport mode for the current runtime and GPS config.
 * Pure & deterministic when `runtimeInfo` is provided.
 *
 * @param {Object} [cfg={}]
 * @param {Object|null} [runtimeInfo=null] - { isBrowser?: boolean, hostname?: string }
 * @returns {{ mode: 'private-proxy'|'vite-proxy'|'public-bridge'|'direct', apiBase: string, isLocalhost: boolean }}
 */
export function resolveProxyMode(cfg = {}, runtimeInfo = null) {
    const isBrowser = runtimeInfo && typeof runtimeInfo.isBrowser === 'boolean'
        ? runtimeInfo.isBrowser
        : isBrowserRuntime();

    const hostname = String(
        runtimeInfo && runtimeInfo.hostname !== undefined
            ? runtimeInfo.hostname
            : (typeof window !== 'undefined' && window.location ? window.location.hostname : '')
    ).toLowerCase();

    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';

    if (!isBrowser) {
        return { mode: 'direct', apiBase: '', isLocalhost: false };
    }

    const rawProxyUrl = String(cfg?.proxyUrl || '').trim();
    if (rawProxyUrl) {
        return {
            mode: 'private-proxy',
            apiBase: normalizeProxyBaseUrl(rawProxyUrl),
            isLocalhost
        };
    }

    if (isLocalhost) {
        return {
            mode: 'vite-proxy',
            apiBase: '/iopgps-api',
            isLocalhost: true
        };
    }

    return {
        mode: 'public-bridge',
        apiBase: SCALAR_CORS_BRIDGE,
        isLocalhost: false
    };
}

function buildUpstreamUrl(pathWithQuery, token = '', zoneId = 'America/Bogota') {
    const baseUrl = pathWithQuery.startsWith('/open/')
        ? `https://open.iopgps.com${pathWithQuery.replace(/^\/open/, '')}`
        : `https://iopgps.com${pathWithQuery}`;
    const urlObj = new URL(baseUrl);
    if (token && !urlObj.searchParams.has('accessToken')) {
        urlObj.searchParams.set('accessToken', token);
    }
    if (zoneId && !urlObj.searchParams.has('zoneId') && !pathWithQuery.startsWith('/open/')) {
        urlObj.searchParams.set('zoneId', zoneId);
    }
    return urlObj.toString();
}

/**
 * Authenticates against IOPGPS and returns { accessToken, accountId, accountName }.
 * Supports private Cloudflare Worker proxy, Vite local dev proxy, Scalar CORS bridge fallback, and Node.js direct mode.
 * Always hashes the password client-side with buildIopgpsPasswordHash before transport.
 * @param {Object} [customCreds]
 * @returns {Promise<{ accessToken: string, accountId: number, accountName: string }>}
 */
export async function loginIopgps(customCreds = null) {
    const cfg = customCreds ? { ...getGpsConfig(), ...customCreds } : getGpsConfig();
    const hashedPassword = buildIopgpsPasswordHash(cfg.password);
    const proxy = resolveProxyMode(cfg);

    if (proxy.mode === 'private-proxy' || proxy.mode === 'vite-proxy') {
        const res = await fetch(`${proxy.apiBase}/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'x-iopgps-zone': cfg.zoneId || 'America/Bogota'
            },
            body: JSON.stringify({
                username: cfg.username,
                password: hashedPassword,
                isPreHashed: true
            })
        });

        if (!res.ok) {
            throw new Error(`Error HTTP ${res.status} al autenticar GPS`);
        }

        const data = await res.json();
        const code = data?.code ?? data?.raw?.resultBean?.code ?? data?.raw?.code ?? -1;
        if (code !== 0 && code !== 1) {
            throw new Error(data?.raw?.resultBean?.result || data?.message || 'Credenciales GPS inválidas');
        }
        const finalToken = data?.accessToken || data?.raw?.accessToken || '';
        if (!finalToken) {
            throw new Error('No se recibió token de sesión GPS');
        }
        return {
            accessToken: finalToken,
            accountId: data.accountId || cfg.accountId,
            accountName: data.accountName || cfg.username
        };
    }

    const formBody = new URLSearchParams({
        username: cfg.username,
        password: hashedPassword,
        loginType: 'ADMIN',
        rememberMe: 'true',
        domain: 'iopgps.com'
    });

    if (proxy.mode === 'public-bridge') {
        // Fallback: Direct HTTPS CORS bridge for hosted environments without private proxy
        const targetLoginUrl = `https://iopgps.com/login?v=${Date.now()}`;
        const res = await fetch(`${SCALAR_CORS_BRIDGE}${encodeURIComponent(targetLoginUrl)}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Scalar-Cookie': `zoneId=${cfg.zoneId}`
            },
            body: formBody.toString()
        });

        if (!res.ok) {
            throw new Error(`Error HTTP ${res.status} al autenticar GPS`);
        }

        const rawCookieHeader =
            res.headers.get('x-scalar-set-cookie') ||
            res.headers.get('set-cookie') ||
            '';
        const tokenMatch = rawCookieHeader.match(/USER_TOKEN=([^;,\s]+)/);
        const userToken = tokenMatch ? tokenMatch[1] : '';

        const data = await res.json();
        const code = data?.resultBean?.code ?? data?.code ?? -1;
        if (code !== 0 && code !== 1) {
            throw new Error(data?.resultBean?.result || data?.message || 'Credenciales GPS inválidas');
        }
        const finalToken = userToken || data.accessToken || '';
        if (!finalToken) {
            throw new Error('No se recibió token de sesión GPS');
        }
        return {
            accessToken: finalToken,
            accountId: data.accountId || cfg.accountId,
            accountName: data.accountName || cfg.username
        };
    }

    // Node.js Direct Upstream Mode
    const res = await fetch(`https://iopgps.com/login?v=${Date.now()}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'Cookie': `zoneId=${cfg.zoneId}`
        },
        body: formBody.toString()
    });
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    let userToken = '';
    for (const c of setCookies) {
        const match = c.match(/USER_TOKEN=([^;]+)/);
        if (match && match[1]) {
            userToken = match[1];
            break;
        }
    }
    const data = await res.json();
    const code = data?.resultBean?.code ?? data?.code ?? -1;
    if (code !== 0 && code !== 1) {
        throw new Error(data?.resultBean?.result || 'Credenciales GPS inválidas');
    }
    return {
        accessToken: userToken || data.accessToken || '',
        accountId: data.accountId || cfg.accountId,
        accountName: data.accountName || cfg.username
    };
}

/**
 * Performs an authenticated request to IOPGPS /rest/* or /open/api/*.
 * Automatically re-authenticates if token is missing or expired (401).
 * @param {string} pathWithQuery - e.g. "/rest/device/mileage?imei=..."
 * @param {Object} [options] - { method, body, token, retry }
 * @returns {Promise<any>}
 */
export async function fetchIopgps(pathWithQuery, options = {}) {
    const profile = await getVehicleProfile().catch(() => null);
    const cfg = getGpsConfig(profile);
    let cache = profile?.gpsCache || {};

    let token = options.token || cache.accessToken || '';
    const tokenAge = Date.now() - (Number(cache.tokenCreatedAt) || 0);
    if (!token || tokenAge > TOKEN_TTL_MS) {
        const auth = await loginIopgps(cfg);
        token = auth.accessToken;
        cache = {
            ...cache,
            accessToken: token,
            accountId: auth.accountId || cfg.accountId,
            tokenCreatedAt: Date.now()
        };
        if (profile) {
            await saveVehicleProfile({ ...profile, gpsCache: cache }).catch(() => {});
        }
    }

    const method = options.method || 'GET';
    const proxy = resolveProxyMode(cfg);
    const normalizedPath = pathWithQuery.startsWith('/') ? pathWithQuery : `/${pathWithQuery}`;

    let url = '';
    const headers = {
        'Accept': 'application/json',
        'Content-Type': 'application/json; charset=utf-8'
    };

    if (proxy.mode === 'private-proxy' || proxy.mode === 'vite-proxy') {
        url = `${proxy.apiBase}${normalizedPath}`;
        headers['x-iopgps-token'] = token;
        headers['x-iopgps-zone'] = cfg.zoneId || 'America/Bogota';
    } else if (proxy.mode === 'public-bridge') {
        const upstreamUrl = buildUpstreamUrl(normalizedPath, token, cfg.zoneId);
        url = `${SCALAR_CORS_BRIDGE}${encodeURIComponent(upstreamUrl)}`;
        headers['accessToken'] = token;
        headers['X-Scalar-Cookie'] = `USER_TOKEN=${token}; accessToken=${token}; zoneId=${cfg.zoneId}`;
    } else {
        url = buildUpstreamUrl(normalizedPath, token, cfg.zoneId);
        headers['accessToken'] = token;
        headers['Cookie'] = `USER_TOKEN=${token}; accessToken=${token}; zoneId=${cfg.zoneId}`;
    }

    const fetchOpts = { method, headers };
    if (options.body && method !== 'GET') {
        fetchOpts.body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    }

    const res = await fetch(url, fetchOpts);
    if (res.status === 401 && !options.isRetry) {
        const auth = await loginIopgps(cfg);
        return fetchIopgps(pathWithQuery, { ...options, token: auth.accessToken, isRetry: true });
    }

    const json = await res.json();
    if ((json?.code === 401 || json?.resultBean?.code === 401) && !options.isRetry) {
        const auth = await loginIopgps(cfg);
        return fetchIopgps(pathWithQuery, { ...options, token: auth.accessToken, isRetry: true });
    }
    return json;
}

/**
 * Simplifies verbose Colombian geocoded addresses into clean, readable instrument labels.
 * Example: "Cl. 56 #13-13, La Ceiba, Barranquilla, Atlántico, Colombia" -> "Cl. 56 #13-13 · La Ceiba"
 * @param {string} rawAddr
 * @returns {string}
 */
export function formatCleanGpsAddress(rawAddr) {
    if (!rawAddr || typeof rawAddr !== 'string') return 'Ubicación GPS';
    const parts = rawAddr
        .split(',')
        .map((s) => s.trim())
        .filter((s) =>
            s &&
            !/^(colombia|atl[aá]ntico|rap caribe|per[ií]metro urbano.*|localidad .*|\d{5,6})$/i.test(s)
        );
    if (parts.length === 0) return rawAddr.slice(0, 36);
    if (parts.length === 1) return parts[0];
    // Combine street + neighborhood
    const first = parts[0].replace(/^Parqueadero \d+$/i, parts[1] || parts[0]);
    const second = parts[1] && parts[1] !== first ? parts[1] : (parts[2] || '');
    return second ? `${first} · ${second}` : first;
}

/**
 * Fetches live vehicle status: Odometer, Today's KM, External Battery Voltage (V), ACC status, and Location.
 * @param {string} [customImei]
 * @returns {Promise<Object>}
 */
export async function fetchGpsLiveSnapshot(customImei = '') {
    const profile = await getVehicleProfile().catch(() => null);
    const cfg = getGpsConfig(profile);
    const imei = customImei || cfg.imei;

    const [mileageRes, realtimeRes, openLocRes] = await Promise.all([
        fetchIopgps(`/rest/device/mileage?imei=${encodeURIComponent(imei)}&mapType=0&zoneId=${encodeURIComponent(cfg.zoneId)}`),
        fetchIopgps(`/rest/device/realtime/location?imei=${encodeURIComponent(imei)}&mapType=0`),
        fetchIopgps(`/open/api/device/location?imei=${encodeURIComponent(imei)}`).catch(() => null)
    ]);

    const totalMile = Number(mileageRes?.data?.totalMile) || 0;
    const todayMile = Number(mileageRes?.data?.todayMile) || 0;
    const statusBean = realtimeRes?.deviceStatusBean || {};

    const externalVoltage = Number(realtimeRes?.externalVoltage ?? statusBean?.externalVoltage) || 0;
    const accStatus = Boolean(statusBean?.accStatus);
    const accDurationDesc = String(realtimeRes?.accDurationDesc || '')
        .replace(/时/g, 'h ')
        .replace(/分/g, 'm ')
        .replace(/秒/g, 's')
        .trim();

    const rawAddress = openLocRes?.address || '';

    return {
        imei,
        name: realtimeRes?.name || cfg.username,
        deviceType: realtimeRes?.deviceTypeBean?.typeName || 'WETRACK2',
        totalMile: Math.round(totalMile),
        todayMile: Number(todayMile.toFixed(2)),
        externalVoltage: Number(externalVoltage.toFixed(2)),
        accStatus,
        accTime: Number(statusBean?.accTime) || 0,
        accDurationDesc,
        speed: Number(statusBean?.speed) || 0,
        course: Number(statusBean?.course) || 0,
        lat: Number(statusBean?.lat || openLocRes?.lat) || 0,
        lng: Number(statusBean?.lng || openLocRes?.lng) || 0,
        gpsTime: Number(statusBean?.gpsTime) || (Number(openLocRes?.gpsTime) * 1000) || Date.now(),
        date: todayLocalYmd(),
        address: formatCleanGpsAddress(rawAddress),
        rawAddress,
        syncedAt: new Date().toISOString()
    };
}

/**
 * Bi-directional odometer calibration: updates the GPS odometer in IOPGPS to match
 * the user's physical dashboard reading whenever a manual reading or refuel is saved.
 * @param {number} newOdoKm
 * @returns {Promise<boolean>}
 */
export async function calibrateGpsOdometer(newOdoKm) {
    const cleanOdo = Math.round(Number(newOdoKm) || 0);
    if (cleanOdo <= 0) return false;

    try {
        const profile = await getVehicleProfile();
        const cfg = getGpsConfig(profile);
        if (!cfg.enabled) return false;

        const res = await fetchIopgps('/rest/device/mileage', {
            method: 'PUT',
            body: {
                imei: cfg.imei,
                totalMile: String(cleanOdo)
            }
        });

        const ok = res?.code === 0 || res?.resultBean?.code === 0;
        if (ok && profile) {
            const gpsCache = {
                ...(profile.gpsCache || {}),
                live: {
                    ...(profile.gpsCache?.live || {}),
                    totalMile: cleanOdo,
                    syncedAt: new Date().toISOString()
                },
                lastManualCalibration: {
                    odometer: cleanOdo,
                    date: todayLocalYmd(),
                    calibratedAt: new Date().toISOString()
                }
            };
            const updatedProfile = await saveVehicleProfile({ ...profile, gpsCache });
            store.setState({ vehicleProfile: updatedProfile });
        }
        return ok;
    } catch (err) {
        console.warn('[OCTANE GPS] Odometer calibration skipped:', err?.message);
        return false;
    }
}

/**
 * Generates 30-day windows between startDateStr ("YYYY-MM-DD") and endDateStr ("YYYY-MM-DD").
 * IOPGPS enforces a maximum 31-day span per statistics query.
 * @param {string} startDateStr
 * @param {string} endDateStr
 * @returns {Array<{ startYmd: string, endYmd: string, startUnix: number, endUnix: number }>}
 */
export function build30DayWindows(startDateStr, endDateStr) {
    const windows = [];
    const cur = new Date(`${startDateStr}T00:00:00-05:00`);
    const end = new Date(`${endDateStr}T23:59:59-05:00`);
    if (isNaN(cur.getTime()) || isNaN(end.getTime()) || cur > end) return windows;

    const toYmd = (d) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    };

    while (cur <= end) {
        const wStart = new Date(cur.getTime());
        const wEnd = new Date(cur.getTime());
        wEnd.setDate(wEnd.getDate() + 29);
        wEnd.setHours(23, 59, 59, 0);
        if (wEnd > end) {
            wEnd.setTime(end.getTime());
        }

        windows.push({
            startYmd: toYmd(wStart),
            endYmd: toYmd(wEnd),
            startUnix: Math.floor(wStart.getTime() / 1000),
            endUnix: Math.floor(wEnd.getTime() / 1000)
        });

        cur.setDate(cur.getDate() + 30);
        cur.setHours(0, 0, 0, 0);
    }

    return windows;
}

/**
 * Fetches daily mileage and idling (stayAccOn) statistics for a single <=30-day window.
 * @param {string} imei
 * @param {number} startUnix
 * @param {number} endUnix
 * @param {string} zoneId
 * @returns {Promise<Object>} Map of date ("YYYY-MM-DD") -> daily telemetry record
 */
async function fetchWindowDailyTelemetry(imei, startUnix, endUnix, zoneId = 'America/Bogota') {
    const [milesRes, idleRes] = await Promise.all([
        fetchIopgps(`/rest/device/statistics/miles?startTime=${startUnix}&endTime=${endUnix}&imei=${encodeURIComponent(imei)}&zoneId=${encodeURIComponent(zoneId)}`),
        fetchIopgps(`/rest/device/stayAccOn/report/list?startTime=${startUnix}&endTime=${endUnix}&imei=${encodeURIComponent(imei)}&currentPage=1&pageSize=500&mapType=0&zoneId=${encodeURIComponent(zoneId)}`).catch(() => null)
    ]);

    const dayMap = {};
    const beans = Array.isArray(milesRes?.beanList) ? milesRes.beanList : [];

    for (const b of beans) {
        if (!b || !b.date) continue;
        const miles = Number(b.miles) || 0;
        const runTime = Number(b.runTime) || 0; // seconds moving / engine active
        const stayTime = Number(b.stayTime) || 0;
        const runNo = Number(b.runNo) || 0;
        const stayNo = Number(b.stayNo) || 0;
        const overspeedNo = Number(b.overspeedNo) || 0;
        const avgSpeedKmh = runTime > 0 ? Number((miles / (runTime / 3600)).toFixed(1)) : 0;

        dayMap[b.date] = {
            date: b.date,
            km: Number(miles.toFixed(2)),
            miles: Number(miles.toFixed(2)),
            runTimeSec: runTime,
            runTime,
            stayTimeSec: stayTime,
            stayTime,
            runNo,
            stayNo,
            overspeedNo,
            avgSpeedKmh,
            idleAccOnSec: 0,
            idleAccOnCount: 0
        };
    }

    // Aggregate idling with engine/AC on (stayAccOn) by Colombia date
    const idleList = Array.isArray(idleRes?.data) ? idleRes.data : [];
    for (const item of idleList) {
        const tsMs = Number(item?.startTime) || 0;
        if (!tsMs) continue;
        // Convert to Colombia local date (UTC-5)
        const colDate = new Date(tsMs - 5 * 3600 * 1000).toISOString().slice(0, 10);
        if (!dayMap[colDate]) {
            dayMap[colDate] = {
                date: colDate,
                km: 0,
                miles: 0,
                runTimeSec: 0,
                runTime: 0,
                stayTimeSec: 0,
                stayTime: 0,
                runNo: 0,
                stayNo: 0,
                overspeedNo: 0,
                avgSpeedKmh: 0,
                idleAccOnSec: 0,
                idleAccOnCount: 0
            };
        }
        dayMap[colDate].idleAccOnSec += Number(item.duration) || 0;
        dayMap[colDate].idleAccOnCount += 1;
    }

    return dayMap;
}

/**
 * Computes aggregated kinematic and consumption summary for a list of trips.
 * @param {Array<Object>} trips
 * @param {Array<Object>} [rawIdles=[]]
 * @returns {Object}
 */
/**
 * Generates an ultra-lightweight, normalized SVG path string representing a route sparkline (cartographic glyph).
 * Used for instant, zero-latency visual signatures of daily trajectories without loading map tiles.
 * 
 * @param {Array<{ lat: number, lng: number }>} points
 * @param {number} [width=56]
 * @param {number} [height=28]
 * @param {number} [padding=3]
 * @returns {string} SVG path string ("M x y L x y ...")
 */
export function buildRouteGlyph(points = [], width = 56, height = 28, padding = 3) {
    if (!Array.isArray(points) || points.length < 2) return '';
    let minLat = Infinity, maxLat = -Infinity;
    let minLng = Infinity, maxLng = -Infinity;

    for (const p of points) {
        const lat = Number(p?.lat ?? p?.[0]);
        const lng = Number(p?.lng ?? p?.[1]);
        if (!isNaN(lat) && !isNaN(lng) && (lat !== 0 || lng !== 0)) {
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
            if (lng < minLng) minLng = lng;
            if (lng > maxLng) maxLng = lng;
        }
    }

    if (!isFinite(minLat) || !isFinite(maxLat) || !isFinite(minLng) || !isFinite(maxLng)) return '';

    const latSpan = Math.max(0.0001, maxLat - minLat);
    const lngSpan = Math.max(0.0001, maxLng - minLng);

    const drawW = Math.max(4, width - padding * 2);
    const drawH = Math.max(4, height - padding * 2);

    const toX = (lng) => Number((padding + ((lng - minLng) / lngSpan) * drawW).toFixed(1));
    const toY = (lat) => Number((height - padding - ((lat - minLat) / latSpan) * drawH).toFixed(1));

    let pathD = '';
    let count = 0;
    for (const p of points) {
        const lat = Number(p?.lat ?? p?.[0]);
        const lng = Number(p?.lng ?? p?.[1]);
        if (!isNaN(lat) && !isNaN(lng) && (lat !== 0 || lng !== 0)) {
            const x = toX(lng);
            const y = toY(lat);
            pathD += count === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
            count++;
        }
    }
    return count >= 2 ? pathD : '';
}

/**
 * Splits track points into contiguous segments categorized by velocity for visual intensity rendering.
 * Encodes traffic flow directly onto the trajectory with a high-contrast chromatic spectrum:
 * - 'crawl' (< 12 km/h): pure red / dense congestion
 * - 'slow' (12 - 24 km/h): red-orange / heavy city traffic
 * - 'moderate' (24 - 38 km/h): octane amber / standard flow
 * - 'fluid' (38 - 52 km/h): golden yellow / agile flow
 * - 'fast' (>= 52 km/h): bright electric yellow / high-speed cruise
 * 
 * @param {Array<{ lat: number, lng: number, speed: number }>} points
 * @returns {Array<{ category: 'crawl'|'slow'|'moderate'|'fluid'|'fast', points: Array<{ lat: number, lng: number }>, avgSpeed: number }>}
 */
export function speedSegments(points = []) {
    if (!Array.isArray(points) || points.length < 2) return [];
    const getCat = (v) => {
        if (v < 12) return 'crawl';
        if (v < 24) return 'slow';
        if (v < 38) return 'moderate';
        if (v < 52) return 'fluid';
        return 'fast';
    };

    // 3-point weighted moving average to filter GPS speed telemetry jitter and prevent beaded micro-segments
    const smoothedSpeeds = points.map((p, idx, arr) => {
        const prev = Number(arr[Math.max(0, idx - 1)]?.speed) || 0;
        const curr = Number(p?.speed) || 0;
        const next = Number(arr[Math.min(arr.length - 1, idx + 1)]?.speed) || 0;
        return (prev + curr * 2 + next) / 4;
    });

    const segments = [];
    let currentCat = getCat(smoothedSpeeds[0]);
    let currentPts = [points[0]];

    for (let i = 1; i < points.length; i++) {
        const pt = points[i];
        const cat = getCat(smoothedSpeeds[i]);

        if (cat === currentCat) {
            currentPts.push(pt);
        } else {
            currentPts.push(pt); // overlap 1 point for continuous polyline
            segments.push({
                category: currentCat,
                points: currentPts,
                avgSpeed: Math.round(currentPts.reduce((acc, p) => acc + (Number(p.speed) || 0), 0) / currentPts.length)
            });
            currentCat = cat;
            currentPts = [pt];
        }
    }

    if (currentPts.length >= 2) {
        segments.push({
            category: currentCat,
            points: currentPts,
            avgSpeed: Math.round(currentPts.reduce((acc, p) => acc + (Number(p.speed) || 0), 0) / currentPts.length)
        });
    }

    return segments;
}

// ============================================================================
// ENGINE THERMAL DISSIPATION & COLD-START ECU ENRICHMENT MODEL
// ============================================================================

/**
 * Resolves normalized YYYY-MM-DD date string for a trip object.
 * @param {Object} trip
 * @returns {string}
 */
export function getTripDateYmd(trip) {
    if (trip && typeof trip.date === 'string' && trip.date.length >= 10) {
        return trip.date.slice(0, 10);
    }
    const ms = Number(trip?.startTimeMs ?? (trip?.startTimeUnix ? trip.startTimeUnix * 1000 : 0));
    if (ms > 0) {
        return new Date(ms - 5 * 3600 * 1000).toISOString().slice(0, 10);
    }
    return '';
}

/**
 * Computes engine thermal dissipation and cold-start ECU enrichment penalty.
 *
 * 1. delta_t_off = (startMs - prevTripEndMs) / (60 * 1000) in minutes for sorted trips.
 *    If no previous trip within 12h or first trip of day, delta_t_off = Infinity.
 * 2. Thermal retention R = Math.exp(-0.015 * delta_t_off).
 * 3. Cold-start ECU enrichment penalty: coldPenalty = (1 - R) * Math.max(0, 1 - (distKm / 5.0)) * 0.18.
 * 4. Apply to tripSeverity = Math.max(0.85, Math.min(1.50, baseSeverity * (1 + coldPenalty))).
 * 5. Exposes thermalRetentionPct: Math.round(R * 100), idleOffMin: Math.round(delta_t_off), and coldPenaltyPct: Math.round(coldPenalty * 100).
 *
 * @param {number} startMs - Current trip start timestamp in ms
 * @param {number|null} prevTripEndMs - Previous trip end timestamp in ms (null if none)
 * @param {number} distKm - Trip distance in km
 * @param {Object} [options={}] - { isFirstTripOfDay: boolean, baseSeverity: number }
 * @returns {Object}
 */
export function computeEngineThermalDissipation(startMs, prevTripEndMs, distKm, options = {}) {
    const isFirstTripOfDay = Boolean(options.isFirstTripOfDay);
    const baseSeverity = Number(options.baseSeverity) || 1.0;
    const km = Number(distKm) || 0;

    let delta_t_off;
    const hasPrev = prevTripEndMs != null && !isNaN(prevTripEndMs) && Number(prevTripEndMs) > 0;
    const gapMs = hasPrev ? (Number(startMs) - Number(prevTripEndMs)) : Infinity;
    const isOver12h = gapMs > 12 * 60 * 60 * 1000;

    if (!hasPrev || isFirstTripOfDay || isOver12h || !isFinite(gapMs)) {
        delta_t_off = Infinity;
    } else {
        delta_t_off = Math.max(0, gapMs / (60 * 1000));
    }

    const R = delta_t_off === Infinity ? 0 : Math.exp(-0.015 * delta_t_off);
    const coldPenalty = (1 - R) * Math.max(0, 1 - (km / 5.0)) * 0.18;
    const tripSeverity = Math.max(0.85, Math.min(1.50, baseSeverity * (1 + coldPenalty)));

    return {
        delta_t_off,
        R,
        thermalRetentionPct: Math.round(R * 100),
        idleOffMin: Math.round(delta_t_off),
        coldPenalty,
        coldPenaltyPct: Math.round(coldPenalty * 100),
        tripSeverity: Number(tripSeverity.toFixed(3))
    };
}

/**
 * Applies engine thermal dissipation model across consecutive trips.
 *
 * @param {Array<Object>} trips - List of trip objects
 * @param {Object} [options={}] - { baseEff: number, fuelPriceCop: number }
 * @returns {Array<Object>} trips with thermal dissipation applied
 */
export function applyThermalDissipation(trips = [], options = {}) {
    if (!Array.isArray(trips) || trips.length === 0) return trips;

    const defaultBaseEff = Number(options.baseEff) || 33.71;
    const defaultFuelPriceCop = Number(options.fuelPriceCop) || 16000;

    // Sort chronologically (earliest to latest) to compute consecutive dissipation
    const sorted = [...trips].sort((a, b) => (Number(a.startTimeMs) || 0) - (Number(b.startTimeMs) || 0));

    for (let i = 0; i < sorted.length; i++) {
        const trip = sorted[i];
        const startMs = Number(trip.startTimeMs) || 0;
        const distKm = Number(trip.distanceKm ?? trip.mileageKm) || 0;
        const prevTrip = i > 0 ? sorted[i - 1] : null;
        const prevTripEndMs = prevTrip ? (Number(prevTrip.endTimeMs) || 0) : null;

        const tripDate = getTripDateYmd(trip);
        const prevDate = prevTrip ? getTripDateYmd(prevTrip) : '';

        const isFirstTripOfDay = !prevTrip || (Boolean(tripDate && prevDate) && tripDate !== prevDate);
        const baseSeverity = Number(trip.baseSeverity ?? trip.tripSeverity ?? 1.0);
        trip.baseSeverity = Number(baseSeverity.toFixed(3));

        const thermal = computeEngineThermalDissipation(startMs, prevTripEndMs, distKm, {
            isFirstTripOfDay,
            baseSeverity
        });

        trip.thermalRetentionPct = thermal.thermalRetentionPct;
        trip.idleOffMin = thermal.idleOffMin;
        trip.coldPenaltyPct = thermal.coldPenaltyPct;
        trip.tripSeverity = thermal.tripSeverity;

        // Recalculate estGallons and estCostCop
        const tripEff = Number(trip.baseEff) || defaultBaseEff;
        const tripFuelPrice = Number(trip.fuelPriceCop) || defaultFuelPriceCop;
        const effectiveEff = tripEff / trip.tripSeverity;
        trip.estGallons = distKm > 0 ? Number((distKm / effectiveEff).toFixed(3)) : 0;
        trip.estCostCop = Math.round(trip.estGallons * tripFuelPrice);
    }

    return trips;
}

/**
 * Groups a flat array of trips by local date ("YYYY-MM-DD") in descending chronological order.
 * Computes the day's macro metrics (total KM, duration, est. fuel, est. cost) and composite route glyph.
 * 
 * @param {Array<Object>} trips
 * @param {Object} [options={}] - { fuelPriceCop, baseEff }
 * @returns {Array<Object>}
 */
export function groupTripsByDay(trips = [], options = {}) {
    if (!Array.isArray(trips) || trips.length === 0) return [];
    const fuelPriceCop = Number(options.fuelPriceCop) || 16000;
    const baseEff = Number(options.baseEff) || 33.71;

    const dayMap = {};

    for (const t of trips) {
        if (!t) continue;
        const dateKey = String(t.date || '').slice(0, 10);
        if (!dateKey) continue;

        if (!dayMap[dateKey]) {
            dayMap[dateKey] = {
                date: dateKey,
                trips: [],
                totalKm: 0,
                durationSec: 0,
                durationMin: 0,
                totalEstGallons: 0,
                totalEstCostCop: 0,
                totalMovingSec: 0,
                totalStoppedSec: 0,
                allTrackPoints: [],
                routeGlyph: ''
            };
        }

        const dEntry = dayMap[dateKey];
        const km = Number(t.distanceKm ?? t.mileageKm) || 0;
        const sec = Number(t.durationSec ?? t.tripTimeSec) || 0;

        // Ensure fuel estimates exist (rehydrate if loaded from older cache)
        let rawGallons = Number(t.estGallons) || 0;
        let rawCostCop = Number(t.estCostCop) || 0;
        if ((!rawGallons || !rawCostCop) && km > 0) {
            rawGallons = Number((km / baseEff).toFixed(3));
            rawCostCop = Math.round(rawGallons * fuelPriceCop);
            t.estGallons = rawGallons;
            t.estCostCop = rawCostCop;
        }
        const gallons = Number(t.reconciledGallons ?? rawGallons) || 0;
        const costCop = Number(t.reconciledCostCop ?? rawCostCop) || 0;

        dEntry.trips.push(t);
        dEntry.totalKm += km;
        dEntry.durationSec += sec;
        dEntry.totalEstGallons += gallons;
        dEntry.totalEstCostCop += costCop;
        dEntry.totalMovingSec += Number(t.movingTimeSec) || sec;
        dEntry.totalStoppedSec += Number(t.stoppedTimeSec) || 0;

        if (Array.isArray(t.trackPoints) && t.trackPoints.length > 0) {
            dEntry.allTrackPoints.push(...t.trackPoints);
        }
    }

    const dayList = Object.values(dayMap).map(d => {
        // Sort trips within day chronologically (earliest to latest)
        d.trips.sort((a, b) => (Number(a.startTimeMs) || 0) - (Number(b.startTimeMs) || 0));
        d.totalKm = Number(d.totalKm.toFixed(2));
        d.durationMin = Math.max(1, Math.round(d.durationSec / 60));
        d.totalEstGallons = Number(d.totalEstGallons.toFixed(2));
        d.totalEstCostCop = Math.round(d.totalEstCostCop);
        d.avgSpeedKmh = d.durationSec > 0 ? Number((d.totalKm / (d.durationSec / 3600)).toFixed(1)) : 0;
        d.tripCount = d.trips.length;
        d.routeGlyph = buildRouteGlyph(d.allTrackPoints, 56, 28);
        return d;
    });

    // Sort days descending (most recent date first)
    return dayList.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Computes aggregated kinematic and consumption summary for a list of trips.
 * @param {Array<Object>} trips
 * @param {Array<Object>} [rawIdles=[]]
 * @param {Object} [options={}]
 * @returns {Object}
 */
export function computeTripsSummary(trips = [], rawIdles = [], options = {}) {
    const fuelPriceCop = Number(options.fuelPriceCop) || 16000;
    const baseEff = Number(options.baseEff) || 33.71;

    let totalKm = 0;
    let totalDurationSec = 0;
    let totalHardAccels = 0;
    let totalHardBrakes = 0;
    let totalEstGallons = 0;
    let totalEstCostCop = 0;
    let slowTrafficPoints = 0;
    let totalMovingPoints = 0;

    for (const t of trips) {
        const km = Number(t.distanceKm ?? t.mileageKm) || 0;
        const sec = Number(t.durationSec ?? t.tripTimeSec) || 0;
        totalKm += km;
        totalDurationSec += sec;
        totalHardAccels += Number(t.hardAccels ?? t.hardAccelCount) || 0;
        totalHardBrakes += Number(t.hardBrakes) || 0;

        // Re-hydrate fuel estimates if missing from previous cache
        let g = Number(t.estGallons) || 0;
        let c = Number(t.estCostCop) || 0;
        if ((!g || !c) && km > 0) {
            g = Number((km / baseEff).toFixed(3));
            c = Math.round(g * fuelPriceCop);
            t.estGallons = g;
            t.estCostCop = c;
        }

        totalEstGallons += Number(t.reconciledGallons ?? g) || 0;
        totalEstCostCop += Number(t.reconciledCostCop ?? c) || 0;

        if (Array.isArray(t.trackPoints) && t.trackPoints.length > 0) {
            for (const pt of t.trackPoints) {
                if (pt.speed > 0) {
                    totalMovingPoints++;
                    if (pt.speed < 18) slowTrafficPoints++;
                }
            }
        }
    }

    const totalIdleSec = Array.isArray(rawIdles)
        ? rawIdles.reduce((acc, x) => acc + (Number(x?.duration) || 0), 0)
        : 0;
    const overallAvgSpeed = totalDurationSec > 0 ? Number((totalKm / (totalDurationSec / 3600)).toFixed(1)) : 0;
    const overallTrafficPct = totalMovingPoints > 0
        ? Math.round((slowTrafficPoints / totalMovingPoints) * 100)
        : (trips.length > 0 ? Math.round(trips.reduce((acc, t) => acc + (t.trafficPct || 0), 0) / trips.length) : 0);

    return {
        tripCount: trips.length,
        totalKm: Number(totalKm.toFixed(2)),
        totalDurationSec,
        totalIdleSec,
        overallAvgSpeed,
        overallTrafficPct,
        totalHardAccels,
        totalHardBrakes,
        totalEstGallons: Number(totalEstGallons.toFixed(2)),
        totalEstCostCop: Math.round(totalEstCostCop)
    };
}

/**
 * Returns trips cached in profile.gpsCache.tripsByDate for a date range [startDateStr, endDateStr].
 * @param {string} startDateStr - "YYYY-MM-DD"
 * @param {string} endDateStr - "YYYY-MM-DD"
 * @param {Object} [profile=null]
 * @returns {Array<Object>}
 */
export function getCachedGpsTrips(startDateStr, endDateStr, profile = null) {
    const p = profile || store.getState()?.vehicleProfile;
    const tripsByDate = p?.gpsCache?.tripsByDate || {};
    if (!startDateStr || !endDateStr) return [];

    const trips = [];
    const seenIds = new Set();
    const dates = Object.keys(tripsByDate)
        .filter(d => d >= startDateStr && d <= endDateStr)
        .sort();

    for (const d of dates) {
        const dayTrips = tripsByDate[d];
        if (Array.isArray(dayTrips)) {
            for (const t of dayTrips) {
                if (t) {
                    const tid = t.id || `${t.startTimeMs}_${t.distanceKm}`;
                    if (!seenIds.has(tid)) {
                        seenIds.add(tid);
                        trips.push(t);
                    }
                }
            }
        }
    }
    return trips.sort((a, b) => (Number(b.startTimeMs) || 0) - (Number(a.startTimeMs) || 0));
}

function resolveStopCoords(trip, which = 'end') {
    if (!trip || typeof trip !== 'object') return null;
    if (which === 'start') {
        const lat = Number(trip.startLat ?? trip.trackPoints?.[0]?.lat);
        const lng = Number(trip.startLng ?? trip.trackPoints?.[0]?.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
            return { lat, lng };
        }
        return null;
    }
    const lastPt = Array.isArray(trip.trackPoints) && trip.trackPoints.length > 0
        ? trip.trackPoints[trip.trackPoints.length - 1]
        : null;
    const lat = Number(trip.endLat ?? lastPt?.lat);
    const lng = Number(trip.endLng ?? lastPt?.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
        return { lat, lng };
    }
    return null;
}

function resolveLogTimestampMs(log) {
    if (!log) return NaN;
    if (Number.isFinite(Number(log.timestampMs))) return Number(log.timestampMs);
    if (log.date && log.time && /^\d{4}-\d{2}-\d{2}$/.test(String(log.date).slice(0, 10)) && /^\d{1,2}:\d{2}/.test(String(log.time))) {
        const ms = Date.parse(`${String(log.date).slice(0, 10)}T${String(log.time).slice(0, 5)}:00`);
        if (Number.isFinite(ms)) return ms;
    }
    if (log.createdAt) {
        const ms = Date.parse(log.createdAt);
        if (Number.isFinite(ms)) return ms;
    }
    return NaN;
}

/**
 * Pure geofence stop detector and deduplicator.
 * Inspects idle reports, stationary gaps between consecutive trips, and live parked state
 * against `profile.learnedGasStations`, deduplicating via `gpsCache.notifiedStopIds`
 * (ring-buffered to latest 60) and suppressing stops within 2 hours of an existing refuel log.
 *
 * @param {Object} params
 * @returns {{ matchedStop: Object|null, station: Object|null, updatedNotifiedStopIds: Array<string>, pendingStationMatch: Object|null }}
 */
export function detectAndProcessStationStops({
    trips = [],
    idles = [],
    live = null,
    profile = {},
    telemetryLogs = [],
    nowMs = Date.now()
} = {}) {
    const stations = Array.isArray(profile?.learnedGasStations) ? profile.learnedGasStations : [];
    const existingNotified = Array.isArray(profile?.gpsCache?.notifiedStopIds)
        ? profile.gpsCache.notifiedStopIds.map(String)
        : [];

    if (stations.length === 0) {
        return {
            matchedStop: null,
            station: null,
            updatedNotifiedStopIds: existingNotified.slice(-60),
            pendingStationMatch: null
        };
    }

    const candidates = [];

    // 1. Candidate stops from stayAccOn / idle reports
    if (Array.isArray(idles)) {
        for (const idle of idles) {
            if (!idle || typeof idle !== 'object') continue;
            const lat = Number(idle.lat ?? idle.latitude);
            const lng = Number(idle.lng ?? idle.longitude ?? idle.lon);
            const duration = Number(idle.durationSeconds ?? idle.duration ?? idle.durationSec ?? 0);
            if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0) || duration < 120) continue;
            const startMs = Number(idle.startTimeMs ?? idle.startTime ?? nowMs);
            candidates.push({
                id: String(idle.id || `idle_${startMs}_${Math.round(lat * 10000)}_${Math.round(lng * 10000)}`),
                lat,
                lng,
                durationSeconds: duration,
                startTimeMs: startMs,
                odometer: idle.odometer ?? live?.totalMile
            });
        }
    }

    // 2. Candidate stops from gaps between consecutive trips (<= 4h and < 120m drift)
    if (Array.isArray(trips) && trips.length >= 2) {
        const sortedTrips = [...trips]
            .filter(t => t && Number(t.startTimeMs) > 0 && Number(t.endTimeMs) > 0)
            .sort((a, b) => Number(a.startTimeMs) - Number(b.startTimeMs));

        for (let i = 0; i < sortedTrips.length - 1; i++) {
            const t1 = sortedTrips[i];
            const t2 = sortedTrips[i + 1];
            const gapMs = Number(t2.startTimeMs) - Number(t1.endTimeMs);
            const gapSec = Math.round(gapMs / 1000);
            if (gapSec < 120 || gapMs > 4 * 3600 * 1000) continue;

            const endCoords = resolveStopCoords(t1, 'end');
            if (!endCoords) continue;
            const startCoords = resolveStopCoords(t2, 'start');
            if (startCoords) {
                const driftM = calculateDistanceMeters(endCoords.lat, endCoords.lng, startCoords.lat, startCoords.lng);
                if (driftM >= 120) continue;
            }

            candidates.push({
                id: `gap_${t1.endTimeMs}_${t2.startTimeMs}`,
                lat: endCoords.lat,
                lng: endCoords.lng,
                durationSeconds: gapSec,
                startTimeMs: Number(t1.endTimeMs),
                odometer: live?.totalMile
            });
        }
    }

    // 3. Candidate stop from live stationary vehicle snapshot
    if (live && (!live.accStatus || Number(live.speed) === 0)) {
        const lat = Number(live.lat ?? live.latitude);
        const lng = Number(live.lng ?? live.longitude ?? live.lon);
        const liveDuration = Number(live.idleDurationSec ?? live.stayTimeSec ?? live.stopDurationSec ?? 0);
        if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0) && liveDuration >= 120) {
            const stopTs = Number(live.gpsTimeMs) || nowMs;
            candidates.push({
                id: String(live.stopId || `live_${live.date || 'today'}_${Math.round(lat * 10000)}_${Math.round(lng * 10000)}`),
                lat,
                lng,
                durationSeconds: liveDuration,
                startTimeMs: stopTs,
                odometer: live.totalMile
            });
        }
    }

    if (candidates.length === 0) {
        return {
            matchedStop: null,
            station: null,
            updatedNotifiedStopIds: existingNotified.slice(-60),
            pendingStationMatch: null
        };
    }

    // Check most recent candidate stops first
    candidates.sort((a, b) => (Number(b.startTimeMs) || 0) - (Number(a.startTimeMs) || 0));

    const refuelTimestamps = (Array.isArray(telemetryLogs) ? telemetryLogs : [])
        .filter(l => l && (Number(l.gallons_added) > 0 || l.is_full_tank || l.isFullTank))
        .map(resolveLogTimestampMs)
        .filter(ms => Number.isFinite(ms));

    const TWO_HOURS_MS = 2 * 3600 * 1000;

    for (const stop of candidates) {
        const station = checkStopNearStation(stop, stations);
        if (!station) continue;

        const stopId = String(stop.id);
        if (existingNotified.includes(stopId)) continue;

        const stopMs = Number(stop.startTimeMs) || nowMs;
        const alreadyRefueledNearby = refuelTimestamps.some(rMs => Math.abs(stopMs - rMs) <= TWO_HOURS_MS);
        if (alreadyRefueledNearby) continue;

        const updatedNotifiedStopIds = [...existingNotified, stopId].slice(-60);
        const pendingStationMatch = {
            stationId: station.id,
            stationName: station.name || 'Estación de Servicio',
            stopId,
            detectedAt: new Date(stopMs).toISOString(),
            odo: stop.odometer !== undefined && stop.odometer !== null ? Number(stop.odometer) : undefined
        };

        return {
            matchedStop: stop,
            station,
            updatedNotifiedStopIds,
            pendingStationMatch
        };
    }

    return {
        matchedStop: null,
        station: null,
        updatedNotifiedStopIds: existingNotified.slice(-60),
        pendingStationMatch: null
    };
}

/**
 * Pure 10-second trackpoint kinematic extractor.
 * Computes hard accelerations/brakes, kinetic acceleration/brake energy (MJ),
 * lateral cornering stress events, acceleration variance, and moving/stopped times.
 *
 * @param {Array} [rawPts=[]]
 * @param {number} [massKg=1045]
 * @returns {Object}
 */
export function extractTripKinematics(rawPts = [], massKg = 1045) {
    const pts = Array.isArray(rawPts) ? rawPts : [];
    const safeMass = Number(massKg) > 0 ? Number(massKg) : 1045;

    let hardAccels = 0;
    let hardBrakes = 0;
    let tripSlowPts = 0;
    let tripMovePts = 0;
    let movingTimeSec = 0;
    let stoppedTimeSec = 0;
    let accelEnergyJ = 0;
    let brakeEnergyJ = 0;
    let lateralStressEvents = 0;
    const accelSamples = [];

    for (let i = 0; i < pts.length; i++) {
        const vKmh = Number(pts[i]['12']) || 0;
        const isMoving = Number(pts[i]['13']) === 1 || vKmh > 0;
        const dt = i > 0
            ? Math.min(30, Math.max(1, (Number(pts[i]['7']) || 0) - (Number(pts[i - 1]['7']) || 0)))
            : 10;

        if (isMoving) {
            tripMovePts++;
            movingTimeSec += dt;
            if (vKmh < 18) tripSlowPts++;
        } else {
            stoppedTimeSec += dt;
        }

        if (i > 0) {
            const prevV = Number(pts[i - 1]['12']) || 0;
            const pointDt = (Number(pts[i]['7']) || 0) - (Number(pts[i - 1]['7']) || 0);
            if (pointDt > 0 && pointDt <= 30) {
                const v1 = prevV / 3.6;
                const v2 = vKmh / 3.6;
                const dvMs = v2 - v1;
                const accelMs2 = dvMs / pointDt;
                accelSamples.push(accelMs2);
                if (accelMs2 >= 2.1) hardAccels++;
                if (accelMs2 <= -2.3) hardBrakes++;

                if (v2 > v1) {
                    accelEnergyJ += 0.5 * safeMass * (v2 * v2 - v1 * v1);
                } else if (v2 < v1) {
                    brakeEnergyJ += 0.5 * safeMass * (v1 * v1 - v2 * v2);
                }

                const h1 = Number(pts[i - 1]['4']) || 0;
                const h2 = Number(pts[i]['4']) || 0;
                const dDeg = Math.abs(((h2 - h1 + 540) % 360) - 180);
                const latAccel = v2 * ((dDeg * Math.PI / 180) / pointDt);
                if (latAccel >= 2.5 && vKmh >= 15) {
                    lateralStressEvents++;
                }
            }
        }
    }

    let accelVariance = 0;
    if (accelSamples.length >= 2) {
        const mean = accelSamples.reduce((a, b) => a + b, 0) / accelSamples.length;
        const sqSum = accelSamples.reduce((acc, x) => acc + (x - mean) * (x - mean), 0);
        accelVariance = Number((sqSum / (accelSamples.length - 1)).toFixed(4));
    }

    return {
        hardAccels,
        hardBrakes,
        tripSlowPts,
        tripMovePts,
        movingTimeSec,
        stoppedTimeSec,
        accelEnergyMj: Number((accelEnergyJ / 1e6).toFixed(3)),
        brakeEnergyMj: Number((brakeEnergyJ / 1e6).toFixed(3)),
        lateralStressEvents,
        accelVariance
    };
}

/**
 * Reconciles cached trips grouped by date against closed full-tank cycles.
 * For each closed full cycle (`startDate` -> `endDate`, `gals > 0`), collects trips in
 * `(startDate, endDate]`, applies `reconcileClosedCycleTrips`, and returns a cloned map
 * with `isCalibrated: true`, `reconciledGallons`, and `reconciledCostCop`.
 *
 * @param {Object} [tripsByDate={}]
 * @param {Array<Object>} [closedCycles=[]]
 * @param {number} [fuelPriceCop=16000]
 * @returns {Object}
 */
export function reconcileTripsAgainstClosedCycles(tripsByDate = {}, closedCycles = [], fuelPriceCop = 16000) {
    if (!tripsByDate || typeof tripsByDate !== 'object') return {};
    const cloned = {};
    for (const dateKey of Object.keys(tripsByDate)) {
        const list = tripsByDate[dateKey];
        cloned[dateKey] = Array.isArray(list) ? list.map(t => (t && typeof t === 'object' ? { ...t } : t)) : list;
    }

    if (!Array.isArray(closedCycles) || closedCycles.length === 0) {
        return cloned;
    }

    for (const cycle of closedCycles) {
        if (!cycle || cycle.isFull === false) continue;
        const pumpGals = Number(cycle.gals ?? cycle.gallons) || 0;
        const startDate = cycle.startDate ? String(cycle.startDate).slice(0, 10) : '';
        const endDate = cycle.endDate ? String(cycle.endDate).slice(0, 10) : '';
        if (pumpGals <= 0 || !startDate || !endDate) continue;

        const refs = [];
        for (const dateKey of Object.keys(cloned).sort()) {
            const inWindow = startDate === endDate
                ? dateKey === endDate
                : (dateKey > startDate && dateKey <= endDate);
            if (!inWindow) continue;

            const dayList = cloned[dateKey];
            if (!Array.isArray(dayList)) continue;
            dayList.forEach((t, idx) => {
                if (t && typeof t === 'object') {
                    refs.push({ dateKey, idx, trip: t });
                }
            });
        }

        if (refs.length === 0) continue;
        const reconciled = reconcileClosedCycleTrips(refs.map(r => r.trip), pumpGals, fuelPriceCop);
        refs.forEach((r, i) => {
            if (reconciled[i]) {
                cloned[r.dateKey][r.idx] = reconciled[i];
            }
        });
    }

    return cloned;
}

/**
 * Fetches point-to-point trips (/rest/device/track/{imei}/travel) and computes physical
 * kinematics (accelerations, braking, traffic congestion, and solar A/C load) for a date range.
 * 
 * Persistent Date Cache:
 * - Checks profile.gpsCache.tripsByDate first. If all days in range (except today if not synchronized)
 *   are in cache and !options.forceRefresh, returns instantly from cache (fromCache: true, 0 ms).
 * - Enriches each trip with estGallons, estCostCop, and clean trackPoints.
 * - Saves normalized trips to profile.gpsCache.tripsByDate and persists in IndexedDB.
 *
 * @param {string} startDateStr - "YYYY-MM-DD"
 * @param {string} endDateStr - "YYYY-MM-DD"
 * @param {Object} [options={}] - { forceRefresh: boolean }
 * @returns {Promise<{ trips: Array<Object>, summary: Object, fromCache: boolean }>}
 */
export async function fetchGpsCycleTrips(startDateStr, endDateStr, options = {}) {
    const profile = await getVehicleProfile().catch(() => null);
    const cfg = getGpsConfig(profile);
    const forceRefresh = Boolean(options.forceRefresh);

    const startD = new Date(`${startDateStr}T00:00:00-05:00`);
    const endD = new Date(`${endDateStr}T23:59:59-05:00`);
    if (isNaN(startD.getTime()) || isNaN(endD.getTime()) || startD > endD) {
        return { trips: [], summary: null, fromCache: false };
    }

    // Build day range list
    const daysInRange = [];
    const cur = new Date(startD.getTime());
    while (cur <= endD) {
        const y = cur.getFullYear();
        const m = String(cur.getMonth() + 1).padStart(2, '0');
        const d = String(cur.getDate()).padStart(2, '0');
        daysInRange.push(`${y}-${m}-${d}`);
        cur.setDate(cur.getDate() + 1);
    }

    const todayStr = todayLocalYmd();
    const tripsByDate = profile?.gpsCache?.tripsByDate || {};

    // Check if every day in range is present in cache:
    // If today is in the range, it is only considered cached if tripsByDate[todayStr] exists AND
    // profile.gpsCache.lastTripsSyncedDate === todayStr (i.e. synchronized today).
    // Otherwise, today is not synchronized, so we must fetch.
    const allDaysCached = daysInRange.length > 0 && daysInRange.every(d => {
        if (d === todayStr) {
            const isTodaySynced = tripsByDate[todayStr] !== undefined &&
                profile?.gpsCache?.lastTripsSyncedDate === todayStr;
            return isTodaySynced;
        }
        return tripsByDate[d] !== undefined;
    });

    if (!forceRefresh && allDaysCached) {
        const engineSnap = store.getState()?.telemetryEngineResults;
        const closedCycles = engineSnap?.closedCycles || engineSnap?.allClosedCycles || engineSnap?.fullEraCycles || [];
        const fuelPriceCop = Number(profile?.fuelPriceCop) || 16000;
        const baseEff = Number(engineSnap?.adaptiveEff) ||
            Number(profile?.benchmarkEff) ||
            Number(profile?.defaultEfficiencyKmGal) ||
            33.71;

        const reconciledMap = closedCycles.length > 0
            ? reconcileTripsAgainstClosedCycles(profile?.gpsCache?.tripsByDate || {}, closedCycles, fuelPriceCop)
            : (profile?.gpsCache?.tripsByDate || {});
        const cachedTrips = getCachedGpsTrips(startDateStr, endDateStr, {
            ...profile,
            gpsCache: { ...(profile?.gpsCache || {}), tripsByDate: reconciledMap }
        });

        // Re-hydrate any missing cost/gallons in cached trips from earlier versions
        for (const t of cachedTrips) {
            const km = Number(t.distanceKm ?? t.mileageKm) || 0;
            if ((!t.estGallons || !t.estCostCop) && km > 0) {
                t.estGallons = Number((km / baseEff).toFixed(3));
                t.estCostCop = Math.round(t.estGallons * fuelPriceCop);
            }
        }
        const summary = computeTripsSummary(cachedTrips, [], { fuelPriceCop, baseEff });
        return {
            trips: cachedTrips,
            summary,
            fromCache: true
        };
    }

    const startUnix = Math.floor(startD.getTime() / 1000);
    const endUnix = Math.floor(endD.getTime() / 1000);

    const [travelRes, idleRes] = await Promise.all([
        fetchIopgps(`/rest/device/track/${encodeURIComponent(cfg.imei)}/travel?startTime=${startUnix}&endTime=${endUnix}&locationType=1&mapType=0&stayThreshold=180`),
        fetchIopgps(`/rest/device/stayAccOn/report/list?startTime=${startUnix}&endTime=${endUnix}&imei=${encodeURIComponent(cfg.imei)}&currentPage=1&pageSize=300&mapType=0&zoneId=${encodeURIComponent(cfg.zoneId)}`).catch(() => null)
    ]);

    const rawTrips = Array.isArray(travelRes?.data) ? travelRes.data : [];
    const rawIdles = Array.isArray(idleRes?.data) ? idleRes.data : [];

    const baseEff = Number(store.getState()?.telemetryEngineResults?.adaptiveEff) ||
        Number(profile?.benchmarkEff) ||
        Number(profile?.defaultEfficiencyKmGal) ||
        33.71;
    const fuelPriceCop = Number(profile?.fuelPriceCop) || 16000;
    const massKg = (Number(profile?.curbWeightKg) || 970) + 75;

    const trips = rawTrips.map((t, idx) => {
        const startMs = Number(t.startTime) || 0;
        const endMs = Number(t.endTime) || 0;
        const distKm = Number(t.mileage) || 0;
        const tripSec = Number(t.tripTime) || Math.max(1, Math.round((endMs - startMs) / 1000));
        const avgSpeedKmh = tripSec > 0 ? Number((distKm / (tripSec / 3600)).toFixed(1)) : 0;
        const speedMax = Number(t.speedMax) || 0;

        // Local hour in Colombia (UTC-5)
        const colDateObj = new Date(startMs - 5 * 3600 * 1000);
        const dateYmd = colDateObj.toISOString().slice(0, 10);
        const startTimeHm = colDateObj.toISOString().slice(11, 16);
        const endTimeHm = new Date(endMs - 5 * 3600 * 1000).toISOString().slice(11, 16);

        // Analyze 10-second kinematic breadcrumb points
        const rawPts = Array.isArray(t.deviceTrackPoints) ? t.deviceTrackPoints : [];
        const kin = extractTripKinematics(rawPts, massKg);
        const hardAccels = kin.hardAccels;
        const hardBrakes = kin.hardBrakes;
        const tripSlowPts = kin.tripSlowPts;
        const tripMovePts = kin.tripMovePts;
        let movingTimeSec = kin.movingTimeSec;
        const stoppedTimeSec = kin.stoppedTimeSec;
        const accelEnergyMj = kin.accelEnergyMj;
        const brakeEnergyMj = kin.brakeEnergyMj;
        const lateralStressEvents = kin.lateralStressEvents;
        const accelVariance = kin.accelVariance;

        if (stoppedTimeSec === 0 && movingTimeSec === 0) {
            movingTimeSec = tripSec;
        }

        const trafficPct = tripMovePts > 0 ? Math.round((tripSlowPts / tripMovePts) * 100) : 0;

        // Kinematic severity calculation (pure traffic, dynamics and congestion)
        const speedDelta = (22 - avgSpeedKmh) / 22;
        const trafficPenalty = Math.max(-0.08, Math.min(0.20, speedDelta * 0.22));
        const dynamicPenalty = Math.min(0.15, (hardAccels * 0.02) + (hardBrakes * 0.01));
        const congestionPenalty = (trafficPct / 100) * 0.10;
        const baseSeverity = Math.max(0.85, Math.min(1.40, 1 + trafficPenalty + dynamicPenalty + congestionPenalty));

        // Initial physical fuel estimation based on kinematic severity
        const effectiveEff = baseEff / baseSeverity;
        const estGallons = distKm > 0 ? Number((distKm / effectiveEff).toFixed(3)) : 0;
        const estCostCop = Math.round(estGallons * fuelPriceCop);

        // Clean track points
        const trackPoints = rawPts.map(pt => ({
            lat: Number(pt['9']) || 0,
            lng: Number(pt['10']) || 0,
            speed: Number(pt['12']) || 0,
            time: Number(pt['7']) || 0,
            heading: Number(pt['4']) || 0
        })).filter(p => p.lat !== 0 || p.lng !== 0);

        const firstPt = trackPoints.length > 0 ? trackPoints[0] : null;
        const lastPt = trackPoints.length > 0 ? trackPoints[trackPoints.length - 1] : null;

        return {
            id: `trip_${startMs}_${idx}`,
            date: dateYmd,
            startTimeMs: startMs,
            startTimeUnix: Math.floor(startMs / 1000),
            endTimeMs: endMs,
            endTimeUnix: Math.floor(endMs / 1000),
            startTimeHm,
            endTimeHm,
            startAddress: formatCleanGpsAddress(t.startAddress),
            endAddress: formatCleanGpsAddress(t.endAddress),
            rawStartAddress: t.startAddress || '',
            rawEndAddress: t.endAddress || '',
            startLat: firstPt ? firstPt.lat : null,
            startLng: firstPt ? firstPt.lng : null,
            endLat: lastPt ? lastPt.lat : null,
            endLng: lastPt ? lastPt.lng : null,
            distanceKm: Number(distKm.toFixed(2)),
            mileageKm: Number(distKm.toFixed(2)),
            durationSec: tripSec,
            tripTimeSec: tripSec,
            durationMin: Math.max(1, Math.round(tripSec / 60)),
            stoppedTimeSec,
            movingTimeSec,
            stoppedTimeMin: Math.round(stoppedTimeSec / 60),
            movingTimeMin: Math.max(1, Math.round(movingTimeSec / 60)),
            avgSpeedKmh,
            maxSpeedKmh: speedMax,
            speedMax,
            hardAccels,
            hardAccelCount: hardAccels,
            hardBrakes,
            brakeEnergyMj,
            accelEnergyMj,
            lateralStressEvents,
            accelVariance,
            trafficPct,
            baseSeverity: Number(baseSeverity.toFixed(3)),
            tripSeverity: Number(baseSeverity.toFixed(3)),
            estGallons,
            estCostCop,
            trackPoints
        };
    }).sort((a, b) => b.startTimeMs - a.startTimeMs);

    // Apply engine thermal dissipation and cold-start enrichment model across consecutive trips
    applyThermalDissipation(trips, { baseEff, fuelPriceCop });

    // Group trips by date for persistent caching in profile.gpsCache.tripsByDate
    const newTripsByDate = {};
    for (const d of daysInRange) {
        newTripsByDate[d] = [];
    }
    for (const trip of trips) {
        if (newTripsByDate[trip.date]) {
            newTripsByDate[trip.date].push(trip);
        } else {
            newTripsByDate[trip.date] = [trip];
        }
    }

    const engineSnap = store.getState()?.telemetryEngineResults;
    const closedCycles = engineSnap?.closedCycles || engineSnap?.allClosedCycles || engineSnap?.fullEraCycles || [];
    let finalTrips = trips;

    if (profile) {
        let mergedTripsByDate = {
            ...(profile.gpsCache?.tripsByDate || {}),
            ...newTripsByDate
        };
        if (closedCycles.length > 0) {
            mergedTripsByDate = reconcileTripsAgainstClosedCycles(mergedTripsByDate, closedCycles, fuelPriceCop);
            finalTrips = getCachedGpsTrips(startDateStr, endDateStr, {
                ...profile,
                gpsCache: { ...(profile.gpsCache || {}), tripsByDate: mergedTripsByDate }
            });
        }
        const logs = await getTelemetryLogs().catch(() => []);
        const stationMatch = detectAndProcessStationStops({
            trips: finalTrips,
            idles: rawIdles,
            live: profile?.gpsCache?.live || null,
            profile,
            telemetryLogs: logs
        });

        const updatedGpsCache = {
            ...(profile.gpsCache || {}),
            tripsByDate: mergedTripsByDate,
            lastTripsSyncedAt: new Date().toISOString(),
            lastTripsSyncedDate: todayStr,
            ...(stationMatch.matchedStop ? {
                notifiedStopIds: stationMatch.updatedNotifiedStopIds,
                pendingStationMatch: stationMatch.pendingStationMatch
            } : {})
        };
        const updatedProfile = await saveVehicleProfile({
            ...profile,
            gpsCache: updatedGpsCache
        }).catch(() => profile);
        store.setState({ vehicleProfile: updatedProfile });

        if (stationMatch.matchedStop && stationMatch.station && cfg.stationAlertsEnabled === true) {
            notifyGasStationStop(stationMatch.matchedStop, stationMatch.station).catch(() => {});
        }
    } else if (closedCycles.length > 0) {
        const reconciledMap = reconcileTripsAgainstClosedCycles(newTripsByDate, closedCycles, fuelPriceCop);
        finalTrips = Object.values(reconciledMap).flat().sort((a, b) => (Number(b.startTimeMs) || 0) - (Number(a.startTimeMs) || 0));
    }

    const summary = computeTripsSummary(finalTrips, rawIdles, { fuelPriceCop, baseEff });

    return {
        trips: finalTrips,
        summary,
        fromCache: false
    };
}

/**
 * Main autonomous sync orchestrator:
 * 1. Fetches live GPS snapshot (odometer, today's km, battery voltage, ACC status, location)
 * 2. Performs incremental historical backfill from 2026-02-01 to today (skipping already cached past windows)
 * 3. Recalculates OCTANE's telemetry model with the live GPS odometer & daily series
 * 4. Updates the reactive store and triggers Cloud Sync
 *
 * @param {Object} [options] - { forceFullBackfill: false, silent: true }
 * @returns {Promise<Object|null>}
 */
export async function syncGpsTelemetry(options = {}) {
    if (activeSyncPromise && !options.forceFullBackfill) {
        return activeSyncPromise;
    }

    activeSyncPromise = (async () => {
        try {
            const profile = await getVehicleProfile();
            let cfg = getGpsConfig(profile);
            if (!cfg.enabled || !cfg.username || !cfg.password) return null;

            // Ensure valid session token and auto-discover IMEI if user left IMEI blank
            if (!cfg.imei) {
                const auth = await loginIopgps(cfg);
                const discoveredImei = await discoverAccountImei(auth.accountId || cfg.accountId, auth.accessToken);
                if (!discoveredImei) {
                    throw new Error('Ingresa el IMEI del GPS o verifica tu cuenta');
                }
                cfg = {
                    ...cfg,
                    imei: discoveredImei,
                    accountId: auth.accountId || cfg.accountId
                };
            }

            // Persist remembered credentials in localStorage so the user only enters them once
            saveRememberedGpsCreds({
                enabled: true,
                username: cfg.username,
                password: cfg.password,
                imei: cfg.imei,
                accountId: cfg.accountId,
                installStartDate: cfg.installStartDate || cfg.installDate,
                proxyUrl: cfg.proxyUrl || '',
                stationAlertsEnabled: Boolean(cfg.stationAlertsEnabled)
            });

            const todayStr = todayLocalYmd();
            const installDate = cfg.installDate || IOPGPS_INSTALL_DATE;

            // 1. Live snapshot (Odometer, Today KM, Voltage, ACC)
            const live = await fetchGpsLiveSnapshot(cfg.imei);

            // 2. Incremental backfill of daily telemetry from installDate (2026-02-01) to todayStr
            const existingDays = { ...(profile?.gpsCache?.days || {}) };
            const windows = build30DayWindows(installDate, todayStr);

            // Determine which windows need fetching:
            // - Any window where startYmd or endYmd is missing from existingDays
            // - Always refresh the last window (which contains today and recent days)
            for (let i = 0; i < windows.length; i++) {
                const w = windows[i];
                const isLastWindow = i === windows.length - 1;
                const hasWindowCached = Boolean(existingDays[w.startYmd] && existingDays[w.endYmd]);

                if (options.forceFullBackfill || isLastWindow || !hasWindowCached) {
                    const windowDays = await fetchWindowDailyTelemetry(cfg.imei, w.startUnix, w.endUnix, cfg.zoneId);
                    Object.assign(existingDays, windowDays);
                }
            }

            // Ensure today's live mileage is reflected in today's entry
            if (live.todayMile >= 0) {
                const curToday = existingDays[todayStr] || {
                    date: todayStr,
                    km: 0,
                    miles: 0,
                    runTimeSec: 0,
                    runTime: 0,
                    stayTimeSec: 0,
                    stayTime: 0,
                    runNo: 0,
                    stayNo: 0,
                    overspeedNo: 0,
                    avgSpeedKmh: 0,
                    idleAccOnSec: 0,
                    idleAccOnCount: 0
                };
                const updatedTodayKm = Math.max(Number(curToday.km ?? curToday.miles) || 0, live.todayMile);
                existingDays[todayStr] = {
                    ...curToday,
                    km: updatedTodayKm,
                    miles: updatedTodayKm
                };
            }

            const voltageHistory = recordVoltageSample(profile?.gpsCache?.voltageHistory || [], live);

            const gpsCache = {
                ...(profile?.gpsCache || {}),
                live,
                days: existingDays,
                voltageHistory,
                backfillStartDate: installDate,
                lastSyncedDate: todayStr,
                lastSyncedAt: new Date().toISOString()
            };

            let updatedProfile = await saveVehicleProfile({
                ...profile,
                gpsConfig: cfg,
                gpsCache
            });

            // 3. Recompute OCTANE Telemetry Model with fused GPS cache
            const logs = await getTelemetryLogs();
            const stateSnap = store.getState();
            const engineResults = calculateTelemetryModel(logs, updatedProfile, {
                scopeFilter: stateSnap.scopeFilter,
                fuelPriceCop: updatedProfile.fuelPriceCop || stateSnap.fuelPriceCop
            });

            // Persist learned physicalSensitivity if changed by >= 0.005, and check station geofence stops
            const prevSensitivity = Number(updatedProfile?.gpsCache?.physicalSensitivity) || 1.0;
            const nextSensitivity = Number(engineResults?.learnedSensitivity) || 1.0;
            const sensitivityChanged = Math.abs(nextSensitivity - prevSensitivity) >= 0.005;

            const todayCachedTrips = updatedProfile?.gpsCache?.tripsByDate?.[todayStr] || [];
            const stationMatch = detectAndProcessStationStops({
                trips: todayCachedTrips,
                idles: [],
                live,
                profile: updatedProfile,
                telemetryLogs: logs
            });

            if (sensitivityChanged || stationMatch.matchedStop) {
                const enrichedCache = {
                    ...(updatedProfile.gpsCache || gpsCache),
                    ...(sensitivityChanged ? { physicalSensitivity: nextSensitivity } : {}),
                    ...(stationMatch.matchedStop ? {
                        notifiedStopIds: stationMatch.updatedNotifiedStopIds,
                        pendingStationMatch: stationMatch.pendingStationMatch
                    } : {})
                };
                updatedProfile = await saveVehicleProfile({
                    ...updatedProfile,
                    gpsCache: enrichedCache
                }).catch(() => updatedProfile);
            }

            store.setState({
                vehicleProfile: updatedProfile,
                telemetryLogs: logs,
                telemetryEngineResults: engineResults,
                gpsLive: live
            });

            if (stationMatch.matchedStop && stationMatch.station && cfg.stationAlertsEnabled === true) {
                notifyGasStationStop(stationMatch.matchedStop, stationMatch.station).catch(() => {});
            }

            refreshAlerts().catch(() => {});
            triggerCloudSync();

            if (!options.silent) {
                showToast(`GPS SINCRONIZADO · ${live.totalMile.toLocaleString('es-CO')} KM · ${live.externalVoltage}V`);
            }

            return { ok: true, live, daysCount: Object.keys(existingDays).length, engineResults };
        } catch (err) {
            console.warn('[OCTANE GPS] Sync warning:', err?.message);
            if (!options.silent) {
                showToast(`ENLACE GPS: ${err?.message || 'SIN SEÑAL'}`);
            }
            return null;
        } finally {
            activeSyncPromise = null;
        }
    })();

    return activeSyncPromise;
}
