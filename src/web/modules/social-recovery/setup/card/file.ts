/**
 * The card as a file: a one-page PDF with the card's rows and nothing else,
 * readable offline and printable from any reader.
 */
import type { Translate } from '@web/modules/social-recovery/shared/display'

import { cardRowsOf } from './card'
import { cardPdfOf } from './pdf'
import type { CardFile, RecoveryCard } from './types'

const CARD_FILE_NAME = 'kohaku-recovery-card.pdf'
const CARD_FILE_TYPE = 'application/pdf'

export const cardFileOf = (card: RecoveryCard, t: Translate): CardFile => ({
  name: CARD_FILE_NAME,
  type: CARD_FILE_TYPE,
  ...cardPdfOf(t('socialRecovery.card.cardTitle'), cardRowsOf(card, t))
})
