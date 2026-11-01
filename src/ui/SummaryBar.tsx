import type { ActivitySummary } from '../types';
import { formatDuration, formatElevation, formatKm, formatVerticalSpeed } from './format';

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'up' | 'down' }) {
  return (
    <div className={`stat${tone ? ` stat-${tone}` : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function SummaryBar({ summary }: { summary: ActivitySummary }) {
  return (
    <section className="summary" aria-label="Activity summary">
      <Stat label="Distance" value={formatKm(summary.totalDistance)} />
      <Stat label="Moving time" value={formatDuration(summary.movingTime)} sub={`${formatDuration(summary.elapsedTime)} elapsed`} />
      <Stat label="D+" value={formatElevation(summary.totalGain)} tone="up" />
      <Stat label="D−" value={formatElevation(summary.totalLoss)} tone="down" />
      <Stat label="Avg climb" value={formatVerticalSpeed(summary.avgClimbSpeed)} tone="up" />
      <Stat label="Avg descent" value={formatVerticalSpeed(summary.avgDescentSpeed)} tone="down" />
    </section>
  );
}
