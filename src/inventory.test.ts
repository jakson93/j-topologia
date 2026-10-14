import { importJmap, parseInventory } from './inventory';
import { EMPTY_INVENTORY } from './types';
test('rejects duplicate identities and missing endpoints before saving', () => {
  const node = { id: 'a', hostname: 'A', site: 'A' };
  expect(() => parseInventory(JSON.stringify({ ...EMPTY_INVENTORY, nodes: [node, node] }))).toThrow('duplicado');
  expect(() =>
    parseInventory(
      JSON.stringify({
        ...EMPTY_INVENTORY,
        nodes: [node],
        links: [{ id: 'ab', name: 'AB', source: 'a', target: 'b', sourceInterface: 'GE1', targetInterface: 'GE2' }],
      })
    )
  ).toThrow('extremos');
});
test('imports JMAP topology and Zabbix aliases but never guesses endpoints from geographic positions', () => {
  const input = {
    pops: [
      { id: 'a', name: 'A', equipments: [{ id: 'r1', name: 'R1', statusItem: 'R1.status' }] },
      { id: 'b', name: 'B' },
    ],
    routes: [
      {
        id: 'ab',
        name: 'AB',
        source: { popId: 'a', equipmentId: 'r1', portId: 'GE1' },
        target: { popId: 'b', portId: 'GE2' },
        interfaceItem: 'AB.status',
        metrics: [{ id: 'rx', zabbixItem: 'AB.opticalRx' }],
      },
      {
        id: 'unbound',
        name: 'Sem extremos',
        points: [
          { lat: 1, lng: 2 },
          { lat: 3, lng: 4 },
        ],
      },
    ],
  };
  const result = importJmap(JSON.stringify(input));
  expect(result.inventory.links).toHaveLength(1);
  expect(result.inventory.pops).toHaveLength(2);
  expect(result.inventory.nodes.map((n) => n.id)).toEqual(['a:r1', 'b']);
  expect(result.inventory.links[0].bindings?.opticalRx).toBe('AB.opticalRx');
  expect(result.warnings.some((w) => w.includes('Sem extremos'))).toBe(true);
});
