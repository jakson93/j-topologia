import { DataFrame, GrafanaTheme2 } from '@grafana/data';
import { TimeZone } from '@grafana/schema';
import { readTelemetry, numeric, Reading } from './networkTelemetry';
import { buildSignalSeries, signalTime } from './signalHistory';
import { opticalSettings, signalAttenuation } from './opticalModel';
import { correlate, resolvePath, worst } from './transportModel';
import { collectorState, serviceAnalysis } from './serviceModel';
import {
  EMPTY_INVENTORY,
  Health,
  LinkState,
  MplsTunnel,
  NetworkEvent,
  NetworkLink,
  NetworkNode,
  OspfNeighbor,
  OspfState,
  PanelOptions,
  TopologyInventory,
  TopologySnapshot,
  TunnelPath,
} from './types';

type Row = Record<string, unknown>;
const text = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));
const timestamp = (value: unknown) => {
  if (value == null || value === '') {
    return undefined;
  }
  const number = typeof value === 'string' && !/^\d+(\.\d+)?$/.test(value) ? Date.parse(value) : Number(value);
  return Number.isFinite(number) ? signalTime(number) : undefined;
};
export const fresh = (time: number | undefined, now: number, maxAge: number) =>
  time !== undefined && time <= now && now - time <= maxAge;
export function physicalHealth(value: unknown): Health {
  const v = text(value).toLowerCase();
  return ['1', 'up', 'online', 'ok', 'true'].includes(v)
    ? 'ok'
    : ['2', 'down', 'offline', 'false', '0'].includes(v)
      ? 'down'
      : 'unknown';
}
export function ospfState(value: unknown): OspfState {
  const states: OspfState[] = ['Down', 'Attempt', 'Init', '2-Way', 'ExStart', 'Exchange', 'Loading', 'Full'];
  return (
    states.find(
      (s, i) =>
        s.toLowerCase().replace('-', '') === text(value).toLowerCase().replace('-', '') || text(value) === String(i + 1)
    ) ?? 'Unknown'
  );
}
export const ospfHealth = (state: OspfState, expected = 'Full'): Health =>
  state === 'Unknown' ? 'unknown' : state === expected ? 'ok' : state === 'Down' ? 'down' : 'degraded';
const tunnelHealth = (value: unknown): Health =>
  ['degraded', 'degradado'].includes(text(value).toLowerCase()) ? 'degraded' : physicalHealth(value);

/** Status transitions count only consecutive observed samples; gaps never become flaps. */
export function transitions(
  values: unknown[],
  times: number[],
  now: number,
  maxGap: number,
  convert: (v: unknown) => Health,
  entityId: string,
  kind: NetworkEvent['kind']
): NetworkEvent[] {
  const events: NetworkEvent[] = [];
  for (let i = 1; i < values.length; i++) {
    const before = convert(values[i - 1]),
      after = convert(values[i]);
    if (
      !Number.isFinite(times[i]) ||
      times[i] > now ||
      times[i] < times[i - 1] ||
      times[i] - times[i - 1] > maxGap ||
      before === 'unknown' ||
      after === 'unknown' ||
      before === after
    ) {
      continue;
    }
    events.push({
      id: `${kind}:${entityId}:${times[i]}`,
      entityId,
      kind,
      time: times[i],
      severity: after === 'down' ? 'critical' : after === 'ok' ? 'restored' : 'warning',
      message: `${entityId} · ${after === 'down' ? 'DOWN' : after === 'ok' ? 'restaurado' : 'degradado'}`,
    });
  }
  return events;
}

export interface TopologyDataProvider {
  getSnapshot(frames: DataFrame[], inventory: TopologyInventory, options: PanelOptions, now: number): TopologySnapshot;
}

