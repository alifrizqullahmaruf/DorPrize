import { createGameServer } from "./app";
import { loadConfig } from "./config";

const config = loadConfig();
const server = createGameServer(config);

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
