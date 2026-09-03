/**
 * visitorRef 的形状定义（OPT-067）——**客户端安全，不含任何 node 依赖**
 *
 * 与 `visitor-ref.ts` 分家的唯一理由：那个文件 `import { createHmac } from
 * 'node:crypto'`，而客户端（InquiryModal / sessionStorage 读写）也需要校验
 * 同一个形状。直接从那边 import 会把 `node:crypto` 拖进浏览器 bundle。
 *
 * 不在两处各写一份正则：那必然漂移——服务端收紧了、客户端还在放行，
 * 或者反过来，而两边都"看着正常"。校验口径只有这一个来源。
 */

/** visitorRef 的固定长度（十六进制字符数） */
export const VISITOR_REF_LENGTH = 32

/** 只认 32 位**小写**十六进制 */
const VISITOR_REF_PATTERN = /^[0-9a-f]{32}$/

/**
 * 严格校验。
 *
 * 大写一律拒绝而不是归一化：合法值只可能来自我们自己发出的小写串，
 * 出现大写说明它在传输链路上被改过——宁可当非法丢弃，也不猜测意图。
 */
export function isVisitorRef(value: unknown): value is string {
  return typeof value === 'string' && VISITOR_REF_PATTERN.test(value)
}
