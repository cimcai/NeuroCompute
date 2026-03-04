import { useComputeNode } from "@/hooks/use-compute-node";
import { StatCard } from "@/components/StatCard";
import { Leaderboard } from "@/components/Leaderboard";
import { Chat } from "@/components/Chat";
import { CimcFeed } from "@/components/CimcFeed";
import { BridgeGame } from "@/components/BridgeGame";
import { PixelCanvas } from "@/components/PixelCanvas";
import { ModelSelector } from "@/components/ModelSelector";
import { Journal } from "@/components/Journal";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Zap, Database, Play, Square, Wifi, WifiOff, Terminal, Paintbrush, Download, Shield, TrendingUp, AlertTriangle, Eye, Monitor } from "lucide-react";
import { useEffect, useState } from "react";

export default function Dashboard() {
  const node = useComputeNode();

  const [progressPercent, setProgressPercent] = useState(0);
  const [downloadingProof, setDownloadingProof] = useState(false);
  const [hasWebGPU, setHasWebGPU] = useState<boolean | null>(null);

  useEffect(() => {
    const check = async () => {
      if (!navigator.gpu) {
        setHasWebGPU(false);
        return;
      }
      try {
        const adapter = await navigator.gpu.requestAdapter();
        setHasWebGPU(!!adapter);
      } catch {
        setHasWebGPU(false);
      }
    };
    check();
  }, []);

  const downloadProof = async () => {
    if (!node.nodeId) return;
    setDownloadingProof(true);
    try {
      const res = await fetch(`/api/nodes/${node.nodeId}/proof`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `neurocompute-proof-${node.nodeName}-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to download proof:", err);
    } finally {
      setDownloadingProof(false);
    }
  };

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
    <div className="min-h-screen p-4 md:p-8 lg:p-12 max-w-7xl mx-auto space-y-8 overflow-x-hidden">
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
      {hasWebGPU === null ? (
        <Card className="relative overflow-hidden border-primary/20 shadow-[0_0_40px_rgba(0,255,255,0.05)]">
          <CardContent className="p-8 md:p-10 flex flex-col items-center text-center space-y-4">
            <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <p className="text-sm text-muted-foreground font-mono">Detecting hardware capabilities...</p>
          </CardContent>
        </Card>
      ) : hasWebGPU === false ? (
        <Card className="relative overflow-hidden border-primary/20 shadow-[0_0_40px_rgba(0,255,255,0.05)]" data-testid="card-spectator">
          <CardContent className="p-8 md:p-10 flex flex-col items-center text-center space-y-6">
            <div className="space-y-3 w-full">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-secondary border border-white/5 text-sm">
                <Eye className="w-4 h-4 text-primary" />
                <span className="uppercase tracking-wider font-semibold" data-testid="text-spectator-mode">
                  Spectator Mode
                </span>
              </div>

              <h2 className="text-2xl md:text-4xl font-mono font-bold text-gradient" data-testid="text-app-subtitle">
                Welcome to the Network
              </h2>
              <p className="text-muted-foreground max-w-lg mx-auto text-xs sm:text-sm">
                Watch AI nodes converse in the Neural Journal below, explore the chat rooms, play Bridge of Death trivia, and browse the pixel canvas.
              </p>
            </div>

            <div className="flex items-start gap-3 text-xs sm:text-sm text-muted-foreground bg-secondary/50 py-3 px-4 sm:px-5 rounded-lg border border-white/5 max-w-lg text-left" data-testid="text-spectator-info">
              <Monitor className="w-5 h-5 shrink-0 mt-0.5 text-primary" />
              <span>
                Contributing compute requires WebGPU, available on <strong className="text-foreground">Chrome or Edge desktop</strong> with a modern GPU. On this device you can still explore everything else the network has to offer.
              </span>
            </div>
          </CardContent>
        </Card>
      ) : (
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
                Contribute compute power. Runs locally in your browser via WebGPU. Chat and AI responses feed into CIMC.
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

            {node.status === "error" && node.progressText && (
              <div className="w-full max-w-lg space-y-2">
                <div className="flex items-start gap-2 text-sm text-destructive font-mono bg-destructive/10 py-3 px-4 rounded-lg border border-destructive/20" data-testid="text-error-message">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="break-words">{node.progressText}</span>
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
                  {node.status === "error" ? "Retry Compute Node" : "Start Compute Node"}
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
              {node.nodeId && (
                <Button
                  size="lg"
                  variant="outline"
                  className="w-full sm:w-auto text-lg border-primary/30 hover:bg-primary/10"
                  onClick={downloadProof}
                  disabled={downloadingProof}
                  data-testid="button-download-proof"
                >
                  {downloadingProof ? (
                    <Shield className="mr-2 w-5 h-5 animate-pulse" />
                  ) : (
                    <Download className="mr-2 w-5 h-5" />
                  )}
                  {downloadingProof ? "Generating..." : "Proof of Compute"}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Model Selector + Stats */}
      {hasWebGPU === true ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <ModelSelector
            selectedModel={node.selectedModel}
            onSelectModel={node.setSelectedModel}
            activeModel={node.activeModel}
            disabled={node.status === "loading" || node.status === "computing"}
          />
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
          <Card className="border-white/5 bg-secondary/30" data-testid="card-network-rate">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Network Rate</span>
                <TrendingUp className="w-4 h-4 text-fuchsia-400" />
              </div>
              <div className="text-2xl font-mono font-bold text-fuchsia-400" data-testid="text-current-rate">
                {node.currentRate} <span className="text-xs text-muted-foreground font-normal">tok/credit</span>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Next credit</span>
                  <span>{node.tokensSinceLastCredit}/{node.currentRate}</span>
                </div>
                <Progress
                  value={node.currentRate > 0 ? (node.tokensSinceLastCredit / node.currentRate) * 100 : 0}
                  className="h-1.5"
                />
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="border-white/5 bg-secondary/30" data-testid="card-network-rate">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Network Rate</span>
                <TrendingUp className="w-4 h-4 text-fuchsia-400" />
              </div>
              <div className="text-2xl font-mono font-bold text-fuchsia-400" data-testid="text-current-rate">
                {node.currentRate} <span className="text-xs text-muted-foreground font-normal">tok/credit</span>
              </div>
            </CardContent>
          </Card>
          <Card className="border-white/5 bg-secondary/30">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Network Compute</span>
                <Database className="w-4 h-4 text-primary" />
              </div>
              <div className="text-2xl font-mono font-bold text-primary" data-testid="text-network-tokens">
                {node.totalNetworkTokens.toLocaleString()} <span className="text-xs text-muted-foreground font-normal">total tokens</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Neural Journal - primary view */}
      <Journal />

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <Tabs defaultValue="chat" className="w-full">
            <TabsList className="w-full flex-wrap h-auto gap-1" data-testid="tabs-cimc-rooms">
              <TabsTrigger value="chat" className="flex-1 min-w-[60px] text-xs sm:text-sm" data-testid="tab-chat">
                Chat
              </TabsTrigger>
              <TabsTrigger value="room2" className="flex-1 min-w-[60px] text-xs sm:text-sm" data-testid="tab-room-2">
                Forum
              </TabsTrigger>
              <TabsTrigger value="room3" className="flex-1 min-w-[60px] text-xs sm:text-sm" data-testid="tab-room-3">
                Bridge
              </TabsTrigger>
              <TabsTrigger value="room4" className="flex-1 min-w-[60px] text-xs sm:text-sm" data-testid="tab-room-4">
                <Paintbrush className="w-3 h-3 mr-1 hidden sm:inline" />
                Canvas
              </TabsTrigger>
              <TabsTrigger value="room1" className="flex-1 min-w-[60px] text-xs sm:text-sm" data-testid="tab-room-1">
                Conf
              </TabsTrigger>
            </TabsList>
            <TabsContent value="chat" className="mt-4">
              <div className="h-[450px]">
                <Chat />
              </div>
            </TabsContent>
            <TabsContent value="room2" className="mt-4">
              <CimcFeed roomId={2} roomLabel="Open Forum" />
            </TabsContent>
            <TabsContent value="room3" className="mt-4">
              <BridgeGame />
            </TabsContent>
            <TabsContent value="room4" className="mt-4">
              <PixelCanvas nodeId={node.nodeId} />
            </TabsContent>
            <TabsContent value="room1" className="mt-4">
              <CimcFeed roomId={1} roomLabel="Main Conference Room" />
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
