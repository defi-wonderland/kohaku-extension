/**
 * The signer facade (ux-interfaces.md D-370): typed data or raw bytes signed
 * for a key the keystore holds, addressed by the keystore's own handle of
 * address and key type. It exposes those two members and nothing else, so no
 * key, seed or export reaches a screen through it, whatever the keystore's
 * own settings surfaces do.
 *
 * The keystore and its signers live in the background and the UI reaches them
 * only by dispatch. ux.md D-316 says every signing request lands in the action
 * window through the request queue, so the facade routes each signature
 * through that queue as a request of its own:
 *
 * 1. It dispatches `REQUESTS_CONTROLLER_ADD_USER_REQUEST` with a sign request
 *    under an id of its own: the key's address as the account, the recovery
 *    chain, the typed message or the plain message, an internal session and
 *    `allowAccountSwitch`.
 * 2. The queue opens the action window on that request. The window's own
 *    sign-message screen initialises the sign-message controller with the
 *    request's id, shows the holder the message, and signs only when the
 *    holder confirms. The facade dispatches nothing to that controller.
 * 3. The facade takes the signature from the `signMessage` controller state
 *    whose `signedMessage` carries its request's id. A request that leaves the
 *    queue with no such signature (the holder rejected it or closed the
 *    window) is refused. A request with no answer in time is withdrawn.
 *
 * The queue signs for an account the wallet lists with that account's keys.
 * A key that is itself a basic account (an EOA the wallet lists, its own only
 * associated key) therefore gets its own plain signature: EIP-712 over typed
 * data, EIP-191 over bytes. Any other key, such as the smart account's
 * controlling key at the slot's index plus 100000 (ux.md D-316), cannot sign
 * through it, and the facade refuses such a key with `SignerNotWired`, naming
 * the background action that is missing. Raw bytes always carry the EIP-191
 * prefix: the queue has no request that signs a bare digest.
 */
import { isHexString } from 'ethers'

import { Session } from '@ambire-common/classes/session'
import type { SignedMessage } from '@ambire-common/controllers/activity/types'
import type { Account } from '@ambire-common/interfaces/account'
import type { Key } from '@ambire-common/interfaces/keystore'
import type {
  PlainTextMessage,
  SignUserRequest,
  TypedMessage
} from '@ambire-common/interfaces/userRequest'
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
  /** An EIP-712 signature over the typed data by the key, after the holder confirms it. */
  signTypedData(key: KeyHandle, typedData: TypedDataToSign): Promise<Hex>
  /** An EIP-191 personal-message signature over the bytes by the key, after the holder confirms it. */
  signBytes(key: KeyHandle, bytes: Hex): Promise<Hex>
}

export const SIGNER_MEMBERS = ['signTypedData', 'signBytes'] as const
export type SignerMember = typeof SIGNER_MEMBERS[number]

/** The two request-queue actions the facade dispatches: add its request, and withdraw it on a timeout. */
export type SignRequestAction = Extract<
  Action,
  { type: 'REQUESTS_CONTROLLER_ADD_USER_REQUEST' | 'REQUESTS_CONTROLLER_REMOVE_USER_REQUEST' }
>

/** The part of the `signMessage` controller state the facade reads. */
export interface SignMessageState {
  signedMessage?: Pick<SignedMessage, 'fromActionId' | 'signature'> | null
}

/** The part of the `requests` controller state the facade reads. */
export interface RequestsState {
  userRequests?: { id: string | number }[]
  userRequestsWaitingAccountSwitch?: { id: string | number }[]
}

/** One controller state the background pushed, by controller. */
export type SignRequestUpdate =
  | { controller: 'signMessage'; state: SignMessageState }
  | { controller: 'requests'; state: RequestsState }

/** The account records the facade checks a key against. */
export type ListedAccount = Pick<Account, 'addr' | 'associatedKeys' | 'creation'>

/**
 * How the facade reaches the background: the dispatch of `useBackgroundService`,
 * the `signMessage` and `requests` controller states the background pushes,
 * the accounts the wallet lists and the window the request opens beside.
 * `signRequestPort` (signer-port.ts) wires the UI's own.
 */
export interface SignRequestPort {
  dispatch(action: SignRequestAction): void
  /** Calls the listener with each pushed `signMessage` and `requests` state; returns the unsubscribe. */
  subscribe(listener: (update: SignRequestUpdate) => void): () => void
  accounts(): readonly ListedAccount[]
  windowId(): number | undefined
}

/**
 * The background action the facade would need to sign for any key the
 * keystore holds, and for a bare digest. It does not exist: a new background
 * action touches a shared file and is the owner's call. Its shape: params
 * `{ requestId, keyAddr, keyType, content }`, where `content` is a
 * `PlainTextMessage` or a `TypedMessage`; the handler takes
 * `KeystoreController.getSigner(keyAddr, keyType)`, runs `signer.init` with
 * the external signer controller of that type, answers
 * `signMessage(content.message)` or `signTypedData(content)` with no account
 * lookup and no Ambire envelope, and sends the signature or the error back to
 * the UI under the request id (the pattern `PROVIDER_RPC_REQUEST` uses). Under
 * ux.md D-316 it too would land in the action window for the holder's
 * confirmation.
 */
