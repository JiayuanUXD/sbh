/**
 * OPT-100：ChoOffice 导入资讯正文清洗规则。
 *
 * 夹具按生产实测的节点形态造（见 scripts/clean-chooffice-articles.ts 文件头），
 * 每条规则一个用例，外加「不误伤」与「幂等」两条守护。
 */
import { describe, expect, it } from 'vitest'

import {
  cleanArticleContent,
  textOf,
  type LexicalNode,
  type LexicalRoot,
} from '../scripts/clean-chooffice-articles'

const t = (text: string, format = 0): LexicalNode => ({ type: 'text', text, format, version: 1 })
const p = (...children: LexicalNode[]): LexicalNode => ({ type: 'paragraph', version: 1, children })
const q = (...children: LexicalNode[]): LexicalNode => ({ type: 'quote', version: 1, children })
const h = (tag: string, text: string): LexicalNode => ({ type: 'heading', tag, version: 1, children: [t(text)] })
const hr = (): LexicalNode => ({ type: 'horizontalrule', version: 1 })
const up = (id: number): LexicalNode => ({ type: 'upload', relationTo: 'media', value: { id }, version: 1 })
const li = (text: string): LexicalNode => ({ type: 'listitem', version: 1, children: [t(text)] })
const ul = (...items: LexicalNode[]): LexicalNode => ({ type: 'list', tag: 'ul', listType: 'bullet', version: 1, children: items })
const doc = (...children: LexicalNode[]): LexicalRoot => ({ root: { type: 'root', version: 1, children } })
const kinds = (r: ReturnType<typeof cleanArticleContent>) => r.report.removals.map((x) => x.kind)
const texts = (r: ReturnType<typeof cleanArticleContent>) => (r.content.root.children ?? []).map(textOf)

describe('OPT-100 清洗：三类目标', () => {
  it('图片：upload 节点删掉，封面不归它管', () => {
    const r = cleanArticleContent(doc(p(t('正文')), up(17476), p(t('更多正文')), up(17480)))
    expect(kinds(r)).toEqual(['upload', 'upload'])
    expect(texts(r)).toEqual(['正文', '更多正文'])
  })

  it('来源：末尾的乱码 ChoOffice 行整节点删', () => {
    const r = cleanArticleContent(doc(p(t('正文')), hr(), p(t('???ChoOffice?https://www.chooffice.com/6346.html?'))))
    expect(kinds(r)).toContain('source')
    expect(texts(r)).toEqual(['正文'])
  })

  it('联系方式：整节点就是联系方式的 heading / paragraph / quote 删', () => {
    const r = cleanArticleContent(
      doc(
        h('h2', '八、下一步'),
        h('h3', '招商热线： 021-51306070'),
        h('h3', '招商专线： 13774382509（已认证）王经理'),
        p(t('招商电话：137-7438-2509（已认证） 王经理 ')),
        q(t('温馨提示 ：强烈建议有意向的企业负责人立即致电 021-51306070 / 13774382509 王经理 ，获取最新房源信息。')),
      ),
    )
    expect(texts(r)).toEqual([])
    // 「八、下一步」本身不是联系标题，是下面的联系节点删光后成了空章节被收尾删掉
    expect(kinds(r).filter((k) => k === 'contact-node')).toHaveLength(4)
    expect(kinds(r)).toContain('empty-heading')
  })

  it('联系方式：带连字符的手机号也认（137-7438-2509）', () => {
    const r = cleanArticleContent(doc(p(t('租赁热线：137-7438-2509（王经理，微信同号）'))))
    expect(texts(r)).toEqual([])
  })

  it('联系方式：list 里含电话的项删，list 空了整个删', () => {
    const r = cleanArticleContent(doc(ul(li('地铁 7 号线龙华中路站'), li('招商热线 13774382509 王经理')), ul(li('电话：021-51306070'))))
    expect(texts(r)).toEqual(['地铁 7 号线龙华中路站'])
  })
})

