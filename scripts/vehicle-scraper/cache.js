/**
 * OCTANE // KINETIC — Vehicle Scraper Cache & Resilience Layer
 * 
 * Provides disk caching, exponential backoff, request rate limiting,
 * and User-Agent rotation for automated scraping pipelines.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_DIR = path.join(__dirname, '.cache');

if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:129.0) Gecko/20100101 Firefox/129.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:128.0) Gecko/20100101 Firefox/128.0'
];

/**
 * Returns a random User-Agent header
 */
export function getRandomUserAgent() {
  const index = Math.floor(Math.random() * USER_AGENTS.length);
  return USER_AGENTS[index];
}

/**
 * Generates a sanitized cache key
 * @param {string} key 
 */
function sanitizeKey(key) {
  return key.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
}

/**
 * Checks if a cache entry exists and is fresh
 * @param {string} key 
 * @param {number} [ttlMs] Time to live in ms (default: 7 days)
 */
export function getFromCache(key, ttlMs = 7 * 24 * 60 * 60 * 1000) {
  const filePath = path.join(CACHE_DIR, `${sanitizeKey(key)}.json`);
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const entry = JSON.parse(raw);
    if (Date.now() - entry.timestamp > ttlMs) {
      return null;
    }
    return entry.data;
  } catch (err) {
    return null;
  }
}

/**
 * Writes data into the cache
 * @param {string} key 
 * @param {any} data 
 */
export function setInCache(key, data) {
  const filePath = path.join(CACHE_DIR, `${sanitizeKey(key)}.json`);
  try {
    const entry = {
      timestamp: Date.now(),
      key,
      data
    };
    fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf-8');
  } catch (err) {
    console.error(`[CACHE ERROR] Failed to cache key "${key}":`, err.message);
  }
}

/**
 * Sleep helper for rate limiting
 * @param {number} ms 
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resilient fetch with exponential backoff and rate limiting
 * @param {string} url 
 * @param {RequestInit} [options] 
 * @param {number} [maxRetries] 
 * @param {number} [baseDelayMs] 
 */
export async function resilientFetch(url, options = {}, maxRetries = 3, baseDelayMs = 1000) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      const headers = {
        'User-Agent': getRandomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
        'Accept-Language': 'es-CO,es;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
        ...(options.headers || {})
      };

      const res = await fetch(url, { ...options, headers });
      if (res.status === 429) {
        // Rate limited
        const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 500;
        console.warn(`[RATE LIMIT 429] Backing off for ${Math.round(delay)}ms on ${url}`);
        await sleep(delay);
        attempt++;
        continue;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      return res;
    } catch (err) {
      attempt++;
      if (attempt >= maxRetries) {
        throw err;
      }
      const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 500;
      await sleep(delay);
    }
  }
}
