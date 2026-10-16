import { describe, expect, it } from 'vitest'

import { mapArticleDetail } from '@/domain/public-catalog/mappers'

const city = (slug: string, overrides: Record<string, unknown> = {}) => ({
  id: slug === 'shanghai' ? 1 : 2, slug, name: slug === 'shanghai' ? '上海' : '苏州', type: 'city', status: 'active', ...overrides,
})
const area = (id: number, slug: string, overrides: Record<string, unknown> = {}) => ({
  id, slug, name: `区域${id}`, type: 'district', status: 'active', frontendVisible: true, city: city('shanghai'), ...overrides,
})
const article = (relatedDistricts: unknown[]) => ({ id: 1, slug: 'a', title: '文', relatedDistricts, relatedBuildings: [] })

describe('mapArticleDetail 的 relatedDistricts.citySlug', () => {
  it('取区域自己所属城市，而不是默认城市（非默认城市的区域也能拿到正确前缀）', () => {
    const vm = mapArticleDetail(article([area(10, 'xuhui'), area(11, 'gusu', { city: city('suzhou') })]))
    expect(vm?.relatedDistricts.map((d) => [d.slug, d.citySlug])).toEqual([['xuhui', 'shanghai'], ['gusu', 'suzhou']])
  })

  it.each([
    ['所属城市没填充（只有 id）', { city: 2 }],
    ['区域前台不可见', { frontendVisible: false }],
    ['区域已停用', { status: 'inactive' }],
    ['所属不是启用的规范城市', { city: city('shanghai', { status: 'inactive' }) }],
  ])('%s → citySlug 为 null（页面只显示名称，不生成会 404 的链接）', (_label, overrides) => {
    const vm = mapArticleDetail(article([area(10, 'xuhui', overrides)]))
    expect(vm?.relatedDistricts).toEqual([{ id: 10, slug: 'xuhui', name: '区域10', citySlug: null }])
  })
})