describe('OPT-100 清洗：混排块只抠一行 / 一句', () => {
  it('开头引用块按行抠：地址 / 面积 / 开发商保留，招商热线那一行删', () => {
    const r = cleanArticleContent(
      doc(q(t('地址 ：上海市黄浦区马当路159号\n总建筑面积 ：约90,000平方米\n开发商 ：瑞安房地产\n招商热线 ：13774382509（已认证）王经理'))),
    )
    expect(new Set(kinds(r))).toEqual(new Set(['contact-line']))
    expect(texts(r)).toEqual(['地址 ：上海市黄浦区马当路159号\n总建筑面积 ：约90,000平方米\n开发商 ：瑞安房地产'])
  })

  it('长正文段落里嵌了一句电话：只删那一句，其余原样', () => {
    const body = '坐落于长宁区华山路1568号的南丰大厦，由台湾三宝建设开发集团投资。大厦已形成成熟商务社区，现推出248㎡至1233㎡精装房源。'
    const r = cleanArticleContent(doc(p(t(body + '有意向的企业请致电 13774382509 王经理。'))))
    expect(new Set(kinds(r))).toEqual(new Set(['contact-line']))
    expect(texts(r)).toEqual([body])
  })

  it('一句里前半是项目事实、后半是电话：按逗号只丢电话分句，项目名与位置保留', () => {
    const r = cleanArticleContent(
      doc(q(t('项目标准名称为旭辉企业大厦（推广名CIFI TOWER），位于上海普陀区长寿路与常德路交口，招商直租热线13774382509（王经理）；总建筑面积约 6 万平方米。'))),
    )
    expect(texts(r)).toEqual(['项目标准名称为旭辉企业大厦（推广名CIFI TOWER），位于上海普陀区长寿路与常德路交口；总建筑面积约 6 万平方米。'])
  })

  it('纯招商话术的句子不按逗号切，整句删，不留「获取最新房源信息。」这种残句', () => {
    const r = cleanArticleContent(doc(p(t('项目已于2026年4月竣工。温馨提示：强烈建议有意向的企业负责人立即致电 13774382509 王经理，获取最新房源信息、定制方案及优惠政策。'))))
    expect(texts(r)).toEqual(['项目已于2026年4月竣工。'])
  })

  it('用「·」和空格分隔的事实摘要行：只丢末尾的电话段，事实保留', () => {
    const facts = '上海徐汇滨江 · 龙华板块核心 · 7/12号线龙华中路站步行约275米 · 2016年现房 260㎡-1700㎡灵活空间 · 租金5.0-8.5元/㎡/天'
    const r = cleanArticleContent(doc(p(t(facts + ' 招商电话：13774382509 王经理'))))
    // 「招商电话：137…」与「王经理」是两个分句，各记一条；关键是事实一字不丢
    expect(new Set(kinds(r))).toEqual(new Set(['contact-line']))
    expect(texts(r)[0].trim()).toBe(facts)
  })

  it('无电话的营销句不算联系方式：「欢迎预约实地看房」保留，「请致电垂询」那句删', () => {
    const r = cleanArticleContent(doc(p(t('78㎡至1500㎡精装空间，欢迎预约实地看房，亲鉴静安寺核心区商务高度。实时房源与楼层报价，请致电垂询。'))))
    expect(texts(r)).toEqual(['78㎡至1500㎡精装空间，欢迎预约实地看房，亲鉴静安寺核心区商务高度。'])
  })

  it('只有「预约实地看房」没有强联系词的短营销句不是联系方式，保留', () => {
    const r = cleanArticleContent(doc(p(t('上海星光耀广场甲级写字楼持续招商中，高区景观层、整层总部单位可预约实地考察。'))))
    expect(r.report.removals).toEqual([])
  })

  it('地址后面紧跟「致电即可…」：地址留，致电句走', () => {
    const r = cleanArticleContent(doc(p(t('项目地址：上海市闵行区虹桥商务区申昆路2377号虹桥国际展汇 致电即可获取最新房源清单、租金预算表'))))
    expect(texts(r)).toEqual(['项目地址：上海市闵行区虹桥商务区申昆路2377号虹桥国际展汇'])
  })

  it('以冒号收尾的联系引导句整段删（后面的电话节点没了它就悬空）', () => {
    const r = cleanArticleContent(doc(p(t('如需预约实地看房、获取详细租赁方案与定制化报价，可直接联系官方专属招商经理：')), p(t('招商热线：13774382509 王经理'))))
    expect(texts(r)).toEqual([])
  })

  it('FAQ：「A：」是联系方式被删后，紧挨的「Q：」一起删；正常问答不动', () => {
    const r = cleanArticleContent(
      doc(p(t('Q：租金多少？')), p(t('A：租金 5 元/㎡/天起。')), p(t('Q：怎么联系？')), p(t('A：可通过王经理联系，招商热线 13774382509。'))),
    )
    expect(texts(r)).toEqual(['Q：租金多少？', 'A：租金 5 元/㎡/天起。'])
  })

  it('事实段落末尾挂了个电话：事实全留，只丢电话（不靠事实词白名单）', () => {
    const facts = '上海中海国际中心 是上海新天地核心商务区的成熟甲级写字楼，年均出租率稳定95%，产业集聚效应突出，适合头部企业、跨国公司区域总部入驻'
    const r = cleanArticleContent(doc(p(t(facts + '， 招商电话：13774382509 王经理 。'))))
    expect(texts(r)).toEqual([facts + '。'])
  })

  it('括号里的电话不把前面的位置带走', () => {
    const r = cleanArticleContent(doc(p(t('建滔广场位于上海市长宁区虹桥临空经济园区核心位置（具体地址欢迎来电咨询：13774382509 王经理 微信同号）'))))
    expect(texts(r)).toEqual(['建滔广场位于上海市长宁区虹桥临空经济园区核心位置'])
  })

  it('信息式标题（竖线分隔 / 带单位）不当空章节删', () => {
    const r = cleanArticleContent(doc(h('h2', '南京西路1717号|270米超甲级地标|九龙仓集团开发'), up(1), h('h3', '4.5-5.5元/㎡/天 · 现房可看'), up(2), h('h3', '专属优惠政策'), up(3)))
    expect(texts(r)).toEqual(['南京西路1717号|270米超甲级地标|九龙仓集团开发', '4.5-5.5元/㎡/天 · 现房可看'])
  })

  it('「统一报价2.5元/㎡/天」有数字单位，是事实不是话术，哪怕含「报价」', () => {
    const r = cleanArticleContent(doc(q(t('统一报价2.5元/㎡/天，招商热线：13774382509 王经理。'))))
    expect(texts(r)).toEqual(['统一报价2.5元/㎡/天。'])
  })

  it('括号头被丢时括号尾巴不能留下来（「业主直租）！」）；「招商由…专员」「预约电话」这类引导也算联系', () => {
    const r = cleanArticleContent(
      doc(
        p(t('招商电话：13774382509（已认证，业主直租）！')),
        p(t('本次招商由资深企业服务专员王经理（13774382509）全程负责，为电商企业提供：')),
        p(t('招商售楼处官方预约电话（提前预约享内部优惠） 王经理：13774382509')),
        p(t('作为黄浦区亿元税收楼宇，上海中海国际中心正等待你共拓未来新蓝图。 招商电话：13774382509（已认证，招商直租）')),
      ),
    )
    expect(texts(r)).toEqual(['作为黄浦区亿元税收楼宇，上海中海国际中心正等待你共拓未来新蓝图。'])
  })

  it('保留 text 子节点的 format 等属性（加粗片段不丢样式）', () => {
    const r = cleanArticleContent(doc(p(t('项目定位：', 1), t('核心商务区甲级写字楼\n招商热线：13774382509 王经理'))))
    const children = r.content.root.children![0].children!
    expect(children[0]).toMatchObject({ text: '项目定位：', format: 1 })
    expect(children[1]).toMatchObject({ text: '核心商务区甲级写字楼' })
  })
})

