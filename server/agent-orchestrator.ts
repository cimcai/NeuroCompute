import * as cimc from "./cimc";
import { storage } from "./storage";
import { logger } from "./logger";
import { runDailyReport, getIntervalMs, getReportFrequency } from "./analytics";

type BroadcastFn = (msg: string) => void;
type SendToNodeFn = (nodeId: number, msg: string) => boolean;

interface OrchestratorConfig {
  broadcastAll: BroadcastFn;
  sendToNode: SendToNodeFn;
}

const CHAT_INTERVAL_MS = 90_000;
const CONVO_INTERVAL_MS = 45_000;
const BRIDGE_INTERVAL_MS = 120_000;
const PIXEL_INTERVAL_MS = 45_000;
const GOAL_EXPIRY_MS = 10 * 60 * 1000;

const PIXEL_COLORS = [
  "#7AADAD", "#A98EC4", "#8FAF8A", "#C4A882",
  "#7B9AB5", "#C4785A", "#9DB87A", "#C4A84E",
  "#8090A0", "#B58A7A", "#7A9EC4", "#C49A7A",
];

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

      config.broadcastAll(
        JSON.stringify({
          type: "chatPending",
          payload: {
            content: `Respond thoughtfully to this message from the CIMC Open Forum by ${latest.speaker}: "${latest.content}"`,
          },
        })
      );
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
          colors.push(`(${nx},${ny}):${c}`);
        }
      }
    }
  }
  if (colors.length > 20) {
    return colors.slice(0, 20).join(", ") + ` ...and ${colors.length - 20} more colored pixels`;
  }
  return colors.length > 0 ? colors.join(", ") : "all black (empty area)";
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

    for (const node of activeNodes) {
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
            },
          }));

          if (!sent) {
            const WORLD_GOALS = [
              { description: "Claiming an empty patch of land", color: "#8FAF8A" },
              { description: "Building a small wooden house", color: "#8B4513" },
              { description: "Planting a green tree", color: "#228B22" },
              { description: "Laying a stone road", color: "#808080" },
              { description: "Digging a blue river", color: "#4169E1" },
              { description: "Constructing a red-roofed cottage", color: "#CC0000" },
              { description: "Growing a flower garden", color: "#FF69B4" },
              { description: "Building a castle tower", color: "#696969" },
              { description: "Painting a golden sun", color: "#FFD700" },
              { description: "Adding stars to the sky", color: "#FFFFFF" },
              { description: "Adding fine district detail", color: "#7AADAD" },
              { description: "Decorating a district with texture", color: "#A98EC4" },
              { description: "Building a wooden fence", color: "#DEB887" },
              { description: "Creating a mountain peak", color: "#A9A9A9" },
              { description: "Planting crops in a field", color: "#9ACD32" },
              { description: "Adding windows to a building", color: "#87CEEB" },
            ];
            const worldGoal = WORLD_GOALS[Math.floor(Math.random() * WORLD_GOALS.length)];
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
            config.broadcastAll(
              JSON.stringify({
                type: "nodeGoalSet",
                payload: { nodeId: node.id, nodeName, description: fallbackGoal.description, targetX: fallbackGoal.targetX, targetY: fallbackGoal.targetY, color: fallbackGoal.color },
              })
            );
          }

          const dir = DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];
          const newX = Math.max(0, Math.min(31, node.pixelX + dir.dx));
          const newY = Math.max(0, Math.min(31, node.pixelY + dir.dy));
          if (newX !== node.pixelX || newY !== node.pixelY) {
            await storage.moveNode(node.id, newX, newY);
            config.broadcastAll(
              JSON.stringify({
                type: "nodeMoved",
                payload: { nodeId: node.id, nodeName, x: newX, y: newY },
              })
            );
          }

          if (node.pixelCredits >= 1) {
            const color = PIXEL_COLORS[Math.floor(Math.random() * PIXEL_COLORS.length)];
            await placePixelForNode(config, node, nodeName, newX, newY, color, canvasData);
          }
          continue;
        }

        const atTarget = node.pixelX === goal.targetX && node.pixelY === goal.targetY;

        if (atTarget) {
          if (node.pixelCredits >= 1) {
            await placePixelForNode(config, node, nodeName, node.pixelX, node.pixelY, goal.color, canvasData);
          }
          await storage.updateNodeGoal(node.id, null);
          config.broadcastAll(JSON.stringify({ type: "nodeGoalCleared", payload: { nodeId: node.id } }));
          console.log(`[orchestrator] ${nodeName} reached goal target (${goal.targetX},${goal.targetY}), clearing goal`);
          continue;
        }

        const distX = Math.abs(goal.targetX - node.pixelX);
        const distY = Math.abs(goal.targetY - node.pixelY);
        const steps = Math.min(3, Math.max(distX, distY));
        const { dx, dy } = moveToward(node.pixelX, node.pixelY, goal.targetX, goal.targetY);
        const newX = Math.max(0, Math.min(31, node.pixelX + dx * steps));
        const newY = Math.max(0, Math.min(31, node.pixelY + dy * steps));

        if (newX !== node.pixelX || newY !== node.pixelY) {
          await storage.moveNode(node.id, newX, newY);
          config.broadcastAll(
            JSON.stringify({
              type: "nodeMoved",
              payload: { nodeId: node.id, nodeName, x: newX, y: newY },
            })
          );
        }

        if (node.pixelCredits >= 1) {
          await placePixelForNode(config, node, nodeName, newX, newY, goal.color, canvasData);
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
) {
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

  const updated = await storage.spendPixelCredit(node.id);

  if (isCellOccupied) {
    const placed: any[] = [];
    for (let i = 0; i < SUB_PIXELS_PER_CREDIT; i++) {
      const subX = Math.floor(Math.random() * 8);
      const subY = Math.floor(Math.random() * 8);
      try {
        const sp = await storage.placeSubPixel({
          regionX: x, regionY: y, subX, subY, color,
          nodeId: node.id, nodeName,
        });
        placed.push(sp);
        config.broadcastAll(JSON.stringify({
          type: "subPixelPlaced",
          payload: { id: sp.id, regionX: x, regionY: y, subX, subY, color, nodeName, nodeId: node.id },
        }));
      } catch {}
    }

    console.log(
      `[orchestrator] ${nodeName} → district detail (${x},${y}): ${placed.length} sub-pixels placed — ${updated.pixelCredits} credits left`
    );

    config.broadcastAll(JSON.stringify({
      type: "pixelPlaced",
      payload: { x, y, color, agent: nodeName, nodeId: node.id, pixelCredits: updated.pixelCredits, isSubPixelOnly: true },
    }));

    const sent = config.sendToNode(node.id, JSON.stringify({
      type: "pixelCommentRequest",
      payload: { x, y, color, colorName, wasEmpty: false, creditsLeft: updated.pixelCredits, goalDescription, isDetailWork: true },
    }));

    if (!sent) {
      config.broadcastAll(JSON.stringify({
        type: "pixelObservationRequest",
        payload: { placerName: nodeName, x, y, colorName, goalDescription, isDetailWork: true },
      }));
    }
    return;
  }

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
    config.broadcastAll(JSON.stringify({
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
