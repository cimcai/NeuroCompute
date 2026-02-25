import { useEffect, useState } from "react";
import { useNodes } from "@/hooks/use-nodes";
import { useWebSocket } from "@/hooks/use-websocket";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Activity, Cpu, Server, Trophy, Paintbrush } from "lucide-react";
import { Node } from "@shared/schema";
import { motion, AnimatePresence } from "framer-motion";

export function Leaderboard() {
  const { data: initialNodes, isLoading } = useNodes();
  const [liveNodes, setLiveNodes] = useState<Node[]>([]);
  const ws = useWebSocket();

  // Initialize from REST API
  useEffect(() => {
    if (initialNodes) {
      setLiveNodes(initialNodes);
    }
  }, [initialNodes]);

  // Handle live updates
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
        // Construct a partial node for the list
        const newNode: Node = {
          id: data.id,
          name: data.name,
          totalTokens: 0,
          pixelCredits: 0,
          pixelsPlaced: 0,
          status: "offline",
          lastSeen: new Date()
        };
        return [...prev, newNode];
      });
    });

    return () => {
      unsubStats();
      unsubJoined();
    };
  }, [ws]);

  const activeNodes = liveNodes.filter(n => n.status === "computing").length;
  
  // Sort and take top 10
  const sortedNodes = [...liveNodes].sort((a, b) => b.totalTokens - a.totalTokens).slice(0, 10);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="border-b border-white/5 pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-xl">
            <Trophy className="w-5 h-5 text-accent" />
            Global Network
          </CardTitle>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
            </span>
            {activeNodes} active nodes
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-auto p-0">
        {isLoading ? (
          <div className="flex justify-center items-center h-40">
            <Activity className="w-8 h-8 text-muted-foreground animate-pulse" />
          </div>
        ) : sortedNodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
            <Server className="w-12 h-12 mb-2 opacity-20" />
            <p>No nodes registered yet</p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            <AnimatePresence>
              {sortedNodes.map((node, index) => (
                <motion.div
                  key={node.id}
                  layout
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex items-center justify-between p-4 hover:bg-white/[0.02] transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-8 text-center font-mono text-muted-foreground">
                      #{index + 1}
                    </div>
                    <div>
                      <div className="font-medium flex items-center gap-2">
                        {node.name}
                        {node.status === "computing" && (
                          <Cpu className="w-3 h-3 text-primary animate-pulse" />
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Node ID: {node.id}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-primary">
                      {node.totalTokens.toLocaleString()}
                      <span className="text-xs text-muted-foreground ml-1">tkns</span>
                    </div>
                    {(node.pixelCredits > 0 || node.pixelsPlaced > 0) && (
                      <div className="flex items-center justify-end gap-1 mt-0.5">
                        <Paintbrush className="w-3 h-3 text-fuchsia-400" />
                        <span className="text-xs font-mono text-fuchsia-400" data-testid={`text-pixel-credits-${node.id}`}>
                          {node.pixelCredits}
                        </span>
                        {node.pixelsPlaced > 0 && (
                          <span className="text-xs text-muted-foreground">
                            ({node.pixelsPlaced} placed)
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