export const MISSING_BACKGROUND_ACTION = 'KEYSTORE_CONTROLLER_SIGN_WITH_KEY' as const

/** The facade was asked for a key the request queue cannot sign for. */
export interface SignerNotWired extends Error {
  name: 'SignerNotWired'
  member: SignerMember
  key: KeyHandle
  missingAction: typeof MISSING_BACKGROUND_ACTION
}

export const signerNotWired = (member: SignerMember, key: KeyHandle): SignerNotWired => {
  const error = new Error(
    `${member} is not wired for key ${key.addr} (${key.type}): the request queue signs only for a key that is itself a basic account the wallet lists. Missing background action: ${MISSING_BACKGROUND_ACTION} { requestId, keyAddr, keyType, content }, signing with KeystoreController.getSigner(keyAddr, keyType) and answering the UI.`
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
 * Why a queued request returned no signature: it left the queue with none
 * (the holder rejected it or closed the action window), no answer came in
 * time (the facade then withdraws it), or the answer was not a hex signature.
 */
export const SIGN_FLOW_FAILURE_REASONS = ['refused', 'timeout', 'malformed-signature'] as const
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

/** How long the facade waits for the holder's confirmation, a hardware key's included. */
export const DEFAULT_SIGN_TIMEOUT_MS = 10 * 60 * 1000

/** How long the request must stay out of the queue, with no signature, before it counts as refused. */
export const ABSENCE_GRACE_MS = 3000

export interface SignerFacadeOptions {
  /** The chain the request signs on, the recovery chain's id. */
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

/** The typed message the queue takes, with `EIP712Domain` derived from the domain where absent. */
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

/** Whether a key is itself a basic account the wallet lists, the one case the queue signs as the key. */
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

/** A numeric request id, as the wallet's other own requests use, unique within the page. */
const nextRequestId = (): number => {
  requestCount = (requestCount + 1) % 1000
  return Date.now() * 1000 + requestCount
}

const sameId = (a: string | number | undefined, b: string | number): boolean =>
  a !== undefined && String(a) === String(b)

/** The sign request the facade adds to the queue for one key and one content. */
export const signRequestOf = (
  id: number,
  key: KeyHandle,
  chainId: bigint,
  content: PlainTextMessage | TypedMessage,
  windowId: number | undefined
): SignUserRequest => ({
  id,
  session: new Session({ windowId }),
  meta: { isSignAction: true, accountAddr: key.addr, chainId },
  action: content
})

/** Builds the signer facade over the request queue. */
export const createSignerFacade = (
  port: SignRequestPort,
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
    const id = nextRequestId()
    return new Promise<Hex>((resolve, reject) => {
      let done = false
      let queued = false
      let unsubscribe: () => void = () => {}
      let timer: ReturnType<typeof setTimeout> | undefined
      let absence: ReturnType<typeof setTimeout> | undefined

      const finish = (outcome: { signature: Hex } | { error: Error }, withdraw = false) => {
        if (done) return
        done = true
        if (timer !== undefined) clearTimeout(timer)
        if (absence !== undefined) clearTimeout(absence)
        unsubscribe()
        if (withdraw)
          port.dispatch({ type: 'REQUESTS_CONTROLLER_REMOVE_USER_REQUEST', params: { id } })
        if ('signature' in outcome) resolve(outcome.signature)
        else reject(outcome.error)
      }

      timer = setTimeout(
        () => finish({ error: signFlowFailure(member, 'timeout') }, true),
        timeoutMs
      )

      unsubscribe = port.subscribe((update) => {
        if (done) return
        if (update.controller === 'signMessage') {
          const signed = update.state.signedMessage
          if (!signed || !sameId(signed.fromActionId, id)) return
          if (typeof signed.signature === 'string' && isHexString(signed.signature)) {
            finish({ signature: signed.signature as Hex })
          } else {
            finish({ error: signFlowFailure(member, 'malformed-signature') })
          }
          return
        }
        const present = [
          ...(update.state.userRequests ?? []),
          ...(update.state.userRequestsWaitingAccountSwitch ?? [])
        ].some((request) => sameId(request.id, id))
        if (present) {
          queued = true
          if (absence !== undefined) clearTimeout(absence)
          absence = undefined
        } else if (queued && absence === undefined) {
          // The queue moves a request between its two lists after an account
          // switch and may push a state between the two moves, so an absence
          // counts only once it lasts.
          absence = setTimeout(
            () => finish({ error: signFlowFailure(member, 'refused') }),
            ABSENCE_GRACE_MS
          )
        }
      })

      port.dispatch({
        type: 'REQUESTS_CONTROLLER_ADD_USER_REQUEST',
        params: {
          userRequest: signRequestOf(id, key, chainId, content, port.windowId()),
          allowAccountSwitch: true
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
