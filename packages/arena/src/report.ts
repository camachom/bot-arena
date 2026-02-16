import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import type { RoundReport, RoundMetrics, ProfileMetrics } from '@bot-arena/types';

export function generateReport(report: RoundReport, outputPath: string): void {
  const html = renderReportHtml(report);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, html);
}

function renderReportHtml(report: RoundReport): string {
  const { roundNumber, timestamp, metrics, redProposal, blueProposal, redValidation, blueValidation, winner, winReason } = report;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bot Arena - Round ${roundNumber}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      color: #1a1a2e;
      background: linear-gradient(135deg, #0f0f23 0%, #1a1a2e 100%);
      min-height: 100vh;
      padding: 2rem;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 {
      color: #fff;
      font-size: 2.5rem;
      margin-bottom: 0.5rem;
      text-align: center;
    }
    .subtitle {
      color: #888;
      text-align: center;
      margin-bottom: 2rem;
    }
    .card {
      background: #fff;
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
    }
    .card h2 {
      color: #1a1a2e;
      font-size: 1.25rem;
      margin-bottom: 1rem;
      padding-bottom: 0.5rem;
      border-bottom: 2px solid #eee;
    }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; }
    .metric {
      background: #f8f9fa;
      padding: 1rem;
      border-radius: 8px;
      text-align: center;
    }
    .metric-value {
      font-size: 2rem;
      font-weight: bold;
      color: #1a1a2e;
    }
    .metric-label { color: #666; font-size: 0.875rem; }
    .success { color: #22c55e; }
    .warning { color: #f59e0b; }
    .danger { color: #ef4444; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 1rem;
    }
    th, td {
      padding: 0.75rem;
      text-align: left;
      border-bottom: 1px solid #eee;
    }
    th { background: #f8f9fa; font-weight: 600; }
    tr:hover { background: #f8f9fa; }
    .proposal {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.5rem;
    }
    @media (max-width: 768px) {
      .proposal { grid-template-columns: 1fr; }
    }
    .team-red { border-left: 4px solid #ef4444; }
    .team-blue { border-left: 4px solid #3b82f6; }
    .badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
    }
    .badge-accepted { background: #dcfce7; color: #166534; }
    .badge-rejected { background: #fee2e2; color: #991b1b; }
    pre {
      background: #1a1a2e;
      color: #a5f3fc;
      padding: 1rem;
      border-radius: 8px;
      overflow-x: auto;
      font-size: 0.875rem;
    }
    .reasoning {
      background: #f0f9ff;
      padding: 1rem;
      border-radius: 8px;
      margin-top: 0.5rem;
      font-style: italic;
      color: #1e40af;
    }
    .winner-banner {
      text-align: center;
      padding: 1.5rem;
      border-radius: 12px;
      margin-bottom: 1.5rem;
      font-size: 1.5rem;
      font-weight: bold;
    }
    .winner-red {
      background: linear-gradient(135deg, #fecaca 0%, #fee2e2 100%);
      color: #991b1b;
      border: 2px solid #ef4444;
    }
    .winner-blue {
      background: linear-gradient(135deg, #bfdbfe 0%, #dbeafe 100%);
      color: #1e40af;
      border: 2px solid #3b82f6;
    }
    .winner-draw {
      background: linear-gradient(135deg, #e5e7eb 0%, #f3f4f6 100%);
      color: #374151;
      border: 2px solid #9ca3af;
    }
    .winner-reason {
      font-size: 1rem;
      font-weight: normal;
      margin-top: 0.5rem;
      opacity: 0.8;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Bot Arena</h1>
    <p class="subtitle">Round ${roundNumber} &middot; ${new Date(timestamp).toLocaleString()}</p>

    <div class="winner-banner winner-${winner}">
      ${winner === 'red' ? '🔴 Red Wins' : winner === 'blue' ? '🔵 Blue Wins' : '⚪ Draw'}
      <div class="winner-reason">${winReason}</div>
    </div>

    <div class="card">
      <h2>Summary Metrics</h2>
      <div class="grid">
        <div class="metric">
          <div class="metric-value ${metrics.humanSuccessRate >= 0.99 ? 'success' : 'danger'}">
            ${(metrics.humanSuccessRate * 100).toFixed(1)}%
          </div>
          <div class="metric-label">Human Success Rate</div>
        </div>
        <div class="metric">
          <div class="metric-value ${metrics.falsePositiveRate <= 0.01 ? 'success' : 'danger'}">
            ${(metrics.falsePositiveRate * 100).toFixed(2)}%
          </div>
          <div class="metric-label">False Positive Rate</div>
        </div>
        <div class="metric">
          <div class="metric-value">${(metrics.botSuppressionRate * 100).toFixed(1)}%</div>
          <div class="metric-label">Bot Suppression Rate</div>
        </div>
        <div class="metric">
          <div class="metric-value">${(metrics.botExtractionRate * 100).toFixed(1)}%</div>
          <div class="metric-label">Bot Extraction Rate</div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Profile Results</h2>
      <table>
        <thead>
          <tr>
            <th>Profile</th>
            <th>Type</th>
            <th>Sessions</th>
            <th>Extraction Rate</th>
            <th>Blocked</th>
            <th>Avg Score</th>
          </tr>
        </thead>
        <tbody>
          ${metrics.profiles.map(renderProfileRow).join('')}
        </tbody>
      </table>
    </div>

    <div class="proposal">
      <div class="card team-red">
        <h2>Red Team Proposal</h2>
        ${redProposal ? `
          <span class="badge ${redValidation?.accepted ? 'badge-accepted' : 'badge-rejected'}">
            ${redValidation?.accepted ? 'Accepted' : 'Rejected'}
          </span>
          <div class="reasoning">${redProposal.reasoning}</div>
          <h3 style="margin-top: 1rem; font-size: 0.875rem; color: #666;">Changes</h3>
          <pre>${JSON.stringify(redProposal.changes, null, 2)}</pre>
          ${redValidation ? `<p style="margin-top: 0.5rem; color: #666;">${redValidation.reason}</p>` : ''}
        ` : '<p style="color: #666;">No proposal this round</p>'}
      </div>

      <div class="card team-blue">
        <h2>Blue Team Proposal</h2>
        ${blueProposal ? `
          <span class="badge ${blueValidation?.accepted ? 'badge-accepted' : 'badge-rejected'}">
            ${blueValidation?.accepted ? 'Accepted' : 'Rejected'}
          </span>
          <div class="reasoning">${blueProposal.reasoning}</div>
          <h3 style="margin-top: 1rem; font-size: 0.875rem; color: #666;">Changes</h3>
          <pre>${JSON.stringify(blueProposal.changes, null, 2)}</pre>
          ${blueValidation ? `<p style="margin-top: 0.5rem; color: #666;">${blueValidation.reason}</p>` : ''}
        ` : '<p style="color: #666;">No proposal this round</p>'}
      </div>
    </div>

    <div class="card">
      <h2>Current Configs</h2>
      <div class="proposal">
        <div>
          <h3 style="font-size: 0.875rem; color: #666; margin-bottom: 0.5rem;">attack_profile.json</h3>
          <pre>${JSON.stringify(report.attackProfile, null, 2)}</pre>
        </div>
        <div>
          <h3 style="font-size: 0.875rem; color: #666; margin-bottom: 0.5rem;">policy.yml</h3>
          <pre>${JSON.stringify(report.policy, null, 2)}</pre>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function renderProfileRow(profile: ProfileMetrics): string {
  const typeClass = profile.isBot ? '' : 'success';
  return `
    <tr>
      <td><strong>${profile.profileType}</strong></td>
      <td class="${typeClass}">${profile.isBot ? 'Bot' : 'Human'}</td>
      <td>${profile.sessions}</td>
      <td>${(profile.extractionRate * 100).toFixed(1)}%</td>
      <td>${profile.blockedRequests}</td>
      <td>${profile.avgScore.toFixed(2)}</td>
    </tr>
  `;
}
