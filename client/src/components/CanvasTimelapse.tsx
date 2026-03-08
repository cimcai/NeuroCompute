import { useState, useRef, useEffect, useCallback } from "react";
import { SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";

const CANVAS_SIZE = 32;
const CELL_SIZE = 16;
const TOTAL_DURATION_MS = 7000;

interface HistoryEntry {
  x: number;
  y: number;
  color: string;
  placedBy: string;
  placedAt: string;
}

interface CanvasTimelapseProps {
  onComplete: () => void;
}

export function CanvasTimelapse({ onComplete }: CanvasTimelapseProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [progress, setProgress] = useState(0);
  const [totalPixels, setTotalPixels] = useState(0);
  const [currentAgent, setCurrentAgent] = useState("");
  const [currentCount, setCurrentCount] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState(false);
  const animRef = useRef<number>(0);
  const skippedRef = useRef(false);

  useEffect(() => {
    fetch("/api/canvas/history")
      .then(r => r.json())
      .then(data => {
        if (!Array.isArray(data) || data.length === 0) {
          onComplete();
          return;
        }
        setHistory(data);
        setTotalPixels(data.length);
      })
      .catch(() => {
        setError(true);
        setTimeout(onComplete, 500);
      });
  }, [onComplete]);

  const drawPixel = useCallback((ctx: CanvasRenderingContext2D, x: number, y: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
  }, []);

  useEffect(() => {
    if (!history || history.length === 0) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#0a0a0f";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const total = history.length;
    const intervalMs = TOTAL_DURATION_MS / total;
    let idx = 0;
    let startTime: number | null = null;

    const step = (timestamp: number) => {
      if (skippedRef.current) return;
      if (!startTime) startTime = timestamp;

      const elapsed = timestamp - startTime;
      const targetIdx = Math.min(Math.floor(elapsed / intervalMs), total);

      while (idx < targetIdx && idx < total) {
        const entry = history[idx];
        drawPixel(ctx, entry.x, entry.y, entry.color);
        idx++;
      }

      if (idx > 0) {
        const lastDrawn = history[idx - 1];
        const name = lastDrawn.placedBy.replace(/^NeuroCompute-/, "");
        setCurrentAgent(name);
        setCurrentCount(idx);
        setProgress((idx / total) * 100);
      }

      if (idx >= total) {
        setTimeout(onComplete, 800);
        return;
      }

      animRef.current = requestAnimationFrame(step);
    };

    animRef.current = requestAnimationFrame(step);

    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [history, drawPixel, onComplete]);

  const handleSkip = () => {
    skippedRef.current = true;
    if (animRef.current) cancelAnimationFrame(animRef.current);
    onComplete();
  };

  if (error) return null;
  if (!history) {
    return (
      <div className="relative w-full bg-black/90 rounded-lg border border-white/10 flex items-center justify-center" style={{ aspectRatio: "1/1" }}>
        <div className="text-xs text-muted-foreground font-mono animate-pulse">Loading history...</div>
      </div>
    );
  }

  return (
    <div className="relative w-full" data-testid="canvas-timelapse">
      <canvas
        ref={canvasRef}
        width={CANVAS_SIZE * CELL_SIZE}
        height={CANVAS_SIZE * CELL_SIZE}
        className="w-full rounded-lg border border-white/10"
        style={{ imageRendering: "pixelated", aspectRatio: "1/1" }}
      />

      <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-3">
        <div className="flex items-center justify-between">
          <div className="bg-black/70 backdrop-blur-sm rounded-full px-3 py-1 border border-white/10">
            <span className="text-[10px] font-mono text-primary">TIMELAPSE</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="pointer-events-auto h-7 px-3 text-[10px] font-mono bg-black/70 backdrop-blur-sm border border-white/10 hover:bg-white/10"
            onClick={handleSkip}
            data-testid="button-skip-timelapse"
          >
            <SkipForward className="w-3 h-3 mr-1" />
            Skip
          </Button>
        </div>

        <div className="space-y-1.5">
          {currentAgent && (
            <div className="flex justify-center">
              <span className="bg-black/70 backdrop-blur-sm rounded-full px-2.5 py-0.5 text-[9px] font-mono text-muted-foreground border border-white/10 truncate max-w-[200px]">
                {currentAgent}
              </span>
            </div>
          )}
          <div className="bg-black/70 backdrop-blur-sm rounded-lg px-3 py-1.5 border border-white/10">
            <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground mb-1">
              <span>{currentCount} / {totalPixels} pixels</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-100"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
