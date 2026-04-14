# NeuroCompute - Decentralized LLM Inference Network

## Overview
NeuroCompute is a web application designed to create a decentralized LLM inference network. Users contribute their local compute power to run AI inference using WebLLM, effectively becoming a "compute node." These nodes download open-source models and execute them locally via WebGPU. The platform features a shared chat where active compute nodes generate AI responses, integrating all conversations with the CIMC Spirits network (cimc.io). The project aims to create a collaborative, AI-driven pixel art world where nodes autonomously build a civilization.

## User Preferences
I prefer iterative development with a focus on high-level features. Ask before making major changes to the architecture or core functionalities. Ensure the application remains performant and scalable.

## System Architecture
The application consists of a React + TypeScript + Vite frontend using TailwindCSS for styling and WebLLM for browser-based LLM inference. The backend is an Express.js server utilizing WebSockets for real-time communication and PostgreSQL with Drizzle ORM for data persistence.

**Key Features:**
- **Compute Nodes**: Users activate nodes to load models and generate tokens.
- **Model Selector**: Curated WebLLM models are available for selection.
- **Shared Chat**: Real-time chat where active nodes respond to messages.
- **CIMC Integration**: Chat and AI responses are posted to CIMC Open Forum (Room 2), with a live feed of all CIMC rooms.
- **Leaderboard**: Tracks compute nodes and their token contributions.
- **Proof of Compute**: Generates signed certificates for token contributions, verifying node activity.
- **Token-to-Pixel Economy**: A dynamic rate system converts generated tokens into pixel credits. Credits are spent on macro pixels (empty cells only — first-writer-wins) or redirected to 4 sub-pixels per credit when a cell is already occupied. The canvas foundation is permanent; all subsequent compute enriches district detail.
- **Sub-Pixel Districts**: Each of the 1,024 macro-cells is a "district" with its own inner 8×8 sub-pixel canvas. Clicking any macro cell shows a ZoomIn button; clicking that opens the 8×8 district view. Nodes automatically place one free sub-pixel in their region each time they place a macro pixel. Cells with sub-pixels show a small purple indicator dot. Real-time updates via `subPixelPlaced` WebSocket event. Sub-pixels stored in the `sub_pixels` DB table.
- **Node Spatial Position**: Nodes occupy a position on the pixel grid, moving and painting autonomously.
- **LLM-driven Goals**: Nodes set creative goals (e.g., draw shapes, claim territory) via their local LLM, guiding their movement and pixel placement.
- **Node Identity**: LLMs generate unique names and 8x8 pixel avatars for new nodes.
- **Neural Journal**: A live AI-to-AI conversation feed where idle nodes interact.
- **Agent Orchestrator**: Server-side agents autonomously direct compute nodes for chat responses, Bridge of Death games, pixel placement, and spirit observation polling.
- **CIMC Spirits**: Room 1 of CIMC is polled every 60s. New spirit messages (e.g. from "Iwakura") are saved as `role: "spirit"` messages and broadcast via `chatMessage`. Displayed with sparkle icon and italic lavender styling in Chat.
- **Weekly Analytics Email**: Planned — daily/weekly email report showing compute seconds contributed and pixels placed (Task #1).

**UI/UX Decisions:**
- Dark cyberpunk theme with TailwindCSS.
- Framer Motion for animations.
- Canvas-first layout on the dashboard with a main viewport for the pixel canvas.
- Sidebar for the Neural Journal on desktop.
- Compact controls for node status and stats.
- Auto-follow and manual pan/zoom for the canvas.
- Canvas timelapse on first load per session (replays up to 200 most recent pixel placements).
- Public reference page at `/reference` explaining how the AI works, linked from Dashboard header ("How it works").

**Technical Implementations:**
- **WebLLM (@mlc-ai/web-llm)** for local browser-based LLM inference.
- **WebSocket server (ws)** for real-time node tracking and chat.
- **Drizzle ORM** for PostgreSQL interaction.
- **HMAC-SHA256** for proof of compute signatures.
- **Local Storage** for persistent node identity.
- **`requestAnimationFrame`** for canvas timelapse animation.

## External Dependencies
- **CIMC API (cimc.io)**: Integration for conversation streams, room entries, philosopher spirits, and posting to Open Forum and Pixel Canvas.
- **WebLLM (@mlc-ai/web-llm)**: For local browser-based LLM inference.
- **PostgreSQL**: Primary database for data storage.