/** Grafana owns collection, credentials, query refresh and time ranges. No duplicate SNMP/Zabbix requests. */
export class GrafanaTopologyDataProvider implements TopologyDataProvider {
  constructor(
    private theme: GrafanaTheme2,
    private timeZone?: TimeZone
  ) {}
  getSnapshot(
    frames: DataFrame[],
    inventory: TopologyInventory = EMPTY_INVENTORY,
    options: PanelOptions,
    now: number
  ): TopologySnapshot {
    const warnings: string[] = [];
    const maxAge = Math.max(10, options.staleAfterSeconds ?? 300) * 1000;
    const seriesFrames = frames.filter((f) => !f.name?.startsWith('jtopology_'));
    const readings = readTelemetry(seriesFrames, this.theme, this.timeZone);
    const metrics = buildSignalSeries(seriesFrames);
    const keys = new Set([...inventory.nodes, ...inventory.links].flatMap((e) => Object.values(e.bindings ?? {})));
    for (const [key, reading] of readings) {
      if (reading.ambiguous) {
        reading.stale = true;
        metrics.delete(key);
        if (keys.has(key)) {
          warnings.push(`Alias ${key} contém amostras conflitantes; use um alias único por equipamento/interface.`);
        }
      }
    }
    const tableCache = new Map<string, Row[]>();
    const tableRows = (kind: string): Row[] => {
      if (tableCache.has(kind)) {
        return tableCache.get(kind)!;
      }
      const rows = frames
        .filter((f) => f.name === `jtopology_${kind}`)
        .flatMap((f) =>
          Array.from({ length: f.length }, (_, i) =>
            Object.fromEntries(f.fields.map((field) => [field.name, field.values[i]]))
          )
        );
      tableCache.set(kind, rows);
      return rows;
    };
    const latestRows = (kind: string) => {
      const map = new Map<string, Row>();
      for (const row of tableRows(kind)) {
        const id = text(row.id);
        if (!id) {
          warnings.push(`${kind}: registro sem ID ignorado.`);
          continue;
        }
        const time = timestamp(row.observedAt);
        if (time !== undefined && time > now) {
          continue;
        }
        if (!map.has(id) || (time ?? -Infinity) >= (timestamp(map.get(id)?.observedAt) ?? -Infinity)) {
          map.set(id, row);
        }
      }
      return map;
    };
    const read = (key?: string): Reading | undefined => {
      if (!key) {
        return undefined;
      }
      const r = readings.get(key);
      if (!r) {
        return undefined;
      }
      for (let i = r.values.length - 1; i >= 0; i--) {
        const time = timestamp(r.times[i]);
        if (time === undefined || time > now) {
          continue;
        }
        return { ...r, raw: r.values[i], sampleTime: time, stale: r.ambiguous || !fresh(time, now, maxAge) };
      }
      return { ...r, raw: undefined, sampleTime: undefined, stale: true };
    };
    const value = (key?: string) => {
      const r = read(key);
      return r && !r.stale ? numeric(r.raw) : undefined;
    };
    const status = (key?: string, raw?: unknown, time?: number, convert = physicalHealth) => {
      const r = read(key);
      return key ? (r && !r.stale ? convert(r.raw) : 'unknown') : fresh(time, now, maxAge) ? convert(raw) : 'unknown';
    };
    const events: NetworkEvent[] = [];
    const history = (
      key: string | undefined,
      kind: NetworkEvent['kind'],
      id: string,
      convert: (v: unknown) => Health
    ) => {
      const r = key ? readings.get(key) : undefined;
      const table = kind === 'physical' ? 'links' : kind === 'ospf' ? 'ospf' : 'tunnels';
      const field = kind === 'physical' ? 'physicalStatus' : kind === 'ospf' ? 'state' : 'operStatus';
      const rows = r
        ? []
        : tableRows(table)
            .filter((row) => row.id === id)
            .map((row) => ({ time: timestamp(row.observedAt), raw: row[field] }))
            .filter((row): row is { time: number; raw: unknown } => row.time !== undefined)
            .sort((a, b) => a.time - b.time);
      const changes = transitions(
        r?.values ?? rows.map((row) => row.raw),
        r?.times.map((t) => timestamp(t) ?? NaN) ?? rows.map((row) => row.time),
        now,
        maxAge,
        convert,
        id,
        kind
      );
      events.push(...changes);
      return changes.filter(
        (e) => e.severity === 'critical' && e.time >= now - (options.flapWindowMinutes ?? 10) * 60000
      ).length;
    };
    const nodeRows = latestRows('nodes'),
      linkRows = latestRows('links'),
      ospfRows = latestRows('ospf'),
      tunnelRows = latestRows('tunnels');
    const merge = <T extends { id: string }>(saved: T[], rows: Map<string, Row>, create: (row: Row) => T): T[] => {
      const map = new Map(saved.map((item) => [item.id, item]));
      for (const [id, row] of rows) {
        const old = map.get(id);
        const merged = {
          ...old,
          ...create({ ...old, ...row }),
          ...(old && 'position' in old ? { position: old.position } : {}),
        };
        if (old && 'overrideFields' in old && Array.isArray(old.overrideFields)) {
          const allowed = new Set([
            'hostname',
            'site',
            'routerId',
            'ip',
            'model',
            'vendor',
            'region',
            'group',
            'icon',
            'name',
            'source',
            'target',
            'sourceInterface',
            'targetInterface',
            'capacityBps',
            'bindings',
          ]);
          for (const key of old.overrideFields) {
            if (typeof key === 'string' && allowed.has(key)) {
              (merged as Record<string, unknown>)[key] = (old as Record<string, unknown>)[key];
            }
          }
        }
        map.set(id, merged);
      }
      return [...map.values()];
    };
    const nodes = merge<NetworkNode>(inventory.nodes, nodeRows, (row) => ({
      id: text(row.id),
      hostname: text(row.hostname) || text(row.id),
      site: text(row.site) || text(row.hostname) || text(row.id),
      routerId: text(row.routerId),
      ip: text(row.ip),
      model: text(row.model),
      vendor: text(row.vendor),
      group: text(row.group),
      region: text(row.region),
    }));
    const validNodes = new Set(nodes.map((n) => n.id));
    const linksConfig = merge<NetworkLink>(inventory.links, linkRows, (row) => ({
      id: text(row.id),
      name: text(row.name),
      source: text(row.source),
      target: text(row.target),
      sourceInterface: text(row.sourceInterface),
      targetInterface: text(row.targetInterface),
      capacityBps: numeric(row.capacityBps),
    })).filter((l) => {
      if (!validNodes.has(l.source) || !validNodes.has(l.target)) {
        warnings.push(`${l.id}: extremos não cadastrados; enlace ignorado.`);
        return false;
      }
      return true;
    });
    const links: LinkState[] = linksConfig.map((l) => {
      const row = linkRows.get(l.id),
        time = timestamp(row?.observedAt);
      const direct = (name: string) => (fresh(time, now, maxAge) ? numeric(row?.[name]) : undefined);
      const rx = value(l.bindings?.rx) ?? direct('rxBps'),
        tx = value(l.bindings?.tx) ?? direct('txBps');
      const values = {
        rx,
        tx,
        latency: value(l.bindings?.latency) ?? direct('latencyMs'),
        errors: value(l.bindings?.errors) ?? direct('errorsPerSecond'),
        discards: value(l.bindings?.discards) ?? direct('discardsPerSecond'),
        opticalRx: value(l.bindings?.opticalRx) ?? direct('opticalRxDbm'),
        opticalTx: value(l.bindings?.opticalTx) ?? direct('opticalTxDbm'),
      };
      const traffic = [rx, tx].filter((v): v is number => v !== undefined && v >= 0);
      const utilization =
        l.capacityBps && l.capacityBps > 0 && traffic.length ? (Math.max(...traffic) * 100) / l.capacityBps : undefined;
      const physical = status(l.bindings?.status, row?.physicalStatus, time);
      const flapCount = history(l.bindings?.status, 'physical', l.id, physicalHealth);
      const optical = l.bindings?.opticalRx ? metrics.get(l.bindings.opticalRx) : undefined;
      const attenuation = optical ? signalAttenuation(optical, opticalSettings(options), now) : undefined;
      const attenuationDb = attenuation?.state === 'active' ? attenuation.event?.dropDb : undefined;
      const thresholds = [
        options.warningPercent ?? 70,
        options.degradedPercent ?? 85,
        options.criticalPercent ?? 95,
      ].sort((a, b) => a - b);
      const load: Health =
        utilization === undefined
          ? 'ok'
          : utilization >= thresholds[2]
            ? 'critical'
            : utilization >= thresholds[1]
              ? 'degraded'
              : utilization >= thresholds[0]
                ? 'warning'
                : 'ok';
      const quality: Health =
        (values.errors ?? 0) > 0 ||
        (values.discards ?? 0) > 0 ||
        flapCount >= (options.flapCount ?? 3) ||
        attenuationDb !== undefined
          ? 'degraded'
          : 'ok';
      return {
        ...l,
        physical,
        values,
        utilization,
        flapCount,
        attenuationDb,
        sampleTime: read(l.bindings?.status)?.sampleTime ?? time,
        health: physical === 'down' || physical === 'unknown' ? physical : worst([load, quality]),
      };
    });
    const ospfConfigs = merge<OspfNeighbor>(inventory.ospfNeighbors, ospfRows, (row) => ({
      id: text(row.id),
      localNode: text(row.localNode),
      neighborRouterId: text(row.neighborRouterId),
      neighborIp: text(row.neighborIp),
      interface: text(row.interface),
      area: text(row.area),
      linkId: text(row.linkId),
      state: ospfState(row.state),
      observedAt: timestamp(row.observedAt),
      lastChange: timestamp(row.lastChange),
      transitions: numeric(row.transitions),
      cost: fresh(timestamp(row.costObservedAt ?? row.observedAt), now, maxAge) ? numeric(row.cost) : undefined,
      costObservedAt: timestamp(row.costObservedAt ?? row.observedAt),
      dataSource: text(row.costSource ?? row.dataSource),
      localRouterId: text(row.localRouterId),
      localIp: text(row.localIp),
      process: text(row.process),
      networkType: text(row.networkType),
    }));
    const ospfNeighbors = ospfConfigs.map((n) => {
      const r = read(n.stateItem);
      const time = r?.sampleTime ?? n.observedAt;
      const state = fresh(time, now, maxAge) ? ospfState(n.stateItem ? r?.raw : n.state) : 'Unknown';
      const targets = nodes.filter((node) => node.routerId === n.neighborRouterId);
      if (targets.length > 1) {
        warnings.push(`${n.id}: Router ID do vizinho ambíguo.`);
      }
      const targetNode = targets.length === 1 ? targets[0].id : undefined;
      const matchingLinks = links.filter(
        (l) =>
          (l.source === n.localNode && l.target === targetNode && l.sourceInterface === n.interface) ||
          (l.target === n.localNode && l.source === targetNode && l.targetInterface === n.interface)
      );
      const linkId = n.linkId || (matchingLinks.length === 1 ? matchingLinks[0].id : undefined);
      const flapCount = history(n.stateItem, 'ospf', n.id, (v) => ospfHealth(ospfState(v), n.expectedState));
      return {
        ...n,
        linkId,
        state,
        observedAt: time,
        targetNode,
        flapCount,
        health: worst([ospfHealth(state, n.expectedState), flapCount >= (options.flapCount ?? 3) ? 'degraded' : 'ok']),
      };
    });
    const parsePath = (raw: unknown, observedAt?: number): TunnelPath | undefined => {
      if (!raw) {
        return undefined;
      }
      try {
        const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (
          !p ||
          !Array.isArray(p.hops) ||
          p.hops.some((h: unknown) => typeof h !== 'string') ||
          (p.linkIds && (!Array.isArray(p.linkIds) || p.linkIds.some((id: unknown) => typeof id !== 'string')))
        ) {
          throw new Error('Caminho inválido');
        }
        return {
          hops: p.hops,
          linkIds: p.linkIds,
          kind: p.kind === 'observed' ? 'observed' : 'configured',
          observedAt: timestamp(p.observedAt) ?? observedAt,
        };
      } catch {
        warnings.push('Um caminho MPLS foi ignorado: use JSON com hops e linkIds.');
        return undefined;
      }
    };
    const tunnelConfigs = merge<MplsTunnel>(
      inventory.mplsTunnels.map((t) => ({
        ...t,
        primaryPath: t.primaryPath ? { ...t.primaryPath, kind: 'configured' } : undefined,
        backupPath: t.backupPath ? { ...t.backupPath, kind: 'configured' } : undefined,
      })),
      tunnelRows,
      (row) => ({
        id: text(row.id),
        name: text(row.name),
        source: text(row.source),
        destination: text(row.destination),
        adminStatus: text(row.adminStatus),
        operStatus: text(row.operStatus),
        observedAt: timestamp(row.observedAt),
        primaryPath: parsePath(row.primaryPath, timestamp(row.observedAt)),
        backupPath: parsePath(row.backupPath, timestamp(row.observedAt)),
        activePath: row.activePath === 'primary' || row.activePath === 'backup' ? row.activePath : 'unknown',
        primaryLsp: text(row.primaryLsp),
        backupLsp: text(row.backupLsp),
        bandwidthBps: numeric(row.bandwidthBps),
        priority: numeric(row.priority),
        uptime: numeric(row.uptime),
        lastChange: timestamp(row.lastChange),
      })
    );
    const mplsTunnels = tunnelConfigs.map((t) => {
      const flapCount = history(t.statusItem, 'mpls', t.id, tunnelHealth);
      return {
        ...t,
        flapCount,
        health: worst([
          status(t.statusItem, t.operStatus, t.observedAt, tunnelHealth),
          flapCount >= (options.flapCount ?? 3) ? 'degraded' : 'ok',
        ]),
        primary: resolvePath(t.primaryPath, t, nodes, links, now, maxAge),
        backup: resolvePath(t.backupPath, t, nodes, links, now, maxAge),
        trafficBps: value(t.trafficItem),
      };
    });
    const nodeStates = nodes.map((n) => {
      const row = nodeRows.get(n.id);
      const snmp = status(n.bindings?.status, row?.snmpStatus, timestamp(row?.observedAt));
      const related = [
        ...links.filter((l) => l.source === n.id || l.target === n.id).map((l) => l.health),
        ...ospfNeighbors.filter((o) => o.localNode === n.id).map((o) => o.health),
        ...mplsTunnels.filter((t) => t.source === n.id || t.destination === n.id).map((t) => t.health),
      ];
      return {
        ...n,
        snmp,
        health: snmp === 'unknown' || snmp === 'down' ? ('unknown' as const) : worst([snmp, ...related]),
        uptime: value(n.bindings?.uptime) ?? numeric(row?.uptime),
      };
    });
    for (const row of tableRows('events')) {
      const time = timestamp(row.time);
      if (!time || time > now || !['physical', 'ospf', 'mpls'].includes(text(row.kind))) {
        continue;
      }
      events.push({
        id: text(row.id),
        entityId: text(row.entityId),
        kind: row.kind as NetworkEvent['kind'],
        time,
        severity: row.severity === 'restored' ? 'restored' : row.severity === 'critical' ? 'critical' : 'warning',
        message: text(row.message),
      });
    }
    if (!frames.length && nodes.length) {
      warnings.push('Sem respostas das consultas do Grafana. Os cadastros permanecem visíveis, sem status presumido.');
    }
    const partial = {
      nodes: nodeStates,
      links,
      ospfNeighbors,
      mplsTunnels,
      metrics,
      events: [...new Map(events.map((e) => [e.id, e])).values()].sort((a, b) => b.time - a.time),
      warnings,
      services: tableRows('service_paths').flatMap((row) => {
        const service = serviceAnalysis(row, now, maxAge);
        if (!service) {
          warnings.push('Uma análise de VSI inválida foi ignorada.');
        }
        return service ? [service] : [];
      }),
      collectors: tableRows('collector').map(collectorState),
    };
    return { ...partial, incidents: correlate(partial) };
  }
}
