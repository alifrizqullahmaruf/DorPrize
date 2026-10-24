# @dorprize/contracts (sc)

Foundry contracts for DOR PRIZE on Monad testnet (chain id `10143`). Every contract is a **UUPS proxy** (OpenZeppelin 5.6.1), following the PassChick pattern.

| Contract      | Role                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------- |
| `GameUSDC`    | Test USDC (6 decimals), mintable only by the faucet                                      |
| `USDCFaucet`  | Claims 100 test USDC                                                                     |
| `GameVault`   | Player balances (available / locked) and treasury. `withdraw` is blocked while in a room |
| `RoomManager` | Room lifecycle: join, leave, start, settle, refund                                       |

## Room lifecycle

```
joinRoom   (backend EIP-712 ticket)   -> Open      bid locked in the vault
leaveRoom                             -> Open      bid returned (before start only)
startRoom  (operator / relayer)       -> Started   nobody can leave any more
settleRoom (anyone + backend sig)     -> Settled   pot split between winners, skill fees to treasury
refundRoom (anyone, after delay)      -> Refunded  every bid returned
```

- The **first player** sets the room's `bid` and `maxPlayers` (2–10, min. 1 USDC); later players must match them.
- Split-pot dust goes to the treasury. Skill fees are charged from the available balance, capped at what is there, so a settlement can never get stuck.
- A room can be settled or refunded **only once**.

## Backend signatures (EIP-712)

Domain: `{ name: "DorPrizeRoomManager", version: "1", chainId, verifyingContract: <RoomManager> }`

```ts
JoinTicket: [
  { name: "roomId", type: "bytes32" }, // keccak256(toHex(roomCode))
  { name: "player", type: "address" },
  { name: "bid", type: "uint256" }, // USDC base units (6 decimals)
  { name: "maxPlayers", type: "uint8" },
  { name: "deadline", type: "uint64" }, // unix seconds
];
Settlement: [
  { name: "roomId", type: "bytes32" },
  { name: "winners", type: "address[]" },
  { name: "skillFees", type: "uint256[]" }, // same order as getRoom(roomId).players
  { name: "deadline", type: "uint64" },
];
```

Both digests match `viem.hashTypedData` exactly (`hashJoinTicket`, `hashSettlement`).

## Setup

Solidity libraries are **git submodules** in `lib/` (forge-std v1.15.0, openzeppelin-contracts and openzeppelin-contracts-upgradeable v5.6.1). After cloning:

```bash
git submodule update --init --recursive
```

## Commands

From the repo root:

| Command             | What it does                                                 |
| ------------------- | ------------------------------------------------------------ |
| `npm run sc:build`  | `forge build`                                                |
| `npm run sc:test`   | `forge test` (unit, full flows, vault solvency fuzz)         |
| `npm run sc:abi`    | Build, then export ABIs + addresses to `abi/*.ts` (frontend) |
| `npm run sc:deploy` | Deploy to Monad testnet                                      |

Inside `sc/` plain Foundry works too: `forge build`, `forge test`, `forge fmt`.

## Deploying to Monad testnet

1. `cp .env.example .env` and set `PRIVATE_KEY` (deployer with testnet MON). Optional: `BACKEND_SIGNER`, `OPERATOR`, `INITIAL_OWNER` (default: the deployer), `REFUND_DELAY`.
2. Deploy:
   ```bash
   cd sc
   set -a && source .env && set +a
   npm run deploy:monad
   ```
   The script deploys every proxy, lets the faucet mint, points the vault at `RoomManager` and writes the addresses to `deployments/10143.json`.
3. Run `npm run sc:abi` from the root so the frontend picks up the addresses, then commit `deployments/10143.json` and `abi/`.
4. The `OPERATOR` relayer needs MON to call `startRoom` and `settleRoom`.

Verify on MonadVision (Sourcify):

```bash
FOUNDRY_PROFILE=monad_vision forge verify-contract <address> <ContractName> \
  --chain 10143 --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/
```

Local test without a real wallet: run `anvil`, then `npm run deploy:local -w @dorprize/contracts` (uses anvil's dev account; chain 31337 only).
