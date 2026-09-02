import type { Page } from '@playwright/test'

export const ANALYTICS_CAPTURE_KEY = '__landingAnalyticsDataLayerCapture__'

export type AnalyticsRecord = Readonly<{
  name: string
  props: Record<string, unknown>
}>

export type AnalyticsCapture = Readonly<{
  read: () => Promise<readonly AnalyticsRecord[]>
}>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 在页面业务脚本执行前安装。保留原 dataLayer 数组，并捕获已有条目、后续 push，
 * 以及 GTM/业务脚本稍后重新初始化 dataLayer 的场景。
 */
export function installAnalyticsDataLayerCapture(captureKey: string): void {
  const analyticsWindow = window
  if (Array.isArray(Reflect.get(analyticsWindow, captureKey))) return

  const captured: unknown[] = []
  Reflect.set(analyticsWindow, captureKey, captured)
  const wrappedLayers = new WeakSet<unknown[]>()
  const existingLayer = Reflect.get(analyticsWindow, 'dataLayer')
  let currentLayer: unknown[] = Array.isArray(existingLayer) ? existingLayer : []

  const wrapLayer = (layer: unknown[]) => {
    if (wrappedLayers.has(layer)) return
    captured.push(...layer)
    const originalPush = layer.push.bind(layer)
    Object.defineProperty(layer, 'push', {
      configurable: true,
      writable: true,
      value: (...items: unknown[]) => {
        captured.push(...items)
        return originalPush(...items)
      },
    })
    wrappedLayers.add(layer)
  }

  const descriptor = Object.getOwnPropertyDescriptor(analyticsWindow, 'dataLayer')
  if (!descriptor || descriptor.configurable) {
    Object.defineProperty(analyticsWindow, 'dataLayer', {
      configurable: true,
      enumerable: descriptor?.enumerable ?? true,
      get: () => currentLayer,
      set: (value: unknown) => {
        currentLayer = Array.isArray(value) ? value : []
        wrapLayer(currentLayer)
      },
    })
  }
  wrapLayer(currentLayer)
}

export const UMAMI_CAPTURE_KEY = '__landingAnalyticsUmamiCapture__'

/**
 * 在页面业务脚本执行前安装 `window.umami` 桩（OPT-064）。
 *
 * 生产 adapter 从 DataLayerAdapter 换成 UmamiAdapter 之后，事件不再进
 * `window.dataLayer`——只装 dataLayer 捕获会读到空数组，然后被误读成
 * 「埋点没发」。CI 实测踩过这个（run 33586601798）。
 *
 * 真实 `script.js` 由 `_umami-stub.blockUmamiScript` 在网络层拦掉，
 * 所以这个桩不会被后到的真脚本覆盖。
 */
export function installAnalyticsUmamiCapture(captureKey: string): void {
  if (Array.isArray(Reflect.get(window, captureKey))) return
  const captured: unknown[] = []
  Reflect.set(window, captureKey, captured)
  Reflect.set(window, 'umami', {
    track: (name: string, data: Record<string, unknown> = {}) => {
      captured.push({ name, props: data })
    },
    identify: () => {},
  })
}

/** DataLayerAdapter 的 `{ event, ...props, _ts }` 转为 E2E 共用事件形状。 */
export function normalizeDataLayerEvent(value: unknown): AnalyticsRecord | null {
  if (!isRecord(value) || typeof value.event !== 'string') return null
  const props: Record<string, unknown> = {}
  for (const [key, propertyValue] of Object.entries(value)) {
    if (key !== 'event' && key !== '_ts') props[key] = propertyValue
  }
  return { name: value.event, props }
}

/** 同时支持开发 ConsoleAdapter、旧的 DataLayerAdapter 与生产 UmamiAdapter。 */
export async function captureAnalytics(page: Page): Promise<AnalyticsCapture> {
  const consoleEvents: AnalyticsRecord[] = []
  await page.addInitScript(installAnalyticsDataLayerCapture, ANALYTICS_CAPTURE_KEY)
  await page.addInitScript(installAnalyticsUmamiCapture, UMAMI_CAPTURE_KEY)
  page.on('console', async (message) => {
    if (message.type() !== 'debug') return
    const args = message.args()
    if (args.length < 3) return
    const [marker, name, props] = await Promise.all(
      args.slice(0, 3).map(async (argument) => argument.jsonValue().catch(() => undefined)),
    )
    if (marker === '[analytics]' && typeof name === 'string' && isRecord(props)) {
      consoleEvents.push({ name, props })
    }
  })

  return {
    read: async () => {
      const capturedEntries: unknown[] = await page.evaluate((captureKey) => {
        const entries = Reflect.get(window, captureKey)
        return Array.isArray(entries) ? entries : []
      }, ANALYTICS_CAPTURE_KEY)
      const dataLayerEvents = capturedEntries
        .map(normalizeDataLayerEvent)
        .filter((event): event is AnalyticsRecord => event !== null)
      const umamiEntries: unknown[] = await page.evaluate((captureKey) => {
        const entries = Reflect.get(window, captureKey)
        return Array.isArray(entries) ? entries : []
      }, UMAMI_CAPTURE_KEY)
      const umamiEvents = umamiEntries.filter(
        (e): e is AnalyticsRecord => isRecord(e) && typeof e.name === 'string' && isRecord(e.props),
      )
      return [...consoleEvents, ...dataLayerEvents, ...umamiEvents]
    },
  }
}
