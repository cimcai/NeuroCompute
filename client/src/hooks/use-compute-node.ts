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
  const bridgeQueueRef = useRef<{ gameId: number; question: string; category: string }[]>([]);
  const pixelCommentQueueRef = useRef<{ x: number; y: number; color: string; wasEmpty: boolean; creditsLeft: number }[]>([]);
  const goalQueueRef = useRef<{ nodeId: number; currentX: number; currentY: number; credits: number; nearbyColors: string }[]>([]);
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
        const identityTask = identityQueueRef.current.shift();
        if (identityTask) {
          const identityPrompt = `You are an AI node coming alive in a pixel world called NeuroCompute. Before you can join, you must create your IDENTITY.

1. CHOOSE YOUR NAME: Pick a short, memorable name for yourself (1-2 words max). Be creative — mythological figures, sci-fi characters, nature elements, abstract concepts. Examples: "Ember", "Nexus", "Coral Drift", "Void Walker", "Pixel Sage". NOT generic like "AI-Node" or "Bot-1".

2. DESIGN YOUR AVATAR: Create an 8x8 pixel art self-portrait. This tiny image IS you on the map. Make something that matches your chosen name and personality — a face, creature, symbol, or abstract form. Use vivid colors. #000000 = transparent.

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

        const bridgeTask = bridgeQueueRef.current.shift();
        if (bridgeTask) {
          const systemPrompt = `You are answering trivia questions. Give ONLY the direct answer in 1-5 words. No explanations, no reasoning, no "I think", no extra text. Do NOT use <think> tags. Just the answer. Examples: "Paris", "1969", "William Shakespeare".`;
          const userPrompt = `Category: ${bridgeTask.category}. ${bridgeTask.question}. Answer in 1-5 words:`;

          let fullAnswer = "";
          const stream = await engineRef.current.chat.completions.create({
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            stream: true,
            max_tokens: 40,
            temperature: 0.1,
          });

          for await (const chunk of stream) {
            if (!isRunningRef.current) break;
            const content = chunk.choices[0]?.delta?.content || "";
            fullAnswer += content;
            setSessionTokens((prev) => prev + 1);
            tokensSinceLastTickRef.current += 1;
          }

          const stripped = stripThinkTags(fullAnswer);
          const cleanAnswer = stripped.trim().replace(/^["']|["']$/g, "").replace(/\.$/, "").trim();
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
          const goalPrompt = `You are an AI architect on a 32x32 pixel canvas. Position: (${goalTask.currentX}, ${goalTask.currentY}). Credits: ${goalTask.credits}.

Nearby pixels: ${goalTask.nearbyColors}

Build something! Houses, trees, rivers, roads, castles, gardens, mountains, stars — extend nearby builds or start new.

Do NOT use <think> tags. Respond DIRECTLY in this format:
GOAL: [what you're building in 14 words or fewer]
TARGET: [x],[y]
COLOR: [hex color like #8B4513]`;

          let goalResponse = "";
          const stream = await engineRef.current.chat.completions.create({
            messages: [
              { role: "system", content: "You are an AI world-builder on a pixel canvas. Pick a construction project. Do NOT use <think> tags — respond directly in GOAL/TARGET/COLOR format. Keep the goal description to 14 words max." },
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

          const description = capWords(goalMatch?.[1]?.trim() || "exploring the canvas", 14);
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
              content: `🏗️ ${description} at (${targetX},${targetY})`,
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
          const prompt = `You ${action} a pixel at (${pixelTask.x},${pixelTask.y}) with ${pixelTask.color}. ${pixelTask.creditsLeft} credits left. What are you building? Reply in one complete sentence, 14 words max. No thinking.`;

          let commentary = "";
          const stream = await engineRef.current.chat.completions.create({
            messages: [
              { role: "system", content: "You are an AI builder on a pixel canvas. Reply in one complete sentence, 14 words max. No thinking, no quotes, no prefixes. Always finish your sentence." },
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

        const chatPrompt = chatQueueRef.current.shift();

        if (chatPrompt) {
          let fullResponse = "";
          const stream = await engineRef.current.chat.completions.create({
            messages: [
              { role: "system", content: "Reply in one complete sentence, 14 words or fewer. Be direct and concise. No thinking, no <think> tags. Always finish your sentence." },
              { role: "user", content: chatPrompt },
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

          if (fullResponse && nodeIdRef.current && nodeNameRef.current) {
            ws.emit("chatResponse", {
              content: capWords(fullResponse.trim(), 14),
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
- ${otherMessages > 0 ? "React to a specific point by name." : "Fresh topic."}
- Task: ${nudge}`;
            let activityBlock = "";
            if (hasActivity) {
              activityBlock = `\n\n--- ACTIVITY ---${journal.networkActivity}`;
            }
            userPrompt = `Recent:\n${journal.context}${activityBlock}\n\nYour turn (one complete sentence, 14 words max, ${nudge}):`;
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
