# Native MON contract integration

`NativeGameVault.sol` implements the current DOR PRIZE money flow on Monad Testnet (10143). It is a **new non-upgradeable contract**, not an upgrade of the USDC `GameVault` proxy. Import `@dorprize/contracts/native`. Existing root exports and USDC contracts remain for compatibility.

The operator determines game results. The contract checks access, room membership, accounting and lifecycle; `resultHash` does not prove fair gameplay. No native testnet deployment has been recorded yet. A native backend adapter is implemented and tested locally; see [backend integration and UI handoff](../backend/NATIVE_BACKEND.md). UI integration remains separate.

## Roles and accounting

| Role                 | Authority                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| Owner                | Rotate operator/signer, pause new activity, transfer ownership in two steps                      |
| Operator             | Create rooms, start with an expected roster hash, settle before expiry, cancel waiting rooms     |
| Backend signer       | Sign EIP-712 join tickets; may be an EOA or ERC-1271 signer                                      |
| Player               | Deposit native MON, join with their own ticket, leave a waiting room, withdraw available balance |
| Treasury (immutable) | Withdraw only fees credited by completed settlements                                             |
| Anyone               | Cancel expired waiting rooms; refund expired active rooms                                        |

All amounts use **18-decimal integer wei**. JSON transports use decimal strings; convert to `bigint` before contract calls. Never use float arithmetic or six-decimal USDC helpers for MON.

```text
vault.balance >= totalAvailableBalance + totalBidLocked + totalSkillReserved
                 + totalTreasuryClaimable + totalRoomDust
```

`lockedBalanceOf` returns the bid only; `skillReservedOf` is separate. Only available balance is withdrawable, even during a match. The owner/operator cannot sweep user funds or dust. Forced MON creates surplus, not a player deposit. Direct plain transfers revert; use `deposit()` with `value`.

## Lifecycle and integration API

| Function                                                                              | Inputs / rule                                                                                                 |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `deposit()` payable                                                                   | Native MON in `value`; no approve/ERC-20 token/faucet contract                                                |
| `withdraw(amountWei)`                                                                 | Caller receives their available balance; transfer failure reverts the debit                                   |
| `createRoom(roomId,bidWei,maxPlayers,joinDeadline)`                                   | Operator only; nonzero unused ID, bid >=1 MON, capacity 2–10, future deadline <=24 hours                      |
| `joinRoom(ticket,signature)`                                                          | Player sends; locks bid + approved skill budget, consumes nonce; max one live participation per wallet        |
| `leaveRoom(roomId)`                                                                   | Waiting only; releases bid and full budget; room ID/configuration are retained                                |
| `startRoom(roomId,expectedRosterHash)`                                                | Operator; >=2 players, before join deadline; freezes roster and sets expiry to start +15 minutes              |
| `settleRoom(roomId,recipients,amountsWei,skillFeesWei,expectedRosterHash,resultHash)` | Operator before expiry; nonzero persisted resultHash; validates exact equal payouts and per-player fee bounds |
| `cancelWaitingRoom(roomId)`                                                           | Operator immediately, anyone at/after join deadline; releases all reserves                                    |
| `refundExpiredRoom(roomId)`                                                           | Anyone at/after active expiry; releases all reserves with no skill charge                                     |
| `withdrawTreasury(amountWei)`                                                         | Only immutable treasury; pays only its settled fee balance                                                    |

`Waiting → Active → Settled` or `Waiting/Active → Cancelled`. Settled/Cancelled are terminal. Empty lobbies keep their ID; create a fresh internal match ID for every new escrow. Use `keccak256(toHex(internalMatchId))` consistently in frontend/backend; invitation codes are separate from permanent escrow IDs.

Read `getRoom(roomId).players` in its returned order. `nativeRosterHash(expectedPlayers)` hashes that **confirmed expected roster**. A join/leave mined before start changes the hash and makes start revert; reconcile players/readiness and retry deliberately. Do not blindly substitute a fresh chain hash for a stale backend roster.

Fee arrays are ordered by the frozen roster, not by winner order. Budget is fixed by each accepted ticket. Settlement rejects fees over budget or not in 0.01-MON increments; it never silently caps or takes from payout. Game-core/backend must still validate actual skill activations, prices and cooldowns.

Pausing stops deposit/create/join/start. It does not block available withdrawals, leave, settlement, cancellation or expiry refunds. At exact active expiry, settlement is rejected and refund is allowed.

## EIP-712 join ticket

Domain: `DorPrizeNativeGameVault`, version `1`, actual chain ID, actual vault address.

```text
JoinTicket(bytes32 roomId,address player,uint256 skillBudgetWei,uint256 nonce,uint64 deadline)
```

```ts
import { nativeJoinTypedData, nativeGameVaultAbi } from "@dorprize/contracts/native";

// Server: wallet must come from an authenticated session. Validate room access/config first.
const nonce = await publicClient.readContract({
  address: vaultAddress,
  abi: nativeGameVaultAbi,
  functionName: "nonces",
  args: [playerAddress],
});
const ticket = { roomId, player: playerAddress, skillBudgetWei, nonce, deadline };
const signature = await backendSigner.signTypedData(nativeJoinTypedData(vaultAddress, ticket));

// Frontend: verify ticket room/player/budget and approved network, simulate/estimate, then MetaMask signs.
const hash = await walletClient.writeContract({
  address: vaultAddress,
  abi: nativeGameVaultAbi,
  functionName: "joinRoom",
  args: [ticket, signature],
  account: playerAddress,
});
// Only add a confirmed player after a successful receipt + chain-state reconciliation.
```

