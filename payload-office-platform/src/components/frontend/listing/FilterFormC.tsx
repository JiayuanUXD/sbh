import { NavLink } from '@/components/frontend/listing/ListingNavigation'
import React from 'react'
import { buildFilterOptionHref, buildHref, cloneSearchParams } from '@/lib/frontend/listing-url'
import { XMarkIcon } from '@/components/frontend/ui/icons'

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
 *     `buildFilterOptionHref`（同一行内选项互斥、再点已选项即清除）与
 *     `listing-url.ts` 的 `buildPriceUnitHref`（`priceUnit` 永远 `set`，没有
 *     「清除」这个合法状态）语义不同，**刻意没有合并**——理由见该文件顶部注释。
 *
 * OPT-103：底栏不再报「N 套符合条件」（计数在页头副题与工具条已有，三处同屏是
 * 噪音），且只在有已选条件时渲染；开关型行（楼盘页「仅看有在租」）随开关一起移除。
 */

export type FilterRow = Readonly<{
  key: string
  label: string
  options: ReadonlyArray<Readonly<{ value: string; label: string; count?: number }>>
  activeValue?: string
  /**
   * 级联清除（OPT-099）：改动或取消本行时一并删掉的其它 URL 键。
   *
   * 唯一消费方是「位置」行的 `['businessArea']`——商圈从属于行政区，切区后留着
   * 上一个区的商圈就是「静安 + 陆家嘴」这种恒空组合。声明在编排层
   * （`listing-filter-rows.ts`），组件不推导从属关系。
   */
  clearsKeys?: readonly string[]
}>

type ActivePick = Readonly<{ row: FilterRow; option: FilterRow['options'][number] }>

/**
 * 「生效了、但没有任何一行能显示出来」的条件（编排层算好交进来）。桌面筛选条底栏与
 * 移动抽屉（T17）用同一份：两处都只负责摆成可清除的 chip / pill，不推导。
 */
export type ExtraPick = Readonly<{ key: string; label: string; href: string }>

/* 单个选项的 href 走 `listing-url.ts` 的 `buildFilterOptionHref`——OPT-099 之前
   本文件与 `MobileFilterSheet.tsx` 各持有一份逐行相同的实现，收敛理由见那边注释。 */

