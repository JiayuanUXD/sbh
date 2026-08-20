import Link from 'next/link'
import React from 'react'
import { buildHref, cloneSearchParams } from '@/lib/frontend/listing-url'

/**
 * OPT-036 分行文本条件区（筛选形态 C）—— Server Component。
 *
 * 设计依据：docs/SBH设计任务讨论/房源列表.dc.html「筛选形态 C：分行文本条件区」
 * 区块 + specRows「形态 C 条件行/度量/选项/底栏」；楼盘列表.dc.html 明确标注
 * 「与房源列表同一套」，仅标签更长、行数不同（5 行：位置/等级/价格/在租面积/…）。
 *
 * 关键决策：
 *   - **不吸顶**：形态 C 是「结果比控件重要」的产品判断——随页面滚走，不占用
 *     结果区视口（见 specRows「筛选形态」：C 不吸顶，对照 A/B 都 sticky）。
 *   - **标签列宽度不硬编码 52/70**：容器用 CSS Grid 两列（`auto` + `minmax(0,1fr)`），
 *     每行外壳 `display:contents` 把 label/options 两个格子直接摊平进同一个网格，
 *     宽度由浏览器按当前 rows 里最长的 label 自动定宽——房源版 2 字标签自然收敛到
 *     约 52px，楼盘版 4 字标签自然收敛到约 70px，不需要新增 labelWidth 之类的 prop。
 *     行内选项列显式 `minmax(0, 1fr)` 而非裸 `1fr`——本批次踩过的坑：
 *     `1fr` 轨道默认 `min-width:auto`，某行选项一多会撑宽整列。
 *   - **行内选项是纯文本 `<a>`，不是 FilterPill**：选中 `--accent-link`/500，
 *     未选 `--ink`（specRows「形态 C 选项」）。FilterPill 零色相（黑底白字）
 *     服务的是另一类筛选入口（形态 A 常驻横条 / 移动筛选摘要），两套选中态
 *     配色刻意不同，见 FilterPill.tsx 顶部注释。
 *   - **URL 是唯一事实源**：每个选项的 href 由 `currentParams` 克隆后只改
 *     本行一个参数、并删除 `page`（切筛选必须回第一页，否则可能停在越界页码
 *     看到空结果）。再点已选项即取消——href 里不含该参数。
 *   - **无候选值的行不渲染**：一行只有标签没有选项，比不出现更让人困惑。
 *   - **`cloneSearchParams` / `buildHref` 从 `lib/frontend/listing-url.ts` 导入**：
 *     那两个是与本文件曾经私有的 `cloneParams` / `toHref` 逐行相同的原语，Task 7
 *     code review 时收敛过去，避免同目录多个组件各自维护一份相同实现。本文件的
 *     `buildOptionHref`（同一行内选项互斥、再点已选项即清除）与
 *     `listing-url.ts` 的 `buildPriceUnitHref`（`priceUnit` 永远 `set`，没有
 *     「清除」这个合法状态）语义不同，**刻意没有合并**——理由见该文件顶部注释。
 */

export type FilterRow = Readonly<{
  key: string
  label: string
  options: ReadonlyArray<Readonly<{ value: string; label: string; count?: number }>>
  activeValue?: string
}>

/**
 * 开关型筛选行（楼盘列表的「仅看有在租」）——最后一行，形态是 pill 内嵌开关。
 *
 * 设计依据：楼盘列表.dc.html specRows「开关 pill」：36 高 pill 内嵌 34×20 开关，
 * **本批次唯一用 accent 底的筛选项**。为什么它配得上这个例外：暂无在租的楼盘被
 * 降权分组到列表末尾（方案 A），这个开关是那条产品判断的正面出口——「不想看楼宇
 * 字典的人一键关掉」（comp 判断 F 原话）。其余筛选项一律零色相，别照着它再给
 * 第二个筛选项上 accent 底。
 *
 * 只支持「一个二元开关」，不是通用的多选行：href 由编排层算好（开→关 / 关→开
 * 都是同一个 href，因为它就是「切到另一个状态」），组件不推导。
 */
