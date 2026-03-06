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
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(1000);
  const intentionalCloseRef = useRef(false);
  
  const handlersRef = useRef<Map<string, Set<(data: any) => void>>>(new Map());

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    const socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      console.log("[WS] Connected");
      setConnected(true);
      reconnectDelayRef.current = 1000;
    };

    socket.onclose = () => {
      console.log("[WS] Disconnected");
      setConnected(false);
      wsRef.current = null;

      if (!intentionalCloseRef.current) {
        const delay = reconnectDelayRef.current;
        console.log(`[WS] Reconnecting in ${delay}ms...`);
        reconnectTimerRef.current = setTimeout(() => {
          reconnectDelayRef.current = Math.min(delay * 1.5, 15000);
          connect();
        }, delay);
      }
    };

    socket.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (!parsed.type || !parsed.payload) return;

        const eventType = parsed.type as string;
        
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
    intentionalCloseRef.current = false;
    connect();
    return () => {
      intentionalCloseRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
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
