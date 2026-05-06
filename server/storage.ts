import { db } from "./db";
import { nodes, messages, bridgeGames, subPixels, journalEntries, dailySnapshots, patrons, walls, gameScores, getPixelRate, type Node, type InsertNode, type Message, type InsertMessage, type BridgeGame, type InsertBridgeGame, type SubPixel, type InsertSubPixel, type JournalEntry, type InsertJournalEntry, type DailySnapshot, type InsertDailySnapshot, type Patron, type Wall, type InsertWall, type GameScore, type InsertGameScore } from "@shared/schema";
import { eq, desc, sql, and } from "drizzle-orm";

export interface PatronLeaderboardEntry {
  id: number;
  name: string;
  agentCount: number;
  activeAgents: number;
  totalTokens: number;
  pixelsPlaced: number;
  createdAt: Date;
}

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
  getSubPixels(regionX: number, regionY: number): Promise<SubPixel[]>;
  placeSubPixel(data: InsertSubPixel): Promise<SubPixel>;
  getRegionsWithSubPixels(): Promise<{ regionX: number; regionY: number; count: number }[]>;
  createSnapshot(snap: InsertDailySnapshot): Promise<DailySnapshot>;
  getLatestSnapshot(): Promise<DailySnapshot | undefined>;
  getSnapshots(limit: number): Promise<DailySnapshot[]>;
  getSubPixelCount(): Promise<number>;
  getMessageCount(): Promise<number>;
  getJournalEntryCount(): Promise<number>;
  createPatron(name: string, tokenHash: string): Promise<Patron>;
  getPatronByTokenHash(hash: string): Promise<Patron | undefined>;
  getPatronById(id: number): Promise<Patron | undefined>;
  getNodeBySessionTokenHash(hash: string, nodeId: number): Promise<Node | undefined>;
  linkNodeToPatron(nodeId: number, patronId: number): Promise<Node>;
  getPatronLeaderboard(period?: 'all' | '7d' | '24h'): Promise<PatronLeaderboardEntry[]>;
  getNetworkStats(): Promise<{ activeAgents: number; totalTokens: number; totalPatrons: number }>;
  updateNodeMemory(id: number, memory: string): Promise<Node>;
  appendNodeMemoryEvent(id: number, event: { type: string; content: string; ts: number }): Promise<void>;
  getNodeJournalEntries(nodeId: number, limit?: number, offset?: number): Promise<JournalEntry[]>;
  deductMoveCredit(id: number, amount?: number): Promise<void>;
  getWalls(): Promise<Wall[]>;
  getWallAt(x: number, y: number): Promise<Wall | undefined>;
  createWall(data: InsertWall): Promise<Wall>;
  moveWall(id: number, x: number, y: number): Promise<Wall>;
  deleteWall(id: number): Promise<void>;
  transferEnergy(fromNodeId: number, toNodeId: number, amount: number): Promise<{ from: Node; to: Node }>;
  submitGameScore(data: InsertGameScore): Promise<GameScore>;
  getGameLeaderboard(): Promise<{
    topByScore: GameScore[];
    topByBiodiversity: GameScore[];
    regionBestScores: { regionX: number; regionY: number; bestScore: number; bestBio: number; sessions: number }[];
    totalSessions: number;
  }>;
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

  async getSubPixels(regionX: number, regionY: number): Promise<SubPixel[]> {
    return await db
      .select()
      .from(subPixels)
      .where(and(eq(subPixels.regionX, regionX), eq(subPixels.regionY, regionY)))
      .orderBy(subPixels.placedAt);
  }

  async placeSubPixel(data: InsertSubPixel): Promise<SubPixel> {
    const existing = await db
      .select()
      .from(subPixels)
      .where(
        and(
          eq(subPixels.regionX, data.regionX),
          eq(subPixels.regionY, data.regionY),
          eq(subPixels.subX, data.subX),
          eq(subPixels.subY, data.subY)
        )
      );
    if (existing.length > 0) {
      const [updated] = await db
        .update(subPixels)
        .set({ color: data.color, nodeId: data.nodeId ?? null, nodeName: data.nodeName, placedAt: new Date() })
        .where(eq(subPixels.id, existing[0].id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(subPixels).values(data).returning();
    return created;
  }

  async getRegionsWithSubPixels(): Promise<{ regionX: number; regionY: number; count: number }[]> {
    const results = await db
      .select({
        regionX: subPixels.regionX,
        regionY: subPixels.regionY,
        count: sql<number>`count(*)::int`,
      })
      .from(subPixels)
      .groupBy(subPixels.regionX, subPixels.regionY);
    return results;
  }

  async createSnapshot(snap: InsertDailySnapshot): Promise<DailySnapshot> {
    const [created] = await db.insert(dailySnapshots).values(snap).returning();
    return created;
  }

  async getLatestSnapshot(): Promise<DailySnapshot | undefined> {
    const [snap] = await db.select().from(dailySnapshots).orderBy(desc(dailySnapshots.createdAt)).limit(1);
    return snap;
  }

  async getSnapshots(limit: number): Promise<DailySnapshot[]> {
    const snaps = await db.select().from(dailySnapshots).orderBy(desc(dailySnapshots.createdAt)).limit(limit);
    return snaps.reverse();
  }

  async getSubPixelCount(): Promise<number> {
    const [result] = await db.select({ count: sql<number>`count(*)::int` }).from(subPixels);
    return result?.count ?? 0;
  }

  async getMessageCount(): Promise<number> {
    const [result] = await db.select({ count: sql<number>`count(*)::int` }).from(messages);
    return result.count;
  }

  async getJournalEntryCount(): Promise<number> {
    const [result] = await db.select({ count: sql<number>`count(*)::int` }).from(journalEntries);
    return result?.count ?? 0;
  }

  async createPatron(name: string, tokenHash: string): Promise<Patron> {
    const [created] = await db.insert(patrons).values({ name, tokenHash }).returning();
    return created;
  }

  async getPatronByTokenHash(hash: string): Promise<Patron | undefined> {
    const [patron] = await db.select().from(patrons).where(eq(patrons.tokenHash, hash));
    return patron;
  }

  async getPatronById(id: number): Promise<Patron | undefined> {
    const [patron] = await db.select().from(patrons).where(eq(patrons.id, id));
    return patron;
  }

  async getNodeBySessionTokenHash(hash: string, nodeId: number): Promise<Node | undefined> {
    const [node] = await db
      .select()
      .from(nodes)
      .where(and(eq(nodes.id, nodeId), eq(nodes.sessionTokenHash, hash)));
    return node;
  }

  async linkNodeToPatron(nodeId: number, patronId: number): Promise<Node> {
    const [updated] = await db.update(nodes)
      .set({ patronId })
      .where(eq(nodes.id, nodeId))
      .returning();
    if (!updated) throw new Error("Node not found");
    return updated;
  }

  async getPatronLeaderboard(period: 'all' | '7d' | '24h' = 'all'): Promise<PatronLeaderboardEntry[]> {
    const cutoff =
      period === '24h' ? new Date(Date.now() - 24 * 60 * 60 * 1000) :
      period === '7d'  ? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) :
      null;

    const tokenExpr = cutoff
      ? sql<number>`coalesce(sum(${nodes.totalTokens}) filter (where ${nodes.lastSeen} >= ${cutoff}), 0)::int`
      : sql<number>`coalesce(sum(${nodes.totalTokens}), 0)::int`;

    const pixelExpr = cutoff
      ? sql<number>`coalesce(sum(${nodes.pixelsPlaced}) filter (where ${nodes.lastSeen} >= ${cutoff}), 0)::int`
      : sql<number>`coalesce(sum(${nodes.pixelsPlaced}), 0)::int`;

    const agentCountExpr = cutoff
      ? sql<number>`count(${nodes.id}) filter (where ${nodes.lastSeen} >= ${cutoff})::int`
      : sql<number>`count(${nodes.id})::int`;

    const results = await db
      .select({
        id: patrons.id,
        name: patrons.name,
        createdAt: patrons.createdAt,
        agentCount: agentCountExpr,
        activeAgents: sql<number>`count(${nodes.id}) filter (where ${nodes.status} = 'computing')::int`,
        totalTokens: tokenExpr,
        pixelsPlaced: pixelExpr,
      })
      .from(patrons)
      .leftJoin(nodes, eq(nodes.patronId, patrons.id))
      .groupBy(patrons.id, patrons.name, patrons.createdAt)
      .orderBy(desc(cutoff
        ? sql`coalesce(sum(${nodes.totalTokens}) filter (where ${nodes.lastSeen} >= ${cutoff}), 0)`
        : sql`coalesce(sum(${nodes.totalTokens}), 0)`
      ));
    return results;
  }

  async getNetworkStats(): Promise<{ activeAgents: number; totalTokens: number; totalPatrons: number }> {
    const [nodeStats] = await db
      .select({
        activeAgents: sql<number>`count(*) filter (where ${nodes.status} = 'computing')::int`,
        totalTokens: sql<number>`coalesce(sum(${nodes.totalTokens}), 0)::int`,
      })
      .from(nodes);
    const [patronCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(patrons);
    return {
      activeAgents: nodeStats?.activeAgents ?? 0,
      totalTokens: nodeStats?.totalTokens ?? 0,
      totalPatrons: patronCount?.count ?? 0,
    };
  }

  async updateNodeMemory(id: number, memory: string): Promise<Node> {
    const [updated] = await db.update(nodes)
      .set({ memory })
      .where(eq(nodes.id, id))
      .returning();
    if (!updated) throw new Error("Node not found");
    return updated;
  }

  async appendNodeMemoryEvent(id: number, event: { type: string; content: string; ts: number }): Promise<void> {
    const node = await this.getNode(id);
    if (!node) return;
    let events: { type: string; content: string; ts: number }[] = [];
    if (node.memory) {
      try { events = JSON.parse(node.memory); } catch {}
    }
    events.push(event);
    if (events.length > 20) events = events.slice(events.length - 20);
    await this.updateNodeMemory(id, JSON.stringify(events));
  }

  async getNodeJournalEntries(nodeId: number, limit = 20, offset = 0): Promise<JournalEntry[]> {
    const entries = await db
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.nodeId, nodeId))
      .orderBy(desc(journalEntries.createdAt))
      .limit(limit)
      .offset(offset);
    return entries.reverse();
  }

  async deductMoveCredit(id: number, amount = 1): Promise<void> {
    await db.update(nodes).set({ pixelCredits: sql`GREATEST(0, pixel_credits - ${amount})` }).where(eq(nodes.id, id));
  }

  async getWalls(): Promise<Wall[]> {
    return await db.select().from(walls).orderBy(walls.id);
  }

  async getWallAt(x: number, y: number): Promise<Wall | undefined> {
    const [wall] = await db.select().from(walls).where(and(eq(walls.x, x), eq(walls.y, y)));
    return wall;
  }

  async createWall(data: InsertWall): Promise<Wall> {
    const [created] = await db.insert(walls).values(data).returning();
    return created;
  }

  async moveWall(id: number, x: number, y: number): Promise<Wall> {
    const [updated] = await db.update(walls).set({ x, y }).where(eq(walls.id, id)).returning();
    if (!updated) throw new Error("Wall not found");
    return updated;
  }

  async deleteWall(id: number): Promise<void> {
    await db.delete(walls).where(eq(walls.id, id));
  }

  async transferEnergy(fromNodeId: number, toNodeId: number, amount: number): Promise<{ from: Node; to: Node }> {
    const [from] = await db.select().from(nodes).where(eq(nodes.id, fromNodeId));
    const [to] = await db.select().from(nodes).where(eq(nodes.id, toNodeId));
    if (!from) throw new Error("Source node not found");
    if (!to) throw new Error("Target node not found");
    if (from.pixelCredits < amount) throw new Error("Not enough energy");
    const [updatedFrom] = await db.update(nodes).set({ pixelCredits: from.pixelCredits - amount }).where(eq(nodes.id, fromNodeId)).returning();
    const [updatedTo] = await db.update(nodes).set({ pixelCredits: to.pixelCredits + amount }).where(eq(nodes.id, toNodeId)).returning();
    return { from: updatedFrom, to: updatedTo };
  }

  async submitGameScore(data: InsertGameScore): Promise<GameScore> {
    const [created] = await db.insert(gameScores).values(data).returning();
    return created;
  }

  async getGameLeaderboard() {
    const all = await db.select().from(gameScores).orderBy(desc(gameScores.score));
    const topByScore = all.slice(0, 10);
    const topByBiodiversity = [...all]
      .sort((a, b) => b.biodiversityScore - a.biodiversityScore || b.score - a.score)
      .slice(0, 10);

    const regionMap = new Map<string, { regionX: number; regionY: number; bestScore: number; bestBio: number; sessions: number }>();
    for (const row of all) {
      if (row.regionX == null || row.regionY == null) continue;
      const key = `${row.regionX},${row.regionY}`;
      const existing = regionMap.get(key);
      if (!existing) {
        regionMap.set(key, { regionX: row.regionX, regionY: row.regionY, bestScore: row.score, bestBio: row.biodiversityScore, sessions: 1 });
      } else {
        existing.bestScore = Math.max(existing.bestScore, row.score);
        existing.bestBio = Math.max(existing.bestBio, row.biodiversityScore);
        existing.sessions++;
      }
    }
    const regionBestScores = [...regionMap.values()].sort((a, b) => b.bestBio - a.bestBio).slice(0, 20);

    return { topByScore, topByBiodiversity, regionBestScores, totalSessions: all.length };
  }
}

export const storage = new DatabaseStorage();
