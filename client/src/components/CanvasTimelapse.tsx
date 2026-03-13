import { useState, useRef, useEffect, useCallback } from "react";
import { SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";

const CANVAS_SIZE = 32;
const CELL_SIZE = 16;
const TOTAL_DURATION_MS = 10000;
const START_THRESHOLD = 500;

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
  const [loadedPixels, setLoadedPixels] = useState(0);
  const [currentAgent, setCurrentAgent] = useState("");
  const [currentCount, setCurrentCount] = useState(0);
  const [streamDone, setStreamDone] = useState(false);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState(false);

  const pixelsRef = useRef<HistoryEntry[]>([]);
  const totalPixelsRef = useRef(0);
  const streamDoneRef = useRef(false);
  const skippedRef = useRef(false);
  const animRef = useRef<number>(0);
  const startedRef = useRef(false);

  const drawPixel = useCallback((ctx: CanvasRenderingContext2D, x: number, y: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(x * CELL_SIZE, y * CELL_SIZE, CELL_SIZE, CELL_SIZE);
  }, []);

  const startAnimation = useCallback((ctx: CanvasRenderingContext2D) => {
    if (startedRef.current) return;
    startedRef.current = true;
    setStarted(true);

    ctx.fillStyle = "#0a0a0f";
    ctx.fillRect(0, 0, CANVAS_SIZE * CELL_SIZE, CANVAS_SIZE * CELL_SIZE);

    let idx = 0;
    let startTime: number | null = null;

    const step = (timestamp: number) => {
      if (skippedRef.current) return;
      if (!startTime) startTime = timestamp;

      const pixels = pixelsRef.current;
      const knownTotal = totalPixelsRef.current;
      const total = streamDoneRef.current
        ? pixels.length
        : Math.max(pixels.length, knownTotal || pixels.length);
      const elapsed = timestamp - startTime;
      const intervalMs = TOTAL_DURATION_MS / Math.max(total, 1);
      const targetIdx = Math.min(Math.floor(elapsed / intervalMs), pixels.length);

      while (idx < targetIdx && idx < pixels.length) {
        const entry = pixels[idx];
        drawPixel(ctx, entry.x, entry.y, entry.color);
        idx++;
      }

      if (idx > 0) {
        const last = pixels[idx - 1];
        setCurrentAgent(last.placedBy.replace(/^NeuroCompute-/, ""));
        setCurrentCount(idx);
        setProgress((idx / Math.max(total, 1)) * 100);
      }

      if (streamDoneRef.current && idx >= pixels.length) {
        setTimeout(onComplete, 800);
        return;
      }

      animRef.current = requestAnimationFrame(step);
    };

    animRef.current = requestAnimationFrame(step);
  }, [drawPixel, onComplete]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const response = await fetch("/api/canvas/history/stream");
        if (!response.body) throw new Error("No stream body");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (cancelled) return;
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const chunk = JSON.parse(line);
              if (chunk.pixels && chunk.pixels.length > 0) {
                pixelsRef.current = [...pixelsRef.current, ...chunk.pixels];
                setLoadedPixels(pixelsRef.current.length);
              }
              if (chunk.total) {
                totalPixelsRef.current = chunk.total;
              }
              if (chunk.done) {
                streamDoneRef.current = true;
                setStreamDone(true);
              }
            } catch {}
          }

          const canvas = canvasRef.current;
          const ctx = canvas?.getContext("2d");
          if (ctx && !startedRef.current && pixelsRef.current.length >= START_THRESHOLD) {
            startAnimation(ctx);
          }
        }

        streamDoneRef.current = true;
        setStreamDone(true);

        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (ctx && !startedRef.current && pixelsRef.current.length > 0) {
          startAnimation(ctx);
        }
        if (pixelsRef.current.length === 0) {
          onComplete();
        }
      } catch {
        if (!cancelled) {
          setError(true);
          setTimeout(onComplete, 500);
        }
      }
    };

    run();
    return () => {
      cancelled = true;
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [onComplete, startAnimation]);

  const handleSkip = () => {
    skippedRef.current = true;
    if (animRef.current) cancelAnimationFrame(animRef.current);
    onComplete();
  };

  if (error) return null;

  const isLoading = !started;

  return (
    <div className="relative w-full" data-testid="canvas-timelapse">
      <canvas
        ref={canvasRef}
        width={CANVAS_SIZE * CELL_SIZE}
        height={CANVAS_SIZE * CELL_SIZE}
        className="w-full rounded-lg border border-white/10"
        style={{ imageRendering: "pixelated", aspectRatio: "1/1", background: "#0a0a0f" }}
      />

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/80">
          <div className="text-center space-y-2">
            <div className="text-xs font-mono text-primary animate-pulse">Loading history...</div>
            {loadedPixels > 0 && (
              <div className="text-[10px] font-mono text-muted-foreground">{loadedPixels.toLocaleString()} pixels buffered</div>
            )}
          </div>
        </div>
      )}

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

        {started && (
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
                <span>{currentCount.toLocaleString()} / {(totalPixelsRef.current || loadedPixels).toLocaleString()} pixels</span>
                <div className="flex items-center gap-2">
                  {!streamDone && <span className="text-primary animate-pulse">streaming</span>}
                  <span>{Math.round(progress)}%</span>
                </div>
              </div>
              <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-100"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
