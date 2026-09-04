import type { ListingDetailPresentation } from '../../domain/listing-detail-presentation.js'
import {
  createInquirySheetController,
  type InquirySheetContext,
  type InquirySheetController,
  type InquirySheetSnapshot,
} from '../../components/inquiry-sheet/controller.js'
import {
  presentListingCard,
  type ListingCardPresentation,
} from '../../domain/listing-presentation.js'
import { catalog } from '../../services/catalog.js'
import {
  buildListingDetailPath,
  listingNavigation,
} from '../../services/listing-navigation.js'
import {
  createInquiryService,
  createSubmissionIntentManager,
} from '../../services/inquiry.js'
import { isListingFavorite, toggleListingFavorite } from '../../services/favorites.js'
import { recordInquiry } from '../../services/inquiry-tracker.js'
import { request } from '../../services/request.js'
import { createSessionService } from '../../services/session.js'
import {
  createListingDetailController,
  type ListingDetailController,
  type ListingDetailSnapshot,
  type ListingDetailState,
} from './controller.js'

type ListingDetailPageContent = Readonly<
  Omit<ListingDetailPresentation, 'relatedListings'> & {
    relatedListings: readonly ListingCardPresentation[]
  }
>

type ListingDetailPageData = {
  state: ListingDetailState
  slug: string
  content: ListingDetailPageContent | null
  fallbackListings: readonly ListingCardPresentation[]
  loadingFallback: boolean
  inquiryOpen: boolean
  inquirySheet: InquirySheetSnapshot
  isFavorited: boolean
}

type ListingOpenEvent = Readonly<{
  detail: Readonly<{ slug?: unknown }>
}>

type ValueEvent = Readonly<{ detail: Readonly<{ value?: unknown }> }>
type ConsentEvent = Readonly<{ detail: Readonly<{ accepted?: unknown }> }>
type PhoneAuthorizationEvent = Readonly<{ detail: Readonly<{ phoneCode?: unknown }> }>

type ListingDetailPageMethods = {
  listingDetailController: ListingDetailController | null
  inquirySheetController: InquirySheetController | null
  ensureListingDetailController(): ListingDetailController
  ensureInquirySheetController(): InquirySheetController
  handleRetry(): void
  handleBackToListings(): void
  handleRelatedOpen(event: ListingOpenEvent): void
  openDetail(slug: string): void
  handleToggleFavorite(): void
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
  handleBuildingOpen(event: WechatMiniprogram.CustomEvent | WechatMiniprogram.TouchEvent): void
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
      success: ({ code: loginCode }) => resolve({ code: loginCode }),
      fail: reject,
    })
  })
}

function openPrivacyContract(): Promise<void> {
  return new Promise((resolve, reject) => {
    const privacyApi = (wx as unknown as {
      openPrivacyContract?: (options: Readonly<{
        success(): void
        fail(error: unknown): void
      }>) => void
    }).openPrivacyContract
    if (!privacyApi) {
      reject(new Error('privacy contract unavailable'))
      return
    }
    try {
      privacyApi({ success: resolve, fail: reject })
    } catch {
      reject(new Error('privacy contract unavailable'))
    }
  })
}

const sessionService = createSessionService({
  login: requestLoginCode,
  request,
})
const inquiryService = createInquiryService({
  request,
  getAnonymousContextToken: sessionService.getToken,
  clearAnonymousContext: sessionService.clear,
})
const submissionIntentManager = createSubmissionIntentManager()

function inquiryContext(
  slug: string,
  content: ListingDetailPageContent,
): InquirySheetContext {
  return {
    target: {
      targetType: 'listing',
      listingSlug: slug,
      ...(content.building?.slug ? { buildingSlug: content.building.slug } : {}),
    },
    title: content.title,
    facts: {
      area: content.specifications.find((item) => item.id === 'area')?.value ?? '—',
      unitPrice: content.secondaryPrice || '—',
      monthlyEstimate: content.primaryPrice,
    },
    policyVersion: content.inquiryPolicyVersion,
  }
}

function projectSnapshot(snapshot: ListingDetailSnapshot): Partial<ListingDetailPageData> {
  return {
    state: snapshot.state,
    slug: snapshot.slug,
    isFavorited: isListingFavorite(snapshot.slug),
    fallbackListings: snapshot.fallbackListings.map(presentListingCard),
    loadingFallback: snapshot.loadingFallback,
    content: snapshot.content === null
      ? null
      : {
          ...snapshot.content,
          relatedListings: snapshot.content.relatedListings.map(presentListingCard),
        },
  }
}

function showNavigationFailure(message: string): void {
  wx.showToast({ title: message, icon: 'none', duration: 1600 })
}

