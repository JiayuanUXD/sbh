'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Button,
  Card,
  Empty,
  Input,
  Message,
  Space,
  Spin,
  Switch,
  Tag,
  Typography,
} from '@arco-design/web-react'
import { IconDragDotVertical, IconPlus } from '@arco-design/web-react/icon'
import { useDocumentInfo } from '@payloadcms/ui'

const { Text } = Typography

type Station = {
  id: number
  name: string
  immutableCode: string
  status: 'active' | 'disabled'
  sortOrder: number
  version: number
}

/** 单站最近一次写操作的结果；用于明确逐条反馈，避免静默部分成功 */
type RowResult = { ok: boolean; msg?: string }

/** 拉取某线路全部站点（按 sortOrder 升序），供面板展示 / 新增后刷新 */
async function fetchLineStations(lineId: number): Promise<Station[]> {
  const url = `/api/locations?where[parent][equals]=${lineId}&where[type][equals]=metro_station&sort=sortOrder&depth=0&limit=500`
  const res = await fetch(url)
  const data = await res.json()
  return (data?.docs ?? []).map((x: { id?: unknown; name?: unknown; immutableCode?: unknown; status?: unknown; sortOrder?: unknown; version?: unknown }) => ({
    id: toId(x.id) as number,
    name: String(x.name ?? ''),
    immutableCode: String(x.immutableCode ?? ''),
    status: x.status === 'disabled' ? 'disabled' : 'active',
    sortOrder: typeof x.sortOrder === 'number' ? x.sortOrder : 100,
    version: typeof x.version === 'number' ? x.version : 1,
  }))
}

/**
 * 地铁线路的站点内嵌面板（阶段三 Task 12）
 *
 * 内嵌在地铁线路（metro_line）编辑页，完成线路站点的日常维护：
 *   - 列出该线路全部站点（按 sortOrder）
 *   - 拖拽排序：保存时逐条串行 PATCH 各站 sortOrder（每条都过 protectLocation hook）
 *   - 快速新增站点：只填名称 + 区域代码，parent/city/type 自动带上
 *   - 单站启停
 *
 * 读写走 REST，请求携带后台会话，受 access control 与 protectLocation 不变量约束。
 * 批量排序保存逐条串行，任一条失败都会在对应行上给出明确反馈，不静默部分成功。
 */
