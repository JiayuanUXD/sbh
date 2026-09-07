import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  PRODUCTION_CLOUDRUN_ORIGIN,
  PRODUCTION_ENV_ID,
  prepareStagingPackage,
  rewriteDockerfileForStaging,
  validateStagingEnvId,
  validateStagingOrigin,
} from '../scripts/prepare-cloudrun-staging.mjs'

const STAGING_ORIGIN = 'https://sbhmini.ap-shanghai.run.tcloudbase.com'
const STAGING_RUNTIME_ENV_ID = 'sbhmini-gateway-d3fbrmn8097478b8'
const STAGING_DATABASE_ENV_ID = 'sbhmini-d5g7d6732b2c64a66'
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

describe('staging CloudRun package', () => {
  it('accepts an isolated HTTPS origin', () => {
    expect(validateStagingOrigin(STAGING_ORIGIN)).toBe(STAGING_ORIGIN)
  })

  it.each([
    PRODUCTION_CLOUDRUN_ORIGIN,
    `${PRODUCTION_CLOUDRUN_ORIGIN}.`,
    `${PRODUCTION_CLOUDRUN_ORIGIN}..`,
    PRODUCTION_CLOUDRUN_ORIGIN.toUpperCase(),
    `${PRODUCTION_CLOUDRUN_ORIGIN}:443`,
    PRODUCTION_CLOUDRUN_ORIGIN.replace('sbh-', '%73bh-'),
    'http://staging.example.com',
    'https://localhost:3717',
    'https://localhost.',
    'https://LOCALHOST',
    'https://preview.localhost',
    'https://127.0.0.1',
    'https://[::1]',
    'https://user:pass@staging.example.com',
    'https://staging.example.com/api',
    'https://staging.example.com?env=staging',
    'https://staging.example.com/#preview',
  ])('rejects unsafe staging origin %s', (origin) => {
    expect(() => validateStagingOrigin(origin)).toThrow()
  })

  it('rewrites both build-time and runtime production origins without changing production source', () => {
    const source = [
      'ENV NEXT_PUBLIC_SITE_URL=' + PRODUCTION_CLOUDRUN_ORIGIN,
      'RUN pnpm build',
      'ENV NEXT_PUBLIC_SITE_URL=' + PRODUCTION_CLOUDRUN_ORIGIN,
    ].join('\n')

    const rewritten = rewriteDockerfileForStaging(source, STAGING_ORIGIN)

    expect(rewritten).not.toContain(PRODUCTION_CLOUDRUN_ORIGIN)
    expect(rewritten.match(new RegExp(STAGING_ORIGIN.replaceAll('.', '\\.'), 'g'))).toHaveLength(2)
    expect(source).toContain(PRODUCTION_CLOUDRUN_ORIGIN)
  })

  it('fails closed when the production Dockerfile shape drifts', () => {
    const onlyOneOrigin = `ENV NEXT_PUBLIC_SITE_URL=${PRODUCTION_CLOUDRUN_ORIGIN}`

    expect(() => rewriteDockerfileForStaging(onlyOneOrigin, STAGING_ORIGIN)).toThrow(
      /恰好出现 2 次/,
    )
  })

  it('accepts only a non-production CloudBase environment ID', () => {
    expect(validateStagingEnvId(STAGING_RUNTIME_ENV_ID)).toBe(STAGING_RUNTIME_ENV_ID)
    expect(() => validateStagingEnvId(STAGING_DATABASE_ENV_ID)).toThrow(/PostgreSQL 数据库环境/)
    expect(() => validateStagingEnvId(PRODUCTION_ENV_ID)).toThrow(/生产环境/)
    expect(() => validateStagingEnvId('not an env id')).toThrow(/环境 ID/)
  })

  it('creates a tracked, commit-attested staging package in a caller-owned directory', () => {
    const outputDirectory = join(tmpdir(), `sbh-staging-package-test-${crypto.randomUUID()}`)

    try {
      const result = prepareStagingPackage({
        repositoryRoot,
        outputDirectory,
        stagingEnvId: STAGING_RUNTIME_ENV_ID,
        stagingOrigin: STAGING_ORIGIN,
      })
      const dockerfile = readFileSync(join(outputDirectory, 'Dockerfile'), 'utf8')
      const buildInfo = JSON.parse(
        readFileSync(join(outputDirectory, 'build-info.json'), 'utf8'),
      ) as { commit: string }

      expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/)
      expect(result.outputDirectory).toBe(outputDirectory)
      expect(result.stagingEnvId).toBe(STAGING_RUNTIME_ENV_ID)
      expect(result.stagingOrigin).toBe(STAGING_ORIGIN)
      expect(buildInfo).toEqual({ commit: result.commitSha })
      expect(dockerfile).toContain(`ENV NEXT_PUBLIC_SITE_URL=${STAGING_ORIGIN}`)
      expect(dockerfile).not.toContain(PRODUCTION_CLOUDRUN_ORIGIN)
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true })
    }
  })
})
