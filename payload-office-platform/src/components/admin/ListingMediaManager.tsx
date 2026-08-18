'use client'

import MediaWorkbench, { type MediaWorkbenchConfig } from './MediaWorkbench'

/** 房源媒体分类：与 Listings.mediaItems.category 枚举（LISTING_MEDIA_CATEGORIES）保持一致。 */
const LISTING_MEDIA_CONFIG: MediaWorkbenchConfig = {
  workbenchTitle: '房源媒体工作台',
  workbenchSubtitle: '支持图片/视频批量拖拽上传、智能格式识别、九宫格调序与一键封面设定',
  categoryLabels: {
    workspace: '办公空间',
    'meeting-room': '会议室',
    'common-area': '公区/电梯厅',
    exterior: '外立面/建筑外观',
  },
  defaultUploadCategory: 'workspace',
  docTitleField: 'title',
  docTitleFallback: '房源',
  coverSetMessage: '已设为房源封面图',
  // 与 MIN_SUBMIT_MEDIA / 有效供给 §6（listings_gallery COUNT >= 3）对齐
  publishedImageFloor: 3,
}

/**
 * 房源媒体工作台薄入口：通用实现见 MediaWorkbench，
 * 这里只声明房源领域配置（分类枚举 / 文案 / 标题字段）。
 */
export default function ListingMediaManager(props?: { path?: string; schemaPath?: string }) {
  return (
    <MediaWorkbench
      path={props?.path}
      schemaPath={props?.schemaPath}
      config={LISTING_MEDIA_CONFIG}
      maxRows={40}
    />
  )
}
