import { db } from "./db";
import { nodes, messages, type Node, type InsertNode, type Message, type InsertMessage } from "@shared/schema";
import { eq, desc } from "drizzle-orm";

export interface IStorage {
  getNodes(): Promise<Node[]>;
  getNode(id: number): Promise<Node | undefined>;
  createNode(node: InsertNode): Promise<Node>;
  updateNodeTokens(id: number, addedTokens: number): Promise<Node>;
  updateNodeStatus(id: number, status: string): Promise<Node>;
  getMessages(limit?: number): Promise<Message[]>;
  createMessage(msg: InsertMessage): Promise<Message>;
}

export class DatabaseStorage implements IStorage {
  async getNodes(): Promise<Node[]> {
    return await db.select().from(nodes);
  }

  async getNode(id: number): Promise<Node | undefined> {
    const [node] = await db.select().from(nodes).where(eq(nodes.id, id));
    return node;
  }

  async createNode(insertNode: InsertNode): Promise<Node> {
    const [node] = await db.insert(nodes).values({
      ...insertNode,
      status: "offline",
      totalTokens: 0,
    }).returning();
    return node;
  }

  async updateNodeTokens(id: number, addedTokens: number): Promise<Node> {
    const [node] = await db.select().from(nodes).where(eq(nodes.id, id));
    if (!node) throw new Error("Node not found");
    const [updated] = await db.update(nodes)
      .set({ totalTokens: node.totalTokens + addedTokens, lastSeen: new Date() })
      .where(eq(nodes.id, id))
      .returning();
    return updated;
  }

  async updateNodeStatus(id: number, status: string): Promise<Node> {
    const [updated] = await db.update(nodes)
      .set({ status, lastSeen: new Date() })
      .where(eq(nodes.id, id))
      .returning();
    return updated;
  }

  async getMessages(limit = 50): Promise<Message[]> {
    const msgs = await db.select().from(messages).orderBy(desc(messages.createdAt)).limit(limit);
    return msgs.reverse();
  }

  async createMessage(msg: InsertMessage): Promise<Message> {
    const [created] = await db.insert(messages).values(msg).returning();
    return created;
  }
}

export const storage = new DatabaseStorage();
