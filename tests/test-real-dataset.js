import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { clearAllData, getTelemetryLogs } from '../src/core/db-local.js';
import { importFromJSONString } from '../src/core/json-io.js';

async function testRealDataset() {
    console.log('Testing import of real 92-reading dataset...');
    await clearAllData();

    const jsonText = fs.readFileSync('./tests/spicy_sample.json', 'utf-8');
    const result = await importFromJSONString(jsonText);

    console.log('Import result:', result);
    assert.equal(result.type, 'legacy_array');
    assert.equal(result.count, 92);

    const logs = await getTelemetryLogs();
    assert.equal(logs.length, 92);

    // Verify first and last logs
    assert.equal(logs[0].date, '2026-06-02');
    assert.equal(logs[0].odometer_reading, 93404);
    assert.equal(logs[0].fuel_level_percent, 75.46973824501038);

    const last = logs[logs.length - 1];
    assert.equal(last.date, '2026-09-28');
    assert.equal(last.odometer_reading, 96871);

    // Verify refuels
    const refuels = logs.filter(l => l.gallons_added > 0);
    console.log(`Verified ${refuels.length} refueling records among 92 logs.`);
    assert.equal(refuels.length, 15);

    // Partial refuel check (e.g. 2026-06-06 had 6.0 gal and 25.5% fuel level)
    const partial = logs.find(l => l.date === '2026-06-06');
    assert.equal(partial.is_full_tank, false, '2026-06-06 must be recognized as partial refuel');

    // Full tank refuels check (e.g. 2026-07-28 with 6.212 gal or 2026-07-11 with 100% fuel level)
    const full1 = logs.find(l => l.date === '2026-07-28');
    assert.equal(full1.is_full_tank, true, '2026-07-28 decimal refuel must be full tank');
    const full2 = logs.find(l => l.date === '2026-07-11');
    assert.equal(full2.is_full_tank, true, '2026-07-11 100% refuel must be full tank');

    console.log('✓ Real dataset import verification succeeded!');
}

testRealDataset().catch(err => {
    console.error('Real dataset test failed:', err);
    process.exit(1);
});
