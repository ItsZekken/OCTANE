/**
 * OCTANE // KINETIC — Colombian Vehicle Scraper & Technical Extraction Engine
 * 
 * Pipeline architecture:
 * 1. User-Agent Header Rotation & Anti-Detection Fingerprinting
 * 2. Token-Bucket & Exponential Backoff Rate Limiting
 * 3. File-System Disk Caching (.cache/) with SHA256 Keying & TTL
 * 4. Multi-Source Scraper (FASECOLDA, Revista Motor, ANDEMOS, Assembler APIs)
 * 5. Technical Normalizer for OCTANE // KINETIC Gauge & Tank Specifications
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resilientFetch, getFromCache, setInCache, sleep, getRandomUserAgent } from './cache.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_DIR = path.join(__dirname, '.cache');
const TAXONOMY_PATH = path.join(__dirname, 'taxonomy-data.json');

// Advanced rotating client headers mimicking modern Colombian browsers
export const DEVICE_PROFILES = [
  {
    secChUa: '"Google Chrome";v="129", "Not=A?Brand";v="8", "Chromium";v="129"',
    secChUaMobile: '?0',
    secChUaPlatform: '"Windows"',
    acceptLanguage: 'es-CO,es;q=0.9,en-US;q=0.8,en;q=0.7',
    secFetchDest: 'document',
    secFetchMode: 'navigate',
    secFetchSite: 'none',
    secFetchUser: '?1'
  },
  {
    secChUa: '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
    secChUaMobile: '?0',
    secChUaPlatform: '"macOS"',
    acceptLanguage: 'es-419,es;q=0.9,en;q=0.8',
    secFetchDest: 'document',
    secFetchMode: 'navigate',
    secFetchSite: 'same-origin',
    secFetchUser: '?1'
  },
  {
    secChUa: '"Not/A)Brand";v="8", "Chromium";v="126", "Microsoft Edge";v="126"',
    secChUaMobile: '?0',
    secChUaPlatform: '"Windows"',
    acceptLanguage: 'es-CO,es-ES;q=0.9,es;q=0.8',
    secFetchDest: 'empty',
    secFetchMode: 'cors',
    secFetchSite: 'same-origin',
    secFetchUser: '?0'
  }
];

/**
 * Builds adaptive request headers with rotation
 * @param {string} [referer] 
 * @returns {Record<string, string>}
 */
export function buildRotatingHeaders(referer = 'https://www.google.com.co/') {
  const profile = DEVICE_PROFILES[Math.floor(Math.random() * DEVICE_PROFILES.length)];
  return {
    'User-Agent': getRandomUserAgent(),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
    'Accept-Language': profile.acceptLanguage,
    'Sec-Ch-Ua': profile.secChUa,
    'Sec-Ch-Ua-Mobile': profile.secChUaMobile,
    'Sec-Ch-Ua-Platform': profile.secChUaPlatform,
    'Sec-Fetch-Dest': profile.secFetchDest,
    'Sec-Fetch-Mode': profile.secFetchMode,
    'Sec-Fetch-Site': profile.secFetchSite,
    'Sec-Fetch-User': profile.secFetchUser,
    'Referer': referer,
    'DNT': '1',
    'Connection': 'keep-alive',
    'Cache-Control': 'max-age=0'
  };
}

/**
 * Generates deterministic cache key using SHA-256
 * @param {string} url 
 * @param {object} [params] 
 * @returns {string}
 */
export function generateCacheKey(url, params = {}) {
  const payload = url + JSON.stringify(params);
  return 'req_' + crypto.createHash('sha256').update(payload).digest('hex').substring(0, 24);
}

/**
 * Scraper Rate Limiter & Request Queue
 */
export class AdaptiveRateLimiter {
  constructor(requestsPerMinute = 30, minDelayMs = 1200) {
    this.minDelayMs = minDelayMs;
    this.lastRequestTimestamp = 0;
    this.delayVariance = 800; // randomized human jitter
  }

  async throttle() {
    const now = Date.now();
    const elapsed = now - this.lastRequestTimestamp;
    const targetDelay = this.minDelayMs + Math.floor(Math.random() * this.delayVariance);

    if (elapsed < targetDelay) {
      const waitTime = targetDelay - elapsed;
      await sleep(waitTime);
    }
    this.lastRequestTimestamp = Date.now();
  }
}

/**
 * Main Vehicle Scraper Engine
 */
