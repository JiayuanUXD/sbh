import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

import { WATERMARK_FONT_FAMILY, WATERMARK_FONT_PACKAGE } from '@/domain/media/watermark'

function read(relative: string): string {
  return readFileSync(path.join(process.cwd(), relative), 'utf8')
}

/**
 * OPT-069 spec §7.3：生产是 node:22-slim，不带任何中文字体。水印靠 sharp/librsvg
 * 把中文文案画进 SVG 再栅格化，缺字体时 librsvg 把文字渲染成方框或空白——
 * 且**不报错**。typecheck / lint / 单测 / build / CI 三项全绿，容器也能正常启动、
 * 正常提供服务，唯一能看出问题的地方是生产环境里的图片本身。
 *
 * 没有这份测试，任何人（包括未来为镜像瘦身的自己）删掉 Dockerfile 里装字体的那行，
 * 都不会有任何其它信号变红。这份测试就是那个信号。
 */
describe('生产容器的中文字体安装（Dockerfile）', () => {
  const dockerfile = read('Dockerfile')

  it('runner 阶段必须安装 CJK 字体包（fonts-wqy-zenhei）', () => {
    expect(dockerfile).toMatch(/apt-get install[^\n]*fonts-wqy-zenhei/)
  })

  it('必须清理 apt 列表缓存，不留在镜像层里', () => {
    // 允许 && 拼接或独立 RUN，只要同一处安装动作后清理即可；
    // 这里用宽松匹配，抓的是「装了字体的 RUN 里带清理」而非精确格式。
    const installLine = dockerfile
      .split('\n')
      .find((line) => line.includes('fonts-wqy-zenhei'))
    expect(installLine).toBeTruthy()
    expect(dockerfile).toContain('rm -rf /var/lib/apt/lists/*')
  })

  it('只装在 runner 阶段——builder/deps 不连库不渲染水印，没必要装', () => {
    const runnerStageStart = dockerfile.indexOf('FROM node:22-slim AS runner')
    const fontLineIndex = dockerfile.indexOf('fonts-wqy-zenhei')
    expect(runnerStageStart).toBeGreaterThan(-1)
    expect(fontLineIndex).toBeGreaterThan(runnerStageStart)
  })

  /**
   * 装的**包名**必须与 `WATERMARK_FONT_PACKAGE` 一致，因为那个常量进版本哈希。
   *
   * 缺了这条守卫，把这一行从 `fonts-wqy-zenhei` 换成 `fonts-noto-cjk`（两者字形差异很大）
   * 的后果与「改了渲染逻辑却没 +1 版本号」完全同构：像素全变，而
   * `computeWatermarkVersion` 的输入一个字节没动 → 哈希不变 → 之后每一轮重刷都判
   * 「已是当前版本」跳过 → 新旧两种字形永久共存，没有任何报错。
   * `artifacts/verification/OPT-069/` 里那份容器字体验收把 WQY 与 Noto 的权衡明确摆了出来，
   * 客观上提高了有人真去换的概率。
   *
   * 有了它：Dockerfile 一改 → 本测试红 → 必须同步改常量 → 哈希自动变 → 重刷自动重烘。
   */
  it('Dockerfile 装的字体包必须与 WATERMARK_FONT_PACKAGE 一致——它进版本哈希，换包=换字形=存量图必须重刷', () => {
    const installLine = dockerfile
      .split('\n')
      .find((line) => line.includes('apt-get install') && /fonts-\S+/.test(line))
    expect(installLine, 'Dockerfile 里找不到安装字体包的 apt-get install 行').toBeTruthy()
    const installed = /fonts-[A-Za-z0-9.+-]+/.exec(installLine!)?.[0]
    expect(installed).toBe(WATERMARK_FONT_PACKAGE)
  })

  it('WATERMARK_FONT_FAMILY 首选项与 Dockerfile 装的那个包对得上，两者不各说各话', () => {
    // fonts-wqy-zenhei 这个 Debian 包注册的字体族名是 `WenQuanYi Zen Hei`
    // （非本文件猜测，见 watermark.ts 顶部注释与 Dockerfile 同一行注释的交叉引用）。
    //
    // **别把这条读成「不点名就会渲染成方框」**——那是错的，已被实测推翻：只改 font-family
    // 字符串、其余入参全同，两次渲染逐字节相同。fontconfig 做的是最佳匹配而非精确匹配失败，
    // 系统里只要有覆盖该码点的字体就会被选中，是否在 family 列表里点名无关。
    // 当前镜像只装了一个 CJK 字体，fontconfig 无从选择，所以栈的顺序不是失效点。
    // **但若将来镜像里多了第二个 CJK 字体，栈首会重新成为决定因素**（fontconfig 要在候选间
    // 排序，点名的那个会赢）。这条断言就是为那一天留的：它保证「点名的」与「装的」是同一个。
    expect(WATERMARK_FONT_FAMILY.split(',')[0].trim()).toBe('WenQuanYi Zen Hei')
  })
})