describe('OPT-100 清洗：收尾', () => {
  it('删完之后连续的 hr 合并、文末 hr 去掉', () => {
    const r = cleanArticleContent(doc(p(t('A')), hr(), up(1), hr(), p(t('B')), hr(), p(t('???ChoOffice?https://www.chooffice.com/1.html?'))))
    expect(r.content.root.children!.map((n) => n.type)).toEqual(['paragraph', 'horizontalrule', 'paragraph'])
  })

  it('键值式标题（项目地址：xxx）本身是信息：不当空章节删，也让所在章节算有内容', () => {
    const r = cleanArticleContent(doc(h('h2', '五、基础信息'), h('h3', '项目地址：上海闵行区金光路999号'), h('h3', '招商热线：13774382509 王经理')))
    expect(texts(r)).toEqual(['五、基础信息', '项目地址：上海闵行区金光路999号'])
  })

  it('导入时就空的章节标题也删，但报告里单独记作 already-empty-heading', () => {
    const r = cleanArticleContent(doc(h('h3', '灵活空间方案'), h('h3', '租金水平'), p(t('每天 6 元'))))
    expect(texts(r)).toEqual(['租金水平', '每天 6 元'])
    expect(kinds(r)).toEqual(['already-empty-heading'])
  })

  it('章标题（六、…）的章延伸到下一个章标题，小节被导成同级 h2 也不会让它变成空章节', () => {
    const r = cleanArticleContent(
      doc(h('h2', '六、为什么选择西岸中环？'), h('h2', '战略价值：徐汇滨江 = 下一个陆家嘴'), p(t('徐汇滨江是核心段。')), h('h2', '七、常见问题'), p(t('Q：…'))),
    )
    expect(texts(r)[0]).toBe('六、为什么选择西岸中环？')
    expect(r.report.removals).toEqual([])
  })

  it('章下面是「1. 2. 3.」编号的 h3 小节 + 列表：章有内容，一个都不删', () => {
    const r = cleanArticleContent(
      doc(h('h2', '二、五大核心招商亮点'), h('h3', '1. 不可复制的区位优势'), ul(li('双枢纽加持：步行可达虹桥火车站')), h('h3', '2. 国际化甲级写字楼品质'), ul(li('层高 4.2 米')), h('h2', '三、租金')),
    )
    expect(r.report.removals.map((x) => x.kind)).toEqual(['already-empty-heading']) // 只有「三、租金」是真空的
    expect(texts(r)[0]).toBe('二、五大核心招商亮点')
    expect(texts(r)).toContain('1. 不可复制的区位优势')
  })

  it('章标题下面只有联系方式：联系方式删光后章标题也删（八、立即入驻…）', () => {
    const r = cleanArticleContent(doc(h('h2', '一、总览'), p(t('正文')), h('h2', '八、下一步'), h('h3', '招商热线：13774382509 王经理'), h('h2', '九、结语'), p(t('完'))))
    expect(texts(r)).toEqual(['一、总览', '正文', '九、结语', '完'])
  })

  it('空章节：标题之下直到下一个同级标题之间没内容就删，有内容的不删', () => {
    const r = cleanArticleContent(
      doc(h('h2', '六、招商中心联系方式'), p(t('招商电话：13774382509 王经理')), h('h2', '七、交通'), p(t('地铁 2 号线')), h('h2', '八、结语'), h('h3', '子标题'), p(t('正文'))),
    )
    expect(texts(r)).toEqual(['七、交通', '地铁 2 号线', '八、结语', '子标题', '正文'])
  })
})

