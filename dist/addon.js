import { QueryClient, QueryClientProvider, useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent, Button } from "@wealthfolio/ui";
import { useState } from "react";
var jsxRuntime = { exports: {} };
var reactJsxRuntime_production = {};
/**
 * @license React
 * react-jsx-runtime.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var REACT_ELEMENT_TYPE = Symbol.for("react.transitional.element"), REACT_FRAGMENT_TYPE = Symbol.for("react.fragment");
function jsxProd(type, config, maybeKey) {
  var key = null;
  void 0 !== maybeKey && (key = "" + maybeKey);
  void 0 !== config.key && (key = "" + config.key);
  if ("key" in config) {
    maybeKey = {};
    for (var propName in config)
      "key" !== propName && (maybeKey[propName] = config[propName]);
  } else maybeKey = config;
  config = maybeKey.ref;
  return {
    $$typeof: REACT_ELEMENT_TYPE,
    type,
    key,
    ref: void 0 !== config ? config : null,
    props: maybeKey
  };
}
reactJsxRuntime_production.Fragment = REACT_FRAGMENT_TYPE;
reactJsxRuntime_production.jsx = jsxProd;
reactJsxRuntime_production.jsxs = jsxProd;
{
  jsxRuntime.exports = reactJsxRuntime_production;
}
var jsxRuntimeExports = jsxRuntime.exports;
const STORAGE_KEY = "equity-grants";
async function loadGrants(ctx) {
  const raw = await ctx.api.storage.get(STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}
async function saveGrants(ctx, grants) {
  await ctx.api.storage.set(STORAGE_KEY, JSON.stringify(grants));
}
async function upsertGrant(ctx, grant) {
  const grants = await loadGrants(ctx);
  const idx = grants.findIndex((g) => g.id === grant.id);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  if (idx >= 0) {
    grants[idx] = { ...grant, updatedAt: now };
  } else {
    grants.push({ ...grant, createdAt: now, updatedAt: now });
  }
  await saveGrants(ctx, grants);
}
async function deleteGrant(ctx, id) {
  const grants = await loadGrants(ctx);
  await saveGrants(ctx, grants.filter((g) => g.id !== id));
}
function vestedQuantity(grant, asOf = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10)) {
  return grant.vesting.filter((t) => t.date <= asOf && t.vested !== false).reduce((sum, t) => sum + t.quantity, 0);
}
function exercisedQuantity(grant) {
  return grant.exercisedQuantity ?? 0;
}
function privateSymbol(companyName) {
  const cleaned = companyName.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return (cleaned || "PRIVATE").slice(0, 12);
}
async function resolveSymbol(ctx, symbol) {
  let results;
  try {
    results = await ctx.api.market.searchTicker(symbol);
  } catch (error) {
    throw new Error(`market.searchTicker failed: ${String(error)}`);
  }
  try {
    const hits = Array.isArray(results) ? results : results ? [results] : [];
    const exact = hits.find(
      (h) => (h.symbol || "").toUpperCase() === symbol.toUpperCase()
    );
    if (exact) {
      return {
        symbol: exact.symbol || symbol,
        currency: exact.currency || "USD",
        listed: true,
        exchangeMic: exact.exchangeMic,
        existingAssetId: exact.existingAssetId,
        instrumentType: exact.instrumentType || exact.quoteType
      };
    }
  } catch (error) {
    throw new Error(`market.searchTicker failed: ${String(error)}`);
  }
  return { symbol, currency: "USD", listed: false };
}
function assetFor(grant, listing) {
  if (listing.existingAssetId) {
    return { id: listing.existingAssetId };
  }
  if (listing.listed) {
    return {
      symbol: listing.symbol,
      name: grant.companyName,
      quoteCcy: listing.currency,
      instrumentType: listing.instrumentType || "EQUITY",
      ...listing.exchangeMic ? { exchangeMic: listing.exchangeMic } : {}
    };
  }
  return {
    symbol: listing.symbol,
    name: grant.companyName,
    kind: "OTHER",
    quoteCcy: "USD",
    quoteMode: "MANUAL"
  };
}
function plainActivity(activity) {
  const asset = activity.asset;
  const payload = {
    accountId: String(activity.accountId ?? ""),
    activityType: String(activity.activityType ?? ""),
    activityDate: String(activity.activityDate ?? ""),
    amount: Number(activity.amount ?? 0),
    currency: String(activity.currency ?? "USD"),
    status: "POSTED"
  };
  if (activity.quantity !== void 0) payload.quantity = Number(activity.quantity);
  if (activity.unitPrice !== void 0) payload.unitPrice = Number(activity.unitPrice);
  if (asset) {
    const next = {};
    for (const key of [
      "id",
      "symbol",
      "name",
      "quoteCcy",
      "instrumentType",
      "exchangeMic",
      "kind",
      "quoteMode"
    ]) {
      const value = asset[key];
      if (typeof value === "string" && value) next[key] = value;
    }
    payload.asset = next;
  }
  return payload;
}
async function latestManualPrice(ctx, symbol) {
  var _a;
  const getHistory = (_a = ctx.api.quotes) == null ? void 0 : _a.getHistory;
  if (!getHistory || !symbol) return void 0;
  try {
    const history = await getHistory(symbol);
    const quotes = Array.isArray(history) ? history : [];
    let best;
    for (const quote of quotes) {
      const close = Number((quote == null ? void 0 : quote.close) ?? (quote == null ? void 0 : quote.adjclose));
      const time = String((quote == null ? void 0 : quote.timestamp) ?? "");
      if (!Number.isFinite(close) || close <= 0) continue;
      if (!best || time > best.time) best = { time, close };
    }
    return best == null ? void 0 : best.close;
  } catch {
    return void 0;
  }
}
async function restoreManualPrice(ctx, assetId, price, currency) {
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  await ctx.api.quotes.update(assetId, {
    id: "",
    createdAt: timestamp,
    dataSource: "MANUAL",
    timestamp,
    assetId,
    open: price,
    high: price,
    low: price,
    close: price,
    adjclose: price,
    volume: 0,
    currency
  });
}
async function createActivity(ctx, activity) {
  const payload = plainActivity(activity);
  try {
    return await ctx.api.activities.create(payload);
  } catch (error) {
    throw new Error(`activities.create failed: ${String(error)}`);
  }
}
async function recordVestOrExercise(ctx, grant, quantity, date, accountId) {
  var _a;
  if (quantity <= 0) throw new Error("Quantity must be positive");
  const typedSymbol = (_a = grant.symbol) == null ? void 0 : _a.trim();
  const listing = typedSymbol ? await resolveSymbol(ctx, typedSymbol) : { symbol: privateSymbol(grant.companyName), currency: "USD", listed: false };
  const asset = assetFor(grant, listing);
  const currency = listing.listed ? listing.currency : "USD";
  const strike = grant.strikePrice ?? 0;
  if (grant.type === "RSU") {
    const activity2 = await createActivity(ctx, {
      accountId,
      activityType: "TRANSFER_IN",
      activityDate: date,
      asset,
      quantity,
      unitPrice: 0,
      amount: 0,
      currency
    });
    return activity2.id;
  }
  const savedPrice = listing.listed ? void 0 : await latestManualPrice(ctx, listing.symbol);
  const cost = quantity * strike;
  const activity = await createActivity(ctx, {
    accountId,
    activityType: "BUY",
    activityDate: date,
    asset,
    quantity,
    unitPrice: strike,
    amount: cost,
    currency
  });
  if (cost > 0) {
    try {
      await createActivity(ctx, {
        accountId,
        activityType: "DEPOSIT",
        activityDate: date,
        amount: cost,
        currency,
        status: "POSTED"
      });
    } catch {
    }
  }
  const assetId = (activity == null ? void 0 : activity.assetId) || listing.existingAssetId || listing.symbol;
  if (!listing.listed && savedPrice !== void 0 && savedPrice !== strike && assetId) {
    try {
      await restoreManualPrice(ctx, assetId, savedPrice, currency);
    } catch {
    }
  }
  return activity.id;
}
function applyExercise(grant, quantity, date, activityId) {
  return {
    ...grant,
    exercisedQuantity: (grant.exercisedQuantity ?? 0) + quantity,
    vesting: grant.vesting.map(
      (t) => t.date === date && !t.activityId ? { ...t, activityId, vested: true } : t
    )
  };
}
function newId() {
  var _a;
  return ((_a = crypto.randomUUID) == null ? void 0 : _a.call(crypto)) ?? Math.random().toString(36).slice(2);
}
function addMonths(iso, months) {
  const d = /* @__PURE__ */ new Date(iso + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}
