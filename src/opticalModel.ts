import { PanelOptions } from './types';
import { SignalPoint, SignalSeries } from './signalHistory';

export function opticalSettings(options: Partial<PanelOptions> = {}) {
  const clamp = (value: number | undefined, fallback: number, min: number, max: number) =>
    Number.isFinite(value) ? Math.min(max, Math.max(min, value!)) : fallback;
  return {
    enabled: options.attenuationEnabled !== false,
    dropDb: clamp(options.attenuationDropDb, 2, 0.1, 30),
    windowMs: clamp(options.attenuationWindowMinutes, 5, 1, 60) * 60000,
    maxGapMs: clamp(options.staleAfterSeconds, 300, 1, 2592000) * 1000,
  };
}
export type OpticalSettings = ReturnType<typeof opticalSettings>;
export type AttenuationEvent = {
  startedAt: number;
  confirmedAt: number;
  reference: SignalPoint;
  baseline: number;
  current: SignalPoint;
  dropDb: number;
  recovering?: boolean;
  referenceRetained?: boolean;
};
export type OpticalState = {
  state: 'active' | 'pending' | 'normal' | 'insufficient' | 'stale' | 'gap';
  event?: AttenuationEvent;
};

/** Loss is positive when RX becomes more negative. Preserve the event's baseline until recovery. */
export function signalAttenuation(
  series: SignalSeries,
  settings: OpticalSettings,
  now: number,
  retained?: AttenuationEvent
): OpticalState {
  const seed = retained && retained.current.time <= now ? retained : undefined;
  let active: AttenuationEvent | undefined = seed ? { ...seed, referenceRetained: true } : undefined;
  let candidate: { startedAt: number; reference: SignalPoint; baseline: number } | undefined;
  let history: SignalPoint[] = [];
  let previousTime: number | undefined = seed?.current.time;
  let latest: SignalPoint | undefined = seed?.current;
  let qualified = false;
  let recoveryCount = seed?.recovering ? 1 : 0;
  let gap = false;
  for (let i = 0; i < series.times.length; i++) {
    const time = series.times[i],
      value = series.values[i];
    if (!Number.isFinite(time) || time > now || (seed && time <= seed.current.time)) {
      continue;
    }
    if (
      value == null ||
      !Number.isFinite(value) ||
      (previousTime !== undefined && time - previousTime > Math.min(settings.maxGapMs, settings.windowMs))
    ) {
      gap = true;
      candidate = undefined;
      history = [];
      qualified = false;
      recoveryCount = 0;
    }
    previousTime = time;
    if (value == null || !Number.isFinite(value)) {
      latest = undefined;
      continue;
    }
    latest = { time, value };
    history = history.filter((p) => time - p.time <= settings.windowMs);
    if (active) {
      active = { ...active, current: latest, dropDb: active.baseline - value };
      // Two consecutive readings above the recovery boundary prevent alert flicker.
      recoveryCount = active.dropDb < settings.dropDb / 2 ? recoveryCount + 1 : 0;
      active.recovering = recoveryCount > 0;
      if (recoveryCount >= 2) {
        active = undefined;
        candidate = undefined;
        history = [];
        recoveryCount = 0;
        qualified = true;
      }
    } else if (candidate) {
      if (
        candidate.baseline - value >= settings.dropDb - 1e-9 &&
        time > candidate.startedAt &&
        time - candidate.startedAt <= settings.windowMs
      ) {
        active = { ...candidate, confirmedAt: time, current: latest, dropDb: candidate.baseline - value };
        candidate = undefined;
      } else {
        candidate = undefined;
      }
    } else if (history.length >= 2) {
      qualified = true;
      const sorted = history.map((p) => p.value).sort((a, b) => a - b);
      const middle = Math.floor(sorted.length / 2);
      const baseline = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
      if (baseline - value >= settings.dropDb - 1e-9) {
        candidate = { startedAt: time, baseline, reference: history[history.length - 1] };
      }
    }
    history.push(latest);
  }
  if (!latest) {
    return { state: gap ? 'gap' : 'insufficient', event: active };
  }
  if (now - latest.time > settings.maxGapMs) {
    return { state: 'stale', event: active };
  }
  if (active) {
    return { state: 'active', event: active };
  }
  return { state: candidate ? 'pending' : qualified ? 'normal' : 'insufficient' };
}

/** Find actual samples near chosen dates; never bridge a missing sample or borrow a distant day's reading. */
export function compareSignalDates(series: SignalSeries, a: number, b: number, toleranceMs: number) {
  const nearest = (target: number): SignalPoint | undefined => {
    let index = -1,
      distance = Infinity;
    series.times.forEach((time, i) => {
      if (Number.isFinite(time) && Math.abs(time - target) < distance) {
        index = i;
        distance = Math.abs(time - target);
      }
    });
    const value = series.values[index];
    return index >= 0 && distance <= toleranceMs && value != null && Number.isFinite(value)
      ? { time: series.times[index], value }
      : undefined;
  };
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return { error: 'Escolha duas datas válidas.' };
  }
  if (b <= a) {
    return { error: 'A data B deve ser posterior à data A.' };
  }
  const first = nearest(a),
    second = nearest(b);
  if (!first || !second) {
    return { error: 'Sem amostra próxima de uma das datas. Amplie o período da consulta ou escolha outro horário.' };
  }
  if (first.time === second.time) {
    return { error: 'As duas datas apontam para a mesma coleta. Escolha horários mais distantes.' };
  }
  const deltaDb = second.value - first.value;
  return {
    first,
    second,
    deltaDb,
    direction:
      Math.abs(deltaDb) < 0.005 ? ('stable' as const) : deltaDb > 0 ? ('improved' as const) : ('worsened' as const),
  };
}
