import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const here = fileURLToPath(new URL('.', import.meta.url))
const appRoot = resolve(here, '..')
const repositoryRoot = resolve(appRoot, '..')

describe('production build database boundary', () => {
  it('keeps the Payload-backed frontend shell out of database-less prerendering', () => {
    const frontendLayout = readFileSync(
      resolve(appRoot, 'src/app/(frontend)/layout.tsx'),
      'utf8',
    )

    expect(frontendLayout).toContain("export const dynamic = 'force-dynamic'")
  })
})

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
    // 该步骤已拆成两个：等构建结果（始终执行）+ 切流量（受 SHOULD_PROMOTE 控制），
    // 原因见下方「构建失败必须让 job 变红」。
    expect(workflow).toContain('等待新版本构建就绪')
    expect(workflow).toContain('切 10% 灰度')
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

    // 灰度期记录命中情况但不阻断：run 31300263780 实测切流回显成功后仍 0/50 命中
    // （路由收敛延迟 + 同 IP 粘连），拿它当硬门槛会误杀正常发布。
    expect(workflow).toContain('expected="$GITHUB_SHA"')
    expect(workflow).toContain(`if [ "$version" = "$expected" ]; then`)
    expect(workflow).toContain('::notice::不阻断发布；是否真正上线由 promote 之后的版本校验判定')

    // promote 之后才是硬门槛——100% 流量时判定确定无疑，旧版本过不去这一关。
    expect(workflow).toContain(
      '::error::promote 后线上版本始终不是 $expected —— 全量发布未生效，触发回滚',
    )
    // 允许收敛但要求连续匹配，避免抖动期误判成功。
    expect(workflow).toContain('if [ "$matched" -ge 3 ]; then break; fi')
    expect(workflow).toContain('if [ "$matched" -lt 3 ]; then')
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

