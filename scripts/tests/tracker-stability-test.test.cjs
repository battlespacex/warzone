const test = require('node:test');
const assert = require('node:assert/strict');
const { validate, summarize } = require('../tracker-stability-test.cjs');
const config = { baseUrl: 'http://localhost:4174', flow: 'scripts/gnss-staging-flow.cjs', outputDirectory: '.generated/private-tracker-profile' };
test('full tracker profiling rejects production and unbounded cohorts and never invents a memory threshold', () => {
    assert.throws(() => validate({ ...config, baseUrl: 'https://stratops.battlespacex.com' }), /permitted/);
    assert.throws(() => validate({ ...config, cycles: 100 }), /cycles/);
    assert.equal(validate(config).cycles, 10);
    const result = summarize([{ phase: 'startup-off', cdpMetrics: { JSHeapUsedSize: 100 } }, { phase: '10-off', cdpMetrics: { JSHeapUsedSize: 120 } }]);
    assert.equal(result.offHeapGrowthBytes, 20); assert.equal(result.gpuMemoryBytes, null);
    assert.match(result.memoryAcceptance, /plateau review/);
});
