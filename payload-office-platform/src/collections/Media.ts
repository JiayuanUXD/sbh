import type { CollectionConfig } from 'payload'

import { MEDIA_COS_PREFIX } from '@/lib/storage/cos-config'

export const Media: CollectionConfig = {
  slug: 'media',
  labels: {
    singular: '媒体',
    plural: '素材库',
  },
  admin: {
    group: false,
    useAsTitle: 'alt',
  },
  access: {
    read: () => true,
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
  upload: true,
}
