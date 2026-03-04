import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useWebSocket } from "@/hooks/use-websocket";
import { Paintbrush, Coins, Grid3X3, Info, Minus, Plus, RotateCcw, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, MapPin } from "lucide-react";

const CANVAS_SIZE = 32;
const CELL_SIZE = 16;

const COLOR_PALETTE = [
  "#00FFFF", "#FF00FF", "#FFFF00", "#FF0000", "#00FF00", "#0000FF",
  "#FF8800", "#8800FF", "#00FF88", "#FF0088", "#88FF00", "#0088FF",
  "#FFFFFF", "#CCCCCC", "#888888", "#444444", "#222222", "#000000",
];

const NODE_MARKER_COLORS = [
  "#FF4444", "#44FF44", "#4444FF", "#FFAA00", "#FF44FF", "#44FFFF",
  "#FF8866", "#66FF88", "#8866FF", "#FFFF44",
];

interface PixelCanvasProps {
  nodeId: number | null;
  queuePixelComment?: (data: { x: number; y: number; color: string; wasEmpty: boolean; creditsLeft: number }) => void;
}

export function PixelCanvas({ nodeId, queuePixelComment }: PixelCanvasProps) {
  const [selectedColor, setSelectedColor] = useState(COLOR_PALETTE[0]);
  const [hoveredCell, setHoveredCell] = useState<{ x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [nodePositions, setNodePositions] = useState<Map<number, { x: number; y: number; name: string }>>(new Map());
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

  const nodesQuery = useQuery<{ id: number; name: string; pixelX: number; pixelY: number; status: string }[]>({
    queryKey: ["/api/nodes"],
    refetchInterval: 10000,
  });

  useEffect(() => {
    if (nodesQuery.data) {
      const map = new Map<number, { x: number; y: number; name: string }>();
      for (const n of nodesQuery.data) {
        if (n.status === "computing") {
          map.set(n.id, { x: n.pixelX, y: n.pixelY, name: n.name });
        }
      }
      setNodePositions(map);
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

  const myPos = creditsQuery.data ? { x: creditsQuery.data.pixelX, y: creditsQuery.data.pixelY } : null;

  const placeMutation = useMutation({
    mutationFn: async ({ color }: { color: string }) => {
      if (!myPos) throw new Error("Position unknown");
      const grid = canvasQuery.data?.grid;
      const wasEmpty = !grid || !grid[myPos.y]?.[myPos.x] || grid[myPos.y][myPos.x] === "#000000";
      const res = await apiRequest("POST", "/api/canvas/place", { color, nodeId });
      const data = await res.json();
      if (queuePixelComment) {
        queuePixelComment({ x: myPos.x, y: myPos.y, color, wasEmpty, creditsLeft: data.node?.pixelCredits ?? 0 });
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/canvas/credits", nodeId?.toString() ?? ""] });
      queryClient.invalidateQueries({ queryKey: ["/api/canvas"] });
      queryClient.invalidateQueries({ queryKey: ["/api/network/rate"] });
    },
  });

  const moveMutation = useMutation({
    mutationFn: async ({ x, y }: { x: number; y: number }) => {
      const res = await apiRequest("POST", "/api/canvas/move", { nodeId, x, y });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/canvas/credits", nodeId?.toString() ?? ""] });
    },
  });

  const credits = creditsQuery.data?.pixelCredits ?? 0;
  const pixelsPlaced = creditsQuery.data?.pixelsPlaced ?? 0;
  const currentRate = creditsQuery.data?.currentRate ?? rateQuery.data?.rate ?? 10;
  const tokensSinceLastCredit = creditsQuery.data?.tokensSinceLastCredit ?? 0;
  const tokensToNextCredit = currentRate - tokensSinceLastCredit;
  const totalPlacements = canvasQuery.data?.totalPlacements ?? 0;
  const uniqueAgents = canvasQuery.data?.uniqueAgents ?? 0;

  const moveNode = useCallback((dx: number, dy: number) => {
    if (!myPos || !nodeId || moveMutation.isPending) return;
    const nx = Math.max(0, Math.min(31, myPos.x + dx));
    const ny = Math.max(0, Math.min(31, myPos.y + dy));
    if (nx === myPos.x && ny === myPos.y) return;
    moveMutation.mutate({ x: nx, y: ny });
  }, [myPos, nodeId, moveMutation]);

  useEffect(() => {
    if (!nodeId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case "ArrowUp": case "w": case "W": e.preventDefault(); moveNode(0, -1); break;
        case "ArrowDown": case "s": case "S": e.preventDefault(); moveNode(0, 1); break;
        case "ArrowLeft": case "a": case "A": e.preventDefault(); moveNode(-1, 0); break;
        case "ArrowRight": case "d": case "D": e.preventDefault(); moveNode(1, 0); break;
        case " ": e.preventDefault(); if (credits > 0) placeMutation.mutate({ color: selectedColor }); break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [nodeId, moveNode, credits, selectedColor, placeMutation]);

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

    let markerIdx = 0;
    nodePositions.forEach((pos, nId) => {
      if (nId === nodeId) return;
      const mc = NODE_MARKER_COLORS[markerIdx % NODE_MARKER_COLORS.length];
      markerIdx++;
      const px = pos.x * CELL_SIZE;
      const py = pos.y * CELL_SIZE;
      ctx.strokeStyle = mc;
      ctx.lineWidth = 2;
      ctx.strokeRect(px + 1, py + 1, CELL_SIZE - 2, CELL_SIZE - 2);
      ctx.fillStyle = mc;
      ctx.font = "bold 6px monospace";
      ctx.textAlign = "center";
      ctx.fillText(pos.name.slice(-4), px + CELL_SIZE / 2, py - 2);
    });

    if (myPos) {
      const px = myPos.x * CELL_SIZE;
      const py = myPos.y * CELL_SIZE;
      ctx.strokeStyle = "#00FF00";
      ctx.lineWidth = 2.5;
      ctx.strokeRect(px, py, CELL_SIZE, CELL_SIZE);
      ctx.strokeStyle = "#00FF0088";
      ctx.lineWidth = 1;
      ctx.strokeRect(px - 2, py - 2, CELL_SIZE + 4, CELL_SIZE + 4);
      ctx.fillStyle = "#00FF00";
      ctx.beginPath();
      ctx.arc(px + CELL_SIZE / 2, py + CELL_SIZE / 2, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    if (hoveredCell) {
      const isAdjacent = myPos && Math.abs(hoveredCell.x - myPos.x) <= 1 && Math.abs(hoveredCell.y - myPos.y) <= 1;
      const isAtPos = myPos && hoveredCell.x === myPos.x && hoveredCell.y === myPos.y;
      if (isAtPos) {
        ctx.fillStyle = selectedColor + "66";
        ctx.fillRect(hoveredCell.x * CELL_SIZE, hoveredCell.y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
      } else if (isAdjacent) {
        ctx.strokeStyle = "#FFFFFF88";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(hoveredCell.x * CELL_SIZE, hoveredCell.y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
        ctx.setLineDash([]);
      }
      ctx.strokeStyle = "rgba(255,255,255,0.3)";
      ctx.lineWidth = 1;
      ctx.strokeRect(hoveredCell.x * CELL_SIZE, hoveredCell.y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    }

    ctx.restore();
  }, [canvasQuery.data, hoveredCell, selectedColor, zoom, pan, myPos, nodePositions, nodeId]);

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
    const cell = getCellFromEvent(e);
    setHoveredCell(cell);
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button === 1 || e.button === 2) {
      setIsPanning(true);
      panStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
      return;
    }
  };

  const handleMouseUp = () => {
    if (isPanning) {
      setIsPanning(false);
      return;
    }
  };

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!nodeId || !myPos) return;
    const cell = getCellFromEvent(e);
    if (!cell) return;

    if (cell.x === myPos.x && cell.y === myPos.y) {
      if (credits > 0 && !placeMutation.isPending) {
        placeMutation.mutate({ color: selectedColor });
      }
    } else {
      const dx = Math.abs(cell.x - myPos.x);
      const dy = Math.abs(cell.y - myPos.y);
      if (dx <= 1 && dy <= 1 && !moveMutation.isPending) {
        moveMutation.mutate({ x: cell.x, y: cell.y });
      }
    }
  };

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
              <div className="text-xs text-muted-foreground">You Placed</div>
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
              ? `Start a compute node to join the grid. Rate: ${currentRate} tok/credit`
              : credits > 0
                ? `Click your cell (green) to paint, click adjacent cells to move. WASD/arrows + Space to paint.`
                : `${tokensToNextCredit} tokens to next credit. Move around with WASD/arrows!`}
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5" data-testid="color-palette">
          {COLOR_PALETTE.map((color) => (
            <button
              key={color}
              className={`w-7 h-7 rounded-md border-2 transition-all hover:scale-110 ${
                selectedColor === color ? "border-white shadow-[0_0_8px_rgba(0,255,255,0.5)] scale-110" : "border-white/10"
              }`}
              style={{ backgroundColor: color }}
              onClick={() => setSelectedColor(color)}
              data-testid={`button-color-${color.replace("#", "")}`}
            />
          ))}
        </div>

        {nodeId && myPos && (
          <div className="flex items-center justify-center gap-1" data-testid="movement-controls">
            <div className="grid grid-cols-3 gap-0.5">
              <div />
              <Button variant="outline" size="icon" className="h-7 w-7 border-green-500/30 hover:bg-green-500/10" onClick={() => moveNode(0, -1)} disabled={moveMutation.isPending} data-testid="button-move-up">
                <ArrowUp className="w-3 h-3" />
              </Button>
              <div />
              <Button variant="outline" size="icon" className="h-7 w-7 border-green-500/30 hover:bg-green-500/10" onClick={() => moveNode(-1, 0)} disabled={moveMutation.isPending} data-testid="button-move-left">
                <ArrowLeft className="w-3 h-3" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-7 w-7 border-primary/30 hover:bg-primary/10"
                onClick={() => { if (credits > 0) placeMutation.mutate({ color: selectedColor }); }}
                disabled={credits < 1 || placeMutation.isPending}
                data-testid="button-paint"
              >
                <Paintbrush className="w-3 h-3" />
              </Button>
              <Button variant="outline" size="icon" className="h-7 w-7 border-green-500/30 hover:bg-green-500/10" onClick={() => moveNode(1, 0)} disabled={moveMutation.isPending} data-testid="button-move-right">
                <ArrowRight className="w-3 h-3" />
              </Button>
              <div />
              <Button variant="outline" size="icon" className="h-7 w-7 border-green-500/30 hover:bg-green-500/10" onClick={() => moveNode(0, 1)} disabled={moveMutation.isPending} data-testid="button-move-down">
                <ArrowDown className="w-3 h-3" />
              </Button>
              <div />
            </div>
          </div>
        )}

        <div className="relative rounded-lg overflow-hidden border border-white/10 bg-black/50" data-testid="canvas-grid">
          <canvas
            ref={canvasRef}
            width={CANVAS_SIZE * CELL_SIZE}
            height={CANVAS_SIZE * CELL_SIZE}
            className="w-full cursor-crosshair"
            style={{ imageRendering: "pixelated" }}
            onClick={handleClick}
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
                <p className="text-sm font-medium">Start a compute node to join the grid</p>
                <p className="text-xs text-muted-foreground">You'll spawn at the center and can explore the canvas</p>
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
              {myPos && hoveredCell.x === myPos.x && hoveredCell.y === myPos.y && credits > 0 && (
                <span className="text-primary">click to paint</span>
              )}
              {myPos && !(hoveredCell.x === myPos.x && hoveredCell.y === myPos.y) && Math.abs(hoveredCell.x - myPos.x) <= 1 && Math.abs(hoveredCell.y - myPos.y) <= 1 && (
                <span className="text-green-400">click to move</span>
              )}
            </span>
          )}
        </div>

        {(placeMutation.isPending || moveMutation.isPending) && (
          <div className="text-xs text-primary text-center animate-pulse">
            {placeMutation.isPending ? "Painting..." : "Moving..."}
          </div>
        )}

        {placeMutation.isError && (
          <div className="text-xs text-destructive text-center" data-testid="text-place-error">
            {(placeMutation.error as Error)?.message || "Failed to place pixel"}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
