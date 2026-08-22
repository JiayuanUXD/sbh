'use client'

import { useRouter } from 'next/navigation'
import React, { useId, useRef, useState } from 'react'

/** 与 HeroSearch.tsx 原样搬运：类型选项，取值/顺序必须一致。 */
const TYPE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: '全部类型' },
  { value: 'traditional-office', label: '传统办公' },
  { value: 'coworking', label: '共享办公' },
  { value: 'full-floor', label: '整层办公' },
  { value: 'serviced-office', label: '独栋办公' },
]

/** 与 HeroSearch.tsx 原样搬运：面积区间；value 编码为 "<min>-<max>"，空段表示不限。 */
const AREA_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: '面积不限' },
  { value: '-100', label: '100㎡ 以下' },
  { value: '100-300', label: '100–300㎡' },
  { value: '300-500', label: '300–500㎡' },
  { value: '500-', label: '500㎡ 以上' },
]

/**
 * OPT-035 Hero 搜索 pill：单行关键词 + 「筛选」展开三下拉（区域/类型/面积）。
 * URL 语义与旧 HeroSearch 一致：q / district / type / areaMin / areaMax，
 * 提交跳 /listings（多城市为 /{city}/listings），canonical 由列表页服务端收敛。
 */
export default function HomeSearchPill({ districts, citySlug }: Readonly<{
  districts: readonly Readonly<{ slug: string; name: string }>[]
  citySlug?: string
}>) {
  const router = useRouter()
  const panelId = useId()
  const districtId = useId()
  const typeId = useId()
  const areaId = useId()
  const [open, setOpen] = useState(false)
  const [district, setDistrict] = useState('')
  const [type, setType] = useState('')
  const [area, setArea] = useState('')
  const keywordRef = useRef<HTMLInputElement>(null)
  const listingsPath = citySlug ? `/${encodeURIComponent(citySlug)}/listings` : '/listings'

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const params = new URLSearchParams()
    const q = (keywordRef.current?.value ?? '').trim().slice(0, 100)
    if (q) params.set('q', q)
    if (district) params.set('district', district)
    if (type) params.set('type', type)
    if (area) {
      const [min, max] = area.split('-')
      if (min) params.set('areaMin', min)
      if (max) params.set('areaMax', max)
    }
    const qs = params.toString()
    router.push(qs ? `${listingsPath}?${qs}` : listingsPath)
  }

  return (
    <form className="hm-search" role="search" onSubmit={submit}>
      <div className="hm-search__pill">
        <svg width="17" height="17" viewBox="0 0 17 17" style={{ flex: 'none' }} aria-hidden="true">
          <circle cx="7" cy="7" r="5.5" stroke="#86868b" strokeWidth="1.6" fill="none" />
          <path d="M11.2 11.2L15.5 15.5" stroke="#86868b" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <label htmlFor="hm-search-q" className="visually-hidden">搜索商圈、楼盘或地址</label>
        <input id="hm-search-q" ref={keywordRef} type="text" className="hm-search__input"
          placeholder="搜索商圈、楼盘或地址" />
        <span className="hm-search__divider" aria-hidden="true" />
        <button type="button" className="hm-search__filter-btn"
          aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)}>
          筛选
          <svg width="9" height="6" viewBox="0 0 9 6" aria-hidden="true"
            style={{ transform: open ? 'rotate(180deg)' : undefined }}>
            <path d="M1 1l3.5 3.5L8 1" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          </svg>
        </button>
        <button type="submit" className="hm-search__submit" aria-label="搜索">
          <svg width="16" height="16" viewBox="0 0 17 17" aria-hidden="true">
            <circle cx="7" cy="7" r="5.5" stroke="#fff" strokeWidth="1.7" fill="none" />
            <path d="M11.2 11.2L15.5 15.5" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {open ? (
        <div className="hm-search__panel" id={panelId}>
          <div>
            <label htmlFor={districtId} className="visually-hidden">区域</label>
            <select id={districtId} className="hm-search__select" value={district}
              onChange={(e) => setDistrict(e.target.value)}>
              <option value="">全部区域</option>
              {districts.map((d) => (
                <option key={d.slug} value={d.slug}>{d.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={typeId} className="visually-hidden">类型</label>
            <select id={typeId} className="hm-search__select" value={type}
              onChange={(e) => setType(e.target.value)}>
              {TYPE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={areaId} className="visually-hidden">面积</label>
            <select id={areaId} className="hm-search__select" value={area}
              onChange={(e) => setArea(e.target.value)}>
              {AREA_OPTIONS.map((a) => (
                <option key={a.value} value={a.value}>{a.label}</option>
              ))}
            </select>
          </div>
        </div>
      ) : null}
    </form>
  )
}
