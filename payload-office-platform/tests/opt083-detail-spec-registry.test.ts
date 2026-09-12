import { describe, expect, it } from 'vitest'
import {
  BUILDING_SPEC_FIELDS,
  BUILDING_SPEC_GROUP_TITLES,
  LISTING_SPEC_FIELDS,
  LISTING_SPEC_GROUP_TITLES,
  isFieldVisible,
  resolveSpecVisibility,
} from '@/lib/frontend/detail-spec/fields'
import { BUILDING_SPEC_RESOLVERS } from '@/lib/frontend/detail-spec/building-rows'
import { LISTING_SPEC_RESOLVERS, formatSpecDate } from '@/lib/frontend/detail-spec/listing-rows'

/**
 * OPT-083 零变化守卫。
 *
 * registry 的默认可见集合，必须逐字等于改造前 `BuildingSpecPanel` /
 * `ListingOverviewPanel` 里那份硬编码行清单（组序、行序、标签全部对齐）。
 *
 * 本仓库两次「接线造成的静默内容删除」（楼盘详情页丢 6 条、房源详情页丢 5 条）
 * 都发生在这种「把清单从一处搬到另一处」的重构里，两次都是靠事后对账才发现。
 * 这条用例是能在重构当场挡住它的东西——漏一行、换一个标签、组内换序，都会先撞到这里。
 *
 * ⚠️ **它管不了组与组之间的先后**：下面 `actual` 的遍历顺序取自 `BUILDING_EXPECTED`
 * 自己，所以把 `BUILDING_SPEC_GROUP_TITLES` 的键序打乱它照样全绿（2026-09-10 变异测试
 * 实测）。组序由本文件末尾的「组序守卫」单独钉住，别把两者混为一谈。
 */
const BUILDING_EXPECTED: ReadonlyArray<readonly [string, readonly string[]]> = [
  [
    'structure',
    ['物业类型', '楼盘等级', '竣工年份', '总建筑面积', '总楼层', '标准层面积', '层高 / 净高', '得房率'],
  ],
  ['mep', ['客梯 / 货梯', '空调', '供电', '网络', '门禁', '电梯分区', '服务时间']],
  ['cost', ['物业费', '物业公司', '开发商', '停车位', '停车费']],
  ['qualification', ['认证', '可注册', '最小可租面积']],
]

describe('BUILDING_SPEC_FIELDS 零变化守卫', () => {
  it('默认可见项按组归并后，逐字等于改造前的硬编码行清单', () => {
    const visible = BUILDING_SPEC_FIELDS.filter((field) => field.defaultVisible)
    const actual = BUILDING_EXPECTED.map(([groupId]) => [
      groupId,
      visible.filter((field) => field.group === groupId).map((field) => field.label),
    ])
    expect(actual).toEqual(BUILDING_EXPECTED.map(([groupId, labels]) => [groupId, [...labels]]))
  })

  it('共 23 项，且 key 唯一', () => {
    expect(BUILDING_SPEC_FIELDS).toHaveLength(23)
    expect(new Set(BUILDING_SPEC_FIELDS.map((field) => field.key)).size).toBe(23)
  })

  it('楼盘侧全部默认可见（候选池 = 现状清单，无富余项）', () => {
    expect(BUILDING_SPEC_FIELDS.every((field) => field.defaultVisible)).toBe(true)
  })
})

const LISTING_EXPECTED: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['space', ['建筑面积', '套内参考面积', '得房率', '净层高', '工位估算', '房源楼层', '朝向', '可分割', '建筑形态']],
  ['terms', ['合同单价', '起租期', '押金', '付款方式']],
  ['delivery', ['装修状态', '家具', '交付时间', '可注册', '空调', '网络']],
  ['cost', ['物业费', '停车费', '发票', '其他固定费用']],
]

describe('LISTING_SPEC_FIELDS 零变化守卫', () => {
  it('默认可见项按组归并后，逐字等于改造前的硬编码行清单', () => {
    const visible = LISTING_SPEC_FIELDS.filter((field) => field.defaultVisible)
    const actual = LISTING_EXPECTED.map(([groupId]) => [
      groupId,
      visible.filter((field) => field.group === groupId).map((field) => field.label),
    ])
    expect(actual).toEqual(LISTING_EXPECTED.map(([groupId, labels]) => [groupId, [...labels]]))
  })

  it('共 25 项：23 项默认可见 + 「信息时效」2 项默认关闭（OPT-096 加「建筑形态」）', () => {
    expect(LISTING_SPEC_FIELDS).toHaveLength(25)
    expect(LISTING_SPEC_FIELDS.filter((field) => field.defaultVisible)).toHaveLength(23)
    const verification = LISTING_SPEC_FIELDS.filter((field) => field.group === 'verification')
    expect(verification.map((field) => field.label)).toEqual(['信息核验时间', '价格核验时间'])
    expect(verification.every((field) => field.defaultVisible)).toBe(false)
  })

  it('key 唯一', () => {
    expect(new Set(LISTING_SPEC_FIELDS.map((field) => field.key)).size).toBe(25)
  })
})

/**
 * 元数据（`fields.ts`，零 import、客户端安全）与取值函数（`*-rows.ts`，需要
 * `factGroups` 类型）分在两个文件，理由见 `fields.ts` 文件头。分开就有漂移风险
 * ——这两条用例是防漂移的钉子：每个 key 必须恰有一个 resolver，反之亦然。
 */
