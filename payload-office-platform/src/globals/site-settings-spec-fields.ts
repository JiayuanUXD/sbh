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

/**
 * 一侧一个**顶层** group，组内按语义分组用 `collapsible` 分段。
 *
 * ## 为什么是顶层 group 而不是 `detailSpecFields` 再套 `building` / `listing`
 *
 * 跟着仓库既有形状走：全仓 5 处 `type: 'group'`（Buildings 的 developerAndScale /
 * verticalTransport / buildingServices / verificationInfo / seo）**都是 tab 下的
 * 顶层 group**，没有具名 group 套具名 group 的先例。本项最初写的是嵌套形状，
 * 走查中途改成了这个。
 *
 * ⚠️ **不要据此断言「Payload 3.86 不渲染嵌套 group」——那条结论没有立住。**
 * 当时的现象是后台一个 checkbox 都不渲染，我一度归因于嵌套；随后的对照实验
 * 推翻了它：**既有的「图片水印」group 在同一个页面上同样一个字段都不渲染**，
 * 根因是 worktree 里 `next dev` 的模块解析（Turbopack 直接
 * `Module not found: '@nouance/payload-better-fields-plugin/Number'`，
 * webpack 则静默只渲染外壳），与字段结构无关。最终验证是在 `next build` +
 * `next start` 的产物上做的。
 *
 * 换句话说：这个形状是「跟既有写法一致」的选择，不是「嵌套不可用」的结论。
 * 谁要改回嵌套，先在**产物**上验，别在 worktree 的 dev server 上验。
 *
 * ## 列名不受影响
 *
 * Payload 把 group 路径按下划线拼成列名，`detailSpecFields.building.grade` 与
 * `detailSpecFieldsBuilding.grade` 都落到 `detail_spec_fields_building_grade`。
 * 这一条是实测的：改形状后 `payload migrate:create` 报 “No schema changes
 * detected”，所以迁移没动。改名前先确认它仍成立。
 */
function sideGroup<G extends string>(
  name: 'detailSpecFieldsBuilding' | 'detailSpecFieldsListing',
  label: string,
  fields: readonly SpecFieldMeta<G>[],
  groupTitles: Readonly<Record<G, string>>,
): Field {
  return {
    name,
    label,
    type: 'group',
    fields: (Object.keys(groupTitles) as G[]).flatMap((groupId) => checkboxesFor(fields, groupId)),
  }
}

export const detailSpecFieldsTab: Tab = {
  label: '详情页参数',
  description:
    '控制楼盘 / 房源详情页参数区展示哪些字段。取消勾选的字段整行不再出现；勾选了但该楼盘 / 房源没填值的，同样不显示这一行。保存后最长 60 秒全站生效。',
  fields: [
    sideGroup(
      'detailSpecFieldsBuilding',
      '楼盘详情页参数',
      BUILDING_SPEC_FIELDS,
      BUILDING_SPEC_GROUP_TITLES,
    ),
    sideGroup(
      'detailSpecFieldsListing',
      '房源详情页参数',
      LISTING_SPEC_FIELDS,
      LISTING_SPEC_GROUP_TITLES,
    ),
  ],
}
