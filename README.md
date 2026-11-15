# Equity Tracker Addon

Track Incentive Stock Options (ISOs), Non-Qualified Stock Options (NSOs), and Restricted Stock Units (RSUs) inside Wealthfolio.

## Features

- Import grants from Carta CSV (Securities Ledger / Grant Overview)
- Store unexercised grants privately in addon storage
- Vesting schedule generation (4-year / 1-year cliff monthly by default)
- Record vest (RSU) → creates external **TRANSFER_IN**
- Record exercise (ISO/NSO) → creates **BUY** at strike price
- Private company support (create the security in Wealthfolio and set its price)

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

## Linking grants to securities

The addon links a grant to a Wealthfolio security by **exact symbol match**.

- If you enter a symbol on the grant (or pick one from the Find results), recording a vest/exercise uses that symbol.
- If the symbol does not exist yet, creating the activity auto-creates a minimal security as a side effect (Wealthfolio’s `get_or_create_minimal_asset` path). You do not need to create the security first.
- If you leave the symbol blank, the addon generates a short symbol from the company name and the same auto-create behavior applies.
- After the first activity, set the security’s price (Price History) if you want the holding valued at something other than the strike. The exercise itself is always recorded at the strike.

Unexercised grants live only in addon storage (`equity-grants` key). They appear on the Equity page. When you record a vest or exercise, the addon creates a core Wealthfolio activity so the shares show up in Holdings with the correct cost basis.

## Troubleshooting

### “Quote currency is required. Select the asset from the search results.”

This error comes from Wealthfolio, not the addon. It means the asset profile for the symbol has no quote currency set.

**Fix (one-time per symbol):**

1. In Wealthfolio go to **Settings → Securities**.
2. Search for the symbol (e.g. `ACME` or whatever ticker you used).
3. Open it and set **Currency** to the correct value (usually `USD`).
4. Save.

After the currency is set on the asset, recording a vest or exercise from the addon should succeed. You only need to do this once per symbol.
