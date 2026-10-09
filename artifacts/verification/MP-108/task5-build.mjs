#!/usr/bin/env node
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { DIR, WEB, SHA, identity, databaseEnvironment, run, redact } from './task5-local.mjs'

identity()
const temporary = path.join(WEB, 'build-info.json')
assert(!existsSync(temporary), '已有build-info，拒绝覆盖')
const data = { candidateSha: SHA, recordedAt: new Date().toISOString(), status: 'FAILED', commands: [], priorBuildCommit: JSON.parse(readFileSync(path.join(WEB, '.next/required-server-files.json'))).config.env.BUILD_COMMIT }
try {
  writeFileSync(temporary, JSON.stringify({ commit: SHA }), { flag: 'wx' })
  const env = databaseEnvironment('sbh_dev_mp108_prod', { CI: '1', NEXT_PUBLIC_SITE_URL: 'https://mp108.local.test', MULTI_CITY_ROUTING_ENABLED: 'false', NEXT_PUBLIC_AMAP_JS_KEY: 'e2e-fake-amap-js-key-not-real', NEXT_PUBLIC_ANALYTICS_ENABLED: 'true', NEXT_PUBLIC_UMAMI_SRC: 'https://umami-e2e.invalid', NEXT_PUBLIC_UMAMI_WEBSITE_ID: 'e2e-fake-website-id' })
  run('pnpm', ['build'], env, data.commands)
  data.buildCommit = JSON.parse(readFileSync(path.join(WEB, '.next/required-server-files.json'))).config.env.BUILD_COMMIT
  assert.equal(data.buildCommit, SHA)
  data.buildId = readFileSync(path.join(WEB, '.next/BUILD_ID'), 'utf8').trim()
  data.status = 'PASS'
} catch (error) { data.failure = redact(String(error.message)); process.exitCode = 1 }
finally {
  if (existsSync(temporary)) {
    assert.equal(JSON.parse(readFileSync(temporary)).commit, SHA, '临时文件身份改变，不删除')
    unlinkSync(temporary)
  }
  data.temporaryBuildInfoRemoved = !existsSync(temporary)
  writeFileSync(path.join(DIR, 'local-build.json'), `${JSON.stringify(data, null, 2)}\n`)
}
console.log(`BUILD ${data.status}; temporary build-info removed=${data.temporaryBuildInfoRemoved}`)
