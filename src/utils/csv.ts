import type { EquityGrant, VestingTranche } from "../types";

// Re-export of the parser (copied from earlier conversation for self-containment)
// In a real project this can live in utils/carta-csv.ts

export interface ImportResult {
  grants: EquityGrant[];
  warnings: string[];
}

const HEADER_ALIASES: Record<string, string[]> = {
  externalId: ["grant id", "id", "label", "security id", "grant_id"],
  type: ["type", "award type", "security type"],
  grantDate: ["grant date", "issue date", "date granted"],
  totalQuantity: ["options granted", "quantity", "# shares", "shares", "options", "granted"],
  strikePrice: ["exercise price", "strike", "cost/share"],
  expirationDate: ["expiration date", "expires"],
  vestingStart: ["vesting commencement date", "vesting start"],
  vestingSchedule: ["vesting schedule", "vesting type"],
  companyName: ["company", "issuer", "company name"],
  symbol: ["symbol", "ticker"],
};

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function buildHeaderMap(headers: string[]): Map<string, string> {
  const map = new Map<string, string>();
  const normalized = headers.map(normalizeHeader);
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    for (const alias of aliases) {
      const idx = normalized.indexOf(alias);
      if (idx !== -1) {
        map.set(field, headers[idx]);
        break;
      }
    }
  }
  return map;
}

function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { headers: [], rows: [] };

  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (c === "," && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else current += c;
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map((line) => {
    const values = parseLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ""; });
    return row;
  });
  return { headers, rows };
}

function toIsoDate(raw: string): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned;
  const m = cleaned.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    const y = m[3];
    const month = a > 12 ? b : a;
    const day = a > 12 ? a : b;
    return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return undefined;
}

function toNumber(raw: string): number | undefined {
  if (!raw) return undefined;
  const n = parseFloat(raw.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

function mapGrantType(raw: string): "RSU" | "ISO" | "NSO" | undefined {
  const s = raw.toLowerCase();
  if (s.includes("rsu")) return "RSU";
  if (s.includes("iso")) return "ISO";
  if (s.includes("nso") || s.includes("non")) return "NSO";
  return undefined;
}

function uuid(): string {
  return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
}

function generateSimpleVesting(totalQty: number, start: string): VestingTranche[] {
  // Default 4-year monthly after 1-year cliff
  const cliffQty = Math.floor(totalQty * 0.25);
  const remaining = totalQty - cliffQty;
  const perMonth = Math.floor(remaining / 36);
  let leftover = remaining - perMonth * 36;
  const tranches: VestingTranche[] = [];

  const addMonths = (iso: string, m: number) => {
    const d = new Date(iso + "T00:00:00Z");
    d.setUTCMonth(d.getUTCMonth() + m);
    return d.toISOString().slice(0, 10);
  };

  const today = new Date().toISOString().slice(0, 10);
  const cliffDate = addMonths(start, 12);
  tranches.push({
    id: uuid(),
    date: cliffDate,
    quantity: cliffQty,
    vested: cliffDate <= today,
  });

  for (let m = 13; m <= 48; m++) {
    const qty = perMonth + (leftover > 0 ? 1 : 0);
    if (leftover > 0) leftover--;
    if (qty <= 0) continue;
    const d = addMonths(start, m);
    tranches.push({ id: uuid(), date: d, quantity: qty, vested: d <= today });
  }
  return tranches;
}

export function parseCartaCsv(csvText: string, fallbackCompany?: string): ImportResult {
  const { headers, rows } = parseCsv(csvText);
  const headerMap = buildHeaderMap(headers);
  const warnings: string[] = [];
  const grants: EquityGrant[] = [];
  const now = new Date().toISOString();

  for (const [i, row] of rows.entries()) {
    const get = (field: string) => {
      const col = headerMap.get(field);
      return col ? (row[col] ?? "").trim() : "";
    };

    const type = mapGrantType(get("type"));
    const grantDate = toIsoDate(get("grantDate"));
    const totalQuantity = toNumber(get("totalQuantity"));
    const companyName = get("companyName") || fallbackCompany;

    if (!type || !grantDate || !totalQuantity || totalQuantity <= 0 || !companyName) {
      warnings.push(`Row ${i + 2}: skipped`);
      continue;
    }

    const vestingStart = toIsoDate(get("vestingStart")) ?? grantDate;
    const grant: EquityGrant = {
      id: uuid(),
      externalId: get("externalId") || undefined,
      type,
      companyName,
      symbol: get("symbol") || undefined,
      grantDate,
      totalQuantity,
      strikePrice: type === "RSU" ? undefined : toNumber(get("strikePrice")),
      expirationDate: toIsoDate(get("expirationDate")),
      vesting: generateSimpleVesting(totalQuantity, vestingStart),
      accountId: "",
      isPrivate: !get("symbol"),
      notes: get("vestingSchedule") ? `Schedule: ${get("vestingSchedule")}` : undefined,
      createdAt: now,
      updatedAt: now,
    };
    grants.push(grant);
  }

  if (!grants.length) warnings.push("No valid grants parsed");
  return { grants, warnings };
}
