import test from 'node:test'
import assert from 'node:assert/strict'
import { parseSummary } from './task5-verify.mjs'
test('E2E summary missing or conflicting does not become PASS',()=>{
 assert.throws(()=>parseSummary(''))
 assert.deepEqual(parseSummary('  2 failed\n  3 skipped\n  4 did not run\n  10 passed (1m)'),{passed:10,skipped:3,failed:2,flaky:0,didNotRun:4})
 assert.throws(()=>parseSummary('  10 passed\n  11 passed'))
})
