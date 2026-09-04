import {
  createInquirySheetController,
  type InquirySheetContext,
  type InquirySheetController,
  type InquirySheetSnapshot,
} from '../../components/inquiry-sheet/controller.js'
import { getBuildingDetail } from '../../services/catalog.js'
import {
  buildingGradeLabel,
  type MiniBuildingDetailData,
} from '../../services/catalog-contracts.js'
import {
  isFavorite,
  loadUserAssets,
  refreshUserAssets,
  setFavorite,
} from '../../services/favorites.js'
import {
  createInquiryService,
  createSubmissionIntentManager,
} from '../../services/inquiry.js'
import { request } from '../../services/request.js'
import { createSessionService } from '../../services/session.js'

type BuildingDetailState = 'loading' | 'ready' | 'error' | 'not-found'

type BuildingDetailPageData = {
  slug: string
  state: BuildingDetailState
  building: MiniBuildingDetailData | null
  gradeLabel: string
  currentGalleryIndex: number
  isFavorited: boolean
  favoriteBusy: boolean
  inquiryOpen: boolean
  inquirySheet: InquirySheetSnapshot
}

type ValueEvent = Readonly<{ detail: Readonly<{ value?: unknown }> }>
type ConsentEvent = Readonly<{ detail: Readonly<{ accepted?: unknown }> }>
type PhoneAuthorizationEvent = Readonly<{ detail: Readonly<{ phoneCode?: unknown }> }>

type BuildingDetailPageMethods = {
  inquirySheetController: InquirySheetController | null
  ensureInquirySheetController(): InquirySheetController
  loadBuildingDetail(targetSlug?: string): Promise<void>
  loadFavoriteState(slug: string): Promise<void>
  handleFav(): Promise<void>
  handleGalleryChange(event: WechatMiniprogram.CustomEvent): void
  handleListingOpen(event: WechatMiniprogram.BaseEvent): void
  handleComparableOpen(event: WechatMiniprogram.BaseEvent): void
  handleInquiryAdvisor(): void
  handleInquiryClose(): void
  handleInquiryPrivacy(): void
  handleInquiryMoveInChange(event: ValueEvent): void
  handleInquiryPhoneChange(event: ValueEvent): void
  handleInquirySelectManual(): void
  handleInquirySelectWechat(): void
  handleInquiryConsentChange(event: ConsentEvent): void
  handleInquiryPhoneAuthorization(event: PhoneAuthorizationEvent): void
  handleInquiryPhoneRejected(): void
  handleInquiryManualSubmit(): void
  handleBackToList(): void
  handleScrollToListings(): void
}

function closedInquirySheet(): InquirySheetSnapshot {
  return {
    state: 'closed',
    context: null,
    submissionRequestId: null,
    moveInTime: '',
    phone: '',
    consentAccepted: false,
    privacyStatus: 'unchecked',
    phoneMode: 'wechat',
    errorReason: null,
    errorMessage: '',
    requiresNewPhoneAuthorization: false,
    successMessage: '',
    successFollowUp: '',
    busy: false,
    submitDisabled: true,
    phoneSubmitDisabled: true,
    manualSubmitDisabled: true,
  }
}

function requestLoginCode(): Promise<Readonly<{ code: string }>> {
  return new Promise((resolve, reject) => {
    wx.login({
      success: ({ code }) => resolve({ code }),
      fail: reject,
    })
  })
}

function openPrivacyContract(): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      wx.openPrivacyContract({ success: () => resolve(), fail: reject })
    } catch {
      reject(new Error('privacy contract unavailable'))
    }
  })
}

function inquiryContext(building: MiniBuildingDetailData): InquirySheetContext {
  return {
    target: { targetType: 'building', buildingSlug: building.slug },
    title: building.name,
    facts: {
      area: building.standardFloorArea === null ? '—' : `标准层 ${building.standardFloorArea} ㎡`,
      unitPrice: '—',
      monthlyEstimate: '—',
    },
    policyVersion: building.inquiryPolicy.version,
  }
}

const sessionService = createSessionService({ login: requestLoginCode, request })
const inquiryService = createInquiryService({
  request,
  getAnonymousContextToken: sessionService.getToken,
  clearAnonymousContext: sessionService.clear,
})
const submissionIntentManager = createSubmissionIntentManager()

