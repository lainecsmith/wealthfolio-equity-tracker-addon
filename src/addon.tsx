import { QueryClientProvider, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import type { AddonContext, AddonEnableFunction } from "@wealthfolio/addon-sdk";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@wealthfolio/ui";
import { useState } from "react";
import type { EquityGrant } from "./types";
import { loadGrants, upsertGrant, deleteGrant, vestedQuantity, getLatestValuation } from "./storage";
import { parseCartaCsv } from "./utils/csv";
import { recordVestOrExercise, estimateTax } from "./utils/activities";

let addonCtx: AddonContext | undefined;

function EquityPage() {
  const ctx = addonCtx!;
  const queryClient = useQueryClient();
  const [companyName, setCompanyName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [selectedGrant, setSelectedGrant] = useState<EquityGrant | null>(null);
  const [vestQty, setVestQty] = useState("");
  const [vestDate, setVestDate] = useState(new Date().toISOString().slice(0, 10));
  const [accountId, setAccountId] = useState("");
  const [valGrant, setValGrant] = useState<EquityGrant | null>(null);
  const [valDate, setValDate] = useState(new Date().toISOString().slice(0, 10));
  const [valFmv, setValFmv] = useState("");

  const { data: grants = [], isLoading } = useQuery({
    queryKey: ["equity-grants"],
    queryFn: () => loadGrants(ctx),
  });

  const { data: accounts = [], refetch: refetchAccounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => ctx.api.accounts.getAll(),
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      const result = parseCartaCsv(csvText, companyName || undefined);
      for (const g of result.grants) {
        await upsertGrant(ctx, g);
      }
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["equity-grants"] });
      setCsvText("");
      ctx.api.toast.success("Grants imported");
    },
    onError: (e) => ctx.api.toast.error(String(e)),
  });

  const recordMutation = useMutation({
    mutationFn: async () => {
      const qty = Number(vestQty);
      if (!selectedGrant || !accountId || !qty || qty <= 0) throw new Error("Missing fields");
      const activityId = await recordVestOrExercise(
        ctx,
        selectedGrant,
        qty,
        vestDate,
        accountId
      );
      // Mark matching tranche(s) as recorded
      const updated = {
        ...selectedGrant,
        vesting: selectedGrant.vesting.map((t) =>
          t.date === vestDate && !t.activityId ? { ...t, activityId, vested: true } : t
        ),
      };
      await upsertGrant(ctx, updated);
      return activityId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["equity-grants"] });
      setSelectedGrant(null);
      ctx.api.toast.success("Activity recorded");
    },
    onError: (e) => ctx.api.toast.error(String(e)),
  });

  const addValuationMutation = useMutation({
    mutationFn: async () => {
      const fmv = Number(valFmv);
      if (!valGrant || !fmv || fmv <= 0) throw new Error("Missing FMV");
      const updated: EquityGrant = {
        ...valGrant,
        valuations: [...(valGrant.valuations ?? []), { date: valDate, fmvPerShare: fmv }],
      };
      await upsertGrant(ctx, updated);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["equity-grants"] });
      setValGrant(null);
      setValFmv("");
      ctx.api.toast.success("Valuation added");
    },
    onError: (e) => ctx.api.toast.error(String(e)),
  });

  if (isLoading) return <div className="p-6">Loading equity grants…</div>;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <h1 className="text-3xl font-bold">Equity Tracker</h1>
      <p className="text-muted-foreground">
        ISOs, NSOs, and RSUs. Unexercised grants live here. Vest/exercise creates core activities.
      </p>

      {/* Import */}
      <Card>
        <CardHeader>
          <CardTitle>Import from Carta CSV</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            className="w-full border rounded px-3 py-2"
            placeholder="Company name (if not in CSV)"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
          />
          <textarea
            className="w-full border rounded px-3 py-2 font-mono text-sm h-32"
            placeholder="Paste Carta securities ledger / grant overview CSV…"
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
          />
          <Button onClick={() => importMutation.mutate()} disabled={!csvText || importMutation.isPending}>
            {importMutation.isPending ? "Importing…" : "Import Grants"}
          </Button>
        </CardContent>
      </Card>

      {/* Grants list */}
      <div className="space-y-3">
        {grants.length === 0 && <p className="text-muted-foreground">No grants yet. Import a CSV above.</p>}
        {grants.map((g) => {
          const vested = vestedQuantity(g);
          const latestFmv = getLatestValuation(g);
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
                    {vested.toLocaleString()} vested
                    {g.strikePrice != null && ` · Strike $${g.strikePrice}`}
                    {latestFmv != null && ` · FMV $${latestFmv}`}
                  </div>
                </div>
                <div className="space-x-2">
                  <Button size="sm" variant="outline" onClick={() => setSelectedGrant(g)}>
                    Record Vest / Exercise
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setValGrant(g)}>
                    Add FMV
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      if (confirm("Delete this grant?")) {
                        await deleteGrant(ctx, g.id);
                        queryClient.invalidateQueries({ queryKey: ["equity-grants"] });
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

      {/* Add valuation */}
      {valGrant && (
        <Card>
          <CardHeader>
            <CardTitle>Add FMV / 409A – {valGrant.companyName}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm">Date</label>
                <input
                  type="date"
                  className="w-full border rounded px-3 py-2"
                  value={valDate}
                  onChange={(e) => setValDate(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm">FMV per share</label>
                <input
                  type="number"
                  step="0.01"
                  className="w-full border rounded px-3 py-2"
                  value={valFmv}
                  placeholder="0.00"
                  onChange={(e) => setValFmv(e.target.value)}
                />
              </div>
            </div>
            <div className="space-x-2">
              <Button onClick={() => addValuationMutation.mutate()} disabled={addValuationMutation.isPending}>
                {addValuationMutation.isPending ? "Saving…" : "Save Valuation"}
              </Button>
              <Button variant="outline" onClick={() => setValGrant(null)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Record dialog (simple inline) */}
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
                <Button type="button" variant="outline" size="sm" onClick={() => refetchAccounts()}>
                  Refresh
                </Button>
              </div>
            </div>
            <div className="text-sm text-muted-foreground">
              {estimateTax(selectedGrant, Number(vestQty) || 0, getLatestValuation(selectedGrant) ?? 0).map(
                (n) => (
                  <div key={n}>{n}</div>
                )
              )}
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

function EquityRoute() {
  const queryClient = addonCtx!.api.query.getClient() as QueryClient;
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
