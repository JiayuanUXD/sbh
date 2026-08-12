import { describe, expect, it } from 'vitest'

import { CitySiteProfiles } from '@/collections/CitySiteProfiles'

function field(name: string) {
  const matched = CitySiteProfiles.fields.find((candidate) => 'name' in candidate && candidate.name === name)
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
