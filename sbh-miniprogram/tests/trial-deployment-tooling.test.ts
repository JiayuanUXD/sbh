import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const prepareTrialDeployment = (await import('../scripts/prepare-trial-deployment.mjs' as never)).prepareTrialDeployment as (options: {
  environment: Record<string, string>
  currentHeadSha: string
  worktreeStatus: string
  outputPath: string
  allowedOutputPath: string
}) => string

const sha = 'a'.repeat(40)
const environment = {
  TRIAL_API_BASE_URL: 'https://staging.example.com',
  TRIAL_DEPLOYMENT_COMMIT_SHA: sha,
  TRIAL_SERVER_DEPLOYMENT_REVISION: 'rev-2026-08-27',
}

describe('trial deployment manifest tooling', () => {
  it('只在 clean matching commit 上写入 JSON-safe manifest，不写入秘密', () => {
    const directory = mkdtempSync(join(tmpdir(), 'sbh-trial-manifest-'))
    const outputPath = join(directory, 'trial-deployment.generated.ts')
    try {
      prepareTrialDeployment({ environment, currentHeadSha: sha, worktreeStatus: '', outputPath, allowedOutputPath: outputPath })
      const source = readFileSync(outputPath, 'utf8')
      expect(source).toContain('https://staging.example.com')
      expect(source).toContain(sha)
      expect(source).toContain('rev-2026-08-27')
      expect(source).not.toMatch(/secret|token|database|postgres/i)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it.each([
    ['missing origin', { ...environment, TRIAL_API_BASE_URL: '' }, sha, 'clean'],
    ['production origin', { ...environment, TRIAL_API_BASE_URL: 'HTTPS://SBH-286300-10-1253925058.SH.RUN.TCLOUDBASE.COM:443/' }, sha, 'clean'],
    ['production origin with noncanonical port', { ...environment, TRIAL_API_BASE_URL: 'https://sbh-286300-10-1253925058.sh.run.tcloudbase.com:0443' }, sha, 'clean'],
    ['numeric localhost alias', { ...environment, TRIAL_API_BASE_URL: 'https://2130706433' }, sha, 'clean'],
    ['short localhost alias', { ...environment, TRIAL_API_BASE_URL: 'https://127.1' }, sha, 'clean'],
    ['IPv6 localhost', { ...environment, TRIAL_API_BASE_URL: 'https://[::1]' }, sha, 'clean'],
    ['localhost trailing dot', { ...environment, TRIAL_API_BASE_URL: 'https://localhost.' }, sha, 'clean'],
    ['localhost subdomain', { ...environment, TRIAL_API_BASE_URL: 'https://fixture.localhost' }, sha, 'clean'],
    ['DNS absolute-name trailing dot', { ...environment, TRIAL_API_BASE_URL: 'https://staging.example.com.' }, sha, 'clean'],
    ['percent-encoded dot', { ...environment, TRIAL_API_BASE_URL: 'https://staging%2eexample.com' }, sha, 'clean'],
    ['wrong sha', environment, 'b'.repeat(40), 'clean'],
    ['dirty tree', environment, sha, ' M file.ts'],
  ])('%s 时拒绝生成', (_label, env, currentHeadSha, worktreeStatus) => {
    const directory = mkdtempSync(join(tmpdir(), 'sbh-trial-reject-'))
    const outputPath = join(directory, 'manifest.ts')
    try {
      expect(() => prepareTrialDeployment({ environment: env, currentHeadSha, worktreeStatus, outputPath, allowedOutputPath: outputPath })).toThrow()
    } finally {
      expect(() => readFileSync(outputPath, 'utf8')).toThrow()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('拒绝不等于允许目标的绝对输出路径且不创建文件', () => {
    const directory = mkdtempSync(join(tmpdir(), 'sbh-trial-output-reject-'))
    const outputPath = join(directory, 'arbitrary.ts')
    const allowedOutputPath = join(directory, 'miniprogram', 'config', 'trial-deployment.generated.ts')
    try {
      expect(() => prepareTrialDeployment({ environment, currentHeadSha: sha, worktreeStatus: '', outputPath, allowedOutputPath })).toThrow(/允许的 trial manifest/)
      expect(() => readFileSync(outputPath, 'utf8')).toThrow()
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it('拒绝符号链接输出路径，避免跟随链接覆盖其它文件', () => {
    const directory = mkdtempSync(join(tmpdir(), 'sbh-trial-symlink-'))
    const targetPath = join(directory, 'target.ts')
    const outputPath = join(directory, 'trial-deployment.generated.ts')
    try {
      const original = 'do not overwrite'
      writeFileSync(targetPath, original)
      symlinkSync(targetPath, outputPath)
      expect(() => prepareTrialDeployment({ environment, currentHeadSha: sha, worktreeStatus: '', outputPath, allowedOutputPath: outputPath })).toThrow(/符号链接/)
      expect(readFileSync(targetPath, 'utf8')).toBe(original)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
})
