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

/** 行的当前命中项：activeValue 必须能在 options 里找到才算数——防御性，避免陈旧参数误显示 chip。 */
function findActiveOption(row: FilterRow): FilterRow['options'][number] | undefined {
  if (row.activeValue == null) return undefined
  return row.options.find((option) => option.value === row.activeValue)
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
}>): React.JSX.Element {
  const { rows, basePath, currentParams, totalCount, countNoun, clearAllHref } = props
  const visibleRows = rows.filter((row) => row.options.length > 0)
  const picks: readonly ActivePick[] = visibleRows.reduce<ActivePick[]>((acc, row) => {
    const option = findActiveOption(row)
    if (option) acc.push({ row, option })
    return acc
  }, [])

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
      <div className="ls-filterc__footer">
        <span className="ls-filterc__count">{totalCount} {countNoun}符合条件</span>
        {picks.length > 0 ? (
          <>
            <span className="ls-filterc__divider" aria-hidden="true" />
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
