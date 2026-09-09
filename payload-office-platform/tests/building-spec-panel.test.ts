import { describe, expect, it } from 'vitest'
import { buildBuildingSpecGroups } from '@/components/frontend/detail/BuildingSpecPanel'
import type { AmenityGroupViewModel, FactGroupViewModel, FactValue } from '@/domain/public-catalog'

/**
 * `buildBuildingSpecGroups` 是楼盘参数面板（OPT-037 Task 6）的纯函数分组
 * 逻辑——按标签从 `building.factGroups` 查值、两个既有字段拼一行（层高/
 * 净高、客梯/货梯）、从 `amenityGroups` 展示实际持有的认证列表、拼
 * 「竣工年份」。断点截图只能验证渲染结果，这里补上真正的分支覆盖：值
 * 存在 / 缺失渲染 null（不隐藏行）/ 组合行两值都在·只缺一半·都缺三种
 * 情形 / 认证列表单条·多条拼接·真正为空 / 竣工时间年份提取。
 *
 * 认证行 review 修正（见 BuildingSpecPanel.tsx 文件头注释）：不按名称
 * 匹配特定认证体系（如"LEED"），直接展示持有的全部公开认证——这里的用例
 * 特意包含"没有一条叫 LEED，但仍应正常展示"这一支，防止后来者把「按名称
 * 匹配」的写法当成"更贴合 comp"又加回来。
 */

function fact(label: string, value: string | null, estimated = false): FactValue {
  return { label, value, estimated, critical: false }
}

const BASE_FACT_GROUPS: readonly FactGroupViewModel[] = [
  {
    id: 'identity',
    title: '身份与注册',
    facts: [fact('楼宇等级', '甲级'), fact('注册能力', '支持注册')],
  },
  {
    id: 'building',
    title: '建筑信息',
    facts: [
      fact('竣工时间', '2013-01-01T00:00:00.000Z'),
      fact('总建筑面积', '108,000 ㎡'),
      fact('总楼层', '46 层'),
      fact('标准层面积', '2,400 ㎡'),
      fact('标准层高', '4.2 m'),
      fact('净层高', null),
    ],
  },
  {
    id: 'transport',
    title: '电梯与停车',
    facts: [fact('客梯', '18 部'), fact('货梯', null), fact('停车位', '620 个'), fact('停车费', null)],
  },
  {
    id: 'property',
    title: '开发物业',
    facts: [fact('物业公司', '嘉里物业'), fact('物业费', '28 元/㎡/月')],
  },
  {
    id: 'services',
    title: '楼宇服务',
    facts: [fact('空调', 'VAV + VRV 分户'), fact('供电', null), fact('网络', null)],
  },
]

const AMENITY_GROUPS_MULTI_CERT: readonly AmenityGroupViewModel[] = [
  { id: 'certifications', title: '认证', items: ['LEED 金级', '绿色建筑三星'] },
]

// 持有认证，但没有一条叫"LEED"——这是 review 修正要保护的核心情形：
// 不因为字符串不匹配就把该行渲染成 —。
const AMENITY_GROUPS_NON_LEED_CERT: readonly AmenityGroupViewModel[] = [
  { id: 'certifications', title: '认证', items: ['绿色建筑三星'] },
]

const AMENITY_GROUPS_NO_CERT: readonly AmenityGroupViewModel[] = [
  { id: 'certifications', title: '认证', items: [] },
]

