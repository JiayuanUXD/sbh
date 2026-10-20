/**
 * L2 人工别名。
 *
 * 键是实体在库里的规范名称，值是用户可能输入的其他写法（简称、英文名、
 * 首字母）。v1 用代码维护、PR 评审——别名量还不值得建一张表；等运营需要
 * 自助维护时再迁到 Payload 集合（届时走 `payload migrate:create`）。
 *
 * 注意：别名只影响「词项 → 实体」的解析，不会改写实体名；同一个别名指到
 * 两个实体时，解析层会返回两个候选，查询取排序第一，建议列表展示全部。
 */
export const SEARCH_ALIASES: Readonly<Record<string, readonly string[]>> = {
  上海中心: ['上海中心大厦', 'shzx'],
  上海国金中心: ['国金中心', 'IFC'],
  上海环球金融中心: ['环球金融中心', 'SWFC'],
  陆家嘴: ['lujiazui', 'ljz'],
  静安寺: ['jingansi', 'jas'],
}
