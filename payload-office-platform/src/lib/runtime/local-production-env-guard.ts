/**
 * 本机生产模式守卫：拦住「在开发机上以生产模式起进程，却连着生产库 / 生产桶」。
 *
 * 事故（2026-10-15，OPT-114）：在主工作树起 `CI=1 pnpm start` 做性能复测。主树
 * `.env.production.local` 是全套生产凭据，Next 在 NODE_ENV=production 时读它且优先于
 * `.env.local`，于是这个本地实例连着生产库在线约 1 分钟，并按 jobs.autoRun 轮询生产
 * 任务队列（事后只读核查确认无写入）。页面照常渲染，从外面看不出任何异样。
 *
 * 怎么区分本机与线上：线上容器里**没有任何 Next 会自动加载的 env 文件**——CI 与
 * scripts/cloudrun-release.sh 都用 git 取包（只有已跟踪的 .env.example），.dockerignore
 * 再兜一道 `.env*`（守卫：tests/production-deploy-config.test.ts）。所以「cwd 下有这类文件」
 * 就是开发机；再叠加 seed 守卫的「生产目标」判定（库主机非环回 / 生产 COS 桶），
 * 两者同时成立才拦。干净 worktree（只有指向本地库的 .env.local）与 CI E2E（127.0.0.1）都放行。
 *
 * 为什么挂在 payload.config 顶层：onInit 在 db adapter 连库之后才跑，jobs autoRun 也随
 * init 启动，放在那里等于先连上生产再报错。next build（含 collectPageData worker）靠
 * NEXT_PHASE 跳过——构建期不连库，主树本地 build 不该被拦。
 *
 * 判定是纯函数，只有 listPresentEnvFiles 碰文件系统。
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { detectProductionSeedTargets } from './seed-target-guard'

/** Next production 模式自动加载的 env 文件，按 @next/env 的取值优先级排列（16.2.10 源码核对）。 */
export const NEXT_AUTOLOADED_ENV_FILES = [
  '.env.production.local',
  '.env.local',
  '.env.production',
  '.env',
] as const

export type LocalProductionEnv = {
  NODE_ENV?: string
  NEXT_PHASE?: string
  DATABASE_URL?: string
  COS_BUCKET?: string
  /** 只有严格等于 '1' 才放行 */
  ALLOW_LOCAL_PRODUCTION_ENV?: string
}

export type LocalProductionEnvHit = {
  /** cwd 下存在的自动加载 env 文件 */
  envFiles: string[]
  /** 指向的生产资源，文案同 seed 守卫 */
  targets: string[]
}

/** 列出目录里实际存在的自动加载 env 文件，保持 Next 的加载顺序。 */
export function listPresentEnvFiles(dir: string): string[] {
  return NEXT_AUTOLOADED_ENV_FILES.filter((name) => existsSync(join(dir, name)))
}

/** 本机以生产模式运行且指向生产资源时返回命中详情，否则返回 null。 */
export function detectLocalProductionEnv(
  env: LocalProductionEnv,
  presentEnvFiles: readonly string[],
): LocalProductionEnvHit | null {
  if (env.NODE_ENV !== 'production') return null
  if (env.NEXT_PHASE === 'phase-production-build') return null
  if (env.ALLOW_LOCAL_PRODUCTION_ENV === '1') return null

  const autoloaded: readonly string[] = NEXT_AUTOLOADED_ENV_FILES
  const envFiles = presentEnvFiles.filter((name) => autoloaded.includes(name))
  if (envFiles.length === 0) return null

  const targets = detectProductionSeedTargets({
    cosBucket: env.COS_BUCKET,
    databaseUrl: env.DATABASE_URL,
  })
  if (targets.length === 0) return null

  return { envFiles, targets }
}

export function assertNotLocalProductionEnv(
  env: LocalProductionEnv,
  presentEnvFiles: readonly string[],
): void {
  const hit = detectLocalProductionEnv(env, presentEnvFiles)
  if (!hit) return

  throw new Error(
    [
      '[local-production-env-guard] 拒绝启动：本机以生产模式运行，却指向生产资源。',
      `  当前目录存在：${hit.envFiles.join('、')}`,
      ...hit.targets.map((t) => `  - ${t}`),
      '',
      'Next 在 next start / next build 时会读 .env.production*，且优先于 .env.local；',
      '在这里起生产模式 server 等于多起一个连生产库、轮询生产任务队列的实例（2026-10-15 OPT-114）。',
      '处置：改在只复制 .env.local（指向本地 / 隔离库）的干净 worktree 里起，',
      '并带 PAYLOAD_DISABLE_JOB_AUTORUN=1；做法见 payload-office-platform/.agent/testing.md',
      '「起任何生产模式进程前先 ls .env.production*」。',
      '确实要在本机以生产模式连生产资源，请显式设置 ALLOW_LOCAL_PRODUCTION_ENV=1。',
    ].join('\n'),
  )
}

/** payload.config 顶层调用：读 process.env 与 cwd 下的 env 文件。 */
export function assertNotLocalProductionEnvFromProcess(): void {
  assertNotLocalProductionEnv(process.env, listPresentEnvFiles(process.cwd()))
}
