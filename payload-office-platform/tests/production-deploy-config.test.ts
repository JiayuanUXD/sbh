import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const here = fileURLToPath(new URL('.', import.meta.url))
const appRoot = resolve(here, '..')
const repositoryRoot = resolve(appRoot, '..')

describe('生产部署配置', () => {
  it('Git Archive 排除验证产物与测试目录', () => {
    const attributes = readFileSync(resolve(appRoot, '.gitattributes'), 'utf8')

    expect(attributes).toMatch(/^artifacts\/ export-ignore$/m)
    expect(attributes).toMatch(/^tests\/ export-ignore$/m)
  })

  it('本地发布脚本在 pipefail 下完整读取归档清单', () => {
    const script = readFileSync(resolve(repositoryRoot, 'scripts/cloudrun-release.sh'), 'utf8')

    expect(script).toContain('unzip -Z1 "$archive"')
    expect(script).toContain('grep -Fx "Dockerfile" >/dev/null')
    expect(script).not.toContain('grep -q " Dockerfile$"')
  })

  it('Docker builder 始终提供可复制的 public 目录', () => {
    const dockerfile = readFileSync(resolve(appRoot, 'Dockerfile'), 'utf8')
    const ensurePublic = dockerfile.indexOf('RUN mkdir -p public')
    const build = dockerfile.indexOf('pnpm generate:types')
    const copyPublic = dockerfile.indexOf('COPY --from=builder /app/public ./public')

    expect(ensurePublic).toBeGreaterThanOrEqual(0)
    expect(ensurePublic).toBeLessThan(build)
    expect(ensurePublic).toBeLessThan(copyPublic)
  })

  it('容器启动先跑迁移再由 exec 接管 Web 服务', () => {
    const dockerfile = readFileSync(resolve(appRoot, 'Dockerfile'), 'utf8')

    // `&&`：迁移失败（退出码 1）时绝不启动服务
    // `exec`：next server 取代 shell 成为 PID 1，SIGTERM 才能直达
    expect(dockerfile).toContain(
      'CMD ["sh", "-c", "pnpm exec tsx scripts/migrate-locked.ts && exec pnpm start"]',
    )
  })

  it('迁移脚本在两条收尾路径上都显式退出进程', () => {
    const script = readFileSync(resolve(appRoot, 'scripts/migrate-locked.ts'), 'utf8')

    // Payload adapter 永久占用 client -> pool.end() 永不返回 -> 不显式退出就卡死在 `&&` 前
    expect(script).toContain('exitProcess(0)')
    expect(script).toContain('exitProcess(1)')
  })

  it('CloudBase 通过可重试上传和官方 API 显式创建灰度版本', () => {
    const workflow = readFileSync(resolve(repositoryRoot, '.github/workflows/deploy.yml'), 'utf8')

    expect(workflow).toContain('DescribeCloudBaseBuildService')
    expect(workflow).toContain('UpdateCloudRunServer')
    expect(workflow).toContain(`ReleaseType: "GRAY"`)
    expect(workflow).toContain('git archive --format=zip HEAD:payload-office-platform')
    expect(workflow).toContain('3145728')
    expect(workflow).toContain('--http1.1')
    expect(workflow).toContain('--retry 4')
    expect(workflow).toContain('--max-time 600')
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
