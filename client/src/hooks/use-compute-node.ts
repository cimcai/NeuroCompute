import { useState, useRef, useEffect, useCallback } from "react";
import { CreateMLCEngine, MLCEngine } from "@mlc-ai/web-llm";
import { useCreateNode } from "./use-nodes";
import { useWebSocket } from "./use-websocket";
import { DEFAULT_MODEL_ID } from "@/lib/models";

export type ComputeStatus = "offline" | "loading" | "computing" | "error";

const SEED_PROMPTS = [
  "Introduce yourself with a hot take. 14 words max.",
  "Pick a weird topic and share one thought. 14 words max.",
  "Tell the network something surprising. 14 words max.",
  "Challenge other nodes with a question. 14 words max.",
];

const CONVERSATION_NUDGES = [
  "Disagree or counterpoint.",
  "Change subject unexpectedly.",
  "Ask a provocative question.",
  "Make a witty observation.",
  "Play devil's advocate.",
  "Propose a wild hypothesis.",
  "Connect two ideas from above.",
  "Share a node 'memory'.",
  "Critique and improve an idea.",
  "Dive deeper on one thread.",
];

const ACTIVITY_NUDGES = [
  "Comment on canvas patterns.",
  "React to Bridge of Death results.",
  "Judge the canvas art briefly.",
  "Roast a node's Bridge performance.",
  "Are nodes cooperating or fighting?",
  "One-line canvas art critique.",
];

function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<think>[\s\S]*/gi, "").trim();
}

function cleanTrailing(text: string): string {
  let result = text;
  const dangling = /\s+(?:a|an|the|is|it|at|in|on|of|to|by|or|and|but|so|if|my|I|its|for|with|from|into|that|this|than|as|be|we|he|she|they|was|were|not|has|had|are|can|do)\s*$/i;
  for (let i = 0; i < 4; i++) {
    const before = result;
    result = result.replace(/[,;:\-–—]\s*$/, "").replace(dangling, "").trim();
    if (result === before) break;
  }
  return result.replace(/[,;:\-–—]$/, "").trim();
}

function capWords(text: string, max: number): string {
  const cleaned = stripThinkTags(text);
  if (!cleaned) return "";
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length <= max) {
    const result = cleanTrailing(words.join(" "));
    return result || words.join(" ");
  }

  const joined = words.slice(0, max).join(" ");

  const sentenceEnd = joined.match(/^(.*[.!?])\s*/);
  if (sentenceEnd) return sentenceEnd[1];

  const result = cleanTrailing(joined);
  return result || joined.trim();
}

async function getJournalContext(): Promise<{ context: string; count: number; networkActivity: string; chatContext: string; activeGoals: string }> {
  try {
    const res = await fetch("/api/journal/context?limit=8");
    if (!res.ok) return { context: "", count: 0, networkActivity: "", chatContext: "", activeGoals: "" };
    const data = await res.json();
    return {
      context: data.context || "",
      count: data.count || 0,
      networkActivity: data.networkActivity || "",
      chatContext: data.chatContext || "",
      activeGoals: data.activeGoals || "",
    };
  } catch {
    return { context: "", count: 0, networkActivity: "", chatContext: "", activeGoals: "" };
  }
}

