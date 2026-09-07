Component({
  properties: {
    kind: {
      type: String,
      value: 'empty',
      observer(value) {
        const resolvedKind = value === 'loading' || value === 'error' ? value : 'empty'
        if (this.data.resolvedKind !== resolvedKind) {
          this.setData({ resolvedKind })
        }
      },
    },
    title: {
      type: String,
      value: '',
    },
    description: {
      type: String,
      value: '',
    },
    actionLabel: {
      type: String,
      value: '',
    },
  },
  data: {
    resolvedKind: 'empty',
  },
  methods: {
    handleRetry() {
      if (this.data.resolvedKind === 'error') {
        this.triggerEvent('retry')
      }
    },
  },
})
