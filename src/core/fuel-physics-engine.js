/**
 * OCTANE // KINETIC — Pure Fuel Physics & Ridge Auto-Calibration Engine
 *
 * 100% pure mathematical core (zero DOM, zero IndexedDB, zero network).
 * Implements:
 * - Additive 4-bucket fuel decomposition ("Impuesto Invisible": Base, Trancón, Ralentí, Frío/Dinámica)
 * - Closed-cycle pump reconciliation (proportional calibration of trip estimates to pump gallons)
 * - 4x4 Ridge Regression auto-calibration (L2 regularized OLS with Gaussian partial pivoting)
 * - Trailing consecutive anomaly detector (fuel consumption drift > +12% over 2+ cycles)
 */

export const DEFAULT_FUEL_PHYSICS_PRIORS = Object.freeze({
  galPerKmBase: 1 / 38.5,
  galPerIdleHour: 0.18,
  galPerTrafficKm: 0.0085,
  galPerColdStart: 0.028
});

export const FUEL_COEFF_BOUNDS = Object.freeze({
  galPerKmBase: [0.015, 0.06],
  galPerIdleHour: [0.08, 0.45],
  galPerTrafficKm: [0.0, 0.03],
  galPerColdStart: [0.0, 0.12]
});

function clampVal(val, min, max) {
  if (!Number.isFinite(val)) return min;
  return Math.min(max, Math.max(min, val));
}

function computeTrafficWeight(avgSpeedKmh = 0, trafficPctInput = 0) {
  let trafficWeight = 0;
  if (avgSpeedKmh > 0 && avgSpeedKmh < 30) {
    trafficWeight = Math.min(1, (30 - avgSpeedKmh) / 18);
  }
  if (trafficPctInput > 0) {
    const pctWeight = Math.min(1, trafficPctInput / 100);
    trafficWeight = trafficWeight > 0 ? (0.6 * trafficWeight + 0.4 * pctWeight) : pctWeight;
  }
  return trafficWeight;
}

/**
 * Predicts fuel consumption (in gallons) for a single GPS trip using the
 * 4-feature physics model (base distance, idle hours, traffic-weighted km,
 * cold-start enrichment + hard-acceleration dynamics).
 *
 * @param {Object} trip
 * @param {Object|null} [coeffs=null]
 * @param {Object} [options={}]
 * @returns {number}
 */
export function predictTripGallonsWithPhysics(trip, coeffs = null, options = {}) {
  if (!trip || typeof trip !== 'object') return 0;
  const resolvedCoeffs = {
    ...DEFAULT_FUEL_PHYSICS_PRIORS,
    ...(coeffs && typeof coeffs === 'object' ? coeffs : {})
  };

  const km = Number(trip.distanceKm ?? trip.mileageKm) || 0;
  if (km <= 0) return 0;

  const idleSec = Number(trip.stoppedTimeSec ?? trip.idleSec) || 0;
  const avgSpeed = Number(trip.avgSpeedKmh) || 0;
  const trafficPct = Number(trip.trafficPct) || 0;
  const trafficWeight = computeTrafficWeight(avgSpeed, trafficPct);

  const ret = Number(trip.thermalRetentionPct);
  const coldEq = Number.isFinite(ret)
    ? Math.max(0, 1 - Math.min(100, Math.max(0, ret)) / 100)
    : 0.55;
  const hardAccels = Number(trip.hardAccels ?? trip.hardAccelCount) || 0;

  let gal = (
    km * resolvedCoeffs.galPerKmBase +
    (idleSec / 3600) * resolvedCoeffs.galPerIdleHour +
    km * trafficWeight * resolvedCoeffs.galPerTrafficKm +
    coldEq * resolvedCoeffs.galPerColdStart +
    hardAccels * 0.004
  );

  if (km >= 0.2) {
    gal = clampVal(gal, km / 110, km / 8);
  } else {
    gal = Math.max(0, gal);
  }

  return Number(gal.toFixed(3));
}

