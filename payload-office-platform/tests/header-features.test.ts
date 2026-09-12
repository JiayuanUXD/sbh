import { describe, expect, it } from 'vitest'

import { HEADER_FEATURES_FALLBACK, pickServicePhone, resolveHeaderFeatures } from '@/lib/frontend/header-features'

/** OPT-094：顶栏功能开关的空值语义与号码取值顺序。 */
describe('resolveHeaderFeatures', () => {
  it('Global 缺失 → 兜底：登录入口关、电话入口开、无默认号', () => {
    expect(resolveHeaderFeatures(null)).toEqual(HEADER_FEATURES_FALLBACK)
    expect(HEADER_FEATURES_FALLBACK).toEqual({ memberEntryVisible: false, servicePhoneVisible: true, servicePhone: null })
  })

  it('登录开关：只有显式 true 才开（NULL / undefined / false 都是关）', () => {
    expect(resolveHeaderFeatures({ memberEntryVisible: true }).memberEntryVisible).toBe(true)
    expect(resolveHeaderFeatures({ memberEntryVisible: null }).memberEntryVisible).toBe(false)
    expect(resolveHeaderFeatures({}).memberEntryVisible).toBe(false)
    expect(resolveHeaderFeatures({ memberEntryVisible: false }).memberEntryVisible).toBe(false)
  })

  it('电话开关：只有显式 false 才关', () => {
    expect(resolveHeaderFeatures({ servicePhoneVisible: false }).servicePhoneVisible).toBe(false)
    expect(resolveHeaderFeatures({ servicePhoneVisible: null }).servicePhoneVisible).toBe(true)
    expect(resolveHeaderFeatures({}).servicePhoneVisible).toBe(true)
  })

  it('全站默认号归一化，非法串当作没填', () => {
    expect(resolveHeaderFeatures({ servicePhone: '400-820-1234' }).servicePhone).toEqual({
      display: '400-820-1234',
      href: 'tel:4008201234',
    })
    expect(resolveHeaderFeatures({ servicePhone: 'abc' }).servicePhone).toBeNull()
    expect(resolveHeaderFeatures({ servicePhone: '' }).servicePhone).toBeNull()
  })
})

describe('pickServicePhone', () => {
  const features = resolveHeaderFeatures({ servicePhone: '400-820-1234' })

  it('城市覆盖优先，没配回落全站默认，都空为 null', () => {
    expect(pickServicePhone('021 6888 8888', features)?.display).toBe('021 6888 8888')
    expect(pickServicePhone(null, features)?.display).toBe('400-820-1234')
    expect(pickServicePhone('', features)?.display).toBe('400-820-1234')
    expect(pickServicePhone(null, resolveHeaderFeatures({}))).toBeNull()
  })

  it('城市覆盖非法时不静默回落到错号，按没配处理', () => {
    expect(pickServicePhone('call me', features)?.display).toBe('400-820-1234')
  })

  it('入口开关关着时城市覆盖也不显示', () => {
    const off = resolveHeaderFeatures({ servicePhone: '400-820-1234', servicePhoneVisible: false })
    expect(pickServicePhone('021 6888 8888', off)).toBeNull()
  })
})
