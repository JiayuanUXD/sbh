/**
 * 守卫：埋点调用的事件名必须在白名单里（OPT-064）
 *
 * ## 这条守卫防的是什么
 *
 * `CorrectionModal` 从一开始就有 7 个 `track('correction_*')` 调用点，但那四个事件名
 * 从没进过 `ANALYTICS_EVENTS`。链路是这样静默断掉的：
 *
 *   validateEvent 查不到事件名 → 返回 { ok: false, reason: 'unknown_event:...' }
 *   → collector 直接 return 丢弃
 *   → 丢弃日志有 `NODE_ENV !== 'production'` 前置，**生产环境一行线索都不留**
 *
 * 于是「埋点写了、代码评审过了、单测全绿」，而数据从来没到过任何地方。
 * 补那四行白名单只解决了这一次；本测试解决的是这一类——再有人加埋点忘了加白名单，
 * CI 直接红。
 *
 * ## 覆盖范围与已知边界
 *
 * 扫描 `src/` 下所有 **字面量** 事件名：`track('x')` 以及三个既有包装函数
 * （`safeTrackLandingEvent` / `safeTrackCityEvent` / `createLandingOnceTracker`）。
 *
 * **动态派发的调用扫不到**，这是静态扫描的固有限制而不是遗漏：
 * `DetailClickAnalytics.tsx` 走 `track(eventName, ...)`，事件名来自 DOM dataset。
 * 那条路径由该组件自己的单测覆盖。
 *
 * 反方向（白名单里有、但没人埋）**故意不做成断言**：`supply_filter` 当前正处于这个
 * 状态（定义了从没埋过，见 spec §3.3），把它做成硬失败只会逼出一个豁免清单，
 * 而豁免清单本身又会腐烂。这个方向留给人工盘点。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { ANALYTICS_EVENTS } from '@/lib/frontend/analytics/events'

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')

/**
 * 事件名出现在第几个实参，按调用形状登记。
 * 新增包装函数时在这里补一行，否则它的调用点不受本守卫保护。
 */
const CALL_SHAPES: ReadonlyArray<{ callee: string; argIndex: 0 | 1 }> = [
  { callee: 'track', argIndex: 0 },
  { callee: 'safeTrackLandingEvent', argIndex: 1 },
  { callee: 'safeTrackCityEvent', argIndex: 1 },
  { callee: 'createLandingOnceTracker', argIndex: 0 },
]

function listSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...listSourceFiles(full))
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

export interface FoundCall {
  file: string
  line: number
  eventName: string
}

/**
 * 抽出一次调用中位于 `argIndex` 的字符串字面量。
 *
 * 只认「该位置就是一个字符串字面量」这一种形状：`track('x')`、`fn(ident, 'x')`。
 * 位置上是变量（动态派发）时返回 null——那是扫不到的情形，不是错误。
 */
export function extractLiteralArg(callTail: string, argIndex: 0 | 1): string | null {
  if (argIndex === 0) {
    const m = /^\s*'([^']*)'/.exec(callTail)
    return m ? m[1] : null
  }
  // 第 2 个实参：跳过第 1 个标识符实参（不处理嵌套调用，既有包装函数都不需要）
  const m = /^\s*[A-Za-z_$][\w$.]*\s*,\s*'([^']*)'/.exec(callTail)
  return m ? m[1] : null
}

/** 扫描单份源码，返回其中所有字面量事件名调用。 */
export function scanSource(source: string, file: string): FoundCall[] {
  const found: FoundCall[] = []
  for (const { callee, argIndex } of CALL_SHAPES) {
    // 前置 (?<![\w$.]) 避免把 `foo.track(` / `myTrack(` 当成 `track(`
    const re = new RegExp(`(?<![\\w$.])${callee}\\(`, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(source)) !== null) {
      const name = extractLiteralArg(source.slice(m.index + m[0].length), argIndex)
      if (name === null) continue
      found.push({
        file,
        line: source.slice(0, m.index).split('\n').length,
        eventName: name,
      })
    }
  }
  return found
}

describe('埋点事件名白名单守卫', () => {
  const calls = listSourceFiles(SRC_ROOT).flatMap((file) =>
    scanSource(readFileSync(file, 'utf8'), path.relative(SRC_ROOT, file).replace(/\\/g, '/')),
  )

  it('扫描确实命中了埋点调用（守卫本身不能空转）', () => {
    // 空转的守卫比没有守卫更糟：它会给出「已保护」的错觉。
    expect(calls.length).toBeGreaterThan(20)
  })

  it('每一个字面量事件名都在 ANALYTICS_EVENTS 里', () => {
    const known = new Set(Object.keys(ANALYTICS_EVENTS))
    const unknown = calls.filter((c) => !known.has(c.eventName))
    // 失败信息直接给出文件:行号与事件名，不用再去翻
    expect(
      unknown.map((c) => `${c.file}:${c.line} → track('${c.eventName}')`),
      '这些埋点调用的事件名不在 ANALYTICS_EVENTS 白名单里，会被 collector 静默丢弃',
    ).toEqual([])
  })

  it('correction_* 四个事件已在白名单内（本守卫的起因）', () => {
    for (const name of ['correction_open', 'correction_submit', 'correction_success', 'correction_error']) {
      expect(Object.keys(ANALYTICS_EVENTS)).toContain(name)
    }
  })

  it('CorrectionModal 的 7 个调用点都被扫到', () => {
    const hits = calls.filter((c) => c.file.endsWith('CorrectionModal.tsx'))
    expect(hits).toHaveLength(7)
  })
})

describe('extractLiteralArg', () => {
  it('取第 1 个实参的字面量', () => {
    expect(extractLiteralArg("'inquiry_open', { a: 1 })", 0)).toBe('inquiry_open')
  })

  it('取第 2 个实参的字面量（跳过标识符实参）', () => {
    expect(extractLiteralArg("analyticsTrack, 'landing_form_submit', {})", 1)).toBe(
      'landing_form_submit',
    )
  })

  it('动态派发返回 null 而不是误报', () => {
    expect(extractLiteralArg('eventName, { a: 1 })', 0)).toBeNull()
    expect(extractLiteralArg('track, eventName, {})', 1)).toBeNull()
  })
})
