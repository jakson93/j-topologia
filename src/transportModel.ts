import { Health, MplsTunnel, NetworkLink, NetworkNode, ResolvedPath, TopologySnapshot, TunnelPath } from './types';

export const healthLabel: Record<Health, string> = {
  ok: 'Normal',
  warning: 'Atenção',
  degraded: 'Degradado',
  critical: 'Crítico',
  down: 'Indisponível',
  unknown: 'Sem dados',
};
const rank: Record<Health, number> = { ok: 0, warning: 1, degraded: 2, unknown: 3, critical: 4, down: 5 };
export const worst = (states: Health[]): Health =>
  states.length ? states.reduce((a, b) => (rank[a] >= rank[b] ? a : b)) : 'unknown';
export const rate = (value?: number) =>
  value === undefined || !Number.isFinite(value)
    ? '—'
    : value >= 1e9
      ? `${(value / 1e9).toFixed(1)} Gbps`
      : value >= 1e6
        ? `${(value / 1e6).toFixed(1)} Mbps`
        : `${value.toFixed(0)} bps`;
export const age = (time: number | undefined, now: number) =>
  time === undefined ? 'Coleta não informada' : `${Math.max(0, Math.floor((now - time) / 1000))} s atrás`;

/** No shortest-path inference: a record must include every hop and unambiguous physical links. */
export function resolvePath(
  path: TunnelPath | undefined,
  tunnel: Pick<MplsTunnel, 'source' | 'destination'>,
  nodes: NetworkNode[],
  links: NetworkLink[],
  now: number,
  maxAge: number
): ResolvedPath {
  const result: ResolvedPath = { nodes: [], linkIds: [], complete: false, issues: [], evidence: 'unavailable' };
  if (!path?.hops.length) {
    result.issues.push('Caminho não coletado. Configure a coleta dos saltos do LSP.');
    return result;
  }
  result.evidence =
    path.kind === 'observed'
      ? path.observedAt !== undefined && path.observedAt <= now && now - path.observedAt <= maxAge
        ? 'observed'
        : 'stale'
      : 'configured';
  for (const hop of path.hops) {
    const candidates = nodes.filter((n) => n.id === hop || n.routerId === hop);
    if (candidates.length !== 1) {
      result.issues.push(`Salto ${hop}: ${candidates.length ? 'Router ID ambíguo' : 'não cadastrado'}.`);
      return result;
    }
    result.nodes.push(candidates[0].id);
  }
  if (result.nodes[0] !== tunnel.source || result.nodes.at(-1) !== tunnel.destination) {
    result.issues.push('O caminho precisa incluir origem e destino na ordem correta.');
    return result;
  }
  if (new Set(result.nodes).size !== result.nodes.length) {
    result.issues.push('O caminho contém um loop.');
    return result;
  }
  if (path.linkIds && path.linkIds.length !== result.nodes.length - 1) {
    result.issues.push('A quantidade de enlaces não corresponde aos saltos.');
    return result;
  }
  for (let i = 1; i < result.nodes.length; i++) {
    const a = result.nodes[i - 1],
      b = result.nodes[i];
    const candidates = links.filter(
      (l) =>
        ((l.source === a && l.target === b) || (l.source === b && l.target === a)) &&
        (!path.linkIds || l.id === path.linkIds[i - 1])
    );
    if (candidates.length !== 1) {
      result.issues.push(
        `${a} → ${b}: ${candidates.length ? 'enlaces paralelos; informe linkIds' : 'enlace físico não identificado'}.`
      );
    } else {
      result.linkIds.push(candidates[0].id);
    }
  }
  result.complete = result.issues.length === 0;
  if (result.evidence === 'stale') {
    result.issues.push('Registro sem timestamp válido ou fora da validade; não confirma o caminho atual.');
  }
  return result;
}

/** Confirmed active dependencies only. Standby/configured paths are not active traffic evidence. */
export function activePath(t: Pick<TopologySnapshot['mplsTunnels'][number], 'activePath' | 'primary' | 'backup'>) {
  const p = t.activePath === 'primary' ? t.primary : t.activePath === 'backup' ? t.backup : undefined;
  return p?.complete && p.evidence === 'observed' ? p : undefined;
}

