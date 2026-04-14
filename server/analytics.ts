import { storage } from "./storage";
import { logger } from "./logger";
import type { DailySnapshot } from "@shared/schema";

export interface ContributorPeriod {
  nodeId: number;
  nodeName: string;
  periodTokens: number;
  totalTokens: number;
  pixelsPlaced: number;
}

export interface ReportData {
  periodLabel: string;
  snapshotDate: string;
  frequency: string;
  totalNodes: number;
  totalTokens: number;
  totalPixelsPlaced: number;
  activeNodes: number;
  messageCount: number;
  computeSeconds: number;
  prevTotalTokens: number;
  prevTotalPixels: number;
  tokenDelta: number;
  pixelDelta: number;
  computeSecondsDelta: number;
  topContributors: ContributorPeriod[];
}

export function getReportFrequency(): "daily" | "weekly" {
  const freq = (process.env.REPORT_FREQUENCY || "daily").toLowerCase();
  return freq === "weekly" ? "weekly" : "daily";
}

export function getIntervalMs(): number {
  return getReportFrequency() === "weekly"
    ? 7 * 24 * 60 * 60 * 1000
    : 24 * 60 * 60 * 1000;
}

export async function buildReport(): Promise<ReportData> {
  const [allNodes, messageCount, prevSnapshot] = await Promise.all([
    storage.getNodes(),
    storage.getMessageCount(),
    storage.getLatestSnapshot(),
  ]);

  const totalTokens = allNodes.reduce((sum, n) => sum + n.totalTokens, 0);
  const totalPixelsPlaced = allNodes.reduce((sum, n) => sum + n.pixelsPlaced, 0);
  const totalNodes = allNodes.length;

  const cutoff24h = Date.now() - 24 * 60 * 60 * 1000;
  const activeNodes = allNodes.filter(n => n.lastSeen.getTime() > cutoff24h).length;

  const prevTotalTokens = prevSnapshot?.totalTokens ?? 0;
  const prevTotalPixels = prevSnapshot?.totalPixelsPlaced ?? 0;

  const tokenDelta = Math.max(0, totalTokens - prevTotalTokens);
  const pixelDelta = Math.max(0, totalPixelsPlaced - prevTotalPixels);
  const computeSecondsDelta = parseFloat((tokenDelta * 0.1).toFixed(1));
  const computeSeconds = parseFloat((totalTokens * 0.1).toFixed(1));

  let prevNodeTokens: Record<number, number> = {};
  if (prevSnapshot?.nodeTokensSnapshot) {
    try {
      prevNodeTokens = JSON.parse(prevSnapshot.nodeTokensSnapshot);
    } catch {}
  }

  const contributors: ContributorPeriod[] = allNodes
    .map(n => ({
      nodeId: n.id,
      nodeName: n.displayName || n.name,
      periodTokens: Math.max(0, n.totalTokens - (prevNodeTokens[n.id] ?? 0)),
      totalTokens: n.totalTokens,
      pixelsPlaced: n.pixelsPlaced,
    }))
    .filter(c => c.periodTokens > 0)
    .sort((a, b) => b.periodTokens - a.periodTokens)
    .slice(0, 5);

  const now = new Date();
  const snapshotDate = now.toISOString().split("T")[0];
  const frequency = getReportFrequency();
  const periodLabel = prevSnapshot
    ? `${prevSnapshot.snapshotDate} → ${snapshotDate}`
    : `Inception → ${snapshotDate}`;

  return {
    periodLabel,
    snapshotDate,
    frequency,
    totalNodes,
    totalTokens,
    totalPixelsPlaced,
    activeNodes,
    messageCount,
    computeSeconds,
    prevTotalTokens,
    prevTotalPixels,
    tokenDelta,
    pixelDelta,
    computeSecondsDelta,
    topContributors: contributors,
  };
}

