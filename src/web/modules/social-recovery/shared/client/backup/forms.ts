/**
 * The form of a backup the chain holds, in the SDK's layout: none for the
 * empty one, the sealed payload at its one fixed size, and the clear
 * configuration's serialization otherwise. The SDK opens a sealed backup
 * alone; a clear one is read back here, so a holder who kept a clear backup
 * restores without the configuration in hand.
 */
import { BACKUP_SEALED_PAYLOAD_SIZE, deserializeConfiguration } from '@kohaku-eth/social-recovery'
import type { BackupChoice, Configuration, Hex } from '@kohaku-eth/social-recovery'
import { size } from 'viem'

/** The empty backup: the setup keeps no copy of its configuration on chain. */
export const EMPTY_BACKUP: Hex = '0x'

export const backupFormOf = (payload: Hex): BackupChoice => {
  if (payload === EMPTY_BACKUP) {
    return 'empty'
  }
  return size(payload) === BACKUP_SEALED_PAYLOAD_SIZE ? 'encrypted' : 'clear'
}

/** The configuration a clear backup holds; throws a `RangeError` on bytes that are not one. */
export const openClearBackup = (payload: Hex): Configuration => deserializeConfiguration(payload)
