import type { ReactNode, RefObject } from 'react'
import type { StyleProp, View, ViewStyle } from 'react-native'

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

/**
 * How a path tree's line crosses one node: not at all, from the node's top
 * down to its tick, from its tick down to its bottom, or its whole height.
 */
export type PathTreeSegment = 'none' | 'top' | 'bottom' | 'full'

/**
 * A node of a path tree: a branch the line ticks into, a node the line only
 * passes beside, or a junction that shows the tree's label on the line.
 */
export type PathTreeNodeVariant = 'branch' | 'through' | 'junction'

export interface PathTreeProps {
  /** The tree's nodes, each a `PathTreeNode`, in the order the path reads. */
  children: ReactNode
  /** The word a junction node shows on the line. */
  label?: string
  style?: StyleProp<ViewStyle>
  testID?: string
}

export interface PathTreeNodeProps {
  /** A junction shows the tree's label and needs no children. */
  children?: ReactNode
  variant?: PathTreeNodeVariant
  /**
   * How far below the node's top the tick meets the line, for a branch, until
   * a `PathTreeHeader` inside it has been laid out, and for a branch with none.
   */
  anchor?: number
  testID?: string
}

/** What a branch hands the header inside it: itself, and where to report the header's middle. */
export interface PathTreeHeaderTarget {
  node: RefObject<View>
  onMiddle: (middle: number) => void
}

export interface PathTreeHeaderProps {
  /** The part of a branch the tick points at, for example a group's title row. */
  children: ReactNode
  style?: StyleProp<ViewStyle>
  testID?: string
}
