'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import React, { useState } from 'react'

/**
 * 列表页筛选条（标签按钮式，参考阿里商办）
 *
 * 守护不变量：
 *   - 区域/类型/排序/单位/快速筛选：点击即导航（Link），URL 可复现条件；
 *   - 数值字段（关键词/租金/面积/可入驻）：表单提交，提交后页码重置为 1；
 *   - 租金排序选定 rent-asc/rent-desc 时提示选定单位（后端缺 rentUnit 回退 recommended）；
 *   - 数值字段做最小校验（rentMin ≤ rentMax、areaMin ≤ areaMax）。
 */

type District = { id: string | number; slug: string; name: string }

type Props = {
  districts: readonly District[]
}

const TYPE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'traditional-office', label: '传统办公' },
  { value: 'serviced-office', label: '服务式办公' },
  { value: 'coworking', label: '共享办公' },
  { value: 'full-floor', label: '整层办公' },
]

const RENT_UNIT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'rmb-month', label: '元/月' },
  { value: 'rmb-sqm-day', label: '元/㎡/天' },
  { value: 'rmb-seat-month', label: '元/工位/月' },
]

const SORT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'recommended', label: '推荐' },
  { value: 'newest', label: '最新' },
  { value: 'rent-asc', label: '价格升序' },
  { value: 'rent-desc', label: '价格降序' },
]

