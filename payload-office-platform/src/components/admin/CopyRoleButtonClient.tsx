'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import type { Role } from '@/payload-types'

/**
 * 角色复制按钮 - 客户端组件（tasks.md M1.5）
 *
 * 行为：
 *   - 点击后弹窗输入新角色编码（必填）和名称（可选）
 *   - 调用 POST /api/roles/:id/copy
 *   - 成功后跳转到新角色编辑页
 *
 * 安全：
 *   - 服务端 endpoint 校验 role:manage 权限
 *   - 此按钮在前端只发请求，不做权限判定
 */
export default function CopyRoleButtonClient({
  roleId,
  roleCode,
  roleName,
}: {
  roleId: Role['id']
  roleCode: string
  roleName: string
}) {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [newCode, setNewCode] = useState('')
  const [newName, setNewName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleOpen = () => {
    setNewCode('')
    setNewName('')
    setError(null)
    setIsOpen(true)
  }

  const handleClose = () => {
    if (submitting) return
    setIsOpen(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const trimmedCode = newCode.trim()
    const trimmedName = newName.trim()
    if (!trimmedCode) {
      setError('请输入新角色编码')
      return
    }
    setSubmitting(true)
    try {
      const resp = await fetch(`/api/roles/${roleId}/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: trimmedCode, name: trimmedName || undefined }),
        credentials: 'include',
      })
      const data = (await resp.json()) as { ok?: boolean; error?: string; role?: Role }
      if (!resp.ok || !data.ok || !data.role) {
        setError(data.error ?? `复制失败：HTTP ${resp.status}`)
        setSubmitting(false)
        return
      }
      // 跳转到新角色编辑页
      router.push(`/admin/collections/roles/${data.role.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误')
      setSubmitting(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        style={{
          padding: '6px 14px',
          fontSize: 13,
          fontWeight: 500,
          color: '#0b5fff',
          background: '#fff',
          border: '1px solid #0b5fff',
          borderRadius: 6,
          cursor: 'pointer',
        }}
      >
        复制角色
      </button>

      {isOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={handleClose}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff',
              padding: 24,
              borderRadius: 8,
              minWidth: 400,
              maxWidth: '90vw',
            }}
          >
            <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600 }}>
              复制角色
            </h3>
            <p style={{ margin: '0 0 12px', fontSize: 12, color: '#6b7280' }}>
              基于当前角色（{roleCode || roleName}）创建一个自定义角色副本。
              副本始终为非内置角色，权限编码会原样复制。
            </p>
            <form onSubmit={handleSubmit}>
              <label style={{ display: 'block', marginBottom: 12 }}>
                <span style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500 }}>
                  新角色编码 <span style={{ color: '#e03131' }}>*</span>
                </span>
                <input
                  type="text"
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                  placeholder="例如 CUSTOM_OPS_LITE"
                  required
                  autoFocus
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    fontSize: 13,
                    border: '1px solid #d1d5db',
                    borderRadius: 4,
                    boxSizing: 'border-box',
                  }}
                />
                <span style={{ display: 'block', marginTop: 4, fontSize: 11, color: '#9ca3af' }}>
                  大写字母开头，仅含大写字母/数字/下划线，长度 2-32
                </span>
              </label>
              <label style={{ display: 'block', marginBottom: 12 }}>
                <span style={{ display: 'block', marginBottom: 4, fontSize: 13, fontWeight: 500 }}>
                  新角色名称（可选）
                </span>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="留空将默认为「原名称 - 副本」"
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    fontSize: 13,
                    border: '1px solid #d1d5db',
                    borderRadius: 4,
                    boxSizing: 'border-box',
                  }}
                />
              </label>
              {error && (
                <div
                  style={{
                    marginBottom: 12,
                    padding: 8,
                    background: '#fff5f5',
                    border: '1px solid #ffa8a8',
                    borderRadius: 4,
                    color: '#c92a2a',
                    fontSize: 12,
                  }}
                >
                  {error}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={submitting}
                  style={{
                    padding: '6px 14px',
                    fontSize: 13,
                    background: '#f3f4f6',
                    border: '1px solid #d1d5db',
                    borderRadius: 4,
                    cursor: submitting ? 'not-allowed' : 'pointer',
                  }}
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  style={{
                    padding: '6px 14px',
                    fontSize: 13,
                    fontWeight: 500,
                    color: '#fff',
                    background: '#0b5fff',
                    border: '1px solid #0b5fff',
                    borderRadius: 4,
                    cursor: submitting ? 'not-allowed' : 'pointer',
                  }}
                >
                  {submitting ? '创建中...' : '创建副本'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
