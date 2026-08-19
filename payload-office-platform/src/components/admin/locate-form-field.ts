'use client'

/**
 * 后台编辑表单的「点一下跳到该字段」工具
 *
 * 原本这段 DOM 操作内联在 `ListingVisibilityCardClient` 里。D 项的完整度引导需要
 * 同一套行为（切 Tab → 展开折叠分节 → 滚动 → 高亮），把它抽出来共用，避免两份
 * 各自演化——两份一旦分叉，就会出现「可见性卡片点得动、完整度卡片点不动」这种
 * 只有手点才发现的问题。
 *
 * 匹配全部按**文本**做（tab 按钮文字、字段 label 文字），因为 Payload 不给字段
 * 渲染稳定的 data 属性。所以调用方传进来的 label 必须与 `Listings.ts` 逐字一致；
 * 对不上就静默不动作（`tests/listing-completeness-locate.test.ts` 把这一点钉住）。
 */

/** 高亮样式：可见性用琥珀描边，完整度缺失用红色描边 + 闪烁。 */
export type HighlightTone = 'warning' | 'error'

const TONE_COLOR: Record<HighlightTone, string> = {
  warning: 'var(--theme-warning-500, #ff7d00)',
  error: 'var(--theme-error-500, #f53f3f)',
}

/** 切到目标 Tab；已激活则不重复点击。返回是否找到该 Tab。 */
function activateTab(tabLabel: string): boolean {
  const tabButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>('.tabs-field__tabs button'),
  )
  const targetTab = tabButtons.find((btn) => (btn.textContent ?? '').trim() === tabLabel)
  if (!targetTab) return false

  // Payload 的 tab 激活态类名是 `tabs-field__tab-button--active`（不是裸 `active`）。
  const isActive =
    targetTab.classList.contains('tabs-field__tab-button--active') ||
    targetTab.getAttribute('aria-selected') === 'true'
  if (!isActive) targetTab.click()
  return true
}

/**
 * 展开 label 所有折叠着的祖先分节，返回展开了几层。
 *
 * OPT-032 把 5 个 tab 收成 2 个后，原来的 tab 降级成了 collapsible 分节。Payload 的
 * Collapsible 折叠时**仍然渲染 children**（只是套 height: 0），所以 label 找得到、
 * 却滚不到可视区——表现为「点了没反应」。折叠态还持久化在用户 preferences 里，
 * 光靠 initCollapsed 默认展开挡不住。
 *
 * 先收集再点击：click 会触发 React 重渲染，边走边点可能让向上的游标失效。
 */
function expandCollapsedAncestors(label: Element): number {
  const collapsedAncestors: Element[] = []
  let node: Element | null = label.closest('.collapsible--collapsed')
  while (node) {
    collapsedAncestors.push(node)
    node = node.parentElement?.closest('.collapsible--collapsed') ?? null
  }
  for (const el of collapsedAncestors.reverse()) {
    // toggle 按钮是 .collapsible 头部行的直接子元素；限定两层深度，
    // 避免把嵌套分节（如「状态（只读）」）的按钮一起点了。
    el.querySelector<HTMLButtonElement>(':scope > * > .collapsible__toggle')?.click()
  }
  return collapsedAncestors.length
}

/** 给字段容器加一圈描边并在 1.8s 后还原；error 色调额外闪两下。 */
function highlight(container: HTMLElement, tone: HighlightTone): void {
  const color = TONE_COLOR[tone]
  const previousShadow = container.style.boxShadow
  const previousTransition = container.style.transition
  container.style.transition = 'box-shadow 0.3s ease'
  container.style.boxShadow = `0 0 0 3px ${color}`

  if (tone === 'error') {
    // 闪两下再停住：缺失项往往一次跳过去好几个，静态描边不够抓眼。
    const blink = [600, 900, 1200]
    blink.forEach((delay, index) => {
      window.setTimeout(() => {
        container.style.boxShadow = index % 2 === 0 ? 'none' : `0 0 0 3px ${color}`
      }, delay)
    })
  }

  window.setTimeout(() => {
    container.style.boxShadow = previousShadow
    container.style.transition = previousTransition
  }, 1800)
}

/**
 * 切到 `tabLabel`，滚到 label 以 `fieldLabel` 开头的字段并高亮。
 *
 * label 可能因为 Tab 切换的 React 渲染而晚于点击出现，所以带两轮重试；
 * 仍找不到就停在 Tab 上（比什么都不做强）。
 */
export function locateFormField(
  tabLabel: string,
  fieldLabel: string | undefined,
  tone: HighlightTone = 'warning',
): void {
  if (!activateTab(tabLabel)) return
  if (fieldLabel === undefined) return

  const tryHighlight = (attempt: number): void => {
    const label = Array.from(document.querySelectorAll<HTMLElement>('label, .field-label')).find(
      (el) => (el.textContent ?? '').trim().startsWith(fieldLabel),
    )
    if (!label) {
      if (attempt < 2) window.setTimeout(() => tryHighlight(attempt + 1), 300)
      return
    }

    const expanded = expandCollapsedAncestors(label)
    const container = (label.closest('[class*="field"]') ?? label) as HTMLElement
    // 展开分节有 AnimateHeight 过渡，立刻滚会落在错的位置，等一拍再滚。
    window.setTimeout(
      () => container.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      expanded > 0 ? 320 : 0,
    )
    highlight(container, tone)
  }

  window.setTimeout(() => tryHighlight(0), 150)
}
