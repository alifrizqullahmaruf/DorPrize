// Verify every contract created by the last `forge script` deploy on MonadVision (Sourcify).
// Usage: node scripts/verify.mjs <chainId> [DeployNative.s.sol|Deploy.s.sol]
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCIFY = "https://sourcify-api-monad.blockvision.org/";
const chainId = process.argv[2] ?? "10143";
const scriptName = process.argv[3] ?? "Deploy.s.sol";
if (chainId !== "10143" || !["Deploy.s.sol", "DeployNative.s.sol"].includes(scriptName))
  throw new Error("Expected Monad testnet and a known deployment script");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = join(root, "broadcast", scriptName, chainId, "run-latest.json");

const { transactions } = JSON.parse(readFileSync(run, "utf8"));
const created = transactions.filter((tx) => tx.transactionType === "CREATE" && tx.contractAddress);
if (created.length === 0) throw new Error("No created contracts found in deployment broadcast");

let failed = 0;
for (const { contractName, contractAddress } of created) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(contractAddress) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(contractName))
    throw new Error("Invalid contract identity in broadcast record");
  console.log(`\n> ${contractName} ${contractAddress}`);
  const res = spawnSync(
    process.env.FORGE_BIN || "forge",
    [
      "verify-contract",
      contractAddress,
      contractName,
      "--chain",
      chainId,
      "--verifier",
      "sourcify",
      "--verifier-url",
      SOURCIFY,
    ],
    { cwd: root, stdio: "inherit", windowsHide: true },
  );
  if (res.status !== 0) failed++;
}
console.log(`\n${created.length - failed}/${created.length} contracts submitted for verification.`);
process.exit(failed ? 1 : 0);
