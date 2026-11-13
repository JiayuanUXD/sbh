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
import { refreshUserAssets } from '../../services/favorites.js'
import { createDetailFavoriteController, type DetailFavoriteController } from '../../services/detail-favorite.js'
import {
  createInquiryService,
  createSubmissionIntentManager,
} from '../../services/inquiry.js'
import { request } from '../../services/request.js'
import { createSessionService } from '../../services/session.js'
import { MiniApiError } from '../../services/mini-api-error.js'
import { markImageFailed, type ImageFailureState } from '../../utils/image-failure-state.js'

const SAFE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function isValidBuildingSlug(slug: unknown): slug is string {
  return typeof slug === 'string' && SAFE_SLUG_PATTERN.test(slug)
}

function isBuildingNotFound(error: unknown): boolean {
  return error instanceof MiniApiError && (error.code === 'building_not_found' || error.statusCode === 404)
}

type BuildingDetailState = 'loading' | 'ready' | 'error' | 'not-found'

type BuildingDetailPageData = {
  slug: string
  state: BuildingDetailState
  building: MiniBuildingDetailData | null
  gradeLabel: string
  currentGalleryIndex: number
  galleryImageFailures: ImageFailureState
  listingImageFailures: ImageFailureState
  comparableImageFailures: ImageFailureState
  isFavorited: boolean
  favoriteBusy: boolean
  favoriteUnavailable: boolean
  inquiryOpen: boolean
  inquirySheet: InquirySheetSnapshot
}

type ValueEvent = Readonly<{ detail: Readonly<{ value?: unknown }> }>
type ConsentEvent = Readonly<{ detail: Readonly<{ accepted?: unknown }> }>
type PhoneAuthorizationEvent = Readonly<{ detail: Readonly<{ phoneCode?: unknown }> }>

type BuildingDetailPageMethods = {
  loadVersion: number
  inquirySheetController: InquirySheetController | null
  favoriteController: DetailFavoriteController | null
  ensureInquirySheetController(): InquirySheetController
  loadBuildingDetail(targetSlug?: unknown): Promise<void>
  loadFavoriteState(slug: string): Promise<void>
  handleFav(): Promise<void>
  handleGalleryChange(event: WechatMiniprogram.CustomEvent): void
  handleGalleryImageError(event: WechatMiniprogram.BaseEvent): void
  handleListingImageError(event: WechatMiniprogram.BaseEvent): void
  handleComparableImageError(event: WechatMiniprogram.BaseEvent): void
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
    galleryImageFailures: {},
    listingImageFailures: {},
    comparableImageFailures: {},
    isFavorited: false,
    favoriteBusy: true,
    favoriteUnavailable: false,
    inquiryOpen: false,
    inquirySheet: closedInquirySheet(),
  },

  loadVersion: 0,
  inquirySheetController: null,
  favoriteController: null,

  onLoad(options: Record<string, string | undefined>) {
    const rawSlug = options.slug
    const slug = typeof rawSlug === 'string' ? rawSlug.trim() : ''
    this.setData({ slug })
    if (isValidBuildingSlug(slug)) {
      void this.loadBuildingDetail(slug)
    } else {
      this.setData({ state: 'not-found', building: null, isFavorited: false, favoriteBusy: false })
    }
  },

  onShow() {
    if (this.data.slug && this.data.state === 'ready') {
      void this.loadFavoriteState(this.data.slug)
    }
  },

  onUnload() {
    this.favoriteController?.dispose()
    this.loadVersion = (this.loadVersion || 0) + 1
    this.inquirySheetController?.dispose()
    this.inquirySheetController = null
    sessionService.clear()
    submissionIntentManager.invalidate()
  },

  async loadBuildingDetail(targetSlug?: unknown) {
    const isStringSlug = typeof targetSlug === 'string' && targetSlug.trim().length > 0
    const slug = isStringSlug ? (targetSlug as string).trim() : this.data.slug
    if (!isValidBuildingSlug(slug)) {
      this.setData({ state: 'not-found', building: null, isFavorited: false, favoriteBusy: false })
      return
    }
    if (!isStringSlug && this.data.state === 'loading') {
      return
    }
    const version = (this.loadVersion = (this.loadVersion || 0) + 1)
    this.setData({ state: 'loading', favoriteBusy: true })
    try {
      const building = await getBuildingDetail(slug)
      if (this.loadVersion !== version) return
      this.setData({
        state: 'ready',
        building,
        gradeLabel: building.grade ? buildingGradeLabel(building.grade) : '—',
        currentGalleryIndex: 0,
        galleryImageFailures: {},
        listingImageFailures: {},
        comparableImageFailures: {},
      })
      wx.setNavigationBarTitle({ title: building.name })
      void this.loadFavoriteState(building.slug)
    } catch (error: unknown) {
      if (this.loadVersion !== version) return
      this.setData({
        state: isBuildingNotFound(error) ? 'not-found' : 'error',
        building: null,
        isFavorited: false,
        favoriteBusy: false,
      })
    }
  },

  handleGalleryImageError(event) {
    const index = Number(event.currentTarget.dataset.index)
    if (!Number.isSafeInteger(index) || index < 0) return
    this.setData({
      galleryImageFailures: markImageFailed(this.data.galleryImageFailures, String(index)),
    })
  },

  handleListingImageError(event) {
    const id = event.currentTarget.dataset.id
    if (typeof id !== 'string' || !id) return
    this.setData({
      listingImageFailures: markImageFailed(this.data.listingImageFailures, id),
    })
  },

  handleComparableImageError(event) {
    const id = event.currentTarget.dataset.id
    if (typeof id !== 'string' || !id) return
    this.setData({
      comparableImageFailures: markImageFailed(this.data.comparableImageFailures, id),
    })
  },

  async loadFavoriteState(slug) {
    if (!slug || slug !== this.data.slug) return
    this.favoriteController ??= createDetailFavoriteController(
      { targetType: 'building', targetSlug: slug },
      (view) => this.setData(view),
    )
    await this.favoriteController.refresh()
  },

  async handleFav() {
    await this.favoriteController?.activate()
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
