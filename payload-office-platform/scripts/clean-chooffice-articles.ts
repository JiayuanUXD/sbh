/**
 * 清洗 ChoOffice 导入资讯正文里的「来源 / 图片 / 联系方式」（OPT-100，一次性）
 *
 * 背景：生产 100 篇资讯全部是 `chooffice-*` 导入件（2026-08-08 批），正文 Lexical JSON 里带着：
 *   - 来源行：每篇末节点 `???ChoOffice?https://www.chooffice.com/NNNN.html?`（导入时乱码了的「来源」）
 *   - 图片：`upload` 节点（96 篇 / 255 张），全部引用 Media
 *   - 联系方式：ChoOffice 的招商电话（`13774382509` 王经理 177 次、`021-51306070` 9 次、
 *     `13764512981` 3 次；还有 `137-7438-2509` 这种带连字符的写法），散落在「招商热线：」标题、
 *     「温馨提示…致电…」引用块、结尾段落、列表项，以及少数**正文段落里嵌一句**。
 *
 * 这是**改数据**不是改模板，页面模板本身没有「来源」字段。
 *
 * ## 规则（用户 2026-09-16 裁定：含电话的整个节点删掉，混排块只抠号码段）
 *
 *   1. `upload` 节点：一律删除（递归，含嵌套）。封面 `coverImage` 是独立字段，**不动**。
 *   2. 来源：文本命中 `chooffice.com` / `ChoOffice` 的节点整个删除。
 *      例外：整篇就是 ChoOffice 软文的（标题带「-上海找办公室网」），删段落只会留下残骸——
 *      这类**不在本脚本处理范围**，由 `--plan` 报告单独列出，建议下架而不是改写。
 *   3. 联系方式，按节点「以联系为主」还是「混排」分两档：
 *      - **整节点删**：heading（任意级）只要含电话或联系标题词；paragraph / quote 去掉电话与
 *        联系词后剩余文本 ≤ `RESIDUAL_MAX` 字；list 的 listitem 含电话则删该项，list 空了删整个 list。
 *      - **只抠一行 / 一句**：paragraph / quote 剩余文本仍然很长（是正文里嵌了一句联系方式），
 *        按 `\n` 先拆行（导入件用的是文本内 `\n`，不是 linebreak 节点）、再按 `。！；` 拆句，
 *        只删含电话或联系词的那些行 / 句。
 *      - 只有联系词、没有电话的「壳」：heading 命中 `CONTACT_HEADING` 删；短 paragraph / quote
 *        （≤ `SHELL_MAX` 字）命中 `CONTACT_SHELL` 删；长的按句抠。
 *   4. 收尾：删掉只剩空文本的节点；连续 `horizontalrule` 合并成一条、首尾的 hr 去掉；
 *      「空章节」——heading 之后直到下一个同级或更高级 heading / 文末之间没有任何内容节点——删掉
 *      （典型是「八、立即入驻 XX」下面只有联系方式，联系方式删光后标题悬空）。
 *
 * 所有删改都进 `CleanReport`，`--plan` 把它渲染成逐篇 Markdown 供人过目，**不看报告不写库**。
 *
 * ## 用法
 *
 *   pnpm node --env-file-if-exists=.env.local --import tsx scripts/clean-chooffice-articles.ts --plan --source=https://shangban.cc --out=<dir>
 *       只读：从公开 API 拉全部资讯，写 <dir>/report.md（人看）与 <dir>/plan.json（id → 新 content，机器用）
 *   pnpm node --env-file-if-exists=.env.local --import tsx scripts/clean-chooffice-articles.ts --execute --plan-file=<dir>/plan.json
 *       用 Payload Local API 按 plan.json 逐篇 update（走 afterChange 缓存失效钩子）。需要 DATABASE_URL。
 *
 * 生产库本机拿不到 DATABASE_URL；OPT-100 实际是拿 plan.json 经 CloudBase MCP 直接 UPDATE（见工作项），
 * 两条写路径吃的是同一份 plan.json，规则只有这一份实现。
 *
 * 幂等：对已清洗过的正文再跑一遍，report 为空、plan 不含该篇。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ─── 规则常量 ────────────────────────────────────────────────────────────────

/**
 * 电话：手机号允许「137-7438-2509」「137 7438 2509」这类分隔写法（生产实测有），
 * 座机 `021-51306070`。先把数字间的 `-`/空格去掉再匹配，见 `normalizeDigits`。
 */
