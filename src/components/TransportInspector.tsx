import React from 'react';
import { dateTimeFormat } from '@grafana/data';
import { TimeZone } from '@grafana/schema';
import { useStyles2, useTheme2 } from '@grafana/ui';
import { LinkState, NetworkMetric, PanelOptions, ResolvedPath, TopologySnapshot } from '../types';
import { activePath, age, healthLabel, rate } from '../transportModel';
import { getStyles, color } from '../styles';
import { Selection } from './TopologyCanvas';
import { MetricChart } from './MetricChart';
import { SignalTrendChart } from './SignalTrendChart';
import { opticalSettings } from '../opticalModel';
import { serviceDependencies } from '../serviceModel';

export type PathMode = 'primary' | 'backup' | 'both';
export const evidenceLabel = (path: ResolvedPath) =>
  ({
    observed: 'Caminho coletado',
    configured: 'Caminho configurado · não confirma tráfego atual',
    stale: 'Coleta antiga ou sem timestamp',
    unavailable: 'Caminho não coletado',
  })[path.evidence];
export function TransportInspector({
  snapshot,
  selected,
  onSelect,
  now,
  from,
  timeZone,
  pathMode,
  onPathMode,
  options,
  onPeriod,
  expanded,
}: {
  snapshot: TopologySnapshot;
  selected: Selection;
  onSelect: (s: Selection) => void;
  now: number;
  from: number;
  timeZone?: TimeZone;
  pathMode: PathMode;
  onPathMode: (m: PathMode) => void;
  options: PanelOptions;
  onPeriod: (ms: number) => void;
  expanded: boolean;
}) {
  const theme = useTheme2(),
    styles = useStyles2(getStyles);
  const [metric, setMetric] = React.useState('rx');
  const node = selected?.kind === 'node' ? snapshot.nodes.find((n) => n.id === selected.id) : undefined;
  const link = selected?.kind === 'link' ? snapshot.links.find((l) => l.id === selected.id) : undefined;
  const tunnel = selected?.kind === 'tunnel' ? snapshot.mplsTunnels.find((t) => t.id === selected.id) : undefined;
  const neighbor = selected?.kind === 'ospf' ? snapshot.ospfNeighbors.find((n) => n.id === selected.id) : undefined;
  if (!node && !link && !tunnel && !neighbor) {
    return null;
  }
  const fact = (label: string, value: React.ReactNode) => (
    <div key={label}>
      <small>{label}</small>
      <strong>{value ?? '—'}</strong>
    </div>
  );
  const entity = node ?? link ?? tunnel ?? neighbor!;
  const title = node?.hostname ?? link?.name ?? tunnel?.name ?? `OSPF · ${neighbor?.neighborRouterId}`;
  const nodeLinks = node ? snapshot.links.filter((l) => l.source === node.id || l.target === node.id) : [];
  const nodeNeighbors = node
    ? snapshot.ospfNeighbors.filter((n) => n.localNode === node.id || n.targetNode === node.id)
    : [];
  const relatedTunnels = snapshot.mplsTunnels.filter((t) =>
    node
      ? t.source === node.id || t.destination === node.id || activePath(t)?.nodes.includes(node.id)
      : link
        ? activePath(t)?.linkIds.includes(link.id)
        : false
  );
  const renderPath = (path: ResolvedPath, title: string) => (
    <div className={styles.list}>
      <strong>{title}</strong>
      <small style={{ color: path.evidence === 'observed' ? theme.colors.info.text : theme.colors.warning.text }}>
        {evidenceLabel(path)}
      </small>
      {path.issues.map((issue) => (
        <p key={issue} className={styles.warning}>
          {issue}
        </p>
      ))}
      <div className={styles.path}>
        {path.nodes.map((id, i) => (
          <button key={`${id}:${i}`} onClick={() => onSelect({ kind: 'node', id })}>
            <b>{i + 1}</b>
            <span>
              {snapshot.nodes.find((n) => n.id === id)?.site ?? id}
              <small style={{ display: 'block' }}>
                {id}
                {path.linkIds[i] ? ` → ${path.linkIds[i]}` : ''}
              </small>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
  let chart: NetworkMetric | undefined;
  if (link) {
    chart = snapshot.metrics.get(link.bindings?.[metric as keyof NonNullable<LinkState['bindings']>] ?? '');
    if (metric === 'utilization') {
      const rx = snapshot.metrics.get(link.bindings?.rx ?? ''),
        tx = snapshot.metrics.get(link.bindings?.tx ?? '');
      const points = new Map<number, number[]>();
      for (const s of [rx, tx]) {
        s?.times.forEach((time, i) => {
          points.set(time, [...(points.get(time) ?? []), ...(s.values[i] == null ? [] : [s.values[i]!])]);
        });
      }
      const times = [...points.keys()].sort((a, b) => a - b);
      chart = {
        times,
        values: times.map((time) =>
          points.get(time)!.length && link.capacityBps
            ? (Math.max(...points.get(time)!) * 100) / link.capacityBps
            : null
        ),
      };
    }
    if (metric === 'flaps') {
      const events = snapshot.events.filter((e) => e.entityId === link.id && e.kind === 'physical');
      chart = { times: events.map((e) => e.time).sort((a, b) => a - b), values: events.map(() => 1) };
    }
  }
  return (
    <section className={styles.section} aria-label="Detalhes da seleção">
      <div className={styles.row}>
        <small>
          {node ? 'EQUIPAMENTO' : link ? 'ENLACE FÍSICO' : tunnel ? 'INTELIGÊNCIA MPLS-TE' : 'VIZINHANÇA OSPF'}
        </small>
        <button onClick={() => onSelect(undefined)} aria-label="Fechar detalhes">
          ×
        </button>
      </div>
      <h2>{title}</h2>
      <span className={styles.badge} style={{ color: color(theme, entity.health), alignSelf: 'flex-start' }}>
        ● {healthLabel[entity.health]}
      </span>
      {node && (
        <>
          <div className={styles.detailGrid}>
            {fact('POP', node.site)}
            {fact('Router ID', node.routerId || 'Não informado')}
            {fact('IP', node.ip || 'Não informado')}
            {fact('Modelo', node.model || 'Não informado')}
            {fact('SNMP', healthLabel[node.snmp])}
            {fact(
              'Uptime',
              node.uptime === undefined
                ? '—'
                : `${Math.floor(node.uptime / 86400)}d ${Math.floor(node.uptime / 3600) % 24}h`
            )}
            {expanded && (
              <>
                {fact('Fabricante', node.vendor || '—')}
                {fact('Grupo', node.group || '—')}
                {fact('Região', node.region || '—')}
                {fact('Interfaces', nodeLinks.length)}
              </>
            )}
          </div>
          <h4>Interfaces e enlaces</h4>
          {nodeLinks.map((l) => (
            <button className={styles.item} key={l.id} onClick={() => onSelect({ kind: 'link', id: l.id })}>
              <strong>{l.name}</strong>
              <small>
                {l.source === node.id ? l.sourceInterface : l.targetInterface} · {healthLabel[l.health]}
              </small>
            </button>
          ))}
          <h4>Vizinhanças OSPF</h4>
          {nodeNeighbors.length ? (
            nodeNeighbors.map((n) => (
              <button className={styles.item} key={n.id} onClick={() => onSelect({ kind: 'ospf', id: n.id })}>
                <span>
                  {n.neighborRouterId} · {n.state}
                </span>
                <small>
                  {n.interface} · área {n.area}
                </small>
              </button>
            ))
          ) : (
            <small>Vizinhanças não coletadas.</small>
          )}
        </>
      )}
      {link && (
        <>
          <div className={styles.detailGrid}>
            {fact('Origem', link.source)}
            {fact('Destino', link.target)}
            {fact('Interface A', link.sourceInterface)}
            {fact('Interface B', link.targetInterface)}
            {fact('Capacidade', rate(link.capacityBps))}
            {fact('Uso máximo RX/TX', link.utilization === undefined ? '—' : `${link.utilization.toFixed(1)}%`)}
            {fact('Tráfego RX', rate(link.values.rx))}
            {fact('Tráfego TX', rate(link.values.tx))}
            {fact('Latência', link.values.latency === undefined ? '—' : `${link.values.latency} ms`)}
            {fact('Físico', healthLabel[link.physical])}
            {fact('Erros / s', link.values.errors?.toFixed(2))}
            {fact('Discards / s', link.values.discards?.toFixed(2))}
            {fact(`Quedas em ${options.flapWindowMinutes ?? 10} min`, link.flapCount)}
            {fact('Última amostra de status', age(link.sampleTime, now))}
          </div>
          {link.attenuationDb !== undefined && (
            <p className={styles.warning}>
              Possível atenuação · perda de {link.attenuationDb.toFixed(2)} dB. Compare as amostras ópticas.
            </p>
          )}
          <label>
            Histórico
            <select aria-label="Métrica do enlace" value={metric} onChange={(e) => setMetric(e.target.value)}>
              {[
                ['rx', 'Tráfego RX'],
                ['tx', 'Tráfego TX'],
                ['utilization', 'Utilização'],
                ['errors', 'Erros / s'],
                ['discards', 'Discards / s'],
                ['latency', 'Latência'],
                ['flaps', 'Eventos de estado físico'],
                ['opticalRx', 'Potência RX · comparação e atenuação'],
                ['opticalTx', 'Potência TX'],
              ].map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.segment}>
            {[
              [5, '5m'],
              [15, '15m'],
              [60, '1h'],
              [360, '6h'],
              [1440, '24h'],
              [10080, '7d'],
            ].map(([minutes, label]) => (
              <button key={label} onClick={() => onPeriod(Number(minutes) * 60000)}>
                {label}
              </button>
            ))}
          </div>
          {metric === 'opticalRx' && chart ? (
            <SignalTrendChart
              series={chart}
              from={from}
              to={now}
              timeZone={timeZone}
              opticalSettings={opticalSettings(options)}
            />
          ) : (
            <MetricChart
              series={chart}
              from={from}
              to={now}
              timeZone={timeZone}
              format={
                metric === 'rx' || metric === 'tx'
                  ? rate
                  : (v) =>
                      v === undefined
                        ? '—'
                        : `${v.toFixed(2)}${metric === 'utilization' ? '%' : metric === 'latency' ? ' ms' : metric === 'opticalTx' ? ' dBm' : ''}`
              }
            />
          )}
          <small>
            O período consulta os dados pelo Grafana. O tráfego do enlace pode incluir vários serviços; não representa,
            sozinho, o tráfego de cada túnel.
          </small>
          <h4>OSPF neste enlace</h4>
          {snapshot.ospfNeighbors
            .filter((n) => n.linkId === link.id)
            .map((n) => (
              <button key={n.id} onClick={() => onSelect({ kind: 'ospf', id: n.id })}>
                {n.neighborRouterId} · {n.state}
              </button>
            ))}
        </>
      )}
      {tunnel && (
        <>
          <div className={styles.detailGrid}>
            {fact('Origem', tunnel.source)}
            {fact('Destino', tunnel.destination)}
            {fact('Administrativo', tunnel.adminStatus || '—')}
            {fact('Operacional', tunnel.operStatus || '—')}
            {fact(
              'Caminho ativo informado',
              tunnel.activePath === 'primary' ? 'Principal' : tunnel.activePath === 'backup' ? 'Backup' : 'Não coletado'
            )}
            {fact('Banda reservada', rate(tunnel.bandwidthBps))}
            {fact('Tráfego do túnel', rate(tunnel.trafficBps))}
            {fact('Prioridade', tunnel.priority)}
            {fact('LSP principal', tunnel.primaryLsp || '—')}
            {fact('LSP backup', tunnel.backupLsp || '—')}
            {fact('Última mudança', tunnel.lastChange ? dateTimeFormat(tunnel.lastChange, { timeZone }) : '—')}
            {fact('Quedas na janela', tunnel.flapCount)}
          </div>
          <div className={styles.segment} role="group" aria-label="Caminho do túnel">
            {(['primary', 'backup', 'both'] as const).map((m) => (
              <button key={m} aria-pressed={pathMode === m} onClick={() => onPathMode(m)}>
                {m === 'primary' ? 'Principal' : m === 'backup' ? 'Backup' : 'Comparar'}
              </button>
            ))}
          </div>
          {(pathMode === 'primary' || pathMode === 'both') && renderPath(tunnel.primary, 'LSP principal')}
          {(pathMode === 'backup' || pathMode === 'both') && renderPath(tunnel.backup, 'LSP backup')}
          <small>
            Um backup cadastrado não garante proteção disponível. Reserva de banda não é tráfego medido. O caminho
            coletado também pode estar indisponível.
          </small>
        </>
      )}
      {neighbor && (
        <>
          <div className={styles.detailGrid}>
            {fact('Nó local', neighbor.localNode)}
            {fact('Router ID local', snapshot.nodes.find((n) => n.id === neighbor.localNode)?.routerId || '—')}
            {fact('Router ID vizinho', neighbor.neighborRouterId)}
            {fact('IP vizinho', neighbor.neighborIp || '—')}
            {fact('Interface', neighbor.interface)}
            {fact('Área', neighbor.area)}
            {fact('Estado observado', neighbor.state)}
            {fact('OSPF cost →', neighbor.cost)}
            {fact('Processo', neighbor.process || 'Não identificado')}
            {fact('IP local', neighbor.localIp || '—')}
            {fact('Tipo de rede', neighbor.networkType || '—')}
            {fact('Fonte do cost', neighbor.dataSource || 'Não informada')}
            {fact('Coleta do cost', age(neighbor.costObservedAt, now))}
            {fact('Estado esperado', neighbor.expectedState ?? 'Full')}
            {fact('Última coleta', age(neighbor.observedAt, now))}
            {fact('Última alteração', neighbor.lastChange ? dateTimeFormat(neighbor.lastChange, { timeZone }) : '—')}
            {fact('Quedas na janela', neighbor.flapCount)}
            {fact('Transições coletadas', neighbor.transitions)}
          </div>
          <small>
            Em redes broadcast, 2-Way pode ser esperado entre DROTHERs. Configure expectedState para evitar classificar
            uma vizinhança válida como falha.
          </small>
          {neighbor.linkId && (
            <button onClick={() => onSelect({ kind: 'link', id: neighbor.linkId! })}>Investigar enlace físico</button>
          )}
          {!neighbor.targetNode && (
            <p className={styles.warning}>Router ID vizinho sem correspondência única no inventário.</p>
          )}
        </>
      )}
      {(node || link) && (
        <>
          <h4>Túneis com dependência ativa coletada</h4>
          {relatedTunnels.length ? (
            relatedTunnels.map((t) => (
              <button className={styles.item} key={t.id} onClick={() => onSelect({ kind: 'tunnel', id: t.id })}>
                <strong>{t.name}</strong>
                <small>{healthLabel[t.health]}</small>
              </button>
            ))
          ) : (
            <small>Nenhuma dependência ativa confirmada nos dados recebidos.</small>
          )}
        </>
      )}
      <h4>VSIs com dependência ativa coletada</h4>
      {serviceDependencies(snapshot.services, link?.id, tunnel?.id, node?.id).map((service) => (
        <button className={styles.item} key={service.id} onClick={() => onSelect({ kind: 'service', id: service.id })}>
          <strong>{service.vsi.name}</strong>
          <small>{service.vsi.localNode} · abrir ida e volta</small>
        </button>
      ))}
      <h4>Eventos relacionados</h4>
      {snapshot.events
        .filter((e) => e.entityId === entity.id)
        .slice(0, 12)
        .map((e) => (
          <p key={e.id}>
            <small>{dateTimeFormat(e.time, { format: 'DD/MM HH:mm:ss', timeZone })}</small>
            <br />
            {e.message}
          </p>
        ))}
    </section>
  );
}
