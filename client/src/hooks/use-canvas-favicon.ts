import { useEffect, useRef } from "react";

const FAVICON_SIZE = 32;
const REFRESH_INTERVAL = 15_000;

function renderFavicon(grid: string[][]) {
  const canvas = document.createElement("canvas");
  canvas.width = FAVICON_SIZE;
  canvas.height = FAVICON_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.fillStyle = "#0a0a0f";
  ctx.fillRect(0, 0, FAVICON_SIZE, FAVICON_SIZE);

  for (let y = 0; y < grid.length && y < FAVICON_SIZE; y++) {
    for (let x = 0; x < (grid[y]?.length ?? 0) && x < FAVICON_SIZE; x++) {
      const color = grid[y][x];
      if (color && color !== "#000000") {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  const url = canvas.toDataURL("image/png");
  let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.type = "image/png";
  link.href = url;
}

export function useCanvasFavicon() {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    async function fetchAndRender() {
      try {
        const res = await fetch("/api/canvas");
        if (!res.ok) return;
        const data = await res.json();
        if (data?.grid) {
          renderFavicon(data.grid);
        }
      } catch {}
    }

    fetchAndRender();
    intervalRef.current = setInterval(fetchAndRender, REFRESH_INTERVAL);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);
}
