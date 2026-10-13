import { activePath, correlate, positions, resolvePath } from './transportModel';
import { LinkState, NetworkNode, TunnelState } from './types';
const now = Date.parse('2026-10-13T15:00:00Z'),
  age = 300000;
const nodes: NetworkNode[] = ['a', 'b', 'c'].map((id, i) => ({
  id,
  hostname: id,
  site: id,
  routerId: `10.0.0.${i + 1}`,
}));
const links: LinkState[] = [
  {
    id: 'ab',
    name: 'AB',
    source: 'a',
    target: 'b',
    sourceInterface: 'GE1',
    targetInterface: 'GE2',
    physical: 'down',
    health: 'down',
    values: {},
    flapCount: 0,
  },
  {
    id: 'bc',
    name: 'BC',
    source: 'b',
    target: 'c',
    sourceInterface: 'GE3',
    targetInterface: 'GE4',
    physical: 'ok',
    health: 'ok',
    values: {},
    flapCount: 0,
  },
];
const tunnel = { source: 'a', destination: 'c' };
test('resolves ordered recorded router IDs to physical hops', () => {
  expect(
    resolvePath(
      { hops: ['10.0.0.1', '10.0.0.2', '10.0.0.3'], kind: 'observed', observedAt: now },
      tunnel,
      nodes,
      links,
      now,
      age
    )
  ).toMatchObject({ complete: true, evidence: 'observed', nodes: ['a', 'b', 'c'], linkIds: ['ab', 'bc'] });
});
test('does not choose between parallel links without explicit link IDs', () => {
  const parallel = [...links, { ...links[0], id: 'ab2' }];
  expect(
    resolvePath({ hops: ['a', 'b', 'c'], kind: 'observed', observedAt: now }, tunnel, nodes, parallel, now, age)
      .complete
  ).toBe(false);
  expect(
    resolvePath(
      { hops: ['a', 'b', 'c'], linkIds: ['ab2', 'bc'], kind: 'observed', observedAt: now },
      tunnel,
      nodes,
      parallel,
      now,
      age
    ).linkIds
  ).toEqual(['ab2', 'bc']);
});
test('rejects missing endpoints, unknown hops, loops and incomplete physical associations', () => {
  for (const hops of [
    ['b', 'c'],
    ['a', 'x', 'c'],
    ['a', 'b', 'a', 'c'],
    ['a', 'c'],
  ]) {
    expect(resolvePath({ hops, kind: 'observed', observedAt: now }, tunnel, nodes, links, now, age).complete).toBe(
      false
    );
  }
});
test('stale/configured/unavailable paths cannot confirm active dependencies', () => {
  for (const path of [
    undefined,
    { hops: ['a', 'b', 'c'], kind: 'observed' as const, observedAt: now - age - 1 },
    { hops: ['a', 'b', 'c'], kind: 'configured' as const },
  ]) {
    const primary = resolvePath(path, tunnel, nodes, links, now, age),
      backup = resolvePath(undefined, tunnel, nodes, links, now, age);
    expect(activePath({ activePath: 'primary', primary, backup })).toBeUndefined();
  }
});
test('active backup rather than standby primary drives impact correlation', () => {
  const primary = resolvePath(
    { hops: ['a', 'b', 'c'], kind: 'observed', observedAt: now },
    tunnel,
    nodes,
    links,
    now,
    age
  );
  const backup = resolvePath(undefined, tunnel, nodes, links, now, age);
  const t = {
    id: 't',
    name: 'T',
    ...tunnel,
    primary,
    backup,
    health: 'down',
    flapCount: 0,
    activePath: 'backup',
  } as TunnelState;
  expect(correlate({ links, ospfNeighbors: [], mplsTunnels: [t] }).find((i) => i.linkId === 'ab')?.tunnelIds).toEqual(
    []
  );
  expect(
    correlate({ links, ospfNeighbors: [], mplsTunnels: [{ ...t, activePath: 'primary' }] }).find(
      (i) => i.linkId === 'ab'
    )?.tunnelIds
  ).toEqual(['t']);
});
test('organizes deterministic positions without mutating topology or status', () => {
  const copy = JSON.stringify(nodes);
  for (const type of ['ring', 'star', 'tree', 'grid'] as const) {
    expect(positions(nodes, type).every((n) => Number.isFinite(n.position.x))).toBe(true);
  }
  expect(JSON.stringify(nodes)).toBe(copy);
});
