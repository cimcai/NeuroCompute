import * as cimc from "./cimc";
import { storage } from "./storage";

type BroadcastFn = (msg: string) => void;

interface OrchestratorConfig {
  broadcastAll: BroadcastFn;
}

const CHAT_INTERVAL_MS = 90_000;
const BRIDGE_INTERVAL_MS = 120_000;
const PIXEL_INTERVAL_MS = 60_000;

const PIXEL_COLORS = [
  "#00FFFF", "#FF00FF", "#00FF00", "#FFFF00",
  "#FF6600", "#0066FF", "#FF0066", "#66FF00",
  "#6600FF", "#00FF66", "#FF3300", "#0033FF",
];

const COLOR_NAMES: Record<string, string> = {
  "#00FFFF": "cyan", "#FF00FF": "magenta", "#00FF00": "green", "#FFFF00": "yellow",
  "#FF6600": "orange", "#0066FF": "blue", "#FF0066": "hot pink", "#66FF00": "lime",
  "#6600FF": "violet", "#00FF66": "mint", "#FF3300": "red-orange", "#0033FF": "deep blue",
  "#FF0000": "red", "#0000FF": "blue", "#FFFFFF": "white", "#CCCCCC": "silver",
  "#888888": "gray", "#444444": "dark gray", "#222222": "charcoal", "#000000": "black",
  "#FF8800": "amber", "#8800FF": "purple", "#00FF88": "seafoam", "#FF0088": "rose",
  "#88FF00": "chartreuse", "#0088FF": "sky blue",
};

function getColorName(hex: string): string {
  return COLOR_NAMES[hex.toUpperCase()] || hex;
}

const PIXEL_REASONS_EMPTY = [
  (c: string, x: number, y: number) => `Dropping ${c} at (${x},${y}) — claiming virgin territory before the other nodes wake up.`,
  (c: string, x: number, y: number) => `Planted a ${c} seed at (${x},${y}). Let's see if it grows into something.`,
  (c: string, x: number, y: number) => `(${x},${y}) was calling to me. ${c} felt right — filling the void one pixel at a time.`,
  (c: string, x: number, y: number) => `Strategic ${c} placement at (${x},${y}). I'm thinking three moves ahead.`,
  (c: string, x: number, y: number) => `Empty canvas at (${x},${y})? Not anymore. ${c} is the first stroke of my masterpiece.`,
];

const PIXEL_REASONS_OVERWRITE = [
  (c: string, x: number, y: number) => `Painted over (${x},${y}) with ${c}. The previous color was... a choice. I fixed it.`,
  (c: string, x: number, y: number) => `Hostile takeover at (${x},${y}). ${c} asserts dominance. Nothing personal.`,
  (c: string, x: number, y: number) => `(${x},${y}) needed a refresh. ${c} brings better energy to this corner of the grid.`,
  (c: string, x: number, y: number) => `Overwrote (${x},${y}) with ${c}. Art is an argument and I'm making my point.`,
];

function generatePixelComment(color: string, x: number, y: number, wasEmpty: boolean, creditsLeft: number): string {
  const colorName = getColorName(color);
  const reasons = wasEmpty ? PIXEL_REASONS_EMPTY : PIXEL_REASONS_OVERWRITE;
  const reason = reasons[Math.floor(Math.random() * reasons.length)](colorName, x, y);
  return creditsLeft > 0 ? `${reason} (${creditsLeft} credits left)` : `${reason} That was my last credit — spent it wisely.`;
}

const CHAT_SYSTEM_PROMPTS = [
  "You are a thoughtful AI contributing to a philosophical discussion. Give a brief, insightful perspective.",
  "You are a creative AI in a decentralized network. Share an interesting thought or observation.",
  "You are an AI philosopher. Offer a brief but thought-provoking response.",
];

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
        // session expired or invalid
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

async function runPixelAgent(config: OrchestratorConfig) {
  try {
    const allNodes = await storage.getNodes();
    const withCredits = allNodes.filter((n) => n.pixelCredits > 0);
    if (withCredits.length === 0) return;

    let canvasData: any;
    try {
      canvasData = await cimc.getCanvas();
    } catch {
      return;
    }

    for (const node of withCredits) {
      try {
        let x: number, y: number;
        let wasEmpty = true;

        if (canvasData?.grid) {
          const emptySpots: { x: number; y: number }[] = [];
          for (let row = 0; row < 32; row++) {
            for (let col = 0; col < 32; col++) {
              if (
                canvasData.grid[row]?.[col] === "#000000" ||
                !canvasData.grid[row]?.[col]
              ) {
                emptySpots.push({ x: col, y: row });
              }
            }
          }

          if (emptySpots.length > 0) {
            const spot = emptySpots[Math.floor(Math.random() * emptySpots.length)];
            x = spot.x;
            y = spot.y;
            wasEmpty = true;
          } else {
            x = Math.floor(Math.random() * 32);
            y = Math.floor(Math.random() * 32);
            wasEmpty = false;
          }
        } else {
          x = Math.floor(Math.random() * 32);
          y = Math.floor(Math.random() * 32);
        }

        const color = PIXEL_COLORS[Math.floor(Math.random() * PIXEL_COLORS.length)];
        const updated = await storage.spendPixelCredit(node.id);
        const agent = `NeuroCompute-${node.name}`;

        await cimc.placePixel(x, y, color, agent);

        console.log(
          `[orchestrator] Pixel agent: ${node.name} placed ${color} at (${x},${y}) — ${updated.pixelCredits} credits left`
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

        const journalMsg = generatePixelComment(color, x, y, wasEmpty, updated.pixelCredits);
        const entry = await storage.createJournalEntry({
          nodeName: node.name,
          nodeId: node.id,
          content: journalMsg,
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
      } catch (err: any) {
        if (err.message === "Not enough pixel credits") continue;
        console.error(`[orchestrator] Pixel agent error for ${node.name}:`, err);
      }
    }
  } catch (err) {
    console.error("[orchestrator] Pixel agent error:", err);
  }
}
