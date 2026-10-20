import type {
  Address,
  Attempt,
  BlockHeader,
  DeploymentDescriptor,
  Handover,
  Hex,
  Parties,
  PaymentOrder,
  ProviderRevert
} from '@kohaku-eth/social-recovery'

/** What one fake node's world starts from; every member but the two first has a default. */
export interface ScriptedNodeSeed {
  descriptor: DeploymentDescriptor
  account: Address
  /** The chain's clock in seconds; the latest block follows it. The wall clock by default. */
  clock?: () => number
  /** The first block's number, 1000 by default. */
  firstBlock?: number
  /** Whether the account holds the proxy over the served implementation; true by default. */
  hasCode?: boolean
  /** The action's `supportsAccount` answer for an account with code; true by default. */
  supportsAccount?: boolean
  /** The keys that hold the key privilege on the account; none by default. */
  authorities?: readonly Address[]
}

/** The manager's record of the one account and action the node serves. */
export interface ScriptedManagerState {
  setupCommitment: Hex
  setupNonce: bigint
  nextAttemptId: bigint
  setupCommittedAtBlock: number
  attempt: Attempt
  /** The setup body the standing commitment closes over, `0x` where none stands. */
  setupBody: Hex
}

/** A method module's declaration as the node answers it. */
export interface ScriptedMethod {
  name: string
  version: string
  paused: boolean
  parties: Parties
}

/** What a seeded attempt carries; each member has a default. */
export interface ScriptedAttemptOptions {
  handover?: Handover
  order?: PaymentOrder
  /** Seconds after the opening block until the attempt may be consumed; one day by default. */
  wait?: number
  ignoresPause?: boolean
  usedMethods?: readonly Address[]
  usedPlaces?: readonly bigint[]
}

/** What an opening carries that the manager records. */
export interface ScriptedOpening {
  attemptId: bigint
  setupNonce: bigint
  setupBody: Hex
  payload: Hex
  order: PaymentOrder
}

/** How a failed read fails: a transport failure, or a revert with these bytes. */
export type ScriptedFailure = { kind: 'unavailable' } | ({ kind: 'revert' } & ProviderRevert)

/** One block the node mined, with the transactions it holds. */
export interface ScriptedBlock {
  header: BlockHeader
  transactions: Hex[]
}