export default function MetroLineStationsPanel() {
  const { id, data } = useDocumentInfo()
  const lineId = toId(id)
  const isLine = data?.type === 'metro_line'

  const [loading, setLoading] = useState(true)
  const [stations, setStations] = useState<Station[]>([])
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [savingOrder, setSavingOrder] = useState(false)
  const [results, setResults] = useState<Record<number, RowResult>>({})
  const [newName, setNewName] = useState('')
  const [newCode, setNewCode] = useState('')
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    if (lineId == null) {
      setLoading(false)
      return
    }
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const list = await fetchLineStations(lineId as number)
        if (cancelled) return
        setStations(list)
        setResults({})
      } catch {
        if (!cancelled) Message.error('加载线路站点失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [lineId])

  const handleDrop = useCallback(
    (targetIndex: number) => {
      if (dragIndex === null || dragIndex === targetIndex) return
      setStations((prev) => {
        const next = [...prev]
        const [moved] = next.splice(dragIndex, 1)
        next.splice(targetIndex, 0, moved)
        return next
      })
      setDragIndex(null)
      setResults({})
    },
    [dragIndex],
  )

  // 保存排序：逐条串行 PATCH sortOrder，每条都过 protectLocation；失败逐条反馈
  const handleSaveOrder = useCallback(async () => {
    if (stations.length === 0) return
    setSavingOrder(true)
    const nextResults: Record<number, RowResult> = {}
    let failed = 0
    for (let i = 0; i < stations.length; i++) {
      const s = stations[i]
      const target = (i + 1) * 10
      if (s.sortOrder === target) {
        nextResults[s.id] = { ok: true }
        continue
      }
      try {
        const res = await fetch(`/api/locations/${s.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sortOrder: target, version: s.version }),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(body?.errors?.[0]?.message || `HTTP ${res.status}`)
        nextResults[s.id] = { ok: true }
        setStations((prev) =>
          prev.map((st) =>
            st.id === s.id
              ? {
                  ...st,
                  sortOrder: target,
                  version: typeof body?.doc?.version === 'number' ? body.doc.version : st.version,
                }
              : st,
          ),
        )
      } catch (e) {
        failed++
        nextResults[s.id] = { ok: false, msg: e instanceof Error ? e.message : String(e) }
      }
    }
    setResults(nextResults)
    setSavingOrder(false)
    if (failed === 0) Message.success('排序已保存')
    else Message.error(`${failed} 条站点排序保存失败，请查看逐条结果`)
  }, [stations])

  const handleToggle = useCallback(async (s: Station) => {
    const nextStatus = s.status === 'active' ? 'disabled' : 'active'
    try {
      const res = await fetch(`/api/locations/${s.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus, version: s.version }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.errors?.[0]?.message || `HTTP ${res.status}`)
      setStations((prev) =>
        prev.map((st) =>
          st.id === s.id
            ? {
                ...st,
                status: nextStatus,
                version: typeof body?.doc?.version === 'number' ? body.doc.version : st.version,
              }
            : st,
        ),
      )
      Message.success(nextStatus === 'active' ? '已启用' : '已停用')
    } catch (e) {
      Message.error(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const handleAdd = useCallback(async () => {
    const name = newName.trim()
    const code = newCode.trim()
    if (!name || !code) {
      Message.error('请填写站点名称与区域代码')
      return
    }
    setAdding(true)
    try {
      const res = await fetch('/api/locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          immutableCode: code,
          slug: `metro-${code.toLowerCase()}`,
          type: 'metro_station',
          parent: lineId,
          status: 'active',
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.errors?.[0]?.message || `HTTP ${res.status}`)
      setNewName('')
      setNewCode('')
      setStations(await fetchLineStations(lineId as number))
      setResults({})
      Message.success('站点已创建')
    } catch (e) {
      Message.error(e instanceof Error ? e.message : String(e))
    } finally {
      setAdding(false)
    }
  }, [newName, newCode, lineId])

  if (!isLine) return null
  if (lineId == null) return null

  return (
    <Card title="线路站点" style={{ marginBottom: 20 }}>
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
        拖拽排序后点「保存排序」逐条写入；新增站点仅需名称与区域代码，所属线路、城市与类型自动写入。
      </Text>
      {loading ? (
        <Spin />
      ) : (
        <>
          {stations.length === 0 ? (
            <Empty description="该线路暂无站点，可在下方快速新增" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {stations.map((s, index) => (
                <div
                  key={s.id}
                  draggable
                  onDragStart={() => setDragIndex(index)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleDrop(index)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '8px 12px',
                    border: '1px solid #e5e6eb',
                    borderRadius: 8,
                    background: '#fff',
                  }}
                >
                  <IconDragDotVertical style={{ cursor: 'grab', color: '#86909c', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Space>
                      <Text style={{ fontWeight: 500 }}>{s.name}</Text>
                      <Tag size="small" color={s.status === 'active' ? 'green' : 'gray'}>
                        {s.status === 'active' ? '启用' : '停用'}
                      </Tag>
                    </Space>
                    <div>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {s.immutableCode}
                      </Text>
                    </div>
                  </div>
                  <Space>
                    <Switch size="small" checked={s.status === 'active'} onChange={() => handleToggle(s)} />
                    {results[s.id] &&
                      (results[s.id].ok ? (
                        <Text style={{ color: '#00b42a', fontSize: 12 }}>已保存</Text>
                      ) : (
                        <Text style={{ color: '#f53f3f', fontSize: 12 }}>失败：{results[s.id].msg}</Text>
                      ))}
                  </Space>
                </div>
              ))}
            </div>
          )}
          <Space style={{ marginTop: 12 }}>
            <Button
              type="primary"
              loading={savingOrder}
              disabled={stations.length === 0}
              onClick={handleSaveOrder}
            >
              保存排序
            </Button>
          </Space>
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #e5e6eb' }}>
            <Text style={{ fontWeight: 500 }}>快速新增站点</Text>
            <Space style={{ marginTop: 8 }}>
              <Input placeholder="站点名称" value={newName} onChange={setNewName} style={{ width: 200 }} />
              <Input
                placeholder="区域代码（大写字母/数字开头，2–64 位）"
                value={newCode}
                onChange={setNewCode}
                style={{ width: 240 }}
              />
              <Button type="primary" icon={<IconPlus />} loading={adding} onClick={handleAdd}>
                新增
              </Button>
            </Space>
          </div>
        </>
      )}
    </Card>
  )
}

/** relationship 值可能是 id 或已 populate 的对象；统一取出数字 id，取不到返回 null */
function toId(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  if (typeof value === 'object' && 'id' in value) return toId((value as { id: unknown }).id)
  return null
}