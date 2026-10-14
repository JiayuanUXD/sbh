import { Readable } from 'node:stream'

import { S3 } from '@aws-sdk/client-s3'
import { s3Storage } from '@payloadcms/storage-s3'
import type { CollectionConfig, Config, PayloadRequest } from 'payload'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Media } from '@/collections/Media'
import { MEDIA_FILE_CACHE_CONTROL, withMediaFileCacheControl } from '@/lib/storage/media-file-cache'

/**
 * `/api/media/file/*` 的浏览器缓存（2026-10-14，用户裁定缓存一天）。
 *
 * 前半段锁策略本身；后半段把 Media 集合真的套进生产用的 s3Storage 插件、
 * 打桩 COS 客户端后调用它的文件处理器——Payload 何时调用 `modifyResponseHeaders`
 * 是插件内部行为，升级时可能变，只测纯函数守不住「304 也要带、404 不能带」。
 */
describe('媒体文件缓存策略', () => {
  it('缓存一天，过期后后台再确认', () => {
    expect(MEDIA_FILE_CACHE_CONTROL).toBe('public, max-age=86400, stale-while-revalidate=604800')
  })

  it('不能是 immutable：水印烘焙与派生尺寸回填都会同名覆盖、URL 不变', () => {
    expect(MEDIA_FILE_CACHE_CONTROL).not.toMatch(/immutable/)
  })

  it('加上 Cache-Control，原有响应头原样保留', () => {
    const headers = new Headers({ 'Content-Type': 'image/jpeg', ETag: '"abc"' })
    const result = withMediaFileCacheControl({ headers })

    expect(result.get('Cache-Control')).toBe(MEDIA_FILE_CACHE_CONTROL)
    expect(result.get('Content-Type')).toBe('image/jpeg')
    expect(result.get('ETag')).toBe('"abc"')
  })

  it('206 的 Content-Range 照常缓存', () => {
    const headers = new Headers({ 'Content-Range': 'bytes 0-1023/5242726' })
    expect(withMediaFileCacheControl({ headers }).get('Cache-Control')).toBe(MEDIA_FILE_CACHE_CONTROL)
  })

  it('416（Range 越界，Content-Range: bytes */<size>）不缓存', () => {
    const headers = new Headers({ 'Content-Range': 'bytes */5242726' })
    expect(withMediaFileCacheControl({ headers }).get('Cache-Control')).toBeNull()
  })

  it('Media 集合挂的就是这个钩子', () => {
    const upload = Media.upload as Exclude<typeof Media.upload, boolean | undefined>
    expect(upload.modifyResponseHeaders).toBe(withMediaFileCacheControl)
  })
})

type StaticHandler = NonNullable<
  Exclude<CollectionConfig['upload'], boolean | undefined>['handlers']
>[number]

const OBJECT_BYTES = Buffer.from('0123456789')
const OBJECT_ETAG = '"6c8123c7b27f1d07fa60bf39ed3d793d"'

function mediaStaticHandler(): StaticHandler {
  const plugin = s3Storage({
    enabled: true,
    collections: { media: { prefix: 'media' } },
    bucket: 'test-bucket',
    config: {
      credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
      endpoint: 'https://cos.example.invalid',
      region: 'ap-shanghai',
    },
  })
  const config = plugin({ collections: [Media] } as Config) as Config
  const media = config.collections?.find((collection) => collection.slug === 'media')
  const upload = media?.upload
  if (!upload || typeof upload !== 'object' || !upload.handlers?.length) {
    throw new Error('s3Storage 没有给 media 挂上文件处理器')
  }
  return upload.handlers[upload.handlers.length - 1]
}

function fileRequest(headers: Record<string, string> = {}): PayloadRequest {
  return {
    headers: new Headers(headers),
    payload: { logger: { error: vi.fn() } },
  } as unknown as PayloadRequest
}

async function getMediaFile(requestHeaders: Record<string, string> = {}): Promise<Response> {
  const response = await mediaStaticHandler()(fileRequest(requestHeaders), {
    doc: { id: 1 },
    headers: new Headers(),
    params: { collection: 'media', filename: 'shared-office-001-01.jpg', prefix: 'media' },
  })
  if (!(response instanceof Response)) throw new Error('文件处理器没有返回 Response')
  return response
}

describe('经 s3Storage 文件处理器的真实响应', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function stubExistingObject() {
    vi.spyOn(S3.prototype, 'headObject').mockImplementation(async () => ({
      $metadata: {},
      ContentLength: OBJECT_BYTES.length,
      ContentType: 'image/jpeg',
      ETag: OBJECT_ETAG,
    }))
    vi.spyOn(S3.prototype, 'getObject').mockImplementation(async () => ({
      $metadata: {},
      Body: Readable.from([OBJECT_BYTES]) as never,
    }))
  }

  it('200 带缓存头', async () => {
    stubExistingObject()
    const response = await getMediaFile()

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe(MEDIA_FILE_CACHE_CONTROL)
    expect(response.headers.get('ETag')).toBe(OBJECT_ETAG)
    await response.body?.cancel()
  })

  it('304 也带缓存头（浏览器靠它给已缓存的副本续期）', async () => {
    stubExistingObject()
    const response = await getMediaFile({ 'If-None-Match': OBJECT_ETAG })

    expect(response.status).toBe(304)
    expect(response.headers.get('Cache-Control')).toBe(MEDIA_FILE_CACHE_CONTROL)
  })

  it('206（视频按 Range 取）带缓存头', async () => {
    stubExistingObject()
    const response = await getMediaFile({ Range: 'bytes=0-3' })

    expect(response.status).toBe(206)
    expect(response.headers.get('Cache-Control')).toBe(MEDIA_FILE_CACHE_CONTROL)
    await response.body?.cancel()
  })

  it('对象不存在的 404 不带缓存头（补传后要立刻可见）', async () => {
    vi.spyOn(S3.prototype, 'headObject').mockImplementation(async () => {
      throw Object.assign(new Error('NotFound'), { name: 'NotFound' })
    })
    const response = await getMediaFile()

    expect(response.status).toBe(404)
    expect(response.headers.get('Cache-Control')).toBeNull()
  })
})
