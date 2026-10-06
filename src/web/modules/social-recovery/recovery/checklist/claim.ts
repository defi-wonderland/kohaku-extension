/**
 * The passkey row's claim: the ceremony request it stores before the tab
 * leaves for the ceremony, and what it reads back from that request and from
 * the tab's report. A stored request and a report are read from storage, so
 * their values are checked here before the row uses them.
 */
import type { ApproverReply } from '@web/modules/social-recovery/sdk-interfaces'
import { AUTHENTICATOR_PLACES } from '@web/modules/social-recovery/shared/ceremony'
import { sameAddress } from '@web/modules/social-recovery/shared/client'
import type { CeremonyRequestRecord } from '@web/modules/social-recovery/shared/records'

import { PASSKEY_SLUG } from './constants'
import type { ClaimAsked, ClaimRequestInput, ClaimTarget, PassedClaim } from './types'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/** The claim's ceremony request: the place's request, and whether the holder chose the phone. */
export const claimRequestRecordOf = (input: ClaimRequestInput): CeremonyRequestRecord => ({
  call: 'createClaim',
  method: PASSKEY_SLUG,
  account: input.account,
  chainId: input.chainId,
  request: input.request,
  params: { handOff: input.handOff }
})

/**
 * What a stored request asked for, or null for any other request: the
 * requests live under one key for every account, so a request another
 * account, chain or call stored is not this checklist's to take.
 */
export const claimAskedOf = (
  record: CeremonyRequestRecord,
  target: ClaimTarget
): ClaimAsked | null => {
  if (record.call !== 'createClaim' || record.method !== PASSKEY_SLUG) {
    return null
  }
  if (!sameAddress(record.account, target.account)) {
    return null
  }
  if (BigInt(record.chainId) !== BigInt(target.chainId)) {
    return null
  }
  if (!sameAddress(record.request.account, target.account)) {
    return null
  }
  const handOff = isRecord(record.params) && record.params.handOff === true
  return { place: record.request.place, request: record.request, handOff }
}

/**
 * A passed claim's reply as the report carries it, with where the
 * authenticator sat, or null where the value carries no reply. The client's
 * add judges the reply itself; this check only keeps a value that is not one
 * away from it.
 */
export const claimReplyOf = (value: unknown): PassedClaim | null => {
  if (!isRecord(value) || !isRecord(value.reply)) {
    return null
  }
  const { reply, facts } = value
  if (reply.kind !== 'recovery-proof-reply' || typeof reply.place !== 'number') {
    return null
  }
  const place = isRecord(facts)
    ? AUTHENTICATOR_PLACES.find((known) => known === facts.place)
    : undefined
  return { reply: reply as unknown as ApproverReply, ...(place ? { facts: { place } } : {}) }
}
