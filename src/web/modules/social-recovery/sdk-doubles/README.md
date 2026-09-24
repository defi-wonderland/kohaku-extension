# sdk-doubles

- PT-035 The SDK doubles

In-memory implementations of the SDK interfaces the extension consumes, driven by one scripted chain record. Every screen of the cut builds and tests against them until the SDK lands. Only `shared/client` (PT-038) and this folder's tests import them; a screen imports `shared/client` (ESLint enforces it).

The doubles implement the types of `../sdk-interfaces/` and add nothing to them. That folder and these doubles are frozen against `design/sdk.md` at design commit `bd8780f7ad59a451035b15920c00015a2eee6e9b`. The one interface this lane declares is the cut-q-22 seam, `IWalletReadsDouble` (below).

## What is here

| File | What it holds |
| --- | --- |
| `chain.ts` | `ScriptedChain`, the one record every double reads, with its state members and its scripts. |
| `scripts.ts` | The names of the reads, refusals and simulations a script can fail, and the thrown values (`ScriptedReadFailure`, `validationRefusal`, `restoreRefusal`, `kitError`). |
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
| `context.ts`, `prepared.ts`, `logs.ts`, `encoding.ts` | The shared parts' wiring, the prepared-call composer, the raw-log format and the doubles' byte arithmetic. |

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

`chain.land(prepared)` applies a prepared call or batch the doubles made, as if the integrator sent it: arming, disarming, commit, clear, start, the three cancels and the execute. It ignores the simulation, as a chain would. A call the doubles did not prepare changes nothing.

## The scripted chain record

Every state change goes through a member of `ScriptedChain`, and each member appends the event the contract emits in a freshly mined block. The interactor, the read seam and the event manager therefore always agree.

| State (D-371, D-373) | How to set it | What reads back |
| --- | --- | --- |
| setup none | the default, or `clearSetup()` | `stateOf().setupCommitment` is zero; `SetupCleared` after a clear |
| setup committed, private | `commitSetup({ level: 'private', configuration, password })` | public field `0x`, private field sealed; `SetupCommitted`; `stateOf` agrees |
| setup committed, shape-visible | `commitSetup({ level: 'shape-visible', configuration, password })` | public field holds the shape, private field sealed |
| setup committed, public | `commitSetup({ level: 'public', configuration })` | both fields clear, no password |
| attempt none | the default | `attempt.state === 'None'` |
| attempt pending | `openAttempt()` | `Waiting`, `consumableAfter` after the head; `AttemptStarted` |
| attempt ready | `openAttempt({ ready: true })`, or `advance(seconds)` past the wait | `Waiting`, `consumableAfter` at or before the head |
| cancelled by the account | `cancelAttempt('account')` | `Cancelled`; `AttemptCancelled` with `cancelledBy: 'cancelByOwner'` |
| cancelled by a caller with proofs | `cancelAttempt('proofs', { caller?, usedPlaces? })` | `cancelledBy: 'cancelByProofs'` |
| cancelled by nobody | `cancelAttempt('nobody', { vetoingMethod })` for a security stop's veto, or `cancelAttempt('nobody')` for a setup write | `cancelByVeto` with the vetoing method, or `setupWrite` with a zero canceller |
| executed | `executeAttempt()` | `Consumed`; `AttemptConsumed` |
| authorization held or removed | `setAuthorized(boolean)` | `isAuthorized()`; `LogPrivilegeChanged` on the kit slot |
| code present or absent | `setHasCode(boolean)` | `supportsAccount()` answers false with no code; the seam's `fitCheck` judges the code-to-be |
| one declaration per method | `declareMethod(module, { moduleInfo, paused, trustedParties })`, `setPaused`, `updateTrustedKeys`, `forgetMethod` | the three module views; `Paused`, `Unpaused`, `TrustedKeysUpdated` |
| manager views | `chain.manager` (`name`, `version`, `supportsInterface`, `domain`) | `stateOf`, `setupCommittedAtBlock`, `eip712Domain` |
| action views | `setSupportsAccount`, `setAuthorities`, `setOtherPrivileged`, `chain.actionInfo` | `supportsAccount`, `isAuthority`, `holdsAnyPrivilege`, `actionInfo` |

