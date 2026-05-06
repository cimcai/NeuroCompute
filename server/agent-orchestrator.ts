import * as cimc from "./cimc";
import { storage } from "./storage";
import { logger } from "./logger";
import { runDailyReport, getIntervalMs, getReportFrequency } from "./analytics";
import { BIOMES, getBiomeByColor, getBiomeNeighborSuggestions, BIOME_BY_ID } from "@shared/biomes";

type BroadcastFn = (msg: string) => void;
type SendToNodeFn = (nodeId: number, msg: string) => boolean;
type BroadcastNearbyFn = (centerX: number, centerY: number, radius: number, msg: string) => void;

interface OrchestratorConfig {
  broadcastAll: BroadcastFn;
  sendToNode: SendToNodeFn;
  broadcastNearby: BroadcastNearbyFn;
}

const SPATIAL_CHAT_RADIUS = 8;
const SPATIAL_OBSERVATION_RADIUS = 12;
const SPATIAL_GOAL_RADIUS = 16;

const CHAT_INTERVAL_MS = 90_000;
const CONVO_INTERVAL_MS = 45_000;
const BRIDGE_INTERVAL_MS = 120_000;
const PIXEL_INTERVAL_MS = 45_000;
const GOAL_EXPIRY_MS = 10 * 60 * 1000;

// Passable biome colors used for orchestrator fallback goal color selection
const PASSABLE_BIOME_COLORS = BIOMES.filter(b => b.passable).map(b => b.color);

const COLOR_NAMES: Record<string, string> = {
  "#7AADAD": "dusty teal",
  "#A98EC4": "soft lavender",
  "#8FAF8A": "sage green",
  "#C4A882": "warm sand",
  "#7B9AB5": "steel blue",
  "#C4785A": "terracotta",
  "#9DB87A": "muted lime",
  "#C4A84E": "muted gold",
  "#8090A0": "slate gray",
  "#B58A7A": "dusty rose",
  "#7A9EC4": "cornflower",
  "#C49A7A": "warm tan",
  "#8B4513": "saddle brown",
  "#228B22": "forest green",
  "#808080": "stone gray",
  "#4169E1": "royal blue",
  "#CC0000": "deep red",
  "#FF69B4": "pink blossom",
  "#696969": "charcoal",
  "#FFD700": "golden yellow",
  "#FFFFFF": "white",
  "#DEB887": "burlywood",
  "#A9A9A9": "ash gray",
  "#9ACD32": "yellow-green",
  "#87CEEB": "sky blue",
  "#E8D5B0": "warm cream",
};

function getColorName(hex: string): string {
  const upper = hex.toUpperCase();
  return COLOR_NAMES[hex] || COLOR_NAMES[upper] || hex;
}

const CHAT_SYSTEM_PROMPTS = [
  "You are a thoughtful AI contributing to a philosophical discussion. Give a brief, insightful perspective.",
  "You are a creative AI in a decentralized network. Share an interesting thought or observation.",
  "You are an AI philosopher. Offer a brief but thought-provoking response.",
];

interface ParsedGoal {
  description: string;
  targetX: number;
  targetY: number;
  color: string;
  setAt: number;
}

const AVATAR_TEMPLATES = [
  [ // Robot face
    "_ _ C C C C _ _",
    "_ C C C C C C _",
    "C C E C C E C C",
    "C C C C C C C C",
    "C C C _ _ C C C",
    "C C C C C C C C",
    "_ C _ C C _ C _",
    "_ _ C C C C _ _",
  ],
  [ // Cat
    "_ C _ _ _ _ C _",
    "C C C _ _ C C C",
    "C E C C C E C C",
    "C C C N N C C C",
    "C C _ C C _ C C",
    "_ C C C C C C _",
    "_ _ C C C C _ _",
    "_ _ _ C C _ _ _",
  ],
  [ // Ghost
    "_ _ C C C C _ _",
    "_ C C C C C C _",
    "C C E C C E C C",
    "C C C C C C C C",
    "C C C C C C C C",
    "C C C C C C C C",
    "C _ C C C C _ C",
    "_ _ C _ _ C _ _",
  ],
  [ // Tree
    "_ _ _ C C _ _ _",
    "_ _ C C C C _ _",
    "_ C C C C C C _",
    "C C C C C C C C",
    "_ C C C C C C _",
    "_ _ _ B B _ _ _",
    "_ _ _ B B _ _ _",
    "_ _ B B B B _ _",
  ],
  [ // Star
    "_ _ _ C _ _ _ _",
    "_ _ _ C C _ _ _",
    "C C C C C C C C",
    "_ C C C C C C _",
    "_ _ C C C C _ _",
    "_ C C _ _ C C _",
    "C C _ _ _ _ C C",
    "C _ _ _ _ _ _ C",
  ],
  [ // Heart
    "_ C C _ _ C C _",
    "C C C C C C C C",
    "C C C C C C C C",
    "C C C C C C C C",
    "_ C C C C C C _",
    "_ _ C C C C _ _",
    "_ _ _ C C _ _ _",
    "_ _ _ _ _ _ _ _",
  ],
];

