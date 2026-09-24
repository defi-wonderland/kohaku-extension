/**
 * The `IActionCodec` double for the shipped action (sdk.md D-204): the payload
 * is `abi.encode(address newAuthority, address removedAuthority)`, the layout of
 * contracts D-105, and the decoder refuses bytes its encoder would not
 * reproduce.
 */
import type {
  Address,
  Handover,
  Hex,
  IActionCodec
} from '@web/modules/social-recovery/sdk-interfaces'
import { decodeAbiParameters, encodeAbiParameters } from 'viem'

const HANDOVER_LAYOUT = [
  { name: 'newAuthority', type: 'address' },
  { name: 'removedAuthority', type: 'address' }
] as const

export class ActionCodecDouble implements IActionCodec<Handover> {
  readonly actions: Address[]

  constructor(actions: Address[]) {
    this.actions = [...actions]
  }

  encode(handover: Handover): Hex {
    return encodeAbiParameters(HANDOVER_LAYOUT, [handover.newAuthority, handover.removedAuthority])
  }

  decode(payload: Hex): Handover {
    const [newAuthority, removedAuthority] = decodeAbiParameters(HANDOVER_LAYOUT, payload)
    const handover = { newAuthority, removedAuthority }
    if (this.encode(handover).toLowerCase() !== payload.toLowerCase()) {
      throw new Error('MalformedHandover: the payload does not re-encode to the same bytes.')
    }
    return handover
  }
}
