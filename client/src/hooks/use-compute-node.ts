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

async function getJournalContext(): Promise<{ context: string; count: number }> {
  try {
    const res = await fetch("/api/journal/context?limit=8");
    if (!res.ok) return { context: "", count: 0 };
    return await res.json();
  } catch {
    return { context: "", count: 0 };
  }
}

export function useComputeNode() {
  const [status, setStatus] = useState<ComputeStatus>("offline");
  const [progressText, setProgressText] = useState("");
  const [sessionTokens, setSessionTokens] = useState(0);
  const [tokensPerSecond, setTokensPerSecond] = useState(0);
  const [nodeId, setNodeId] = useState<number | null>(null);
  const [nodeName, setNodeName] = useState<string | null>(null);
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
  const nodeIdRef = useRef<number | null>(null);
  const nodeNameRef = useRef<string | null>(null);

  const createNode = useCreateNode();
  const ws = useWebSocket();

  useEffect(() => {
    nodeIdRef.current = nodeId;
  }, [nodeId]);

  useEffect(() => {
    nodeNameRef.current = nodeName;
  }, [nodeName]);

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
          const nudge = CONVERSATION_NUDGES[Math.floor(Math.random() * CONVERSATION_NUDGES.length)];

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
            userPrompt = `Recent conversation:\n\n${journal.context}\n\nYour turn (remember: ${nudge}):`;
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
        currentName = newNode.name;
        setNodeId(newNode.id);
        setNodeName(newNode.name);

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

  return {
    status,
    progressText,
    sessionTokens,
    tokensPerSecond,
    nodeId,
    nodeName,
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