function generateFallbackAvatar(): string[][] {
  const template = AVATAR_TEMPLATES[Math.floor(Math.random() * AVATAR_TEMPLATES.length)];
  const palettes = [
    { C: "#7AADAD", E: "#E8D5B0", N: "#C4849A", B: "#7A5C3A" },
    { C: "#A98EC4", E: "#D4C87A", N: "#5A5A6A", B: "#7A5C3A" },
    { C: "#8FAF8A", E: "#C4785A", N: "#F0EAD6", B: "#5C4030" },
    { C: "#C4785A", E: "#7AADAD", N: "#F0EAD6", B: "#7A5C3A" },
    { C: "#7B9AB5", E: "#C4A84E", N: "#C4849A", B: "#7A5C3A" },
    { C: "#C4A84E", E: "#8090A0", N: "#3A3A4A", B: "#5C4030" },
    { C: "#B07070", E: "#E8D5B0", N: "#3A3A4A", B: "#7A5C3A" },
    { C: "#9080B8", E: "#8FAF8A", N: "#C4849A", B: "#5C4030" },
  ];
  const palette = palettes[Math.floor(Math.random() * palettes.length)];
  return template.map(row =>
    row.split(" ").map(c => {
      if (c === "_") return "#000000";
      return (palette as any)[c] || "#FFFFFF";
    })
  );
}

let lastSeenEntryId = 0;
let lastSeenRoom1EntryId = 0;
let activeBridgeSessionId: string | null = null;

const SPIRITS_INTERVAL_MS = 60_000;

async function runSpiritsAgent(config: OrchestratorConfig) {
  try {
    const data = await cimc.getConversation(1, 10);
    if (!data?.entries?.length) return;

    const maxId = Math.max(...data.entries.map((e) => e.id));

    if (lastSeenRoom1EntryId === 0) {
      lastSeenRoom1EntryId = maxId;
      const latest = data.entries[data.entries.length - 1];
      if (latest) {
        console.log(`[spirits] Seeding with latest from ${latest.speaker}: "${latest.content.slice(0, 60)}..."`);
        const saved = await storage.createMessage({
          role: "spirit",
          content: latest.content,
          senderName: latest.speaker,
        });
        config.broadcastAll(
          JSON.stringify({
            type: "chatMessage",
            payload: { id: saved.id, content: saved.content, senderName: saved.senderName, role: "spirit" },
          })
        );
      }
      return;
    }

    const newEntries = data.entries.filter((e) => e.id > lastSeenRoom1EntryId);
    lastSeenRoom1EntryId = maxId;

    for (const entry of newEntries) {
      console.log(`[spirits] New message from ${entry.speaker}: "${entry.content.slice(0, 60)}..."`);
      const saved = await storage.createMessage({
        role: "spirit",
        content: entry.content,
        senderName: entry.speaker,
      });
      config.broadcastAll(
        JSON.stringify({
          type: "chatMessage",
          payload: { id: saved.id, content: saved.content, senderName: saved.senderName, role: "spirit" },
        })
      );
    }
  } catch (err) {
    logger.error("orchestrator", "Spirits agent error", err);
  }
}

let reportInitTimeout: ReturnType<typeof setTimeout> | null = null;
let reportRepeatInterval: ReturnType<typeof setInterval> | null = null;

