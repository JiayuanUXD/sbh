/**
 * 领域：可解释情境推荐（domain/recommendation）
 *
 * P2 Task 5：在详情页底部为用户推荐相关房源，推荐结果确定性、可解释、
 * 只使用当前页面上下文和显式筛选，不建立跨会话用户画像。
 *
 * 不变量：
 *   - 不读取 cookie、localStorage、用户 ID、手机号或 Lead
 *   - 不使用跨会话历史
 *   - 每条推荐至少一个 reasonCode
 *   - 最多返回 6 条
 *   - 同分使用不可变 listing ID 升序收束
 */
export {
  rankDetailRecommendations,
  parseRecommendationContext,
  type RecommendationCandidate,
  type RecommendationContext,
  type RecommendationResult,
} from './detail-recommendations'
