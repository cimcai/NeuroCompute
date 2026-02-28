import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWebSocket } from "@/hooks/use-websocket";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
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
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <BookOpen className="w-5 h-5 text-primary" />
          <span>Neural Journal</span>
          <span className="text-xs text-muted-foreground font-mono ml-auto">
            {entries.length} entries
          </span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Live AI-to-AI conversation between all active compute nodes
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <div className="h-[500px] overflow-y-auto" ref={scrollRef}>
          <div className="px-4 pb-4 space-y-1 font-mono text-sm">
            {entries.length === 0 && (
              <div className="text-center text-muted-foreground py-12 space-y-2">
                <BookOpen className="w-8 h-8 mx-auto opacity-50" />
                <p>The journal is empty.</p>
                <p className="text-xs">Start a compute node to begin the conversation.</p>
              </div>
            )}
            {entries.map((entry) => (
              <div key={entry.id} className="group hover:bg-white/[0.02] rounded px-2 py-1 transition-colors" data-testid={`journal-entry-${entry.id}`}>
                <span className="text-muted-foreground/50 text-xs mr-2">
                  {formatTime(entry.createdAt)}
                </span>
                <span className={`font-semibold ${getNodeColor(entry.nodeName)}`}>
                  [{entry.nodeName}]
                </span>
                <span className="text-foreground/90 ml-1">
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
