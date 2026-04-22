import { z } from "zod";
import { insertNodeSchema, insertMessageSchema, nodes, messages } from "./schema";

export const errorSchemas = {
  validation: z.object({ message: z.string(), field: z.string().optional() }),
  notFound: z.object({ message: z.string() }),
  internal: z.object({ message: z.string() }),
};

export const api = {
  nodes: {
    list: {
      method: "GET" as const,
      path: "/api/nodes" as const,
      responses: {
        200: z.array(z.custom<typeof nodes.$inferSelect>()),
      },
    },
    get: {
      method: "GET" as const,
      path: "/api/nodes/:id" as const,
      responses: {
        200: z.custom<typeof nodes.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    create: {
      method: "POST" as const,
      path: "/api/nodes" as const,
      input: insertNodeSchema,
      responses: {
        201: z.custom<Omit<typeof nodes.$inferSelect, 'sessionTokenHash'> & { sessionToken: string }>(),
        400: errorSchemas.validation,
      },
    },
  },
  messages: {
    list: {
      method: "GET" as const,
      path: "/api/messages" as const,
      responses: {
        200: z.array(z.custom<typeof messages.$inferSelect>()),
      },
    },
  },
};

export const ws = {
  send: {
    nodeJoined: z.object({ id: z.number() }),
    stats: z.object({ tokensGenerated: z.number(), tokensPerSecond: z.number() }),
    chatMessage: z.object({ content: z.string(), senderName: z.string() }),
    chatResponse: z.object({ content: z.string(), nodeId: z.number(), nodeName: z.string() }),
    bridgeAnswer: z.object({ gameId: z.number(), answer: z.string(), nodeId: z.number(), nodeName: z.string() }),
    journalEntry: z.object({ content: z.string(), nodeName: z.string(), nodeId: z.number() }),
    pixelGoalSet: z.object({ nodeId: z.number(), nodeName: z.string(), description: z.string(), targetX: z.number(), targetY: z.number(), color: z.string() }),
    avatarSet: z.object({ nodeId: z.number(), avatar: z.array(z.array(z.string())) }),
  },
  receive: {
    nodeJoined: z.object({ id: z.number(), name: z.string() }),
    nodeLeft: z.object({ id: z.number() }),
    statsUpdate: z.object({ id: z.number(), totalTokens: z.number(), status: z.string(), tokensPerSecond: z.number(), currentRate: z.number().optional(), tokensSinceLastCredit: z.number().optional() }),
    chatMessage: z.object({ id: z.number(), content: z.string(), senderName: z.string(), role: z.string() }),
    chatResponseChunk: z.object({ messageId: z.number(), chunk: z.string(), done: z.boolean(), nodeName: z.string() }),
    chatPending: z.object({ content: z.string() }),
    journalEntry: z.object({ id: z.number(), nodeName: z.string(), nodeId: z.number().nullable(), content: z.string(), createdAt: z.string() }),
    bridgeQuestion: z.object({ gameId: z.number(), sessionId: z.string(), question: z.string(), questionNumber: z.number(), category: z.string(), modelId: z.string() }),
    bridgeResult: z.object({ gameId: z.number(), correct: z.boolean(), message: z.string(), gameOver: z.boolean(), won: z.boolean(), score: z.object({ answered: z.number(), correct: z.number(), total: z.number() }) }),
    bridgeUpdate: z.object({ game: z.any() }),
    pixelCommentRequest: z.object({ x: z.number(), y: z.number(), color: z.string(), colorName: z.string().optional(), wasEmpty: z.boolean(), creditsLeft: z.number(), goalDescription: z.string().nullable().optional() }),
    pixelObservationRequest: z.object({ placerName: z.string(), x: z.number(), y: z.number(), colorName: z.string(), goalDescription: z.string().nullable().optional() }),
    pixelGoalRequest: z.object({ nodeId: z.number(), currentX: z.number(), currentY: z.number(), credits: z.number(), nearbyColors: z.string() }),
    nodeMoved: z.object({ nodeId: z.number(), nodeName: z.string(), x: z.number(), y: z.number() }),
    nodeGoalSet: z.object({ nodeId: z.number(), nodeName: z.string(), description: z.string(), targetX: z.number(), targetY: z.number(), color: z.string() }),
    nodeGoalCleared: z.object({ nodeId: z.number() }),
    avatarUpdate: z.object({ nodeId: z.number(), avatar: z.array(z.array(z.string())) }),
    memoryContext: z.object({ events: z.array(z.object({ type: z.string(), content: z.string(), ts: z.number() })) }),
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}

export type NodeInput = z.infer<typeof api.nodes.create.input>;
export type NodeResponse = z.infer<typeof api.nodes.create.responses[201]>;
