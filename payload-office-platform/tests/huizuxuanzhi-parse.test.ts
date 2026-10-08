import { describe, expect, it } from 'vitest'

import {
  bd09ToGcj02,
  cleanText,
  labelValues,
  mapDecoration,
  mapFloorZone,
  parseAboveGroundFloors,
  parseBuildingPage,
  parseBuildingPics,
  parseDepositMonths,
  parseDivisible,
  parseEfficiency,
  parseHeights,
  parseLeaseMonths,
  parseListingPage,
  parseLocation,
  parseMonthlyFeePerSqm,
  parsePassengerElevators,
  parseSeatRange,
  parseYear,
} from '../scripts/import-huizuxuanzhi/parse'
import { parseHuizuSyncRow } from '@/domain/supply-sync/huizuxuanzhi-row'

/** 对方页面模板的最小骨架：只保留解析器真正读取的结构。 */
const kv = (label: string, value: string) => `<div><span>${label}</span><div><p>${value}</p></div></div>`
const crumb = (district: string, ba: string) =>
  `您当前的位置: <a href="/loupan">找写字楼</a> > <a href="/loupan/809">${district}办公楼出租</a> > <a href="/loupan/809_146">${ba}办公楼出租</a> > <a href="#">X</a>`

const BUILDING_HTML = [
  '<script>var require = { config: {"buildingName":"滨港商业中心","buildingPicImages":[',
  '{"id":1,"pic_url":"/uploads/20250318/a.png"},{"id":2,"pic_url":"https://huizutec.oss-cn-shanghai.aliyuncs.com/b.jpg"},',
  '{"id":3,"pic_url":"/uploads/20250318/a.png"}]} };</script>',
  crumb('虹口区', '四川北路'),
  '<input type="hidden" name="map_address" value="四川北路989弄">',
  '<input type="hidden" name="map_lng" value="121.490698">',
  '<input type="hidden" name="map_lat" value="31.255552">',
  '<input type="hidden" id="loupan1" value="滨港商业中心">',
  '<dt><i class="num">5</i>个</dt> <dd>在租房源</dd>',
  kv('大厦名称', '滨港商业中心'),
  kv('开发商', ''),
  kv('大厦地址', '四川北路989弄'),
  kv('物业公司', 'CBRE'),
  kv('竣工时间', '2024年'),
  kv('建筑面积', '300000平米'),
  kv('电梯数量', '客梯19部，消防梯2部'),
  kv('楼层层数', '地上36层，地下3层'),
  kv('层    高', '4.5m，净高3.2m'),
  kv('空调开放时间', '工作日早8点至晚6点'),
  kv('停 车 位', '约1100个（B3-B5层）'),
  kv('空调类型', 'VAV中央空调系统'),
  kv('网    络', '电信，移动，联通，光纤'),
  kv('物 业 费', '39元/平方米/月'),
  kv('停车费', '1000元/月'),
  '<span class="text1 hide-more"><h3>简介</h3><p>第一段&amp;正文</p><p>第二段</p></span>',
].join('\n')

const LISTING_HTML = [
  '您当前的位置:<a href="/office">找办公室</a> > <a href="/loupan/809">虹口区办公室出租</a> > <a href="/loupan/809_146">四川北路办公室出租</a>',
  '<input type="hidden" id="loupan" value="5086">',
  '<input type="hidden" id="loupan1" value="滨港商业中心">',
  '<input type="hidden" name="row[title]" value="滨港商业中心 400平米办公室出租，精装修">',
  '<i class="i2">单价：5元/m²&sdot;天 </i>',
  '<dt><i class="num">400㎡</i></dt> <dd>建筑面积</dd>',
  '<dt><i class="num">40~80</i>个工位</dt>',
  kv('所在楼层', '中区'),
  kv('朝向', '朝东南'),
  kv('装修情况', '精装修'),
  kv('面积信息', '400㎡，使用率约70%，可容纳工位40~80个'),
  kv('是否可分割', '不可分割'),
  kv('可 注 册', '是'),
  kv('日租金', '5元/㎡/天'),
  kv('物业费', '元/㎡/月'),
  kv('付款方式', '押3付1'),
  kv('最短租期', '24个月'),
  '<span class="text1">滨港商业中心办公室 出租</span>',
].join('\n')

