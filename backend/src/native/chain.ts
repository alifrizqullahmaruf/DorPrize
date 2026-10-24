import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  keccak256,
  toHex,
  type Abi,
  type Address,
  type Hex,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry, monadTestnet } from "viem/chains";
import { nativeGameVaultAbi, nativeJoinTypedData, type NativeJoinTicket } from "@dorprize/contracts/native";
import type { Journal } from "./store";
import type { NativeConfig } from "./config";

export type ChainRoom = {
  bidWei: bigint;
  maxPlayers: number;
  status: number;
  joinDeadline: bigint;
  settlementDeadline: bigint;
  rosterHash: Hex;
  resultHash: Hex;
  dustWei: bigint;
  players: readonly Address[];
};
export type ChainJob = { id: string; raw: Hex; hash: Hex; status: "pending" | "confirmed" | "reverted" };

export class OperatorTransactionReverted extends Error {
  constructor(readonly hash: Hex) {
    super(`Operator transaction reverted: ${hash}`);
  }
}

export class NativeChain {
  readonly client;
  readonly operator;
  readonly signer;
  private wallet;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    readonly config: NativeConfig,
    private store: Journal,
  ) {
    const chain: Chain = config.chainId === 31337 ? foundry : monadTestnet;
    const transport = http(config.rpcUrl, { timeout: 10_000, retryCount: 1 });
    this.client = createPublicClient({ chain, transport, pollingInterval: 200 });
    this.operator = privateKeyToAccount(config.operatorKey);
    this.signer = privateKeyToAccount(config.signerKey);
    this.wallet = createWalletClient({ account: this.operator, chain, transport });
  }

  async initialize() {
    if ((await this.client.getChainId()) !== this.config.chainId)
      throw new Error("RPC chain does not match configured chain");
    const code = await this.client.getCode({ address: this.config.vault, blockTag: "finalized" });
    if (!code || code === "0x") throw new Error("Native vault has no finalized bytecode");
    const [operator, signer, schema] = await Promise.all([
      this.read<Address>("operator"),
      this.read<Address>("backendSigner"),
      this.read<Hex>("JOIN_TICKET_TYPEHASH"),
    ]);
    if (
      operator.toLowerCase() !== this.operator.address.toLowerCase() ||
      signer.toLowerCase() !== this.signer.address.toLowerCase()
    )
      throw new Error("Server accounts do not match vault operator/backendSigner");
    if (
      schema !==
      keccak256(toHex("JoinTicket(bytes32 roomId,address player,uint256 skillBudgetWei,uint256 nonce,uint64 deadline)"))
    )
      throw new Error("Wrong native vault ticket schema");
    const binding = { chainId: this.config.chainId, vault: this.config.vault.toLowerCase() };
    const saved = await this.store.get<typeof binding>("binding");
    if (saved && (saved.chainId !== binding.chainId || saved.vault !== binding.vault))
      throw new Error("Journal belongs to another chain/vault; use a separate store");
    await this.store.put("binding", binding);
    // Complete a signed transaction from a previous process before allocating another nonce.
    await this.reconcilePending();
  }

  private async reconcilePending() {
    for (const job of await this.store.list<ChainJob>("tx:")) {
      if (job.status !== "pending") continue;
      try {
        await this.writeExisting(job);
      } catch (error) {
        // A finalized revert consumed this nonce. Keep its failure recorded,
        // but allow other rooms and timeout refunds to make progress.
        if (!(error instanceof OperatorTransactionReverted)) throw error;
      }
    }
  }

  read<T>(functionName: string, args: readonly unknown[] = []): Promise<T> {
    return this.client.readContract({
      address: this.config.vault,
      abi: nativeGameVaultAbi as Abi,
      functionName,
      args,
      blockTag: "finalized",
    }) as Promise<T>;
  }
  room(id: Hex) {
    return this.read<ChainRoom>("getRoom", [id]);
  }
  entry(id: Hex, player: Address) {
    return this.read<{ joined: boolean; skillBudgetWei: bigint }>("getEntry", [id, player]);
  }
  async timestamp() {
    return (await this.client.getBlock({ blockTag: "finalized" })).timestamp;
  }
  sign(ticket: NativeJoinTicket) {
    return this.signer.signTypedData(nativeJoinTypedData(this.config.vault, ticket, this.config.chainId));
  }

  write(id: string, functionName: string, args: readonly unknown[]): Promise<Hex> {
    const next = this.queue.then(async () => {
      let job = await this.store.get<ChainJob>(`tx:${id}`);
      if (!job) {
        // An older ambiguous broadcast must retain its nonce until reconciled.
        await this.reconcilePending();
        const data = encodeFunctionData({ abi: nativeGameVaultAbi as Abi, functionName, args });
        await this.client.call({ account: this.operator, to: this.config.vault, data });
        const gas = await this.client.estimateGas({ account: this.operator, to: this.config.vault, data });
        const request = await this.wallet.prepareTransactionRequest({ to: this.config.vault, data, gas });
        const raw = await this.wallet.signTransaction(request);
        job = { id, raw, hash: keccak256(raw), status: "pending" };
        // Durable raw transaction + hash BEFORE broadcast: retries reuse the same nonce/hash.
        await this.store.put(`tx:${id}`, job);
      }
      return this.writeExisting(job);
    });
    this.queue = next.catch(() => {});
    return next;
  }

  private async writeExisting(job: ChainJob): Promise<Hex> {
    if (job.status === "reverted") throw new OperatorTransactionReverted(job.hash);
    if (job.status === "confirmed") return job.hash;
    const known = await this.client.getTransactionReceipt({ hash: job.hash }).catch(() => undefined);
    if (!known) {
      try {
        await this.client.sendRawTransaction({ serializedTransaction: job.raw });
      } catch (error) {
        const mined = await this.client.getTransactionReceipt({ hash: job.hash }).catch(() => undefined);
        const pending = await this.client.getTransaction({ hash: job.hash }).catch(() => undefined);
        if (!mined && !pending) throw error;
      }
    }
    const receipt = await this.client.waitForTransactionReceipt({ hash: job.hash, timeout: 30_000 });
    const until = Date.now() + 30_000;
    while (true) {
      const finalized = await this.client.getBlock({ blockTag: "finalized" });
      if (finalized.number >= receipt.blockNumber) {
        const canonical = await this.client.getBlock({ blockNumber: receipt.blockNumber });
        if (canonical.hash !== receipt.blockHash) throw new Error("Transaction receipt is not canonical");
        break;
      }
      if (Date.now() > until) throw new Error("Transaction awaiting finality; worker will reconcile");
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    job.status = receipt.status === "success" ? "confirmed" : "reverted";
    await this.store.put(`tx:${job.id}`, job);
    if (job.status === "reverted") throw new OperatorTransactionReverted(job.hash);
    return job.hash;
  }
}
