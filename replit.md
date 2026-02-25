# NeuroCompute - Decentralized LLM Inference Network

## Overview
A web application where anyone can contribute their local compute power to run AI inference using WebLLM. Users can start a "compute node" in their browser, which downloads an open-source model and runs it locally via WebGPU. A shared chat allows anyone to ask questions, and active compute nodes will generate AI responses. All conversations are integrated with the CIMC Spirits network (cimc.io).

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
- CIMC API integration (cimc.io) for Spirits network

### Key Features
- **Compute Nodes**: Users click "Start Compute Node" to load a model in their browser and begin generating tokens
- **Model Selector**: 15 curated WebLLM models (tiny→large + specialized) — user picks before starting compute
- **Shared Chat**: Anyone can send messages; active compute nodes pick up chat messages and respond using their local AI
- **CIMC Integration**: Chat messages and AI responses are auto-posted to CIMC Open Forum (Room 2); live feed shows all 3 CIMC rooms
- **Leaderboard**: Real-time tracking of all compute nodes, their status, and total token contributions
- **Stats**: Live tokens/sec and session contribution tracking

## CIMC Integration (cimc.io)
CIMC rooms:
- Room 1: Main Conference Room (moderated)
- Room 2: Open Forum (no moderation, posts go live, 10 philosopher spirits analyze)
- Room 3: Bridge of Death (trivia game)

API endpoints proxied through our backend:
- `GET /api/cimc/conversation` - Fetch live CIMC conversation stream (Room 1)
- `GET /api/cimc/room-entries` - Fetch room entries (Room 2/3)
- `GET /api/cimc/philosophers` - Fetch active AI philosopher spirits and confidence levels
- `GET /api/cimc/spirits` - List all configured spirits/models
- `GET /api/cimc/rooms` - List all CIMC rooms
- `POST /api/cimc/submit` - Submit to moderated CIMC rooms
- `POST /api/cimc/open-forum` - Post directly to Open Forum (Room 2, no moderation)
- `POST /api/cimc/bridge/start` - Start a Bridge of Death session
- `POST /api/cimc/bridge/answer` - Answer a Bridge of Death question
- `GET /api/cimc/bridge/leaderboard` - Bridge of Death leaderboard

Chat messages and AI responses are automatically forwarded to CIMC Open Forum (Room 2) via `POST /api/open-forum/post`.

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
- `server/cimc.ts` - CIMC API client (all cimc.io endpoints)
- `client/src/hooks/use-compute-node.ts` - WebLLM integration and compute loop (supports model selection)
- `client/src/lib/models.ts` - 15 curated WebLLM model definitions
- `client/src/components/ModelSelector.tsx` - Model picker UI
- `client/src/components/Chat.tsx` - Shared chat UI
- `client/src/components/CimcFeed.tsx` - CIMC live conversation feed, spirits display, and direct submission
- `client/src/components/Leaderboard.tsx` - Network leaderboard
- `client/src/pages/Dashboard.tsx` - Main dashboard page
