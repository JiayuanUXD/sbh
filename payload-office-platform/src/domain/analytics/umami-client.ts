/**
 * 自托管 Umami 的服务端只读客户端（OPT-066）
 *
 * 只被 `/api/traffic` 使用，凭据不出服务端。
 *
 * ## API 契约怎么定的
 *
 * spec 说「以所装 v3 版本实测为准」。实测手段是**用状态码区分路径存在性**，
 * 不需要任何凭据（2026-09-02，Umami v3.3.1）：
 *
 * | 请求 | 状态码 | 结论 |
 * |---|---|---|
 * | `GET /api/auth/login` | 405 | 路径存在，需 POST |
 * | `GET /api/websites/:id/{stats,pageviews,events}` | 400 | 存在，缺时间窗参数 |
 * | `GET /api/websites/:id/metrics` | 400 | 存在，另需 `type` |
 * | 带齐 startAt/endAt 后 | **401** | 存在，需鉴权 |
 * | `GET /api/websites/:id/definitely-not-real` | 404 | 对照组：不存在长这样 |
 *
 * 400 的响应体直接给出了参数要求：
 * `["Either startAt+endAt or startDate+endDate must be provided"]`。
 *
 * 错误体形状统一为 `{ error: { message, code, status } }`。
 */

export interface UmamiServerConfig {
  /** Umami 服务 origin，无尾斜杠 */
  url: string
  username: string
  password: string
  websiteId: string
}

/**
 * 从服务端环境变量解析配置。
 *
 * 与客户端那三个 `NEXT_PUBLIC_UMAMI_*` 是**两套**：那些是构建期内联给浏览器的
 * 采集配置，这四个是运行时读的 API 凭据，绝不能加 `NEXT_PUBLIC_` 前缀
 * ——加了就会被内联进客户端 bundle，等于把 Umami 后台密码公开。
 *
 * 任一缺失返回 null，调用方据此走 `{ status: 'unavailable' }` 降级。
 */
export const UMAMI_ENV_KEYS = [
  'UMAMI_URL',
  'UMAMI_USERNAME',
  'UMAMI_PASSWORD',
  'UMAMI_WEBSITE_ID',
] as const

/**
 * 列出缺失（不存在或值为空）的键名。**只回键名，不回值。**
 *
 * 供诊断日志使用：「哪几项没读到」是排查的关键信息，而它本身不敏感。
 */
export function missingUmamiEnvKeys(env: NodeJS.ProcessEnv = process.env): string[] {
  const bag = env as unknown as Record<string, string | undefined>
  return UMAMI_ENV_KEYS.filter((k) => {
    const v = bag[k]
    return typeof v !== 'string' || v.trim().length === 0
  })
}

