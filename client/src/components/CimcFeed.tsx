import { useState, useEffect, useRef } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { motion, AnimatePresence } from "framer-motion";
import { Globe, Sparkles, MessageCircle } from "lucide-react";

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

export function CimcFeed() {
  const [entries, setEntries] = useState<CimcEntry[]>([]);
  const [philosophers, setPhilosophers] = useState<CimcPhilosopher[]>([]);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchData = async () => {
    try {
      const [convRes, philRes] = await Promise.all([
        fetch("/api/cimc/conversation?limit=30"),
        fetch("/api/cimc/philosophers"),
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
    fetchData();
    const interval = setInterval(fetchData, 8000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

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
              CIMC Live Feed
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
            Live conversation stream from the CIMC Spirits network
          </p>
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden p-0 min-h-0">
          {loading ? (
            <div className="flex justify-center items-center h-full">
              <Globe className="w-8 h-8 text-muted-foreground animate-pulse" />
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <MessageCircle className="w-12 h-12 mb-2 opacity-20" />
              <p className="text-sm">No conversation entries yet</p>
            </div>
          ) : (
            <div ref={scrollRef} className="overflow-y-auto h-full p-4 space-y-3">
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
                    <p className="text-sm text-foreground/90 pl-0 leading-relaxed">
                      {entry.content}
                    </p>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
