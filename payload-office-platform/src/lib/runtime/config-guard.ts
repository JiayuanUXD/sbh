/**
 * 生产配置 fail-closed 守卫（OPT-015）
 *
 * 完成标准：生产缺少 PostgreSQL、强密钥或合法站点 URL 时拒绝启动。
 *
 * 挂载点：payload.config.ts 的 onInit 钩子。onInit 在 getPayload 时执行，
 *   - 容器启动 `payload migrate` -> getPayload -> onInit -> 守卫
 *   - `next start` 首次请求 -> getPayload -> onInit -> 守卫
 *   - `next build` / `generate:types` 不调 getPayload -> 不触发（构建期无运行 env 也不阻断）
 *   - 本地 `next dev` NODE_ENV 非 production -> 守卫跳过（允许 SQLite + 默认密钥）
 *
 * 设计原则：
 *   - 仅在 NODE_ENV=production 检查；dev/test 永不阻断
 *   - 纯函数 validateProductionConfig 返回违例列表，便于单元测试
 *   - assertProductionConfig 抛错时进程退出，CloudRun 不切流量 -> fail-closed
 */

export type ConfigGuardEnv = {
  NODE_ENV?: string
  DATABASE_URL?: string
  PAYLOAD_SECRET?: string
  NEXT_PUBLIC_SITE_URL?: string
}

export type ConfigGuardViolation = {
  field: string
  reason: string
}

/**
 * 已知弱密钥默认值。生产若误用这些值（来自 payload.config.ts 的 dev fallback
 * 或常见占位符），即使长度足够也判违例。
 */
const WEAK_SECRETS = new Set([
  'local-dev-secret-change-me',
  'change-me',
  'secret',
  'payload-secret',
  'your-secret-key',
])

/** 生产密钥最小长度（Payload secret 用于 JWT 签名 / 会话加密）。 */
const MIN_SECRET_LENGTH = 32

/**
 * 校验生产配置，返回违例列表（空表示通过）。
 * 非 production 环境直接返回空，不检查。
 */
export function validateProductionConfig(env: ConfigGuardEnv): ConfigGuardViolation[] {
  if (env.NODE_ENV !== 'production') return []

  const violations: ConfigGuardViolation[] = []

  // 1. DATABASE_URL 必须是 PostgreSQL（生产禁止降级到本地 SQLite）
  const db = env.DATABASE_URL?.trim()
  if (!db) {
    violations.push({
      field: 'DATABASE_URL',
      reason: '生产环境缺少 DATABASE_URL（拒绝静默降级到本地 SQLite 临时文件）',
    })
  } else if (!db.startsWith('postgres')) {
    violations.push({
      field: 'DATABASE_URL',
      reason: '生产环境 DATABASE_URL 必须是 PostgreSQL 连接串（以 postgres 开头），禁止 SQLite',
    })
  }

  // 2. PAYLOAD_SECRET 强密钥
  const secret = env.PAYLOAD_SECRET ?? ''
  if (!secret) {
    violations.push({ field: 'PAYLOAD_SECRET', reason: '生产环境缺少 PAYLOAD_SECRET' })
  } else if (WEAK_SECRETS.has(secret)) {
    violations.push({
      field: 'PAYLOAD_SECRET',
      reason: 'PAYLOAD_SECRET 为已知弱默认值，必须使用随机生成的强密钥',
    })
  } else if (secret.length < MIN_SECRET_LENGTH) {
    violations.push({
      field: 'PAYLOAD_SECRET',
      reason: `PAYLOAD_SECRET 长度 ${secret.length} 不足（需 >= ${MIN_SECRET_LENGTH} 字符）`,
    })
  }

  // 3. NEXT_PUBLIC_SITE_URL 合法 URL + https + 非 localhost
  const siteUrl = env.NEXT_PUBLIC_SITE_URL?.trim()
  if (!siteUrl) {
    violations.push({
      field: 'NEXT_PUBLIC_SITE_URL',
      reason: '生产环境缺少 NEXT_PUBLIC_SITE_URL（sitemap/canonical/OG 依赖）',
    })
  } else {
    try {
      const u = new URL(siteUrl)
      if (u.protocol !== 'https:') {
        violations.push({
          field: 'NEXT_PUBLIC_SITE_URL',
          reason: '生产环境 NEXT_PUBLIC_SITE_URL 必须使用 https',
        })
      }
      if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') {
        violations.push({
          field: 'NEXT_PUBLIC_SITE_URL',
          reason: '生产环境 NEXT_PUBLIC_SITE_URL 不得指向 localhost',
        })
      }
    } catch {
      violations.push({
        field: 'NEXT_PUBLIC_SITE_URL',
        reason: 'NEXT_PUBLIC_SITE_URL 不是合法 URL',
      })
    }
  }

  return violations
}

/**
 * 断言生产配置合法，违例时抛错拒绝启动。
 * dev/test 环境无副作用。
 */
export function assertProductionConfig(env: ConfigGuardEnv): void {
  const violations = validateProductionConfig(env)
  if (violations.length === 0) return
  const lines = violations.map((v) => `  - ${v.field}: ${v.reason}`).join('\n')
  throw new Error(
    `[config-guard] 生产配置 fail-closed：启动被拒绝。请补齐以下环境变量：\n${lines}`,
  )
}
