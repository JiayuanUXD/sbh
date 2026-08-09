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

  it('Docker runner 复制完整 node_modules，容器内才跑得动迁移', () => {
    // 镜像由平台在线构建、不出境，体积不再是瓶颈，因此不做 --prod 瘦身。
    // prod-deps 瘦身曾把 devDeps 挡在镜像外，导致 sbh-053 启动即 ERR_MODULE_NOT_FOUND；
    // 其中 `find node_modules -name '*.ts' -delete` 对任何运行时读 .ts 的包都是隐患。
    const dockerfile = readFileSync(resolve(appRoot, 'Dockerfile'), 'utf8')
    const runner = dockerfile.slice(dockerfile.indexOf('FROM node:22-slim AS runner'))

    expect(runner).toContain('COPY --from=deps /app/node_modules ./node_modules')
    expect(dockerfile).not.toContain('AS prod-deps')
    expect(dockerfile).not.toContain('pnpm install --prod')
    expect(dockerfile).not.toContain("find node_modules -type f \\( -name '*.map'")
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

  it('运行时代码依赖的包不在 devDependencies', () => {
    // sbh-053 部署失败：Cannot find package 'pinyin-pro' imported from
    // /app/src/domain/shared/slug.ts。slug.ts 是运行时代码，容器启动跑 migrate-locked.ts
    // 时必然加载到，却被放在 devDependencies 里。当时 runner 只装 --prod，于是容器
    // 起不来、探针失败、流量留在旧版本。
    // 现在 runner 复制完整 node_modules，这个错位不再致命，但依赖归类本身仍是错的：
    // 运行时 import 的包就该在 dependencies，别再挪回去。
    const pkg = JSON.parse(readFileSync(resolve(appRoot, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
    }

    expect(pkg.dependencies).toHaveProperty('pinyin-pro')
    expect(pkg.devDependencies).not.toHaveProperty('pinyin-pro')
  })

  it('发布走代码包上传 + 平台在线构建，不在 CI 里推镜像', () => {
    // 回退依据：CI 推镜像到 ccr.ccs.tencentyun.com 连续失败，最后一次成功上线的
    // sbh-050 就是这条代码包路径产出的。镜像不出境，CI 也不需要 TCR 凭据。
    const workflow = readFileSync(resolve(repositoryRoot, '.github/workflows/deploy.yml'), 'utf8')

    expect(workflow).toContain('DescribeCloudBaseBuildService')
    expect(workflow).toContain('UpdateCloudRunServer')
    expect(workflow).toContain(`ReleaseType: "GRAY"`)
    expect(workflow).toContain('上传代码包并提交灰度版本')
    expect(workflow).toContain('等待新版本就绪 + 切 10% 灰度')
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

    // 这条路径必须是真正在跑的，不能又被 if: false 关掉。
    expect(workflow).not.toContain('if: ${{ false }}')

    // 镜像路径的残留一律不许留下——它们正是这次回退要去掉的东西。
    expect(workflow).not.toContain('docker/build-push-action')
    expect(workflow).not.toContain('docker/setup-buildx-action')
    expect(workflow).not.toContain('docker/login-action')
    expect(workflow).not.toContain('docker push')
    expect(workflow).not.toContain('DeployType:"image"')
  })

  it('灰度冒烟通过后 promote 全量，失败则 rollback', () => {
    // 切镜像方式（FULL 发布）时 Promote 步骤被删过。代码包路径是 GRAY 发布，
    // 少了 promote 流量会永远停在 90/10，新版本上不了线。
    const workflow = readFileSync(resolve(repositoryRoot, '.github/workflows/deploy.yml'), 'utf8')

    expect(workflow).toContain('cloudrun traffic promote -s sbh')
    expect(workflow).toContain('cloudrun traffic rollback -s sbh')
    expect(workflow).toContain('Promote 全量发布')
  })

  it('冒烟靠 version 认出灰度版本，而不是只看 status', () => {
    // run 31275171164 报 success 但线上版本没换：冒烟打生产域名，流量还在旧版本上，
    // 旧版本健康所以必然通过。canary_ok 必须比对 version，否则这个假成功会重演。
    const workflow = readFileSync(resolve(repositoryRoot, '.github/workflows/deploy.yml'), 'utf8')

    // commit 注入代码包：平台在线构建拿不到 --build-arg，只能走包内文件。
    expect(workflow).toContain(`printf '{"commit":"%s"}\\n' "$GITHUB_SHA"`)
    expect(workflow).toContain('zip -q "$archive" build-info.json')

    // 灰度期：必须至少命中一次 version == 本次 commit，否则失败并回滚。
    expect(workflow).toContain('expected="$GITHUB_SHA"')
    expect(workflow).toContain(`if [ "$version" = "$expected" ]; then`)
    expect(workflow).toContain('::error::50 次请求均未命中 version=$expected 的灰度版本')

    // promote 之后：全量流量都必须是本次版本，这是"确实上线了"的最终确认。
    expect(workflow).toContain('::error::promote 后线上仍是 version=$version，期望 $expected')
  })

  it('等待部署记录就绪后再切流，并允许稳定旧版本健康接口返回 404', () => {
    const workflow = readFileSync(resolve(repositoryRoot, '.github/workflows/deploy.yml'), 'utf8')

    expect(workflow).toContain(`case "$deploy_status" in`)
    expect(workflow).toContain('normal)')
    expect(workflow).toContain('build_failed|deploy_failed)')
    expect(workflow).toContain('Smoke test（灰度版本健康检查）')
    expect(workflow).toContain('canary_ok=0')
    // 灰度期间请求可能命中尚无该路由的稳定旧版本，404 不算失败。
    expect(workflow).toContain(`if [ "$code" = "404" ]; then`)
  })
})