/**
 * Decomposes fuel consumption into 4 strictly additive buckets whose sum equals
 * 100% of `totalGallons` and `totalCostCop`:
 *   1. base (BASE): Ideal rolling consumption
 *   2. traffic (TRANCÓN): Low-speed / congestion drag
 *   3. idle (RALENTÍ): Stationary ACC ON idling burn
 *   4. dynamicsCold (FRÍO / DIN.): Cold starts + hard accelerations
 *
 * @param {Object|null} physMetrics - Telemetry metrics from computeCyclePhysicalTelemetry or monthly summary
 * @param {Object} [options={}] - { totalGallons, totalCostCop, fuelPriceCop, totalKm, coldStarts, hardAccels, trafficPct, priors }
 * @returns {Object}
 */
export function decomposeFuelCost(physMetrics, options = {}) {
  const empty = {
    hasData: false,
    totalGallons: 0,
    totalCostCop: 0,
    baseGal: 0,
    trafficGal: 0,
    idleGal: 0,
    dynamicsColdGal: 0,
    baseCop: 0,
    trafficCop: 0,
    idleCop: 0,
    dynamicsColdCop: 0,
    pctBase: 0,
    pctTraffic: 0,
    pctIdle: 0,
    pctDynamicsCold: 0
  };

  if (!physMetrics || typeof physMetrics !== 'object') {
    return empty;
  }

  const km = Number(physMetrics.gpsKm ?? physMetrics.km ?? options.totalKm) || 0;
  const idleSec = Number(physMetrics.idleAccOnSec ?? physMetrics.idleSec) || 0;
  const avgSpeedKmh = Number(physMetrics.avgSpeedKmh) || 0;
  const runNo = Number(physMetrics.runNo) || 0;
  const coldStarts = Number(options.coldStarts ?? physMetrics.coldStarts ?? Math.round(runNo * 0.55)) || 0;
  const hardAccels = Number(options.hardAccels ?? physMetrics.hardAccels) || 0;
  const trafficPctInput = Number(options.trafficPct ?? physMetrics.trafficPct) || 0;

  const fuelPriceCop = Number(options.fuelPriceCop) > 0 ? Number(options.fuelPriceCop) : 16000;
  let totalGallons = Number(options.totalGallons ?? physMetrics.totalGallons) || 0;

  const priors = {
    ...DEFAULT_FUEL_PHYSICS_PRIORS,
    ...(options.priors && typeof options.priors === 'object' ? options.priors : {})
  };

  const rawBase = km > 0 ? km * priors.galPerKmBase : 0;
  const rawIdle = idleSec > 0 ? (idleSec / 3600) * priors.galPerIdleHour : 0;

  const trafficWeight = computeTrafficWeight(avgSpeedKmh, trafficPctInput);
  const rawTraffic = km > 0 ? km * trafficWeight * priors.galPerTrafficKm : 0;
  const rawDynamicsCold = (Math.max(0, coldStarts) * priors.galPerColdStart) + (Math.max(0, hardAccels) * 0.004);
  const rawSum = rawBase + rawTraffic + rawIdle + rawDynamicsCold;

  if (totalGallons <= 0 && km > 0 && rawSum > 0) {
    totalGallons = Number(rawSum.toFixed(3));
  }

  if ((km <= 0 && totalGallons <= 0) || totalGallons <= 0) {
    return empty;
  }

  totalGallons = Number(totalGallons.toFixed(3));
  const totalCostCop = (options.totalCostCop !== undefined && options.totalCostCop !== null && Number(options.totalCostCop) > 0)
    ? Math.round(Number(options.totalCostCop))
    : Math.round(totalGallons * fuelPriceCop);

  if (rawSum <= 0) {
    return {
      hasData: true,
      totalGallons,
      totalCostCop,
      baseGal: totalGallons,
      trafficGal: 0,
      idleGal: 0,
      dynamicsColdGal: 0,
      baseCop: totalCostCop,
      trafficCop: 0,
      idleCop: 0,
      dynamicsColdCop: 0,
      pctBase: 100,
      pctTraffic: 0,
      pctIdle: 0,
      pctDynamicsCold: 0
    };
  }

  const scale = totalGallons / rawSum;
  let trafficGal = Number((rawTraffic * scale).toFixed(3));
  let idleGal = Number((rawIdle * scale).toFixed(3));
  let dynamicsColdGal = Number((rawDynamicsCold * scale).toFixed(3));

  const nonBaseSum = trafficGal + idleGal + dynamicsColdGal;
  if (nonBaseSum > totalGallons) {
    const clampScale = totalGallons / nonBaseSum;
    trafficGal = Number((trafficGal * clampScale).toFixed(3));
    idleGal = Number((idleGal * clampScale).toFixed(3));
    dynamicsColdGal = Number(Math.max(0, totalGallons - trafficGal - idleGal).toFixed(3));
  }
  const baseGal = Number(Math.max(0, totalGallons - trafficGal - idleGal - dynamicsColdGal).toFixed(3));

  let trafficCop = Math.round((trafficGal / totalGallons) * totalCostCop);
  let idleCop = Math.round((idleGal / totalGallons) * totalCostCop);
  let dynamicsColdCop = Math.round((dynamicsColdGal / totalGallons) * totalCostCop);
  const nonBaseCop = trafficCop + idleCop + dynamicsColdCop;
  if (nonBaseCop > totalCostCop) {
    const copScale = totalCostCop / nonBaseCop;
    trafficCop = Math.round(trafficCop * copScale);
    idleCop = Math.round(idleCop * copScale);
    dynamicsColdCop = Math.max(0, totalCostCop - trafficCop - idleCop);
  }
  const baseCop = Math.max(0, totalCostCop - trafficCop - idleCop - dynamicsColdCop);

  let pctTraffic = totalCostCop > 0 ? Math.round((trafficCop / totalCostCop) * 100) : 0;
  let pctIdle = totalCostCop > 0 ? Math.round((idleCop / totalCostCop) * 100) : 0;
  let pctDynamicsCold = totalCostCop > 0 ? Math.round((dynamicsColdCop / totalCostCop) * 100) : 0;
  const nonBasePct = pctTraffic + pctIdle + pctDynamicsCold;
  if (nonBasePct > 100) {
    const pScale = 100 / nonBasePct;
    pctTraffic = Math.round(pctTraffic * pScale);
    pctIdle = Math.round(pctIdle * pScale);
    pctDynamicsCold = Math.max(0, 100 - pctTraffic - pctIdle);
  }
  const pctBase = Math.max(0, 100 - pctTraffic - pctIdle - pctDynamicsCold);

  return {
    hasData: true,
    totalGallons,
    totalCostCop,
    baseGal,
    trafficGal,
    idleGal,
    dynamicsColdGal,
    baseCop,
    trafficCop,
    idleCop,
    dynamicsColdCop,
    pctBase,
    pctTraffic,
    pctIdle,
    pctDynamicsCold
  };
}

