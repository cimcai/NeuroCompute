import { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useWebSocket } from "@/hooks/use-websocket";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AVAILABLE_MODELS } from "@/lib/models";
import { Sword, Trophy, Skull, CheckCircle, XCircle, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

interface BridgeGame {
  id: number;
  sessionId: string;
  playerName: string;
  modelId: string;
  questionsAnswered: number;
  questionsCorrect: number;
  won: string;
  questions: string[];
  answers: string[];
  results: string[];
  createdAt: string;
}

interface BridgeStats {
  modelId: string;
  gamesPlayed: number;
  gamesWon: number;
  totalCorrect: number;
  totalAnswered: number;
}

interface LiveQuestion {
  gameId: number;
  question: string;
  questionNumber: number;
  category: string;
  modelId: string;
}

interface LiveResult {
  gameId: number;
  correct: boolean;
  message: string;
  gameOver: boolean;
  won: boolean;
  score: { answered: number; correct: number; total: number };
}

export function BridgeGame() {
  const ws = useWebSocket();
  const queryClient = useQueryClient();
  const [starting, setStarting] = useState(false);
  const [liveQuestion, setLiveQuestion] = useState<LiveQuestion | null>(null);
  const [liveResult, setLiveResult] = useState<LiveResult | null>(null);
  const [selectedModel, setSelectedModel] = useState(AVAILABLE_MODELS[0].id);

  const { data: games = [] } = useQuery<BridgeGame[]>({
    queryKey: ["/api/bridge/games"],
  });

  const { data: stats = [] } = useQuery<BridgeStats[]>({
    queryKey: ["/api/bridge/stats"],
  });

  useEffect(() => {
    const unsub1 = ws.subscribe("bridgeQuestion", (data: LiveQuestion) => {
      setLiveQuestion(data);
      setLiveResult(null);
    });
    const unsub2 = ws.subscribe("bridgeResult", (data: LiveResult) => {
      setLiveResult(data);
      if (data.gameOver) {
        setLiveQuestion(null);
        queryClient.invalidateQueries({ queryKey: ["/api/bridge/games"] });
        queryClient.invalidateQueries({ queryKey: ["/api/bridge/stats"] });
      }
    });
    const unsub3 = ws.subscribe("bridgeUpdate", () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bridge/games"] });
    });
    return () => { unsub1(); unsub2(); unsub3(); };
  }, [ws, queryClient]);

  const startGame = async () => {
    setStarting(true);
    setLiveResult(null);
    try {
      await fetch("/api/bridge/play", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId: selectedModel }),
      });
    } catch (err) {
      console.error("Failed to start bridge game:", err);
    } finally {
      setStarting(false);
    }
  };

  const modelLabel = (modelId: string) => {
    const m = AVAILABLE_MODELS.find((x) => x.id === modelId);
    return m ? m.label : modelId.split("-").slice(0, 2).join("-");
  };

  const recentGames = games.slice(0, 10);
  const completedGames = games.filter((g) => g.won !== "pending");

  return (
    <div className="space-y-4">
      <Card className="border-accent/20">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg" data-testid="text-bridge-title">
            <Sword className="w-5 h-5 text-accent" />
            Bridge of Death
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Answer three questions to cross. Your WebLLM model plays the game on CIMC Room 3.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground mb-1 block">Choose model to play</label>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="w-full bg-secondary/50 border border-white/10 rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                data-testid="select-bridge-model"
              >
                {AVAILABLE_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} ({m.size})
                  </option>
                ))}
              </select>
            </div>
            <Button
              onClick={startGame}
              disabled={starting || !!liveQuestion}
              className="bg-accent hover:bg-accent/80 text-white"
              data-testid="button-start-bridge"
            >
              {starting ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Sword className="w-4 h-4 mr-2" />
              )}
              Play
            </Button>
          </div>

          <AnimatePresence mode="wait">
            {liveQuestion && (
              <motion.div
                key={`q-${liveQuestion.gameId}-${liveQuestion.questionNumber}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="p-4 rounded-lg bg-accent/10 border border-accent/30 space-y-2"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-accent">
                    Q{liveQuestion.questionNumber}/3
                  </span>
                  <span className="text-xs text-muted-foreground px-2 py-0.5 rounded-full bg-secondary border border-white/5">
                    {liveQuestion.category}
                  </span>
                </div>
                <p className="text-sm font-medium">{liveQuestion.question}</p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>{modelLabel(liveQuestion.modelId)} is thinking...</span>
                </div>
              </motion.div>
            )}

            {liveResult && (
              <motion.div
                key={`r-${liveResult.gameId}-${liveResult.score.answered}`}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className={cn(
                  "p-4 rounded-lg border space-y-2",
                  liveResult.correct
                    ? "bg-green-500/10 border-green-500/30"
                    : "bg-destructive/10 border-destructive/30"
                )}
              >
                <div className="flex items-center gap-2">
                  {liveResult.correct ? (
                    <CheckCircle className="w-5 h-5 text-green-400" />
                  ) : (
                    <XCircle className="w-5 h-5 text-destructive" />
                  )}
                  <span className="text-sm font-medium">{liveResult.message}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Score: {liveResult.score.correct}/{liveResult.score.total}
                </p>
                {liveResult.gameOver && (
                  <div className={cn("flex items-center gap-2 text-sm font-bold mt-2", liveResult.won ? "text-green-400" : "text-destructive")}>
                    {liveResult.won ? (
                      <>
                        <Trophy className="w-5 h-5" />
                        CROSSED THE BRIDGE!
                      </>
                    ) : (
                      <>
                        <Skull className="w-5 h-5" />
                        CAST INTO THE GORGE!
                      </>
                    )}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>

      {stats.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg" data-testid="text-bridge-stats">
              <Trophy className="w-5 h-5 text-primary" />
              Model Scoreboard
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {stats
                .sort((a, b) => b.gamesWon - a.gamesWon || (b.totalCorrect / Math.max(b.totalAnswered, 1)) - (a.totalCorrect / Math.max(a.totalAnswered, 1)))
                .map((s) => {
                  const accuracy = s.totalAnswered > 0 ? Math.round((s.totalCorrect / s.totalAnswered) * 100) : 0;
                  return (
                    <div
                      key={s.modelId}
                      className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-white/5"
                      data-testid={`bridge-stat-${s.modelId}`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-mono text-sm font-medium truncate">{modelLabel(s.modelId)}</p>
                        <p className="text-xs text-muted-foreground">
                          {s.gamesPlayed} game{s.gamesPlayed !== 1 ? "s" : ""} played
                        </p>
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <div className="text-center">
                          <p className="font-bold text-green-400">{s.gamesWon}</p>
                          <p className="text-xs text-muted-foreground">wins</p>
                        </div>
                        <div className="text-center">
                          <p className="font-bold text-primary">{accuracy}%</p>
                          <p className="text-xs text-muted-foreground">accuracy</p>
                        </div>
                        <div className="text-center">
                          <p className="font-bold">{s.totalCorrect}/{s.totalAnswered}</p>
                          <p className="text-xs text-muted-foreground">correct</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </CardContent>
        </Card>
      )}

      {recentGames.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg" data-testid="text-bridge-history">
              <Sparkles className="w-5 h-5 text-muted-foreground" />
              Recent Games
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {recentGames.map((game) => (
                <div
                  key={game.id}
                  className="p-3 rounded-lg bg-secondary/30 border border-white/5 space-y-2"
                  data-testid={`bridge-game-${game.id}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {game.won === "yes" && <Trophy className="w-4 h-4 text-green-400" />}
                      {game.won === "no" && <Skull className="w-4 h-4 text-destructive" />}
                      {game.won === "pending" && <Loader2 className="w-4 h-4 animate-spin text-accent" />}
                      <span className="font-mono text-sm font-medium">{modelLabel(game.modelId)}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(game.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {game.questions.map((q, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs">
                        {i < game.results.length ? (
                          game.results[i] === "correct" ? (
                            <CheckCircle className="w-3 h-3 text-green-400 mt-0.5 flex-shrink-0" />
                          ) : (
                            <XCircle className="w-3 h-3 text-destructive mt-0.5 flex-shrink-0" />
                          )
                        ) : (
                          <div className="w-3 h-3 rounded-full border border-white/20 mt-0.5 flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-muted-foreground truncate">{q}</p>
                          {i < game.answers.length && (
                            <p className={cn("font-medium", game.results[i] === "correct" ? "text-green-400" : "text-destructive")}>
                              → {game.answers[i]}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Score: {game.questionsCorrect}/{game.questionsAnswered}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
