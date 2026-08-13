import type { CollectionConfig } from 'payload'

import { createFieldMaskHooks } from '@/domain/auth/field-hooks'
import { getCityPartnerApplicationMaskRules } from '@/domain/auth/field-mask'
import { activeLocationFilter } from '@/domain/geography/location-hierarchy'
import {
  cityPartnerApplicationManageAccess,
  cityPartnerApplicationReadAccess,
} from '@/domain/city-partner-application/access'
import { protectCityPartnerApplication } from '@/domain/city-partner-application/application-protect'
import { enqueueCityPartnerApplicationCreated } from '@/domain/city-partner-application/application-notify'
import {
  CITY_PARTNER_IDENTITIES,
  CITY_PARTNER_IDENTITY_LABELS,
  CITY_PARTNER_RESOURCE_LABELS,
  CITY_PARTNER_RESOURCE_TYPES,
  CITY_PARTNER_STATUSES,
  CITY_PARTNER_STATUS_LABELS,
} from '@/domain/city-partner-application/schema'

export const CityPartnerApplications: CollectionConfig = {
  slug: 'city-partner-applications',
  labels: { singular: '城市合伙人申请', plural: '城市合伙人申请' },
  admin: {
    group: false,
    useAsTitle: 'applicantName',
    defaultColumns: [
      'city', 'applicantName', 'contactPhone', 'applicantIdentity',
      'status', 'assignee', 'createdAt',
    ],
  },
  access: {
    read: cityPartnerApplicationReadAccess,
    update: cityPartnerApplicationManageAccess,
    create: () => false,
    delete: () => false,
  },
  hooks: {
    beforeChange: [protectCityPartnerApplication],
    afterChange: [enqueueCityPartnerApplicationCreated],
    afterRead: createFieldMaskHooks(getCityPartnerApplicationMaskRules()),
  },
  versions: { drafts: false, maxPerDoc: 50 },
  fields: [
    {
      type: 'tabs',
      tabs: [
        {
          label: '第一阶段申请事实',
          fields: [
            { name: 'city', type: 'relationship', relationTo: 'locations', required: true, index: true, filterOptions: () => activeLocationFilter(['city']) },
            { name: 'applicantName', type: 'text', required: true, maxLength: 50 },
            { name: 'contactPhone', type: 'text', required: true, maxLength: 20 },
            { name: 'applicantIdentity', type: 'select', required: true, options: CITY_PARTNER_IDENTITIES.map((value) => ({ value, label: CITY_PARTNER_IDENTITY_LABELS[value] })) },
            { name: 'otherIdentity', type: 'text', maxLength: 100 },
          ],
        },
        {
          label: '第二阶段补充事实',
          fields: [
            { name: 'organizationName', type: 'text', maxLength: 100 },
            { name: 'resourceTypes', type: 'select', hasMany: true, options: CITY_PARTNER_RESOURCE_TYPES.map((value) => ({ value, label: CITY_PARTNER_RESOURCE_LABELS[value] })) },
            { name: 'otherResource', type: 'text', maxLength: 200 },
            { name: 'experienceSummary', type: 'textarea', maxLength: 2000 },
            { name: 'cooperationPlan', type: 'textarea', maxLength: 2000 },
            { name: 'detailsCompletedAt', type: 'date', admin: { readOnly: true } },
            { name: 'detailsFingerprint', type: 'text', admin: { hidden: true, readOnly: true } },
          ],
        },
        {
          label: '运营流程',
          fields: [
            { name: 'status', type: 'select', required: true, defaultValue: 'pending', index: true, options: CITY_PARTNER_STATUSES.map((value) => ({ value, label: CITY_PARTNER_STATUS_LABELS[value] })) },
            { name: 'assignee', type: 'relationship', relationTo: 'users', index: true },
            { name: 'internalNote', type: 'textarea', maxLength: 5000 },
            { name: 'handledAt', type: 'date', admin: { readOnly: true } },
          ],
        },
        {
          label: '溯源与合规',
          fields: [
            { name: 'requestId', type: 'text', required: true, maxLength: 100, admin: { readOnly: true } },
            { name: 'idempotencyKey', type: 'text', required: true, unique: true, index: true, admin: { readOnly: true } },
            { name: 'sourcePath', type: 'text', required: true, maxLength: 300, admin: { readOnly: true } },
            { name: 'sourceUrl', type: 'text', maxLength: 1000, admin: { readOnly: true } },
            { name: 'consentAccepted', type: 'checkbox', required: true, admin: { readOnly: true } },
            { name: 'consentPolicyVersion', type: 'text', required: true, maxLength: 100, admin: { readOnly: true } },
            { name: 'submitterIpHash', type: 'text', maxLength: 128, admin: { readOnly: true } },
          ],
        },
      ],
    },
  ],
}
