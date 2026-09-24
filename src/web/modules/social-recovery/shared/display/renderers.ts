/**
 * The value renderers of D-302: one form per value type on every recovery
 * surface, so a reader never learns two truncations for one thing.
 *
 * Sources: docs/social-recovery/design/ux.md D-302, invariants.yaml I-41,
 * live-frame-strings.md K-08 (value block) and K-09 (deadline and countdown).
 * Every function here is pure: it reads no clock, no zone and no storage, and
 * takes `now` and the zone as parameters. Strings come from `t`.
 */
import { formatUnits, getAddress } from 'ethers'

import type { Address, Hex, PaymentOrder } from '@web/modules/social-recovery/sdk-interfaces'

import { appTranslate, Translate } from './translate'
import { renderChip, renderValueLabel } from './vocabulary'

/** The one ellipsis every truncation uses. */
export const ELLIPSIS = '…'

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/
const HEX_PATTERN = /^0x[0-9a-fA-F]*$/
const ZERO_ADDRESS = `0x${'0'.repeat(40)}`

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

/**
 * The address checksummed (EIP-55), whatever the casing it came in. Throws a
 * TypeError on a value that is not a 20-byte hex address.
 */
export const checksumAddress = (address: string): Address => {
  if (!ADDRESS_PATTERN.test(address)) {
    throw new TypeError(`Not an address: ${address}`)
  }
  return getAddress(address.toLowerCase()) as Address
}

/**
 * The short form: the first four and last four hex digits after the prefix,
 * checksummed, `0x2b0F…6ef5` (D-302). The recovery surfaces use it wherever the
 * reader neither copies nor compares the address.
 */
export const renderShortAddress = (address: string): string => {
  const full = checksumAddress(address)
  return `${full.slice(0, 6)}${ELLIPSIS}${full.slice(-4)}`
}

/**
 * The full form: the address whole, checksummed, with no grouping of its
 * digits (D-302). It renders on a review or confirmation block, on the cancel
 * banner, on the guardian row's new key, on the approval page's fields, on the
 * key to fund, on the Recovery Card and wherever the reader copies or compares.
 */
export const renderFullAddress = (address: string): string => checksumAddress(address)

// ---------------------------------------------------------------------------
// Hashes and approvals
// ---------------------------------------------------------------------------

const truncateHex = (value: string, lead: number, tail: number): string => {
  if (!HEX_PATTERN.test(value)) {
    throw new TypeError(`Not hex: ${value}`)
  }
  const digits = value.slice(2)
  if (digits.length <= lead + tail) return value
  return `0x${digits.slice(0, lead)}${ELLIPSIS}${digits.slice(-tail)}`
}

/** Leading and trailing digits of a transaction hash or a challenge (D-302). */
export const HASH_DIGITS = { lead: 12, tail: 6 } as const

/** Leading and trailing digits of an approval blob (D-302). */
export const APPROVAL_DIGITS = { lead: 12, tail: 8 } as const

/**
 * A transaction hash or a challenge as twelve leading and six trailing digits,
 * `0x8f31a27b04ce…5d19c2` (D-302). A value that short or shorter renders whole.
 */
export const renderHash = (hash: Hex | string): string =>
  truncateHex(hash, HASH_DIGITS.lead, HASH_DIGITS.tail)

/**
 * An approval blob as twelve leading and eight trailing digits,
 * `0x8ba2c71f04e9…5fa37ad3` (D-302). A value that short or shorter renders whole.
 */
export const renderApproval = (approval: Hex | string): string =>
  truncateHex(approval, APPROVAL_DIGITS.lead, APPROVAL_DIGITS.tail)

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** The most characters a name or a user-typed method name renders with (D-302). */
export const NAME_MAX_LENGTH = 24

/**
 * A resolved name or a user-typed method name, whole up to 24 characters and
 * capped at 24 past that, the last one the ellipsis (D-302). Counts code
 * points, so an emoji is never split.
 */
export const ellipsizeName = (name: string): string => {
  const chars = Array.from(name)
  if (chars.length <= NAME_MAX_LENGTH) return name
  return `${chars.slice(0, NAME_MAX_LENGTH - 1).join('')}${ELLIPSIS}`
}

/**
 * Where a resolved name renders, which decides the caveat of I-41:
 * - `besideAddressToCheck`: beside a full address the reader is asked to check;
 * - `aloneForAction`: alone, for an address the reader is asked to act on;
 * - `informationOnly`: where the screen asks the reader to check nothing.
 */