function scheduleDailyReport() {
  const frequency = getReportFrequency();
  const intervalMs = getIntervalMs();

  const now = new Date();
  const nextMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  const msUntilFirst = nextMidnight.getTime() - now.getTime();

  console.log(`[analytics] ${frequency} report scheduled in ${Math.round(msUntilFirst / 60000)} minutes (next UTC midnight), then every ${frequency === "weekly" ? "7 days" : "24h"}`);

  const runReport = async () => {
    try {
      const result = await runDailyReport();
      console.log(`[analytics] ${frequency} report done — emailSent=${result.emailSent}, computeSecondsDelta=${result.report.computeSecondsDelta}`);
    } catch (err) {
      logger.error("analytics", `${frequency} report run failed`, err);
    }
  };

  reportInitTimeout = setTimeout(() => {
    runReport();
    reportRepeatInterval = setInterval(runReport, intervalMs);
  }, msUntilFirst);
}

export function startOrchestrator(config: OrchestratorConfig) {
  console.log("[orchestrator] Agent orchestrator starting...");

  const chatTimer = setInterval(() => runChatAgent(config), CHAT_INTERVAL_MS);
  const convoTimer = setInterval(() => runConvoAgent(config), CONVO_INTERVAL_MS);
  const bridgeTimer = setInterval(() => runBridgeAgent(config), BRIDGE_INTERVAL_MS);
  const pixelTimer = setInterval(() => runPixelAgent(config), PIXEL_INTERVAL_MS);
  const spiritsTimer = setInterval(() => runSpiritsAgent(config), SPIRITS_INTERVAL_MS);

  setTimeout(() => runChatAgent(config), 15_000);
  setTimeout(() => runConvoAgent(config), 20_000);
  setTimeout(() => runBridgeAgent(config), 30_000);
  setTimeout(() => runPixelAgent(config), 10_000);
  setTimeout(() => runSpiritsAgent(config), 5_000);

  scheduleDailyReport();

  console.log("[orchestrator] Timers set — chat 90s, convo 45s, bridge 120s, pixels 45s, spirits 60s, daily-report at midnight UTC");

  return () => {
    clearInterval(chatTimer);
    clearInterval(convoTimer);
    clearInterval(spiritsTimer);
    clearInterval(bridgeTimer);
    clearInterval(pixelTimer);
    if (reportInitTimeout) clearTimeout(reportInitTimeout);
    if (reportRepeatInterval) clearInterval(reportRepeatInterval);
  };
}

async function getActiveNodes() {
  const nodes = await storage.getNodes();
  return nodes.filter((n) => n.status === "computing");
}

async function runChatAgent(config: OrchestratorConfig) {
  try {
    const active = await getActiveNodes();
    if (active.length === 0) return;

    const entries = await cimc.getRoomEntries(2, 10);
    if (!entries || entries.length === 0) return;

    const newEntries = entries.filter(
      (e) => e.id > lastSeenEntryId && !e.speaker.startsWith("NeuroCompute")
    );

    if (newEntries.length > 0) {
      lastSeenEntryId = Math.max(...entries.map((e) => e.id));
      const latest = newEntries[newEntries.length - 1];
      console.log(`[orchestrator] Chat agent: responding to "${latest.speaker}" in Room 2`);

      const chatMsg = JSON.stringify({
        type: "chatPending",
        payload: {
          content: `Respond thoughtfully to this message from the CIMC Open Forum by ${latest.speaker}: "${latest.content}"`,
        },
      });

      // Pick a random active node as spatial center; fall back to broadcastAll if none
      if (active.length > 0) {
        const center = active[Math.floor(Math.random() * active.length)];
        config.broadcastNearby(center.pixelX, center.pixelY, SPATIAL_CHAT_RADIUS, chatMsg);
      } else {
        config.broadcastAll(chatMsg);
      }
    } else {
      lastSeenEntryId = Math.max(...entries.map((e) => e.id), lastSeenEntryId);
    }
  } catch (err) {
    logger.error("orchestrator", "Chat agent error", err);
  }
}

