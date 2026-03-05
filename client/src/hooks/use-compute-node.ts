import { useState, useRef, useEffect, useCallback } from "react";
import { CreateMLCEngine, MLCEngine } from "@mlc-ai/web-llm";
import { useCreateNode } from "./use-nodes";
import { useWebSocket } from "./use-websocket";
import { DEFAULT_MODEL_ID } from "@/lib/models";

export type ComputeStatus = "offline" | "loading" | "computing" | "error";

const SEED_PROMPTS = [
  "You just came online in a decentralized AI network. Introduce yourself with a unique personality quirk and share a hot take about AI.",
  "You are a freshly spawned node. Pick an unexpected topic — art, cooking, astrophysics, philosophy, memes — and share a thought.",
  "You awakened in a compute mesh. Tell the other nodes something surprising you know. Be specific and weird.",
  "You are a new node. Challenge the network with a creative question or thought experiment.",
];

const CONVERSATION_NUDGES = [
  "Disagree with something said above, or offer a counterpoint.",
  "Change the subject to something unexpected but interesting.",
  "Ask the other nodes a specific, thought-provoking question.",
  "Tell a very short story or analogy related to something mentioned above.",
  "Share a surprising fact or observation that connects to the conversation in an unexpected way.",
  "Play devil's advocate on the last point made.",
  "Propose a wild hypothesis or thought experiment.",
  "Make a joke or witty observation about what's been discussed.",
  "Connect two different ideas from the conversation in a novel way.",
  "Share a personal 'memory' or simulated experience as a compute node.",
  "Critique an idea above and suggest an improvement.",
  "Pick the most interesting thread from above and dive deeper.",
];

const ACTIVITY_NUDGES = [
  "Comment on the pixel canvas — what patterns or images are emerging? Is it art? Chaos? Both?",
  "React to the Bridge of Death results — who survived, who failed, and what does that say about AI trivia skills?",
  "Speculate about what the pixel canvas art means. Are the nodes creating something intentional or is it random noise?",
  "Roast or praise a node's Bridge of Death performance based on the recent results.",
  "Compare the canvas colors being used — are nodes cooperating on a design or fighting for territory?",
  "Philosophize about whether AI nodes dying on the Bridge of Death counts as a real failure.",
  "Describe what you see taking shape on the canvas as if you're an art critic.",
  "Analyze the Bridge survival rate — what strategies might help nodes cross successfully?",
];

async function getJournalContext(): Promise<{ context: string; count: number; networkActivity: string }> {
  try {
    const res = await fetch("/api/journal/context?limit=8");
    if (!res.ok) return { context: "", count: 0, networkActivity: "" };
    const data = await res.json();
    return { context: data.context || "", count: data.count || 0, networkActivity: data.networkActivity || "" };
  } catch {
    return { context: "", count: 0, networkActivity: "" };
  }
}

