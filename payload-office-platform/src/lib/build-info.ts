/**
 * 构建标识：产物是由哪个 commit 构建的。
 *
 * 为什么需要它
 * ------------
 * 灰度发布期间，冒烟测试必须能分辨"命中的是新版本还是旧的稳定版本"。只看
 * /api/health 的 status 做不到——旧版本同样返回 ok。
 *
 * run 31275171164 就栽在这里：它报 success，但线上版本压根没换过。冒烟打的是生产
 * 域名，而流量还在旧版本上，旧版本健康所以必然通过。这次假成功掩盖了后续 7 次真
 * 失败，让"镜像方式可行"的错觉维持了将近一天。
 *
 * 注入路径
 * --------
 * 镜像由 CloudBase 平台在线构建，CI 无法传 --build-arg，只能把 commit 写进代码包：
 * deploy.yml 在 git archive 之后往 ZIP 根部塞一个 build-info.json，next.config.ts
 * 在构建期读它并通过 `env` 内联进产物，运行时不再依赖文件或环境变量。
 *
 * 缺失是正常情况：本地开发、CI 质量门都没有这个文件，回退到 'unknown'。
 * 部署链路上如果拿到 'unknown'，冒烟会因匹配不到新版本而失败并回滚——fail-closed，
 * 宁可发布失败也不要再出现"假成功"。
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const UNKNOWN_COMMIT = 'unknown'

/** build-info.json 的文件名，deploy.yml 注入时用的是同一个名字。 */
export const BUILD_INFO_FILENAME = 'build-info.json'

/**
 * 从 appRoot 下的 build-info.json 读取 commit SHA。
 *
 * 任何异常（文件不存在、JSON 非法、commit 字段缺失或非字符串）一律回退到
 * UNKNOWN_COMMIT——构建绝不能因为这个可选文件而失败。
 */
export function readBuildCommit(appRoot: string): string {
  let raw: string
  try {
    raw = readFileSync(resolve(appRoot, BUILD_INFO_FILENAME), 'utf8')
  } catch {
    return UNKNOWN_COMMIT
  }

  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return UNKNOWN_COMMIT
    const commit = (parsed as { commit?: unknown }).commit
    return typeof commit === 'string' && commit.length > 0 ? commit : UNKNOWN_COMMIT
  } catch {
    return UNKNOWN_COMMIT
  }
}
