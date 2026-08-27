function isGalleryRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

type GalleryImage = Readonly<{
  src: string
  alt: string
}>

function normalizeImages(value: unknown): GalleryImage[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((image) => {
    if (!isGalleryRecord(image) || typeof image.src !== 'string' || !image.src) return []
    return [{
      src: image.src,
      alt: typeof image.alt === 'string' ? image.alt : '',
    }]
  })
}

Component({
  properties: {
    images: {
      type: Array,
      value: [],
      observer(images: unknown) {
        this.setData({
          displayImages: normalizeImages(images),
          current: 0,
          currentLabel: 1,
          failedImages: [],
        })
      },
    },
  },
  data: {
    displayImages: [] as GalleryImage[],
    current: 0,
    currentLabel: 1,
    failedImages: [] as boolean[],
  },
  methods: {
    handleChange(event: WechatMiniprogram.SwiperChange) {
      const current = event.detail.current
      if (!Number.isInteger(current) || current < 0 || current >= this.data.displayImages.length) {
        return
      }
      this.setData({ current, currentLabel: current + 1 })
    },
    handleImageError(event: WechatMiniprogram.BaseEvent) {
      const index = Number(event.currentTarget.dataset.index)
      if (!Number.isSafeInteger(index) || index < 0 || index >= this.data.displayImages.length) {
        return
      }
      const failedImages = this.data.failedImages.slice()
      failedImages[index] = true
      this.setData({ failedImages })
    },
  },
})
