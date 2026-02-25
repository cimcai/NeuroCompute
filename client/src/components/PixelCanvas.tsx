import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TOKENS_PER_PIXEL } from "@shared/schema";
import { Paintbrush, Coins, Grid3X3, Info, Minus, Plus, RotateCcw } from "lucide-react";

const CANVAS_SIZE = 64;
const CELL_SIZE = 8;

const COLOR_PALETTE = [
  "#00FFFF", "#FF00FF", "#FFFF00", "#FF0000", "#00FF00", "#0000FF",
  "#FF8800", "#8800FF", "#00FF88", "#FF0088", "#88FF00", "#0088FF",
  "#FFFFFF", "#CCCCCC", "#888888", "#444444", "#222222", "#000000",
];

interface PixelCanvasProps {
  nodeId: number | null;
}

interface LocalPixel {
  x: number;
  y: number;
  color: string;
  agent: string;
}

export function PixelCanvas({ nodeId }: PixelCanvasProps) {
  const [selectedColor, setSelectedColor] = useState(COLOR_PALETTE[0]);
  const [hoveredCell, setHoveredCell] = useState<{ x: number; y: number } | null>(null);
  const [localPixels, setLocalPixels] = useState<LocalPixel[]>([]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const creditsQuery = useQuery<{ pixelCredits: number; pixelsPlaced: number; totalTokens: number }>({
    queryKey: ["/api/canvas/credits", nodeId?.toString() ?? ""],
    enabled: !!nodeId,
    refetchInterval: 5000,
  });

  const canvasQuery = useQuery({
    queryKey: ["/api/canvas"],
    refetchInterval: 15000,
  });

  const placeMutation = useMutation({
    mutationFn: async ({ x, y, color }: { x: number; y: number; color: string }) => {
      const res = await apiRequest("POST", "/api/canvas/place", { x, y, color, nodeId });
      return res.json();
    },
    onSuccess: (data, variables) => {
      setLocalPixels((prev) => [...prev, { x: variables.x, y: variables.y, color: variables.color, agent: "you" }]);
      queryClient.invalidateQueries({ queryKey: ["/api/canvas/credits", nodeId?.toString() ?? ""] });
      queryClient.invalidateQueries({ queryKey: ["/api/canvas"] });
    },
  });

  const credits = creditsQuery.data?.pixelCredits ?? 0;
  const pixelsPlaced = creditsQuery.data?.pixelsPlaced ?? 0;
  const totalTokens = creditsQuery.data?.totalTokens ?? 0;
  const tokensToNextCredit = TOKENS_PER_PIXEL - (totalTokens % TOKENS_PER_PIXEL);

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

    ctx.strokeStyle = "rgba(0, 255, 255, 0.05)";
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

    const grid = (canvasQuery.data as any)?.grid;
    if (Array.isArray(grid)) {
      for (const pixel of grid) {
        if (pixel && pixel.color) {
          ctx.fillStyle = pixel.color;
          ctx.fillRect(pixel.x * CELL_SIZE, pixel.y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
        }
      }
    }

    for (const pixel of localPixels) {
      ctx.fillStyle = pixel.color;
      ctx.fillRect(pixel.x * CELL_SIZE, pixel.y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    }

    if (hoveredCell) {
      ctx.fillStyle = selectedColor + "66";
      ctx.fillRect(hoveredCell.x * CELL_SIZE, hoveredCell.y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
      ctx.strokeStyle = selectedColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(hoveredCell.x * CELL_SIZE, hoveredCell.y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
    }

    ctx.restore();
  }, [canvasQuery.data, localPixels, hoveredCell, selectedColor, zoom, pan]);

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

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanning) {
      setIsPanning(false);
      return;
    }
  };

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!nodeId || credits < 1 || placeMutation.isPending) return;
    const cell = getCellFromEvent(e);
    if (cell) {
      placeMutation.mutate({ x: cell.x, y: cell.y, color: selectedColor });
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    setZoom((z) => Math.max(0.5, Math.min(4, z + (e.deltaY > 0 ? -0.2 : 0.2))));
  };

  const isAvailable = !!(canvasQuery.data as any)?.grid?.length || localPixels.length > 0;

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

        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-2 bg-secondary/50 rounded-lg px-3 py-2 border border-white/5">
            <Coins className="w-4 h-4 text-primary" />
            <div>
              <div className="text-lg font-mono font-bold text-primary" data-testid="text-pixel-credits">{credits}</div>
              <div className="text-xs text-muted-foreground">Pixel Credits</div>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-secondary/50 rounded-lg px-3 py-2 border border-white/5">
            <Paintbrush className="w-4 h-4 text-fuchsia-400" />
            <div>
              <div className="text-lg font-mono font-bold text-fuchsia-400" data-testid="text-pixels-placed">{pixelsPlaced}</div>
              <div className="text-xs text-muted-foreground">Pixels Placed</div>
            </div>
          </div>
        </div>

        <div className="text-xs text-muted-foreground bg-secondary/30 rounded-lg px-3 py-2 border border-white/5 flex items-center gap-2">
          <Info className="w-3 h-3 shrink-0" />
          <span>
            {credits > 0
              ? `${credits} credit${credits !== 1 ? "s" : ""} available. Pick a color and click the grid!`
              : `${tokensToNextCredit} more tokens until next credit (${TOKENS_PER_PIXEL} tokens = 1 pixel)`}
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
                <p className="text-sm font-medium">Start a compute node to earn pixel credits</p>
                <p className="text-xs text-muted-foreground">Every {TOKENS_PER_PIXEL} tokens = 1 pixel on the canvas</p>
              </div>
            </div>
          )}

          {nodeId && credits === 0 && (
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3">
              <p className="text-xs text-center text-muted-foreground">
                Keep computing to earn pixel credits! {tokensToNextCredit} tokens to go...
              </p>
            </div>
          )}
        </div>

        {hoveredCell && (
          <div className="text-xs text-muted-foreground font-mono text-center" data-testid="text-hover-coords">
            ({hoveredCell.x}, {hoveredCell.y})
          </div>
        )}

        {placeMutation.isPending && (
          <div className="text-xs text-primary text-center animate-pulse">Placing pixel...</div>
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
