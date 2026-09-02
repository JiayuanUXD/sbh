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
export function resolveUmamiServerConfig(
  env: NodeJS.ProcessEnv = process.env,
): UmamiServerConfig | null {
  const url = env.UMAMI_URL?.trim()
  const username = env.UMAMI_USERNAME?.trim()
  const password = env.UMAMI_PASSWORD
  const websiteId = env.UMAMI_WEBSITE_ID?.trim()
  if (!url || !username || !password || !websiteId) return null
  return { url: url.replace(/\/+$/, ''), username, password, websiteId }
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
  /** 测试观察用：当前是否持有 token */
  readonly hasToken: boolean
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** 从 Umami 的错误体里取可读信息；形状不符时回落到状态码。 */
function describeError(body: unknown, status: number): string {
  if (typeof body === 'object' && body !== null) {
    const err = (body as { error?: unknown }).error
    if (typeof err === 'object' && err !== null) {
      const msg = (err as { message?: unknown }).message
      if (typeof msg === 'string' && msg.length > 0) return msg
    }
  }
  return `HTTP ${status}`
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
      throw new UmamiRequestError(describeError(body, res.status), res.status)
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

    get hasToken() {
      return token !== null
    },
  }
}
