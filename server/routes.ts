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

  app.get(api.messages.list.path, async (req, res) => {
    const msgs = await storage.getMessages();
    res.json(msgs);
  });

  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  const clients = new Map<number, WebSocket>();
  const pendingChats: Array<{ content: string; senderName: string; resolve: (response: string) => void }> = [];

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
          // Queue for any compute node to pick up
          broadcastAll(
            JSON.stringify({
              type: "chatPending",
              payload: { content: parsed.content },
            })
          );
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
