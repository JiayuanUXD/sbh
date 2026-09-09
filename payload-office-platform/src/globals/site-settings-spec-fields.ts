import type { Field, Tab } from 'payload'

import {
  BUILDING_SPEC_FIELDS,
  BUILDING_SPEC_GROUP_TITLES,
  LISTING_SPEC_FIELDS,
  LISTING_SPEC_GROUP_TITLES,
  type SpecFieldMeta,
} from '@/lib/frontend/detail-spec/fields'

/**
 * OPT-082：「站点设置 → 详情页参数」这一 tab 的字段树。
 *
 * ## 47 个开关**由 registry 生成**，不在本文件手抄一遍
 *
 * 手抄必然与 registry 漂移。本仓库在「同一判断逻辑存在多处」上已栽 7 次，
 * 同义清单是同一类问题的另一张脸：两份清单刚写完时一定是一致的，出问题的是
 * 三个月后只改了其中一份的那个人。
 * `tests/opt082-detail-spec-settings-coverage.test.ts` 在任何一侧漏项、多项、
 * 或 defaultValue 与 registry 不符时会红。
 *
 * ## 为什么是一堆 checkbox 而不是一个 hasMany select
 *
 * `select hasMany` 在后台是一个装着 47 个选项的下拉，运营要在里面找「得房率」；
 * checkbox 按语义组摊开，是一眼能扫完的清单。多出来的代价是 47 个 DB 列——
 * boolean 列在 PG 里没有成本，而「加字段要带迁移」本就是本仓库的既有约束
 * （`push: false`），不构成额外负担。
 *
 * ## 缺键与 NULL
 *
 * 这些列在存量行上是 NULL（迁移带了 default，但运营从未保存过时读到的仍可能是
 * 未定义）。**NULL 不等于关闭**——`isFieldVisible` 会落回 registry 的
 * `defaultVisible`，否则一次发版就能让新增字段集体消失，而后台显示的却是勾选态。
 */

/**
 * 费用披露类字段。运营**有权**关掉它们（本工作项的产品裁定：不做硬禁止），
 * 但要让他知道自己在关什么——删一条费用条款与删一条装修状态不是一个量级，
 * 前者是用户签约前必须知道、事后才发现会构成纠纷的那类信息。
 */
const COST_DISCLOSURE_KEYS: ReadonlySet<string> = new Set([
  'otherFixedCosts',
  'propertyFee',
  'parkingFee',
])

function checkboxesFor<G extends string>(
  fields: readonly SpecFieldMeta<G>[],
  groupId: G,
): Field[] {
  return fields
    .filter((field) => field.group === groupId)
    .map((field) => ({
      name: field.key,
      label: field.label,
      type: 'checkbox' as const,
      defaultValue: field.defaultVisible,
      ...(COST_DISCLOSURE_KEYS.has(field.key)
        ? { admin: { description: '费用条款，关闭前请确认合规口径。' } }
        : {}),
    }))
}

function sideGroup<G extends string>(
  name: 'building' | 'listing',
  label: string,
  fields: readonly SpecFieldMeta<G>[],
  groupTitles: Readonly<Record<G, string>>,
): Field {
  return {
    name,
    label,
    type: 'group',
    fields: (Object.keys(groupTitles) as G[]).map((groupId) => ({
      type: 'collapsible' as const,
      label: groupTitles[groupId],
      admin: { initCollapsed: false },
      fields: checkboxesFor(fields, groupId),
    })),
  }
}

export const detailSpecFieldsTab: Tab = {
  label: '详情页参数',
  description:
    '控制楼盘 / 房源详情页参数区展示哪些字段。取消勾选的字段整行不再出现；勾选了但该楼盘 / 房源没填值的，同样不显示这一行。保存后最长 60 秒全站生效。',
  fields: [
    {
      name: 'detailSpecFields',
      type: 'group',
      label: '参数展示',
      fields: [
        sideGroup('building', '楼盘详情页参数', BUILDING_SPEC_FIELDS, BUILDING_SPEC_GROUP_TITLES),
        sideGroup('listing', '房源详情页参数', LISTING_SPEC_FIELDS, LISTING_SPEC_GROUP_TITLES),
      ],
    },
  ],
}
