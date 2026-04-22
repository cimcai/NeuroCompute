import { useEffect, useState } from "react";
import { useNodes } from "@/hooks/use-nodes";
import { useWebSocket } from "@/hooks/use-websocket";
import { useQuery } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Activity, Cpu, Server, Trophy, Paintbrush, Users, Zap } from "lucide-react";
import { Node } from "@shared/schema";
import { motion, AnimatePresence } from "framer-motion";

interface PatronEntry {
  id: number;
  name: string;
  agentCount: number;
  activeAgents: number;
  totalTokens: number;
  pixelsPlaced: number;
  createdAt: string;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

type Period = 'all' | '7d' | '24h';

const PERIOD_LABELS: Record<Period, string> = {
  all: 'All time',
  '7d': '7 days',
  '24h': '24 hours',
};

export function Leaderboard() {
  const { data: initialNodes, isLoading } = useNodes();
  const [liveNodes, setLiveNodes] = useState<Node[]>([]);
  const [period, setPeriod] = useState<Period>('all');
  const ws = useWebSocket();

  const patronQuery = useQuery<PatronEntry[]>({
    queryKey: ["/api/patrons/leaderboard", period],
    queryFn: () => fetch(`/api/patrons/leaderboard?period=${period}`).then(r => r.json()),
    refetchInterval: 30000,
  });

  useEffect(() => {
    if (initialNodes) setLiveNodes(initialNodes);
  }, [initialNodes]);

  useEffect(() => {
    const unsubStats = ws.subscribe("statsUpdate", (data) => {
      setLiveNodes(prev => {
        const exists = prev.find(n => n.id === data.id);
        if (exists) {
          return prev.map(n =>
            n.id === data.id
              ? { ...n, totalTokens: data.totalTokens, pixelCredits: data.pixelCredits ?? n.pixelCredits, pixelsPlaced: data.pixelsPlaced ?? n.pixelsPlaced, status: data.status }
              : n
          ).sort((a, b) => b.totalTokens - a.totalTokens);
        }
        return prev;
      });
    });

    const unsubJoined = ws.subscribe("nodeJoined", (data) => {
      setLiveNodes(prev => {
        if (prev.find(n => n.id === data.id)) return prev;
        const newNode: Node = {
          id: data.id,
          name: data.name,
          displayName: null,
          patronId: null,
          totalTokens: 0,
          tokensSinceLastCredit: 0,
          pixelCredits: 0,
          pixelsPlaced: 0,
          pixelX: 16,
          pixelY: 16,
          pixelGoal: null,
          avatar: null,
          status: "computing",
          lastSeen: new Date(),
        };
        return [...prev, newNode];
      });
    });

    return () => { unsubStats(); unsubJoined(); };
  }, [ws]);

  const activeNodes = liveNodes.filter(n => n.status === "computing").length;
  const sortedNodes = [...liveNodes].sort((a, b) => b.totalTokens - a.totalTokens).slice(0, 15);
  const patrons = patronQuery.data ?? [];

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="border-b border-white/5 pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Trophy className="w-4 h-4 text-accent" />
            Global Network
          </CardTitle>
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
            </span>
            {activeNodes} computing
          </div>
        </div>
      </CardHeader>

      <Tabs defaultValue="patrons" className="flex-1 flex flex-col">
        <TabsList className="mx-4 mt-3 mb-1 h-8 w-auto self-start">
          <TabsTrigger value="patrons" className="text-xs h-7 gap-1" data-testid="tab-patrons">
            <Users className="w-3 h-3" />
            Patrons
          </TabsTrigger>
          <TabsTrigger value="nodes" className="text-xs h-7 gap-1" data-testid="tab-nodes">
            <Cpu className="w-3 h-3" />
            Agents
          </TabsTrigger>
        </TabsList>

        <TabsContent value="patrons" className="flex-1 overflow-auto m-0 p-0">
          <div className="flex gap-1 px-4 py-2 border-b border-white/5">
            {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                data-testid={`button-period-${p}`}
                className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                  period === p
                    ? 'bg-primary/20 text-primary border border-primary/30'
                    : 'text-muted-foreground hover:text-foreground border border-transparent'
                }`}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
          {patronQuery.isLoading ? (
            <div className="flex justify-center items-center h-32">
              <Activity className="w-6 h-6 text-muted-foreground animate-pulse" />
            </div>
          ) : patrons.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
              <Users className="w-10 h-10 opacity-20" />
              <p className="text-sm">No patrons yet — claim your identity above</p>
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              <AnimatePresence>
                {patrons.map((patron, index) => (
                  <motion.div
                    key={patron.id}
                    layout
                    initial={{ opacity: 0, x: -16 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors"
                    data-testid={`row-patron-${patron.id}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-6 text-center font-mono text-xs text-muted-foreground">#{index + 1}</div>
                      <div>
                        <div className="font-medium text-sm flex items-center gap-1.5">
                          {patron.name}
                          {patron.activeAgents > 0 && (
                            <span className="flex h-1.5 w-1.5 relative">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary" />
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {patron.agentCount} agent{patron.agentCount !== 1 ? "s" : ""}
                          {patron.activeAgents > 0 && ` · ${patron.activeAgents} active`}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-sm text-primary flex items-center gap-1">
                        <Zap className="w-3 h-3" />
                        {formatTokens(patron.totalTokens)}
                        <span className="text-[10px] text-muted-foreground font-normal">tkns</span>
                      </div>
                      {patron.pixelsPlaced > 0 && (
                        <div className="flex items-center justify-end gap-1 mt-0.5">
                          <Paintbrush className="w-3 h-3 text-fuchsia-400" />
                          <span className="text-[10px] font-mono text-fuchsia-400">{patron.pixelsPlaced} placed</span>
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </TabsContent>

        <TabsContent value="nodes" className="flex-1 overflow-auto m-0 p-0">
          {isLoading ? (
            <div className="flex justify-center items-center h-32">
              <Activity className="w-6 h-6 text-muted-foreground animate-pulse" />
            </div>
          ) : sortedNodes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
              <Server className="w-10 h-10 opacity-20" />
              <p className="text-sm">No nodes registered yet</p>
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              <AnimatePresence>
                {sortedNodes.map((node, index) => (
                  <motion.div
                    key={node.id}
                    layout
                    initial={{ opacity: 0, x: -16 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors"
                    data-testid={`row-node-${node.id}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-6 text-center font-mono text-xs text-muted-foreground">#{index + 1}</div>
                      <div>
                        <div className="font-medium text-sm flex items-center gap-1.5">
                          {node.displayName || node.name}
                          {node.status === "computing" && (
                            <Cpu className="w-3 h-3 text-primary animate-pulse" />
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground">ID #{node.id}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-sm text-primary">
                        {formatTokens(node.totalTokens)}
                        <span className="text-[10px] text-muted-foreground ml-1 font-normal">tkns</span>
                      </div>
                      {(node.pixelCredits > 0 || node.pixelsPlaced > 0) && (
                        <div className="flex items-center justify-end gap-1 mt-0.5">
                          <Paintbrush className="w-3 h-3 text-fuchsia-400" />
                          <span className="text-[10px] font-mono text-fuchsia-400" data-testid={`text-pixel-credits-${node.id}`}>
                            {node.pixelCredits}
                          </span>
                          {node.pixelsPlaced > 0 && (
                            <span className="text-[10px] text-muted-foreground">({node.pixelsPlaced})</span>
                          )}
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </Card>
  );
}
