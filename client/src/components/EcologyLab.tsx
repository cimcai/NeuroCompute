import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Play, Square, RotateCcw, FlaskConical, Trophy, Sparkles, Crown } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  PRESET_WORLDS, BIOMES, SPECIES, SPECIES_META,
  runSimulation, stateFromScoreRow,
  type State, type Biome, type SimSnapshot, type Species,
} from "@/lib/ecologyLab";

interface SeedRow {
  id: number;
  nickname: string | null;
  biodiversityScore: number;
  treeCount: number; birdCount: number; bunnyCount: number; foxCount: number;
  bearCount: number; buffaloCount: number; beeCount: number; butterflyCount: number; flowerCount: number;
}

interface SavedRun {
  id: string;
  worldName: string;
  biome: Biome;
  ticks: number;
  finalBiodiversity: number;
  finalShannon: number;
  finalTotal: number;
  finalState: State;
  timestamp: number;
}

interface LabRecord {
  id: number;
  worldId: string;
  worldName: string;
  biome: string;
  biodiversity: number;
  shannonX100: number;
  totalCreatures: number;
  ticks: number;
  weatherChaosX100: number;
  predationX100: number;
  rngSeed: number;
  finalState: State;
  nickname: string | null;
  createdAt: string;
}

interface LabRecordsResponse {
  records: LabRecord[];
  bestPerWorld: LabRecord[];
  totalRuns: number;
}

const STORAGE_KEY = "neurocompute_lab_runs";

function getPatronToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("neurocompute_patronToken") || localStorage.getItem("neurocompute_token") || null;
}

