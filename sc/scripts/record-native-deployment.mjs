// Record a real deployment only after verifying chain, successful creation receipt and live vault configuration.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, getAddress, http, isHash, parseAbi } from "viem";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const chainId = Number(process.env.CHAIN_ID || 10143);
if (![10143, 31337].includes(chainId)) throw new Error("Only Monad testnet or local Anvil is allowed");
const rpcUrl = process.env.MONAD_RPC_URL;
const address = getAddress(process.env.NATIVE_GAME_VAULT_ADDRESS || "");
const txHash = process.env.DEPLOYMENT_TX_HASH;
if (!rpcUrl || !isHash(txHash || "")) throw new Error("MONAD_RPC_URL and DEPLOYMENT_TX_HASH are required");
const client = createPublicClient({ transport: http(rpcUrl) });
if ((await client.getChainId()) !== chainId) throw new Error("RPC chainId does not match CHAIN_ID");
const receipt = await client.getTransactionReceipt({ hash: txHash });
if (receipt.status !== "success" || !receipt.contractAddress || getAddress(receipt.contractAddress) !== address) {
  throw new Error("A successful direct deployment receipt for this vault address is required");
}
if (chainId === 10143) {
  const finalized = await client.getBlock({ blockTag: "finalized" });
  if (finalized.number < receipt.blockNumber) throw new Error("Deployment is not finalized yet; retry after finality");
}
const canonicalBlock = await client.getBlock({ blockNumber: receipt.blockNumber });
if (canonicalBlock.hash !== receipt.blockHash) throw new Error("Deployment receipt is not canonical");
const code = await client.getCode({ address, blockTag: chainId === 10143 ? "finalized" : "latest" });
if (!code || code === "0x") throw new Error("No deployed bytecode at the vault address");
const configAbi = parseAbi([
  "function owner() view returns (address)",
  "function operator() view returns (address)",
  "function backendSigner() view returns (address)",
  "function treasury() view returns (address)",
  "function JOIN_TICKET_TYPEHASH() view returns (bytes32)",
]);
const { keccak256, toHex } = await import("viem");
const typehash = await client.readContract({ address, abi: configAbi, functionName: "JOIN_TICKET_TYPEHASH" });
if (
  typehash !==
  keccak256(toHex("JoinTicket(bytes32 roomId,address player,uint256 skillBudgetWei,uint256 nonce,uint64 deadline)"))
) {
  throw new Error("Unexpected native vault ticket schema");
}
const values = await Promise.all(
  ["owner", "operator", "backendSigner", "treasury"].map((functionName) =>
    client.readContract({ address, abi: configAbi, functionName }),
  ),
);
const record = {
  chainId,
  asset: "MON",
  decimals: 18,
  NativeGameVault: address,
  deploymentTxHash: txHash,
  owner: values[0],
  operator: values[1],
  backendSigner: values[2],
  treasury: values[3],
  rpcUrl: chainId === 10143 ? "https://testnet-rpc.monad.xyz" : new URL(rpcUrl).origin,
  explorerUrl: chainId === 10143 ? "https://testnet.monadvision.com" : null,
  contractUrl: chainId === 10143 ? `https://testnet.monadvision.com/address/${address}` : null,
  transactionUrl: chainId === 10143 ? `https://testnet.monadvision.com/tx/${txHash}` : null,
  abiPath: "sc/out/NativeGameVault.sol/NativeGameVault.json",
  abiExport: "@dorprize/contracts/native",
};
const output = join(root, "deployments", "native", `${chainId}.json`);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(record, null, 2) + "\n");
console.log(`Confirmed native deployment written to ${output}`);
console.log(
  JSON.stringify(
    {
      contractAddress: address,
      chainId,
      rpcUrl: record.rpcUrl,
      abiPath: record.abiPath,
      explorerUrl: record.explorerUrl,
    },
    null,
    2,
  ),
);