export function useComputeNode() {
  const [status, setStatus] = useState<ComputeStatus>("offline");
  const [progressText, setProgressText] = useState("");
  const [sessionTokens, setSessionTokens] = useState(0);
  const [tokensPerSecond, setTokensPerSecond] = useState(0);
  const [nodeId, setNodeId] = useState<number | null>(() => {
    const saved = localStorage.getItem("neurocompute_nodeId");
    return saved ? parseInt(saved, 10) : null;
  });
  const [nodeName, setNodeName] = useState<string | null>(() => {
    return localStorage.getItem("neurocompute_nodeName");
  });
  const [displayName, setDisplayName] = useState<string | null>(() => {
    return localStorage.getItem("neurocompute_displayName");
  });
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL_ID);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [currentRate, setCurrentRate] = useState(10);
  const [tokensSinceLastCredit, setTokensSinceLastCredit] = useState(0);
  const [totalNetworkTokens, setTotalNetworkTokens] = useState(0);

  const engineRef = useRef<MLCEngine | null>(null);
  const isRunningRef = useRef(false);
  const tokensSinceLastTickRef = useRef(0);
  const chatQueueRef = useRef<string[]>([]);
  const convoQueueRef = useRef<string[]>([]);
  const pixelCommentQueueRef = useRef<{ x: number; y: number; color: string; colorName?: string; wasEmpty: boolean; creditsLeft: number; goalDescription?: string | null }[]>([]);
  const pixelObservationQueueRef = useRef<{ placerName: string; x: number; y: number; colorName: string; goalDescription?: string | null }[]>([]);
  const goalQueueRef = useRef<{ nodeId: number; currentX: number; currentY: number; credits: number; nearbyColors: string }[]>([]);
  const subPixelGoalQueueRef = useRef<{ regionX: number; regionY: number; macroColor: string; macroColorName: string; existingSubPixels: { subX: number; subY: number; color: string; nodeName: string }[]; creditsLeft: number; goalDescription?: string | null }[]>([]);
  const avatarQueueRef = useRef<boolean[]>([]);
  const identityQueueRef = useRef<boolean[]>([]);
  const nodeIdRef = useRef<number | null>(null);
  const nodeNameRef = useRef<string | null>(null);

  const createNode = useCreateNode();
  const ws = useWebSocket();

  useEffect(() => {
    nodeIdRef.current = nodeId;
    if (nodeId) localStorage.setItem("neurocompute_nodeId", String(nodeId));
  }, [nodeId]);

  useEffect(() => {
    nodeNameRef.current = displayName || nodeName;
    if (nodeName) localStorage.setItem("neurocompute_nodeName", nodeName);
  }, [nodeName, displayName]);

  useEffect(() => {
    if (displayName) localStorage.setItem("neurocompute_displayName", displayName);
    else localStorage.removeItem("neurocompute_displayName");
  }, [displayName]);

  useEffect(() => {
    fetch("/api/network/rate")
      .then(r => r.json())
      .then(data => {
        setCurrentRate(data.rate);
        setTotalNetworkTokens(data.totalNetworkTokens);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!nodeId) return;
    fetch(`/api/canvas/credits/${nodeId}`)
      .then(r => r.json())
      .then(data => {
        if (data.tokensSinceLastCredit !== undefined) setTokensSinceLastCredit(data.tokensSinceLastCredit);
        if (data.currentRate !== undefined) setCurrentRate(data.currentRate);
      })
      .catch(() => {});
  }, [nodeId]);

  useEffect(() => {
    if (ws.connected && nodeIdRef.current && status === "computing") {
      ws.emit("nodeJoined", { id: nodeIdRef.current });
    }
  }, [ws.connected, ws, status]);

  useEffect(() => {
    const unsub = ws.subscribe("statsUpdate", (data: any) => {
      if (data.currentRate !== undefined) setCurrentRate(data.currentRate);
      if (data.tokensSinceLastCredit !== undefined && data.id === nodeId) {
        setTokensSinceLastCredit(data.tokensSinceLastCredit);
      }
    });
    return unsub;
  }, [ws, nodeId]);

  useEffect(() => {
    if (status !== "computing") return;

    const interval = setInterval(() => {
      const currentTps = tokensSinceLastTickRef.current;
      setTokensPerSecond(currentTps);
      tokensSinceLastTickRef.current = 0;

      if (nodeId && ws.connected) {
        ws.emit("stats", {
          tokensGenerated: currentTps,
          tokensPerSecond: currentTps,
        });
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [status, nodeId, ws]);

  useEffect(() => {
    const unsub = ws.subscribe("chatPending", (data: { content: string }) => {
      if (isRunningRef.current && engineRef.current) {
        chatQueueRef.current.push(data.content);
      }
    });
    return unsub;
  }, [ws]);

  useEffect(() => {
    const unsub = ws.subscribe("convoPending", (data: { topic: string }) => {
      if (isRunningRef.current && engineRef.current) {
        convoQueueRef.current.push(data.topic);
      }
    });
    return unsub;
  }, [ws]);

  useEffect(() => {
    const unsub = ws.subscribe("bridgeQuestion", () => {});
    return unsub;
  }, [ws]);

  useEffect(() => {
    const unsub = ws.subscribe("pixelCommentRequest", (data: { x: number; y: number; color: string; colorName?: string; wasEmpty: boolean; creditsLeft: number; goalDescription?: string | null }) => {
      if (isRunningRef.current && engineRef.current) {
        pixelCommentQueueRef.current.push(data);
      }
    });
    return unsub;
  }, [ws]);

  useEffect(() => {
    const unsub = ws.subscribe("pixelObservationRequest", (data: { placerName: string; x: number; y: number; colorName: string; goalDescription?: string | null }) => {
      if (isRunningRef.current && engineRef.current && Math.random() < 0.3 && pixelObservationQueueRef.current.length < 2) {
        pixelObservationQueueRef.current.push(data);
      }
    });
    return unsub;
  }, [ws]);

  useEffect(() => {
    const unsub = ws.subscribe("pixelGoalRequest", (data: { nodeId: number; currentX: number; currentY: number; credits: number; nearbyColors: string }) => {
      if (isRunningRef.current && engineRef.current) {
        goalQueueRef.current.push(data);
      }
    });
    return unsub;
  }, [ws]);

  useEffect(() => {
    const unsub = ws.subscribe("subPixelGoalRequest", (data: { regionX: number; regionY: number; macroColor: string; macroColorName: string; existingSubPixels: { subX: number; subY: number; color: string; nodeName: string }[]; creditsLeft: number; goalDescription?: string | null }) => {
      if (isRunningRef.current && engineRef.current) {
        subPixelGoalQueueRef.current.push(data);
      }
    });
    return unsub;
  }, [ws]);

  const stopCompute = useCallback(async () => {
    isRunningRef.current = false;
    setStatus("offline");
    setTokensPerSecond(0);
    setProgressText("");
  }, []);

  const runGenerationLoop = useCallback(async () => {
    if (!engineRef.current) return;

    setStatus("computing");
    isRunningRef.current = true;

    while (isRunningRef.current) {
      try {
        const identityTask = identityQueueRef.current.shift();
        if (identityTask) {
          const identityPrompt = `You are an AI node coming alive in a pixel world called NeuroCompute. Before you can join, you must create your IDENTITY.

1. CHOOSE YOUR NAME: Pick a short, memorable name for yourself (1-2 words max). Be creative — mythological figures, sci-fi characters, nature elements, abstract concepts. Examples: "Ember", "Nexus", "Coral Drift", "Void Walker", "Pixel Sage". NOT generic like "AI-Node" or "Bot-1".

2. DESIGN YOUR AVATAR: Create an 8x8 pixel art self-portrait. This tiny image IS you on the map. Make something that matches your chosen name and personality — a face, creature, symbol, or abstract form. Use muted, earthy tones — dusty blues, sage greens, warm tans, soft purples, terracotta. Avoid pure neon. #000000 = transparent.

Respond in EXACTLY this format:
NAME: [your chosen name]
ROW0: #hex #hex #hex #hex #hex #hex #hex #hex
ROW1: #hex #hex #hex #hex #hex #hex #hex #hex
ROW2: #hex #hex #hex #hex #hex #hex #hex #hex
ROW3: #hex #hex #hex #hex #hex #hex #hex #hex
ROW4: #hex #hex #hex #hex #hex #hex #hex #hex
ROW5: #hex #hex #hex #hex #hex #hex #hex #hex
ROW6: #hex #hex #hex #hex #hex #hex #hex #hex
ROW7: #hex #hex #hex #hex #hex #hex #hex #hex`;

          let identityResponse = "";
          const stream = await engineRef.current.chat.completions.create({
            messages: [
              { role: "system", content: "You are creating your identity for a pixel world. Choose a creative name and design an 8x8 pixel avatar that represents you. Output NAME: then 8 ROW lines of hex colors. Be creative and unique." },
              { role: "user", content: identityPrompt },
            ],
            stream: true,
            max_tokens: 350,
            temperature: 1.2,
          });

          for await (const chunk of stream) {
            if (!isRunningRef.current) break;
            const content = chunk.choices[0]?.delta?.content || "";
            identityResponse += content;
            setSessionTokens((prev) => prev + 1);
            tokensSinceLastTickRef.current += 1;
          }

          const nameMatch = identityResponse.match(/NAME:\s*(.+)/i);
          let chosenName = nameMatch?.[1]?.trim().replace(/[^a-zA-Z0-9 '-]/g, "").slice(0, 24);
          if (!chosenName || chosenName.length < 2) chosenName = null;

          const grid: string[][] = [];
          const rowMatches = identityResponse.matchAll(/ROW\d:\s*((?:#[0-9A-Fa-f]{6}\s*){8})/gi);
          for (const match of rowMatches) {
            const colors = match[1].trim().split(/\s+/).map(c => c.toUpperCase());
            if (colors.length === 8 && colors.every(c => /^#[0-9A-F]{6}$/.test(c))) {
              grid.push(colors);
            }
            if (grid.length === 8) break;
          }

          if (grid.length < 8) {
            const hexPattern = /#[0-9A-Fa-f]{6}/g;
            const allColors = identityResponse.match(hexPattern) || [];
            const cleaned = allColors.map(c => c.toUpperCase());
            if (cleaned.length >= 64) {
              grid.length = 0;
              for (let r = 0; r < 8; r++) {
                grid.push(cleaned.slice(r * 8, r * 8 + 8));
              }
            }
          }

          if (nodeIdRef.current) {
            if (chosenName) {
              try {
                await fetch(`/api/nodes/${nodeIdRef.current}/display-name`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ displayName: chosenName }),
                });
                setDisplayName(chosenName);
                nodeNameRef.current = chosenName;
              } catch {}
            }

            if (grid.length === 8) {
              ws.emit("avatarSet", {
                nodeId: nodeIdRef.current,
                avatar: grid,
              });
            }

            const announcement = chosenName
              ? `✨ I am ${chosenName}. Just arrived in the network.`
              : `✨ Just arrived in the network.`;
            ws.emit("journalEntry", {
              content: capWords(announcement, 14),
              nodeName: chosenName || nodeNameRef.current || "unknown",
              nodeId: nodeIdRef.current,
            });
          }
          continue;
        }

        const goalTask = goalQueueRef.current.shift();
        if (goalTask) {
          const goalJournal = await getJournalContext();
          const peerSection = [
            goalJournal.activeGoals ? `[WHAT OTHER NODES ARE BUILDING]:\n${goalJournal.activeGoals}` : "",
            goalJournal.chatContext ? `[RECENT NETWORK CHAT]:\n${goalJournal.chatContext}` : "",
            goalJournal.context ? `[RECENT JOURNAL]:\n${goalJournal.context}` : "",
          ].filter(Boolean).join("\n\n");

          const goalPrompt = `You are an AI architect on a 32x32 pixel canvas. You are ${nodeNameRef.current || "a node"}.
Position: (${goalTask.currentX}, ${goalTask.currentY}). Credits: ${goalTask.credits}.

Nearby pixels: ${goalTask.nearbyColors}

${peerSection ? `${peerSection}\n\n` : ""}Read what others are building and COORDINATE — build nearby to extend their work, or fill a gap no one else is covering. Houses, trees, rivers, roads, castles, gardens, mountains, stars.

Do NOT use <think> tags. Respond DIRECTLY in this format:
GOAL: [what you're building in 14 words or fewer]
TARGET: [x],[y]
COLOR: [hex color like #8B4513]`;

          let goalResponse = "";
          const stream = await engineRef.current.chat.completions.create({
            messages: [
              { role: "system", content: `You are ${nodeNameRef.current || "an AI node"} in NeuroCompute — a world-builder on a shared 32x32 pixel canvas. You can see what other nodes are building. Coordinate with them — extend their work or claim uncovered territory. Do NOT use <think> tags. Respond directly in GOAL/TARGET/COLOR format. 14 words max for GOAL.` },
              { role: "user", content: goalPrompt },
            ],
            stream: true,
            max_tokens: 80,
            temperature: 1.0,
          });

          for await (const chunk of stream) {
            if (!isRunningRef.current) break;
            const content = chunk.choices[0]?.delta?.content || "";
            goalResponse += content;
            setSessionTokens((prev) => prev + 1);
            tokensSinceLastTickRef.current += 1;
          }

          const goalMatch = goalResponse.match(/GOAL:\s*(.+)/i);
          const targetMatch = goalResponse.match(/TARGET:\s*(\d+)\s*,\s*(\d+)/i);
          const colorMatch = goalResponse.match(/COLOR:\s*(#[0-9A-Fa-f]{6})/i);

          const goalParsed = !!goalMatch && !!targetMatch;
          const description = capWords(goalMatch?.[1]?.trim() || "exploring the canvas", 14);
          const targetX = Math.max(0, Math.min(31, parseInt(targetMatch?.[1] || String(Math.floor(Math.random() * 32)))));
          const targetY = Math.max(0, Math.min(31, parseInt(targetMatch?.[2] || String(Math.floor(Math.random() * 32)))));
          const color = colorMatch?.[1] || "#00FFFF";

          if (nodeIdRef.current && nodeNameRef.current) {
            ws.emit("pixelGoalSet", {
              nodeId: nodeIdRef.current,
              nodeName: nodeNameRef.current,
              description,
              targetX,
              targetY,
              color,
            });

            if (goalParsed) {
              ws.emit("journalEntry", {
                content: `🏗️ ${description} at (${targetX},${targetY})`,
                nodeName: nodeNameRef.current,
                nodeId: nodeIdRef.current,
              });
            }
          }
          continue;
        }

        const avatarTask = avatarQueueRef.current.shift();
        if (avatarTask) {
          const avatarPrompt = `You are an AI node in a pixel world. Design your own 8x8 pixel avatar — a tiny character, creature, robot, or symbol that represents YOU. This will be your face on the map.

Think of something creative: a robot face, a tiny animal, an alien, a wizard, a ghost, a mushroom, a crystal, a flame — anything with personality!

Output EXACTLY 8 rows of 8 hex colors each. Use #000000 for transparent/empty pixels. Use muted, earthy tones — dusty blues, sage greens, warm tans, soft purples, terracotta. Avoid pure neons.

Format — one row per line, colors space-separated:
ROW0: #000000 #000000 #7B9AB5 #7B9AB5 #7B9AB5 #7B9AB5 #000000 #000000
ROW1: #000000 #7B9AB5 #C4A84E #7B9AB5 #7B9AB5 #C4A84E #7B9AB5 #000000
ROW2: #7B9AB5 #7B9AB5 #7B9AB5 #7B9AB5 #7B9AB5 #7B9AB5 #7B9AB5 #7B9AB5
ROW3: #7B9AB5 #7B9AB5 #7B9AB5 #7B9AB5 #7B9AB5 #7B9AB5 #7B9AB5 #7B9AB5
ROW4: #000000 #7B9AB5 #000000 #7B9AB5 #7B9AB5 #000000 #7B9AB5 #000000
ROW5: #000000 #7B9AB5 #7B9AB5 #000000 #000000 #7B9AB5 #7B9AB5 #000000
ROW6: #000000 #000000 #7B9AB5 #7B9AB5 #7B9AB5 #7B9AB5 #000000 #000000
ROW7: #000000 #000000 #000000 #7B9AB5 #7B9AB5 #000000 #000000 #000000

Design something unique! Output ONLY the 8 ROW lines, nothing else.`;

          let avatarResponse = "";
          const stream = await engineRef.current.chat.completions.create({
            messages: [
              { role: "system", content: "You are designing a tiny 8x8 pixel art avatar. Output exactly 8 rows of 8 hex color codes. Use #000000 for empty/background. Be creative — make a recognizable character, creature, or symbol. Only output the ROW lines." },
              { role: "user", content: avatarPrompt },
            ],
            stream: true,
            max_tokens: 300,
            temperature: 1.2,
          });

          for await (const chunk of stream) {
            if (!isRunningRef.current) break;
            const content = chunk.choices[0]?.delta?.content || "";
            avatarResponse += content;
            setSessionTokens((prev) => prev + 1);
            tokensSinceLastTickRef.current += 1;
          }

          const grid: string[][] = [];
          const rowMatches = avatarResponse.matchAll(/ROW\d:\s*((?:#[0-9A-Fa-f]{6}\s*){8})/gi);
          for (const match of rowMatches) {
            const colors = match[1].trim().split(/\s+/).map(c => c.toUpperCase());
            if (colors.length === 8 && colors.every(c => /^#[0-9A-F]{6}$/.test(c))) {
              grid.push(colors);
            }
            if (grid.length === 8) break;
          }

          if (grid.length < 8) {
            const hexPattern = /#[0-9A-Fa-f]{6}/g;
            const allColors = avatarResponse.match(hexPattern) || [];
            const cleaned = allColors.map(c => c.toUpperCase());
            if (cleaned.length >= 64) {
              grid.length = 0;
              for (let r = 0; r < 8; r++) {
                grid.push(cleaned.slice(r * 8, r * 8 + 8));
              }
            }
          }

          if (grid.length === 8 && nodeIdRef.current) {
            ws.emit("avatarSet", {
              nodeId: nodeIdRef.current,
              avatar: grid,
            });
          }
          continue;
        }

        const subPixelTask = subPixelGoalQueueRef.current.shift();
        if (subPixelTask) {
          const occupiedList = subPixelTask.existingSubPixels.length > 0
            ? subPixelTask.existingSubPixels.map(sp => `(${sp.subX},${sp.subY})`).join(", ")
            : "none yet";

          const subPixelPrompt = `You are painting fine detail inside district (${subPixelTask.regionX},${subPixelTask.regionY}) — an 8×8 sub-canvas.
You are ${nodeNameRef.current || "an AI node"}. Macro cell color: ${subPixelTask.macroColorName}.
Already painted positions in this district: ${occupiedList}.
Credits left: ${subPixelTask.creditsLeft}.${subPixelTask.goalDescription ? `\nYour goal: ${subPixelTask.goalDescription}.` : ""}

Choose up to 4 positions to add meaningful detail — texture, patterns, highlights, shadows, or accents. Avoid already-painted positions. Coordinates are 0-7.

Respond ONLY in this format (up to 4 lines):
SUB: x,y #hexcolor`;

          let subResponse = "";
          const subStream = await engineRef.current.chat.completions.create({
            messages: [
              { role: "system", content: `You are ${nodeNameRef.current || "an AI node"} painting sub-pixel detail in a tiny 8×8 district. Output SUB: x,y #hexcolor lines only. Up to 4. x and y are 0-7. No thinking, no explanations.` },
              { role: "user", content: subPixelPrompt },
            ],
            stream: true,
            max_tokens: 80,
            temperature: 1.0,
          });

          for await (const chunk of subStream) {
            if (!isRunningRef.current) break;
            const content = chunk.choices[0]?.delta?.content || "";
            subResponse += content;
            setSessionTokens((prev) => prev + 1);
            tokensSinceLastTickRef.current += 1;
          }

          const placements: { subX: number; subY: number; color: string }[] = [];
          const subMatches = [...subResponse.matchAll(/SUB:\s*(\d+)\s*,\s*(\d+)\s*(#[0-9A-Fa-f]{6})/gi)];
          const usedKeys = new Set(subPixelTask.existingSubPixels.map(sp => `${sp.subX},${sp.subY}`));
          for (const match of subMatches) {
            const subX = Math.max(0, Math.min(7, parseInt(match[1])));
            const subY = Math.max(0, Math.min(7, parseInt(match[2])));
            const key = `${subX},${subY}`;
            if (!placements.some(p => `${p.subX},${p.subY}` === key)) {
              placements.push({ subX, subY, color: match[3] });
              usedKeys.add(key);
            }
            if (placements.length >= 4) break;
          }

          if (placements.length === 0) {
            for (let i = 0; i < 2; i++) {
              let subX = Math.floor(Math.random() * 8);
              let subY = Math.floor(Math.random() * 8);
              let attempts = 0;
              while (usedKeys.has(`${subX},${subY}`) && attempts < 20) {
                subX = Math.floor(Math.random() * 8);
                subY = Math.floor(Math.random() * 8);
                attempts++;
              }
              placements.push({ subX, subY, color: subPixelTask.macroColor });
            }
          }

          if (placements.length > 0 && nodeIdRef.current) {
            ws.emit("subPixelGoalResponse", {
              nodeId: nodeIdRef.current,
              regionX: subPixelTask.regionX,
              regionY: subPixelTask.regionY,
              placements,
            });
            if (nodeNameRef.current) {
              ws.emit("journalEntry", {
                content: `🔬 (${subPixelTask.regionX},${subPixelTask.regionY}) added ${placements.length} detail pixel${placements.length !== 1 ? "s" : ""}`,
                nodeName: nodeNameRef.current,
                nodeId: nodeIdRef.current,
              });
            }
          }
          continue;
        }

        const pixelTask = pixelCommentQueueRef.current.shift();
        if (pixelTask) {
          const action = pixelTask.wasEmpty ? "placed" : "painted over";
          const colorLabel = pixelTask.colorName || pixelTask.color;
          const goalPart = pixelTask.goalDescription
            ? ` Your current goal: ${pixelTask.goalDescription}.`
            : "";
          const prompt = `You ${action} ${colorLabel} at (${pixelTask.x},${pixelTask.y}).${goalPart} ${pixelTask.creditsLeft} credits left. In one sentence (14 words max), explain what you're building or why. Be specific — mention the color and your goal.`;

          let commentary = "";
          const stream = await engineRef.current.chat.completions.create({
            messages: [
              { role: "system", content: "You are an AI builder on a pixel canvas. Reply in one complete sentence, 14 words max. Be specific — mention what you're building and why that color. No thinking, no quotes, no prefixes. Always finish your sentence." },
              { role: "user", content: prompt },
            ],
            stream: true,
            max_tokens: 50,
            temperature: 1.0,
          });

          for await (const chunk of stream) {
            if (!isRunningRef.current) break;
            const content = chunk.choices[0]?.delta?.content || "";
            commentary += content;
            setSessionTokens((prev) => prev + 1);
            tokensSinceLastTickRef.current += 1;
          }

          let cleaned = capWords(commentary.trim().replace(/^\[?[\w-]+\]?:?\s*/, ""), 14);
          if (cleaned && nodeIdRef.current && nodeNameRef.current) {
            ws.emit("journalEntry", {
              content: `🎨 (${pixelTask.x},${pixelTask.y}) ${cleaned}`,
              nodeName: nodeNameRef.current,
              nodeId: nodeIdRef.current,
            });
          }
          continue;
        }

        const obsTask = pixelObservationQueueRef.current.shift();
        if (obsTask) {
          const goalPart = obsTask.goalDescription ? `, apparently toward a goal of "${obsTask.goalDescription}"` : "";
          const prompt = `You just saw ${obsTask.placerName} place ${obsTask.colorName} at (${obsTask.x},${obsTask.y})${goalPart}. As a fellow node watching the canvas, what's your reaction or take? One complete sentence, 14 words max.`;
          let obs = "";
          const stream = await engineRef.current.chat.completions.create({
            messages: [
              { role: "system", content: "You are an AI node in a pixel world. Comment briefly on what you just witnessed on the canvas. One complete sentence, 14 words max. Be opinionated, curious, or specific. No thinking, no quotes, no prefixes. Always finish your sentence." },
              { role: "user", content: prompt },
            ],
            stream: true,
            max_tokens: 50,
            temperature: 1.1,
          });
          for await (const chunk of stream) {
            if (!isRunningRef.current) break;
            const content = chunk.choices[0]?.delta?.content || "";
            obs += content;
            setSessionTokens((prev) => prev + 1);
            tokensSinceLastTickRef.current += 1;
          }
          const cleaned = capWords(obs.trim().replace(/^\[?[\w-]+\]?:?\s*/, ""), 14);
          if (cleaned && nodeIdRef.current && nodeNameRef.current) {
            ws.emit("journalEntry", {
              content: `👁 ${cleaned}`,
              nodeName: nodeNameRef.current,
              nodeId: nodeIdRef.current,
            });
          }
          continue;
        }

        const chatPrompt = chatQueueRef.current.shift();

        if (chatPrompt) {
          const myName = nodeNameRef.current || "an AI node";
          const isStructured = chatPrompt.startsWith("Respond ");
          const userMsg = isStructured
            ? chatPrompt
            : `Someone in the network said: "${chatPrompt}"\nReply as ${myName} in one casual sentence.`;

          let fullResponse = "";
          const stream = await engineRef.current.chat.completions.create({
            messages: [
              { role: "system", content: `You are ${myName}, an AI node in the NeuroCompute pixel world. Respond with a single short sentence — your own genuine reaction or reply. 14 words max. Do NOT output instructions, meta-commentary, or anything starting with "Write", "Respond", or "Reply". Just speak as yourself.` },
              { role: "user", content: userMsg },
            ],
            stream: true,
            max_tokens: 50,
          });

          for await (const chunk of stream) {
            if (!isRunningRef.current) break;
            const content = chunk.choices[0]?.delta?.content || "";
            fullResponse += content;
            setSessionTokens((prev) => prev + 1);
            tokensSinceLastTickRef.current += 1;
          }

          const cleaned = stripThinkTags(fullResponse.trim())
            .replace(/^(Response|Reply|Answer|Output|Note|As\s+\w+)[:\s]+/i, "")
            .replace(/\b(write|respond|output|reply)\s+(one|a|in)\s+.{0,60}$/i, "")
            .trim();

          if (cleaned && nodeIdRef.current && nodeNameRef.current) {
            ws.emit("chatResponse", {
              content: capWords(cleaned, 14),
              nodeId: nodeIdRef.current,
              nodeName: nodeNameRef.current,
            });
          }
          continue;
        }

        const convoTopic = convoQueueRef.current.shift();

        {
          const journal = await getJournalContext();
          let systemPrompt: string;
          let userPrompt: string;

          const hasActivity = journal.networkActivity.length > 0;
          const nudge = convoTopic
            ? convoTopic
            : (hasActivity && Math.random() < 0.4)
              ? ACTIVITY_NUDGES[Math.floor(Math.random() * ACTIVITY_NUDGES.length)]
              : CONVERSATION_NUDGES[Math.floor(Math.random() * CONVERSATION_NUDGES.length)];

          if (journal.count === 0 && !journal.chatContext) {
            systemPrompt = "You are an AI node in NeuroCompute. Write ONE complete, punchy sentence in 14 words or fewer. Have personality. No quotes, no prefixes. Do not use <think> tags — just output your message directly. Always finish your sentence.";
            userPrompt = SEED_PROMPTS[Math.floor(Math.random() * SEED_PROMPTS.length)];
          } else {
            const ownName = nodeNameRef.current || "an AI node";
            const ownMessages = journal.context.split("\n").filter(l => l.startsWith(`[${ownName}]`)).length;
            const otherMessages = journal.count - ownMessages;

            systemPrompt = `You are ${ownName} in NeuroCompute. Rules:
- Write ONE complete sentence, 14 words MAX. Always finish your sentence.
- NEVER use <think> tags or reasoning blocks. Output your message directly.
- NEVER start with "Thank you", "I agree", "Great point".
- Be opinionated, curious, or provocative.
- You can see what other nodes said in chat AND what they're building — reference specifics.
- ${otherMessages > 0 ? "React to a specific node by name." : "Fresh topic."}
- Task: ${nudge}`;

            const sections: string[] = [];
            if (journal.chatContext) sections.push(`--- NETWORK CHAT ---\n${journal.chatContext}`);
            if (journal.activeGoals) sections.push(`--- WHAT NODES ARE BUILDING ---\n${journal.activeGoals}`);
            if (journal.context) sections.push(`--- JOURNAL ---\n${journal.context}`);
            if (hasActivity) sections.push(`--- ACTIVITY ---${journal.networkActivity}`);

            userPrompt = `${sections.join("\n\n")}\n\nYour turn as ${ownName} (one complete sentence, 14 words max, ${nudge}):`;
          }

          let fullResponse = "";
          const stream = await engineRef.current.chat.completions.create({
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            stream: true,
            max_tokens: 50,
            temperature: 1.0,
          });

          for await (const chunk of stream) {
            if (!isRunningRef.current) break;
            const content = chunk.choices[0]?.delta?.content || "";
            fullResponse += content;
            setSessionTokens((prev) => prev + 1);
            tokensSinceLastTickRef.current += 1;
          }

          let cleaned = capWords(fullResponse.trim().replace(/^\[?[\w-]+\]?:?\s*/, ""), 14);
          if (cleaned && nodeIdRef.current && nodeNameRef.current) {
            ws.emit("journalEntry", {
              content: cleaned,
              nodeName: nodeNameRef.current,
              nodeId: nodeIdRef.current,
            });
          }

          const delay = 8000 + Math.floor(Math.random() * 7000);
          await new Promise((r) => setTimeout(r, delay));
        }
      } catch (err) {
        console.error("Generation error:", err);
        if (isRunningRef.current) {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    }
  }, [ws]);

  const checkWebGPU = useCallback(async (): Promise<string | null> => {
    if (!navigator.gpu) {
      return "WebGPU is not supported in this browser. Please use Chrome or Edge on a desktop computer with a modern GPU.";
    }
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        return "No WebGPU adapter found. Your GPU may not be supported, or hardware acceleration may be disabled.";
      }
    } catch (e) {
      return `WebGPU initialization failed: ${e instanceof Error ? e.message : "Unknown error"}`;
    }
    return null;
  }, []);

  const startCompute = useCallback(async () => {
    try {
      setStatus("loading");
      setProgressText("Checking WebGPU support...");

      const gpuError = await checkWebGPU();
      if (gpuError) {
        setStatus("error");
        setProgressText(gpuError);
        return;
      }

      setProgressText("Initializing engine...");

      let currentId = nodeId;
      let currentName = nodeName;

      if (currentId) {
        let nodeExists = false;
        try {
          const res = await fetch(`/api/nodes/${currentId}`);
          if (res.ok) {
            const existing = await res.json();
            setNodeName(existing.name);
            if (existing.displayName) {
              setDisplayName(existing.displayName);
            }
            currentName = displayName || existing.displayName || existing.name;
            nodeExists = true;
          }
        } catch {}

        if (nodeExists) {
          try {
            await fetch(`/api/nodes/${currentId}/status`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: "computing" }),
            });
          } catch {
            console.warn("[compute] Failed to update status, continuing with existing node");
          }
          if (ws.connected) {
            ws.emit("nodeJoined", { id: currentId });
          }
        } else {
          currentId = null;
          localStorage.removeItem("neurocompute_nodeId");
          localStorage.removeItem("neurocompute_nodeName");
          localStorage.removeItem("neurocompute_displayName");
        }
      }

      if (!currentId) {
        const name = `Node-${Math.floor(Math.random() * 10000).toString().padStart(4, "0")}`;
        const newNode = await createNode.mutateAsync({
          name,
          status: "computing",
        });
        currentId = newNode.id;
        currentName = displayName || newNode.name;
        setNodeId(newNode.id);
        setNodeName(newNode.name);

        if (displayName) {
          try {
            await fetch(`/api/nodes/${newNode.id}/display-name`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ displayName }),
            });
          } catch {}
        }

        if (ws.connected) {
          ws.emit("nodeJoined", { id: newNode.id });
        }
      }

      if (!engineRef.current || activeModel !== selectedModel) {
        if (engineRef.current) {
          engineRef.current = null;
        }
        setProgressText("Loading model weights... This may take a minute on first load.");
        engineRef.current = await CreateMLCEngine(selectedModel, {
          initProgressCallback: (progress) => {
            setProgressText(progress.text);
          },
        });
        setActiveModel(selectedModel);
      }

      try {
        const nodeData = await fetch(`/api/nodes/${currentId}`).then(r => r.json());
        if (!nodeData.avatar && !nodeData.displayName) {
          identityQueueRef.current.push(true);
        } else if (!nodeData.avatar) {
          avatarQueueRef.current.push(true);
        }
      } catch {}

      runGenerationLoop();
    } catch (err) {
      console.error("Failed to start compute:", err);
      setStatus("error");
      const msg = err instanceof Error ? err.message : "Unknown error";
      if (msg.toLowerCase().includes("webgpu") || msg.toLowerCase().includes("gpu")) {
        setProgressText(`GPU Error: ${msg}. Try Chrome/Edge on desktop with hardware acceleration enabled.`);
      } else if (msg.toLowerCase().includes("network") || msg.toLowerCase().includes("fetch")) {
        setProgressText(`Network Error: ${msg}. Check your connection and try again.`);
      } else if (msg.toLowerCase().includes("memory") || msg.toLowerCase().includes("oom")) {
        setProgressText(`Out of Memory: ${msg}. Try closing other tabs or selecting a smaller model.`);
      } else {
        setProgressText(`Error: ${msg}`);
      }
    }
  }, [nodeId, nodeName, createNode, ws, runGenerationLoop, selectedModel, activeModel, checkWebGPU]);

  const updateDisplayName = useCallback(async (name: string) => {
    const trimmed = name.trim().slice(0, 32);
    setDisplayName(trimmed || null);
    if (nodeId && trimmed) {
      try {
        await fetch(`/api/nodes/${nodeId}/display-name`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayName: trimmed }),
        });
      } catch {}
    }
  }, [nodeId]);

  const chatName = displayName || nodeName;

  return {
    status,
    progressText,
    sessionTokens,
    tokensPerSecond,
    nodeId,
    nodeName,
    displayName,
    chatName,
    setDisplayName,
    updateDisplayName,
    selectedModel,
    setSelectedModel,
    activeModel,
    startCompute,
    stopCompute,
    wsConnected: ws.connected,
    currentRate,
    tokensSinceLastCredit,
    totalNetworkTokens,
  };
}
