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
  TRIAL_CLOUD_ENV_ID: 'sbhmini-gateway-d3fbrmn8097478b8',
  TRIAL_CLOUD_SERVICE_NAME: 'sbhmini',
  TRIAL_DEPLOYMENT_COMMIT_SHA: sha,
  TRIAL_SERVER_DEPLOYMENT_REVISION: 'sbhmini-016',
}

describe('trial deployment manifest tooling', () => {
  it('只在 clean matching commit 上写入 JSON-safe manifest，不写入秘密', () => {
    const directory = mkdtempSync(join(tmpdir(), 'sbh-trial-manifest-'))
    const outputPath = join(directory, 'trial-deployment.generated.ts')
    try {
      prepareTrialDeployment({ environment, currentHeadSha: sha, worktreeStatus: '', outputPath, allowedOutputPath: outputPath })
      const source = readFileSync(outputPath, 'utf8')
      expect(source).toContain('sbhmini-gateway-d3fbrmn8097478b8')
      expect(source).toContain('sbhmini')
      expect(source).toContain(sha)
      expect(source).toContain('sbhmini-016')
      expect(source).not.toMatch(/https?:|secret|token|database|postgres/i)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it.each([
    ['missing env', { ...environment, TRIAL_CLOUD_ENV_ID: '' }, sha, 'clean', /trial cloud env 与受控 staging 不一致/],
    ['missing service', { ...environment, TRIAL_CLOUD_SERVICE_NAME: '' }, sha, 'clean', /trial cloud service 与受控 staging 不一致/],
    ['production env', { ...environment, TRIAL_CLOUD_ENV_ID: 'sbh-d9gnr8h5ef7e22e30' }, sha, 'clean', /trial cloud env 与受控 staging 不一致/],
    ['postgres database env', { ...environment, TRIAL_CLOUD_ENV_ID: 'sbhmini-d5g7d6732b2c64a66' }, sha, 'clean', /trial cloud env 与受控 staging 不一致/],
    ['illegal env character', { ...environment, TRIAL_CLOUD_ENV_ID: 'sbhmini/staging' }, sha, 'clean', /trial cloud env 与受控 staging 不一致/],
    ['illegal service character', { ...environment, TRIAL_CLOUD_SERVICE_NAME: 'sbhmini.service' }, sha, 'clean', /trial cloud service 与受控 staging 不一致/],
    ['uppercase env disguise', { ...environment, TRIAL_CLOUD_ENV_ID: 'SBHMINI-D5G7D6732B2C64A66' }, sha, 'clean', /trial cloud env 与受控 staging 不一致/],
    ['uppercase service disguise', { ...environment, TRIAL_CLOUD_SERVICE_NAME: 'SBHMINI' }, sha, 'clean', /trial cloud service 与受控 staging 不一致/],
    ['wrong sha', environment, 'b'.repeat(40), 'clean', /目标 Git commit SHA 与当前 HEAD 不一致/],
    ['dirty tree', environment, sha, ' M file.ts', /工作树必须干净/],
  ])('%s 时拒绝生成', (_label, env, currentHeadSha, worktreeStatus, error) => {
    const directory = mkdtempSync(join(tmpdir(), 'sbh-trial-reject-'))
    const outputPath = join(directory, 'manifest.ts')
    try {
      expect(() => prepareTrialDeployment({ environment: env, currentHeadSha, worktreeStatus, outputPath, allowedOutputPath: outputPath })).toThrow(error)
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
