# shared/client

- PT-038 The client, the provider and the signer

The layer of `design/ux-interfaces.md` D-370 between the extension and the SDK. Every chain read and every prepared call of the extension passes through it. Screens import `@web/modules/social-recovery/shared/client` and never `sdk-doubles/`; this folder is the only one outside `sdk-doubles/` that imports the doubles (ESLint enforces it), so the swap to the real SDK touches this folder alone.

The React hook is in its own file, `shared/client/useRecoveryClient`, imported by path. `index.ts` does not export it, so the rest of the lane loads in a Node test without the UI's contexts.

## What is here

| File | What it holds |
| --- | --- |
| `chains.ts` | The two recovery chains of D-208 (`sepolia`, `mainnet`), their chain ids, and `WALLET_RECOVERY_CHAIN`, the one chain this build reads as a fixed label with no switch (ux.md D-312). |
| `addresses.ts` | The address book type and the cut-q-7 placeholder addresses of both deployments. |
| `audited-actions.ts` | The extension's own table of the kit's audited actions and their publishers, the one source of the action a screen offers or names. |
| `descriptors.ts` | The two deployment descriptors of D-208 as data, and `descriptorOf(chain, addressBook)`. |
| `configuration.ts` | `RecoveryClientConfiguration` and `clientConfigurationOf`, the SDK client configuration it derives. |
| `provider-adapter.ts` | `createProviderAdapter(rpc)`, the SDK's `IProvider` over the extension's provider, and its two thrown values. |
| `chain-reads.ts` | `createChainReads(rpc)`: the native balance, the gas estimate and the gas price beside the adapter, for the gas step (PT-039). |
| `extension-provider.ts` | `networkOf` and `extensionProviderFor`, the extension's provider built through `getRpcProvider`. |
| `build-client.ts` | `buildRecoveryClient(config)`, the digest-version check and `DigestVersionRefusal`. |
| `wallet-reads.ts` | `WalletReads`, the cut-q-22 seam of PT-035 under the lane's own name. |
| `signer.ts`, `signer-port.ts` | The signer facade over the existing sign-message flow, and the UI's own port to that flow. |
| `sending.ts` | `SPONSOR_RAIL` (none) and `sendingKeyOf`, the key that sends a prepared call. |
| `stand-in.ts` | `sdkStandIn`, the scripted chain records the doubles serve until the SDK lands. |
| `useRecoveryClient.ts` | The one hook: the client for an account over the extension's provider, with its states. |

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

## The digest-version check

Before anything is built, `buildRecoveryClient` reads the domain the manager publishes through `eip712Domain()` and compares its version with the descriptor's `digestVersion` and its name with `PolicyManager` (D-208 construction check 5). A disagreement throws a `DigestVersionRefusal` (`name: 'DigestVersionRefusal'`, `state: 'update-the-wallet'`, `carried`, `published`) before the builder's first build, so no client exists and no prepare can run. The account step draws it as the update the wallet state (ux.md D-306, D-319); `isDigestVersionRefusal` tells it apart. The builder runs the same check at construction, and its refusal comes back as the same `DigestVersionRefusal`. Every other failure propagates as thrown: a read that failed, or a construction refusal of the builder about the chain id, the descriptor or the rest of the domain.

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

`createChainReads(rpc)` runs beside it on the same provider, since the SDK's provider answers no balance and the SDK estimates nothing (D-373): `nativeBalance(address, block?)` (`eth_getBalance`), `estimateGas(call)` (`eth_estimateGas`, a revert rejects as a `RevertedCall`) and `gasPrice()` (`eth_gasPrice`). `gasCallOf(prepared, from)` turns a prepared call anyone may send into the call to estimate, and refuses a call the account sends, which the account library estimates.

## The audited-actions table

`AUDITED_ACTIONS` holds one row per audited action per chain: `{ kind: 'audited', chain, action, publisher }`. `auditedActionsOn(chain)` is the only list a screen offers (D-319). `auditedActionOf(address, chain?)` answers the row or `UNKNOWN_ACTION` (`{ kind: 'unknown-action' }`), the lane's explicit value for an address the table does not hold. The descriptors' `auditedActions` sets are read from the table.

A publisher is a slug (`ethereumFoundation`), never copy. The frames read "published by the Ethereum Foundation", and no en.json key holds that name yet; the coordinator adds it.

## The signer facade

