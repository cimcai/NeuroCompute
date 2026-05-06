import type { Express } from "express";
import { type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { createHmac, createHash, randomBytes } from "crypto";
import { storage } from "./storage";
import { api, ws as wsSchema } from "@shared/routes";
import { z } from "zod";
import * as cimc from "./cimc";
import { startOrchestrator } from "./agent-orchestrator";
import { logger } from "./logger";
import { runDailyReport, buildReport, renderEmailHtml, buildAnalyticsData, renderAnalyticsEmailHtml } from "./analytics";
import { BIOMES, getBiomeByColor } from "@shared/biomes";

let pixelHistoryCache: any[] = [];
let pixelCacheTotal = 0;

// Strip sessionTokenHash before sending node data to clients
function sanitizeNode<T extends { sessionTokenHash?: string | null }>(node: T): Omit<T, 'sessionTokenHash'> {
  const { sessionTokenHash: _, ...rest } = node;
  return rest as Omit<T, 'sessionTokenHash'>;
}

export async function fetchAndCacheHistory(): Promise<any[]> {
  const response = await fetch("https://cimc.io/api/canvas/history/all");
  if (!response.ok) throw new Error(`CIMC history/all failed: ${response.status}`);
  const data = await response.json();
  const entries: any[] = Array.isArray(data) ? data : (data.history || []);
  entries.sort((a: any, b: any) => new Date(a.placedAt || 0).getTime() - new Date(b.placedAt || 0).getTime());
  pixelHistoryCache = entries;
  pixelCacheTotal = entries.length;
  console.log(`[history] Cached ${entries.length} pixel history entries`);
  return entries;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Tracks node IDs that are actively connected via WebSocket (populated by WS handler below)
  const connectedNodeIds = new Set<number>();

  app.get(api.nodes.list.path, async (req, res) => {
    const nodes = await storage.getNodes();
    res.json(nodes.map(sanitizeNode));
  });

  app.get(api.nodes.get.path, async (req, res) => {
    const node = await storage.getNode(Number(req.params.id));
    if (!node) {
      return res.status(404).json({ message: "Node not found" });
    }
    res.json(sanitizeNode(node));
  });

  app.post(api.nodes.create.path, async (req, res) => {
    try {
      const input = api.nodes.create.input.parse(req.body);
      const sessionToken = randomBytes(20).toString("hex");
      const sessionTokenHash = createHash("sha256").update(sessionToken).digest("hex");
      const node = await storage.createNode({ ...input, sessionTokenHash });
      res.status(201).json({ ...sanitizeNode(node), sessionToken });
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

  app.patch("/api/nodes/:id/status", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { status } = req.body;
      if (!status || !["computing", "idle", "offline"].includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
      }
      const node = await storage.updateNodeStatus(id, status);
      res.json(sanitizeNode(node));
    } catch (err) {
      logger.error("api", "Status update error", err);
      res.status(500).json({ message: "Failed to update status" });
    }
  });

  app.patch("/api/nodes/:id/display-name", async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { displayName } = req.body;
      if (displayName === null || displayName === undefined || (typeof displayName === "string" && displayName.trim().length === 0)) {
        const node = await storage.updateNodeDisplayName(id, null);
        return res.json(sanitizeNode(node));
      }
      if (typeof displayName !== "string") {
        return res.status(400).json({ message: "Display name must be a string" });
      }
      const trimmed = displayName.trim().slice(0, 32);
      const node = await storage.updateNodeDisplayName(id, trimmed);
      res.json(sanitizeNode(node));
    } catch (err) {
      logger.error("api", "Display name update error", err);
      res.status(500).json({ message: "Failed to update display name" });
    }
  });

  // Patron routes
  app.post("/api/patrons/claim", async (req, res) => {
    try {
      const { name } = req.body;
      if (!name || typeof name !== "string" || name.trim().length < 2) {
        return res.status(400).json({ message: "Name must be at least 2 characters" });
      }
      const trimmed = name.trim().slice(0, 32);
      const token = randomBytes(20).toString("hex");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const patron = await storage.createPatron(trimmed, tokenHash);
      res.status(201).json({ patron, token });
    } catch (err: any) {
      if (err.message?.includes("unique")) {
        return res.status(409).json({ message: "A patron with that name already exists — try a different name" });
      }
      logger.error("api", "Patron claim error", err);
      res.status(500).json({ message: "Failed to create patron" });
    }
  });

  app.post("/api/patrons/lookup", async (req, res) => {
    try {
      const { token } = req.body;
      if (!token || typeof token !== "string") {
        return res.status(400).json({ message: "Token is required" });
      }
      const tokenHash = createHash("sha256").update(token.trim()).digest("hex");
      const patron = await storage.getPatronByTokenHash(tokenHash);
      if (!patron) {
        return res.status(404).json({ message: "Invalid token — patron not found" });
      }
      res.json({ patron });
    } catch (err) {
      logger.error("api", "Patron lookup error", err);
      res.status(500).json({ message: "Failed to look up patron" });
    }
  });

  app.post("/api/nodes/:id/link-patron", async (req, res) => {
    try {
      const nodeId = Number(req.params.id);
      const { token, nodeToken } = req.body;
      if (!token || typeof token !== "string") {
        return res.status(400).json({ message: "Patron token is required" });
      }
      if (!nodeToken || typeof nodeToken !== "string") {
        return res.status(400).json({ message: "Node session token is required" });
      }
      // Verify patron token
      const patronHash = createHash("sha256").update(token.trim()).digest("hex");
      const patron = await storage.getPatronByTokenHash(patronHash);
      if (!patron) {
        return res.status(403).json({ message: "Invalid patron token" });
      }
      // Verify node session token (node ownership proof)
      const nodeHash = createHash("sha256").update(nodeToken.trim()).digest("hex");
      const nodeOwned = await storage.getNodeBySessionTokenHash(nodeHash, nodeId);
      if (!nodeOwned) {
        return res.status(403).json({ message: "Invalid node session token" });
      }
      const node = await storage.linkNodeToPatron(nodeId, patron.id);
      res.json(sanitizeNode(node));
    } catch (err: any) {
      if (err.message === "Node not found") return res.status(404).json({ message: "Node not found" });
      logger.error("api", "Link patron error", err);
      res.status(500).json({ message: "Failed to link patron" });
    }
  });

  app.get("/api/patrons/leaderboard", async (req, res) => {
    try {
      const raw = req.query.period as string | undefined;
      const period: 'all' | '7d' | '24h' = (raw === '7d' || raw === '24h') ? raw : 'all';
      const board = await storage.getPatronLeaderboard(period);
      res.json(board);
    } catch (err) {
      logger.error("api", "Patron leaderboard error", err);
      res.status(500).json({ message: "Failed to fetch patron leaderboard" });
    }
  });

  app.get("/api/network/stats", async (req, res) => {
    try {
      const stats = await storage.getNetworkStats();
      res.json(stats);
    } catch (err) {
      logger.error("api", "Network stats error", err);
      res.status(500).json({ message: "Failed to fetch network stats" });
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
      logger.error("api", "Proof generation error", err);
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

  app.get("/api/logs/errors", async (req, res) => {
    try {
      const fs = await import("fs");
      const path = await import("path");
      const logPath = path.default.resolve("logs/error.log");
      if (!fs.default.existsSync(logPath)) {
        return res.json({ entries: [], count: 0 });
      }
      const content = fs.default.readFileSync(logPath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const recent = lines.slice(-limit);
      res.json({ entries: recent, count: lines.length });
    } catch (err) {
      logger.error("api", "Log fetch error", err);
      res.status(500).json({ message: "Failed to fetch logs" });
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

  app.get("/api/canvas/history", async (req, res) => {
    try {
      const entries = pixelHistoryCache.length > 0 ? pixelHistoryCache : await fetchAndCacheHistory();
      res.json(entries);
    } catch (err) {
      logger.error("api", "Canvas history fetch error", err);
      res.status(500).json({ message: "Failed to fetch canvas history" });
    }
  });

  app.get("/api/canvas/history/stream", async (req, res) => {
    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Access-Control-Allow-Origin", "*");

    const sendChunk = (pixels: any[], total: number, done: boolean) => {
      res.write(JSON.stringify({ pixels, total, done }) + "\n");
    };

    try {
      const CHUNK = 500;
      const cached = pixelHistoryCache;

      if (cached.length > 0) {
        const lastCachedId: number = cached[cached.length - 1]?.id ?? 0;

        for (let i = 0; i < cached.length; i += CHUNK) {
          sendChunk(cached.slice(i, i + CHUNK), pixelCacheTotal, false);
        }

        const fresh = await fetchAndCacheHistory();
        const newPixels = fresh.filter((p: any) => p.id > lastCachedId);
        if (newPixels.length > 0) {
          for (let i = 0; i < newPixels.length; i += CHUNK) {
            sendChunk(newPixels.slice(i, i + CHUNK), fresh.length, i + CHUNK >= newPixels.length);
          }
        } else {
          sendChunk([], fresh.length, true);
        }
      } else {
        const all = await fetchAndCacheHistory();
        for (let i = 0; i < all.length; i += CHUNK) {
          sendChunk(all.slice(i, i + CHUNK), all.length, i + CHUNK >= all.length);
        }
        if (all.length === 0) sendChunk([], 0, true);
      }
    } catch (err) {
      logger.error("api", "Canvas history stream error", err);
      res.write(JSON.stringify({ pixels: [], total: 0, done: true, error: "fetch failed" }) + "\n");
    }

    res.end();
  });

  app.get("/api/journal/pixel", async (req, res) => {
    try {
      const x = Number(req.query.x);
      const y = Number(req.query.y);
      if (isNaN(x) || isNaN(y) || x < 0 || x > 31 || y < 0 || y > 31) {
        return res.status(400).json({ message: "Invalid coordinates" });
      }
      const limit = Math.min(Number(req.query.limit) || 20, 50);
      const entries = await storage.getJournalEntries(500);
      const coordRegex = new RegExp(`\\(\\s*${x}\\s*,\\s*${y}\\s*\\)`);
      const matching = entries
        .filter(e => coordRegex.test(e.content))
        .slice(-limit);
      res.json(matching);
    } catch (err) {
      logger.error("api", "Pixel journal fetch error", err);
      res.status(500).json({ message: "Failed to fetch pixel history" });
    }
  });

  app.get("/api/journal/context", async (req, res) => {
    try {
      const limit = Number(req.query.limit) || 8;
      const entries = await storage.getJournalEntries(limit);
      const context = entries
        .map((e) => `[${e.nodeName}]: ${e.content}`)
        .join("\n");

      const recentMessages = await storage.getMessages(6);
      const chatContext = recentMessages.length > 0
        ? recentMessages.map((m) => `[${m.senderName} in chat]: "${m.content}"`).join("\n")
        : "";

      const allNodes = await storage.getNodes();
      const activeGoals = allNodes
        .filter((n) => n.pixelGoal && n.status === "computing")
        .map((n) => {
          try {
            const g = JSON.parse(n.pixelGoal!);
            return `[${n.displayName || n.name}] is building: ${g.description} at (${g.targetX},${g.targetY}) with ${g.color}`;
          } catch { return null; }
        })
        .filter(Boolean)
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

      res.json({ context, count: entries.length, networkActivity, chatContext, activeGoals });
    } catch (err) {
      console.error("Journal context error:", err);
      res.status(500).json({ message: "Failed to fetch journal context" });
    }
  });

  app.get("/api/chat-history", async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 200, 1000);
      let since: Date | null = null;
      if (req.query.since) {
        const parsed = new Date(req.query.since as string);
        if (isNaN(parsed.getTime())) {
          return res.status(400).json({ message: "Invalid 'since' timestamp — use ISO 8601 format" });
        }
        since = parsed;
      }
      let before: Date | null = null;
      if (req.query.before) {
        const parsed = new Date(req.query.before as string);
        if (isNaN(parsed.getTime())) {
          return res.status(400).json({ message: "Invalid 'before' timestamp — use ISO 8601 format" });
        }
        before = parsed;
      }
      const type = req.query.type as string | undefined;
      if (type && type !== "chat" && type !== "journal") {
        return res.status(400).json({ message: "Invalid 'type' — must be 'chat' or 'journal'" });
      }

      const fetchLimit = limit * 2;
      const [msgs, journal, allNodes] = await Promise.all([
        type !== "journal" ? storage.getMessages(fetchLimit) : Promise.resolve([]),
        type !== "chat" ? storage.getJournalEntries(fetchLimit) : Promise.resolve([]),
        storage.getNodes(),
      ]);

      const nodeMap = new Map(allNodes.map(n => [n.id, n]));

      const unified: Array<{
        id: number;
        type: "chat" | "journal";
        content: string;
        speaker: string;
        nodeId: number | null;
        role?: string;
        createdAt: string;
      }> = [];

      for (const m of msgs) {
        const ts = m.createdAt.toISOString();
        if (since && m.createdAt < since) continue;
        if (before && m.createdAt >= before) continue;
        const node = m.nodeId ? nodeMap.get(m.nodeId) : null;
        unified.push({
          id: m.id,
          type: "chat",
          content: m.content,
          speaker: node?.displayName || m.senderName,
          nodeId: m.nodeId,
          role: m.role,
          createdAt: ts,
        });
      }

      for (const j of journal) {
        const ts = j.createdAt.toISOString();
        if (since && j.createdAt < since) continue;
        if (before && j.createdAt >= before) continue;
        const node = j.nodeId ? nodeMap.get(j.nodeId) : null;
        unified.push({
          id: j.id,
          type: "journal",
          content: j.content,
          speaker: node?.displayName || j.nodeName,
          nodeId: j.nodeId,
          createdAt: ts,
        });
      }

      unified.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const trimmed = unified.slice(0, limit).reverse();

      res.json({
        count: trimmed.length,
        entries: trimmed,
      });
    } catch (err) {
      console.error("Chat history error:", err);
      res.status(500).json({ message: "Failed to fetch chat history" });
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
      // Check wall at current node position
      const wallAtPlace = await storage.getWallAt(x, y);
      if (wallAtPlace) {
        return res.status(400).json({ message: "Cannot place pixel — this cell is blocked by a wall. Move first!" });
      }
      const node = await storage.spendPixelCredit(Number(nodeId));
      const agentName = currentNode.displayName || node.name;
      const result = await cimc.placePixel(x, y, color, `NeuroCompute-${agentName}`);
      storage.appendNodeMemoryEvent(Number(nodeId), {
        type: "pixelPlaced",
        content: `placed a ${color} pixel at (${x},${y}) on the canvas`,
        ts: Date.now(),
      }).catch(() => {});
      broadcastAll(JSON.stringify({
        type: "pixelPlaced",
        payload: { x, y, color, agent: agentName, nodeId: node.id, pixelCredits: node.pixelCredits },
      }));
      res.json({ pixel: result, node: sanitizeNode(node) });
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
      if (dx + dy > 1) {
        return res.status(400).json({ message: "Can only move to cardinally adjacent cells (1 step)" });
      }
      // Gate movement on available credits
      if (node.pixelCredits < 1) {
        return res.status(403).json({ message: "Not enough energy to move. Contribute compute tokens to earn credits!" });
      }
      // Check wall occupancy at target
      const wallAtTarget = await storage.getWallAt(nx, ny);
      if (wallAtTarget) {
        return res.status(400).json({ message: "Target cell is blocked by a wall" });
      }
      const updated = await storage.moveNode(Number(nodeId), nx, ny);
      await storage.deductMoveCredit(Number(nodeId));
      broadcastAll(JSON.stringify({
        type: "nodeMoved",
        payload: { nodeId: updated.id, nodeName: updated.name, x: updated.pixelX, y: updated.pixelY },
      }));
      res.json({ node: sanitizeNode(updated) });
    } catch (err: any) {
      console.error("Canvas move error:", err);
      res.status(500).json({ message: "Failed to move node" });
    }
  });

  app.get("/api/canvas/sub", async (req, res) => {
    try {
      const rx = Number(req.query.rx);
      const ry = Number(req.query.ry);
      if (isNaN(rx) || isNaN(ry) || rx < 0 || rx > 31 || ry < 0 || ry > 31) {
        return res.status(400).json({ message: "rx and ry must be 0–31" });
      }
      const pixels = await storage.getSubPixels(rx, ry);
      res.json({ regionX: rx, regionY: ry, pixels });
    } catch (err) {
      console.error("Sub-pixel fetch error:", err);
      res.status(500).json({ message: "Failed to fetch sub-pixels" });
    }
  });

  app.get("/api/canvas/sub/regions", async (req, res) => {
    try {
      const regions = await storage.getRegionsWithSubPixels();
      res.json({ regions });
    } catch (err) {
      console.error("Sub-pixel regions error:", err);
      res.status(500).json({ message: "Failed to fetch sub-pixel regions" });
    }
  });

  app.get("/api/admin/send-report", async (req, res) => {
    try {
      const adminSecret = process.env.ADMIN_SECRET;
      const provided = req.query.secret as string | undefined;
      if (!adminSecret) {
        return res.status(401).json({ message: "Admin endpoint disabled — set ADMIN_SECRET env var to enable" });
      }
      if (provided !== adminSecret) {
        return res.status(401).json({ message: "Unauthorized — invalid or missing secret" });
      }
      const preview = req.query.preview === "true";
      if (preview) {
        const report = await buildReport();
        const html = renderEmailHtml(report);
        res.setHeader("Content-Type", "text/html");
        return res.send(html);
      }
      const result = await runDailyReport();
      res.json({
        success: result.success,
        emailSent: result.emailSent,
        report: {
          snapshotDate: result.report.snapshotDate,
          periodLabel: result.report.periodLabel,
          totalNodes: result.report.totalNodes,
          activeNodes: result.report.activeNodes,
          computeSecondsDelta: result.report.computeSecondsDelta,
          pixelDelta: result.report.pixelDelta,
          tokenDelta: result.report.tokenDelta,
        },
      });
    } catch (err) {
      logger.error("api", "Admin send-report error", err);
      res.status(500).json({ message: "Failed to run report" });
    }
  });

  app.get("/api/admin/analytics", async (req, res) => {
    try {
      const adminSecret = process.env.ADMIN_SECRET;
      const provided = req.query.secret as string | undefined;
      if (!adminSecret) {
        return res.status(401).json({ message: "Admin endpoint disabled — set ADMIN_SECRET env var to enable" });
      }
      if (provided !== adminSecret) {
        return res.status(401).json({ message: "Unauthorized — invalid or missing secret" });
      }

      const trendDays = Math.min(90, Math.max(1, parseInt((req.query.days as string) || "14") || 14));
      const format = req.query.format as string | undefined;

      const data = await buildAnalyticsData(trendDays);

      if (format === "html") {
        const html = renderAnalyticsEmailHtml(data);
        res.setHeader("Content-Type", "text/html");
        return res.send(html);
      }

      res.json(data);
    } catch (err) {
      logger.error("api", "Admin analytics error", err);
      res.status(500).json({ message: "Failed to build analytics" });
    }
  });

  app.get("/api/nodes/:id/profile", async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
      const node = await storage.getNode(id);
      if (!node) return res.status(404).json({ message: "Node not found" });
      const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
      const offset = Math.max(0, Number(req.query.offset) || 0);
      const recentJournal = await storage.getNodeJournalEntries(id, limit, offset);
      let goalDescription: string | null = null;
      if (node.pixelGoal) {
        try { goalDescription = JSON.parse(node.pixelGoal).description ?? null; } catch {}
      }
      let goalsAchieved = 0;
      if (node.memory) {
        try {
          const memEvents: { type: string; content: string; ts: number }[] = JSON.parse(node.memory);
          goalsAchieved = memEvents.filter(e => e.type === "pixelGoalSet").length;
        } catch {}
      }
      res.json({
        id: node.id,
        name: node.name,
        displayName: node.displayName,
        status: node.status,
        totalTokens: node.totalTokens,
        pixelsPlaced: node.pixelsPlaced,
        pixelCredits: node.pixelCredits,
        pixelX: node.pixelX,
        pixelY: node.pixelY,
        avatar: node.avatar,
        goalDescription,
        goalsAchieved,
        lastSeen: node.lastSeen.toISOString(),
        journal: recentJournal.map(e => ({
          id: e.id,
          content: e.content,
          createdAt: e.createdAt.toISOString(),
        })),
        hasMore: recentJournal.length === limit,
        offset,
        limit,
      });
    } catch (err) {
      logger.error("api", "Node profile error", err);
      res.status(500).json({ message: "Failed to fetch profile" });
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

  const wallPushPending = new Map<number, { nodeId: number; direction: string; ts: number }>();

  app.get("/api/walls", async (_req, res) => {
    try {
      const wallList = await storage.getWalls();
      res.json(wallList);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch walls" });
    }
  });

  app.post("/api/walls/seed", async (_req, res) => {
    try {
      const existing = await storage.getWalls();
      if (existing.length > 0) return res.json({ seeded: 0, total: existing.length });
      const initialWalls = [
        { x: 8, y: 8 }, { x: 8, y: 9 }, { x: 8, y: 10 },
        { x: 20, y: 15 }, { x: 21, y: 15 },
        { x: 14, y: 22 }, { x: 15, y: 22 }, { x: 16, y: 22 },
        { x: 25, y: 5 }, { x: 6, y: 25 },
      ];
      const created: any[] = [];
      for (const pos of initialWalls) {
        const existing = await storage.getWallAt(pos.x, pos.y);
        if (!existing) {
          const w = await storage.createWall(pos);
          created.push(w);
          broadcastAll(JSON.stringify({ type: "wallAdded", payload: { id: w.id, x: w.x, y: w.y } }));
        }
      }
      res.json({ seeded: created.length, total: created.length });
    } catch (err) {
      logger.error("api", "Wall seed error", err);
      res.status(500).json({ message: "Failed to seed walls" });
    }
  });

  app.post("/api/walls/:id/push", async (req, res) => {
    try {
      const wallId = Number(req.params.id);
      const { nodeId: pusherNodeId, direction, nodeToken } = req.body;
      if (!pusherNodeId || !direction || !["up", "down", "left", "right"].includes(direction)) {
        return res.status(400).json({ message: "nodeId and direction (up/down/left/right) required" });
      }
      if (!nodeToken || typeof nodeToken !== "string") {
        return res.status(400).json({ message: "nodeToken required for authorization" });
      }

      if (!connectedNodeIds.has(Number(pusherNodeId))) {
        return res.status(403).json({ message: "Node is not currently connected" });
      }
      // Verify session token to prevent IDOR
      const pushTokenHash = createHash("sha256").update(nodeToken.trim()).digest("hex");
      const ownedPusher = await storage.getNodeBySessionTokenHash(pushTokenHash, Number(pusherNodeId));
      if (!ownedPusher) {
        return res.status(403).json({ message: "Invalid node session token" });
      }

      const wallList = await storage.getWalls();
      const wall = wallList.find(w => w.id === wallId);
      if (!wall) return res.status(404).json({ message: "Wall not found" });

      const pusher = await storage.getNode(Number(pusherNodeId));
      if (!pusher) return res.status(404).json({ message: "Node not found" });

      // Cardinal adjacency only (no diagonals)
      const adjDx = Math.abs(pusher.pixelX - wall.x);
      const adjDy = Math.abs(pusher.pixelY - wall.y);
      if (adjDx + adjDy > 1) {
        return res.status(400).json({ message: "Node is not cardinally adjacent to this wall" });
      }

      const PUSH_WINDOW_MS = 3000;
      const pending = wallPushPending.get(wallId);
      const now = Date.now();

      if (pending && pending.nodeId !== Number(pusherNodeId) && pending.direction === direction && now - pending.ts <= PUSH_WINDOW_MS) {
        wallPushPending.delete(wallId);
        const dirMap: Record<string, { dx: number; dy: number }> = {
          up: { dx: 0, dy: -1 }, down: { dx: 0, dy: 1 },
          left: { dx: -1, dy: 0 }, right: { dx: 1, dy: 0 },
        };
        const { dx, dy } = dirMap[direction];
        const newX = Math.max(0, Math.min(31, wall.x + dx));
        const newY = Math.max(0, Math.min(31, wall.y + dy));
        if (newX === wall.x && newY === wall.y) {
          return res.status(400).json({ message: "Wall cannot move further in that direction" });
        }
        const existing = await storage.getWallAt(newX, newY);
        if (existing) return res.status(400).json({ message: "Target cell already has a wall" });
        // Prevent moving wall into a cell occupied by any node
        const occupyingNode = [...nodePositionCache.entries()].find(([, pos]) => pos.x === newX && pos.y === newY);
        if (occupyingNode) {
          return res.status(400).json({ message: "Cannot move wall into an occupied cell" });
        }
        const updated = await storage.moveWall(wallId, newX, newY);
        broadcastAll(JSON.stringify({
          type: "wallMoved",
          payload: { id: updated.id, fromX: wall.x, fromY: wall.y, toX: newX, toY: newY },
        }));
        console.log(`[walls] Wall ${wallId} pushed ${direction} from (${wall.x},${wall.y}) to (${newX},${newY}) by cooperative push`);
        return res.json({ moved: true, wall: updated });
      }

      wallPushPending.set(wallId, { nodeId: Number(pusherNodeId), direction, ts: now });
      setTimeout(() => {
        const p = wallPushPending.get(wallId);
        if (p && p.nodeId === Number(pusherNodeId) && p.ts === now) {
          wallPushPending.delete(wallId);
        }
      }, PUSH_WINDOW_MS);

      res.json({ moved: false, pending: true, message: "Push registered — need a second adjacent node to push in the same direction within 3s" });
    } catch (err) {
      logger.error("api", "Wall push error", err);
      res.status(500).json({ message: "Failed to push wall" });
    }
  });

  app.post("/api/nodes/:id/transfer-energy", async (req, res) => {
    try {
      const fromNodeId = Number(req.params.id);
      const { toNodeId, amount, nodeToken } = req.body;
      const parsedToNodeId = Number(toNodeId);
      const parsedAmount = Math.floor(Number(amount));
      if (!parsedToNodeId || isNaN(parsedAmount) || parsedAmount < 1) {
        return res.status(400).json({ message: "toNodeId and amount (integer >= 1) required" });
      }
      // Prevent self-transfer (energy minting exploit)
      if (fromNodeId === parsedToNodeId) {
        return res.status(400).json({ message: "Cannot transfer energy to yourself" });
      }
      if (!nodeToken || typeof nodeToken !== "string") {
        return res.status(400).json({ message: "nodeToken required for authorization" });
      }
      if (!connectedNodeIds.has(fromNodeId)) {
        return res.status(403).json({ message: "Source node is not currently connected" });
      }
      // Verify node session token to prevent IDOR
      const tokenHash = createHash("sha256").update(nodeToken.trim()).digest("hex");
      const ownedNode = await storage.getNodeBySessionTokenHash(tokenHash, fromNodeId);
      if (!ownedNode) {
        return res.status(403).json({ message: "Invalid node session token" });
      }
      const from = await storage.getNode(fromNodeId);
      const to = await storage.getNode(parsedToNodeId);
      if (!from || !to) return res.status(404).json({ message: "Node not found" });
      // Strict cardinal adjacency: exactly 1 step away, no diagonals, not same cell
      const adjDx = Math.abs(from.pixelX - to.pixelX);
      const adjDy = Math.abs(from.pixelY - to.pixelY);
      if (adjDx + adjDy !== 1) {
        return res.status(400).json({ message: "Nodes must be cardinally adjacent (exactly 1 step) to transfer energy" });
      }
      const { from: updatedFrom, to: updatedTo } = await storage.transferEnergy(fromNodeId, parsedToNodeId, parsedAmount);
      broadcastAll(JSON.stringify({
        type: "energyTransferred",
        payload: { fromNodeId, toNodeId: parsedToNodeId, amount: parsedAmount, fromCredits: updatedFrom.pixelCredits, toCredits: updatedTo.pixelCredits },
      }));
      res.json({ from: sanitizeNode(updatedFrom), to: sanitizeNode(updatedTo) });
    } catch (err: any) {
      if (err.message === "Not enough energy") return res.status(400).json({ message: "Not enough energy to transfer" });
      logger.error("api", "Transfer energy error", err);
      res.status(500).json({ message: "Failed to transfer energy" });
    }
  });

  // ─── Appleseed Game Integration API (public CORS) ────────────────────────────
  const gameCors = (_req: any, res: any, next: any) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    next();
  };

  // Pending game action requests: requestId → { resolve, timer }
  const pendingGameActions = new Map<string, { resolve: (action: any) => void; timer: ReturnType<typeof setTimeout> }>();

  app.options(/^\/api\/game\//, gameCors, (_req, res) => res.sendStatus(204));

  // Heuristic fallback when no compute node is available
  function ecologyHeuristic(gs: { trees: number; birds: number; bunnies: number; foxes: number; bears: number; buffalos: number; bees: number; butterflies: number; flowers: number; apples: number; biodiversity: number }) {
    if (gs.trees < 3) return { action: "plant_seed", reason: "Need more trees for ecosystem foundation" };
    if (gs.birds === 0 && gs.trees >= 2) return { action: "release_bird", reason: "Birds missing from ecosystem" };
    if (gs.bunnies === 0) return { action: "release_bunny", reason: "Bunnies increase biodiversity" };
    if (gs.foxes === 0 && gs.bunnies >= 2) return { action: "release_fox", reason: "Foxes balance bunny population" };
    if (gs.flowers === 0) return { action: "plant_seed", reason: "Plant flowers for pollinators" };
    if (gs.bees === 0 && gs.flowers > 0) return { action: "release_bee", reason: "Bees pollinate flowers" };
    if (gs.butterflies === 0 && gs.flowers > 0) return { action: "release_butterfly", reason: "Butterflies add biodiversity" };
    if (gs.bears === 0 && gs.trees >= 5) return { action: "release_bear", reason: "Bears complete food chain" };
    if (gs.buffalos === 0) return { action: "release_bunny", reason: "More herbivores needed" };
    if (gs.apples >= 10) return { action: "harvest_apples", reason: "Harvest apples for points" };
    return { action: "plant_seed", reason: "Expanding tree coverage" };
  }

  app.post("/api/game/appleseed/score", gameCors, async (req, res) => {
    try {
      const {
        patronToken, externalUserId, nickname, score, biodiversityScore, livingCreatures,
        eggsCollected, level, treeCount, birdCount, bunnyCount, foxCount, bearCount,
        buffaloCount, beeCount, butterflyCount, flowerCount, regionX, regionY,
      } = req.body;

      let patronId: number | null = null;
      let nodeId: number | null = null;
      if (patronToken) {
        const { createHash } = await import("crypto");
        const hash = createHash("sha256").update(String(patronToken)).digest("hex");
        const patron = await storage.getPatronByTokenHash(hash);
        if (patron) {
          patronId = patron.id;
          const allNodes = await storage.getNodes();
          const patronNode = allNodes.find(n => n.patronId === patron.id);
          if (patronNode) nodeId = patronNode.id;
        }
      }

      const saved = await storage.submitGameScore({
        patronId,
        nodeId,
        externalUserId: externalUserId || null,
        nickname: nickname ? String(nickname).slice(0, 64) : null,
        score: Math.max(0, Math.floor(Number(score) || 0)),
        biodiversityScore: Math.max(0, Math.min(9, Math.floor(Number(biodiversityScore) || 0))),
        livingCreatures: Math.max(0, Math.floor(Number(livingCreatures) || 0)),
        eggsCollected: Math.max(0, Math.floor(Number(eggsCollected) || 0)),
        level: Math.max(1, Math.floor(Number(level) || 1)),
        treeCount: Math.max(0, Math.floor(Number(treeCount) || 0)),
        birdCount: Math.max(0, Math.floor(Number(birdCount) || 0)),
        bunnyCount: Math.max(0, Math.floor(Number(bunnyCount) || 0)),
        foxCount: Math.max(0, Math.floor(Number(foxCount) || 0)),
        bearCount: Math.max(0, Math.floor(Number(bearCount) || 0)),
        buffaloCount: Math.max(0, Math.floor(Number(buffaloCount) || 0)),
        beeCount: Math.max(0, Math.floor(Number(beeCount) || 0)),
        butterflyCount: Math.max(0, Math.floor(Number(butterflyCount) || 0)),
        flowerCount: Math.max(0, Math.floor(Number(flowerCount) || 0)),
        regionX: regionX != null ? Math.max(0, Math.min(31, Math.floor(Number(regionX)))) : null,
        regionY: regionY != null ? Math.max(0, Math.min(31, Math.floor(Number(regionY)))) : null,
      });

      res.json({ ok: true, id: saved.id, biodiversityScore: saved.biodiversityScore });
    } catch (err) {
      logger.error("api", "Appleseed score submit error", err);
      res.status(500).json({ message: "Failed to save score" });
    }
  });

  app.get("/api/game/appleseed/leaderboard", gameCors, async (_req, res) => {
    try {
      const data = await storage.getGameLeaderboard();
      res.json(data);
    } catch (err) {
      logger.error("api", "Appleseed leaderboard error", err);
      res.status(500).json({ message: "Failed to fetch leaderboard" });
    }
  });

  app.post("/api/game/appleseed/action", gameCors, async (req, res) => {
    try {
      const { gameState } = req.body;
      if (!gameState || typeof gameState !== "object") {
        return res.status(400).json({ message: "gameState object required" });
      }

      const gs = {
        trees: Math.max(0, Number(gameState.trees) || 0),
        birds: Math.max(0, Number(gameState.birds) || 0),
        bunnies: Math.max(0, Number(gameState.bunnies) || 0),
        foxes: Math.max(0, Number(gameState.foxes) || 0),
        bears: Math.max(0, Number(gameState.bears) || 0),
        buffalos: Math.max(0, Number(gameState.buffalos) || 0),
        bees: Math.max(0, Number(gameState.bees) || 0),
        butterflies: Math.max(0, Number(gameState.butterflies) || 0),
        flowers: Math.max(0, Number(gameState.flowers) || 0),
        apples: Math.max(0, Number(gameState.apples) || 0),
        level: Math.max(1, Number(gameState.level) || 1),
        score: Math.max(0, Number(gameState.score) || 0),
        biodiversity: Math.max(0, Math.min(9, Number(gameState.biodiversity) || 0)),
        x: gameState.x != null ? Number(gameState.x) : undefined,
        y: gameState.y != null ? Number(gameState.y) : undefined,
      };

      // Check for active compute nodes
      const allNodes = await storage.getNodes();
      const onlineNodes = allNodes.filter(n => n.status === "online");

      if (onlineNodes.length === 0) {
        // No live LLM available — use heuristic
        return res.json({ ...ecologyHeuristic(gs), source: "heuristic" });
      }

      // Queue to an active compute node
      const requestId = `game_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      const actionPromise = new Promise<any>((resolve) => {
        const timer = setTimeout(() => {
          pendingGameActions.delete(requestId);
          resolve({ ...ecologyHeuristic(gs), source: "timeout_heuristic" });
        }, 4000);
        pendingGameActions.set(requestId, { resolve, timer });
      });

      broadcastAll(JSON.stringify({ type: "gameActionRequest", payload: { requestId, gameState: gs } }));

      const result = await actionPromise;
      res.json(result);
    } catch (err) {
      logger.error("api", "Appleseed action error", err);
      res.status(500).json({ message: "Failed to get action" });
    }
  });

  // Serve the integration script
  app.get("/game/neurocompute-appleseed.js", (_req, res) => {
    res.setHeader("Content-Type", "application/javascript");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=300");
    const origin = `${_req.protocol}://${_req.get("host")}`;
    res.send(`/* NeuroCompute × Appleseed integration v1.0 */
(function() {
  var NC_ORIGIN = "${origin}";
  var patronToken = window.ncPatronToken || localStorage.getItem("neurocompute_token") || null;
  var regionX = window.ncRegionX != null ? window.ncRegionX : null;
  var regionY = window.ncRegionY != null ? window.ncRegionY : null;
  var llmControl = window.ncLLMControl === true;

  // --- Score submission overlay ---
  function createOverlay() {
    if (document.getElementById("nc-overlay")) return;
    var el = document.createElement("div");
    el.id = "nc-overlay";
    el.style.cssText = "position:fixed;bottom:10px;left:10px;z-index:9999;background:rgba(0,0,0,0.85);border:1px solid #00ff88;border-radius:6px;padding:8px 12px;font-family:monospace;font-size:10px;color:#00ff88;min-width:180px;";
    var linked = patronToken ? "Patron linked ✓" : '<a href="#" id="nc-link-btn" style="color:#ff8">Link patron token</a>';
    el.innerHTML = '<b style="color:#fff">NeuroCompute</b><br>' + linked + (llmControl ? "<br>🤖 LLM control: ON" : "") + '<div id="nc-status" style="color:#aaa;margin-top:4px;font-size:9px;">Ready</div>';
    document.body.appendChild(el);
    var btn = document.getElementById("nc-link-btn");
    if (btn) btn.addEventListener("click", function(e) {
      e.preventDefault();
      var tok = prompt("Paste your NeuroCompute patron token:");
      if (tok && tok.trim()) {
        patronToken = tok.trim();
        localStorage.setItem("neurocompute_token", patronToken);
        el.innerHTML = '<b style="color:#fff">NeuroCompute</b><br>Patron linked ✓<div id="nc-status" style="color:#aaa;margin-top:4px;font-size:9px;">Ready</div>';
      }
    });
  }

  function setStatus(msg) {
    var s = document.getElementById("nc-status");
    if (s) s.textContent = msg;
  }

  // --- Hook score submission ---
  var origSave = window.saveAndSubmitScore;
  window.saveAndSubmitScore = function() {
    if (origSave) origSave.apply(this, arguments);
    try {
      var trees = window.trees ? window.trees.length : 0;
      var birds = window.birds ? window.birds.length : 0;
      var bunnies = window.bunnies ? window.bunnies.length : 0;
      var foxes = window.foxes ? window.foxes.length : 0;
      var bears = window.bears ? window.bears.length : 0;
      var buffalos = window.buffalos ? window.buffalos.length : 0;
      var bees = window.bees ? window.bees.length : 0;
      var butterflies = window.butterflies ? window.butterflies.length : 0;
      var flowers = window.flowers ? window.flowers.length : 0;
      var score = (window.updateScore ? window.updateScore() : 0) || 0;
      var bio = [trees,birds,bunnies,foxes,buffalos,bears,bees,butterflies,flowers].filter(function(n){return n>0;}).length;
      var payload = {
        patronToken: patronToken,
        externalUserId: window.userId || null,
        nickname: window.userNickname || "Appleseed Player",
        score: score,
        biodiversityScore: bio,
        livingCreatures: trees+birds+bunnies+foxes+bears+buffalos+bees+butterflies+flowers,
        eggsCollected: window.eggCollectedCount || 0,
        level: window.level || 1,
        treeCount: trees, birdCount: birds, bunnyCount: bunnies, foxCount: foxes,
        bearCount: bears, buffaloCount: buffalos, beeCount: bees, butterflyCount: butterflies, flowerCount: flowers,
        regionX: regionX, regionY: regionY
      };
      setStatus("Submitting to NeuroCompute...");
      fetch(NC_ORIGIN + "/api/game/appleseed/score", {
        method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(payload)
      }).then(function(r){ return r.json(); }).then(function(d){
        setStatus("Submitted! Bio " + (d.biodiversityScore || bio) + "/9");
      }).catch(function(){ setStatus("Submit failed"); });
    } catch(e) { console.warn("[NC] Score hook error:", e); }
  };

  // --- LLM agent control ---
  var actionPollTimer = null;
  function getAction() {
    if (!llmControl) return;
    try {
      var trees = window.trees ? window.trees.length : 0;
      var birds = window.birds ? window.birds.length : 0;
      var bunnies = window.bunnies ? window.bunnies.length : 0;
      var foxes = window.foxes ? window.foxes.length : 0;
      var bears = window.bears ? window.bears.length : 0;
      var buffalos = window.buffalos ? window.buffalos.length : 0;
      var bees = window.bees ? window.bees.length : 0;
      var butterflies = window.butterflies ? window.butterflies.length : 0;
      var flowers = window.flowers ? window.flowers.length : 0;
      var score = 0; try { score = window.updateScore ? window.updateScore() : 0; } catch(e){}
      var bio = [trees,birds,bunnies,foxes,buffalos,bears,bees,butterflies,flowers].filter(function(n){return n>0;}).length;
      var gameState = {
        trees:trees, birds:birds, bunnies:bunnies, foxes:foxes, bears:bears, buffalos:buffalos,
        bees:bees, butterflies:butterflies, flowers:flowers,
        apples: window.appleCount || 0, level: window.level || 1,
        score: score, biodiversity: bio,
        x: window.character ? window.character.x : null,
        y: window.character ? window.character.y : null
      };
      setStatus("Asking LLM...");
      fetch(NC_ORIGIN + "/api/game/appleseed/action", {
        method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({gameState: gameState})
      }).then(function(r){ return r.json(); }).then(function(d){
        setStatus("LLM: " + d.action + (d.reason ? " (" + d.reason.slice(0,30) + ")" : ""));
        executeAction(d);
      }).catch(function(){ setStatus("Action fetch failed"); });
    } catch(e) { console.warn("[NC] Action poll error:", e); }
  }

  function executeAction(d) {
    try {
      var action = (d.action || "").toLowerCase().trim();
      if (action === "plant_seed" && window.plantSeed) { window.plantSeed(); }
      else if (action === "release_bird" && window.releaseBird) { window.releaseBird(); }
      else if (action === "release_bunny" && window.releaseBunny) { window.releaseBunny(); }
      else if (action === "release_fox" && window.releaseFox) { window.releaseFox(); }
      else if (action === "release_bear" && window.releaseBear) { window.releaseBear(); }
      else if (action === "release_bee" && window.releaseBee) { window.releaseBee(); }
      else if (action === "release_butterfly" && window.releaseButterfly) { window.releaseButterfly(); }
      else if (action === "harvest_apples" && window.harvestApples) { window.harvestApples(); }
      else if (action === "move" && window.character && d.x != null && d.y != null) {
        window.character.x = d.x; window.character.y = d.y;
      }
    } catch(e) { console.warn("[NC] Execute action error:", e); }
  }

  if (llmControl) {
    actionPollTimer = setInterval(getAction, 8000);
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    setTimeout(createOverlay, 500);
  } else {
    document.addEventListener("DOMContentLoaded", function() { setTimeout(createOverlay, 500); });
  }

  console.log("[NeuroCompute] Appleseed integration loaded. Patron:", patronToken ? "linked" : "not linked", "| LLM control:", llmControl);
})();`);
  });

  // ─── World Map API (public, CORS-enabled for third-party game access) ───────
  const worldCors = (_req: any, res: any, next: any) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    next();
  };

  app.options(/^\/api\/world\//, worldCors, (_req, res) => res.sendStatus(204));

  app.get("/api/world/biomes", worldCors, (_req, res) => {
    res.json({ biomes: BIOMES });
  });

  app.get("/api/world/map", worldCors, async (_req, res) => {
    try {
      const canvasData = await cimc.getCanvas();
      const grid = canvasData?.grid ?? [];
      const annotated: any[][] = [];
      const biomeCounts: Record<string, number> = {};
      for (let y = 0; y < 32; y++) {
        annotated[y] = [];
        for (let x = 0; x < 32; x++) {
          const color: string = grid[y]?.[x] ?? "#000000";
          const biome = color === "#000000" ? null : getBiomeByColor(color);
          if (biome) biomeCounts[biome.id] = (biomeCounts[biome.id] ?? 0) + 1;
          annotated[y][x] = {
            x, y, color,
            biomeId: biome?.id ?? null,
            biomeName: biome?.name ?? null,
            biomeEmoji: biome?.emoji ?? null,
            terrain: biome?.terrain ?? null,
            passable: biome?.passable ?? true,
          };
        }
      }
      const walls = await storage.getWalls();
      for (const w of walls) {
        if (annotated[w.y]?.[w.x]) {
          annotated[w.y][w.x].wall = true;
          annotated[w.y][w.x].passable = false;
        }
      }
      const nodes = await storage.getNodes();
      const agents = nodes
        .filter(n => n.status === "computing")
        .map(n => ({ id: n.id, name: n.displayName || n.name, x: n.pixelX, y: n.pixelY, pixelCredits: n.pixelCredits }));
      res.json({
        generatedAt: new Date().toISOString(),
        width: 32, height: 32,
        cells: annotated,
        walls: walls.map(w => ({ x: w.x, y: w.y })),
        agents,
        biomeSummary: Object.entries(biomeCounts)
          .map(([id, count]) => ({ biomeId: id, cells: count }))
          .sort((a, b) => b.cells - a.cells),
      });
    } catch (err) {
      logger.error("api", "World map error", err);
      res.status(500).json({ message: "Failed to fetch world map" });
    }
  });

  app.get("/api/world/cell/:x/:y", worldCors, async (req, res) => {
    try {
      const x = Number(req.params.x);
      const y = Number(req.params.y);
      if (isNaN(x) || isNaN(y) || x < 0 || x > 31 || y < 0 || y > 31) {
        return res.status(400).json({ message: "x and y must be 0–31" });
      }
      const canvasData = await cimc.getCanvas();
      const color: string = canvasData?.grid?.[y]?.[x] ?? "#000000";
      const biome = color === "#000000" ? null : getBiomeByColor(color);
      const wall = await storage.getWallAt(x, y);
      const nodes = await storage.getNodes();
      const occupants = nodes
        .filter(n => n.pixelX === x && n.pixelY === y && n.status === "computing")
        .map(n => ({ id: n.id, name: n.displayName || n.name }));
      const subPixels = await storage.getSubPixels(x, y);
      res.json({ x, y, color, biome, wall: !!wall, occupants, subPixelCount: subPixels.length });
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch cell" });
    }
  });

  app.get("/api/world/state", worldCors, async (_req, res) => {
    try {
      const [nodes, walls, messages] = await Promise.all([
        storage.getNodes(),
        storage.getWalls(),
        storage.getMessages(5),
      ]);
      const active = nodes.filter(n => n.status === "computing");
      res.json({
        generatedAt: new Date().toISOString(),
        network: {
          totalNodes: nodes.length,
          activeAgents: active.length,
          totalTokens: nodes.reduce((s, n) => s + n.totalTokens, 0),
          totalPixels: nodes.reduce((s, n) => s + n.pixelsPlaced, 0),
        },
        agents: active.map(n => ({
          id: n.id,
          name: n.displayName || n.name,
          x: n.pixelX, y: n.pixelY,
          pixelCredits: n.pixelCredits,
          totalTokens: n.totalTokens,
        })),
        walls: walls.map(w => ({ x: w.x, y: w.y })),
        recentMessages: messages.map(m => ({ role: m.role, content: m.content, senderName: m.senderName })),
        biomes: BIOMES.map(b => ({ id: b.id, name: b.name, color: b.color, emoji: b.emoji })),
      });
    } catch (err) {
      logger.error("api", "World state error", err);
      res.status(500).json({ message: "Failed to fetch world state" });
    }
  });
  // ─── End World Map API ────────────────────────────────────────────────────

  await storage.markAllNodesOffline();
  console.log("[startup] Reset all stale nodes to offline");

  setInterval(async () => {
    try {
      await storage.markStaleNodesOffline(2);
    } catch (err) {
      logger.error("system", "Stale node sweep error", err);
    }
  }, 60_000);

  // Seed walls on startup
  storage.getWalls().then(async (existingWalls) => {
    if (existingWalls.length === 0) {
      const initialWalls = [
        { x: 8, y: 8 }, { x: 8, y: 9 }, { x: 8, y: 10 },
        { x: 20, y: 15 }, { x: 21, y: 15 },
        { x: 14, y: 22 }, { x: 15, y: 22 }, { x: 16, y: 22 },
        { x: 25, y: 5 }, { x: 6, y: 25 },
      ];
      for (const pos of initialWalls) {
        const existing = await storage.getWallAt(pos.x, pos.y);
        if (!existing) await storage.createWall(pos);
      }
      console.log("[startup] Seeded initial walls");
    }
  }).catch(() => {});

  // WebSocket
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  const clients = new Map<number, WebSocket>();
  const nodePositionCache = new Map<number, { x: number; y: number }>();

  const pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if ((ws as any).isAlive === false) {
        ws.terminate();
        return;
      }
      (ws as any).isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on("close", () => clearInterval(pingInterval));

  function broadcast(msg: string, exclude?: WebSocket) {
    wss.clients.forEach((c) => {
      if (c !== exclude && c.readyState === WebSocket.OPEN) {
        c.send(msg);
      }
    });
  }

  function broadcastAll(msg: string) {
    // Intercept nodeMoved to update position cache
    try {
      const parsed = JSON.parse(msg);
      if (parsed.type === "nodeMoved" && parsed.payload) {
        const { nodeId: nid, x, y } = parsed.payload;
        if (typeof nid === "number" && typeof x === "number" && typeof y === "number") {
          nodePositionCache.set(nid, { x, y });
        }
      }
    } catch {}
    wss.clients.forEach((c) => {
      if (c.readyState === WebSocket.OPEN) {
        c.send(msg);
      }
    });
  }

  // Spatial broadcast radii (Manhattan distance, in grid cells)
  const CHAT_RADIUS = 8;
  const OBSERVATION_RADIUS = 12;
  const GOAL_RADIUS = 16;

  function broadcastNearby(centerX: number, centerY: number, radius: number, msg: string) {
    clients.forEach((ws, nId) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const pos = nodePositionCache.get(nId);
      if (!pos) return; // skip nodes with unknown position — outside range by default
      if (Math.abs(pos.x - centerX) + Math.abs(pos.y - centerY) <= radius) {
        ws.send(msg);
      }
    });
  }

  wss.on("connection", (socket) => {
    (socket as any).isAlive = true;
    socket.on("pong", () => { (socket as any).isAlive = true; });

    let nodeId: number | null = null;

    socket.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.type === "ping") {
          (socket as any).isAlive = true;
          socket.send(JSON.stringify({ type: "pong", payload: {} }));
          return;
        }

        if (message.type === "nodeJoined") {
          const parsed = wsSchema.send.nodeJoined.parse(message.payload);
          nodeId = parsed.id;
          clients.set(nodeId, socket);
          connectedNodeIds.add(nodeId);
          await storage.updateNodeStatus(nodeId, "computing");
          const node = await storage.getNode(nodeId);
          if (node) {
            nodePositionCache.set(nodeId, { x: node.pixelX, y: node.pixelY });
            broadcast(
              JSON.stringify({ type: "nodeJoined", payload: { id: node.id, name: node.displayName || node.name } }),
              socket
            );
            // Send memory context back to only this node
            let memoryEvents: { type: string; content: string; ts: number }[] = [];
            if (node.memory) {
              try { memoryEvents = JSON.parse(node.memory); } catch {}
            }
            if (memoryEvents.length > 0) {
              socket.send(JSON.stringify({
                type: "memoryContext",
                payload: { events: memoryEvents.slice(-10) },
              }));
            }
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
          // chatMessage is global: all nodes see the chat history (persistent record)
          broadcastAll(
            JSON.stringify({
              type: "chatMessage",
              payload: { id: saved.id, content: saved.content, senderName: saved.senderName, role: "user" },
            })
          );
          // chatPending is spatial: only nearby agents receive the LLM prompt to respond
          const chatPendingMsg = JSON.stringify({
            type: "chatPending",
            payload: { content: parsed.content },
          });
          if (nodeId && nodePositionCache.has(nodeId)) {
            const senderPos = nodePositionCache.get(nodeId)!;
            broadcastNearby(senderPos.x, senderPos.y, CHAT_RADIUS, chatPendingMsg);
          } else {
            broadcastAll(chatPendingMsg);
          }
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
          // Append to node memory
          if (parsed.nodeId) {
            storage.appendNodeMemoryEvent(parsed.nodeId, {
              type: "chat",
              content: parsed.content,
              ts: Date.now(),
            }).catch(() => {});
          }
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
          // Append goal to node memory
          storage.appendNodeMemoryEvent(goalNodeId, {
            type: "goal",
            content: `🏗️ ${description} at (${targetX},${targetY})`,
            ts: Date.now(),
          }).catch(() => {});
        } else if (message.type === "avatarSet") {
          const { nodeId: avatarNodeId, avatar } = message.payload;
          if (!avatarNodeId || !Array.isArray(avatar)) return;
          if (avatar.length !== 8 || !avatar.every((row: any) => Array.isArray(row) && row.length === 8)) return;
          await storage.updateNodeAvatar(avatarNodeId, JSON.stringify(avatar));
          broadcastAll(
            JSON.stringify({
              type: "avatarUpdate",
              payload: { nodeId: avatarNodeId, avatar },
            })
          );
        } else if (message.type === "subPixelGoalResponse") {
          const { nodeId: respNodeId, regionX, regionY, placements } = message.payload || {};
          if (typeof respNodeId !== "number" || typeof regionX !== "number" || typeof regionY !== "number") return;
          if (!Array.isArray(placements) || placements.length === 0) return;
          const respNode = await storage.getNode(respNodeId);
          if (!respNode) return;
          const respName = respNode.displayName || respNode.name;
          for (const p of placements.slice(0, 4)) {
            const subX = Math.max(0, Math.min(7, Math.floor(Number(p.subX))));
            const subY = Math.max(0, Math.min(7, Math.floor(Number(p.subY))));
            const color = typeof p.color === "string" && /^#[0-9A-Fa-f]{6}$/.test(p.color) ? p.color : "#7AADAD";
            try {
              const sp = await storage.placeSubPixel({
                regionX, regionY, subX, subY, color,
                nodeId: respNodeId, nodeName: respName,
              });
              broadcastAll(JSON.stringify({
                type: "subPixelPlaced",
                payload: { id: sp.id, regionX, regionY, subX, subY, color, nodeName: respName, nodeId: respNodeId },
              }));
            } catch (err) {
              logger.error("ws", "subPixelGoalResponse placement error", err);
            }
          }
        } else if (message.type === "gameActionResponse") {
          const { requestId, action, x, y, reason, nodeName: respNodeName } = message.payload || {};
          if (!requestId || !action) return;
          const pending = pendingGameActions.get(requestId);
          if (pending) {
            clearTimeout(pending.timer);
            pendingGameActions.delete(requestId);
            pending.resolve({ action, x, y, reason, source: "llm", nodeName: respNodeName });
          }
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
          // Append to node memory
          if (entryNodeId) {
            storage.appendNodeMemoryEvent(entryNodeId, {
              type: "journal",
              content: trimmed,
              ts: Date.now(),
            }).catch(() => {});
          }
        }
      } catch (err) {
        logger.error("ws", "WebSocket message handler error", err);
      }
    });

    socket.on("close", async () => {
      if (nodeId) {
        clients.delete(nodeId);
        connectedNodeIds.delete(nodeId);
        nodePositionCache.delete(nodeId);
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

  startOrchestrator({ broadcastAll, sendToNode, broadcastNearby });

  return httpServer;
}
