import { FieldType, toDataFrame } from '@grafana/data';
import { buildSignalSeries, signalSegments, signalSummary, signalWindow } from './signalHistory';

const start = Date.parse('2026-10-08T10:00:00Z');
test('full-history scale retains the healthy signal and the -40 dBm drop', () => {
  const series = { times: [start, start + 60000, start + 120000], values: [-24, -23.5, -40] };
  const summary = signalSummary(series);
  expect(summary.min).toBeLessThan(-40);
  expect(summary.max).toBeGreaterThan(-23.5);
  expect(summary.beforeLoss).toEqual({ time: start + 60000, value: -23.5 });
  expect(summary.firstCritical).toBe(start + 120000);
  expect(
    signalSegments(series, 1)
      .flat()
      .map((p) => p.value)
  ).toContain(-40);
});
test('combines query fragments by timestamp, accepts seconds and retains null gaps instead of fabricating a line', () => {
  const frame = (times: number[], values: unknown[]) =>
    toDataFrame({
      name: 'RX interface',
      fields: [
        { name: 'time', type: FieldType.time, values: times },
        { name: 'value', type: FieldType.number, config: { displayNameFromDS: 'RX interface' }, values },
      ],
    });
  const result = buildSignalSeries([
    frame([start / 1000, start / 1000 + 60], [-24, null]),
    frame([start + 120000, start + 180000], [-40, -40]),
  ]);
  expect(result.get('RX interface')).toEqual({
    times: [start, start + 60000, start + 120000, start + 180000],
    values: [-24, null, -40, -40],
  });
  expect(signalSegments(result.get('RX interface')!, 2)).toHaveLength(2);
  expect(signalSummary(result.get('RX interface')!).beforeLoss).toBeUndefined();
});
test('empty selected periods remain empty, while peaks, constant series and isolated readings remain usable', () => {
  expect(signalWindow({ times: [start], values: [-24] }, start + 1, start + 100)).toEqual({ times: [], values: [] });
  const series = {
    times: Array.from({ length: 1000 }, (_, i) => start + i),
    values: Array.from({ length: 1000 }, (_, i) => (i === 345 ? -40 : -24)),
  };
  expect(
    signalSegments(series, 10)
      .flat()
      .map((p) => p.value)
  ).toContain(-40);
  expect(signalSummary({ times: [start], values: [-40] })).toMatchObject({ min: -41, max: -39 });
});