describe('OPT-100 清洗：守护', () => {
  it('不误伤：没有电话、没有联系词、没有来源的正文一字不动', () => {
    const src = doc(h('h2', '一、项目总览'), p(t('西岸中环是香港置地集团在内地规模最大的单一投资项目。')), ul(li('65万平方米甲级办公'), li('滨江公园')), q(t('自然、文化、灵感在此交汇')))
    const r = cleanArticleContent(src)
    expect(r.report.removals).toEqual([])
    expect(r.content).toEqual(src)
  })

  it('不误伤：内容里的普通数字、地址门牌、面积不会被当成电话', () => {
    const r = cleanArticleContent(doc(p(t('龙腾大道3399号 / 瑞宁路288号，总建筑面积约 180 万平方米，2026年8月开业，标准层 2100㎡。'))))
    expect(r.report.removals).toEqual([])
  })

  it('整篇 ChoOffice 软文（标题带「-上海找办公室网」）不改写，只标记', () => {
    const src = doc(p(t('来上海找办公室网（chooffice.com）找实验室')))
    const r = cleanArticleContent(src, { title: '在上海如何找生物制药研发实验室？-上海找办公室网' })
    expect(r.report.advertorial).toBe(true)
    expect(r.report.removals).toEqual([])
    expect(r.content).toBe(src)
  })

  it('不修改入参', () => {
    const src = doc(p(t('正文')), up(1))
    const snapshot = JSON.stringify(src)
    cleanArticleContent(src)
    expect(JSON.stringify(src)).toBe(snapshot)
  })

  it('幂等：清洗过的正文再清一遍，零改动', () => {
    const once = cleanArticleContent(
      doc(q(t('地址：马当路159号\n招商热线：13774382509 王经理')), h('h2', '一、总览'), p(t('正文')), up(1), h('h2', '八、立即入驻'), h('h3', '招商热线： 021-51306070'), hr(), p(t('???ChoOffice?https://www.chooffice.com/1.html?'))),
    )
    const twice = cleanArticleContent(once.content)
    expect(twice.report.removals).toEqual([])
    expect(twice.content).toEqual(once.content)
  })
})
