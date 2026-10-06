/**
 * The manager's setup events and the Ambire account's privilege event: their
 * topics, filters and decoding, and the chunked log scan they are read
 * through.
 */
export {
  SETUP_COMMITTED_TOPIC,
  SETUP_CLEARED_TOPIC,
  decodeSetupLog,
  createSetupEvents
} from './setup-events'
export {
  PRIVILEGE_CHANGED_TOPIC,
  decodePrivilegeLog,
  createPrivilegeEvents
} from './privilege-events'
export { LOG_CHUNK_BLOCKS, chunksOf, logsInChunks } from './log-scan'
export type {
  CommitQuery,
  LogScan,
  PrivilegeChangedLog,
  PrivilegeEvents,
  SetupClearedLog,
  SetupCommittedLog,
  SetupEvents,
  SetupLog
} from './types'
