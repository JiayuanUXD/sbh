/**
 * 卡片等高与价格贴底（2026-09-04 用户反馈：首页轨道里两张卡一高一矮）。
 *
 * ## 现象与判据
 *
 * 多列容器（grid 的 `.ls-grid` / `.card-grid`、flex 的 `.hm-rail__track`）本来就把
 * 每个格子拉到该行最高，但卡片自身是 auto 高度，于是在格子里「缩着」——同一行两张卡
 * 只要标题差一行折行，卡片外框就一高一矮，价格行也各在各的位置。
 *
 * 修法是两条，缺一不可：
 *   1. `.sf-card { height: 100% }` —— 卡片撑满格子（外框等高）；
 *   2. 竖排变体 `body { flex: 1 }` + 价格行 `margin-top: auto` —— 价格贴底对齐
 *      （内部元素等位）。只做第 1 条的话卡片等高了，但价格仍跟着标题上下浮动。
 *
 * ## 为什么用 CSS 文本断言
 *
 * 等高是布局行为，vitest 的 node 环境量不到（没有排版引擎）。这里锁的是「这两条
 * 规则还在」，真实的等高证据在浏览器走查（artifacts/verification/）。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const STYLES = path.resolve(__dirname, '..', 'src', 'app', '(frontend)')
const read = (rel: string) => readFileSync(path.join(STYLES, rel), 'utf8')

/**
 * 取某个选择器的声明块（只取第一处定义），并**剥掉注释**——本仓库的 CSS 注释里
 * 经常写着属性名（如 `.sf-card` 那条「不能加 flex-direction」的说明），不剥的话
 * 「不含某属性」这类断言会被自己的注释打脸。
 */
