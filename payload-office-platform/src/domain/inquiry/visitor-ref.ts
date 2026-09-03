/**
 * 线索访客标识 visitorRef（OPT-067）
 *
 * 咨询提交成功时派生一个假名化 ID，客户端据此调 `umami.identify(visitorRef)`，
 * 把「提交前的匿名浏览路径」接到这条线索上；后台线索详情用它深链到 Umami
 * 的会话视图。
 *
 * ## 为什么是 HMAC，不是普通哈希
 *
 * 派生源 `idempotencyKey` 本身是
 * `SHA-256(requestId | phoneNormalized | targetType | targetSlug)`。
 * 这几项**攻击者可能全都知道**（自己的手机号、看的哪套房、requestId 由客户端
 * 生成）。若 visitorRef 用普通哈希派生，任何人都能算出别人的 visitorRef，
 * 进而在 Umami 里定位到那个人的完整浏览路径——那是实打实的隐私泄露。
 *
 * 加服务端密钥做 HMAC 才切断这条路：不知道 `PAYLOAD_SECRET` 就算不出来。
 *
 * ## 为什么截断到 32 hex
 *
 * 128 bit 足够避免碰撞，而 Umami 的 distinct id 是要写进 URL 与页面的，
 * 64 位全长没必要。截断不削弱不可逆性——HMAC 的任意子串同样不可反推。
 */

import { createHmac } from 'node:crypto'

// 形状定义（长度 + 校验）拆在 visitor-ref-shape.ts：本文件 import 了
// `node:crypto`，而客户端也要校验同一个形状，从这里 import 会把 node:crypto
// 拖进浏览器 bundle。re-export 保持调用方无感，同时口径只有一个来源。
export { isVisitorRef, VISITOR_REF_LENGTH } from './visitor-ref-shape'
import { isVisitorRef, VISITOR_REF_LENGTH } from './visitor-ref-shape'

/**
 * 从 `idempotencyKey` 派生。
 *
 * 同一个 `idempotencyKey` 必然得到同一个值——幂等重放时会重新派生一次，
 * 两次不一致会让同一条线索前后拿到不同 ID。
 *
 * 缺密钥直接抛错，**不静默降级成普通哈希**：那样会产出「看起来正常但可被
 * 反推」的 ID，比直接失败危险得多。生产环境 `PAYLOAD_SECRET` 由
 * `config-guard` fail-closed 保证存在，这里只是最后一道。
 */
export function deriveVisitorRef(secret: string, idempotencyKey: string): string {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('deriveVisitorRef 需要非空密钥（PAYLOAD_SECRET）')
  }
  return createHmac('sha256', secret)
    .update(idempotencyKey, 'utf8')
    .digest('hex')
    .slice(0, VISITOR_REF_LENGTH)
}

/**
 * 解析最终使用的 visitorRef：客户端回传合法值则复用，否则派生。
 *
 * ## 为什么允许客户端回传
 *
 * 同一会话提交第二条线索时要**复用首个 ID**。不复用的话，
 * `umami.identify` 的会话级后写覆盖会让第一条线索的深链失效——
 * `idempotencyKey` 含 targetSlug，咨询两套房源必然产生两个不同派生值。
 *
 * ## 伪造回传的风险已评估
 *
 * 攻击者伪造回传，只能把**自己这条线索**的分析归因指到别处，
 * 触及不到他人数据（Umami 侧按 distinct id 查到的是攻击者自己的会话）。
 * 风险接受——换取同会话多线索的正确关联。
 *
 * 非法回传（被改过、旧版本客户端、类型不对）一律**忽略并回落到派生值**，
 * 不让整个提交失败：那是客户端的问题，不该让用户提交不了咨询。
 */
export function resolveVisitorRef(
  provided: unknown,
  secret: string,
  idempotencyKey: string,
): string {
  if (isVisitorRef(provided)) return provided
  return deriveVisitorRef(secret, idempotencyKey)
}
