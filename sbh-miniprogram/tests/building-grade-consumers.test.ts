import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const miniprogramRoot = resolve(import.meta.dirname, '../miniprogram')

function read(relativePath: string): string {
  return readFileSync(resolve(miniprogramRoot, relativePath), 'utf8')
}

describe('楼盘等级真实消费面', () => {
  it.each([
    'components/building-card/index.ts',
    'pages/building-detail/index.ts',
  ])('%s 只调用共享穷尽映射，不保留旧枚举或拼接回退', (relativePath) => {
    const source = read(relativePath)

    expect(source).toContain('buildingGradeLabel(')
    expect(source).not.toMatch(/grade-b|grade-c|'A'|'B'|'C'/)
    expect(source).not.toContain("endsWith('级')")
  })
})
