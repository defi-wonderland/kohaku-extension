/**
 * The address book of the kit's two deployments: the manager, the four method
 * modules, the action and the account implementation the action serves.
 *
 * cut-q-7 (docs/social-recovery/tasks/README.md, open question 9): the
 * addresses of the manager, the methods and the action on the test network
 * are owed by the contracts owner and the design owner, and sdk.md D-208 says
 * every field of both default descriptors is a placeholder until each
 * deployment lands. Every address below is therefore a named placeholder and
 * no contract is deployed at any of them. Each reads as `c7` (for cut-q-7),
 * one byte for the chain (`01` Sepolia, `02` mainnet) and one byte for the
 * field, behind seventeen zero bytes, so nobody mistakes one for a deployment.
 * Replace them in this one file when cut-q-7 is answered.
 */
import type { Address } from '@web/modules/social-recovery/sdk-interfaces'

import type { RecoveryChain } from './chains'

/** The addresses one deployment is reached at (ux-interfaces.md D-370 "the address book"). */
export interface AddressBook {
  /** The policy manager every setup and attempt call targets (contracts D-103). */
  manager: Address
  /** The four shipped method modules (contracts D-104). */
  methods: {
    ecdsa: Address
    passkey: Address
    aadhaar: Address
    zkpassport: Address
  }
  /** The recovery action for Kohaku's Ambire-derived account (contracts D-105). */
  action: Address
}

/** The placeholder addresses of both deployments, by chain (cut-q-7). */
export const PLACEHOLDER_ADDRESSES = {
  sepolia: {
    // cut-q-7 placeholder: the Sepolia policy manager.
    manager: '0x0000000000000000000000000000000000c70101',
    // cut-q-7 placeholder: the Sepolia guardian (ECDSA) method.
    methodEcdsa: '0x0000000000000000000000000000000000c70102',
    // cut-q-7 placeholder: the Sepolia passkey method.
    methodPasskey: '0x0000000000000000000000000000000000c70103',
    // cut-q-7 placeholder: the Sepolia Anon Aadhaar method.
    methodAadhaar: '0x0000000000000000000000000000000000c70104',
    // cut-q-7 placeholder: the Sepolia zkPassport method.
    methodZkpassport: '0x0000000000000000000000000000000000c70105',
    // cut-q-7 placeholder: the Sepolia recovery action.
    action: '0x0000000000000000000000000000000000c70106',
    // cut-q-7 placeholder: the account implementation the Sepolia action serves.
    servedImplementation: '0x0000000000000000000000000000000000c70107'
  },
  mainnet: {
    // cut-q-7 placeholder: the mainnet policy manager.
    manager: '0x0000000000000000000000000000000000c70201',
    // cut-q-7 placeholder: the mainnet guardian (ECDSA) method.
    methodEcdsa: '0x0000000000000000000000000000000000c70202',
    // cut-q-7 placeholder: the mainnet passkey method.
    methodPasskey: '0x0000000000000000000000000000000000c70203',
    // cut-q-7 placeholder: the mainnet Anon Aadhaar method.
    methodAadhaar: '0x0000000000000000000000000000000000c70204',
    // cut-q-7 placeholder: the mainnet zkPassport method.
    methodZkpassport: '0x0000000000000000000000000000000000c70205',
    // cut-q-7 placeholder: the mainnet recovery action.
    action: '0x0000000000000000000000000000000000c70206',
    // cut-q-7 placeholder: the account implementation the mainnet action serves.
    servedImplementation: '0x0000000000000000000000000000000000c70207'
  }
} as const

/** The address book of one chain's shipped deployment, as a fresh record. */
export const addressBookOf = (chain: RecoveryChain): AddressBook => {
  const a = PLACEHOLDER_ADDRESSES[chain]
  return {
    manager: a.manager,
    methods: {
      ecdsa: a.methodEcdsa,
      passkey: a.methodPasskey,
      aadhaar: a.methodAadhaar,
      zkpassport: a.methodZkpassport
    },
    action: a.action
  }
}

/** Two addresses name the same account or contract, whatever their case. */
export const sameAddress = (a: string | undefined, b: string | undefined): boolean =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase()
