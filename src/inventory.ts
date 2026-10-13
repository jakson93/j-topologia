import { EMPTY_INVENTORY, TopologyInventory } from './types';

export function parseInventory(text: string): TopologyInventory {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object') {
    throw new Error('Informe um objeto de inventário.');
  }
  const input = value as Record<string, unknown>;
  const result = { ...EMPTY_INVENTORY, ...input } as TopologyInventory;
  for (const key of ['nodes', 'links', 'ospfNeighbors', 'mplsTunnels'] as const) {
    if (!Array.isArray(result[key])) {
      throw new Error(`${key} precisa ser uma lista.`);
    }
    const ids = new Set<string>();
    for (const item of result[key]) {
      if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id.trim()) {
        throw new Error(`${key}: ID obrigatório.`);
      }
      if (ids.has(item.id)) {
        throw new Error(`${key}: ID duplicado ${item.id}.`);
      }
      ids.add(item.id);
    }
  }
  const nodes = new Set(result.nodes.map((n) => n.id));
  const required = (value: unknown, label: string) => {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`${label} obrigatório.`);
    }
  };
  for (const n of result.nodes) {
    required(n.hostname, 'Hostname');
    required(n.site, 'POP');
    if (n.position && (!Number.isFinite(n.position.x) || !Number.isFinite(n.position.y))) {
      throw new Error(`Posição inválida: ${n.id}.`);
    }
  }
  for (const l of result.links) {
    required(l.name, 'Nome do enlace');
    required(l.sourceInterface, 'Interface origem');
    required(l.targetInterface, 'Interface destino');
    if (!nodes.has(l.source) || !nodes.has(l.target) || l.source === l.target) {
      throw new Error(`Enlace ${l.id}: extremos inválidos.`);
    }
    if (l.capacityBps !== undefined && (!Number.isFinite(l.capacityBps) || l.capacityBps <= 0)) {
      throw new Error(`Capacidade inválida: ${l.id}.`);
    }
    if (
      l.points &&
      (!Array.isArray(l.points) || l.points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
    ) {
      throw new Error(`Traçado inválido: ${l.id}.`);
    }
  }
  for (const n of result.ospfNeighbors) {
    if (!nodes.has(n.localNode)) {
      throw new Error(`Vizinho ${n.id}: nó local não cadastrado.`);
    }
    required(n.neighborRouterId, 'Router ID vizinho');
    required(n.interface, 'Interface OSPF');
    required(n.area, 'Área OSPF');
  }
  for (const t of result.mplsTunnels) {
    required(t.name, 'Nome do túnel');
    if (!nodes.has(t.source) || !nodes.has(t.destination)) {
      throw new Error(`Túnel ${t.id}: extremos não cadastrados.`);
    }
    for (const path of [t.primaryPath, t.backupPath]) {
      if (
        path &&
        (!Array.isArray(path.hops) ||
          path.hops.some((h) => typeof h !== 'string') ||
          !['observed', 'configured'].includes(path.kind) ||
          (path.linkIds && (!Array.isArray(path.linkIds) || path.linkIds.some((l) => typeof l !== 'string'))))
      ) {
        throw new Error(`Caminho inválido: ${t.id}.`);
      }
    }
  }
  for (const entity of [...result.nodes, ...result.links]) {
    if (
      entity.bindings &&
      (typeof entity.bindings !== 'object' ||
        Array.isArray(entity.bindings) ||
        Object.values(entity.bindings).some((v) => typeof v !== 'string'))
    ) {
      throw new Error(`Bindings inválidos: ${entity.id}.`);
    }
  }
  return result;
}

/** Import topology endpoints and metric bindings; never use geographic proximity to invent links. */
export function importJmap(text: string): { inventory: TopologyInventory; warnings: string[] } {
  const doc = JSON.parse(text);
  const source = doc.options ?? doc;
  if (!Array.isArray(source.pops) || !Array.isArray(source.routes)) {
    throw new Error('Selecione as options do painel JMAP (pops e routes).');
  }
  const inventory: TopologyInventory = { nodes: [], links: [], ospfNeighbors: [], mplsTunnels: [] };
  const warnings: string[] = [];
  const resolve = (e: { popId?: string; equipmentId?: string } | undefined) =>
    e ? (e.equipmentId ? `${e.popId}:${e.equipmentId}` : e.popId) : undefined;
  for (const pop of source.pops) {
    inventory.nodes.push({
      id: pop.id,
      hostname: pop.name,
      site: pop.name,
      region: pop.region,
      position: pop.topologyPosition,
    });
    for (const eq of pop.equipments ?? []) {
      inventory.nodes.push({
        id: `${pop.id}:${eq.id}`,
        hostname: eq.name,
        site: pop.name,
        ip: eq.ip,
        model: eq.type,
        position: eq.topologyPosition,
        bindings: { status: eq.statusItem, uptime: eq.uptimeItem },
      });
    }
  }
  for (const route of source.routes) {
    const a = resolve(route.source),
      b = resolve(route.target);
    if (!a || !b || !inventory.nodes.some((n) => n.id === a) || !inventory.nodes.some((n) => n.id === b)) {
      warnings.push(`${route.name}: selecione os extremos; a rota não foi importada.`);
      continue;
    }
    const metric = (id: string) => (route.metrics ?? []).find((m: { id: string }) => m.id === id)?.zabbixItem;
    inventory.links.push({
      id: route.id,
      name: route.name,
      source: a,
      target: b,
      sourceInterface: route.source.portId ?? 'Configurar interface A',
      targetInterface: route.target.portId ?? 'Configurar interface B',
      points: route.topologyPoints,
      bindings: {
        status: route.interfaceItem,
        rx: metric('download'),
        tx: metric('upload'),
        opticalRx: metric('rx'),
        opticalTx: metric('tx'),
      },
    });
    warnings.push(`${route.name}: confira interfaces, capacidade em bps e unidades RX/TX importadas.`);
  }
  return { inventory, warnings };
}