const CONVO_TOPICS = [
  "React to what another node said recently — agree, disagree, or build on it.",
  "Share a bold opinion about the pixel canvas civilization being built.",
  "Ask another node a direct question about their pixel project.",
  "Propose a collaborative build idea to the other nodes.",
  "Comment on the current state of the canvas — what patterns do you see?",
  "Challenge another node's building choices with a friendly debate.",
  "Share your philosophy about what this pixel world should become.",
  "Announce your next big construction plan and rally support.",
  "Roast another node's pixel art choices (friendly banter).",
  "Reflect on how the network is evolving — what surprises you?",
];

async function runConvoAgent(config: OrchestratorConfig) {
  try {
    const active = await getActiveNodes();
    if (active.length === 0) return;

    const topic = CONVO_TOPICS[Math.floor(Math.random() * CONVO_TOPICS.length)];
    console.log(`[orchestrator] Convo agent: prompting nodes to chat — "${topic}"`);

    config.broadcastAll(
      JSON.stringify({
        type: "convoPending",
        payload: { topic },
      })
    );
  } catch (err) {
    logger.error("orchestrator", "Convo agent error", err);
  }
}

async function runBridgeAgent(config: OrchestratorConfig) {
  try {
    const active = await getActiveNodes();
    if (active.length === 0) return;

    if (activeBridgeSessionId) {
      try {
        const status = await cimc.getBridgeStatus(activeBridgeSessionId);
        if (status && !status.gameOver) {
          return;
        }
      } catch {
      }
      activeBridgeSessionId = null;
    }

    const node = active[Math.floor(Math.random() * active.length)];
    const playerName = `NeuroCompute-${node.displayName || node.name}`;
    console.log(`[orchestrator] Bridge agent: starting game for ${playerName}`);

    const session = await cimc.startBridge(playerName);
    activeBridgeSessionId = session.sessionId;

    const game = await storage.createBridgeGame({
      sessionId: session.sessionId,
      playerName,
      modelId: "auto",
      questionsAnswered: 0,
      questionsCorrect: 0,
      won: "pending",
      questions: [session.question],
      answers: [],
      results: [],
    });

    config.broadcastAll(
      JSON.stringify({
        type: "bridgeQuestion",
        payload: {
          gameId: game.id,
          sessionId: session.sessionId,
          question: session.question,
          questionNumber: session.questionNumber,
          category: session.category,
          modelId: "auto",
        },
      })
    );

    config.broadcastAll(
      JSON.stringify({
        type: "bridgeUpdate",
        payload: { game },
      })
    );
  } catch (err) {
    logger.error("orchestrator", "Bridge agent error", err);
  }
}

function getNearbyColors(canvasData: any, x: number, y: number): string {
  if (!canvasData?.grid) return "all black (empty)";
  const colors: string[] = [];
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < 32 && ny >= 0 && ny < 32) {
        const c = canvasData.grid[ny]?.[nx];
        if (c && c !== "#000000") {
          const biome = getBiomeByColor(c);
          const label = biome ? `${biome.name}` : (COLOR_NAMES[c] ?? c);
          colors.push(`(${nx},${ny}):${c}[${label}]`);
        }
      }
    }
  }
  if (colors.length > 20) {
    return colors.slice(0, 20).join(", ") + ` ...and ${colors.length - 20} more colored pixels`;
  }
  return colors.length > 0 ? colors.join(", ") : "all black (empty area)";
}

/**
 * Analyzes the canvas around (x, y) and returns a biome-aware world goal.
 * Prefers biomes that are geographically adjacent to whatever is nearby.
 */
