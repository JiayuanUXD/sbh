import Link from 'next/link'
import React from 'react'

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
 */

export type FilterRow = Readonly<{
  key: string
  label: string
  options: ReadonlyArray<Readonly<{ value: string; label: string; count?: number }>>
  activeValue?: string
}>

type ActivePick = Readonly<{ row: FilterRow; option: FilterRow['options'][number] }>

/** 克隆 currentParams：统一入口，避免各处直接 new 出来时忘记带上已有参数。 */
function cloneParams(currentParams: URLSearchParams): URLSearchParams {
  return new URLSearchParams(currentParams)
}

function toHref(basePath: string, sp: URLSearchParams): string {
  const qs = sp.toString()
  return qs ? `${basePath}?${qs}` : basePath
}

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
  const sp = cloneParams(currentParams)
  sp.delete('page')
  sp.delete(rowKey)
  if (!isActive) sp.set(rowKey, optionValue)
  return toHref(basePath, sp)
}

/** 底栏已选 chip 的 × ：清除这一行的参数（与再点已选项同一语义，独立导出便于复用）。 */
function buildClearRowHref(basePath: string, currentParams: URLSearchParams, rowKey: string): string {
  const sp = cloneParams(currentParams)
  sp.delete('page')
  sp.delete(rowKey)
  return toHref(basePath, sp)
}

/** 底栏「清除全部」：一次性删掉所有可见行的参数。 */
function buildClearAllHref(basePath: string, currentParams: URLSearchParams, rows: readonly FilterRow[]): string {
  const sp = cloneParams(currentParams)
  sp.delete('page')
  for (const row of rows) sp.delete(row.key)
  return toHref(basePath, sp)
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
}>): React.JSX.Element {
  const { rows, basePath, currentParams, totalCount, countNoun } = props
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
            {/* 传 rows（完整列表）而非 visibleRows：某行候选数当前恰好归零会被隐藏
                （见下方渲染用的 visibleRows），但它的 key 仍可能残留在 currentParams
                里（真实场景：Task 11/12 按当前筛选算 facet，某维度算出 0 候选是正常
                结果，不代表这一维度没有选中值）。清除全部必须把 URL 彻底清空，用
                visibleRows 会漏删这类隐藏行的参数，「清除全部」名不副实。 */}
            <Link href={buildClearAllHref(basePath, currentParams, rows)} className="ls-filterc__clear-all">
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
