import type { MonitoringTrendPoint } from '../../monitoring/types'

export default function MetricChart({ points, metric }: { points: MonitoringTrendPoint[]; metric: 'requests' | 'error_rate' | 'p95_latency_ms' | 'queued_jobs' | 'ai_failure_rate' }) {
  const width = 900, height = 190, pad = 22, max = Math.max(1, ...points.map(item => item[metric]))
  const line = points.map((item, index) => `${pad + index * (width-pad*2) / Math.max(1, points.length-1)},${height-pad-item[metric]/max*(height-pad*2)}`).join(' ')
  return <div className="monitor-metric-chart"><svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">{[0,.25,.5,.75,1].map(value=><line key={value} x1={pad} x2={width-pad} y1={pad+value*(height-pad*2)} y2={pad+value*(height-pad*2)} />)}<polyline points={line} /></svg><footer><span>{points[0] ? new Date(points[0].collected_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '—'}</span><b>{max.toLocaleString()}</b><span>{points.at(-1) ? new Date(points.at(-1)!.collected_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '—'}</span></footer></div>
}
