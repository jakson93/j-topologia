import { createTheme, FieldType, toDataFrame } from '@grafana/data';
import { GrafanaTopologyDataProvider, ospfHealth, ospfState, physicalHealth, transitions } from './provider';
import { EMPTY_INVENTORY, TopologyInventory } from './types';
import { demoData } from './demo';
const now = Date.parse('2026-10-13T15:00:00Z');
const provider = new GrafanaTopologyDataProvider(createTheme());
const inventory = (): TopologyInventory => ({
  ...EMPTY_INVENTORY,
  nodes: [
    { id: 'a', hostname: 'A', site: 'A', routerId: '10.0.0.1' },
    { id: 'b', hostname: 'B', site: 'B', routerId: '10.0.0.2' },
  ],
  links: [
    {
      id: 'ab',
      name: 'A-B',
      source: 'a',
      target: 'b',
      sourceInterface: 'GE1',
      targetInterface: 'GE2',
      capacityBps: 10e9,
      bindings: { status: 'ab.status', rx: 'ab.rx', tx: 'ab.tx' },
    },
  ],
});
const series = (name: string, values: unknown[], times = values.map((_, i) => now - (values.length - i - 1) * 30000)) =>
  toDataFrame({
    name,
    fields: [
      { name: 'Time', type: FieldType.time, values: times },
      { name, type: typeof values.find((v) => v != null) === 'number' ? FieldType.number : FieldType.string, values },
    ],
  });
const table = (name: string, rows: Array<Record<string, unknown>>) =>
  toDataFrame({
    name: `jtopology_${name}`,
    fields: [...new Set(rows.flatMap((r) => Object.keys(r)))].map((key) => ({
      name: key,
      type: typeof rows[0][key] === 'number' ? FieldType.number : FieldType.string,
      values: rows.map((r) => r[key] ?? null),
    })),
  });

