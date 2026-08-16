'use client'

import MediaWorkbench, { type MediaWorkbenchConfig } from './MediaWorkbench'

/** 楼盘媒体分类：与 Buildings.mediaItems.category 枚举（BUILDING_MEDIA_CATEGORIES）保持一致。 */
const BUILDING_MEDIA_CONFIG: MediaWorkbenchConfig = {
  workbenchTitle: '楼盘媒体工作台',
  workbenchSubtitle: '支持图片/视频批量拖拽上传、智能格式识别、九宫格调序与一键封面设定',
  categoryLabels: {
    exterior: '外立面/建筑外观',
    lobby: '大堂/前台',
    'common-area': '公区/电梯厅',
    facilities: '配套设施/周边',
  },
  defaultUploadCategory: 'exterior',
  docTitleField: 'name',
  docTitleFallback: '楼盘',
  coverSetMessage: '已设为楼盘封面图',
}

/**
 * 楼盘媒体工作台薄入口：通用实现见 MediaWorkbench，
 * 这里只声明楼盘领域配置（分类枚举 / 文案 / 标题字段）。
 */
export default function BuildingMediaManager(props?: { path?: string; schemaPath?: string }) {
  return (
    <MediaWorkbench
      path={props?.path}
      schemaPath={props?.schemaPath}
      config={BUILDING_MEDIA_CONFIG}
      maxRows={40}
    />
  )
}