export type FilterSwitch = Readonly<{
  /** 左侧标签列文案，如「在租状态」。 */
  label: string
  /** 开关自身的文案，如「仅看有在租」。 */
  optionLabel: string
  /** 打开后的结果数；缺省或 <=0 不渲染数字（批次统一的「不显示 0」）。 */
  count?: number
  /** 切到另一个状态的目标地址，由编排层构造（与其它筛选项同一口径：删 page）。 */
  href: string
  active: boolean
  /**
   * 该开关占用的 URL 键。本组件不渲染它，编排层用它记账：判断「这个条件是不是
   * 已经被某个控件显示出来了」，从而决定要不要补一个 `extraPicks` chip。
   *
   * 历史：它原本是给移动抽屉的「重置」推导作用域用的（重置按 rows 的 key 逐个删，
   * 漏掉开关就会「重置完仍然只看有在租」）。那套推导已经删除——重置改为直接接收
   * 编排层算好的 `resetHref`，与两个「清除全部」共用同一个值，见
   * `MobileFilterSheet.resetHref` 注释。
   */
  paramKey: string
  /** 抽屉里的副行文案，如「26 / 68 个」；桌面 pill 不渲染它（那里只放计数）。 */
  subLabel?: string
}>

type ActivePick = Readonly<{ row: FilterRow; option: FilterRow['options'][number] }>

/**
 * 单个选项的 href：只改本行一个参数，删除 page。
 * isActive=true（再点已选项）时只删不写，等价于清除该行筛选。
 */
function buildOptionHref(
  basePath: string,
  currentParams: URLSearchParams,
  rowKey: string,
  optionValue: string,
  isActive: boolean,
): string {
  const sp = cloneSearchParams(currentParams)
  sp.delete('page')
  sp.delete(rowKey)
  if (!isActive) sp.set(rowKey, optionValue)
  return buildHref(basePath, sp)
}

/** 底栏已选 chip 的 × ：清除这一行的参数（与再点已选项同一语义，独立导出便于复用）。 */
function buildClearRowHref(basePath: string, currentParams: URLSearchParams, rowKey: string): string {
  const sp = cloneSearchParams(currentParams)
  sp.delete('page')
  sp.delete(rowKey)
  return buildHref(basePath, sp)
}

/**
 * 行的当前命中项：`activeValue` 必须能在 `options` 里找到才算数。
 *
 * 这个「命中」判据比 `activeValue != null` **严格**，而且差别是有后果的：
 * 数值型维度的解析层接受的取值域比 UI 预设档位宽得多（`?leasableAreaMin=750`
 * 完全合法、真的收窄结果集，但 750 不等于 500/1000/2000/5000 任何一档）。
 * 这种值不会渲染出行内 chip，因此**编排层判断「这一行是否已经把某个条件显示
 * 出来了」必须用同一个判据**——用 `activeValue != null` 会误判成「已显示」，
 * 于是行 chip、补充 chip、底栏三处一起把一个正在生效的条件藏起来，底栏还写着
 * 「未选的行保持『全部』」（OPT-036 Task 12 第二轮审查抓到的真实缺陷）。
 *
 * 导出而不是让调用方各写一份：本批次已经被「同一段逻辑存在多份」咬过好几次
 * （`MobileFilterSheet` 曾经自带一份同名副本，现已改为从这里导入）。
 */
export function findActiveOption(row: FilterRow): FilterRow['options'][number] | undefined {
  if (row.activeValue == null) return undefined
  return row.options.find((option) => option.value === row.activeValue)
}

/** 这一行是否会渲染出一个可见的已选 chip（编排层判断「条件是否已被显示」用同一判据）。 */
export function rowShowsActivePick(row: FilterRow): boolean {
  return findActiveOption(row) != null
}