/**
 * Reconciles GPS trip fuel estimates against real pump gallons recorded on a closed tank cycle.
 * Returns a new array of cloned trip objects with `reconciledGallons`, `reconciledCostCop`,
 * `reconciliationFactor` (clamped to [0.65, 1.45]), and `isCalibrated: true`.
 *
 * @param {Array<Object>} [trips=[]]
 * @param {number} [realPumpGallons=0]
 * @param {number} [fuelPriceCop=16000]
 * @returns {Array<Object>}
 */
export function reconcileClosedCycleTrips(trips = [], realPumpGallons = 0, fuelPriceCop = 16000) {
  if (!Array.isArray(trips) || trips.length === 0) return [];
  const targetGal = Number(realPumpGallons) || 0;
  const safePrice = Number(fuelPriceCop) > 0 ? Number(fuelPriceCop) : 16000;

  if (targetGal <= 0) {
    return trips.map(t => (t && typeof t === 'object' ? { ...t } : t));
  }

  const totalEst = trips.reduce((acc, t) => acc + (Number(t?.estGallons) || 0), 0);
  if (totalEst <= 0) {
    return trips.map(t => (t && typeof t === 'object' ? { ...t } : t));
  }

  const rawK = targetGal / totalEst;
  const k = clampVal(rawK, 0.65, 1.45);
  const factor = Number(k.toFixed(3));
  const isUnclamped = rawK >= 0.65 && rawK <= 1.45;

  let lastPositiveIdx = -1;
  for (let i = trips.length - 1; i >= 0; i--) {
    if ((Number(trips[i]?.estGallons) || 0) > 0) {
      lastPositiveIdx = i;
      break;
    }
  }

  let runningSum = 0;
  return trips.map((t, idx) => {
    if (!t || typeof t !== 'object') return t;
    const estG = Number(t.estGallons) || 0;
    let recG = Number((estG * k).toFixed(3));
    if (isUnclamped && idx === lastPositiveIdx && estG > 0) {
      recG = Number(Math.max(0, targetGal - runningSum).toFixed(3));
    }
    runningSum += recG;

    return {
      ...t,
      reconciledGallons: recG,
      reconciledCostCop: Math.round(recG * safePrice),
      reconciliationFactor: factor,
      isCalibrated: true
    };
  });
}

