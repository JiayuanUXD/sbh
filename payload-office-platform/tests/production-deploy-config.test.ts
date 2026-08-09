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
    expect(dockerfile).toContain("find .next -type f -name '*.map' -delete")
  })

  it('Docker runner 只复制瘦身后的生产依赖，避免把完整 devDependencies 打进镜像', () => {
    const dockerfile = readFileSync(resolve(appRoot, 'Dockerfile'), 'utf8')
    const runner = dockerfile.slice(dockerfile.indexOf('FROM node:22-slim AS runner'))

    expect(dockerfile).toContain('FROM node:22-slim AS prod-deps')
    expect(dockerfile).toContain('RUN pnpm install --prod --frozen-lockfile')
    expect(dockerfile).toContain("find node_modules -type f \\( -name '*.map'")
    expect(runner).toContain('COPY --from=prod-deps /app/node_modules ./node_modules')
    expect(runner).not.toContain('COPY --from=deps /app/node_modules ./node_modules')
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

    expect(workflow).toContain('docker/login-action@v3')
    expect(workflow).toContain('ccr.ccs.tencentyun.com/tcb-100000818451-xfjy/ca-gevmmbac_sbh')
    expect(workflow).toContain('timeout-minutes: 20')
    expect(workflow).toContain('tcb api tcbr UpdateCloudRunServer')
    expect(workflow).toContain('DeployType:"image"')
    expect(workflow).toContain('ImageUrl:$imageUrl')
    expect(workflow).toContain('ReleaseType:"FULL"')
    expect(workflow).toContain("jq -e '.data.TaskId | numbers'")
    expect(workflow).not.toContain('cloudrun deploy')
    expect(workflow).not.toContain('--imageUrl "$IMAGE_URL"')
    expect(workflow).not.toContain('Image deploy path is already active after CloudRun deploy')
    expect(workflow).not.toContain('traffic_ready=0')
    expect(workflow).not.toContain('CloudRun traffic not ready yet')
    expect(workflow).not.toContain(`printf '\\n\\n\\n' | tcb`)
  })

  it('镜像推送与构建分离，跨境 push 有超时重试', () => {
    // 病根（run 31292071284 / 31290760006）：GitHub 美国 runner -> 上海 TCR 的链路会
    // 静默停滞，buildkit 推 blob 没有停滞检测，连接死掉既不报错也不重试，一路挂到
    // job timeout。31292071284 里 build 3分55秒就完事，push 之后 15 分钟零输出被杀。
    const workflow = readFileSync(resolve(repositoryRoot, '.github/workflows/deploy.yml'), 'utf8')

    // build 与 push 必须分离：融在一个 action 里时一次卡死 = 整步白费、下次从零再来。
    // 拆开后 push 可独立重试，registry 已收下的 blob 会被跳过，重试是增量推进的。
    // 断言钉步骤名与实际命令行，不钉注释里也会出现的裸字串。
    expect(workflow).toContain('- name: Build Docker image（只构建，不推送）')
    expect(workflow).toContain('- name: Push image to Tencent Container Registry（跨境，带超时重试）')
    expect(workflow).toContain('--file payload-office-platform/Dockerfile')
    expect(workflow).not.toContain('docker/build-push-action')

    // 单次 push 必须有超时，否则停滞连接会骑满整个步骤预算，退化回原来的卡死。
    expect(workflow).toContain('timeout 420 docker push')

    // 重试必须是有限轮次且失败可见，不能静默放过。
    expect(workflow).toContain('for attempt in 1 2 3 4 5')
    expect(workflow).toContain('::error::push $ref 5 次全部失败')

    // cache-to gha mode=max 在 31292071284 里花了 390 秒导出 deps/builder 全部中间层，
    // 吃掉五分之一预算，而 build 从零也只要 4 分钟——净负担，别加回来。
    expect(workflow).not.toContain('cache-to: type=gha')
    expect(workflow).not.toContain('cache-from: type=gha')

    // setup-buildx 会把默认 builder 换成 docker-container 驱动，产物不落本地镜像库，
    // 拆开 push 后还得多一次 --load 导出。裸 docker build 走 daemon 内置 buildkit。
    expect(workflow).not.toContain('docker/setup-buildx-action')
  })

  it('运行时代码依赖的包不在 devDependencies（prod-deps 镜像装不到）', () => {
    // sbh-053 部署失败：Cannot find package 'pinyin-pro' imported from
    // /app/src/domain/shared/slug.ts。slug.ts 是运行时代码，容器启动跑 migrate-locked.ts
    // 时必然加载到，但 pinyin-pro 当时在 devDependencies；runner 阶段只装 --prod，
    // 于是容器起不来、探针失败、流量留在旧版本。
    const pkg = JSON.parse(readFileSync(resolve(appRoot, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
    }

    expect(pkg.dependencies).toHaveProperty('pinyin-pro')
    expect(pkg.devDependencies).not.toHaveProperty('pinyin-pro')
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
    expect(workflow).toContain('Smoke test after image deploy')
    expect(workflow).toContain('healthy=0')
    expect(workflow).toContain('Image deploy smoke passed')
    expect(workflow).not.toContain(`if [ "$canary_ok" -lt 1 ]`)
  })
})
