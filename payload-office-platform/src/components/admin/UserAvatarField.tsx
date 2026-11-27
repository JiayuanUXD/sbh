'use client'

import React, { useEffect, useId, useRef, useState } from 'react'
import {
  FieldDescription,
  FieldLabel,
  useField,
  useFormFields,
} from '@payloadcms/ui'
import type { UploadFieldClientProps } from 'payload'

type AvatarValue = number | string | { id?: number | string; url?: string; sizes?: { thumb?: { url?: string } } } | null

function extractMediaId(value: AvatarValue | undefined): number | string | null {
  if (typeof value === 'number' || typeof value === 'string') return value
  if (value && typeof value === 'object' && (typeof value.id === 'number' || typeof value.id === 'string')) {
    return value.id
  }
  return null
}

function extractMediaUrl(value: AvatarValue | undefined): string | null {
  if (!value || typeof value !== 'object') return null
  const thumb = value.sizes?.thumb?.url
  if (typeof thumb === 'string' && thumb.length > 0) return thumb
  if (typeof value.url === 'string' && value.url.length > 0) return value.url
  return null
}

export default function UserAvatarField(props: UploadFieldClientProps) {
  const { field, path, readOnly } = props
  const { value, setValue, showError, errorMessage } = useField<AvatarValue>({ path })
  const userName = useFormFields(([fields]) => {
    const raw = fields?.name?.value
    return typeof raw === 'string' && raw.trim() ? raw.trim() : ''
  })
  const inputId = useId()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadedPreview, setUploadedPreview] = useState<{ id: string; url: string | null } | null>(null)
  const [fetched, setFetched] = useState<{ id: string; url: string | null } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [erroredUrl, setErroredUrl] = useState<string | null>(null)

  const mediaId = extractMediaId(value)
  const mediaIdKey = mediaId !== null ? String(mediaId) : null
  const inlineUrl = extractMediaUrl(value)
  const uploadedUrl = mediaIdKey && uploadedPreview?.id === mediaIdKey ? uploadedPreview.url : null
  const fetchedUrl = mediaIdKey && fetched?.id === mediaIdKey ? fetched.url : null
  const candidateUrl = inlineUrl ?? uploadedUrl ?? fetchedUrl
  const previewUrl = candidateUrl && erroredUrl !== candidateUrl ? candidateUrl : null

  useEffect(() => {
    if (inlineUrl || uploadedUrl || !mediaIdKey) return
    const controller = new AbortController()
    fetch(`/api/media/${encodeURIComponent(mediaIdKey)}?depth=0`, {
      credentials: 'same-origin',
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((doc: { url?: string; sizes?: { thumb?: { url?: string } } } | null) => {
        if (controller.signal.aborted) return
        setFetched({
          id: mediaIdKey,
          url: doc ? doc.sizes?.thumb?.url || doc.url || null : null,
        })
      })
      .catch(() => {
        if (!controller.signal.aborted) setFetched({ id: mediaIdKey, url: null })
      })
    return () => {
      controller.abort()
    }
  }, [inlineUrl, mediaIdKey, uploadedUrl])

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setUploadError(null)
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/admin/avatar', {
        method: 'POST',
        credentials: 'same-origin',
        body: formData,
      })
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean
        message?: string
        media?: { id?: number; url?: string }
      } | null
      if (!res.ok || !body?.ok || !body.media?.id) {
        setUploadError(body?.message || `上传失败（HTTP ${res.status}）`)
        return
      }
      setUploadedPreview({ id: String(body.media.id), url: body.media.url || null })
      setErroredUrl(null)
      setValue(body.media.id)
    } catch {
      setUploadError('网络异常，请稍后重试')
    } finally {
      setUploading(false)
    }
  }

  const handleRemove = () => {
    setUploadError(null)
    setUploadedPreview(null)
    setErroredUrl(null)
    setValue(null)
  }

  const initial = (userName || '用').charAt(0).toUpperCase()
  const label = typeof field.label === 'string' ? field.label : '头像'
  const description = typeof field.admin?.description === 'string' ? field.admin.description : undefined

  return (
    <div className="field-type upload arco-user-avatar-field">
      <FieldLabel htmlFor={inputId} label={label} path={path} required={Boolean(field.required)} />
      <div className="arco-user-avatar-field__body">
        <div className="arco-user-avatar-field__preview" aria-hidden="true">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- 后台上传预览直接展示媒体地址
            <img
              alt=""
              className="arco-user-avatar-field__img"
              onError={() => setErroredUrl(previewUrl)}
              src={previewUrl}
            />
          ) : (
            <span className="arco-user-avatar-field__fallback">{initial}</span>
          )}
        </div>
        <div className="arco-user-avatar-field__actions">
          <input
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="arco-user-avatar-field__input"
            disabled={Boolean(readOnly) || uploading}
            id={inputId}
            onChange={(e) => {
              void handleFileChange(e)
            }}
            ref={fileInputRef}
            type="file"
          />
          <button
            className="btn btn--style-secondary btn--size-small"
            disabled={Boolean(readOnly) || uploading}
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            {uploading ? '上传中...' : mediaId !== null ? '更换头像' : '上传头像'}
          </button>
          {mediaId !== null && !readOnly ? (
            <button
              className="btn btn--style-subtle btn--size-small"
              disabled={uploading}
              onClick={handleRemove}
              type="button"
            >
              恢复默认
            </button>
          ) : null}
        </div>
      </div>
      {uploadError || (showError && errorMessage) ? (
        <div className="arco-user-avatar-field__error" role="alert">
          {uploadError || errorMessage}
        </div>
      ) : null}
      {description ? <FieldDescription description={description} path={path} /> : null}
    </div>
  )
}
