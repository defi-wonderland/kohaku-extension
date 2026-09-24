/**
 * The two deployment descriptors of sdk.md D-208, Sepolia and Ethereum
 * mainnet, as plain data this build carries.
 *
 * Every address is a cut-q-7 placeholder (addresses.ts), and sdk.md D-208 says
 * every field of both is a placeholder until each deployment lands: the
 * deployment block, the digest version and the release string too. The digest
 * version is the domain version this build derives typed data under (contracts
 * D-103 `DIGEST_VERSION`, sdk.md D-204 "The version constants"); `buildRecoveryClient`
 * refuses a manager that publishes another one (ux.md D-319).
 *
 * The two audited sets are the kit's claim, not the address fields read back
 * (sdk.md D-208): `shippedMethods` are the four shipped modules and
 * `auditedActions` come from the one audited-actions table (audited-actions.ts).
 */
import type { DeploymentDescriptor } from '@web/modules/social-recovery/sdk-interfaces'

import { AddressBook, PLACEHOLDER_ADDRESSES } from './addresses'
import { auditedActionsOn } from './audited-actions'
import { CHAIN_IDS, RecoveryChain } from './chains'

/** The fields of a shipped descriptor that are not addresses, all placeholders until deployment. */
export const DEPLOYMENT_FACTS = {
  sepolia: {
    // Placeholder until the Sepolia deployment lands (cut-q-7).
    deployedAt: 0,
    // The digest format version this build derives under; placeholder until contracts fix it.
    digestVersion: '1',
    // Placeholder release string until the Sepolia deployment lands (cut-q-7).
    managerVersion: '1.0.0'
  },
  mainnet: {
    // Placeholder until the mainnet deployment lands.
    deployedAt: 0,
    // The digest format version this build derives under; placeholder until contracts fix it.
    digestVersion: '1',
    // Placeholder release string until the mainnet deployment lands.
    managerVersion: '1.0.0'
  }
} as const

/** The shipped descriptor of one chain (sdk.md D-208), as a fresh record every call. */
export const deploymentDescriptor = (chain: RecoveryChain): DeploymentDescriptor => {
  const a = PLACEHOLDER_ADDRESSES[chain]
  const facts = DEPLOYMENT_FACTS[chain]
  return {
    chainId: CHAIN_IDS[chain],
    manager: a.manager,
    methodEcdsa: a.methodEcdsa,
    methodPasskey: a.methodPasskey,
    methodAadhaar: a.methodAadhaar,
    methodZkpassport: a.methodZkpassport,
    action: a.action,
    servedImplementation: a.servedImplementation,
    deployedAt: facts.deployedAt,
    digestVersion: facts.digestVersion,
    managerVersion: facts.managerVersion,
    shippedMethods: [a.methodEcdsa, a.methodPasskey, a.methodAadhaar, a.methodZkpassport],
    auditedActions: auditedActionsOn(chain).map((row) => row.action)
  }
}

/**
 * The descriptor a client is built with: the chain's shipped descriptor with
 * the configuration's address book in its address fields. The two audited
 * sets stay the shipped ones, so an address book naming another action or
 * method gets the unaudited and unshipped warnings rather than silencing them
 * (sdk.md D-208: registering never widens the audited sets).
 */
export const descriptorOf = (chain: RecoveryChain, book: AddressBook): DeploymentDescriptor => ({
  ...deploymentDescriptor(chain),
  manager: book.manager,
  methodEcdsa: book.methods.ecdsa,
  methodPasskey: book.methods.passkey,
  methodAadhaar: book.methods.aadhaar,
  methodZkpassport: book.methods.zkpassport,
  action: book.action
})
