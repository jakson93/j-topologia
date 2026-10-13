import { compareSignalDates, opticalSettings, signalAttenuation } from './opticalModel';

const start = Date.parse('2026-10-13T12:00:00Z');
const settings = opticalSettings();
const series = (values: Array<number | null>, step = 60000) => ({
  times: values.map((_, i) => start + i * step),
  values,
});
test('compares negative dBm correctly across dates and returns a difference in dB', () => {
  const history = series([-20, -22, -18]);
  expect(compareSignalDates(history, start, start + 60000, 5000)).toMatchObject({ direction: 'worsened', deltaDb: -2 });
  expect(compareSignalDates(history, start + 60000, start + 120000, 5000)).toMatchObject({
    direction: 'improved',
    deltaDb: 4,
  });
  expect(compareSignalDates(series([-20, -20]), start, start + 60000, 5000)).toMatchObject({
    direction: 'stable',
    deltaDb: 0,
  });
});
test('reports missing data, reversed dates, the same sample and out-of-range dates without borrowing distant data', () => {
  const history = series([-20, null, -22]);
  expect(compareSignalDates(history, start, start + 60000, 300000).error).toContain('Sem amostra');
  expect(compareSignalDates(history, start, start + 86400000, 300000).error).toContain('Sem amostra');
  expect(compareSignalDates(history, start, start + 1, 300000).error).toContain('mesma coleta');
  expect(compareSignalDates(history, start + 1, start, 300000).error).toContain('posterior');
  expect(compareSignalDates(history, NaN, start, 300000).error).toContain('válidas');
});
test('confirms a 2 dB drop on the second collection while the absolute RX remains above the critical floor', () => {
  const history = series([-20.1, -20.1, -22.1, -22.2]);
  const state = signalAttenuation(history, settings, history.times[3]);
  expect(state.state).toBe('active');
  expect(state.event).toMatchObject({ baseline: -20.1, startedAt: start + 120000, confirmedAt: start + 180000 });
  expect(state.event?.dropDb).toBeCloseTo(2.1);
  expect(signalAttenuation(series([-20, -20, -22]), settings, start + 120000).state).toBe('pending');
});
test('ignores isolated glitches and gradual losses below the configured short-window drop', () => {
  expect(signalAttenuation(series([-20, -20, -24, -20, -20]), settings, start + 240000).state).toBe('normal');
  const gradual = series(Array.from({ length: 30 }, (_, i) => -20 - i * 0.1));
  expect(signalAttenuation(gradual, settings, gradual.times[29]).state).toBe('normal');
});
test('holds the original reference after the rolling window moves and resolves only after two recovered readings', () => {
  const values = [-20, -20, -23, -23, ...Array(12).fill(-23)];
  const held = series(values);
  expect(signalAttenuation(held, settings, held.times[held.times.length - 1]).event?.baseline).toBe(-20);
  const oneRecovered = series([...values, -20.5]);
  expect(signalAttenuation(oneRecovered, settings, oneRecovered.times[values.length]).event?.recovering).toBe(true);
  const recovered = series([...values, -20.5, -20.5]);
  expect(signalAttenuation(recovered, settings, recovered.times[values.length + 1]).state).not.toBe('active');
});
test('does not infer attenuation across missing, stale, invalid, future or widely separated samples', () => {
  expect(signalAttenuation(series([-20, -20, null, -25, -25]), settings, start + 240000).state).not.toBe('active');
  const spaced = series([-20, -20, -25, -25], 3600000);
  expect(signalAttenuation(spaced, settings, spaced.times[3]).state).toBe('insufficient');
  expect(signalAttenuation(series([-20, -20, -23, -23]), settings, start + 900000).state).toBe('stale');
  expect(signalAttenuation(series([-20, -20, -23, -23]), settings, start + 60000).state).toBe('insufficient');
  expect(signalAttenuation(series([null, NaN]), settings, start + 60000).state).toBe('gap');
});
