# sdk-doubles

- PT-035 The SDK doubles

In-memory implementations of the SDK interfaces the extension consumes, driven by one scripted chain record. Every screen of the cut builds and tests against them until the SDK lands. Only `shared/client` (PT-038) and this folder's tests import them; a screen imports `shared/client` (ESLint enforces it).

The doubles implement the types of `../sdk-interfaces/` and add nothing to them. That folder and these doubles are frozen against `design/sdk.md` at design commit `bd8780f7ad59a451035b15920c00015a2eee6e9b`. The one interface this lane declares is the cut-q-22 seam, `IWalletReadsDouble` (below).

## What is here

| File | What it holds |
| --- | --- |
| `chain.ts` | `ScriptedChain`, the one record every double reads, with its state members, its scripts and `land`. |
| `scripts.ts` | The names of the reads, refusals, simulations and validations a script can touch, and the thrown values (`ScriptedReadFailure`, `validationRefusal`, `restoreRefusal`, `codedError`, `landingRevert`, `kitError`). |
| `verification.ts` | What the chain itself decides, shared by the simulations and `land`: the rule evaluation of D-204, the manager's acceptance path, the execute path with the account behind it. |
| `provider.ts` | `ProviderDouble implements IProvider`. |
| `event-manager.ts` | `EventManagerDouble implements IEventManager`. |
| `policy-manager.ts` | `PolicyManagerDouble implements IPolicyManagerInteractor` (and so `IMethodModuleReads`), and `narrowModuleReads`. |
| `recovery-action.ts` | `RecoveryActionDouble implements IRecoveryActionInteractor, IRecoveryActionArming`, and `narrowActionInteractor`. |
| `action-codec.ts` | `ActionCodecDouble implements IActionCodec<Handover>`, the real `abi.encode(address,address)` layout of contracts D-105. |
| `methods.ts` | One `IRecoveryMethod` double per shipped kind: `WalletMethodDouble`, `PasskeyMethodDouble`, `ZkPassportMethodDouble`, `AadhaarMethodDouble`. |
| `orchestrator.ts` | `MethodsOrchestratorDouble implements IMethodsOrchestrator`. |
| `setup-client.ts` | `SetupClientDouble implements ISetupClient`. |
| `recovery-client.ts` | `RecoveryClientDouble implements IRecoveryClient`. |
| `builder.ts` | `RecoveryKitBuilderDouble implements RecoveryKitBuilder`, and `kitFor(chain, config?)`. |
| `wallet-reads.ts` | The cut-q-22 seam `IWalletReadsDouble` and `WalletReadsDouble`. |
| `context.ts`, `prepared.ts`, `logs.ts`, `encoding.ts` | The shared parts' wiring, the prepared-call composer, the raw-log format and the byte arithmetic (digests, body, backup, public note). |

## Using them

```ts
const chain = new ScriptedChain()                  // defaults: Sepolia-shaped placeholder deployment, one account
const kit = kitFor(chain, { creation })            // provider, descriptor, account and config already set
shippedMethodDoubles(chain).forEach((m) => kit.method(m))
const setup = await kit.buildSetupClient()
const recovery = await kit.buildRecoveryClient()   // same shared parts as `setup`
const approving = kit.buildMethodsOrchestrator()   // no provider
const action = await kit.recoveryAction()          // IRecoveryActionInteractor only, no armingCall at runtime
const moduleReads = await kit.methodModuleReads()  // IMethodModuleReads only, no prepare at runtime
const walletReads = new WalletReadsDouble(chain, { creation })

const commit = await setup.prepareCommitSetup(draft, password)
chain.land(commit)                                 // the chain applies what the prepared calls do
```

The recovery client's context carries the action part as `IRecoveryActionInteractor` alone; the arming seam reaches the setup client alone, through its constructor (D-201 drawing).

`chain.land(prepared)` applies a prepared call or batch the doubles made, as if the integrator sent it: arming, disarming, commit, clear, start, the three cancels and the execute. It ignores the prepare's simulation and judges the chain as it stands at landing. Where the chain would revert any call it throws a `LandingRevert` (`code` the kit error's name, `error` the `KitError`) and applies nothing, since a batch lands whole or not at all. A call the doubles did not prepare changes nothing.

