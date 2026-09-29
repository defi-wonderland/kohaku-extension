import type { SetupDraft } from '@web/modules/social-recovery/sdk-interfaces'

import { PICKER_CEILING_HOURS, WAIT_CHIPS, WAIT_FLOOR_HOURS } from './types'
import type { CustomWait, WaitChoice } from './types'

const SECONDS_PER_HOUR = 3600n

export const secondsOfHours = (hours: number): SetupDraft['wait'] =>
  BigInt(hours) * SECONDS_PER_HOUR

/** The custom entry keeps digits alone, since it counts whole hours. */
export const customTextOf = (typed: string): string => typed.replace(/[^0-9]/g, '')

/** Reads the custom entry. The ceiling is checked before the floor. */
export const readCustomWait = (text: string): CustomWait => {
  if (text === '') return { status: 'empty' }
  const hours = Number(text)
  if (hours > PICKER_CEILING_HOURS) return { status: 'pastCeiling' }
  if (hours < WAIT_FLOOR_HOURS) return { status: 'belowMinimum' }
  return { status: 'accepted', hours }
}

/** The length the picker holds in hours, or undefined while the custom entry is empty or refused. */
export const hoursOfChoice = (choice: WaitChoice): number | undefined => {
  if (choice.kind === 'chip') return WAIT_CHIPS.find(({ id }) => id === choice.id)?.hours
  const custom = readCustomWait(choice.text)
  return custom.status === 'accepted' ? custom.hours : undefined
}

/** The picker's state when no waiting period is stored: 48 hours. */
export const DEFAULT_CHOICE: WaitChoice = { kind: 'chip', id: 'hours48' }

/**
 * The picker's state for a stored waiting period: its chip, or the custom
 * entry in whole hours. A length that is no whole number of hours, or that the
 * picker would refuse, falls back to the default.
 */
export const choiceOfSeconds = (seconds: SetupDraft['wait']): WaitChoice => {
  if (seconds % SECONDS_PER_HOUR !== 0n) return DEFAULT_CHOICE
  const hours = Number(seconds / SECONDS_PER_HOUR)
  const chip = WAIT_CHIPS.find((candidate) => candidate.hours === hours)
  if (chip) return { kind: 'chip', id: chip.id }
  const text = String(hours)
  return readCustomWait(text).status === 'accepted' ? { kind: 'custom', text } : DEFAULT_CHOICE
}
