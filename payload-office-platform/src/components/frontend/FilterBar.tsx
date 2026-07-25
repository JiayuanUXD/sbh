'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import React, { useState } from 'react'

/**
 * 列表页桌面筛选条（F3.3）
 *
 * 设计依据：specs/frontend-mvp/design.md §7.1、§7.4
 *           Page PRD: FP-02 §3
 *
 * 守护不变量：
 *   - 提交后跳转 /listings?<canonical>，URL 可复现条件；
 *   - 租金排序选定 rent-asc/rent-desc 时强制要求 rentUnit（或回退到 recommended）；
 *   - 数值字段做最小校验（rentMin ≤ rentMax、areaMin ≤ areaMax）；
 *   - 不直接拼 Payload where（由 Facade 在服务端处理）；
 *   - 移动端筛选抽屉在 F3.4 实现，本组件仅服务桌面端；
 *   - 提交后页码重置为 1（避免越界）。
 */

type District = { id: string | number; slug: string; name: string }

type Props = {
  districts: readonly District[]
  /** 当前 rentUnit 选择（用于回填） */
  initialRentUnit?: string
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

export default function FilterBar({ districts }: Props) {
  const router = useRouter()
  const sp = useSearchParams()

  const [q, setQ] = useState(sp.get('q') || '')
  const [district, setDistrict] = useState(sp.get('district') || '')
  const [type, setType] = useState(sp.get('type') || '')
  const [rentMin, setRentMin] = useState(sp.get('rentMin') || '')
  const [rentMax, setRentMax] = useState(sp.get('rentMax') || '')
  const [rentUnit, setRentUnit] = useState(sp.get('rentUnit') || '')
  const [areaMin, setAreaMin] = useState(sp.get('areaMin') || '')
  const [areaMax, setAreaMax] = useState(sp.get('areaMax') || '')
  const [availableBefore, setAvailableBefore] = useState(sp.get('availableBefore') || '')
  const [sort, setSort] = useState(sp.get('sort') || 'recommended')
  const [error, setError] = useState<string | null>(null)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const params = new URLSearchParams()

    // 数值字段校验
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

    // 价格排序与 rentUnit 一致性（design.md §7.4）
    let finalSort = sort
    if ((sort === 'rent-asc' || sort === 'rent-desc') && !rentUnit) {
      // 缺少 rentUnit 时回退为 recommended，避免跨单位排序
      finalSort = 'recommended'
    }

    setError(null)

    const qNormalized = q.trim().slice(0, 60)
    if (qNormalized) params.set('q', qNormalized)
    if (district) params.set('district', district)
    if (type) params.set('type', type)
    if (rentMinN != null) params.set('rentMin', String(rentMinN))
    if (rentMaxN != null) params.set('rentMax', String(rentMaxN))
    if (rentUnit) params.set('rentUnit', rentUnit)
    if (areaMinN != null) params.set('areaMin', String(areaMinN))
    if (areaMaxN != null) params.set('areaMax', String(areaMaxN))
    if (availableBefore) params.set('availableBefore', availableBefore)
    if (finalSort && finalSort !== 'recommended') params.set('sort', finalSort)

    // 提交后页码重置为 1
    const qs = params.toString()
    router.push(qs ? `/listings?${qs}` : '/listings')
  }

  function reset() {
    setQ('')
    setDistrict('')
    setType('')
    setRentMin('')
    setRentMax('')
    setRentUnit('')
    setAreaMin('')
    setAreaMax('')
    setAvailableBefore('')
    setSort('recommended')
    setError(null)
    router.push('/listings')
  }

  const isPriceSort = sort === 'rent-asc' || sort === 'rent-desc'

  return (
    <form className="filter-bar" onSubmit={submit}>
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
        <label className="filter-bar__label" htmlFor="fb-district">区域</label>
        <select
          id="fb-district"
          className="filter-bar__select"
          value={district}
          onChange={(e) => setDistrict(e.target.value)}
        >
          <option value="">全部</option>
          {districts.map((d) => (
            <option key={d.id} value={d.slug}>{d.name}</option>
          ))}
        </select>
      </div>

      <div className="filter-bar__field">
        <label className="filter-bar__label" htmlFor="fb-type">类型</label>
        <select
          id="fb-type"
          className="filter-bar__select"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="">全部</option>
          {TYPE_OPTIONS.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

      <div className="filter-bar__field">
        <label className="filter-bar__label" htmlFor="fb-rent-unit">租金单位</label>
        <select
          id="fb-rent-unit"
          className="filter-bar__select"
          value={rentUnit}
          onChange={(e) => setRentUnit(e.target.value)}
          aria-describedby={isPriceSort && !rentUnit ? 'fb-rent-unit-hint' : undefined}
        >
          <option value="">不限</option>
          {RENT_UNIT_OPTIONS.map((u) => (
            <option key={u.value} value={u.value}>{u.label}</option>
          ))}
        </select>
        {isPriceSort && !rentUnit && (
          <span id="fb-rent-unit-hint" className="filter-bar__hint filter-bar__hint--warn">
            价格排序需选定单位
          </span>
        )}
      </div>

      <div className="filter-bar__field">
        <label className="filter-bar__label">租金（元）</label>
        <div className="filter-bar__rent-group">
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
        <div className="filter-bar__rent-group">
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
        <label className="filter-bar__label" htmlFor="fb-available">可入驻时间</label>
        <input
          id="fb-available"
          type="date"
          className="filter-bar__input"
          value={availableBefore}
          onChange={(e) => setAvailableBefore(e.target.value)}
          aria-label="可入驻时间上限"
        />
      </div>

      <div className="filter-bar__field">
        <label className="filter-bar__label" htmlFor="fb-sort">排序</label>
        <select
          id="fb-sort"
          className="filter-bar__select"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          {SORT_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      {error && (
        <p className="filter-bar__error" role="alert">{error}</p>
      )}

      <button type="submit" className="btn btn--primary">筛选</button>
      <button type="button" className="btn btn--ghost" onClick={reset}>重置</button>
    </form>
  )
}
