import sharp from 'sharp'
import type { Payload } from 'payload'
import type { Media } from '@/payload-types'
import { normalizePublicMediaUrl } from '@/domain/public-catalog/media-url'

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024

export const AVATAR_ALLOWED_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
])

const FORMAT_TO_MIME_AND_EXT: Record<string, { mime: string; ext: string }> = {
  jpeg: { mime: 'image/jpeg', ext: 'jpg' },
  jpg: { mime: 'image/jpeg', ext: 'jpg' },
  png: { mime: 'image/png', ext: 'png' },
  webp: { mime: 'image/webp', ext: 'webp' },
  gif: { mime: 'image/gif', ext: 'gif' },
}

export type AvatarUploadErrorCode =
  | 'FILE_REQUIRED'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_IMAGE'

export class AvatarUploadError extends Error {
  readonly code: AvatarUploadErrorCode
  readonly status: number
  constructor(code: AvatarUploadErrorCode, message: string, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

export type ValidatedAvatarFile = Readonly<{
  data: Buffer
  mimetype: string
  ext: string
}>

/**
 * 校验头像上传文件：大小上限 + MIME 白名单 + sharp 解码核验真实格式（防伪造后缀与 SVG XSS）。
 */
export async function validateAvatarFile(file: unknown): Promise<ValidatedAvatarFile> {
  if (!(file instanceof File) || file.size <= 0) {
    throw new AvatarUploadError('FILE_REQUIRED', '请选择需要上传的头像图片', 400)
  }
  if (file.size > AVATAR_MAX_BYTES) {
    throw new AvatarUploadError('FILE_TOO_LARGE', '头像图片大小不能超过 2MB', 413)
  }
  if (file.type && !AVATAR_ALLOWED_MIMES.has(file.type.toLowerCase())) {
    throw new AvatarUploadError(
      'UNSUPPORTED_IMAGE',
      '仅支持 JPG、PNG、WebP 或 GIF 格式的图片',
      400,
    )
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  let format: string | undefined
  let width: number | undefined
  let height: number | undefined
  try {
    const meta = await sharp(buffer).metadata()
    format = meta.format
    width = meta.width
    height = meta.height
  } catch {
    throw new AvatarUploadError('UNSUPPORTED_IMAGE', '无法识别的图片文件，请更换后重试', 400)
  }

  const resolved = format ? FORMAT_TO_MIME_AND_EXT[format] : undefined
  if (!resolved || !width || !height || width <= 0 || height <= 0) {
    throw new AvatarUploadError(
      'UNSUPPORTED_IMAGE',
      '仅支持有效的 JPG、PNG、WebP 或 GIF 图片',
      400,
    )
  }

  return { data: buffer, mimetype: resolved.mime, ext: resolved.ext }
}

/**
 * 以 `usage: 'other'` 写入媒体库（不触发实景图水印烘焙），返回新增媒体记录。
 */
export async function storeAvatarMedia(
  payload: Payload,
  file: ValidatedAvatarFile,
  options: { prefix: string; alt: string },
): Promise<{ id: number; url: string }> {
  const safeAlt = options.alt.trim().slice(0, 120) || '用户头像'
  const filename = `${options.prefix}-${Date.now()}.${file.ext}`
  const created = (await payload.create({
    collection: 'media',
    data: {
      alt: safeAlt,
      usage: 'other',
    },
    file: {
      data: file.data,
      mimetype: file.mimetype,
      name: filename,
      size: file.data.length,
    },
    depth: 0,
    overrideAccess: true,
  })) as Media

  const url =
    normalizePublicMediaUrl(created.sizes?.thumb?.url) ??
    normalizePublicMediaUrl(created.url) ??
    ''

  return { id: created.id, url }
}

/**
 * 从关系字段（裸 ID 或已展开 Media 文档）提取安全可用的缩略图 / 原图 URL。
 */
export function resolveAvatarMediaUrl(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const media = value as Partial<Media>
  return (
    normalizePublicMediaUrl(media.sizes?.thumb?.url) ??
    normalizePublicMediaUrl(media.url)
  )
}
