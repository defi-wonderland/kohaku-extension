/**
 * The signer facade (ux-interfaces.md D-370): typed data or raw bytes signed
 * for a key the keystore holds, addressed by the keystore's own handle of
 * address and key type. It exposes those two members and nothing else, so no
 * key, seed or export reaches a screen through it, whatever the keystore's
 * own settings surfaces do.
 *
 * The keystore and its signers live in the background (`KeystoreController.
 * getSigner(addr, type)`), reached from the UI only by dispatch. The facade
 * therefore signs through the extension's existing sign-message flow, the
 * `SignMessageController` of ambire-common, and never holds a key in the UI:
 *
 * 1. `MAIN_CONTROLLER_SIGN_MESSAGE_INIT` with a message whose account is the
 *    key's own address, the chain and the content, under a request id of its own;
 * 2. once the controller's state shows that message, `MAIN_CONTROLLER_HANDLE_SIGN_MESSAGE`
 *    with the key's address and type;
 * 3. the signature from the controller's `signedMessage` for that request id,
 *    then `MAIN_CONTROLLER_SIGN_MESSAGE_RESET`.
 *
 * What that flow can and cannot do sets what the facade can do:
 *
 * - It signs for an account the wallet lists, with a key of that account. A
 *   key that is itself a basic account (an EOA the wallet lists, its own only
 *   associated key) gets its own plain signature: EIP-712 over the typed data,
 *   EIP-191 over the bytes. That is what the facade wires.
 * - A key that is not itself a listed basic account (the smart account's
 *   controlling key at the slot's index plus 100000, ux.md D-316, or any key
 *   whose account the wallet does not list) cannot sign through it: the flow
 *   looks the address up among the accounts and wraps a smart account's
 *   signature in Ambire's envelope. The facade refuses such a key with
 *   `SignerNotWired`, naming the background action that is missing.
 * - "Raw bytes" are signed as an EIP-191 personal message. The flow has no
 *   path that signs a bare digest without the prefix.
 */
import { isHexString } from 'ethers'

import type { SignedMessage } from '@ambire-common/controllers/activity/types'
import type { Account } from '@ambire-common/interfaces/account'
import type { Key } from '@ambire-common/interfaces/keystore'
import type { Message, PlainTextMessage, TypedMessage } from '@ambire-common/interfaces/userRequest'
import type { Action } from '@web/extension-services/background/actions'
import type { Address, Hex } from '@web/modules/social-recovery/sdk-interfaces'

import { sameAddress } from './addresses'

/** The keystore's own handle of a key: its address and its type (ux-interfaces.md D-370). */
export interface KeyHandle {
  addr: Address
  type: Key['type']
}

/** EIP-712 typed data. `types.EIP712Domain` is derived from the domain where the caller leaves it out. */
export interface TypedDataToSign {
  domain: TypedMessage['domain']
  types: TypedMessage['types']
  primaryType: string
  message: Record<string, unknown>
}

/** The facade. Its two members are its whole surface. */
export interface SignerFacade {
  /** An EIP-712 signature over the typed data by the key. */
  signTypedData(key: KeyHandle, typedData: TypedDataToSign): Promise<Hex>
  /** An EIP-191 personal-message signature over the bytes by the key. */
  signBytes(key: KeyHandle, bytes: Hex): Promise<Hex>
}

export const SIGNER_MEMBERS = ['signTypedData', 'signBytes'] as const
export type SignerMember = typeof SIGNER_MEMBERS[number]

/** The three actions of the existing sign-message flow the facade dispatches. */
export type SignMessageFlowAction = Extract<
  Action,
  {
    type:
      | 'MAIN_CONTROLLER_SIGN_MESSAGE_INIT'
      | 'MAIN_CONTROLLER_HANDLE_SIGN_MESSAGE'
      | 'MAIN_CONTROLLER_SIGN_MESSAGE_RESET'
  }
>

/** The part of the `SignMessageController` state the background pushes that the facade reads. */
export interface SignMessageFlowState {
  isInitialized?: boolean
  messageToSign?: Message | null
  signedMessage?: SignedMessage | null
  statuses?: { sign?: string }
}

/** The account records the facade checks a key against. */
export type ListedAccount = Pick<Account, 'addr' | 'associatedKeys' | 'creation'>