Page<BuildingDetailPageData, BuildingDetailPageMethods>({
  data: {
    slug: '',
    state: 'loading',
    building: null,
    gradeLabel: '—',
    currentGalleryIndex: 0,
    isFavorited: false,
    favoriteBusy: true,
    inquiryOpen: false,
    inquirySheet: closedInquirySheet(),
  },

  inquirySheetController: null,

  onLoad(options: Record<string, string | undefined>) {
    const slug = options.slug ?? ''
    this.setData({ slug })
    if (slug) void this.loadBuildingDetail(slug)
    else this.setData({ state: 'not-found', favoriteBusy: false })
  },

  onUnload() {
    this.inquirySheetController?.dispose()
    this.inquirySheetController = null
    sessionService.clear()
    submissionIntentManager.invalidate()
  },

  async loadBuildingDetail(targetSlug) {
    const slug = targetSlug || this.data.slug
    if (!slug) return
    this.setData({ state: 'loading', favoriteBusy: true })
    try {
      const building = await getBuildingDetail(slug)
      this.setData({
        state: 'ready',
        building,
        gradeLabel: building.grade ? buildingGradeLabel(building.grade) : '—',
        currentGalleryIndex: 0,
      })
      wx.setNavigationBarTitle({ title: building.name })
      void this.loadFavoriteState(building.slug)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      this.setData({
        state: message.includes('404') || message.includes('not_found') || message.includes('无效')
          ? 'not-found'
          : 'error',
        building: null,
        isFavorited: false,
        favoriteBusy: false,
      })
    }
  },

  async loadFavoriteState(slug) {
    this.setData({ favoriteBusy: true })
    try {
      const assets = await loadUserAssets()
      if (this.data.slug !== slug) return
      this.setData({
        isFavorited: isFavorite(assets, { targetType: 'building', targetSlug: slug }),
      })
    } catch {
      if (this.data.slug === slug) this.setData({ isFavorited: false })
    } finally {
      if (this.data.slug === slug) this.setData({ favoriteBusy: false })
    }
  },

  async handleFav() {
    const building = this.data.building
    if (this.data.favoriteBusy) return
    if (!building?.slug) return
    const target = { targetType: 'building' as const, targetSlug: building.slug }
    const favorite = !this.data.isFavorited
    this.setData({ favoriteBusy: true })
    try {
      const assets = await setFavorite(target, favorite)
      const isFavorited = isFavorite(assets, target)
      this.setData({ isFavorited })
      wx.showToast({
        title: isFavorited ? '已收藏该楼盘' : '已取消收藏',
        icon: 'success',
      })
    } catch {
      wx.showToast({ title: '收藏状态更新失败，请重试', icon: 'none' })
    } finally {
      this.setData({ favoriteBusy: false })
    }
  },

  ensureInquirySheetController() {
    if (this.inquirySheetController === null) {
      this.inquirySheetController = createInquirySheetController({
        openIntent: submissionIntentManager.open,
        invalidateIntent: submissionIntentManager.invalidate,
        ensureAnonymousContext: sessionService.ensureAnonymousContext,
        openPrivacyContract,
        submit: inquiryService.submit,
        onChange: (snapshot) => {
          this.setData({
            inquirySheet: snapshot,
            inquiryOpen: snapshot.state !== 'closed',
          })
          if (snapshot.state === 'success') {
            void refreshUserAssets().catch(() => undefined)
          }
        },
      })
    }
    return this.inquirySheetController
  },

  handleGalleryChange(event) {
    this.setData({ currentGalleryIndex: event.detail.current })
  },

  handleListingOpen(event) {
    const slug = event.currentTarget.dataset.slug
    if (typeof slug !== 'string' || !slug) return
    wx.navigateTo({ url: `/pages/listing-detail/index?slug=${encodeURIComponent(slug)}` })
  },

  handleComparableOpen(event) {
    const slug = event.currentTarget.dataset.slug
    if (typeof slug !== 'string' || !slug) return
    wx.navigateTo({ url: `/pages/building-detail/index?slug=${encodeURIComponent(slug)}` })
  },

  handleInquiryAdvisor() {
    const building = this.data.building
    if (!building || this.data.state !== 'ready') return
    void this.ensureInquirySheetController().open(inquiryContext(building))
  },

  handleInquiryClose() {
    this.inquirySheetController?.close()
  },

  handleInquiryPrivacy() {
    void this.ensureInquirySheetController().verifyPrivacy()
  },

  handleInquiryMoveInChange(event) {
    if (typeof event.detail.value === 'string') {
      this.ensureInquirySheetController().setMoveInTime(event.detail.value)
    }
  },

  handleInquiryPhoneChange(event) {
    if (typeof event.detail.value === 'string') {
      this.ensureInquirySheetController().setPhone(event.detail.value)
    }
  },

  handleInquirySelectManual() {
    this.ensureInquirySheetController().selectManual()
  },

  handleInquirySelectWechat() {
    this.ensureInquirySheetController().selectPhoneAuthorization()
  },

  handleInquiryConsentChange(event) {
    this.ensureInquirySheetController().setConsent(event.detail.accepted === true)
  },

  handleInquiryPhoneAuthorization(event) {
    const phoneCode = event.detail.phoneCode
    if (typeof phoneCode === 'string') {
      void this.ensureInquirySheetController().submitPhoneCode(phoneCode)
    }
  },

  handleInquiryPhoneRejected() {
    this.ensureInquirySheetController().rejectPhoneAuthorization()
  },

  handleInquiryManualSubmit() {
    void this.ensureInquirySheetController().submitManual()
  },

  handleBackToList() {
    wx.switchTab({ url: '/pages/buildings/index' })
  },

  handleScrollToListings() {
    wx.pageScrollTo({ selector: '.building-listings-card', duration: 300 })
  },
})
