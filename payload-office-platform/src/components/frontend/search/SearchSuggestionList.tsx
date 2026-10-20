'use client'

/**
 * 联想下拉（OPT-122 Phase 3）。纯展示：开合、键盘、取数都在
 * `useSearchSuggestions`；本组件只负责 ARIA 与样式。
 *
 * ARIA 口径（WAI-ARIA combobox pattern）：
 *   - 容器 `role="listbox"`，选项 `role="option"` + `aria-selected`；
 *   - 输入框侧的 `aria-expanded / aria-controls / aria-activedescendant`
 *     由调用方（顶栏 / 搜索页表单）拼在 input 上，本组件只消费 id。
 *   - 鼠标用 `onMouseDown` 而不是 `onClick`：要先于 input 的 blur 收起，
 *     否则点中的瞬间列表已经没了。
 */

import type { SearchSuggestionItem } from './useSearchSuggestions'

const KIND_LABEL: Readonly<Record<string, string>> = {
  building: '楼盘',
  district: '区域',
  businessArea: '商圈',
  metro: '地铁',
  city: '城市',
}

export default function SearchSuggestionList({
  id,
  items,
  activeIndex,
  optionId,
  onPick,
  onHover,
}: Readonly<{
  id: string
  items: readonly SearchSuggestionItem[]
  activeIndex: number
  optionId: (index: number) => string
  onPick: (item: SearchSuggestionItem) => void
  onHover: (index: number) => void
}>) {
  if (items.length === 0) return null

  return (
    <ul className="sw-suggest" id={id} role="listbox" aria-label="搜索建议">
      {items.map((item, index) => (
        <li
          key={`${item.kind}:${item.href}`}
          id={optionId(index)}
          role="option"
          aria-selected={index === activeIndex}
          className={index === activeIndex ? 'sw-suggest__item sw-suggest__item--active' : 'sw-suggest__item'}
          onMouseDown={(event) => {
            event.preventDefault()
            onPick(item)
          }}
          onMouseEnter={() => onHover(index)}
        >
          <span className="sw-suggest__kind">{KIND_LABEL[item.kind] ?? item.kind}</span>
          <span className="sw-suggest__name">{item.name}</span>
          {item.parentName ? <span className="sw-suggest__parent">{item.parentName}</span> : null}
        </li>
      ))}
    </ul>
  )
}
