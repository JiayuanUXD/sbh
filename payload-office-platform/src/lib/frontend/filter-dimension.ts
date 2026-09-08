/**
 * 筛选维度「已选文案」的唯一构造点 + 词表型取值的收口规则。
 *
 * ## 规则：URL 上的取值不是条件名
 *
 * 筛选维度分三类，展示口径各不相同：
 *
 *   1. **词表型**（`district` / `metro` / `businessArea` / `type` / `grade`）——URL 上是
 *      slug 或枚举值，用户看的是**名称**，而名称只能来自词表。词表里查不到的取值
 *      不是「一个叫这个名字的条件」，它只是一段任意字符串。
 *   2. **结构型**（价格 / 面积 / 日期 / 页码）——文案由解析后的数值生成，解析层已经
 *      做过边界校验，不存在原样回显的问题。
 *   3. **自由文本**（`q`）——取值本身就是内容，原样显示是正确的（解析层已 trim +
 *      100 字截断）。它不属于词表型，不适用下面这条规则。
 *
 * 对第 1 类，本模块只给一条硬规则：**查不到名称时返回 `null`，绝不回落成原始取值**。
 * 曾经的写法是 `districts.find((d) => d.slug === v)?.name ?? v`，于是
 * `?district=<任意字符串>` 会在筛选 chip 上印出「位置：<任意字符串>」、在空态②
 * 印出「取消『位置：<任意字符串>』这一个条件」——把用户自己都没写过的一段 URL
 * 输入当成一个行政区的名字展示给他看。不是 XSS（React 文本节点会转义，且这些位置
 * 都不进属性 / href），但任意取值都能得到一个 200 + 自指 canonical 的可索引页面，
 * 页面上印着构造者选定的文案，这一面本身就不该开着。
 *
 * ## 查不到名称之后怎么办：两条出路，取决于这一页能否判定「不存在」
 *
 *   - **有权威词表**（房源页的城市区域表、楼盘页查询层的全城 facet 全集）：查不到
 *     即「这个城市没有这个地方」，该取值**从查询与 UI 一起丢弃**（`keepKnownValues`），
 *     与解析层对 `type` / `sort` / `priceUnit` 的白名单同一裁定——非法参数静默降级，
 *     由 canonical 对外规范化（见 `domain/public-catalog/search-params.ts` 顶部注释）。
 *   - **没有权威词表**（房源页的 `metro` / `businessArea`：这一页从不加载地铁站 /
 *     商圈名表）：判定不了「不存在」，就**不能替用户丢掉一个真的在收窄结果集的条件**
 *     ——那会变成「URL 写着筛了、结果却是全量」。此时条件照旧生效、照旧可见可清除，
 *     只是 chip 上**不印取值**，只印维度名（`dimensionPickText` 的 `null` 分支）。
 *     两者共同的下限是同一条：任意输入不出现在文案里。
 */

/**
 * 词表型取值 → 名称。查不到返回 `null`。
 *
 * **不提供「回落成原始取值」的开关**：那正是本模块要消灭的写法。调用点拿到 `null`
 * 之后按上面两条出路之一处置，不要在调用点自己 `?? value` 补回来。
 */
export function vocabularyName(
  value: string | null | undefined,
  entries: readonly Readonly<{ slug: string; name: string }>[],
): string | null {
  if (value == null || value === '') return null
  return entries.find((entry) => entry.slug === value)?.name ?? null
}

/**
 * 枚举型取值 → 标签。查不到返回 `null`（同上，不回落成原始取值）。
 */
export function enumLabel(
  value: string | null | undefined,
  labels: Readonly<Record<string, string>>,
): string | null {
  if (value == null || value === '') return null
  return labels[value] ?? null
}

/**
 * 只保留词表里存在的取值；一个都不剩时返回 `undefined`（= 这个维度没有生效）。
 *
 * 返回 `undefined` 而不是空数组：`ListingSearchInput` 的可选数组字段全部以
 * 「缺省 = 未生效」建模，空数组会让 `if (input.district)` 之类的判空全部翻车
 * （`buildCanonicalSearchParams` 会输出零个值但 `if` 仍为真，`buildListingWhere`
 * 则会走进 `resolved.length === 0` 的空结果短路）。
 */
export function keepKnownValues(
  values: readonly string[] | undefined,
  known: ReadonlySet<string>,
): readonly string[] | undefined {
  if (!values || values.length === 0) return undefined
  const kept = values.filter((value) => known.has(value))
  return kept.length > 0 ? kept : undefined
}

/**
 * 已选条件的可读文案，chip 与空态②退路**共用同一份**。
 *
 * 之前这一段字面量在两个编排层（房源 / 楼盘）× 两个用途（chip / 退路）里各写一遍，
 * 共四份；本仓库已经因为「同一段判断存在多份副本」翻过车（见 `.agent/frontend.md`）。
 * 收成一处之后，`activeText` 为 `null` 的分支也就只需要在一个地方判对。
 *
 * @param label 维度中文名（「位置」「地铁」「租金」…）。
 * @param activeText 已解析出的取值文案；`null` 表示条件生效但叫不出名字，
 *   此时只印维度名——绝不在这里把原始取值补回来。
 */
export function dimensionPickText(label: string, activeText: string | null | undefined): string {
  return activeText == null ? label : `${label}：${activeText}`
}
