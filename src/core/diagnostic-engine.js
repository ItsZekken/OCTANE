/**
 * OCTANE // KINETIC — Motor Analítico Transversal ("diagnostic-engine.js")
 * 
 * Orquesta y cruza métricas de:
 * - Telemetría de Combustible (TelemetryEngine)
 * - Finanzas y Economía Marginal de Plataformas (RidesEngine)
 * 
 * Reglas de Diseño Industrial:
 * - Función pura inmutable: generateOperationalDiagnostic(state, periodFilter)
 * - Cero divisiones por cero con guardias matemáticas en todos los ratios
 * - Cero verbosidad y cero prefijos ruidosos
 * - Formateadores con estricto signo monetario único (cero $$)
 */

import {
  calculateRidesCycleSummary,
  calculateCostPerKm,
  DEFAULT_FUEL_PRICE_COP,
  DEFAULT_ROUTINE_DAILY_KM,
  DEFAULT_EFFICIENCY_KM_GAL as DEFAULT_BENCHMARK_EFF,
  getCycleDateRange
} from './rides-engine.js';
import { formatNumber, buildInterpolatedDailySeries } from './telemetry-engine.js';
import { todayLocalYmd, shortHumanDate } from './date-utils.js';

export const FALLBACK_OIL_SERVICE_COST_COP = 135000;

/**
 * Formatea un número como COP garantizando exactamente un solo signo '$'
 * @param {number|string} val
 * @returns {string} E.g. "$535.140"
 */
export function fmtCop(val) {
  if (val === null || val === undefined || isNaN(Number(val))) return '$0';
  const num = Math.round(Number(val));
  const sign = num < 0 ? '-' : '';
  const abs = Math.abs(num);
  return `${sign}$${formatNumber(abs)}`;
}

/**
 * Formatea un número como COP compacto garantizando exactamente un solo signo '$'
 * @param {number|string} val
 * @returns {string} E.g. "$535K" o "$1.2M"
 */
export function fmtCompact(val) {
  if (val === null || val === undefined || isNaN(Number(val))) return '$0';
  const num = Math.round(Number(val));
  const sign = num < 0 ? '-' : '';
  const abs = Math.abs(num);
  if (abs >= 1000000) {
    return `${sign}$${(abs / 1000000).toFixed(1)}M`;
  }
  if (abs >= 1000) {
    return `${sign}$${Math.round(abs / 1000)}K`;
  }
  return `${sign}$${formatNumber(abs)}`;
}

/**
 * Normaliza el nombre de una plataforma para consistencia visual y de agrupamiento.
 * @param {string} raw
 * @returns {string}
 */
