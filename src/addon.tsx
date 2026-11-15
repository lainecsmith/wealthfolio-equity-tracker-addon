import { QueryClient, QueryClientProvider, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { AddonContext, AddonEnableFunction } from "@wealthfolio/addon-sdk";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@wealthfolio/ui";
import { useState } from "react";
import type { EquityGrant, GrantType } from "./types";
import { loadGrants, upsertGrant, deleteGrant, vestedQuantity, exercisedQuantity } from "./storage";
import { recordVestOrExercise, privateSymbol, createPrivateSecurity } from "./lib/activities";
import { applyExercise } from "./lib/exercise";
import { generateVesting, newId } from "./lib/vesting";

let addonCtx: AddonContext | undefined;

function EquityPage() {
  const ctx = addonCtx!;
  const queryClient = useQueryClient();

  // New grant form
  const [companyName, setCompanyName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [symbolResults, setSymbolResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [grantType, setGrantType] = useState<GrantType>("ISO");
  const [grantDate, setGrantDate] = useState(new Date().toISOString().slice(0, 10));
  const [totalQuantity, setTotalQuantity] = useState("");
  const [strikePrice, setStrikePrice] = useState("");
  const [fmv, setFmv] = useState("");
  const [privateAccountId, setPrivateAccountId] = useState("");
  const [cliffMonths, setCliffMonths] = useState("12");
  const [cliffPercent, setCliffPercent] = useState("25");
  const [postCliffMonths, setPostCliffMonths] = useState("36");

  // Record state
  const [selectedGrant, setSelectedGrant] = useState<EquityGrant | null>(null);
  const [vestQty, setVestQty] = useState("");
  const [vestDate, setVestDate] = useState(new Date().toISOString().slice(0, 10));
  const [accountId, setAccountId] = useState("");

  const grantsQuery = useQuery({
    queryKey: ["equity-grants"],
    queryFn: async () => {
      try {
        return await loadGrants(ctx);
      } catch (error) {
        throw new Error(`storage.get failed: ${String(error)}`);
      }
    },
  });
  const grants = grantsQuery.data ?? [];

  const accountsQuery = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => {
      try {
        return await ctx.api.accounts.getAll();
      } catch (error) {
        throw new Error(`accounts.getAll failed: ${String(error)}`);
      }
    },
  });
  const accounts = accountsQuery.data ?? [];

  const addGrantMutation = useMutation({
    mutationFn: async () => {
      const qty = Number(totalQuantity);
      if (!companyName || !grantDate || !qty || qty <= 0) throw new Error("Missing required fields");

      const cliffM = Math.max(0, Number(cliffMonths) || 0);
      const cliffP = Math.max(0, Math.min(100, Number(cliffPercent) || 0));
      const postM = Math.max(0, Number(postCliffMonths) || 0);
      const privateCompany = !symbol.trim();
      const price = Number(fmv);
      if (privateCompany && (!price || price <= 0)) throw new Error("Enter the current FMV");
      if (privateCompany && !privateAccountId) throw new Error("Choose an account for the private company");

      const now = new Date().toISOString();
      const createdSymbol = privateCompany
        ? await createPrivateSecurity(ctx, companyName, price, privateAccountId, grantDate)
        : undefined;
      const grant: EquityGrant = {
        id: newId(),
        type: grantType,
        companyName,
        symbol: symbol.trim() || createdSymbol,
        grantDate,
        totalQuantity: qty,
        strikePrice: grantType === "RSU" ? undefined : Number(strikePrice) || undefined,
        fmv: privateCompany ? price : undefined,
        vesting: generateVesting(qty, grantDate, cliffM, cliffP, postM),
        accountId: privateCompany ? privateAccountId : "",
        isPrivate: privateCompany,
        createdAt: now,
        updatedAt: now,
      };
      await upsertGrant(ctx, grant);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["equity-grants"] });
      setCompanyName("");
      setSymbol("");
      setTotalQuantity("");
      setStrikePrice("");
      setFmv("");
      setPrivateAccountId("");
      ctx.api.toast.success("Grant added");
    },
    onError: (e) => ctx.api.toast.error(String(e)),
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
      queryClient.invalidateQueries({ queryKey: ["equity-grants"] });
      setSelectedGrant(null);
      ctx.api.toast.success("Activity recorded");
    },
    onError: (e) => ctx.api.toast.error(String(e)),
  });

  if (grantsQuery.isLoading) return <div className="p-6">Loading equity grants…</div>;

  const loadError = grantsQuery.error ?? accountsQuery.error;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold">Equity Tracker</h1>
      {loadError && (
        <p className="text-sm text-destructive">{String(loadError.message || loadError)}</p>
      )}
      <p className="text-muted-foreground">
        Add grants with a cliff and vesting schedule. Vested amounts are calculated automatically.
      </p>

      {/* Add grant form */}
      <Card>
        <CardHeader>
          <CardTitle>Add Grant</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm">Company</label>
              <div className="flex gap-2">
                <input
                  className="flex-1 border rounded px-3 py-2"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Company name"
                  autoComplete="off"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!companyName || searching}
                  onClick={async () => {
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
                  }}
                >
                  {searching ? "…" : "Find"}
                </Button>
              </div>
              {symbolResults.length > 0 && (
                <div className="mt-1 border rounded max-h-40 overflow-auto text-sm">
                  {symbolResults.map((r: any, i: number) => (
                    <button
                      key={i}
                      type="button"
                      className="w-full text-left px-3 py-1.5 hover:bg-muted"
                      onClick={() => {
                        setSymbol(r.symbol || r.ticker || "");
                        setSymbolResults([]);
                      }}
                    >
                      <span className="font-medium">{r.symbol || r.ticker}</span>
                      {r.name && <span className="text-muted-foreground"> — {r.name}</span>}
                      {r.exchange && <span className="text-muted-foreground"> ({r.exchange})</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="text-sm">Symbol (optional)</label>
              <input
                className="w-full border rounded px-3 py-2"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                placeholder="Ticker (optional)"
                autoComplete="off"
                title="Leave this blank unless the security already exists in Wealthfolio. A blank symbol is generated from the company name and is not searched."
              />
              {(() => {
                const generated = privateSymbol(companyName);
                return (
                  <p className="text-xs text-muted-foreground mt-1">
                    {symbol.trim()
                      ? <>Will search for “{symbol.trim()}”. Clear this field to use the generated symbol instead.</>
                      : companyName.trim()
                        ? <>Symbol field is blank, so this grant will create “{generated}” at the FMV below.</>
                        : <>Leave Symbol blank to generate one from the company name.</>}
                  </p>
                );
              })()}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-sm">Type</label>
              <select
                className="w-full border rounded px-3 py-2"
                value={grantType}
                onChange={(e) => setGrantType(e.target.value as GrantType)}
              >
                <option value="ISO">ISO</option>
                <option value="NSO">NSO</option>
                <option value="RSU">RSU</option>
              </select>
            </div>
            <div>
              <label className="text-sm">Grant date</label>
              <input
                type="date"
                className="w-full border rounded px-3 py-2"
                value={grantDate}
                onChange={(e) => setGrantDate(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm">Total shares</label>
              <input
                type="number"
                className="w-full border rounded px-3 py-2"
                value={totalQuantity}
                onChange={(e) => setTotalQuantity(e.target.value)}
                placeholder="5000"
              />
            </div>
          </div>

          {grantType !== "RSU" && (
            <div>
              <label className="text-sm">Strike / exercise price</label>
              <input
                type="number"
                step="0.01"
                className="w-full border rounded px-3 py-2"
                value={strikePrice}
                onChange={(e) => setStrikePrice(e.target.value)}
                placeholder="Exercise price"
                autoComplete="off"
              />
            </div>
          )}

          {!symbol.trim() && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm">Current FMV</label>
                <input
                  type="number"
                  step="0.01"
                  className="w-full border rounded px-3 py-2"
                  value={fmv}
                  onChange={(e) => setFmv(e.target.value)}
                  placeholder="Share price"
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="text-sm">Account</label>
                <select
                  className="w-full border rounded px-3 py-2"
                  value={privateAccountId}
                  onChange={(e) => setPrivateAccountId(e.target.value)}
                >
                  <option value="">Choose an account</option>
                  {accounts.map((a: { id: string; name: string }) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-xs text-muted-foreground col-span-2">
                No ticker was chosen, so the add-on creates a private security priced at this FMV. Later exercises do not change that price.
              </p>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-sm">Cliff (months)</label>
              <input
                type="number"
                className="w-full border rounded px-3 py-2"
                value={cliffMonths}
                onChange={(e) => setCliffMonths(e.target.value)}
                placeholder="12"
              />
            </div>
            <div>
              <label className="text-sm">Cliff % that vests</label>
              <input
                type="number"
                className="w-full border rounded px-3 py-2"
                value={cliffPercent}
                onChange={(e) => setCliffPercent(e.target.value)}
                placeholder="25"
              />
            </div>
            <div>
              <label className="text-sm">Months after cliff (monthly)</label>
              <input
                type="number"
                className="w-full border rounded px-3 py-2"
                value={postCliffMonths}
                onChange={(e) => setPostCliffMonths(e.target.value)}
                placeholder="36"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Example: 12-month cliff with 25% vesting, then monthly for 36 months = classic 4-year schedule.
          </p>

          <Button onClick={() => addGrantMutation.mutate()} disabled={addGrantMutation.isPending}>
            {addGrantMutation.isPending ? "Adding…" : "Add Grant"}
          </Button>
        </CardContent>
      </Card>

      {/* Grants list */}
      <div className="space-y-3">
        {grants.length === 0 && <p className="text-muted-foreground">No grants yet.</p>}
        {grants.map((g) => {
          const vested = vestedQuantity(g);
          const exercised = exercisedQuantity(g);
          return (
            <Card key={g.id}>
              <CardContent className="pt-4 flex justify-between items-start">
                <div>
                  <div className="font-semibold">
                    {g.type} – {g.companyName}
                    {g.symbol && <span className="text-muted-foreground"> ({g.symbol})</span>}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Grant {g.grantDate} · {g.totalQuantity.toLocaleString()} total ·{" "}
                    {vested.toLocaleString()} vested · {exercised.toLocaleString()} exercised
                    {g.strikePrice != null && ` · Strike $${g.strikePrice}`}
                    {g.fmv != null && ` · FMV $${g.fmv}`}
                  </div>
                </div>
                <div className="space-x-2">
                  <Button size="sm" variant="outline" onClick={() => setSelectedGrant(g)}>
                    Record Vest / Exercise
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      try {
                        await deleteGrant(ctx, g.id);
                        queryClient.invalidateQueries({ queryKey: ["equity-grants"] });
                        ctx.api.toast.success("Grant deleted");
                      } catch (e) {
                        ctx.api.toast.error(String(e));
                      }
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Record form */}
      {selectedGrant && (
        <Card>
          <CardHeader>
            <CardTitle>
              Record {selectedGrant.type === "RSU" ? "Vest" : "Exercise"} – {selectedGrant.companyName}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm">Quantity</label>
                <input
                  type="number"
                  className="w-full border rounded px-3 py-2"
                  value={vestQty}
                  placeholder="0"
                  onChange={(e) => setVestQty(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm">Date</label>
                <input
                  type="date"
                  className="w-full border rounded px-3 py-2"
                  value={vestDate}
                  onChange={(e) => setVestDate(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="text-sm">Account</label>
              <div className="flex gap-2">
                <select
                  className="flex-1 border rounded px-3 py-2"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                >
                  <option value="">Select account…</option>
                  {accounts.map((a: any) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <Button type="button" variant="outline" size="sm" onClick={() => accountsQuery.refetch()}>
                  Refresh
                </Button>
              </div>
            </div>
            <div className="space-x-2">
              <Button onClick={() => recordMutation.mutate()} disabled={recordMutation.isPending}>
                {recordMutation.isPending ? "Recording…" : "Create Activity"}
              </Button>
              <Button variant="outline" onClick={() => setSelectedGrant(null)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

const queryClient = new QueryClient();

function EquityRoute() {
  return (
    <QueryClientProvider client={queryClient}>
      <EquityPage />
    </QueryClientProvider>
  );
}

const enable: AddonEnableFunction = (ctx) => {
  addonCtx = ctx;

  ctx.router.add({
    id: "equity",
    path: "/addons/equity-tracker",
    component: EquityRoute,
  });

  ctx.onDisable(() => {
    addonCtx = undefined;
  });
};

export default enable;
