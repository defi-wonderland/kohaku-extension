import type { RpcProviderKind } from '@ambire-common/interfaces/network'
import type {
  Address,
  Clause,
  Credential,
  ModuleInfo,
  ReadResult,
  SetupDraft,
  TrustedParties
} from '@web/modules/social-recovery/sdk-interfaces'
import type { AddressBook, RecoveryKitClient } from '@web/modules/social-recovery/shared/client'
import type {
  ChainId,
  Enrollment,
  SlotKind,
  WalletRecords
} from '@web/modules/social-recovery/shared/records'

/** The kind of method a row of the path holds: one of the address book's method slugs. */
export type MethodKind = SlotKind

/** The picker's fixed lengths with their chip words, so the review names a length as the picker did. */
export const REVIEW_WAIT_CHIPS = [
  { id: 'hours24', hours: 24 },
  { id: 'hours48', hours: 48 },
  { id: 'hours72', hours: 72 },
  { id: 'days7', hours: 7 * 24 }
] as const
export type ReviewWaitChipId = typeof REVIEW_WAIT_CHIPS[number]['id']

/** The provider kinds that read through a light client with its prover; any other is a plain node. */
export const LIGHT_CLIENT_PROVIDERS = ['helios', 'colibri'] as const

/** How the node the wallet reads through is named on the trust list. */
export type NodeKind = 'light-client' | 'plain'

/** The provider kind of the network the wallet reads the recovery chain through. */
export type ProviderKind = RpcProviderKind

/** The things a recovery publishes that are not addresses, as item slugs of the disclosures. */
export type PublicationItem = 'passkey' | 'passkeys' | 'passportIdentifier' | 'aadhaar'

/** One row of the lead's path block, rendered. */
export interface PathRow {
  /** The row's name: a guardian's full address, a passkey's label, or the kind's name. */
  name: string
  /** The guardian noun beside a guardian's address, or a passkey's kind word. */
  aside: string | null
  /** The status chip, or null where the records hold no verdict for an enrolled credential. */
  chip: string | null
  /** The lines under the row, in order. */
  lines: string[]
}

// ---------------------------------------------------------------------------
// The trust list
// ---------------------------------------------------------------------------

/** The two declarations the trust list reads for every method of the path. */
export const TRUST_READ_NAMES = ['trustedParties', 'moduleInfo'] as const
export type TrustReadName = typeof TRUST_READ_NAMES[number]

/** The reads of one method; a member not yet present is a read still running. */
export interface MethodReads {
  trustedParties?: ReadResult<TrustedParties>
  moduleInfo?: ReadResult<ModuleInfo>
}

/** The reads of every method of the path, keyed by the method's lowercased address. */
export type TrustReads = Record<string, MethodReads>

/** One credential of the path that uses a method, as the trust list heads it. */
export interface TrustHeading {
  credential: Credential
  kind: MethodKind | undefined
  /** A guardian's address, decoded from its config. */
  guardian?: Address
  /** A passkey's backup kind, where the records hold one. */
  backup?: Enrollment['backup']
  /** Whether its access test passed. */
  tested: boolean
}

/** What the trust list says about one method contract. */
export type TrustContract =
  | { status: 'pending' }
  | { status: 'unavailable'; unanswered: TrustReadName[] }
  | { status: 'third-party' }
  | {
      status: 'declared'
      /** The method's admin, absent where the declaration names no outside party. */
      admin?: Address
      /** The address one acceptance away from the admin role, where there is one. */
      pendingAdmin?: Address
      /** The method alone satisfies the whole rule, so its admin could recover alone. */
      recoverAlone: boolean
      /** The passport method, whose credential a renewed document ends. */
      passportRenewal: boolean
    }

/** One contract row of the trust list: one per method, however many path rows use it. */
export interface TrustRow {
  method: Address
  kind: MethodKind | undefined
  headings: TrustHeading[]
  /** The count line above several guardian headings. */
  guardians?: { count: number; tested: number }
  contract: TrustContract
}

export interface TrustRowsInput {
  clauses: readonly Clause[]
  enrollments: readonly Enrollment[]
  reads: TrustReads
  /** The method modules the deployment ships; any other is a third-party module. */
  shippedMethods: readonly Address[]
  addressBook: AddressBook
}

// ---------------------------------------------------------------------------
// The screen and the view
// ---------------------------------------------------------------------------

/** The part of the recovery client the review reads. */
export type ReviewKitClient = Pick<RecoveryKitClient, 'chain' | 'descriptor' | 'moduleReads'>

/** The recovery client as the view takes it. */
export type ReviewClient =
  | { status: 'loading' }
  | { status: 'ready'; client: ReviewKitClient }
  | { status: 'update-the-wallet'; retry: () => void }
  | { status: 'failed'; retry: () => void }

/** The setup records the review reads. */
export interface ReviewLoad {
  draft: SetupDraft
  enrollments: Enrollment[]
  passwordSet: boolean
}

export interface ReviewViewProps {
  records: Pick<WalletRecords, 'setup'>
  chainId: ChainId
  account: Address
  client: ReviewClient
  /** The provider kind of the recovery chain's network; absent reads as a plain node. */
  providerKind?: ProviderKind
  /** The label the wallet holds for the account, where it holds one. */
  accountLabel?: string
  navigate: (to: string) => void
}

export interface PathBlockProps {
  clauses: readonly Clause[]
  enrollments: readonly Enrollment[]
  addressBook: AddressBook
}

export interface TrustListProps {
  rows: readonly TrustRow[]
  client: ReviewKitClient
  providerKind?: ProviderKind
  onRetry: (method: Address) => void
}

export interface TrustReadsState {
  reads: TrustReads
  /** Runs again the reads of one method that did not answer. */
  retry: (method: Address) => void
}