export function EcologyLab({ leaderboardSeeds }: { leaderboardSeeds: SeedRow[] }) {
  const [presetId, setPresetId] = useState(PRESET_WORLDS[0].id);
  const [seedRowId, setSeedRowId] = useState<number | null>(null);
  const [biome, setBiome] = useState<Biome>(PRESET_WORLDS[0].biome);
  const [ticks, setTicks] = useState(150);
  const [chaos, setChaos] = useState(0.2);
  const [predation, setPredation] = useState(1.0);
  const [seedRng, setSeedRng] = useState(1);

  const [running, setRunning] = useState(false);
  const [snapshots, setSnapshots] = useState<SimSnapshot[]>([]);
  const [savedRuns, setSavedRuns] = useState<SavedRun[]>([]);
  const animRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // Global world records
  const recordsQuery = useQuery<LabRecordsResponse>({
    queryKey: ["/api/game/lab/records"],
    refetchInterval: 60000,
  });

  const submitRecord = useMutation({
    mutationFn: async (payload: {
      worldId: string; worldName: string; biome: Biome;
      biodiversity: number; shannon: number; totalCreatures: number;
      ticks: number; weatherChaos: number; predation: number; rngSeed: number;
      finalState: State;
    }) => {
      return apiRequest("POST", "/api/game/lab/record", {
        ...payload,
        patronToken: getPatronToken(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/game/lab/records"] });
    },
  });

  // Load local saved runs
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setSavedRuns(JSON.parse(raw));
    } catch {}
  }, []);

  const persistRun = (run: SavedRun) => {
    setSavedRuns(prev => {
      const next = [run, ...prev].slice(0, 12);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const initialState = useMemo<State>(() => {
    if (seedRowId != null) {
      const row = leaderboardSeeds.find(r => r.id === seedRowId);
      if (row) return stateFromScoreRow(row);
    }
    const preset = PRESET_WORLDS.find(p => p.id === presetId)!;
    return preset.state;
  }, [presetId, seedRowId, leaderboardSeeds]);

  const startSourceLabel = useMemo(() => {
    if (seedRowId != null) {
      const row = leaderboardSeeds.find(r => r.id === seedRowId);
      return row ? `${row.nickname ?? "Anonymous"} (Bio ${row.biodiversityScore}/9)` : "Recorded";
    }
    const p = PRESET_WORLDS.find(p => p.id === presetId)!;
    return `${p.emoji} ${p.name}`;
  }, [seedRowId, presetId, leaderboardSeeds]);

  const reset = () => {
    cancelledRef.current = true;
    if (animRef.current) {
      window.clearInterval(animRef.current);
      animRef.current = null;
    }
    setRunning(false);
    setSnapshots([]);
  };

  const run = () => {
    if (animRef.current) window.clearInterval(animRef.current);
    cancelledRef.current = false;

    const allSnaps = runSimulation(
      { biome, initial: initialState, ticks, weatherChaos: chaos, predationStrength: predation },
      Math.max(1, Math.floor(ticks / 50)),
      seedRng,
    );
    setSnapshots([allSnaps[0]]);
    setRunning(true);

    let i = 1;
    animRef.current = window.setInterval(() => {
      if (cancelledRef.current || !mountedRef.current) {
        if (animRef.current) window.clearInterval(animRef.current);
        animRef.current = null;
        return;
      }
      if (i >= allSnaps.length) {
        if (animRef.current) window.clearInterval(animRef.current);
        animRef.current = null;
        setRunning(false);
        const final = allSnaps[allSnaps.length - 1];
        const worldId = seedRowId != null ? `seed-${seedRowId}` : presetId;
        const worldLabel = seedRowId != null
          ? (leaderboardSeeds.find(r => r.id === seedRowId)?.nickname ?? "Recorded") + " seed"
          : (PRESET_WORLDS.find(p => p.id === presetId)?.name ?? "Run");
        persistRun({
          id: `${Date.now()}`,
          worldName: worldLabel,
          biome,
          ticks,
          finalBiodiversity: final.biodiversity,
          finalShannon: Math.round(final.shannon * 100) / 100,
          finalTotal: final.totalCreatures,
          finalState: final.state,
          timestamp: Date.now(),
        });
        // Submit to global records (fire-and-forget)
        submitRecord.mutate({
          worldId,
          worldName: worldLabel,
          biome,
          biodiversity: final.biodiversity,
          shannon: final.shannon,
          totalCreatures: final.totalCreatures,
          ticks,
          weatherChaos: chaos,
          predation,
          rngSeed: seedRng,
          finalState: final.state,
        });
        return;
      }
      setSnapshots(prev => [...prev, allSnaps[i]]);
      i++;
    }, 50);
  };

  const stop = () => {
    cancelledRef.current = true;
    if (animRef.current) {
      window.clearInterval(animRef.current);
      animRef.current = null;
    }
    setRunning(false);
  };

  useEffect(() => () => {
    if (animRef.current) window.clearInterval(animRef.current);
  }, []);

  const final = snapshots[snapshots.length - 1];
  const peakBio = snapshots.reduce((m, s) => Math.max(m, s.biodiversity), 0);
  const extinctions = final
    ? SPECIES.filter(sp => initialState[sp] >= 1 && final.state[sp] < 1)
    : [];
  const newcomers = final
    ? SPECIES.filter(sp => initialState[sp] < 1 && final.state[sp] >= 1)
    : [];

  return (
    <div className="space-y-5">
      {/* Intro */}
      <div className="p-4 rounded-xl border border-purple-500/20 bg-purple-950/10 flex items-start gap-3">
        <FlaskConical className="w-5 h-5 text-purple-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-foreground">Ecology Lab</p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            Pick a starting world, set the biome and parameters, then run a fast-forward simulation.
            Every completed run is recorded — try to set the biodiversity record for each world.
          </p>
        </div>
      </div>

      {/* World Records Grid */}
      <WorldRecordsGrid
        records={recordsQuery.data}
        loading={recordsQuery.isLoading}
        onPick={(worldId, biome) => {
          if (worldId.startsWith("seed-")) return; // can't switch to a seed-based world from here
          setPresetId(worldId);
          setSeedRowId(null);
          setBiome(biome as Biome);
          reset();
        }}
        currentWorldId={seedRowId != null ? `seed-${seedRowId}` : presetId}
        currentBiome={biome}
      />

      <div className="grid lg:grid-cols-[320px_1fr] gap-4">
        {/* Left: controls */}
        <div className="space-y-3">
          {/* World picker */}
          <Card className="border-white/10">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-normal text-muted-foreground">Starting world</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                {PRESET_WORLDS.map(p => (
                  <button
                    key={p.id}
                    onClick={() => { setPresetId(p.id); setSeedRowId(null); setBiome(p.biome); reset(); }}
                    className={`w-full text-left p-2 rounded-md border transition-colors ${
                      seedRowId == null && presetId === p.id
                        ? "border-purple-500/50 bg-purple-950/30"
                        : "border-white/8 hover:border-white/20 bg-white/2"
                    }`}
                    data-testid={`preset-${p.id}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-base">{p.emoji}</span>
                      <span className="text-xs font-medium text-foreground">{p.name}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">{p.description}</p>
                  </button>
                ))}
              </div>

              {leaderboardSeeds.length > 0 && (
                <div className="pt-2 border-t border-white/5">
                  <p className="text-[10px] text-muted-foreground mb-1.5 flex items-center gap-1">
                    <Trophy className="w-2.5 h-2.5" /> Or seed from a real player run
                  </p>
                  <select
                    value={seedRowId ?? ""}
                    onChange={e => {
                      const v = e.target.value;
                      if (v === "") setSeedRowId(null);
                      else setSeedRowId(Number(v));
                      reset();
                    }}
                    className="w-full h-8 px-2 text-xs bg-white/5 border border-white/10 rounded focus:outline-none focus:border-purple-500/50 text-foreground"
                    data-testid="select-seed-row"
                  >
                    <option value="">— Use preset above —</option>
                    {leaderboardSeeds.slice(0, 20).map(r => (
                      <option key={r.id} value={r.id}>
                        {r.nickname ?? "Anon"} · Bio {r.biodiversityScore}/9
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Sim params */}
          <Card className="border-white/10">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-normal text-muted-foreground">Conditions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="text-[11px] text-muted-foreground block mb-1">Biome</label>
                <div className="grid grid-cols-3 gap-1">
                  {BIOMES.map(b => (
                    <button
                      key={b.id}
                      onClick={() => { setBiome(b.id); reset(); }}
                      className={`px-2 py-1.5 rounded text-[11px] border transition-colors ${
                        biome === b.id
                          ? "border-purple-500/50 bg-purple-950/30 text-foreground"
                          : "border-white/8 bg-white/2 text-muted-foreground hover:border-white/20"
                      }`}
                      data-testid={`biome-${b.id}`}
                    >
                      {b.emoji} {b.name}
                    </button>
                  ))}
                </div>
              </div>
              <SliderRow label="Duration" value={ticks} min={50} max={500} step={25} suffix="ticks" onChange={v => { setTicks(v); reset(); }} testId="slider-ticks" />
              <SliderRow label="Weather chaos" value={chaos} min={0} max={1} step={0.1} suffix="" onChange={v => { setChaos(v); reset(); }} testId="slider-chaos" />
              <SliderRow label="Predation" value={predation} min={0.2} max={2} step={0.1} suffix="×" onChange={v => { setPredation(v); reset(); }} testId="slider-predation" />
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">Random seed</span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    value={seedRng}
                    onChange={e => { setSeedRng(Number(e.target.value) || 1); reset(); }}
                    className="w-16 h-7 px-2 text-xs bg-white/5 border border-white/10 rounded text-right"
                    data-testid="input-seed"
                  />
                  <Button size="sm" variant="ghost" onClick={() => { setSeedRng(Math.floor(Math.random() * 9999)); reset(); }} className="h-7 px-2 text-[10px]" data-testid="button-randomize-seed">
                    🎲
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Run controls */}
          <div className="flex gap-2">
            {!running ? (
              <Button onClick={run} className="flex-1 bg-purple-600 hover:bg-purple-500 text-white" data-testid="button-run-sim">
                <Play className="w-3.5 h-3.5 mr-1.5" /> Run simulation
              </Button>
            ) : (
              <Button onClick={stop} variant="destructive" className="flex-1" data-testid="button-stop-sim">
                <Square className="w-3.5 h-3.5 mr-1.5" /> Stop
              </Button>
            )}
            {snapshots.length > 0 && !running && (
              <Button onClick={reset} variant="outline" size="icon" className="border-white/10" data-testid="button-reset-sim">
                <RotateCcw className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* Right: chart + report */}
        <div className="space-y-3">
          {/* Header bar */}
          <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-white/3 border border-white/8">
            <div className="text-xs text-muted-foreground min-w-0">
              <span className="text-foreground truncate">{startSourceLabel}</span>
              <span className="mx-1.5">→</span>
              <span>{BIOMES.find(b => b.id === biome)?.emoji} {BIOMES.find(b => b.id === biome)?.name}</span>
              <span className="mx-1.5">·</span>
              <span>{ticks} ticks</span>
            </div>
            {final && (
              <div className="flex items-center gap-2 shrink-0">
                <Badge variant="outline" className="text-[10px] border-purple-400/40 text-purple-300">
                  Bio {final.biodiversity}/9
                </Badge>
                <Badge variant="outline" className="text-[10px] border-white/15 text-muted-foreground">
                  H={final.shannon.toFixed(2)}
                </Badge>
              </div>
            )}
          </div>

          {/* Chart */}
          <Card className="border-white/10">
            <CardContent className="pt-4">
              <SpeciesChart snapshots={snapshots} ticks={ticks} />
            </CardContent>
          </Card>

          {/* Live counts */}
          <Card className="border-white/10">
            <CardContent className="pt-4 pb-3">
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {SPECIES.map(sp => {
                  const cur = final ? Math.round(final.state[sp]) : Math.round(initialState[sp]);
                  const start = Math.round(initialState[sp]);
                  const delta = cur - start;
                  const meta = SPECIES_META[sp];
                  return (
                    <div key={sp} className="p-2 rounded bg-white/3 border border-white/5 text-center" data-testid={`count-${sp}`}>
                      <div className="text-base">{meta.emoji}</div>
                      <div className="text-sm font-bold text-foreground">{cur}</div>
                      {final && delta !== 0 && (
                        <div className={`text-[10px] ${delta > 0 ? "text-green-400" : "text-red-400"}`}>
                          {delta > 0 ? "+" : ""}{delta}
                        </div>
                      )}
                      <div className="text-[9px] text-muted-foreground uppercase tracking-wider">{meta.label}</div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Final report */}
          {final && !running && (
            <Card className="border-purple-500/30 bg-purple-950/10">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-purple-400" /> Simulation complete
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <p>
                  <span className="text-muted-foreground">Final biodiversity:</span>{" "}
                  <span className="text-purple-300 font-bold">{final.biodiversity}/9 species</span>
                  {peakBio > final.biodiversity && (
                    <span className="text-muted-foreground"> · peaked at {peakBio}</span>
                  )}
                </p>
                <p>
                  <span className="text-muted-foreground">Total creatures:</span>{" "}
                  <span className="text-foreground font-medium">{final.totalCreatures}</span>
                  <span className="text-muted-foreground"> · Shannon H = {final.shannon.toFixed(2)}</span>
                </p>
                {extinctions.length > 0 && (
                  <p className="text-red-300/90">
                    💀 Extinct: {extinctions.map(sp => SPECIES_META[sp].emoji + " " + SPECIES_META[sp].label).join(", ")}
                  </p>
                )}
                {newcomers.length > 0 && (
                  <p className="text-green-300/90">
                    🌱 Emerged: {newcomers.map(sp => SPECIES_META[sp].emoji + " " + SPECIES_META[sp].label).join(", ")}
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Saved runs */}
      {savedRuns.length > 0 && (
        <Card className="border-white/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-normal text-muted-foreground">Recent runs (saved locally)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {savedRuns.map(r => {
                const biomeMeta = BIOMES.find(b => b.id === r.biome);
                return (
                  <div key={r.id} className="p-2.5 rounded-lg border border-white/8 bg-white/2 text-xs space-y-1" data-testid={`saved-run-${r.id}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-foreground truncate">{r.worldName}</span>
                      <Badge variant="outline" className="text-[10px] border-purple-400/30 text-purple-300 shrink-0">
                        {r.finalBiodiversity}/9
                      </Badge>
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {biomeMeta?.emoji} {biomeMeta?.name} · {r.ticks} ticks · {r.finalTotal} creatures · H={r.finalShannon}
                    </div>
                    <div className="flex flex-wrap gap-0.5 pt-0.5">
                      {SPECIES.map(sp => {
                        const c = Math.round(r.finalState[sp]);
                        if (c < 1) return null;
                        return (
                          <span key={sp} className="text-[10px] bg-white/5 rounded px-1" title={`${SPECIES_META[sp].label}: ${c}`}>
                            {SPECIES_META[sp].emoji}{c}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            <button
              onClick={() => { localStorage.removeItem(STORAGE_KEY); setSavedRuns([]); }}
              className="text-[10px] text-muted-foreground hover:text-foreground mt-3 transition-colors"
              data-testid="button-clear-runs"
            >
              Clear saved runs
            </button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function WorldRecordsGrid({ records, loading, onPick, currentWorldId, currentBiome }: {
  records?: LabRecordsResponse;
  loading: boolean;
  onPick: (worldId: string, biome: string) => void;
  currentWorldId: string;
  currentBiome: string;
}) {
  // Build a row per preset world, with best record (if any) per biome
  const bestByWorldBiome = new Map<string, LabRecord>();
  if (records) {
    for (const r of records.bestPerWorld) {
      bestByWorldBiome.set(`${r.worldId}|${r.biome}`, r);
    }
  }

  return (
    <Card className="border-yellow-500/20 bg-yellow-950/5">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-2">
          <Crown className="w-4 h-4 text-yellow-400" /> World Records
        </CardTitle>
        <span className="text-[10px] text-muted-foreground" data-testid="text-total-runs">
          {records ? `${records.totalRuns} run${records.totalRuns !== 1 ? "s" : ""} community-wide` : "—"}
        </span>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading && !records ? (
          <p className="text-xs text-muted-foreground py-2 text-center">Loading records…</p>
        ) : (
          <div className="space-y-1.5">
            {PRESET_WORLDS.map(world => {
              const isCurrentWorld = currentWorldId === world.id;
              return (
                <div
                  key={world.id}
                  className={`p-2 rounded-md border transition-colors ${
                    isCurrentWorld ? "border-purple-500/40 bg-purple-950/20" : "border-white/8 bg-white/2"
                  }`}
                  data-testid={`record-row-${world.id}`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-base shrink-0">{world.emoji}</span>
                      <span className="text-xs font-medium text-foreground truncate">{world.name}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {BIOMES.map(b => {
                      const rec = bestByWorldBiome.get(`${world.id}|${b.id}`);
                      const isCurrent = isCurrentWorld && currentBiome === b.id;
                      return (
                        <button
                          key={b.id}
                          onClick={() => onPick(world.id, b.id)}
                          title={rec
                            ? `${rec.nickname ?? "Anonymous"} — Bio ${rec.biodiversity}/9 · H=${(rec.shannonX100 / 100).toFixed(2)} · ${rec.totalCreatures} creatures · ${rec.ticks} ticks`
                            : `${b.name} — no runs yet, click to try`}
                          className={`text-[10px] px-1.5 py-1 rounded border transition-colors flex items-center gap-1 ${
                            isCurrent
                              ? "border-purple-500/60 bg-purple-950/40 text-purple-200"
                              : rec
                              ? "border-yellow-500/30 bg-yellow-950/15 text-yellow-200/90 hover:border-yellow-500/50"
                              : "border-white/8 bg-white/2 text-muted-foreground/60 hover:border-white/20 hover:text-muted-foreground"
                          }`}
                          data-testid={`record-cell-${world.id}-${b.id}`}
                        >
                          <span>{b.emoji}</span>
                          {rec ? (
                            <>
                              <span className="font-bold">{rec.biodiversity}</span>
                              <span className="opacity-60">/9</span>
                            </>
                          ) : (
                            <span className="opacity-50">—</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p className="text-[10px] text-muted-foreground/70 pt-1">
          Click any biome chip to load that world. Numbers are the highest biodiversity (0–9) anyone has achieved with that combination.
        </p>
      </CardContent>
    </Card>
  );
}

function SliderRow({ label, value, min, max, step, suffix, onChange, testId }: {
  label: string; value: number; min: number; max: number; step: number; suffix: string; onChange: (v: number) => void; testId: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-muted-foreground">{label}</span>
        <span className="text-[11px] text-foreground font-mono">{value}{suffix}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-purple-500"
        data-testid={testId}
      />
    </div>
  );
}

function SpeciesChart({ snapshots, ticks }: { snapshots: SimSnapshot[]; ticks: number }) {
  const W = 720, H = 240, padL = 30, padR = 12, padT = 12, padB = 22;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const visible: Species[] = SPECIES;
  const maxY = Math.max(
    1,
    ...snapshots.flatMap(s => visible.map(sp => s.state[sp])),
  );

  const xFor = (tick: number) => padL + (tick / ticks) * innerW;
  const yFor = (val: number) => padT + innerH - (val / maxY) * innerH;

  if (snapshots.length === 0) {
    return (
      <div className="h-[240px] flex flex-col items-center justify-center text-muted-foreground text-xs gap-2">
        <FlaskConical className="w-8 h-8 opacity-30" />
        <p>Press <span className="text-foreground">Run simulation</span> to start</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" data-testid="species-chart">
        {/* gridlines */}
        {[0.25, 0.5, 0.75, 1].map(p => (
          <line key={p} x1={padL} x2={W - padR} y1={padT + innerH * (1 - p)} y2={padT + innerH * (1 - p)} stroke="currentColor" strokeOpacity={0.06} strokeWidth={1} />
        ))}
        {/* y-axis labels */}
        {[0, 0.5, 1].map(p => (
          <text key={p} x={padL - 4} y={padT + innerH * (1 - p) + 3} textAnchor="end" className="fill-muted-foreground" fontSize="9">
            {Math.round(maxY * p)}
          </text>
        ))}
        {/* x-axis label */}
        <text x={padL} y={H - 6} className="fill-muted-foreground" fontSize="9">tick 0</text>
        <text x={W - padR} y={H - 6} textAnchor="end" className="fill-muted-foreground" fontSize="9">tick {ticks}</text>

        {/* species lines */}
        {visible.map(sp => {
          const meta = SPECIES_META[sp];
          const points = snapshots.map(s => `${xFor(s.tick)},${yFor(s.state[sp])}`).join(" ");
          return (
            <polyline
              key={sp}
              points={points}
              fill="none"
              stroke={meta.color}
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.85}
            />
          );
        })}
      </svg>
      <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center">
        {visible.map(sp => {
          const meta = SPECIES_META[sp];
          return (
            <span key={sp} className="text-[10px] text-muted-foreground flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ background: meta.color }} />
              {meta.emoji} {meta.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}
