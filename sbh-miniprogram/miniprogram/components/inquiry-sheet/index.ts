Component({
  properties: {
    snapshot: {
      type: Object,
      value: null,
    },
  },

  methods: {
    handleClose() {
      const snapshot = this.data.snapshot as Readonly<{ state?: unknown }> | null
      if (snapshot?.state === 'authorizing' || snapshot?.state === 'submitting') return
      this.triggerEvent('close')
    },

    handlePanelTap() {
      // 阻止面板内点击穿透到遮罩。
    },

    handleTouchMove() {
      // catchtouchmove 锁定详情页背景滚动。
    },

    handleMoveInInput(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
      this.triggerEvent('moveinchange', { value: event.detail.value })
    },

    handlePhoneInput(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
      this.triggerEvent('phonechange', { value: event.detail.value })
    },

    handleSelectManual() {
      this.triggerEvent('selectmanual')
    },

    handleSelectWechat() {
      this.triggerEvent('selectwechat')
    },

    handleConsentChange(event: WechatMiniprogram.CustomEvent<{ value: string[] }>) {
      this.triggerEvent('consentchange', {
        accepted: Array.isArray(event.detail.value) && event.detail.value.includes('accepted'),
      })
    },

    handlePrivacy() {
      this.triggerEvent('privacy')
    },

    handlePhoneAuthorization(event: WechatMiniprogram.CustomEvent<{
      errMsg?: string
      code?: string
    }>) {
      const detail = event.detail
      if (
        typeof detail?.errMsg === 'string'
        && detail.errMsg === 'getPhoneNumber:ok'
        && typeof detail.code === 'string'
        && detail.code.length > 0
      ) {
        this.triggerEvent('phoneauthorize', { phoneCode: detail.code })
        return
      }
      this.triggerEvent('phonerejected')
    },

    handleManualSubmit() {
      this.triggerEvent('manualsubmit')
    },
  },
})
