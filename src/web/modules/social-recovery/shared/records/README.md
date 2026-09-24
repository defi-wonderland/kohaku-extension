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
| Enrollments | `Enrollment[]` (credential, test verdict, cause) | `socialRecovery:enrollments:<chainId>:<account>` |
| Waiting period | `SetupDraft['wait']` (seconds) | `socialRecovery:waitingPeriod:<chainId>:<account>` |
| Password-set flag | `'password-set'`, never a boolean | `socialRecovery:passwordSet:<chainId>:<account>` |
| Recovery session | `LiveRecoverySession` or `WipedRecoverySession` | `socialRecovery:recoverySession:<chainId>` |
| Countdown | `{ account }` alone | `socialRecovery:countdown:<chainId>` |
| Decrypted setup cache | `Configuration` (sdk-interfaces) | `socialRecovery:decryptedSetupCache:<chainId>:<account>` |

`<account>` is the lowercase address. The recovery session and the countdown are this device's one recovery on a chain, so they carry the account as a field rather than in the key.

## Functions

- `records.setup(chainId, account)` returns the six setup records, each with `read()`, `write(value)`, `wipe()` and `age(at?)`. `records.setupSavedAt(chainId, account)` returns the latest `savedAt` of the six, the age a resumed draft shows.
- `records.saveSetup(chainId, account)` and `records.startOverSetup(chainId, account)` wipe the six setup records. They touch no other key, so platform credentials survive.
- `records.recoverySession(chainId)` has `read()`, `write({ account, predictedAttemptId, approvals })` and `age(at?)`.
- `records.wipeRecoverySession(chainId, event)` takes one of the five `RECOVERY_WIPE_EVENTS`: `submission-landed`, `deadline-passed`, `another-attempt-opened`, `setup-changed`, `recoverer-abandoned`. It deletes the approvals and the predicted attempt id and leaves `{ state: 'wiped', reason: event }`, one reason code and nothing else (I-38). Any other value, a security stop or a pause among them, throws and wipes nothing.
- `records.landSubmission(chainId, account)` writes the countdown record, the account address alone, then wipes the session with `submission-landed`. The countdown takes the attempt id from the attempt read (D-371).
- `records.countdown(chainId)` has `read()`, `write(account)`, `wipe()` and `age(at?)`.
- `records.decryptedSetupCache(chainId, account)` has `read()`, `write(configuration)`, `wipe()` and `age(at?)`. No wipe of this lane touches it, so it stays after the recovery executes.
- `WIPE_REASON_STRING_KEYS` maps each reason code to its `socialRecovery.records` title and body keys: `deadline-passed` to the expired state, `another-attempt-opened` to the void state, `setup-changed` to the setup changed state (D-392, D-393). `submission-landed` and `recoverer-abandoned` map to `null`.
- `recordKeys`, `recordAge(read, at)` and `isRecoveryWipeEvent(value)` are exported for callers and tests.
