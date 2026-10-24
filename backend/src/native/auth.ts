import { createHash, randomBytes } from "node:crypto";
import { getAddress, isAddress, type Address, type Hex } from "viem";
import { createSiweMessage } from "viem/siwe";

const digest = (token: string) => createHash("sha256").update(token).digest("hex");
type Challenge = { message: string; address: Address; expires: number };
type Session = { address: Address; expires: number };

export class WalletAuth {
  private challenges = new Map<string, Challenge>();
  private sessions = new Map<string, Session>();
  constructor(
    readonly origin: string,
    readonly chainId: number,
    private verify: (message: string, signature: Hex) => Promise<boolean>,
    private now: () => number = Date.now,
  ) {}

  challenge(value: unknown) {
    this.sweep();
    if (typeof value !== "string" || !isAddress(value)) throw new Error("Invalid wallet address");
    if (this.challenges.size >= 10_000) throw new Error("Too many pending challenges");
    const address = getAddress(value);
    const id = randomBytes(24).toString("hex");
    const expires = this.now() + 5 * 60_000;
    const message = createSiweMessage({
      address,
      chainId: this.chainId,
      domain: new URL(this.origin).host,
      uri: this.origin,
      version: "1",
      nonce: randomBytes(16).toString("hex"),
      statement: "Sign in to DOR PRIZE. This does not authorize a transaction.",
      issuedAt: new Date(this.now()),
      expirationTime: new Date(expires),
    });
    this.challenges.set(id, { message, address, expires });
    return { challengeId: id, message, expiresAt: expires };
  }

  async login(id: unknown, signature: unknown) {
    if (
      typeof id !== "string" ||
      typeof signature !== "string" ||
      !/^0x[0-9a-fA-F]+$/.test(signature) ||
      signature.length > 8194
    )
      throw new Error("Invalid signature");
    const challenge = this.challenges.get(id);
    // Consume before asynchronous verification so parallel requests cannot replay it.
    this.challenges.delete(id);
    if (!challenge || challenge.expires <= this.now()) throw new Error("Challenge expired or already used");
    if (!(await this.verify(challenge.message, signature as Hex))) throw new Error("Wallet signature rejected");
    this.sweep();
    if (this.sessions.size >= 10_000) throw new Error("Too many sessions");
    const token = randomBytes(32).toString("hex");
    const session = { address: challenge.address, expires: this.now() + 60 * 60_000 };
    this.sessions.set(digest(token), session);
    return { token, address: session.address, expiresAt: session.expires };
  }

  session(token: unknown): Session | undefined {
    if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) return;
    const session = this.sessions.get(digest(token));
    if (!session || session.expires <= this.now()) {
      this.sessions.delete(digest(token));
      return;
    }
    return session;
  }
  logout(token: string) {
    this.sessions.delete(digest(token));
  }
  private sweep() {
    for (const [key, value] of this.challenges) if (value.expires <= this.now()) this.challenges.delete(key);
    for (const [key, value] of this.sessions) if (value.expires <= this.now()) this.sessions.delete(key);
  }
}
