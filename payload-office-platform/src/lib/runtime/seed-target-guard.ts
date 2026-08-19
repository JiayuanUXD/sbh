/**
 * seed 目标环境守卫：拦住「拿生产凭据跑 seed」这类误操作。
 *
 * 事故复盘（2026-08-15 17:10:59Z，COS LastModified 实证）：
 *   本地一次 `pnpm seed:media` 读到主工作树 .env.local 里的**生产 COS 凭据**，
 *   数据写进了本地库（生产 media 表 filesize 至今未变，证明 DB 没被碰），
 *   但 COS 按同名 key 覆盖——生产的 hero-bg.mp4 从 1,232,907 字节的真视频
 *   被换成 15,269 字节的纯音轨 E2E 占位 fixture，首页 hero 视频不再出画。
 *   同批还覆盖了 landing-hero-publish/entrust-20260810.jpg。
 *
 * 为什么守在这一层：seed 脚本的所有上传都走同一个 payload.create({ file })，
 * 目标桶完全由环境变量决定，脚本自身看不出「这是生产」。把判定收成纯函数，
 * 在 seed 入口 fail-fast，比指望每个人记得改 .env.local 可靠。
 *
 * 无 IO、无 payload 依赖，可独立单测。
 */

/** 生产媒体桶（腾讯云 COS，见 DEPLOYMENT.md）。 */
export const PRODUCTION_COS_BUCKET = 'sbh-1253925058'

/** 本地/CI 环回地址：只有这些主机上的库才算非生产。 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

export interface SeedTargetEnv {
  /** COS_BUCKET */
  cosBucket?: string
  /** DATABASE_URL */
  databaseUrl?: string
  /** ALLOW_PRODUCTION_SEED，只有严格等于 '1' 才放行 */
  allowProductionSeed?: string
}

/** 从连接串里取主机名；取不到返回 null（无法解析时不臆断为生产）。 */
function parseDatabaseHost(databaseUrl: string): string | null {
  try {
    return new URL(databaseUrl).hostname || null
  } catch {
    return null
  }
}

/**
 * 列出 env 指向的生产目标，本地/CI 形态返回空数组。
 *
 * 判定保守：只有「明确是生产桶」或「数据库主机不是环回地址」才算命中，
 * 无法解析的连接串一律不算——误拦本地开发比漏拦生产更容易让人直接关掉守卫。
 */
export function detectProductionSeedTargets(env: SeedTargetEnv): string[] {
  const targets: string[] = []

  if (env.cosBucket === PRODUCTION_COS_BUCKET) {
    targets.push(`COS 桶 ${PRODUCTION_COS_BUCKET}`)
  }

  if (env.databaseUrl) {
    const host = parseDatabaseHost(env.databaseUrl)
    if (host !== null && !LOOPBACK_HOSTS.has(host)) {
      targets.push(`数据库主机 ${host}`)
    }
  }

  return targets
}

/**
 * seed 入口调用：指向生产就抛错中止。
 *
 * 逃生舱 `ALLOW_PRODUCTION_SEED=1` 留给「确实要往生产灌初始数据」的场景，
 * 只认字面量 '1'——否则 `ALLOW_PRODUCTION_SEED=false` 这种写法会反向放行。
 */
export function assertSeedTargetNotProduction(env: SeedTargetEnv): void {
  if (env.allowProductionSeed === '1') return

  const targets = detectProductionSeedTargets(env)
  if (targets.length === 0) return

  throw new Error(
    [
      'seed 拒绝执行：当前环境指向生产资源。',
      ...targets.map((t) => `  - ${t}`),
      '',
      'seed 会按同名 key 覆盖对象存储里的文件（真实事故：生产首页 hero 视频被 15KB 占位 fixture 覆盖）。',
      '本地请改用独立的 PG 库，并把五项 COS_* 全部留空（走本地磁盘存储）。',
      '不要填占位桶：那会让本地上传恒 500，且极易被随手改成真实生产凭据。',
      '确实要写生产请显式设置 ALLOW_PRODUCTION_SEED=1。',
    ].join('\n'),
  )
}

/** 从 process.env 读取并校验，供脚本入口直接调用。 */
export function assertSeedTargetFromProcessEnv(): void {
  assertSeedTargetNotProduction({
    cosBucket: process.env.COS_BUCKET,
    databaseUrl: process.env.DATABASE_URL,
    allowProductionSeed: process.env.ALLOW_PRODUCTION_SEED,
  })
}
