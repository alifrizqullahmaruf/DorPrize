import { createGameServer } from "./app";
import { loadConfig } from "./config";
import { createNativeServer } from "./native/app";
import { loadNativeConfig } from "./native/config";

const config = loadConfig();
const mode = process.env.SERVER_MODE ?? "demo";
if (mode !== "demo" && mode !== "native") throw new Error("SERVER_MODE must be demo or native");
const server = mode === "native" ? await createNativeServer(config, loadNativeConfig()) : createGameServer(config);

const port = await server.listen();
console.log(`DOR PRIZE server listening on http://localhost:${port}`);
console.log(`  mode: ${mode}`);
console.log(`  CORS origins: ${config.corsOrigins.join(", ")}`);
console.log(`  bots: ${config.allowBots ? `${config.botsPerRoom} per room` : "off"} · time scale: ${config.timeScale}`);

const shutdown = async () => {
  await server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
