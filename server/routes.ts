import type { Express } from "express";
import { type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { api, ws as wsSchema } from "@shared/routes";
import { z } from "zod";
import * as cimc from "./cimc";

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

  app.get(api.messages.list.path, async (req, res) => {
    const msgs = await storage.getMessages();
    res.json(msgs);
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
      const { x, y, color, nodeId } = req.body;
      if (x === undefined || y === undefined || !color || !nodeId) {
        return res.status(400).json({ message: "x, y, color, and nodeId are required" });
      }
      const node = await storage.spendPixelCredit(Number(nodeId));
      const result = await cimc.placePixel(Number(x), Number(y), color, `NeuroCompute-${node.name}`);
      broadcastAll(JSON.stringify({
        type: "pixelPlaced",
        payload: { x: Number(x), y: Number(y), color, agent: node.name, nodeId: node.id, pixelCredits: node.pixelCredits },
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

  app.get("/api/canvas/credits/:nodeId", async (req, res) => {
    try {
      const node = await storage.getNode(Number(req.params.nodeId));
      if (!node) return res.status(404).json({ message: "Node not found" });
      res.json({ pixelCredits: node.pixelCredits, pixelsPlaced: node.pixelsPlaced, totalTokens: node.totalTokens });
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
          const updated = await storage.updateNodeTokens(nodeId, parsed.tokensGenerated);
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
          // Submit AI response to CIMC Open Forum (Room 2, no moderation)
          try {
            await cimc.postToOpenForum(`NeuroCompute:${parsed.nodeName}`, parsed.content, 2);
          } catch (err) {
            console.error("CIMC submit error (response):", err);
          }
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

  return httpServer;
}
