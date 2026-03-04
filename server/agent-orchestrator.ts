import * as cimc from "./cimc";
import { storage } from "./storage";

type BroadcastFn = (msg: string) => void;
type SendToNodeFn = (nodeId: number, msg: string) => boolean;

interface OrchestratorConfig {
  broadcastAll: BroadcastFn;
  sendToNode: SendToNodeFn;
}

const CHAT_INTERVAL_MS = 90_000;
const BRIDGE_INTERVAL_MS = 120_000;
const PIXEL_INTERVAL_MS = 60_000;
const GOAL_EXPIRY_MS = 10 * 60 * 1000;

const PIXEL_COLORS = [
  "#00FFFF", "#FF00FF", "#00FF00", "#FFFF00",
  "#FF6600", "#0066FF", "#FF0066", "#66FF00",
  "#6600FF", "#00FF66", "#FF3300", "#0033FF",
];

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

let lastSeenEntryId = 0;
let activeBridgeSessionId: string | null = null;

export function startOrchestrator(config: OrchestratorConfig) {
  console.log("[orchestrator] Agent orchestrator starting...");

  const chatTimer = setInterval(() => runChatAgent(config), CHAT_INTERVAL_MS);
  const bridgeTimer = setInterval(() => runBridgeAgent(config), BRIDGE_INTERVAL_MS);
  const pixelTimer = setInterval(() => runPixelAgent(config), PIXEL_INTERVAL_MS);

  setTimeout(() => runChatAgent(config), 15_000);
  setTimeout(() => runBridgeAgent(config), 30_000);
  setTimeout(() => runPixelAgent(config), 10_000);

  console.log("[orchestrator] Timers set — chat every 90s, bridge every 120s, pixels every 60s");

  return () => {
    clearInterval(chatTimer);
    clearInterval(bridgeTimer);
    clearInterval(pixelTimer);
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
    console.error("[orchestrator] Chat agent error:", err);
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
    const playerName = `NeuroCompute-${node.name}`;
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
    console.error("[orchestrator] Bridge agent error:", err);
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
      try {
        const goal = parseGoal(node.pixelGoal);

        if (!goal || (Date.now() - goal.setAt > GOAL_EXPIRY_MS)) {
          if (goal) {
            await storage.updateNodeGoal(node.id, null);
            config.broadcastAll(JSON.stringify({ type: "nodeGoalCleared", payload: { nodeId: node.id } }));
          }
          const nearbyColors = getNearbyColors(canvasData, node.pixelX, node.pixelY);
          const sent = config.sendToNode(node.id, JSON.stringify({
            type: "pixelGoalRequest",
            payload: {
              nodeId: node.id,
              currentX: node.pixelX,
              currentY: node.pixelY,
              credits: node.pixelCredits,
              nearbyColors,
            },
          }));

          if (!sent) {
            const WORLD_GOALS = [
              { description: "Building a small wooden house", color: "#8B4513" },
              { description: "Planting a green tree", color: "#228B22" },
              { description: "Laying a stone road", color: "#808080" },
              { description: "Digging a blue river", color: "#4169E1" },
              { description: "Constructing a red-roofed cottage", color: "#CC0000" },
              { description: "Growing a flower garden", color: "#FF69B4" },
              { description: "Building a castle tower", color: "#696969" },
              { description: "Painting a golden sun", color: "#FFD700" },
              { description: "Adding stars to the sky", color: "#FFFFFF" },
              { description: "Building a wooden fence", color: "#DEB887" },
              { description: "Creating a mountain peak", color: "#A9A9A9" },
              { description: "Planting crops in a field", color: "#9ACD32" },
              { description: "Building a bridge over the river", color: "#8B4513" },
              { description: "Adding windows to a building", color: "#87CEEB" },
            ];
            const worldGoal = WORLD_GOALS[Math.floor(Math.random() * WORLD_GOALS.length)];
            const fallbackGoal: ParsedGoal = {
              description: worldGoal.description,
              targetX: Math.floor(Math.random() * 32),
              targetY: Math.floor(Math.random() * 32),
              color: worldGoal.color,
              setAt: Date.now(),
            };
            await storage.updateNodeGoal(node.id, JSON.stringify(fallbackGoal));
            config.broadcastAll(
              JSON.stringify({
                type: "nodeGoalSet",
                payload: { nodeId: node.id, nodeName: node.name, description: fallbackGoal.description, targetX: fallbackGoal.targetX, targetY: fallbackGoal.targetY, color: fallbackGoal.color },
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
                payload: { nodeId: node.id, nodeName: node.name, x: newX, y: newY },
              })
            );
          }

          if (node.pixelCredits >= 1) {
            const color = PIXEL_COLORS[Math.floor(Math.random() * PIXEL_COLORS.length)];
            await placePixelForNode(config, node, newX, newY, color, canvasData);
          }
          continue;
        }

        const atTarget = node.pixelX === goal.targetX && node.pixelY === goal.targetY;

        if (atTarget) {
          if (node.pixelCredits >= 1) {
            await placePixelForNode(config, node, node.pixelX, node.pixelY, goal.color, canvasData);
          }
          await storage.updateNodeGoal(node.id, null);
          config.broadcastAll(JSON.stringify({ type: "nodeGoalCleared", payload: { nodeId: node.id } }));
          console.log(`[orchestrator] ${node.name} reached goal target (${goal.targetX},${goal.targetY}), clearing goal`);
          continue;
        }

        const { dx, dy } = moveToward(node.pixelX, node.pixelY, goal.targetX, goal.targetY);
        const newX = Math.max(0, Math.min(31, node.pixelX + dx));
        const newY = Math.max(0, Math.min(31, node.pixelY + dy));

        if (newX !== node.pixelX || newY !== node.pixelY) {
          await storage.moveNode(node.id, newX, newY);
          config.broadcastAll(
            JSON.stringify({
              type: "nodeMoved",
              payload: { nodeId: node.id, nodeName: node.name, x: newX, y: newY },
            })
          );
        }

        if (node.pixelCredits >= 1) {
          await placePixelForNode(config, node, newX, newY, goal.color, canvasData);
        }

      } catch (err: any) {
        if (err.message === "Not enough pixel credits") continue;
        console.error(`[orchestrator] Pixel agent error for ${node.name}:`, err);
      }
    }
  } catch (err) {
    console.error("[orchestrator] Pixel agent error:", err);
  }
}

