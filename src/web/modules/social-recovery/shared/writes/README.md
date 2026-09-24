# shared/writes

- PT-039 The shared write states and the gas step

The submitting and failed states every write of the chapter shares, and the gas check with its deposit step (`docs/social-recovery/design/ux.md` D-303, D-307, D-312, D-319, D-393; `ux-interfaces.md` D-373). Every owner-signed write and both recovery calls render these states and draw none of their own: the setup save, the edit, any other setup write, the owner's cancel, the submission and the execution.

Screens import `@web/modules/social-recovery/shared/writes` for the pure module and `@web/modules/social-recovery/shared/writes/components` for the two views. `index.ts` does not export the views, so the pure module loads in a Node test without the UI. The lane reaches the SDK only through `shared/client` (PT-038) and renders values and chips only through `shared/display` (PT-036).

## Files

| File | What it holds |
| --- | --- |
| `kinds.ts` | `WRITE_KINDS` (`save`, `edit`, `ownerWrite`, `cancel`, `submission`, `execution`), who pays each (`payerOf`), and `assertWriteDoor`, which refuses a prepared write whose sender does not match its kind. |
| `states.ts` | The state types, `WRITE_STATUSES`, `FAILED_STATUSES`, `canRetry` and `offersMoveFunds`. |
| `classify.ts` | Receipts and failures (`receiptOf`, `writeFailureOf`), the causes of a revert (`revertCauseOf`), `classifyFailure` and `settleReceipt`. |
| `machine.ts` | `writeReducer`, the one pure reducer over the states, its events and `initialWriteState`. |
| `gas.ts` | `checkGas`, the deposit step's data (`DepositStep`, `DepositRoute`) and the estimate (`gasEstimateOf`, `FEE_HEADROOM_PERCENT`). |
| `copy.ts` | The en.json keys the lane reads (`WRITES_KEYS`, `GAS_KEYS`, `REVERTED_KEYS`, `causeKey`, `cancelGoneRoadKey`), `renderWriteState` and `renderDepositStep`. |
| `components/` | `WriteStateView` and `DepositStepView`, which lay out what the two renderers answer. |

## The states

| Status | Meaning |
| --- | --- |
| `idle` | Nothing asked yet. |
| `checkingGas` | The gas check runs. |
| `needsDeposit` | The sending key holds too little; carries the `DepositStep`. |
| `submitting` | The one submitting state; carries the transaction hash once the wallet broadcast the call. |
| `landed` | A receipt with status one. |
| `failedNotSent` | The first reading of the failed state: nothing reached the chain and the account stands as it did. |
| `failedReverted` | The second reading: the call reached the chain and reverted, with the cause the receipt carries and its gas gone. |

`FailedState` is `FailedNotSentState | FailedRevertedState`: one failed state type whose two readings are two states, never one state with a flag. A holder who reads that the wallet sent nothing retries a call that cannot land (D-319).

```
idle ──start──▶ checkingGas ──gasChecked(enough)──▶ submitting ──sent──▶ submitting(hash)
                     │  ▲                                  │
  gasChecked(deposit)│  │recheck                  receipt / error
                     ▼  │                                  ▼
                needsDeposit                 landed | failedNotSent | failedReverted
```

`start` from a failed state that offers the retry runs the gas check again, at that moment's fee. An event a state does not take leaves the state as it was, the same object, so a late answer of an earlier run never moves the screen. `attemptRead` fills the controller of a reverted cancel once the attempt read returns.

## The classification

`classifyFailure(failure, { write, attemptAfter })` decides by whether a transaction hash exists and whether a receipt with status zero came back:

- A receipt with status zero reads `failedReverted`, with `gasSpent` where the receipt carries `gasUsed` and `effectiveGasPrice`.
- No receipt and no hash reads `failedNotSent`: a refused signature, a gas estimate that would revert, a read or a broadcast that failed.
- A hash with no receipt is neither reading. The call may still land, so the answer is the submitting state with that hash, which keeps waiting for its receipt.
- A receipt with status one is no failure: `settleReceipt` reads it as `landed`, and `classifyFailure` throws a TypeError for one.

