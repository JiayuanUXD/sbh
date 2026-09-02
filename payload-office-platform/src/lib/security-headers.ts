/**
 * 生产安全响应头（OPT-019）
 *
 * 单一事实源：next.config.ts 与测试都引用本模块，避免漂移。
 * buildSecurityHeaders 是纯函数，按 env 返回 header -> value 映射。
 *
 * 设计权衡：
 * - CSP 保留 'unsafe-inline'/'unsafe-eval'：Payload admin 的 bootstrap 内联脚本需要。
 *   未来可用 middleware 生成 per-request nonce 收紧（见 alerting.md 待办）。
 * - HSTS 仅生产：非生产可能走 http，加 HSTS 会导致 http 调试被强制 https。
 * - 非生产不加 CSP：避免 dev 工具/源码映射被 CSP 误拦，仍保留其余头。
 * - X-Frame-Options 与 CSP frame-ancestors 并存：兼容旧浏览器。
 */

export interface SecurityHeaderEnv {
  /** 是否生产环境 */
  isProduction: boolean
}

/** Permissions-Policy：禁用不需要的浏览器能力 */
const PERMISSIONS_POLICY =
  'camera=(), microphone=(), geolocation=(), payment=(), interest-cohort=()'

/**
 * Umami 统计脚本的 origin（OPT-064）。
 *
 * 从 env 读而不是硬编码域名：Umami 部署在自己的 CloudRun 服务上，域名随环境变化，
 * 写死会让预发/本地生产构建的脚本被 CSP 拦掉——而 CSP 拦截在控制台之外没有任何
 * 症状，采集会静默归零。
 *
 * 未配置时返回空数组：CSP 一个字符都不变，与「未接入 Umami」这个状态一致。
 */
function umamiScriptOrigins(): string[] {
  const src = process.env.NEXT_PUBLIC_UMAMI_SRC
  if (!src) return []
  try {
    return [new URL(src).origin]
  } catch {
    // 配了个不合法的值：宁可不放行也不要往 CSP 里拼一段垃圾
    return []
  }
}

/** 生产 CSP：兼容 Payload admin（内联脚本/样式）+ 限制外部资源 */
const PRODUCTION_CSP = [
  "default-src 'self'",
  // Payload admin bootstrap 需内联脚本；保留 unsafe-eval 兼容 admin 运行时
  // 高德 JS API 由 AmapMapCanvas 在视口内自动注入，需放行 webapi.amap.com
  // 末尾按需追加自托管 Umami 的 origin（见 umamiScriptOrigins）
  [
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    'https://webapi.amap.com https://jsapi.amap.com https://restapi.amap.com https://mapplugin.amap.com',
    ...umamiScriptOrigins(),
  ].join(' '),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self' https:",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ')

/** 所有环境都应用的基础头 */
function baseHeaders(): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': PERMISSIONS_POLICY,
  }
}

/**
 * 按环境构造安全响应头。
 * - 生产：基础头 + HSTS + CSP
 * - 非生产：基础头（不加 HSTS/CSP，避免破坏 dev 调试）
 */
export function buildSecurityHeaders(env: SecurityHeaderEnv): Record<string, string> {
  const headers = baseHeaders()
  if (env.isProduction) {
    headers['Strict-Transport-Security'] = 'max-age=63072000; includeSubDomains; preload'
    headers['Content-Security-Policy'] = PRODUCTION_CSP
  }
  return headers
}

/** 把 Record<string,string> 转成 NextConfig headers() 的数组格式 */
export function toNextHeaderEntries(
  headers: Record<string, string>,
): Array<{ key: string; value: string }> {
  return Object.entries(headers).map(([key, value]) => ({ key, value }))
}
