import { useState, useRef, useEffect, useCallback } from "react";
import { CreateMLCEngine, MLCEngine } from "@mlc-ai/web-llm";
import { useCreateNode } from "./use-nodes";
import { useWebSocket } from "./use-websocket";

export type ComputeStatus = "offline" | "loading" | "computing" | "error";

// A tiny model suitable for running in the browser rapidly to generate tokens
const MODEL_ID = "TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC";

const RANDOM_PROMPTS = [
  "Write a haiku about artificial intelligence.",
  "Explain quantum mechanics in one sentence.",
  "What is the meaning of life, the universe, and everything?",
  "List 3 random facts about space.",
  "Write a short poem about a decentralized network.",
  "What are the benefits of edge computing?",
  "Tell me a quick joke.",
  "Generate a random sci-fi character name and short backstory.",
  "Summarize the history of the internet in 20 words.",
  "What's your favorite color and why?"
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
  
  const engineRef = useRef<MLCEngine | null>(null);
  const isRunningRef = useRef(false);
  const tokensSinceLastTickRef = useRef(0);
  
  const createNode = useCreateNode();
  const ws = useWebSocket();

  // Handle reporting stats periodically
  useEffect(() => {
    if (status !== "computing") return;
    
    const interval = setInterval(() => {
      const currentTps = tokensSinceLastTickRef.current;
      setTokensPerSecond(currentTps);
      tokensSinceLastTickRef.current = 0; // Reset for next second
      
      // Emit stats to backend if registered
      if (nodeId && ws.connected) {
        ws.emit("stats", {
          tokensGenerated: currentTps, // We can send delta or total, schema implies maybe we send whatever we want and backend accumulates. Wait, schema says: stats: z.object({ tokensGenerated: z.number(), tokensPerSecond: z.number() })
          // Assuming backend wants total tokens for this session update, or delta. Let's send current session total and TPS.
          tokensPerSecond: currentTps
        });
      }
    }, 1000);
    
    return () => clearInterval(interval);
  }, [status, nodeId, ws]);

  const stopCompute = useCallback(async () => {
    isRunningRef.current = false;
    setStatus("offline");
    setTokensPerSecond(0);
    setProgressText("");
    
    // In a real robust app we might need to fully destroy the engine if we want to release memory, 
    // but for now we just stop the generation loop.
  }, []);

  const runGenerationLoop = useCallback(async () => {
    if (!engineRef.current) return;
    
    setStatus("computing");
    isRunningRef.current = true;
    
    while (isRunningRef.current) {
      try {
        const stream = await engineRef.current.chat.completions.create({
          messages: [{ role: "user", content: getRandomPrompt() }],
          stream: true,
          // Low max_tokens to keep iterations fast and responsive
          max_tokens: 50, 
        });

        for await (const chunk of stream) {
          if (!isRunningRef.current) break;
          // We assume 1 chunk roughly equals 1 token for streaming.
          // WebLLM doesn't perfectly expose live usage stats per chunk, so we estimate.
          setSessionTokens(prev => prev + 1);
          tokensSinceLastTickRef.current += 1;
        }
        
      } catch (err) {
        console.error("Generation error:", err);
        if (isRunningRef.current) {
          // Pause briefly on error before retrying
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }
  }, []);

  const startCompute = useCallback(async () => {
    try {
      setStatus("loading");
      setProgressText("Initializing engine...");
      
      // 1. Register Node if we haven't
      let currentId = nodeId;
      if (!currentId) {
        const newNode = await createNode.mutateAsync({
          name: `Node-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`,
          status: "computing"
        });
        currentId = newNode.id;
        setNodeId(newNode.id);
        setNodeName(newNode.name);
        
        if (ws.connected) {
          ws.emit("nodeJoined", { id: newNode.id });
        }
      }

      // 2. Load Model if not loaded
      if (!engineRef.current) {
        engineRef.current = await CreateMLCEngine(
          MODEL_ID,
          {
            initProgressCallback: (progress) => {
              setProgressText(progress.text);
            }
          }
        );
      }

      // 3. Start Loop
      runGenerationLoop();
      
    } catch (err) {
      console.error("Failed to start compute:", err);
      setStatus("error");
      setProgressText(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }, [nodeId, createNode, ws, runGenerationLoop]);

  return {
    status,
    progressText,
    sessionTokens,
    tokensPerSecond,
    nodeId,
    nodeName,
    startCompute,
    stopCompute,
    wsConnected: ws.connected
  };
}
