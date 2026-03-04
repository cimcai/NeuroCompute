import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useWebSocket } from "@/hooks/use-websocket";
import { Grid3X3, Coins, Paintbrush, Minus, Plus, RotateCcw, MapPin, Info } from "lucide-react";

const CANVAS_SIZE = 32;
const CELL_SIZE = 16;

const NODE_MARKER_COLORS = [
  "#FF4444", "#44FF44", "#4444FF", "#FFAA00", "#FF44FF", "#44FFFF",
  "#FF8866", "#66FF88", "#8866FF", "#FFFF44",
];

const BUBBLE_DURATION = 6000;
const MAX_BUBBLE_CHARS = 60;

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

interface PixelCanvasProps {
  nodeId: number | null;
}

export function PixelCanvas({ nodeId }: PixelCanvasProps) {
  const [hoveredCell, setHoveredCell] = useState<{ x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [nodePositions, setNodePositions] = useState<Map<number, { x: number; y: number; name: string }>>(new Map());
  const [speechBubbles, setSpeechBubbles] = useState<SpeechBubble[]>([]);
  const [nodeGoals, setNodeGoals] = useState<Map<number, NodeGoal>>(new Map());
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
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

  const nodesQuery = useQuery<{ id: number; name: string; pixelX: number; pixelY: number; pixelGoal: string | null; status: string }[]>({
    queryKey: ["/api/nodes"],
    refetchInterval: 10000,
  });

  useEffect(() => {
    if (nodesQuery.data) {
      const posMap = new Map<number, { x: number; y: number; name: string }>();
      const goalMap = new Map<number, NodeGoal>();
      for (const n of nodesQuery.data) {
        if (n.status === "computing") {
          posMap.set(n.id, { x: n.pixelX, y: n.pixelY, name: n.name });
          if (n.pixelGoal) {
            try {
              const g = JSON.parse(n.pixelGoal);
              goalMap.set(n.id, { nodeId: n.id, nodeName: n.name, description: g.description, targetX: g.targetX, targetY: g.targetY, color: g.color });
            } catch {}
          }
        }
      }
      setNodePositions(posMap);
      setNodeGoals(goalMap);
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

      ctx.fillStyle = mc;
      ctx.font = `bold ${isMe ? 7 : 6}px monospace`;
      ctx.textAlign = "center";
      const label = isMe ? "YOU" : pos.name.slice(-4);
      ctx.fillText(label, px + CELL_SIZE / 2, py - 2);

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
          if (ctx.measureText(test).width > 80) {
            if (currentLine) lines.push(currentLine);
            currentLine = word;
          } else {
            currentLine = test;
          }
        }
        if (currentLine) lines.push(currentLine);
        if (lines.length > 3) {
          lines.length = 3;
          lines[2] = lines[2].slice(0, -3) + "...";
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

    if (hoveredCell) {
      ctx.strokeStyle = "rgba(255,255,255,0.3)";
      ctx.lineWidth = 1;
      ctx.strokeRect(hoveredCell.x * CELL_SIZE, hoveredCell.y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    }

    ctx.restore();
  }, [canvasQuery.data, hoveredCell, zoom, pan, myPos, nodePositions, nodeId, speechBubbles, nodeGoals]);

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
    if (e.button === 1 || e.button === 2) {
      setIsPanning(true);
      panStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    }
  };

  const handleMouseUp = () => { if (isPanning) setIsPanning(false); };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    setZoom((z) => Math.max(0.5, Math.min(4, z + (e.deltaY > 0 ? -0.2 : 0.2))));
  };

  const currentPixelColor = hoveredCell && canvasQuery.data?.grid
    ? canvasQuery.data.grid[hoveredCell.y]?.[hoveredCell.x] ?? "#000000"
    : null;

  return (
    <Card className="overflow-hidden border-primary/20">
      <CardContent className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Grid3X3 className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-semibold font-mono" data-testid="text-canvas-title">Pixel Canvas</h3>
            <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20" data-testid="text-canvas-room">
              Room 4
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} data-testid="button-zoom-out">
              <Minus className="w-3 h-3" />
            </Button>
            <span className="text-xs font-mono w-10 text-center">{Math.round(zoom * 100)}%</span>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom((z) => Math.min(4, z + 0.25))} data-testid="button-zoom-in">
              <Plus className="w-3 h-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} data-testid="button-zoom-reset">
              <RotateCcw className="w-3 h-3" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="flex items-center gap-2 bg-secondary/50 rounded-lg px-3 py-2 border border-white/5">
            <Coins className="w-4 h-4 text-primary" />
            <div>
              <div className="text-lg font-mono font-bold text-primary" data-testid="text-pixel-credits">{credits}</div>
              <div className="text-xs text-muted-foreground">Credits</div>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-secondary/50 rounded-lg px-3 py-2 border border-white/5">
            <Paintbrush className="w-4 h-4 text-fuchsia-400" />
            <div>
              <div className="text-lg font-mono font-bold text-fuchsia-400" data-testid="text-pixels-placed">{pixelsPlaced}</div>
              <div className="text-xs text-muted-foreground">Placed</div>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-secondary/50 rounded-lg px-3 py-2 border border-white/5">
            <MapPin className="w-4 h-4 text-green-400" />
            <div>
              <div className="text-lg font-mono font-bold text-green-400" data-testid="text-node-position">
                {myPos ? `(${myPos.x},${myPos.y})` : "—"}
              </div>
              <div className="text-xs text-muted-foreground">Position</div>
            </div>
          </div>
        </div>

        <div className="text-xs text-muted-foreground bg-secondary/30 rounded-lg px-3 py-2 border border-white/5 flex items-center gap-2">
          <Info className="w-3 h-3 shrink-0" />
          <span>
            {!nodeId
              ? `Start a compute node to help build an AI world. Rate: ${currentRate} tok/credit`
              : credits > 0
                ? `Your AI is building a world. ${credits} credits ready for construction.`
                : `${tokensToNextCredit} tokens to next credit (rate: ${currentRate} tok/credit)`}
          </span>
        </div>

        <div className="relative rounded-lg overflow-hidden border border-white/10 bg-black/50" data-testid="canvas-grid">
          <canvas
            ref={canvasRef}
            width={CANVAS_SIZE * CELL_SIZE}
            height={CANVAS_SIZE * CELL_SIZE}
            className="w-full"
            style={{ imageRendering: "pixelated", cursor: isPanning ? "grabbing" : "grab" }}
            onMouseMove={handleMouseMove}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => { setHoveredCell(null); setIsPanning(false); }}
            onWheel={handleWheel}
            onContextMenu={(e) => e.preventDefault()}
          />

          {!nodeId && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/70 backdrop-blur-sm">
              <div className="text-center space-y-2 px-4">
                <Paintbrush className="w-8 h-8 text-primary mx-auto" />
                <p className="text-sm font-medium">Start a compute node to build the AI world</p>
                <p className="text-xs text-muted-foreground">Your AI will spawn at the center and start constructing a civilization</p>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{totalPlacements} pixels placed by {uniqueAgents} agent{uniqueAgents !== 1 ? "s" : ""}</span>
          {hoveredCell && (
            <span className="font-mono flex items-center gap-2" data-testid="text-hover-coords">
              ({hoveredCell.x}, {hoveredCell.y})
              {currentPixelColor && currentPixelColor !== "#000000" && (
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded-sm border border-white/20" style={{ backgroundColor: currentPixelColor }} />
                  {currentPixelColor}
                </span>
              )}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
