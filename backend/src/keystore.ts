/**
 * Decrypt a Foundry / Ethereum v3 keystore (what `cast wallet import` writes),
 * so the server can sign without a private key ever sitting in a file.
 */
import { createDecipheriv, pbkdf2Sync, scryptSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { bytesToHex, concat, keccak256, type Hex } from "viem";

type KeystoreV3 = {
  crypto: {
    cipher: string;
    ciphertext: string;
    cipherparams: { iv: string };
    kdf: "scrypt" | "pbkdf2";
    kdfparams: { dklen: number; salt: string; n?: number; r?: number; p?: number; c?: number; prf?: string };
    mac: string;
  };
};

export function decryptKeystore(path: string, password: string): Hex {
  const { crypto: c } = JSON.parse(readFileSync(path, "utf8")) as KeystoreV3;
  const salt = Buffer.from(c.kdfparams.salt, "hex");
  const dklen = c.kdfparams.dklen;
  const key =
    c.kdf === "scrypt"
      ? scryptSync(password, salt, dklen, {
          N: c.kdfparams.n!,
          r: c.kdfparams.r!,
          p: c.kdfparams.p!,
          maxmem: 256 * 1024 * 1024,
        })
      : pbkdf2Sync(password, salt, c.kdfparams.c!, dklen, "sha256");

  const ciphertext = Buffer.from(c.ciphertext, "hex");
  const mac = keccak256(concat([key.subarray(16, 32), ciphertext]));
  if (mac.slice(2) !== c.mac.toLowerCase()) throw new Error("Wrong keystore password.");
  if (c.cipher !== "aes-128-ctr") throw new Error(`Unsupported keystore cipher ${c.cipher}.`);

  const decipher = createDecipheriv("aes-128-ctr", key.subarray(0, 16), Buffer.from(c.cipherparams.iv, "hex"));
  return bytesToHex(Buffer.concat([decipher.update(ciphertext), decipher.final()]));
}

/** Ask for a password on the terminal without echoing it. */
export function promptPassword(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const write = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput.bind(rl);
    let asked = false;
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
      if (!asked) {
        asked = true;
        write(s);
      }
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}
