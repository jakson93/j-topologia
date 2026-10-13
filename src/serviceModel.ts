import { CollectorState, ServiceAnalysis, ServicePathRecord } from './types';
const decode = (value: unknown) => (typeof value === 'string' ? JSON.parse(value) : value);
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
const optionalText = (value: unknown) => (typeof value === 'string' ? value : undefined);
const optionalNumber = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
export function serviceAnalysis(
  row: Record<string, unknown>,
  now: number,
  maxAge: number
): ServiceAnalysis | undefined {
  try {
    const vsi = decode(row.vsi);
    if (
      !record(vsi) ||
      typeof vsi.id !== 'string' ||
      typeof vsi.name !== 'string' ||
      typeof vsi.localNode !== 'string'
    ) {
      return undefined;
    }
    const paths = (raw: unknown): ServicePathRecord[] => {
      const values = decode(raw);
      if (!Array.isArray(values)) {
        return [];
      }
      return values
        .filter((v) => record(v) && ['pwId', 'tunnelId', 'lspId'].every((k) => typeof v[k] === 'string'))
        .map((v) => {
          const p = v.path;
          const valid =
            record(p) &&
            Array.isArray(p.hops) &&
            p.hops.every((h) => record(h) && typeof h.routerId === 'string') &&
            Array.isArray(p.segments) &&
            p.segments.every((s) => record(s) && typeof s.source === 'string' && typeof s.target === 'string');
          const inTime = (t: unknown) => typeof t === 'number' && t <= now && now - t <= maxAge;
          const stale = !valid || !inTime(p.observedAt) || !inTime(v.observedAt);
          return {
            ...v,
            pwId: String(v.pwId),
            tunnelId: String(v.tunnelId),
            lspId: String(v.lspId),
            lspRole: optionalText(v.lspRole),
            dataSource: optionalText(v.dataSource),
            observedAt: optionalNumber(v.observedAt),
            distributionPercent:
              typeof v.distributionPercent === 'number' && v.distributionPercent >= 0 && v.distributionPercent <= 100
                ? v.distributionPercent
                : undefined,
            issues: strings(v.issues),
            discoveryConfidence: stale ? 'incomplete' : v.discoveryConfidence,
            path: valid
              ? {
                  ...p,
                  id: optionalText(p.id) ?? '',
                  dataSource: optionalText(p.dataSource),
                  observedAt: optionalNumber(p.observedAt),
                  hops: (p.hops as Array<Record<string, unknown>>).map((h) => ({
                    routerId: String(h.routerId),
                    nodeId: optionalText(h.nodeId),
                    incomingInterface: optionalText(h.incomingInterface),
                    outgoingInterface: optionalText(h.outgoingInterface),
                    labelIn: optionalText(h.labelIn),
                    labelOut: optionalText(h.labelOut),
                  })),
                  segments: (p.segments as Array<Record<string, unknown>>).map((s) => ({
                    source: String(s.source),
                    target: String(s.target),
                    linkId: optionalText(s.linkId),
                    sourceInterface: optionalText(s.sourceInterface),
                    targetInterface: optionalText(s.targetInterface),
                    ospfCost: optionalNumber(s.ospfCost),
                    costSource: optionalText(s.costSource),
                    costInterface: optionalText(s.costInterface),
                    costObservedAt: optionalNumber(s.costObservedAt),
                    capacityBps: optionalNumber(s.capacityBps),
                    forwardBps: optionalNumber(s.forwardBps),
                    reverseBps: optionalNumber(s.reverseBps),
                    localIp: optionalText(s.localIp),
                    neighborIp: optionalText(s.neighborIp),
                  })),
                  stale,
                  actual: p.actual === true && !stale,
                  issues: strings(p.issues),
                }
              : undefined,
          } as ServicePathRecord;
        });
    };
    const forward = paths(row.forward),
      reverse = paths(row.reverse);
    const stale = [...forward, ...reverse].some((p) => p.path?.stale);
    return {
      id: String(row.id ?? vsi.id),
      vsi: {
        id: vsi.id,
        name: vsi.name,
        localNode: vsi.localNode,
        vsiId: optionalText(vsi.vsiId),
        status: optionalText(vsi.status),
        observedAt: optionalNumber(vsi.observedAt),
        dataSource: optionalText(vsi.dataSource),
      },
      forward,
      reverse,
      asymmetric: stale
        ? undefined
        : typeof row.asymmetric === 'boolean'
          ? row.asymmetric
          : row.asymmetric === 'true'
            ? true
            : row.asymmetric === 'false'
              ? false
              : undefined,
      multipleActivePaths: row.multipleActivePaths === true || row.multipleActivePaths === 'true',
      discoveryConfidence: stale ? 'incomplete' : String(row.discoveryConfidence ?? 'incomplete'),
      issues: strings(decode(row.issues)),
    };
  } catch {
    return undefined;
  }
}
export function collectorState(row: Record<string, unknown>): CollectorState {
  let modules: string[] = [];
  try {
    const value = decode(row.modules);
    if (Array.isArray(value)) {
      modules = value.filter((v) => typeof v === 'string');
    }
  } catch {
    /* Partial capability response. */
  }
  return {
    id: String(row.id),
    deviceId: String(row.deviceId ?? ''),
    protocol: String(row.protocol ?? ''),
    status: String(row.status ?? 'unknown'),
    observedAt: typeof row.observedAt === 'number' ? row.observedAt : undefined,
    modules,
    warningCount: typeof row.warningCount === 'number' ? row.warningCount : undefined,
  };
}
export function serviceDependencies(services: ServiceAnalysis[], linkId?: string, tunnelId?: string, nodeId?: string) {
  return services.filter((s) =>
    [...s.forward, ...s.reverse].some(
      (r) =>
        r.path?.actual &&
        (linkId
          ? r.path.segments.some((segment) => segment.linkId === linkId)
          : tunnelId
            ? r.tunnelId === tunnelId
            : nodeId
              ? r.path.hops.some((h) => h.nodeId === nodeId)
              : false)
    )
  );
}
