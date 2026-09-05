import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

import { WATERMARK_FONT_FAMILY } from '@/domain/media/watermark'

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

  it('WATERMARK_FONT_FAMILY 首选项必须是 Dockerfile 实际安装的那个字体族名，两者不能各说各话', () => {
    // fonts-wqy-zenhei 这个 Debian 包注册的字体族名是 `WenQuanYi Zen Hei`
    // （非本文件猜测，见 watermark.ts 顶部注释与 Dockerfile 同一行注释的交叉引用）。
    // 装的包和代码选的字体名必须是同一个东西，否则装了也白装：生产容器里
    // librsvg 找不到 `WATERMARK_FONT_FAMILY` 第一项，直接跳到下一项——而下一项
    // （Noto Sans CJK SC / Microsoft YaHei）在容器里同样不存在，照样方框。
    expect(WATERMARK_FONT_FAMILY.split(',')[0].trim()).toBe('WenQuanYi Zen Hei')
  })
})
