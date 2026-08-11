'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Message,
  Select,
  Space,
  Switch,
  Typography,
} from '@arco-design/web-react'

import type { LocationType } from '@/domain/geography/location-hierarchy'

const STATUS_OPTIONS = [
  { label: '启用', value: 'active' },
  { label: '停用', value: 'disabled' },
]

export type GeographyCreateViewClientProps = {
  moduleType: LocationType
  title: string
  createLabel: string
  /** 新建时固定的节点类型（创建后不可改），隐藏字段随提交 */
  fixedType: LocationType
  parentFilter: 'city' | 'district'
  parentOptions: { id: number; name: string }[]
  prefilledParentId: string | null
  cityId: string | null
}

/** 提交出错的业务文案（REST create 错误形状 { errors: [{ message }] }） */
type CreateError = { errors?: Array<{ message?: string }> }

/**
 * 地理模块「新建」轻量表单（计划 Task 8）
 *
 * 预填 type 与父级（由 /new 的 query params 携带），提交走 REST /api/locations
 * （过 protectLocation hook → city 由 hook 自动填对），成功后跳 Payload 编辑页。
 */
export default function GeographyCreateViewClient({
  moduleType,
  title,
  createLabel,
  fixedType,
  parentFilter,
  parentOptions,
  prefilledParentId,
  cityId,
}: GeographyCreateViewClientProps) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [immutableCode, setImmutableCode] = useState('')
  const [slug, setSlug] = useState('')
  const [parentId, setParentId] = useState<string | undefined>(
    prefilledParentId ?? undefined,
  )
  const [status, setStatus] = useState<'active' | 'disabled'>('active')
  const [frontendVisible, setFrontendVisible] = useState(false)
  const [sortOrder, setSortOrder] = useState(100)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!name.trim() || !immutableCode.trim() || !slug.trim()) {
      setError('名称、区域代码、URL 标识均为必填')
      return
    }
    if (!parentId) {
      setError('请选择上级区域')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/locations', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: fixedType,
          name: name.trim(),
          immutableCode: immutableCode.trim(),
          slug: slug.trim(),
          parent: Number(parentId),
          status,
          frontendVisible,
          sortOrder,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        doc?: { id?: number }
        errors?: Array<{ message?: string }>
      }
      if (!res.ok || !data.doc) {
        setError(data.errors?.[0]?.message || `创建失败（HTTP ${res.status}）`)
        return
      }
      Message.success('已创建')
      // 跳 Payload 原生编辑页，后续配置（封面/坐标/扩展）在编辑页完成
      window.location.href = `/admin/collections/locations/${data.doc.id}`
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络异常，创建失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 640 }}>
      <Typography.Title heading={5} style={{ marginTop: 0 }}>
        新建{moduleType === 'metro_line' ? '地铁' : '行政'}节点
      </Typography.Title>
      <Typography.Text type="secondary" style={{ fontSize: 13 }}>
        {createLabel} · {title} · 保存后仍可在编辑页补充坐标 / 封面等
      </Typography.Text>

      <Card style={{ marginTop: 16 }}>
        <Form layout="vertical">
          <Form.Item label="上级区域" required>
            <Select
              showSearch
              placeholder={parentFilter === 'city' ? '选择所属城市' : '选择所属行政区'}
              value={parentId}
              onChange={(v) => setParentId(v as string | undefined)}
              options={parentOptions.map((p) => ({ label: p.name, value: String(p.id) }))}
              filterOption={false}
            />
          </Form.Item>
          <Form.Item label="名称" required>
            <Input
              value={name}
              onChange={setName}
              placeholder="如：长宁"
            />
          </Form.Item>
          <Form.Item label="区域代码" required>
            <Input
              value={immutableCode}
              onChange={setImmutableCode}
              placeholder="全局唯一，如 SH-CHANGNING"
            />
          </Form.Item>
          <Form.Item label="URL 标识" required>
            <Input
              value={slug}
              onChange={setSlug}
              placeholder="全局唯一，如 changning"
            />
          </Form.Item>
          <Form.Item label="状态">
            <Select
              value={status}
              onChange={(v) => setStatus(v as 'active' | 'disabled')}
              options={STATUS_OPTIONS}
              style={{ width: 160 }}
            />
          </Form.Item>
          <Form.Item label="前台可见">
            <Switch
              checked={frontendVisible}
              onChange={setFrontendVisible}
            />
          </Form.Item>
          <Form.Item label="排序">
            <InputNumber
              value={sortOrder}
              min={0}
              onChange={(v) => setSortOrder(typeof v === 'number' ? v : 0)}
            />
          </Form.Item>
          {error ? (
            <Typography.Text type="error" style={{ display: 'block', marginBottom: 8 }}>
              {error}
            </Typography.Text>
          ) : null}
          <Space>
            <Button type="primary" loading={saving} onClick={submit}>
              创建
            </Button>
            <Button onClick={() => router.back()}>取消</Button>
          </Space>
        </Form>
      </Card>
    </div>
  )
}