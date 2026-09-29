/**
 * The access test's challenge for a credential before any setup exists: an
 * approval request for place zero of attempt zero under setup number zero,
 * with no handover and no payment, whose digest the credential signs. The
 * request is valid for the recovery request window and carries a fresh salt,
 * so no two tests sign the same challenge.
 */
import { bytesToHex, zeroAddress, zeroHash } from 'viem'

import type { ApproverRequest } from '@web/modules/social-recovery/sdk-interfaces'
import { REQUEST_WINDOW_SECONDS } from '@web/modules/social-recovery/shared/client'

import type { TestRequestInput } from './types'

export const testRequestOf = ({
  descriptor,
  chainId,
  account,
  method,
  config,
  now,
  randomBytes
}: TestRequestInput): ApproverRequest => ({
  kind: 'recovery-proof-request',
  version: 1,
  purpose: 'approval',
  chainId: BigInt(chainId).toString(),
  manager: descriptor.manager,
  digestVersion: descriptor.digestVersion,
  account,
  action: descriptor.action,
  attemptId: '0',
  setupNonce: '0',
  setupBodyHash: zeroHash,
  payload: '0x',
  order: { token: zeroAddress, amount: '0', payee: zeroAddress },
  validUntil: String(Math.floor(now / 1000) + REQUEST_WINDOW_SECONDS),
  place: 0,
  method,
  config,
  salt: bytesToHex(randomBytes(32))
})