describe('字段换算', () => {
  it('BD-09 → GCJ-02：滨港商业中心落到高德坐标（约向西南偏 600 米）', () => {
    const g = bd09ToGcj02(121.490698, 31.255552)
    expect(g.lng).toBeCloseTo(121.484124, 5)
    expect(g.lat).toBeCloseTo(31.249796, 5)
  })

  it('竣工时间：年份文本与 Excel 日期序列号都能换成年份', () => {
    expect(parseYear('2024年')).toBe(2024)
    expect(parseYear('39783')).toBe(2008) // 楼盘 6 的真实取值，2008-12-01
    expect(parseYear('暂无')).toBeNull()
    expect(parseYear('12')).toBeNull()
  })

  it('楼层层数：只取地上；裸数字也认', () => {
    expect(parseAboveGroundFloors('地上36层，地下3层')).toBe(36)
    expect(parseAboveGroundFloors('33')).toBe(33)
    expect(parseAboveGroundFloors('28层')).toBe(28)
    expect(parseAboveGroundFloors('地下3层')).toBeNull()
  })

  it('层高与净高拆分', () => {
    expect(parseHeights('4.5m，净高3.2m')).toEqual({ standard: 4.5, net: 3.2 })
    expect(parseHeights('2.7m')).toEqual({ standard: 2.7, net: null })
    expect(parseHeights('净高2.8米')).toEqual({ standard: null, net: 2.8 })
  })

  it('物业费取「元」紧前的数字，多座楼取第一座而不是座号', () => {
    expect(parseMonthlyFeePerSqm('39元/平方米/月')).toBe(39)
    expect(parseMonthlyFeePerSqm('1座:28元/平米月；2座:7元/平米月')).toBe(28)
    expect(parseMonthlyFeePerSqm('元/㎡/月')).toBeNull()
    expect(parseMonthlyFeePerSqm('1.2元/㎡/天')).toBeNull()
  })

  it('客梯只认「客梯 N 部」', () => {
    expect(parsePassengerElevators('客梯19部，消防梯2部')).toBe(19)
    expect(parsePassengerElevators('9部')).toBeNull()
  })

  it('房源细项', () => {
    expect(parseEfficiency('400㎡，使用率约70%，可容纳工位40~80个')).toBe(70)
    expect(parseSeatRange('40~80')).toEqual({ min: 40, max: 80 })
    expect(parseSeatRange('50')).toEqual({ min: 50, max: 50 })
    expect(parseDepositMonths('押3付1')).toBe(3)
    expect(parseDepositMonths('押二付三')).toBe(2)
    expect(parseLeaseMonths('24个月')).toBe(24)
    expect(parseLeaseMonths('2年')).toBe(24)
    expect(parseLeaseMonths('面议')).toBeNull()
    expect(parseDivisible('不可分割')).toBe(false)
    expect(parseDivisible('可分割')).toBe(true)
  })

  it('装修映射：简单装修是简装，不是 2026-08 那轮误映射的精装', () => {
    expect(mapDecoration('简单装修')).toBe('simple')
    expect(mapDecoration('精装修')).toBe('furnished')
    expect(mapDecoration('毛坯')).toBe('rough')
    expect(mapDecoration('豪华装修')).toBe('furnished')
    expect(mapDecoration('未知')).toBeNull()
  })

  it('楼层分区换成「低层/中层/高层」，其它原样', () => {
    expect(mapFloorZone('中区')).toBe('中层')
    expect(mapFloorZone('12层')).toBe('12层')
  })
})

describe('HTML 工具', () => {
  it('标签去空白；同名标签只取第一次', () => {
    const m = labelValues(kv('层    高', '4.5m') + kv('停 车 位', '10个') + kv('层高', '9m'))
    expect(m.get('层高')).toBe('4.5m')
    expect(m.get('停车位')).toBe('10个')
  })

  it('块级标签换行、实体解码', () => {
    expect(cleanText('<h3>标题</h3><p>正文&amp;更多</p>')).toBe('标题\n正文&更多')
    expect(cleanText('<p>  </p>')).toBeNull()
  })

  it('面包屑取区 id 与商圈名（去掉「办公楼出租」后缀）', () => {
    expect(parseLocation(crumb('虹口区', '四川北路'))).toEqual({
      siteDistrictId: 809,
      businessAreaName: '四川北路',
    })
  })

  it('图集：相对路径补全、去重', () => {
    expect(parseBuildingPics(BUILDING_HTML)).toEqual([
      'https://www.huizuxuanzhi.com/uploads/20250318/a.png',
      'https://huizutec.oss-cn-shanghai.aliyuncs.com/b.jpg',
    ])
  })
})

