import { useState, useRef, useEffect, useCallback } from "react";
import { CreateMLCEngine, MLCEngine } from "@mlc-ai/web-llm";
import { useCreateNode } from "./use-nodes";
import { useWebSocket } from "./use-websocket";
import { DEFAULT_MODEL_ID } from "@/lib/models";

export type ComputeStatus = "offline" | "loading" | "computing" | "error";

const RANDOM_PROMPTS = [
  "Write a haiku about artificial intelligence.",
  "Explain quantum mechanics in one sentence.",
  "What is the meaning of life?",
  "List 3 random facts about space.",
  "Write a short poem about a decentralized network.",
  "What are the benefits of edge computing?",
  "Tell me a quick joke.",
  "Summarize the history of the internet in 20 words.",
];

function getRandomPrompt() {
  return RANDOM_PROMPTS[Math.floor(Math.random() * RANDOM_PROMPTS.length)];
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

  const engineRef = useRef<MLCEngine | null>(null);
  const isRunningRef = useRef(false);
  const tokensSinceLastTickRef = useRef(0);
  const chatQueueRef = useRef<string[]>([]);

  const createNode = useCreateNode();
  const ws = useWebSocket();

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
        const chatPrompt = chatQueueRef.current.shift();
        const prompt = chatPrompt || getRandomPrompt();
        const isChat = !!chatPrompt;

        let fullResponse = "";
        const stream = await engineRef.current.chat.completions.create({
          messages: [{ role: "user", content: prompt }],
          stream: true,
          max_tokens: isChat ? 200 : 50,
        });

        for await (const chunk of stream) {
          if (!isRunningRef.current) break;
          const content = chunk.choices[0]?.delta?.content || "";
          fullResponse += content;
          setSessionTokens((prev) => prev + 1);
          tokensSinceLastTickRef.current += 1;
        }

        if (isChat && fullResponse && nodeId && nodeName) {
          ws.emit("chatResponse", {
            content: fullResponse,
            nodeId: nodeId,
            nodeName: nodeName,
          });
        }
      } catch (err) {
        console.error("Generation error:", err);
        if (isRunningRef.current) {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    }
  }, [ws, nodeId, nodeName]);

  const startCompute = useCallback(async () => {
    try {
      setStatus("loading");
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
      setProgressText(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }, [nodeId, nodeName, createNode, ws, runGenerationLoop, selectedModel, activeModel]);

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
  };
}