export class VehicleScraperEngine {
  constructor(options = {}) {
    this.rateLimiter = new AdaptiveRateLimiter(options.rpm || 25, options.delay || 1500);
    this.cacheTtlMs = options.cacheTtlMs || (7 * 24 * 60 * 60 * 1000); // 7 days
    this.stats = {
      requests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      retries: 0,
      errors: 0
    };
  }

  /**
   * Fetches an automotive data endpoint with caching & rate limiting
   * @param {string} url 
   * @param {object} [options] 
   * @returns {Promise<any>}
   */
  async fetchWithCache(url, options = {}) {
    const cacheKey = generateCacheKey(url, options.body ? { body: options.body } : {});
    
    // Check local cache first
    const cachedData = getFromCache(cacheKey, this.cacheTtlMs);
    if (cachedData && !options.forceRefresh) {
      this.stats.cacheHits++;
      return { data: cachedData, fromCache: true, key: cacheKey };
    }

    this.stats.cacheMisses++;
    await this.rateLimiter.throttle();

    const headers = {
      ...buildRotatingHeaders(options.referer),
      ...(options.headers || {})
    };

    try {
      this.stats.requests++;
      const response = await resilientFetch(url, { ...options, headers }, 4, 1500);
      const contentType = response.headers.get('content-type') || '';
      
      let payload;
      if (contentType.includes('application/json')) {
        payload = await response.json();
      } else {
        payload = await response.text();
      }

      setInCache(cacheKey, payload);
      return { data: payload, fromCache: false, key: cacheKey };
    } catch (err) {
      this.stats.errors++;
      console.error(`[SCRAPER ERROR] ${url} ->`, err.message);
      throw err;
    }
  }

  /**
   * Loads the current master Colombian vehicle taxonomy
   * @returns {Array<object>}
   */
  loadTaxonomy() {
    if (!fs.existsSync(TAXONOMY_PATH)) {
      throw new Error(`Taxonomy file not found at ${TAXONOMY_PATH}`);
    }
    const raw = fs.readFileSync(TAXONOMY_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed.vehicles;
  }

  /**
   * Normalizes raw vehicle parameters to OCTANE standard format
   * @param {object} raw 
   * @returns {object}
   */
  normalizeVehicleSpec(raw) {
    const liters = Number(raw.tankCapacityLiters) || 0;
    const gallons = liters > 0 ? Number((liters / 3.78541).toFixed(2)) : 0;
    const reserveLiters = Number(raw.reserveLiters) || (liters > 0 ? Number((liters * 0.12).toFixed(1)) : 0);
    const reserveGallons = reserveLiters > 0 ? Number((reserveLiters / 3.78541).toFixed(2)) : 0;

    let defaultGauge = raw.defaultGauge || 'analog-180';
    if (raw.fuelType === 'electrico') {
      defaultGauge = 'digital-lcd';
    } else if (raw.model && raw.model.toLowerCase().includes('picanto')) {
      defaultGauge = 'spicy-arc';
    }

    return {
      id: raw.id,
      brand: raw.brand,
      model: raw.model,
      trim: raw.trim,
      generation: raw.generation,
      yearRange: raw.yearRange,
      category: raw.category,
      bodyType: raw.bodyType,
      engine: raw.engine,
      fuelType: raw.fuelType,
      tankCapacityLiters: liters,
      tankCapacityGallons: gallons,
      reserveLiters: reserveLiters,
      reserveGallons: reserveGallons,
      defaultEfficiencyKmGal: Number(raw.defaultEfficiencyKmGal) || 40.0,
      defaultGauge: defaultGauge,
      usageSuitability: Array.isArray(raw.usageSuitability) ? raw.usageSuitability : ['particular'],
      fasecoldaCode: raw.fasecoldaCode || '00000000',
      sources: raw.sources || ['FASECOLDA', 'Revista Motor Colombia']
    };
  }

  /**
   * Dumps pipeline diagnostics and cache statistics
   */
  getDiagnostics() {
    const cacheFiles = fs.existsSync(CACHE_DIR) ? fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.json')) : [];
    return {
      stats: this.stats,
      cacheEntriesCount: cacheFiles.length,
      cachePath: CACHE_DIR,
      taxonomyPath: TAXONOMY_PATH
    };
  }
}

// Standalone execution test when run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('--- OCTANE // KINETIC VEHICLE SCRAPER ENGINE ---');
  const engine = new VehicleScraperEngine();
  const taxonomy = engine.loadTaxonomy();
  console.log(`Loaded ${taxonomy.length} vehicles from master taxonomy.`);
  console.log('Diagnostics:', engine.getDiagnostics());
}
