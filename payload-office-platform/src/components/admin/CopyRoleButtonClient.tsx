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
        className="copy-role-btn"
      >
        复制角色
      </button>

      {isOpen && (
        <div className="copy-role-overlay" onClick={handleClose}>
          <div className="copy-role-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="copy-role-modal__title">复制角色</h3>
            <p className="copy-role-modal__desc">
              基于当前角色（{roleCode || roleName}）创建一个自定义角色副本。
              副本始终为非内置角色，权限编码会原样复制。
            </p>
            <form onSubmit={handleSubmit}>
              <label className="copy-role-modal__field">
                <span className="copy-role-modal__label">
                  新角色编码 <span className="copy-role-modal__required">*</span>
                </span>
                <input
                  type="text"
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                  placeholder="例如 CUSTOM_OPS_LITE"
                  required
                  autoFocus
                  className="copy-role-modal__input"
                />
                <span className="copy-role-modal__hint">
                  大写字母开头，仅含大写字母/数字/下划线，长度 2-32
                </span>
              </label>
              <label className="copy-role-modal__field">
                <span className="copy-role-modal__label">
                  新角色名称（可选）
                </span>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="留空将默认为「原名称 - 副本」"
                  className="copy-role-modal__input"
                />
              </label>
              {error && (
                <div className="copy-role-modal__error">{error}</div>
              )}
              <div className="copy-role-modal__actions">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={submitting}
                  className="copy-role-modal__btn copy-role-modal__btn--cancel"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="copy-role-modal__btn copy-role-modal__btn--confirm"
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