describe('页面级解析', () => {
  it('楼盘页解析出的行能通过同步行校验', () => {
    const { row, extras, issues } = parseBuildingPage(BUILDING_HTML, '5086')
    expect(issues).toEqual([])
    expect(extras).toEqual({ siteDistrictId: 809, claimedListingCount: 5 })
    expect(row).toMatchObject({
      externalId: '5086',
      sourceUrl: 'https://www.huizuxuanzhi.com/loupan/l5086',
      name: '滨港商业中心',
      districtName: '虹口区',
      businessAreaName: '四川北路',
      completionYear: 2024,
      totalFloors: 36,
      grossFloorArea: 300000,
      standardFloorHeight: 4.5,
      netCeilingHeight: 3.2,
      passengerElevators: 19,
      airConditioning: 'VAV中央空调系统；开放时间：工作日早8点至晚6点',
      propertyFee: 39,
      parkingSpaces: 1100,
      developer: null,
      description: '简介\n第一段&正文\n第二段',
    })
    expect(
      parseHuizuSyncRow({
        ...JSON.parse(JSON.stringify(row)),
        slug: 'bin-gang-5086',
        attachToBuildingId: null,
      }).ok,
    ).toBe(true)
  })

  it('开发商填的是楼盘名时置空', () => {
    const html = BUILDING_HTML.replace(kv('开发商', ''), kv('开发商', '滨港商业中心'))
    expect(parseBuildingPage(html, '5086').row.developer).toBeNull()
  })

  it('坐标缺失或不在上海时不入库，并记一笔', () => {
    const html = BUILDING_HTML.replace('121.490698', '116.404413').replace('31.255552', '39.903536')
    const { row, issues } = parseBuildingPage(html, '5086')
    expect(row.latitude).toBeNull()
    expect(issues.map((i) => i.field)).toContain('coordinates')
  })

  it('房源页：标题统一成「楼盘名 面积㎡ 装修」，楼盘以页面为准', () => {
    const { row, issues } = parseListingPage(LISTING_HTML, '63445', '9999')
    expect(row).toMatchObject({
      externalId: '63445',
      buildingExternalId: '5086',
      sourceUrl: 'https://www.huizuxuanzhi.com/loupan/l5086-x63445.html',
      title: '滨港商业中心 400㎡ 精装修',
      area: 400,
      dailyRent: 5,
      decorationStatus: 'furnished',
      registrable: true,
      floor: '中层',
      orientation: '朝东南',
      efficiencyRate: 70,
      seatMin: 40,
      seatMax: 80,
      isDivisible: false,
      depositMonths: 3,
      minimumLeaseMonths: 24,
      propertyFee: null,
    })
    expect(issues.map((i) => i.field)).toEqual(['buildingExternalId'])
    expect(
      parseHuizuSyncRow({
        ...JSON.parse(JSON.stringify(row)),
        slug: 'x-huizu-63445',
      }).ok,
    ).toBe(true)
  })
})

describe('parseHuizuSyncRow', () => {
  it('非对象、未知 kind、字段类型不符一律整行拒收', () => {
    expect(parseHuizuSyncRow(null).ok).toBe(false)
    expect(parseHuizuSyncRow({ kind: 'x' }).ok).toBe(false)
    const { row } = parseListingPage(LISTING_HTML, '63445', '5086')
    const bad = {
      ...JSON.parse(JSON.stringify(row)),
      slug: 'x-huizu-63445',
      area: '400',
    }
    const res = parseHuizuSyncRow(bad)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.errors).toContain('area 应为有限数值')
  })

  it('sourceUrl 必须是对方详情页，防止同步包被塞进任意地址', () => {
    const { row } = parseListingPage(LISTING_HTML, '63445', '5086')
    const res = parseHuizuSyncRow({
      ...JSON.parse(JSON.stringify(row)),
      slug: 'x-huizu-63445',
      sourceUrl: 'https://evil.example/x',
    })
    expect(res.ok).toBe(false)
  })

  it('装修值必须在本站枚举内', () => {
    const { row } = parseListingPage(LISTING_HTML, '63445', '5086')
    const res = parseHuizuSyncRow({
      ...JSON.parse(JSON.stringify(row)),
      slug: 'x-huizu-63445',
      decorationStatus: 'luxury',
    })
    expect(res.ok).toBe(false)
  })
})

