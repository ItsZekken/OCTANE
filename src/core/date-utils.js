/**
 * OCTANE — Local calendar date helpers.
 *
 * `new Date().toISOString().slice(0, 10)` devuelve la fecha en UTC: en Colombia (UTC-5),
 * después de las 7:00 p. m. ya "es mañana", y los registros quedaban con fecha futura.
 * Todo "hoy" de la app debe salir de aquí.
 */

/**
 * Formats a Date as YYYY-MM-DD using the device's local calendar.
 * @param {Date} [d=new Date()]
 * @returns {string}
 */
export function localYmd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Today's local date as YYYY-MM-DD.
 * @returns {string}
 */
export function todayLocalYmd() {
  return localYmd(new Date());
}

/**
 * Short human label (e.g. "12 OCT") for a YYYY-MM-DD string.
 * @param {string} ymd
 * @returns {string}
 */
export function shortHumanDate(ymd) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}/.test(ymd)) return '';
  const months = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
  const [, m, d] = ymd.slice(0, 10).split('-').map(Number);
  return `${String(d).padStart(2, '0')} ${months[m - 1]}`;
}
