import { useComputeNode } from "@/hooks/use-compute-node";
import { StatCard } from "@/components/StatCard";
import { Leaderboard } from "@/components/Leaderboard";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import { Cpu, Zap, Database, Play, Square, Wifi, WifiOff, Terminal } from "lucide-react";
import { useEffect, useState } from "react";

export default function Dashboard() {
  const node = useComputeNode();
  
  // Try to parse percentage from WebLLM progress text if available
  const [progressPercent, setProgressPercent] = useState(0);
  
  useEffect(() => {
    if (node.progressText) {
      // Often looks like: "Loading model... 45%" or "[1/3] Downloading... 25%"
      const match = node.progressText.match(/(\d+)%/);
      if (match) {
        setProgressPercent(parseInt(match[1]));
      } else {
        // Fallback for indeterminate loading
        setProgressPercent(prev => prev >= 95 ? 95 : prev + 1);
      }
    } else {
      setProgressPercent(0);
    }
  }, [node.progressText]);

  return (
    <div className="min-h-screen p-4 md:p-8 lg:p-12 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <header className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-display font-bold text-gradient">
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
          <span className="text-sm font-medium">
            {node.wsConnected ? "Network Connected" : "Network Disconnected"}
          </span>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Personal Node */}
        <div className="lg:col-span-2 space-y-8">
          
          {/* Main Controls Card */}
          <Card className="relative overflow-hidden border-primary/20 shadow-[0_0_40px_rgba(0,255,255,0.05)]">
            {/* Ambient background glow when computing */}
            {node.status === "computing" && (
              <div className="absolute inset-0 bg-primary/5 animate-pulse-slow pointer-events-none" />
            )}
            
            <CardContent className="p-8 md:p-12 flex flex-col items-center text-center space-y-8">
              <div className="space-y-4 w-full">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-secondary border border-white/5 text-sm">
                  {node.status === "offline" && <span className="w-2 h-2 rounded-full bg-muted-foreground" />}
                  {node.status === "loading" && <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />}
                  {node.status === "computing" && <span className="w-2 h-2 rounded-full bg-primary shadow-[0_0_10px_rgba(0,255,255,1)] animate-pulse" />}
                  <span className="uppercase tracking-wider font-semibold">
                    Status: {node.status}
                  </span>
                </div>
                
                <h2 className="text-3xl md:text-5xl font-mono font-bold">
                  {node.nodeName || "Node Unregistered"}
                </h2>
                <p className="text-muted-foreground max-w-md mx-auto">
                  Contribute your idle compute power to the decentralized network. 
                  Runs entirely locally in your browser using WebGPU.
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

              <div className="flex flex-wrap justify-center gap-4 pt-4">
                {node.status === "offline" || node.status === "error" ? (
                  <Button 
                    size="lg" 
                    variant="neon" 
                    className="w-full sm:w-auto text-lg"
                    onClick={node.startCompute}
                  >
                    <Play className="mr-2 w-5 h-5" />
                    Start Compute Node
                  </Button>
                ) : (
                  <Button 
                    size="lg" 
                    variant="destructive" 
                    className="w-full sm:w-auto text-lg bg-red-600 hover:bg-red-700 shadow-[0_0_15px_rgba(255,0,0,0.3)]"
                    onClick={node.stopCompute}
                    disabled={node.status === "loading"}
                  >
                    <Square className="mr-2 w-5 h-5 fill-current" />
                    Stop Node
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <StatCard 
              title="Live Hashrate" 
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
        </div>

        {/* Right Column: Leaderboard */}
        <div className="lg:h-[800px]">
          <Leaderboard />
        </div>
      </div>
    </div>
  );
}
