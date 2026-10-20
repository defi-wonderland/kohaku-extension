import { WEB_ROUTES } from '@common/modules/router/constants/common'
import type { SetupDraft } from '@web/modules/social-recovery/sdk-interfaces'
import type { ManageIntent } from '@web/modules/social-recovery/shared/writes'

import type { ElsewhereLink } from './types'

export const OVERVIEW = 'socialRecovery.management.overview'

/** The keys of the recovery password ask of a locked path. */
export const LOCKED = `${OVERVIEW}.locked`

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

/** Where each of the management editor's writes is followed, the line that says so, and the link's label. */
export const MANAGE_LINKS: Readonly<Record<ManageIntent, ElsewhereLink>> = {
  manageEdit: {
    route: WEB_ROUTES.socialRecoveryManageReview,
    line: `${OVERVIEW}.writes.editInFlight`,
    label: `${OVERVIEW}.writes.openReview`
  },
  manageRemove: {
    route: WEB_ROUTES.socialRecoveryManageRemove,
    line: `${OVERVIEW}.writes.removeInFlight`,
    label: `${OVERVIEW}.writes.openRemove`
  }
}
