import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  createPublicClient,
  createWalletClient,
  getContractAddress,
  getAddress,
  hashTypedData,
  http,
  keccak256,
  parseEther,
  toHex,
} from "viem";
import type { Abi, Account, Hex } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { nativeGameVaultAbi, nativeJoinTypedData, nativePayout, nativeRosterHash } from "../native";

test(
  "viem native lifecycle, EIP-712 parity and confirmed deployment recording on local Monad Anvil",
  {
    timeout: 60_000,
  },
  async (t) => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const listener = createServer();
    listener.listen(0, "127.0.0.1");
    await once(listener, "listening");
    const endpoint = listener.address();
    if (!endpoint || typeof endpoint === "string") throw new Error("No local port");
    const port = endpoint.port;
    await new Promise<void>((resolve) => listener.close(() => resolve()));
    const child = spawn(
      process.env.ANVIL_BIN || "anvil",
      ["--network", "monad", "--chain-id", "31337", "--host", "127.0.0.1", "--port", String(port), "--silent"],
      { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
    );
    let startupError: Error | undefined;
    let stderr = "";
    child.on("error", (error) => {
      startupError = error;
    });
    child.stderr.on("data", (data) => {
      stderr += String(data);
    });
    t.after(async () => {
      if (child.exitCode === null && !startupError) {
        child.kill();
        await once(child, "exit");
      }
    });
    const rpcUrl = `http://127.0.0.1:${port}`;
    const transport = http(rpcUrl, { retryCount: 0, timeout: 1000 });
    const client = createPublicClient({ chain: foundry, transport, pollingInterval: 25 });
    let ready = false;
    let lastRpcError: unknown;
    for (let i = 0; i < 50; i++) {
      if (startupError) throw startupError;
      if (child.exitCode !== null) throw new Error(`Anvil exited: ${stderr}`);
      try {
        await client.getBlockNumber();
        ready = true;
        break;
      } catch (error) {
        lastRpcError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, `Anvil did not become ready: ${stderr} ${String(lastRpcError)}`);
    assert.equal(await client.getChainId(), 31337);
    // Public Anvil development mnemonic; only used against the ephemeral localhost node created above.
    const mnemonic = "test test test test test test test test test test test junk";
    const [operator, alice, bob, treasury] = [0, 1, 2, 3].map((addressIndex) =>
      mnemonicToAccount(mnemonic, { addressIndex }),
    );
    const wallet = createWalletClient({ account: operator, chain: foundry, transport });
    const artifact = JSON.parse(readFileSync(join(root, "out/NativeGameVault.sol/NativeGameVault.json"), "utf8"));
    const creation = await wallet.deployContract({
      abi: nativeGameVaultAbi,
      bytecode: artifact.bytecode.object as Hex,
      args: [operator.address, operator.address, operator.address, treasury.address],
    });
    const receipt = await client.waitForTransactionReceipt({ hash: creation });
    assert.equal(receipt.status, "success");
    const address = receipt.contractAddress;
    assert.ok(address);
    const abi = nativeGameVaultAbi as Abi;
    const read = (functionName: string, args: readonly unknown[] = []) =>
      client.readContract({ address, abi, functionName, args });
    const write = async (account: Account, functionName: string, args: readonly unknown[] = [], value?: bigint) => {
      const { request } = await client.simulateContract({ address, abi, functionName, args, account, value });
      const gas = await client.estimateContractGas({ address, abi, functionName, args, account, value });
      const hash = await wallet.writeContract({ ...request, account, gas });
      const confirmed = await client.waitForTransactionReceipt({ hash });
      assert.equal(confirmed.status, "success");
      return hash;
    };
    await write(alice, "deposit", [], parseEther("10"));
    await write(bob, "deposit", [], parseEther("10"));
    const roomId = keccak256(toHex("local-integration-match"));
    const block = await client.getBlock();
    await write(operator, "createRoom", [roomId, parseEther("1"), 2, block.timestamp + 600n]);
    for (const player of [alice, bob]) {
      const ticket = {
        roomId,
        player: player.address,
        skillBudgetWei: parseEther("2"),
        nonce: (await read("nonces", [player.address])) as bigint,
        deadline: block.timestamp + 300n,
      };
      const typed = nativeJoinTypedData(address, ticket, 31337);
      assert.equal(await read("hashJoinTicket", [ticket]), hashTypedData(typed));
      const signature = await operator.signTypedData(typed);
      await write(player, "joinRoom", [ticket, signature]);
    }
    const roster = nativeRosterHash([alice.address, bob.address]);
    assert.equal(await read("currentRosterHash", [roomId]), roster);
    await write(operator, "startRoom", [roomId, roster]);
    const { payoutEachWei } = nativePayout(parseEther("1"), 2, 1);
    await write(operator, "settleRoom", [
      roomId,
      [alice.address],
      [payoutEachWei],
      [parseEther("0.4"), 0n],
      roster,
      keccak256(toHex("persisted-result")),
    ]);
    assert.equal(await read("availableBalanceOf", [alice.address]), parseEther("10.6"));
    assert.equal(await read("availableBalanceOf", [bob.address]), parseEther("9"));
    assert.equal(await read("totalTreasuryClaimable"), parseEther("0.4"));
    await write(alice, "withdraw", [parseEther("10.6")]);
    await write(treasury, "withdrawTreasury", [parseEther("0.4")]);
    assert.equal(await client.getBalance({ address }), parseEther("9"));
    assert.equal(await read("totalLiabilities"), parseEther("9"));

    // A fractional tie must agree between the helper and Solidity, even with reversed recipients.
    const tiePlayers = [alice, bob, treasury, operator];
    const tieId = keccak256(toHex("fractional-tie"));
    const bid = parseEther("2.5");
    for (const player of tiePlayers) await write(player, "deposit", [], bid);
    const tieBlock = await client.getBlock();
    await write(operator, "createRoom", [tieId, bid, 4, tieBlock.timestamp + 600n]);
    for (const player of tiePlayers) {
      const ticket = {
        roomId: tieId,
        player: player.address,
        skillBudgetWei: 0n,
        nonce: (await read("nonces", [player.address])) as bigint,
        deadline: tieBlock.timestamp + 300n,
      };
      await write(player, "joinRoom", [
        ticket,
        await operator.signTypedData(nativeJoinTypedData(address, ticket, 31337)),
      ]);
    }
    const tieRoster = nativeRosterHash(tiePlayers.map((player) => player.address));
    await write(operator, "startRoom", [tieId, tieRoster]);
    const tie = nativePayout(bid, 4, 3);
    await write(operator, "settleRoom", [
      tieId,
      [treasury.address, bob.address, alice.address],
      [...tie.amountsWei].reverse(),
      [0n, 0n, 0n, 0n],
      tieRoster,
      keccak256(toHex("fractional-tie-result")),
    ]);
    assert.equal(await read("availableBalanceOf", [alice.address]), tie.amountsWei[0]);
    assert.equal(await read("availableBalanceOf", [bob.address]), parseEther("9") + tie.amountsWei[1]);
    assert.equal(await read("availableBalanceOf", [treasury.address]), tie.amountsWei[2]);
    assert.equal(await read("totalRoomDust"), 0n);
    assert.equal(await read("totalLiabilities"), await client.getBalance({ address }));

    // Simulation alone must never populate a deployment record. This writer demands a real creation receipt.
    await promisify(execFile)(process.execPath, ["scripts/record-native-deployment.mjs"], {
      cwd: root,
      env: {
        ...process.env,
        CHAIN_ID: "31337",
        MONAD_RPC_URL: rpcUrl,
        NATIVE_GAME_VAULT_ADDRESS: address,
        DEPLOYMENT_TX_HASH: creation,
      },
      windowsHide: true,
    });
    const record = JSON.parse(readFileSync(join(root, "deployments/native/31337.json"), "utf8"));
    assert.equal(record.NativeGameVault, getAddress(address));
    assert.equal(record.asset, "MON");
    assert.equal(record.decimals, 18);
    assert.equal(record.rpcUrl, rpcUrl);
    assert.equal(record.abiPath, "sc/out/NativeGameVault.sol/NativeGameVault.json");
    assert.equal(record.abiExport, "@dorprize/contracts/native");
    assert.equal(record.explorerUrl, null);

    // Exercise the actual Foundry deployment entry point against this same ephemeral local chain.
    const deploymentNonce = await client.getTransactionCount({ address: operator.address });
    const scriptedAddress = getContractAddress({ from: operator.address, nonce: BigInt(deploymentNonce) });
    await promisify(execFile)(
      process.env.FORGE_BIN || "forge",
      ["script", "script/DeployNative.s.sol", "--network", "monad", "--rpc-url", rpcUrl, "--unlocked", "--broadcast"],
      {
        cwd: root,
        env: {
          ...process.env,
          DEPLOYER_ADDRESS: operator.address,
          VAULT_OWNER: operator.address,
          OPERATOR: operator.address,
          BACKEND_SIGNER: operator.address,
          TREASURY: treasury.address,
        },
        windowsHide: true,
      },
    );
    assert.notEqual(await client.getCode({ address: scriptedAddress }), "0x");
    assert.equal(
      await client.readContract({ address: scriptedAddress, abi, functionName: "treasury" }),
      getAddress(treasury.address),
    );
  },
);
