import { DataFrame, FieldType, GrafanaTheme2, getDisplayProcessor } from '@grafana/data';
import { TimeZone } from '@grafana/schema';
import { signalTime } from './signalHistory';

export type Status = 'online' | 'down' | 'alert' | 'unknown' | 'maintenance';
export type Reading = {
  raw: unknown;
  text: string;
  values: unknown[];
  times: number[];
  sampleTime?: number;
  stale?: boolean;
  ambiguous?: boolean;
  format?: (value: unknown) => string;
};
export type Readings = Map<string, Reading>;
export const statusLabel: Record<Status, string> = {
  online: 'Online',
  down: 'Indisponível',
  alert: 'Em alerta',
  unknown: 'Sem dados',
  maintenance: 'Manutenção',
};

export function readTelemetry(series: DataFrame[], theme: GrafanaTheme2, timeZone?: TimeZone): Readings {
  const readings: Readings = new Map();
  for (const frame of series) {
    const fields = frame.fields.filter((field) => field.type !== FieldType.time);
    const times = Array.from(frame.fields.find((field) => field.type === FieldType.time)?.values ?? []).map(Number);
    for (const field of fields) {
      const values: unknown[] = Array.from(field.values);
      let raw: unknown;
      let sampleTime: number | undefined;
      for (let i = values.length - 1; i >= 0; i--) {
        if (values[i] !== null && values[i] !== undefined && values[i] !== '') {
          raw = values[i];
          sampleTime = Number.isFinite(times[i]) ? times[i] : undefined;
          break;
        }
      }
      if (raw === undefined) {
        continue;
      }
      const processor = getDisplayProcessor({ field, theme, timeZone });
      const display = processor(raw);
      const entry = {
        raw,
        text: `${display.prefix ?? ''}${display.text}${display.suffix ?? ''}`,
        values,
        times,
        sampleTime,
        format: (value: unknown) => processor(value).text,
      };
      for (const label of [
        fields.length === 1 ? frame.name : undefined,
        field.name,
        field.config.displayNameFromDS,
        field.config.displayName,
      ]) {
        const key = label?.trim();
        if (!key) {
          continue;
        }
        const existing = readings.get(key);
        if (!existing) {
          readings.set(key, entry);
        } else if (existing !== entry) {
          const merged = new Map<number, unknown>();
          let ambiguous = existing.ambiguous ?? false;
          for (const source of [existing, entry]) {
            source.times.forEach((time, i) => {
              const t = signalTime(time),
                v = source.values[i];
              if (!Number.isFinite(t)) {
                return;
              }
              if (merged.has(t) && merged.get(t) != null && v != null && merged.get(t) !== v) {
                ambiguous = true;
                merged.set(t, null);
              } else {
                merged.set(t, v);
              }
            });
          }
          const sorted = [...merged].sort((a, b) => a[0] - b[0]);
          readings.set(key, { ...entry, ambiguous, times: sorted.map(([t]) => t), values: sorted.map(([, v]) => v) });
        }
      }
    }
  }
  return readings;
}

export function numeric(value: unknown): number | undefined {
  if (value === null || value === undefined || String(value).trim() === '') {
    return undefined;
  }
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}
