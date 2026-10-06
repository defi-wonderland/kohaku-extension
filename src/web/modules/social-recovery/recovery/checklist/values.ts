/**
 * The four values a guardian row shows before anything carries its link
 * away: the account above the new key, then the key being removed and the
 * payment line. Each renders only from a value the checklist read; a value
 * still unread leaves the block not ready, and the carriers stay locked.
 * Addresses render in full, since both ends compare them on the call. Pure.
 */
import { isAddress } from 'viem'

import type { Address, ApproverRequest } from '@web/modules/social-recovery/sdk-interfaces'
import {
  renderFullAddress,
  renderPaymentOrder,
  renderValueLabel
} from '@web/modules/social-recovery/shared/display'
import type { Translate } from '@web/modules/social-recovery/shared/display'

import type { GuardianValueBlock, GuardianValueLine, RemovedKeyRead } from './types'

const fullAddressOf = (address: Address | undefined): string | null =>
  address && isAddress(address, { strict: false }) ? renderFullAddress(address) : null

/**
 * The payment line of the request's own order. A zero amount reads no
 * payment; an order this folder cannot name a token for renders nothing, so
 * the carriers stay locked rather than show a payment the guardian cannot read.
 */
const paymentOf = (request: ApproverRequest, t: Translate): string | null => {
  const { order } = request
  if (!order) {
    return null
  }
  try {
    return renderPaymentOrder(
      { token: order.token, amount: BigInt(order.amount), payee: order.payee },
      null,
      t
    )
  } catch {
    return null
  }
}

/** The four values of one place's request, with the new key and the removed key the checklist read. */
export const guardianValuesOf = (
  request: ApproverRequest,
  newKey: Address | undefined,
  removed: RemovedKeyRead,
  t: Translate
): GuardianValueBlock => {
  const lines: GuardianValueLine[] = [
    {
      name: 'account',
      label: renderValueLabel('account', t),
      value: fullAddressOf(request.account)
    },
    { name: 'newKey', label: renderValueLabel('newKey', t), value: fullAddressOf(newKey) },
    {
      name: 'keyBeingRemoved',
      label: renderValueLabel('keyBeingRemoved', t),
      value: removed.status === 'named' ? fullAddressOf(removed.key) : null
    },
    { name: 'payment', label: renderValueLabel('payment', t), value: paymentOf(request, t) }
  ]
  return { lines, ready: lines.every((line) => line.value !== null) }
}