/**
 * Solves 4x4 Ridge Regression: (X^T X + lambda * I) * beta = X^T y + lambda * priorVec
 * via Gaussian elimination with partial pivoting. Guards singular matrices by falling back to priorVec.
 *
 * @param {Array<Array<number>>} X - Nx4 feature matrix
 * @param {Array<number>} y - N-length target vector
 * @param {Array<number>} priorVec - 4-element prior coefficients
 * @param {number} [lambda=0.25]
 * @returns {Array<number>} 4-element coefficient vector
 */
export function solveRidge4x4(X, y, priorVec, lambda = 0.25) {
  const safePrior = Array.isArray(priorVec) && priorVec.length === 4
    ? priorVec.map(Number)
    : [
      DEFAULT_FUEL_PHYSICS_PRIORS.galPerKmBase,
      DEFAULT_FUEL_PHYSICS_PRIORS.galPerIdleHour,
      DEFAULT_FUEL_PHYSICS_PRIORS.galPerTrafficKm,
      DEFAULT_FUEL_PHYSICS_PRIORS.galPerColdStart
    ];

  if (!Array.isArray(X) || !Array.isArray(y) || X.length === 0 || X.length !== y.length) {
    return [...safePrior];
  }

  const lam = Number.isFinite(Number(lambda)) && Number(lambda) >= 0 ? Number(lambda) : 0.25;
  const A = Array.from({ length: 4 }, (_, r) =>
    Array.from({ length: 4 }, (__, c) => (r === c ? lam : 0))
  );
  const b = safePrior.map(p => lam * p);

  for (let row = 0; row < X.length; row++) {
    const xr = X[row];
    const yr = Number(y[row]);
    if (!Array.isArray(xr) || xr.length !== 4 || !Number.isFinite(yr)) continue;
    for (let i = 0; i < 4; i++) {
      const xi = Number(xr[i]) || 0;
      b[i] += xi * yr;
      for (let j = 0; j < 4; j++) {
        A[i][j] += xi * (Number(xr[j]) || 0);
      }
    }
  }

  // Augmented matrix [A | b]
  const M = A.map((row, idx) => [...row, b[idx]]);

  for (let col = 0; col < 4; col++) {
    let pivotRow = col;
    let maxAbs = Math.abs(M[col][col]);
    for (let r = col + 1; r < 4; r++) {
      const v = Math.abs(M[r][col]);
      if (v > maxAbs) {
        maxAbs = v;
        pivotRow = r;
      }
    }

    if (maxAbs < 1e-12) {
      return [...safePrior];
    }

    if (pivotRow !== col) {
      const tmp = M[col];
      M[col] = M[pivotRow];
      M[pivotRow] = tmp;
    }

    const pivot = M[col][col];
    for (let c = col; c < 5; c++) {
      M[col][c] /= pivot;
    }

    for (let r = 0; r < 4; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      if (factor === 0) continue;
      for (let c = col; c < 5; c++) {
        M[r][c] -= factor * M[col][c];
      }
    }
  }

  const sol = M.map(row => row[4]);
  if (sol.some(v => !Number.isFinite(v))) {
    return [...safePrior];
  }
  return sol;
}

