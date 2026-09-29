import type { SetupDraft } from '@web/modules/social-recovery/sdk-interfaces'

import { PICKER_CEILING_HOURS, WAIT_CHIPS, WAIT_FLOOR_HOURS } from './types'
import type { CustomWait, WaitChoice } from './types'

const SECONDS_PER_HOUR = 3600n

export const secondsOfHours = (hours: number): SetupDraft['wait'] =>
  BigInt(hours) * SECONDS_PER_HOUR

/**
 * Reads the custom entry, which counts whole hours. An entry with anything but
 * digits is refused with the floor until it is whole hours, so a decimal or a
 * unit never turns into another length. The ceiling is checked before the
 * floor.
 */
export const readCustomWait = (text: string): CustomWait => {
  if (text === '') return { status: 'empty' }
  if (!/^[0-9]+$/.test(text)) return { status: 'belowMinimum' }
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
 * entry in hours. A length the picker refuses, under the floor, past the
 * ceiling or not a whole number of hours, goes into the custom entry as well,
 * so its refusal shows and continue stays held.
 */
export const choiceOfSeconds = (seconds: SetupDraft['wait']): WaitChoice => {
  if (seconds % SECONDS_PER_HOUR !== 0n) {
    return { kind: 'custom', text: String(Number(seconds) / Number(SECONDS_PER_HOUR)) }
  }
  const hours = seconds / SECONDS_PER_HOUR
  const chip = WAIT_CHIPS.find((candidate) => BigInt(candidate.hours) === hours)
  return chip ? { kind: 'chip', id: chip.id } : { kind: 'custom', text: String(hours) }
}
