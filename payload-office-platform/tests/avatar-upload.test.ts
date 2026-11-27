import sharp from 'sharp'
import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import {
  AVATAR_MAX_BYTES,
  AvatarUploadError,
  resolveAvatarMediaUrl,
  storeAvatarMedia,
  validateAvatarFile,
} from '@/domain/media/avatar-upload'

async function makePngBuffer(width = 32, height = 32): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 113, b: 227, alpha: 1 } },
  })
    .png()
    .toBuffer()
}

describe('avatar-upload 领域校验与媒体写入', () => {
  it('空文件 / 非 File → 抛出 FILE_REQUIRED', async () => {
    await expect(validateAvatarFile(null)).rejects.toMatchObject({
      code: 'FILE_REQUIRED',
      status: 400,
    })
    const empty = new File([], 'empty.png', { type: 'image/png' })
    await expect(validateAvatarFile(empty)).rejects.toBeInstanceOf(AvatarUploadError)
  })

  it('超过 2MB → 抛出 FILE_TOO_LARGE (413)', async () => {
    const oversized = new File([new Uint8Array(AVATAR_MAX_BYTES + 1)], 'big.png', {
      type: 'image/png',
    })
    await expect(validateAvatarFile(oversized)).rejects.toMatchObject({
      code: 'FILE_TOO_LARGE',
      status: 413,
    })
  })

  it('拒绝 SVG 与伪造 PNG 后缀的非法字节', async () => {
    const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg"></svg>'], 'xss.svg', {
      type: 'image/svg+xml',
    })
    await expect(validateAvatarFile(svg)).rejects.toMatchObject({
      code: 'UNSUPPORTED_IMAGE',
      status: 400,
    })

    const fakePng = new File(['not-an-image'], 'fake.png', { type: 'image/png' })
    await expect(validateAvatarFile(fakePng)).rejects.toMatchObject({
      code: 'UNSUPPORTED_IMAGE',
      status: 400,
    })
  })

  it('合法 PNG 通过校验并识别真实 mime 与扩展名', async () => {
    const buf = await makePngBuffer()
    const file = new File([new Uint8Array(buf)], 'avatar.png', { type: 'image/png' })
    const validated = await validateAvatarFile(file)
    expect(validated.mimetype).toBe('image/png')
    expect(validated.ext).toBe('png')
    expect(validated.data.length).toBe(buf.length)
  })

  it('storeAvatarMedia 以 usage=other 写入媒体库，避免触发实景图水印', async () => {
    const create = vi.fn(async () => ({
      id: 42,
      url: '/api/media/file/avatar.png',
      sizes: { thumb: { url: '/api/media/file/avatar-thumb.webp' } },
    }))
    const payload = { create } as unknown as Payload
    const buf = await makePngBuffer()
    const res = await storeAvatarMedia(
      payload,
      { data: buf, mimetype: 'image/png', ext: 'png' },
      { prefix: 'user-avatar-1', alt: '测试用户头像' },
    )
    expect(res).toEqual({ id: 42, url: '/api/media/file/avatar-thumb.webp' })
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'media',
        overrideAccess: true,
        data: { alt: '测试用户头像', usage: 'other' },
      }),
    )
  })

  it('resolveAvatarMediaUrl 拒绝危险协议并优先返回 thumb', () => {
    expect(
      resolveAvatarMediaUrl({
        url: '/api/media/file/full.png',
        sizes: { thumb: { url: '/api/media/file/thumb.webp' } },
      }),
    ).toBe('/api/media/file/thumb.webp')
    expect(resolveAvatarMediaUrl({ url: 'javascript:alert(1)' })).toBeNull()
    expect(resolveAvatarMediaUrl(123)).toBeNull()
  })
})