describe('同步行：retire / slug / 挂靠', () => {
  it('retire 行只要 externalId 与合法 reason', () => {
    expect(
      parseHuizuSyncRow({
        kind: 'retire',
        externalId: '63425',
        reason: 'gone',
      }),
    ).toEqual({
      ok: true,
      row: { kind: 'retire', externalId: '63425', reason: 'gone' },
    })
    expect(
      parseHuizuSyncRow({
        kind: 'retire',
        externalId: '63425',
        reason: 'maybe',
      }).ok,
    ).toBe(false)
    expect(parseHuizuSyncRow({ kind: 'retire', externalId: 'abc', reason: 'gone' }).ok).toBe(false)
  })

  it('slug 必须是小写字母数字连字符', () => {
    const { row } = parseListingPage(LISTING_HTML, '63445', '5086')
    const base = JSON.parse(JSON.stringify(row))
    expect(parseHuizuSyncRow({ ...base, slug: 'bin-gang-huizu-63445' }).ok).toBe(true)
    expect(parseHuizuSyncRow({ ...base, slug: 'Bin Gang' }).ok).toBe(false)
    expect(parseHuizuSyncRow({ ...base }).ok).toBe(false)
  })

  it('挂靠楼盘 id 只接受正整数或 null', () => {
    const { row } = parseBuildingPage(BUILDING_HTML, '5086')
    const base = { ...JSON.parse(JSON.stringify(row)), slug: 'bin-gang-5086' }
    const ok = parseHuizuSyncRow({ ...base, attachToBuildingId: 146 })
    expect(ok.ok && ok.row.kind === 'building' && ok.row.attachToBuildingId).toBe(146)
    expect(parseHuizuSyncRow({ ...base, attachToBuildingId: '146' }).ok).toBe(false)
    expect(parseHuizuSyncRow({ ...base, attachToBuildingId: 0 }).ok).toBe(false)
  })
})

describe('pinyinSlug', () => {
  it('与 2026-08 那轮生产 slug 同格式；非汉字连续保留', async () => {
    const { pinyinSlug } = await import('../scripts/import-huizuxuanzhi/build-dataset')
    expect(pinyinSlug('仲盛金融中心')).toBe('zhong-sheng-jin-rong-zhong-xin')
    expect(pinyinSlug('SOHO东海广场')).toBe('soho-dong-hai-guang-chang')
    expect(pinyinSlug('品尊国际 2000㎡ 简单装修')).toBe('pin-zun-guo-ji-2000-jian-dan-zhuang-xiu')
    expect(pinyinSlug('华敏·翰尊国际')).toBe('hua-min-han-zun-guo-ji')
  })
})

describe('全量实测补充的写法（2026-10-08）', () => {
  it('装修：简装修、中等装修都归简装', () => {
    expect(mapDecoration('简装修')).toBe('simple')
    expect(mapDecoration('中等装修')).toBe('simple')
  })

  it('使用率不带百分号', () => {
    expect(parseEfficiency('1823㎡，使用率约80，可容纳工位182~365个')).toBe(80)
    expect(parseEfficiency('272.66㎡，使用率约，可容纳工位27~55个')).toBeNull()
  })

  it('物业费写成「天」：大于 3 按月计，≤ 3 丢弃', () => {
    expect(parseMonthlyFeePerSqm('42元/平米/天')).toBe(42)
    expect(parseMonthlyFeePerSqm('1.2元/㎡/天')).toBeNull()
  })

  it('竣工 1898 年的老楼、楼层写成 66F', () => {
    expect(parseYear('1898年')).toBe(1898)
    expect(parseYear('9983')).toBeNull()
    expect(parseAboveGroundFloors('66F')).toBe(66)
  })
})

describe('物业费的其它写法', () => {
  it('不写「元」的按月写法；含「租金」的不是物业费', () => {
    expect(parseMonthlyFeePerSqm('10.5平方/月')).toBe(10.5)
    expect(parseMonthlyFeePerSqm('35㎡/月')).toBe(35)
    expect(parseMonthlyFeePerSqm('24/㎡/月')).toBe(24)
    expect(parseMonthlyFeePerSqm('21元／平米／天')).toBe(21)
    expect(parseMonthlyFeePerSqm('租金单价4元/㎡/天,含物业费')).toBeNull()
    expect(parseMonthlyFeePerSqm('1座:28元/平米月；2座:7元/平米月')).toBe(28)
  })
})
