/**
 * 站内搜索模糊匹配的「评测集」：查询 → 期望。
 *
 * 用途：不再靠一条条特例规则打补丁，而是把「用户会怎么打」整理成数据，每次调权重 / 改匹配器
 * 都跑一遍，看命中率变化。新出现的打法（尤其是「未命中搜索词」里的真实词）先加到这里，再改代码。
 *
 * 词表是固定的小样本（不代表线上规模），别名来自代码里的 SEARCH_ALIASES。
 */

import type { SearchVocabularyRow } from '@/domain/search/vocabulary-build'

export const GOLDEN_ROWS: readonly SearchVocabularyRow[] = [
  { kind: 'building', id: 1, slug: 'shanghai-tower', name: '上海中心', parent_name: '陆家嘴' },
  { kind: 'building', id: 2, slug: 'ifc', name: '上海国金中心', parent_name: '陆家嘴' },
  { kind: 'building', id: 3, slug: 'ljz-river', name: '陆家嘴江景甲级写字楼', parent_name: '陆家嘴' },
  { kind: 'building', id: 4, slug: 'njxl-center', name: '南京西路高端商务中心', parent_name: '南京西路' },
  { kind: 'building', id: 5, slug: 'bund-source', name: '外滩源大厦', parent_name: '外滩' },
  { kind: 'building', id: 6, slug: 'xjh-intl', name: '徐家汇国际大厦', parent_name: '徐家汇' },
  { kind: 'building', id: 7, slug: 'hq-biz', name: '虹桥国际商务中心', parent_name: '虹桥' },
  { kind: 'building', id: 8, slug: 'east-center', name: '东中心', parent_name: '虹桥' },
  { kind: 'building', id: 9, slug: 'soho', name: 'SOHO中山广场', parent_name: '静安' },
  { kind: 'businessArea', id: 11, slug: 'lujiazui', name: '陆家嘴', parent_name: '浦东新区' },
  { kind: 'businessArea', id: 12, slug: 'waitan', name: '外滩', parent_name: '黄浦区' },
  { kind: 'businessArea', id: 13, slug: 'nanjingxilu', name: '南京西路', parent_name: '静安区' },
  { kind: 'businessArea', id: 14, slug: 'xujiahui', name: '徐家汇', parent_name: '徐汇区' },
  { kind: 'district', id: 21, slug: 'pudong', name: '浦东新区', parent_name: '上海' },
  { kind: 'district', id: 22, slug: 'jingan', name: '静安区', parent_name: '上海' },
  { kind: 'district', id: 23, slug: 'huangpu', name: '黄浦区', parent_name: '上海' },
  { kind: 'metro', id: 31, slug: 'jingansi', name: '静安寺', parent_name: '2号线' },
  { kind: 'metro', id: 32, slug: 'renmin-sq', name: '人民广场', parent_name: '1号线' },
  { kind: 'metro', id: 33, slug: 'lujiazui-st', name: '陆家嘴站', parent_name: '2号线' },
  { kind: 'metro', id: 34, slug: 'century-ave', name: '世纪大道', parent_name: '2号线' },
]

/** 自动改写：编辑数为 0，第一个候选必须是期望的实体。 */
export const GOLDEN_AUTO: ReadonlyArray<readonly [query: string, expectedFirst: string]> = [
  // 整词全拼 / 首字母（精确档，也必须被打分器自洽地认同）
  ['lujiazui', '陆家嘴'],
  ['shanghaizhongxin', '上海中心'],
  ['jingansi', '静安寺'],
  ['xujiahui', '徐家汇'],
  ['waitan', '外滩'],
  // 拼音后半截 / 中间一段 / 最后一个音节只打一部分
  ['zhongxin', '东中心'],
  ['guojin', '上海国金中心'],
  ['guojinzhongx', '上海国金中心'],
  ['gaoduan', '南京西路高端商务中心'],
  ['jiangjing', '陆家嘴江景甲级写字楼'],
  // 汉字与拼音混输
  ['luj嘴', '陆家嘴'],
  ['lu家嘴', '陆家嘴'],
  ['陆j嘴', '陆家嘴'],
  ['陆家z', '陆家嘴'],
  ['lj嘴', '陆家嘴'],
  ['上hai中心', '上海中心'],
  ['上海zhong', '上海中心'],
  ['上h国', '上海国金中心'],
  ['静an寺', '静安寺'],
  ['xu家hui', '徐家汇'],
]

/** 不应该自动改写：第一个候选不存在（空）。 */
export const GOLDEN_AUTO_NONE: readonly string[] = [
  'xin', // 太短
  'zhon', // 只有半个音节，证据不够
  'hongxin', // 从音节（zhong）中间开始
  'abc',
  'xyz嘴', // 字母对不上任何音节
  'luj家', // 汉字位置错了
  'lx嘴', // x 不是 jia 的开头
  '整层办公室', // 纯汉字不走自动改写（原样 ILIKE）
  '陆家嘴', // 纯汉字
]

/** 建议（零结果页「你是不是想找」）：编辑数 > 0，整个名字对齐，期望出现在候选里。 */
export const GOLDEN_SUGGEST: ReadonlyArray<readonly [query: string, expected: string]> = [
  ['陆加嘴', '陆家嘴'], // 错字
  ['陆嘉嘴', '陆家嘴'],
  ['陆家最', '陆家嘴'], // 同音错字
  ['陆嘴', '陆家嘴'], // 漏字
  ['陆家家嘴', '陆家嘴'], // 多字
  ['上海中新', '上海中心'],
  ['静按寺', '静安寺'],
  ['外滩原大厦', '外滩源大厦'],
  ['徐家汇国际大夏', '徐家汇国际大厦'],
  ['国金中新', '上海国金中心'], // 别名里的错字
  ['人明广场', '人民广场'],
  ['世记大道', '世纪大道'],
  ['上海国今中新', '上海国金中心'], // 6 字，两处错
]

/** 不应该给建议。 */
export const GOLDEN_SUGGEST_NONE: readonly string[] = [
  '陆加最', // 两处错（3 字只容 1 处）
  '整层办公室',
  '完全不相干的东西',
  '陆', // 太短
  'ifc', // 纯字母
]
