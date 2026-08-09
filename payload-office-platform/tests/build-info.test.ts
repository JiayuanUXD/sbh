import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { BUILD_INFO_FILENAME, readBuildCommit, UNKNOWN_COMMIT } from '@/lib/build-info'

describe('readBuildCommit', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'build-info-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const write = (content: string) => writeFileSync(join(dir, BUILD_INFO_FILENAME), content, 'utf8')

  it('读出 CI 注入的 commit', () => {
    // deploy.yml 写入的就是这个形状：printf '{"commit":"%s"}\n' "$GITHUB_SHA"
    write('{"commit":"b88cf220f0dd1e3a4c5f6789abcdef0123456789"}\n')

    expect(readBuildCommit(dir)).toBe('b88cf220f0dd1e3a4c5f6789abcdef0123456789')
  })

  it('文件不存在时回退 unknown（本地开发与 CI 质量门的正常情况）', () => {
    expect(readBuildCommit(dir)).toBe(UNKNOWN_COMMIT)
  })

  it('JSON 非法时回退 unknown，不抛错中断构建', () => {
    write('{ 这不是 JSON')

    expect(() => readBuildCommit(dir)).not.toThrow()
    expect(readBuildCommit(dir)).toBe(UNKNOWN_COMMIT)
  })

  it.each([
    ['commit 字段缺失', '{"sha":"abc"}'],
    ['commit 为空字符串', '{"commit":""}'],
    ['commit 非字符串', '{"commit":123}'],
    ['顶层是数组', '[]'],
    ['顶层是 null', 'null'],
  ])('%s 时回退 unknown', (_label, content) => {
    write(content)

    expect(readBuildCommit(dir)).toBe(UNKNOWN_COMMIT)
  })
})
