import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { RoundReport, RoundMetrics } from '@bot-arena/types';

export function generateSummary(reports: RoundReport[], outputPath: string): void {
  const html = renderSummaryHtml(reports);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, html);
}

function determineWinner(metrics: RoundMetrics): 'red' | 'blue' | 'draw' {
  const { botExtractionRate, botSuppressionRate, falsePositiveRate } = metrics;
  const blueConstrained = falsePositiveRate <= 0.01;

  if (botExtractionRate > 0.5) {
    return 'red';
  }

  if (botSuppressionRate > 0.5 && blueConstrained) {
    return 'blue';
  }

  return 'draw';
}

function renderSummaryHtml(reports: RoundReport[]): string {
  const rounds = reports.map(r => r.roundNumber);
  const extractionRates = reports.map(r => (r.metrics.botExtractionRate * 100).toFixed(1));
  const suppressionRates = reports.map(r => (r.metrics.botSuppressionRate * 100).toFixed(1));
  const fprRates = reports.map(r => (r.metrics.falsePositiveRate * 100).toFixed(2));

  const redWins = reports.filter(r => determineWinner(r.metrics) === 'red').length;
  const blueWins = reports.filter(r => determineWinner(r.metrics) === 'blue').length;
  const draws = reports.length - redWins - blueWins;

  const redAccepted = reports.filter(r => r.redValidation?.accepted).length;
  const blueAccepted = reports.filter(r => r.blueValidation?.accepted).length;
  const redProposals = reports.filter(r => r.redProposal).length;
  const blueProposals = reports.filter(r => r.blueProposal).length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bot Arena - Summary Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
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
    .container { max-width: 1400px; margin: 0 auto; }
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
    .grid-2 {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: 1.5rem;
    }
    @media (max-width: 900px) {
      .grid-2 { grid-template-columns: 1fr; }
    }
    .chart-container {
      position: relative;
      height: 300px;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1rem;
      margin-bottom: 1rem;
    }
    .stat {
      text-align: center;
      padding: 1rem;
      border-radius: 8px;
    }
    .stat-red { background: #fee2e2; }
    .stat-blue { background: #dbeafe; }
    .stat-draw { background: #f3f4f6; }
    .stat-value {
      font-size: 2.5rem;
      font-weight: bold;
    }
    .stat-red .stat-value { color: #dc2626; }
    .stat-blue .stat-value { color: #2563eb; }
    .stat-draw .stat-value { color: #6b7280; }
    .stat-label {
      font-size: 0.875rem;
      color: #666;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      padding: 0.75rem;
      text-align: left;
      border-bottom: 1px solid #eee;
    }
    th { background: #f8f9fa; font-weight: 600; }
    tr:hover { background: #f8f9fa; }
    .winner-red { color: #dc2626; font-weight: 600; }
    .winner-blue { color: #2563eb; font-weight: 600; }
    .winner-draw { color: #6b7280; font-weight: 600; }
    .acceptance-bar {
      display: flex;
      height: 24px;
      border-radius: 4px;
      overflow: hidden;
      background: #e5e7eb;
      margin-top: 0.5rem;
    }
    .acceptance-fill {
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.75rem;
      font-weight: 600;
      color: #fff;
    }
    .acceptance-red { background: #ef4444; }
    .acceptance-blue { background: #3b82f6; }
    .acceptance-label {
      display: flex;
      justify-content: space-between;
      margin-bottom: 0.25rem;
      font-size: 0.875rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Bot Arena Summary</h1>
    <p class="subtitle">${reports.length} Rounds &middot; ${new Date().toLocaleString()}</p>

    <div class="grid-2">
      <div class="card">
        <h2>Metrics Over Time</h2>
        <div class="chart-container">
          <canvas id="metricsChart"></canvas>
        </div>
      </div>

      <div class="card">
        <h2>Win Distribution</h2>
        <div class="stats-grid">
          <div class="stat stat-red">
            <div class="stat-value">${redWins}</div>
            <div class="stat-label">Red Wins</div>
          </div>
          <div class="stat stat-blue">
            <div class="stat-value">${blueWins}</div>
            <div class="stat-label">Blue Wins</div>
          </div>
          <div class="stat stat-draw">
            <div class="stat-value">${draws}</div>
            <div class="stat-label">Draws</div>
          </div>
        </div>
        <div class="chart-container" style="height: 200px;">
          <canvas id="winChart"></canvas>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Proposal Acceptance Rates</h2>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 2rem;">
        <div>
          <div class="acceptance-label">
            <span>Red Team</span>
            <span>${redAccepted}/${redProposals} accepted (${redProposals > 0 ? ((redAccepted / redProposals) * 100).toFixed(0) : 0}%)</span>
          </div>
          <div class="acceptance-bar">
            <div class="acceptance-fill acceptance-red" style="width: ${redProposals > 0 ? (redAccepted / redProposals) * 100 : 0}%">
              ${redProposals > 0 && redAccepted > 0 ? `${((redAccepted / redProposals) * 100).toFixed(0)}%` : ''}
            </div>
          </div>
        </div>
        <div>
          <div class="acceptance-label">
            <span>Blue Team</span>
            <span>${blueAccepted}/${blueProposals} accepted (${blueProposals > 0 ? ((blueAccepted / blueProposals) * 100).toFixed(0) : 0}%)</span>
          </div>
          <div class="acceptance-bar">
            <div class="acceptance-fill acceptance-blue" style="width: ${blueProposals > 0 ? (blueAccepted / blueProposals) * 100 : 0}%">
              ${blueProposals > 0 && blueAccepted > 0 ? `${((blueAccepted / blueProposals) * 100).toFixed(0)}%` : ''}
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>Round-by-Round Results</h2>
      <table>
        <thead>
          <tr>
            <th>Round</th>
            <th>Extraction</th>
            <th>Suppression</th>
            <th>FPR</th>
            <th>Red Proposal</th>
            <th>Blue Proposal</th>
            <th>Winner</th>
          </tr>
        </thead>
        <tbody>
          ${reports.map(r => {
            const winner = determineWinner(r.metrics);
            const winnerClass = `winner-${winner}`;
            const winnerLabel = winner === 'red' ? 'Red' : winner === 'blue' ? 'Blue' : 'Draw';
            return `
          <tr>
            <td>${r.roundNumber}</td>
            <td>${(r.metrics.botExtractionRate * 100).toFixed(1)}%</td>
            <td>${(r.metrics.botSuppressionRate * 100).toFixed(1)}%</td>
            <td>${(r.metrics.falsePositiveRate * 100).toFixed(2)}%</td>
            <td>${r.redValidation?.accepted ? 'Accepted' : r.redProposal ? 'Rejected' : '-'}</td>
            <td>${r.blueValidation?.accepted ? 'Accepted' : r.blueProposal ? 'Rejected' : '-'}</td>
            <td class="${winnerClass}">${winnerLabel}</td>
          </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  </div>

  <script>
    // Metrics over time chart
    const metricsCtx = document.getElementById('metricsChart').getContext('2d');
    new Chart(metricsCtx, {
      type: 'line',
      data: {
        labels: ${JSON.stringify(rounds.map(r => `Round ${r}`))},
        datasets: [
          {
            label: 'Extraction Rate',
            data: ${JSON.stringify(extractionRates.map(Number))},
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            fill: true,
            tension: 0.3
          },
          {
            label: 'Suppression Rate',
            data: ${JSON.stringify(suppressionRates.map(Number))},
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            fill: true,
            tension: 0.3
          },
          {
            label: 'False Positive Rate',
            data: ${JSON.stringify(fprRates.map(Number))},
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245, 158, 11, 0.1)',
            fill: true,
            tension: 0.3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom'
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            max: 100,
            ticks: {
              callback: function(value) {
                return value + '%';
              }
            }
          }
        }
      }
    });

    // Win distribution chart
    const winCtx = document.getElementById('winChart').getContext('2d');
    new Chart(winCtx, {
      type: 'doughnut',
      data: {
        labels: ['Red Wins', 'Blue Wins', 'Draws'],
        datasets: [{
          data: [${redWins}, ${blueWins}, ${draws}],
          backgroundColor: ['#ef4444', '#3b82f6', '#9ca3af'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom'
          }
        }
      }
    });
  </script>
</body>
</html>`;
}