function ruleOf(css: string, selector: string): string {
  const index = css.indexOf(`${selector} {`)
  expect(index, `${selector} 未定义`).toBeGreaterThan(-1)
  return css.slice(index, css.indexOf('}', index)).replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('卡片等高：共享基元', () => {
  const surface = read('styles/surface.css')

  it('.sf-card 撑满被拉伸的格子', () => {
    expect(ruleOf(surface, '.sf-card')).toMatch(/height:\s*100%/)
  })

  it('.sf-card 不设 flex-direction —— 横排卡 .ls-rowcard 只写了 display:flex，基元写死 column 会把它整张翻成竖排', () => {
    expect(ruleOf(surface, '.sf-card')).not.toMatch(/flex-direction/)
    const list = read('styles/list.css')
    expect(ruleOf(list, '.ls-rowcard')).toContain('display: flex')
    expect(ruleOf(list, '.ls-rowcard')).not.toMatch(/flex-direction:\s*column/)
  })
})

/**
 * OPT-099：媒体盒的 16:10 必须真的生效。
 *
 * 2026-09-04 那一轮锁住了 `.sf-card { height: 100% }`（外框等高），但**没管媒体盒**，
 * 于是等高只在「同一行内」成立，行与行之间仍然按各自最高的那张图分档。
 *
 * 根因（2026-09-16 生产站实测）：`.sf-media img { height: 100% }` 的百分比在「由
 * aspect-ratio 推导出来的高度」上解析不了，回落成 auto（图片原始比例）；带
 * aspect-ratio 的块盒其自动最小尺寸取内容尺寸，于是比 16:10 更高的图把盒子顶高。
 * `/shanghai/listings` 一页 24 张卡因此出现 8 种不同的媒体盒比例、两档卡片高度。
 *
 * 两条缺一不可，删任一条 16:10 都会重新变成一句没有效力的声明：
 *   1. img `position: absolute; inset: 0` —— 让 height 有确定的解析基准，图片不再撑高；
 *   2. `.sf-media { overflow: hidden }` —— 兜住残留溢出。
 *
 * ⚠️ 本文件是文本断言，量不到真实布局。**真实证据只能来自「有比 16:10 更高的图」的
 * 环境**：本地夹具封面全是 768x432（16:9），在那上面这个 bug 永远复现不出来。
 */
describe('卡片等高：媒体盒比例真的生效（OPT-099）', () => {
  const surface = read('styles/surface.css')

  it('.sf-media img 绝对定位撑满容器 —— 否则 height:100% 解析不了、图片会顶高盒子', () => {
    const rule = ruleOf(surface, '.sf-media img')
    expect(rule).toMatch(/position:\s*absolute/)
    expect(rule).toMatch(/inset:\s*0/)
    expect(rule).toMatch(/height:\s*100%/)
    expect(rule).toMatch(/object-fit:\s*cover/)
  })

  it('.sf-media 裁切溢出', () => {
    expect(ruleOf(surface, '.sf-media')).toMatch(/overflow:\s*hidden/)
  })

  it('比例档位仍由修饰符声明（消费方靠它，不靠图片原始比例）', () => {
    expect(ruleOf(surface, '.sf-media--16x10')).toMatch(/aspect-ratio:\s*16\s*\/\s*10/)
  })
})

describe('卡片等高：竖排变体的价格贴底', () => {
  it('首页供给卡：竖排 + 正文 flex:1 + 价格 margin-top:auto + 标题两行封顶', () => {
    const home = read('styles/home.css')
    expect(ruleOf(home, '.hm-supply-card')).toMatch(/flex-direction:\s*column/)
    expect(ruleOf(home, '.hm-supply-card__body')).toMatch(/flex:\s*1/)
    expect(ruleOf(home, '.hm-supply-card__price')).toMatch(/margin-top:\s*auto/)
    // 不封顶的话，一个超长标题会把整条轨道的卡一起顶高
    expect(ruleOf(home, '.hm-supply-card__title')).toMatch(/line-clamp:\s*2/)
  })

  it('列表页房源卡：正文 flex:1 + 价格/面积行 margin-top:auto', () => {
    const list = read('styles/list.css')
    expect(ruleOf(list, '.ls-card')).toMatch(/flex-direction:\s*column/)
    expect(ruleOf(list, '.ls-card__body')).toMatch(/flex:\s*1/)
    expect(ruleOf(list, '.ls-card__meta')).toMatch(/margin-top:\s*auto/)
  })

  it('列表页楼盘卡：正文 flex:1 + 在租统计行 margin-top:auto', () => {
    const list = read('styles/list.css')
    expect(ruleOf(list, '.bd-card')).toMatch(/flex-direction:\s*column/)
    expect(ruleOf(list, '.bd-card__body')).toMatch(/flex:\s*1/)
    expect(ruleOf(list, '.bd-card__stats')).toMatch(/margin-top:\s*auto/)
  })

  it('详情页相关房源卡（.listing-card）：既有的 flex:1 / margin-top:auto 不得被撤', () => {
    const styles = read('styles.css')
    expect(ruleOf(styles, '.listing-card')).toMatch(/flex-direction:\s*column/)
    expect(ruleOf(styles, '.listing-card__body')).toMatch(/flex:\s*1/)
    // .listing-card__meta 在文件里有两处定义，后者带 margin-top:auto
    expect(styles).toMatch(/\.listing-card__meta \{[^}]*margin-top:\s*auto/s)
  })

  it('详情页相关楼盘卡与周边楼盘条带：正文 flex:1', () => {
    const styles = read('styles.css')
    expect(ruleOf(styles, '.building-card-mini')).toMatch(/flex-direction:\s*column/)
    expect(ruleOf(styles, '.building-card-mini__body')).toMatch(/flex:\s*1/)
    expect(ruleOf(styles, '.nearby-strip__body')).toMatch(/flex:\s*1/)
  })

  it('资讯卡：链接层已 height:100% + 正文 flex:1（本次不动，守住不被撤）', () => {
    const styles = read('styles.css')
    expect(ruleOf(styles, '.article-card__link')).toMatch(/height:\s*100%/)
    expect(ruleOf(styles, '.article-card__body')).toMatch(/flex:\s*1/)
  })
})
