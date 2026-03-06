import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useWebSocket } from "@/hooks/use-websocket";
import { Coins, Paintbrush, Minus, Plus, RotateCcw, MapPin, Info, Crosshair, X, MessageCircle } from "lucide-react";

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
  const [hoveredCell, setHoveredCell] = useState<{ x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [nodePositions, setNodePositions] = useState<Map<number, { x: number; y: number; name: string }>>(new Map());
  const [speechBubbles, setSpeechBubbles] = useState<SpeechBubble[]>([]);
  const [nodeGoals, setNodeGoals] = useState<Map<number, NodeGoal>>(new Map());
  const [nodeAvatars, setNodeAvatars] = useState<Map<number, AvatarGrid>>(new Map());
  const [following, setFollowing] = useState(autoFollow);
  const [selectedPixel, setSelectedPixel] = useState<{ x: number; y: number } | null>(null);
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

  const nodesQuery = useQuery<{ id: number; name: string; displayName: string | null; pixelX: number; pixelY: number; pixelGoal: string | null; avatar: string | null; status: string }[]>({
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

  useEffect(() => {
    if (nodesQuery.data) {
      const posMap = new Map<number, { x: number; y: number; name: string }>();
      const goalMap = new Map<number, NodeGoal>();
      const avatarMap = new Map<number, AvatarGrid>();
      for (const n of nodesQuery.data) {
        if (n.status === "computing") {
          posMap.set(n.id, { x: n.pixelX, y: n.pixelY, name: n.displayName || n.name });
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

      const bubble = speechBubbles.find(b => b.nodeId === nId);
      if (bubble) {
        const age = Date.now() - bubble.timestamp;
        const opacity = Math.min(1, Math.max(0, 1 - (age / BUBBLE_DURATION) * 0.5));

        ctx.save();
        ctx.globalAlpha = opacity;

        const bubbleText = bubble.text;
        ctx.font = "5px monospace";
        const lines: string[] = [];
        const words = bubbleText.split(" ");
        let currentLine = "";
        for (const word of words) {
          const test = currentLine ? currentLine + " " + word : word;
          if (ctx.measureText(test).width > 100) {
            if (currentLine) lines.push(currentLine);
            currentLine = word;
          } else {
            currentLine = test;
          }
        }
        if (currentLine) lines.push(currentLine);
        if (lines.length > 4) {
          lines.length = 4;
          lines[3] = lines[3].slice(0, -3) + "...";
        }

        const lineHeight = 6;
        const padding = 3;
        const maxWidth = Math.max(...lines.map(l => ctx.measureText(l).width));
        const bubbleW = maxWidth + padding * 2;
        const bubbleH = lines.length * lineHeight + padding * 2;
        let bubbleX = px + CELL_SIZE / 2 - bubbleW / 2;
        let bubbleY = py - bubbleH - 8;
        const canvasW = CANVAS_SIZE * CELL_SIZE;
        const canvasH = CANVAS_SIZE * CELL_SIZE;
        if (bubbleY < 0) bubbleY = py + CELL_SIZE + 4;
        if (bubbleX < 0) bubbleX = 0;
        if (bubbleX + bubbleW > canvasW) bubbleX = canvasW - bubbleW;
        if (bubbleY + bubbleH > canvasH) bubbleY = canvasH - bubbleH;

        ctx.fillStyle = "rgba(0,0,0,0.85)";
        ctx.beginPath();
        const r = 3;
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
        ctx.lineWidth = 0.5;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(px + CELL_SIZE / 2 - 3, bubbleY + bubbleH);
        ctx.lineTo(px + CELL_SIZE / 2, bubbleY + bubbleH + 4);
        ctx.lineTo(px + CELL_SIZE / 2 + 3, bubbleY + bubbleH);
        ctx.fillStyle = "rgba(0,0,0,0.85)";
        ctx.fill();

        ctx.fillStyle = "#FFFFFF";
        ctx.font = "5px monospace";
        ctx.textAlign = "left";
        for (let i = 0; i < lines.length; i++) {
          ctx.fillText(lines[i], bubbleX + padding, bubbleY + padding + (i + 1) * lineHeight - 1);
        }

        ctx.restore();
      }
    });

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
  }, [canvasQuery.data, hoveredCell, selectedPixel, zoom, pan, myPos, nodePositions, nodeId, speechBubbles, nodeGoals, nodeAvatars]);

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

          {selectedPixel && (
            <div className="absolute top-2 right-2 w-64 max-h-[50%] bg-black/85 backdrop-blur-md rounded-lg border border-white/10 overflow-hidden flex flex-col" data-testid="panel-pixel-history">
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
                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setSelectedPixel(null)} data-testid="button-close-pixel-history">
                  <X className="w-3 h-3" />
                </Button>
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
            </div>
          )}
        </div>

        {hoveredCell && (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="font-mono" data-testid="text-hover-coords">
              ({hoveredCell.x}, {hoveredCell.y})
              {currentPixelColor && currentPixelColor !== "#000000" && (
                <span className="ml-2 inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-sm border border-white/20 inline-block" style={{ backgroundColor: currentPixelColor }} />
                  {currentPixelColor}
                </span>
              )}
              <span className="ml-2 text-muted-foreground/50">click for history</span>
            </span>
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
        </div>
      </CardContent>
    </Card>
  );
}
