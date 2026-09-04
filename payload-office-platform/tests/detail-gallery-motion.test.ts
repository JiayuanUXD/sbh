/**
 * 守卫：详情页主图的 hover 缩放必须真的有过渡
 *
 * ## 这条守卫防的是什么
 *
 * 主图按钮的 className 是 `detail-gallery__main-media detail-gallery__open`
 * （DetailGallery.tsx），于是 styles.css 里这两条**同特异度 (0,1,1)** 的规则
 * 都命中它内部的 `img`：
 *
 *   .detail-gallery__main-media img { transition: transform … }   （靠前）
 *   .detail-gallery__open img       { transition: opacity   … }   （靠后，赢）
 *
 * `transition` 是简写，后来者**整条替换**前者——于是 `:hover img { transform: scale() }`
 * 长期没有任何过渡曲线，直接跳变。用户报的「hover 放大动画有些生硬」不是曲线难看，
 * 是压根没有曲线。2026-09-04 修复：在靠后那条里把 transform 一并重述。
 *
 * ## 判据为什么落在「靠后那条」上
 *
 * 失效通道是层叠，不是某一行文本。只断言靠前那条写了 transform 毫无意义——
 * 它本来就写着，照样被盖掉。**唯一能决定最终结果的是最后一条**，所以这里断言的是
 * `.detail-gallery__open img` 这一条同时含 opacity 与 transform。
 *
 * 已在真实 Chrome 上核对过最终计算值：
 * `opacity 0.32s cubic-bezier(0.28, 0.11, 0.32, 1), transform 0.32s cubic-bezier(0.28, 0.11, 0.32, 1)`。
 *
 * 若将来把这两条合并成一条、或改了类名组合，本测试会失败——那时应当重新确认
 * 「主图上最后生效的那条 transition 是否仍含 transform」，而不是把断言删掉。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const CSS = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'app', '(frontend)', 'styles.css'),
  'utf8',
)

/** 取出某个选择器块的声明体（只取第一处，本文件涉及的选择器在 styles.css 中唯一）。 */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = CSS.match(new RegExp(`(^|})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'))
  return match?.[2] ?? ''
}

describe('详情页主图 hover 缩放的过渡不得被后来的同特异度规则吃掉', () => {
  it('.detail-gallery__open img 的 transition 同时覆盖 opacity 与 transform', () => {
    const body = ruleBody('.detail-gallery__open img')

    expect(body).not.toBe('')
    // 载入淡入是这条规则的原始职责，不能因为补 transform 就把它弄丢
    expect(body).toMatch(/transition:[^;]*opacity/s)
    // 被它压掉的那半必须在同作用域重述
    expect(body).toMatch(/transition:[^;]*transform/s)
  })

  it('主图缩放用全站动效 token，不用字面量', () => {
    const openBody = ruleBody('.detail-gallery__open img')
    // 时长与缓动都走 token：320ms 与 .sf-card 的 hover 抬升是同一个决定，
    // 字面量抄第二遍就会分叉（surface.css 同款理由）。
    expect(openBody).toContain('var(--duration-slow)')
    expect(openBody).toContain('var(--ease-apple)')
    expect(openBody).not.toMatch(/transition:[^;]*\d+(\.\d+)?s\s+ease\b/)
  })

  it('hover 缩放幅度仍在"看得出是缩放"的量级', () => {
    const hover = ruleBody('.detail-gallery__main-media:hover img')
    const scale = hover.match(/scale\(([\d.]+)\)/)?.[1]

    expect(scale).toBeDefined()
    // 1.02 在 16:10 大图上小到只读得出"抖了一下"；上限防止有人调成夸张的橱窗效果
    expect(Number(scale)).toBeGreaterThanOrEqual(1.03)
    expect(Number(scale)).toBeLessThanOrEqual(1.06)
  })
})
