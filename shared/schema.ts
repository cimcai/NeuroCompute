import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const nodes = pgTable("nodes", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  totalTokens: integer("total_tokens").default(0).notNull(),
  status: text("status").default("offline").notNull(), // offline, computing
  lastSeen: timestamp("last_seen").defaultNow().notNull(),
});

export const insertNodeSchema = createInsertSchema(nodes).omit({ id: true, totalTokens: true, lastSeen: true });

export type Node = typeof nodes.$inferSelect;
export type InsertNode = z.infer<typeof insertNodeSchema>;
export type UpdateNodeRequest = Partial<InsertNode>;
