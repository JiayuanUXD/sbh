import ListingCompletenessCardClient from './ListingCompletenessCardClient'

/**
 * 房源编辑页「信息完整度」卡片 - 服务端壳（D 项：房源信息不足的引导）
 *
 * 与「前台可见性」卡片刻意分成两张：
 *   - 可见性卡片答的是「已经填完了，为什么前台看不到」（发布/审核/冻结/举报）；
 *   - 本卡片答的是「还差什么才算填完」（提交审核必填清单）。
 * 混成一张的话，「没图也能上前台、但提交审核仍要 3 张图」这种两级口径就说不清了。
 *
 * 本组件不取数：完整度判定全部来自表单当前值（含未保存的编辑），由客户端组件
 * 直接调 `checkListingCompleteness`——与服务端 `decideAdminAutoPublish` 用的是
 * 同一个纯函数，不会各说各话。
 */
export default function ListingCompletenessCard() {
  return <ListingCompletenessCardClient />
}
