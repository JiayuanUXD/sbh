/**
 * 领域：前台咨询表单（domain/inquiry）
 *
 * 设计依据：specs/frontend-mvp/design.md §10、specs/frontend-mvp/tasks/F5-inquiry.md、
 *           docs/prd/前台网站_MVP_页面PRD/05-咨询表单_PRD.md
 *
 * 职责边界：
 *   - 请求体 schema 白名单校验（unknown → InquiryRequest）
 *   - 手机号标准化、字段长度与枚举校验
 *   - 隐私同意版本校验（必须 accepted=true 且 policyVersion 匹配）
 *   - source.path 与 campaign 白名单化（防止个人信息泄露）
 *   - 幂等键计算：requestId + normalizedPhone + targetType + targetSlug
 *   - 隐私安全日志：maskPhone、不记录姓名/留言/原始 URL 个人信息
 *
 * 不变量：
 *   - 服务端把请求体视为 unknown，schema 收窄后才落库
 *   - 不接受未主动同意隐私政策的提交
 *   - 不向日志、埋点暴露完整手机号、姓名或留言正文
 *   - 错误返回稳定安全错误码字符串数组，不泄露内部对象
 *   - source.path 与 campaign 经过白名单化，长度有限
 *
 * 不依赖 payload / React，可独立单测。
 */

export * from './schema'
export * from './idempotency'
export * from './privacy-log'
export * from './campaign'