/** 数值字段规范化：去除非数字、范围夹逼 */
function toIntOrNull(v: string): number | null {
  if (!v.trim()) return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** 基于当前 searchParams 构造新 URL（切换筛选时重置页码） */
function buildHref(sp: URLSearchParams, updates: Record<string, string | null>): string {
  const next = new URLSearchParams(sp)
  for (const [k, v] of Object.entries(updates)) {
    if (v === null || v === '') next.delete(k)
    else next.set(k, v)
  }
  next.delete('page')
  const qs = next.toString()
  return qs ? `/listings?${qs}` : '/listings'
}

/** toggle：全部参数已匹配则清除，否则设置 */
function toggleHref(sp: URLSearchParams, updates: Record<string, string>): string {
  const allMatch = Object.entries(updates).every(([k, v]) => sp.get(k) === v)
  const next = new URLSearchParams(sp)
  for (const [k] of Object.entries(updates)) {
    if (allMatch) next.delete(k)
  }
  if (!allMatch) {
    for (const [k, v] of Object.entries(updates)) next.set(k, v)
  }
  next.delete('page')
  const qs = next.toString()
  return qs ? `/listings?${qs}` : '/listings'
}

export default function FilterBar({ districts }: Props) {
  const sp = useSearchParams()
  const router = useRouter()

  const district = sp.get('district') || ''
  const type = sp.get('type') || ''
  const sort = sp.get('sort') || 'recommended'
  const rentUnit = sp.get('rentUnit') || ''

  const [q, setQ] = useState(sp.get('q') || '')
  const [rentMin, setRentMin] = useState(sp.get('rentMin') || '')
  const [rentMax, setRentMax] = useState(sp.get('rentMax') || '')
  const [areaMin, setAreaMin] = useState(sp.get('areaMin') || '')
  const [areaMax, setAreaMax] = useState(sp.get('areaMax') || '')
  const [availableBefore, setAvailableBefore] = useState(sp.get('availableBefore') || '')
  const [error, setError] = useState<string | null>(null)

  const isPriceSort = sort === 'rent-asc' || sort === 'rent-desc'
  const qMatches = (val: string) => sp.get('q') === val

  // 高级筛选（快速筛选 + 数值字段）默认收起，结果优先；
  // 有任一高级条件生效时默认展开，并显示生效数量徽标
  const ADVANCED_KEYS = ['q', 'rentMin', 'rentMax', 'areaMin', 'areaMax', 'availableBefore'] as const
  const activeAdvancedCount = ADVANCED_KEYS.filter((k) => sp.get(k)).length
  const [showAdvanced, setShowAdvanced] = useState(activeAdvancedCount > 0)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const rentMinN = toIntOrNull(rentMin)
    const rentMaxN = toIntOrNull(rentMax)
    const areaMinN = toIntOrNull(areaMin)
    const areaMaxN = toIntOrNull(areaMax)

    if (rentMinN != null && rentMaxN != null && rentMinN > rentMaxN) {
      setError('租金最低不能高于最高')
      return
    }
    if (areaMinN != null && areaMaxN != null && areaMinN > areaMaxN) {
      setError('面积最低不能高于最高')
      return
    }

    setError(null)

    const params = new URLSearchParams(sp)
    params.delete('q')
    params.delete('rentMin')
    params.delete('rentMax')
    params.delete('areaMin')
    params.delete('areaMax')
    params.delete('availableBefore')

    const qNormalized = q.trim().slice(0, 60)
    if (qNormalized) params.set('q', qNormalized)
    if (rentMinN != null) params.set('rentMin', String(rentMinN))
    if (rentMaxN != null) params.set('rentMax', String(rentMaxN))
    if (areaMinN != null) params.set('areaMin', String(areaMinN))
    if (areaMaxN != null) params.set('areaMax', String(areaMaxN))
    if (availableBefore) params.set('availableBefore', availableBefore)

    params.delete('page')

    const qs = params.toString()
    router.push(qs ? `/listings?${qs}` : '/listings')
  }

  return (
    <div className="filter-bar">
      {/* 排序 + 单位（相邻，价格排序时需选定单位） */}
      <div className="filter-bar__row">
        <span className="filter-bar__row-label">排序</span>
        <div className="filter-bar__chips">
          {SORT_OPTIONS.map((s) => (
            <Link
              key={s.value}
              className={`filter-chip${sort === s.value ? ' is-active' : ''}`}
              href={buildHref(sp, { sort: s.value === 'recommended' ? null : s.value })}
            >
              {s.label}
            </Link>
          ))}
        </div>
        <span className="filter-bar__row-label filter-bar__row-label--unit">单位</span>
        <div className="filter-bar__chips">
          <Link
            className={`filter-chip${!rentUnit ? ' is-active' : ''}`}
            href={buildHref(sp, { rentUnit: null })}
          >
            不限
          </Link>
          {RENT_UNIT_OPTIONS.map((u) => (
            <Link
              key={u.value}
              className={`filter-chip${rentUnit === u.value ? ' is-active' : ''}`}
              href={buildHref(sp, { rentUnit: u.value })}
            >
              {u.label}
            </Link>
          ))}
        </div>
        {isPriceSort && !rentUnit && (
          <span className="filter-bar__hint filter-bar__hint--warn">价格排序需选定单位</span>
        )}
      </div>

      {/* 区域 */}
      <div className="filter-bar__row">
        <span className="filter-bar__row-label">区域</span>
        <div className="filter-bar__chips">
          <Link
            className={`filter-chip${!district ? ' is-active' : ''}`}
            href={buildHref(sp, { district: null })}
          >
            全部
          </Link>
          {districts.map((d) => (
            <Link
              key={d.id}
              className={`filter-chip${district === d.slug ? ' is-active' : ''}`}
              href={buildHref(sp, { district: d.slug })}
            >
              {d.name}
            </Link>
          ))}
        </div>
      </div>

      {/* 类型 */}
      <div className="filter-bar__row">
        <span className="filter-bar__row-label">类型</span>
        <div className="filter-bar__chips">
          <Link
            className={`filter-chip${!type ? ' is-active' : ''}`}
            href={buildHref(sp, { type: null })}
          >
            全部
          </Link>
          {TYPE_OPTIONS.map((t) => (
            <Link
              key={t.value}
              className={`filter-chip${type === t.value ? ' is-active' : ''}`}
              href={buildHref(sp, { type: t.value })}
            >
              {t.label}
            </Link>
          ))}
        </div>
      </div>

      {/* 更多筛选开关 */}
      <button
        type="button"
        className="filter-bar__more"
        aria-expanded={showAdvanced}
        aria-controls="filter-bar-advanced"
        onClick={() => setShowAdvanced((v) => !v)}
      >
        {showAdvanced ? '收起筛选' : '更多筛选'}
        {activeAdvancedCount > 0 && (
          <span className="filter-bar__more-count" aria-label={`${activeAdvancedCount} 个条件生效中`}>
            {activeAdvancedCount}
          </span>
        )}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`filter-bar__more-chevron${showAdvanced ? ' is-open' : ''}`}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      <div id="filter-bar-advanced" className="filter-bar__advanced" hidden={!showAdvanced}>
      {/* 快速筛选 */}
      <div className="filter-bar__row">
        <span className="filter-bar__row-label">快速筛选</span>
        <div className="filter-bar__chips">
          <Link
            className={`filter-chip${qMatches('地铁') ? ' is-active' : ''}`}
            href={toggleHref(sp, { q: '地铁' })}
          >
            近地铁
          </Link>
          <Link
            className={`filter-chip${qMatches('精装修') ? ' is-active' : ''}`}
            href={toggleHref(sp, { q: '精装修' })}
          >
            精装修
          </Link>
          <Link
            className={`filter-chip${sp.get('rentMax') === '3' && sp.get('rentUnit') === 'rmb-sqm-day' ? ' is-active' : ''}`}
            href={toggleHref(sp, { rentMax: '3', rentUnit: 'rmb-sqm-day' })}
          >
            ≤3元/㎡/天
          </Link>
          <Link
            className={`filter-chip${sp.get('areaMax') === '100' ? ' is-active' : ''}`}
            href={toggleHref(sp, { areaMax: '100' })}
          >
            ≤100㎡
          </Link>
        </div>
      </div>

      {/* 数值字段（表单提交） */}
      <form className="filter-bar__form" onSubmit={submit}>
        <div className="filter-bar__field">
          <label className="filter-bar__label" htmlFor="fb-q">关键词</label>
          <input
            id="fb-q"
            className="filter-bar__input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="如：江景、整层"
            maxLength={60}
          />
        </div>
        <div className="filter-bar__field">
          <label className="filter-bar__label">租金（元）</label>
          <div className="filter-bar__range">
            <input
              className="filter-bar__input"
              value={rentMin}
              onChange={(e) => setRentMin(e.target.value)}
              placeholder="最低"
              inputMode="numeric"
              aria-label="租金最低"
            />
            <span aria-hidden="true">–</span>
            <input
              className="filter-bar__input"
              value={rentMax}
              onChange={(e) => setRentMax(e.target.value)}
              placeholder="最高"
              inputMode="numeric"
              aria-label="租金最高"
            />
          </div>
        </div>
        <div className="filter-bar__field">
          <label className="filter-bar__label">面积（㎡）</label>
          <div className="filter-bar__range">
            <input
              className="filter-bar__input"
              value={areaMin}
              onChange={(e) => setAreaMin(e.target.value)}
              placeholder="最低"
              inputMode="numeric"
              aria-label="面积最低"
            />
            <span aria-hidden="true">–</span>
            <input
              className="filter-bar__input"
              value={areaMax}
              onChange={(e) => setAreaMax(e.target.value)}
              placeholder="最高"
              inputMode="numeric"
              aria-label="面积最高"
            />
          </div>
        </div>
        <div className="filter-bar__field">
          <label className="filter-bar__label" htmlFor="fb-available">可入驻</label>
          <input
            id="fb-available"
            type="date"
            className="filter-bar__input"
            value={availableBefore}
            onChange={(e) => setAvailableBefore(e.target.value)}
            aria-label="可入驻时间上限"
          />
        </div>
        {error && (
          <p className="filter-bar__error" role="alert">{error}</p>
        )}
        <button type="submit" className="btn btn--primary">筛选</button>
        <Link href="/listings" className="btn btn--ghost">重置</Link>
      </form>
      </div>
    </div>
  )
}
