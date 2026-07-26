import { describe, expect, it } from 'vitest'
import {
  AUDIT_BEFORE_AFTER_MASK_RULES,
  BUILDING_COORDINATE_MASK_RULES,
  PHONE_MASK_RULE,
  PHONE_MASK_RULES,
  canSeeField,
  getBuildingMaskRules,
  getLeadMaskRules,
  getUserMaskRules,
  maskDocFields,
  maskDocsFields,
  maskSinglePhone,
  normalizeAndMaskPhone,
  type FieldMaskRule,
} from '@/domain/auth/field-mask'
import type { PermissionContext } from '@/domain/auth/permission-context'

function makeCtx(
  fieldPermissions: string[] = [],
): PermissionContext {
  return {
    userId: 1,
    roleCodes: ['OPS'],
    cityIds: 'all',
    teamIds: new Set(),
    operationPermissions: new Set(),
    fieldPermissions: new Set(fieldPermissions),
    menuPermissions: new Set(),
    dataScope: 'global',
  }
}

// ────────────────────────────────────────────────────────────
// maskDocFields
// ────────────────────────────────────────────────────────────

describe('field-mask/maskDocFields', () => {
  it('ctx=null → 全部字段脱敏', () => {
    const doc = { name: '张三', phone: '13812345678', phoneNormalized: '13812345678' }
    const result = maskDocFields(doc, PHONE_MASK_RULES, null)
    expect(result.phone).toBe('138****5678')
    expect(result.phoneNormalized).toBe('138****5678')
    expect(result.name).toBe('张三') // 非敏感字段不修改
  })

  it('ctx 无 phone:full → 脱敏', () => {
    const ctx = makeCtx(['phone:masked'])
    const doc = { phone: '13812345678' }
    const result = maskDocFields(doc, PHONE_MASK_RULES, ctx)
    expect(result.phone).toBe('138****5678')
  })

  it('ctx 有 phone:full → 保留原值', () => {
    const ctx = makeCtx(['phone:full'])
    const doc = { phone: '13812345678' }
    const result = maskDocFields(doc, PHONE_MASK_RULES, ctx)
    expect(result.phone).toBe('13812345678')
  })

  it('ctx 有通配符 * → 保留原值', () => {
    const ctx = makeCtx(['*'])
    const doc = { phone: '13812345678', phoneNormalized: '13812345678' }
    const result = maskDocFields(doc, PHONE_MASK_RULES, ctx)
    expect(result.phone).toBe('13812345678')
    expect(result.phoneNormalized).toBe('13812345678')
  })

  it('字段为 null / undefined → 不修改', () => {
    const doc = { phone: null, phoneNormalized: undefined }
    const result = maskDocFields(doc, PHONE_MASK_RULES, null)
    expect(result.phone).toBeNull()
    expect(result.phoneNormalized).toBeUndefined()
  })

  it('字段不存在 → 不修改', () => {
    const doc = { name: '张三' }
    const result = maskDocFields(doc, PHONE_MASK_RULES, null)
    expect(result).toEqual({ name: '张三' })
  })

  it('就地震敏：返回同一引用', () => {
    const doc = { phone: '13812345678' }
    const result = maskDocFields(doc, PHONE_MASK_RULES, null)
    expect(result).toBe(doc)
  })

  it('非法手机号原样返回（maskPhone 内部处理）', () => {
    const doc = { phone: 'abc' }
    const result = maskDocFields(doc, PHONE_MASK_RULES, null)
    expect(result.phone).toBe('abc')
  })
})

// ────────────────────────────────────────────────────────────
// maskDocsFields（批量）
// ────────────────────────────────────────────────────────────

describe('field-mask/maskDocsFields', () => {
  it('批量脱敏：每条独立处理', () => {
    const docs = [
      { phone: '13812345678' },
      { phone: '13987654321' },
      { name: 'no phone' },
    ]
    const results = maskDocsFields(docs, PHONE_MASK_RULES, null)
    expect(results[0].phone).toBe('138****5678')
    expect(results[1].phone).toBe('139****4321')
    expect(results[2]).toEqual({ name: 'no phone' })
  })

  it('批量脱敏：浅拷贝，不影响原数组', () => {
    const docs = [{ phone: '13812345678' }]
    const results = maskDocsFields(docs, PHONE_MASK_RULES, null)
    expect(docs[0].phone).toBe('13812345678') // 原数组未变
    expect(results[0].phone).toBe('138****5678')
  })
})

// ────────────────────────────────────────────────────────────
// 预置规则
// ────────────────────────────────────────────────────────────