describe('resolver 覆盖守卫', () => {
  it('楼盘：key 与 resolver 一一对应', () => {
    expect(Object.keys(BUILDING_SPEC_RESOLVERS).sort()).toEqual(
      BUILDING_SPEC_FIELDS.map((field) => field.key).sort(),
    )
  })

  it('房源：key 与 resolver 一一对应', () => {
    expect(Object.keys(LISTING_SPEC_RESOLVERS).sort()).toEqual(
      LISTING_SPEC_FIELDS.map((field) => field.key).sort(),
    )
  })
})

describe('formatSpecDate', () => {
  it('ISO 串转成年-月-日', () => {
    // 断言用正则而不是定值：Date.parse 的 UTC 串按本地时区渲染，CI 与本机
    // 时区不同会让定值断言随机红。这条宽松是刻意的，不要「收紧」。
    expect(formatSpecDate('2026-03-14T00:00:00.000Z')).toMatch(/^2026-03-1[34]$/)
  })

  it('非法值与 null 都返回 null（不把 ISO 原串甩给用户）', () => {
    expect(formatSpecDate('不是日期')).toBeNull()
    expect(formatSpecDate(null)).toBeNull()
  })
})

/**
 * 组的**渲染顺序**守卫。
 *
 * 上面两条零变化用例遍历的是 `*_EXPECTED` 自己的顺序，所以它们只能证明「每组里有哪些行、
 * 行序对不对」，**证明不了组与组之间的先后**——把 `BUILDING_SPEC_GROUP_TITLES` 里
 * `structure` 与 `mep` 对调，那两条照样全绿。这是 2026-09-10 用变异测试当场打出来的缺口
 * （注入对调后 25 条用例无一变红），不是理论担心。
 *
 * 组序就是页面上那几个区块从上到下的顺序（`Object.keys` 保序，registry 不另存 order 字段），
 * 所以必须单独钉住。
 */
describe('组序守卫', () => {
  it('楼盘：GROUP_TITLES 的键序即渲染顺序，与零变化清单一致', () => {
    expect(Object.keys(BUILDING_SPEC_GROUP_TITLES)).toEqual(
      BUILDING_EXPECTED.map(([groupId]) => groupId),
    )
  })

  it('房源：GROUP_TITLES 的键序即渲染顺序，「信息时效」固定排在最后', () => {
    expect(Object.keys(LISTING_SPEC_GROUP_TITLES)).toEqual([
      ...LISTING_EXPECTED.map(([groupId]) => groupId),
      'verification',
    ])
  })

  it('组标题文案不被静默改掉', () => {
    expect(Object.values(BUILDING_SPEC_GROUP_TITLES)).toEqual([
      '建筑',
      '机电与设施',
      '费用与管理',
      '资质与运营',
    ])
    expect(Object.values(LISTING_SPEC_GROUP_TITLES)).toEqual([
      '面积与格局',
      '租赁条件',
      '交付与资质',
      '费用明细',
      '信息时效',
    ])
  })
})

/**
 * 「缺键 / NULL / 非 boolean 一律落回 registry 默认」的守卫。
 *
 * 这条不变量此前**零覆盖**：`opt083-detail-spec-fallback.test.ts` 测的是兜底常量，
 * 不是把 Global 原始行补成完整映射的那个函数。2026-09-10 变异测试把实现换成
 * `row[field.key] === true`（即缺键 ⇒ 关闭），全量单测**一条都没红**。
 *
 * 它失守的症状极难查：发版新增候选项后前台该字段集体消失，而后台显示的却是勾选态
 * ——两边说法不一致，且没有任何报错。
 */
describe('resolveSpecVisibility：缺键与 NULL 不等于关闭', () => {
  const FIELDS = [
    { key: 'onByDefault', defaultVisible: true },
    { key: 'offByDefault', defaultVisible: false },
  ] as const

  it('整个原始行缺失（Global 还没有这一段）→ 全部落回各自默认', () => {
    for (const raw of [undefined, null, 'not-an-object', 42]) {
      expect(resolveSpecVisibility(raw, FIELDS), String(raw)).toEqual({
        onByDefault: true,
        offByDefault: false,
      })
    }
  })

  it('单个 key 缺失 / 为 NULL → 落回该字段自己的默认，不是一律 false', () => {
    expect(resolveSpecVisibility({ offByDefault: true }, FIELDS)).toEqual({
      onByDefault: true,
      offByDefault: true,
    })
    expect(resolveSpecVisibility({ onByDefault: null }, FIELDS)).toEqual({
      onByDefault: true,
      offByDefault: false,
    })
  })

  it('显式 false 被尊重（运营确实关掉了）', () => {
    expect(resolveSpecVisibility({ onByDefault: false }, FIELDS).onByDefault).toBe(false)
  })

  it('registry 之外的孤儿键被丢弃（配置比代码新，例如回滚后）', () => {
    expect(resolveSpecVisibility({ someRemovedKey: true }, FIELDS)).toEqual({
      onByDefault: true,
      offByDefault: false,
    })
  })

  it('与 isFieldVisible 是同一条规则（两个调用形状不得分叉）', () => {
    for (const field of FIELDS) {
      for (const raw of [undefined, null, true, false, 'x']) {
        const viaMap = resolveSpecVisibility({ [field.key]: raw }, FIELDS)[field.key]
        const viaPredicate = isFieldVisible(field, { [field.key]: raw } as never)
        expect(viaMap, `${field.key} / ${String(raw)}`).toBe(viaPredicate)
      }
    }
  })
})
