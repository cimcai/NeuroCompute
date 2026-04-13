import { storage } from "./storage";
import { logger } from "./logger";

export interface ReportData {
  periodLabel: string;
  snapshotDate: string;
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
  topContributors: { nodeId: number; nodeName: string; totalTokens: number; pixelsPlaced: number }[];
}

export async function buildReport(): Promise<ReportData> {
  const [allNodes, topContributors, messageCount, prevSnapshot] = await Promise.all([
    storage.getNodes(),
    storage.getTopContributors(5),
    storage.getMessageCount(),
    storage.getLatestSnapshot(),
  ]);

  const totalTokens = allNodes.reduce((sum, n) => sum + n.totalTokens, 0);
  const totalPixelsPlaced = allNodes.reduce((sum, n) => sum + n.pixelsPlaced, 0);
  const totalNodes = allNodes.length;
  const activeNodes = allNodes.filter(n => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return n.lastSeen.getTime() > cutoff;
  }).length;

  const prevTotalTokens = prevSnapshot?.totalTokens ?? 0;
  const prevTotalPixels = prevSnapshot?.totalPixelsPlaced ?? 0;

  const tokenDelta = Math.max(0, totalTokens - prevTotalTokens);
  const pixelDelta = Math.max(0, totalPixelsPlaced - prevTotalPixels);
  const computeSeconds = parseFloat((tokenDelta * 0.1).toFixed(1));
  const computeSecondsDelta = parseFloat((tokenDelta * 0.1).toFixed(1));

  const now = new Date();
  const snapshotDate = now.toISOString().split("T")[0];
  const periodLabel = prevSnapshot
    ? `${prevSnapshot.snapshotDate} → ${snapshotDate}`
    : `Inception → ${snapshotDate}`;

  return {
    periodLabel,
    snapshotDate,
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
    topContributors,
  };
}

export async function takeSnapshot(report: ReportData): Promise<void> {
  await storage.createSnapshot({
    snapshotDate: report.snapshotDate,
    totalNodes: report.totalNodes,
    totalTokens: report.totalTokens,
    totalPixelsPlaced: report.totalPixelsPlaced,
    activeNodes: report.activeNodes,
    messageCount: report.messageCount,
  });
  logger.info("analytics", `Snapshot taken for ${report.snapshotDate}`);
}

export function renderEmailHtml(report: ReportData): string {
  const fmt = (n: number) => n.toLocaleString("en-US");
  const fmtSec = (s: number) => {
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${(s % 60).toFixed(0)}s`;
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
        <td style="padding:6px 10px;color:#e8d5b0">${c.nodeName}</td>
        <td style="padding:6px 10px;color:#7aadad;text-align:right;font-family:monospace">${fmt(c.totalTokens)}</td>
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
          <div style="font-size:22px;font-weight:bold;color:#e8d5b0">Network Activity Report</div>
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
                  <div style="font-size:11px;color:#8090a0;margin-top:2px;font-family:monospace">Total: ${fmtSec(report.totalTokens * 0.1)}</div>
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

        <!-- Top contributors -->
        <tr><td style="padding:0 32px 24px;">
          <div style="background:#111120;border:1px solid #1a1a2a;border-radius:6px;padding:16px;">
            <div style="font-size:11px;letter-spacing:2px;color:#c4a882;text-transform:uppercase;margin-bottom:12px">Top 5 Contributors (All Time)</div>
            <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;border-collapse:collapse;">
              <tr style="border-bottom:1px solid #1a1a2a;">
                <th style="padding:6px 10px;text-align:left;color:#8090a0;font-weight:normal;font-size:11px">#</th>
                <th style="padding:6px 10px;text-align:left;color:#8090a0;font-weight:normal;font-size:11px">Node</th>
                <th style="padding:6px 10px;text-align:right;color:#8090a0;font-weight:normal;font-size:11px">Tokens</th>
                <th style="padding:6px 10px;text-align:right;color:#8090a0;font-weight:normal;font-size:11px">Pixels</th>
              </tr>
              ${topRows || '<tr><td colspan="4" style="padding:12px 10px;color:#8090a0;text-align:center">No contributors yet</td></tr>'}
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

  if (!apiKey || !toEmail) {
    logger.warn("analytics", `Email skipped — missing ${!apiKey ? "RESEND_API_KEY" : "REPORT_EMAIL"} env var`);
    return false;
  }

  const html = renderEmailHtml(report);
  const subject = `NeuroCompute Report — ${report.snapshotDate} | ${report.activeNodes} nodes active`;

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "NeuroCompute <reports@neurocompute.replit.app>",
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