## The scripted chain record

Every state change goes through a member of `ScriptedChain`, and each member appends the events the contract emits, one transaction per block with log indices in order. The interactor, the read seam, the event manager and the privilege stream therefore always agree.

| State (D-371, D-373) | How to set it | What reads back |
| --- | --- | --- |
| setup none | the default, or `clearSetup()` | `stateOf().setupCommitment` is zero; `SetupCleared` after a clear |
| setup committed, private | `commitSetup({ level: 'private', configuration, password })` | public field `0x`, private field sealed; `SetupCommitted`; `stateOf` agrees |
| setup committed, shape-visible | `commitSetup({ level: 'shape-visible', configuration, password })` | public field holds the shape, private field sealed |
| setup committed, public | `commitSetup({ level: 'public', configuration })` | both fields clear, no password |
| a setup under another action | `commitOtherAction(action)`, `clearOtherAction(action)` | events only; `validateSetup` raises `manager.already-armed` while its last write is a commit |
| attempt none | the default | `attempt.state === 'None'` |
| attempt pending | `openAttempt()` | `Waiting`, `consumableAfter` after the head; `AttemptStarted`; the default payload is a decodable handover to `addressOf('new-key')` from the first authority |
| attempt ready | `openAttempt({ ready: true })`, or `advance(seconds)` past the wait | `Waiting`, `consumableAfter` at or before the head |
| cancelled by the account | `cancelAttempt('account')` | `Cancelled`; `AttemptCancelled` with `cancelledBy: 'cancelByOwner'` |
| cancelled by a caller with proofs | `cancelAttempt('proofs', { caller?, usedPlaces? })` | `cancelledBy: 'cancelByProofs'` |
| cancelled by nobody | `cancelAttempt('nobody', { vetoingMethod })` for a security stop's veto, or `cancelAttempt('nobody')` for a setup write | `cancelByVeto` with the vetoing method, or `setupWrite` with a zero canceller |
| executed | `executeAttempt(handover?)` | `Consumed`; `AttemptConsumed`, then the grant of the new key (`LogPrivilegeChanged`, value `KEY_PRIVILEGE`) and the revoke of the removed one (value zero) in one transaction; the key list rotates (ux.md D-319 "AttemptConsumed, key rotated") |
| authorization held or removed | `setAuthorized(boolean)` | `isAuthorized()`; `LogPrivilegeChanged` on the kit slot |
| code present or absent | `setHasCode(boolean)` | `supportsAccount()` answers false with no code; the seam's `fitCheck` judges the code-to-be |
| keys and other privileges | `setAuthorities(keys)`, `setOtherPrivileged(addresses)` | `isAuthority`, `holdsAnyPrivilege`; one `LogPrivilegeChanged` per entry that changed |
| one declaration per method | `declareMethod(module, { moduleInfo, paused, trustedParties })`, `setPaused`, `updateTrustedKeys`, `forgetMethod` | the three module views; `Paused`, `Unpaused`, `TrustedKeysUpdated` |
| a method's `verify` gas | `chain.verifyCosts.set(module, gas)` | what `rule.too-wide` sums; placeholders 10k (wallet), 400k (passkey), 2M (identity pair), 2M for any other module |
| manager views | `chain.manager` (`name`, `version`, `supportsInterface`, `domain`) | `stateOf`, `setupCommittedAtBlock`, `eip712Domain` |
| action views | `setSupportsAccount`, `setAuthorities`, `setOtherPrivileged`, `chain.actionInfo` | `supportsAccount`, `isAuthority`, `holdsAnyPrivilege`, `actionInfo` |

`chain.attemptStatus()` returns the D-371 status (`none`, `pending`, `ready`, `cancelled`, `executed`). Ready is the wallet's own computation, `consumableAfter` against the head's timestamp; the doubles expose it for tests. `advance(seconds, blocks?)` moves chain time. A commit over a waiting attempt cancels it as a setup write, as D-103 does.