export function correlate(snapshot: Pick<TopologySnapshot, 'links' | 'ospfNeighbors' | 'mplsTunnels'>) {
  const incidents: TopologySnapshot['incidents'] = [];
  const coveredNeighbors = new Set<string>(),
    coveredTunnels = new Set<string>();
  for (const link of snapshot.links.filter((l) => l.physical === 'down')) {
    const neighbors = snapshot.ospfNeighbors.filter((n) => n.linkId === link.id && n.health === 'down');
    const tunnels = snapshot.mplsTunnels.filter((t) => activePath(t)?.linkIds.includes(link.id));
    neighbors.forEach((n) => coveredNeighbors.add(n.id));
    tunnels.filter((t) => t.health === 'down').forEach((t) => coveredTunnels.add(t.id));
    incidents.push({
      id: `link:${link.id}`,
      title: link.name,
      health: 'down',
      linkId: link.id,
      neighborIds: neighbors.map((n) => n.id),
      tunnelIds: tunnels.map((t) => t.id),
      description: `Falha física observada. Causa provável para ${neighbors.length} adjacência(s) down; ${tunnels.length} túnel(is) com caminho ativo associado. Causalidade não confirmada.`,
    });
  }
  for (const t of snapshot.mplsTunnels.filter((t) => t.health === 'down' && !coveredTunnels.has(t.id))) {
    incidents.push({
      id: `tunnel:${t.id}`,
      title: t.name,
      health: 'down',
      tunnelIds: [t.id],
      neighborIds: [],
      description: 'Túnel down observado. Causa física não identificada nos dados disponíveis.',
    });
  }
  for (const n of snapshot.ospfNeighbors.filter((n) => n.health === 'down' && !coveredNeighbors.has(n.id))) {
    incidents.push({
      id: `ospf:${n.id}`,
      title: `OSPF · ${n.localNode} → ${n.neighborRouterId}`,
      health: 'down',
      tunnelIds: [],
      neighborIds: [n.id],
      description: 'Vizinhança down. Sem vínculo suficiente para apontar uma causa física.',
    });
  }
  for (const link of snapshot.links.filter((l) => ['warning', 'degraded', 'critical'].includes(l.health))) {
    incidents.push({
      id: `load:${link.id}`,
      title: link.name,
      health: link.health,
      linkId: link.id,
      tunnelIds: snapshot.mplsTunnels.filter((t) => activePath(t)?.linkIds.includes(link.id)).map((t) => t.id),
      neighborIds: [],
      description: link.attenuationDb
        ? `Possível atenuação óptica: perda de ${link.attenuationDb.toFixed(2)} dB confirmada em duas coletas.`
        : `Utilização ${link.utilization?.toFixed(1) ?? '—'}%; verifique erros, descartes e oscilações.`,
    });
  }
  return incidents;
}

export function positions(nodes: NetworkNode[], layout: 'ring' | 'grid' | 'star' | 'tree') {
  return nodes.map((n, i) => ({
    ...n,
    position:
      layout === 'ring'
        ? {
            x: 650 + Math.cos(-Math.PI / 2 + (i * 2 * Math.PI) / nodes.length) * 480,
            y: 380 + Math.sin(-Math.PI / 2 + (i * 2 * Math.PI) / nodes.length) * 280,
          }
        : layout === 'star'
          ? i === 0
            ? { x: 650, y: 380 }
            : {
                x: 650 + Math.cos((i * 2 * Math.PI) / Math.max(1, nodes.length - 1)) * 470,
                y: 380 + Math.sin((i * 2 * Math.PI) / Math.max(1, nodes.length - 1)) * 280,
              }
          : layout === 'tree'
            ? {
                x: 140 + (i - (2 ** Math.floor(Math.log2(i + 1)) - 1)) * (1200 / 2 ** Math.floor(Math.log2(i + 1))),
                y: 100 + Math.floor(Math.log2(i + 1)) * 180,
              }
            : { x: 150 + (i % 4) * 330, y: 120 + Math.floor(i / 4) * 190 },
  }));
}
