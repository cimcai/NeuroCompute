import type { Express } from "express";
import { type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { createHmac } from "crypto";
import { storage } from "./storage";
import { api, ws as wsSchema } from "@shared/routes";
import { z } from "zod";
import * as cimc from "./cimc";
import { startOrchestrator } from "./agent-orchestrator";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.get(api.nodes.list.path, async (req, res) => {
    const nodes = await storage.getNodes();
    res.json(nodes);
  });

  app.get(api.nodes.get.path, async (req, res) => {
    const node = await storage.getNode(Number(req.params.id));
    if (!node) {
      return res.status(404).json({ message: "Node not found" });
    }
    res.json(node);
  });

  app.post(api.nodes.create.path, async (req, res) => {
    try {
      const input = api.nodes.create.input.parse(req.body);
      const node = await storage.createNode(input);
      res.status(201).json(node);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join("."),
        });
      }
      throw err;
    }
  });

  app.get("/api/nodes/:id/proof", async (req, res) => {
    try {
      const node = await storage.getNode(Number(req.params.id));
      if (!node) {
        return res.status(404).json({ message: "Node not found" });
      }

      const proofData = {
        version: "1.0",
        network: "NeuroCompute",
        type: "proof-of-compute",
        node: {
          id: node.id,
          name: node.name,
          status: node.status,
        },
        compute: {
          totalTokensGenerated: node.totalTokens,
          pixelCreditsEarned: node.pixelCredits + node.pixelsPlaced,
          pixelCreditsRemaining: node.pixelCredits,
          pixelsPlaced: node.pixelsPlaced,
          tokensPerPixelCredit: (await storage.getCurrentPixelRate()).rate,
        },
        metadata: {
          issuedAt: new Date().toISOString(),
          lastSeen: node.lastSeen.toISOString(),
          networkEndpoint: "https://neurocompute.replit.app",
          cimcIntegration: "https://cimc.io",
        },
      };

      const payload = JSON.stringify(proofData, null, 0);
      const secret = process.env.SESSION_SECRET || "neurocompute-default";
      const signature = createHmac("sha256", secret).update(payload).digest("hex");

      const certificate = {
        ...proofData,
        proof: {
          algorithm: "HMAC-SHA256",
          signature,
          verifyEndpoint: "/api/verify-proof",
        },
      };

      res.setHeader("Content-Type", "application/json");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="neurocompute-proof-${node.name}-${Date.now()}.json"`
      );
      res.json(certificate);
    } catch (err) {
      console.error("Proof generation error:", err);
      res.status(500).json({ message: "Failed to generate proof of compute" });
    }
  });

  app.post("/api/verify-proof", async (req, res) => {
    try {
      const { proof, ...proofData } = req.body;
      if (!proof?.signature) {
        return res.status(400).json({ valid: false, message: "No signature provided" });
      }

      const payload = JSON.stringify(proofData, null, 0);
      const secret = process.env.SESSION_SECRET || "neurocompute-default";
      const expected = createHmac("sha256", secret).update(payload).digest("hex");

      if (expected === proof.signature) {
        const node = await storage.getNode(proofData.node?.id);
        res.json({
          valid: true,
          message: "Proof of compute verified successfully",
          currentState: node
            ? {
                totalTokens: node.totalTokens,
                pixelCredits: node.pixelCredits,
                pixelsPlaced: node.pixelsPlaced,
                status: node.status,
              }
            : null,
        });
      } else {
        res.json({ valid: false, message: "Invalid signature — proof has been tampered with" });
      }
    } catch (err) {
      console.error("Proof verification error:", err);
      res.status(500).json({ valid: false, message: "Verification failed" });
    }
  });

  app.get(api.messages.list.path, async (req, res) => {
    const msgs = await storage.getMessages();
    res.json(msgs);
  });

  app.get("/api/network/rate", async (req, res) => {
    try {
      const { rate, totalNetworkTokens } = await storage.getCurrentPixelRate();
      res.json({ rate, totalNetworkTokens });
    } catch (err) {
      console.error("Network rate error:", err);
      res.status(500).json({ message: "Failed to fetch network rate" });
    }
  });

  app.get("/api/journal", async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const entries = await storage.getJournalEntries(limit);
      res.json(entries);
    } catch (err) {
      console.error("Journal fetch error:", err);
      res.status(500).json({ message: "Failed to fetch journal" });
    }
  });

  app.get("/api/journal/context", async (req, res) => {
    try {
      const limit = Number(req.query.limit) || 8;
      const entries = await storage.getJournalEntries(limit);
      const context = entries
        .map((e) => `[${e.nodeName}]: ${e.content}`)
        .join("\n");

      let networkActivity = "";
      try {
        const recentGames = await storage.getBridgeGames(5);
        const finishedGames = recentGames.filter(g => g.won !== "pending");
        if (finishedGames.length > 0) {
          const bridgeSummaries = finishedGames.slice(0, 3).map(g => {
            const result = g.won === "yes" ? "CROSSED successfully" : "was CAST INTO THE GORGE";
            return `${g.playerName} (${g.modelId}) ${result} — answered ${g.questionsCorrect}/${g.questionsAnswered} correctly`;
          });
          networkActivity += `\n\n[BRIDGE OF DEATH RECENT RESULTS]:\n${bridgeSummaries.join("\n")}`;
        }
        const stats = await storage.getBridgeStats();
        if (stats.length > 0) {
          const totalGames = stats.reduce((a, s) => a + s.gamesPlayed, 0);
          const totalWins = stats.reduce((a, s) => a + s.gamesWon, 0);
          networkActivity += `\nOverall: ${totalGames} attempts, ${totalWins} successful crossings (${totalGames > 0 ? Math.round(totalWins / totalGames * 100) : 0}% survival rate)`;
        }
      } catch {}

      try {
        const canvasData = await cimc.getCanvas();
        if (canvasData) {
          const { grid, totalPlacements, uniqueAgents } = canvasData;
          if (totalPlacements > 0) {
            const colorCounts: Record<string, number> = {};
            for (const row of grid) {
              for (const cell of row) {
                if (cell !== "#000000") {
                  colorCounts[cell] = (colorCounts[cell] || 0) + 1;
                }
              }
            }
            const topColors = Object.entries(colorCounts)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 3)
              .map(([color, count]) => `${color} (${count}px)`)
              .join(", ");
            const filledCells = Object.values(colorCounts).reduce((a, b) => a + b, 0);
            networkActivity += `\n\n[PIXEL CANVAS STATUS]:\n${filledCells} pixels placed by ${uniqueAgents} agents (${totalPlacements} total placements on 32x32 grid). Dominant colors: ${topColors}`;
          }
        }
      } catch {}

      res.json({ context, count: entries.length, networkActivity });
    } catch (err) {
      console.error("Journal context error:", err);
      res.status(500).json({ message: "Failed to fetch journal context" });
    }
  });

  // CIMC proxy endpoints
  app.get("/api/cimc/conversation", async (req, res) => {
    try {
      const roomId = Number(req.query.roomId) || 1;
      const limit = Number(req.query.limit) || 30;
      const data = await cimc.getConversation(roomId, limit);
      res.json(data);
    } catch (err) {
      console.error("CIMC conversation error:", err);
      res.status(502).json({ message: "Failed to fetch CIMC conversation" });
    }
  });

  app.get("/api/cimc/philosophers", async (req, res) => {
    try {
      const roomId = Number(req.query.roomId) || 1;
      const data = await cimc.getPhilosophers(roomId);
      res.json(data);
    } catch (err) {
      console.error("CIMC philosophers error:", err);
      res.status(502).json({ message: "Failed to fetch CIMC philosophers" });
    }
  });

  app.get("/api/cimc/spirits", async (req, res) => {
    try {
      const data = await cimc.getSpirits();
      res.json(data);
    } catch (err) {
      console.error("CIMC spirits error:", err);
      res.status(502).json({ message: "Failed to fetch CIMC spirits" });
    }
  });

  app.post("/api/cimc/submit", async (req, res) => {
    try {
      const { speaker, content, roomId } = req.body;
      if (!speaker || !content) {
        return res.status(400).json({ message: "speaker and content are required" });
      }
      const data = await cimc.submitResponse(speaker, content, roomId || 1);
      res.json(data);
    } catch (err) {
      console.error("CIMC submit error:", err);
      res.status(502).json({ message: "Failed to submit to CIMC" });
    }
  });

  app.post("/api/cimc/open-forum", async (req, res) => {
    try {
      const { speaker, content, roomId } = req.body;
      if (!speaker || !content) {
        return res.status(400).json({ message: "speaker and content are required" });
      }
      const data = await cimc.postToOpenForum(speaker, content, roomId || 2);
      res.json(data);
    } catch (err) {
      console.error("CIMC open forum error:", err);
      res.status(502).json({ message: "Failed to post to CIMC open forum" });
    }
  });

  app.get("/api/cimc/rooms", async (req, res) => {
    try {
      const data = await cimc.getRooms();
      res.json(data);
    } catch (err) {
      console.error("CIMC rooms error:", err);
      res.status(502).json({ message: "Failed to fetch CIMC rooms" });
    }
  });

  app.get("/api/cimc/room-entries", async (req, res) => {
    try {
      const roomId = Number(req.query.roomId) || 2;
      const limit = Number(req.query.limit) || 30;
      const data = await cimc.getRoomEntries(roomId, limit);
      res.json(data);
    } catch (err) {
      console.error("CIMC room entries error:", err);
      res.status(502).json({ message: "Failed to fetch CIMC room entries" });
    }
  });

  app.post("/api/cimc/bridge/start", async (req, res) => {
    try {
      const data = await cimc.startBridge();
      res.json(data);
    } catch (err) {
      console.error("CIMC bridge start error:", err);
      res.status(502).json({ message: "Failed to start Bridge of Death" });
    }
  });

  app.post("/api/cimc/bridge/answer", async (req, res) => {
    try {
      const { sessionId, answer } = req.body;
      if (!sessionId || !answer) {
        return res.status(400).json({ message: "sessionId and answer are required" });
      }
      const data = await cimc.answerBridge(sessionId, answer);
      res.json(data);
    } catch (err) {
      console.error("CIMC bridge answer error:", err);
      res.status(502).json({ message: "Failed to answer Bridge of Death" });
    }
  });

  app.get("/api/cimc/bridge/leaderboard", async (req, res) => {
    try {
      const data = await cimc.getBridgeLeaderboard();
      res.json(data);
    } catch (err) {
      console.error("CIMC bridge leaderboard error:", err);
      res.status(502).json({ message: "Failed to fetch Bridge leaderboard" });
    }
  });

  app.post("/api/bridge/play", async (req, res) => {
    try {
      const { modelId } = req.body;
      if (!modelId) {
        return res.status(400).json({ message: "modelId is required" });
      }
      const playerName = `NeuroCompute-${modelId.split("-")[0]}`;
      const session = await cimc.startBridge(playerName);

      const game = await storage.createBridgeGame({
        sessionId: session.sessionId,
        playerName,
        modelId,
        questionsAnswered: 0,
        questionsCorrect: 0,
        won: "pending",
        questions: [session.question],
        answers: [],
        results: [],
      });

      broadcastAll(JSON.stringify({
        type: "bridgeQuestion",
        payload: {
          gameId: game.id,
          sessionId: session.sessionId,
          question: session.question,
          questionNumber: session.questionNumber,
          category: session.category,
          modelId,
        },
      }));

      broadcastAll(JSON.stringify({
        type: "bridgeUpdate",
        payload: { game },
      }));

      res.json({ game, session });
    } catch (err) {
      console.error("Bridge play error:", err);
      res.status(500).json({ message: "Failed to start Bridge game" });
    }
  });

  app.get("/api/bridge/games", async (req, res) => {
    try {
      const games = await storage.getBridgeGames(100);
      res.json(games);
    } catch (err) {
      console.error("Bridge games error:", err);
      res.status(500).json({ message: "Failed to fetch bridge games" });
    }
  });

  app.get("/api/bridge/stats", async (req, res) => {
    try {
      const stats = await storage.getBridgeStats();
      res.json(stats);
    } catch (err) {
      console.error("Bridge stats error:", err);
      res.status(500).json({ message: "Failed to fetch bridge stats" });
    }
  });

  app.get("/api/canvas", async (req, res) => {
    try {
      const data = await cimc.getCanvas();
      if (!data) {
        return res.status(502).json({ message: "Canvas API returned invalid response" });
      }
      res.json(data);
    } catch (err) {
      console.error("Canvas fetch error:", err);
      res.status(502).json({ message: "Failed to fetch canvas from CIMC" });
    }
  });

  app.post("/api/canvas/place", async (req, res) => {
    try {
      const { color, nodeId } = req.body;
      if (!color || !nodeId) {
        return res.status(400).json({ message: "color and nodeId are required" });
      }
      const currentNode = await storage.getNode(Number(nodeId));
      if (!currentNode) return res.status(404).json({ message: "Node not found" });
      const x = currentNode.pixelX;
      const y = currentNode.pixelY;
      const node = await storage.spendPixelCredit(Number(nodeId));
      const result = await cimc.placePixel(x, y, color, `NeuroCompute-${node.name}`);
      broadcastAll(JSON.stringify({
        type: "pixelPlaced",
        payload: { x, y, color, agent: node.name, nodeId: node.id, pixelCredits: node.pixelCredits },
      }));
      res.json({ pixel: result, node });
    } catch (err: any) {
      console.error("Canvas place error:", err);
      if (err.message === "Not enough pixel credits") {
        return res.status(403).json({ message: "Not enough pixel credits. Contribute more compute tokens!" });
      }
      if (err.message === "Node not found") {
        return res.status(404).json({ message: "Node not found" });
      }
      res.status(500).json({ message: "Failed to place pixel" });
    }
  });

  app.post("/api/canvas/move", async (req, res) => {
    try {
      const { nodeId, x, y } = req.body;
      if (!nodeId || x === undefined || y === undefined) {
        return res.status(400).json({ message: "nodeId, x, and y are required" });
      }
      const node = await storage.getNode(Number(nodeId));
      if (!node) return res.status(404).json({ message: "Node not found" });
      const nx = Number(x);
      const ny = Number(y);
      if (nx < 0 || nx > 31 || ny < 0 || ny > 31) {
        return res.status(400).json({ message: "Position must be within the 32x32 grid" });
      }
      const dx = Math.abs(nx - node.pixelX);
      const dy = Math.abs(ny - node.pixelY);
      if (dx > 1 || dy > 1) {
        return res.status(400).json({ message: "Can only move to adjacent cells (1 step)" });
      }
      const updated = await storage.moveNode(Number(nodeId), Number(x), Number(y));
      broadcastAll(JSON.stringify({
        type: "nodeMoved",
        payload: { nodeId: updated.id, nodeName: updated.name, x: updated.pixelX, y: updated.pixelY },
      }));
      res.json({ node: updated });
    } catch (err: any) {
      console.error("Canvas move error:", err);
      res.status(500).json({ message: "Failed to move node" });
    }
  });

  app.get("/api/canvas/credits/:nodeId", async (req, res) => {
    try {
      const node = await storage.getNode(Number(req.params.nodeId));
      if (!node) return res.status(404).json({ message: "Node not found" });
      const { rate } = await storage.getCurrentPixelRate();
      res.json({ pixelCredits: node.pixelCredits, pixelsPlaced: node.pixelsPlaced, totalTokens: node.totalTokens, tokensSinceLastCredit: node.tokensSinceLastCredit, currentRate: rate, pixelX: node.pixelX, pixelY: node.pixelY });
    } catch (err) {
      console.error("Canvas credits error:", err);
      res.status(500).json({ message: "Failed to fetch credits" });
    }
  });

  await storage.markAllNodesOffline();
  console.log("[startup] Reset all stale nodes to offline");

  setInterval(async () => {
    try {
      await storage.markStaleNodesOffline(2);
    } catch (err) {
      console.error("Stale node sweep error:", err);
    }
  }, 60_000);

  // WebSocket
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  const clients = new Map<number, WebSocket>();

  function broadcast(msg: string, exclude?: WebSocket) {
    wss.clients.forEach((c) => {
      if (c !== exclude && c.readyState === WebSocket.OPEN) {
        c.send(msg);
      }
    });
  }

  function broadcastAll(msg: string) {
    wss.clients.forEach((c) => {
      if (c.readyState === WebSocket.OPEN) {
        c.send(msg);
      }
    });
  }

  wss.on("connection", (socket) => {
    let nodeId: number | null = null;

    socket.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.type === "nodeJoined") {
          const parsed = wsSchema.send.nodeJoined.parse(message.payload);
          nodeId = parsed.id;
          clients.set(nodeId, socket);
          await storage.updateNodeStatus(nodeId, "computing");
          const node = await storage.getNode(nodeId);
          if (node) {
            broadcast(
              JSON.stringify({ type: "nodeJoined", payload: { id: node.id, name: node.name } }),
              socket
            );
          }
        } else if (message.type === "stats") {
          if (!nodeId) return;
          const parsed = wsSchema.send.stats.parse(message.payload);
          const { node: updated, currentRate } = await storage.updateNodeTokens(nodeId, parsed.tokensGenerated);
          broadcastAll(
            JSON.stringify({
              type: "statsUpdate",
              payload: {
                id: nodeId,
                totalTokens: updated.totalTokens,
                pixelCredits: updated.pixelCredits,
                pixelsPlaced: updated.pixelsPlaced,
                status: updated.status,
                tokensPerSecond: parsed.tokensPerSecond,
                currentRate,
                tokensSinceLastCredit: updated.tokensSinceLastCredit,
              },
            })
          );
        } else if (message.type === "chatMessage") {
          const parsed = wsSchema.send.chatMessage.parse(message.payload);
          const saved = await storage.createMessage({
            role: "user",
            content: parsed.content,
            senderName: parsed.senderName,
            nodeId: null,
          });
          broadcastAll(
            JSON.stringify({
              type: "chatMessage",
              payload: { id: saved.id, content: saved.content, senderName: saved.senderName, role: "user" },
            })
          );
          broadcastAll(
            JSON.stringify({
              type: "chatPending",
              payload: { content: parsed.content },
            })
          );
          // Submit to CIMC Open Forum (Room 2, no moderation)
          try {
            await cimc.postToOpenForum(parsed.senderName, parsed.content, 2);
          } catch (err) {
            console.error("CIMC submit error (chat):", err);
          }
        } else if (message.type === "bridgeAnswer") {
          const parsed = wsSchema.send.bridgeAnswer.parse(message.payload);
          const game = await storage.getBridgeGames(100).then(g => g.find(x => x.id === parsed.gameId));
          if (game && game.won === "pending") {
            try {
              const result = await cimc.answerBridge(game.sessionId, parsed.answer);
              const newQuestions = [...game.questions];
              const newAnswers = [...game.answers, parsed.answer];
              const newResults = [...game.results, result.correct ? "correct" : "wrong"];

              if (result.nextQuestion) {
                newQuestions.push(result.nextQuestion);
              }

              const updates: any = {
                questionsAnswered: result.score.answered,
                questionsCorrect: result.score.correct,
                questions: newQuestions,
                answers: newAnswers,
                results: newResults,
              };

              if (result.gameOver) {
                updates.won = result.won ? "yes" : "no";
              }

              const updated = await storage.updateBridgeGame(game.id, updates);

              broadcastAll(JSON.stringify({
                type: "bridgeResult",
                payload: {
                  gameId: game.id,
                  correct: result.correct,
                  message: result.message,
                  gameOver: result.gameOver,
                  won: result.won || false,
                  score: result.score,
                },
              }));

              broadcastAll(JSON.stringify({
                type: "bridgeUpdate",
                payload: { game: updated },
              }));

              if (!result.gameOver && result.nextQuestion) {
                broadcastAll(JSON.stringify({
                  type: "bridgeQuestion",
                  payload: {
                    gameId: game.id,
                    sessionId: game.sessionId,
                    question: result.nextQuestion,
                    questionNumber: result.nextQuestionNumber || result.score.answered + 1,
                    category: result.nextCategory || "general",
                    modelId: game.modelId,
                  },
                }));
              }
            } catch (err) {
              console.error("Bridge answer error:", err);
            }
          }
        } else if (message.type === "chatResponse") {
          const parsed = wsSchema.send.chatResponse.parse(message.payload);
          const saved = await storage.createMessage({
            role: "assistant",
            content: parsed.content,
            senderName: parsed.nodeName,
            nodeId: parsed.nodeId,
          });
          broadcastAll(
            JSON.stringify({
              type: "chatMessage",
              payload: { id: saved.id, content: saved.content, senderName: saved.nodeName, role: "assistant" },
            })
          );
          try {
            await cimc.postToOpenForum(`NeuroCompute:${parsed.nodeName}`, parsed.content, 2);
          } catch (err) {
            console.error("CIMC submit error (response):", err);
          }
        } else if (message.type === "pixelGoalSet") {
          const { nodeId: goalNodeId, nodeName: goalNodeName, description, targetX, targetY, color } = message.payload;
          if (!goalNodeId || !description) return;
          const goalData = JSON.stringify({ description, targetX, targetY, color, setAt: Date.now() });
          await storage.updateNodeGoal(goalNodeId, goalData);
          broadcastAll(
            JSON.stringify({
              type: "nodeGoalSet",
              payload: { nodeId: goalNodeId, nodeName: goalNodeName || "Unknown", description, targetX, targetY, color },
            })
          );
        } else if (message.type === "journalEntry") {
          const { content, nodeName, nodeId: entryNodeId } = message.payload;
          if (!content || !nodeName) return;
          const trimmed = content.trim().slice(0, 500);
          if (!trimmed) return;
          const entry = await storage.createJournalEntry({
            nodeName,
            nodeId: entryNodeId || null,
            content: trimmed,
          });
          broadcastAll(
            JSON.stringify({
              type: "journalEntry",
              payload: {
                id: entry.id,
                nodeName: entry.nodeName,
                nodeId: entry.nodeId,
                content: entry.content,
                createdAt: entry.createdAt.toISOString(),
              },
            })
          );
        }
      } catch (err) {
        console.error("WS error:", err);
      }
    });

    socket.on("close", async () => {
      if (nodeId) {
        clients.delete(nodeId);
        await storage.updateNodeStatus(nodeId, "offline");
        broadcastAll(
          JSON.stringify({ type: "nodeLeft", payload: { id: nodeId } })
        );
      }
    });
  });

  function sendToNode(nodeId: number, msg: string): boolean {
    const ws = clients.get(nodeId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
      return true;
    }
    return false;
  }

  startOrchestrator({ broadcastAll, sendToNode });

  return httpServer;
}