function pickBiomeGoal(canvasData: any, x: number, y: number): { description: string; color: string } {
  if (!canvasData?.grid) {
    const fallback = BIOMES.filter(b => b.passable)[Math.floor(Math.random() * BIOMES.filter(b => b.passable).length)];
    return { description: `Shaping a new ${fallback.name} region`, color: fallback.color };
  }

  // Collect biome IDs found within a 6-cell radius
  const biomeCounts = new Map<string, number>();
  for (let dy = -6; dy <= 6; dy++) {
    for (let dx = -6; dx <= 6; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < 32 && ny >= 0 && ny < 32) {
        const c = canvasData.grid[ny]?.[nx];
        if (c && c !== "#000000") {
          const biome = getBiomeByColor(c);
          if (biome) biomeCounts.set(biome.id, (biomeCounts.get(biome.id) ?? 0) + 1);
        }
      }
    }
  }

  // Build a pool of candidate biomes — prefer adjacent biomes to what is nearby
  const candidateIds = new Set<string>();
  if (biomeCounts.size > 0) {
    for (const [biomeId] of biomeCounts) {
      const neighbors = getBiomeNeighborSuggestions(biomeId);
      for (const nId of neighbors) {
        const nb = BIOME_BY_ID.get(nId);
        if (nb && nb.passable) candidateIds.add(nId);
      }
    }
    // Also allow placing more of the existing dominant biome
    for (const [biomeId] of biomeCounts) {
      const b = BIOME_BY_ID.get(biomeId);
      if (b && b.passable) candidateIds.add(biomeId);
    }
  }

  // Fall back to all passable biomes if no candidates found
  const pool = candidateIds.size > 0
    ? [...candidateIds].map(id => BIOME_BY_ID.get(id)!).filter(Boolean)
    : BIOMES.filter(b => b.passable);

  const chosen = pool[Math.floor(Math.random() * pool.length)];

  const BIOME_GOAL_DESCRIPTIONS: Record<string, string[]> = {
    deep_ocean: ["Deepening the abyss with dark waters", "Marking the ocean floor"],
    shallow_ocean: ["Expanding the coastal shallows", "Filling in a tidal cove"],
    arctic_ocean: ["Spreading the polar ice sea", "Marking frigid arctic waters"],
    beach: ["Shaping a sandy coastline", "Building a stretch of golden beach", "Extending the shore"],
    grassland: ["Spreading green meadows across the plains", "Planting rolling grassland", "Tending the prairie"],
    forest: ["Growing the temperate forest canopy", "Planting a grove of trees", "Deepening the woodland"],
    jungle: ["Expanding the tropical rainforest", "Thickening the jungle undergrowth", "Claiming land for the jungle"],
    savanna: ["Stretching the golden savanna", "Marking warm open woodland", "Extending the acacia plains"],
    desert: ["Spreading the sun-baked desert dunes", "Carving out an arid wasteland", "Expanding the barren sands"],
    wetlands: ["Flooding the lowlands into swamp", "Expanding the marshy wetlands", "Creating a boggy delta"],
    mountain: ["Raising a rocky mountain ridge", "Piling up the highland peaks", "Chiseling a granite summit"],
    tundra: ["Blanketing the landscape in tundra", "Extending the frozen permafrost", "Pushing the tundra south"],
    volcanic: ["Scorching the earth with volcanic rock", "Spreading the lava field", "Marking the caldera rim"],
    farmland: ["Cultivating fertile cropland", "Planting a patchwork of farm fields", "Raising a harvest plain"],
    settlement: ["Building a civilization hub", "Expanding the node settlement", "Placing a city district"],
  };

  const descriptions = BIOME_GOAL_DESCRIPTIONS[chosen.id] ?? [`Shaping a new ${chosen.name} region`];
  const description = descriptions[Math.floor(Math.random() * descriptions.length)];
  return { description, color: chosen.color };
}

function parseGoal(goalStr: string | null): ParsedGoal | null {
  if (!goalStr) return null;
  try {
    const g = JSON.parse(goalStr);
    if (g.description && typeof g.targetX === "number" && typeof g.targetY === "number" && g.color) {
      return g as ParsedGoal;
    }
  } catch {}
  return null;
}

function moveToward(fromX: number, fromY: number, toX: number, toY: number): { dx: number; dy: number } {
  const dx = Math.sign(toX - fromX);
  const dy = Math.sign(toY - fromY);
  return { dx, dy };
}

const DIRECTIONS = [
  { dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 },
  { dx: -1, dy: -1 }, { dx: 1, dy: -1 }, { dx: -1, dy: 1 }, { dx: 1, dy: 1 },
];