export default function FilterFormC(props: Readonly<{
  rows: readonly FilterRow[]
  basePath: string
  currentParams: URLSearchParams
  totalCount: number
  /**
   * 底栏计数单位名词，拼成「N {countNoun}符合条件」——如 `套`（房源列表 →
   * 「168 套符合条件」）、`个楼盘`（楼盘列表 → 「24 个楼盘符合条件」）。
   *
   * 必填、无默认值：组件复用不等于文案复用，见
   * `src/components/frontend/city/CityListingsView.tsx` 的 `CHANNEL_COPY`
   * 及其顶部注释——同一套栅格换到出售频道，「在租房源」就是错的语境。
   * 房源列表.dc.html 写「N 套符合」，楼盘列表.dc.html 写「N 个楼盘」，两个
   * 页面本就不共享同一个名词；给个默认值只会把两者悄悄磨成一个通用词，
   * 且在未来接出售频道时继续读错语境。调用方（Task 11/12 接线）应从
   * `CHANNEL_COPY` 一类的集中文案表取值，不要在调用点写字面量。
   */
  countNoun: string
  /**
   * 底栏「清除全部」的目标地址，**由调用方给定，本组件不自行推导**。
   *
   * 曾经的实现是内部按 `rows` 逐个 `delete(row.key)`，即「清掉我渲染出来的这几行」。
   * 那个口径在接线后是错的（OPT-036 Task 11 审查发现）：编排层只把 4 行交给本组件
   * （位置 / 类型 / 价格上限 / 面积下限），而 URL 上真正生效的筛选维度有 8 个
   * （还有 `priceMin`、`areaMax`、`q`、`businessArea`、`metro`、`availableBefore`）。
   * 于是在空态②里，屏幕上会同时出现两个都叫「清除全部」的控件——筛选条底栏这个
   * 只清 4 个键，空态里那个清 8 个键——**同名不同义**：用户点了前者，仍然停在
   * 零结果页面上，且看不出为什么。
   *
   * 修法是把口径交给唯一知道完整维度清单的那一层（编排层），而不是让组件从它
   * 恰好收到的 `rows` 去猜。本组件仍然自己构造**单行**的清除 href（底栏 chip 的
   * `×` 与再点已选项），那是行级作用域，不存在歧义。
   */
  clearAllHref: string
  /** 开关型筛选行（楼盘页「仅看有在租」）；省略则不渲染这一行，见 `FilterSwitch`。 */
  switchRow?: FilterSwitch
  /**
   * 「生效了、但没有任何一行能显示出来」的条件，渲染成与行内 chip 同款的
   * 可清除 chip。
   *
   * 为什么需要这个口子：筛选行是**每行一个 URL 参数**的单选控件，而 URL 上
   * 合法的筛选状态不止这些——楼盘页的 `?leasableAreaMax=2000` 会被解析层收下、
   * 进 canonical、真的收窄结果集，却没有对应的行（那一行建模的是下限）。结果是
   * 底栏出现了「清除全部」（因为确实有条件生效），用户却看不到被清除的是什么。
   * 这类条件由编排层——唯一知道完整维度清单的那一层——算出来交进来，本组件
   * 只负责把它们摆成 chip，与 `clearAllHref` 的分工完全一致。
   */
  extraPicks?: ReadonlyArray<Readonly<{ key: string; label: string; href: string }>>
}>): React.JSX.Element {
  const { rows, basePath, currentParams, totalCount, countNoun, clearAllHref, switchRow, extraPicks } = props
  const visibleRows = rows.filter((row) => row.options.length > 0)
  const picks: readonly ActivePick[] = visibleRows.reduce<ActivePick[]>((acc, row) => {
    const option = findActiveOption(row)
    if (option) acc.push({ row, option })
    return acc
  }, [])
  // 开关打开时也算一个已选条件：否则「只开了开关」这种状态下底栏既不显示 chip
  // 也不显示「清除全部」，用户没有出口把它关掉（pill 本身可以再点一次关掉，但
  // 底栏说「每行单选，未选的行保持全部」就成了一句与屏幕不符的话）。
  const hasPicks = picks.length > 0 || switchRow?.active === true || (extraPicks?.length ?? 0) > 0

  return (
    <div className="ls-filterc">
      {visibleRows.map((row) => (
        <div className="ls-filterc__row" key={row.key}>
          <span className="ls-filterc__label">{row.label}</span>
          <div className="ls-filterc__options">
            {row.options.map((option) => {
              const isActive = row.activeValue === option.value
              return (
                <Link
                  key={option.value}
                  href={buildOptionHref(basePath, currentParams, row.key, option.value, isActive)}
                  className={isActive ? 'ls-filterc__opt ls-filterc__opt--active' : 'ls-filterc__opt'}
                >
                  {option.label}
                  {option.count != null ? (
                    <span className="ls-filterc__opt-count">{option.count}</span>
                  ) : null}
                </Link>
              )
            })}
          </div>
        </div>
      ))}
      {switchRow ? (
        <div className="ls-filterc__row">
          <span className="ls-filterc__label">{switchRow.label}</span>
          <div className="ls-filterc__options">
            {/* 导航链接，不是 <button>：状态写进 URL（与本页其它筛选项同一口径），
                因此当前态用 aria-current 而不是 aria-pressed——后者加在 role=link
                上是无效属性（Task 9 已全站清零，别在这里重新引入）。 */}
            <Link
              href={switchRow.href}
              aria-current={switchRow.active ? 'true' : undefined}
              className={
                switchRow.active
                  ? 'ls-filterc__switch ls-filterc__switch--on'
                  : 'ls-filterc__switch'
              }
            >
              <span className="ls-filterc__switch-track" aria-hidden="true">
                <span className="ls-filterc__switch-knob" />
              </span>
              {switchRow.optionLabel}
              {switchRow.count != null && switchRow.count > 0 ? (
                <span className="ls-filterc__switch-count sf-num">{switchRow.count}</span>
              ) : null}
            </Link>
          </div>
        </div>
      ) : null}
      <div className="ls-filterc__footer">
        <span className="ls-filterc__count">{totalCount} {countNoun}符合条件</span>
        {hasPicks ? (
          <>
            <span className="ls-filterc__divider" aria-hidden="true" />
            {switchRow?.active ? (
              <Link href={switchRow.href} className="ls-filterc__chip">
                {switchRow.label}：{switchRow.optionLabel}
                <span className="ls-filterc__chip-x" aria-hidden="true">×</span>
              </Link>
            ) : null}
            {picks.map(({ row, option }) => (
              <Link
                key={row.key}
                href={buildClearRowHref(basePath, currentParams, row.key)}
                className="ls-filterc__chip"
              >
                {row.label}：{option.label}
                <span className="ls-filterc__chip-x" aria-hidden="true">×</span>
              </Link>
            ))}
            {(extraPicks ?? []).map((pick) => (
              <Link key={pick.key} href={pick.href} className="ls-filterc__chip">
                {pick.label}
                <span className="ls-filterc__chip-x" aria-hidden="true">×</span>
              </Link>
            ))}
            {/* href 由调用方给定：本组件收到的 rows 只是被渲染出来的那几行，不等于
                URL 上真正生效的全部筛选维度——理由与那次「同一屏两个清除全部、作用域
                不同」的缺陷见 clearAllHref 的 prop 注释。 */}
            <Link href={clearAllHref} className="ls-filterc__clear-all">
              清除全部
            </Link>
          </>
        ) : (
          <span className="ls-filterc__hint">每行单选，选中即写入地址栏；未选的行保持「全部」</span>
        )}
      </div>
    </div>
  )
}