test('missing telemetry never becomes healthy or zero traffic', () => {
  const snap = provider.getSnapshot([], inventory(), {}, now);
  expect(snap.links[0]).toMatchObject({ health: 'unknown', physical: 'unknown' });
  expect(snap.links[0].values.rx).toBeUndefined();
  expect(snap.links[0].utilization).toBeUndefined();
  expect(snap.nodes.every((n) => n.health === 'unknown')).toBe(true);
});
test('full duplex utilization is max RX/TX, not their sum, with configurable severity', () => {
  const snap = provider.getSnapshot(
    [series('ab.status', [1]), series('ab.rx', [9.6e9]), series('ab.tx', [8e9])],
    inventory(),
    {},
    now
  );
  expect(snap.links[0]).toMatchObject({ health: 'critical', utilization: 96 });
  expect(snap.incidents[0].description).toContain('96.0%');
});
test('stale, null, future and timestamp-free status are unknown rather than last good', () => {
  for (const frame of [
    series('ab.status', [1], [now - 600000]),
    series('ab.status', [1, null]),
    series('ab.status', [1], [now + 1]),
    toDataFrame({ name: 'ab.status', fields: [{ name: 'ab.status', type: FieldType.number, values: [1] }] }),
  ]) {
    expect(provider.getSnapshot([frame], inventory(), {}, now).links[0].physical).toBe('unknown');
  }
});
test('merges fragmented queries and accepts seconds in timestamps', () => {
  const snap = provider.getSnapshot(
    [series('ab.status', [1], [(now - 60000) / 1000]), series('ab.status', [2], [now / 1000])],
    inventory(),
    {},
    now
  );
  expect(snap.links[0].physical).toBe('down');
  expect(snap.events).toHaveLength(1);
});
test('OSPF autodiscovery correlates Router IDs and interfaces without inventing physical links', () => {
  const snap = provider.getSnapshot(
    [
      table('ospf', [
        {
          id: 'o',
          localNode: 'a',
          neighborRouterId: '10.0.0.2',
          interface: 'GE1',
          area: '0.0.0.0',
          state: 8,
          observedAt: now,
        },
      ]),
    ],
    inventory(),
    {},
    now
  );
  expect(snap.ospfNeighbors[0]).toMatchObject({ state: 'Full', health: 'ok', targetNode: 'b', linkId: 'ab' });
  expect(snap.links).toHaveLength(1);
});
test('2-Way is configurable and OSPF-MIB states do not use IF-MIB meanings', () => {
  expect(ospfState(1)).toBe('Down');
  expect(ospfState(8)).toBe('Full');
  expect(ospfState(2)).toBe('Attempt');
  expect(ospfHealth('2-Way')).toBe('degraded');
  expect(ospfHealth('2-Way', '2-Way')).toBe('ok');
  expect(physicalHealth(1)).toBe('ok');
  expect(physicalHealth(2)).toBe('down');
});
test('flaps count observed drops rather than every transition and never bridge gaps', () => {
  const frames = [series('ab.status', [1, 2, 1, 2, 1, 2, 1])];
  const snap = provider.getSnapshot(frames, inventory(), { flapCount: 3 }, now);
  expect(snap.links[0]).toMatchObject({ physical: 'ok', health: 'degraded', flapCount: 3 });
  expect(snap.events).toHaveLength(6);
  expect(
    transitions(
      [1, null, 2, 1],
      [now - 120000, now - 90000, now - 60000, now],
      now,
      300000,
      physicalHealth,
      'ab',
      'physical'
    )
  ).toHaveLength(1);
  expect(transitions([1, 2], [now - 600000, now], now, 300000, physicalHealth, 'ab', 'physical')).toHaveLength(0);
});
test('future table observations are excluded and stale neighbors stay unknown', () => {
  const snap = provider.getSnapshot(
    [
      table('ospf', [
        {
          id: 'o',
          localNode: 'a',
          neighborRouterId: '10.0.0.2',
          interface: 'GE1',
          area: '0',
          state: 'Full',
          observedAt: now - 600000,
        },
        {
          id: 'o',
          localNode: 'a',
          neighborRouterId: '10.0.0.2',
          interface: 'GE1',
          area: '0',
          state: 'Full',
          observedAt: now + 60000,
        },
      ]),
    ],
    inventory(),
    {},
    now
  );
  expect(snap.ospfNeighbors[0].health).toBe('unknown');
});
test('manual planned paths are never promoted to observed active dependencies', () => {
  const input = inventory();
  input.mplsTunnels = [
    {
      id: 't',
      name: 'TE',
      source: 'a',
      destination: 'b',
      activePath: 'primary',
      primaryPath: { kind: 'observed', hops: ['a', 'b'], observedAt: now },
    },
  ];
  const snap = provider.getSnapshot([series('ab.status', [2])], input, {}, now);
  expect(snap.mplsTunnels[0].primary.evidence).toBe('configured');
  expect(snap.incidents[0].tunnelIds).toEqual([]);
});
test('dynamic data preserve manually saved node positions', () => {
  const input = inventory();
  input.nodes[0].position = { x: 777, y: 333 };
  const snap = provider.getSnapshot(
    [table('nodes', [{ id: 'a', hostname: 'A', site: 'A', snmpStatus: 'up', observedAt: now }])],
    input,
    {},
    now
  );
  expect(snap.nodes[0].position).toEqual({ x: 777, y: 333 });
  expect(input.nodes[0].position).toEqual({ x: 777, y: 333 });
});
test('only explicit manual overrides replace discovered identity fields', () => {
  const input = inventory();
  input.nodes[0].hostname = 'Override';
  input.nodes[0].overrideFields = ['hostname'];
  const frame = table('nodes', [{ id: 'a', hostname: 'Collected', site: 'Discovered POP', observedAt: now }]);
  expect(provider.getSnapshot([frame], input, {}, now).nodes[0]).toMatchObject({
    hostname: 'Override',
    site: 'Discovered POP',
  });
});
test('demo uses the production adapter and correlates a real fixture dependency plus relative attenuation', () => {
  const demo = demoData(now),
    snap = provider.getSnapshot(demo.frames, demo.inventory, {}, now);
  expect(snap.nodes).toHaveLength(10);
  expect(snap.links).toHaveLength(12);
  expect(snap.ospfNeighbors).toHaveLength(12);
  expect(snap.mplsTunnels).toHaveLength(5);
  expect(snap.incidents.find((i) => i.linkId === 'L6')).toMatchObject({
    tunnelIds: ['TE-RUR-BSB'],
    neighborIds: ['OSPF-L6'],
  });
  expect(snap.links.find((l) => l.id === 'L10')?.attenuationDb).toBeGreaterThan(2);
  expect(snap.mplsTunnels.find((t) => t.id === 'TE-STM-ITB')?.primary.evidence).toBe('unavailable');
});
test('handles malformed path JSON and missing node endpoints safely', () => {
  const snap = provider.getSnapshot(
    [
      table('tunnels', [
        {
          id: 't',
          name: 'TE',
          source: 'a',
          destination: 'b',
          primaryPath: 'bad-json',
          operStatus: 'up',
          observedAt: now,
        },
      ]),
      table('links', [
        { id: 'broken', name: 'broken', source: 'absent', target: 'b', physicalStatus: 'up', observedAt: now },
      ]),
    ],
    inventory(),
    {},
    now
  );
  expect(snap.mplsTunnels[0].primary.evidence).toBe('unavailable');
  expect(snap.links).toHaveLength(1);
  expect(snap.warnings).toHaveLength(2);
});
test('initial target volume: 100 devices, 300 links, 500 neighbors and 500 tunnels', () => {
  const demo = demoData(now),
    input: TopologyInventory = { nodes: [], links: [], ospfNeighbors: [], mplsTunnels: [] };
  for (let i = 0; i < 100; i++) {
    input.nodes.push({ id: `n${i}`, hostname: `N${i}`, site: `POP${i}`, routerId: `10.0.0.${i}` });
  }
  for (let i = 0; i < 300; i++) {
    input.links.push({
      id: `l${i}`,
      name: `L${i}`,
      source: `n${i % 100}`,
      target: `n${(i + 1) % 100}`,
      sourceInterface: `GE${i}`,
      targetInterface: `GE${i}`,
      capacityBps: 10e9,
    });
  }
  for (let i = 0; i < 500; i++) {
    input.ospfNeighbors.push({
      id: `o${i}`,
      localNode: `n${i % 100}`,
      neighborRouterId: `10.0.0.${(i + 1) % 100}`,
      interface: `GE${i % 300}`,
      area: '0',
    });
    input.mplsTunnels.push({
      id: `t${i}`,
      name: `T${i}`,
      source: `n${i % 100}`,
      destination: `n${(i + 1) % 100}`,
      primaryPath: { kind: 'configured', hops: [`n${i % 100}`, `n${(i + 1) % 100}`], linkIds: [`l${i % 100}`] },
    });
  }
  const started = performance.now();
  const snap = provider.getSnapshot(demo.frames, input, {}, now);
  const elapsed = performance.now() - started;
  expect(snap.nodes.length).toBeGreaterThanOrEqual(100);
  expect(snap.links.length).toBeGreaterThanOrEqual(300);
  expect(snap.mplsTunnels.length).toBeGreaterThanOrEqual(500);
  expect(elapsed).toBeLessThan(3000);
  console.info(
    `Provider load benchmark: ${elapsed.toFixed(1)} ms (100/300/500/500 target, no browser rendering claim)`
  );
});
