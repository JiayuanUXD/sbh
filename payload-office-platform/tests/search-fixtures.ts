import type { SearchVocabulary } from '@/domain/search/vocabulary'

/**
 * 测试用词表：覆盖楼盘、商圈、行政区、地铁，含别名、全拼、首字母与一个同音歧义。
 * 只用于单测，不代表线上词表规模。
 */
export const testVocabulary: SearchVocabulary = {
  city: 'shanghai',
  entries: [
    {
      kind: 'businessArea',
      id: 11,
      slug: 'lujiazui',
      name: '陆家嘴',
      parentName: '浦东新区',
      aliases: ['ljz'],
      pinyin: 'lujiazui',
      initials: 'ljz',
    },
    {
      kind: 'building',
      id: 2,
      slug: 'shanghai-tower',
      name: '上海中心',
      parentName: '陆家嘴',
      aliases: ['上海中心大厦', 'shzx'],
      pinyin: 'shanghaizhongxin',
      initials: 'shzx',
    },
    {
      kind: 'building',
      id: 3,
      slug: 'ifc',
      name: '上海国金中心',
      parentName: '陆家嘴',
      aliases: ['国金中心', 'IFC'],
      pinyin: 'shanghaiguojinzhongxin',
      initials: 'shgjzx',
    },
    {
      kind: 'district',
      id: 4,
      slug: 'changning',
      name: '长宁',
      aliases: [],
      pinyin: 'changning',
      initials: 'cn',
    },
    {
      kind: 'district',
      id: 5,
      slug: 'jingan',
      name: '静安',
      aliases: [],
      pinyin: 'jingan',
      initials: 'ja',
    },
    {
      kind: 'metro',
      id: 7,
      slug: 'jingan-station',
      name: '静安站',
      aliases: [],
      pinyin: 'jingan',
      initials: 'jaz',
    },
  ],
}
