'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Button,
  Card,
  Empty,
  Form,
  Input,
  Message,
  Select,
  Space,
  Spin,
  Typography,
} from '@arco-design/web-react'
import { useDocumentInfo } from '@payloadcms/ui'

const { Text } = Typography

/**
 * 商圈扩展面板（阶段三 Task 11）
 *
 * 内嵌在商圈（business_area）编辑页，替代「商圈管理」独立页完成空间扩展的日常配置：
 *   - boundary：GeoJSON Polygon 文本
 *   - extendedCenterLatitude / extendedCenterLongitude：扩展中心点
 *   - aliases：别名列表
 *   - metroStations：同城、已启用的既有站点多选
 *   - version：乐观锁（PATCH 时携带；并发旧页面触发 409 版本冲突）
 *
 * 读写都走 REST（GET / POST / PATCH /api/business-area-extensions），请求携带后台会话，
 * 受 access control 与 protectBusinessAreaExtension 不变量约束——「跨城/停用站点被 REST
 * 强行提交」仍由后端拒绝，本面板只是换入口，不改任何不变量与错误码。
 *
 * 新建商圈（无 id）只提示「保存后可配置空间信息」，不渲染可编辑表单。
 */
export default function BusinessAreaExtensionPanel() {
  const { id, data } = useDocumentInfo()
  const locationId = toId(id)
  const cityId = toId(data?.city)
  const isBusinessArea = data?.type === 'business_area'

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [extId, setExtId] = useState<number | null>(null)
  const [version, setVersion] = useState(1)
  const [boundaryText, setBoundaryText] = useState('')
  const [latText, setLatText] = useState('')
  const [lngText, setLngText] = useState('')
  const [aliases, setAliases] = useState<string[]>([])
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [stationOptions, setStationOptions] = useState<StationOpt[]>([])

  useEffect(() => {
    // locationId 为空时渲染层已提前返回(见下方 if (locationId == null) return)，不展示 loading，
    // 无需在此同步 setLoading(false)，避免 react-hooks/set-state-in-effect。
    if (locationId == null) return
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const extRes = await fetch(
          `/api/business-area-extensions?where[businessArea][equals]=${locationId}&limit=1&depth=0`,
        )
        const extData = await extRes.json()
        const doc = (extData?.docs?.[0] ?? null) as ExtensionDoc | null

        let opts: StationOpt[] = []
        if (cityId != null && !cancelled) {
          const stUrl = `/api/locations?where[type][equals]=metro_station&where[status][equals]=active&where[city][equals]=${cityId}&depth=0&limit=500`
          const stRes = await fetch(stUrl)
          const stData = await stRes.json()
          opts = (stData?.docs ?? []).map((s: RawNode) => ({
            id: toId(s.id) as number,
            name: String(s.name ?? ''),
            code: String(s.immutableCode ?? ''),
          }))
        }

        const selected = (doc?.metroStations ?? []).map(toId).filter((v): v is number => v != null)
        // 已被关联但之后停用的站点不在候选里，补一次按 id 取标签，避免下拉出现裸 id
        const missing = selected.filter((sid) => !opts.some((o) => o.id === sid))
        if (missing.length > 0 && !cancelled) {
          const missRes = await fetch(
            `/api/locations?where[id][in]=${missing.join(',')}&depth=0&limit=${missing.length}`,
          )
          const missData = await missRes.json()
          const extra = (missData?.docs ?? []).map((s: RawNode) => ({
            id: toId(s.id) as number,
            name: String(s.name ?? ''),
            code: String(s.immutableCode ?? ''),
          }))
          opts = [...opts, ...extra]
        }

        if (cancelled) return
        setStationOptions(opts)
        if (doc) {
          setExtId(toId(doc.id))
          setVersion(typeof doc.version === 'number' ? doc.version : 1)
          setBoundaryText(doc.boundary ? JSON.stringify(doc.boundary, null, 2) : '')
          setLatText(doc.extendedCenterLatitude != null ? String(doc.extendedCenterLatitude) : '')
          setLngText(doc.extendedCenterLongitude != null ? String(doc.extendedCenterLongitude) : '')
          setAliases(
            (doc.aliases ?? []).map((a: unknown) => {
              if (a && typeof a === 'object' && 'alias' in a) return String((a as { alias: unknown }).alias)
              return String(a)
            }),
          )
          setSelectedIds(selected)
        } else {
          setExtId(null)
          setVersion(1)
          setBoundaryText('')
          setLatText('')
          setLngText('')
          setAliases([])
          setSelectedIds([])
        }
      } catch {
        if (!cancelled) Message.error('加载商圈扩展失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [locationId, cityId])

  const handleSave = useCallback(async () => {
    let boundary: unknown = null
    const trimmed = boundaryText.trim()
    if (trimmed) {
      try {
        boundary = JSON.parse(trimmed)
      } catch {
        Message.error('边界必须是合法 JSON')
        return
      }
    }
    let lat: number | null = null
    let lng: number | null = null
    if (latText.trim() !== '' || lngText.trim() !== '') {
      lat = Number(latText)
      lng = Number(lngText)
      if (Number.isNaN(lat) || Number.isNaN(lng)) {
        Message.error('经纬度必须是数字')
        return
      }
    }

    const body = {
      boundary,
      extendedCenterLatitude: lat,
      extendedCenterLongitude: lng,
      aliases: aliases.map((a) => ({ alias: a })),
      metroStations: selectedIds,
      ...(extId != null ? { version } : { businessArea: locationId }),
    }

    setSaving(true)
    try {
      const url = extId != null ? `/api/business-area-extensions/${extId}` : '/api/business-area-extensions'
      const method = extId != null ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const resData = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = resData?.errors?.[0]?.message
        if (res.status === 409) {
          Message.error('版本冲突：该商圈扩展已被他人修改，请刷新页面后重试')
        } else {
          Message.error(msg || `保存失败（${res.status}）`)
        }
        return
      }
      const savedDoc = resData?.doc
      setExtId(toId(savedDoc?.id ?? resData?.id))
      setVersion(typeof savedDoc?.version === 'number' ? savedDoc.version : version)
      Message.success('已保存')
    } finally {
      setSaving(false)
    }
  }, [boundaryText, latText, lngText, aliases, selectedIds, extId, version, locationId])

  if (!isBusinessArea) return null

  if (locationId == null) {
    return (
      <Card title="商圈空间扩展" style={{ marginBottom: 20 }}>
        <Empty description="保存后可配置空间信息" />
      </Card>
    )
  }

  return (
    <Card title="商圈空间扩展" style={{ marginBottom: 20 }}>
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
        维护边界多边形、扩展中心点、别名与同城站点关联。保存后版本自动递增，并发的旧页面再保存会触发版本冲突。
      </Text>
      {loading ? (
        <Spin />
      ) : (
        <Form layout="vertical">
          <Form.Item
            label="边界多边形（GeoJSON Polygon）"
            extra="留空表示清除边界；外环须闭合、坐标合法且不自交。"
          >
            <Input.TextArea
              rows={6}
              value={boundaryText}
              onChange={setBoundaryText}
              placeholder={'{ "type": "Polygon", "coordinates": [[ [lng, lat], ... ]] }'}
            />
          </Form.Item>
          <Space size="large">
            <Form.Item label="扩展中心纬度（-90 ~ 90）">
              <Input value={latText} onChange={setLatText} placeholder="-90 ~ 90" style={{ width: 180 }} />
            </Form.Item>
            <Form.Item label="扩展中心经度（-180 ~ 180）">
              <Input value={lngText} onChange={setLngText} placeholder="-180 ~ 180" style={{ width: 180 }} />
            </Form.Item>
          </Space>
          <Form.Item label="别名" extra="单项 1–50 字，自动去首尾空格并去重。">
            {aliases.map((a, i) => (
              <Space key={i} style={{ display: 'flex', marginBottom: 8 }}>
                <Input
                  value={a}
                  onChange={(v) => {
                    const next = [...aliases]
                    next[i] = v
                    setAliases(next)
                  }}
                  style={{ width: 260 }}
                />
                <Button
                  size="small"
                  status="danger"
                  onClick={() => setAliases(aliases.filter((_, j) => j !== i))}
                >
                  删除
                </Button>
              </Space>
            ))}
            <Button size="small" onClick={() => setAliases([...aliases, ''])}>
              + 添加别名
            </Button>
          </Form.Item>
          <Form.Item label="关联站点（同城、已启用）" extra="仅可选择与商圈同城且已启用的既有地铁站。">
            <Select
              mode="multiple"
              showSearch
              filterOption={false}
              style={{ width: 420 }}
              placeholder="选择同城站点"
              value={selectedIds}
              onChange={(v) => setSelectedIds(v as number[])}
              options={stationOptions.map((o) => ({ label: `${o.name}（${o.code}）`, value: o.id }))}
            />
          </Form.Item>
          <Space>
            <Button type="primary" loading={saving} onClick={handleSave}>
              {extId != null ? '保存更新' : '创建扩展'}
            </Button>
            {extId != null && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                版本 v{version}
              </Text>
            )}
          </Space>
        </Form>
      )}
    </Card>
  )
}

type StationOpt = { id: number; name: string; code: string }

type RawNode = { id: unknown; name?: unknown; immutableCode?: unknown }

type ExtensionDoc = {
  id: unknown
  version?: unknown
  boundary?: unknown
  extendedCenterLatitude?: unknown
  extendedCenterLongitude?: unknown
  aliases?: unknown[]
  metroStations?: unknown[]
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