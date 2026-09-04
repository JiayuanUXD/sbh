import { catalog } from '../../services/catalog.js'
import {
  createInquirySheetController,
  type InquirySheetContext,
  type InquirySheetController,
  type InquirySheetSnapshot,
} from '../../components/inquiry-sheet/controller.js'
import { refreshUserAssets } from '../../services/favorites.js'
import {
  CURRENT_INQUIRY_POLICY_VERSION,
  createInquiryService,
  createSubmissionIntentManager,
} from '../../services/inquiry.js'
import { listingNavigation } from '../../services/listing-navigation.js'
import { request } from '../../services/request.js'
import { createSessionService } from '../../services/session.js'
import {
  createHomeLoadController,
  type HomeLoadController,
} from './controller.js'
import {
  buildSearchNavigation,
  type HomePageSnapshot,
} from './model.js'

type HomePageData = HomePageSnapshot & Readonly<{
  keyword: string
  heroVideoUrl: string
  heroPosterUrl: string
  videoFailed: boolean
  imageFailed: boolean
  inquiryOpen: boolean
  inquirySheet: InquirySheetSnapshot
}>

type SearchSubmitEvent = Readonly<{
  detail?: Readonly<{ value?: unknown }>
}>

type NavigationTapEvent = Readonly<{
  currentTarget: Readonly<{
    dataset: Readonly<{ query?: unknown }>
  }>
}>

type ListingOpenEvent = Readonly<{
  detail: Readonly<{ slug?: unknown }>
}>

type BuildingOpenEvent = Readonly<{
  detail: Readonly<{ slug?: unknown }>
}>

type ValueEvent = Readonly<{ detail: Readonly<{ value?: unknown }> }>
type ConsentEvent = Readonly<{ detail: Readonly<{ accepted?: unknown }> }>
type PhoneAuthorizationEvent = Readonly<{ detail: Readonly<{ phoneCode?: unknown }> }>

type HomePageMethods = {
  homeLoadController: HomeLoadController | null
  inquirySheetController: InquirySheetController | null
  ensureHomeLoadController(): HomeLoadController
  loadHome(refresh?: boolean): Promise<void>
  handleKeywordInput(event: WechatMiniprogram.Input): void
  handleSearchSubmit(event?: SearchSubmitEvent): void
  handleRetry(): void
  handleQuickFilter(event: NavigationTapEvent): void
  openListings(query: string): void
  handleListingOpen(event: ListingOpenEvent): void
  handleBrowseBuildings(): void
  handleBuildingOpenDirect(event: BuildingOpenEvent): void
  handleVideoError(): void
  handleImageError(): void
  ensureInquirySheetController(): InquirySheetController
  handleOpenInquiry(): void
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
}

function closedInquirySheet(): InquirySheetSnapshot {
  return {
    state: 'closed', context: null, submissionRequestId: null, moveInTime: '', phone: '',
    consentAccepted: false, privacyStatus: 'unchecked', phoneMode: 'wechat', errorReason: null,
    errorMessage: '', requiresNewPhoneAuthorization: false, successMessage: '', successFollowUp: '',
    busy: false, submitDisabled: true, phoneSubmitDisabled: true, manualSubmitDisabled: true,
  }
}