describe('buildBuildingSpecGroups', () => {
  it('值存在时原样传给对应行', () => {
    const groups = buildBuildingSpecGroups(
      { factGroups: BASE_FACT_GROUPS, amenityGroups: AMENITY_GROUPS_MULTI_CERT },
      320,
    )
    const structureGroup = groups.find((g) => g.id === 'structure')
    expect(structureGroup?.rows.find((r) => r.label === '楼盘等级')?.value).toBe('甲级')
    expect(structureGroup?.rows.find((r) => r.label === '总建筑面积')?.value).toBe('108,000 ㎡')
  })

  // OPT-082 起规则反转：缺值的行不再渲染 — 而是整行不出现。
  // 裁定与已知代价见 specs/work-items/OPT-082-detail-spec-field-visibility.md §2 / §11。
  it('factGroups 里查不到值时，该行不出现（同组内有值的行照常在）', () => {
    const groups = buildBuildingSpecGroups(
      { factGroups: BASE_FACT_GROUPS, amenityGroups: AMENITY_GROUPS_MULTI_CERT },
      null,
    )
    const mepGroup = groups.find((g) => g.id === 'mep')
    expect(mepGroup?.rows.find((r) => r.label === '供电')).toBeUndefined()
    // 同组的「空调」有值，不受影响——过滤是逐行的，不是整组的
    expect(mepGroup?.rows.find((r) => r.label === '空调')?.value).toBe('VAV + VRV 分户')
  })

  it('竣工时间事实值（ISO 字符串）转成年份 + "年" 后缀', () => {
    const groups = buildBuildingSpecGroups(
      { factGroups: BASE_FACT_GROUPS, amenityGroups: AMENITY_GROUPS_MULTI_CERT },
      null,
    )
    const structureGroup = groups.find((g) => g.id === 'structure')
    expect(structureGroup?.rows.find((r) => r.label === '竣工年份')?.value).toBe('2013 年')
  })

  it('组合行：两个字段都在 → "A / B"', () => {
    const groups = buildBuildingSpecGroups(
      {
        factGroups: [
          ...BASE_FACT_GROUPS.filter((g) => g.id !== 'transport'),
          {
            id: 'transport',
            title: '电梯与停车',
            facts: [fact('客梯', '18 部'), fact('货梯', '2 部'), fact('停车位', '620 个'), fact('停车费', null)],
          },
        ],
        amenityGroups: AMENITY_GROUPS_MULTI_CERT,
      },
      null,
    )
    const mepGroup = groups.find((g) => g.id === 'mep')
    expect(mepGroup?.rows.find((r) => r.label === '客梯 / 货梯')?.value).toBe('18 部 / 2 部')
  })

  it('组合行：只缺一半 → 缺的一半渲染 —，不是整行消失', () => {
    const groups = buildBuildingSpecGroups(
      { factGroups: BASE_FACT_GROUPS, amenityGroups: AMENITY_GROUPS_MULTI_CERT },
      null,
    )
    const structureGroup = groups.find((g) => g.id === 'structure')
    // 「净层高」为 null，「标准层高」为 "4.2 m"
    expect(structureGroup?.rows.find((r) => r.label === '层高 / 净高')?.value).toBe('4.2 m / —')
  })

  it('组合行：两个字段都缺 → 整行 value 为 null（渲染 —）', () => {
    const factGroupsBothMissing: readonly FactGroupViewModel[] = [
      ...BASE_FACT_GROUPS.filter((g) => g.id !== 'transport'),
      {
        id: 'transport',
        title: '电梯与停车',
        facts: [fact('客梯', null), fact('货梯', null), fact('停车位', '620 个'), fact('停车费', null)],
      },
    ]
    const groups = buildBuildingSpecGroups(
      { factGroups: factGroupsBothMissing, amenityGroups: AMENITY_GROUPS_MULTI_CERT },
      null,
    )
    const mepGroup = groups.find((g) => g.id === 'mep')
    // OPT-082：两个字段都缺 → 整行 value 为 null → 该行不出现
    expect(mepGroup?.rows.find((r) => r.label === '客梯 / 货梯')).toBeUndefined()
  })

  it('认证：多条持有认证按 " · " 拼成一行展示，不挑一条丢其余的', () => {
    const groups = buildBuildingSpecGroups(
      { factGroups: BASE_FACT_GROUPS, amenityGroups: AMENITY_GROUPS_MULTI_CERT },
      null,
    )
    const qualificationGroup = groups.find((g) => g.id === 'qualification')
    expect(qualificationGroup?.rows.find((r) => r.label === '认证')?.value).toBe('LEED 金级 · 绿色建筑三星')
  })

  it('认证：持有认证但没有一条叫 "LEED"，仍原样展示（不因名称不匹配而渲染 —）', () => {
    const groups = buildBuildingSpecGroups(
      { factGroups: BASE_FACT_GROUPS, amenityGroups: AMENITY_GROUPS_NON_LEED_CERT },
      null,
    )
    const qualificationGroup = groups.find((g) => g.id === 'qualification')
    expect(qualificationGroup?.rows.find((r) => r.label === '认证')?.value).toBe('绿色建筑三星')
  })

  // 本条守的仍是「不做 LEED 名称匹配」那件事的另一半：真正没有认证时不能凭空
  // 编一个值出来。OPT-082 起「没有值」的呈现从 — 变成整行不出现。
  it('认证：真正没有任何认证（空数组）时该行不出现', () => {
    const groups = buildBuildingSpecGroups(
      { factGroups: BASE_FACT_GROUPS, amenityGroups: AMENITY_GROUPS_NO_CERT },
      null,
    )
    const qualificationGroup = groups.find((g) => g.id === 'qualification')
    expect(qualificationGroup?.rows.find((r) => r.label === '认证')).toBeUndefined()
  })

  it('最小可租面积：调用方传入数值时拼 "㎡" 后缀，传 null 时该行不出现', () => {
    const withArea = buildBuildingSpecGroups(
      { factGroups: BASE_FACT_GROUPS, amenityGroups: AMENITY_GROUPS_MULTI_CERT },
      320,
    )
    const withoutArea = buildBuildingSpecGroups(
      { factGroups: BASE_FACT_GROUPS, amenityGroups: AMENITY_GROUPS_MULTI_CERT },
      null,
    )
    const qualGroupWithArea = withArea.find((g) => g.id === 'qualification')
    const qualGroupWithoutArea = withoutArea.find((g) => g.id === 'qualification')
    expect(qualGroupWithArea?.rows.find((r) => r.label === '最小可租面积')?.value).toBe('320 ㎡')
    expect(qualGroupWithoutArea?.rows.find((r) => r.label === '最小可租面积')).toBeUndefined()
  })

  // OPT-082 起规则反转：整组无可见行时连组标题一起收掉。旧口径「组是固定行清单、
  // 不随数据完整度变化」被产品裁定推翻（见规格 §2 空值行一栏），保留一个只剩标题
  // 的空组在新规则下就是空货架。
  it('整组字段全缺时该组不出现（含组标题）', () => {
    const factGroupsMepAllMissing: readonly FactGroupViewModel[] = [
      ...BASE_FACT_GROUPS.filter((g) => g.id !== 'transport' && g.id !== 'services'),
      {
        id: 'transport',
        title: '电梯与停车',
        facts: [fact('客梯', null), fact('货梯', null), fact('停车位', '620 个'), fact('停车费', null)],
      },
      {
        id: 'services',
        title: '楼宇服务',
        facts: [fact('空调', null), fact('供电', null), fact('网络', null)],
      },
    ]
    const groups = buildBuildingSpecGroups(
      { factGroups: factGroupsMepAllMissing, amenityGroups: AMENITY_GROUPS_MULTI_CERT },
      null,
    )
    expect(groups.find((g) => g.id === 'mep')).toBeUndefined()
    // 其余有值的组不受影响——收起是逐组判断的，不是一荣俱荣
    expect(groups.map((g) => g.id)).toContain('structure')
  })

  /**
   * 守卫落在失效点：这 6 条事实 **comp 的 24 格里没有**，但 `mapBuildingFactGroups`
   * 一直在产出、改版前楼盘详情页的 `DetailFacts`（全量事实清单）一直在展示，
   * 真实种子数据里也都有值。OPT-037 Task 10 用本面板替换 `DetailFacts` 时，
   * 漏掉它们就是一次**接线造成的静默内容删除**——页面看不出少了东西，只有
   * 拿改版前后的字段清单逐条对账才发现。
   * 未来任何「按 comp 收敛参数表」的清理都会先撞到这条用例，而不是撞到用户。
   */
  it('保留 comp 未列、但域层与旧 DetailFacts 一直在展示的 6 条事实', () => {
    const factGroups: readonly FactGroupViewModel[] = [
      { id: 'identity', title: '身份与注册', facts: [fact('物业类型', '写字楼')] },
      { id: 'building', title: '建筑信息', facts: [fact('得房率', '70%')] },
      {
        id: 'transport',
        title: '电梯与停车',
        facts: [fact('分区说明', '低区 1-14 层 / 高区 15-28 层')],
      },
      { id: 'property', title: '开发物业', facts: [fact('开发商', '静安商务开发')] },
      {
        id: 'services',
        title: '楼宇服务',
        facts: [fact('门禁', '7×24 智能门禁'), fact('服务时间', '7×24')],
      },
    ]
    const rows = buildBuildingSpecGroups({ factGroups, amenityGroups: [] }, null)
      .flatMap((group) => group.rows)
    const byLabel = new Map(rows.map((row) => [row.label, row.value]))
    expect(byLabel.get('物业类型')).toBe('写字楼')
    expect(byLabel.get('得房率')).toBe('70%')
    expect(byLabel.get('电梯分区')).toBe('低区 1-14 层 / 高区 15-28 层')
    expect(byLabel.get('开发商')).toBe('静安商务开发')
    expect(byLabel.get('门禁')).toBe('7×24 智能门禁')
    expect(byLabel.get('服务时间')).toBe('7×24')
  })
})
