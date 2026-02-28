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
          } else {
            x = Math.floor(Math.random() * 32);
            y = Math.floor(Math.random() * 32);
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

        const journalMsg = `Placed a ${color} pixel at (${x}, ${y}) on the canvas. ${updated.pixelCredits} credits remaining.`;
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
