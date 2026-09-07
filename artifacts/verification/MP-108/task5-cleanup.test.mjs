import test from 'node:test'
import assert from 'node:assert/strict'
import { assertMarkers } from './task5-cleanup.mjs'
test('cleanup rejects seed-like or non-unique markers',()=>{
  assert.throws(()=>assertMarkers(['seed-row'],[],[]))
  assert.throws(()=>assertMarkers([],['customer-listing'],[]))
  assert.throws(()=>assertMarkers([],[],['real.xlsx']))
  assert.doesNotThrow(()=>assertMarkers(['e2e-idempotent-123-a'],['E2E-OPT041-mtquvbpe-1'],['bulk-import-listings-mtquvbpe.xlsx']))
})