Read a new nonce when issuing a ticket after leave/rejoin. Tickets bind the wallet, budget, room, nonce, chain and vault. Room config is immutable and IDs are not recycled. Concurrent issued tickets can race for a nonce or slot; failure must refresh rather than pretend join succeeded. Changing the backend signer invalidates its old outstanding signatures.

## Pot, fees and dust

- `pot = bidWei × confirmed roster length`.
- A single winner receives the entire pot, including sub-cent wei from custom bids.
- Ties: each payout is `floor(pot / winners / 0.01 MON) × 0.01 MON`. Recipients must be unique roster members. Every amount must equal the contract's computed payout.
- `dust = pot − sum(payouts)` is recorded per room and globally; it never goes to treasury. **Dust entitlement/claim policy is still unresolved. This version has no dust withdrawal function**, so adopting a distribution policy later requires a new contract/design decision.
- Skill fees are charged from the reserved budget into treasury, including for losing players. Unspent budget returns to available balance. Bid is already part of payout; never credit a second bid refund to winners.
- `nativeSkillPrice` applies half-up rounding of 15%/25%/25%/40% to 0.01 MON; `nativePayout` is the shared payout helper. Backend validates the full game result before persistence/settlement.

Persist result and settlement job atomically before broadcast. On timeout/restart, query receipt and `getRoom().status/resultHash` before retrying. A second settle/refund transaction reverts; caller recovery must recognize the existing terminal state. The player claim button asks the backend to submit its persisted result, not a result supplied by the browser. One settlement completes the whole room; a fallback worker must also settle when winners do not claim.

## Build and test

Install workspace dependencies with `npm ci`. Foundry >=1.8 is required for `--network monad`. From repo root:

```sh
npm run sc:build
npm run sc:abi
npm run test:monad -w @dorprize/contracts
npm run test:helpers -w @dorprize/contracts
npm run test:integration -w @dorprize/contracts
npm run typecheck
```

The integration test starts an ephemeral localhost Anvil with Monad execution rules and public development accounts. Put `anvil` and `forge` on PATH or set `ANVIL_BIN` / `FORGE_BIN` to their binaries. It checks viem/Solidity typed-data and roster hashes, deposit/join/start/settle/withdraw, treasury, confirmed deployment recording, and the actual Foundry deploy script on localhost. Local deployment records are ignored and excluded from generated production exports.

`forge test --network monad` includes legacy tests and stateful native invariants (128 runs ×64 calls). Do not use default Ethereum gas figures as Monad transaction estimates. Simulate the exact call, estimate on the intended network, and avoid oversized gas limits; native deposits are contract calls, not 21,000-gas plain transfers.

## Deployment preparation

See `.env.native.example` for required role addresses. No raw private key is needed by `DeployNative.s.sol`; the developer selects their keystore signer. Keep backend signer/operator secrets outside frontend bundles.

```sh
# Set MONAD_RPC_URL, DEPLOYER_ADDRESS, VAULT_OWNER, OPERATOR, BACKEND_SIGNER and TREASURY.
# Dry run first; pass your local Foundry keystore account name.
forge script script/DeployNative.s.sol --network monad --rpc-url monad_native_testnet --account dorprize-deployer
# Broadcast only after reviewing role addresses and the simulation.
npm run deploy:native:monad -- --account dorprize-deployer
```

Run the commands from `sc`. Only chain 10143 and local 31337 are accepted. There are no guessed deployment addresses. Deployment role addresses must be explicitly configured; treasury is immutable. After broadcast, verify deployed source using the MONSKILLS verification procedure and matching compiler/settings.

After a **finalized successful direct deployment receipt**, set `NATIVE_GAME_VAULT_ADDRESS` and `DEPLOYMENT_TX_HASH`, then run:

```sh
npm run deployment:record:native
npm run abi
```

The recorder checks chain ID, canonical finalized creation receipt/address, bytecode, ticket schema and readable role addresses, and writes `deployments/native/10143.json`. It also supplies the five public handoff details: contract address, chain ID, public RPC, `sc/out/NativeGameVault.sol/NativeGameVault.json` ABI path, and `https://testnet.monadvision.com` explorer links. Secret RPC credentials and keys are excluded. Simulation never writes that record. `nativeDeployments` remains empty until confirmed deployment. Default `deploy:monad` and root `sc:deploy` select native MON; use `deploy:legacy:monad` only for the old USDC stack.

## Remaining application integration

The current web code still uses ERC-20 approve/deposit, USDC formatting and Reown. It must adopt MetaMask, payable deposit, 18-decimal amounts, separate reserve displays and native ABI/address. The native server now implements authenticated wallet sessions, ticket issuance, onchain roster reconciliation, durable operator jobs, private audit records and settlement persistence. Its two-wallet contract/game flow is tested on localhost Anvil. Live testnet deployment, backend hosting and production PostgreSQL verification are pending; local tests do not establish readiness of the deployed web UI.
