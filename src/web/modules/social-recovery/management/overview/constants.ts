import type { SetupDraft } from '@web/modules/social-recovery/sdk-interfaces'

export const OVERVIEW = 'socialRecovery.management.overview'

/**
 * The draft a removal's stored write carries: the record of a write in flight
 * holds a draft, and a removal commits none. Nothing reads it back.
 */
export const REMOVAL_DRAFT: SetupDraft = {
  wait: 0n,
  clauses: [],
  ignoresPause: true,
  privacy: { publicMetadata: '0x', backup: 'empty' }
}
