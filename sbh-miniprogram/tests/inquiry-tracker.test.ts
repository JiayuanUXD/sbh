import { describe, expect, it } from 'vitest'

import {
  getRecentInquiries,
  inquiryDetailRoute,
} from '../miniprogram/services/inquiry-tracker.js'
import {
  parseUserAssets,
  type UserAssets,
} from '../miniprogram/services/user-assets.js'

const COMPLETE_PAGE_INFO = {
  favorites: { limit: 200, hasMore: false },
  inquiries: { limit: 100, hasMore: false },
} as const

function assetsWithInquiries(): UserAssets {
  return parseUserAssets({
    counts: { favorites: 0, inquiries: 3 },
    pageInfo: COMPLETE_PAGE_INFO,
    favorites: { listings: [], buildings: [] },
    inquiries: [
      {
        targetType: 'listing',
        targetSlug: 'jing-an-100',
        targetTitle: '静安中心 100㎡',
        submittedAt: '2026-09-04T09:10:00.000Z',
        status: { value: 'following', label: '顾问跟进中' },
      },
      {
        targetType: 'building',
        targetSlug: 'jing-an-center',
        targetTitle: '静安中心',
        submittedAt: '2026-09-04T09:00:00.000Z',
        status: { value: 'new', label: '已提交' },
      },
      {
        targetType: 'general',
        targetSlug: null,
        targetTitle: '通用找房需求',
        submittedAt: '2026-09-04T08:00:00.000Z',
        status: { value: 'pending_assignment', label: '已提交' },
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
      pageInfo: COMPLETE_PAGE_INFO,
      favorites: { listings: [], buildings: [] },
      inquiries: [],
      [key]: value,
    }

    expect(() => parseUserAssets(payload)).toThrow('invalid user assets response')
  })

  it('拒绝 general 伪造 slug 与未知服务端状态', () => {
    const base = {
      counts: { favorites: 0, inquiries: 1 },
      pageInfo: COMPLETE_PAGE_INFO,
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

  // OPT-117：本地表仍是展示文案的唯一事实源，伪造 / 不一致的服务端 label 永远不上屏；
  // 但不再因此判整份响应无效——只改措辞就让「咨询记录」整块加载失败，代价不对等。
  it('合法状态 value 携带不一致或伪造的服务端 label 时，显示本地文案', () => {
    const assets = parseUserAssets({
      counts: { favorites: 0, inquiries: 1 },
      pageInfo: COMPLETE_PAGE_INFO,
      favorites: { listings: [], buildings: [] },
      inquiries: [{
        targetType: 'listing',
        targetSlug: 'jing-an-100',
        targetTitle: '静安中心 100㎡',
        submittedAt: '2026-09-04T08:00:00.000Z',
        status: { value: 'following', label: '顾问已分配' },
      }],
    })
    expect(assets.inquiries[0]?.status).toEqual({ value: 'following', label: '顾问跟进中' })
  })

  it('服务端 label 仍须是非空字符串（形状校验不放宽）', () => {
    expect(() => parseUserAssets({
      counts: { favorites: 0, inquiries: 1 },
      pageInfo: COMPLETE_PAGE_INFO,
      favorites: { listings: [], buildings: [] },
      inquiries: [{
        targetType: 'listing',
        targetSlug: 'jing-an-100',
        targetTitle: '静安中心 100㎡',
        submittedAt: '2026-09-04T08:00:00.000Z',
        status: { value: 'following', label: '' },
      }],
    })).toThrow('invalid user assets response')
  })

  it('穷尽接受本地权威的八种状态，文案是给客户看的（OPT-117）', () => {
    const statuses = [
      { value: 'new', label: '已提交' },
      { value: 'pending_assignment', label: '已提交' },
      { value: 'following', label: '顾问跟进中' },
      { value: 'qualified', label: '顾问跟进中' },
      { value: 'viewing', label: '已安排看房' },
      { value: 'negotiation', label: '洽谈中' },
      { value: 'converted', label: '已完成' },
      { value: 'lost', label: '已结束' },
    ]
    const assets = parseUserAssets({
      counts: { favorites: 0, inquiries: statuses.length },
      pageInfo: COMPLETE_PAGE_INFO,
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
