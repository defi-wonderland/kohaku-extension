/**
 * The send port: one transaction sent from a key the keystore holds, addressed
 * by the keystore's own handle of address and key type. It signs nothing and
 * broadcasts nothing itself: the wallet's own request queue and action window
 * do both, as for a transaction the wallet builds itself.
 *
 * 1. It opens an activity session over the key's account on the chain, with
 *    `MAIN_CONTROLLER_ACTIVITY_SET_ACC_OPS_FILTERS` under a session id of its
 *    own, as the transfer screen does to follow the operation it sent.
 * 2. It dispatches `REQUESTS_CONTROLLER_ADD_USER_REQUEST` with a transaction
 *    request under an id of its own: the key's address as the account, the
 *    chain, the one call and `allowAccountSwitch`.
 * 3. The queue opens the action window on that request. The window's own
 *    sign screen estimates the transaction, shows it to the holder, and signs
 *    and broadcasts it only when the holder confirms. The port dispatches
 *    nothing to that screen.
 * 4. The wallet adds the operation it broadcast to the activity, its calls
 *    naming the request they came from. The port answers the transaction hash
 *    of its own call, as soon as the activity carries one: at once for a
 *    transaction the key sent itself, later where the wallet learns it after
 *    the broadcast.
 *
 * The queue sends for an account the wallet lists, from that account's keys.
 * A key that is itself a basic account (an EOA the wallet lists, its own only
 * associated key) therefore sends its own transaction and pays its gas. Any
 * other key, such as the smart account's controlling key at the slot's index
 * plus 100000, cannot send through it, and the port refuses such a key with a
 * `not-wired` refusal.
 */
import { v4 as uuidv4 } from 'uuid'
import { isHash } from 'viem'

import { Session } from '@ambire-common/classes/session'
import type { SignUserRequest } from '@ambire-common/interfaces/userRequest'
import { AccountOpStatus } from '@ambire-common/libs/accountOp/types'
import type { Address, Hex } from '@web/modules/social-recovery/sdk-interfaces'

import { sameAddress } from './addresses'
import { ABSENCE_GRACE_MS, listedBasicAccountOf } from './signer'
import type {
  GasEstimateCall,
  KeyHandle,
  SendPort,
  SendPortOptions,
  SendRefusal,
  SendRefusalReason,
  SendRequestPort,
  SubmittedOperation
} from './types'

/** The background action a `not-wired` key needs. It does not exist yet. */
export const MISSING_SEND_ACTION = 'KEYSTORE_CONTROLLER_SEND_WITH_KEY' as const

/**
 * Why the send port returned no transaction hash:
 *
 * - `not-wired`: the key is not itself a basic account the wallet lists;
 * - `refused`: the request left the queue with no operation broadcast, since
 *   the holder rejected it or declined the account switch it waited for;
 * - `window-closed`: the holder closed the action window with the request
 *   still queued; the port withdraws it, so the wallet cannot send it later;
 * - `not-broadcast`: the operation the wallet submitted was rejected before it
 *   reached the chain, and names no transaction;
 * - `timeout`: no answer came in time; the port withdraws the request.
 */
export const SEND_REFUSAL_REASONS = [
  'not-wired',
  'refused',
  'window-closed',
  'not-broadcast',
  'timeout'
] as const

const REFUSAL_MESSAGES: { readonly [R in SendRefusalReason]: string } = {
  'not-wired': `the request queue sends only from a key that is itself a basic account the wallet lists. Missing background action: ${MISSING_SEND_ACTION} { requestId, keyAddr, keyType, chainId, transaction }.`,
  refused: 'the request left the queue with no transaction broadcast.',
  'window-closed': 'the action window closed with the request still queued; it was withdrawn.',
  'not-broadcast': 'the operation the wallet submitted was rejected before it reached the chain.',
  timeout: 'no answer came in time; the request was withdrawn.'
}

export const sendRefusal = (reason: SendRefusalReason, key: KeyHandle): SendRefusal => {
  const error = new Error(
    `No transaction was sent from key ${key.addr} (${key.type}): ${REFUSAL_MESSAGES[reason]}`
  ) as SendRefusal
  error.name = 'SendRefusal'
  error.reason = reason
  error.key = { ...key }
  if (reason === 'not-wired') error.missingAction = MISSING_SEND_ACTION
  return error
}

/**
 * How long the port waits for the holder to confirm and the wallet to
 * broadcast, a hardware key's included. Once the activity lists the operation
 * the wallet broadcast, the port waits for its transaction hash with no limit:
 * the wallet sent it.
 */
export const DEFAULT_SEND_TIMEOUT_MS = 10 * 60 * 1000

/** The activity page the port reads: the operation it sent is the newest of the account. */
const ACTIVITY_PAGE = { fromPage: 0, itemsPerPage: 10 }

/**
 * A request id no other page makes: the port's prefix and a random UUID. The
 * activity session takes the same id, so it is the port's own too.
 */
const nextRequestId = (): string => `social-recovery-sender:${uuidv4()}`

/**
 * The transaction request the port adds to the queue for one key and one
 * transaction. `meta.keyType` carries the handle's key type beside the account
 * address, so the key type travels with the request. Today the action window
 * does not read it: it picks the key among the account's keys, which for a
 * listed basic account all sign as the same address. `key.addr` must be the
 * listed account's own address as the wallet holds it, since the queue, the
 * sign screen and the activity compare addresses with exact case.
 */