export async function takeSnapshot(report: ReportData): Promise<void> {
  const allNodes = await storage.getNodes();
  const nodeTokensSnapshot: Record<number, number> = {};
  for (const n of allNodes) {
    nodeTokensSnapshot[n.id] = n.totalTokens;
  }

  await storage.createSnapshot({
    snapshotDate: report.snapshotDate,
    totalNodes: report.totalNodes,
    totalTokens: report.totalTokens,
    totalPixelsPlaced: report.totalPixelsPlaced,
    activeNodes: report.activeNodes,
    messageCount: report.messageCount,
    nodeTokensSnapshot: JSON.stringify(nodeTokensSnapshot),
  });
  logger.info("analytics", `Snapshot taken for ${report.snapshotDate} (${report.frequency})`);
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderEmailHtml(report: ReportData): string {
  const fmt = (n: number) => n.toLocaleString("en-US");
  const fmtSec = (s: number) => {
    if (s < 60) return `${s.toFixed(1)}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  };

  const arrowUp = (delta: number) =>
    delta > 0
      ? `<span style="color:#7aadad">▲ +${fmt(delta)}</span>`
      : `<span style="color:#8090a0">— no change</span>`;

  const topRows = report.topContributors
    .map(
      (c, i) => `
      <tr>
        <td style="padding:6px 10px;color:#c4a882;font-family:monospace">${i + 1}</td>
        <td style="padding:6px 10px;color:#e8d5b0">${escHtml(c.nodeName)}</td>
        <td style="padding:6px 10px;color:#7aadad;text-align:right;font-family:monospace">+${fmt(c.periodTokens)}</td>
        <td style="padding:6px 10px;color:#a98ec4;text-align:right;font-family:monospace">${fmt(c.pixelsPlaced)}</td>
      </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>NeuroCompute Network Report</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:Arial,sans-serif;color:#e8d5b0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0f;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#11111a;border:1px solid #2a2a3a;border-radius:8px;overflow:hidden;">

        <!-- Header -->
        <tr><td style="background:#0d1a2a;padding:24px 32px;border-bottom:1px solid #1a2a3a;">
          <div style="font-size:11px;letter-spacing:3px;color:#7aadad;text-transform:uppercase;margin-bottom:6px">NEUROCOMPUTE NETWORK</div>
          <div style="font-size:22px;font-weight:bold;color:#e8d5b0">${report.frequency === "weekly" ? "Weekly" : "Daily"} Network Report</div>
          <div style="font-size:12px;color:#8090a0;margin-top:4px;font-family:monospace">${report.periodLabel}</div>
        </td></tr>

        <!-- Stat cards -->
        <tr><td style="padding:24px 32px 8px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td width="33%" style="padding-right:8px;">
                <div style="background:#0d1a1a;border:1px solid #1a3a3a;border-radius:6px;padding:16px;text-align:center;">
                  <div style="font-size:11px;letter-spacing:2px;color:#7aadad;text-transform:uppercase;margin-bottom:8px">Compute Time</div>
                  <div style="font-size:28px;font-weight:bold;color:#7aadad;font-family:monospace">${fmtSec(report.computeSecondsDelta)}</div>
                  <div style="font-size:11px;color:#8090a0;margin-top:4px">this period</div>
                  <div style="font-size:11px;color:#8090a0;margin-top:2px;font-family:monospace">Total: ${fmtSec(report.computeSeconds)}</div>
                </div>
              </td>
              <td width="33%" style="padding-right:8px;">
                <div style="background:#1a0d1a;border:1px solid #2a1a2a;border-radius:6px;padding:16px;text-align:center;">
                  <div style="font-size:11px;letter-spacing:2px;color:#a98ec4;text-transform:uppercase;margin-bottom:8px">Pixels Placed</div>
                  <div style="font-size:28px;font-weight:bold;color:#a98ec4;font-family:monospace">${fmt(report.pixelDelta)}</div>
                  <div style="font-size:11px;color:#8090a0;margin-top:4px">this period</div>
                  <div style="font-size:11px;color:#8090a0;margin-top:2px;font-family:monospace">Total: ${fmt(report.totalPixelsPlaced)}</div>
                </div>
              </td>
              <td width="33%">
                <div style="background:#0d1a0d;border:1px solid #1a2a1a;border-radius:6px;padding:16px;text-align:center;">
                  <div style="font-size:11px;letter-spacing:2px;color:#8faf8a;text-transform:uppercase;margin-bottom:8px">Active Nodes</div>
                  <div style="font-size:28px;font-weight:bold;color:#8faf8a;font-family:monospace">${report.activeNodes}</div>
                  <div style="font-size:11px;color:#8090a0;margin-top:4px">last 24h</div>
                  <div style="font-size:11px;color:#8090a0;margin-top:2px;font-family:monospace">Total: ${report.totalNodes}</div>
                </div>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Period comparison -->
        <tr><td style="padding:16px 32px;">
          <div style="background:#111120;border:1px solid #1a1a2a;border-radius:6px;padding:16px;">
            <div style="font-size:11px;letter-spacing:2px;color:#c4a882;text-transform:uppercase;margin-bottom:12px">Period Comparison</div>
            <table width="100%" cellpadding="0" cellspacing="0" style="font-family:monospace;font-size:13px;">
              <tr>
                <td style="color:#8090a0;padding:3px 0">Tokens generated</td>
                <td style="text-align:right">${arrowUp(report.tokenDelta)} tokens</td>
              </tr>
              <tr>
                <td style="color:#8090a0;padding:3px 0">Compute contributed</td>
                <td style="text-align:right">${arrowUp(Math.round(report.computeSecondsDelta))} seconds</td>
              </tr>
              <tr>
                <td style="color:#8090a0;padding:3px 0">Pixels painted</td>
                <td style="text-align:right">${arrowUp(report.pixelDelta)} pixels</td>
              </tr>
              <tr>
                <td style="color:#8090a0;padding:3px 0">Chat messages</td>
                <td style="text-align:right"><span style="color:#e8d5b0">${fmt(report.messageCount)}</span> total</td>
              </tr>
            </table>
          </div>
        </td></tr>

        <!-- Top contributors this period -->
        <tr><td style="padding:0 32px 24px;">
          <div style="background:#111120;border:1px solid #1a1a2a;border-radius:6px;padding:16px;">
            <div style="font-size:11px;letter-spacing:2px;color:#c4a882;text-transform:uppercase;margin-bottom:12px">Top 5 Contributors — This Period</div>
            <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;border-collapse:collapse;">
              <tr style="border-bottom:1px solid #1a1a2a;">
                <th style="padding:6px 10px;text-align:left;color:#8090a0;font-weight:normal;font-size:11px">#</th>
                <th style="padding:6px 10px;text-align:left;color:#8090a0;font-weight:normal;font-size:11px">Node</th>
                <th style="padding:6px 10px;text-align:right;color:#8090a0;font-weight:normal;font-size:11px">Period Tokens</th>
                <th style="padding:6px 10px;text-align:right;color:#8090a0;font-weight:normal;font-size:11px">Pixels</th>
              </tr>
              ${topRows || '<tr><td colspan="4" style="padding:12px 10px;color:#8090a0;text-align:center">No contributions this period</td></tr>'}
            </table>
          </div>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#0a0a10;padding:16px 32px;border-top:1px solid #1a1a2a;text-align:center;">
          <div style="font-size:11px;color:#4a4a5a;font-family:monospace">NeuroCompute — Decentralized AI Compute Network</div>
          <div style="font-size:11px;color:#3a3a4a;font-family:monospace;margin-top:4px">cimc.io integration | Sub-pixel districts | Proof of Compute</div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function sendReportEmail(report: ReportData): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const toEmail = process.env.REPORT_EMAIL;

  if (!apiKey) {
    logger.warn("analytics", "Email skipped — RESEND_API_KEY is not set");
    return false;
  }
  if (!toEmail) {
    logger.warn("analytics", "Email skipped — REPORT_EMAIL is not set");
    return false;
  }

  const html = renderEmailHtml(report);
  const label = report.frequency === "weekly" ? "Weekly" : "Daily";
  const subject = `${label} NeuroCompute Report — ${report.snapshotDate} | ${report.activeNodes} nodes active`;

  try {
    const fromEmail = process.env.REPORT_FROM_EMAIL || "NeuroCompute <onboarding@resend.dev>";

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [toEmail],
        subject,
        html,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      logger.error("analytics", `Resend API error ${resp.status}: ${body}`);
      return false;
    }

    const result = await resp.json() as { id?: string };
    logger.info("analytics", `Report email sent → ${toEmail} (id: ${result.id})`);
    return true;
  } catch (err) {
    logger.error("analytics", "Failed to send report email", err);
    return false;
  }
}

export async function runDailyReport(): Promise<{ success: boolean; emailSent: boolean; report: ReportData }> {
  const report = await buildReport();
  await takeSnapshot(report);
  const emailSent = await sendReportEmail(report);
  return { success: true, emailSent, report };
}

// ─── Rich analytics API ───────────────────────────────────────────────────────

export interface TrendPoint {
  date: string;
  totalTokens: number;
  totalPixels: number;
  totalSubPixels: number;
  activeNodes: number;
  messageCount: number;
  tokenDelta: number;
  pixelDelta: number;
}

export interface NodeStat {
  rank: number;
  nodeId: number;
  nodeName: string;
  status: string;
  periodTokens: number;
  totalTokens: number;
  pixelsPlaced: number;
  pixelCredits: number;
  lastSeen: string;
}

export interface AnalyticsData {
  generatedAt: string;
  live: {
    totalNodes: number;
    activeNodes24h: number;
    onlineNow: number;
    totalTokens: number;
    totalPixelsPlaced: number;
    totalSubPixels: number;
    messageCount: number;
    computeSeconds: number;
    pixelCreditsInCirculation: number;
  };
  period: {
    label: string;
    tokenDelta: number;
    pixelDelta: number;
    computeSecondsDelta: number;
    newContributors: number;
  };
  trend: TrendPoint[];
  contributors: NodeStat[];
}

export async function buildAnalyticsData(trendDays = 14): Promise<AnalyticsData> {
  const [allNodes, messageCount, subPixelCount, snapshots] = await Promise.all([
    storage.getNodes(),
    storage.getMessageCount(),
    storage.getSubPixelCount(),
    storage.getSnapshots(trendDays),
  ]);

  const now = new Date();
  const cutoff24h = Date.now() - 24 * 60 * 60 * 1000;

  const totalTokens = allNodes.reduce((s, n) => s + n.totalTokens, 0);
  const totalPixelsPlaced = allNodes.reduce((s, n) => s + n.pixelsPlaced, 0);
  const pixelCreditsInCirculation = allNodes.reduce((s, n) => s + n.pixelCredits, 0);
  const activeNodes24h = allNodes.filter(n => n.lastSeen.getTime() > cutoff24h).length;
  const onlineNow = allNodes.filter(n => n.status === "online").length;
  const computeSeconds = parseFloat((totalTokens * 0.1).toFixed(1));

  const prevSnapshot = snapshots.length > 0 ? snapshots[snapshots.length - 1] : undefined;
  const prevTotalTokens = prevSnapshot?.totalTokens ?? 0;
  const prevTotalPixels = prevSnapshot?.totalPixelsPlaced ?? 0;
  const tokenDelta = Math.max(0, totalTokens - prevTotalTokens);
  const pixelDelta = Math.max(0, totalPixelsPlaced - prevTotalPixels);
  const computeSecondsDelta = parseFloat((tokenDelta * 0.1).toFixed(1));

  let prevNodeTokens: Record<number, number> = {};
  if (prevSnapshot?.nodeTokensSnapshot) {
    try { prevNodeTokens = JSON.parse(prevSnapshot.nodeTokensSnapshot); } catch {}
  }
  const prevNodeIds = new Set(Object.keys(prevNodeTokens).map(Number));
  const newContributors = allNodes.filter(n => n.totalTokens > 0 && !prevNodeIds.has(n.id)).length;

  const periodLabel = prevSnapshot
    ? `${prevSnapshot.snapshotDate} → ${now.toISOString().split("T")[0]}`
    : `Inception → ${now.toISOString().split("T")[0]}`;

  const trend: TrendPoint[] = snapshots.map((snap, i) => {
    const prev = i > 0 ? snapshots[i - 1] : undefined;
    return {
      date: snap.snapshotDate,
      totalTokens: snap.totalTokens,
      totalPixels: snap.totalPixelsPlaced,
      totalSubPixels: 0,
      activeNodes: snap.activeNodes,
      messageCount: snap.messageCount,
      tokenDelta: prev ? Math.max(0, snap.totalTokens - prev.totalTokens) : 0,
      pixelDelta: prev ? Math.max(0, snap.totalPixelsPlaced - prev.totalPixelsPlaced) : 0,
    };
  });

  const contributors: NodeStat[] = allNodes
    .map((n, _, arr) => ({
      rank: 0,
      nodeId: n.id,
      nodeName: n.displayName || n.name,
      status: n.status,
      periodTokens: Math.max(0, n.totalTokens - (prevNodeTokens[n.id] ?? 0)),
      totalTokens: n.totalTokens,
      pixelsPlaced: n.pixelsPlaced,
      pixelCredits: n.pixelCredits,
      lastSeen: n.lastSeen.toISOString(),
    }))
    .sort((a, b) => b.periodTokens - a.periodTokens || b.totalTokens - a.totalTokens)
    .map((c, i) => ({ ...c, rank: i + 1 }));

  return {
    generatedAt: now.toISOString(),
    live: {
      totalNodes: allNodes.length,
      activeNodes24h,
      onlineNow,
      totalTokens,
      totalPixelsPlaced,
      totalSubPixels: subPixelCount,
      messageCount,
      computeSeconds,
      pixelCreditsInCirculation,
    },
    period: { label: periodLabel, tokenDelta, pixelDelta, computeSecondsDelta, newContributors },
    trend,
    contributors,
  };
}

export function renderAnalyticsEmailHtml(data: AnalyticsData): string {
  const fmt = (n: number) => n.toLocaleString("en-US");
  const fmtSec = (s: number) => {
    if (s < 60) return `${s.toFixed(1)}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  };
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const delta = (n: number) =>
    n > 0 ? `<span style="color:#7aadad">▲ +${fmt(n)}</span>` : `<span style="color:#8090a0">—</span>`;

  const trendRows = data.trend.length > 0
    ? data.trend.slice(-10).map(t => `
      <tr style="border-bottom:1px solid #1a1a2a">
        <td style="padding:5px 10px;color:#8090a0;font-family:monospace;font-size:12px">${esc(t.date)}</td>
        <td style="padding:5px 10px;text-align:right;font-family:monospace;font-size:12px">${delta(t.tokenDelta)}</td>
        <td style="padding:5px 10px;text-align:right;font-family:monospace;font-size:12px">${delta(t.pixelDelta)}</td>
        <td style="padding:5px 10px;text-align:right;font-family:monospace;font-size:12px;color:#8faf8a">${fmt(t.activeNodes)}</td>
      </tr>`).join("")
    : `<tr><td colspan="4" style="padding:12px;color:#8090a0;text-align:center">No historical snapshots yet</td></tr>`;

  const topContributors = data.contributors.slice(0, 10);
  const contributorRows = topContributors.length > 0
    ? topContributors.map(c => `
      <tr style="border-bottom:1px solid #1a1a2a">
        <td style="padding:5px 10px;color:#c4a882;font-family:monospace;font-size:12px">${c.rank}</td>
        <td style="padding:5px 10px;color:#e8d5b0;font-size:12px">${esc(c.nodeName)}</td>
        <td style="padding:5px 10px;text-align:right;font-family:monospace;font-size:12px;color:#7aadad">+${fmt(c.periodTokens)}</td>
        <td style="padding:5px 10px;text-align:right;font-family:monospace;font-size:12px;color:#a98ec4">${fmt(c.pixelsPlaced)}</td>
        <td style="padding:5px 10px;text-align:center;font-size:11px;color:${c.status === "online" ? "#8faf8a" : "#8090a0"}">${c.status}</td>
      </tr>`).join("")
    : `<tr><td colspan="5" style="padding:12px;color:#8090a0;text-align:center">No contributions this period</td></tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>NeuroCompute Analytics Report</title></head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:Arial,sans-serif;color:#e8d5b0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0f;padding:32px 0;">
    <tr><td align="center">
      <table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#11111a;border:1px solid #2a2a3a;border-radius:8px;overflow:hidden;">

        <tr><td style="background:#0d1a2a;padding:24px 32px;border-bottom:1px solid #1a2a3a;">
          <div style="font-size:11px;letter-spacing:3px;color:#7aadad;text-transform:uppercase;margin-bottom:6px">NEUROCOMPUTE NETWORK</div>
          <div style="font-size:22px;font-weight:bold;color:#e8d5b0">Analytics Report</div>
          <div style="font-size:12px;color:#8090a0;margin-top:4px;font-family:monospace">${esc(data.period.label)}</div>
          <div style="font-size:11px;color:#4a4a5a;margin-top:2px;font-family:monospace">Generated ${esc(data.generatedAt.replace("T"," ").slice(0,19))} UTC</div>
        </td></tr>

        <tr><td style="padding:24px 32px 8px;">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td width="25%" style="padding-right:6px;">
              <div style="background:#0d1a1a;border:1px solid #1a3a3a;border-radius:6px;padding:14px;text-align:center;">
                <div style="font-size:10px;letter-spacing:2px;color:#7aadad;text-transform:uppercase;margin-bottom:6px">Compute</div>
                <div style="font-size:22px;font-weight:bold;color:#7aadad;font-family:monospace">${fmtSec(data.period.computeSecondsDelta)}</div>
                <div style="font-size:10px;color:#8090a0;margin-top:3px">period</div>
                <div style="font-size:10px;color:#8090a0;font-family:monospace">All: ${fmtSec(data.live.computeSeconds)}</div>
              </div>
            </td>
            <td width="25%" style="padding-right:6px;">
              <div style="background:#1a0d1a;border:1px solid #2a1a2a;border-radius:6px;padding:14px;text-align:center;">
                <div style="font-size:10px;letter-spacing:2px;color:#a98ec4;text-transform:uppercase;margin-bottom:6px">Pixels</div>
                <div style="font-size:22px;font-weight:bold;color:#a98ec4;font-family:monospace">${fmt(data.period.pixelDelta)}</div>
                <div style="font-size:10px;color:#8090a0;margin-top:3px">period</div>
                <div style="font-size:10px;color:#8090a0;font-family:monospace">Sub: ${fmt(data.live.totalSubPixels)}</div>
              </div>
            </td>
            <td width="25%" style="padding-right:6px;">
              <div style="background:#0d1a0d;border:1px solid #1a2a1a;border-radius:6px;padding:14px;text-align:center;">
                <div style="font-size:10px;letter-spacing:2px;color:#8faf8a;text-transform:uppercase;margin-bottom:6px">Nodes</div>
                <div style="font-size:22px;font-weight:bold;color:#8faf8a;font-family:monospace">${data.live.activeNodes24h}</div>
                <div style="font-size:10px;color:#8090a0;margin-top:3px">active 24h</div>
                <div style="font-size:10px;color:#8090a0;font-family:monospace">Online: ${data.live.onlineNow}</div>
              </div>
            </td>
            <td width="25%">
              <div style="background:#1a1a0d;border:1px solid #2a2a1a;border-radius:6px;padding:14px;text-align:center;">
                <div style="font-size:10px;letter-spacing:2px;color:#c4a882;text-transform:uppercase;margin-bottom:6px">Tokens</div>
                <div style="font-size:22px;font-weight:bold;color:#c4a882;font-family:monospace">${fmt(data.period.tokenDelta)}</div>
                <div style="font-size:10px;color:#8090a0;margin-top:3px">period</div>
                <div style="font-size:10px;color:#8090a0;font-family:monospace">Total: ${fmt(data.live.totalTokens)}</div>
              </div>
            </td>
          </tr></table>
        </td></tr>

        <tr><td style="padding:16px 32px 0;">
          <div style="background:#111120;border:1px solid #1a1a2a;border-radius:6px;padding:16px;">
            <div style="font-size:11px;letter-spacing:2px;color:#c4a882;text-transform:uppercase;margin-bottom:10px">Historical Trend</div>
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
              <tr style="border-bottom:1px solid #2a2a3a">
                <th style="padding:5px 10px;text-align:left;color:#8090a0;font-weight:normal;font-size:10px">Date</th>
                <th style="padding:5px 10px;text-align:right;color:#8090a0;font-weight:normal;font-size:10px">Tokens</th>
                <th style="padding:5px 10px;text-align:right;color:#8090a0;font-weight:normal;font-size:10px">Pixels</th>
                <th style="padding:5px 10px;text-align:right;color:#8090a0;font-weight:normal;font-size:10px">Active</th>
              </tr>
              ${trendRows}
            </table>
          </div>
        </td></tr>

        <tr><td style="padding:16px 32px 24px;">
          <div style="background:#111120;border:1px solid #1a1a2a;border-radius:6px;padding:16px;">
            <div style="font-size:11px;letter-spacing:2px;color:#c4a882;text-transform:uppercase;margin-bottom:10px">Top 10 Contributors — This Period</div>
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
              <tr style="border-bottom:1px solid #2a2a3a">
                <th style="padding:5px 10px;text-align:left;color:#8090a0;font-weight:normal;font-size:10px">#</th>
                <th style="padding:5px 10px;text-align:left;color:#8090a0;font-weight:normal;font-size:10px">Node</th>
                <th style="padding:5px 10px;text-align:right;color:#8090a0;font-weight:normal;font-size:10px">Period Tokens</th>
                <th style="padding:5px 10px;text-align:right;color:#8090a0;font-weight:normal;font-size:10px">Pixels</th>
                <th style="padding:5px 10px;text-align:center;color:#8090a0;font-weight:normal;font-size:10px">Status</th>
              </tr>
              ${contributorRows}
            </table>
          </div>
        </td></tr>

        <tr><td style="background:#0a0a10;padding:14px 32px;border-top:1px solid #1a1a2a;text-align:center;">
          <div style="font-size:11px;color:#4a4a5a;font-family:monospace">NeuroCompute — Decentralized AI Compute Network</div>
          <div style="font-size:10px;color:#3a3a4a;font-family:monospace;margin-top:3px">Messages: ${fmt(data.live.messageCount)} · Credits in circulation: ${fmt(data.live.pixelCreditsInCirculation)} · New nodes this period: ${data.period.newContributors}</div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`;
}
