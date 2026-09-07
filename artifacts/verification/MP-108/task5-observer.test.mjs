import test from 'node:test'
import assert from 'node:assert/strict'
import { safePath } from './task5-observer.mjs'
test('access evidence discards query and non-mini paths', () => {
  assert.equal(safePath('/api/mini/v1/home?phone=13812345678&openid=secret'), '/api/mini/v1/home')
  assert.equal(safePath('/api/leads/123?secret=x'), null)
  assert.equal(safePath('/api/health'), '/api/health')
})
