# Native MON backend and frontend handoff

The native backend connects to the separate `NativeGameVault`. It does not use
the legacy USDC vault or Reown. `SERVER_MODE=demo` retains the existing guest
server; `SERVER_MODE=native` requires authenticated wallet sessions and onchain
escrow. No frontend source was changed for this integration.

## Current readiness

- The contract and native backend are connected and exercised on local Anvil
  with Monad execution rules and two signed development wallets.
- The public frontend domain supplied by the user is `https://dorprize.vercel.app`.
  Its existence does not mean that it already uses the native API.
- The user supplied public MetaMask address
  `0x50463168EBC5ae0Ed86efcA496b9A7A4495F7109`, now explicitly selected as owner.
  The additional valid wallet is `0x5EaD190F2786362c556B9BF4798326d6e11b88F2`.
  Proposed testnet roles: existing owner also deployer/treasury; new wallet operator;
  one additional backend signer wallet is recommended. A two-wallet MVP can reuse
  the new wallet for both server roles. Only owner assignment is confirmed; no
  live roles or signing credentials have been configured. See `TESTNET_SETUP_ID.md`.
- There is no recorded native testnet deployment, live backend hosting, production
  PostgreSQL connection, or real MetaMask-to-backend demo yet.

The current source layout is `frontend/`, `backend/`, `shared/` and `sc/`.
Native integration was migrated onto the new GitHub history at `080c2c2`, then
rebased onto the team's update `744ef45` while preserving the upstream frontend.

## Start and storage

Copy `.env.native.example` to `.env` in `backend`, fill the deployed vault,
RPC, operator/signer secrets and persistence settings, then run from repo root:

```sh
npm ci
npm run dev:backend
```

Startup verifies the chain, finalized vault bytecode, native ticket schema,
operator and signer. It refuses a database/journal previously bound to another
chain or vault. Bots are rejected in native mode. Keep `TIME_SCALE=1` on testnet.

Production: use `DATABASE_URL` for a PostgreSQL/Supabase direct or session
connection with TLS. Do not use transaction pooling: one persistent connection
holds the advisory writer lock. Startup creates `dorprize_native_records`; the
connection role must own the private journal table (or be a privileged server
role), since startup also enables RLS and revokes browser-role access using
`backend/migrations/001_native_journal.sql`. The migration is transactional.
Browser `anon` and `authenticated` roles receive no policies or table privileges.
Keep this table server-only. Configure hosting to run one
replica. A lost DB connection fails subsequent journal operations closed until
restart. The production PostgreSQL adapter still needs a smoke test against the
actual production database. A separate suite runs a real ephemeral PostgreSQL
cluster and validates persistence, writer locking, RLS, browser-role denial and
connection-loss recovery. The game end-to-end suite uses the durable file journal.

Local: set `NATIVE_STATE_DIR=.native-state`, leave `DATABASE_URL` empty, and keep
that directory on persistent storage. Its exclusive `writer.lock` prevents a
second process. After a hard crash, verify the old process is stopped before
removing a stale lock. Never delete `state.json` to fix a lock. Writes fsync the
temporary file before atomic replacement; use PostgreSQL for production durability
and backups. Do not use an ephemeral hosting filesystem for real escrow jobs.

The operator account pays create/start/settle/cancel/refund gas. The backend
signer signs join tickets. Configure their private keys only as backend secrets;
players keep signing their own deposit/join/leave/withdraw through MetaMask.
The owner, treasury and deployed role assignments follow
[`sc/NATIVE_MON.md`](../sc/NATIVE_MON.md).

## Login and HTTP API

All amounts are unsigned base-10 **integer wei strings**, with 18 decimals.
Never send floating-point MON values for money operations. Every authenticated
request uses `Authorization: Bearer <token>`. Restart invalidates sessions and
unused login challenges; the wallet signs in again.

The full pot is split equally down to wei, with residual 1-wei shares assigned
to winners in frozen roster order. Result `recipients` and `amountsWei` use that
order. `dustWei` is always `"0"`; treasury receives only skill fees. Use the exact
per-recipient amount, since numeric `payoutEach` is only an approximate display.

1. `POST /auth/challenge` with `{ "address": "0x..." }` returns
   `{ challengeId, message, expiresAt }`. Sign the exact message using MetaMask
   `personal_sign` or viem `signMessage`. It is bound to `AUTH_ORIGIN`, chain and
   a five-minute nonce.
