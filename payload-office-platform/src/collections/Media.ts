import type { CollectionConfig } from 'payload'

import {
  collectMediaCacheTagsBeforeDelete,
  invalidateMediaConsumerCacheAfterDelete,
} from '@/domain/media/media-cache-hook'
import { unmountMediaReferences } from '@/domain/media/media-delete-cleanup'
import { MEDIA_COS_PREFIX } from '@/lib/storage/cos-config'

export const Media: CollectionConfig = {
  slug: 'media',
  labels: {
    singular: '媒体',
    plural: '素材库',
  },
  admin: {
    group: false,
    pagination: { defaultLimit: 25, limits: [10, 25, 50, 100] },
    useAsTitle: 'alt',
  },
  access: {
    read: () => true,
  },
  /**
   * 删 media 要做两件互相独立的事，各自的病理见对应模块的头注释：
   *
   *   - `unmountMediaReferences`（OPT-070，`media-delete-cleanup.ts`）：先摘掉房源 /
   *     楼盘图集与媒体工作台里指向它的行，否则撞上 `NOT NULL` + `ON DELETE SET NULL`
   *     的死结（23502），后台只显示「Something went wrong.」。
   *   - `collectMediaCacheTagsBeforeDelete` / `invalidateMediaConsumerCacheAfterDelete`
   *     （`media-cache-hook.ts`）：失效引用它的公开页面缓存。引用 media 的外键是
   *     `ON DELETE SET NULL`，父文档不经过 Payload 写入路径，它们自己的失效钩子
   *     一次都不会触发。
   *
   * ## 两条顺序约束，都不能反
   *
   * 1. **`beforeDelete` 里反查必须排在摘除之前。** 摘除直接删图集 / 工作台子表行，
   *    排在前面会让反查查不到那条房源。`coverImage` 是标量列、摘除不动它，所以
   *    「这张图正好是封面」的房源仍能查到——漏的是「只经 gallery / mediaItems 引用、
   *    封面是别的图」那一类，**部分静默漏，最难发现**。
   * 2. **反查在 `beforeDelete`、失效在 `afterDelete`。** `SET NULL` 在 DELETE 语句
   *    执行时就生效，放到 `afterDelete` 再反查是恒空的；而删除可能失败，失败时不该动缓存。
   *    两段之间用 `req.context` 按 media id 分桶传递。
   */
  hooks: {
    beforeDelete: [collectMediaCacheTagsBeforeDelete, unmountMediaReferences],
    afterDelete: [invalidateMediaConsumerCacheAfterDelete],
  },
  fields: [
    {
      name: 'alt',
      label: '替代文本',
      type: 'text',
      required: true,
    },
    // 存储前缀。s3Storage 插件仅在启用（COS_* 存在）时注入该字段；本地存储/CI 无 COS_*
    // 时不注入，导致 /api/media/file/*?prefix=media 的访问校验 findOne 报
    // "Cannot find field for path at prefix"（500）。在此显式声明以对齐 DB 中
    // 20260805_cos_media_prefix 迁移创建的 prefix 列，使前缀查询在所有存储模式下可用。
    // defaultValue 必须显式声明：COS 启用时插件会注入 defaultValue（值同 MEDIA_COS_PREFIX），
    // 缺省会导致 COS 关闭的环境跑 migrate:create 时误生成 DROP DEFAULT 漂移语句。
    {
      name: 'prefix',
      type: 'text',
      defaultValue: MEDIA_COS_PREFIX,
      admin: { hidden: true, readOnly: true },
    },
  ],
  /**
   * OPT-059：三档宽度型派生 + 焦点。
   *
   * 宽度型（只给 width、不给 height）而非定尺寸裁剪：bento 三种坑位
   * （480 / 232 / 280）比例各不相同，一份派生图配合 CSS 的 object-fit + focal
   * 定位可以通吃；服务端裁死反而没法适配。
   *
   * withoutEnlargement：小于目标宽度的原图跳过放大，避免造出比原图还大的
   * 「派生图」。此时该档的 width 会小于标称值，故消费方必须按 sizes[].width
   * 的实际值拼 srcset，不能假定它等于 320/768/1600。
   *
   * focalPoint 在 Payload 3.86 默认即为 true（uploads/types.d.ts:210-214），
   * 显式写出是因为它是前台 object-position 的数据来源，不能被后来者当成
   * 无用配置删掉。
   */
  upload: {
    focalPoint: true,
    imageSizes: [
      { name: 'thumb', width: 320, withoutEnlargement: true, formatOptions: { format: 'webp' } },
      { name: 'card', width: 768, withoutEnlargement: true, formatOptions: { format: 'webp' } },
      { name: 'hero', width: 1600, withoutEnlargement: true, formatOptions: { format: 'webp' } },
    ],
  },
}
