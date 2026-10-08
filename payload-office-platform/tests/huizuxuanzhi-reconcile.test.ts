import { describe, expect, it } from 'vitest'

import { addressKey, normalizeName } from '../scripts/import-huizuxuanzhi/reconcile'

describe('reconcile：疑似同栋匹配', () => {
  it('名称归一去掉括号别名、「上海」前缀、标点与空白', () => {
    expect(normalizeName('金砖大厦（东方汇经中心）')).toBe('金砖大厦')
    expect(normalizeName('上海环球金融中心')).toBe('环球金融中心')
    expect(normalizeName('华敏·翰尊国际')).toBe('华敏翰尊国际')
    expect(normalizeName('SOHO 东海广场')).toBe('soho东海广场')
  })

  it('地址取「路名 + 门牌号」，楼层与座号不参与', () => {
    expect(addressKey('南京西路1266号')).toBe('南京西路1266')
    expect(addressKey('云南南路118号12楼')).toBe('云南南路118')
    expect(addressKey('中山西路1602号B座')).toBe('中山西路1602')
    expect(addressKey('申郑路18弄1-22号')).toBe('申郑路18')
    expect(addressKey('上海市静安区南京西路商圈')).toBeNull()
    expect(addressKey(null)).toBeNull()
  })
})
