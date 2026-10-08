import { gzipSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import { MAX_CHUNK_ROWS, parseSyncChunk } from '@/domain/supply-sync/chunk'

const retire = (externalId: string) => ({ kind: 'retire', externalId, reason: 'gone' })
const toBytes = (rows: unknown[], gzip = false) => {
  const text = rows.map((r) => JSON.stringify(r)).join('\n') + '\n'
  return new Uint8Array(gzip ? gzipSync(Buffer.from(text, 'utf8')) : Buffer.from(text, 'utf8'))
}

describe('parseSyncChunk', () => {
  it('gzip 与纯文本 NDJSON 都接受，空行忽略', () => {
    const plain = parseSyncChunk(toBytes([retire('1'), retire('2')]))
    const gz = parseSyncChunk(toBytes([retire('1'), retire('2')], true))
    expect(plain).toMatchObject({ ok: true, kind: 'retire' })
    expect(gz).toEqual(plain)
  })

  it('任一行不合格整包拒收，并指出第几行', () => {
    const res = parseSyncChunk(toBytes([retire('1'), { kind: 'retire', externalId: 'x', reason: 'gone' }]))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.errors[0]).toContain('第 2 行')
  })

  it('一包只能装一种 kind', () => {
    const listingLike = { kind: 'building' }
    const res = parseSyncChunk(toBytes([retire('1'), listingLike]))
    expect(res.ok).toBe(false)
  })

  it('同一包内 externalId 重复拒收', () => {
    const res = parseSyncChunk(toBytes([retire('1'), retire('1')]))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.errors[0]).toContain('重复')
  })

  it('超过行数上限、非 JSON、空文件都拒收', () => {
    const many = Array.from({ length: MAX_CHUNK_ROWS + 1 }, (_, i) => retire(String(i + 1)))
    expect(parseSyncChunk(toBytes(many))).toMatchObject({ ok: false, code: 'TOO_MANY_ROWS' })
    expect(parseSyncChunk(new Uint8Array(Buffer.from('{not json}\n')))).toMatchObject({
      ok: false,
      code: 'INVALID_ROWS',
    })
    expect(parseSyncChunk(new Uint8Array())).toMatchObject({ ok: false, code: 'EMPTY' })
  })

  it('坏的 gzip 拒收而不是抛错', () => {
    expect(parseSyncChunk(new Uint8Array([0x1f, 0x8b, 1, 2, 3]))).toMatchObject({ ok: false, code: 'BAD_GZIP' })
  })
})

describe('图片地址只允许对方图床（服务端会去拉取，防 SSRF）', () => {
  it('非对方主机、http、内网地址一律拒收', async () => {
    const { isHuizuImageUrl } = await import('@/domain/supply-sync/huizuxuanzhi-row')
    expect(isHuizuImageUrl('https://huizutec.oss-cn-shanghai.aliyuncs.com/uploads/a.jpg')).toBe(true)
    expect(isHuizuImageUrl('https://www.huizuxuanzhi.com/uploads/20250318/a.png')).toBe(true)
    expect(isHuizuImageUrl('http://www.huizuxuanzhi.com/uploads/a.png')).toBe(false)
    expect(isHuizuImageUrl('http://169.254.169.254/latest/meta-data')).toBe(false)
    expect(isHuizuImageUrl('https://evil.example/a.jpg')).toBe(false)
    expect(isHuizuImageUrl('not a url')).toBe(false)
  })

  it('只对对方图床带 Referer', async () => {
    const { imageRequestHeaders } = await import('@/domain/supply-sync/source-sync-task')
    expect(imageRequestHeaders('https://huizutec.oss-cn-shanghai.aliyuncs.com/a.jpg')).toEqual({
      Referer: 'https://www.huizuxuanzhi.com/',
    })
    expect(imageRequestHeaders('https://example.com/a.jpg')).toEqual({})
  })
})

describe('已有楼盘补图条件', () => {
  it('封面、图集、媒体条目三者全空才补图（手工楼盘的封面多在旧字段里）', async () => {
    const { buildingHasNoImages } = await import('@/domain/supply-sync/source-sync-task')
    expect(buildingHasNoImages({ coverImage: null, gallery: [], mediaItems: [] })).toBe(true)
    expect(buildingHasNoImages({})).toBe(true)
    expect(buildingHasNoImages({ coverImage: 12, gallery: [], mediaItems: [] })).toBe(false)
    expect(buildingHasNoImages({ coverImage: null, gallery: [{ image: 12 }], mediaItems: [] })).toBe(false)
    expect(buildingHasNoImages({ coverImage: null, gallery: [], mediaItems: [{ resource: 12 }] })).toBe(false)
  })
})