2. `POST /auth/verify` with `{ challengeId, signature }` returns
   `{ token, address, expiresAt }`, valid for one hour. The nonce is single-use,
   including concurrent requests or a failed signature attempt. The server
   validates the signer from its own saved message, never a client-supplied one.
3. Use `GET /auth/session` to check the session and `POST /auth/logout` with `{}`
   to revoke it and disconnect sockets using that token.

Keep bearer tokens in memory in the frontend. CORS/origin allowlists apply to
HTTP and WebSocket upgrades. In-memory rate limits bound challenge/session
issuance and socket actions; terminate TLS and apply deployment-level connection
and per-IP limits at the backend host. Do not blindly trust arbitrary forwarded
headers from the internet.

| Endpoint                           | Authentication and behavior                                                                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health`, `GET /config`       | Public readiness, chain, native vault and asset metadata                                                                                                 |
| `GET /balance`                     | Session wallet's availableWei, bidLockedWei and skillReservedWei from finalized chain reads                                                              |
| `GET /rooms`                       | Public waiting rooms only; native bidWei metadata                                                                                                        |
| `POST /rooms`                      | Session; `{ name, bidWei, maxPlayers, isPrivate }`; persists match ID and confirms operator createRoom before success                                    |
| `GET /rooms/:code`                 | Session; invitation code resolves to permanent matchId and escrowRoomId                                                                                  |
| `POST /rooms/:code/ticket`         | Session; `{ skillBudgetWei }`; verifies capacity, available balance, no active room and nonce; returns ticket, signature, chainId and vault              |
| `GET /matches/:code/result`        | Frozen roster participants only; authoritative result, native amounts, status and transaction hash                                                       |
| `POST /api/game/submit-settlement` | Participant session; accepts only `{ roomId: code }`; ignores no extra fields, rejects them. Uses the persisted server result and settles the whole room |

`GET /ready` checks persistence and RPC availability, returning 200 when both
respond and 503 otherwise. `/health` remains a lightweight liveness endpoint.

A private invitation code is the access capability; private rooms are absent
from the public list. Codes are never reused by this journal. Each permanent
UUID is mapped to `keccak256(toHex(matchId))` for onchain escrow. Use
`escrowRoomId` from the API for contract calls, and the short code for socket/HTTP
room references. Creation is bounded to 100 open records and three per creator.

## Frontend money and game sequence

1. Connect MetaMask to chain 10143, sign in, and read `/config` and `/balance`.
2. Call native `deposit()` with MON in `value`; no ERC-20 approve. Wait for a
   successful finalized receipt and refresh balance.
3. Create/select a room, approve a skill budget, and request a ticket. Validate
   the ticket's player, escrowRoomId, budget, chain and vault before signing the
   player's `joinRoom(ticket, signature)` transaction. Parse integer ticket
   strings to `bigint`. A ticket alone is not an escrow entry.
4. After successful chain confirmation, emit socket `room:join`. The server
   independently checks finalized membership; an address in a client payload
   never grants a seat. The current code is the private-room invitation.
5. Emit `room:ready`. Once every seated player is ready, the countdown ends and
   the backend compares all ready seats to the chain roster, freezes the expected
   roster hash, submits `startRoom`, waits for finality and rechecks reserves.
   Only then does it emit `round:start`. Join/leave/readiness changes are frozen
   during start confirmation. If an address set or reserve races, gameplay does
   not start and the room follows cancellation/timeout recovery.
6. Before leaving a waiting lobby, confirm the player's onchain `leaveRoom`
   transaction, then emit `room:leave`. Closing a tab preserves its escrow seat;
   reconnect with the same authenticated wallet. Active departures retain roster
   membership and use last accepted/default actions, with no immediate refund.
7. Gameplay sends validated actions privately; skill purchases are capped by
   each frozen `skillBudgetWei`. Native fees are computed with integer helpers,
   independent of legacy numeric display fields in game events.
8. Results are persisted before `game:end`. Read the native result endpoint for
   exact potWei/amountsWei/skillFeesWei/dustWei and transaction status. The claim
   button can trigger settlement, and a fallback worker also submits it.
9. After finalized settlement, refresh balance. Payout is vault credit; the
   player separately signs `withdraw(amountWei)` to receive wallet MON.

## Socket protocol

Connect with `io(backendUrl, { auth: { token } })`. Guest `playerId` and any
supplied address are ignored. Sessions are checked on every packet and socket
expiry disconnects the session. Existing game event shapes remain compatible
for rendering, with a native action envelope and additive settlement event:

```ts
socket.emit("room:join", { roomId: code, name, skin }, ack);
socket.emit("room:ready", { ready: true }, ack);
socket.emit(
  "round:submit",
  {
    round: currentRound,
    actionId: crypto.randomUUID(),
    seq: nextSequence, // increasing safe integer within this match
    action: { moveTo, shootDir, skill, mineAt },
  },
  ack,
);
```

ACKs are `{ ok: true, result? }` or `{ ok: false, error }`. Repeat the identical
actionId/sequence/body when retrying; a changed action or stale round/sequence
is rejected. Maintain sequence across reconnects. Native inputs close exactly
at the server deadline with no grace window. Invalid budget/cooldown/tile inputs
do not lock the player's valid next attempt. Skill IDs remain `mine`, `shotgun`,
`shield`, `goldHelm`; the last maps to native helper `helmet`.

`room:state`, `round:start`, `round:resolve` and `game:end` retain the existing
game protocol. Legacy numeric fields are for rendering only, not settlement
authority. Only the wallet's channel receives its private position and mines.
`settlement:update` sends `{ roomId: code, status, txHash? }`; statuses are
`settled` or `cancelled`. Poll the result endpoint for the persisted `result`
(pending), `recovery`, `settled` or `cancelled` state. Do not display payout
success based solely on `game:end`.

## Retry, restart and remaining limitations

Before broadcast the relayer persists the exact signed operator transaction
and its hash. Pending jobs are reconciled before allocating another nonce;
retries reuse the same raw transaction/hash. Do not use the operator signing
account for unrelated transactions from another process, as this would conflict
with nonce management. Gas is estimated for the exact call without an oversized
fixed limit. Confirmation checks both receipt success and canonical finality.

Results and the pending settlement intent are in one atomic match record.
Settlement arguments always come from that record. A restart checks the chain's
terminal resultHash and recovers the original txHash, preventing a second credit.
An ambiguous provider error retains its pending transaction for reconciliation.
A confirmed revert remains a recorded failed job. Its consumed nonce does not
block startup or jobs for other rooms. The backend does not replace it with an
unrelated signed result automatically.

Waiting lobbies from a previous process are cancelled to release all reserves.
Active rounds are not resumed from lost memory: they enter `recovery`, stay
locked until the contract's 15-minute active timeout, and are refunded without
skill charges. Anyone can call the contract expiry refund if the backend is
unavailable. Final results already saved are settled where still permitted;
expired/cancelled matches do not credit a game payout.

Dust remains a separate contract liability without a sweep/claim function.
Its recipient policy remains undecided; no funds are silently sent to treasury.
The server remains authoritative for gameplay; resultHash is an audit commitment,
not a proof that a result is fair. Private actions, resolved state and native fees
are persisted in each match's server-only audit trail and included in the atomic
final result record. Never expose that record/table directly to browsers.
Resuming live rounds after process loss is not implemented by this backend.

## Validation

```sh
npm test
npm run typecheck
# Put Foundry >=1.8 forge/anvil on PATH. Build the existing native artifact first.
npm run sc:build
npm run test:native -w @dorprize/backend
npm run test:postgres
```

`ANVIL_BIN` can select the local binary. Integration tests create an ephemeral
localhost Monad Anvil, use only public development accounts, and test signed
login, fake identity and escrow rejection, native tickets, roster gating, skill
budgets, action replay, settlement/withdraw, persisted hash recovery, waiting
cancellation and active expiry refunds. No test sends transactions to testnet.

The PostgreSQL suite starts its own localhost database using the development-only
`embedded-postgres` dependency. It never reads `DATABASE_URL`, creates no system
account and removes its temporary cluster afterward. Use regular `npm ci` so the
platform binary package can hydrate its runtime links. Run it as a normal user,
including in Linux containers (PostgreSQL refuses to run as root).

GitHub Actions in `.github/workflows/native-checks.yml` reruns unit tests,
typecheck, contract tests and localhost integration on Linux and Windows.

## Deployment handoff

After a real deployment is finalized, run `npm run deployment:record:native -w @dorprize/contracts`.
It records the public contract address, chain ID, ABI path, public RPC and
explorer links. The public explorer chosen for this project is
`https://testnet.monadvision.com`. RPC API keys and signing keys are never included
in the handoff record. Use `/address/<address>` and `/tx/<hash>` under that explorer.
A localhost record is excluded from production address exports.
