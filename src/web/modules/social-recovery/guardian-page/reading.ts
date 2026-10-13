/**
 * What the page reads of a request, as pure functions over the request, the
 * chain reads and the page's clock: whether its domain is this build's, the
 * state that takes the place of the sign action, and whether the sign action
 * is enabled.
 */
import { isAddressEqual, keccak256 } from 'viem'

import type { ApproverRequest, Attempt } from '@web/modules/social-recovery/sdk-interfaces'
import type { PollFacts } from '@web/modules/social-recovery/recovery/checklist'

import type {
  ApprovalClient,
  ApprovalReading,
  ApprovalReads,
  DomainOfBuild,
  SignGates
} from './types'

/**
 * Whether the request is aimed at the deployment this build reads: the same
 * chain, the same manager and the same digest version. The build's client
 * refuses a manager whose published domain carries another digest version,
 * so a request that agrees here also agrees with the manager's own domain.
 */
export const domainAgrees = (request: ApproverRequest, build: DomainOfBuild): boolean =>
  request.chainId === String(build.chainId) &&
  isAddressEqual(request.manager, build.manager) &&
  request.digestVersion === build.digestVersion

/** Whether the clock, in ms, is past the request's deadline. */
const requestExpired = (request: ApproverRequest, clock: number): boolean =>
  Math.floor(clock / 1000) > Number(request.validUntil)

/**
 * Whether the account's attempt is this request's own submission, still
 * waiting: it carries the request's attempt id, the setup nonce the request
 * was built under and the hash of the request's handover. The id alone names
 * whoever opened next, so another holder's attempt can carry it.
 */
const submittedAndWaiting = (request: ApproverRequest, attempt: Attempt): boolean =>
  attempt.state === 'Waiting' &&
  attempt.attemptId === BigInt(request.attemptId) &&
  attempt.setupNonce === BigInt(request.setupNonce) &&
  request.payload !== undefined &&
  keccak256(request.payload) === attempt.payloadHash

/**
 * Whether an attempt other than this request's own was opened: another
 * attempt waits, or the attempt counter moved past the request's id.
 */
const anotherAttemptOpened = (request: ApproverRequest, facts: PollFacts): boolean =>
  facts.attempt.state === 'Waiting' || facts.nextAttemptId > BigInt(request.attemptId)

/**
 * The reading of an answered round. A request the recoverer submitted reads
 * as waiting until its end, never as dead. Otherwise the deaths in this
 * order: expired, another attempt opened, the setup changed. A request with
 * none of them is live, the account authorizing the action or not.
 */
export const readingOfFacts = (
  request: ApproverRequest,
  facts: PollFacts,
  clock: number
): ApprovalReading => {
  if (submittedAndWaiting(request, facts.attempt)) {
    return {
      kind: 'waiting',
      endsAt: facts.attempt.consumableAfter * 1000,
      authorized: facts.authorized
    }
  }
  if (requestExpired(request, clock)) {
    return { kind: 'dead', death: 'expired' }
  }
  if (anotherAttemptOpened(request, facts)) {
    return { kind: 'dead', death: 'void' }
  }
  if (facts.setupNonce !== BigInt(request.setupNonce)) {
    return { kind: 'dead', death: 'setup-changed' }
  }
  return { kind: 'live', authorized: facts.authorized }
}

/**
 * The reading of the page: another deployment before any read, then the
 * client and the reads, where nothing answered yet reads as reading and a
 * failure as failed, never as a death and never as live.
 */
export const readingOf = (
  request: ApproverRequest,
  build: DomainOfBuild,
  client: ApprovalClient,
  reads: ApprovalReads,
  clock: number
): ApprovalReading => {
  if (!domainAgrees(request, build)) {
    return { kind: 'other-deployment' }
  }
  if (client.status === 'failed') {
    return { kind: 'failed' }
  }
  if (client.status === 'loading' || reads.status === 'pending') {
    return { kind: 'reading' }
  }
  if (reads.status === 'failed') {
    return { kind: 'failed' }
  }
  return readingOfFacts(request, reads.facts, clock)
}

/**
 * Whether the sign action is enabled: the four values and the deadline
 * rendered, the request live with the account authorizing the action, and
 * the acknowledgment ticked.
 */
export const signEnabled = ({ values, deadline, reading, acknowledged }: SignGates): boolean =>
  values.rendered &&
  deadline !== null &&
  !deadline.passed &&
  reading.kind === 'live' &&
  reading.authorized &&
  acknowledged
