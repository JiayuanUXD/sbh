import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createLocalMediaWriter, MEDIA_SOURCE_PREFIX } from '@/lib/storage/media-writer'

let root: string

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'media-writer-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('createLocalMediaWriter', () => {
  it('put 写到 <root>/<prefix>/<filename>，目录不存在时自动建', async () => {
    const writer = createLocalMediaWriter(root)
    await writer.put({
      prefix: MEDIA_SOURCE_PREFIX,
      filename: 'office.jpg',
      body: Buffer.from('hello'),
      mimeType: 'image/jpeg',
    })
    const written = readFileSync(path.join(root, MEDIA_SOURCE_PREFIX, 'office.jpg'))
    expect(written.toString()).toBe('hello')
  })

  it('put 对同名文件是覆盖而不是追加', async () => {
    const writer = createLocalMediaWriter(root)
    const args = { prefix: 'media', filename: 'a.jpg', mimeType: 'image/jpeg' }
    await writer.put({ ...args, body: Buffer.from('first') })
    await writer.put({ ...args, body: Buffer.from('second') })
    expect(readFileSync(path.join(root, 'media', 'a.jpg')).toString()).toBe('second')
  })

  it('get 读回 put 写下的字节', async () => {
    const writer = createLocalMediaWriter(root)
    await writer.put({
      prefix: MEDIA_SOURCE_PREFIX,
      filename: 'b.png',
      body: Buffer.from([1, 2, 3]),
      mimeType: 'image/png',
    })
    const got = await writer.get({ prefix: MEDIA_SOURCE_PREFIX, filename: 'b.png' })
    expect(got).toEqual(Buffer.from([1, 2, 3]))
  })

  it('get 对不存在的文件返回 null，而不是抛错', async () => {
    const writer = createLocalMediaWriter(root)
    expect(await writer.get({ prefix: 'media', filename: 'missing.jpg' })).toBeNull()
  })

  it('拒绝带路径穿越的文件名', async () => {
    const writer = createLocalMediaWriter(root)
    await expect(
      writer.put({
        prefix: 'media',
        filename: '../escape.jpg',
        body: Buffer.from('x'),
        mimeType: 'image/jpeg',
      }),
    ).rejects.toThrow(/文件名/)
  })
})