/**
 * How the facade reaches the background: the dispatch of `useBackgroundService`,
 * the `signMessage` controller state the background pushes, and the accounts
 * the wallet lists. `signMessageFlowPort` (signer-port.ts) wires the UI's own.
 */
export interface SignMessageFlowPort {
  dispatch(action: SignMessageFlowAction): void
  /** Calls the listener with each `signMessage` controller state; returns the unsubscribe. */
  subscribe(listener: (state: SignMessageFlowState) => void): () => void
  accounts(): readonly ListedAccount[]
}

/**
 * The background action the facade would need to sign for any key the
 * keystore holds. It does not exist: a new background action touches a shared
 * file and is the owner's call. Its shape: params `{ requestId, keyAddr,
 * keyType, content }`, where `content` is a `PlainTextMessage` or a
 * `TypedMessage`; the handler takes `KeystoreController.getSigner(keyAddr,
 * keyType)`, runs `signer.init` with the external signer controller of that
 * type, answers `signMessage(content.message)` or `signTypedData(content)`
 * with no account lookup, no Ambire envelope, no activity record and no
 * request resolution, and sends the signature or the error back to the UI
 * under the request id (the pattern `PROVIDER_RPC_REQUEST` uses).
 */
export const MISSING_BACKGROUND_ACTION = 'KEYSTORE_CONTROLLER_SIGN_WITH_KEY' as const

/** The facade was asked for a key the existing flow cannot sign for. */
export interface SignerNotWired extends Error {
  name: 'SignerNotWired'
  member: SignerMember
  key: KeyHandle
  missingAction: typeof MISSING_BACKGROUND_ACTION
}

export const signerNotWired = (member: SignerMember, key: KeyHandle): SignerNotWired => {
  const error = new Error(
    `${member} is not wired for key ${key.addr} (${key.type}): the sign-message flow signs only for a key that is itself a basic account the wallet lists. Missing background action: ${MISSING_BACKGROUND_ACTION} { requestId, keyAddr, keyType, content }, signing with KeystoreController.getSigner(keyAddr, keyType) and answering the UI.`
  ) as SignerNotWired
  error.name = 'SignerNotWired'
  error.member = member
  error.key = { ...key }
  error.missingAction = MISSING_BACKGROUND_ACTION
  return error
}

export const isSignerNotWired = (value: unknown): value is SignerNotWired =>
  value instanceof Error && value.name === 'SignerNotWired'

/**
 * Why a dispatched signing did not return a signature: the flow refused (a
 * rejected device, a failed verification, a locked keystore), another request
 * took the controller over, no answer came in time, or the answer was not a
 * hex signature.
 */
export const SIGN_FLOW_FAILURE_REASONS = [
  'refused',
  'superseded',
  'timeout',
  'malformed-signature'
] as const
export type SignFlowFailureReason = typeof SIGN_FLOW_FAILURE_REASONS[number]

export interface SignFlowFailure extends Error {
  name: 'SignFlowFailure'
  member: SignerMember
  reason: SignFlowFailureReason
}

export const signFlowFailure = (
  member: SignerMember,
  reason: SignFlowFailureReason
): SignFlowFailure => {
  const error = new Error(`${member} did not return a signature: ${reason}.`) as SignFlowFailure
  error.name = 'SignFlowFailure'
  error.member = member
  error.reason = reason
  return error
}

export const isSignFlowFailure = (value: unknown): value is SignFlowFailure =>
  value instanceof Error && value.name === 'SignFlowFailure'

/** How long the facade waits for the flow, a hardware key's confirmation included. */
export const DEFAULT_SIGN_TIMEOUT_MS = 5 * 60 * 1000

export interface SignerFacadeOptions {
  /** The chain the flow signs on, the recovery chain's id. */
  chainId: number | bigint
  timeoutMs?: number
}

const DOMAIN_MEMBERS = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
  { name: 'salt', type: 'bytes32' }
] as const