Page<ListingDetailPageData, ListingDetailPageMethods>({
  data: {
    state: 'loading',
    slug: '',
    content: null,
    fallbackListings: [],
    loadingFallback: false,
    inquiryOpen: false,
    inquirySheet: closedInquirySheet(),
    isFavorited: false,
  },

  listingDetailController: null,
  inquirySheetController: null,

  onLoad(options) {
    const slug = typeof options.slug === 'string' ? options.slug : ''
    void this.ensureListingDetailController().load(slug)
  },

  onUnload() {
    this.listingDetailController?.dispose()
    this.inquirySheetController?.dispose()
    sessionService.clear()
    submissionIntentManager.invalidate()
    this.listingDetailController = null
    this.inquirySheetController = null
  },

  onPullDownRefresh() {
    return this.ensureListingDetailController().refresh()
  },

  onShareAppMessage() {
    try {
      return {
        title: this.data.content?.title ?? '尚办好房源',
        path: buildListingDetailPath(this.data.slug),
      }
    } catch {
      return { title: '尚办好', path: '/pages/home/index' }
    }
  },

  ensureListingDetailController() {
    if (this.listingDetailController === null) {
      this.listingDetailController = createListingDetailController({
        getListingDetail: (slug) => catalog.getListingDetail(slug),
        getFallbackListings: async () => (await catalog.getHome('shanghai')).featuredListings,
        onChange: (snapshot) => {
          const projected = projectSnapshot(snapshot)
          this.setData(projected)
          if (this.data.inquiryOpen && projected.content) {
            void this.ensureInquirySheetController().syncContext(
              inquiryContext(snapshot.slug, projected.content),
            )
          }
        },
        stopPullDownRefresh: () => wx.stopPullDownRefresh(),
      })
    }
    return this.listingDetailController
  },

  ensureInquirySheetController() {
    if (this.inquirySheetController === null) {
      this.inquirySheetController = createInquirySheetController({
        openIntent: submissionIntentManager.open,
        invalidateIntent: submissionIntentManager.invalidate,
        ensureAnonymousContext: sessionService.ensureAnonymousContext,
        openPrivacyContract,
        submit: async (input) => {
          const result = await inquiryService.submit(input)
          if (result.ok) {
            recordInquiry({
              submissionRequestId: input.submissionRequestId,
              targetType: input.target.targetType,
              targetSlug: input.target.targetType === 'general'
                ? undefined
                : input.target.targetType === 'listing'
                  ? input.target.listingSlug
                  : input.target.buildingSlug,
              targetTitle: this.data.content?.title || '商办房源咨询',
              imageUrl: this.data.content?.gallery?.[0]?.src,
              status: 'pending',
              statusLabel: '待带看',
            })
          }
          return result
        },
        onChange: (snapshot) => this.setData({
          inquirySheet: snapshot,
          inquiryOpen: snapshot.state !== 'closed',
        }),
      })
    }
    return this.inquirySheetController
  },

  handleToggleFavorite() {
    const slug = this.data.slug
    const content = this.data.content
    if (!slug) return
    const isNowFav = toggleListingFavorite({
      slug,
      title: content?.title || '商办房源',
      imageUrl: content?.gallery?.[0]?.src,
    })
    this.setData({ isFavorited: isNowFav })
    wx.showToast({
      title: isNowFav ? '已收藏该房源' : '已取消收藏',
      icon: 'success',
    })
  },

  handleRetry() {
    if (this.data.state === 'stale') {
      void this.ensureListingDetailController().refresh()
      return
    }
    void this.ensureListingDetailController().load(this.data.slug)
  },

  handleBackToListings() {
    void listingNavigation.open('').catch(() => {
      showNavigationFailure('暂时无法打开找房页')
    })
  },

  handleRelatedOpen(event) {
    const slug = event.detail.slug
    if (typeof slug !== 'string' || !slug) return
    this.openDetail(slug)
  },

  handleBuildingOpen(event) {
    const slug = event.currentTarget.dataset.slug
    if (typeof slug !== 'string' || !slug) return
    void listingNavigation.openBuildingDetail(slug).catch(() => {
      showNavigationFailure('暂时无法打开楼盘详情')
    })
  },

  openDetail(slug) {
    void listingNavigation.openDetail(slug).catch(() => {
      showNavigationFailure('暂时无法打开房源详情')
    })
  },

  handleOpenInquiry() {
    if (
      this.data.state !== 'ready'
      && this.data.state !== 'refreshing'
      && this.data.state !== 'stale'
    ) return
    if (!this.data.content) return
    void this.ensureInquirySheetController().open(
      inquiryContext(this.data.slug, this.data.content),
    )
  },

  handleInquiryClose() {
    // 微信公开组件/API 没有可靠的程序化 button 无障碍焦点恢复能力。
    // 这里只恢复页面交互；关闭后的真实焦点效果须 VoiceOver/TalkBack 真机验收。
    this.inquirySheetController?.close()
  },

  handleInquiryPrivacy() {
    void this.ensureInquirySheetController().verifyPrivacy()
  },

  handleInquiryMoveInChange(event) {
    if (typeof event.detail.value !== 'string') return
    this.ensureInquirySheetController().setMoveInTime(event.detail.value)
  },

  handleInquiryPhoneChange(event) {
    if (typeof event.detail.value !== 'string') return
    this.ensureInquirySheetController().setPhone(event.detail.value)
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
    if (typeof phoneCode !== 'string') return
    void this.ensureInquirySheetController().submitPhoneCode(phoneCode)
  },

  handleInquiryPhoneRejected() {
    this.ensureInquirySheetController().rejectPhoneAuthorization()
  },

  handleInquiryManualSubmit() {
    void this.ensureInquirySheetController().submitManual()
  },
})
