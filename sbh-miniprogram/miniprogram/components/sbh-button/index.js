Component({
  properties: {
    variant: {
      type: String,
      value: 'primary',
      observer(value) {
        const resolvedVariant = value === 'secondary' ? 'secondary' : 'primary'
        if (this.data.resolvedVariant !== resolvedVariant) {
          this.setData({ resolvedVariant })
        }
      },
    },
    loading: {
      type: Boolean,
      value: false,
    },
    disabled: {
      type: Boolean,
      value: false,
    },
  },
  data: {
    resolvedVariant: 'primary',
  },
  methods: {
    handleTap() {
      if (this.data.disabled || this.data.loading) {
        return
      }

      this.triggerEvent('tap')
    },
  },
})
