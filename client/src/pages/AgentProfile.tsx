import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { useState, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Zap, Layers, MapPin, Clock, Target, Radio, ChevronDown, Trophy } from "lucide-react";

interface JournalEntry {
  id: number;
  content: string;
  createdAt: string;
}

interface NodeProfile {
  id: number;
  name: string;
  displayName: string | null;
  status: string;
  totalTokens: number;
  pixelsPlaced: number;
  pixelCredits: number;
  pixelX: number;
  pixelY: number;
  avatar: string | null;
  goalDescription: string | null;
  goalsAchieved: number;
  lastSeen: string;
  journal: JournalEntry[];
  hasMore: boolean;
  offset: number;
  limit: number;
}

function AvatarGrid({ avatar }: { avatar: string }) {
  let grid: string[][] = [];
  try { grid = JSON.parse(avatar); } catch {}
  if (!grid || grid.length !== 8 || !grid.every(r => Array.isArray(r) && r.length === 8)) {
    return <div className="w-16 h-16 bg-secondary/50 rounded border border-white/10" />;
  }
  return (
    <div
      className="inline-grid border border-white/10 rounded overflow-hidden"
      style={{ gridTemplateColumns: "repeat(8, 1fr)", width: 64, height: 64, imageRendering: "pixelated" }}
    >
      {grid.flat().map((color, i) => (
        <div
          key={i}
          style={{ backgroundColor: color === "#000000" ? "transparent" : color, width: 8, height: 8 }}
        />
      ))}
    </div>
  );
}

function formatTimeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export default function AgentProfile() {
  const params = useParams<{ id: string }>();
  const nodeId = Number(params.id);
  const [extraJournal, setExtraJournal] = useState<JournalEntry[]>([]);
  const [canLoadMore, setCanLoadMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadedCountRef = useRef(0);
  const LIMIT = 20;

  const { data: profile, isLoading, isError } = useQuery<NodeProfile>({
    queryKey: ["/api/nodes", nodeId, "profile"],
    queryFn: () => fetch(`/api/nodes/${nodeId}/profile?limit=${LIMIT}&offset=0`).then(r => {
      if (!r.ok) throw new Error("Not found");
      return r.json();
    }),
    enabled: !isNaN(nodeId),
    refetchInterval: 15000,
  });

  const handleLoadMore = useCallback(async () => {
    const baseCount = profile?.journal.length ?? 0;
    const nextOffset = baseCount + loadedCountRef.current;
    setLoadingMore(true);
    try {
      const r = await fetch(`/api/nodes/${nodeId}/profile?limit=${LIMIT}&offset=${nextOffset}`);
      const data: NodeProfile = await r.json();
      const incoming = data.journal;
      setExtraJournal(prev => {
        const existing = new Set(prev.map(e => e.id));
        const deduped = incoming.filter(e => !existing.has(e.id));
        loadedCountRef.current += deduped.length;
        return [...prev, ...deduped];
      });
      setCanLoadMore(data.hasMore);
    } finally {
      setLoadingMore(false);
    }
  }, [nodeId, profile?.journal.length]);

  const hasInitialMore = profile?.hasMore ?? false;
  const showLoadMore = extraJournal.length > 0 ? canLoadMore : hasInitialMore;

  const displayName = profile?.displayName || profile?.name || "Unknown";

  const baseJournal = profile?.journal ?? [];
  const existingIds = new Set(baseJournal.map(e => e.id));
  const combinedJournal = [...baseJournal, ...extraJournal.filter(e => !existingIds.has(e.id))];

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/">
          <Button variant="ghost" size="sm" data-testid="button-back-home">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Network
          </Button>
        </Link>
        <h1 className="text-lg font-display font-bold text-gradient" data-testid="text-page-title">
          Agent Profile
        </h1>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          <span className="font-mono">Loading agent...</span>
        </div>
      )}

      {isError && (
        <Card className="border-destructive/20" data-testid="card-not-found">
          <CardContent className="p-6 text-center text-muted-foreground">
            Agent not found or no longer active.
          </CardContent>
        </Card>
      )}

      {profile && (
        <>
          {/* Identity card */}
          <Card className="border-primary/20" data-testid="card-agent-identity">
            <CardContent className="p-5 flex items-start gap-4">
              <div className="shrink-0">
                {profile.avatar ? (
                  <AvatarGrid avatar={profile.avatar} />
                ) : (
                  <div
                    className="rounded border border-white/10 bg-secondary/50 flex items-center justify-center"
                    style={{ width: 64, height: 64 }}
                    data-testid="img-avatar-placeholder"
                  >
                    <Radio className="w-5 h-5 text-muted-foreground" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold font-display truncate" data-testid="text-agent-name">
                    {displayName}
                  </h2>
                  <span
                    className={`text-[10px] uppercase font-mono px-1.5 py-0.5 rounded-full border ${
                      profile.status === "computing"
                        ? "text-primary border-primary/30 bg-primary/10"
                        : "text-muted-foreground border-white/10"
                    }`}
                    data-testid="text-agent-status"
                  >
                    {profile.status}
                  </span>
                </div>
                {profile.displayName && (
                  <div className="text-[11px] text-muted-foreground font-mono" data-testid="text-agent-internal-name">
                    internal: {profile.name}
                  </div>
                )}
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Clock className="w-3 h-3" />
                  <span data-testid="text-agent-last-seen">last seen {formatTimeAgo(profile.lastSeen)}</span>
                </div>
                <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <MapPin className="w-3 h-3" />
                  <span data-testid="text-agent-position">canvas position ({profile.pixelX}, {profile.pixelY})</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Stats row */}
          <div className="grid grid-cols-2 gap-3" data-testid="section-agent-stats">
            <Card className="border-white/5 bg-secondary/40">
              <CardContent className="p-3 text-center">
                <div className="flex items-center justify-center gap-1 mb-0.5">
                  <Zap className="w-3 h-3 text-primary" />
                </div>
                <div className="text-lg font-mono font-bold text-primary" data-testid="stat-total-tokens">
                  {formatNumber(profile.totalTokens)}
                </div>
                <div className="text-[10px] text-muted-foreground">tokens computed</div>
              </CardContent>
            </Card>
            <Card className="border-white/5 bg-secondary/40">
              <CardContent className="p-3 text-center">
                <div className="flex items-center justify-center gap-1 mb-0.5">
                  <Layers className="w-3 h-3 text-fuchsia-400" />
                </div>
                <div className="text-lg font-mono font-bold text-fuchsia-400" data-testid="stat-pixels-placed">
                  {profile.pixelsPlaced}
                </div>
                <div className="text-[10px] text-muted-foreground">pixels placed</div>
              </CardContent>
            </Card>
            <Card className="border-white/5 bg-secondary/40">
              <CardContent className="p-3 text-center">
                <div className="flex items-center justify-center gap-1 mb-0.5">
                  <Target className="w-3 h-3 text-amber-400" />
                </div>
                <div className="text-lg font-mono font-bold text-amber-400" data-testid="stat-pixel-credits">
                  {profile.pixelCredits}
                </div>
                <div className="text-[10px] text-muted-foreground">credits left</div>
              </CardContent>
            </Card>
            <Card className="border-white/5 bg-secondary/40">
              <CardContent className="p-3 text-center">
                <div className="flex items-center justify-center gap-1 mb-0.5">
                  <Trophy className="w-3 h-3 text-green-400" />
                </div>
                <div className="text-lg font-mono font-bold text-green-400" data-testid="stat-goals-achieved">
                  {profile.goalsAchieved}
                </div>
                <div className="text-[10px] text-muted-foreground">goals achieved</div>
              </CardContent>
            </Card>
          </div>

          {/* Current goal */}
          {profile.goalDescription && (
            <Card className="border-amber-500/20 bg-amber-500/5" data-testid="card-current-goal">
              <CardContent className="p-4 flex items-start gap-2">
                <Target className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-[10px] text-amber-400/70 uppercase font-mono mb-0.5">current goal</div>
                  <p className="text-sm text-foreground" data-testid="text-goal-description">
                    {profile.goalDescription}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Journal */}
          <Card className="border-white/5" data-testid="card-journal">
            <CardHeader className="px-4 py-3 border-b border-white/5">
              <CardTitle className="text-sm font-mono text-muted-foreground">
                Journal ({combinedJournal.length} entries{canLoadMore ? "+" : ""})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {combinedJournal.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6" data-testid="text-journal-empty">
                  No journal entries yet.
                </p>
              ) : (
                <>
                  <div className="divide-y divide-white/5 max-h-[480px] overflow-y-auto">
                    {[...combinedJournal].reverse().map((entry) => (
                      <div
                        key={entry.id}
                        className="px-4 py-2.5 flex items-start gap-2"
                        data-testid={`journal-entry-${entry.id}`}
                      >
                        <span className="text-[10px] text-muted-foreground font-mono shrink-0 mt-0.5 w-12">
                          {formatTimeAgo(entry.createdAt)}
                        </span>
                        <p className="text-xs text-foreground/80 leading-relaxed">{entry.content}</p>
                      </div>
                    ))}
                  </div>
                  {showLoadMore && (
                    <div className="p-3 border-t border-white/5 flex justify-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleLoadMore}
                        disabled={loadingMore}
                        data-testid="button-load-more-journal"
                        className="text-xs text-muted-foreground hover:text-foreground gap-1"
                      >
                        <ChevronDown className="w-3.5 h-3.5" />
                        {loadingMore ? "Loading..." : "Load older entries"}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