export const NAME_USES = ['besideAddressToCheck', 'aloneForAction', 'informationOnly'] as const
export type NameUse = typeof NAME_USES[number]

export interface RenderedName {
  /** The name, ellipsized past 24 characters. */
  name: string
  /** The I-41 caveat, or null where the screen asks the reader to check nothing. */
  caveat: string | null
}

/** Tells whether a resolved name in this use carries the I-41 caveat. */
export const nameNeedsCaveat = (use: NameUse): boolean => use !== 'informationOnly'

/**
 * A resolved name with its caveat under I-41: the name can change hands and the
 * full address is what to check. The caveat renders beside a name standing
 * beside a full address to check and beside a name alone for an address to
 * act on; an account line that asks the reader to check nothing is exempt.
 */
export const renderResolvedName = (
  name: string,
  use: NameUse,
  t: Translate = appTranslate
): RenderedName => ({
  name: ellipsizeName(name),
  caveat: nameNeedsCaveat(use) ? t('socialRecovery.display.nameCaveat') : null
})

// ---------------------------------------------------------------------------
// Hidden value
// ---------------------------------------------------------------------------

export interface RenderedHiddenValue {
  /** Sixteen dots. */
  dots: string
  /** The hidden chip that renders beside them. */
  chip: string
}

/**
 * A hidden value as sixteen dots beside a hidden chip, so a masked value never
 * looks like a load failure (D-302).
 */
export const renderHiddenValue = (t: Translate = appTranslate): RenderedHiddenValue => ({
  dots: t('socialRecovery.display.hiddenValue'),
  chip: t('socialRecovery.display.hiddenChip')
})

// ---------------------------------------------------------------------------
// Member list
// ---------------------------------------------------------------------------

/** How many members a list shows before the count of the rest (D-302). */
export const MEMBER_LIST_VISIBLE = 3

export interface RenderedMemberList<T> {
  /** The members the list shows, in the order given. */
  shown: readonly T[]
  /** How many members the list does not show. */
  restCount: number
  /** The count line, `2 more members`, or null where nothing is left out. */
  more: string | null
}

/**
 * A member list as three members then a count of the rest (D-302). The
 * checklist of D-392 shows every member and passes `showAll`.
 */
export const renderMemberList = <T>(
  members: readonly T[],
  options: { showAll?: boolean } = {},
  t: Translate = appTranslate
): RenderedMemberList<T> => {
  if (options.showAll || members.length <= MEMBER_LIST_VISIBLE) {
    return { shown: members, restCount: 0, more: null }
  }
  const restCount = members.length - MEMBER_LIST_VISIBLE
  return {
    shown: members.slice(0, MEMBER_LIST_VISIBLE),
    restCount,
    more: t('socialRecovery.display.moreMembers', { count: restCount })
  }
}

// ---------------------------------------------------------------------------
// Payment order
// ---------------------------------------------------------------------------

/** What the wallet knows of the token a payment order names. */
export interface PaymentToken {
  symbol: string
  decimals: number
}

/**
 * A token amount in human units, with at least two decimals and no trailing
 * zero past them: `12500000` at six decimals reads `12.50`.
 */
export const renderTokenAmount = (amount: bigint, decimals: number): string => {
  const [whole, fraction = ''] = formatUnits(amount, decimals).split('.')
  const trimmed = fraction.replace(/0+$/, '')
  return `${whole}.${trimmed.padEnd(2, '0')}`
}

/**
 * The payment order as the token's symbol, a human amount and the payee beside
 * it, one form on every screen: `12.50 USDC to 0x…` or `12.50 USDC to whoever
 * executes` where the payee is zero (D-302, contracts D-103). A missing order
 * or a zero amount renders the words no payment. The payee renders in the full
 * form unless the caller passes `payeeForm: 'short'`.
 *
 * The payment order is a second-release value (D-393); a first-release request
 * names no payment and renders no payment.
 */
export const renderPaymentOrder = (
  order: PaymentOrder | null | undefined,
  token: PaymentToken | null | undefined,
  options: { payeeForm?: 'full' | 'short' } = {},
  t: Translate = appTranslate
): string => {
  if (!order || order.amount === 0n) {
    return renderValueLabel('noPayment', t)
  }
  if (!token) {
    throw new TypeError('A payment order renders only with its token symbol and decimals')
  }
  const amount = renderTokenAmount(order.amount, token.decimals)
  if (order.payee.toLowerCase() === ZERO_ADDRESS) {
    return t('socialRecovery.display.paymentOrderOpenPayee', { amount, symbol: token.symbol })
  }
  const payee =
    options.payeeForm === 'short' ? renderShortAddress(order.payee) : renderFullAddress(order.payee)
  return t('socialRecovery.display.paymentOrder', { amount, symbol: token.symbol, payee })
}