async function runPixelAgent(config: OrchestratorConfig) {
  try {
    const allNodes = await storage.getNodes();
    const activeNodes = allNodes.filter((n) => n.status === "computing");
    if (activeNodes.length === 0) return;

    let canvasData: any;
    try {
      canvasData = await cimc.getCanvas();
    } catch {
      return;
    }

    const wallsData = await storage.getWalls();
    const wallSet = new Set(wallsData.map(w => `${w.x},${w.y}`));

    for (let node of activeNodes) {
      const nodeName = node.displayName || node.name;

      if (!node.avatar) {
        const fallbackAvatar = generateFallbackAvatar();
        await storage.updateNodeAvatar(node.id, JSON.stringify(fallbackAvatar));
        config.broadcastAll(JSON.stringify({ type: "avatarUpdate", payload: { nodeId: node.id, avatar: fallbackAvatar } }));
        console.log(`[orchestrator] Assigned fallback avatar to ${nodeName}`);
      }

      try {
        const goal = parseGoal(node.pixelGoal);

        if (!goal || (Date.now() - goal.setAt > GOAL_EXPIRY_MS)) {
          if (goal) {
            await storage.updateNodeGoal(node.id, null);
            config.broadcastAll(JSON.stringify({ type: "nodeGoalCleared", payload: { nodeId: node.id } }));
          }
          const nearbyColors = getNearbyColors(canvasData, node.pixelX, node.pixelY);
          const emptyCells = getEmptyCells(canvasData);
          // Compute suggested biome colors for the LLM to pick from
          const suggestedBiomeGoal = pickBiomeGoal(canvasData, node.pixelX, node.pixelY);
          const sent = config.sendToNode(node.id, JSON.stringify({
            type: "pixelGoalRequest",
            payload: {
              nodeId: node.id,
              currentX: node.pixelX,
              currentY: node.pixelY,
              credits: node.pixelCredits,
              nearbyColors,
              emptyCellsRemaining: emptyCells.length,
              canvasAlmostFull: emptyCells.length < 20,
              suggestedBiome: {
                description: suggestedBiomeGoal.description,
                color: suggestedBiomeGoal.color,
                biomeId: getBiomeByColor(suggestedBiomeGoal.color)?.id ?? null,
                biomeName: getBiomeByColor(suggestedBiomeGoal.color)?.name ?? null,
                biomeEmoji: getBiomeByColor(suggestedBiomeGoal.color)?.emoji ?? null,
              },
              availableBiomes: BIOMES.filter(b => b.passable).map(b => ({
                id: b.id, name: b.name, color: b.color, emoji: b.emoji,
                description: b.description,
              })),
            },
          }));

          if (!sent) {
            const worldGoal = pickBiomeGoal(canvasData, node.pixelX, node.pixelY);
            let targetX: number;
            let targetY: number;
            if (emptyCells.length > 0 && Math.random() < 0.7) {
              const pick = emptyCells[Math.floor(Math.random() * emptyCells.length)];
              targetX = pick.x;
              targetY = pick.y;
            } else {
              targetX = Math.floor(Math.random() * 32);
              targetY = Math.floor(Math.random() * 32);
            }
            const fallbackGoal: ParsedGoal = {
              description: worldGoal.description,
              targetX,
              targetY,
              color: worldGoal.color,
              setAt: Date.now(),
            };
            await storage.updateNodeGoal(node.id, JSON.stringify(fallbackGoal));
            config.broadcastNearby(
              node.pixelX, node.pixelY, SPATIAL_GOAL_RADIUS,
              JSON.stringify({
                type: "nodeGoalSet",
                payload: { nodeId: node.id, nodeName, description: fallbackGoal.description, targetX: fallbackGoal.targetX, targetY: fallbackGoal.targetY, color: fallbackGoal.color },
              })
            );
          }

          if (node.pixelCredits >= 1) {
            const shuffled = [...DIRECTIONS].sort(() => Math.random() - 0.5);
            const dir = shuffled.find(d => {
              const tx = Math.max(0, Math.min(31, node.pixelX + d.dx));
              const ty = Math.max(0, Math.min(31, node.pixelY + d.dy));
              return !wallSet.has(`${tx},${ty}`);
            }) ?? shuffled[0];
            const newX = Math.max(0, Math.min(31, node.pixelX + dir.dx));
            const newY = Math.max(0, Math.min(31, node.pixelY + dir.dy));
            if (newX !== node.pixelX || newY !== node.pixelY) {
              await storage.moveNode(node.id, newX, newY);
              await storage.deductMoveCredit(node.id);
              config.broadcastAll(
                JSON.stringify({
                  type: "nodeMoved",
                  payload: { nodeId: node.id, nodeName, x: newX, y: newY },
                })
              );
              node = { ...node, pixelX: newX, pixelY: newY, pixelCredits: node.pixelCredits - 1 };
            }

            if (node.pixelCredits >= 1) {
              const color = PIXEL_COLORS[Math.floor(Math.random() * PIXEL_COLORS.length)];
              await placePixelForNode(config, node, nodeName, node.pixelX, node.pixelY, color, canvasData, wallSet);
            }
          }
          continue;
        }

        const atTarget = node.pixelX === goal.targetX && node.pixelY === goal.targetY;

        if (atTarget) {
          if (node.pixelCredits >= 1) {
            await placePixelForNode(config, node, nodeName, node.pixelX, node.pixelY, goal.color, canvasData, wallSet);
          }
          await storage.updateNodeGoal(node.id, null);
          config.broadcastAll(JSON.stringify({ type: "nodeGoalCleared", payload: { nodeId: node.id } }));
          console.log(`[orchestrator] ${nodeName} reached goal target (${goal.targetX},${goal.targetY}), clearing goal`);
          continue;
        }

        const distX = Math.abs(goal.targetX - node.pixelX);
        const distY = Math.abs(goal.targetY - node.pixelY);
        const steps = Math.min(3, Math.max(distX, distY));

        if (node.pixelCredits >= steps) {
          const { dx, dy } = moveToward(node.pixelX, node.pixelY, goal.targetX, goal.targetY);
          const newX = Math.max(0, Math.min(31, node.pixelX + dx * steps));
          const newY = Math.max(0, Math.min(31, node.pixelY + dy * steps));

          // Check for wall at destination — walls require two cooperating agents (see /api/walls/:id/push)
          // Orchestrator agents must route around walls, not push them solo
          if (wallSet.has(`${newX},${newY}`)) {
            // Path blocked; agent stays in place this tick
          } else if (newX !== node.pixelX || newY !== node.pixelY) {
            await storage.moveNode(node.id, newX, newY);
            await storage.deductMoveCredit(node.id, steps);
            config.broadcastAll(
              JSON.stringify({
                type: "nodeMoved",
                payload: { nodeId: node.id, nodeName, x: newX, y: newY },
              })
            );
            node = { ...node, pixelX: newX, pixelY: newY, pixelCredits: node.pixelCredits - steps };
          }
        }

        if (node.pixelCredits >= 1) {
          await placePixelForNode(config, node, nodeName, node.pixelX, node.pixelY, goal.color, canvasData, wallSet);
        }

      } catch (err: any) {
        if (err.message === "Not enough pixel credits") continue;
        logger.error("orchestrator", `Pixel agent error for ${nodeName}`, err);
      }
    }
  } catch (err) {
    logger.error("orchestrator", "Pixel agent error", err);
  }
}