describe('field-mask/preset-rules', () => {
  it('getUserMaskRules 返回 phone + phoneNormalized', () => {
    const rules = getUserMaskRules()
    expect(rules.map((r) => r.field).sort()).toEqual(['phone', 'phoneNormalized'])
  })

  it('getLeadMaskRules 仅返回 phone', () => {
    const rules = getLeadMaskRules()
    expect(rules.map((r) => r.field)).toEqual(['phone'])
  })

  it('getBuildingMaskRules 返回 latitude + longitude', () => {
    const rules = getBuildingMaskRules()
    expect(rules.map((r) => r.field).sort()).toEqual(['latitude', 'longitude'])
  })

  it('BUILDING_COORDINATE_MASK_RULES：缺权限 → 坐标清空为 null', () => {
    const doc = { latitude: 31.2304, longitude: 121.4737 }
    const result = maskDocFields(doc, BUILDING_COORDINATE_MASK_RULES, null)
    expect(result.latitude).toBeNull()
    expect(result.longitude).toBeNull()
  })

  it('BUILDING_COORDINATE_MASK_RULES：有 building:coordinate → 保留原值', () => {
    const ctx = makeCtx(['building:coordinate'])
    const doc = { latitude: 31.2304, longitude: 121.4737 }
    const result = maskDocFields(doc, BUILDING_COORDINATE_MASK_RULES, ctx)
    expect(result.latitude).toBe(31.2304)
    expect(result.longitude).toBe(121.4737)
  })

  it('AUDIT_BEFORE_AFTER_MASK_RULES：缺 audit:before_after → 清空为 null', () => {
    const doc = { before: { phone: '13812345678' }, after: { phone: '13987654321' } }
    const result = maskDocFields(doc, AUDIT_BEFORE_AFTER_MASK_RULES, null)
    expect(result.before).toBeNull()
    expect(result.after).toBeNull()
  })

  it('AUDIT_BEFORE_AFTER_MASK_RULES：有 audit:before_after → 保留原值', () => {
    const ctx = makeCtx(['audit:before_after'])
    const before = { phone: '13812345678' }
    const after = { phone: '13987654321' }
    const doc = { before, after }
    const result = maskDocFields(doc, AUDIT_BEFORE_AFTER_MASK_RULES, ctx)
    expect(result.before).toBe(before)
    expect(result.after).toBe(after)
  })
})

// ────────────────────────────────────────────────────────────
// canSeeField
// ────────────────────────────────────────────────────────────

describe('field-mask/canSeeField', () => {
  it('ctx=null → false', () => {
    expect(canSeeField(null, PHONE_MASK_RULE)).toBe(false)
  })

  it('ctx 无权限 → false', () => {
    const ctx = makeCtx(['phone:masked'])
    expect(canSeeField(ctx, PHONE_MASK_RULE)).toBe(false)
  })

  it('ctx 精确匹配 → true', () => {
    const ctx = makeCtx(['phone:full'])
    expect(canSeeField(ctx, PHONE_MASK_RULE)).toBe(true)
  })

  it('ctx 通配符 * → true', () => {
    const ctx = makeCtx(['*'])
    expect(canSeeField(ctx, PHONE_MASK_RULE)).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────
// maskSinglePhone
// ────────────────────────────────────────────────────────────

describe('field-mask/maskSinglePhone', () => {
  it('ctx=null → 138****1111', () => {
    expect(maskSinglePhone('13812345678', null)).toBe('138****5678')
  })

  it('ctx 有 phone:full → 原值', () => {
    const ctx = makeCtx(['phone:full'])
    expect(maskSinglePhone('13812345678', ctx)).toBe('13812345678')
  })

  it('空值 → 原样返回', () => {
    expect(maskSinglePhone('', null)).toBe('')
  })
})

// ────────────────────────────────────────────────────────────
// normalizeAndMaskPhone
// ────────────────────────────────────────────────────────────

describe('field-mask/normalizeAndMaskPhone', () => {
  it('带空格/横线 → 先规范化再脱敏', () => {
    expect(normalizeAndMaskPhone('138-1234-5678', null)).toBe('138****5678')
    expect(normalizeAndMaskPhone('+86 138 1234 5678', null)).toBe('138****5678')
  })

  it('ctx 有 phone:full → 规范化后原值返回', () => {
    const ctx = makeCtx(['phone:full'])
    expect(normalizeAndMaskPhone('138-1234-5678', ctx)).toBe('13812345678')
  })

  it('非法手机号 → maskPhone 原样返回', () => {
    expect(normalizeAndMaskPhone('abc', null)).toBe('abc')
  })
})

// ────────────────────────────────────────────────────────────
// 自定义规则
// ────────────────────────────────────────────────────────────

describe('field-mask/custom-rules', () => {
  it('自定义规则：按自定义脱敏函数处理', () => {
    const rule: FieldMaskRule = {
      field: 'email',
      requiredPermission: 'email:full',
      mask: (v) => {
        if (typeof v !== 'string') return v
        const [name, domain] = v.split('@')
        if (!domain) return v
        return `${name.slice(0, 2)}***@${domain}`
      },
    }
    const doc = { email: 'admin@example.com' }
    const result = maskDocFields(doc, [rule], null)
    expect(result.email).toBe('ad***@example.com')
  })

  it('自定义规则：有权限 → 保留原值', () => {
    const rule: FieldMaskRule = {
      field: 'email',
      requiredPermission: 'email:full',
      mask: (v) => '***',
    }
    const ctx = makeCtx(['email:full'])
    const doc = { email: 'admin@example.com' }
    const result = maskDocFields(doc, [rule], ctx)
    expect(result.email).toBe('admin@example.com')
  })
})
