import { useState, useRef, useEffect, useCallback } from "react";
import { z } from "zod";
import { ws } from "@shared/routes";

type WsSendMap = typeof ws.send;
type WsReceiveMap = typeof ws.receive;

type SendEventNames = keyof WsSendMap;
type ReceiveEventNames = keyof WsReceiveMap;

export function useWebSocket() {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  
  // Use refs for handlers to avoid unnecessary re-renders when handlers change
  const handlersRef = useRef<Map<string, Set<(data: any) => void>>>(new Map());

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    const socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      console.log("[WS] Connected");
      setConnected(true);
    };

    socket.onclose = () => {
      console.log("[WS] Disconnected");
      setConnected(false);
      // Optional: Auto-reconnect logic could go here
    };

    socket.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (!parsed.type || !parsed.payload) return;

        const eventType = parsed.type as string;
        
        // Validate if we have a schema for this event
        if (eventType in ws.receive) {
          const schema = ws.receive[eventType as ReceiveEventNames];
          const validated = schema.parse(parsed.payload);
          
          const handlers = handlersRef.current.get(eventType);
          if (handlers) {
            handlers.forEach(handler => handler(validated));
          }
        }
      } catch (err) {
        console.error("[WS] Message parsing/validation error:", err);
      }
    };

    wsRef.current = socket;
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  const emit = useCallback(<K extends SendEventNames>(
    event: K,
    payload: z.infer<WsSendMap[K]>
  ) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.warn("[WS] Cannot emit, not connected");
      return;
    }

    try {
      const validated = ws.send[event].parse(payload);
      wsRef.current.send(JSON.stringify({
        type: event,
        payload: validated
      }));
    } catch (err) {
      console.error(`[WS] Emit validation failed for ${event}:`, err);
    }
  }, []);

  const subscribe = useCallback(<K extends ReceiveEventNames>(
    event: K,
    handler: (data: z.infer<WsReceiveMap[K]>) => void
  ) => {
    if (!handlersRef.current.has(event)) {
      handlersRef.current.set(event, new Set());
    }
    handlersRef.current.get(event)!.add(handler);

    return () => {
      const handlers = handlersRef.current.get(event);
      if (handlers) {
        handlers.delete(handler);
      }
    };
  }, []);

  return {
    connected,
    emit,
    subscribe,
    reconnect: connect
  };
}