`createSignerFacade(port, { chainId })` returns a frozen object with two members and nothing else, so no key, seed or export reaches a screen through it:

- `signTypedData(key, typedData)`: an EIP-712 signature. `types.EIP712Domain` is derived from the domain where the caller leaves it out.
- `signBytes(key, bytes)`: an EIP-191 personal-message signature over the bytes.

`key` is the keystore's own handle, `{ addr, type }`. The keystore lives in the background, so the facade signs through the existing sign-message flow of `SignMessageController`: it dispatches `MAIN_CONTROLLER_SIGN_MESSAGE_INIT` with the key's address as the account, the chain and the content under a request id of its own, dispatches `MAIN_CONTROLLER_HANDLE_SIGN_MESSAGE` with `{ keyAddr, keyType }` once the pushed `signMessage` state shows that message, takes the signature from `signedMessage` for that request id and dispatches `MAIN_CONTROLLER_SIGN_MESSAGE_RESET`. `signMessageFlowPort(dispatch, () => accounts)` wires the UI's own dispatch, the event bus and the accounts the wallet lists.

What the flow can do, and so what the facade does:

- It signs for a key that is itself a basic account the wallet lists (an EOA account whose associated key is its own address). The signature is the key's own: `signTypedData` of the keystore signer, `signMessage` for the bytes.
- It cannot sign for any other key the keystore holds, such as the smart account's controlling key at the slot's index plus 100000 (ux.md D-316): the flow looks the address up among the accounts and wraps a smart account's signature in Ambire's envelope. The facade refuses such a key with a `SignerNotWired` error (`member`, `key`, `missingAction: 'KEYSTORE_CONTROLLER_SIGN_WITH_KEY'`) before dispatching anything. That background action does not exist; its shape is written on `MISSING_BACKGROUND_ACTION` in `signer.ts`, and adding it is the owner's call.
- It signs no bare digest: raw bytes always carry the EIP-191 prefix.
- A dispatched run that returns no signature rejects with a `SignFlowFailure`: `refused` (the flow's sign status went to error), `superseded` (another request took the controller over), `timeout` (5 minutes by default) or `malformed-signature`.

The flow has side effects the facade cannot turn off. The background records each signature in the activity's signed messages of that account and raises its "message signed" notification. A dApp sign request open in the action window at the same moment shares the one controller, and `MAIN_CONTROLLER_HANDLE_SIGN_MESSAGE` names no message: the facade dispatches it only after the state shows its own message, but a re-initialisation that lands between the two is signed with the facade's key, and the flow then verifies that signature against the other request's account. The missing background action above removes all three.

## Which key sends

`SPONSOR_RAIL` is `'none'`: the first release configures no rail (D-312), so every prepared call is sent from a key the signer holds. `sendingKeyOf(prepared, { accountKey, recovererKey })` names it: the account's controlling key for a call whose sender is the account and for every prepared batch, and the recoverer's own key for a call anyone may send.

## The hook

`useRecoveryClient(account, facts?)` builds the client for the account over the extension's provider for `WALLET_RECOVERY_CHAIN`, read from `useNetworksControllerState`, and destroys that provider on change or unmount. It returns one of `{ status: 'loading' }`, `{ status: 'ready', client, reads }` (the balance and gas reads on the same provider), `{ status: 'update-the-wallet', refusal }` and `{ status: 'failed', error }`, with `retry()`.

## The stand-in

Until the SDK lands, `buildRecoveryClient` builds through `RecoveryKitBuilderDouble` over `sdkStandIn.chainFor(descriptor, account)`, one scripted chain record per deployment and account for the life of the page. Tests and development runs script that world through it, `sdkStandIn.providerFor(chain)` gives an `IProvider` answered from it, and `sdkStandIn.reset()` forgets every record. When the SDK lands, `stand-in.ts` goes and `build-client.ts` builds through the SDK's builder.

The block pins and log reads of the doubles go through the configured provider, while the manager, action and method state comes from the scripted record. A client built over a real node therefore reads the record's state at the node's blocks; a coherent development world passes `sdkStandIn.providerFor(chain)` as the provider.

## Open questions

- cut-q-7: the addresses of the manager, methods and action on the test network. Every address in `addresses.ts` is a placeholder until it is answered.
- The missing background action `KEYSTORE_CONTROLLER_SIGN_WITH_KEY` for a key that is not itself a listed basic account (ux owner).
- The publisher's display name has no en.json key yet (coordinator).
