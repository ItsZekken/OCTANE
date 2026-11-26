/**
 * OCTANE — Registro de Versiones y Notas de Actualización (Lenguaje Humano)
 *
 * Política obligatoria (ver AGENTS.md):
 * - En cada actualización nueva, incrementar APP_VERSION en conjunto con
 *   package.json ("version") y public/sw.js (CACHE_NAME = "octane-vX.Y.Z").
 * - Agregar una entrada nueva al inicio de RELEASES con 2 a 5 puntos cortos,
 *   claros y completamente NO técnicos enfocados en la experiencia del conductor.
 * - El popup de novedades aparece una única vez por versión.
 */

export const APP_VERSION = '1.0.15';
export const RELEASE_NOTES_STORAGE_KEY = 'octane_seen_release_version';

export const RELEASES = Object.freeze([
  Object.freeze({
    version: '1.0.15',
    date: '2026-11-26',
    title: 'Nueva versión',
    subtitle: 'Navegación más fluida y tu historial siempre a la mano',
    highlights: Object.freeze([
      'Botón atrás inteligente: volver desde cualquier ventana, mapa o detalle te regresa al paso anterior sin sacarte de la app.',
      'Memoria de posición en tus rutas: al regresar desde el detalle de un viaje vuelves exactamente al punto de la lista donde ibas.',
      'Historial GPS guardado para siempre: tus recorridos pasados se archivan automáticamente con indicador de avance en vivo.',
      'Ajustes más limpios: la configuración del GPS ahora permanece plegada hasta que necesites abrirla y el mapa de rutas luce bien en modo claro y oscuro.'
    ])
  })
]);

/**
 * Resolves a safe storage adapter (browser localStorage or injected mock).
 * @param {Storage|Object|null} [storage]
 * @returns {Storage|Object|null}
 */
function resolveStorage(storage) {
  if (storage && typeof storage.getItem === 'function') return storage;
  try {
    if (typeof localStorage !== 'undefined' && localStorage) return localStorage;
  } catch (_) {}
  return null;
}

/**
 * Returns the latest release entry matching APP_VERSION (or first entry).
 * @returns {{ version: string, date: string, title: string, subtitle: string, highlights: readonly string[] }}
 */
export function getCurrentRelease() {
  return RELEASES.find((r) => r.version === APP_VERSION) || RELEASES[0];
}

/**
 * Reads the last release version already seen by the user on this device.
 * @param {Storage|Object|null} [storage]
 * @returns {string}
 */
export function getSeenReleaseVersion(storage = null) {
  const store = resolveStorage(storage);
  if (!store) return '';
  try {
    return String(store.getItem(RELEASE_NOTES_STORAGE_KEY) || '').trim();
  } catch (_) {
    return '';
  }
}

/**
 * Marks a version (default: current APP_VERSION) as already shown so it never repeats.
 * @param {string} [version=APP_VERSION]
 * @param {Storage|Object|null} [storage]
 * @returns {boolean}
 */
export function markReleaseNotesSeen(version = APP_VERSION, storage = null) {
  const store = resolveStorage(storage);
  if (!store || typeof store.setItem !== 'function') return false;
  try {
    store.setItem(RELEASE_NOTES_STORAGE_KEY, String(version || APP_VERSION));
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Determines whether the one-time update popup should be presented for the current release.
 * Skips display during brand-new onboarding so first-time setup stays clean.
 *
 * @param {Object} [options={}]
 * @param {Storage|Object|null} [options.storage]
 * @param {boolean} [options.isFirstTimeOnboarding=false]
 * @returns {boolean}
 */
export function shouldShowReleaseNotes(options = {}) {
  if (options.isFirstTimeOnboarding) return false;
  const current = getCurrentRelease();
  if (!current || !current.version || !Array.isArray(current.highlights) || current.highlights.length === 0) {
    return false;
  }
  const seen = getSeenReleaseVersion(options.storage || null);
  return seen !== current.version;
}
