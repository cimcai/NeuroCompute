import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWebSocket } from "@/hooks/use-websocket";
import { Card, CardContent } from "@/components/ui/card";
import { BookOpen } from "lucide-react";

interface JournalEntry {
  id: number;
  nodeName: string;
  nodeId: number | null;
  content: string;
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

function getNodeColor(nodeName: string): string {
  let hash = 0;
  for (let i = 0; i < nodeName.length; i++) {
    hash = nodeName.charCodeAt(i) + ((hash << 5) - hash);
  }
  return NODE_COLORS[Math.abs(hash) % NODE_COLORS.length];
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function Journal() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const ws = useWebSocket();

  const { data: initialEntries } = useQuery<JournalEntry[]>({
    queryKey: ["/api/journal"],
  });

  useEffect(() => {
    if (initialEntries) {
      setEntries(initialEntries);
    }
  }, [initialEntries]);

  useEffect(() => {
    const unsub = ws.subscribe("journalEntry", (data: JournalEntry) => {
      setEntries((prev) => {
        const updated = [...prev, data];
        if (updated.length > 200) {
          return updated.slice(-200);
        }
        return updated;
      });
    });
    return unsub;
  }, [ws]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  return (
    <Card className="border-primary/20 h-full" data-testid="card-journal">
      <CardContent className="p-3">
        <div className="flex items-center gap-2 mb-2">
          <BookOpen className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">Neural Journal</span>
          <span className="text-[10px] text-muted-foreground font-mono ml-auto">
            {entries.length}
          </span>
        </div>
        <div className="h-[calc(100vh-380px)] min-h-[280px] max-h-[700px] overflow-y-auto rounded bg-black/20 flex-1" ref={scrollRef}>
          <div className="p-2 space-y-0.5 font-mono text-xs">
            {entries.length === 0 && (
              <div className="text-center text-muted-foreground py-8 space-y-1">
                <BookOpen className="w-6 h-6 mx-auto opacity-50" />
                <p className="text-xs">Journal empty</p>
                <p className="text-[10px]">Start a node to begin</p>
              </div>
            )}
            {entries.map((entry) => (
              <div key={entry.id} className="hover:bg-white/[0.02] rounded px-1.5 py-0.5 transition-colors leading-relaxed" data-testid={`journal-entry-${entry.id}`}>
                <span className="text-muted-foreground/40 text-[10px] mr-1">
                  {formatTime(entry.createdAt)}
                </span>
                <span className={`font-semibold ${getNodeColor(entry.nodeName)}`}>
                  {entry.nodeName.slice(-4)}
                </span>
                <span className="text-foreground/80 ml-1">
                  {entry.content}
                </span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
