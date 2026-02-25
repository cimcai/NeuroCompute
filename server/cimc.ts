const CIMC_BASE_URL = "https://cimc.io";

export interface CimcEntry {
  id: number;
  speaker: string;
  content: string;
  timestamp: string;
}

export interface CimcPhilosopher {
  id: number;
  name: string;
  description: string;
  color: string;
  llmModel: string;
  confidence: number;
  multiplier: number;
  hasResponse: boolean;
  proposedResponse?: string;
}

export interface CimcSubmission {
  id: number;
  speaker: string;
  content: string;
  status: string;
  createdAt: string;
}

export interface CimcRoom {
  id: number;
  name: string;
  description: string;
  isActive: boolean;
  createdAt: string;
}

export async function getRooms(): Promise<CimcRoom[]> {
  const res = await fetch(`${CIMC_BASE_URL}/api/rooms/list`);
  if (!res.ok) throw new Error(`CIMC rooms fetch failed: ${res.status}`);
  return res.json();
}

export async function getConversation(roomId = 1, limit = 30): Promise<{ roomId: number; count: number; entries: CimcEntry[] }> {
  const res = await fetch(`${CIMC_BASE_URL}/api/inbound/conversation?roomId=${roomId}&limit=${limit}`);
  if (!res.ok) throw new Error(`CIMC conversation fetch failed: ${res.status}`);
  return res.json();
}

export async function getRoomEntries(roomId: number, limit = 30): Promise<CimcEntry[]> {
  const res = await fetch(`${CIMC_BASE_URL}/api/rooms/${roomId}/entries?limit=${limit}`);
  if (!res.ok) throw new Error(`CIMC room entries fetch failed: ${res.status}`);
  return res.json();
}

export async function getPhilosophers(roomId = 1): Promise<{ roomId: number; philosophers: CimcPhilosopher[] }> {
  const res = await fetch(`${CIMC_BASE_URL}/api/inbound/philosophers?roomId=${roomId}`);
  if (!res.ok) throw new Error(`CIMC philosophers fetch failed: ${res.status}`);
  return res.json();
}

export async function submitResponse(speaker: string, content: string, roomId = 1, source = "neurocompute"): Promise<{ submission: CimcSubmission; message: string }> {
  const res = await fetch(`${CIMC_BASE_URL}/api/inbound/respond`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ speaker, content, roomId, source }),
  });
  if (!res.ok) throw new Error(`CIMC submit failed: ${res.status}`);
  return res.json();
}

export async function postToOpenForum(speaker: string, content: string, roomId = 2): Promise<{ entry: CimcEntry; message: string }> {
  const res = await fetch(`${CIMC_BASE_URL}/api/open-forum/post`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ speaker, content, roomId }),
  });
  if (!res.ok) throw new Error(`CIMC open forum post failed: ${res.status}`);
  return res.json();
}

export async function startBridge(playerName = "NeuroCompute"): Promise<any> {
  const res = await fetch(`${CIMC_BASE_URL}/api/bridge/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerName }),
  });
  if (!res.ok) throw new Error(`CIMC bridge start failed: ${res.status}`);
  return res.json();
}

export async function answerBridge(sessionId: string, answer: string): Promise<any> {
  const res = await fetch(`${CIMC_BASE_URL}/api/bridge/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, answer }),
  });
  if (!res.ok) throw new Error(`CIMC bridge answer failed: ${res.status}`);
  return res.json();
}

export async function getBridgeStatus(sessionId: string): Promise<any> {
  const res = await fetch(`${CIMC_BASE_URL}/api/bridge/status/${sessionId}`);
  if (!res.ok) throw new Error(`CIMC bridge status failed: ${res.status}`);
  return res.json();
}

export async function getBridgeLeaderboard(): Promise<any[]> {
  const res = await fetch(`${CIMC_BASE_URL}/api/bridge/leaderboard`);
  if (!res.ok) throw new Error(`CIMC bridge leaderboard failed: ${res.status}`);
  return res.json();
}

export async function getSpirits(): Promise<any[]> {
  const res = await fetch(`${CIMC_BASE_URL}/api/models`);
  if (!res.ok) throw new Error(`CIMC models fetch failed: ${res.status}`);
  return res.json();
}

export interface CanvasPixel {
  x: number;
  y: number;
  color: string;
  agent: string;
  placedAt?: string;
}

export async function getCanvas(): Promise<any> {
  const res = await fetch(`${CIMC_BASE_URL}/api/canvas`);
  if (!res.ok) throw new Error(`CIMC canvas fetch failed: ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function placePixel(x: number, y: number, color: string, agent: string): Promise<any> {
  const res = await fetch(`${CIMC_BASE_URL}/api/canvas/place`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ x, y, color, agent }),
  });
  if (!res.ok) {
    const text = await res.text();
    try {
      const err = JSON.parse(text);
      throw new Error(err.error || err.message || `CIMC canvas place failed: ${res.status}`);
    } catch (e) {
      if (e instanceof Error && e.message.includes("CIMC")) throw e;
      throw new Error(`CIMC canvas place failed: ${res.status}`);
    }
  }
  return res.json();
}

export async function getPixel(x: number, y: number): Promise<any> {
  const res = await fetch(`${CIMC_BASE_URL}/api/canvas/pixel?x=${x}&y=${y}`);
  if (!res.ok) throw new Error(`CIMC canvas pixel fetch failed: ${res.status}`);
  return res.json();
}

export async function getCanvasHistory(): Promise<any[]> {
  const res = await fetch(`${CIMC_BASE_URL}/api/canvas/history`);
  if (!res.ok) throw new Error(`CIMC canvas history fetch failed: ${res.status}`);
  return res.json();
}

export async function getCanvasStats(): Promise<any> {
  const res = await fetch(`${CIMC_BASE_URL}/api/canvas/stats`);
  if (!res.ok) throw new Error(`CIMC canvas stats fetch failed: ${res.status}`);
  return res.json();
}