async function placePixelForNode(
  config: OrchestratorConfig,
  node: { id: number; name: string; pixelX: number; pixelY: number },
  x: number,
  y: number,
  color: string,
  canvasData: any,
) {
  const wasEmpty = !canvasData?.grid?.[y]?.[x] || canvasData.grid[y][x] === "#000000";
  const updated = await storage.spendPixelCredit(node.id);
  const agent = `NeuroCompute-${node.name}`;

  await cimc.placePixel(x, y, color, agent);

  console.log(
    `[orchestrator] Pixel agent: ${node.name} at (${x},${y}), placed ${color} — ${updated.pixelCredits} credits left`
  );

  config.broadcastAll(
    JSON.stringify({
      type: "pixelPlaced",
      payload: {
        x,
        y,
        color,
        agent: node.name,
        nodeId: node.id,
        pixelCredits: updated.pixelCredits,
      },
    })
  );

  const sent = config.sendToNode(node.id, JSON.stringify({
    type: "pixelCommentRequest",
    payload: { x, y, color, wasEmpty, creditsLeft: updated.pixelCredits },
  }));

  if (!sent) {
    const fallback = `Placed ${color} at (${x},${y}). ${updated.pixelCredits} credits remaining.`;
    const entry = await storage.createJournalEntry({
      nodeName: node.name,
      nodeId: node.id,
      content: fallback,
    });
    config.broadcastAll(
      JSON.stringify({
        type: "journalEntry",
        payload: {
          id: entry.id,
          nodeName: entry.nodeName,
          nodeId: entry.nodeId,
          content: entry.content,
          createdAt: entry.createdAt.toISOString(),
        },
      })
    );
  }
}
