'use client'
import { useRouter, useSearchParams } from 'next/navigation'
import React, { useState } from 'react'

type Props = { districts: { id: string | number; slug: string; name: string }[] }

export default function FilterBar({ districts }: Props) {
  const router = useRouter()
  const sp = useSearchParams()
  const [q, setQ] = useState(sp.get('q') || '')
  const [district, setDistrict] = useState(sp.get('district') || '')
  const [type, setType] = useState(sp.get('type') || '')
  const [rentMin, setRentMin] = useState(sp.get('rentMin') || '')
  const [rentMax, setRentMax] = useState(sp.get('rentMax') || '')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (district) params.set('district', district)
    if (type) params.set('type', type)
    if (rentMin) params.set('rentMin', rentMin)
    if (rentMax) params.set('rentMax', rentMax)
    router.push(`/listings?${params.toString()}`)
  }

  function reset() {
    setQ(''); setDistrict(''); setType(''); setRentMin(''); setRentMax('')
    router.push('/listings')
  }

  return (
    <form className="filter-bar" onSubmit={submit}>
      <div className="filter-bar__field">
        <label className="filter-bar__label">关键词</label>
        <input className="filter-bar__input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="如：江景、整层" />
      </div>
      <div className="filter-bar__field">
        <label className="filter-bar__label">区域</label>
        <select className="filter-bar__select" value={district} onChange={(e) => setDistrict(e.target.value)}>
          <option value="">全部</option>
          {districts.map((d) => <option key={d.id} value={d.slug}>{d.name}</option>)}
        </select>
      </div>
      <div className="filter-bar__field">
        <label className="filter-bar__label">类型</label>
        <select className="filter-bar__select" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">全部</option>
          <option value="traditional-office">传统办公</option>
          <option value="serviced-office">服务式办公</option>
          <option value="coworking">共享办公</option>
          <option value="full-floor">整层办公</option>
        </select>
      </div>
      <div className="filter-bar__field">
        <label className="filter-bar__label">租金(元)</label>
        <div style={{ display: 'flex', gap: 6 }}>
          <input className="filter-bar__input" value={rentMin} onChange={(e) => setRentMin(e.target.value)} placeholder="最低" style={{ width: 80 }} />
          <input className="filter-bar__input" value={rentMax} onChange={(e) => setRentMax(e.target.value)} placeholder="最高" style={{ width: 80 }} />
        </div>
      </div>
      <button type="submit" className="btn btn--primary">筛选</button>
      <button type="button" className="btn btn--ghost" onClick={reset}>重置</button>
    </form>
  )
}
