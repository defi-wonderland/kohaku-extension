import type { ReactNode } from 'react'
import type { StyleProp, ViewStyle } from 'react-native'

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

export interface PlainHeaderProps {
  /** The words beside the extension's name; a header with none draws the name alone. */
  title?: string
  testID?: string
}

export interface PlainChromeProps {
  /** The header's words, passed on to the plain header. */
  title?: string
  children: ReactNode
  testID?: string
}

export interface StepCounterProps {
  /** The string key of the counter line; the line takes the step and the total. */
  labelKey: string
  step: number
  total: number
  testID?: string
}
