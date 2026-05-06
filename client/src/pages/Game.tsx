import { useState, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { ArrowLeft, Leaf, Trees, Globe, Zap, Code2, ExternalLink, Copy, Check, Play, Trophy, Monitor, FlaskConical } from "lucide-react";
import { EcologyLab } from "@/components/EcologyLab";

interface GameScore {
  id: number;
  nickname: string | null;
  score: number;
  biodiversityScore: number;
  livingCreatures: number;
  eggsCollected: number;
  level: number;
  treeCount: number;
  birdCount: number;
  bunnyCount: number;
  foxCount: number;
  bearCount: number;
  buffaloCount: number;
  beeCount: number;
  butterflyCount: number;
  flowerCount: number;
  regionX: number | null;
  regionY: number | null;
  createdAt: string;
}

interface LeaderboardData {
  topByScore: GameScore[];
  topByBiodiversity: GameScore[];
  regionBestScores: { regionX: number; regionY: number; bestScore: number; bestBio: number; sessions: number }[];
  totalSessions: number;
}

function BioDot({ n }: { n: number }) {
  return (
    <span className="flex gap-0.5">
      {Array.from({ length: 9 }).map((_, i) => (
        <span key={i} className={`w-1.5 h-1.5 rounded-full ${i < n ? "bg-green-400" : "bg-white/10"}`} />
      ))}
    </span>
  );
}

function SpeciesChips({ row }: { row: GameScore }) {
  const chips = [
    { count: row.treeCount, emoji: "🌲", label: "trees" },
    { count: row.birdCount, emoji: "🐦", label: "birds" },
    { count: row.bunnyCount, emoji: "🐰", label: "bunnies" },
    { count: row.foxCount, emoji: "🦊", label: "foxes" },
    { count: row.bearCount, emoji: "🐻", label: "bears" },
    { count: row.buffaloCount, emoji: "🦬", label: "buffalo" },
    { count: row.beeCount, emoji: "🐝", label: "bees" },
    { count: row.butterflyCount, emoji: "🦋", label: "butterflies" },
    { count: row.flowerCount, emoji: "🌸", label: "flowers" },
  ].filter(c => c.count > 0);
  return (
    <span className="flex flex-wrap gap-1">
      {chips.map(c => (
        <span key={c.label} className="text-[10px] bg-white/5 border border-white/10 rounded px-1.5 py-0.5">
          {c.emoji} {c.count}
        </span>
      ))}
      {chips.length === 0 && <span className="text-[10px] text-muted-foreground">no species yet</span>}
    </span>
  );
}

function buildSnippet(origin: string, patronToken: string | null, regionX: string, regionY: string, llmControl: boolean) {
  const lines = [`<!-- Add after your game scripts -->`];
  lines.push(`<script>`);
  lines.push(`  (function() {`);
  lines.push(`    const NC = "${origin}";`);
  if (patronToken) lines.push(`    window.ncPatronToken = "${patronToken}";`);
  else lines.push(`    // window.ncPatronToken = "paste-your-token-here";`);
  if (regionX && regionY) {
    lines.push(`    window.ncRegionX = ${regionX}; window.ncRegionY = ${regionY};`);
  } else {
    lines.push(`    // window.ncRegionX = 16; window.ncRegionY = 16; // canvas region 0-31`);
  }
  if (llmControl) lines.push(`    window.ncLLMControl = true; // LLM controls agents`);
  else lines.push(`    // window.ncLLMControl = true; // uncomment to let NeuroCompute LLMs drive agents`);
  lines.push(`    var s = document.createElement("script");`);
  lines.push(`    s.src = NC + "/game/neurocompute-appleseed.js";`);
  lines.push(`    document.head.appendChild(s);`);
  lines.push(`  })();`);
  lines.push(`</script>`);
  return lines.join("\n");
}

type Tab = "play" | "leaderboard" | "connect" | "lab";

function readHashTab(): Tab {
  if (typeof window === "undefined") return "connect";
  const h = window.location.hash.replace("#", "");
  if (h === "play" || h === "leaderboard" || h === "connect" || h === "lab") return h;
  return "connect";
}

export default function Game() {
  const [tab, setTabState] = useState<Tab>(readHashTab);
  const setTab = (t: Tab) => {
    setTabState(t);
    if (typeof window !== "undefined" && window.location.hash !== `#${t}`) {
      window.history.pushState(null, "", `#${t}`);
    }
  };
  useEffect(() => {
    const onHashChange = () => setTabState(readHashTab());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  const [copied, setCopied] = useState(false);
  const [llmControl, setLlmControl] = useState(false);
  const [regionX, setRegionX] = useState("");
  const [regionY, setRegionY] = useState("");

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const patronToken: string | null = typeof window !== "undefined"
    ? (localStorage.getItem("neurocompute_patronToken") || localStorage.getItem("neurocompute_token") || null)
    : null;

  const snippet = buildSnippet(origin, patronToken, regionX, regionY, llmControl);

  const copySnippet = useCallback(() => {
    navigator.clipboard.writeText(snippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [snippet]);

  const leaderboardQuery = useQuery<LeaderboardData>({
    queryKey: ["/api/game/appleseed/leaderboard"],
    refetchInterval: 30000,
  });

  const data = leaderboardQuery.data;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Header */}
      <div className="p-4 md:px-6 border-b border-white/5">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-sm transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div className="w-7 h-7 rounded-lg bg-green-900/40 border border-green-500/30 flex items-center justify-center shrink-0">
              <Leaf className="w-3.5 h-3.5 text-green-400" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight leading-none">Appleseed × NeuroCompute</h1>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Ecosystem game — biodiversity leaderboard — LLM agent control
              </p>
            </div>
          </div>
          <a
            href="https://fractastical.github.io/appleseed/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-green-400/70 hover:text-green-400 transition-colors"
            data-testid="link-play-external"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Open game
          </a>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-white/5">
        <div className="max-w-6xl mx-auto px-4 md:px-6 flex gap-1 pt-1">
          {(["connect", "play", "lab", "leaderboard"] as Tab[]).map(t => {
            const isLab = t === "lab";
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-2 text-xs font-medium rounded-t-md transition-colors border-b-2 -mb-px capitalize flex items-center gap-1.5 ${
                  tab === t
                    ? isLab
                      ? "border-purple-400 text-purple-400 bg-purple-950/20"
                      : "border-green-400 text-green-400 bg-green-950/20"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
                data-testid={`tab-${t}`}
              >
                {t === "connect" && <Code2 className="w-3 h-3" />}
                {t === "play" && <Monitor className="w-3 h-3" />}
                {t === "lab" && <FlaskConical className="w-3 h-3" />}
                {t === "leaderboard" && <Trophy className="w-3 h-3" />}
                {t}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 max-w-6xl mx-auto w-full p-4 md:p-6">

        {/* ── CONNECT TAB ── */}
        {tab === "connect" && (
          <div className="space-y-5 max-w-3xl">
            <div className="p-4 rounded-xl border border-green-500/20 bg-green-950/10 space-y-2">
              <p className="text-sm font-medium text-foreground">One snippet connects Appleseed to NeuroCompute</p>
              <p className="text-xs text-muted-foreground">
                Paste the code below after the existing <code className="text-green-300 font-mono text-[10px] bg-white/5 px-1 py-0.5 rounded">&lt;script&gt;</code> tags in your Appleseed <code className="text-green-300 font-mono text-[10px] bg-white/5 px-1 py-0.5 rounded">index.html</code>.
                It hooks into the existing <kbd className="bg-white/10 border border-white/20 rounded px-1 py-0.5 font-mono text-[10px]">e</kbd> key to submit your score here, and optionally lets NeuroCompute LLMs control your agents.
              </p>
            </div>

            {/* Customiser */}
            <Card className="border-white/10">
              <CardHeader className="pb-3">
                <CardTitle className="text-xs text-muted-foreground font-normal">Customise snippet</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-muted-foreground block mb-1">Canvas region X (0–31)</label>
                    <input
                      type="number" min={0} max={31}
                      value={regionX}
                      onChange={e => setRegionX(e.target.value)}
                      placeholder="e.g. 16"
                      className="w-full h-8 px-2 text-xs bg-white/5 border border-white/10 rounded focus:outline-none focus:border-green-500/50 text-foreground"
                      data-testid="input-region-x"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground block mb-1">Canvas region Y (0–31)</label>
                    <input
                      type="number" min={0} max={31}
                      value={regionY}
                      onChange={e => setRegionY(e.target.value)}
                      placeholder="e.g. 16"
                      className="w-full h-8 px-2 text-xs bg-white/5 border border-white/10 rounded focus:outline-none focus:border-green-500/50 text-foreground"
                      data-testid="input-region-y"
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 cursor-pointer select-none" data-testid="toggle-llm-control">
                  <div
                    onClick={() => setLlmControl(v => !v)}
                    className={`w-8 h-4 rounded-full transition-colors relative ${llmControl ? "bg-green-500" : "bg-white/10"}`}
                  >
                    <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${llmControl ? "translate-x-4" : "translate-x-0.5"}`} />
                  </div>
                  <span className="text-xs text-muted-foreground">Enable LLM agent control (NeuroCompute nodes drive your agents)</span>
                </label>
                {patronToken && (
                  <p className="text-[11px] text-green-400/70">
                    Your patron token detected — auto-filled into snippet.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Snippet */}
            <div className="relative">
              <pre
                className="bg-black/60 border border-white/10 rounded-xl p-4 overflow-x-auto text-[11px] text-green-300 font-mono whitespace-pre leading-relaxed select-all"
                data-testid="code-snippet"
              >
                {snippet}
              </pre>
              <Button
                size="sm"
                variant="outline"
                onClick={copySnippet}
                className={`absolute top-2 right-2 h-7 px-2.5 text-[11px] gap-1.5 transition-colors ${copied ? "border-green-500/50 text-green-400" : "border-white/10 text-muted-foreground hover:text-foreground"}`}
                data-testid="button-copy-snippet"
              >
                {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copied ? "Copied!" : "Copy"}
              </Button>
            </div>

            {/* Feature grid */}
            <div className="grid md:grid-cols-3 gap-3 pt-1">
              {[
                { icon: "🔑", title: "Score syncing", desc: "Press e in-game to submit your ecosystem score + full species breakdown here." },
                { icon: "🤖", title: "LLM agents", desc: "Active compute nodes receive your game state every 8s and decide: plant, release, harvest." },
                { icon: "🗺️", title: "Region linking", desc: "Set ncRegionX/Y to tie your game sessions to a canvas region. Biodiversity enriches that cell." },
              ].map(f => (
                <div key={f.title} className="p-3 rounded-lg border border-white/8 bg-white/2 space-y-1">
                  <p className="text-base">{f.icon}</p>
                  <p className="text-xs font-medium text-foreground">{f.title}</p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">{f.desc}</p>
                </div>
              ))}
            </div>

            {/* API ref */}
            <Card className="border-white/8">
              <CardContent className="pt-4 pb-3">
                <p className="text-[11px] font-medium text-muted-foreground mb-2">REST API (CORS *)</p>
                <div className="space-y-1 font-mono text-[10px]">
                  <p><span className="text-green-400">GET </span> <span className="text-muted-foreground">/api/game/appleseed/leaderboard</span></p>
                  <p><span className="text-blue-400">POST</span> <span className="text-muted-foreground">/api/game/appleseed/score</span> <span className="text-white/30">— submit score</span></p>
                  <p><span className="text-blue-400">POST</span> <span className="text-muted-foreground">/api/game/appleseed/action</span> <span className="text-white/30">— LLM action decision</span></p>
                  <p><span className="text-green-400">GET </span> <span className="text-muted-foreground">/game/neurocompute-appleseed.js</span> <span className="text-white/30">— integration script</span></p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── PLAY TAB ── */}
        {tab === "play" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                The integration script is <span className="text-green-400">not</span> injected here — add it to your Appleseed fork for score syncing.
              </p>
              <a
                href="https://fractastical.github.io/appleseed/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-green-400/70 hover:text-green-400 flex items-center gap-1"
              >
                Open full screen <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <div className="relative w-full rounded-xl overflow-hidden border border-white/10 bg-black" style={{ height: "calc(100vh - 200px)", minHeight: 500 }}>
              <iframe
                src="https://fractastical.github.io/appleseed/"
                className="w-full h-full"
                title="Johnny Appleseed"
                allow="keyboard-map"
                data-testid="iframe-appleseed"
              />
            </div>
            <p className="text-[11px] text-muted-foreground text-center">
              Arrow keys to move · <kbd className="bg-white/10 border border-white/15 rounded px-1 font-mono">a</kbd> plant seed · <kbd className="bg-white/10 border border-white/15 rounded px-1 font-mono">e</kbd> submit score · <kbd className="bg-white/10 border border-white/15 rounded px-1 font-mono">w</kbd> autowalk
            </p>
          </div>
        )}

        {/* ── LAB TAB ── */}
        {tab === "lab" && (
          <EcologyLab leaderboardSeeds={data?.topByBiodiversity ?? []} />
        )}

        {/* ── LEADERBOARD TAB ── */}
        {tab === "leaderboard" && (
          <div className="space-y-5">
            {/* Stats */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { value: data?.totalSessions ?? 0, label: "game sessions" },
                { value: data?.topByScore[0]?.score?.toLocaleString() ?? 0, label: "top ecosystem score" },
                { value: `${data?.topByBiodiversity[0]?.biodiversityScore ?? 0}/9`, label: "top biodiversity" },
              ].map(s => (
                <Card key={s.label} className="border-green-500/15 bg-green-950/10">
                  <CardContent className="pt-4 pb-3 text-center">
                    <p className="text-2xl font-bold text-green-400">{s.value}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{s.label}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              {/* Top by Score */}
              <Card className="border-white/10">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Zap className="w-4 h-4 text-yellow-400" /> Top Ecosystem Scores
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {leaderboardQuery.isLoading ? (
                    <p className="text-muted-foreground text-xs text-center py-4">Loading…</p>
                  ) : !data?.topByScore.length ? (
                    <div className="text-center py-8 space-y-2">
                      <p className="text-3xl">🌱</p>
                      <p className="text-xs text-muted-foreground">No scores yet — add the snippet and press <kbd className="bg-white/10 border border-white/15 rounded px-1 font-mono text-[10px]">e</kbd> in-game</p>
                    </div>
                  ) : (
                    data.topByScore.map((row, i) => (
                      <div key={row.id} className="flex items-start gap-3 p-2 rounded-lg bg-white/3 border border-white/5" data-testid={`score-row-${row.id}`}>
                        <span className="text-lg font-bold text-muted-foreground/40 w-6 text-center shrink-0">#{i + 1}</span>
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm text-foreground truncate">{row.nickname ?? "Anonymous"}</span>
                            <Badge variant="outline" className="text-[10px] text-yellow-400 border-yellow-400/30">
                              {row.score.toLocaleString()} pts
                            </Badge>
                            <Badge variant="outline" className="text-[10px] text-muted-foreground">Lv{row.level}</Badge>
                            {row.regionX != null && (
                              <Badge variant="outline" className="text-[10px] text-purple-400 border-purple-400/30">
                                ({row.regionX},{row.regionY})
                              </Badge>
                            )}
                          </div>
                          <SpeciesChips row={row} />
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              {/* Top by Biodiversity */}
              <Card className="border-white/10">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Globe className="w-4 h-4 text-green-400" /> Top Biodiversity
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {leaderboardQuery.isLoading ? (
                    <p className="text-muted-foreground text-xs text-center py-4">Loading…</p>
                  ) : !data?.topByBiodiversity.length ? (
                    <div className="text-center py-8 space-y-2">
                      <p className="text-3xl">🦋</p>
                      <p className="text-xs text-muted-foreground">No records yet — grow 9 species for max biodiversity</p>
                    </div>
                  ) : (
                    data.topByBiodiversity.map((row, i) => (
                      <div key={row.id} className="flex items-start gap-3 p-2 rounded-lg bg-white/3 border border-white/5" data-testid={`biodiv-row-${row.id}`}>
                        <span className="text-lg font-bold text-muted-foreground/40 w-6 text-center shrink-0">#{i + 1}</span>
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm text-foreground truncate">{row.nickname ?? "Anonymous"}</span>
                            <Badge variant="outline" className="text-[10px] text-green-400 border-green-400/30">
                              {row.biodiversityScore}/9 species
                            </Badge>
                            {row.regionX != null && (
                              <Badge variant="outline" className="text-[10px] text-purple-400 border-purple-400/30">
                                region ({row.regionX},{row.regionY})
                              </Badge>
                            )}
                          </div>
                          <BioDot n={row.biodiversityScore} />
                          <SpeciesChips row={row} />
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Region heat map */}
            {data?.regionBestScores && data.regionBestScores.length > 0 && (
              <Card className="border-white/10">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Trees className="w-4 h-4 text-emerald-400" /> Richest Canvas Regions
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {data.regionBestScores.slice(0, 20).map((r) => {
                      const intensity = Math.min(1, r.bestBio / 9);
                      const green = Math.round(intensity * 200 + 55);
                      return (
                        <div
                          key={`${r.regionX}-${r.regionY}`}
                          className="w-12 h-12 rounded border border-white/10 flex flex-col items-center justify-center cursor-default"
                          style={{ backgroundColor: `rgba(0,${green},0,${0.15 + intensity * 0.4})` }}
                          title={`(${r.regionX},${r.regionY}) · Bio ${r.bestBio}/9 · Score ${r.bestScore.toLocaleString()} · ${r.sessions} session${r.sessions !== 1 ? "s" : ""}`}
                          data-testid={`region-cell-${r.regionX}-${r.regionY}`}
                        >
                          <span className="text-[10px] text-white/60">({r.regionX},{r.regionY})</span>
                          <span className="text-[11px] text-green-400 font-bold">{r.bestBio}/9</span>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
