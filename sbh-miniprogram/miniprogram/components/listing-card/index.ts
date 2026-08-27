function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function displayTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((tag): tag is string => typeof tag === 'string').slice(0, 3)
}

function sameTags(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((tag, index) => tag === right[index])
}

Component({
  properties: {
    listing: {
      type: Object,
      value: null,
      observer(listing: unknown) {
        const record = isRecord(listing) ? listing : {}
        const slug = stringValue(record.slug)
        const imageUrl = stringValue(record.imageUrl)
        const tags = displayTags(record.tags)
        const listingChanged = slug !== this.data.listingSlug || imageUrl !== this.data.listingImageUrl

        if (!listingChanged && sameTags(tags, this.data.displayTags)) {
          return
        }

        this.setData({
          listingSlug: slug,
          listingImageUrl: imageUrl,
          displayTags: tags,
          ...(listingChanged ? { imageFailed: false } : {}),
        })
      },
    },
  },
  data: {
    imageFailed: false,
    listingSlug: '',
    listingImageUrl: '',
    displayTags: [] as string[],
  },
  methods: {
    handleImageError() {
      this.setData({ imageFailed: true })
    },
    handleOpen(event: WechatMiniprogram.BaseEvent) {
      const slug = event.currentTarget.dataset.slug
      if (typeof slug !== 'string' || !slug) {
        return
      }

      this.triggerEvent('open', { slug })
    },
  },
})
