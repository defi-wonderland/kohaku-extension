# shared/client

- PT-038 The client, the provider and the signer

The layer of `design/ux-interfaces.md` D-370 between the extension and the SDK. Every chain read and every prepared call of the extension passes through it. Screens import `@web/modules/social-recovery/shared/client` and never `sdk-doubles/`; this folder is the only one outside `sdk-doubles/` that imports the doubles (ESLint enforces it), so the swap to the real SDK touches this folder alone.

Two files are imported by path and stay out of `index.ts`. The React hook, `shared/client/useRecoveryClient`, stays out so the rest of the lane loads in a Node test without the UI's contexts. The stand-in, `shared/client/stand-in`, stays out so no screen reaches the scripted chain through the lane; tests and development code import it by path.

## What is here

| File | What it holds |
| --- | --- |
| `chains.ts` | The two recovery chains of D-208 (`sepolia`, `mainnet`), their chain ids, and `WALLET_RECOVERY_CHAIN`, the one chain this build reads as a fixed label with no switch (ux.md D-312). |
| `addresses.ts` | The address book type and the cut-q-7 placeholder addresses of both deployments. |
| `audited-actions.ts` | The extension's own table of the kit's audited actions and their publishers, the one source of the action a screen offers or names, and `publisherKeyOf`. |
| `descriptors.ts` | The two deployment descriptors of D-208 as data, and `descriptorOf(chain, addressBook)`. |
| `configuration.ts` | `RecoveryClientConfiguration` and `clientConfigurationOf`, the SDK client configuration it derives. |
| `provider-adapter.ts` | `createProviderAdapter(rpc)`, the SDK's `IProvider` over the extension's provider, and its two thrown values. |
| `chain-reads.ts` | `createChainReads(rpc)`: the native balance, the gas estimate and the gas price beside the adapter, for the gas step (PT-039). |
| `extension-provider.ts` | `networkOf` and `extensionProviderFor`, the extension's provider built through `getRpcProvider`. |
| `build-client.ts` | `buildRecoveryClient(config)`, the construction checks in D-208's order, and `DigestVersionRefusal`. |
| `wallet-reads.ts` | `WalletReads`, the cut-q-22 seam of PT-035 under the lane's own name. |
| `signer.ts`, `signer-port.ts` | The signer facade over the request queue, and the UI's own port to that queue. |
| `sending.ts` | `SPONSOR_RAIL` (none) and `sendingKeyOf`, the key that sends a prepared call. |
| `stand-in.ts` | `sdkStandIn`, the scripted chain records the doubles serve until the SDK lands. Imported by path. |
| `useRecoveryClient.ts` | The one hook: the client for an account over the extension's provider, with its states. Imported by path. |

## The configuration and the client

```ts
const rpc = extensionProviderFor(networkOf(networks, WALLET_RECOVERY_CHAIN)!)
const client = await buildRecoveryClient({
  chain: WALLET_RECOVERY_CHAIN,                 // one chain, a fixed label (D-312)
  account,                                      // the account the client binds
  addressBook: addressBookOf(WALLET_RECOVERY_CHAIN), // manager, methods, action (cut-q-7 placeholders)
  provider: createProviderAdapter(rpc),         // IProvider over the extension's own provider
  creation, accountImplementation, candidateKeys // where the wallet has them (D-208)
})
client.setup      // ISetupClient
client.recovery   // IRecoveryClient
client.action     // IRecoveryActionInteractor only
client.moduleReads // IMethodModuleReads only
client.approving  // IMethodsOrchestrator (reads no chain)
client.walletReads // the cut-q-22 reads: verifyReply, removedKey, fitCheck
```

The configuration has no field for a signer, a storage or a sponsor rail. The builder receives the adapter, `descriptorOf(chain, addressBook)`, the account, `clientConfigurationOf(config)` and the four shipped method implementations, and nothing else of the extension. The descriptor keeps the shipped audited sets whatever the address book says, so an address book naming another action gets the unaudited warning rather than silencing it (D-208).