// ---------------------------------------------------------------------------
// Deadline and countdown
// ---------------------------------------------------------------------------

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS

/** The locale the deadline's date and time render in, `13 Aug, 18:04 CEST`. */
export const DEADLINE_LOCALE = 'en-GB'

export interface RenderedDeadline {
  /** The date and time in the reader's zone with the zone named, `13 Aug, 18:04 CEST`. */
  date: string
  /** The zone's name as the date shows it, `CEST`. */
  zone: string
  /** The time left, `23 hours`, or null once the deadline has passed. */
  remaining: string | null
  /** True once `now` reaches the deadline. */
  passed: boolean
  /** The deadline line, `Valid until 13 Aug, 18:04 CEST · 23 hours left`, or null once passed. */
  line: string | null
}

const toMs = (value: Date | number): number => (typeof value === 'number' ? value : value.getTime())

/** The date and time of `at` in `timeZone`, the zone named, and the zone alone. */
export const renderDateTimeInZone = (
  at: Date | number,
  timeZone: string,
  locale: string = DEADLINE_LOCALE
): { date: string; zone: string } => {
  const format = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
    timeZoneName: 'short'
  })
  const date = new Date(toMs(at))
  const zone = format.formatToParts(date).find((part) => part.type === 'timeZoneName')?.value ?? ''
  return { date: format.format(date), zone }
}

/**
 * The time left before a deadline in whole hours, or in whole minutes under one
 * hour, `23 hours` (live-frame-strings K-09).
 */
export const renderRemaining = (remainingMs: number, t: Translate = appTranslate): string => {
  if (remainingMs >= HOUR_MS) {
    const count = Math.floor(remainingMs / HOUR_MS)
    return t('socialRecovery.display.remainingHours', { count })
  }
  const count = Math.max(1, Math.ceil(remainingMs / MINUTE_MS))
  return t('socialRecovery.display.remainingMinutes', { count })
}

/**
 * The deadline as a date and time in the reader's zone, the zone named, with
 * the time left beside it (D-302, K-09): `Valid until 13 Aug, 18:04 CEST ·
 * 23 hours left`. `now` and the reader's zone are parameters, so the output
 * depends on nothing else.
 */
export const renderDeadline = (
  input: { deadline: Date | number; now: Date | number; timeZone: string; locale?: string },
  t: Translate = appTranslate
): RenderedDeadline => {
  const { date, zone } = renderDateTimeInZone(input.deadline, input.timeZone, input.locale)
  const remainingMs = toMs(input.deadline) - toMs(input.now)
  if (remainingMs <= 0) {
    return { date, zone, remaining: null, passed: true, line: null }
  }
  const remaining = renderRemaining(remainingMs, t)
  return {
    date,
    zone,
    remaining,
    passed: false,
    line: t('socialRecovery.display.deadlineValidUntil', { date, remaining })
  }
}

/** The time left of a waiting period as hours, minutes and seconds, `47:12:06` (K-09). */
export const renderCountdownTime = (remainingMs: number): string => {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
}

/** The two states of a running attempt's countdown (D-302). */
export const COUNTDOWN_STATES = ['waiting', 'executionDue'] as const
export type CountdownState = typeof COUNTDOWN_STATES[number]

/**
 * A running attempt's countdown (D-302, K-09): `47:12:06 · waiting` while the
 * waiting period runs and `Execution due` once it ends. `stopped` marks a
 * security stop on the attempt, a second-release state: `47:12:06 · stopped`
 * and `Execution due · stopped`.
 */
export const renderCountdown = (
  input: { state: CountdownState; remainingMs: number; stopped?: boolean },
  t: Translate = appTranslate
): string => {
  if (input.state === 'executionDue') {
    return input.stopped
      ? t('socialRecovery.display.countdownExecutionDueStopped')
      : renderChip('attempt', 'executionDue', t)
  }
  const time = renderCountdownTime(input.remainingMs)
  return input.stopped
    ? t('socialRecovery.display.countdownStopped', { time })
    : t('socialRecovery.display.countdownWaiting', { time })
}
