'use client'

import { useRouter } from 'next/navigation'
import React, { useState } from 'react'

/**
 * 首页 Hero 搜索表单（F3.1）：紧凑下拉式（对齐 homepage-preview.html 首屏）
 *
 * 设计依据：plans/temporal-imagining-sonnet.md §9、demo UI（区域/类型/面积 三个
 *           下拉 + 搜索按钮，单行收起，替代原 chips 平铺）。
 *
 * 守护不变量：
 *   - 提交后跳转 /listings?<canonical>，URL 可复现条件；
 *   - 三个下拉均为「可选」：全部区域/全部类型/面积不限 时不带对应参数；
 *   - 面积区间映射到列表页的 areaMin/areaMax 数值参数（见 search-params.ts）；
 *   - 关键词搜索移至 /listings 列表页自身筛选项，首屏保持单行轻量；
 *   - 纯客户端组件，仅负责构造 URLSearchParams 并 router.push；
 *     canonical URL 解析与稳定排序在列表页 /listings 服务端完成（F3.5）。
 */

type DistrictOption = { slug: string; name: string }

type Props = {
  districts: readonly DistrictOption[]
  /** 当前城市 slug；MVP 单城市默认 shanghai */
  city?: string
}

const TYPE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: '全部类型' },
  { value: 'traditional-office', label: '传统办公' },
  { value: 'serviced-office', label: '服务式办公' },
  { value: 'coworking', label: '共享办公' },
  { value: 'full-floor', label: '整层办公' },
]

/** 面积区间；value 编码为 "<min>-<max>"，空段表示不限。 */
const AREA_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: '面积不限' },
  { value: '-100', label: '100㎡ 以下' },
  { value: '100-300', label: '100–300㎡' },
  { value: '300-500', label: '300–500㎡' },
  { value: '500-', label: '500㎡ 以上' },
]

export default function HeroSearch({ districts, city = 'shanghai' }: Props) {
  const router = useRouter()
  const [district, setDistrict] = useState('')
  const [type, setType] = useState('')
  const [area, setArea] = useState('')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const params = new URLSearchParams()
    if (district) params.set('district', district)
    if (type) params.set('type', type)
    if (area) {
      const [min, max] = area.split('-')
      if (min) params.set('areaMin', min)
      if (max) params.set('areaMax', max)
    }
    const qs = params.toString()
    router.push(qs ? `/listings?${qs}` : '/listings')
  }

  return (
    <div className="hero-search">
      <form className="hero-search__form" onSubmit={submit} role="search">
        <label htmlFor="hero-district" className="visually-hidden">区域</label>
        <select
          id="hero-district"
          name="district"
          className="hero-search__select"
          value={district}
          onChange={(e) => setDistrict(e.target.value)}
        >
          <option value="">全部区域</option>
          {districts.map((d) => (
            <option key={d.slug} value={d.slug}>{d.name}</option>
          ))}
        </select>

        <label htmlFor="hero-type" className="visually-hidden">类型</label>
        <select
          id="hero-type"
          name="type"
          className="hero-search__select"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          {TYPE_OPTIONS.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>

        <label htmlFor="hero-area" className="visually-hidden">面积</label>
        <select
          id="hero-area"
          name="area"
          className="hero-search__select"
          value={area}
          onChange={(e) => setArea(e.target.value)}
        >
          {AREA_OPTIONS.map((a) => (
            <option key={a.value} value={a.value}>{a.label}</option>
          ))}
        </select>

        <button type="submit" className="btn btn--primary">搜索</button>
      </form>

      {/* city 作为隐藏上下文锚点，便于未来多城市扩展；当前不渲染选择器 */}
      <input type="hidden" name="city" value={city} />
    </div>
  )
}
