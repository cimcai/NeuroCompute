import { db } from "./db";
import { nodes, messages, bridgeGames, TOKENS_PER_PIXEL, type Node, type InsertNode, type Message, type InsertMessage, type BridgeGame, type InsertBridgeGame } from "@shared/schema";
import { eq, desc, sql } from "drizzle-orm";

export interface IStorage {
  getNodes(): Promise<Node[]>;
  getNode(id: number): Promise<Node | undefined>;
  createNode(node: InsertNode): Promise<Node>;
  updateNodeTokens(id: number, addedTokens: number): Promise<Node>;
  updateNodeStatus(id: number, status: string): Promise<Node>;
  spendPixelCredit(nodeId: number): Promise<Node>;
  getMessages(limit?: number): Promise<Message[]>;
  createMessage(msg: InsertMessage): Promise<Message>;
  createBridgeGame(game: InsertBridgeGame): Promise<BridgeGame>;
  updateBridgeGame(id: number, updates: Partial<BridgeGame>): Promise<BridgeGame>;
  getBridgeGames(limit?: number): Promise<BridgeGame[]>;
  getBridgeGameBySession(sessionId: string): Promise<BridgeGame | undefined>;
  getBridgeStats(): Promise<{ modelId: string; gamesPlayed: number; gamesWon: number; totalCorrect: number; totalAnswered: number }[]>;
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
    const newTotalTokens = node.totalTokens + addedTokens;
    const oldCreditsFromTokens = Math.floor(node.totalTokens / TOKENS_PER_PIXEL);
    const newCreditsFromTokens = Math.floor(newTotalTokens / TOKENS_PER_PIXEL);
    const earnedCredits = newCreditsFromTokens - oldCreditsFromTokens;
    const [updated] = await db.update(nodes)
      .set({
        totalTokens: newTotalTokens,
        pixelCredits: node.pixelCredits + earnedCredits,
        lastSeen: new Date(),
      })
      .where(eq(nodes.id, id))
      .returning();
    return updated;
  }

  async spendPixelCredit(nodeId: number): Promise<Node> {
    const [node] = await db.select().from(nodes).where(eq(nodes.id, nodeId));
    if (!node) throw new Error("Node not found");
    if (node.pixelCredits < 1) throw new Error("Not enough pixel credits");
    const [updated] = await db.update(nodes)
      .set({
        pixelCredits: node.pixelCredits - 1,
        pixelsPlaced: node.pixelsPlaced + 1,
      })
      .where(eq(nodes.id, nodeId))
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

  async createBridgeGame(game: InsertBridgeGame): Promise<BridgeGame> {
    const [created] = await db.insert(bridgeGames).values(game).returning();
    return created;
  }

  async updateBridgeGame(id: number, updates: Partial<BridgeGame>): Promise<BridgeGame> {
    const [updated] = await db.update(bridgeGames)
      .set(updates)
      .where(eq(bridgeGames.id, id))
      .returning();
    return updated;
  }

  async getBridgeGames(limit = 50): Promise<BridgeGame[]> {
    return await db.select().from(bridgeGames).orderBy(desc(bridgeGames.createdAt)).limit(limit);
  }

  async getBridgeGameBySession(sessionId: string): Promise<BridgeGame | undefined> {
    const [game] = await db.select().from(bridgeGames).where(eq(bridgeGames.sessionId, sessionId));
    return game;
  }

  async getBridgeStats(): Promise<{ modelId: string; gamesPlayed: number; gamesWon: number; totalCorrect: number; totalAnswered: number }[]> {
    const results = await db
      .select({
        modelId: bridgeGames.modelId,
        gamesPlayed: sql<number>`count(*)::int`,
        gamesWon: sql<number>`count(*) filter (where ${bridgeGames.won} = 'yes')::int`,
        totalCorrect: sql<number>`sum(${bridgeGames.questionsCorrect})::int`,
        totalAnswered: sql<number>`sum(${bridgeGames.questionsAnswered})::int`,
      })
      .from(bridgeGames)
      .where(sql`${bridgeGames.won} != 'pending'`)
      .groupBy(bridgeGames.modelId);
    return results;
  }
}

export const storage = new DatabaseStorage();