`clientConfigurationOf` takes D-208's shipped numbers from the SDK's exported defaults (today the doubles'), sets the request window to the wallet's own 24 hours (`REQUEST_WINDOW_SECONDS`, D-373), leaves the token allowlist empty (the first release names no payment order, D-312) and adds the account facts the wallet gives.

## The construction checks and the digest version

Before anything is built, `buildRecoveryClient` runs D-208's construction checks 2 to 5 in D-208's order:

1. Check 2: the provider's `chainId()` against the descriptor's chain id. A disagreement throws the builder's `ConstructionRefusal` with `check: 'chain-id'`.
2. Check 3: the domain the manager publishes through `eip712Domain()`, its chain id and its verifying contract against the descriptor. A disagreement throws `check: 'domain'`, so a manager on another chain reads as a construction refusal.
3. Check 4: the domain's `fields` bitmap against `0x0f` (`MANAGER_DOMAIN_FIELDS`). A disagreement throws `check: 'domain-fields'`.
4. Check 5: the domain's version against the descriptor's `digestVersion` and its name against `PolicyManager`. A disagreement throws a `DigestVersionRefusal` (`name: 'DigestVersionRefusal'`, `state: 'update-the-wallet'`, `carried`, `published`).

Every refusal comes before the builder's first build, so no client exists and no prepare can run. The account step draws the `DigestVersionRefusal` as the update the wallet state (ux.md D-306, D-319); `isDigestVersionRefusal` tells it apart. The builder runs the same checks at construction, and its digest-version refusal comes back as the same `DigestVersionRefusal`. Every other failure propagates as thrown: a read that failed, or a later construction refusal of the builder.

Until the SDK lands, the domain is read from the stand-in's manager part (`PolicyManagerDouble`), the same instance the builder is handed. With the SDK, the SDK's own construction check makes that read through the provider.

## The provider adapter and the chain reads

`ExtensionRpc` is the one member this lane calls on the extension's provider, `send(method, params)`. Every provider `getRpcProvider` builds answers it: ethers' `JsonRpcProvider`, Ambire's `BrowserProvider` over the Helios light client and `ColibriRpcProvider` with its prover, so a read may route through a light client and its prover (D-370).

`createProviderAdapter(rpc)` answers D-208's four reads, one request each:

| Read | Request |
| --- | --- |
| `chainId()` | `eth_chainId`, `[]` |
| `call(to, data, from, block)` | `eth_call`, `[{ to, data }, blockTag]`, with `from` in the object where given |
| `logs(filterSpec, range)` | `eth_getLogs`, `[{ address: addresses, topics, fromBlock, toBlock }]` |
| `block(tag)` | `eth_getBlockByNumber`, `[blockTag, false]` |

A block tag is `latest`, `finalized` or a number sent as a quantity. A reverted call rejects with a `RevertedCall` carrying the raw revert data (`0x` for a revert with none), found on ethers' `CALL_EXCEPTION` or on the node's own error. A read the provider could not make, or an answer that is not the shape asked for (a missing block among them), rejects with a `ProviderReadFailure` naming the read. No read answers empty (D-209).

`createChainReads(rpc)` runs beside it on the same provider, since the SDK's provider answers no balance and the SDK estimates nothing (D-373): `nativeBalance(address, block?)` (`eth_getBalance`), `estimateGas(call)` (`eth_estimateGas`, a revert rejects as a `RevertedCall`) and `gasPrice()` (`eth_gasPrice`). `gasCallOf(prepared, from)` turns a prepared call anyone may send (the submission or the execution) into the call to estimate, and refuses a call the account sends, which the account library estimates.

## The audited-actions table

`AUDITED_ACTIONS` holds one row per audited action per chain: `{ kind: 'audited', chain, action, publisher }`. `auditedActionsOn(chain)` is the only list a screen offers (D-319). `auditedActionOf(address, chain?)` answers the row or `UNKNOWN_ACTION` (`{ kind: 'unknown-action' }`), the lane's explicit value for an address the table does not hold. The descriptors' `auditedActions` sets are read from the table.

A publisher is a slug (`ethereumFoundation`), never copy. `publisherKeyOf(row)` answers the en.json key of its name, `socialRecovery.display.publishers.<slug>`, and a screen renders it with `t(publisherKeyOf(row))`. The lane holds no English name.

## The signer facade

`createSignerFacade(port, { chainId })` returns a frozen object with two members and nothing else, so no key, seed or export reaches a screen through it:

- `signTypedData(key, typedData)`: an EIP-712 signature. `types.EIP712Domain` is derived from the domain where the caller leaves it out.
- `signBytes(key, bytes)`: an EIP-191 personal-message signature over the bytes.

`key` is the keystore's own handle, `{ addr, type }`. `signRequestPort(dispatch, () => accounts, windowId)` wires the UI's own port: the dispatch and window id of `useBackgroundService`, the `signMessage` and `requests` states the background pushes over the event bus, and the accounts of `useAccountsControllerState`.

### The route: the request queue

ux.md D-316 says every signing request lands in the action window through the request queue. The facade therefore routes each signature through that queue as a request of its own, the same way the wallet's other own requests enter it (the settings screens add their own `calls` requests with `new Session({ windowId })`):

1. The facade dispatches `REQUESTS_CONTROLLER_ADD_USER_REQUEST` with a `SignUserRequest` (`signRequestOf`): a numeric id of its own, an internal session (`new Session({ windowId })`, origin `internal`, no dApp), `meta: { isSignAction: true, accountAddr: key.addr, chainId }`, the `typedMessage` or `message` content, and `allowAccountSwitch: true`.
2. The queue accepts a wallet-originated `typedMessage` or `message` request with no dApp session. It files the request as a `signMessage` action under the request's own id and opens the action window on it.
3. The action window's own sign-message screen initialises `SignMessageController` with the request's id as `fromActionId` and signs only when the holder confirms. The facade dispatches nothing to that controller.
4. The facade takes the signature from the pushed `signMessage` state whose `signedMessage.fromActionId` is its request's id. The background pushes that state before it removes the request from the queue.
5. The request leaving the queue (`requests.userRequests` and `userRequestsWaitingAccountSwitch`) with no such signature for 3 seconds (`ABSENCE_GRACE_MS`) counts as refused: the holder rejected it or closed the window. The grace covers the moment the queue moves a request between its two lists after an account switch.
6. With no answer in 10 minutes (`DEFAULT_SIGN_TIMEOUT_MS`), the facade withdraws its request with `REQUESTS_CONTROLLER_REMOVE_USER_REQUEST` and rejects.

### The confirmation the holder sees

- Where the wallet's selected account is not the key's account, the queue first shows its switch-account request. The holder switches the selected account to that account, and the sign request follows. Declining the switch refuses the signature.
- The action window's "Sign message" screen, with the account and the network (the recovery chain) in its header.
- The requester line reads "The App is requesting your signature", since the internal session has no name. The lane ships no string and names no requester.
- The type, "EIP-712 Type" or "Standard Type", then the message: typed data with its verifying contract under "Will verify this signature", or the bytes. A message the wallet cannot humanise shows raw, with "Please read the whole message as we are unable to translate it!".
- The "Sign" and "Reject" buttons. Where the keystore holds the address under more than one key type, the screen asks the holder which one signs. A Ledger key asks for its device first.

### What the facade can and cannot sign, for the owner's decision

The owner decides on the missing background action and on the D-316 question below. These are the facts they rest on.

1. The facade signs with no dApp request. Each signature is a request of its own in the queue, bound to its own id and confirmed by the holder in the action window.
2. It can sign when the key is itself a basic account the wallet lists: an EOA account whose associated key is its own address. The queue signs for the request's account with that account's keys, so the signature is the key's own EIP-712 signature (`signTypedData` of the keystore signer), or its EIP-191 signature over the bytes (`signMessage`).
3. It cannot sign for any other key the keystore holds, such as the smart account's controlling key at the slot's index plus 100000 (ux.md D-316). The queue looks the account up among the accounts and wraps a smart account's signature in Ambire's envelope. The facade refuses such a key before it dispatches anything, with a `SignerNotWired` error (`member`, `key`, `missingAction: 'KEYSTORE_CONTROLLER_SIGN_WITH_KEY'`).
4. It cannot sign a bare digest. The queue has no request that signs without the EIP-191 prefix.
5. The missing action is `KEYSTORE_CONTROLLER_SIGN_WITH_KEY`, with params `{ requestId, keyAddr, keyType, content }`, where `content` is a `PlainTextMessage` or a `TypedMessage`. Its handler takes `KeystoreController.getSigner(keyAddr, keyType)` and runs `signer.init` with the external signer controller of that type. It answers `signMessage(content.message)` or `signTypedData(content)`, with no account lookup and no Ambire envelope. It sends the signature or the error back to the UI under the request id, as `PROVIDER_RPC_REQUEST` does. Under D-316 it too would land in the action window for the holder's confirmation. The shape is also written on `MISSING_BACKGROUND_ACTION` in `signer.ts`. It does not exist, and this lane adds no background action.
6. There is no race with a dApp request any more. The facade dispatches no `MAIN_CONTROLLER_SIGN_MESSAGE_INIT`, `MAIN_CONTROLLER_HANDLE_SIGN_MESSAGE` or `MAIN_CONTROLLER_SIGN_MESSAGE_RESET`. The action window's own screen initialises the controller with the request it shows, and the holder confirms that request alone. The facade accepts only a signature whose `fromActionId` is its own request's id. The earlier route dispatched INIT and HANDLE itself; HANDLE names no message, so a dApp request re-initialised by an open sign-message screen could be signed with the facade's key and resolved to the dApp unseen. That route is removed.
7. The queue shows one sign-message request at a time. A request added while another one is visible is dropped without a trace in the pushed state, and the facade waits until its timeout. The queue also skips a request while a hardware signing is in progress, with the same outcome.
8. The side effects: the background records each signature in the activity's signed messages of that account and raises its "message signed" notification. An account switch, where the holder confirms one, changes the wallet's selected account.
9. The result has no channel of its own. The queue resolves a request's result into the dApp promise it carries, and a request the UI adds carries none. The facade therefore reads the signature from the pushed `signMessage` state, keyed by its request id.
10. A queued request that returns no signature rejects with a `SignFlowFailure`: `refused` (the request left the queue unsigned), `timeout` (the facade withdrew it) or `malformed-signature`.

## Which key sends

`SPONSOR_RAIL` is `'none'`: the first release configures no rail (D-312), so every prepared call is sent from a key the signer holds. `sendingKeyOf(prepared, { accountKey, recovererKey }, recoveryCall?)` names it:

- A call whose sender is the account is sent by the account's controlling key.
- A batch is sent by the account's controlling key, and only a batch whose every call's sender is the account. Any other batch is refused.
- A call anyone may send is sent by the recoverer's own key only where the caller names it as one of the two recovery calls, `'submission'` or `'execution'` (`RECOVERY_CALLS`, D-373). The cancel by proofs is not a recovery call: whoever submits it pays for it and it ships in a later milestone (D-373), so it is refused.

## The hook

`useRecoveryClient(account, facts?)` builds the client for the account over the extension's provider for `WALLET_RECOVERY_CHAIN`, read from `useNetworksControllerState`, and destroys that provider on change or unmount. It returns one of `{ status: 'loading' }`, `{ status: 'ready', client, reads }` (the balance and gas reads on the same provider), `{ status: 'update-the-wallet', refusal }` and `{ status: 'failed', error }`, with `retry()`.

## The stand-in

Until the SDK lands, `buildRecoveryClient` builds through `RecoveryKitBuilderDouble` over `sdkStandIn.chainFor(descriptor, account)`, one scripted chain record per deployment and account for the life of the page. Tests and development code import `shared/client/stand-in` by path and script that world through it; `sdkStandIn.providerFor(chain)` gives an `IProvider` answered from it, and `sdkStandIn.reset()` forgets every record. When the SDK lands, `stand-in.ts` goes and `build-client.ts` builds through the SDK's builder.

The block pins and log reads of the doubles go through the configured provider, while the manager, action and method state comes from the scripted record. A client built over a real node therefore reads the record's state at the node's blocks; a coherent development world passes `sdkStandIn.providerFor(chain)` as the provider.

## Open questions for the owner

1. cut-q-7: the addresses of the manager, methods and action on the test network. Every address in `addresses.ts` is a placeholder until it is answered.
2. The missing background action `KEYSTORE_CONTROLLER_SIGN_WITH_KEY` for a key that is not itself a listed basic account, and for a bare digest (the facts are in the signer section above).
3. The D-316 conflict: ux.md D-316 puts every signing request in the action window, so every facade signature now asks the holder to confirm in that window. Are the new key's certification (ux-interfaces.md D-373) and the access tests of the method rows exempt from the action window? If they are, the signing needs a background path the owner rules on; if they are not, the confirmation above stands for them too.
4. The queue's gaps for a wallet-originated sign request: no result channel of its own (item 9), a silent drop while another sign-message request is visible (item 7), and the requester line "The App is requesting your signature" for a request no dApp made.
