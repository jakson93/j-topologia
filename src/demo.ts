import { FieldType, toDataFrame } from '@grafana/data';
import { TopologyInventory } from './types';

/** Explicit, opt-in lab fixture. It uses the exact same data-frame adapter as production. */
export function demoData(now: number) {
  const names = [
    'ALTAMIRA',
    'SANTARÉM',
    'ALENQUER',
    'MEDICILÂNDIA',
    'PLACAS',
    'BRASÍLIA',
    'NOVO PROGRESSO',
    'RURÓPOLIS',
    'ITAITUBA',
    'URUARÁ',
  ];
  const codes = ['ATM', 'STM', 'ALQ', 'MED', 'PLA', 'BSB', 'NPR', 'RUR', 'ITB', 'URU'];
  const coords = [
    [140, 240],
    [400, 100],
    [720, 100],
    [1040, 240],
    [1040, 480],
    [900, 690],
    [590, 690],
    [280, 690],
    [140, 480],
    [590, 370],
  ];
  const nodes = codes.map((id, i) => ({
    id,
    hostname: `S6730-${id}-01`,
    site: names[i],
    model: 'Huawei S6730',
    vendor: 'Huawei',
    routerId: `10.40.40.${i + 1}`,
    ip: `10.0.0.${i + 1}`,
    group: i === 9 ? 'AGREGAÇÃO' : 'BACKBONE',
    region: 'Transporte',
    position: { x: coords[i][0], y: coords[i][1] },
    icon: 'router' as const,
  }));
  const pairs = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 8],
    [8, 0],
    [0, 9],
    [9, 3],
    [9, 7],
  ];
  const loads = [6.8, 4.7, 3.9, 1.8, 2.6, 0, 7.3, 5.6, 9.4, 8.1, 3.9, 2.4];
  const links = pairs.map(([a, b], i) => ({
    id: `L${i + 1}`,
    name: `${codes[a]} ↔ ${codes[b]}`,
    source: codes[a],
    target: codes[b],
    sourceInterface: `XGE0/0/${i + 1}`,
    targetInterface: `XGE0/0/${i + 1}`,
    capacityBps: 10e9,
    bindings: { rx: `L${i + 1}.rx`, tx: `L${i + 1}.tx`, opticalRx: `L${i + 1}.opticalRx` },
  }));
  const inventory: TopologyInventory = { nodes, links, ospfNeighbors: [], mplsTunnels: [] };
  const table = (name: string, rows: Array<Record<string, unknown>>) =>
    toDataFrame({
      name,
      fields: [...new Set(rows.flatMap((row) => Object.keys(row)))].map((key) => ({
        name: key,
        type: typeof rows.find((r) => r[key] != null)?.[key] === 'number' ? FieldType.number : FieldType.string,
        values: rows.map((row) => row[key] ?? null),
      })),
    });
  const frames = [
    table(
      'jtopology_nodes',
      nodes.map((n) => ({ ...n, observedAt: now, snmpStatus: 'up', uptime: 1854900 }))
    ),
    table(
      'jtopology_links',
      links.map((l, i) => ({
        ...l,
        observedAt: now,
        physicalStatus: i === 5 ? 'down' : 'up',
        rxBps: loads[i] * 1e9,
        txBps: loads[i] * 0.72e9,
        latencyMs: 2 + (i % 5),
        errorsPerSecond: 0,
        discardsPerSecond: 0,
      }))
    ),
    table(
      'jtopology_ospf',
      links.map((l, i) => ({
        id: `OSPF-${l.id}`,
        localNode: l.source,
        neighborRouterId: nodes.find((n) => n.id === l.target)!.routerId,
        neighborIp: nodes.find((n) => n.id === l.target)!.ip,
        interface: l.sourceInterface,
        area: '0.0.0.0',
        linkId: l.id,
        state: i === 5 ? 'Down' : 'Full',
        observedAt: now,
        lastChange: now - (i === 5 ? 240000 : 86400000),
      }))
    ),
    table('jtopology_tunnels', [
      {
        id: 'TE-ATM-BSB',
        name: 'TE-ATM-BSB · Internet',
        source: 'ATM',
        destination: 'BSB',
        operStatus: 'up',
        adminStatus: 'up',
        activePath: 'primary',
        observedAt: now,
        bandwidthBps: 4e9,
        priority: 7,
        primaryLsp: 'LSP-ATM-BSB-01',
        backupLsp: 'LSP-ATM-BSB-02',
        uptime: 129600,
        primaryPath: JSON.stringify({
          kind: 'observed',
          hops: ['ATM', 'STM', 'ALQ', 'MED', 'PLA', 'BSB'],
          linkIds: ['L1', 'L2', 'L3', 'L4', 'L5'],
        }),
        backupPath: JSON.stringify({
          kind: 'configured',
          hops: ['ATM', 'ITB', 'RUR', 'NPR', 'BSB'],
          linkIds: ['L9', 'L8', 'L7', 'L6'],
        }),
      },
      {
        id: 'TE-RUR-BSB',
        name: 'TE-RUR-BSB · Transporte',
        source: 'RUR',
        destination: 'BSB',
        operStatus: 'down',
        adminStatus: 'up',
        activePath: 'primary',
        observedAt: now,
        bandwidthBps: 2e9,
        primaryPath: JSON.stringify({ kind: 'observed', hops: ['RUR', 'NPR', 'BSB'], linkIds: ['L7', 'L6'] }),
      },
      {
        id: 'TE-ATM-MED',
        name: 'TE-ATM-MED · Corporativo',
        source: 'ATM',
        destination: 'MED',
        operStatus: 'up',
        adminStatus: 'up',
        activePath: 'primary',
        observedAt: now,
        bandwidthBps: 1e9,
        primaryPath: JSON.stringify({ kind: 'observed', hops: ['ATM', 'URU', 'MED'], linkIds: ['L10', 'L11'] }),
      },
      {
        id: 'TE-STM-ITB',
        name: 'TE-STM-ITB · Sem coleta de saltos',
        source: 'STM',
        destination: 'ITB',
        operStatus: 'up',
        adminStatus: 'up',
        observedAt: now,
      },
      {
        id: 'TE-BSB-ATM',
        name: 'TE-BSB-ATM · Volta',
        source: 'BSB',
        destination: 'ATM',
        operStatus: 'up',
        adminStatus: 'up',
        activePath: 'primary',
        observedAt: now,
        primaryLsp: 'LSP-BSB-ATM-01',
        primaryPath: JSON.stringify({
          kind: 'observed',
          hops: ['BSB', 'PLA', 'MED', 'URU', 'ATM'],
          linkIds: ['L5', 'L4', 'L11', 'L10'],
        }),
      },
    ]),
    table('jtopology_events', [
      {
        id: 'demo-failure',
        entityId: 'L6',
        kind: 'physical',
        time: now - 240000,
        severity: 'critical',
        message: 'NPR ↔ BSB · interface perdeu portadora',
      },
      {
        id: 'demo-restore',
        entityId: 'L2',
        kind: 'ospf',
        time: now - 900000,
        severity: 'restored',
        message: 'STM ↔ ALQ · adjacência restaurada (FULL)',
      },
    ]),
  ];
  const servicePath = (
    pwId: string,
    tunnelId: string,
    lspId: string,
    hops: string[],
    linkIds: string[],
    cost: number
  ) => ({
    pwId,
    tunnelId,
    lspId,
    lspRole: 'primary',
    dataSource: 'fixture',
    observedAt: now,
    discoveryConfidence: 'confirmed',
    path: {
      id: `path:${lspId}`,
      hops: hops.map((id) => ({ nodeId: id, routerId: nodes.find((n) => n.id === id)!.routerId })),
      segments: linkIds.map((id, i) => {
        const l = links.find((l) => l.id === id)!,
          load = loads[links.indexOf(l)];
        return {
          source: hops[i],
          target: hops[i + 1],
          linkId: id,
          sourceInterface: l.source === hops[i] ? l.sourceInterface : l.targetInterface,
          targetInterface: l.source === hops[i] ? l.targetInterface : l.sourceInterface,
          ospfCost: cost + i * 10,
          costSource: 'fixture',
          costObservedAt: now,
          capacityBps: l.capacityBps,
          rxBps: load * 1e9,
          txBps: load * 0.72e9,
          forwardBps: load * (l.source === hops[i] ? 0.72 : 1) * 1e9,
          reverseBps: load * (l.source === hops[i] ? 1 : 0.72) * 1e9,
          costInterface: l.sourceInterface,
        };
      }),
      actual: true,
      stale: false,
      observedAt: now,
      dataSource: 'fixture',
      issues: [],
      discoveryConfidence: 'confirmed',
    },
  });
  const forward = servicePath(
    'PW-ATM-BSB-300',
    'TE-ATM-BSB',
    'LSP-ATM-BSB-01',
    ['ATM', 'STM', 'ALQ', 'MED', 'PLA', 'BSB'],
    ['L1', 'L2', 'L3', 'L4', 'L5'],
    10
  );
  const reverse = servicePath(
    'PW-BSB-ATM-300',
    'TE-BSB-ATM',
    'LSP-BSB-ATM-01',
    ['BSB', 'PLA', 'MED', 'URU', 'ATM'],
    ['L5', 'L4', 'L11', 'L10'],
    50
  );
  frames.push(
    table('jtopology_service_paths', [
      {
        id: 'VSI-CLIENTE-300',
        vsi: JSON.stringify({
          id: 'VSI-CLIENTE-300',
          name: 'CLIENTE-300 · Corporativo',
          localNode: 'ATM',
          vsiId: '300',
          status: 'up',
          observedAt: now,
          dataSource: 'fixture',
        }),
        forward: JSON.stringify([forward]),
        reverse: JSON.stringify([reverse]),
        asymmetric: true,
        multipleActivePaths: false,
        discoveryConfidence: 'confirmed',
        issues: '[]',
      },
      {
        id: 'VSI-CLIENTE-400',
        vsi: JSON.stringify({
          id: 'VSI-CLIENTE-400',
          name: 'CLIENTE-400 · Multiponto',
          localNode: 'ATM',
          vsiId: '400',
          status: 'up',
          observedAt: now,
          dataSource: 'fixture',
        }),
        forward: JSON.stringify([
          forward,
          servicePath('PW-ATM-BSB-400', 'TE-ATM-MED', 'LSP-ATM-MED-01', ['ATM', 'URU', 'MED'], ['L10', 'L11'], 20),
        ]),
        reverse: '[]',
        multipleActivePaths: true,
        discoveryConfidence: 'incomplete',
        issues: JSON.stringify(['Caminho de volta não coletado. Distribuição percentual não informada.']),
      },
    ])
  );
  links.forEach((link, i) => {
    const times = Array.from({ length: 121 }, (_, n) => now - (120 - n) * 30000);
    for (const [metric, factor] of [
      ['rx', 1],
      ['tx', 0.72],
      ['opticalRx', 1],
    ] as const) {
      frames.push(
        toDataFrame({
          name: `${link.id}.${metric}`,
          fields: [
            { name: 'Time', type: FieldType.time, values: times },
            {
              name: `${link.id}.${metric}`,
              type: FieldType.number,
              values: times.map((_, n) =>
                metric === 'opticalRx'
                  ? i === 9 && n > 116
                    ? -23
                    : -20 + Math.sin(n / 7) * 0.1
                  : i === 5 && n > 112
                    ? 0
                    : Math.max(0, loads[i] * factor * 1e9 * (1 + Math.sin(n / 6 + i) * 0.06))
              ),
            },
          ],
        })
      );
    }
  });
  return { inventory, frames };
}
