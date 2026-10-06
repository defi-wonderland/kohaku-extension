import type { ReactNode } from 'react'
import type { StyleProp, ViewStyle } from 'react-native'
import type { Address } from 'viem'

import type { InputProps } from '@common/components/Input'

export interface SetupChromeProps {
  /** The screen's view, already keyed and given its props. */
  children: ReactNode
  testID?: string
}

export interface PageTitleProps {
  title: string
  lead?: string
  titleTestID?: string
  /** A trailing link under the lead. */
  children?: ReactNode
  testID?: string
}

export interface SectionLabelProps {
  children: string
  testID?: string
}

export type SectionCardTone = 'plain' | 'muted'

export type SectionCardSpacing = 'block' | 'item' | 'none'

export interface SectionCardProps {
  label?: string
  tone?: SectionCardTone
  spacing?: SectionCardSpacing
  children: ReactNode
  style?: StyleProp<ViewStyle>
  testID?: string
}

export interface ActionsRowProps {
  primary: ReactNode
  secondary?: ReactNode
  note?: string
  noteTestID?: string
  testID?: string
}

export type StatusChipTone = 'default' | 'success' | 'warning' | 'error'

export interface StatusChipProps {
  text: string
  tone?: StatusChipTone
  style?: ViewStyle
  testID?: string
}

export interface RadioCardProps {
  selected: boolean
  onPress: () => void
  disabled?: boolean
  testID: string
  children: ReactNode
}

export interface PillChoiceProps {
  label: string
  selected: boolean
  onPress: () => void
  disabled?: boolean
  style?: StyleProp<ViewStyle>
  testID: string
}

export interface NoteBoxProps {
  children: string
  testID?: string
}

export interface MethodRowProps {
  children: ReactNode
  /** A lighter border, for rows that only list. */
  quiet?: boolean
  style?: StyleProp<ViewStyle>
  testID?: string
}

export type FieldInputProps = InputProps

export interface SetupAccount {
  /** The account the setup tab works on: the latched one, else the wallet's selected one. */
  account: Address | undefined
  /** Whether the wallet's selected account is now another account. */
  differs: boolean
  /** The wallet's selected account, only while it differs from the tab's account. */
  selected: Address | undefined
  /** Latches the wallet's selected account in place of the tab's account. */
  switchToSelected: () => void
}

/** A location a setup visit settled, as the tab's session storage keeps it. */
export interface VisitedLocation {
  key: string
  pathname: string
}

/** How a location stands to the setup visit: already in it, a new step in it, or the start of a new one. */
export type VisitDecision = 'settled' | 'inside' | 'arrival'

export interface OtherAccountNoticeProps {
  /** The account the setup tab works on. */
  account: Address
  onSwitch: () => void
  testID?: string
}
