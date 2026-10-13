import React from 'react';
import { dateTimeFormat } from '@grafana/data';
import { TimeZone } from '@grafana/schema';
import { useStyles2, useTheme2 } from '@grafana/ui';
import { NetworkMetric } from '../types';
import { getStyles } from '../styles';
import { rate } from '../transportModel';

export function MetricChart({
  series,
  from,
  to,
  format = rate,
  timeZone,
}: {
  series?: NetworkMetric;
  from: number;
  to: number;
  format?: (n?: number) => string;
  timeZone?: TimeZone;
}) {
  const theme = useTheme2(),
    styles = useStyles2(getStyles);
  const [hover, setHover] = React.useState<number>();
  const points = React.useMemo(
    () => series?.times.flatMap((t, i) => (t >= from && t <= to ? [{ time: t, value: series.values[i] }] : [])) ?? [],
    [series, from, to]
  );
  const valid = points.filter((p): p is { time: number; value: number } => p.value !== null);
  const max = Math.max(...valid.map((p) => p.value), 1),
    min = Math.min(...valid.map((p) => p.value), 0);
  const x = (t: number) => 10 + ((t - from) / Math.max(1, to - from)) * 480;
  const y = (v: number) => 15 + ((max - v) / (max - min)) * 90;
  const segments: Array<Array<{ time: number; value: number }>> = [];
  let segment: Array<{ time: number; value: number }> = [];
  const gaps = valid
    .slice(1)
    .map((p, i) => p.time - valid[i].time)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  const maxGap = (gaps[Math.floor(gaps.length / 2)] ?? Infinity) * 3;
  for (const p of points) {
    if (p.value === null || (segment.length && p.time - segment.at(-1)!.time > maxGap)) {
      if (segment.length) {
        segments.push(segment);
        segment = [];
      }
    }
    if (p.value !== null) {
      segment.push({ time: p.time, value: p.value });
    }
  }
  if (segment.length) {
    segments.push(segment);
  }
  const current = hover === undefined ? undefined : valid[hover];
  return (
    <div>
      {!valid.length ? (
        <p className={styles.warning}>Sem histórico para esta métrica no período consultado.</p>
      ) : (
        <>
          <div className={styles.row}>
            <small>{format(max)}</small>
            <strong>{format(current?.value ?? valid.at(-1)?.value)}</strong>
          </div>
          <svg
            className={styles.chart}
            viewBox="0 0 500 135"
            preserveAspectRatio="none"
            role="img"
            aria-label="Histórico da métrica; lacunas de coleta permanecem abertas"
            onMouseMove={(e) => {
              const box = e.currentTarget.getBoundingClientRect(),
                time = from + ((e.clientX - box.left) / box.width) * (to - from);
              let best = 0;
              valid.forEach((p, i) => {
                if (Math.abs(p.time - time) < Math.abs(valid[best].time - time)) {
                  best = i;
                }
              });
              setHover(best);
            }}
            onMouseLeave={() => setHover(undefined)}
          >
            {[15, 60, 105].map((v) => (
              <line key={v} x1={10} x2={490} y1={v} y2={v} stroke={theme.colors.border.weak} />
            ))}
            {segments.map((s, i) =>
              s.length === 1 ? (
                <circle key={i} cx={x(s[0].time)} cy={y(s[0].value)} r={2} fill={theme.colors.info.text} />
              ) : (
                <polyline
                  key={i}
                  points={s.map((p) => `${x(p.time)},${y(p.value)}`).join(' ')}
                  fill="none"
                  stroke={theme.colors.info.text}
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              )
            )}
            {current && (
              <line
                x1={x(current.time)}
                x2={x(current.time)}
                y1={10}
                y2={110}
                stroke={theme.colors.text.secondary}
                strokeDasharray="3 4"
              />
            )}
          </svg>
          <div className={styles.row}>
            <small>{dateTimeFormat(current?.time ?? from, { format: 'DD/MM HH:mm:ss', timeZone })}</small>
            <small>{dateTimeFormat(to, { format: 'DD/MM HH:mm', timeZone })}</small>
          </div>
        </>
      )}
    </div>
  );
}