describe('部署流水线 / 构建失败必须让 job 变红', () => {
  /**
   * 病根（CloudRun sbh-096 / GitHub run 32119795967）：GitHub 报 success，CloudBase
   * 侧却是 build_failed。提交步骤只用 `jq -e '.data.TaskId'` 确认接口受理，而真正判
   * 构建结果的轮询挂着 `if: env.SHOULD_PROMOTE == 'true'`——push 触发的部署整步跳过，
   * 构建后来挂了没有任何信号。没人会去复查一次"成功"的部署。
   *
   * 守护不变量：等构建结果的步骤**不带** SHOULD_PROMOTE 门；切流量才带。
   */
  const workflow = () =>
    readFileSync(resolve(repositoryRoot, '.github/workflows/deploy.yml'), 'utf8')

  /** 取某个 step 从 `- name:` 到下一个 `- name:` 之间的正文 */
  function stepBlock(yaml: string, nameFragment: string): string {
    const lines = yaml.split('\n')
    const start = lines.findIndex((l) => l.includes('- name:') && l.includes(nameFragment))
    expect(start, `未找到步骤：${nameFragment}`).toBeGreaterThan(-1)
    const rest = lines.slice(start + 1)
    const end = rest.findIndex((l) => l.includes('- name:'))
    return (end === -1 ? rest : rest.slice(0, end)).join('\n')
  }

  it('等待构建就绪的步骤始终执行，不受 SHOULD_PROMOTE 控制', () => {
    const block = stepBlock(workflow(), '等待新版本构建就绪')
    // 判的是 `if:` 门而不是字面出现——步骤注释里就解释了「为什么没有这个门」，
    // 用 not.toContain 会把注释里的提及也当成门（第一版就是这么误报的）。
    expect(block).not.toMatch(/^\s*if:.*SHOULD_PROMOTE/m)
  })

  it('该步骤确实会在构建失败时退出非零', () => {
    const block = stepBlock(workflow(), '等待新版本构建就绪')
    expect(block).toContain('build_failed|deploy_failed')
    expect(block).toContain('exit 1')
  })

  /**
   * 2026-08-26：本条与下一条**整体反向重写**。
   *
   * 上一版守的是「只能手动触发」（`6e3861b`，2026-08-18）。那次改动的真实病根是
   * **自动触发一律 `promote=false`**——每次合并 master 都构建一个 0% 流量、永远
   * 没人用的 GRAY 版本，白烧约 8 分钟平台构建和一个版本号，真发布时同一个 commit
   * 还要再构建一遍（sbh-096 就是这么一个「为没人用而构建」的版本，且它在镜像推送
   * 阶段挂掉）。当时把「自动」整个砍掉，是把病根和症状一起砍了。
   *
   * 现在恢复自动触发，但**带 promote**：构建出来就上线，那笔浪费不复存在。
   * 所以这一条现在守的是三件事的**组合**，缺一条就退回旧病：
   *   1. 有 workflow_run 触发（自动）
   *   2. job 自己判 conclusion（闸门红了不能发）
   *   3. 自动路径 SHOULD_PROMOTE 为真（构建了就要用）
   *
   * 判 YAML 键与表达式引用，而不是字面出现——文件顶部注释要讲清这段来龙去脉，
   * 直接 toContain/not.toContain 会被自己的注释绊倒（原作者在这上面踩中过两次）。
   */
  it('合并 master 自动接力发布：workflow_run + 判 conclusion + 自动路径 promote', () => {
    const yaml = workflow()

    // 1. 自动触发存在，且盯的是 quality.yml 的 master 分支
    expect(yaml).toMatch(/^\s*workflow_run:/m)
    expect(yaml).toContain("workflows: ['Quality and migration baseline']")
    expect(yaml).toMatch(/workflow_run:[\s\S]{0,200}branches:\s*\[master\]/)

    // 2. types: [completed] 上游失败也会触发，job 必须自己判结论。
    //    少了这一条，闸门红着也会照样发布——这是本次改动最危险的失手方式。
    expect(yaml).toMatch(
      /if:[\s\S]{0,160}github\.event\.workflow_run\.conclusion == 'success'/,
    )

    // 3. 自动路径必须切流量。写成 `github.event_name == 'workflow_run' || inputs.promote`：
    //    若退化成 `&& inputs.promote` 之类，就又变成「构建了却没人用」。
    expect(yaml).toMatch(
      /SHOULD_PROMOTE:\s*\$\{\{\s*github\.event_name == 'workflow_run' \|\|/,
    )

    // 4. checkout 必须钉上游 run 的 head_sha，否则期间又推一次 master 就会发错代码
    expect(yaml).toContain('github.event.workflow_run.head_sha')

    // 5. 手动入口保留（重发历史 ref / 只出 GRAY 版本），但不再是唯一入口
    expect(yaml).toContain('workflow_dispatch')
  })

  it('上游 quality.yml 的 paths 覆盖 deploy.yml，否则改本文件时链路静默失联', () => {
    // workflow_run 只有在上游**真的跑了**的时候才会接力。quality.yml 的 push/PR
    // 都带 paths 过滤，漏掉 deploy.yml 就会出现「改了发布链路却没人跑闸门、
    // 也没触发部署」——静默，不报错。
    const quality = readFileSync(
      resolve(repositoryRoot, '.github/workflows/quality.yml'),
      'utf8',
    )
    expect(quality).toMatch(/^name: Quality and migration baseline$/m)
    // push 与 pull_request 两个块各要有一份
    const hits = quality.match(/'\.github\/workflows\/deploy\.yml'/g) ?? []
    expect(hits.length, 'quality.yml 的 push 与 pull_request 都应覆盖 deploy.yml')
      .toBeGreaterThanOrEqual(2)
  })

  /**
   * 文档不得再声称「只能手动触发 / 合并 master 什么都不发生」。
   *
   * ## 为什么这条值得单独守（方向变了，理由没变）
   *
   * `6e3861b`（2026-08-18）移除自动触发时**只改了 workflow，没改文档**，于是四处
   * 文档整整七天都在说「push 到 master 即自动上线」。上一版守卫是绿的，因为它只
   * 断言 YAML，不管文档怎么写。代价在 2026-08-25 兑现：合并两个 PR 时据此告知
   * 「会触发自动部署到生产」，实际什么都没发生，差点把未上线的修复当成已上线。
   *
   * 2026-08-26 把触发改回自动并带 promote，这条守卫**整体反向重写**：现在漂移的
   * 方向反过来了——文档若还写着「只能手动」「合并什么都不发生」，会让人以为合并
   * 是安全的、可以先合着放几天，而实际上一合就进生产。这个方向的错更危险：
   * 上一次的后果是「以为发了其实没发」，这一次是「以为没发其实发了」。
   *
   * **陈述性文档也是接口。** 它被人和 agent 当作事实源读取，写错了不会有任何
   * 运行期信号——这正是它需要测试的理由。
   *
   * ## 判据：直接匹配「手动才会发布」这类断言措辞
   *
   * 不逐字匹配某句话（那样换个说法就绕过去了），而是判**断言本身**。
   * 带否定/历史标记（不再 / 已改为 / 曾经 / 注：当时…）的行是刻意保留的沿革说明，
   * 放行——把「曾经如此、现已改变」写清楚，本身就是防漂移的一部分。
   *
   * 保留原作者踩过的两个坑作为设计约束：
   *   1. 不能只判词共现（「合并即进入发布候选」这类正确表述会被误判）
   *   2. 不能要求出现触发动词（原始错句「默认分支 master 触发 CI 自动部署」没有动词）
   */
  it('文档与 workflow 不得再声称「只能手动触发 / 合并不会部署」', () => {
    // 前提：workflow 确实是 workflow_run 自动接力。哪天又改回手动，本守卫应当整体重来。
    expect(
      workflow(),
      'deploy.yml 去掉了 workflow_run —— 本守卫方向需要同步反转',
    ).toMatch(/^\s*workflow_run:/m)

    const DOCS = [
      'CLAUDE.md',
      'AGENTS.md',
      'DEPLOYMENT.md',
      '.github/workflows/deploy.yml',
      'payload-office-platform/CLAUDE.md',
      'payload-office-platform/AGENTS.md',
    ]
    /**
     * 禁止的**断言本身**（现在方向反过来了：不得声称发布是手动的 / 合并无事发生），
     * 而不是「手动 + 部署」这种词共现——deploy.yml 保留了 workflow_dispatch 手动
     * 入口，正常描述它并不违规，违规的是声称它是**唯一**入口。
     *
     * 沿用上一版用血换来的两条设计约束：不判词共现、不要求出现触发动词。
     * **这条测试本身就是「绿灯不等于有效」的例子**——必须反向验证过才算数，
     * 见本次提交信息里记录的反验结果。
     */
    const FORBIDDEN = [
      /只能手动/,
      /仅能手动/,
      /不(会|再)触发任何部署/,
      /(合并|push|推送|merge).{0,16}master.{0,16}(什么都不|不会).{0,8}(发生|部署|上线)/i,
      /master.{0,8}(本身)?不触发(任何)?部署/,
      /发布是显式动作/,
      /(发布|上线|部署).{0,8}只(能|有).{0,12}(手动|workflow_dispatch)/,
    ]
    /**
     * 放行：标注为历史/沿革/更正的行，或明确在讲手动入口的**附加**用途。
     * 把「曾经如此、现已改变」写清楚，本身就是防漂移的一部分——不是漏洞，是出口。
     */
    const NEGATED =
      /曾经|原先|此前|不再|已改为|已恢复|已于|已移除|已作废|注：当时|历史|错|~~|❌|20\d\d-\d\d-\d\d/

    const offenders: string[] = []
    for (const rel of DOCS) {
      const full = resolve(repositoryRoot, rel)
      let text: string
      try {
        text = readFileSync(full, 'utf8')
      } catch {
        continue // 文件不存在就跳过，不因为挪了个文件把测试搞红
      }
      text.split('\n').forEach((line, i) => {
        if (NEGATED.test(line)) return
        if (FORBIDDEN.some((re) => re.test(line))) {
          offenders.push(`${rel}:${i + 1}  ${line.trim()}`)
        }
      })
    }

    expect(
      offenders,
      '这些行声称发布只能手动 / 合并 master 不会部署，而 deploy.yml 已由 quality.yml\n' +
        '的 workflow_run 自动接力并全量切流：\n' +
        offenders.join('\n') +
        '\n合并到 master 即上线（闸门通过后自动 promote）。' +
        '若确实在描述沿革，请把「曾经 / 已改为 / 注：当时」或日期写进同一行。',
    ).toEqual([])
  })

  it('切流量仍然受 SHOULD_PROMOTE 控制（不能顺手把流量门也拆了）', () => {
    const yaml = workflow()
    for (const step of ['切 10% 灰度', 'Promote 全量发布']) {
      expect(stepBlock(yaml, step), `${step} 应保留流量门`).toMatch(
        /^\s*if:.*SHOULD_PROMOTE/m,
      )
    }
  })
})

describe('Umami 采集的构建期/运行期环境（OPT-064b）', () => {
  const dockerfile = () => readFileSync(resolve(appRoot, 'Dockerfile'), 'utf8')

  /** 取某个构建阶段的正文（到下一个 `FROM` 为止） */
  function stage(text: string, name: 'builder' | 'runner'): string {
    const start = text.indexOf(`AS ${name}`)
    expect(start, `Dockerfile 里找不到 ${name} 阶段`).toBeGreaterThan(-1)
    const next = text.indexOf('\nFROM ', start)
    return next === -1 ? text.slice(start) : text.slice(start, next)
  }

  /** 从一段 Dockerfile 里抽出 `ENV KEY=VALUE` 映射 */
  function envOf(block: string): Record<string, string> {
    const out: Record<string, string> = {}
    for (const line of block.split('\n')) {
      const m = /^ENV\s+([A-Z0-9_]+)=(.*)$/.exec(line.trim())
      if (m) out[m[1]] = m[2]
    }
    return out
  }

  const UMAMI_KEYS = [
    'NEXT_PUBLIC_ANALYTICS_ENABLED',
    'NEXT_PUBLIC_UMAMI_SRC',
    'NEXT_PUBLIC_UMAMI_WEBSITE_ID',
  ] as const

  it('builder 阶段提供三个 NEXT_PUBLIC_UMAMI 变量（客户端 bundle 靠构建期内联）', () => {
    // Next 把 NEXT_PUBLIC_* 内联成字面量。缺了它们，浏览器侧 resolveUmamiConfig()
    // 恒为 null：脚本不注、adapter 退化 Noop，采集静默归零。
    const env = envOf(stage(dockerfile(), 'builder'))
    for (const key of UMAMI_KEYS) {
      expect(env[key], `builder 阶段缺 ${key}`).toBeTruthy()
    }
  })

  it('runner 阶段的三个值与 builder 逐字一致', () => {
    // next.config.ts 顶层 import 了 security-headers，按 NEXT_PUBLIC_UMAMI_SRC
    // 往 CSP 的 script-src 追加 Umami origin。两个阶段一旦漂移（典型：换域名只改了
    // builder），CSP 会拦掉采集脚本——而 CSP 拦截除控制台一行外**没有任何症状**。
    const text = dockerfile()
    const builder = envOf(stage(text, 'builder'))
    const runner = envOf(stage(text, 'runner'))
    for (const key of UMAMI_KEYS) {
      expect(runner[key], `runner 阶段缺 ${key}`).toBeTruthy()
      expect(runner[key], `${key} 在 builder/runner 两个阶段不一致`).toBe(builder[key])
    }
  })

  it('CSP 的 script-src 由 NEXT_PUBLIC_UMAMI_SRC 驱动，没有把域名写死', () => {
    // 写死域名会让预发/本地生产构建的脚本被 CSP 拦掉，且改域名时必然漏改一处。
    const headers = readFileSync(resolve(appRoot, 'src/lib/security-headers.ts'), 'utf8')
    expect(headers).toContain('process.env.NEXT_PUBLIC_UMAMI_SRC')
    expect(headers).not.toContain('umami-286300-10-1253925058')
  })
})
