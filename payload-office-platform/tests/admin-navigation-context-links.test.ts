import { describe, expect, it, vi } from 'vitest'
import type { SanitizedPermissions } from 'payload'
import { isValidElement } from 'react'

import { Leads } from '@/collections/Leads'

vi.mock('@/components/admin/FormSubmissionsLinkClient', () => ({
  default: function FormSubmissionsLinkClient() {
    return null
  },
}))

vi.mock('@/components/admin/LeadOwnershipHistoryLinkClient', () => ({
  default: function LeadOwnershipHistoryLinkClient() {
    return null
  },
}))

import FormSubmissionsLink from '@/components/admin/FormSubmissionsLink'
import FormSubmissionsLinkClient from '@/components/admin/FormSubmissionsLinkClient'
import LeadOwnershipHistoryLink from '@/components/admin/LeadOwnershipHistoryLink'
import LeadOwnershipHistoryLinkClient from '@/components/admin/LeadOwnershipHistoryLinkClient'
import {
  buildFormSubmissionsURL,
  buildLeadOwnershipHistoryURL,
  canReadContextCollection,
} from '@/domain/admin-navigation/context-links'

const { default: configPromise } = await import('@/payload.config')
const payloadConfig = await configPromise

function componentPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((component) => {
    if (typeof component === 'string') return [component]
    if (
      typeof component === 'object' &&
      component !== null &&
      'path' in component &&
      typeof component.path === 'string'
    ) {
      return [component.path]
    }
    return []
  })
}

describe('admin navigation context links', () => {
  it('builds the ownership history URL for a lead edit page', () => {
    expect(buildLeadOwnershipHistoryURL(42)).toBe(
      '/admin/collections/lead-ownership-history?where%5Blead%5D%5Bequals%5D=42',
    )
  })

  it('builds the submissions URL for a form edit page', () => {
    expect(buildFormSubmissionsURL('form-42')).toBe(
      '/admin/collections/form-submissions?where%5Bform%5D%5Bequals%5D=form-42',
    )
  })

  it('returns null when an edit document has no ID', () => {
    expect(buildLeadOwnershipHistoryURL(undefined)).toBeNull()
    expect(buildFormSubmissionsURL(null)).toBeNull()
    expect(buildLeadOwnershipHistoryURL('')).toBeNull()
  })

  it('encodes special-character IDs through URLSearchParams', () => {
    expect(buildLeadOwnershipHistoryURL('lead & = ?')).toBe(
      '/admin/collections/lead-ownership-history?where%5Blead%5D%5Bequals%5D=lead+%26+%3D+%3F',
    )
  })

  it('rejects non-scalar IDs', () => {
    expect(buildLeadOwnershipHistoryURL(['lead-1'])).toBeNull()
    expect(buildFormSubmissionsURL({ id: 'form-1' })).toBeNull()
  })

  it('only permits a target collection when sanitized permissions grant read', () => {
    const readable: SanitizedPermissions = {
      collections: {
        'lead-ownership-history': { fields: true, read: true },
      },
    }
    const unreadable: SanitizedPermissions = {
      collections: {
        'lead-ownership-history': { fields: true },
      },
    }

    expect(canReadContextCollection(readable, 'lead-ownership-history')).toBe(true)
    expect(canReadContextCollection(unreadable, 'lead-ownership-history')).toBe(false)
    expect(canReadContextCollection(undefined, 'form-submissions')).toBe(false)
  })

  it('does not render the ownership history client link without target read permission', () => {
    const element = LeadOwnershipHistoryLink({
      id: 'lead-1',
      permissions: { collections: { 'lead-ownership-history': { fields: true } } },
    })

    expect(element).toBeNull()
  })

  it('renders the ownership history client link without serializing permissions', () => {
    const element = LeadOwnershipHistoryLink({
      id: 'lead-1',
      permissions: {
        collections: { 'lead-ownership-history': { fields: true, read: true } },
      },
    })

    expect(isValidElement(element)).toBe(true)
    if (!isValidElement(element)) throw new Error('expected a React element')
    expect(element.type).toBe(LeadOwnershipHistoryLinkClient)
    expect(element.props).toEqual({})
    expect(element.props).not.toHaveProperty('permissions')
  })

  it('does not render the submissions client link without target read permission', () => {
    const element = FormSubmissionsLink({
      id: 'form-1',
      permissions: { collections: { 'form-submissions': { fields: true } } },
    })

    expect(element).toBeNull()
  })

  it('renders the submissions client link without serializing permissions', () => {
    const element = FormSubmissionsLink({
      id: 'form-1',
      permissions: {
        collections: { 'form-submissions': { fields: true, read: true } },
      },
    })

    expect(isValidElement(element)).toBe(true)
    if (!isValidElement(element)) throw new Error('expected a React element')
    expect(element.type).toBe(FormSubmissionsLinkClient)
    expect(element.props).toEqual({})
    expect(element.props).not.toHaveProperty('permissions')
  })

  it('registers the ownership history link before lead document controls', () => {
    expect(componentPaths(Leads.admin?.components?.edit?.beforeDocumentControls)).toContain(
      '/components/admin/LeadOwnershipHistoryLink',
    )
  })

  it('registers the submissions link without losing form builder overrides', () => {
    const forms = payloadConfig.collections.find((collection) => collection.slug === 'forms')
    const submissions = payloadConfig.collections.find(
      (collection) => collection.slug === 'form-submissions',
    )

    expect(componentPaths(forms?.admin.components?.edit?.beforeDocumentControls)).toContain(
      '/components/admin/FormSubmissionsLink',
    )
    expect(forms?.admin.group).toBe(false)
    expect(submissions?.admin.group).toBe(false)
    expect(submissions?.fields.length).toBeGreaterThan(0)
    expect(submissions?.hooks.beforeChange.length).toBeGreaterThan(0)
    expect(submissions?.access.update).toBeDefined()
  })
})