export function normalizePlatformName(raw) {
  if (!raw || typeof raw !== 'string') return 'Directo';
  const clean = raw.trim();
  const lower = clean.toLowerCase();
  if (lower === 'uber') return 'Uber';
  if (lower === 'didi') return 'DiDi';
  if (lower === 'indrive') return 'InDrive';
  if (lower === 'gyhsell') return 'Gyhsell';
  if (lower === 'particular') return 'Particular';
  if (lower === 'directo') return 'Directo';
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

/**
 * Detecta registros potencialmente duplicados en la colección de carreras.
 * Criterio de duplicidad: Misma fecha, misma plataforma, mismo valor bruto y mismos kilómetros.
 * 
 * @param {Array} rawSessions - Array de sesiones de carreras
 * @returns {Array<Object>} Lista de anomalías detectadas
 */
export function detectRideAnomalies(rawSessions = []) {
  if (!Array.isArray(rawSessions) || rawSessions.length === 0) {
    return [];
  }

  const rideOnly = rawSessions.filter(s => s && s.type !== 'expense' && s.type !== 'pass');
  const groups = new Map();

  rideOnly.forEach(s => {
    const date = String(s.date || '').slice(0, 10);
    const platform = normalizePlatformName(s.platform);
    const amount = Math.round(Number(s.grossEarnings || s.fareCop || s.grossRevenueCop || s.grossIncomeCop || 0));
    const km = Number((Number(s.distanceKm || s.workKm || s.tripKmTotal || 0)).toFixed(1));
    const id = s.id || `anon_${Math.random()}`;

    if (!date || (amount === 0 && km === 0)) return;

    const signature = `${date}__${platform.toLowerCase()}__${amount}__${km}`;
    if (!groups.has(signature)) {
      groups.set(signature, []);
    }
    groups.get(signature).push({ id, date, platform, amount, km, raw: s });
  });

  const anomalies = [];
  groups.forEach((items, signature) => {
    if (items.length > 1) {
      const original = items[0];
      const duplicates = items.slice(1);
      anomalies.push({
        signature,
        date: original.date,
        platform: original.platform,
        amountCop: original.amount,
        km: original.km,
        count: items.length,
        originalId: original.id,
        duplicateIds: duplicates.map(d => d.id),
        candidateToDeleteId: duplicates[0].id,
        allIds: items.map(i => i.id)
      });
    }
  });

  return anomalies.sort((a, b) => (b.date > a.date ? 1 : (b.date < a.date ? -1 : 0)));
}

/**
 * Resuelve la ventana de fechas para los selectores del informe:
 * - 'this_month': Mes calendario actual
 * - 'prev_month': Mes calendario anterior
 * - 'all_time': Todo el histórico acumulado desde la primera carrera
 * 
 * @param {string|Object} periodFilter
 * @param {Array} rideSessions
 * @param {Array} telemetryLogs
 * @returns {{ startDate: string, endDate: string, label: string, displayRange: string, periodKey: string }}
 */
export function resolveDiagnosticPeriod(periodFilter = 'this_month', rideSessions = [], telemetryLogs = []) {
  const todayStr = todayLocalYmd();
  const [curYear, curMonthNum] = todayStr.split('-').map(Number);

  if (periodFilter === 'this_month' || periodFilter === 'month') {
    const startStr = `${curYear}-${String(curMonthNum).padStart(2, '0')}-01`;
    const lastDay = new Date(curYear, curMonthNum, 0).getDate();
    const endStr = `${curYear}-${String(curMonthNum).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    return {
      startDate: startStr,
      endDate: endStr,
      label: 'ESTE MES',
      displayRange: `${shortHumanDate(startStr)} — ${shortHumanDate(endStr)}`,
      periodKey: 'this_month'
    };
  }

  if (periodFilter === 'prev_month') {
    const prevMonthDate = new Date(curYear, curMonthNum - 2, 1, 12, 0, 0);
    const py = prevMonthDate.getFullYear();
    const pm = prevMonthDate.getMonth() + 1;
    const lastDay = new Date(py, pm, 0).getDate();
    const startStr = `${py}-${String(pm).padStart(2, '0')}-01`;
    const endStr = `${py}-${String(pm).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    return {
      startDate: startStr,
      endDate: endStr,
      label: 'MES ANTERIOR',
      displayRange: `${shortHumanDate(startStr)} — ${shortHumanDate(endStr)}`,
      periodKey: 'prev_month'
    };
  }

  if (periodFilter === 'all_time' || periodFilter === 'historic') {
    let earliestDate = todayStr;
    rideSessions.forEach(s => {
      if (!s || s.type === 'expense' || s.type === 'pass') return;
      const d = String(s.date || '').slice(0, 10);
      if (d && d < earliestDate) earliestDate = d;
    });
    if (earliestDate === todayStr && rideSessions.length > 0) {
      rideSessions.forEach(s => {
        const d = String(s?.date || '').slice(0, 10);
        if (d && d < earliestDate) earliestDate = d;
      });
    }

    // Anclar al primer día del mes donde ocurrió la primera carrera registrada
    // para acumular meses enteros (ej. octubre completo + noviembre en curso)
    // ignorando meses previos sin carreras (junio, julio, agosto, septiembre).
    const startMonthStr = earliestDate !== todayStr 
      ? `${earliestDate.slice(0, 7)}-01` 
      : `${curYear}-${String(curMonthNum).padStart(2, '0')}-01`;

    return {
      startDate: startMonthStr,
      endDate: todayStr,
      label: 'DESDE INICIO',
      displayRange: `${shortHumanDate(startMonthStr)} — ${shortHumanDate(todayStr)}`,
      periodKey: 'all_time'
    };
  }

  // Objeto personalizado { startDate, endDate, label }
  if (typeof periodFilter === 'object' && periodFilter !== null) {
    if (periodFilter.startDate && periodFilter.endDate) {
      return {
        startDate: periodFilter.startDate,
        endDate: periodFilter.endDate,
        label: periodFilter.label || 'PERSONALIZADO',
        displayRange: `${shortHumanDate(periodFilter.startDate)} — ${shortHumanDate(periodFilter.endDate)}`,
        periodKey: periodFilter.periodKey || 'custom'
      };
    }

    if (periodFilter.cycleType) {
      const range = getCycleDateRange(periodFilter.cycleType, new Date(), telemetryLogs, periodFilter.cycleOffset || 0);
      return {
        startDate: range.startDate,
        endDate: range.endDate,
        label: range.label || 'PERIODO',
        displayRange: range.displayRange,
        periodKey: periodFilter.cycleType
      };
    }
  }

  // Fallback a este mes
  const startStr = `${curYear}-${String(curMonthNum).padStart(2, '0')}-01`;
  const lastDay = new Date(curYear, curMonthNum, 0).getDate();
  const endStr = `${curYear}-${String(curMonthNum).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return {
    startDate: startStr,
    endDate: endStr,
    label: 'ESTE MES',
    displayRange: `${shortHumanDate(startStr)} — ${shortHumanDate(endStr)}`,
    periodKey: 'this_month'
  };
}

const TIME_SLOTS = [
  { key: 'madrugada', label: 'MADRUGADA', range: '00–05', minHour: 0, maxHour: 5 },
  { key: 'manana', label: 'MAÑANA', range: '06–11', minHour: 6, maxHour: 11 },
  { key: 'tarde', label: 'TARDE', range: '12–17', minHour: 12, maxHour: 17 },
  { key: 'noche', label: 'NOCHE', range: '18–23', minHour: 18, maxHour: 23 }
];

function extractLocalHour(obj, { isGpsTrip = false } = {}) {
  if (!obj || typeof obj !== 'object') return null;
  if (typeof obj.time === 'string' && /^\d{1,2}:\d{2}/.test(obj.time.trim())) {
    const h = parseInt(obj.time.trim().split(':')[0], 10);
    if (Number.isFinite(h) && h >= 0 && h <= 23) return h;
  }
  if (typeof obj.startTimeHm === 'string' && /^\d{1,2}:\d{2}/.test(obj.startTimeHm.trim())) {
    const h = parseInt(obj.startTimeHm.trim().split(':')[0], 10);
    if (Number.isFinite(h) && h >= 0 && h <= 23) return h;
  }
  if (isGpsTrip) {
    const rawMs = Number(obj.startTimeMs ?? obj.startTime);
    if (Number.isFinite(rawMs) && rawMs > 0) {
      const d = new Date(rawMs < 1e12 ? rawMs * 1000 : rawMs);
      if (!isNaN(d.getTime())) return d.getHours();
    }
  }
  // Never fall back to createdAt for ride sessions: retroactive logging at home or the next day
  // would misattribute night shifts to morning/late-night hours.
  return null;
}

/**
 * Classifies timestamped ride sessions into 4 circadian slots (MADRUGADA, MAÑANA, TARDE, NOCHE)
 * and enriches slot duration using matching GPS trips on the same date & time window when available.
 *
 * @param {Array} [rideSessions=[]]
 * @param {Object} [tripsByDate={}]
 * @param {Object} [options={}]
 * @returns {{ slots: Array<Object>, hasTimestampedData: boolean }}
 */
export function buildTimeSlotMatrix(rideSessions = [], tripsByDate = {}, options = {}) {
  const startDate = options.startDate ? String(options.startDate).slice(0, 10) : '';
  const endDate = options.endDate ? String(options.endDate).slice(0, 10) : '';

  const slotAcc = new Map(TIME_SLOTS.map(s => [s.key, {
    key: s.key,
    label: s.label,
    range: s.range,
    tripsCount: 0,
    grossCop: 0,
    km: 0,
    gpsDurationSec: 0,
    activeDates: new Set()
  }]));

  const resolveSlot = (hour) => TIME_SLOTS.find(s => hour >= s.minHour && hour <= s.maxHour) || null;
  let totalTimestamped = 0;

  if (Array.isArray(rideSessions)) {
    for (const s of rideSessions) {
      if (!s || !s.date || s.type === 'expense' || s.type === 'pass') continue;
      const d = String(s.date).slice(0, 10);
      if (startDate && d < startDate) continue;
      if (endDate && d > endDate) continue;

      if (Array.isArray(s.rides) && s.rides.length > 0) {
        for (const sub of s.rides) {
          const hour = extractLocalHour(sub) ?? extractLocalHour(s);
          if (hour === null) continue;
          const slotDef = resolveSlot(hour);
          if (!slotDef) continue;
          const bucket = slotAcc.get(slotDef.key);
          bucket.tripsCount += 1;
          bucket.grossCop += Number(sub.fareCop || sub.netValue || 0);
          bucket.km += Number(sub.distanceKm || sub.km || 0);
          bucket.activeDates.add(d);
          totalTimestamped += 1;
        }
      } else {
        const hour = extractLocalHour(s);
        if (hour === null) continue;
        const slotDef = resolveSlot(hour);
        if (!slotDef) continue;
        const bucket = slotAcc.get(slotDef.key);
        const count = Number(s.totalRidesCount) || 1;
        bucket.tripsCount += count;
        bucket.grossCop += Number(s.grossEarnings || s.fareCop || s.grossRevenueCop || s.grossIncomeCop || 0);
        bucket.km += Number(s.distanceKm || s.workKm || s.tripKmTotal || 0);
        bucket.activeDates.add(d);
        totalTimestamped += count;
      }
    }
  }

  // Correlate GPS trip duration on dates that had ride activity in each slot
  if (tripsByDate && typeof tripsByDate === 'object') {
    for (const bucket of slotAcc.values()) {
      for (const dateKey of bucket.activeDates) {
        const dayTrips = tripsByDate[dateKey];
        if (!Array.isArray(dayTrips)) continue;
        for (const t of dayTrips) {
          const tHour = extractLocalHour(t, { isGpsTrip: true });
          if (tHour === null) continue;
          const slotDef = resolveSlot(tHour);
          if (slotDef && slotDef.key === bucket.key) {
            bucket.gpsDurationSec += Number(t.durationSec ?? t.tripTimeSec) || 0;
          }
        }
      }
    }
  }

  const slots = TIME_SLOTS.map(def => {
    const b = slotAcc.get(def.key);
    const workHours = Number((b.gpsDurationSec / 3600).toFixed(2));
    const ratePerHourCop = workHours >= 0.25 ? Math.round(b.grossCop / workHours) : null;
    const avgFareCop = b.tripsCount > 0 ? Math.round(b.grossCop / b.tripsCount) : 0;
    return {
      key: b.key,
      label: b.label,
      range: b.range,
      tripsCount: b.tripsCount,
      grossCop: Math.round(b.grossCop),
      km: Number(b.km.toFixed(1)),
      workHours,
      ratePerHourCop,
      avgFareCop
    };
  });

  return {
    slots,
    hasTimestampedData: totalTimestamped > 0
  };
}

/**
 * Genera el informe financiero y balance operativo transversal completo.
 * 
 * @param {Object} state - Estado de la app (telemetryLogs, rideSessions, platformPasses, vehicleProfile, telemetryModel)
 * @param {Object|string} [periodFilter='this_month'] - 'this_month' | 'prev_month' | 'all_time' o rango
 * @returns {Object} Informe estructurado
 */
export function generateOperationalDiagnostic(state = {}, periodFilter = 'this_month') {
  const telemetryLogs = Array.isArray(state.telemetryLogs) ? state.telemetryLogs : [];
  const rideSessions = Array.isArray(state.rideSessions) ? state.rideSessions : [];
  const platformPasses = Array.isArray(state.platformPasses) ? state.platformPasses : [];
  const maintenanceItems = Array.isArray(state.maintenanceItems) ? state.maintenanceItems : [];
  const vehicleProfile = (state.vehicleProfile && typeof state.vehicleProfile === 'object') ? state.vehicleProfile : {};
  const telemetryModel = (state.telemetryModel && typeof state.telemetryModel === 'object') ? state.telemetryModel : {};

  // 1. Resolver ventana de fechas
  const period = resolveDiagnosticPeriod(periodFilter, rideSessions, telemetryLogs);
  const { startDate, endDate, label: periodLabel, displayRange, periodKey } = period;

  // Parámetros del perfil del vehículo
  const fuelPriceCop = Number(vehicleProfile.fuelPriceCop) || Number(telemetryModel.fuelPriceCop) || DEFAULT_FUEL_PRICE_COP;
  const routineDailyKm = Number(vehicleProfile.routineDailyKm) || DEFAULT_ROUTINE_DAILY_KM;
  const tankCapacityGal = Number(vehicleProfile.tankCapacityGallons) || 9.25;
  const effKmGal = Number(telemetryModel.fullEraAvgEff) || Number(vehicleProfile.defaultEfficiencyKmGal) || DEFAULT_BENCHMARK_EFF;
  const costPerKmCop = calculateCostPerKm({ fuelPriceCop, efficiencyKmGal: effKmGal, telemetryModel, vehicleProfile, exact: true });

  // 2. Resumen de ciclo base usando RidesEngine con las fechas exactas
  const cycleSummary = calculateRidesCycleSummary({
    sessions: rideSessions,
    passes: platformPasses,
    profile: vehicleProfile,
    telemetryLogs,
    telemetryModel,
    cycleType: 'custom',
    startDate,
    endDate
  });

  // Filtrar sesiones del periodo (excluyendo egresos)
  const periodRides = rideSessions.filter(s => {
    if (!s || !s.date || s.type === 'expense' || s.type === 'pass') return false;
    const d = String(s.date).slice(0, 10);
    return d >= startDate && d <= endDate;
  });

  // -------------------------------------------------------------------------
  // SECCIÓN 1: FLUJO DE CAJA Y PROYECCIONES
  // -------------------------------------------------------------------------
  const grossRevenueCop = cycleSummary.grossRevenueCop;
  const totalExpensesCop = cycleSummary.totalExpensesCop;
  const netAppRevenueCop = Math.max(0, grossRevenueCop - totalExpensesCop);

  // Días trabajados con carreras registradas
  const activeDaysCount = Math.max(0, cycleSummary.activeDaysCount || Object.keys(cycleSummary.dailyBreakdown || {}).length);
  const freeNetProfitCop = cycleSummary.freeNetProfitCop; // Margen libre tras combustible de carreras y recogidas

  const avgProfitPerShift = activeDaysCount > 0
    ? Math.round(freeNetProfitCop / activeDaysCount)
    : 0;

  const proj12Days = Math.round(avgProfitPerShift * 12);
  const proj15Days = Math.round(avgProfitPerShift * 15);
  const proj20Days = Math.round(avgProfitPerShift * 20);

  // Proyección de mes completo para el mes en curso (this_month)
  const dNow = new Date();
  const curYear = dNow.getFullYear();
  const curMonthNum = dNow.getMonth() + 1;
  const curDayOfMonth = Math.max(1, dNow.getDate());
  const totalDaysInCurMonth = new Date(curYear, curMonthNum, 0).getDate();
  const projMonth = activeDaysCount > 0
    ? Math.round(avgProfitPerShift * Math.min(totalDaysInCurMonth, Math.max(activeDaysCount, Math.round((activeDaysCount / curDayOfMonth) * totalDaysInCurMonth)))) || proj20Days
    : 0;

  // Propiedades dinámicas para la Celda 3 según el periodo activo:
  let card3Label = 'PROYECCIÓN MES';
  let card3Value = projMonth || proj20Days;
  let card3SubLabel = 'Mes en curso';

  if (periodKey === 'prev_month') {
    card3Label = 'GANANCIA NETA';
    card3Value = freeNetProfitCop;
    card3SubLabel = 'Mes cerrado';
  } else if (periodKey === 'all_time') {
    card3Label = 'GANANCIA NETA';
    card3Value = freeNetProfitCop;
    card3SubLabel = 'Total acumulado';
  } else if (periodKey === 'this_month') {
    card3Label = 'PROYECCIÓN MES';
    card3Value = projMonth || proj20Days;
    card3SubLabel = 'Mes en curso';
  }

  // Reserva de Desgaste (10%)
  const wearReserveCop = Math.round(grossRevenueCop * 0.10);
  const netAfterWearReserveCop = Math.round(freeNetProfitCop - wearReserveCop);

  const hourlyProfitCop = cycleSummary.netProfitPerHourCop ?? null;
  const gpsWorkHours = Number(cycleSummary.totalGpsWorkHours) || 0;
  const gpsIdleFuelCop = Number(cycleSummary.totalIdleFuelCop) || 0;

  const cashFlow = {
    grossRevenueCop,
    totalExpensesCop,
    netAppRevenueCop,
    activeDaysCount,
    freeNetProfitCop,
    avgProfitPerShift,
    hourlyProfitCop,
    gpsWorkHours,
    proj12Days,
    proj15Days,
    proj20Days,
    projMonth,
    card3Label,
    card3Value,
    card3SubLabel,
    wearReserveCop,
    netAfterWearReserveCop
  };

  // -------------------------------------------------------------------------
  // SECCIÓN 2: DESGLOSE DE GASOLINA Y BOLSILLO REAL
  // -------------------------------------------------------------------------
  // Calcular días de calendario del periodo
  const dStart = new Date(startDate + 'T12:00:00');
  const dEnd = new Date(endDate + 'T12:00:00');
  const daysInPeriod = Math.max(1, Math.round((dEnd.getTime() - dStart.getTime()) / 86400000) + 1);

  // Kilómetros de carreras con combustible y recogidas
  const rawEffective = cycleSummary.totalEffectiveWorkKm ?? Math.max(0, (cycleSummary.totalExtraKm || 0) - (cycleSummary.totalPickupKm || 0));
  const kmRides = Number(Number(rawEffective || 0).toFixed(1));
  const kmPickup = Number(Number(cycleSummary.totalPickupKm || 0).toFixed(1));

  // Total de kilómetros recorridos por el vehículo en el periodo
  // Buscamos odómetros de telemetría interpolada (integrando GPS diario si existe)
  const gpsDaysMap = vehicleProfile?.gpsCache?.days || null;
  let totalCarKmFromTelemetry = 0;
  try {
    const dailySeries = buildInterpolatedDailySeries(telemetryLogs, gpsDaysMap);
    const inRangeDaily = dailySeries.filter(d => d.date >= startDate && d.date <= endDate);
    totalCarKmFromTelemetry = inRangeDaily.reduce((acc, d) => acc + (Number(d.km) || 0), 0);
  } catch (_) {}

  const hasGpsFuelData = Boolean(
    cycleSummary.hasGpsFuelData ||
    cycleSummary.fuelSource === 'gps_calibrated' ||
    cycleSummary.fuelSource === 'gps_estimated' ||
    Number(cycleSummary.periodGpsDaysCount) > 0
  );

  let kmBase = 0;
  let totalCarKm = 0;
  let fuelBaseCop = 0;
  let fuelRidesCop = 0;
  let fuelPickupCop = 0;
  let totalCarFuelCop = 0;
  let isGpsCalibrated = false;
  let fuelDataSource = 'estimate';

  if (hasGpsFuelData && Number(cycleSummary.periodCarFuelCop) > 0) {
    totalCarFuelCop = Math.round(cycleSummary.periodCarFuelCop);
    fuelBaseCop = Math.min(totalCarFuelCop, Math.round(cycleSummary.personalFuelCop || 0));
    const ridesAndPickupFuelCop = Math.max(0, totalCarFuelCop - fuelBaseCop);

    const workKmSum = kmRides + kmPickup;
    if (workKmSum > 0) {
      fuelRidesCop = Math.round(ridesAndPickupFuelCop * (kmRides / workKmSum));
      fuelPickupCop = Math.max(0, ridesAndPickupFuelCop - fuelRidesCop);
    } else {
      fuelRidesCop = ridesAndPickupFuelCop;
      fuelPickupCop = 0;
    }

    const fallbackKmBase = totalCarKmFromTelemetry > (kmRides + kmPickup)
      ? Number((totalCarKmFromTelemetry - (kmRides + kmPickup)).toFixed(1))
      : Number((daysInPeriod * routineDailyKm).toFixed(1));
    totalCarKm = Number((Number(cycleSummary.periodCarKm) || totalCarKmFromTelemetry || (fallbackKmBase + kmRides + kmPickup)).toFixed(1));
    kmBase = Number(Math.max(0, totalCarKm - kmRides - kmPickup).toFixed(1));
    isGpsCalibrated = Boolean(
      cycleSummary.isGpsFuelCalibrated ||
      cycleSummary.fuelSource === 'gps_calibrated' ||
      Number(cycleSummary.periodCalibratedDaysCount) > 0
    );
    fuelDataSource = 'gps';
  } else {
    fuelRidesCop = Math.round(kmRides * costPerKmCop);
    fuelPickupCop = Math.round(kmPickup * costPerKmCop);

    // Si no hay lecturas de odómetro registradas suficientes, estimamos la base con routineDailyKm * días
    if (totalCarKmFromTelemetry > (kmRides + kmPickup)) {
      kmBase = Number((totalCarKmFromTelemetry - (kmRides + kmPickup)).toFixed(1));
    } else {
      kmBase = Number((daysInPeriod * routineDailyKm).toFixed(1));
    }

    fuelBaseCop = Math.round(kmBase * costPerKmCop);
    totalCarKm = Number((kmBase + kmRides + kmPickup).toFixed(1));
    totalCarFuelCop = fuelBaseCop + fuelRidesCop + fuelPickupCop + gpsIdleFuelCop;
  }

  // Porcentajes de cada rubro de gasolina
  const pctBase = totalCarFuelCop > 0 ? Math.round((fuelBaseCop / totalCarFuelCop) * 100) : 0;
  const pctRides = totalCarFuelCop > 0 ? Math.min(100 - pctBase, Math.round((fuelRidesCop / totalCarFuelCop) * 100)) : 0;
  const pctPickup = totalCarFuelCop > 0 ? Math.max(0, 100 - pctBase - pctRides) : 0;

  const fuelBreakdown = {
    kmBase,
    fuelBaseCop,
    pctBase,
    kmRides,
    fuelRidesCop,
    pctRides,
    kmPickup,
    fuelPickupCop,
    pctPickup,
    gpsIdleFuelCop,
    totalCarKm,
    totalCarFuelCop,
    effKmGal,
    costPerKmCop,
    isGpsCalibrated,
    fuelDataSource
  };

  // Balance Final de Bolsillo (La Verdad Financiera)
  // 1. Ganancia Libre de Trabajo (Marginal) = Ingreso Neto Apps - (Gasolina Carreras + Recogidas)
  const marginalProfitCop = freeNetProfitCop;

  // 2. % de Toda mi Gasolina Cubierta = (Marginal / Total Car Fuel) * 100
  const totalFuelCoveredPct = totalCarFuelCop > 0
    ? Math.round((marginalProfitCop / totalCarFuelCop) * 100)
    : 0;

  const gallonsEquivalent = fuelPriceCop > 0 ? Number((marginalProfitCop / fuelPriceCop).toFixed(2)) : 0;
  const tanksEquivalent = tankCapacityGal > 0 ? Number((gallonsEquivalent / tankCapacityGal).toFixed(1)) : 0;

  // 3. Bolsillo Final tras Pagar TODA la Gasolina del Carro = Ingreso Neto Apps - Total Gasolina del Carro
  const finalPocketCop = Math.round(netAppRevenueCop - totalCarFuelCop);
  const isFinalPocketPositive = finalPocketCop >= 0;

  const pocketBalance = {
    marginalProfitCop,
    totalFuelCoveredPct,
    gallonsEquivalent,
    tanksEquivalent,
    finalPocketCop,
    isFinalPocketPositive,
    outOfPocketCop: Math.abs(finalPocketCop)
  };

  // -------------------------------------------------------------------------
  // SECCIÓN 3: TABLA DE EFICIENCIA POR CANAL (Sin barras)
  // -------------------------------------------------------------------------
  const platformMap = new Map();

  periodRides.forEach(s => {
    if (Array.isArray(s.rides) && s.rides.length > 0) {
      s.rides.forEach(sub => {
        const pName = normalizePlatformName(sub.platform || s.platform);
        const fare = Number(sub.fareCop || sub.netValue || 0);
        const km = Number(sub.distanceKm || sub.km || 0);
        const isEnRoute = Boolean(sub.isEnRoute || sub.tripType === 'en_route');

        if (!platformMap.has(pName)) {
          platformMap.set(pName, {
            platform: pName,
            tripsCount: 0,
            totalKm: 0,
            grossRevenueCop: 0,
            enRouteTrips: 0
          });
        }
        const data = platformMap.get(pName);
        data.tripsCount += 1;
        data.totalKm += km;
        data.grossRevenueCop += fare;
        if (isEnRoute) data.enRouteTrips += 1;
      });
    } else {
      const pName = normalizePlatformName(s.platform);
      const fare = Number(s.grossEarnings || s.fareCop || s.grossRevenueCop || s.grossIncomeCop || 0);
      const km = Number(s.distanceKm || s.workKm || s.tripKmTotal || 0);
      const isEnRoute = Boolean(s.isEnRoute || s.tripType === 'en_route');
      const count = Number(s.totalRidesCount) || 1;

      if (!platformMap.has(pName)) {
        platformMap.set(pName, {
          platform: pName,
          tripsCount: 0,
          totalKm: 0,
          grossRevenueCop: 0,
          enRouteTrips: 0
        });
      }
      const data = platformMap.get(pName);
      data.tripsCount += count;
      data.totalKm += km;
      data.grossRevenueCop += fare;
      if (isEnRoute) data.enRouteTrips += count;
    }
  });

  const platformBreakdown = Array.from(platformMap.values()).map(p => {
    const totalKm = Number(p.totalKm.toFixed(1));
    const ratePerKmCop = totalKm > 0 ? Math.round(p.grossRevenueCop / totalKm) : 0;
    const enRoutePct = p.tripsCount > 0 ? Math.round((p.enRouteTrips / p.tripsCount) * 100) : 0;
    const freePct = 100 - enRoutePct;
    const revenueSharePct = grossRevenueCop > 0 ? Math.round((p.grossRevenueCop / grossRevenueCop) * 100) : 0;

    return {
      platform: p.platform,
      tripsCount: p.tripsCount,
      totalKm,
      grossRevenueCop: p.grossRevenueCop,
      ratePerKmCop,
      enRouteTrips: p.enRouteTrips,
      enRoutePct,
      freePct,
      revenueSharePct
    };
  });

  // Ordenar de mayor a menor $/KM
  platformBreakdown.sort((a, b) => b.ratePerKmCop - a.ratePerKmCop);

  // -------------------------------------------------------------------------
  // 4. DETECTOR DE ANOMALÍAS (dataAnomalies) & MATRIZ DE FRANJAS HORARIAS
  // -------------------------------------------------------------------------
  const dataAnomalies = detectRideAnomalies(rideSessions);
  const timeSlotMatrix = buildTimeSlotMatrix(
    periodRides,
    vehicleProfile?.gpsCache?.tripsByDate || {},
    { startDate, endDate, costPerKmCop }
  );

  // Odómetro actual del vehículo para el reporte de impresión (incluyendo GPS en vivo)
  let odoFromLogs = 0;
  if (telemetryLogs.length > 0) {
    const sortedLogs = [...telemetryLogs].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    odoFromLogs = Number(sortedLogs[sortedLogs.length - 1].odometer_reading) || 0;
  }
  const profileOdo = Number(vehicleProfile.currentOdometer) || 0;
  const gpsOdo = Number(vehicleProfile?.gpsCache?.live?.totalMile) || 0;
  const currentOdo = Math.max(odoFromLogs, profileOdo, gpsOdo, 0);

  return {
    periodKey,
    periodRange: {
      startDate,
      endDate,
      label: periodLabel,
      displayRange
    },
    vehicleProfile: {
      name: vehicleProfile.name || 'Vehículo',
      currentOdometer: currentOdo,
      tankCapacityGallons: tankCapacityGal,
      fuelPriceCop
    },
    cashFlow,
    fuelBreakdown,
    pocketBalance,
    platformBreakdown,
    dataAnomalies,
    hourlyProfitCop,
    gpsWorkHours,
    gpsIdleFuelCop,
    timeSlotMatrix
  };
}
