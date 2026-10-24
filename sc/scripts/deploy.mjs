// Deploy to Monad testnet with the `deployer` keystore account.
// Usage: node scripts/deploy.mjs   (run from sc/; DEPLOYER_ADDRESS comes from sc/.env)
// Forge needs both --account (the key) and --sender (its address) to broadcast.
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = join(root, ".env");
const env = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
const sender = process.env.DEPLOYER_ADDRESS || /^DEPLOYER_ADDRESS=(0x[0-9a-fA-F]{40})\s*$/m.exec(env)?.[1];
if (!sender) {
  console.error("Set DEPLOYER_ADDRESS in sc/.env (the address printed by `cast wallet import`).");
  process.exit(1);
}

const args = ["script", "script/Deploy.s.sol", "--rpc-url", "monad_testnet"];
args.push("--account", "deployer", "--sender", sender, "--broadcast", "--slow");
const res = spawnSync("forge", args, { cwd: root, stdio: "inherit" });
process.exit(res.status ?? 1);
