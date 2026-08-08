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

  it('本地发布脚本等待流量实际收敛后再继续', () => {
    const script = readFileSync(resolve(repositoryRoot, 'scripts/cloudrun-release.sh'), 'utf8')

    expect(script).toContain('wait_traffic "$expected"')
    expect(script).toContain('wait_traffic "100"')
    expect(script).toContain('流量在 60 秒内未收敛')
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

  it('Docker builder 不把 Next 构建缓存打进运行镜像', () => {
    const dockerfile = readFileSync(resolve(appRoot, 'Dockerfile'), 'utf8')
    const build = dockerfile.indexOf('pnpm generate:types')
    const pruneCache = dockerfile.indexOf('RUN rm -rf .next/cache')
    const copyNext = dockerfile.indexOf('COPY --from=builder /app/.next ./.next')

    expect(pruneCache).toBeGreaterThan(build)
    expect(pruneCache).toBeLessThan(copyNext)
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

  it('CloudBase 镜像部署通过 GitHub Actions 构建推送镜像并灰度切流', () => {
    const workflow = readFileSync(resolve(repositoryRoot, '.github/workflows/deploy.yml'), 'utf8')

    expect(workflow).toContain('docker/setup-buildx-action@v3')
    expect(workflow).toContain('docker/login-action@v3')
    expect(workflow).toContain('ccr.ccs.tencentyun.com/tcb-100000818451-xfjy/ca-gevmmbac_sbh')
    expect(workflow).toContain('docker/build-push-action@v6')
    expect(workflow).toContain('push: true')
    expect(workflow).toContain('provenance: false')
    expect(workflow).toContain('sbom: false')
    expect(workflow).not.toContain('cache-to: type=gha')
    expect(workflow).toContain('cloudrun deploy')
    expect(workflow).toContain('--imageUrl "$IMAGE_URL"')
    expect(workflow).toContain('--traffic')
    expect(workflow).toContain('--stable 90')
    expect(workflow).toContain('--canary 10')
    expect(workflow).not.toContain(`printf '\\n\\n\\n' | tcb`)
  })

  it('旧源码包上传部署路径保留但不再默认执行', () => {
    const workflow = readFileSync(resolve(repositoryRoot, '.github/workflows/deploy.yml'), 'utf8')

    expect(workflow).toContain('DescribeCloudBaseBuildService')
    expect(workflow).toContain('UpdateCloudRunServer')
    expect(workflow).toContain(`ReleaseType: "GRAY"`)
    expect(workflow).toContain('上传代码包并提交灰度版本')
    expect(workflow).toContain('等待新版本就绪 + 切 10% 灰度')
    expect(workflow).toContain('if: ${{ false }}')
    expect(workflow).toContain('git archive --format=zip HEAD:payload-office-platform')
    expect(workflow).toContain('3145728')
    expect(workflow).toContain('--http1.1')
    // 重试机制：每次尝试重新拉取预签名 URL 再上传。curl --retry 会复用同一个
    // 可能已过期的 URL，跨境慢传常在收尾被 COS 以 400 拒（run 31098998980）。
    expect(workflow).toContain('for attempt in 1 2 3 4')
    expect(workflow).toContain('fetch_upload_info')
    expect(workflow).toContain('--max-time 300')
    // 停滞检测：死连接 30s 内放弃换新 URL，而不是骑满整个签名窗口
    expect(workflow).toContain('--speed-time 30')
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
