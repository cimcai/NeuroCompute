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

export async function getConversation(roomId = 1, limit = 30): Promise<{ roomId: number; count: number; entries: CimcEntry[] }> {
  const res = await fetch(`${CIMC_BASE_URL}/api/inbound/conversation?roomId=${roomId}&limit=${limit}`);
  if (!res.ok) throw new Error(`CIMC conversation fetch failed: ${res.status}`);
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

export async function getSpirits(): Promise<any[]> {
  const res = await fetch(`${CIMC_BASE_URL}/api/models`);
  if (!res.ok) throw new Error(`CIMC models fetch failed: ${res.status}`);
  return res.json();
}
