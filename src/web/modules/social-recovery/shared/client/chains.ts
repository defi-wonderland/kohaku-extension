/**
 * The chains the wallet can read a recovery on, and the one it does read.
 *
 * sdk.md D-208 ships a default descriptor for two chains, Sepolia for the
 * showcase and Ethereum mainnet for the production target. ux.md D-312
 * (2026-09-22) rules that the wallet reads one chain, named by its
 * configuration, and names it as a fixed label with no switch.
 */

export const RECOVERY_CHAINS = ['sepolia', 'mainnet'] as const
export type RecoveryChain = typeof RECOVERY_CHAINS[number]

/** The chain id of each recovery chain (sdk.md D-208 `chainId`). */
export const CHAIN_IDS = {
  sepolia: 11155111,
  mainnet: 1
} as const

/**
 * The one chain this build reads (ux.md D-312). The first release runs its
 * demo on the test network; the mainnet descriptor stays a placeholder until
 * that deployment lands. No screen offers a switch.
 */
export const WALLET_RECOVERY_CHAIN: RecoveryChain = 'sepolia'

/** The recovery chain a chain id names, or undefined for any other chain. */
export const recoveryChainOf = (chainId: number | bigint): RecoveryChain | undefined =>
  RECOVERY_CHAINS.find((chain) => CHAIN_IDS[chain] === Number(chainId))
