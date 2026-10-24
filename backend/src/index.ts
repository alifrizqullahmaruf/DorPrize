import { homedir } from "node:os";
import { join } from "node:path";
import { formatEther } from "viem";
import { createGameServer } from "./app";
import { ChainService } from "./chain";
import { loadConfig } from "./config";
import { decryptKeystore, promptPassword } from "./keystore";

const config = loadConfig();

// On-chain bids: unlock the server key from its Foundry keystore (asked on the terminal).
let chain: ChainService | undefined;
if (config.onchain) {
  const keystore = config.signerKeystore || join(homedir(), ".foundry", "keystores", "deployer");
  const password = process.env.SIGNER_PASSWORD ?? (await promptPassword(`Keystore password (${keystore}): `));
  chain = new ChainService(decryptKeystore(keystore, password), config.rpcUrl);
  const { address, balance } = await chain.checkRoles();
  console.log(`On-chain bids ON · signer/relayer ${address} · ${formatEther(balance)} MON`);
}

const server = createGameServer(config, chain);

const port = await server.listen();
console.log(`DOR PRIZE server listening on http://localhost:${port}`);
console.log(`  CORS origins: ${config.corsOrigins.join(", ")}`);
console.log(`  bots: ${config.allowBots ? `${config.botsPerRoom} per room` : "off"} · time scale: ${config.timeScale}`);

const shutdown = async () => {
  await server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
