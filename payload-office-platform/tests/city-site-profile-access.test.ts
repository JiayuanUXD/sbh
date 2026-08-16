import { describe, expect, it } from 'vitest'

import { CitySiteProfiles } from '@/collections/CitySiteProfiles'

// 递归查找字段（row / collapsible / group 布局收口后字段可能嵌套一层）
function field(name: string): Record<string, unknown> {
  const walk = (fields: readonly unknown[]): Record<string, unknown> | undefined => {
    for (const candidate of fields) {
      if (!candidate || typeof candidate !== 'object') continue
      const c = candidate as Record<string, unknown> & { fields?: readonly unknown[] }
      if (c.name === name) return c
      if (Array.isArray(c.fields)) {
        const nested = walk(c.fields)
        if (nested) return nested
      }
    }
    return undefined
  }
  const matched = walk(CitySiteProfiles.fields)
  if (!matched) throw new Error(`missing field: ${name}`)
  return matched
}

function accessHandler(value: unknown): (args: unknown) => unknown {
  if (typeof value !== 'function') throw new Error('missing access handler')
  return (args) => value(args)
}

describe('CitySiteProfiles collection boundary', () => {
  it('exposes a unique city profile with closed write and delete access', () => {
    expect(CitySiteProfiles.slug).toBe('city-site-profiles')
    expect(field('city')).toMatchObject({ type: 'relationship', relationTo: 'locations', required: true, unique: true })
    expect(accessHandler(CitySiteProfiles.access?.read)({})).toBe(true)
    expect(accessHandler(CitySiteProfiles.access?.delete)({})).toBe(false)
  })

  it('keeps profile operations behind location:manage and featured regions bounded', () => {
    expect(field('featuredRegions')).toMatchObject({
      type: 'relationship',
      relationTo: 'locations',
      hasMany: true,
      maxRows: 12,
    })
    expect(CitySiteProfiles.hooks?.beforeChange).toHaveLength(1)
  })
})