/** The typed message the flow takes, with `EIP712Domain` derived from the domain where absent. */
export const typedMessageOf = (typedData: TypedDataToSign): TypedMessage => {
  const domain = typedData.domain as Record<string, unknown>
  const types = typedData.types.EIP712Domain
    ? { ...typedData.types }
    : {
        EIP712Domain: DOMAIN_MEMBERS.filter(
          (member) => domain[member.name] !== undefined && domain[member.name] !== null
        ).map((member) => ({ ...member })),
        ...typedData.types
      }
  return {
    kind: 'typedMessage',
    domain: typedData.domain,
    types,
    message: typedData.message,
    primaryType: typedData.primaryType
  }
}

/** Whether a key is itself a basic account the wallet lists, the one case the flow signs as the key. */
export const isListedBasicAccountKey = (
  accounts: readonly ListedAccount[],
  key: KeyHandle
): boolean =>
  accounts.some(
    (account) =>
      sameAddress(account.addr, key.addr) &&
      !account.creation &&
      account.associatedKeys.some((associated) => sameAddress(associated, key.addr))
  )

let requestCount = 0

const nextRequestId = (member: SignerMember): string => {
  requestCount += 1
  return `social-recovery-signer:${member}:${Date.now()}:${requestCount}`
}

/** Builds the signer facade over the sign-message flow. */
export const createSignerFacade = (
  port: SignMessageFlowPort,
  options: SignerFacadeOptions
): SignerFacade => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_SIGN_TIMEOUT_MS
  const chainId = BigInt(options.chainId)

  const run = (
    member: SignerMember,
    key: KeyHandle,
    content: PlainTextMessage | TypedMessage
  ): Promise<Hex> => {
    if (!isListedBasicAccountKey(port.accounts(), key)) {
      return Promise.reject(signerNotWired(member, key))
    }
    const requestId = nextRequestId(member)
    return new Promise<Hex>((resolve, reject) => {
      let phase: 'init' | 'sign' | 'done' = 'init'
      let ownsController = false
      let unsubscribe: () => void = () => {}
      let timer: ReturnType<typeof setTimeout> | undefined

      const finish = (outcome: { signature: Hex } | { error: Error }) => {
        if (phase === 'done') return
        phase = 'done'
        if (timer !== undefined) clearTimeout(timer)
        unsubscribe()
        if (ownsController) port.dispatch({ type: 'MAIN_CONTROLLER_SIGN_MESSAGE_RESET' })
        if ('signature' in outcome) resolve(outcome.signature)
        else reject(outcome.error)
      }

      timer = setTimeout(() => finish({ error: signFlowFailure(member, 'timeout') }), timeoutMs)

      unsubscribe = port.subscribe((state) => {
        if (phase === 'done') return
        ownsController = state.messageToSign?.fromActionId === requestId
        if (phase === 'init') {
          if (!ownsController || !state.isInitialized) return
          phase = 'sign'
          port.dispatch({
            type: 'MAIN_CONTROLLER_HANDLE_SIGN_MESSAGE',
            params: { keyAddr: key.addr, keyType: key.type }
          })
          return
        }
        if (state.signedMessage?.fromActionId === requestId) {
          const { signature } = state.signedMessage
          if (typeof signature === 'string' && isHexString(signature)) {
            finish({ signature: signature as Hex })
          } else {
            finish({ error: signFlowFailure(member, 'malformed-signature') })
          }
          return
        }
        if (!ownsController) {
          finish({ error: signFlowFailure(member, 'superseded') })
          return
        }
        if (state.statuses?.sign === 'ERROR') finish({ error: signFlowFailure(member, 'refused') })
      })

      port.dispatch({
        type: 'MAIN_CONTROLLER_SIGN_MESSAGE_INIT',
        params: {
          dapp: { name: '', icon: '' },
          messageToSign: {
            fromActionId: requestId,
            accountAddr: key.addr,
            chainId,
            content,
            signature: null
          }
        }
      })
    })
  }

  return Object.freeze({
    signTypedData(key: KeyHandle, typedData: TypedDataToSign): Promise<Hex> {
      return run('signTypedData', key, typedMessageOf(typedData))
    },
    signBytes(key: KeyHandle, bytes: Hex): Promise<Hex> {
      if (!isHexString(bytes)) {
        return Promise.reject(new Error('signBytes takes 0x-prefixed hex bytes.'))
      }
      return run('signBytes', key, { kind: 'message', message: bytes })
    }
  })
}