function requestLoginCode(): Promise<Readonly<{ code: string }>> {
  return new Promise((resolve, reject) => wx.login({
    success: ({ code }) => resolve({ code }),
    fail: reject,
  }))
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

function generalInquiryContext(): InquirySheetContext {
  return {
    target: { targetType: 'general' },
    title: '告诉我们办公需求',
    facts: { area: '全上海', unitPrice: '多种计价', monthlyEstimate: '按需求匹配' },
    policyVersion: CURRENT_INQUIRY_POLICY_VERSION,
  }
}

const sessionService = createSessionService({ login: requestLoginCode, request })
const inquiryService = createInquiryService({
  request,
  getAnonymousContextToken: sessionService.getToken,
  clearAnonymousContext: sessionService.clear,
})
const submissionIntentManager = createSubmissionIntentManager()

function currentSnapshot(data: HomePageData): HomePageSnapshot {
  return {
    state: data.state,
    content: data.content,
    refreshError: data.refreshError,
  }
}

Page<HomePageData, HomePageMethods>({
  data: {
    state: 'idle',
    content: null,
    refreshError: false,
    keyword: '',
    heroVideoUrl: '/api/media/file/hero-bg.mp4?prefix=media',
    heroPosterUrl: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?q=80&w=1200&auto=format&fit=crop',
    videoFailed: false,
    imageFailed: false,
    inquiryOpen: false,
    inquirySheet: closedInquirySheet(),
  },

  homeLoadController: null,
  inquirySheetController: null,

  onLoad() {
    void this.loadHome(false)
  },

  onUnload() {
    this.homeLoadController?.invalidate()
    this.inquirySheetController?.dispose()
    sessionService.clear()
    submissionIntentManager.invalidate()
    this.homeLoadController = null
    this.inquirySheetController = null
  },

  onPullDownRefresh() {
    return this.loadHome(true)
  },

  ensureHomeLoadController() {
    if (this.homeLoadController === null) {
      this.homeLoadController = createHomeLoadController({
        getHome: () => catalog.getHome('shanghai'),
        getSnapshot: () => currentSnapshot(this.data),
        setSnapshot: (snapshot) => this.setData(snapshot),
        stopPullDownRefresh: () => wx.stopPullDownRefresh(),
      })
    }
    return this.homeLoadController
  },

  loadHome(refresh = false) {
    return this.ensureHomeLoadController().load(refresh)
  },

  handleKeywordInput(event) {
    this.setData({ keyword: event.detail.value })
  },

  handleSearchSubmit(event) {
    const submittedValue = event?.detail?.value
    const keyword = typeof submittedValue === 'string' ? submittedValue : this.data.keyword
    this.setData({ keyword })
    this.openListings(buildSearchNavigation(keyword))
  },

  handleRetry() {
    void this.loadHome(false)
  },

  handleQuickFilter(event) {
    const query = event.currentTarget.dataset.query
    if (typeof query !== 'string') return
    this.openListings(query)
  },

  openListings(query) {
    void listingNavigation.open(query).catch(() => {
      wx.showToast({
        title: '暂时无法打开找房页',
        icon: 'none',
        duration: 1600,
      })
    })
  },

  handleListingOpen(event) {
    const slug = event.detail.slug
    if (typeof slug !== 'string' || !slug) return

    void listingNavigation.openDetail(slug).catch(() => {
      wx.showToast({
        title: '暂时无法打开房源详情',
        icon: 'none',
        duration: 1600,
      })
    })
  },

  handleBrowseBuildings() {
    void listingNavigation.openBuildings().catch(() => {
      wx.showToast({
        title: '暂时无法打开楼盘页',
        icon: 'none',
        duration: 1600,
      })
    })
  },

  handleBuildingOpenDirect(event) {
    const slug = event.detail.slug
    if (typeof slug !== 'string' || !slug) return
    void listingNavigation.openBuildingDetail(slug).catch(() => {
      wx.showToast({
        title: '暂时无法打开楼盘详情',
        icon: 'none',
        duration: 1600,
      })
    })
  },

  handleVideoError() {
    this.setData({ videoFailed: true })
  },

  handleImageError() {
    this.setData({ imageFailed: true })
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
          this.setData({ inquirySheet: snapshot, inquiryOpen: snapshot.state !== 'closed' })
          if (snapshot.state === 'success') void refreshUserAssets().catch(() => undefined)
        },
      })
    }
    return this.inquirySheetController
  },

  handleOpenInquiry() { void this.ensureInquirySheetController().open(generalInquiryContext()) },
  handleInquiryClose() { this.inquirySheetController?.close() },
  handleInquiryPrivacy() { void this.ensureInquirySheetController().verifyPrivacy() },
  handleInquiryMoveInChange(event) {
    if (typeof event.detail.value === 'string') this.ensureInquirySheetController().setMoveInTime(event.detail.value)
  },
  handleInquiryPhoneChange(event) {
    if (typeof event.detail.value === 'string') this.ensureInquirySheetController().setPhone(event.detail.value)
  },
  handleInquirySelectManual() { this.ensureInquirySheetController().selectManual() },
  handleInquirySelectWechat() { this.ensureInquirySheetController().selectPhoneAuthorization() },
  handleInquiryConsentChange(event) { this.ensureInquirySheetController().setConsent(event.detail.accepted === true) },
  handleInquiryPhoneAuthorization(event) {
    if (typeof event.detail.phoneCode === 'string') void this.ensureInquirySheetController().submitPhoneCode(event.detail.phoneCode)
  },
  handleInquiryPhoneRejected() { this.ensureInquirySheetController().rejectPhoneAuthorization() },
  handleInquiryManualSubmit() { void this.ensureInquirySheetController().submitManual() },
})
