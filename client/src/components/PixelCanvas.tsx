import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useWebSocket } from "@/hooks/use-websocket";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Coins, Paintbrush, Minus, Plus, RotateCcw, MapPin, Crosshair, X, MessageCircle, ZoomIn, Grid3X3, Zap, Globe } from "lucide-react";
import { getBiomeByColor, BIOMES } from "@shared/biomes";

const CANVAS_SIZE = 32;
const CELL_SIZE = 16;

const NODE_MARKER_COLORS = [
  "#FF4444", "#44FF44", "#4444FF", "#FFAA00", "#FF44FF", "#44FFFF",
  "#FF8866", "#66FF88", "#8866FF", "#FFFF44",
];

const BUBBLE_DURATION = 8000;
const MAX_BUBBLE_CHARS = 120;

interface SpeechBubble {
  nodeId: number;
  text: string;
  timestamp: number;
}

interface NodeGoal {
  nodeId: number;
  nodeName: string;
  description: string;
  targetX: number;
  targetY: number;
  color: string;
}

type AvatarGrid = string[][];

interface PixelCanvasProps {
  nodeId: number | null;
  autoFollow?: boolean;
}

interface PixelHistoryEntry {
  id: number;
  nodeName: string;
  content: string;
  createdAt: string;
}

export function PixelCanvas({ nodeId, autoFollow = false }: PixelCanvasProps) {
  const [, navigate] = useLocation();
  const [hoveredCell, setHoveredCell] = useState<{ x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [nodePositions, setNodePositions] = useState<Map<number, { x: number; y: number; name: string }>>(new Map());
  const [wallPositions, setWallPositions] = useState<Map<number, { x: number; y: number }>>(new Map());
  const [speechBubbles, setSpeechBubbles] = useState<SpeechBubble[]>([]);
  const [nodeGoals, setNodeGoals] = useState<Map<number, NodeGoal>>(new Map());
  const [nodeAvatars, setNodeAvatars] = useState<Map<number, AvatarGrid>>(new Map());
  const [following, setFollowing] = useState(autoFollow);
  const [selectedPixel, setSelectedPixel] = useState<{ x: number; y: number } | null>(null);
  const [energyTransferTarget, setEnergyTransferTarget] = useState<{ nodeId: number; nodeName: string } | null>(null);
  const [transferAmount, setTransferAmount] = useState(1);
  const [wallPushTarget, setWallPushTarget] = useState<{ wallId: number; wallX: number; wallY: number } | null>(null);
  const [wallPushDirection, setWallPushDirection] = useState<"up" | "down" | "left" | "right">("up");
  const [zoomedRegion, setZoomedRegion] = useState<{ x: number; y: number } | null>(null);
  const [showBiomeLegend, setShowBiomeLegend] = useState(false);
  const [liveSubPixels, setLiveSubPixels] = useState<Map<string, { color: string; nodeName: string }>>(new Map());
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const mouseDownPosRef = useRef({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ws = useWebSocket();

  const creditsQuery = useQuery<{ pixelCredits: number; pixelsPlaced: number; totalTokens: number; tokensSinceLastCredit: number; currentRate: number; pixelX: number; pixelY: number }>({
    queryKey: ["/api/canvas/credits", nodeId?.toString() ?? ""],
    enabled: !!nodeId,
    refetchInterval: 5000,
  });

  const canvasQuery = useQuery<{ size: number; grid: string[][]; totalPlacements: number; uniqueAgents: number }>({
    queryKey: ["/api/canvas"],
    refetchInterval: 10000,
  });

  const rateQuery = useQuery<{ rate: number; totalNetworkTokens: number }>({
    queryKey: ["/api/network/rate"],
    refetchInterval: 15000,
  });

  const [nodeCredits, setNodeCredits] = useState<Map<number, number>>(new Map());

  const wallPushMutation = useMutation({
    mutationFn: async ({ wallId, direction }: { wallId: number; direction: string }) => {
      if (!nodeId) throw new Error("No node connected");
      const nodeToken = localStorage.getItem(`neurocompute_nodeToken_${nodeId}`);
      if (!nodeToken) throw new Error("Session token not found — reconnect to continue");
      return apiRequest("POST", `/api/walls/${wallId}/push`, { nodeId, direction, nodeToken });
    },
    onSuccess: () => {
      setWallPushTarget(null);
    },
  });

  const energyTransferMutation = useMutation({
    mutationFn: async ({ toNodeId, amount }: { toNodeId: number; amount: number }) => {
      if (!nodeId) throw new Error("No node connected");
      const nodeToken = localStorage.getItem(`neurocompute_nodeToken_${nodeId}`);
      if (!nodeToken) throw new Error("Session token not found — reconnect to continue");
      return apiRequest("POST", `/api/nodes/${nodeId}/transfer-energy`, { toNodeId, amount, nodeToken });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/nodes"] });
      setEnergyTransferTarget(null);
      setTransferAmount(1);
    },
  });

  const nodesQuery = useQuery<{ id: number; name: string; displayName: string | null; pixelX: number; pixelY: number; pixelGoal: string | null; avatar: string | null; status: string; pixelCredits?: number }[]>({
    queryKey: ["/api/nodes"],
    refetchInterval: 10000,
  });

  const pixelHistoryQuery = useQuery<PixelHistoryEntry[]>({
    queryKey: ["/api/journal/pixel", selectedPixel?.x, selectedPixel?.y],
    queryFn: async () => {
      if (!selectedPixel) return [];
      const res = await fetch(`/api/journal/pixel?x=${selectedPixel.x}&y=${selectedPixel.y}`);
      if (!res.ok) throw new Error("Failed to fetch pixel history");
      return res.json();
    },
    enabled: selectedPixel !== null,
  });

  const regionsQuery = useQuery<{ regions: { regionX: number; regionY: number; count: number }[] }>({
    queryKey: ["/api/canvas/sub/regions"],
    refetchInterval: 30000,
  });

  const wallsQuery = useQuery<{ id: number; x: number; y: number }[]>({
    queryKey: ["/api/walls"],
    refetchInterval: 60000,
  });

  const subPixelQuery = useQuery<{ regionX: number; regionY: number; pixels: { id: number; subX: number; subY: number; color: string; nodeName: string }[] }>({
    queryKey: ["/api/canvas/sub", zoomedRegion?.x, zoomedRegion?.y],
    queryFn: async () => {
      if (!zoomedRegion) return { regionX: 0, regionY: 0, pixels: [] };
      const res = await fetch(`/api/canvas/sub?rx=${zoomedRegion.x}&ry=${zoomedRegion.y}`);
      if (!res.ok) throw new Error("Failed to fetch sub-pixels");
      return res.json();
    },
    enabled: zoomedRegion !== null,
  });

  useEffect(() => {
    if (wallsQuery.data) {
      const wMap = new Map<number, { x: number; y: number }>();
      for (const w of wallsQuery.data) wMap.set(w.id, { x: w.x, y: w.y });
      setWallPositions(wMap);
    }
  }, [wallsQuery.data]);

  useEffect(() => {
    const unsub = ws.subscribe("statsUpdate", (data: { id: number; pixelCredits?: number }) => {
      if (typeof data.id === "number" && typeof data.pixelCredits === "number") {
        setNodeCredits(prev => { const next = new Map(prev); next.set(data.id, data.pixelCredits!); return next; });
      }
    });
    return unsub;
  }, [ws]);

  useEffect(() => {
    if (nodesQuery.data) {
      const posMap = new Map<number, { x: number; y: number; name: string }>();
      const goalMap = new Map<number, NodeGoal>();
      const avatarMap = new Map<number, AvatarGrid>();
      const creditsMap = new Map<number, number>();
      for (const n of nodesQuery.data) {
        if (n.status === "computing") {
          posMap.set(n.id, { x: n.pixelX, y: n.pixelY, name: n.displayName || n.name });
          if (typeof n.pixelCredits === "number") creditsMap.set(n.id, n.pixelCredits);
          if (n.pixelGoal) {
            try {
              const g = JSON.parse(n.pixelGoal);
              goalMap.set(n.id, { nodeId: n.id, nodeName: n.displayName || n.name, description: g.description, targetX: g.targetX, targetY: g.targetY, color: g.color });
            } catch {}
          }
          if (n.avatar) {
            try {
              const a = JSON.parse(n.avatar);
              if (Array.isArray(a) && a.length === 8) avatarMap.set(n.id, a);
            } catch {}
          }
        }
      }
      setNodePositions(posMap);
      setNodeGoals(goalMap);
      setNodeCredits(prev => {
        const merged = new Map(prev);
        creditsMap.forEach((v, k) => merged.set(k, v));
        return merged;
      });
      setNodeAvatars(prev => {
        const merged = new Map(prev);
        avatarMap.forEach((v, k) => merged.set(k, v));
        return merged;
      });
    }
  }, [nodesQuery.data]);

  useEffect(() => {
    const unsub = ws.subscribe("nodeMoved", (data: { nodeId: number; nodeName: string; x: number; y: number }) => {
      setNodePositions(prev => {
        const next = new Map(prev);
        next.set(data.nodeId, { x: data.x, y: data.y, name: data.nodeName });
        return next;
      });
    });
    return unsub;
  }, [ws]);

  useEffect(() => {
    const unsub = ws.subscribe("journalEntry", (data: { nodeId: number | null; nodeName: string; content: string }) => {
      if (!data.nodeId) return;
      const text = data.content.length > MAX_BUBBLE_CHARS
        ? data.content.slice(0, MAX_BUBBLE_CHARS) + "..."
        : data.content;
      setSpeechBubbles(prev => {
        const filtered = prev.filter(b => b.nodeId !== data.nodeId);
        return [...filtered, { nodeId: data.nodeId!, text, timestamp: Date.now() }];
      });
    });
    return unsub;
  }, [ws]);

  useEffect(() => {
    const unsub = ws.subscribe("nodeGoalSet", (data: { nodeId: number; nodeName: string; description: string; targetX: number; targetY: number; color: string }) => {
      setNodeGoals(prev => {
        const next = new Map(prev);
        next.set(data.nodeId, data);
        return next;
      });
    });
    return unsub;
  }, [ws]);

  useEffect(() => {
    const unsub = ws.subscribe("avatarUpdate", (data: { nodeId: number; avatar: string[][] }) => {
      setNodeAvatars(prev => {
        const next = new Map(prev);
        next.set(data.nodeId, data.avatar);
        return next;
      });
    });
    return unsub;
  }, [ws]);

  useEffect(() => {
    const unsub = ws.subscribe("nodeGoalCleared", (data: { nodeId: number }) => {
      setNodeGoals(prev => {
        if (!prev.has(data.nodeId)) return prev;
        const next = new Map(prev);
        next.delete(data.nodeId);
        return next;
      });
    });
    return unsub;
  }, [ws]);

  useEffect(() => {
    const unsub = ws.subscribe("wallAdded", (data: { id: number; x: number; y: number }) => {
      setWallPositions(prev => { const next = new Map(prev); next.set(data.id, { x: data.x, y: data.y }); return next; });
    });
    return unsub;
  }, [ws]);

  useEffect(() => {
    const unsub = ws.subscribe("wallMoved", (data: { id: number; fromX: number; fromY: number; toX: number; toY: number }) => {
      setWallPositions(prev => { const next = new Map(prev); next.set(data.id, { x: data.toX, y: data.toY }); return next; });
    });
    return unsub;
  }, [ws]);

  useEffect(() => {
    const unsub = ws.subscribe("subPixelPlaced", (data: { regionX: number; regionY: number; subX: number; subY: number; color: string; nodeName: string }) => {
      if (zoomedRegion && data.regionX === zoomedRegion.x && data.regionY === zoomedRegion.y) {
        setLiveSubPixels(prev => {
          const next = new Map(prev);
          next.set(`${data.subX}:${data.subY}`, { color: data.color, nodeName: data.nodeName });
          return next;
        });
      }
    });
    return unsub;
  }, [ws, zoomedRegion]);

  useEffect(() => {
    if (subPixelQuery.data?.pixels) {
      const m = new Map<string, { color: string; nodeName: string }>();
      for (const p of subPixelQuery.data.pixels) {
        m.set(`${p.subX}:${p.subY}`, { color: p.color, nodeName: p.nodeName });
      }
      setLiveSubPixels(m);
    }
  }, [subPixelQuery.data]);

  useEffect(() => {
    const interval = setInterval(() => {
      setSpeechBubbles(prev => {
        const now = Date.now();
        const filtered = prev.filter(b => now - b.timestamp < BUBBLE_DURATION);
        return filtered.length !== prev.length ? filtered : prev;
      });
    }, 500);
    return () => clearInterval(interval);
  }, []);

  const myPos = creditsQuery.data ? { x: creditsQuery.data.pixelX, y: creditsQuery.data.pixelY } : null;
  const credits = creditsQuery.data?.pixelCredits ?? 0;
  const pixelsPlaced = creditsQuery.data?.pixelsPlaced ?? 0;
  const currentRate = creditsQuery.data?.currentRate ?? rateQuery.data?.rate ?? 10;
  const tokensSinceLastCredit = creditsQuery.data?.tokensSinceLastCredit ?? 0;
  const tokensToNextCredit = currentRate - tokensSinceLastCredit;
  const totalPlacements = canvasQuery.data?.totalPlacements ?? 0;
  const uniqueAgents = canvasQuery.data?.uniqueAgents ?? 0;
  const activeNodeCount = nodesQuery.data?.filter(n => n.status === "computing").length ?? 0;
  const totalNetworkTokens = rateQuery.data?.totalNetworkTokens ?? 0;

  useEffect(() => {
    if (following && myPos && canvasRef.current) {
      const canvas = canvasRef.current;
      const centerPixelX = myPos.x * CELL_SIZE + CELL_SIZE / 2;
      const centerPixelY = myPos.y * CELL_SIZE + CELL_SIZE / 2;
      const targetPanX = -(centerPixelX - canvas.width / 2) * zoom;
      const targetPanY = -(centerPixelY - canvas.height / 2) * zoom;
      setPan(prev => {
        const dx = targetPanX - prev.x;
        const dy = targetPanY - prev.y;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return prev;
        return {
          x: prev.x + dx * 0.3,
          y: prev.y + dy * 0.3,
        };
      });
    }
  }, [following, myPos, zoom]);

  const centerOnNode = useCallback(() => {
    if (myPos && canvasRef.current) {
      const canvas = canvasRef.current;
      const centerPixelX = myPos.x * CELL_SIZE + CELL_SIZE / 2;
      const centerPixelY = myPos.y * CELL_SIZE + CELL_SIZE / 2;
      setPan({
        x: -(centerPixelX - canvas.width / 2) * zoom,
        y: -(centerPixelY - canvas.height / 2) * zoom,
      });
      setFollowing(true);
    }
  }, [myPos, zoom]);

  const myGoal = nodeId ? nodeGoals.get(nodeId) : null;

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    ctx.save();
    ctx.translate(pan.x + w / 2, pan.y + h / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-w / 2, -h / 2);

    ctx.fillStyle = "#0a0a0f";
    ctx.fillRect(0, 0, CANVAS_SIZE * CELL_SIZE, CANVAS_SIZE * CELL_SIZE);

    const grid = canvasQuery.data?.grid;
    if (Array.isArray(grid)) {
      for (let y = 0; y < grid.length; y++) {
        for (let x = 0; x < grid[y].length; x++) {
          const color = grid[y][x];
          if (color && color !== "#000000") {
            ctx.fillStyle = color;
            ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
          }
        }
      }
    }

    // Draw walls as dark stone tiles
    wallPositions.forEach(pos => {
      const wx = pos.x * CELL_SIZE;
      const wy = pos.y * CELL_SIZE;
      ctx.fillStyle = "#1e1a16";
      ctx.fillRect(wx, wy, CELL_SIZE, CELL_SIZE);
      ctx.strokeStyle = "#5c4a30";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(wx + 0.75, wy + 0.75, CELL_SIZE - 1.5, CELL_SIZE - 1.5);
      ctx.strokeStyle = "#3a2e1e";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(wx, wy); ctx.lineTo(wx + CELL_SIZE, wy + CELL_SIZE);
      ctx.moveTo(wx + CELL_SIZE * 0.5, wy); ctx.lineTo(wx + CELL_SIZE, wy + CELL_SIZE * 0.5);
      ctx.moveTo(wx, wy + CELL_SIZE * 0.5); ctx.lineTo(wx + CELL_SIZE * 0.5, wy + CELL_SIZE);
      ctx.stroke();
      ctx.fillStyle = "#8B6914";
      ctx.font = "bold 7px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("▓", wx + CELL_SIZE / 2, wy + CELL_SIZE / 2);
      ctx.textBaseline = "alphabetic";
    });

    ctx.strokeStyle = "rgba(0, 255, 255, 0.08)";
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= CANVAS_SIZE; i++) {
      ctx.beginPath();
      ctx.moveTo(i * CELL_SIZE, 0);
      ctx.lineTo(i * CELL_SIZE, CANVAS_SIZE * CELL_SIZE);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * CELL_SIZE);
      ctx.lineTo(CANVAS_SIZE * CELL_SIZE, i * CELL_SIZE);
      ctx.stroke();
    }

    nodeGoals.forEach((goal, gNodeId) => {
      const nodePos = nodePositions.get(gNodeId) || (gNodeId === nodeId && myPos ? { x: myPos.x, y: myPos.y } : null);
      if (!nodePos) return;

      const fromX = nodePos.x * CELL_SIZE + CELL_SIZE / 2;
      const fromY = nodePos.y * CELL_SIZE + CELL_SIZE / 2;
      const toX = goal.targetX * CELL_SIZE + CELL_SIZE / 2;
      const toY = goal.targetY * CELL_SIZE + CELL_SIZE / 2;

      ctx.save();
      ctx.strokeStyle = goal.color + "55";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(fromX, fromY);
      ctx.lineTo(toX, toY);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = goal.color + "44";
      ctx.strokeStyle = goal.color + "88";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(toX, toY, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = goal.color;
      ctx.font = "4px monospace";
      ctx.textAlign = "center";
      const goalLabel = goal.description.length > 20 ? goal.description.slice(0, 18) + ".." : goal.description;
      ctx.fillText(goalLabel, toX, toY + 8);
      ctx.restore();
    });

    // Highlight nodes within spatial chat range (Manhattan distance ≤ 8) of my node
    if (myPos) {
      nodePositions.forEach((pos, nId) => {
        if (nId === nodeId) return;
        const dist = Math.abs(pos.x - myPos.x) + Math.abs(pos.y - myPos.y);
        if (dist <= 8) {
          ctx.strokeStyle = "rgba(0,255,160,0.35)";
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 2]);
          ctx.strokeRect(pos.x * CELL_SIZE - 2, pos.y * CELL_SIZE - 2, CELL_SIZE + 4, CELL_SIZE + 4);
          ctx.setLineDash([]);
        }
      });
    }

    let markerIdx = 0;
    const allNodes = new Map(nodePositions);
    if (myPos && nodeId) {
      allNodes.set(nodeId, { x: myPos.x, y: myPos.y, name: "You" });
    }

    allNodes.forEach((pos, nId) => {
      const isMe = nId === nodeId;
      const mc = isMe ? "#00FF00" : NODE_MARKER_COLORS[markerIdx % NODE_MARKER_COLORS.length];
      if (!isMe) markerIdx++;

      const px = pos.x * CELL_SIZE;
      const py = pos.y * CELL_SIZE;
      const avatar = nodeAvatars.get(nId);

      if (avatar && avatar.length === 8) {
        const pixSize = CELL_SIZE / 8;
        for (let ay = 0; ay < 8; ay++) {
          for (let ax = 0; ax < 8; ax++) {
            const c = avatar[ay]?.[ax];
            if (c && c !== "#000000") {
              ctx.fillStyle = c;
              ctx.fillRect(px + ax * pixSize, py + ay * pixSize, pixSize, pixSize);
            }
          }
        }
        if (isMe) {
          ctx.strokeStyle = "#00FF00";
          ctx.lineWidth = 2;
          ctx.strokeRect(px - 1, py - 1, CELL_SIZE + 2, CELL_SIZE + 2);
          ctx.strokeStyle = "#00FF0066";
          ctx.lineWidth = 1;
          ctx.strokeRect(px - 3, py - 3, CELL_SIZE + 6, CELL_SIZE + 6);
        } else {
          ctx.strokeStyle = mc + "88";
          ctx.lineWidth = 1;
          ctx.strokeRect(px, py, CELL_SIZE, CELL_SIZE);
        }
      } else {
        ctx.strokeStyle = mc;
        ctx.lineWidth = isMe ? 2.5 : 2;
        ctx.strokeRect(px + (isMe ? 0 : 1), py + (isMe ? 0 : 1), CELL_SIZE - (isMe ? 0 : 2), CELL_SIZE - (isMe ? 0 : 2));

        if (isMe) {
          ctx.strokeStyle = "#00FF0088";
          ctx.lineWidth = 1;
          ctx.strokeRect(px - 2, py - 2, CELL_SIZE + 4, CELL_SIZE + 4);
        }

        ctx.fillStyle = mc;
        ctx.beginPath();
        ctx.arc(px + CELL_SIZE / 2, py + CELL_SIZE / 2, isMe ? 2.5 : 2, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = isMe ? "#00FF00" : "#FFFFFF";
      ctx.font = `bold ${isMe ? 7 : 6}px monospace`;
      ctx.textAlign = "center";
      const label = isMe ? "YOU" : (pos.name.length > 10 ? pos.name.slice(0, 9) + "…" : pos.name);

      const labelWidth = ctx.measureText(label).width;
      const labelX = px + CELL_SIZE / 2;
      const labelY = py - 3;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(labelX - labelWidth / 2 - 2, labelY - 6, labelWidth + 4, 8);
      ctx.fillStyle = isMe ? "#00FF00" : mc;
      ctx.fillText(label, labelX, labelY);

      // Per-node energy (pixelCredits) indicator
      const knownCredits = isMe ? credits : nodeCredits.get(nId);
      if (knownCredits !== undefined) {
        const creditLabel = `⚡${knownCredits}`;
        ctx.font = "5px monospace";
        ctx.textAlign = "center";
        const creditW = ctx.measureText(creditLabel).width;
        const creditY = labelY - 8;
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(labelX - creditW / 2 - 1, creditY - 5, creditW + 2, 6);
        ctx.fillStyle = knownCredits > 0 ? "#FFD700" : "#FF6666";
        ctx.fillText(creditLabel, labelX, creditY);
      }

      const bubble = speechBubbles.find(b => b.nodeId === nId);
      if (bubble) {
        const age = Date.now() - bubble.timestamp;
        const opacity = Math.min(1, Math.max(0, 1 - (age / BUBBLE_DURATION) * 0.5));

        ctx.save();
        ctx.globalAlpha = opacity;

        const bubbleText = bubble.text;
        const fontSize = 9;
        const maxWrapWidth = 160;
        ctx.font = `bold ${fontSize}px sans-serif`;
        const lines: string[] = [];
        const words = bubbleText.split(" ");
        let currentLine = "";
        for (const word of words) {
          const test = currentLine ? currentLine + " " + word : word;
          if (ctx.measureText(test).width > maxWrapWidth) {
            if (currentLine) lines.push(currentLine);
            currentLine = word;
          } else {
            currentLine = test;
          }
        }
        if (currentLine) lines.push(currentLine);
        if (lines.length > 5) {
          lines.length = 5;
          lines[4] = lines[4].slice(0, -3) + "...";
        }

        const lineHeight = fontSize + 3;
        const padding = 6;
        const maxWidth = Math.max(...lines.map(l => ctx.measureText(l).width));
        const bubbleW = maxWidth + padding * 2;
        const bubbleH = lines.length * lineHeight + padding * 2;
        let bubbleX = px + CELL_SIZE / 2 - bubbleW / 2;
        let bubbleY = py - bubbleH - 12;
        const canvasW = CANVAS_SIZE * CELL_SIZE;
        const canvasH = CANVAS_SIZE * CELL_SIZE;
        if (bubbleY < 0) bubbleY = py + CELL_SIZE + 6;
        if (bubbleX < 2) bubbleX = 2;
        if (bubbleX + bubbleW > canvasW - 2) bubbleX = canvasW - bubbleW - 2;
        if (bubbleY + bubbleH > canvasH - 2) bubbleY = canvasH - bubbleH - 2;

        ctx.fillStyle = "rgba(0,0,0,0.9)";
        ctx.beginPath();
        const r = 5;
        ctx.moveTo(bubbleX + r, bubbleY);
        ctx.lineTo(bubbleX + bubbleW - r, bubbleY);
        ctx.quadraticCurveTo(bubbleX + bubbleW, bubbleY, bubbleX + bubbleW, bubbleY + r);
        ctx.lineTo(bubbleX + bubbleW, bubbleY + bubbleH - r);
        ctx.quadraticCurveTo(bubbleX + bubbleW, bubbleY + bubbleH, bubbleX + bubbleW - r, bubbleY + bubbleH);
        ctx.lineTo(bubbleX + r, bubbleY + bubbleH);
        ctx.quadraticCurveTo(bubbleX, bubbleY + bubbleH, bubbleX, bubbleY + bubbleH - r);
        ctx.lineTo(bubbleX, bubbleY + r);
        ctx.quadraticCurveTo(bubbleX, bubbleY, bubbleX + r, bubbleY);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = mc;
        ctx.lineWidth = 1;
        ctx.stroke();

        const tailX = px + CELL_SIZE / 2;
        const tailClamp = Math.max(bubbleX + 8, Math.min(bubbleX + bubbleW - 8, tailX));
        ctx.beginPath();
        ctx.moveTo(tailClamp - 4, bubbleY + bubbleH);
        ctx.lineTo(tailClamp, bubbleY + bubbleH + 6);
        ctx.lineTo(tailClamp + 4, bubbleY + bubbleH);
        ctx.fillStyle = "rgba(0,0,0,0.9)";
        ctx.fill();

        ctx.fillStyle = "#FFFFFF";
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.textAlign = "left";
        for (let i = 0; i < lines.length; i++) {
          ctx.fillText(lines[i], bubbleX + padding, bubbleY + padding + (i + 1) * lineHeight - 2);
        }

        ctx.restore();
      }
    });

    const regionsWithSub = regionsQuery.data?.regions;
    if (regionsWithSub && regionsWithSub.length > 0) {
      for (const region of regionsWithSub) {
        const rx = region.regionX * CELL_SIZE;
        const ry = region.regionY * CELL_SIZE;
        ctx.fillStyle = "rgba(180, 140, 255, 0.7)";
        ctx.beginPath();
        ctx.arc(rx + CELL_SIZE - 3.5, ry + 3.5, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (selectedPixel) {
      ctx.strokeStyle = "rgba(59,130,246,0.9)";
      ctx.lineWidth = 2;
      ctx.strokeRect(selectedPixel.x * CELL_SIZE - 1, selectedPixel.y * CELL_SIZE - 1, CELL_SIZE + 2, CELL_SIZE + 2);
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 1;
      ctx.strokeRect(selectedPixel.x * CELL_SIZE, selectedPixel.y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    }

    if (hoveredCell) {
      ctx.strokeStyle = "rgba(255,255,255,0.3)";
      ctx.lineWidth = 1;
      ctx.strokeRect(hoveredCell.x * CELL_SIZE, hoveredCell.y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    }

    ctx.restore();
  }, [canvasQuery.data, hoveredCell, selectedPixel, zoom, pan, myPos, nodePositions, nodeId, credits, speechBubbles, nodeGoals, nodeAvatars, regionsQuery.data, wallPositions, nodeCredits]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  const getCellFromEvent = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const px = mx * scaleX;
    const py = my * scaleY;
    const cx = (px - pan.x - canvas.width / 2) / zoom + canvas.width / 2;
    const cy = (py - pan.y - canvas.height / 2) / zoom + canvas.height / 2;
    const cellX = Math.floor(cx / CELL_SIZE);
    const cellY = Math.floor(cy / CELL_SIZE);
    if (cellX < 0 || cellX >= CANVAS_SIZE || cellY < 0 || cellY >= CANVAS_SIZE) return null;
    return { x: cellX, y: cellY };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanning) {
      setPan({
        x: panStartRef.current.panX + (e.clientX - panStartRef.current.x),
        y: panStartRef.current.panY + (e.clientY - panStartRef.current.y),
      });
      return;
    }
    setHoveredCell(getCellFromEvent(e));
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button === 0 || e.button === 1 || e.button === 2) {
      setIsPanning(true);
      setFollowing(false);
      panStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
      mouseDownPosRef.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanning) {
      const dx = Math.abs(e.clientX - mouseDownPosRef.current.x);
      const dy = Math.abs(e.clientY - mouseDownPosRef.current.y);
      if (dx < 4 && dy < 4) {
        const cell = getCellFromEvent(e);
        if (cell) {
          let clickedNodeId: number | null = null;
          nodePositions.forEach((pos, nId) => {
            if (pos.x === cell.x && pos.y === cell.y) clickedNodeId = nId;
          });
          if (!clickedNodeId && nodeId && myPos && myPos.x === cell.x && myPos.y === cell.y) {
            clickedNodeId = nodeId;
          }
          if (clickedNodeId !== null) {
            setIsPanning(false);
            // If the clicked node is cardinally adjacent to my node, offer energy transfer
            if (nodeId && myPos && clickedNodeId !== nodeId) {
              const pos = nodePositions.get(clickedNodeId);
              if (pos) {
                const dist = Math.abs(pos.x - myPos.x) + Math.abs(pos.y - myPos.y);
                if (dist === 1) {
                  setEnergyTransferTarget({ nodeId: clickedNodeId, nodeName: pos.name });
                  setTransferAmount(1);
                  return;
                }
              }
            }
            navigate(`/node/${clickedNodeId}`);
            return;
          }
          // Check if clicked cell has a wall cardinally adjacent to my node
          if (nodeId && myPos) {
            let clickedWallId: number | null = null;
            wallPositions.forEach((pos, wId) => {
              if (pos.x === cell.x && pos.y === cell.y) clickedWallId = wId;
            });
            if (clickedWallId !== null) {
              const wallDist = Math.abs(cell.x - myPos.x) + Math.abs(cell.y - myPos.y);
              if (wallDist === 1) {
                // Suggest push direction: opposite of from-node perspective
                const suggestedDir = cell.x > myPos.x ? "right" : cell.x < myPos.x ? "left" : cell.y > myPos.y ? "down" : "up";
                setWallPushTarget({ wallId: clickedWallId, wallX: cell.x, wallY: cell.y });
                setWallPushDirection(suggestedDir);
                return;
              }
            }
          }

          if (selectedPixel && selectedPixel.x === cell.x && selectedPixel.y === cell.y) {
            setSelectedPixel(null);
          } else {
            setSelectedPixel(cell);
          }
        }
      }
      setIsPanning(false);
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    setZoom((z) => Math.max(0.5, Math.min(6, z + (e.deltaY > 0 ? -0.3 : 0.3))));
  };

  const currentPixelColor = hoveredCell && canvasQuery.data?.grid
    ? canvasQuery.data.grid[hoveredCell.y]?.[hoveredCell.x] ?? "#000000"
    : null;

  return (
    <Card className="overflow-hidden border-primary/20">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {myPos && (
              <div className="flex items-center gap-1.5 text-xs">
                <MapPin className="w-3 h-3 text-green-400" />
                <span className="font-mono text-green-400" data-testid="text-node-position">({myPos.x},{myPos.y})</span>
              </div>
            )}
            {nodeId && (
              <div className="flex items-center gap-1.5 text-xs">
                <Coins className="w-3 h-3 text-primary" />
                <span className="font-mono text-primary" data-testid="text-pixel-credits">{credits}</span>
              </div>
            )}
            {nodeId && (
              <div className="flex items-center gap-1.5 text-xs">
                <Paintbrush className="w-3 h-3 text-fuchsia-400" />
                <span className="font-mono text-fuchsia-400" data-testid="text-pixels-placed">{pixelsPlaced}</span>
              </div>
            )}
            <span className="text-xs text-muted-foreground">
              {totalPlacements} px / {uniqueAgents} agent{uniqueAgents !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="flex items-center gap-0.5">
            {nodeId && (
              <Button
                variant={following ? "default" : "ghost"}
                size="icon"
                className="h-6 w-6"
                onClick={centerOnNode}
                title="Follow your node"
                aria-label="Follow your node"
                data-testid="button-follow-node"
              >
                <Crosshair className="w-3 h-3" />
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setZoom((z) => Math.max(0.5, z - 0.5))} data-testid="button-zoom-out">
              <Minus className="w-3 h-3" />
            </Button>
            <span className="text-[10px] font-mono w-8 text-center text-muted-foreground">{Math.round(zoom * 100)}%</span>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setZoom((z) => Math.min(6, z + 0.5))} data-testid="button-zoom-in">
              <Plus className="w-3 h-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); setFollowing(false); }} data-testid="button-zoom-reset">
              <RotateCcw className="w-3 h-3" />
            </Button>
            <Button
              variant={showBiomeLegend ? "default" : "ghost"}
              size="icon"
              className="h-6 w-6"
              onClick={() => setShowBiomeLegend(v => !v)}
              title="Toggle biome legend"
              data-testid="button-biome-legend-toggle"
            >
              <Globe className="w-3 h-3" />
            </Button>
          </div>
        </div>

        {myGoal && (
          <div className="flex items-center gap-2 text-xs bg-secondary/50 rounded px-2.5 py-1.5 border border-white/5" data-testid="text-current-goal">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: myGoal.color }} />
            <span className="text-muted-foreground truncate">
              <span className="text-foreground font-medium">Goal:</span> {myGoal.description}
              <span className="text-muted-foreground/60 ml-1">({myGoal.targetX},{myGoal.targetY})</span>
            </span>
          </div>
        )}

        <div className="relative rounded-lg overflow-hidden border border-white/10 bg-black/50" data-testid="canvas-grid">
          <canvas
            ref={canvasRef}
            width={CANVAS_SIZE * CELL_SIZE}
            height={CANVAS_SIZE * CELL_SIZE}
            className="w-full"
            style={{ imageRendering: "pixelated", cursor: isPanning ? "grabbing" : "crosshair", aspectRatio: "1/1" }}
            onMouseMove={handleMouseMove}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => { setHoveredCell(null); setIsPanning(false); }}
            onWheel={handleWheel}
            onContextMenu={(e) => e.preventDefault()}
          />

          {!nodeId && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/70 backdrop-blur-sm rounded-full px-3 py-1.5 border border-white/10" data-testid="badge-spectating">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              <span className="text-[10px] font-mono text-muted-foreground">Spectating</span>
            </div>
          )}

          {wallPushTarget && (
            <div className="absolute top-2 right-2 w-60 bg-black/90 backdrop-blur-md rounded-lg border border-stone-400/30 overflow-hidden" data-testid="panel-wall-push">
              <div className="flex items-center justify-between px-3 py-2 border-b border-stone-400/20">
                <span className="text-xs font-mono text-stone-300">▓ Push Wall ({wallPushTarget.wallX},{wallPushTarget.wallY})</span>
                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setWallPushTarget(null)} data-testid="button-close-wall-push">
                  <X className="w-3 h-3" />
                </Button>
              </div>
              <div className="px-3 py-3 space-y-3">
                <p className="text-[10px] text-muted-foreground">Another agent must push same direction within 3 seconds to move this wall.</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {(["up", "down", "left", "right"] as const).map(dir => (
                    <Button
                      key={dir}
                      variant={wallPushDirection === dir ? "default" : "outline"}
                      className="h-7 text-[11px] capitalize"
                      onClick={() => setWallPushDirection(dir)}
                      data-testid={`button-wall-push-dir-${dir}`}
                    >{dir}</Button>
                  ))}
                </div>
                <Button
                  className="w-full h-7 text-xs bg-stone-600 hover:bg-stone-500 text-white font-semibold"
                  onClick={() => wallPushMutation.mutate({ wallId: wallPushTarget.wallId, direction: wallPushDirection })}
                  disabled={wallPushMutation.isPending}
                  data-testid="button-wall-push-confirm"
                >
                  {wallPushMutation.isPending ? "Pushing…" : "Push Wall"}
                </Button>
                {wallPushMutation.isError && (
                  <p className="text-[10px] text-red-400" data-testid="text-wall-push-error">{(wallPushMutation.error as Error)?.message}</p>
                )}
                {wallPushMutation.isSuccess && (
                  <p className="text-[10px] text-green-400">Push registered! Waiting for second agent...</p>
                )}
              </div>
            </div>
          )}

          {energyTransferTarget && (
            <div className="absolute top-2 right-2 w-60 bg-black/90 backdrop-blur-md rounded-lg border border-yellow-400/30 overflow-hidden" data-testid="panel-energy-transfer">
              <div className="flex items-center justify-between px-3 py-2 border-b border-yellow-400/20">
                <div className="flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-yellow-400" />
                  <span className="text-xs font-mono text-yellow-300">Give Energy</span>
                </div>
                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setEnergyTransferTarget(null)} data-testid="button-close-energy-transfer">
                  <X className="w-3 h-3" />
                </Button>
              </div>
              <div className="px-3 py-3 space-y-3">
                <p className="text-[10px] text-muted-foreground">Transfer ⚡ to <span className="text-yellow-300 font-semibold">{energyTransferTarget.nodeName}</span></p>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="icon" className="h-6 w-6 shrink-0" onClick={() => setTransferAmount(a => Math.max(1, a - 1))} data-testid="button-transfer-amount-minus">
                    <Minus className="w-3 h-3" />
                  </Button>
                  <span className="text-sm font-mono text-yellow-300 flex-1 text-center" data-testid="text-transfer-amount">⚡ {transferAmount}</span>
                  <Button variant="outline" size="icon" className="h-6 w-6 shrink-0" onClick={() => setTransferAmount(a => Math.min(credits ?? 10, a + 1))} data-testid="button-transfer-amount-plus">
                    <Plus className="w-3 h-3" />
                  </Button>
                </div>
                <Button
                  className="w-full h-7 text-xs bg-yellow-600 hover:bg-yellow-500 text-black font-semibold"
                  onClick={() => energyTransferMutation.mutate({ toNodeId: energyTransferTarget.nodeId, amount: transferAmount })}
                  disabled={energyTransferMutation.isPending || !transferAmount}
                  data-testid="button-transfer-energy-confirm"
                >
                  {energyTransferMutation.isPending ? "Transferring…" : "Confirm Transfer"}
                </Button>
                {energyTransferMutation.isError && (
                  <p className="text-[10px] text-red-400" data-testid="text-transfer-error">{(energyTransferMutation.error as Error)?.message}</p>
                )}
              </div>
            </div>
          )}

          {selectedPixel && !zoomedRegion && !energyTransferTarget && (
            <div className="absolute top-2 right-2 w-64 max-h-[60%] bg-black/85 backdrop-blur-md rounded-lg border border-white/10 overflow-hidden flex flex-col" data-testid="panel-pixel-history">
              <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 shrink-0">
                <div className="flex items-center gap-2">
                  <MessageCircle className="w-3.5 h-3.5 text-primary" />
                  <span className="text-xs font-mono text-foreground">
                    Pixel ({selectedPixel.x}, {selectedPixel.y})
                  </span>
                  {canvasQuery.data?.grid?.[selectedPixel.y]?.[selectedPixel.x] && canvasQuery.data.grid[selectedPixel.y][selectedPixel.x] !== "#000000" && (
                    <span className="w-3 h-3 rounded-sm border border-white/20" style={{ backgroundColor: canvasQuery.data.grid[selectedPixel.y][selectedPixel.x] }} />
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 text-accent hover:text-accent/80"
                    onClick={() => setZoomedRegion({ x: selectedPixel.x, y: selectedPixel.y })}
                    title="Zoom into district"
                    data-testid="button-zoom-district"
                  >
                    <ZoomIn className="w-3 h-3" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setSelectedPixel(null)} data-testid="button-close-pixel-history">
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              </div>
              <div className="overflow-y-auto flex-1 px-3 py-2 space-y-2">
                {pixelHistoryQuery.isLoading ? (
                  <p className="text-[10px] text-muted-foreground text-center py-4">Loading history...</p>
                ) : !pixelHistoryQuery.data?.length ? (
                  <p className="text-[10px] text-muted-foreground text-center py-4">No activity recorded for this pixel yet</p>
                ) : (
                  pixelHistoryQuery.data.map(entry => (
                    <div key={entry.id} className="text-[10px] leading-relaxed" data-testid={`pixel-history-entry-${entry.id}`}>
                      <span className="font-semibold text-primary">{entry.nodeName}</span>
                      <span className="text-muted-foreground ml-1">{entry.content.replace(/🎨\s*\(\d+,\d+\)\s*/, "").replace(/🏗️\s*/, "")}</span>
                      <span className="block text-[9px] text-muted-foreground/50 mt-0.5">
                        {new Date(entry.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  ))
                )}
              </div>
              <div className="px-3 py-1.5 border-t border-white/5 shrink-0">
                <button
                  className="w-full text-[10px] text-accent/70 hover:text-accent flex items-center justify-center gap-1 py-0.5"
                  onClick={() => setZoomedRegion({ x: selectedPixel.x, y: selectedPixel.y })}
                  data-testid="button-zoom-district-footer"
                >
                  <ZoomIn className="w-2.5 h-2.5" />
                  Zoom into district ({selectedPixel.x},{selectedPixel.y})
                </button>
              </div>
            </div>
          )}

          {zoomedRegion && (
            <div className="absolute inset-2 bg-black/92 backdrop-blur-md rounded-lg border border-accent/30 flex flex-col overflow-hidden" data-testid="panel-sub-canvas">
              <div className="flex items-center justify-between px-3 py-2 border-b border-accent/20 shrink-0">
                <div className="flex items-center gap-2">
                  <Grid3X3 className="w-3.5 h-3.5 text-accent" />
                  <span className="text-xs font-mono text-foreground">
                    District ({zoomedRegion.x},{zoomedRegion.y})
                  </span>
                  <span className="text-[10px] text-muted-foreground">8×8 sub-pixels</span>
                  {canvasQuery.data?.grid?.[zoomedRegion.y]?.[zoomedRegion.x] && (
                    <span className="w-3 h-3 rounded-sm border border-white/20" style={{ backgroundColor: canvasQuery.data.grid[zoomedRegion.y][zoomedRegion.x] }} />
                  )}
                </div>
                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setZoomedRegion(null)} data-testid="button-close-sub-canvas">
                  <X className="w-3 h-3" />
                </Button>
              </div>
              <div className="flex-1 flex items-center justify-center p-4">
                <div className="flex flex-col gap-0.5">
                  {Array.from({ length: 8 }, (_, sy) => (
                    <div key={sy} className="flex gap-0.5">
                      {Array.from({ length: 8 }, (_, sx) => {
                        const key = `${sx}:${sy}`;
                        const sp = liveSubPixels.get(key);
                        return (
                          <div
                            key={sx}
                            title={sp ? `${sp.nodeName}` : "Empty"}
                            data-testid={`sub-pixel-${sx}-${sy}`}
                            className="w-8 h-8 rounded-sm border transition-all duration-300"
                            style={{
                              backgroundColor: sp ? sp.color : "rgba(255,255,255,0.04)",
                              borderColor: sp ? `${sp.color}44` : "rgba(255,255,255,0.08)",
                              boxShadow: sp ? `0 0 6px ${sp.color}33` : "none",
                            }}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
              <div className="px-3 py-2 border-t border-accent/10 shrink-0">
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>
                    <span className="text-foreground font-semibold">{liveSubPixels.size}</span> / 64 sub-pixels painted
                  </span>
                  {subPixelQuery.isLoading && <span className="text-accent/50 animate-pulse">Loading...</span>}
                  <span className="text-accent/50">· nodes paint here automatically</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {hoveredCell && (() => {
          const hovBiome = currentPixelColor && currentPixelColor !== "#000000"
            ? getBiomeByColor(currentPixelColor)
            : null;
          return (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-mono" data-testid="text-hover-coords">
                ({hoveredCell.x}, {hoveredCell.y})
                {currentPixelColor && currentPixelColor !== "#000000" && (
                  <span className="ml-2 inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-sm border border-white/20 inline-block" style={{ backgroundColor: currentPixelColor }} />
                    {hovBiome
                      ? <span className="text-foreground/80">{hovBiome.emoji} {hovBiome.name}</span>
                      : <span>{currentPixelColor}</span>
                    }
                  </span>
                )}
                {!currentPixelColor || currentPixelColor === "#000000"
                  ? <span className="ml-2 text-muted-foreground/40">empty</span>
                  : null
                }
                <span className="ml-2 text-muted-foreground/40">click → history</span>
              </span>
              {hovBiome && (
                <span className="text-[10px] text-muted-foreground/60 italic max-w-[45%] text-right truncate" title={hovBiome.description}>
                  {hovBiome.description}
                </span>
              )}
            </div>
          );
        })()}

        {showBiomeLegend && (
          <div className="grid grid-cols-3 gap-1 bg-black/40 rounded-lg border border-white/10 p-2" data-testid="panel-biome-legend">
            {BIOMES.map(b => (
              <div key={b.id} className="flex items-center gap-1.5 text-[10px]" title={b.description} data-testid={`biome-legend-${b.id}`}>
                <span className="w-3 h-3 rounded-sm border border-white/15 shrink-0" style={{ backgroundColor: b.color }} />
                <span className={`truncate ${b.passable ? "text-muted-foreground" : "text-muted-foreground/40 line-through"}`}>
                  {b.emoji} {b.name}
                </span>
              </div>
            ))}
            <div className="col-span-3 text-[9px] text-muted-foreground/40 pt-0.5 border-t border-white/5 mt-0.5">
              Strikethrough = impassable terrain
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 text-[10px] font-mono text-muted-foreground bg-secondary/30 rounded px-2.5 py-1.5 border border-white/5 flex-wrap" data-testid="bar-world-stats">
          <span className="flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${activeNodeCount > 0 ? "bg-primary animate-pulse" : "bg-muted-foreground/40"}`} />
            <span className="font-semibold text-foreground">{activeNodeCount}</span> node{activeNodeCount !== 1 ? "s" : ""} active
          </span>
          <span className="text-white/10">|</span>
          <span><span className="font-semibold text-foreground">{canvasQuery.data?.totalPlacements?.toLocaleString() ?? 0}</span> pixels placed</span>
          <span className="text-white/10">|</span>
          <span><span className="font-semibold text-foreground">{totalNetworkTokens.toLocaleString()}</span> tokens</span>
          <span className="text-white/10">|</span>
          <span><span className="font-semibold text-foreground">{currentRate}</span> tok/credit</span>
          <span className="text-white/10">|</span>
          <span title="Stone walls — cooperative push to move them"><span className="font-semibold text-foreground">{wallPositions.size}</span> walls</span>
          {nodeId && (
            <>
              <span className="text-white/10">|</span>
              <span className="text-amber-400/70" title="Each step costs 1 energy (credit)">⚡ 1/step</span>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
