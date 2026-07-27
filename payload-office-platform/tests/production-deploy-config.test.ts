import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const here = fileURLToPath(new URL('.', import.meta.url))
const appRoot = resolve(here, '..')
const repositoryRoot = resolve(appRoot, '..')

describe('生产部署配置', () => {
  it('Docker builder 始终提供可复制的 public 目录', () => {
    const dockerfile = readFileSync(resolve(appRoot, 'Dockerfile'), 'utf8')
    const ensurePublic = dockerfile.indexOf('RUN mkdir -p public')
    const build = dockerfile.indexOf('pnpm generate:types')
    const copyPublic = dockerfile.indexOf('COPY --from=builder /app/public ./public')

    expect(ensurePublic).toBeGreaterThanOrEqual(0)
    expect(ensurePublic).toBeLessThan(build)
    expect(ensurePublic).toBeLessThan(copyPublic)
  })

  it('CloudBase 通过可重试上传和官方 API 显式创建灰度版本', () => {
    const workflow = readFileSync(resolve(repositoryRoot, '.github/workflows/deploy.yml'), 'utf8')

    expect(workflow).toContain('DescribeCloudBaseBuildService')
    expect(workflow).toContain('UpdateCloudRunServer')
    expect(workflow).toContain(`ReleaseType: "GRAY"`)
    expect(workflow).toContain('MAX_UPLOAD_ATTEMPTS')
    expect(workflow).not.toContain('cloudrun deploy')
    expect(workflow).not.toContain(`printf '\\n\\n\\n' | tcb`)
  })

  it('等待部署记录就绪后再切流，并允许稳定旧版本健康接口返回 404', () => {
    const workflow = readFileSync(resolve(repositoryRoot, '.github/workflows/deploy.yml'), 'utf8')

    expect(workflow).toContain(`case "$deploy_status" in`)
    expect(workflow).toContain('normal)')
    expect(workflow).toContain('build_failed|deploy_failed)')
    expect(workflow).not.toContain('sleep 30')
    expect(workflow).toContain(`if [ "$code" = "404" ]`)
    expect(workflow).toContain(`if [ "$canary_ok" -lt 1 ]`)
  })
})
