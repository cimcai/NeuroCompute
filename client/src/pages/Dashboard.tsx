import { useComputeNode } from "@/hooks/use-compute-node";
import { StatCard } from "@/components/StatCard";
import { Leaderboard } from "@/components/Leaderboard";
import { Chat } from "@/components/Chat";
import { CimcFeed } from "@/components/CimcFeed";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Zap, Database, Play, Square, Wifi, WifiOff, Terminal } from "lucide-react";
import { useEffect, useState } from "react";

export default function Dashboard() {
  const node = useComputeNode();

  const [progressPercent, setProgressPercent] = useState(0);

  useEffect(() => {
    if (node.progressText) {
      const match = node.progressText.match(/(\d+)%/);
      if (match) {
        setProgressPercent(parseInt(match[1]));
      } else {
        setProgressPercent((prev) => (prev >= 95 ? 95 : prev + 1));
      }
    } else {
      setProgressPercent(0);
    }
  }, [node.progressText]);

  return (
    <div className="min-h-screen p-4 md:p-8 lg:p-12 max-w-7xl mx-auto space-y-8">
      <header className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-display font-bold text-gradient" data-testid="text-app-title">
            NeuroCompute
          </h1>
          <p className="text-muted-foreground mt-1">
            Decentralized LLM Inference Network
          </p>
        </div>

        <div className="flex items-center gap-3 bg-secondary/50 rounded-full px-4 py-2 border border-white/5">
          {node.wsConnected ? (
            <Wifi className="w-4 h-4 text-primary" />
          ) : (
            <WifiOff className="w-4 h-4 text-destructive" />
          )}
          <span className="text-sm font-medium" data-testid="text-connection-status">
            {node.wsConnected ? "Network Connected" : "Network Disconnected"}
          </span>
        </div>
      </header>

      {/* Compute Node Controls */}
      <Card className="relative overflow-hidden border-primary/20 shadow-[0_0_40px_rgba(0,255,255,0.05)]">
        {node.status === "computing" && (
          <div className="absolute inset-0 bg-primary/5 animate-pulse-slow pointer-events-none" />
        )}

        <CardContent className="p-8 md:p-10 flex flex-col items-center text-center space-y-6">
          <div className="space-y-3 w-full">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-secondary border border-white/5 text-sm">
              {node.status === "offline" && <span className="w-2 h-2 rounded-full bg-muted-foreground" />}
              {node.status === "loading" && <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />}
              {node.status === "computing" && <span className="w-2 h-2 rounded-full bg-primary shadow-[0_0_10px_rgba(0,255,255,1)] animate-pulse" />}
              {node.status === "error" && <span className="w-2 h-2 rounded-full bg-destructive" />}
              <span className="uppercase tracking-wider font-semibold" data-testid="text-node-status">
                Status: {node.status}
              </span>
            </div>

            <h2 className="text-3xl md:text-4xl font-mono font-bold" data-testid="text-node-name">
              {node.nodeName || "Node Unregistered"}
            </h2>
            <p className="text-muted-foreground max-w-md mx-auto text-sm">
              Contribute compute power. Runs locally in your browser via WebGPU. Chat and AI responses feed into CIMC Room 2.
            </p>
          </div>

          {node.status === "loading" && (
            <div className="w-full max-w-md space-y-3">
              <Progress value={progressPercent} className="h-3" />
              <div className="flex items-center gap-2 text-sm text-amber-500 justify-center font-mono bg-amber-500/10 py-2 px-4 rounded-lg border border-amber-500/20">
                <Terminal className="w-4 h-4" />
                <span className="truncate">{node.progressText || "Loading weights..."}</span>
              </div>
            </div>
          )}

          <div className="flex flex-wrap justify-center gap-4">
            {node.status === "offline" || node.status === "error" ? (
              <Button
                size="lg"
                className="w-full sm:w-auto text-lg"
                onClick={node.startCompute}
                data-testid="button-start-compute"
              >
                <Play className="mr-2 w-5 h-5" />
                Start Compute Node
              </Button>
            ) : (
              <Button
                size="lg"
                variant="destructive"
                className="w-full sm:w-auto text-lg"
                onClick={node.stopCompute}
                disabled={node.status === "loading"}
                data-testid="button-stop-compute"
              >
                <Square className="mr-2 w-5 h-5 fill-current" />
                Stop Node
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <StatCard
          title="Live Speed"
          value={node.tokensPerSecond}
          subtitle="Tokens per second"
          icon={<Zap className="w-6 h-6" />}
          valueColor={node.tokensPerSecond > 0 ? "text-primary" : "text-muted-foreground"}
        />
        <StatCard
          title="Session Contribution"
          value={node.sessionTokens.toLocaleString()}
          subtitle="Total tokens generated"
          icon={<Database className="w-6 h-6" />}
          valueColor="text-foreground"
        />
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <div className="h-[450px]">
            <Chat />
          </div>

          <Tabs defaultValue="room2" className="w-full">
            <TabsList className="w-full" data-testid="tabs-cimc-rooms">
              <TabsTrigger value="room2" className="flex-1" data-testid="tab-room-2">
                NeuroCompute (Room 2)
              </TabsTrigger>
              <TabsTrigger value="room1" className="flex-1" data-testid="tab-room-1">
                Hackathon (Room 1)
              </TabsTrigger>
            </TabsList>
            <TabsContent value="room2" className="mt-4">
              <CimcFeed roomId={2} roomLabel="NeuroCompute Room" />
            </TabsContent>
            <TabsContent value="room1" className="mt-4">
              <CimcFeed roomId={1} roomLabel="Hackathon Room" />
            </TabsContent>
          </Tabs>
        </div>

        <div>
          <div className="lg:sticky lg:top-8">
            <Leaderboard />
          </div>
        </div>
      </div>
    </div>
  );
}
