import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const script = resolve(import.meta.dirname, '../../artifacts/verification/MP-110/20261105-run1/verify-ui-metrics.cjs')
describe('MP-110 微信几何采样入口', () => {
  it('源码目录缺失时不能报告通过', () => {
    const result = spawnSync(process.execPath, [script], {
      env: { ...process.env, TARGET_ROOT: resolve(script, 'missing-source'), MP110_VIEWPORT: '375' },
      encoding: 'utf8',
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('源码')
  })

  it('未指定微信采样视口时返回未完成', () => {
    const result = spawnSync(process.execPath, [script], {
      env: { ...process.env, TARGET_ROOT: resolve(import.meta.dirname, '..'), MP110_VIEWPORT: '' },
      encoding: 'utf8',
    })
    expect(result.status).toBe(2)
    expect(JSON.parse(result.stdout)).toMatchObject({ verdict: 'INCOMPLETE' })
  })
})
