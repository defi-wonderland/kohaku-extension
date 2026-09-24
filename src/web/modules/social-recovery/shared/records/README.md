# shared/records

- PT-040 The wallet's records

The extension's storage of every record `docs/social-recovery/design/ux.md` D-310 names. Records live in the extension's local storage through `src/web/extension-services/background/webapi/storage.ts`, never in a background controller, since the worker restarts and clears its controllers. The SDK stores nothing (`ux-interfaces.md` D-370): the setup draft, the recovery session and the setup cache live here, and the SDK sees them only as arguments. No React and no hook; a hook belongs to the screen that needs it.

## Use

```ts
import {
  createWalletRecords,
  extensionRecordStorage
} from '@web/modules/social-recovery/shared/records'

const records = createWalletRecords({ storage: extensionRecordStorage })
```

`storage` is injectable, so a test passes an in-memory double with the helper's `get(key, default)`, `set` and `remove`. `now` is injectable too and defaults to `Date.now`.

## Stored shape

Every record is stored as `{ value, savedAt }`, `savedAt` in ms since epoch. No record is a bare boolean or zero, since the helper's `get` returns the default for a falsy stored value. A read returns `{ status: 'present', value, savedAt }` or `ABSENT` (`{ status: 'absent' }`), never `false` or `0`. A stored value without that shape reads as `ABSENT`. Values may carry `bigint`; the helper's rich JSON keeps it.

## Records and keys

| Record | Value type | Storage key |
| --- | --- | --- |
| Setup draft | `SetupDraft` (sdk-interfaces, D-202) | `socialRecovery:setupDraft:<chainId>:<account>` |
| Inventory | `InventoryItem[]` | `socialRecovery:inventory:<chainId>:<account>` |
| Path | `SetupDraft['clauses']`, the record the rule lines read | `socialRecovery:path:<chainId>:<account>` |
| Enrollments | `Enrollment[]`: credential, test verdict, cause, and for a passkey `backup: 'synced' \| 'device-bound'` (D-305) | `socialRecovery:enrollments:<chainId>:<account>` |
| Waiting period | `SetupDraft['wait']` (seconds) | `socialRecovery:waitingPeriod:<chainId>:<account>` |
| Password-set flag | `'password-set'`, never a boolean | `socialRecovery:passwordSet:<chainId>:<account>` |
| Recovery session | `{ state: 'live', gathering }` or `{ state: 'wiped', reason, account, deadline? }` | `socialRecovery:recoverySession:<chainId>:<account>` |
| Countdown | `{ account }` alone | `socialRecovery:countdown:<chainId>:<account>` |
| Decrypted setup cache | `{ configuration, setupNonce, setupCommitment? }` | `socialRecovery:decryptedSetupCache:<chainId>:<account>` |
| Session index | `{ accounts }`, the accounts holding a session on the chain | `socialRecovery:recoverySessionIndex:<chainId>` |
| Countdown index | `{ accounts }`, the accounts holding a countdown on the chain | `socialRecovery:countdownIndex:<chainId>` |

`<account>` is the lowercase address. A write for one account touches only that account's keys, so it never wipes another account's session. The two index records back the list functions, since the storage helper's keyed `get` cannot enumerate. An index entry is written before the record it lists and removed after it, so an interrupted call leaves at worst an entry whose record reads absent, which a listing skips. Two concurrent writes for different accounts can race on the index (read, modify, write).

## The live session

The live session's body is the SDK's gathering record (`sdk.md` D-207, `Gathering` in sdk-interfaces), which the integrator stores so the gathering survives a closed tab. Its request carries what a resume needs (`ux-interfaces.md` D-373): the account, the predicted attempt id (`request.attemptId`), the setup nonce the request was built under (`request.setupNonce`) and the deadline (`request.validUntil`). Its replies are the approvals. `sessionAccount(record)` and `predictedAttemptId(live)` read them.

A write takes an approval gathering whose request names the keyed account and chain. It refuses a gathering whose request differs from the live session's own (chain, manager, account, action, attempt id, setup nonce, deadline): replacing the request would wipe the session without one of the five reasons. A new request follows a wipe.

## The wipe and its line of reason

The five wipe events are the closed vocabulary `RECOVERY_WIPE_EVENTS`: `submission-landed`, `deadline-passed`, `another-attempt-opened`, `setup-changed`, `recoverer-abandoned`. A wipe deletes the whole gathering, so no reply outlives it (I-38), and leaves `{ state: 'wiped', reason, account, deadline? }`. The account is always kept, and `deadline` (the request's `validUntil`) only for `deadline-passed`, so the expired ("The deadline passed on {{deadline}}"), void and setup changed states of D-392 and D-393 render after a resume. This record is this lane's reading of the "one line of reason" of D-310 and I-38. The owner rules on whether the account and the deadline belong on that line.

A security stop or a pause is not in the vocabulary and wipes nothing (I-38).

## Functions

- `records.setup(chainId, account)` returns the six setup records, each with `read()`, `write(value)`, `wipe()` and `age(at?)`. `records.setupSavedAt(chainId, account)` returns the latest `savedAt` of the six, the age a resumed draft shows.
- `records.saveSetup(chainId, account)` and `records.startOverSetup(chainId, account)` wipe the six setup records. They touch no other key, so platform credentials survive.
- `records.recoverySession(chainId, account)` has `read()`, `write(gathering)` and `age(at?)`. `records.listRecoverySessions(chainId)` returns every stored session on the chain, live or wiped, as `{ account, record }`.
- `records.wipeRecoverySession(chainId, account, event)` takes one of the four direct events (`DirectWipeEvent`). It wipes only a live session and returns `true`; on an absent or already wiped session it changes nothing and returns `false`. `submission-landed` and any value outside the vocabulary throw and wipe nothing.
- `records.landSubmission(chainId, account)` refuses (throws) when no live session exists. Otherwise it writes the countdown record, the account address alone, and then the wiped session with `submission-landed`. The helper's `set` writes one key per call, so these are two writes, the countdown first: an interrupted call never loses the account, and a retry finds the session still live and completes. It returns the countdown record. The countdown takes the attempt id from the attempt read (D-371).
- `records.countdown(chainId, account)` has `read()`, `write()`, `wipe()` and `age(at?)`. `records.listCountdowns(chainId)` returns every countdown on the chain as `{ account, record }`.
- `records.decryptedSetupCache(chainId, account)` has `read()`, `write({ configuration, setupNonce, setupCommitment? })`, `wipe()` and `age(at?)`. A reader compares `setupNonce` (or the commitment) with the chain before trusting the cache, since D-310 calls it a cache re-imported from the chain. No wipe of this lane touches it, so it stays after the recovery executes.
- `WIPE_REASON_STRING_KEYS` maps each reason code to its `socialRecovery.records` title and body keys: `deadline-passed` to the expired state, `another-attempt-opened` to the void state, `setup-changed` to the setup changed state (D-392, D-393). `submission-landed` and `recoverer-abandoned` map to `null`.
- `recordKeys`, `recordAge(read, at)`, `isRecoveryWipeEvent(value)`, `sessionAccount(record)` and `predictedAttemptId(live)` are exported for callers and tests.