`writeFailureOf(thrown)` finds a receipt (ethers' `CALL_EXCEPTION` from `wait()`) or a hash (`transactionHash`, `hash`, `transaction.hash`) on a thrown value. The reducer's `error` event runs it, so an error that carries its reverted receipt settles as a revert.

The cause of a revert (`RevertCause`):

- `named`: a kit error of sdk.md D-205 the wallet decoded, passed in as `cause`. The wallet names it in its own words, never the SDK's (D-373).
- `unnamed`: a revert with no cause the wallet can name.
- `attemptGone`: the owner's cancel reverted (D-307). The cancel names no id and reverts only when nothing is left to cancel, so every reverted cancel reads that the attempt was already gone, unless the decoded cause names a kit error other than `NoActiveAttempt`. `attemptAfter` (`{ ended, controller }`) comes from the attempt read after the revert. After an execution the state names the account's controller as it now stands and offers the cancel's move-funds action. After another road (`cancelByOwner`, `cancelByProofs`, `cancelByVeto`, `setupWrite`) it names that road, with control unchanged and no move-funds action. Until the read returns it names no controller rather than one it guessed. It never offers the retry.

## The gas check

`checkGas({ write, prepared, key, reads, network, transaction?, operates?, fastTrack?, feeHeadroomPercent? })`:

1. `assertWriteDoor`: an owner write is a call whose sender is the account, or a batch; a recovery call is a call anyone may send.
2. The transaction to estimate (`gasTransactionOf`): a call anyone may send as it stands, from the key, through `gasCallOf` of shared/client. A write the account sends rides the account's own execute, so the caller passes `transaction`, the transaction the key sends, built through the account library (with the deployment prepended for an account with no code yet, D-319); it must come from the key.
3. Three reads through the extension's provider (`createChainReads` of shared/client), one request each: the estimate of that transaction, the gas price and the key's balance. A read that fails rejects as it failed; the reducer reads it as `failedNotSent`.
4. `required` is the estimate times the gas price plus `FEE_HEADROOM_PERCENT` (20). A balance at or above it answers `{ kind: 'enough' }` and the step is skipped. Otherwise it answers `{ kind: 'deposit', step }`.

The step carries the key's address, the estimate, the balance, the shortfall, the network name and symbol, and the routes. The amount on each route is the shortfall rounded up to six decimals, so a holder who sends what the step shows covers it. Off the fast track, `operates` (the account this wallet holds that the key operates) is required and the step offers both routes, the transfer from it and the deposit from outside. On the fast track the key operates no account yet, so the step offers the deposit from outside alone (D-393: on the logged-in route the step offers both routes). The step links to no service that hands out test-network funds (D-312, the owner's ruling of 2026-09-22), and the first release configures no sponsor.

## The copy

`renderWriteState(state, t?)` and `renderDepositStep(step, { balance? }, t?)` answer every string the two views show, from `socialRecovery.writes` in en.json.

| State | Reads |
| --- | --- |
| `submitting` | the in-progress chip, `submittingRecovery` for a submission and `submitting` for any other write, `submittingBody` |
| `failedNotSent` | `notSent`, the retry |
| `failedReverted` | the write's own reverted sentence (`REVERTED_KEYS`) with the cause sentence (`causes.<KitErrorName>` or `causes.unnamed`) as `{{cause}}`, the retry |
| `failedReverted`, gone attempt | `cancelRevertedTitle`, `cancelReverted`, then `nowControlledBy` and the controller in full after an execution, or the road's sentence after another road |

| Deposit step | Reads |
| --- | --- |
| Owner write | `notEnoughGas` over a save, `notEnoughGasAccountKey`, the write's shortfall (`shortfallSave`, `shortfall`, `shortfallCancel`), the key in full with `copy`, `transferRoute` with `transferRouteNote`, `outsideRoute`, `transferIsAnOperation`, `networkOwner` |
| Recovery call, fast track | `fundTitle`, `sendingKeyPays`, `sendingKey`, the key in full with `copy`, `submissionAmount` (`executionAmount` at execution due), `secondFunding`, `network`, `balanceWaiting`, `continuesOnItsOwn`, `alreadyFunded`, `continueUnlocks` |
| Recovery call, logged in | `fundTitle`, `accountHoldsFunds`, `keyOf`, the key in full with `copy`, both routes, `transferIsAnOperation`, `secondFunding`, `network`, the waiting lines |

Each step also answers a `blocker`, the short panel a write's own screen shows when the check at sending comes up short: `notEnoughGasSendingKey` with `shortfallSubmit` (`shortfallExecute` at execution due), or the owner write's title and shortfall. No string promises that one funding covers both the submission and the execution.

## The views

- `WriteStateView({ state, title?, note?, onRetry?, children? })` renders the submitting and failed states, a spinner while the gas check runs, and nothing for the other states. `title` and `note` are the write's own strings, from its own keys. The retry renders where the state offers it and `onRetry` is given. The write's own actions go in as children, the cancel's move-funds action among them where `offersMoveFunds(state)` answers true.
- `DepositStepView({ step, balance?, variant?, onCopy?, children? })` renders the step, or with `variant="blocker"` the short panel that leads to it. `balance` is the latest balance the write's screen polled. `onCopy` defaults to the clipboard. The write's own actions (continue, back, fund the key) go in as children, and the continue line renders under them.

Both use the existing components of `src/common/components` over react-native-web.

## The reverted sentence of each write

`REVERTED_KEYS` picks the reverted reading by the write kind, from each write's own frame. Every one carries the cause as `{{cause}}`.

| Write | Key | Frame |
| --- | --- | --- |
| `save` | `revertedSave` | C-07 |
| `edit` | `revertedEdit` | G-05b |
| `submission` | `revertedSubmit` | D-11 |
| `execution` | `revertedExecute` | D-13 |
| `ownerWrite` | `reverted` | none of its own |
| `cancel` | `reverted`, only where the decoded cause names a kit error other than `NoActiveAttempt`; every other reverted cancel reads the gone attempt | D2-01 |

Every string the lane shows comes from `socialRecovery.writes` and the chip and value keys of shared/display. The lane adds no key to en.json.

## Open points

- The send path is not built: the signer facade of PT-038 signs messages only, and no background action sends a transaction from a key. The classifier therefore reads receipts and thrown values in the shapes ethers and a node give, and a consumer reports its own hash with the `sent` event.
- The decoded cause of a revert comes from the consumer, which replays the call and decodes it through the SDK. The SDK surface of this repository declares the decoded shape (`KitError`) but no decoder member.
- `FEE_HEADROOM_PERCENT` and the six-decimal rounding are the extension's own estimation choices; no chapter sentence fixes them.
