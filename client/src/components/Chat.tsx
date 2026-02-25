import { useState, useEffect, useRef } from "react";
import { useWebSocket } from "@/hooks/use-websocket";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MessageCircle, Send, Bot, User } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface ChatMsg {
  id: number;
  role: string;
  content: string;
  senderName: string;
}

export function Chat() {
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [userName] = useState(() => `User-${Math.floor(Math.random() * 10000).toString().padStart(4, "0")}`);
  const scrollRef = useRef<HTMLDivElement>(null);
  const ws = useWebSocket();

  useEffect(() => {
    fetch("/api/messages")
      .then((r) => r.json())
      .then((msgs: ChatMsg[]) => setChatMessages(msgs))
      .catch(console.error);
  }, []);

  useEffect(() => {
    const unsub = ws.subscribe("chatMessage", (data: { id: number; content: string; senderName: string; role: string }) => {
      setChatMessages((prev) => {
        if (prev.find((m) => m.id === data.id)) return prev;
        return [...prev, data];
      });
    });
    return unsub;
  }, [ws]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  const sendMessage = () => {
    const trimmed = input.trim();
    if (!trimmed || !ws.connected) return;
    ws.emit("chatMessage", { content: trimmed, senderName: userName });
    setInput("");
  };

  return (
    <Card className="flex flex-col h-full">
      <CardHeader className="border-b border-white/5 pb-4">
        <CardTitle className="flex items-center gap-2 text-xl" data-testid="text-chat-title">
          <MessageCircle className="w-5 h-5 text-primary" />
          Shared Chat
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Ask anything — an active compute node will answer using its local AI
        </p>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col p-0 min-h-0">
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3" data-testid="container-chat-messages">
          {chatMessages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <MessageCircle className="w-12 h-12 mb-2 opacity-20" />
              <p className="text-sm">No messages yet. Start a conversation!</p>
            </div>
          )}
          <AnimatePresence>
            {chatMessages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex gap-3 ${msg.role === "assistant" ? "" : "flex-row-reverse"}`}
              >
                <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${msg.role === "assistant" ? "bg-primary/20 text-primary" : "bg-secondary text-muted-foreground"}`}>
                  {msg.role === "assistant" ? <Bot className="w-4 h-4" /> : <User className="w-4 h-4" />}
                </div>
                <div className={`max-w-[80%] ${msg.role === "assistant" ? "" : "text-right"}`}>
                  <p className="text-xs text-muted-foreground mb-1">{msg.senderName}</p>
                  <div
                    className={`rounded-lg px-3 py-2 text-sm ${msg.role === "assistant" ? "bg-secondary/80 text-foreground" : "bg-primary/20 text-foreground"}`}
                    data-testid={`text-message-${msg.id}`}
                  >
                    {msg.content}
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        <div className="p-4 border-t border-white/5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage();
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a message..."
              className="flex-1 bg-secondary/50 border border-white/10 rounded-lg px-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              data-testid="input-chat-message"
            />
            <Button
              type="submit"
              size="icon"
              disabled={!input.trim() || !ws.connected}
              data-testid="button-send-message"
            >
              <Send className="w-4 h-4" />
            </Button>
          </form>
          <p className="text-xs text-muted-foreground mt-2">
            Chatting as <span className="font-mono text-primary">{userName}</span>
            {!ws.connected && <span className="text-destructive ml-2">- Disconnected</span>}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
