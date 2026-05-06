import { sql } from "drizzle-orm";
import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const BASE_TOKENS_PER_PIXEL = 10;
export const RATE_SCALE_FACTOR = 1000;

export function getPixelRate(totalNetworkTokens: number): number {
  return Math.max(
    BASE_TOKENS_PER_PIXEL,
    Math.floor(BASE_TOKENS_PER_PIXEL * (1 + Math.log(1 + totalNetworkTokens / RATE_SCALE_FACTOR)))
  );
}

export const GRID_CENTER = 16;

export const patrons = pgTable("patrons", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPatronSchema = createInsertSchema(patrons).omit({ id: true, createdAt: true });
export type Patron = typeof patrons.$inferSelect;
export type InsertPatron = z.infer<typeof insertPatronSchema>;

export const nodes = pgTable("nodes", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  displayName: text("display_name"),
  patronId: integer("patron_id").references(() => patrons.id),
  totalTokens: integer("total_tokens").default(0).notNull(),
  tokensSinceLastCredit: integer("tokens_since_last_credit").default(0).notNull(),
  pixelCredits: integer("pixel_credits").default(0).notNull(),
  pixelsPlaced: integer("pixels_placed").default(0).notNull(),
  pixelX: integer("pixel_x").default(16).notNull(),
  pixelY: integer("pixel_y").default(16).notNull(),
  pixelGoal: text("pixel_goal"),
  avatar: text("avatar"),
  memory: text("memory"),
  status: text("status").default("offline").notNull(),
  sessionTokenHash: text("session_token_hash"),
  lastSeen: timestamp("last_seen").defaultNow().notNull(),
});

export const insertNodeSchema = createInsertSchema(nodes).omit({ id: true, totalTokens: true, tokensSinceLastCredit: true, pixelCredits: true, pixelsPlaced: true, pixelX: true, pixelY: true, pixelGoal: true, avatar: true, memory: true, lastSeen: true, displayName: true, patronId: true, sessionTokenHash: true });

export type Node = typeof nodes.$inferSelect;
export type InsertNode = z.infer<typeof insertNodeSchema>;

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  senderName: text("sender_name").notNull(),
  nodeId: integer("node_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMessageSchema = createInsertSchema(messages).omit({ id: true, createdAt: true });

export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;

export const bridgeGames = pgTable("bridge_games", {
  id: serial("id").primaryKey(),
  sessionId: text("session_id").notNull(),
  playerName: text("player_name").notNull(),
  modelId: text("model_id").notNull(),
  questionsAnswered: integer("questions_answered").default(0).notNull(),
  questionsCorrect: integer("questions_correct").default(0).notNull(),
  won: text("won").default("pending").notNull(),
  questions: text("questions").array().default([]).notNull(),
  answers: text("answers").array().default([]).notNull(),
  results: text("results").array().default([]).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertBridgeGameSchema = createInsertSchema(bridgeGames).omit({ id: true, createdAt: true });

export type BridgeGame = typeof bridgeGames.$inferSelect;
export type InsertBridgeGame = z.infer<typeof insertBridgeGameSchema>;

export const subPixels = pgTable("sub_pixels", {
  id: serial("id").primaryKey(),
  regionX: integer("region_x").notNull(),
  regionY: integer("region_y").notNull(),
  subX: integer("sub_x").notNull(),
  subY: integer("sub_y").notNull(),
  color: text("color").notNull(),
  nodeId: integer("node_id"),
  nodeName: text("node_name").notNull(),
  placedAt: timestamp("placed_at").defaultNow().notNull(),
});

export const insertSubPixelSchema = createInsertSchema(subPixels).omit({ id: true, placedAt: true });

export type SubPixel = typeof subPixels.$inferSelect;
export type InsertSubPixel = z.infer<typeof insertSubPixelSchema>;

export const journalEntries = pgTable("journal_entries", {
  id: serial("id").primaryKey(),
  nodeName: text("node_name").notNull(),
  nodeId: integer("node_id"),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertJournalEntrySchema = createInsertSchema(journalEntries).omit({ id: true, createdAt: true });

export type JournalEntry = typeof journalEntries.$inferSelect;
export type InsertJournalEntry = z.infer<typeof insertJournalEntrySchema>;

export const dailySnapshots = pgTable("daily_snapshots", {
  id: serial("id").primaryKey(),
  snapshotDate: text("snapshot_date").notNull(),
  totalNodes: integer("total_nodes").default(0).notNull(),
  totalTokens: integer("total_tokens").default(0).notNull(),
  totalPixelsPlaced: integer("total_pixels_placed").default(0).notNull(),
  activeNodes: integer("active_nodes").default(0).notNull(),
  messageCount: integer("message_count").default(0).notNull(),
  nodeTokensSnapshot: text("node_tokens_snapshot"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertDailySnapshotSchema = createInsertSchema(dailySnapshots).omit({ id: true, createdAt: true });

export type DailySnapshot = typeof dailySnapshots.$inferSelect;
export type InsertDailySnapshot = z.infer<typeof insertDailySnapshotSchema>;

export const walls = pgTable("walls", {
  id: serial("id").primaryKey(),
  x: integer("x").notNull(),
  y: integer("y").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertWallSchema = createInsertSchema(walls).omit({ id: true, createdAt: true });

export type Wall = typeof walls.$inferSelect;
export type InsertWall = z.infer<typeof insertWallSchema>;

export const gameScores = pgTable("game_scores", {
  id: serial("id").primaryKey(),
  patronId: integer("patron_id").references(() => patrons.id),
  nodeId: integer("node_id"),
  externalUserId: text("external_user_id"),
  nickname: text("nickname"),
  score: integer("score").notNull().default(0),
  biodiversityScore: integer("biodiversity_score").notNull().default(0),
  livingCreatures: integer("living_creatures").notNull().default(0),
  eggsCollected: integer("eggs_collected").notNull().default(0),
  level: integer("level").notNull().default(1),
  treeCount: integer("tree_count").default(0).notNull(),
  birdCount: integer("bird_count").default(0).notNull(),
  bunnyCount: integer("bunny_count").default(0).notNull(),
  foxCount: integer("fox_count").default(0).notNull(),
  bearCount: integer("bear_count").default(0).notNull(),
  buffaloCount: integer("buffalo_count").default(0).notNull(),
  beeCount: integer("bee_count").default(0).notNull(),
  butterflyCount: integer("butterfly_count").default(0).notNull(),
  flowerCount: integer("flower_count").default(0).notNull(),
  regionX: integer("region_x"),
  regionY: integer("region_y"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertGameScoreSchema = createInsertSchema(gameScores).omit({ id: true, createdAt: true });

export type GameScore = typeof gameScores.$inferSelect;
export type InsertGameScore = z.infer<typeof insertGameScoreSchema>;