const PHONE = /(?:1[3-9]\d{9})|(?:0\d{2,3}-?\d{7,8})|(?:400-?\d{3}-?\d{4})/
/** 来源：ChoOffice 域名或品牌名 */
const SOURCE = /chooffice\.com|ChoOffice|上海找办公室网/i
/** 以联系为目的的标题（含或不含电话都删） */
const CONTACT_HEADING = /联系方式|招商专线|招商热线|招商电话|租赁热线|预约看房|立即入驻|招商中心|恭候垂询|联系我们/
/** 联系「壳」：短段落里出现这些就是招商话术，不是内容 */
const CONTACT_SHELL =
  /致电|来电|垂询|联系.{0,6}经理|王经理|微信同号|已认证|招商热线|招商专线|招商电话|租赁热线|租赁咨询|看房时间|预约实地|预约线下|24h|24小时(?:直租|服务|专线|招商)|直租热线|直租专线/
/**
 * 招商话术词。含电话的句子按分句切开后，去掉电话分句，**剩下的分句再剥掉这些词**，
 * 若剩不下几个字就说明整句都是话术（「获取最新房源信息、定制方案及优惠政策」），整句删；
 * 剩得下（「年均出租率稳定95%，产业集聚效应突出」）才是被电话拖累的事实，保留。
 */
const CTA_WORDS = /温馨提示|强烈建议|有意向|负责人|立即|建议|直接|现在就|即刻|获取|最新房源|房源信息|报价|优惠|定制|方案|预约|欢迎|一对一|专属|了解|详情|面谈|咨询|政策|清单|信息|即可|随时|实地|看房|考察|服务|对接|提供|抢占|感受|亲临|亲鉴|体验|安排|全程|专员|经理|带看|户型|平面图|楼书|资料|独家|第一手|一次通话|开端/
/**
 * 分句边界：逗号、「·」、右括号之后；连续空格之间；联系关键词或「地址」之前；左括号之前
 * （「…核心位置（具体地址欢迎来电咨询：137…」括号里的电话不能把前面的位置一起带走）。
 */
const CLAUSE_BOUNDARY =
  /(?<=[，,·])|(?<=[）)])(?=[^，,。！!；;？?\s])|(?<=\s)(?=\s)|(?=\s?(?:招商电话|招商热线|招商专线|租赁热线|联系人|联系电话|王经理|项目地址|(?<!项目)地址|致电|欢迎))|(?=[（(])/
/** 分句剥掉话术词与标点后至少还有这么多字，才算「有实质内容」 */
const SUBSTANTIVE_MIN = 8
/** 「数字 + 单位」：有它的分句一律当事实，不做话术判定 */
const FACT_UNIT = /\d+(?:\.\d+)?\s*(?:元|㎡|平方米|米|%|万|层|号|年|㎡)/
/** 抠句子时的判据：句子里有电话，或有下面这些强联系词 */
const CONTACT_SENTENCE = /致电|垂询|王经理|微信同号|招商热线|招商专线|招商电话|租赁热线|租赁咨询|拨打|联系人/

/** paragraph / quote 去掉联系内容后剩余 ≤ 这么多字，视为「整节点就是联系方式」 */
export const RESIDUAL_MAX = 12
/** 只有联系词没电话的段落，≤ 这么多字才当壳删；更长的按句抠 */
export const SHELL_MAX = 40

// ─── Lexical 节点的最小类型 ──────────────────────────────────────────────────

export type LexicalNode = {
  type: string
  tag?: string
  text?: string
  children?: LexicalNode[]
  [key: string]: unknown
}
export type LexicalRoot = { root: LexicalNode }

export type Removal = {
  kind: 'upload' | 'source' | 'contact-node' | 'contact-line' | 'empty-heading' | 'already-empty-heading' | 'hr'
  /** 顶层节点序号（改动前） */
  index: number
  nodeType: string
  /** 被删的文本（line 级是那一行；node 级是整节点文本），截断到 160 字 */
  text: string
}

export type CleanReport = {
  removals: Removal[]
  /** 整篇是 ChoOffice 软文，未处理，建议下架 */
  advertorial: boolean
}

// ─── 文本工具 ────────────────────────────────────────────────────────────────

export function textOf(node: LexicalNode): string {
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'linebreak') return '\n'
  return (node.children ?? []).map(textOf).join('')
}

