/**
 * 地理模块的菜单准入码
 *
 * 语义：**任一命中即视为「能进地理模块」**，与 `navigation-config.ts` 里
 * region-management 组各叶子的 menuCodes 一致（城市/行政区/地铁 → `locations`，
 * 商圈 → `business-areas`）。
 *
 * 原先这份常量在 location-tree-endpoint 与 location-search-endpoint 里各抄一份；
 * BusinessAreaExtensions 的写侧准入是第三个消费点，再抄一份必然漂移，故抽出。
 * 改这里等于同时改「级联数据源」「地理搜索」「商圈扩展写入」三处口径。
 */
export const GEOGRAPHY_MENU_CODES = ['locations', 'business-areas'] as const
