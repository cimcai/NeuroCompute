import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { History, Bot, User, BookOpen, ChevronUp } from "lucide-react";

interface HistoryEntry {
  id: number;
  type: "chat" | "journal";
  content: string;
  speaker: string;
  nodeId: number | null;
  role?: string;
  createdAt: string;
}

const NODE_COLORS = [
  "text-cyan-400",
  "text-fuchsia-400",
  "text-emerald-400",
  "text-amber-400",
  "text-violet-400",
  "text-rose-400",
  "text-sky-400",
  "text-lime-400",
  "text-orange-400",
  "text-teal-400",
];

function getNodeColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return NODE_COLORS[Math.abs(hash) % NODE_COLORS.length];
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " +
    d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

type FilterType = "all" | "chat" | "journal";
const PAGE_SIZE = 50;

export function ChatHistory() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [filter, setFilter] = useState<FilterType>("all");
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchPage = useCallback(async (beforeDate?: string) => {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (filter !== "all") params.set("type", filter);
    if (beforeDate) params.set("before", beforeDate);
    const res = await fetch(`/api/chat-history?${params}`);
    if (!res.ok) throw new Error("Failed to load");
    const data = await res.json();
    return data.entries as HistoryEntry[];
  }, [filter]);

  useEffect(() => {
    setEntries([]);
    setHasMore(true);
    setLoading(true);
    fetchPage()
      .then((newEntries) => {
        setEntries(newEntries);
        setHasMore(newEntries.length >= PAGE_SIZE);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [fetchPage]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries.length]);

  const loadOlder = useCallback(async () => {
    if (loading || entries.length === 0) return;
    setLoading(true);
    try {
      const oldest = entries[0].createdAt;
      const olderEntries = await fetchPage(oldest);
      if (olderEntries.length === 0) {
        setHasMore(false);
        return;
      }
      setEntries((prev) => {
        const ids = new Set(prev.map((e) => `${e.type}-${e.id}`));
        const unique = olderEntries.filter((e) => !ids.has(`${e.type}-${e.id}`));
        return [...unique, ...prev];
      });
      setHasMore(olderEntries.length >= PAGE_SIZE);
    } catch (err) {
      console.error("Failed to load older entries:", err);
    } finally {
      setLoading(false);
    }
  }, [loading, entries, fetchPage]);

  return (
    <Card className="flex flex-col h-full">
      <CardContent className="flex-1 flex flex-col p-0 min-h-0">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
          <History className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold" data-testid="text-history-title">Full History</span>
          <span className="text-[10px] text-muted-foreground font-mono ml-1" data-testid="text-history-count">
            {entries.length} entries
          </span>
          <div className="ml-auto flex gap-1">
            {(["all", "chat", "journal"] as FilterType[]).map((f) => (
              <Button
                key={f}
                variant={filter === f ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setFilter(f)}
                className={`h-5 px-2 text-[10px] font-mono ${
                  filter === f ? "text-primary" : "text-muted-foreground"
                }`}
                data-testid={`button-filter-${f}`}
              >
                {f}
              </Button>
            ))}
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto" data-testid="container-history">
          {hasMore && entries.length > 0 && (
            <div className="flex justify-center py-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={loading}
                onClick={loadOlder}
                className="text-xs text-muted-foreground"
                data-testid="button-load-more"
              >
                <ChevronUp className="w-3 h-3 mr-1" />
                {loading ? "Loading..." : "Load older"}
              </Button>
            </div>
          )}

          {entries.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground py-12">
              <History className="w-10 h-10 mb-2 opacity-20" />
              <p className="text-sm" data-testid="text-history-empty">No history yet</p>
              <p className="text-[10px] mt-1">Messages and journal entries will appear here</p>
            </div>
          )}

          {loading && entries.length === 0 && (
            <div className="flex items-center justify-center h-full text-muted-foreground py-12">
              <p className="text-sm">Loading...</p>
            </div>
          )}

          <div className="p-3 space-y-1">
            {entries.map((entry) => (
              <div
                key={`${entry.type}-${entry.id}`}
                className="flex items-start gap-2 rounded px-2 py-1"
                data-testid={`history-entry-${entry.type}-${entry.id}`}
              >
                <div className="flex-shrink-0 mt-0.5">
                  {entry.type === "chat" ? (
                    entry.role === "assistant" ? (
                      <Bot className="w-3 h-3 text-primary" />
                    ) : (
                      <User className="w-3 h-3 text-muted-foreground" />
                    )
                  ) : (
                    <BookOpen className="w-3 h-3 text-emerald-400/60" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-1.5">
                    <span className={`text-xs font-semibold ${getNodeColor(entry.speaker)}`} data-testid={`text-speaker-${entry.type}-${entry.id}`}>
                      {entry.speaker}
                    </span>
                    <span className="text-[9px] text-muted-foreground/40 font-mono">
                      {formatTime(entry.createdAt)}
                    </span>
                    <span className={`text-[9px] font-mono px-1 rounded ${
                      entry.type === "chat"
                        ? "bg-primary/10 text-primary/60"
                        : "bg-emerald-400/10 text-emerald-400/60"
                    }`} data-testid={`badge-type-${entry.type}-${entry.id}`}>
                      {entry.type}
                    </span>
                  </div>
                  <p className="text-xs text-foreground/80 break-words leading-relaxed" data-testid={`text-content-${entry.type}-${entry.id}`}>
                    {entry.content}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