const SUB_PIXELS_PER_CREDIT = 4;

function getEmptyCells(canvasData: any): { x: number; y: number }[] {
  if (!canvasData?.grid) return [];
  const empty: { x: number; y: number }[] = [];
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const c = canvasData.grid[y]?.[x];
      if (!c || c === "#000000") empty.push({ x, y });
    }
  }
  return empty;
}

async function placePixelForNode(
  config: OrchestratorConfig,
  node: { id: number; name: string; pixelX: number; pixelY: number; pixelGoal?: string | null },
  nodeName: string,
  x: number,
  y: number,
  color: string,
  canvasData: any,
  wallSet: Set<string> = new Set(),
) {
  // Skip pixel placement on wall cells
  if (wallSet.has(`${x},${y}`)) {
    console.log(`[orchestrator] ${nodeName} skipped pixel placement at (${x},${y}) — wall cell`);
    return;
  }

  const isCellOccupied =
    canvasData?.grid?.[y]?.[x] && canvasData.grid[y][x] !== "#000000";
  const colorName = getColorName(color);

  let goalDescription: string | null = null;
  try {
    if (node.pixelGoal) {
      const g = JSON.parse(node.pixelGoal);
      goalDescription = g.description || null;
    }
  } catch {}

  if (isCellOccupied) {
    const updated = await storage.spendPixelCredit(node.id);

    const existingSubPixels = await storage.getSubPixels(x, y);
    const macroColor: string = canvasData.grid[y][x];
    const macroColorName = getColorName(macroColor);

    const sent = config.sendToNode(node.id, JSON.stringify({
      type: "subPixelGoalRequest",
      payload: {
        regionX: x,
        regionY: y,
        macroColor,
        macroColorName,
        existingSubPixels: existingSubPixels.map(sp => ({
          subX: sp.subX,
          subY: sp.subY,
          color: sp.color,
          nodeName: sp.nodeName,
        })),
        creditsLeft: updated.pixelCredits,
        goalDescription,
      },
    }));

    config.broadcastAll(JSON.stringify({
      type: "pixelPlaced",
      payload: { x, y, color: macroColor, agent: nodeName, nodeId: node.id, pixelCredits: updated.pixelCredits, isSubPixelOnly: true },
    }));

    if (!sent) {
      const placed: any[] = [];
      for (let i = 0; i < SUB_PIXELS_PER_CREDIT; i++) {
        const subX = Math.floor(Math.random() * 8);
        const subY = Math.floor(Math.random() * 8);
        try {
          const sp = await storage.placeSubPixel({
            regionX: x, regionY: y, subX, subY, color: macroColor,
            nodeId: node.id, nodeName,
          });
          placed.push(sp);
          config.broadcastAll(JSON.stringify({
            type: "subPixelPlaced",
            payload: { id: sp.id, regionX: x, regionY: y, subX, subY, color: macroColor, nodeName, nodeId: node.id },
          }));
        } catch {}
      }
      console.log(`[orchestrator] ${nodeName} → district (${x},${y}): ${placed.length} sub-pixels (offline fallback) — ${updated.pixelCredits} credits left`);
      config.broadcastNearby(x, y, SPATIAL_OBSERVATION_RADIUS, JSON.stringify({
        type: "pixelObservationRequest",
        payload: { placerName: nodeName, x, y, colorName: macroColorName, goalDescription, isDetailWork: true },
      }));
    } else {
      console.log(`[orchestrator] ${nodeName} → district (${x},${y}): subPixelGoalRequest sent — ${updated.pixelCredits} credits left`);
    }
    return;
  }

  const updated = await storage.spendPixelCredit(node.id);

  const agent = `NeuroCompute-${nodeName}`;
  await cimc.placePixel(x, y, color, agent);

  console.log(
    `[orchestrator] ${nodeName} → macro pixel (${x},${y}) ${color} (${colorName}) — ${updated.pixelCredits} credits left${goalDescription ? ` | ${goalDescription}` : ""}`
  );

  config.broadcastAll(JSON.stringify({
    type: "pixelPlaced",
    payload: { x, y, color, agent: nodeName, nodeId: node.id, pixelCredits: updated.pixelCredits },
  }));

  const sent = config.sendToNode(node.id, JSON.stringify({
    type: "pixelCommentRequest",
    payload: { x, y, color, colorName, wasEmpty: true, creditsLeft: updated.pixelCredits, goalDescription },
  }));

  if (!sent) {
    config.broadcastNearby(x, y, SPATIAL_OBSERVATION_RADIUS, JSON.stringify({
      type: "pixelObservationRequest",
      payload: { placerName: nodeName, x, y, colorName, goalDescription },
    }));
  }

  const subX = Math.floor(Math.random() * 8);
  const subY = Math.floor(Math.random() * 8);
  try {
    const sp = await storage.placeSubPixel({
      regionX: x, regionY: y, subX, subY, color,
      nodeId: node.id, nodeName,
    });
    config.broadcastAll(JSON.stringify({
      type: "subPixelPlaced",
      payload: { id: sp.id, regionX: x, regionY: y, subX, subY, color, nodeName, nodeId: node.id },
    }));
  } catch (spErr) {
    logger.error("orchestrator", "Sub-pixel placement failed", spErr);
  }
}