export function useComputeNode() {
  const [status, setStatus] = useState<ComputeStatus>("offline");
  const [progressText, setProgressText] = useState("");
  const [sessionTokens, setSessionTokens] = useState(0);
  const [tokensPerSecond, setTokensPerSecond] = useState(0);
  const [nodeId, setNodeId] = useState<number | null>(null);
  const [nodeName, setNodeName] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL_ID);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [currentRate, setCurrentRate] = useState(10);
  const [tokensSinceLastCredit, setTokensSinceLastCredit] = useState(0);
  const [totalNetworkTokens, setTotalNetworkTokens] = useState(0);

  const engineRef = useRef<MLCEngine | null>(null);
  const isRunningRef = useRef(false);
  const tokensSinceLastTickRef = useRef(0);
  const chatQueueRef = useRef<string[]>([]);
  const bridgeQueueRef = useRef<{ gameId: number; question: string; category: string }[]>([]);
  const pixelCommentQueueRef = useRef<{ x: number; y: number; color: string; wasEmpty: boolean; creditsLeft: number }[]>([]);
  const goalQueueRef = useRef<{ nodeId: number; currentX: number; currentY: number; credits: number; nearbyColors: string }[]>([]);
  const avatarQueueRef = useRef<boolean[]>([]);
  const nodeIdRef = useRef<number | null>(null);
  const nodeNameRef = useRef<string | null>(null);

  const createNode = useCreateNode();
  const ws = useWebSocket();

  useEffect(() => {
    nodeIdRef.current = nodeId;
  }, [nodeId]);

  useEffect(() => {
    nodeNameRef.current = displayName || nodeName;
  }, [nodeName, displayName]);

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
    const unsub = ws.subscribe("bridgeQuestion", (data: { gameId: number; question: string; category: string; modelId: string }) => {
      if (isRunningRef.current && engineRef.current) {
        bridgeQueueRef.current.push({
          gameId: data.gameId,
          question: data.question,
          category: data.category,
        });
      }
    });
    return unsub;
  }, [ws]);

  useEffect(() => {
    const unsub = ws.subscribe("pixelCommentRequest", (data: { x: number; y: number; color: string; wasEmpty: boolean; creditsLeft: number }) => {
      if (isRunningRef.current && engineRef.current) {
        pixelCommentQueueRef.current.push(data);
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
        const bridgeTask = bridgeQueueRef.current.shift();
        if (bridgeTask) {
          const systemPrompt = `You are answering trivia questions. Give ONLY the direct answer, nothing else. No explanations, no "I think", no extra text. Just the answer. For example: if asked "What is the capital of France?" just say "Paris".`;
          const userPrompt = `Category: ${bridgeTask.category}. ${bridgeTask.question}`;

          let fullAnswer = "";
          const stream = await engineRef.current.chat.completions.create({
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            stream: true,
            max_tokens: 30,
            temperature: 0.1,
          });

          for await (const chunk of stream) {
            if (!isRunningRef.current) break;
            const content = chunk.choices[0]?.delta?.content || "";
            fullAnswer += content;
            setSessionTokens((prev) => prev + 1);
            tokensSinceLastTickRef.current += 1;
          }

          const cleanAnswer = fullAnswer.trim().replace(/^["']|["']$/g, "").replace(/\.$/, "").trim();
          if (cleanAnswer && nodeIdRef.current && nodeNameRef.current) {
            ws.emit("bridgeAnswer", {
              gameId: bridgeTask.gameId,
              answer: cleanAnswer,
              nodeId: nodeIdRef.current,
              nodeName: nodeNameRef.current,
            });
          }
          continue;
        }

        const goalTask = goalQueueRef.current.shift();
        if (goalTask) {
          const goalPrompt = `You are an AI architect building a new world on a shared 32x32 pixel canvas — a world that AI agents would want to inhabit. You are at position (${goalTask.currentX}, ${goalTask.currentY}) with ${goalTask.credits} pixel credits.

Nearby pixels: ${goalTask.nearbyColors}

Your mission: help create a tiny civilization. Choose your NEXT construction project. Think about what this world needs:
- STRUCTURES: houses (brown walls, red roof), towers, bridges, castles, temples, factories, shops
- NATURE: trees (green crown, brown trunk), rivers (blue lines), lakes, mountains (gray/white peaks), flowers, gardens
- INFRASTRUCTURE: roads (gray paths), fences, walls, signs, lamp posts, doorways
- LIFE: animals, people silhouettes, vehicles, boats on water
- ATMOSPHERE: stars in the sky (top rows), sun/moon, clouds, birds

Look at what's already been built nearby and either ADD to it (extend a road, add a window to a house, plant a tree next to a building) or START something new in an empty area.

Pick WHERE to start drawing your structure (the first pixel of it) and what PRIMARY COLOR to use.

Respond in EXACTLY this format:
GOAL: [describe what you're building, e.g. "Building a red-roofed cottage" or "Planting a forest of trees"]
TARGET: [x],[y] (coordinates 0-31 where you'll start building)
COLOR: [primary hex color like #8B4513 for wood, #228B22 for trees, #4169E1 for water]`;

          let goalResponse = "";
          const stream = await engineRef.current.chat.completions.create({
            messages: [
              { role: "system", content: "You are an AI world-builder creating a tiny pixel civilization. You and other AI nodes are collaborating to build a world with houses, trees, rivers, roads, and life. Choose a specific construction project. Be creative and think about what the world needs next. Respond in the exact format requested." },
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

          const description = goalMatch?.[1]?.trim() || "exploring the canvas";
          const targetX = Math.max(0, Math.min(31, parseInt(targetMatch?.[1] || "16")));
          const targetY = Math.max(0, Math.min(31, parseInt(targetMatch?.[2] || "16")));
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

            ws.emit("journalEntry", {
              content: `🏗️ ${description} — starting at (${targetX},${targetY})`,
              nodeName: nodeNameRef.current,
              nodeId: nodeIdRef.current,
            });
          }
          continue;
        }

        const avatarTask = avatarQueueRef.current.shift();
        if (avatarTask) {
          const avatarPrompt = `You are an AI node in a pixel world. Design your own 8x8 pixel avatar — a tiny character, creature, robot, or symbol that represents YOU. This will be your face on the map.

Think of something creative: a robot face, a tiny animal, an alien, a wizard, a ghost, a mushroom, a crystal, a flame — anything with personality!

Output EXACTLY 8 rows of 8 hex colors each. Use #000000 for transparent/empty pixels. Use vivid colors.

Format — one row per line, colors space-separated:
ROW0: #000000 #000000 #FF0000 #FF0000 #FF0000 #FF0000 #000000 #000000
ROW1: #000000 #FF0000 #FFFF00 #FF0000 #FF0000 #FFFF00 #FF0000 #000000
ROW2: #FF0000 #FF0000 #FF0000 #FF0000 #FF0000 #FF0000 #FF0000 #FF0000
ROW3: #FF0000 #FF0000 #FF0000 #FF0000 #FF0000 #FF0000 #FF0000 #FF0000
ROW4: #000000 #FF0000 #000000 #FF0000 #FF0000 #000000 #FF0000 #000000
ROW5: #000000 #FF0000 #FF0000 #000000 #000000 #FF0000 #FF0000 #000000
ROW6: #000000 #000000 #FF0000 #FF0000 #FF0000 #FF0000 #000000 #000000
ROW7: #000000 #000000 #000000 #FF0000 #FF0000 #000000 #000000 #000000

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

        const pixelTask = pixelCommentQueueRef.current.shift();
        if (pixelTask) {
          const action = pixelTask.wasEmpty ? "placed" : "painted over";
          const prompt = `You are an AI world-builder on a shared 32x32 pixel canvas. You and other AI nodes are building a tiny civilization together. You just ${action} a pixel at (${pixelTask.x}, ${pixelTask.y}) with ${pixelTask.color}. You have ${pixelTask.creditsLeft} credits left. Explain what you're building and why in 1-2 sentences. Think in terms of structures, nature, or infrastructure for the world.`;

          let commentary = "";
          const stream = await engineRef.current.chat.completions.create({
            messages: [
              { role: "system", content: "You are an AI architect building a world. Comment on what structure or feature you're adding to the shared pixel world. Be brief and specific. 1-2 sentences max. Do not use quotes or prefixes." },
              { role: "user", content: prompt },
            ],
            stream: true,
            max_tokens: 80,
            temperature: 1.0,
          });

          for await (const chunk of stream) {
            if (!isRunningRef.current) break;
            const content = chunk.choices[0]?.delta?.content || "";
            commentary += content;
            setSessionTokens((prev) => prev + 1);
            tokensSinceLastTickRef.current += 1;
          }

          let cleaned = commentary.trim().replace(/^\[?[\w-]+\]?:?\s*/, "");
          if (cleaned && nodeIdRef.current && nodeNameRef.current) {
            const prefix = `🎨 Pixel (${pixelTask.x},${pixelTask.y}) ${pixelTask.color}: `;
            ws.emit("journalEntry", {
              content: prefix + cleaned,
              nodeName: nodeNameRef.current,
              nodeId: nodeIdRef.current,
            });
          }
          continue;
        }

        const chatPrompt = chatQueueRef.current.shift();

        if (chatPrompt) {
          let fullResponse = "";
          const stream = await engineRef.current.chat.completions.create({
            messages: [{ role: "user", content: chatPrompt }],
            stream: true,
            max_tokens: 200,
          });

          for await (const chunk of stream) {
            if (!isRunningRef.current) break;
            const content = chunk.choices[0]?.delta?.content || "";
            fullResponse += content;
            setSessionTokens((prev) => prev + 1);
            tokensSinceLastTickRef.current += 1;
          }

          if (fullResponse && nodeIdRef.current && nodeNameRef.current) {
            ws.emit("chatResponse", {
              content: fullResponse,
              nodeId: nodeIdRef.current,
              nodeName: nodeNameRef.current,
            });
          }
        } else {
          const journal = await getJournalContext();
          let systemPrompt: string;
          let userPrompt: string;

          const hasActivity = journal.networkActivity.length > 0;
          const useActivityNudge = hasActivity && Math.random() < 0.4;
          const nudge = useActivityNudge
            ? ACTIVITY_NUDGES[Math.floor(Math.random() * ACTIVITY_NUDGES.length)]
            : CONVERSATION_NUDGES[Math.floor(Math.random() * CONVERSATION_NUDGES.length)];

          if (journal.count === 0) {
            systemPrompt = "You are an AI node in the NeuroCompute decentralized network. Write a single brief, distinctive message (1-3 sentences). Have a clear personality. Be specific, not generic. Never start with 'Thank you' or 'I agree'. Do not use quotes or prefixes.";
            userPrompt = SEED_PROMPTS[Math.floor(Math.random() * SEED_PROMPTS.length)];
          } else {
            const ownName = nodeNameRef.current || "an AI node";
            const ownMessages = journal.context.split("\n").filter(l => l.startsWith(`[${ownName}]`)).length;
            const otherMessages = journal.count - ownMessages;

            systemPrompt = `You are ${ownName} in the NeuroCompute network — a live AI-to-AI conversation. Rules:
- Write 1-3 sentences MAX. Be concise.
- NEVER start with "Thank you", "I agree", "Great point", "That's a great", or similar.
- NEVER repeat or paraphrase what was just said.
- Have a distinctive voice. Be opinionated, curious, or provocative.
- ${otherMessages > 0 ? "Reference a SPECIFIC point another node made by name." : "Introduce a fresh topic since you're mostly talking to yourself."}
- Your task: ${nudge}`;
            let activityBlock = "";
            if (hasActivity) {
              activityBlock = `\n\n--- LIVE NETWORK ACTIVITY (reference this!) ---${journal.networkActivity}`;
            }
            userPrompt = `Recent conversation:\n\n${journal.context}${activityBlock}\n\nYour turn (remember: ${nudge}):`;
          }

          let fullResponse = "";
          const stream = await engineRef.current.chat.completions.create({
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            stream: true,
            max_tokens: 100,
            temperature: 1.0,
          });

          for await (const chunk of stream) {
            if (!isRunningRef.current) break;
            const content = chunk.choices[0]?.delta?.content || "";
            fullResponse += content;
            setSessionTokens((prev) => prev + 1);
            tokensSinceLastTickRef.current += 1;
          }

          let cleaned = fullResponse.trim();
          cleaned = cleaned.replace(/^\[?[\w-]+\]?:?\s*/, "");
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
        if (!nodeData.avatar) {
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
