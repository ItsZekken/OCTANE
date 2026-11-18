/**
 * OCTANE // KINETIC — Precision Universal Number & Metric Parsing Utilities
 * 
 * Solves decimal vs thousands separator ambiguity in Hispanic/Latin locales:
 * - Differentiates 7,025 / 7.025 gallons from 7025 gallons (impossible for standard vehicle tanks)
 * - Safely handles pump decimal-less entries (e.g. 7025 -> 7.025 gal)
 * - Parses odometer readings formatted with dots ("97.395" -> 97395 km)
 * - Real-time thousands formatting with Swiss precision dot notation
 */

/**
 * Universal fuel volume parser with pump-heuristic validation.
 * @param {string|number} rawInput - User input or raw database value
 * @param {number} [maxTankGal=25] - Nominal maximum tank capacity in gallons
 * @returns {number} Parsed volume in gallons (float), or 0 if invalid
 */
export function parseFuelVolume(rawInput, maxTankGal = 25) {
    if (rawInput === null || rawInput === undefined || rawInput === '') return 0;
    if (typeof rawInput === 'number') {
        if (isNaN(rawInput) || rawInput <= 0) return 0;
        // Check if raw number is bloated (e.g. 7025 instead of 7.025)
        const upperThreshold = (maxTankGal || 25) * 1.35;
        if (rawInput > upperThreshold) {
            if (rawInput / 1000 > 0.2 && rawInput / 1000 <= (maxTankGal || 25) * 1.25) {
                return Number((rawInput / 1000).toFixed(3));
            }
            if (rawInput / 100 > 0.2 && rawInput / 100 <= (maxTankGal || 25) * 1.25) {
                return Number((rawInput / 100).toFixed(2));
            }
        }
        return Number(rawInput.toFixed(3));
    }

    let str = String(rawInput).trim();
    if (!str) return 0;

    // Remove any currency or unit symbols
    str = str.replace(/[^\d.,]/g, '');

    // Case 1: Contains both dot and comma (e.g., "1.234,56" or "1,234.56")
    if (str.includes('.') && str.includes(',')) {
        const lastDot = str.lastIndexOf('.');
        const lastComma = str.lastIndexOf(',');
        if (lastComma > lastDot) {
            // "1.234,56" -> comma is decimal
            str = str.replace(/\./g, '').replace(',', '.');
        } else {
            // "1,234.56" -> dot is decimal
            str = str.replace(/,/g, '');
        }
    } else if (str.includes(',')) {
        // Only comma: in Spanish fuel forms, "7,025" or "7,5" is decimal
        // If there are multiple commas (e.g. "1,000,000"), strip all but last
        const parts = str.split(',');
        if (parts.length === 2) {
            str = parts[0] + '.' + parts[1];
        } else {
            str = str.replace(/,/g, '');
        }
    }

    let val = parseFloat(str);
    if (isNaN(val) || val <= 0) return 0;

    // Heuristic correction for 3-decimal pump integers entered without separator
    // Example: user typed 7025 in a field or pump integer sent 7025 gal into a 9.25 gal tank
    const upperThreshold = (maxTankGal || 25) * 1.35;
    if (val > upperThreshold) {
        if (val / 1000 > 0.2 && val / 1000 <= (maxTankGal || 25) * 1.25) {
            val = val / 1000;
        } else if (val / 100 > 0.2 && val / 100 <= (maxTankGal || 25) * 1.25) {
            val = val / 100;
        }
    }

    return Number(val.toFixed(3));
}

/**
 * Parses integer metrics such as odometer readings or COP currency amounts.
 * Correctly strips thousands separators (dots, commas, spaces).
 * Example: "97.395" -> 97395, "150.000" -> 150000, "$ 16.000" -> 16000
 * @param {string|number} rawInput
 * @returns {number} Integer value, or 0 if invalid
 */