`chain.attemptStatus()` returns the D-371 status (`none`, `pending`, `ready`, `cancelled`, `executed`). Ready is the wallet's own computation, `consumableAfter` against the head's timestamp; the doubles expose it for tests. `advance(seconds, blocks?)` moves chain time. A commit over a waiting attempt cancels it as a setup write, as D-103 does.

## Failure and refusal scripting

Every script stands until cleared with `restoreRead`, `allow`, `clearSimulation` or `clearScripts()`.

- **A read fails**: `chain.failRead(read, { module?, error? })`. The read throws a `ScriptedReadFailure` (`kind: 'scripted-read-failure'`, `read`), or the given error. A failed read is a thrown value, never an empty answer. `read` is one of `SCRIPTED_READS`, named part and member, such as `'manager.stateOf'`, `'action.isAuthorized'`, `'provider.block'`, `'events.fetch'` or `'walletReads.removedKey'`.
- **A module read goes unanswered**: `chain.leaveUnanswered('manager.paused' | 'manager.moduleInfo' | 'manager.trustedParties', module?)`. The read answers `{ answered: false }`, the SDK's own shape for a provider that failed (sdk.md D-202).
- **A member refuses**: `chain.refuse(member, refusal)`, with `member` from `SCRIPTED_REFUSALS`, such as `'setup.prepareCommitSetup'` or `'recovery.complete'`. The refusal is `{ kind: 'validation', findings }` (throws a `ValidationRefusal` carrying the findings), `{ kind: 'restore', cause }` (throws a `RestoreRefusal`) or `{ kind: 'error', message? }` (throws an ordinary error).
- **A simulation fails**: `chain.failSimulation(member, kitError('ProofRejected', { place, method }))`. The prepare returns its record with `simulation: { ok: false, from, error }`.
- **The typed results**: `chain.replyFailure = cause` (every `replyFrom` returns `{ kind: 'reply-failure', cause }`), `chain.enrollFailure = cause` (every `configFrom`), `chain.verdict = 'satisfied' | 'rejected' | 'not-judged'` (every verify), `chain.addRefusal = reason` (every `addApproverReply` returns that reason with the gathering unchanged), `chain.unmetBindings.add(binding)` (`signingInput` throws for that device binding).

Beside the scripts the doubles refuse on their own where the chapter refuses: validation errors throw from `prepareCommitSetup` and the submission prepares, the restore throws its three causes, `addApproverReply` runs its five refusals (`version-unread`, `binding-mismatch`, `place-unknown`, `credential-mismatch`, `digest-mismatch`), and the simulations report `ProofRejected`, `MethodStopped`, `NoActiveAttempt`, `MethodNotUsed`, `AttemptIgnoresPause`, `MethodNotStopped`, `NotConsumable` and `MethodVetoedSpend`.

## The proof convention

The doubles run no real cryptography. A proof satisfies a credential exactly when it equals `doubleProof(config, digest)`. Each method double's `satisfyingMaterial(request)` builds the material a willing approver's device returns; the Aadhaar double needs the QR data it was enrolled with. The digests, the setup body, the commitment and the backup are the doubles' own bytes (keccak256 over canonical JSON), not the formats of sdk.md D-204. Only the handover payload is the real layout.

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

Each member throws when its read fails (`walletReads.verifyReply`, `walletReads.removedKey`, `walletReads.fitCheck`).

## Where the doubles differ from `sdk-interfaces/`

- `RecoveryState.removedKey` is `Address | 'no-creation-triple'`. It has no value for a creation record whose replay names no key or several. The recovery client double answers `'no-creation-triple'` there, and the seam's `removedKey()` names the cause.
- `PreparedCall` has no field for a warning, so the `payment.open-payee` warning the execute prepare raises (sdk.md D-202) is not carried.
- `ReadResult<TrustedParties>` cannot tell a module with no declaration from a provider that failed; both are `{ answered: false }`. The double answers that for an undeclared module, and `validateSetup` raises `method.no-declaration` only for a module the chain does not declare.
- `ClientConfiguration` has no version-escape option (sdk.md D-208) and no moment-skew span (D-207). The builder double never escapes; `MOMENT_SKEW_SPAN` is the doubles' own 15 minutes.
- The value shapes of `SetupDescription` are `unknown` in the interfaces; the double's shapes are its own and a screen must not rely on them.