export function resolveUmamiServerConfig(
  env: NodeJS.ProcessEnv = process.env,
): UmamiServerConfig | null {
  // ⚠️ 用变量 + 方括号取值，**不要写成 `process.env.UMAMI_URL` 这种静态成员表达式**。
  // 打包器会对静态成员表达式做构建期替换：构建镜像时容器里没有这些变量，
  // 静态写法可能被直接替换成 undefined，于是运行时无论怎么配都读不到。
  // 方括号 + 变量的形式无法被静态分析替换，一定走运行时查表。
  const bag = env as unknown as Record<string, string | undefined>
  const url = bag['UMAMI_URL']?.trim()
  const username = bag['UMAMI_USERNAME']?.trim()
  const password = bag['UMAMI_PASSWORD']
  const websiteId = bag['UMAMI_WEBSITE_ID']?.trim()
  if (!url || !username || !password || !websiteId) return null

  // 容错：漏写协议是最常见的输入错误，而它的表现是 fetch 立刻抛
  // `Failed to parse URL`——耗时接近 0，和「压根没配」长得一模一样。
  const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`
  return { url: withScheme.replace(/\/+$/, ''), username, password, websiteId }
}

export class UmamiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'UmamiRequestError'
  }
}

export interface UmamiStats {
  pageviews: number
  visitors: number
}

export interface UmamiPageviewPoint {
  t: string
  pageviews: number
  visitors: number
}

export interface UmamiMetric {
  x: string
  y: number
}

export interface UmamiClient {
  stats(window: { startAt: number; endAt: number }): Promise<UmamiStats>
  pageviews(window: { startAt: number; endAt: number }): Promise<UmamiPageviewPoint[]>
  metrics(
    type: string,
    window: { startAt: number; endAt: number },
    extra?: Record<string, string>,
  ): Promise<UmamiMetric[]>
  /**
   * 某个事件的某个属性的取值分布。
   *
   * 契约实测确定（v3.3.1，用 Umami 后台自己的会话逐个试出来的）：
   *
   *     GET /api/websites/:id/event-data/values
   *         ?startAt&endAt&eventName&propertyName
   *     → [{ value: string, total: number }]
   *
   * ⚠️ **eventName 不可省**。省掉它会把该属性在**所有事件**上的取值聚合起来：
   * 实测 page_type 带 eventName=city_page_view 是 home=7/building-detail=2/
   * listings=2/listing-detail=1，不带则是 19/4/4/4——因为 page_engagement
   * 也有 page_type。漏掉这个参数数字会偏大，而且从结果上看不出错。
   */
  eventDataValues(
    eventName: string,
    propertyName: string,
    window: { startAt: number; endAt: number },
  ): Promise<Array<{ value: string; total: number }>>
  /** 测试观察用：当前是否持有 token */
  readonly hasToken: boolean
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/**
 * 从 Umami 的错误体里取可读信息。
 *
 * ⚠️ **必须把 `errors[]` 与 `properties` 一起带出来**。Umami 的 400 顶层
 * `message` 恒为 "Bad request"，真正说明「哪个参数错了」的内容在这两处：
 *
 * ```json
 * { "error": { "message": "Bad request", "errors":
 *     ["Either startAt+endAt or startDate+endDate must be provided"] } }
 * { "error": { "message": "Bad request", "properties":
 *     { "type": { "errors": ["Invalid input: expected string, received undefined"] } } } }
 * ```
 *
 * 初版只取顶层 message，于是线上日志里只有一句无信息量的 "Bad request"——
 * 抓到了错误却没保留能定位问题的那部分，等于没抓。
 */
function describeError(body: unknown, status: number): string {
  if (typeof body !== 'object' || body === null) return `HTTP ${status}`
  const err = (body as { error?: unknown }).error
  if (typeof err !== 'object' || err === null) return `HTTP ${status}`

  const parts: string[] = []
  const msg = (err as { message?: unknown }).message
  if (typeof msg === 'string' && msg.length > 0) parts.push(msg)

  const errors = (err as { errors?: unknown }).errors
  if (Array.isArray(errors) && errors.length > 0) {
    parts.push(errors.filter((e) => typeof e === 'string').join('; '))
  }

  // properties 是按字段分组的校验错误：{ type: { errors: [...] } }
  const props = (err as { properties?: unknown }).properties
  if (typeof props === 'object' && props !== null) {
    for (const [field, detail] of Object.entries(props as Record<string, unknown>)) {
      const fieldErrors =
        typeof detail === 'object' && detail !== null
          ? (detail as { errors?: unknown }).errors
          : undefined
      const text = Array.isArray(fieldErrors)
        ? fieldErrors.filter((e) => typeof e === 'string').join('; ')
        : ''
      parts.push(text ? `${field}: ${text}` : field)
    }
  }

  return parts.length > 0 ? parts.join(' | ') : `HTTP ${status}`
}

function toNumber(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  // Umami 的 stats 在部分版本返回 { value, prev } 形状
  if (typeof v === 'object' && v !== null) {
    const value = (v as { value?: unknown }).value
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return 0
}

/**
 * 创建客户端。
 *
 * token 缓存在闭包里（进程内），**401 时重登一次**并重放该请求；再失败即抛。
 * 只重放一次是刻意的：密码错了的话无限重登会把 Umami 的登录接口打爆，
 * 而且每次请求都要等两轮超时。
 */
export function createUmamiClient(deps: {
  config: UmamiServerConfig
  fetchImpl?: FetchLike
}): UmamiClient {
  const { config } = deps
  const doFetch: FetchLike = deps.fetchImpl ?? ((i, init) => fetch(i, init))
  let token: string | null = null

  async function login(): Promise<string> {
    const res = await doFetch(`${config.url}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: config.username, password: config.password }),
    })
    const body: unknown = await res.json().catch(() => null)
    if (!res.ok) {
      throw new UmamiRequestError(`Umami 登录失败：${describeError(body, res.status)}`, res.status)
    }
    const t = (body as { token?: unknown } | null)?.token
    if (typeof t !== 'string' || t.length === 0) {
      throw new UmamiRequestError('Umami 登录响应缺少 token', res.status)
    }
    return t
  }

  async function authedGet(path: string, params: Record<string, string>): Promise<unknown> {
    const qs = new URLSearchParams(params).toString()
    const url = `${config.url}${path}?${qs}`

    const attempt = async (): Promise<Response> => {
      if (!token) token = await login()
      return doFetch(url, { headers: { authorization: `Bearer ${token}` } })
    }

    let res = await attempt()
    if (res.status === 401) {
      // token 过期或失效：清掉重登一次，只重放这一次
      token = null
      res = await attempt()
    }

    const body: unknown = await res.json().catch(() => null)
    if (!res.ok) {
      // 带上路径与参数名（不带值）：5 个查询是并发发的，
      // 不标明是哪一个失败，日志里只有一句 "Bad request"，等于没说
      const where = `${path}?${Object.keys(params).sort().join(',')}`
      throw new UmamiRequestError(`${where} → ${describeError(body, res.status)}`, res.status)
    }
    return body
  }

  const win = (w: { startAt: number; endAt: number }) => ({
    startAt: String(w.startAt),
    endAt: String(w.endAt),
  })

  return {
    async stats(w) {
      const body = await authedGet(`/api/websites/${config.websiteId}/stats`, win(w))
      const r = (body ?? {}) as Record<string, unknown>
      return { pageviews: toNumber(r.pageviews), visitors: toNumber(r.visitors) }
    },

    async pageviews(w) {
      const body = await authedGet(`/api/websites/${config.websiteId}/pageviews`, {
        ...win(w),
        unit: 'day',
        timezone: 'Asia/Shanghai',
      })
      const r = (body ?? {}) as Record<string, unknown>
      const pv = Array.isArray(r.pageviews) ? r.pageviews : []
      const uv = Array.isArray(r.sessions) ? r.sessions : []
      const uvByT = new Map<string, number>()
      for (const item of uv) {
        if (typeof item === 'object' && item !== null) {
          const { x, y } = item as { x?: unknown; y?: unknown }
          if (typeof x === 'string') uvByT.set(x, toNumber(y))
        }
      }
      const out: UmamiPageviewPoint[] = []
      for (const item of pv) {
        if (typeof item !== 'object' || item === null) continue
        const { x, y } = item as { x?: unknown; y?: unknown }
        if (typeof x !== 'string') continue
        out.push({ t: x, pageviews: toNumber(y), visitors: uvByT.get(x) ?? 0 })
      }
      return out
    },

    async metrics(type, w, extra = {}) {
      const body = await authedGet(`/api/websites/${config.websiteId}/metrics`, {
        ...win(w),
        type,
        ...extra,
      })
      const rows = Array.isArray(body) ? body : []
      const out: UmamiMetric[] = []
      for (const row of rows) {
        if (typeof row !== 'object' || row === null) continue
        const { x, y } = row as { x?: unknown; y?: unknown }
        if (typeof x !== 'string') continue
        out.push({ x, y: toNumber(y) })
      }
      return out
    },

    async eventDataValues(eventName, propertyName, w) {
      const body = await authedGet(`/api/websites/${config.websiteId}/event-data/values`, {
        ...win(w),
        eventName,
        propertyName,
      })
      const rows = Array.isArray(body) ? body : []
      const out: Array<{ value: string; total: number }> = []
      for (const row of rows) {
        if (typeof row !== 'object' || row === null) continue
        const { value, total } = row as { value?: unknown; total?: unknown }
        if (typeof value !== 'string') continue
        out.push({ value, total: toNumber(total) })
      }
      return out
    },

    get hasToken() {
      return token !== null
    },
  }
}