`executeAttempt` is a script: it checks only that an attempt waits and that the handover decodes. The chain's own refusals live in `land` and in the execute prepare's simulation: a dormant setup (`!chain.authorized`) reverts as the account's `AccountNotArmed`, an account the action does not fit (`!(hasCode && supportsAccount)`) as the account's `AccountUnfit`, both with `source: 'account'` (D-110, D-205 status description, ux.md D-319, D-373's fifth ending). The two names are the doubles' stand-ins, since D-205 carries the account's reverts as a class the action task pins.

Public note and levels: one rule reads the level from a draft and from the chain's two fields alike (`levelOfFields`): a clear backup is public, a non-empty public note beside a sealed or empty backup is shape-visible, nothing public is private. `readPublicNote(publicMetadata)` (none, shape, clear, or opaque bytes) and `readBackup(privateMetadata, password?)` give the client layer the inputs of D-371's four setup states.

## Failure and refusal scripting

Every script stands until cleared with `restoreRead`, `allow`, `clearSimulation`, `clearFindings` or `clearScripts()`.

- **A read fails**: `chain.failRead(read, { module?, error? })`. The read throws a `ScriptedReadFailure` (`kind: 'scripted-read-failure'`, `code: 'read.unanswered'`, `read`), or the given error. A failed read is a thrown value, never an empty answer. `read` is one of `SCRIPTED_READS`, named part and member, such as `'manager.stateOf'`, `'action.isAuthorized'`, `'provider.block'`, `'events.fetch'` or `'walletReads.removedKey'`.
- **A module read goes unanswered**: `chain.leaveUnanswered('manager.paused' | 'manager.moduleInfo' | 'manager.trustedParties', module?)`. The read answers `{ answered: false }`, the SDK's own shape for a provider that failed (sdk.md D-202).
- **A member refuses**: `chain.refuse(member, refusal)`, with `member` from `SCRIPTED_REFUSALS`, such as `'setup.prepareCommitSetup'` or `'recovery.complete'`. The refusal is `{ kind: 'validation', findings }` (throws a `ValidationRefusal` carrying the findings), `{ kind: 'restore', cause }` (throws a `RestoreRefusal`) or `{ kind: 'error', code?, message? }` (throws a `CodedError`, `scripted.refused` by default).
- **A validation row is forced**: `chain.appendFindings(member, { errors?, warnings? })`, with `member` `'setup.validateSetup'` (read by `validateSetup` and `prepareCommitSetup`) or `'recovery.validateRequest'` (read by `prepareStartAttempt` and `prepareCancelByProofs`). Appended errors refuse the prepares like the doubles' own.
- **A simulation fails**: `chain.failSimulation(member, kitError('ProofRejected', { place, method }))`. The prepare returns its record with `simulation: { ok: false, from, error }`.
- **The typed results**: `chain.replyFailure = cause` (every `replyFrom` returns `{ kind: 'reply-failure', cause }`), `chain.enrollFailure = cause` (every `configFrom`), `chain.verdict = 'satisfied' | 'rejected' | 'not-judged'` (every verify), `chain.addRefusal = reason` (every `addApproverReply` returns that reason with the gathering unchanged), `chain.unmetBindings.add(binding)` (`signingInput` throws for that device binding).

## What the doubles refuse on their own

- **Setup validation** (D-205) raises every setup row from the draft and the reads: `rule.empty`, `clause.empty`, `rule.all-thresholds-zero`, `clause.threshold-above-count`, `clause.threshold-too-wide`, `rule.too-wide`, `credential.duplicate`, `wait.field-width`, `wait.above-maximum`, `action.unsupported`, `backup.too-wide` (plaintext against `BACKUP_PADDING_SIZE`, 16 credentials of the widest shipped config plus a salt and the method address), and the warnings `clause.single-point` (one credential, or threshold equal to count), `clause.threshold-zero`, `clause.shared-failure`, `clause.secondary-only` (every credential of the identity pair), `method.unshipped`, `method.no-declaration`, `method.stopped`, `action.unaudited`, `action.fit-unchecked`, `manager.already-armed`, `setup.wait-short`, `setup.wait-zero`, `backup.clear`, `backup.empty`, `rule.repeated-person` (two credentials whose contact-book labels match). `describeSetup` fills `passkeyDomains` with each passkey place's relying-party hash.
- **Request validation** (D-205) inside `prepareStartAttempt` and `prepareCancelByProofs` raises `request.expired`, `request.attempt-active`, `request.attempt-id`, `request.no-active-attempt`, `request.stale-attempt`, `request.body-mismatch`, `proof.places-unordered`, `request.rule-unsatisfied`, `request.method-stopped`, and on an opening request `handover.malformed`, `handover.same-authority`, `handover.removed-not-authority`, `handover.new-holds-privilege`. Every row carries the subject `request`, as D-205's table gives. The gathering init raises the handover rows and `handover.removed-unknown` before it builds anything; a zero key on either side is `handover.malformed`.
- **Ruling on the D-205 and D-207 conflict (coordinator, PR #8 review):** request validation refuses a stopped method at the prepare with `request.method-stopped`; the simulation, and `land`, still report `MethodStopped` when a stop lands between the prepare and the landing.
- **The rule** is evaluated one way everywhere (`evaluateRule`, D-204): false for a body with no clauses and for a rule whose every threshold is zero, in `assess`, `complete` and request validation alike.
- **`addApproverReply`** checks the pasted reply's shape first and never throws: a record that is not a reply or whose fields are not the record's types is `version-unread`; then `binding-mismatch`, `place-unknown`, `credential-mismatch`, `digest-mismatch`. The seam's `verifyReply` runs the same shape check (`replyReadable`, and `requestReadable` on the request) and answers `rejected` to a malformed paste, a reply with no digest or no proof among them.
- **The simulations** and `land` run the chain's path: `RequestExpired`, `NoSetup`, `AttemptAlreadyActive`, `WrongAttemptId`, `NoActiveAttempt`, `StaleAttempt`, `WrongSetupNonce`, `SetupCommitmentMismatch`, `PlacesNotStrictlyIncreasing`, `PlaceOutOfRange`, `CredentialMismatch`, `MethodStopped`, `ProofRejected`, `RuleUnsatisfied`, `MethodNotUsed`, `AttemptIgnoresPause`, `MethodNotStopped`, and at the execute `MalformedHandover` (an undecodable payload is a simulation result, never a thrown finding), `NotConsumable`, `ReservedAuthority`, `AccountNotArmed`, `AccountUnfit`, `MethodVetoedSpend`.
- **Every other refusal is a `CodedError`**, never only a sentence: `version-unread`, `method-unsupported`, `binding-unmet`, `params-missing`, `material-missing` (the orchestrator and the methods), `action.no-codec`, `setup.password-missing`, `confirm.no-commit-call`, `confirm.commitment-mismatch`, `MalformedHandover` (the codec), `builder.frozen`, and the scripts' kit-error names (`NoSetup`, `AttemptAlreadyActive`, `NoActiveAttempt`, `NotConsumable`). Codes that are not D-205, D-206 or D-207 slugs or kit error names are the doubles' own.

## The digest and the proof convention

The digest of a place is the real EIP-712 hash of D-204's typed data, `typedDataOf(members)`: domain `PolicyManager`, the digest version, a numeric chain id and the manager; `Approval` (account, action, attemptId, setupNonce, setupBodyHash, payload, the nested `PaymentOrder`, validUntil, place) or `Cancellation` (the same without payload and order). It folds nothing else: the credential is bound by the place through the body's credential hash, so `hashApproval` and `hashCancel` answer for any place, proof or not. The wallet method's `signingInput` returns that typed data, `{ domain, types, primaryType, message }`; the ctx carries the digest beside it, never inside it. Its message carries `bigint` values (`attemptId`, `setupNonce`, `validUntil`, `place` and the order's `amount`), which `JSON.stringify` refuses, so an offline JSON export of the typed data (the guardian page's offline block, PT-064) needs a bigint-aware serializer, one that writes each as a decimal string, as `eth_signTypedData_v4` accepts.

The doubles run no real signature, WebAuthn or proving cryptography. A proof satisfies a credential exactly when it equals `doubleProof(config, digest)`. Each method double's `satisfyingMaterial(request)` builds the material a willing approver's device returns; the Aadhaar double needs the QR data it was enrolled with. The setup body, the commitment, the backup and the public note are the doubles' own bytes (keccak256 over canonical JSON), not D-204's ABI layouts. The handover payload and the digest are the real ones.

## The cut-q-22 seam

`IWalletReadsDouble` in `wallet-reads.ts` holds the three members the ux chapter asks for and sdk.md D-201 does not name (open question 4 of `docs/social-recovery/tasks/README.md`). They are not SDK members, so the extension owns the seam. The name follows the brief: it is the wallet's own reads, and the `Double` suffix marks that the shape lives in this lane until the sdk chapter adopts or renames them. PT-038 wraps it; no screen imports it.

```ts
interface IWalletReadsDouble {
  verifyReply(request: ApproverRequest, reply: ApproverReply): Promise<Verdict>   // the verify per pasted reply (D-373, D-374)
  removedKey(): Promise<                                                          // the key a recovery would remove (D-371, D-319)
    | { kind: 'named'; key: Address }
    | { kind: 'unavailable'; cause: 'no-creation-record' | 'no-key-entry' | 'several-key-entries' }
  >
  fitCheck(accountImplementation?: Address): Promise<                             // the fit check on the code-to-be (D-371, D-319)
    | { basis: 'deployed-code'; fits: boolean }
    | { basis: 'code-to-be'; implementation: Address; fits: boolean }
    | { basis: 'no-code'; fits: false }
  >
}
```

Each member throws when its read is scripted to fail (`walletReads.verifyReply`, `walletReads.removedKey`, `walletReads.fitCheck`), and never on a malformed paste.

## Where the doubles differ from `sdk-interfaces/`

These are gaps in the frozen types, reported and not patched.

- `RecoveryState.removedKey` is `Address | 'no-creation-triple'` (interactor.ts; sdk.md D-202 "The two state records" and the inference under "Recovery request"). It has no value for a creation record whose replay names no key or several. The recovery client double answers `'no-creation-triple'` there, and the seam's `removedKey()` names the cause.
- `PreparedCall` has no field for a warning (interactor.ts; sdk.md D-202 "Simulation", fourth rule, and "Recovery execute"), so the `payment.open-payee` warning the execute prepare raises is not carried.
- `ReadResult<TrustedParties>` has one "no value" shape, `{ answered: false }` (interactor.ts `IMethodModuleReads`, common.ts `ReadResult`; sdk.md D-202 "The read surface", ux-interfaces.md D-371). **Judgment call, flagged for the sdk owner:** for a module with no declaration, `moduleInfo` and `trustedParties` answer alike, `answered: true` with empty values (empty name and version, zero parties), since D-202 says a revert is a contract answering; `validateSetup` raises `method.no-declaration` from those empty values, and `{ answered: false }` stays the failed provider's alone. The owner may rule otherwise.
- No construction-refusal shape is declared (builder.ts; sdk.md D-208 construction checks). The builder double throws a `ConstructionRefusal`, a `CodedError` with `code` `construction.<check>` and `check` one of `descriptor`, `provider`, `account`, `chain-id`, `domain`, `domain-fields`, `digest-version`.
- No coded-error shape is declared for the refusals that are neither a validation nor a restore refusal (utilities.ts declares `ValidationRefusal` and `RestoreRefusal` alone; sdk.md D-201 "Refusals throw" says an ordinary error). The doubles throw a `CodedError` (scripts.ts): an `Error` with `code`, a slug or a kit error name, and `values`, the facts behind it as a record. The codes the doubles use are listed under "What the doubles refuse on their own"; the real SDK's may differ.
- `AccountNotArmed` and `AccountUnfit` are stand-in names for the account's own reverts at the execute (sdk.md D-205 carries the account's reverts as a class the action task pins from the vendored revision). The client layer (PT-038) must map them, by `source: 'account'` and these two names, to its own vocabulary, and expect the real names to differ.
- `ClientConfiguration` has no version-escape option (sdk.md D-208) and no moment-skew span (D-207). The builder double never escapes; `MOMENT_SKEW_SPAN` is the doubles' own 15 minutes.
- The value shapes of `SetupDescription` are `unknown` in the interfaces; the double's shapes are its own and a screen must not rely on them.
