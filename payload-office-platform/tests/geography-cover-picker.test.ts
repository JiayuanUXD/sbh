import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const SRC = readFileSync('src/components/admin/geography/CoverPickerModal.tsx', 'utf8')

/**
 * OPT-062：选图/上传弹层。
 *
 * 用源码契约断言而非渲染断言，是因为这里要守的是**结构性约束**——
 * 「上传必须判 res.ok」这类要求，渲染快照抓不住。重交互（弹层开关、
 * ESC 冒泡、强刷回显）留给浏览器验收。
 */
describe('CoverPickerModal 的结构性约束', () => {
  it('是客户端组件', () => {
    expect(SRC.startsWith("'use client'")).toBe(true)
  })

  it('上传走 POST /api/media + FormData，alt 放进 _payload', () => {
    expect(SRC).toContain("'/api/media'")
    expect(SRC).toContain('FormData')
    // Payload 的多部分上传约定：非文件字段序列化进 _payload
    expect(SRC).toContain('_payload')
  })

  it('显式检查 res.ok —— 不判就是静默丢文件', () => {
    // 非 2xx 会正常 resolve（413 超大 / 403 无权限 / 422 校验失败）。
    // MediaWorkbench.tsx:346-349 有同一条教训的注释。
    expect(SRC).toMatch(/res\.ok|response\.ok/)
  })

  it('不依赖 Payload 表单上下文（抽屉在 Payload 表单之外）', () => {
    expect(SRC).not.toContain('useField')
    expect(SRC).not.toContain('useForm')
    expect(SRC).not.toContain('useDocumentInfo')
  })

  it('alt 由 areaName 派生，不是写死的占位串', () => {
    expect(SRC).toContain('areaName')
  })
})
