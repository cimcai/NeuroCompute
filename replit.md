# NeuroCompute - Decentralized LLM Inference Network

## Overview
A web application where anyone can contribute their local compute power to run AI inference using WebLLM. Users can start a "compute node" in their browser, which downloads a small open-source model and runs it locally via WebGPU. A shared chat allows anyone to ask questions, and active compute nodes will generate AI responses.

## Architecture

### Frontend (client/)
- React + TypeScript + Vite
- TailwindCSS with dark cyberpunk theme
- WebLLM (@mlc-ai/web-llm) for local browser-based LLM inference
- WebSocket for real-time communication
- Framer Motion for animations

### Backend (server/)
- Express.js
- WebSocket server (ws) for real-time node tracking and chat
- PostgreSQL via Drizzle ORM

### Key Features
- **Compute Nodes**: Users click "Start Compute Node" to load a TinyLlama model in their browser and begin generating tokens
- **Shared Chat**: Anyone can send messages; active compute nodes pick up chat messages and respond using their local AI
- **Leaderboard**: Real-time tracking of all compute nodes, their status, and total token contributions
- **Stats**: Live tokens/sec and session contribution tracking

## Data Model
- `nodes` - Tracks registered compute nodes (name, status, totalTokens, lastSeen)
- `messages` - Stores chat messages (role: user/assistant, content, senderName, nodeId)

## WebSocket Events
- `nodeJoined/nodeLeft` - Node lifecycle
- `stats/statsUpdate` - Token generation metrics
- `chatMessage` - User sends a chat message
- `chatPending` - Broadcast to compute nodes to pick up
- `chatResponse` - Compute node sends AI response back

## Key Files
- `shared/schema.ts` - Drizzle tables and types
- `shared/routes.ts` - API contracts and WS event schemas
- `server/routes.ts` - Express routes + WebSocket server
- `client/src/hooks/use-compute-node.ts` - WebLLM integration and compute loop
- `client/src/components/Chat.tsx` - Shared chat UI
- `client/src/components/Leaderboard.tsx` - Network leaderboard
