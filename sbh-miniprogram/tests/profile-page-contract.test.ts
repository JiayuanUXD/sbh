import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const projectRoot = resolve(import.meta.dirname, '..')
const miniprogramRoot = resolve(projectRoot, 'miniprogram')
const pageRoot = resolve(miniprogramRoot, 'pages/profile')

function readPageFile(filename: string): string {
  return readFileSync(resolve(pageRoot, filename), 'utf8')
}

describe('我的 (Profile) 页面合同与设计规范', () => {
  it('注册 profile-ready 标记与基本元数据', () => {
    const markup = readPageFile('index.wxml')
    const config = JSON.parse(readPageFile('index.json')) as Record<string, unknown>

    expect(markup).toContain('id="profile-ready"')
    expect(config).toMatchObject({
      navigationBarTitleText: '我的',
      navigationBarBackgroundColor: '#ffffff',
      navigationBarTextStyle: 'black',
      backgroundColor: '#f2f2f4',
    })
  })

  it('包含用户身份、4 格资产指标、我的留资、菜单与版本页脚', () => {
    const markup = readPageFile('index.wxml')
    const styles = readPageFile('index.wxss')
    const script = readPageFile('index.ts')

    // 用户身份栏
    expect(markup).toContain('profile-user-card')
    expect(markup).toContain('{{user.nickname}}')
    expect(markup).toContain('{{user.city}}')

    // 4 格核心资产指标
    expect(markup).toContain('profile-metrics-card')
    expect(markup).toContain('收藏房源')
    expect(markup).toContain('收藏楼盘')
    expect(markup).toContain('浏览过')
    expect(markup).toContain('对比中')
    expect(markup).toContain('{{summary.listingCount}}')
    expect(markup).toContain('{{summary.buildingCount}}')

    // 我的留资
    expect(markup).toContain('profile-inquiry-card')
    expect(markup).toContain('我的留资')
    expect(markup).toContain('{{pendingInquiryCount}} 条待跟进')
    expect(markup).toContain('wx:for="{{inquiries}}"')

    // 功能菜单
    expect(markup).toContain('profile-menu-card')
    expect(markup).toContain('房源对比')
    expect(markup).toContain('切换城市')
    expect(markup).toContain('联系顾问')
    expect(markup).toContain('设置')

    // 页脚
    expect(markup).toContain('SBH 商办 · 版本')
    expect(markup).toContain('1.0.0')

    // 脚本逻辑与按压态
    expect(script).toContain('getFavoritesSummary')
    expect(script).toContain('getRecentInquiries')
    expect(styles).toContain('.sbh-pressable:active')
  })
})
