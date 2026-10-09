Component({
  properties: {
    mode: {
      type: String,
      value: 'compact',
      observer(value) {
        const resolvedMode = value === 'detail' ? 'detail' : 'compact'

        if (this.data.resolvedMode !== resolvedMode) {
          this.setData({ resolvedMode })
        }
      },
    },
    label: {
      type: String,
      value: '实景图片待补充',
    },
  },

  data: {
    resolvedMode: 'compact',
  },
})