function generateVesting(totalQty, startDate, cliffMonths, cliffPercent, postCliffMonths, options = {}) {
  const asOf = options.asOf ?? (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const id = options.id ?? newId;
  const tranches = [];
  const cliffQty = cliffMonths > 0 ? Math.floor(totalQty * (cliffPercent / 100)) : 0;
  const remaining = totalQty - cliffQty;
  if (cliffMonths > 0 && cliffQty > 0) {
    const cliffDate = addMonths(startDate, cliffMonths);
    tranches.push({
      id: id(),
      date: cliffDate,
      quantity: cliffQty,
      vested: cliffDate <= asOf
    });
  }
  if (postCliffMonths > 0 && remaining > 0) {
    const perMonth = Math.floor(remaining / postCliffMonths);
    let leftover = remaining - perMonth * postCliffMonths;
    const firstPost = cliffMonths + 1;
    for (let i = 0; i < postCliffMonths; i++) {
      const qty = perMonth + (leftover > 0 ? 1 : 0);
      if (leftover > 0) leftover--;
      if (qty <= 0) continue;
      const date = addMonths(startDate, firstPost + i);
      tranches.push({
        id: id(),
        date,
        quantity: qty,
        vested: date <= asOf
      });
    }
  } else if (cliffMonths === 0 && remaining > 0) {
    tranches.push({
      id: id(),
      date: startDate,
      quantity: remaining,
      vested: startDate <= asOf
    });
  }
  return tranches;
}
let addonCtx;
function EquityPage() {
  const ctx = addonCtx;
  const queryClient2 = useQueryClient();
  const [companyName, setCompanyName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [symbolResults, setSymbolResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [grantType, setGrantType] = useState("ISO");
  const [grantDate, setGrantDate] = useState((/* @__PURE__ */ new Date()).toISOString().slice(0, 10));
  const [totalQuantity, setTotalQuantity] = useState("");
  const [strikePrice, setStrikePrice] = useState("");
  const [cliffMonths, setCliffMonths] = useState("12");
  const [cliffPercent, setCliffPercent] = useState("25");
  const [postCliffMonths, setPostCliffMonths] = useState("36");
  const [selectedGrant, setSelectedGrant] = useState(null);
  const [vestQty, setVestQty] = useState("");
  const [vestDate, setVestDate] = useState((/* @__PURE__ */ new Date()).toISOString().slice(0, 10));
  const [accountId, setAccountId] = useState("");
  const { data: grants = [], isLoading } = useQuery({
    queryKey: ["equity-grants"],
    queryFn: () => loadGrants(ctx)
  });
  const { data: accounts = [], refetch: refetchAccounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => ctx.api.accounts.getAll()
  });
  const addGrantMutation = useMutation({
    mutationFn: async () => {
      const qty = Number(totalQuantity);
      if (!companyName || !grantDate || !qty || qty <= 0) throw new Error("Missing required fields");
      const cliffM = Math.max(0, Number(cliffMonths) || 0);
      const cliffP = Math.max(0, Math.min(100, Number(cliffPercent) || 0));
      const postM = Math.max(0, Number(postCliffMonths) || 0);
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const grant = {
        id: newId(),
        type: grantType,
        companyName,
        symbol: symbol.trim() || void 0,
        grantDate,
        totalQuantity: qty,
        strikePrice: grantType === "RSU" ? void 0 : Number(strikePrice) || void 0,
        vesting: generateVesting(qty, grantDate, cliffM, cliffP, postM),
        accountId: "",
        isPrivate: !symbol.trim(),
        createdAt: now,
        updatedAt: now
      };
      await upsertGrant(ctx, grant);
    },
    onSuccess: () => {
      queryClient2.invalidateQueries({ queryKey: ["equity-grants"] });
      setCompanyName("");
      setSymbol("");
      setTotalQuantity("");
      setStrikePrice("");
      ctx.api.toast.success("Grant added");
    },
    onError: (e) => ctx.api.toast.error(String(e))
  });
  const recordMutation = useMutation({
    mutationFn: async () => {
      const qty = Number(vestQty);
      if (!selectedGrant || !accountId || !qty || qty <= 0) throw new Error("Missing fields");
      const activityId = await recordVestOrExercise(ctx, selectedGrant, qty, vestDate, accountId);
      await upsertGrant(ctx, applyExercise(selectedGrant, qty, vestDate, activityId));
      return activityId;
    },
    onSuccess: () => {
      queryClient2.invalidateQueries({ queryKey: ["equity-grants"] });
      setSelectedGrant(null);
      ctx.api.toast.success("Activity recorded");
    },
    onError: (e) => ctx.api.toast.error(String(e))
  });
  if (isLoading) return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "p-6", children: "Loading equity grants…" });
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "p-6 max-w-5xl mx-auto space-y-6", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx("h1", { className: "text-3xl font-bold", children: "Equity Tracker" }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-muted-foreground", children: "Add grants with a cliff and vesting schedule. Vested amounts are calculated automatically." }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs(Card, { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(CardHeader, { children: /* @__PURE__ */ jsxRuntimeExports.jsx(CardTitle, { children: "Add Grant" }) }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs(CardContent, { className: "space-y-3", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid grid-cols-2 gap-3", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("label", { className: "text-sm", children: "Company" }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex gap-2", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx(
                "input",
                {
                  className: "flex-1 border rounded px-3 py-2",
                  value: companyName,
                  onChange: (e) => setCompanyName(e.target.value),
                  placeholder: "Company name",
                  autoComplete: "off"
                }
              ),
              /* @__PURE__ */ jsxRuntimeExports.jsx(
                Button,
                {
                  type: "button",
                  variant: "outline",
                  size: "sm",
                  disabled: !companyName || searching,
                  onClick: async () => {
                    setSearching(true);
                    setSymbolResults([]);
                    try {
                      const results = await ctx.api.market.searchTicker(companyName);
                      setSymbolResults(Array.isArray(results) ? results.slice(0, 8) : []);
                    } catch (e) {
                      ctx.api.toast.error(String(e));
                    } finally {
                      setSearching(false);
                    }
                  },
                  children: searching ? "…" : "Find"
                }
              )
            ] }),
            symbolResults.length > 0 && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "mt-1 border rounded max-h-40 overflow-auto text-sm", children: symbolResults.map((r, i) => /* @__PURE__ */ jsxRuntimeExports.jsxs(
              "button",
              {
                type: "button",
                className: "w-full text-left px-3 py-1.5 hover:bg-muted",
                onClick: () => {
                  setSymbol(r.symbol || r.ticker || "");
                  setSymbolResults([]);
                },
                children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "font-medium", children: r.symbol || r.ticker }),
                  r.name && /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "text-muted-foreground", children: [
                    " — ",
                    r.name
                  ] }),
                  r.exchange && /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "text-muted-foreground", children: [
                    " (",
                    r.exchange,
                    ")"
                  ] })
                ]
              },
              i
            )) })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("label", { className: "text-sm", children: "Symbol (optional)" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              "input",
              {
                className: "w-full border rounded px-3 py-2",
                value: symbol,
                onChange: (e) => setSymbol(e.target.value),
                placeholder: "Ticker (optional)",
                autoComplete: "off",
                title: "Leave this blank unless the security already exists in Wealthfolio. A blank symbol is generated from the company name and is not searched."
              }
            ),
            (() => {
              const generated = privateSymbol(companyName);
              return /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-muted-foreground mt-1", children: symbol.trim() ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
                "Will search for “",
                symbol.trim(),
                "”. Clear this field to use the generated symbol instead."
              ] }) : companyName.trim() ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
                "Symbol field is blank, so an exercise will create “",
                generated,
                "” without searching."
              ] }) : /* @__PURE__ */ jsxRuntimeExports.jsx(jsxRuntimeExports.Fragment, { children: "Leave Symbol blank to generate one from the company name." }) });
            })()
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid grid-cols-3 gap-3", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("label", { className: "text-sm", children: "Type" }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs(
              "select",
              {
                className: "w-full border rounded px-3 py-2",
                value: grantType,
                onChange: (e) => setGrantType(e.target.value),
                children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx("option", { value: "ISO", children: "ISO" }),
                  /* @__PURE__ */ jsxRuntimeExports.jsx("option", { value: "NSO", children: "NSO" }),
                  /* @__PURE__ */ jsxRuntimeExports.jsx("option", { value: "RSU", children: "RSU" })
                ]
              }
            )
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("label", { className: "text-sm", children: "Grant date" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              "input",
              {
                type: "date",
                className: "w-full border rounded px-3 py-2",
                value: grantDate,
                onChange: (e) => setGrantDate(e.target.value)
              }
            )
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("label", { className: "text-sm", children: "Total shares" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              "input",
              {
                type: "number",
                className: "w-full border rounded px-3 py-2",
                value: totalQuantity,
                onChange: (e) => setTotalQuantity(e.target.value),
                placeholder: "5000"
              }
            )
          ] })
        ] }),
        grantType !== "RSU" && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("label", { className: "text-sm", children: "Strike / exercise price" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            "input",
            {
              type: "number",
              step: "0.01",
              className: "w-full border rounded px-3 py-2",
              value: strikePrice,
              onChange: (e) => setStrikePrice(e.target.value),
              placeholder: "Exercise price",
              autoComplete: "off"
            }
          )
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid grid-cols-3 gap-3", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("label", { className: "text-sm", children: "Cliff (months)" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              "input",
              {
                type: "number",
                className: "w-full border rounded px-3 py-2",
                value: cliffMonths,
                onChange: (e) => setCliffMonths(e.target.value),
                placeholder: "12"
              }
            )
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("label", { className: "text-sm", children: "Cliff % that vests" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              "input",
              {
                type: "number",
                className: "w-full border rounded px-3 py-2",
                value: cliffPercent,
                onChange: (e) => setCliffPercent(e.target.value),
                placeholder: "25"
              }
            )
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("label", { className: "text-sm", children: "Months after cliff (monthly)" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              "input",
              {
                type: "number",
                className: "w-full border rounded px-3 py-2",
                value: postCliffMonths,
                onChange: (e) => setPostCliffMonths(e.target.value),
                placeholder: "36"
              }
            )
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-xs text-muted-foreground", children: "Example: 12-month cliff with 25% vesting, then monthly for 36 months = classic 4-year schedule." }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { onClick: () => addGrantMutation.mutate(), disabled: addGrantMutation.isPending, children: addGrantMutation.isPending ? "Adding…" : "Add Grant" })
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-y-3", children: [
      grants.length === 0 && /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "text-muted-foreground", children: "No grants yet." }),
      grants.map((g) => {
        const vested = vestedQuantity(g);
        const exercised = exercisedQuantity(g);
        return /* @__PURE__ */ jsxRuntimeExports.jsx(Card, { children: /* @__PURE__ */ jsxRuntimeExports.jsxs(CardContent, { className: "pt-4 flex justify-between items-start", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "font-semibold", children: [
              g.type,
              " – ",
              g.companyName,
              g.symbol && /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "text-muted-foreground", children: [
                " (",
                g.symbol,
                ")"
              ] })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "text-sm text-muted-foreground", children: [
              "Grant ",
              g.grantDate,
              " · ",
              g.totalQuantity.toLocaleString(),
              " total ·",
              " ",
              vested.toLocaleString(),
              " vested · ",
              exercised.toLocaleString(),
              " exercised",
              g.strikePrice != null && ` · Strike $${g.strikePrice}`
            ] })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-x-2", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { size: "sm", variant: "outline", onClick: () => setSelectedGrant(g), children: "Record Vest / Exercise" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              Button,
              {
                size: "sm",
                variant: "ghost",
                onClick: async () => {
                  try {
                    await deleteGrant(ctx, g.id);
                    queryClient2.invalidateQueries({ queryKey: ["equity-grants"] });
                    ctx.api.toast.success("Grant deleted");
                  } catch (e) {
                    ctx.api.toast.error(String(e));
                  }
                },
                children: "Delete"
              }
            )
          ] })
        ] }) }, g.id);
      })
    ] }),
    selectedGrant && /* @__PURE__ */ jsxRuntimeExports.jsxs(Card, { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(CardHeader, { children: /* @__PURE__ */ jsxRuntimeExports.jsxs(CardTitle, { children: [
        "Record ",
        selectedGrant.type === "RSU" ? "Vest" : "Exercise",
        " – ",
        selectedGrant.companyName
      ] }) }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs(CardContent, { className: "space-y-3", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "grid grid-cols-2 gap-3", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("label", { className: "text-sm", children: "Quantity" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              "input",
              {
                type: "number",
                className: "w-full border rounded px-3 py-2",
                value: vestQty,
                placeholder: "0",
                onChange: (e) => setVestQty(e.target.value)
              }
            )
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("label", { className: "text-sm", children: "Date" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              "input",
              {
                type: "date",
                className: "w-full border rounded px-3 py-2",
                value: vestDate,
                onChange: (e) => setVestDate(e.target.value)
              }
            )
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("label", { className: "text-sm", children: "Account" }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "flex gap-2", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs(
              "select",
              {
                className: "flex-1 border rounded px-3 py-2",
                value: accountId,
                onChange: (e) => setAccountId(e.target.value),
                children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx("option", { value: "", children: "Select account…" }),
                  accounts.map((a) => /* @__PURE__ */ jsxRuntimeExports.jsx("option", { value: a.id, children: a.name }, a.id))
                ]
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { type: "button", variant: "outline", size: "sm", onClick: () => refetchAccounts(), children: "Refresh" })
          ] })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "space-x-2", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { onClick: () => recordMutation.mutate(), disabled: recordMutation.isPending, children: recordMutation.isPending ? "Recording…" : "Create Activity" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(Button, { variant: "outline", onClick: () => setSelectedGrant(null), children: "Cancel" })
        ] })
      ] })
    ] })
  ] });
}
const queryClient = new QueryClient();
function EquityRoute() {
  return /* @__PURE__ */ jsxRuntimeExports.jsx(QueryClientProvider, { client: queryClient, children: /* @__PURE__ */ jsxRuntimeExports.jsx(EquityPage, {}) });
}
const enable = (ctx) => {
  addonCtx = ctx;
  ctx.router.add({
    id: "equity",
    path: "/addons/equity-tracker",
    component: EquityRoute
  });
  ctx.onDisable(() => {
    addonCtx = void 0;
  });
};
export {
  enable as default
};
//# sourceMappingURL=addon.js.map
