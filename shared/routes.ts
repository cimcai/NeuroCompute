import { z } from "zod";
import { insertNodeSchema, nodes } from "./schema";

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
        201: z.custom<typeof nodes.$inferSelect>(),
        400: errorSchemas.validation,
      },
    }
  },
};

export const ws = {
  send: {
    nodeJoined: z.object({ id: z.number() }),
    stats: z.object({ tokensGenerated: z.number(), tokensPerSecond: z.number() }),
  },
  receive: {
    nodeJoined: z.object({ id: z.number(), name: z.string() }),
    nodeLeft: z.object({ id: z.number() }),
    statsUpdate: z.object({ id: z.number(), totalTokens: z.number(), status: z.string(), tokensPerSecond: z.number() }),
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
