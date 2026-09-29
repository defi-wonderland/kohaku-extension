import type { ComponentType } from 'react'

import type { Address, PrivacyLevel } from '@web/modules/social-recovery/sdk-interfaces'
import type { AddressBook } from '@web/modules/social-recovery/shared/client'
import type { ChainId, WalletRecords } from '@web/modules/social-recovery/shared/records'

/** The shortest waiting period this wallet saves. The chain enforces no minimum. */
export const WAIT_FLOOR_HOURS = 24

/**
 * The longest waiting period the picker accepts, 90 days in hours. A
 * placeholder until the SDK fixes the value.
 */
export const PICKER_CEILING_HOURS = 90 * 24

/** The fixed chips of the picker with their lengths in hours, in the order they show. */
export const WAIT_CHIPS = [
  { id: 'hours24', hours: 24 },
  { id: 'hours48', hours: 48 },
  { id: 'hours72', hours: 72 },
  { id: 'days7', hours: 7 * 24 }
] as const
export type WaitChipId = typeof WAIT_CHIPS[number]['id']

/** What the picker holds: one of the chips, or the custom entry as typed. */
export type WaitChoice = { kind: 'chip'; id: WaitChipId } | { kind: 'custom'; text: string }

/** The custom entry read: empty, refused with its reason, or a length in hours. */
export type CustomWait =
  | { status: 'empty' }
  | { status: 'belowMinimum' }
  | { status: 'pastCeiling' }
  | { status: 'accepted'; hours: number }

/** The levels this step offers, the default first. The level between them is not offered yet. */
export const OFFERED_LEVELS = ['private', 'public'] as const
export type OfferedLevel = Extract<PrivacyLevel, typeof OFFERED_LEVELS[number]>

/** What the privacy step stores: Private with the recovery password, or Public with none. */
export type PrivacyChoice = { level: 'private'; password: string } | { level: 'public' }

/** The method kind a row of the path holds: one of the address book's method slugs. */
export type MethodKind = keyof AddressBook['methods']

/**
 * The exposure line of a path: the guessability half, which exists only for a
 * path with an address row, and the publication half every path carries.
 */
export interface ExposureLines {
  guardians?: string
  unguessable?: string
  publication: string
}

export interface StepViewProps {
  records: WalletRecords
  chainId: ChainId
  account: Address
  navigate: (to: string) => void
}

export type WaitingPeriodViewProps = StepViewProps

export type PrivacyViewProps = StepViewProps

export interface SettingsChromeProps {
  /** The step the chrome holds, given the selected account's records. */
  step: ComponentType<StepViewProps>
}
