/**
 * P1 Task 3：高德 JS API 地图加载器
 *
 * 设计依据：docs/superpowers/plans/2026-07-30-detail-pages-p1-enhancements.md Task 3
 *
 * 守护不变量：
 *   - 单例 Promise：多次调用返回同一 Promise，避免重复注入 script
 *   - 缺 Key / SSR / 脚本失败 / 超时 / 非法响应 返回稳定错误，由调用方降级
 *   - 不调用 Geolocation（P1 只展示楼盘固定坐标，不请求用户定位）
 *   - Key 只在浏览器侧使用 NEXT_PUBLIC_AMAP_JS_KEY（域名白名单 Key），不与服务端 WebService Key 混用
 *
 * 这是仓库内首个第三方 JS SDK 注入器，无先例可抄。
 */

/** 高德 JS API 命名空间（最小接口，仅声明 LocationPanel 用到的方法） */
export interface AMapNamespace {
  Map: new (container: HTMLElement | string, opts: Record<string, unknown>) => AMapMap
  Marker: new (opts: Record<string, unknown>) => AMapMarker
}

export interface AMapMap {
  setCenter(center: unknown): void
  setFitView(): void
  destroy(): void
  on(event: string, handler: (...args: unknown[]) => void): void
}

export interface AMapMarker {
  setMap(map: AMapMap | null): void
  on(event: string, handler: (...args: unknown[]) => void): void
  setLabel(opts: { content: string; direction?: string; offset?: unknown }): void
  setPosition(lnglat: unknown): void
}

declare global {
  interface Window {
    AMap?: AMapNamespace
  }
}

/** 加载错误码（供调用方分类降级） */
export type AmapLoaderErrorCode =
  | 'amap_js_key_missing'
  | 'amap_js_ssr'
  | 'amap_js_script_error'
  | 'amap_js_timeout'
  | 'amap_js_invalid_response'

export class AmapLoaderError extends Error {
  readonly code: AmapLoaderErrorCode
  constructor(code: AmapLoaderErrorCode, message: string) {
    super(message)
    this.name = 'AmapLoaderError'
    this.code = code
  }
}

/** 脚本加载超时（毫秒） */
const LOAD_TIMEOUT_MS = 5000

let amapPromise: Promise<AMapNamespace> | null = null

/**
 * 加载高德 JS API 命名空间（单例）。
 *
 * 生产环境只在浏览器调用；SSR 调用返回 amap_js_ssr 错误。
 * 调用方应 catch 任何错误并降级为静态地址卡片。
 */
export function loadAmapMap(): Promise<AMapNamespace> {
  if (amapPromise) return amapPromise
  amapPromise = new Promise<AMapNamespace>((resolve, reject) => {
    const key = process.env.NEXT_PUBLIC_AMAP_JS_KEY
    if (!key) {
      reject(new AmapLoaderError('amap_js_key_missing', '高德 JS API Key 未配置'))
      return
    }
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      reject(new AmapLoaderError('amap_js_ssr', '高德 JS API 不能在 SSR 环境 加载'))
      return
    }
    // 已加载（热重载/重复挂载）直接复用
    if (window.AMap) {
      resolve(window.AMap)
      return
    }
    const script = document.createElement('script')
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}`
    script.async = true
    const timer = setTimeout(() => {
      cleanup()
      reject(new AmapLoaderError('amap_js_timeout', '高德 JS API 加载超时'))
    }, LOAD_TIMEOUT_MS)
    function cleanup(): void {
      clearTimeout(timer)
      script.onload = null
      script.onerror = null
    }
    script.onload = () => {
      cleanup()
      const AMap = window.AMap
      if (AMap) {
        resolve(AMap)
      } else {
        reject(
          new AmapLoaderError('amap_js_invalid_response', '高德 JS API 加载后命名空间缺失'),
        )
      }
    }
    script.onerror = () => {
      cleanup()
      reject(new AmapLoaderError('amap_js_script_error', '高德 JS API 脚本加载失败'))
    }
    document.head.appendChild(script)
  })
  return amapPromise
}

/** 仅供测试重置单例（生产代码不应调用） */
export function __resetAmapLoaderForTests(): void {
  amapPromise = null
}
