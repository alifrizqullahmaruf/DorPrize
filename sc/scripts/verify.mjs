// Verify every contract created by the last `forge script` deploy on MonadVision (Sourcify).
// Usage: node scripts/verify.mjs <chainId>   (run from sc/, after `npm run deploy:monad`)
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCIFY = "https://sourcify-api-monad.blockvision.org/";
const chainId = process.argv[2] ?? "10143";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = join(root, "broadcast", "Deploy.s.sol", chainId, "run-latest.json");

if (!existsSync(run)) {
  console.error(`No deployment found at ${run}. Run "npm run deploy:monad" first.`);
  process.exit(1);
}
const { transactions } = JSON.parse(readFileSync(run, "utf8"));
const created = transactions.filter((tx) => tx.transactionType === "CREATE" && tx.contractAddress);

let failed = 0;
for (const { contractName, contractAddress } of created) {
  console.log(`\n> ${contractName} ${contractAddress}`);
  const res = spawnSync(
    "forge",
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
    { cwd: root, stdio: "inherit", shell: process.platform === "win32" },
  );
  if (res.status !== 0) failed++;
}
console.log(`\n${created.length - failed}/${created.length} contracts submitted for verification.`);
process.exit(failed ? 1 : 0);