/** 「137-7438-2509」→「13774382509」，只处理数字之间的 - 与空格 */
function normalizeDigits(s: string): string {
  return s.replace(/(?<=\d)[-\s](?=\d)/g, '')
}
function hasPhone(s: string): boolean {
  return PHONE.test(normalizeDigits(s))
}
/** 去掉电话与联系词之后还剩多少「内容」 */
function residual(s: string): string {
  return normalizeDigits(s)
    .replace(new RegExp(PHONE.source, 'g'), '')
    .replace(/[（(]已认证[^）)]*[）)]/g, '')
    .replace(/[（(]?微信同号[）)]?/g, '')
    .replace(new RegExp(CONTACT_SHELL.source, 'g'), '')
    .replace(/[\s：:｜|、，,。！!；;—–-]+/g, '')
}
const clip = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 160)
/** 只数汉字、字母、数字（含 %），标点与空白不算 */
const contentLength = (s: string) => s.replace(/[^\u4e00-\u9fa5A-Za-z0-9%]/g, '').length

// ─── 行 / 句级抠除 ───────────────────────────────────────────────────────────

/**
 * 在一个 paragraph / quote 内删掉含联系方式的行与句，其余原样保留（含 text 的 format 等属性）。
 *
 * 实现取舍：导入件的一个节点通常只有 1~3 个 text 子节点，行用 `\n` 分。这里把每个 text 子节点
 * 按行拆开逐行判断，行内再按句拆。跨 text 子节点的句子不处理（实测没有这种情况：电话所在的句子
 * 与它前后的加粗片段属于同一个 text 或各自独立成句）。
 */
