import { createTheme, FieldType, toDataFrame } from '@grafana/data';
import { demoData } from './demo';
import { GrafanaTopologyDataProvider } from './provider';
import { serviceAnalysis, serviceDependencies } from './serviceModel';
import { readFileSync } from 'fs';
const now = Date.parse('2026-10-13T15:00:00Z');
const demo = () => {
  const fixture = demoData(now);
  return new GrafanaTopologyDataProvider(createTheme()).getSnapshot(fixture.frames, fixture.inventory, {}, now);
};
test('reads independent directional service records and reverse dependencies', () => {
  const snapshot = demo(),
    service = snapshot.services[0];
  expect(service.vsi.name).toContain('CLIENTE-300');
  expect(service.forward[0]).toMatchObject({ tunnelPolicy: 'TP-CORPORATIVO-ATM', policyStale: false });
  expect(service.reverse[0]).toMatchObject({ tunnelPolicy: 'TP-CORPORATIVO-BSB', policyStale: false });
  expect(service.forward[0].path?.segments[0]).toMatchObject({
    costInterface: 'Vlanif100',
    ospfCost: 10,
    subnet: '172.20.0.0/30',
  });
  expect(service.asymmetric).toBe(true);
  expect(service.forward[0].path?.hops.map((h) => h.nodeId)).not.toEqual(
    service.reverse[0].path?.hops.map((h) => h.nodeId).reverse()
  );
  expect(serviceDependencies(snapshot.services, 'L2').map((s) => s.id)).toContain(service.id);
  expect(serviceDependencies(snapshot.services, undefined, 'TE-BSB-ATM').map((s) => s.id)).toContain(service.id);
});
test('stale service records cannot imply current paths, symmetry or impact', () => {
  const current = demo().services[0];
  const row = {
    ...current,
    vsi: JSON.stringify(current.vsi),
    forward: JSON.stringify(current.forward),
    reverse: JSON.stringify(current.reverse),
    issues: '[]',
  };
  const stale = serviceAnalysis(row, now + 600000, 300000)!;
  expect(stale.forward[0].path?.actual).toBe(false);
  expect(stale.forward[0].policyStale).toBe(true);
  expect(stale.asymmetric).toBeUndefined();
  expect(serviceDependencies([stale], 'L2')).toEqual([]);
});
test('null distribution is absent, malformed optional values cannot become React children', () => {
  const current = demo().services[0];
  const forward = JSON.parse(JSON.stringify(current.forward));
  forward[0].distributionPercent = null;
  forward[0].lspRole = { bad: true };
  forward[0].path.issues = [{ bad: true }, 'Known issue'];
  const result = serviceAnalysis(
    { ...current, vsi: { ...current.vsi, status: { bad: true } }, forward, issues: [{ bad: true }, 'Partial'] },
    now,
    300000
  )!;
  expect(result.forward[0].distributionPercent).toBeUndefined();
  expect(result.forward[0].lspRole).toBeUndefined();
  expect(result.vsi.status).toBeUndefined();
  expect(result.issues).toEqual(['Partial']);
});
test('malformed service frame is rejected without crashing topology', () => {
  expect(serviceAnalysis({ id: 'vsi', vsi: 'broken-json' }, now, 300000)).toBeUndefined();
});
test('collector graph JSON is consumed by the real panel adapter without hand-written per-VSI inventory', () => {
  const fixture = JSON.parse(readFileSync('collector/fixtures/asymmetric-network.json', 'utf8')) as {
    time: number;
    frames: Record<string, Array<Record<string, unknown>>>;
  };
  const frames = Object.entries(fixture.frames)
    .filter(([, rows]) => rows.length)
    .map(([name, rows]) =>
      toDataFrame({
        name,
        fields: [...new Set(rows.flatMap((row) => Object.keys(row)))].map((key) => ({
          name: key,
          type: typeof rows[0][key] === 'number' ? FieldType.number : FieldType.string,
          values: rows.map((row) => row[key] ?? null),
        })),
      })
    );
  const snapshot = new GrafanaTopologyDataProvider(createTheme()).getSnapshot(
    frames,
    { nodes: [], links: [], ospfNeighbors: [], mplsTunnels: [] },
    {},
    fixture.time
  );
  expect(snapshot.nodes).toHaveLength(4);
  expect(snapshot.services).toHaveLength(2);
  expect(snapshot.services.find((s) => s.id === 'A:VSI300')?.asymmetric).toBe(true);
  expect(serviceDependencies(snapshot.services, 'AB').map((s) => s.id)).toContain('A:VSI300');
});
