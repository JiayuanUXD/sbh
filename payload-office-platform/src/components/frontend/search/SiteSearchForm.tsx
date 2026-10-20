'use client'

/**
 * 搜索页关键词表单（OPT-122 Phase 3 接入输入联想）。
 *
 * 保留原生 GET 表单（`action` + `method="get"` + `name="q"`）：JS 未就绪时
 * 回车照常跳搜索结果页，联想只是增强。客户端只多做两件事：联想键盘导航、
 * 以及选中建议时走 `router.push` 直达实体页。
 */

import { useRouter } from 'next/navigation'
import React, { useState } from 'react'

import SearchSuggestionList from './SearchSuggestionList'
import { useSearchSuggestions } from './useSearchSuggestions'

export default function SiteSearchForm({
  citySlug,
  q,
  action,
}: Readonly<{
  citySlug: string
  /** 当前 URL 上的 q，仅作初值；之后输入框是自己的事实源。 */
  q: string
  action: string
}>) {
  const router = useRouter()
  const [value, setValue] = useState(q)
  const [focused, setFocused] = useState(false)
  const suggestions = useSearchSuggestions({ citySlug, query: value, enabled: focused })

  function onKeyDown(event: React.KeyboardEvent) {
    const picked = suggestions.consumeKeyDown(event)
    if (picked) {
      suggestions.close()
      router.push(picked.href)
    }
  }

  return (
    <form
      className="sw-form"
      action={action}
      method="get"
      role="search"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          suggestions.close()
        }
      }}
    >
      <input
        className="sw-form__input"
        name="q"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onFocus={() => setFocused(true)}
        onKeyDown={onKeyDown}
        placeholder="搜索楼盘、商圈、地铁或房源"
        aria-label="搜索关键词"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={suggestions.open}
        aria-controls={suggestions.listboxId}
        aria-activedescendant={
          suggestions.activeIndex >= 0 ? suggestions.optionId(suggestions.activeIndex) : undefined
        }
      />
      <button className="sw-form__submit" type="submit">
        搜索
      </button>
      {suggestions.open ? (
        <SearchSuggestionList
          id={suggestions.listboxId}
          items={suggestions.items}
          activeIndex={suggestions.activeIndex}
          optionId={suggestions.optionId}
          onHover={suggestions.select}
          onPick={(item) => {
            suggestions.close()
            router.push(item.href)
          }}
        />
      ) : null}
    </form>
  )
}
