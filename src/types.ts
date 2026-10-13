export type Health = 'ok' | 'warning' | 'degraded' | 'critical' | 'down' | 'unknown';
export type ViewMode = 'physical' | 'ospf' | 'mpls' | 'all';
export type Point = { x: number; y: number };
export type MetricKey = 'rx' | 'tx' | 'latency' | 'errors' | 'discards' | 'opticalRx' | 'opticalTx';
/** Values must already be rates, except optical power (dBm) and latency (ms). */
export type Bindings = Partial<Record<MetricKey | 'status' | 'uptime', string>>;
export type NetworkNode = {
  overrideFields?: string[];
  id: string;
  hostname: string;
  site: string;
  routerId?: string;
  ip?: string;
  model?: string;
  vendor?: string;
  region?: string;
  group?: string;
  icon?: 'router' | 'switch' | 'datacenter';
  position?: Point;
  bindings?: Bindings;
};
export type NetworkLink = {
  overrideFields?: string[];
  id: string;
  name: string;
  source: string;
  target: string;
  sourceInterface: string;
  targetInterface: string;
  capacityBps?: number;
  bindings?: Bindings;
  points?: Point[];
};
export type OspfState = 'Down' | 'Attempt' | 'Init' | '2-Way' | 'ExStart' | 'Exchange' | 'Loading' | 'Full' | 'Unknown';
export type OspfNeighbor = {
  id: string;
  localNode: string;
  neighborRouterId: string;
  neighborIp?: string;
  interface: string;
  area: string;
  linkId?: string;
  stateItem?: string;
  expectedState?: 'Full' | '2-Way';
  state?: OspfState;
  observedAt?: number;
  lastChange?: number;
  transitions?: number;
  cost?: number;
  costObservedAt?: number;
  dataSource?: string;
  localRouterId?: string;
  localIp?: string;
  process?: string;
  networkType?: string;
};
export type TunnelPath = {
  /** Ordered node IDs or Router IDs, including the two endpoints. */
  hops: string[];
  /** Ordered physical link IDs disambiguate parallel links. */
  linkIds?: string[];
  kind: 'observed' | 'configured';
  observedAt?: number;
};
export type MplsTunnel = {
  id: string;
  name: string;
  source: string;
  destination: string;
  statusItem?: string;
  adminStatus?: string;
  operStatus?: string;
  observedAt?: number;
  primaryPath?: TunnelPath;
  backupPath?: TunnelPath;
  activePath?: 'primary' | 'backup' | 'unknown';
  primaryLsp?: string;
  backupLsp?: string;
  bandwidthBps?: number;
  trafficItem?: string;
  priority?: number;
  uptime?: number;
  lastChange?: number;
};
export type NetworkEvent = {
  id: string;
  entityId: string;
  kind: 'physical' | 'ospf' | 'mpls';
  time: number;
  severity: 'critical' | 'warning' | 'restored';
  message: string;
};
export type TopologyInventory = {
  nodes: NetworkNode[];
  links: NetworkLink[];
  ospfNeighbors: OspfNeighbor[];
  mplsTunnels: MplsTunnel[];
};
export type NetworkMetric = { times: number[]; values: Array<number | null> };
export type NodeState = NetworkNode & { health: Health; snmp: Health; uptime?: number };
export type LinkState = NetworkLink & {
  health: Health;
  physical: Health;
  values: Partial<Record<MetricKey, number>>;
  utilization?: number;
  sampleTime?: number;
  flapCount: number;
  attenuationDb?: number;
};
export type OspfStateRecord = OspfNeighbor & { health: Health; targetNode?: string; flapCount: number };
export type ResolvedPath = {
  nodes: string[];
  linkIds: string[];
  complete: boolean;
  issues: string[];
  evidence: 'observed' | 'configured' | 'stale' | 'unavailable';
};
export type TunnelState = MplsTunnel & {
  health: Health;
  primary: ResolvedPath;
  backup: ResolvedPath;
  flapCount: number;
  trafficBps?: number;
};
export type Incident = {
  id: string;
  title: string;
  health: Health;
  linkId?: string;
  tunnelIds: string[];
  neighborIds: string[];
  description: string;
};
export type TopologySnapshot = {
  nodes: NodeState[];
  links: LinkState[];
  ospfNeighbors: OspfStateRecord[];
  mplsTunnels: TunnelState[];
  metrics: Map<string, NetworkMetric>;
  events: NetworkEvent[];
  incidents: Incident[];
  warnings: string[];
  services: ServiceAnalysis[];
  collectors: CollectorState[];
};
export type ServiceSegment = {
  source: string;
  target: string;
  linkId?: string;
  sourceInterface?: string;
  targetInterface?: string;
  ospfCost?: number;
  costSource?: string;
  costObservedAt?: number;
  capacityBps?: number;
  rxBps?: number;
  txBps?: number;
  localIp?: string;
  neighborIp?: string;
  forwardBps?: number;
  reverseBps?: number;
  costInterface?: string;
};
export type ServicePathRecord = {
  pwId: string;
  tunnelId: string;
  lspId: string;
  lspRole?: string;
  distributionPercent?: number;
  dataSource?: string;
  observedAt?: number;
  discoveryConfidence: string;
  issues?: string[];
  path?: {
    id: string;
    hops: Array<{
      nodeId?: string;
      routerId: string;
      incomingInterface?: string;
      outgoingInterface?: string;
      labelIn?: string;
      labelOut?: string;
    }>;
    segments: ServiceSegment[];
    actual: boolean;
    stale: boolean;
    observedAt?: number;
    dataSource?: string;
    issues: string[];
    discoveryConfidence: string;
  };
};
export type ServiceAnalysis = {
  id: string;
  vsi: {
    id: string;
    name: string;
    localNode: string;
    vsiId?: string;
    status?: string;
    observedAt?: number;
    dataSource?: string;
  };
  forward: ServicePathRecord[];
  reverse: ServicePathRecord[];
  asymmetric?: boolean;
  multipleActivePaths: boolean;
  discoveryConfidence: string;
  issues: string[];
};
export type CollectorState = {
  id: string;
  deviceId: string;
  protocol: string;
  status: string;
  observedAt?: number;
  modules: string[];
  warningCount?: number;
};
export interface PanelOptions {
  inventory?: TopologyInventory;
  demo?: boolean;
  mode?: ViewMode;
  routeStyle?: 'curve' | 'orthogonal' | 'direct';
  staleAfterSeconds?: number;
  warningPercent?: number;
  degradedPercent?: number;
  criticalPercent?: number;
  flapCount?: number;
  flapWindowMinutes?: number;
  attenuationEnabled?: boolean;
  attenuationDropDb?: number;
  attenuationWindowMinutes?: number;
  viewport?: { x: number; y: number; scale: number };
  filters?: { query: string; site: string; group: string; status: string };
  sidebar?: boolean;
}
export const EMPTY_INVENTORY: TopologyInventory = { nodes: [], links: [], ospfNeighbors: [], mplsTunnels: [] };
