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

export const nodes = pgTable("nodes", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  displayName: text("display_name"),
  totalTokens: integer("total_tokens").default(0).notNull(),
  tokensSinceLastCredit: integer("tokens_since_last_credit").default(0).notNull(),
  pixelCredits: integer("pixel_credits").default(0).notNull(),
  pixelsPlaced: integer("pixels_placed").default(0).notNull(),
  pixelX: integer("pixel_x").default(16).notNull(),
  pixelY: integer("pixel_y").default(16).notNull(),
  pixelGoal: text("pixel_goal"),
  avatar: text("avatar"),
  status: text("status").default("offline").notNull(),
  lastSeen: timestamp("last_seen").defaultNow().notNull(),
});

export const insertNodeSchema = createInsertSchema(nodes).omit({ id: true, totalTokens: true, tokensSinceLastCredit: true, pixelCredits: true, pixelsPlaced: true, pixelX: true, pixelY: true, pixelGoal: true, avatar: true, lastSeen: true, displayName: true });

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
