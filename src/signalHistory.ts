import { DataFrame, FieldType } from '@grafana/data';

export type SignalSeries = { times: number[]; values: Array<number | null> };
export const RX_CRITICAL = -35;
export const signalTime = (time: number) => (time < 1_000_000_000_000 ? time * 1000 : time);

/** Combine query fragments by timestamp; preserve missing values instead of inventing measurements. */
export function buildSignalSeries(frames: DataFrame[]) {
  const byItem = new Map<string, Map<number, number | null>>();
  for (const frame of frames) {
    const timeField = frame.fields.find((f) => f.type === FieldType.time);
    if (!timeField) {
      continue;
    }
    const fields = frame.fields.filter((f) => f.type !== FieldType.time);
    for (const field of fields) {
      const labels = new Set([
        field.name,
        field.config.displayNameFromDS,
        field.config.displayName,
        ...(fields.length === 1 ? [frame.name] : []),
      ]);
      const points = new Map<number, number | null>();
      for (let i = 0; i < Math.min(field.values.length, timeField.values.length); i++) {
        const time = signalTime(Number(timeField.values[i]));
        if (!Number.isFinite(time) || timeField.values[i] == null) {
          continue;
        }
        const raw = field.values[i];
        const value = raw == null || String(raw).trim() === '' ? null : Number(String(raw).replace(',', '.'));
        points.set(time, value !== null && Number.isFinite(value) ? value : null);
      }
      for (const label of labels) {
        const key = label?.trim();
        if (!key) {
          continue;
        }
        const target = byItem.get(key) ?? new Map<number, number | null>();
        for (const [time, value] of points) {
          target.set(time, value);
        }
        byItem.set(key, target);
      }
    }
  }
  return new Map(
    [...byItem].map(([key, values]) => {
      const sorted = [...values].sort((a, b) => a[0] - b[0]);
      return [key, { times: sorted.map(([time]) => time), values: sorted.map(([, value]) => value) }] as const;
    })
  );
}

export function signalWindow(series: SignalSeries | undefined, from: number, to: number) {
  const result: SignalSeries = { times: [], values: [] };
  series?.times.forEach((time, i) => {
    if (time >= from && time <= to) {
      result.times.push(time);
      result.values.push(series.values[i] ?? null);
    }
  });
  return result;
}

export function signalSummary(series: SignalSeries) {
  let min = Infinity,
    max = -Infinity;
  let beforeLoss: { time: number; value: number } | undefined;
  let previous: { time: number; value: number } | undefined;
  let last: typeof previous;
  let firstCritical: number | undefined;
  series.values.forEach((value, i) => {
    if (value === null || !Number.isFinite(value)) {
      previous = undefined;
      return;
    }
    min = Math.min(min, value);
    max = Math.max(max, value);
    last = { time: series.times[i], value };
    if (value <= RX_CRITICAL && previous && previous.value > RX_CRITICAL) {
      beforeLoss = previous;
      firstCritical = series.times[i];
    }
    previous = last;
  });
  const padding = Math.max(1, (max - min) * 0.08);
  return { min: min - padding, max: max + padding, last, beforeLoss, firstCritical };
}

export type SignalPoint = { time: number; value: number };
/** Keep peaks and drops in each bucket; never reduce across a missing-data gap. */
export function signalSegments(series: SignalSeries, budget: number): SignalPoint[][] {
  const segments: SignalPoint[][] = [];
  let segment: SignalPoint[] = [];
  series.values.forEach((value, i) => {
    if (value === null || !Number.isFinite(value)) {
      if (segment.length) {
        segments.push(segment);
        segment = [];
      }
    } else {
      segment.push({ time: series.times[i], value });
    }
  });
  if (segment.length) {
    segments.push(segment);
  }
  const size = Math.max(1, Math.ceil(series.values.length / Math.max(1, budget)));
  return segments.map((points) => {
    const reduced: SignalPoint[] = [];
    for (let i = 0; i < points.length; i += size) {
      const bucket = points.slice(i, i + size);
      const low = bucket.reduce((a, b) => (b.value < a.value ? b : a));
      const high = bucket.reduce((a, b) => (b.value > a.value ? b : a));
      reduced.push(...[...new Set([bucket[0], low, high, bucket[bucket.length - 1]])].sort((a, b) => a.time - b.time));
    }
    return reduced;
  });
}
