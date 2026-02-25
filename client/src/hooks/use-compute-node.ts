import { useState, useRef, useEffect, useCallback } from "react";
import { CreateMLCEngine, MLCEngine } from "@mlc-ai/web-llm";
import { useCreateNode } from "./use-nodes";
import { useWebSocket } from "./use-websocket";
import { DEFAULT_MODEL_ID } from "@/lib/models";

export type ComputeStatus = "offline" | "loading" | "computing" | "error";

const IDLE_PROMPTS = [
  "What does decentralized AI inference mean for the future of computing?",
  "How does browser-based AI compare to cloud-based AI in terms of privacy?",
  "Write a brief thought about collective intelligence networks.",
  "What philosophical implications does distributed consciousness have?",
  "How might peer-to-peer AI change the relationship between users and technology?",
  "Describe the concept of emergent intelligence from networked compute nodes.",
  "What role does trust play in decentralized systems?",
  "How does the Wired connect all forms of consciousness?",
];

function getIdlePrompt() {
  return IDLE_PROMPTS[Math.floor(Math.random() * IDLE_PROMPTS.length)];
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
        const prompt = chatPrompt || getIdlePrompt();
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

        if (isChat && fullResponse && nodeIdRef.current && nodeNameRef.current) {
          ws.emit("chatResponse", {
            content: fullResponse,
            nodeId: nodeIdRef.current,
            nodeName: nodeNameRef.current,
          });
        }
      } catch (err) {
        console.error("Generation error:", err);
        if (isRunningRef.current) {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    }
  }, [ws]);

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
