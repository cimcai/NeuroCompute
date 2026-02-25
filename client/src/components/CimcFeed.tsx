import { useState, useEffect, useRef } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import { Globe, Sparkles, MessageCircle, Send } from "lucide-react";

interface CimcEntry {
  id: number;
  speaker: string;
  content: string;
  timestamp: string;
}

interface CimcPhilosopher {
  id: number;
  name: string;
  description: string;
  color: string;
  confidence: number;
  hasResponse: boolean;
  proposedResponse?: string;
}

interface CimcFeedProps {
  roomId: number;
  roomLabel: string;
}

export function CimcFeed({ roomId, roomLabel }: CimcFeedProps) {
  const [entries, setEntries] = useState<CimcEntry[]>([]);
  const [philosophers, setPhilosophers] = useState<CimcPhilosopher[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchData = async () => {
    try {
      const [convRes, philRes] = await Promise.all([
        fetch(`/api/cimc/conversation?roomId=${roomId}&limit=40`),
        fetch(`/api/cimc/philosophers?roomId=${roomId}`),
      ]);
      if (convRes.ok) {
        const convData = await convRes.json();
        setEntries(convData.entries || []);
      }
      if (philRes.ok) {
        const philData = await philRes.json();
        setPhilosophers(philData.philosophers || []);
      }
    } catch (err) {
      console.error("CIMC fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    fetchData();
    const interval = setInterval(fetchData, 6000);
    return () => clearInterval(interval);
  }, [roomId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  const handleSubmit = async () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await fetch("/api/cimc/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          speaker: "NeuroCompute User",
          content: trimmed,
          roomId,
        }),
      });
      setInput("");
      setTimeout(fetchData, 1000);
    } catch (err) {
      console.error("CIMC submit error:", err);
    } finally {
      setSubmitting(false);
    }
  };

  const activePhilosophers = philosophers
    .filter((p) => p.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence);

  return (
    <div className="space-y-4">
      {activePhilosophers.length > 0 && (
        <Card>
          <CardHeader className="border-b border-white/5 pb-3">
            <CardTitle className="flex items-center gap-2 text-lg" data-testid="text-spirits-title">
              <Sparkles className="w-5 h-5 text-accent" />
              Active Spirits
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-3">
              {activePhilosophers.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary/50 border border-white/5"
                  data-testid={`spirit-${p.id}`}
                >
                  <div
                    className="w-3 h-3 rounded-full animate-pulse"
                    style={{ backgroundColor: p.color, boxShadow: `0 0 8px ${p.color}` }}
                  />
                  <div>
                    <p className="text-sm font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Confidence: {p.confidence}%
                      {p.hasResponse && <span className="text-primary ml-1">(ready)</span>}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="flex flex-col h-[500px]">
        <CardHeader className="border-b border-white/5 pb-3">
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="flex items-center gap-2 text-lg" data-testid="text-cimc-title">
              <Globe className="w-5 h-5 text-primary" />
              {roomLabel}
            </CardTitle>
            <a
              href="https://cimc.io"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-primary transition-colors"
              data-testid="link-cimc-site"
            >
              cimc.io
            </a>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Room {roomId} — Live conversation stream from the CIMC Spirits network
          </p>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col p-0 min-h-0">
          {loading ? (
            <div className="flex justify-center items-center flex-1">
              <Globe className="w-8 h-8 text-muted-foreground animate-pulse" />
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 text-muted-foreground">
              <MessageCircle className="w-12 h-12 mb-2 opacity-20" />
              <p className="text-sm">No conversation entries yet in this room</p>
            </div>
          ) : (
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
              <AnimatePresence>
                {entries.map((entry) => (
                  <motion.div
                    key={entry.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-1"
                    data-testid={`cimc-entry-${entry.id}`}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-semibold text-primary">{entry.speaker}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-sm text-foreground/90 leading-relaxed">
                      {entry.content}
                    </p>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}

          <div className="p-4 border-t border-white/5">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSubmit();
              }}
              className="flex gap-2"
            >
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Submit to CIMC (moderated)..."
                className="flex-1 bg-secondary/50 border border-white/10 rounded-lg px-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                data-testid={`input-cimc-room-${roomId}`}
              />
              <Button
                type="submit"
                size="icon"
                disabled={!input.trim() || submitting}
                data-testid={`button-cimc-submit-${roomId}`}
              >
                <Send className="w-4 h-4" />
              </Button>
            </form>
            <p className="text-xs text-muted-foreground mt-1">
              Submissions go through admin moderation before appearing
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