function isFiniteTimestamp(val) {
  return val !== null && val !== undefined && val !== '' && Number.isFinite(Number(val));
}

function resolveCycleColdStarts(cycle, phys, tripsByDate) {
  if (tripsByDate && typeof tripsByDate === 'object' && cycle.startDate && cycle.endDate) {
    const startDate = String(cycle.startDate).slice(0, 10);
    const endDate = String(cycle.endDate).slice(0, 10);
    const hasCStart = isFiniteTimestamp(cycle.startTimeMs);
    const hasCEnd = isFiniteTimestamp(cycle.endTimeMs);
    const cStartMs = hasCStart ? Number(cycle.startTimeMs) : NaN;
    const cEndMs = hasCEnd ? Number(cycle.endTimeMs) : NaN;
    const scanFromStart = hasCStart || hasCEnd;

    let sumColdEq = 0;
    let foundTrips = 0;
    for (const dateKey of Object.keys(tripsByDate)) {
      const inDateSpan = scanFromStart
        ? (dateKey >= startDate && dateKey <= endDate)
        : (startDate === endDate ? dateKey === endDate : (dateKey > startDate && dateKey <= endDate));
      if (!inDateSpan) continue;

      const dayTrips = tripsByDate[dateKey];
      if (!Array.isArray(dayTrips)) continue;
      for (const t of dayTrips) {
        if (!t) continue;
        const tStartMs = Number(t.startTimeMs);
        const hasTripMs = isFiniteTimestamp(t.startTimeMs) && tStartMs > 0;
        let matches = false;
        if (hasCStart && hasCEnd && hasTripMs) {
          matches = tStartMs > cStartMs && tStartMs <= cEndMs;
        } else if (hasCEnd && dateKey === endDate && hasTripMs) {
          matches = tStartMs <= cEndMs;
        } else if (hasCStart && dateKey === startDate && hasTripMs) {
          matches = tStartMs > cStartMs;
        } else {
          matches = startDate === endDate ? dateKey === endDate : (dateKey > startDate && dateKey <= endDate);
        }
        if (!matches) continue;

        foundTrips++;
        const ret = Number(t.thermalRetentionPct);
        if (Number.isFinite(ret)) {
          sumColdEq += Math.max(0, 1 - Math.min(100, Math.max(0, ret)) / 100);
        } else {
          sumColdEq += 0.55;
        }
      }
    }
    if (foundTrips > 0) {
      return sumColdEq;
    }
  }
  return (Number(phys.runNo) || 0) * 0.55;
}

/**
 * Calibrates vehicle-specific 4-feature fuel physics coefficients via Ridge Regression
 * across valid closed cycles with >= 75% GPS coverage, and detects trailing 2+ cycle
 * positive consumption drift (> +12%).
 *
 * @param {Array<Object>} [closedCycles=[]]
 * @param {Object} [options={}] - { tripsByDate, priors, lambda }
 * @returns {Object}
 */