export function parseIntegerMetric(rawInput) {
    if (rawInput === null || rawInput === undefined || rawInput === '') return 0;
    if (typeof rawInput === 'number') {
        if (isNaN(rawInput) || rawInput <= 0) return 0;
        // If a floating odometer was saved as 97.395 km (due to earlier parseFloat of "97.395"),
        // check if it's a truncated 5-6 digit odometer
        if (rawInput > 10 && rawInput < 500 && Math.floor(rawInput) !== rawInput) {
            const reconstructed = Math.round(rawInput * 1000);
            if (reconstructed >= 10000 && reconstructed <= 999999) {
                return reconstructed;
            }
        }
        return Math.round(rawInput);
    }

    let str = String(rawInput).trim();
    if (!str) return 0;

    // Remove all non-digits
    const digitsOnly = str.replace(/[^\d]/g, '');
    if (!digitsOnly) return 0;

    const val = parseInt(digitsOnly, 10);
    return isNaN(val) ? 0 : val;
}

/**
 * Formats an integer with precision dot thousands separators for live inputs and displays.
 * Example: 97395 -> "97.395", 150000 -> "150.000"
 * @param {string|number} val
 * @returns {string} Formatted string
 */
export function formatThousandsLive(val) {
    if (val === null || val === undefined || val === '') return '';
    const digits = String(val).replace(/[^\d]/g, '');
    if (!digits) return '';
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * Parses a decimal distance in KM, supporting both comma and dot decimal separators.
 * Example: "12,5" -> 12.5, "12.5" -> 12.5
 * @param {string|number} rawInput
 * @returns {number}
 */
export function parseDistanceKm(rawInput) {
    if (rawInput === null || rawInput === undefined || rawInput === '') return 0;
    if (typeof rawInput === 'number') return isNaN(rawInput) ? 0 : Number(rawInput.toFixed(2));
    let str = String(rawInput).trim().replace(',', '.').replace(/[^\d.]/g, '');
    const val = parseFloat(str);
    return isNaN(val) ? 0 : Number(val.toFixed(2));
}

/**
 * Sanitizes total fuel expense in COP, auto-healing inflated or missing pump values.
 * In Colombian fuel markets, gasoline price per gallon ranges between ~12.000 and 20.000 COP.
 * Values with implied price per gallon > 60.000 COP indicate point/comma distortion
 * (e.g. 114071950 COP instead of 114.072 COP).
 * 
 * @param {string|number} rawCost - Raw cost amount from user or DB
 * @param {number} gallonsAdded - Sanitized volume in gallons
 * @param {number} [fallbackPricePerGal=16000] - Benchmark fuel price in COP
 * @returns {number} Sanitized integer COP amount
 */
export function sanitizeFuelCostCop(rawCost, gallonsAdded, fallbackPricePerGal = 16000) {
    const gals = Number(gallonsAdded) || 0;
    const fallback = Number(fallbackPricePerGal) || 16000;

    let cost = 0;
    if (typeof rawCost === 'number') {
        cost = isNaN(rawCost) ? 0 : rawCost;
    } else if (rawCost !== null && rawCost !== undefined && rawCost !== '') {
        cost = parseIntegerMetric(rawCost);
    }

    if (gals > 0 && cost > 0) {
        const impliedPrice = cost / gals;
        if (impliedPrice > 60000) {
            const p1000 = (cost / 1000) / gals;
            if (p1000 >= 5000 && p1000 <= 55000) {
                return Math.round(cost / 1000);
            }
            const p100 = (cost / 100) / gals;
            if (p100 >= 5000 && p100 <= 55000) {
                return Math.round(cost / 100);
            }
            return Math.round(gals * fallback);
        }
        return Math.round(cost);
    }

    if ((!cost || cost <= 0) && gals > 0) {
        return Math.round(gals * fallback);
    }

    return Math.max(0, Math.round(cost || 0));
}

/**
 * Safely moves text caret to the end of an input without triggering native selection popups.
 * @param {HTMLInputElement} inputEl
 */
export function setCursorAtEnd(inputEl) {
    if (!inputEl) return;
    const len = inputEl.value ? inputEl.value.length : 0;
    try {
        inputEl.setSelectionRange(len, len);
    } catch (_) {}
}

