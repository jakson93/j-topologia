import { mergeOptions, saveEditedItem } from './optionMerge';

const saved = () => ({
  routes: [
    {
      id: 'a',
      name: 'A',
      points: [1, 2],
      source: { popId: 'p' },
      trunks: [{ id: 't', interfaces: [{ id: 'i', rxItem: 'rx', txItem: 'tx' }] }],
      topologyPoints: [10, 20],
    },
    { id: 'b', name: 'B' },
  ],
  pops: [{ id: 'p', iconUrl: '', topologyPosition: { x: 100, y: 100 } }],
});

test('combines layout edits with new interface signals and POP icons from original options, without mutation', () => {
  const base = saved();
  const draft = JSON.parse(JSON.stringify(base)) as typeof base;
  draft.routes[0].topologyPoints = [30, 40];
  draft.pops[0].topologyPosition = { x: 500, y: 500 };
  const latest = JSON.parse(JSON.stringify(base)) as typeof base;
  latest.routes[0].trunks![0].interfaces[0].rxItem = 'new.rx';
  latest.pops[0].iconUrl = '/public/plugins/jakson-jmap-panel/img/torre.png';
  const merged = mergeOptions(base, draft, latest);
  expect(merged.conflicts).toEqual([]);
  expect(merged.value.routes[0].topologyPoints).toEqual([30, 40]);
  expect(merged.value.routes[0].trunks![0].interfaces[0].rxItem).toBe('new.rx');
  expect(merged.value.pops[0]).toMatchObject({ iconUrl: latest.pops[0].iconUrl, topologyPosition: { x: 500, y: 500 } });
  expect(base).toEqual(saved());
});

test('saves original route editor by ID after reordering, preserving links added while modal is open', () => {
  const base = saved().routes[0];
  const draft = { ...base, name: 'New A' };
  const latest = [
    { id: 'b', name: 'B' },
    { ...base, source: { popId: 'new' }, topologyPoints: [50, 60] },
  ];
  const merged = saveEditedItem(latest, base, draft);
  expect(merged.conflicts).toEqual([]);
  expect(merged.value[0]).toEqual(latest[0]);
  expect(merged.value[1]).toMatchObject({ id: 'a', name: 'New A', source: { popId: 'new' }, topologyPoints: [50, 60] });
});

test('conflicting same-field edits, deletions and duplicate IDs cannot silently overwrite or resurrect items', () => {
  const base = saved().routes[0];
  const draft = { ...base, name: 'Mine' };
  expect(saveEditedItem([{ ...base, name: 'External' }], base, draft).conflicts).not.toEqual([]);
  expect(saveEditedItem([], base, draft).conflicts).not.toEqual([]);
  expect(saveEditedItem([base], undefined, base).conflicts).not.toEqual([]);
});

test('merges independently added/removed items and nested interface fields by ID', () => {
  const base = saved();
  const draft = JSON.parse(JSON.stringify(base)) as typeof base;
  draft.routes.pop();
  draft.routes[0].trunks![0].interfaces[0].txItem = 'mine.tx';
  const latest = JSON.parse(JSON.stringify(base)) as typeof base;
  latest.routes.push({ id: 'c', name: 'C' });
  latest.routes[0].trunks![0].interfaces[0].rxItem = 'external.rx';
  const merged = mergeOptions(base, draft, latest);
  expect(merged.conflicts).toEqual([]);
  expect(merged.value.routes.map((r) => r.id)).toEqual(['a', 'c']);
  expect(merged.value.routes[0].trunks![0].interfaces[0]).toEqual({
    id: 'i',
    rxItem: 'external.rx',
    txItem: 'mine.tx',
  });
});
