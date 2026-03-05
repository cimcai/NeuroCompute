import { useComputeNode } from "@/hooks/use-compute-node";
import { StatCard } from "@/components/StatCard";
import { Leaderboard } from "@/components/Leaderboard";
import { Chat } from "@/components/Chat";
import { ChatHistory } from "@/components/ChatHistory";
import { CimcFeed } from "@/components/CimcFeed";
import { BridgeGame } from "@/components/BridgeGame";
import { PixelCanvas } from "@/components/PixelCanvas";
import { ModelSelector } from "@/components/ModelSelector";
import { Journal } from "@/components/Journal";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Zap, Database, Play, Square, Wifi, WifiOff, Terminal, Download, Shield, TrendingUp, AlertTriangle, Eye, Monitor, MessageSquare, Swords, Users, Radio, User, History } from "lucide-react";
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
    <div className="min-h-screen p-3 md:p-6 lg:p-8 max-w-[1600px] mx-auto space-y-4 overflow-x-hidden">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl md:text-3xl font-display font-bold text-gradient" data-testid="text-app-title">
            NeuroCompute
          </h1>
          <span className="hidden sm:inline text-xs text-muted-foreground border border-white/10 rounded-full px-2 py-0.5">
            AI World Builder
          </span>
        </div>

        <div className="flex items-center gap-2">
          {node.wsConnected ? (
            <div className="flex items-center gap-1.5 text-xs text-primary">
              <Wifi className="w-3.5 h-3.5" />
              <span className="hidden sm:inline" data-testid="text-connection-status">Connected</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-destructive">
              <WifiOff className="w-3.5 h-3.5" />
              <span className="hidden sm:inline" data-testid="text-connection-status">Disconnected</span>
            </div>
          )}
        </div>
      </header>

      {hasWebGPU === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          <span className="font-mono">Detecting hardware...</span>
        </div>
      ) : hasWebGPU === false ? (
        <Card className="border-primary/20" data-testid="card-spectator">
          <CardContent className="p-4 flex items-center gap-4">
            <Eye className="w-5 h-5 text-primary shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-semibold" data-testid="text-spectator-mode">Spectator Mode</div>
              <p className="text-xs text-muted-foreground" data-testid="text-spectator-info">
                WebGPU required to contribute compute (Chrome/Edge desktop). You can still watch the AI world being built.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="relative overflow-hidden border-primary/20">
          {node.status === "computing" && (
            <div className="absolute inset-0 bg-primary/5 animate-pulse-slow pointer-events-none" />
          )}
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 min-w-0">
                {node.status === "offline" && <span className="w-2 h-2 rounded-full bg-muted-foreground shrink-0" />}
                {node.status === "loading" && <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0" />}
                {node.status === "computing" && <span className="w-2 h-2 rounded-full bg-primary shadow-[0_0_10px_rgba(0,255,255,1)] animate-pulse shrink-0" />}
                {node.status === "error" && <span className="w-2 h-2 rounded-full bg-destructive shrink-0" />}
                <span className="text-sm font-mono font-semibold truncate" data-testid="text-node-name">
                  {node.chatName || node.nodeName || "No Node"}
                </span>
                <span className="text-xs text-muted-foreground uppercase" data-testid="text-node-status">{node.status}</span>
              </div>

              <div className="flex items-center gap-2 ml-auto">
                {node.status === "computing" && (
                  <div className="hidden sm:flex items-center gap-3 text-xs mr-2">
                    <span className="text-primary font-mono" data-testid="text-live-speed">
                      <Zap className="w-3 h-3 inline mr-0.5" />{node.tokensPerSecond} tok/s
                    </span>
                    <span className="text-muted-foreground font-mono">
                      {node.sessionTokens.toLocaleString()} tokens
                    </span>
                  </div>
                )}

                {(node.status === "offline" || node.status === "error") ? (
                  <Button size="sm" onClick={node.startCompute} data-testid="button-start-compute">
                    <Play className="mr-1.5 w-3.5 h-3.5" />
                    {node.status === "error" ? "Retry" : "Start Node"}
                  </Button>
                ) : (
                  <Button size="sm" variant="destructive" onClick={node.stopCompute} disabled={node.status === "loading"} data-testid="button-stop-compute">
                    <Square className="mr-1.5 w-3.5 h-3.5 fill-current" />
                    Stop
                  </Button>
                )}
                {node.nodeId && (
                  <Button size="sm" variant="outline" className="border-primary/30" onClick={downloadProof} disabled={downloadingProof} data-testid="button-download-proof">
                    {downloadingProof ? <Shield className="w-3.5 h-3.5 animate-pulse" /> : <Download className="w-3.5 h-3.5" />}
                  </Button>
                )}
              </div>
            </div>

            {node.status === "loading" && (
              <div className="mt-3 space-y-2">
                <Progress value={progressPercent} className="h-2" />
                <div className="flex items-center gap-1.5 text-xs text-amber-500 font-mono">
                  <Terminal className="w-3 h-3" />
                  <span className="truncate">{node.progressText || "Loading weights..."}</span>
                </div>
              </div>
            )}

            {node.status === "error" && node.progressText && (
              <div className="mt-3 flex items-start gap-2 text-xs text-destructive font-mono bg-destructive/10 py-2 px-3 rounded border border-destructive/20" data-testid="text-error-message">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span className="break-words">{node.progressText}</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {hasWebGPU === true && (node.status === "offline" || node.status === "error") && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-[240px]">
              <User className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                data-testid="input-display-name"
                placeholder="Your node name (optional)"
                value={node.displayName || ""}
                onChange={(e) => node.setDisplayName(e.target.value.slice(0, 32) || null)}
                className="pl-8 h-9 text-sm font-mono bg-secondary/30 border-white/10 focus:border-primary/50"
                maxLength={32}
              />
            </div>
            <Card className="border-white/5 bg-secondary/30 flex-1" data-testid="card-network-rate">
              <CardContent className="p-3 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Network Rate</span>
                <span className="text-sm font-mono font-bold text-fuchsia-400" data-testid="text-current-rate">
                  {node.currentRate} <span className="text-xs text-muted-foreground font-normal">tok/credit</span>
                </span>
              </CardContent>
            </Card>
          </div>
          <ModelSelector
            selectedModel={node.selectedModel}
            onSelectModel={node.setSelectedModel}
            activeModel={node.activeModel}
            disabled={node.status === "loading" || node.status === "computing"}
          />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr,340px] gap-4">
        <div className="space-y-4">
          <PixelCanvas nodeId={node.nodeId} autoFollow={true} />
        </div>

        <div className="space-y-4">
          {hasWebGPU === true && node.status === "computing" && (
            <div className="grid grid-cols-3 gap-2">
              <Card className="border-white/5 bg-secondary/30">
                <CardContent className="p-2.5 text-center">
                  <div className="text-lg font-mono font-bold text-primary">{node.tokensPerSecond}</div>
                  <div className="text-[10px] text-muted-foreground">tok/s</div>
                </CardContent>
              </Card>
              <Card className="border-white/5 bg-secondary/30">
                <CardContent className="p-2.5 text-center">
                  <div className="text-lg font-mono font-bold text-fuchsia-400" data-testid="text-current-rate">{node.currentRate}</div>
                  <div className="text-[10px] text-muted-foreground">tok/credit</div>
                </CardContent>
              </Card>
              <Card className="border-white/5 bg-secondary/30">
                <CardContent className="p-2.5 text-center">
                  <div className="text-lg font-mono font-bold">{node.sessionTokens.toLocaleString()}</div>
                  <div className="text-[10px] text-muted-foreground">tokens</div>
                </CardContent>
              </Card>
            </div>
          )}

          <Journal />
        </div>
      </div>

      <Tabs defaultValue="chat" className="w-full">
        <TabsList className="w-full flex-wrap h-auto gap-1" data-testid="tabs-cimc-rooms">
          <TabsTrigger value="chat" className="flex-1 min-w-[60px] text-xs" data-testid="tab-chat">
            <MessageSquare className="w-3 h-3 mr-1" />
            Chat
          </TabsTrigger>
          <TabsTrigger value="history" className="flex-1 min-w-[60px] text-xs" data-testid="tab-history">
            <History className="w-3 h-3 mr-1" />
            History
          </TabsTrigger>
          <TabsTrigger value="room3" className="flex-1 min-w-[60px] text-xs" data-testid="tab-room-3">
            <Swords className="w-3 h-3 mr-1" />
            Bridge
          </TabsTrigger>
          <TabsTrigger value="leaderboard" className="flex-1 min-w-[60px] text-xs" data-testid="tab-leaderboard">
            <Users className="w-3 h-3 mr-1" />
            Nodes
          </TabsTrigger>
          <TabsTrigger value="room2" className="flex-1 min-w-[60px] text-xs" data-testid="tab-room-2">
            <Radio className="w-3 h-3 mr-1" />
            Forum
          </TabsTrigger>
          <TabsTrigger value="room1" className="flex-1 min-w-[60px] text-xs" data-testid="tab-room-1">
            <Monitor className="w-3 h-3 mr-1" />
            Conf
          </TabsTrigger>
        </TabsList>
        <TabsContent value="chat" className="mt-3">
          <div className="h-[400px]">
            <Chat />
          </div>
        </TabsContent>
        <TabsContent value="history" className="mt-3">
          <div className="h-[400px]">
            <ChatHistory />
          </div>
        </TabsContent>
        <TabsContent value="room3" className="mt-3">
          <BridgeGame />
        </TabsContent>
        <TabsContent value="leaderboard" className="mt-3">
          <Leaderboard />
        </TabsContent>
        <TabsContent value="room2" className="mt-3">
          <CimcFeed roomId={2} roomLabel="Open Forum" />
        </TabsContent>
        <TabsContent value="room1" className="mt-3">
          <CimcFeed roomId={1} roomLabel="Main Conference Room" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