export function calibrateVehicleFuelModel(closedCycles = [], options = {}) {
  const priors = {
    ...DEFAULT_FUEL_PHYSICS_PRIORS,
    ...(options.priors && typeof options.priors === 'object' ? options.priors : {})
  };
  const lambda = options.lambda !== undefined ? Number(options.lambda) : 0.25;
  const tripsByDate = options.tripsByDate || null;

  const eligible = [];
  if (Array.isArray(closedCycles)) {
    for (const c of closedCycles) {
      if (!c || c.isValid === false) continue;
      const km = Number(c.dist ?? c.distance) || 0;
      const gals = Number(c.gals ?? c.gallons) || 0;
      const phys = c.physicalTelemetry;
      if (km <= 0 || gals <= 0 || !phys || typeof phys !== 'object') continue;

      let gpsCoverage = 1;
      if (phys.gpsCoverage !== undefined && phys.gpsCoverage !== null) {
        gpsCoverage = Number(phys.gpsCoverage) || 0;
      } else if (Number(phys.gpsKm) > 0) {
        gpsCoverage = Math.min(1, Number(phys.gpsKm) / km);
      } else if (Number(c.days) > 0 && phys.activeDays !== undefined) {
        gpsCoverage = Math.min(1, (Number(phys.activeDays) || 0) / Number(c.days));
      } else {
        gpsCoverage = 0;
      }

      if (gpsCoverage < 0.75) continue;

      const idleHours = (Number(phys.idleAccOnSec) || 0) / 3600;
      const avgSpeed = Number(phys.avgSpeedKmh) || 0;
      const trafficWeight = (avgSpeed > 0 && avgSpeed < 30) ? Math.min(1, (30 - avgSpeed) / 18) : 0;
      const trafficWeightedKm = km * trafficWeight;
      const coldStartsEq = resolveCycleColdStarts(c, phys, tripsByDate);

      eligible.push({
        cycle: c,
        km,
        gals,
        features: [km, idleHours, trafficWeightedKm, coldStartsEq]
      });
    }
  }

  if (eligible.length < 5) {
    return {
      mode: 'prior',
      confidence: Number((eligible.length / 5).toFixed(2)),
      coeffs: { ...priors },
      eligibleCount: eligible.length,
      cycleResiduals: [],
      anomalyAlert: null
    };
  }

  const X = eligible.map(e => e.features);
  const y = eligible.map(e => e.gals);
  const priorVec = [
    priors.galPerKmBase,
    priors.galPerIdleHour,
    priors.galPerTrafficKm,
    priors.galPerColdStart
  ];

  const rawBeta = solveRidge4x4(X, y, priorVec, lambda);
  const coeffs = {
    galPerKmBase: Number(clampVal(rawBeta[0], ...FUEL_COEFF_BOUNDS.galPerKmBase).toFixed(5)),
    galPerIdleHour: Number(clampVal(rawBeta[1], ...FUEL_COEFF_BOUNDS.galPerIdleHour).toFixed(4)),
    galPerTrafficKm: Number(clampVal(rawBeta[2], ...FUEL_COEFF_BOUNDS.galPerTrafficKm).toFixed(5)),
    galPerColdStart: Number(clampVal(rawBeta[3], ...FUEL_COEFF_BOUNDS.galPerColdStart).toFixed(5))
  };

  const cycleResiduals = eligible.map(e => {
    const f = e.features;
    const predictedGallons = (
      f[0] * coeffs.galPerKmBase +
      f[1] * coeffs.galPerIdleHour +
      f[2] * coeffs.galPerTrafficKm +
      f[3] * coeffs.galPerColdStart
    );
    const residualPct = predictedGallons > 0
      ? Number((((e.gals - predictedGallons) / predictedGallons) * 100).toFixed(1))
      : 0;
    return {
      cycleIndex: e.cycle.cycleIndex,
      startDate: e.cycle.startDate,
      endDate: e.cycle.endDate,
      actualGallons: Number(e.gals.toFixed(3)),
      predictedGallons: Number(predictedGallons.toFixed(3)),
      residualPct
    };
  });

  // Trigger anomalyAlert ONLY when latest 2+ consecutive valid cycles both exceed +12%
  let consecutiveCount = 0;
  let trailingSum = 0;
  for (let i = cycleResiduals.length - 1; i >= 0; i--) {
    if (cycleResiduals[i].residualPct > 12) {
      consecutiveCount++;
      trailingSum += cycleResiduals[i].residualPct;
    } else {
      break;
    }
  }

  const anomalyAlert = consecutiveCount >= 2
    ? {
        type: 'fuel_consumption_drift',
        severity: 'warning',
        consecutiveCount,
        avgExcessPct: Math.round(trailingSum / consecutiveCount),
        label: 'CONSUMO ANÓMALO'
      }
    : null;

  return {
    mode: 'ridge',
    confidence: Number(Math.min(1, eligible.length / 10).toFixed(2)),
    coeffs,
    eligibleCount: eligible.length,
    cycleResiduals,
    anomalyAlert
  };
}
