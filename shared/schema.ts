import { sql } from "drizzle-orm";
import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const TOKENS_PER_PIXEL = 100;

export const nodes = pgTable("nodes", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  totalTokens: integer("total_tokens").default(0).notNull(),
  pixelCredits: integer("pixel_credits").default(0).notNull(),
  pixelsPlaced: integer("pixels_placed").default(0).notNull(),
  status: text("status").default("offline").notNull(),
  lastSeen: timestamp("last_seen").defaultNow().notNull(),
});

export const insertNodeSchema = createInsertSchema(nodes).omit({ id: true, totalTokens: true, pixelCredits: true, pixelsPlaced: true, lastSeen: true });

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
