import type { WarningCopy, WarningForm } from './types'

const WARNING = 'socialRecovery.recover.warning'

/**
 * The strings of one form of the warning. The pointer line and the step
 * counter belong to the recover door alone; the reset entries take the shorter
 * acknowledgment; the condensed form keeps the lead and one line.
 */
export const warningCopyOf = (form: WarningForm): WarningCopy => {
  if (form === 'condensed') {
    return {
      counter: false,
      header: null,
      lead: `${WARNING}.lead`,
      lines: [`${WARNING}.condensed`],
      pointer: null,
      acknowledge: `${WARNING}.acknowledgeRecover`,
      leave: false
    }
  }
  const recover = form === 'recover'
  return {
    counter: recover,
    header: `${WARNING}.header`,
    lead: `${WARNING}.lead`,
    lines: [
      `${WARNING}.body`,
      `${WARNING}.nobodyWatches`,
      `${WARNING}.nobodyNeedsPhrase`,
      `${WARNING}.walkAway`
    ],
    pointer: recover
      ? { line: `${WARNING}.importPointer`, action: `${WARNING}.importAction` }
      : null,
    acknowledge: recover ? `${WARNING}.acknowledgeRecover` : `${WARNING}.acknowledgeReset`,
    leave: true
  }
}
