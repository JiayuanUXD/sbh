import { describe, expect, it } from 'vitest'

import {
  getRecentInquiries,
  inquiryDetailRoute,
} from '../miniprogram/services/inquiry-tracker.js'
import {
  parseUserAssets,
  type UserAssets,
} from '../miniprogram/services/user-assets.js'

function assetsWithInquiries(): UserAssets {
  return parseUserAssets({
    counts: { favorites: 0, inquiries: 3 },
    favorites: { listings: [], buildings: [] },
    inquiries: [
      {
        targetType: 'listing',
        targetSlug: 'jing-an-100',
        targetTitle: '静安中心 100㎡',
        submittedAt: '2026-09-04T09:10:00.000Z',
        status: { value: 'following', label: '跟进中' },
      },
      {
        targetType: 'building',
        targetSlug: 'jing-an-center',
        targetTitle: '静安中心',
        submittedAt: '2026-09-04T09:00:00.000Z',
        status: { value: 'new', label: '新建' },
      },
      {
        targetType: 'general',
        targetSlug: null,
        targetTitle: '通用找房需求',
        submittedAt: '2026-09-04T08:00:00.000Z',
        status: { value: 'pending_assignment', label: '待分配' },
      },
    ],
  })
}

describe('服务端咨询记录投影', () => {
  it('只从 /me 已确认资产读取历史并支持限制条数', () => {
    const assets = assetsWithInquiries()

    expect(getRecentInquiries(assets, 2).map((item) => item.targetType)).toEqual([
      'listing',
      'building',
    ])
  })

  it('房源与楼盘分别导航真实详情，general 不伪造详情', () => {
    const [listing, building, general] = assetsWithInquiries().inquiries

    expect(listing && inquiryDetailRoute(listing)).toBe('/pages/listing-detail/index?slug=jing-an-100')
    expect(building && inquiryDetailRoute(building)).toBe('/pages/building-detail/index?slug=jing-an-center')
    expect(general && inquiryDetailRoute(general)).toBeNull()
  })

  it.each([
    { key: 'phone', value: '13800000000' },
    { key: 'openid', value: 'openid-secret' },
    { key: 'lead', value: 42 },
    { key: 'idempotencyKey', value: 'private-key' },
  ])('拒绝服务端夹带 PII 或内部字段 $key', ({ key, value }) => {
    const payload = {
      counts: { favorites: 0, inquiries: 0 },
      favorites: { listings: [], buildings: [] },
      inquiries: [],
      [key]: value,
    }

    expect(() => parseUserAssets(payload)).toThrow('invalid user assets response')
  })

  it('拒绝 general 伪造 slug 与未知服务端状态', () => {
    const base = {
      counts: { favorites: 0, inquiries: 1 },
      favorites: { listings: [], buildings: [] },
    }

    expect(() => parseUserAssets({
      ...base,
      inquiries: [{
        targetType: 'general',
        targetSlug: 'fake-detail',
        targetTitle: '通用需求',
        submittedAt: '2026-09-04T08:00:00.000Z',
        status: { value: 'new', label: '新建' },
      }],
    })).toThrow('invalid user assets response')

    expect(() => parseUserAssets({
      ...base,
      inquiries: [{
        targetType: 'listing',
        targetSlug: 'jing-an-100',
        targetTitle: '静安中心 100㎡',
        submittedAt: '2026-09-04T08:00:00.000Z',
        status: { value: 'assigned', label: '顾问已分配' },
      }],
    })).toThrow('invalid user assets response')
  })

  it('拒绝合法状态 value 携带不一致或伪造的服务端 label', () => {
    expect(() => parseUserAssets({
      counts: { favorites: 0, inquiries: 1 },
      favorites: { listings: [], buildings: [] },
      inquiries: [{
        targetType: 'listing',
        targetSlug: 'jing-an-100',
        targetTitle: '静安中心 100㎡',
        submittedAt: '2026-09-04T08:00:00.000Z',
        status: { value: 'following', label: '顾问已分配' },
      }],
    })).toThrow('invalid user assets response')
  })

  it('穷尽接受本地权威的八种 Lead 状态标签', () => {
    const statuses = [
      { value: 'new', label: '新建' },
      { value: 'pending_assignment', label: '待分配' },
      { value: 'following', label: '跟进中' },
      { value: 'qualified', label: '有效商机' },
      { value: 'viewing', label: '带看' },
      { value: 'negotiation', label: '谈判' },
      { value: 'converted', label: '已转化' },
      { value: 'lost', label: '已流失' },
    ]
    const assets = parseUserAssets({
      counts: { favorites: 0, inquiries: statuses.length },
      favorites: { listings: [], buildings: [] },
      inquiries: statuses.map((status, index) => ({
        targetType: 'general',
        targetSlug: null,
        targetTitle: '通用找房需求',
        submittedAt: `2026-09-04T0${index}:00:00.000Z`,
        status,
      })),
    })

    expect(assets.inquiries.map((inquiry) => inquiry.status)).toEqual(statuses)
  })
})
