/**
 * 访客身份关联（OPT-067 客户端侧）
 *
 * @vitest-environment happy-dom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  identifyAfterSubmitSuccess,
  readStoredVisitorRef,
  rememberVisitorRef,
  VISITOR_REF_STORAGE_KEY,
} from '@/lib/frontend/analytics/visitor-identity'

const VALID = '0123456789abcdef0123456789abcdef'
const VALID_2 = 'fedcba9876543210fedcba9876543210'

describe('readStoredVisitorRef', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  it('读回合法值', () => {
    window.sessionStorage.setItem(VISITOR_REF_STORAGE_KEY, VALID)
    expect(readStoredVisitorRef()).toBe(VALID)
  })

  it('没有时返回 null', () => {
    expect(readStoredVisitorRef()).toBeNull()
  })

  it('存储里是畸形值时返回 null——sessionStorage 是用户可改的', () => {
    // 服务端会拒，但没必要把垃圾发出去
    for (const bad of ['', 'nope', 'ABCDEF0123456789abcdef0123456789', '../../etc']) {
      window.sessionStorage.setItem(VISITOR_REF_STORAGE_KEY, bad)
      expect(readStoredVisitorRef(), `应拒绝 ${JSON.stringify(bad)}`).toBeNull()
    }
  })

  it('sessionStorage 抛错时返回 null 而不是崩掉', () => {
    // 隐私模式 / 存储被禁用 / 配额满，都不该让咨询流程出错
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(readStoredVisitorRef()).toBeNull()
    spy.mockRestore()
  })
})

describe('rememberVisitorRef', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  it('写入合法值', () => {
    rememberVisitorRef(VALID)
    expect(window.sessionStorage.getItem(VISITOR_REF_STORAGE_KEY)).toBe(VALID)
  })

  it('非法值不写——宁可下次重新派生，也不让坏值一直传下去', () => {
    for (const bad of ['nope', '', null, undefined, 42, {}]) {
      rememberVisitorRef(bad)
      expect(window.sessionStorage.getItem(VISITOR_REF_STORAGE_KEY)).toBeNull()
    }
  })

  it('写入抛错时不冒泡', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => rememberVisitorRef(VALID)).not.toThrow()
    spy.mockRestore()
  })
})

describe('identifyAfterSubmitSuccess', () => {
  let identified: string[]

  beforeEach(() => {
    window.sessionStorage.clear()
    identified = []
    Reflect.set(window, 'umami', {
      identify: (id: string) => identified.push(id),
      track: () => {},
    })
  })

  afterEach(() => {
    Reflect.deleteProperty(window, 'umami')
  })

  it('调用 umami.identify 并记住该值', () => {
    identifyAfterSubmitSuccess(VALID)
    expect(identified).toEqual([VALID])
    expect(window.sessionStorage.getItem(VISITOR_REF_STORAGE_KEY)).toBe(VALID)
  })

  it('非法值不调用 identify——不让畸形 ID 污染分析侧', () => {
    for (const bad of ['nope', '', null, undefined, 42]) {
      identifyAfterSubmitSuccess(bad)
    }
    expect(identified).toEqual([])
    expect(window.sessionStorage.getItem(VISITOR_REF_STORAGE_KEY)).toBeNull()
  })

  it('Umami 未加载时静默跳过，且仍然记住值', () => {
    // 关联不上只是少一份分析数据，绝不能影响用户已经成功的咨询提交；
    // 但值要存下来——同会话第二条线索仍需复用它
    Reflect.deleteProperty(window, 'umami')
    expect(() => identifyAfterSubmitSuccess(VALID)).not.toThrow()
    expect(window.sessionStorage.getItem(VISITOR_REF_STORAGE_KEY)).toBe(VALID)
  })

  it('umami.identify 抛错时不冒泡到调用方', () => {
    Reflect.set(window, 'umami', {
      identify: () => {
        throw new Error('boom')
      },
    })
    expect(() => identifyAfterSubmitSuccess(VALID)).not.toThrow()
  })

  it('同会话第二次提交覆盖为新值', () => {
    // 服务端在有回传时会复用旧值，所以正常流程下第二次拿到的就是同一个；
    // 但若服务端确实给了新值（例如回传丢失），客户端应以服务端为准
    identifyAfterSubmitSuccess(VALID)
    identifyAfterSubmitSuccess(VALID_2)
    expect(identified).toEqual([VALID, VALID_2])
    expect(window.sessionStorage.getItem(VISITOR_REF_STORAGE_KEY)).toBe(VALID_2)
  })
})

describe('模块不提供「提交前 identify」的入口（spec D5）', () => {
  it('只导出 identifyAfterSubmitSuccess，没有裸的 identify', async () => {
    // 匿名浏览阶段 identify 等于「先关联、后征得同意」，与隐私声明相悖。
    // 命名即契约：误用需要先绕过名字才做得到。
    const mod = await import('@/lib/frontend/analytics/visitor-identity')
    const exported = Object.keys(mod)
    expect(exported).toContain('identifyAfterSubmitSuccess')
    expect(exported.filter((k) => /^identify/.test(k))).toEqual([
      'identifyAfterSubmitSuccess',
    ])
  })
})

// ────────────────────────────────────────────────────────────
// 静态守卫：identify 只能出现在提交成功分支
// ────────────────────────────────────────────────────────────

describe('identify 调用点守卫（spec D5）', () => {
  it('全仓库只有 InquiryModal 的成功分支调 identifyAfterSubmitSuccess', async () => {
    // 匿名浏览阶段 identify = 在用户同意留资前把浏览行为挂到持久身份上。
    // 命名与注释拦不住「再加一处调用」，这条能：新增调用点会让它红，
    // 逼调用者要么确认这是提交成功后、要么改设计。
    const { readdirSync, readFileSync, statSync } = await import('node:fs')
    const path = await import('node:path')
    const { fileURLToPath } = await import('node:url')

    const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry)
        if (statSync(full).isDirectory()) walk(full, out)
        else if (/\.tsx?$/.test(entry)) out.push(full)
      }
      return out
    }

    const callers: string[] = []
    for (const file of walk(SRC)) {
      // 模块自身的定义与导出不算调用点
      if (file.endsWith(path.join('analytics', 'visitor-identity.ts'))) continue
      const source = readFileSync(file, 'utf8')
      // 去掉 import 行，避免「只 import 不调用」被算成调用点
      const body = source.replace(/^import[\s\S]*?from .*$/gm, '')
      if (/(?<![\w$.])identifyAfterSubmitSuccess\s*\(/.test(body)) {
        callers.push(path.relative(SRC, file).split(path.sep).join('/'))
      }
    }

    expect(
      callers,
      '新增了 identify 调用点。请确认它确实在「提交成功之后」——'
        + '匿名浏览阶段 identify 与隐私声明相悖（spec D5）。'
        + '确属成功分支的话，把文件加进本断言的白名单。',
    ).toEqual(['components/frontend/InquiryModal.tsx'])
  })

  it('调用点位于 res.ok 分支内，不在提交前', async () => {
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const file = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      'src/components/frontend/InquiryModal.tsx',
    )
    const source = readFileSync(file, 'utf8')
    const okIndex = source.indexOf('if (res.ok) {')
    const callIndex = source.indexOf('identifyAfterSubmitSuccess(data.visitorRef)')
    expect(okIndex).toBeGreaterThan(-1)
    expect(callIndex).toBeGreaterThan(okIndex)
  })
})
