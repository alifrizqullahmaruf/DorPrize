# Project instructions

- Read `context.md` before starting work. Update it after every task/checkpoint with changes, validation results, pending work and blockers. This is an explicit user requirement.
- The current target is native MON on Monad Testnet (10143), with MetaMask for product wallets. Legacy USDC contracts and UI adapters remain in the repo for compatibility; do not confuse their ABI, addresses, or six-decimal amounts with native MON.
- Start Monad tasks with the locally installed `monskill` routing skill and load only relevant topic skills. User decisions override skill defaults. Verify live network parameters against official Monad documentation.
- Native contract integration is documented in `sc/NATIVE_MON.md`. Do not claim deployment or wallet-to-wallet integration until receipts and live configuration have been verified.
- Keep available balance, bid escrow, skill reserve, treasury fees and split-pot dust separate. Dust ownership is unresolved; do not silently route it to treasury.
- Preserve the application's game UI unless the task authorizes UI changes. Do not upgrade the legacy USDC proxy to `NativeGameVault`; it is a separate deployment.
