'use client'

import { useRouter } from 'next/navigation'
import React, { useState } from 'react'

/**
 * 首页 Hero 搜索表单（F3.1）
 *
 * 设计依据：specs/frontend-mvp/design.md §5.2、§7.1
 *           Page PRD: FP-01 §3.2
 *
 * 守护不变量：
 *   - 提交后跳转 /listings?<canonical>，URL 可复现条件；
 *   - 关键词提交前做长度与字符白名单校验，避免非法 query 进 URL；
 *   - 区域与类型入口为 chip 形式，单选直接跳转；
 *   - 不使用自动轮播，首屏图片由 Next.js 优先级控制（layout.tsx）。
 *
 * 注意：
 *   - 此组件为客户端组件，仅负责构造 URLSearchParams 并 router.push；
 *   - canonical URL 解析与稳定排序在列表页 /listings 服务端完成（F3.5）。
 */

type DistrictChip = { slug: string; name: string }

type Props = {
  districts: readonly DistrictChip[]
  /** 当前城市 slug；MVP 单城市默认 shanghai */
  city?: string
}

const TYPE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'traditional-office', label: '传统办公' },
  { value: 'serviced-office', label: '服务式办公' },
  { value: 'coworking', label: '共享办公' },
  { value: 'full-floor', label: '整层办公' },
]

/** 关键词白名单：去除控制字符、压缩空白、长度 ≤ 60 */
function normalizeKeyword(raw: string): string | null {
  const trimmed = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  if (trimmed.length === 0 || trimmed.length > 60) return null
  return trimmed
}

export default function HeroSearch({ districts, city = 'shanghai' }: Props) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [error, setError] = useState<string | null>(null)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const normalized = normalizeKeyword(q)
    if (q && !normalized) {
      setError('关键词需为 1–60 字符')
      return
    }
    setError(null)
    const params = new URLSearchParams()
    if (normalized) params.set('q', normalized)
    const qs = params.toString()
    router.push(qs ? `/listings?${qs}` : '/listings')
  }

  function pickDistrict(slug: string) {
    const params = new URLSearchParams()
    params.set('district', slug)
    router.push(`/listings?${params.toString()}`)
  }

  function pickType(value: string) {
    const params = new URLSearchParams()
    params.set('type', value)
    router.push(`/listings?${params.toString()}`)
  }

  return (
    <div className="hero-search">
      <form className="hero-search__form" onSubmit={submit} role="search">
        <label htmlFor="hero-q" className="visually-hidden">搜索关键词</label>
        <input
          id="hero-q"
          name="q"
          type="search"
          className="hero-search__input"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            if (error) setError(null)
          }}
          placeholder="如：江景、整层、地铁口"
          maxLength={60}
          autoComplete="off"
          aria-invalid={error != null}
          aria-describedby={error ? 'hero-q-error' : undefined}
        />
        <button type="submit" className="btn btn--primary btn--lg">搜索办公室</button>
      </form>
      {error && (
        <p id="hero-q-error" className="hero-search__error" role="alert">
          {error}
        </p>
      )}

      <div className="hero-search__chips" aria-label="按区域快速浏览">
        <span className="hero-search__chip-label">区域：</span>
        {districts.slice(0, 8).map((d) => (
          <button
            key={d.slug}
            type="button"
            className="tag tag--lg"
            onClick={() => pickDistrict(d.slug)}
          >
            {d.name}
          </button>
        ))}
      </div>

      <div className="hero-search__chips" aria-label="按办公类型快速浏览">
        <span className="hero-search__chip-label">类型：</span>
        {TYPE_OPTIONS.map((t) => (
          <button
            key={t.value}
            type="button"
            className="tag tag--lg"
            onClick={() => pickType(t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* city 作为隐藏上下文锚点，便于未来多城市扩展；当前不渲染选择器 */}
      <input type="hidden" name="city" value={city} />
    </div>
  )
}
