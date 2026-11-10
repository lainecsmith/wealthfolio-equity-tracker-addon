# Equity Tracker Addon

Track Incentive Stock Options (ISOs), Non-Qualified Stock Options (NSOs), and Restricted Stock Units (RSUs) inside Wealthfolio.

## Features

- Import grants from Carta CSV (Securities Ledger / Grant Overview)
- Store unexercised grants privately in addon storage
- Vesting schedule generation (4-year / 1-year cliff monthly by default)
- Record vest (RSU) → creates external **TRANSFER_IN** at FMV cost basis
- Record exercise (ISO/NSO) → creates **BUY** at strike price
- Basic tax estimate notes (ordinary income / AMT bargain element)
- Private company support (manual 409A valuations via assets/quotes APIs)

## Setup

```bash
cd equity-tracker-addon
pnpm install
pnpm dev:server
```

Then open Wealthfolio in addon development mode (`VITE_ENABLE_ADDON_DEV_MODE=true pnpm tauri dev`) or install the packaged ZIP.

## Permissions

Declared in `manifest.json`:
- `accounts.getAll`
- `activities.create` / `activities.import`
- `financialAssets.*` (private company pricing)
- `quotes.update`

## Architecture

Unexercised grants live only in addon storage (`equity-grants` key). They appear on the Equity page. When you record a vest or exercise, the addon creates a core Wealthfolio activity so the shares show up in Holdings with the correct cost basis.
