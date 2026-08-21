import { publicCertificationsText } from '@/components/frontend/detail/BuildingSpecPanel'
import { factMagnitude, findFact } from '@/components/frontend/detail/fact-lookup'
import type { NoImageMetaItem } from '@/components/frontend/detail/NoImageHeroGrid'
import type { SpecRow } from '@/components/frontend/detail/SpecTable'
import type { BuildingDetailViewModel } from '@/domain/public-catalog'

/**
 * 楼盘详情页「无图替代构图」的字段选定（OPT-037 Task 10b）。
 *
 * 为什么需要它：本地库实测 `buildings_media_items` / `buildings_gallery` 都是
 * 0 行——**每一个**楼盘详情页当前都在渲染那块 776×240 的灰底占位。与房源详情
 * 页同一判断（见 `DetailGallery.tsx` 文件头）：没有图就换构图，不摆空占位。
 *
 * 为什么单独一个纯函数模块而不是写在 `BuildingDetailLayout` 里：下面这份字段
 * 清单是**一个会被后来者"顺手改回去"的设计决定**（见下条），必须有测试锁住；
 * 而 `BuildingDetailLayout` 拖着 RichText / InquiryModal 一大串 client 组件，
 * 不适合被单测直接 import。`BuildingSpecPanel` 的 `buildBuildingSpecGroups`
 * 是同一个模式。
 *
 * ── 六格为什么是这六个（走完了「已有 DTO → mapper → collection」三层判定） ──
 * 第 1 层就够用：六项全部来自 `building.factGroups`（`mapBuildingFactGroups`
 * 已产出），无一项需要新增映射，也无一项去解析拼好后缀的展示串——数值走
 * `factMagnitude`，它的「数值 / 单位」两半由 mapper 的 `fact()` 与 `value`
 * 同源产出（见 contracts.ts `FactValue`）。
 *
 * 选字段的硬约束**不是"哪些字段最重要"，而是"右边 32px 之外还没说过什么"**：
 * `HeroSummaryPanel` 就在同一行的右列，已经渲染着 地址 / 地铁 / 以及
 * `HERO_FACT_LABELS`（建筑面积 · 竣工时间 · 物业公司 · 物业费 · 层高 · 总楼层）
 * 里命中的最多 5 条。把「总建筑面积 / 竣工年份 / 层高」放进宫格 = 同一屏里
 * 把同一个数字排两遍（1023 以下两列还会上下紧挨着）。所以这六格刻意避开那份
 * 清单**整体**（含它在别的字段缺失时才会命中的「总楼层」），取的是右栏说不到、
 * 又真能帮人判断"值不值得约看"的维度：产品形态 / 整层可用面积 / 得房率 /
 * 电梯 / 车位 / 能不能落公司。
 *
 * **不要"按稿子补回" 等级 / 竣工年份 / 总建筑面积 / 层高**——它们不是漏了，
 * 是右栏与标题栏副标已经在说；`tests/building-no-media-fallback.test.ts` 锁着
 * 这份清单。
 *
 * 「客梯」不与「货梯」拼成一格（不像 `BuildingSpecPanel` 的 `combineFacts` 那样
 * 排成 "6 部 / 1 部"）：宫格是「32px 数值 + 独立单位」的版式，拼接串拆不出
 * 单位，1440 下一格只有 216px、375 下 124px，实测会拦腰折行。首屏一眼要看的
 * 是客梯数（等梯时长），货梯在「楼盘参数」里照旧完整。
 */
const KEY_SPECS: ReadonlyArray<{ label: string; factLabel: string }> = [
  { label: '物业类型', factLabel: '物业类型' },
  { label: '标准层面积', factLabel: '标准层面积' },
  { label: '得房率', factLabel: '得房率' },
  { label: '客梯', factLabel: '客梯' },
  { label: '停车位', factLabel: '停车位' },
  // 标签用「可注册」，与 `BuildingSpecPanel` 同一字段那一行保持一致——同一个
  // 字段在同一页出现两次不能叫两个名字。
  { label: '可注册', factLabel: '注册能力' },
]

export function buildBuildingNoMediaKeySpecs(
  building: Pick<BuildingDetailViewModel, 'factGroups'>,
): readonly SpecRow[] {
  return KEY_SPECS.map(({ label, factLabel }) => ({
    label,
    // 命中不到的事实一律 `value: null`，由 `NoImageHeroGrid` 渲染 —，
    // **不是 0**，也不隐藏该格（缺失本身是信息，见 SpecTable 文件头）。
    ...(factMagnitude(findFact(building.factGroups, factLabel)) ?? { value: null }),
  }))
}

/**
 * 底条两格同样按「右栏没说过」挑：
 *   - 「楼盘简介」= `building.summary`。它在 DTO 里一直有，改版后**整页没有
 *     任何地方渲染它**（`HeroSummaryPanel` 不读，参数区放的是富文本
 *     `description`）——正是没有照片时最该补上的那句"这栋楼是什么调性"。
 *     mapper 对缺失给的是 `''` 不是 null，这里显式归一，让组件渲染 — 而不是
 *     一格空白。
 *   - 「认证」复用 `publicCertificationsText`（已过滤 publicVisible + 有效期），
 *     不在这里另拼一遍 join——那正是本项目栽过 7 次的「同一判断多处」。
 *
 * 刻意**不**放「地址 / 交通」：那是房源详情页那一份的内容，在楼盘页它们就在
 * 右侧信息面板里，重复一遍只是噪音（见 `NoImageHeroGrid` 文件头）。
 */
export function buildBuildingNoMediaMeta(
  building: Pick<BuildingDetailViewModel, 'summary' | 'amenityGroups'>,
): readonly NoImageMetaItem[] {
  return [
    { label: '楼盘简介', value: building.summary.trim() || null },
    { label: '认证', value: publicCertificationsText(building.amenityGroups) },
  ]
}
