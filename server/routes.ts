import type { Express } from "express";
import { type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { api, ws as wsSchema } from "@shared/routes";
import { z } from "zod";

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

  // Setup WebSocket server
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  const clients = new Map<number, WebSocket>();

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
            // Broadcast join
            const msg = JSON.stringify({ type: "nodeJoined", payload: { id: node.id, name: node.name } });
            wss.clients.forEach((c) => {
              if (c !== socket && c.readyState === WebSocket.OPEN) {
                c.send(msg);
              }
            });
          }
        } else if (message.type === "stats") {
          if (!nodeId) return;
          const parsed = wsSchema.send.stats.parse(message.payload);
          const updated = await storage.updateNodeTokens(nodeId, parsed.tokensGenerated);
          
          // Broadcast stats update
          const msg = JSON.stringify({
            type: "statsUpdate",
            payload: {
              id: nodeId,
              totalTokens: updated.totalTokens,
              status: updated.status,
              tokensPerSecond: parsed.tokensPerSecond,
            },
          });
          wss.clients.forEach((c) => {
            if (c.readyState === WebSocket.OPEN) {
              c.send(msg);
            }
          });
        }
      } catch (err) {
        console.error("WS error:", err);
      }
    });

    socket.on("close", async () => {
      if (nodeId) {
        clients.delete(nodeId);
        await storage.updateNodeStatus(nodeId, "offline");
        const msg = JSON.stringify({ type: "nodeLeft", payload: { id: nodeId } });
        wss.clients.forEach((c) => {
          if (c.readyState === WebSocket.OPEN) {
            c.send(msg);
          }
        });
      }
    });
  });

  return httpServer;
}