export const sendRequestOf = (
  id: string,
  key: KeyHandle,
  chainId: bigint,
  transaction: GasEstimateCall,
  windowId: number | undefined
): SignUserRequest => ({
  id,
  session: new Session({ windowId }),
  meta: { isSignAction: true, accountAddr: key.addr, keyType: key.type, chainId },
  action: {
    kind: 'calls',
    calls: [{ to: transaction.to, value: transaction.value ?? 0n, data: transaction.data }]
  }
})

/** The transaction hash of the request's own call in an operation: the call's, else the operation's. */
const hashOf = (operation: SubmittedOperation, id: string): Hex | undefined => {
  const call = operation.calls?.find((candidate) => candidate.fromUserRequestId === id)
  return [call?.txnId, operation.txnId].find(
    (candidate): candidate is Hex => typeof candidate === 'string' && isHash(candidate)
  )
}

/** Builds the send port over the request queue and the activity. */
export const createSendPort = (port: SendRequestPort, options: SendPortOptions): SendPort => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_SEND_TIMEOUT_MS
  const chainId = BigInt(options.chainId)

  return Object.freeze({
    send(key: KeyHandle, transaction: GasEstimateCall): Promise<Hex> {
      if (!sameAddress(transaction.from, key.addr)) {
        return Promise.reject(
          new TypeError(
            `The transaction comes from ${transaction.from}, not from the sending key ${key.addr}.`
          )
        )
      }
      const listed = listedBasicAccountOf(port.accounts(), key)
      if (!listed) {
        return Promise.reject(sendRefusal('not-wired', key))
      }
      // The queue, the sign screen and the activity compare addresses with
      // exact case, so the request carries the listed account's own address.
      const account = listed.addr as Address
      const id = nextRequestId()
      return new Promise<Hex>((resolve, reject) => {
        let done = false
        let broadcast = false
        let queued = false
        let windowSeen = false
        let unsubscribe: () => void = () => {}
        let timer: ReturnType<typeof setTimeout> | undefined
        let absence: ReturnType<typeof setTimeout> | undefined
        let closed: ReturnType<typeof setTimeout> | undefined

        const clearWaits = () => {
          if (timer !== undefined) clearTimeout(timer)
          if (absence !== undefined) clearTimeout(absence)
          if (closed !== undefined) clearTimeout(closed)
          timer = undefined
          absence = undefined
          closed = undefined
        }
        const end = (withdraw: boolean): boolean => {
          if (done) return false
          done = true
          clearWaits()
          unsubscribe()
          port.dispatch({
            type: 'MAIN_CONTROLLER_ACTIVITY_RESET_ACC_OPS_FILTERS',
            params: { sessionId: id }
          })
          if (withdraw) {
            port.dispatch({ type: 'REQUESTS_CONTROLLER_REMOVE_USER_REQUEST', params: { id } })
          }
          return true
        }
        const succeed = (hash: Hex) => {
          if (end(false)) resolve(hash)
        }
        const fail = (reason: SendRefusalReason, withdraw = false) => {
          if (end(withdraw)) reject(sendRefusal(reason, key))
        }

        timer = setTimeout(() => fail('timeout', true), timeoutMs)

        unsubscribe = port.subscribe((update) => {
          if (done) return
          if (update.controller === 'activity') {
            const operation = update.state.accountsOps?.[id]?.result?.items?.find((item) =>
              item.calls?.some((call) => call.fromUserRequestId === id)
            )
            if (!operation) return
            // The wallet broadcast the request: its absence from the queue and
            // the window closing no longer mean that nothing was sent.
            broadcast = true
            clearWaits()
            const hash = hashOf(operation, id)
            if (hash) succeed(hash)
            else if (operation.status === AccountOpStatus.Rejected) fail('not-broadcast')
            return
          }
          if (broadcast) return
          const { userRequests = [], userRequestsWaitingAccountSwitch = [] } = update.state
          const present = [...userRequests, ...userRequestsWaitingAccountSwitch].some(
            (request) => request.id === id
          )
          if (!present) {
            // The queue moves a request between its two lists after an account
            // switch and may push a state between the two moves, and the
            // activity that lists a broadcast operation may reach this page
            // after the queue dropped its request, so an absence counts only
            // once it lasts.
            if (queued && absence === undefined) {
              absence = setTimeout(() => fail('refused'), ABSENCE_GRACE_MS)
            }
            return
          }
          queued = true
          if (absence !== undefined) clearTimeout(absence)
          absence = undefined
          if (update.state.actions?.actionWindow?.windowProps) {
            windowSeen = true
            if (closed !== undefined) clearTimeout(closed)
            closed = undefined
          } else if (windowSeen && closed === undefined) {
            // The queue keeps a transaction request when its window closes, so
            // the holder could still send it from the dashboard later. The port
            // withdraws it instead, once the window stays closed.
            closed = setTimeout(() => fail('window-closed', true), ABSENCE_GRACE_MS)
          }
        })

        port.dispatch({
          type: 'MAIN_CONTROLLER_ACTIVITY_SET_ACC_OPS_FILTERS',
          params: { sessionId: id, filters: { account, chainId }, pagination: { ...ACTIVITY_PAGE } }
        })
        port.dispatch({
          type: 'REQUESTS_CONTROLLER_ADD_USER_REQUEST',
          params: {
            userRequest: sendRequestOf(
              id,
              { addr: account, type: key.type },
              chainId,
              transaction,
              port.windowId()
            ),
            allowAccountSwitch: true
          }
        })
      })
    }
  })
}
