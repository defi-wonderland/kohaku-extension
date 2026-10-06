import type { ReactElement } from 'react'

/**
 * The warning's forms: the recover door's, the one in front of the password
 * reset and the seed import, and the condensed one an entry inside settings
 * draws above its own content.
 */
export type WarningForm = 'recover' | 'reset' | 'condensed'

export interface WarningPointer {
  line: string
  action: string
}

/** The string keys one form draws, in reading order. */
export interface WarningCopy {
  /** Whether the form opens with the fast track's step counter. */
  counter: boolean
  header: string | null
  lead: string
  lines: readonly string[]
  pointer: WarningPointer | null
  acknowledge: string
  /** Whether the form offers a way off the screen beside continue. */
  leave: boolean
}

interface WarningGateBase {
  /** Runs once the holder gave the acknowledgment and pressed continue. */
  onContinue: () => void
  testID?: string
}

export interface RecoverWarningProps extends WarningGateBase {
  form: 'recover'
  onLeave: () => void
  onImportInstead: () => void
}

export interface ResetWarningProps extends WarningGateBase {
  form: 'reset'
  onLeave: () => void
}

export interface CondensedWarningProps extends WarningGateBase {
  form: 'condensed'
}

export type WarningGateProps = RecoverWarningProps | ResetWarningProps | CondensedWarningProps

export interface ResetEntryGateProps {
  /** The entry's own screen, mounted only after the acknowledgment and continue. */
  children: ReactElement
  onLeave: () => void
}
