import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { ArrowLeft, Leaf, Bird, Rabbit, Trees, Globe, Zap, Code2, ExternalLink } from "lucide-react";

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

const NEUROCOMPUTE_ORIGIN = typeof window !== "undefined" ? window.location.origin : "";
const SNIPPET = `<!-- Add after your game scripts -->
<script>
  (function() {
    const NC = "${NEUROCOMPUTE_ORIGIN}";
    // Optionally: set your NeuroCompute patron token
    // window.ncPatronToken = "your-token-here";
    // Optionally: set your canvas region (0-31)
    // window.ncRegionX = 16; window.ncRegionY = 16;
    var s = document.createElement("script");
    s.src = NC + "/game/neurocompute-appleseed.js";
    document.head.appendChild(s);
  })();
</script>`;

export default function Game() {
  const leaderboardQuery = useQuery<LeaderboardData>({
    queryKey: ["/api/game/appleseed/leaderboard"],
    refetchInterval: 30000,
  });

  const data = leaderboardQuery.data;

  return (
    <div className="min-h-screen bg-background text-foreground p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/" className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-sm transition-colors">
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Link>
      </div>

      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-green-900/40 border border-green-500/30 flex items-center justify-center shrink-0">
          <Leaf className="w-5 h-5 text-green-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Appleseed × NeuroCompute</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Grow ecosystems. Earn biodiversity scores. Let local AI control your agents.{" "}
            <a href="https://fractastical.github.io/appleseed/" target="_blank" rel="noopener noreferrer"
              className="text-green-400 hover:text-green-300 inline-flex items-center gap-1">
              Play Appleseed <ExternalLink className="w-3 h-3" />
            </a>
          </p>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="border-green-500/20 bg-green-950/20">
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-2xl font-bold text-green-400">{data?.totalSessions ?? 0}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">game sessions</p>
          </CardContent>
        </Card>
        <Card className="border-green-500/20 bg-green-950/20">
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-2xl font-bold text-green-400">
              {data?.topByScore[0]?.score?.toLocaleString() ?? 0}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">top ecosystem score</p>
          </CardContent>
        </Card>
        <Card className="border-green-500/20 bg-green-950/20">
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-2xl font-bold text-green-400">
              {data?.topByBiodiversity[0]?.biodiversityScore ?? 0}
              <span className="text-base text-muted-foreground">/9</span>
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">top biodiversity</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Top by Ecosystem Score */}
        <Card className="border-white/10">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Zap className="w-4 h-4 text-yellow-400" /> Top Ecosystem Scores
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {leaderboardQuery.isLoading ? (
              <p className="text-muted-foreground text-xs text-center py-4">Loading...</p>
            ) : !data?.topByScore.length ? (
              <p className="text-muted-foreground text-xs text-center py-6">
                No scores yet — be the first to submit!
              </p>
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
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">
                        Lv{row.level}
                      </Badge>
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
              <p className="text-muted-foreground text-xs text-center py-4">Loading...</p>
            ) : !data?.topByBiodiversity.length ? (
              <p className="text-muted-foreground text-xs text-center py-6">
                No biodiversity records yet
              </p>
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
                    className="w-12 h-12 rounded border border-white/10 flex flex-col items-center justify-center text-[9px] cursor-default"
                    style={{ backgroundColor: `rgba(0,${green},0,${0.15 + intensity * 0.4})` }}
                    title={`(${r.regionX},${r.regionY}) — Bio: ${r.bestBio}/9 Score: ${r.bestScore.toLocaleString()} Sessions: ${r.sessions}`}
                    data-testid={`region-cell-${r.regionX}-${r.regionY}`}
                  >
                    <span className="text-[11px]">({r.regionX},{r.regionY})</span>
                    <span className="text-green-400 font-bold">{r.bestBio}/9</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Integration Docs */}
      <Card className="border-primary/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Code2 className="w-4 h-4 text-primary" /> Connect Appleseed to NeuroCompute
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-xs text-muted-foreground">
          <p>Paste this snippet into your Appleseed HTML (after the existing scripts) to enable score syncing and LLM agent control:</p>
          <pre className="bg-black/50 border border-white/10 rounded-lg p-3 overflow-x-auto text-[11px] text-green-300 font-mono whitespace-pre select-all" data-testid="code-snippet">
            {SNIPPET}
          </pre>
          <div className="grid md:grid-cols-2 gap-4 pt-1">
            <div>
              <p className="text-foreground font-medium mb-1.5">Score submission</p>
              <p>When you press <kbd className="bg-white/10 border border-white/20 rounded px-1.5 py-0.5 font-mono text-[10px]">e</kbd> in-game, your ecosystem score + full species breakdown is sent here alongside your patron token.</p>
            </div>
            <div>
              <p className="text-foreground font-medium mb-1.5">LLM agent control</p>
              <p>Set <code className="text-primary font-mono">window.ncLLMControl = true</code> before loading the script. Active NeuroCompute compute nodes receive your game state and vote on the next action (plant seed, release bird, etc.).</p>
            </div>
            <div>
              <p className="text-foreground font-medium mb-1.5">Canvas region linking</p>
              <p>Set <code className="text-primary font-mono">window.ncRegionX/Y</code> (0–31) to link your game sessions to a specific cell on the world map. Biodiversity scores enrich that region's data.</p>
            </div>
            <div>
              <p className="text-foreground font-medium mb-1.5">Action API</p>
              <code className="text-[10px] text-muted-foreground/80 font-mono break-all">POST /api/game/appleseed/action</code>
              <p className="mt-1">POSTs game state JSON, returns <code className="text-primary font-mono">&#123; action, x?, y?, species? &#125;</code> within 4 seconds. Falls back to ecology heuristic if no node is online.</p>
            </div>
          </div>
          <div className="pt-2 border-t border-white/5">
            <p className="text-foreground font-medium mb-2">REST API (CORS-enabled)</p>
            <div className="space-y-1 font-mono text-[10px]">
              <p><span className="text-green-400">GET</span>  /api/game/appleseed/leaderboard — top 10 by score + biodiversity</p>
              <p><span className="text-blue-400">POST</span> /api/game/appleseed/score — submit score (JSON body)</p>
              <p><span className="text-blue-400">POST</span> /api/game/appleseed/action — request LLM action decision</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
