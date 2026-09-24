/**
 * The cut-q-22 seam: the three reads the ux chapter asks the sdk chapter for and
 * `sdk.md` D-201 does not name (docs/social-recovery/tasks/README.md, open
 * question 4). They are not SDK members, so this interface is the extension's
 * own, scripted here so every screen that needs them builds against one shape.
 * The client layer (PT-038) wraps it; no screen imports it.
 *
 * - `verifyReply`: the verify per pasted reply (ux-interfaces.md D-373 "Verify
 *   approvals", D-374; residue FR23-SDK-VERIFY): the claim run through the
 *   credential's module, the static call the manager runs at submission.
 * - `removedKey`: the read naming the key a recovery would remove
 *   (ux-interfaces.md D-371, D-373; ux.md D-319), with the reason it cannot
 *   name one, since D-319 blocks the save on that reason.
 * - `fitCheck`: the fit check against the code the account will carry
 *   (ux-interfaces.md D-371 "residue FR13-ARMING-BATCH"; ux.md D-319), so a
 *   fresh account with no code yet is judged by the implementation it deploys.
 *
 * Every read throws when it could not be made, and never answers empty.
 */
import type {
  Address,
  ApproverReply,
  ApproverRequest,
  ClientConfiguration,
  Verdict
} from '@web/modules/social-recovery/sdk-interfaces'

import type { ScriptedChain } from './chain'
import { digestOfRequest, doubleProof, sameAddress } from './encoding'
import { replyReadable, requestReadable } from './orchestrator'

/** Why the removed key cannot be named (the causes D-202's inference refuses with). */
export const REMOVED_KEY_UNAVAILABLE_CAUSES = [
  'no-creation-record',
  'no-key-entry',
  'several-key-entries'
] as const
export type RemovedKeyUnavailableCause = typeof REMOVED_KEY_UNAVAILABLE_CAUSES[number]

export type RemovedKeyReading =
  | { kind: 'named'; key: Address }
  | { kind: 'unavailable'; cause: RemovedKeyUnavailableCause }

/**
 * What the fit check read: against the code the account holds, against the
 * implementation it will deploy, or neither (no code and no implementation named).
 */
export type FitCheckReading =
  | { basis: 'deployed-code'; fits: boolean }
  | { basis: 'code-to-be'; implementation: Address; fits: boolean }
  | { basis: 'no-code'; fits: false }

/**
 * cut-q-22: the extension-owned seam over the three reads no SDK member makes
 * today. Named for the doubles lane; the real implementation behind the client
 * layer answers the same shape until the sdk chapter adopts or renames them.
 */
export interface IWalletReadsDouble {
  /** The module's own verdict over one pasted reply against the request it answers. */
  verifyReply(request: ApproverRequest, reply: ApproverReply): Promise<Verdict>
  /** The key a recovery of this account would remove, or why it cannot be named. */
  removedKey(): Promise<RemovedKeyReading>
  /** Whether the action fits the account, judged against the code it will carry. */
  fitCheck(accountImplementation?: Address): Promise<FitCheckReading>
}

export class WalletReadsDouble implements IWalletReadsDouble {
  constructor(
    private readonly chain: ScriptedChain,
    private readonly config: Pick<ClientConfiguration, 'creation' | 'accountImplementation'> = {}
  ) {}

  /**
   * A malformed paste never throws: a reply or request that fails the record
   * shape checks `addApproverReply` and the orchestrator use (`replyReadable`,
   * `requestReadable`: every field present with its type, the digest and the
   * proof among them), or whose values make no digest, answers `rejected`. Only
   * a read scripted to fail throws.
   */
  async verifyReply(request: ApproverRequest, reply: ApproverReply): Promise<Verdict> {
    this.chain.guard('walletReads.verifyReply')
    if (this.chain.verdict) return this.chain.verdict
    if (!replyReadable(reply) || !requestReadable(request)) return 'rejected'
    if (
      reply.place !== request.place ||
      !sameAddress(reply.method, request.method) ||
      reply.config.toLowerCase() !== request.config.toLowerCase()
    ) {
      return 'rejected'
    }
    try {
      const expected = doubleProof(request.config, digestOfRequest(request))
      return reply.proof.toLowerCase() === expected.toLowerCase() ? 'satisfied' : 'rejected'
    } catch {
      return 'rejected'
    }
  }

  async removedKey(): Promise<RemovedKeyReading> {
    this.chain.guard('walletReads.removedKey')
    return this.chain.removedKeyReading(!!this.config.creation)
  }

  async fitCheck(accountImplementation?: Address): Promise<FitCheckReading> {
    this.chain.guard('walletReads.fitCheck')
    if (this.chain.hasCode) return { basis: 'deployed-code', fits: this.chain.supportsAccount }
    const implementation = accountImplementation ?? this.config.accountImplementation
    if (!implementation) return { basis: 'no-code', fits: false }
    return {
      basis: 'code-to-be',
      implementation,
      fits: sameAddress(implementation, this.chain.descriptor.servedImplementation)
    }
  }
}