function stripContactLines(node: LexicalNode): { changed: boolean; removedLines: string[] } {
  const removedLines: string[] = []
  const nextChildren: LexicalNode[] = []
  for (const child of node.children ?? []) {
    if (child.type !== 'text' || typeof child.text !== 'string') {
      nextChildren.push(child)
      continue
    }
    const lines = child.text.split('\n')
    const kept: string[] = []
    for (const line of lines) {
      if (!hasPhone(line) && !CONTACT_SENTENCE.test(line)) {
        kept.push(line)
        continue
      }
      // 行里有联系内容：按句再切一层，命中的句子再按分句切。丢掉含电话 / 联系词的分句，
      // 剩下的分句剥掉话术词后还有实质内容才保留（否则整句都是招商话术，一起删）。
      // 生产实测的两个极端：「上海中海国际中心是…成熟甲级写字楼，年均出租率稳定95%，…，
      // 招商电话：137… 王经理。」——前面是事实要留；「温馨提示：强烈建议立即致电…，获取最新
      // 房源信息、定制方案及优惠政策。」——去掉电话后只剩话术，整句删，不留「获取最新房源信息。」残句。
      const sentences = line.split(/(?<=[。！!；;？?])/)
      const keptSentences = sentences.map((sentence) => {
        if (!hasPhone(sentence) && !CONTACT_SENTENCE.test(sentence)) return sentence
        const clauses = sentence.split(CLAUSE_BOUNDARY)
        // 三类分句要丢：含电话 / 含联系词 / 剥掉话术词后没剩几个字的纯话术（「获取最新房源信息、
        // 定制方案及优惠政策」「温馨提示：强烈建议有意向的企业负责人立即」）。
        // 逐个分句判，不能因为同一句里有一个实质分句就把话术分句一起带回来。
        // 只对**含话术词**的分句做剥词判定：「上海徐汇滨江 ·」「现房可看」这种不含话术词的短分句
        // 是事实摘要行里的正常条目，字少不等于话术。
        // 带「数字 + 单位」的分句（「统一报价2.5元/㎡/天」）是事实，哪怕里面有「报价」这种话术词。
        const isCtaOnly = (c: string) =>
          CTA_WORDS.test(c) && !FACT_UNIT.test(c) && contentLength(c.replace(new RegExp(CTA_WORDS.source, 'g'), '')) < SUBSTANTIVE_MIN
        const isContact = (c: string) => hasPhone(c) || CONTACT_SHELL.test(c) || isCtaOnly(c)
        const dropped = clauses.map(isContact)
        // 贴着被丢分句的 ≤2 字残段（「请」「地址」）跟着丢——它们是被切开的联系句的一部分，
        // 不是独立内容；迭代到收敛，让「（具体 | 地址 | 欢迎来电…」这种链整段塌掉。
        // 不贴着被丢分句的短标签（「核心 」「地址 」+ 后面跟着保留的地址）照常保留。
        for (let changed = true; changed; ) {
          changed = false
          clauses.forEach((c, i) => {
            if (dropped[i] || contentLength(c) > 2 || contentLength(c) === 0) return
            if (dropped[i - 1] || dropped[i + 1]) { dropped[i] = true; changed = true }
          })
        }
        // 两种残片也丢：① 纯标点（「（」「；」）——否则会拼出「交口，（；」；② 以左括号开头、
        // 而它后面那个分句是被丢的联系内容（「核心位置（具体 | 地址欢迎来电咨询：137…」）——
        // 括号体没了，开头的「（具体」就是孤儿。**不按字数丢**：「核心 」「地址 」这种两个字的
        // 标签是导入件用双空格分隔出来的正常分句。
        const solid: string[] = []
        const droppedHere: string[] = []
        clauses.forEach((c, i) => {
          if (dropped[i]) { droppedHere.push(c); return }
          if (contentLength(c) === 0) return
          if (/^\s*[（(]/.test(c) && dropped[i + 1]) { droppedHere.push(c); return }
          solid.push(c)
        })
        if (solid.length === 0) {
          // 整句都没了：报告里记整句，比记一堆分句碎片好读
          removedLines.push(clip(sentence))
          return ''
        }
        for (const c of droppedHere) removedLines.push(clip(c))
        // 被丢的分句如果是句尾，句号 / 分号会跟着走，前面保留的部分要把它接回来，
        // 否则下一句会粘上来（「…交口总建筑面积…」）。
        const terminator = sentence.match(/[。！!；;？?]\s*$/)?.[0] ?? ''
        const rest = solid.join('').replace(/[，,·（(\s]+$/, '')
        return rest && !/[。！!；;？?]\s*$/.test(rest) ? rest + terminator : rest
      })
      const rest = keptSentences.join('').trim()
      if (rest) kept.push(rest)
    }
    const text = kept.join('\n')
    if (text.trim()) nextChildren.push({ ...child, text })
  }
  if (removedLines.length === 0) return { changed: false, removedLines }
  node.children = nextChildren
  return { changed: true, removedLines }
}

// ─── 主清洗 ──────────────────────────────────────────────────────────────────

function isUpload(n: LexicalNode): boolean {
  return n.type === 'upload'
}
function headingLevel(n: LexicalNode): number {
  return n.type === 'heading' && typeof n.tag === 'string' ? Number(n.tag.replace('h', '')) || 6 : 0
}
/**
 * 「键值式标题」：`项目地址：上海闵行区金光路999号` 这种 h3——标题本身就是信息，
 * 不是章节名。空章节判定时它算内容（不会因为下面没段落被删），自己也不会被当空章节删。
 */
function isKeyValueHeading(n: LexicalNode): boolean {
  if (n.type !== 'heading') return false
  const t = textOf(n)
  // 「项目地址：xxx」键值式；「南京西路1717号|270米超甲级地标|九龙仓集团开发」竖线 / 圆点分隔的
  // 事实摘要；「4.5-5.5元/㎡/天 · 现房可看」带数量单位——都是信息不是章节名
  return /[：:]\s*\S/.test(t) || /[|｜·]/.test(t) || /\d+(?:\.\d+)?\s*(?:㎡|平方米|米|元|号|层|万|年)/.test(t)
}
function isContentNode(n: LexicalNode): boolean {
  if (n.type === 'horizontalrule') return false
  if (n.type === 'heading') return isKeyValueHeading(n)
  return textOf(n).trim().length > 0 || n.type === 'upload'
}

/**
 * 清洗一篇正文。**不修改入参**，返回新的 root 与报告。
 * `advertorial: true` 时不做任何改动（返回原样），由调用方决定下架。
 */
export function cleanArticleContent(
  content: LexicalRoot,
  opts: Readonly<{ title?: string }> = {},
): { content: LexicalRoot; report: CleanReport } {
  const report: CleanReport = { removals: [], advertorial: false }
  if (opts.title && /上海找办公室网/.test(opts.title)) {
    report.advertorial = true
    return { content, report }
  }
  const root = structuredClone(content.root)
  const src = root.children ?? []
  const out: LexicalNode[] = []

  src.forEach((node, index) => {
    // 1) 图片
    if (isUpload(node)) {
      report.removals.push({ kind: 'upload', index, nodeType: node.type, text: '' })
      return
    }
    // 递归清掉嵌套的 upload（list 里理论上没有，防御一下）
    const stripNestedUploads = (n: LexicalNode) => {
      if (!n.children) return
      const before = n.children.length
      n.children = n.children.filter((c) => !isUpload(c))
      if (n.children.length !== before) report.removals.push({ kind: 'upload', index, nodeType: n.type, text: '(nested)' })
      n.children.forEach(stripNestedUploads)
    }
    stripNestedUploads(node)

    const text = textOf(node)

    // 2) 来源
    if (SOURCE.test(text)) {
      report.removals.push({ kind: 'source', index, nodeType: node.type, text: clip(text) })
      return
    }

    // 3) 联系方式
    if (node.type === 'heading') {
      if (hasPhone(text) || CONTACT_HEADING.test(text)) {
        report.removals.push({ kind: 'contact-node', index, nodeType: `heading/${node.tag}`, text: clip(text) })
        return
      }
      out.push(node)
      return
    }
    if (node.type === 'list') {
      const items = node.children ?? []
      const keptItems = items.filter((item) => {
        const t = textOf(item)
        const bad = hasPhone(t) || (CONTACT_SHELL.test(t) && residual(t).length <= RESIDUAL_MAX)
        if (bad) report.removals.push({ kind: 'contact-node', index, nodeType: 'listitem', text: clip(t) })
        return !bad
      })
      if (keptItems.length === 0) return
      node.children = keptItems
      out.push(node)
      return
    }
    if (node.type === 'paragraph' || node.type === 'quote') {
      const phone = hasPhone(text)
      const shell = CONTACT_SHELL.test(text)
      if (phone || shell) {
        const rest = residual(text)
        const trimmed = text.trim()
        // 无电话、只有联系词的「壳」：以冒号收尾的引导句（「…可直接联系官方招商经理：」，
        // 后面那个电话节点会被删，它就悬空了）、或很短的一行（「招商负责人：王经理」）→ 整节点删；
        // 更长的（「78㎡至1500㎡精装空间，欢迎预约实地看房…」这种带事实的营销段）走句级，
        // 只删含强联系词的那几句——「欢迎预约实地看房」不是联系方式，用户要去掉的是号码与
        // 「找谁 / 怎么联系」，不是所有招商话术。
        // 短行整删要求出现**强联系词**（致电 / 垂询 / 王经理 / 拨打…）：「上海星光耀广场甲级写字楼
        // 持续招商中，高区景观层可预约实地考察。」只有「预约实地」，是营销收尾不是联系方式，留着。
        const shellWhole =
          !phone && (/[：:]\s*$/.test(trimmed) || (trimmed.length <= SHELL_MAX && CONTACT_SENTENCE.test(trimmed)))
        // 残余里还有「数字 + 单位」（「统一报价2.5元/㎡/天，招商热线：…」）就不是整节点联系方式，
        // 交给下面的分句逻辑只抠电话那半句。
        const wholeNode = phone ? rest.length <= RESIDUAL_MAX && !FACT_UNIT.test(rest) : shellWhole
        if (wholeNode) {
          report.removals.push({ kind: 'contact-node', index, nodeType: node.type, text: clip(text) })
          return
        }
        const { changed, removedLines } = stripContactLines(node)
        if (changed) {
          // 按句抠完发现整节点空了（典型：「温馨提示：…立即致电…获取最新房源信息」整段都是
          // 招商话术，残余判据没抓住但句级判据抓住了）——报告里按「整节点删」记，
          // 审阅者看到的才是真实发生的事。
          if (!textOf(node).trim()) {
            report.removals.push({ kind: 'contact-node', index, nodeType: node.type, text: clip(text) })
            return
          }
          for (const line of removedLines) report.removals.push({ kind: 'contact-line', index, nodeType: node.type, text: line })
        }
      }
      out.push(node)
      return
    }
    out.push(node)
  })

  // 4a) FAQ 里「A：…」是联系方式被删掉后，紧挨着的「Q：…」会悬空——一起删。
  //     判据：源序列里 Q 的下一个节点是以 A 开头的、且它没有出现在输出里。
  const removedSrc = new Set(src.filter((n) => !out.includes(n)))
  for (let i = out.length - 1; i >= 0; i--) {
    const n = out[i]
    if (!/^Q\d*\s*[：:]/.test(textOf(n).trim())) continue
    const next = src[src.indexOf(n) + 1]
    if (next && removedSrc.has(next) && /^A\d*\s*[：:]/.test(textOf(next).trim())) {
      report.removals.push({ kind: 'contact-node', index: src.indexOf(n), nodeType: `${n.type} (orphan Q)`, text: clip(textOf(n)) })
      out.splice(i, 1)
    }
  }

  // 4b) 收尾：空章节 → 连续 hr → 首尾 hr
  // 空章节判定分两种记账：本次删图 / 删联系方式之后才空的，和**导入时就空的**（生产实测
  // 「灵活空间方案」「已入驻核心企业矩阵」这类 h3 下面直接接下一个同级标题，疑似导入丢了表格）。
  // 两者都删——留一个光秃秃的标题是同一个视觉缺陷——但报告里分开写，审阅者能看出哪些
  // 不是本次清洗引起的。
  const sectionHasContent = (list: LexicalNode[], i: number): boolean => {
    const level = headingLevel(list[i])
    for (let j = i + 1; j < list.length; j++) {
      const lv = headingLevel(list[j])
      if (lv > 0 && lv <= level) break
      if (isContentNode(list[j])) return true
    }
    return false
  }
  const pruned: LexicalNode[] = []
  for (let i = 0; i < out.length; i++) {
    const n = out[i]
    if (headingLevel(n) > 0 && !isKeyValueHeading(n) && !sectionHasContent(out, i)) {
      const srcIndex = src.indexOf(n)
      const wasEmptyBefore = srcIndex >= 0 && !sectionHasContent(src, srcIndex)
      report.removals.push({
        kind: wasEmptyBefore ? 'already-empty-heading' : 'empty-heading',
        index: srcIndex,
        nodeType: `heading/${n.tag}`,
        text: clip(textOf(n)),
      })
      continue
    }
    pruned.push(n)
  }
  const final: LexicalNode[] = []
  for (const n of pruned) {
    if (n.type === 'horizontalrule') {
      const prev = final[final.length - 1]
      if (!prev || prev.type === 'horizontalrule') { report.removals.push({ kind: 'hr', index: src.indexOf(n), nodeType: 'horizontalrule', text: '' }); continue }
    }
    final.push(n)
  }
  while (final.length && final[final.length - 1].type === 'horizontalrule') {
    const n = final.pop()!
    report.removals.push({ kind: 'hr', index: src.indexOf(n), nodeType: 'horizontalrule', text: '' })
  }

  root.children = final
  return { content: { root }, report }
}

// ─── CLI ────────────────────────────────────────────────────────────────────

type ArticleDoc = { id: number; slug: string; title: string; status: string; content: LexicalRoot | null }

async function fetchAll(source: string): Promise<ArticleDoc[]> {
  const all: ArticleDoc[] = []
  for (let page = 1; ; page++) {
    const r = (await fetch(`${source}/api/articles?limit=100&page=${page}&depth=0`).then((x) => x.json())) as {
      docs: ArticleDoc[]
      hasNextPage: boolean
    }
    all.push(...r.docs)
    if (!r.hasNextPage) break
  }
  return all
}

function renderReport(rows: Array<{ doc: ArticleDoc; report: CleanReport; before: number; after: number }>): string {
  const lines: string[] = ['# OPT-100 清洗计划（dry-run）', '']
  const totals: Record<string, number> = {}
  let touched = 0
  const ads: string[] = []
  for (const { doc, report } of rows) {
    if (report.advertorial) ads.push(`${doc.slug} | ${doc.title}`)
    if (report.removals.length) touched++
    for (const r of report.removals) totals[r.kind] = (totals[r.kind] ?? 0) + 1
  }
  lines.push(`- 篇数：${rows.length}，有改动：${touched}`)
  lines.push(`- 删除计数：${JSON.stringify(totals)}`)
  if (ads.length) {
    lines.push('', '## ⚠ 整篇 ChoOffice 软文（未处理，建议下架）', '', ...ads.map((a) => `- ${a}`))
  }
  lines.push('', '## 说明', '',
    '- `contact-node`：整节点删；`contact-line`：只抠了含联系方式的那一行 / 一句，其余保留',
    '- `empty-heading`：本次删掉图 / 联系方式后才空的章节标题；`already-empty-heading`：**导入时就是空的**（下面直接接同级标题），顺手一并删',
    '- 键值式标题（`项目地址：xxx`）视为内容，不删')
  lines.push('', '## 逐篇', '')
  for (const { doc, report, before, after } of rows) {
    if (report.advertorial || report.removals.length === 0) continue
    lines.push(`### ${doc.slug} — ${doc.title}`, '', `节点 ${before} → ${after}`, '')
    for (const r of report.removals) {
      const t = r.text ? `：${r.text}` : ''
      lines.push(`- [${r.kind}] #${r.index} ${r.nodeType}${t}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

async function main(): Promise<void> {
  const args = new Map(process.argv.slice(2).map((a) => { const [k, v] = a.split('='); return [k, v ?? 'true'] }))
  if (args.has('--plan')) {
    const source = args.get('--source') ?? 'http://localhost:3717'
    const out = path.resolve(args.get('--out') ?? 'artifacts/opt-100-plan')
    fs.mkdirSync(out, { recursive: true })
    const docs = await fetchAll(source)
    const rows = docs
      .filter((d) => d.content)
      .map((doc) => {
        const { content, report } = cleanArticleContent(doc.content!, { title: doc.title })
        return { doc, content, report, before: doc.content!.root.children?.length ?? 0, after: content.root.children?.length ?? 0 }
      })
    const plan = rows
      .filter((r) => !r.report.advertorial && r.report.removals.length > 0)
      .map((r) => ({ id: r.doc.id, slug: r.doc.slug, content: r.content }))
    fs.writeFileSync(path.join(out, 'report.md'), renderReport(rows), 'utf8')
    fs.writeFileSync(path.join(out, 'plan.json'), JSON.stringify(plan), 'utf8')
    fs.writeFileSync(path.join(out, 'backup-before.json'), JSON.stringify(docs.map((d) => ({ id: d.id, slug: d.slug, content: d.content }))), 'utf8')
    console.log(`[opt-100] ${docs.length} 篇，计划改 ${plan.length} 篇；报告 ${path.join(out, 'report.md')}`)
    return
  }
  if (args.has('--execute')) {
    const planFile = args.get('--plan-file')
    if (!planFile) throw new Error('--execute 需要 --plan-file=<plan.json>')
    const plan = JSON.parse(fs.readFileSync(planFile, 'utf8')) as Array<{ id: number; slug: string; content: LexicalRoot }>
    const { getPayload } = await import('payload')
    const { default: config } = await import('../src/payload.config')
    const payload = await getPayload({ config })
    for (const p of plan) {
      await payload.update({ collection: 'articles', id: p.id, data: { content: p.content as never }, overrideAccess: true })
      console.log(`[opt-100] updated ${p.slug}`)
    }
    console.log(`[opt-100] done, ${plan.length} 篇`)
    return
  }
  console.error('用法见文件头注释：--plan 或 --execute')
  process.exit(2)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error('[opt-100] 未预期错误：', err)
    process.exit(1)
  })
}
