import type { CollectionConfig } from 'payload'

import {
  invalidateSupplyCacheAfterMediaDelete,
  unmountMediaReferences,
} from '@/domain/media/media-delete-cleanup'
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
   * OPT-070：删 media 前先摘掉房源 / 楼盘图集与媒体工作台里指向它的行。
   *
   * 不摘就会撞上 `NOT NULL` + `ON DELETE SET NULL` 的死结（23502），后台只显示
   * 「Something went wrong.」。完整病理与「为什么是摘除而不是放宽 NOT NULL」
   * 见 `domain/media/media-delete-cleanup.ts` 的头注释。
   *
   * afterDelete 的缓存失效必须排在 beforeDelete 之后消费它算好的城市——
   * 两者用 `req.context` 传递，删除真正成功了才会失效。
   */
  hooks: {
    beforeDelete: [unmountMediaReferences],
    afterDelete: [invalidateSupplyCacheAfterMediaDelete],
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
