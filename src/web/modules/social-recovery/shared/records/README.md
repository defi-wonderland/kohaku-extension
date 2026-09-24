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

`storage` is injectable, so a test passes an in-memory double with the helper's `get(key, default)`, `set` and `remove`, and an optional `getAll()` that returns every entry by key. `extensionRecordStorage.getAll` is the helper's `get()` with no key, which returns every entry of `browser.storage.local`. The two list functions scan by key prefix through `getAll` and throw on a storage without it. `now` is injectable too and defaults to `Date.now`.

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
| Recovery session | `{ state: 'live', gathering }`, `{ state: 'wiped', reason, account, deadline? }` or `{ state: 'landed', account }` | `socialRecovery:recoverySession:<chainId>:<account>` |
| Decrypted setup cache | `{ configuration, setupNonce, setupCommitment? }` | `socialRecovery:decryptedSetupCache:<chainId>:<account>` |

`<account>` is the lowercase address. A write for one account touches only that account's keys, so it never wipes another account's session. The countdown has no key of its own: it is the recovery session in its landed state (see below).

## The live session

The live session's body is the SDK's gathering record (`sdk.md` D-207, `Gathering` in sdk-interfaces), which the integrator stores so the gathering survives a closed tab. Its request carries what a resume needs (`ux-interfaces.md` D-373): the account, the predicted attempt id (`request.attemptId`), the setup nonce the request was built under (`request.setupNonce`) and the deadline (`request.validUntil`). Its replies are the approvals. `sessionAccount(record)` and `predictedAttemptId(live)` read them.

A write takes an approval gathering whose request names the keyed account and chain. Over a live session it refuses:

- a gathering whose request differs from the stored request in any field, payload, order, digest version, setup body and block included, since replacing the request would wipe the session without one of the five reasons. A new request follows a wipe.
- a gathering that leaves a filled place without a reply. A later reply for the same place may displace the earlier one, since `addApproverReply` replaces a second reply for one place and names the one it displaced (`sdk.md` D-207); a reply is never dropped.

A write over a landed session is refused: the countdown's record is ended with `endCountdown` once its attempt ends, then a new gathering starts. A write over a wiped session starts the new gathering.

## The wipe and its line of reason

The five wipe events are the closed vocabulary `RECOVERY_WIPE_EVENTS`: `submission-landed`, `deadline-passed`, `another-attempt-opened`, `setup-changed`, `recoverer-abandoned`. A wipe deletes the whole gathering, so no reply outlives it (I-38).

- The four direct events leave `{ state: 'wiped', reason, account, deadline? }`, `reason` typed `DirectWipeEvent`: `submission-landed` is never a wiped reason. The account is always kept, and `deadline` (the request's `validUntil`) only for `deadline-passed`, so the expired ("The deadline passed on {{deadline}}"), void and setup changed states of D-392 and D-393 render after a resume. This record is this lane's reading of the "one line of reason" of D-310 and I-38. The owner rules on whether the account and the deadline belong on that line.
- The submission landing leaves `{ state: 'landed', account }`: "the session itself survives the submission as the countdown's record, holding the account address alone" (D-310). `landSubmission` writes it in one `set` in place of the live session, so the countdown's record and the wipe land together. The countdown takes the attempt id from the attempt read (D-371).

A security stop or a pause is not in the vocabulary and wipes nothing (I-38).

## Functions

- `records.setup(chainId, account)` returns the six setup records, each with `read()`, `write(value)`, `wipe()` and `age(at?)`. `records.setupSavedAt(chainId, account)` returns the latest `savedAt` of the six, the age a resumed draft shows.
- `records.saveSetup(chainId, account)` and `records.startOverSetup(chainId, account)` wipe the six setup records. They touch no other key, so platform credentials survive.
- `records.recoverySession(chainId, account)` has `read()`, `write(gathering)` and `age(at?)`. `records.listRecoverySessions(chainId)` returns every session on the chain, live, wiped or landed, as `{ account, record }`, ordered by key.
- `records.wipeRecoverySession(chainId, account, event)` takes one of the four direct events (`DirectWipeEvent`). It wipes only a live session and returns `true`; on an absent, wiped or landed session it changes nothing and returns `false`. `submission-landed` and any value outside the vocabulary throw and wipe nothing.
- `records.landSubmission(chainId, account)` refuses (throws) when no live session exists. Otherwise it writes the landed session in one `set` and returns the countdown's record `{ value: { account }, savedAt }`.
- `records.clearWipedSession(chainId, account)` removes a session in its wiped state, once its death screen is read, so old sessions do not accumulate, and returns `true`. On a live, landed or absent session it touches nothing and returns `false`, so clearing old death screens never ends a running countdown (D-393).
- `records.endCountdown(chainId, account)` removes a session in its landed state, once the attempt it counts down to has ended, and returns `true`. On a live, wiped or absent session it touches nothing and returns `false`.
- `records.countdown(chainId, account)` has `read()` and `age(at?)`. It reads the session record: the landed state reads as `{ account }`, every other state as `ABSENT`. `records.listCountdowns(chainId)` returns every landed session on the chain as `{ account, record }`.
- `records.decryptedSetupCache(chainId, account)` has `read()`, `write({ configuration, setupNonce, setupCommitment? })`, `wipe()` and `age(at?)`. A reader compares `setupNonce` (or the commitment) with the chain before trusting the cache, since D-310 calls it a cache re-imported from the chain. No wipe of this lane touches it, so it stays after the recovery executes.
- `WIPE_REASON_STRING_KEYS` maps each reason code to its `socialRecovery.records` title and body keys: `deadline-passed` to the expired state, `another-attempt-opened` to the void state, `setup-changed` to the setup changed state (D-392, D-393). `submission-landed` and `recoverer-abandoned` map to `null`.
- `recordKeys`, `recordAge(read, at)`, `isRecoveryWipeEvent(value)`, `sessionAccount(record)` and `predictedAttemptId(live)` are exported for callers and tests.
