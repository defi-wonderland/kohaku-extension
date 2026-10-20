/**
 * A backup read from the chain names its form in the SDK's layout: no bytes
 * for the empty one, the sealed payload at its one fixed size, and the clear
 * configuration's serialization otherwise, which reads back as the
 * configuration. Text that is not hex bytes names no form.
 */
import { BACKUP_SEALED_PAYLOAD_SIZE, serializeConfiguration } from '@kohaku-eth/social-recovery'
import type { Configuration, Hex } from '@kohaku-eth/social-recovery'

import {
  backupFormOf,
  EMPTY_BACKUP,
  openClearBackup
} from '@web/modules/social-recovery/shared/client/backup'

const CONFIGURATION: Configuration = {
  wait: 3 * 24 * 3600,
  ignoresPause: false,
  clauses: [
    {
      threshold: 1,
      credentials: [
        {
          method: '0x00000000000000000000000000000000000C7010',
          config: `0x${'00'.repeat(12)}${'ab'.repeat(20)}`
        }
      ]
    }
  ]
}

describe('backupFormOf', () => {
  it('names the empty backup', () => {
    expect(EMPTY_BACKUP).toBe('0x')
    expect(backupFormOf(EMPTY_BACKUP)).toBe('empty')
  })

  it('names the sealed backup by its fixed size, and any other bytes the clear one', () => {
    expect(backupFormOf(`0x${'ff'.repeat(BACKUP_SEALED_PAYLOAD_SIZE)}`)).toBe('encrypted')
    expect(backupFormOf(`0x${'ff'.repeat(BACKUP_SEALED_PAYLOAD_SIZE - 1)}`)).toBe('clear')
    expect(backupFormOf(serializeConfiguration(CONFIGURATION))).toBe('clear')
  })

  it('refuses text that is not hex bytes', () => {
    ;(['0xzz', '0x012', '01', ''] as Hex[]).forEach((payload) =>
      expect(() => backupFormOf(payload)).toThrow(RangeError)
    )
  })
})

describe('openClearBackup', () => {
  it('reads a clear backup back as the configuration it serializes', () => {
    const opened = openClearBackup(serializeConfiguration(CONFIGURATION))
    expect(opened.wait).toBe(CONFIGURATION.wait)
    expect(opened.clauses[0].threshold).toBe(1)
    expect(opened.clauses[0].credentials[0].config).toBe(
      CONFIGURATION.clauses[0].credentials[0].config
    )
  })
})