/** 底栏已选 chip 的 × ：清除这一行的参数（与再点已选项同一语义，独立导出便于复用）。 */
function buildClearRowHref(
  basePath: string,
  currentParams: URLSearchParams,
  rowKey: string,
  alsoClear: readonly string[] = [],
): string {
  const sp = cloneSearchParams(currentParams)
  sp.delete('page')
  sp.delete(rowKey)
  // 与 `buildFilterOptionHref` 同一口径：清「位置」必须连商圈一起清，否则
  // 会留下一个所属行已经消失、只活在地址栏里的生效条件。
  for (const key of alsoClear) sp.delete(key)
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
 * 于是行 chip、补充 chip、底栏三处一起把一个正在生效的条件藏起来，底栏退化成
 * 「一个条件都没选」的空态（OPT-036 Task 12 第二轮审查抓到的真实缺陷）。
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

/**
 * 「已选 N 项」的唯一口径：**能被这套筛选控件显示出来的**已选行数。
 *
 * 两个消费者必须逐字同口径，否则同一屏上两个数字互相矛盾：
 * `MobileFilterSheet` 头部的「已选 N 项」与 `MobileFilterShell` 交给悬浮 pill 的
 * 徽标数就并排出现在移动端同一个视口里（抽屉打开时徽标仍在底栏后面）。
 *
 * 两条判据缺一不可（OPT-036 终审 I1）：
 *   - `options.length > 0`：无候选值的行整行不渲染（`visibleRows`），因此它上面
 *     的选中值一个字都显示不出来，不能算进「你能看见几个选中项」。这一条是
 *     结构性守卫，必须与 `visibleRows` 逐字同判据。
 *
 *     原先这里举的例子是 `?priceMax=6` 而没有 `priceUnit`（价格行的档位来自
 *     `PRICE_MAX_BUCKETS[priceUnit]`，没有单位就零候选）。那个 URL **已经不再是
 *     一个生效条件**：缺单位的价格区间在解析层就被整段丢弃了（见
 *     `search-params.ts#parseListingSearchInput`），因为跨计价单位比 amount 无意义。
 *     判据本身照留——它守的是「零候选行不计数」这条结构不变量，不是那一个 URL；
 *     直接的回归测试见 `tests/listing-price-unit-gate.test.ts` 里对本函数的单测。
 *   - `rowShowsActivePick`（而不是 `activeValue != null`）：数值维度解析层的取值域
 *     比 UI 档位宽，`?leasableAreaMin=750` / `?areaMin=750` 合法且真的收窄结果集，
 *     但 750 不等于任何一档，行内不会出现选中项。见 `findActiveOption` 的注释。
 *
 * 落在这两条之外的生效条件由编排层算成 `extraPicks`：桌面筛选条底栏补 chip，抽屉顶部
 * 「其他条件」一组补选中态 pill（TODOS T17，之前抽屉里根本看不见它们）。它们**计入**
 * 这个数——这个数说的仍是「抽屉里你能看见几个选中项」，只是从 T17 起抽屉真的能看见它们了。
 */
export function countActivePicks(
  rows: readonly FilterRow[],
  extraPicks: readonly ExtraPick[] = [],
): number {
  const shown = rows.filter((row) => row.options.length > 0 && rowShowsActivePick(row)).length
  return shown + extraPicks.length
}

export default function FilterFormC(props: Readonly<{
  rows: readonly FilterRow[]
  basePath: string
  currentParams: URLSearchParams
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
  extraPicks?: readonly ExtraPick[]
}>): React.JSX.Element {
  const { rows, basePath, currentParams, clearAllHref, extraPicks } = props
  const visibleRows = rows.filter((row) => row.options.length > 0)
  const picks: readonly ActivePick[] = visibleRows.reduce<ActivePick[]>((acc, row) => {
    const option = findActiveOption(row)
    if (option) acc.push({ row, option })
    return acc
  }, [])
  const hasPicks = picks.length > 0 || (extraPicks?.length ?? 0) > 0

  return (
    <div className="ls-filterc">
      {visibleRows.map((row) => (
        <div className="ls-filterc__row" key={row.key}>
          <span className="ls-filterc__label">{row.label}</span>
          <div className="ls-filterc__options">
            {row.options.map((option) => {
              const isActive = row.activeValue === option.value
              return (
                <NavLink
                  key={option.value}
                  href={buildFilterOptionHref(
                    basePath,
                    currentParams,
                    row.key,
                    option.value,
                    isActive,
                    row.clearsKeys,
                  )}
                  className={isActive ? 'ls-filterc__opt ls-filterc__opt--active' : 'ls-filterc__opt'}
                  // 高基数：一行内每个候选值都各自渲染一个 Link，Next 默认的 hover/
                  // 进入视口自动预取会对每个候选值都打一次查询（OPT-026 定的规矩，
                  // FilterBar.tsx 曾是唯一实现，随该文件在 Task 13 删除时一并转移到
                  // 这里——见 tests/listings-query-prefetch-performance.test.ts）。
                  prefetch={false}
                >
                  {option.label}
                  {option.count != null ? (
                    <span className="ls-filterc__opt-count">{option.count}</span>
                  ) : null}
                </NavLink>
              )
            })}
          </div>
        </div>
      ))}
      {hasPicks ? (
        <div className="ls-filterc__footer">
          {picks.map(({ row, option }) => (
            <NavLink key={row.key} href={buildClearRowHref(basePath, currentParams, row.key, row.clearsKeys)} className="ls-filterc__chip">
              {row.label}：{option.label}
              <span className="ls-filterc__chip-x" aria-hidden="true"><XMarkIcon size={10} /></span>
            </NavLink>
          ))}
          {(extraPicks ?? []).map((pick) => (
            <NavLink key={pick.key} href={pick.href} className="ls-filterc__chip">
              {pick.label}
              <span className="ls-filterc__chip-x" aria-hidden="true"><XMarkIcon size={10} /></span>
            </NavLink>
          ))}
          {/* href 由调用方给定：本组件收到的 rows 只是被渲染出来的那几行，不等于 URL 上真正生效的全部筛选维度。 */}
          <NavLink href={clearAllHref} className="ls-filterc__clear-all">清除全部</NavLink>
        </div>
      ) : null}
    </div>
  )
}
