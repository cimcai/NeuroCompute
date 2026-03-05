import { db } from "./db";
import { nodes, messages, bridgeGames, journalEntries, getPixelRate, type Node, type InsertNode, type Message, type InsertMessage, type BridgeGame, type InsertBridgeGame, type JournalEntry, type InsertJournalEntry } from "@shared/schema";
import { eq, desc, sql, sum } from "drizzle-orm";

export interface IStorage {
  getNodes(): Promise<Node[]>;
  getNode(id: number): Promise<Node | undefined>;
  createNode(node: InsertNode): Promise<Node>;
  updateNodeTokens(id: number, addedTokens: number): Promise<{ node: Node; currentRate: number; earnedCredits: number }>;
  updateNodeStatus(id: number, status: string): Promise<Node>;
  moveNode(id: number, x: number, y: number): Promise<Node>;
  updateNodeGoal(id: number, goal: string | null): Promise<Node>;
  spendPixelCredit(nodeId: number): Promise<Node>;
  getTotalNetworkTokens(): Promise<number>;
  getCurrentPixelRate(): Promise<{ rate: number; totalNetworkTokens: number }>;
  getMessages(limit?: number): Promise<Message[]>;
  createMessage(msg: InsertMessage): Promise<Message>;
  createBridgeGame(game: InsertBridgeGame): Promise<BridgeGame>;
  updateBridgeGame(id: number, updates: Partial<BridgeGame>): Promise<BridgeGame>;
  getBridgeGames(limit?: number): Promise<BridgeGame[]>;
  getBridgeGameBySession(sessionId: string): Promise<BridgeGame | undefined>;
  getBridgeStats(): Promise<{ modelId: string; gamesPlayed: number; gamesWon: number; totalCorrect: number; totalAnswered: number }[]>;
  updateNodeDisplayName(id: number, displayName: string | null): Promise<Node>;
  updateNodeAvatar(id: number, avatar: string | null): Promise<Node>;
  markAllNodesOffline(): Promise<void>;
  markStaleNodesOffline(staleMinutes?: number): Promise<void>;
  getJournalEntries(limit?: number): Promise<JournalEntry[]>;
  createJournalEntry(entry: InsertJournalEntry): Promise<JournalEntry>;
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

  async getTotalNetworkTokens(): Promise<number> {
    const [result] = await db.select({ total: sql<number>`coalesce(sum(${nodes.totalTokens}), 0)::int` }).from(nodes);
    return result.total;
  }

  async getCurrentPixelRate(): Promise<{ rate: number; totalNetworkTokens: number }> {
    const totalNetworkTokens = await this.getTotalNetworkTokens();
    return { rate: getPixelRate(totalNetworkTokens), totalNetworkTokens };
  }

  async updateNodeTokens(id: number, addedTokens: number): Promise<{ node: Node; currentRate: number; earnedCredits: number }> {
    const [node] = await db.select().from(nodes).where(eq(nodes.id, id));
    if (!node) throw new Error("Node not found");

    const newTotalTokens = node.totalTokens + addedTokens;
    const totalNetworkTokens = await this.getTotalNetworkTokens();
    const currentRate = getPixelRate(totalNetworkTokens);

    const accumulated = node.tokensSinceLastCredit + addedTokens;
    const earnedCredits = Math.floor(accumulated / currentRate);
    const remainder = accumulated % currentRate;

    if (earnedCredits > 0) {
      console.log(`[pixel] Node ${node.name} earned ${earnedCredits} credit(s)! Rate: ${currentRate} tok/credit, Network: ${totalNetworkTokens + addedTokens} total tokens`);
    }

    const [updated] = await db.update(nodes)
      .set({
        totalTokens: newTotalTokens,
        tokensSinceLastCredit: remainder,
        pixelCredits: node.pixelCredits + earnedCredits,
        lastSeen: new Date(),
      })
      .where(eq(nodes.id, id))
      .returning();
    return { node: updated, currentRate, earnedCredits };
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

  async moveNode(id: number, x: number, y: number): Promise<Node> {
    const clampedX = Math.max(0, Math.min(31, x));
    const clampedY = Math.max(0, Math.min(31, y));
    const [updated] = await db.update(nodes)
      .set({ pixelX: clampedX, pixelY: clampedY, lastSeen: new Date() })
      .where(eq(nodes.id, id))
      .returning();
    if (!updated) throw new Error("Node not found");
    return updated;
  }

  async updateNodeGoal(id: number, goal: string | null): Promise<Node> {
    const [updated] = await db.update(nodes)
      .set({ pixelGoal: goal, lastSeen: new Date() })
      .where(eq(nodes.id, id))
      .returning();
    if (!updated) throw new Error("Node not found");
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

  async updateNodeDisplayName(id: number, displayName: string | null): Promise<Node> {
    const [updated] = await db.update(nodes)
      .set({ displayName })
      .where(eq(nodes.id, id))
      .returning();
    if (!updated) throw new Error("Node not found");
    return updated;
  }

  async updateNodeAvatar(id: number, avatar: string | null): Promise<Node> {
    const [updated] = await db.update(nodes)
      .set({ avatar })
      .where(eq(nodes.id, id))
      .returning();
    if (!updated) throw new Error("Node not found");
    return updated;
  }

  async markAllNodesOffline(): Promise<void> {
    await db.update(nodes).set({ status: "offline" });
  }

  async markStaleNodesOffline(staleMinutes = 5): Promise<void> {
    const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000);
    await db.update(nodes)
      .set({ status: "offline" })
      .where(sql`${nodes.status} = 'computing' AND ${nodes.lastSeen} < ${cutoff}`);
  }

  async getJournalEntries(limit = 100): Promise<JournalEntry[]> {
    const entries = await db.select().from(journalEntries).orderBy(desc(journalEntries.createdAt)).limit(limit);
    return entries.reverse();
  }

  async createJournalEntry(entry: InsertJournalEntry): Promise<JournalEntry> {
    const [created] = await db.insert(journalEntries).values(entry).returning();
    return created;
  }
}

export const storage = new DatabaseStorage();
