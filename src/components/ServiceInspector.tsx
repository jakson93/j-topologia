import React from 'react';
import { dateTimeFormat } from '@grafana/data';
import { TimeZone } from '@grafana/schema';
import { useStyles2, useTheme2 } from '@grafana/ui';
import { ServiceAnalysis, ServicePathRecord, TopologySnapshot } from '../types';
import { getStyles } from '../styles';
import { age, rate } from '../transportModel';
import { Selection } from './TopologyCanvas';

export type ServiceDirection = 'forward' | 'reverse' | 'both';
export const confidenceLabel = (value: string) =>
  value === 'confirmed' ? 'CONFIRMADO' : value === 'inferred' ? 'INFERIDO' : 'INCOMPLETO';
export function ServiceInspector({
  service,
  snapshot,
  direction,
  onDirection,
  onSelect,
  now,
  timeZone,
}: {
  service: ServiceAnalysis;
  snapshot: TopologySnapshot;
  direction: ServiceDirection;
  onDirection: (d: ServiceDirection) => void;
  onSelect: (s: Selection) => void;
  now: number;
  timeZone?: TimeZone;
}) {
  const theme = useTheme2(),
    styles = useStyles2(getStyles);
  const path = (p: ServicePathRecord, index: number, label: string) => (
    <div key={`${label}:${p.pwId}:${p.lspId}:${index}`} className={styles.list}>
      <div className={styles.row}>
        <strong>
          {label} · path {index + 1}
        </strong>
        <span
          className={styles.badge}
          style={{ color: p.path?.actual ? theme.colors.info.text : theme.colors.warning.text }}
        >
          {p.path?.stale ? 'COLETA ANTIGA' : confidenceLabel(p.discoveryConfidence)}
        </span>
      </div>
      <div className={styles.detailGrid}>
        <div>
          <small>PW</small>
          <strong>{p.pwId}</strong>
        </div>
        <div>
          <small>Túnel ativo coletado</small>
          <button onClick={() => onSelect({ kind: 'tunnel', id: p.tunnelId })}>
            {snapshot.mplsTunnels.find((t) => t.id === p.tunnelId)?.name ?? p.tunnelId}
          </button>
        </div>
        <div>
          <small>CR-LSP</small>
          <strong>{p.lspId}</strong>
        </div>
        <div>
          <small>Proteção em uso</small>
          <strong>{p.lspRole ?? 'Não identificada'}</strong>
        </div>
      </div>
      <small>
        Fonte: {p.path?.dataSource ?? p.dataSource ?? 'Não informada'} · {age(p.path?.observedAt, now)}
      </small>
      {p.distributionPercent !== undefined && <strong>Distribuição medida: {p.distributionPercent}%</strong>}
      {!p.path && <p className={styles.warning}>Não há registro dos saltos deste LSP.</p>}
      {p.path?.hops.map((h, i) => (
        <div key={`${h.routerId}:${i}`} className={styles.list}>
          <button
            className={styles.item}
            disabled={!h.nodeId}
            onClick={() => h.nodeId && onSelect({ kind: 'node', id: h.nodeId })}
          >
            <strong>
              {i + 1}. {snapshot.nodes.find((n) => n.id === h.nodeId)?.site ?? h.routerId}
            </strong>
            <small>
              {h.routerId} · {h.nodeId ?? 'Equipamento não resolvido'}
            </small>
          </button>
          {p.path?.segments[i] && (
            <div className={styles.detailGrid}>
              <div>
                <small>Interface de saída</small>
                <strong>{p.path.segments[i].sourceInterface ?? 'Não resolvida'}</strong>
              </div>
              <div>
                <small>OSPF cost → · {p.path.segments[i].costInterface ?? 'interface não resolvida'}</small>
                <strong>{p.path.segments[i].ospfCost ?? '—'}</strong>
              </div>
              <div>
                <small>IP local → next-hop</small>
                <strong>
                  {p.path.segments[i].localIp ?? '—'} → {p.path.segments[i].neighborIp ?? '—'}
                </strong>
              </div>
              <div>
                <small>Capacidade</small>
                <strong>{rate(p.path.segments[i].capacityBps)}</strong>
              </div>
              <div>
                <small>
                  {p.path.segments[i].source} → {p.path.segments[i].target}
                </small>
                <strong>{rate(p.path.segments[i].forwardBps)}</strong>
              </div>
              <div>
                <small>
                  {p.path.segments[i].target} → {p.path.segments[i].source}
                </small>
                <strong>{rate(p.path.segments[i].reverseBps)}</strong>
              </div>
              {p.path.segments[i].linkId && (
                <button onClick={() => onSelect({ kind: 'link', id: p.path!.segments[i].linkId! })}>
                  Investigar enlace
                </button>
              )}
              <small>
                Cost: {p.path.segments[i].costSource ?? 'sem fonte'} ·{' '}
                {p.path.segments[i].costObservedAt
                  ? dateTimeFormat(p.path.segments[i].costObservedAt!, { format: 'HH:mm:ss', timeZone })
                  : 'sem coleta'}
              </small>
            </div>
          )}
        </div>
      ))}
      {[...(p.issues ?? []), ...(p.path?.issues ?? [])].map((issue, i) => (
        <p key={i} className={styles.warning}>
          {issue}
        </p>
      ))}
    </div>
  );
  return (
    <section className={styles.section} aria-label="Caminho da VSI">
      <div className={styles.row}>
        <small>SERVIÇO / VSI / PW</small>
        <button onClick={() => onSelect(undefined)} aria-label="Fechar serviço">
          ×
        </button>
      </div>
      <h2>{service.vsi.name}</h2>
      <small>
        PE local: {service.vsi.localNode} · VSI ID: {service.vsi.vsiId ?? '—'} ·{' '}
        {service.vsi.status ?? 'Estado não coletado'}
      </small>
      <div className={styles.row}>
        <span className={styles.badge}>{confidenceLabel(service.discoveryConfidence)}</span>
        <span className={styles.badge}>
          {service.asymmetric === true
            ? 'IDA ≠ VOLTA'
            : service.asymmetric === false
              ? 'CAMINHO SIMÉTRICO'
              : 'SIMETRIA NÃO CONFIRMADA'}
        </span>
      </div>
      {service.multipleActivePaths && (
        <p className={styles.notice}>
          Múltiplos caminhos ativos. Percentuais aparecem somente quando medidos pelo equipamento.
        </p>
      )}
      <div className={styles.segment} role="group" aria-label="Sentido do serviço">
        {(['forward', 'reverse', 'both'] as const).map((d) => (
          <button key={d} aria-pressed={direction === d} onClick={() => onDirection(d)}>
            {d === 'forward' ? 'Ida' : d === 'reverse' ? 'Volta' : 'Ambos'}
          </button>
        ))}
      </div>
      {direction !== 'reverse' &&
        (service.forward.length ? (
          service.forward.map((p, i) => path(p, i, 'IDA'))
        ) : (
          <p className={styles.warning}>Caminho de ida não confirmado.</p>
        ))}
      {direction !== 'forward' &&
        (service.reverse.length ? (
          service.reverse.map((p, i) => path(p, i, 'VOLTA'))
        ) : (
          <p className={styles.warning}>Caminho de volta não confirmado. Não será copiado da ida.</p>
        ))}
      {service.issues.map((issue, i) => (
        <p key={i} className={styles.warning}>
          {issue}
        </p>
      ))}
      <small>
        O cost OSPF é contextual: não comprova o motivo da escolha do TE. O tráfego exibido nos segmentos é do enlace,
        não uma medição exclusiva desta VSI.
      </small>
    </section>
  );
}
