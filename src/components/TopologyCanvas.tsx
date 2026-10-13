import React from 'react';
import { useStyles2, useTheme2 } from '@grafana/ui';
import { NodeState, PanelOptions, Point, ServicePathRecord, TopologySnapshot, ViewMode } from '../types';
import { getStyles, color } from '../styles';
import { healthLabel, rate } from '../transportModel';

type Selection = { kind: 'node' | 'link' | 'tunnel' | 'ospf' | 'service'; id: string } | undefined;
export type { Selection };
const defaultPoint = (i: number) => ({ x: 160 + (i % 4) * 320, y: 140 + Math.floor(i / 4) * 190 });
const NodeCard = React.memo(function NodeCard({
  node,
  point,
  selected,
  editing,
  ospf,
  mpls,
  onSelect,
  onDrag,
  onDoubleClick,
}: {
  node: NodeState;
  point: Point;
  selected: boolean;
  editing: boolean;
  ospf: string;
  mpls: string;
  onSelect: () => void;
  onDrag: (event: React.PointerEvent) => void;
  onDoubleClick: () => void;
}) {
  const theme = useTheme2();
  const c = color(theme, node.health);
  return (
    <g
      transform={`translate(${point.x},${point.y})`}
      role="button"
      tabIndex={0}
      aria-label={`${node.site}, ${node.hostname}, ${healthLabel[node.health]}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      onPointerDown={editing ? onDrag : (e) => e.stopPropagation()}
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
      style={{ cursor: editing ? 'grab' : 'pointer' }}
    >
      <title>{`${node.hostname}\nRouter ID ${node.routerId || 'não informado'}\n${healthLabel[node.health]}\nClique para investigar${editing ? ' · arraste para mover' : ''}`}</title>
      <rect
        x={-106}
        y={-45}
        width={212}
        height={90}
        rx={8}
        fill={theme.colors.background.primary}
        stroke={selected ? theme.colors.info.text : theme.colors.border.medium}
        strokeWidth={selected ? 2 : 1}
      />
      <rect x={-106} y={-30} width={3} height={60} rx={1.5} fill={c} />
      <image
        href={`public/plugins/jakson-j-topologia-panel/img/pop-${node.icon === 'datacenter' ? 'datacenter' : node.icon === 'switch' ? 'olt' : 'router'}.svg`}
        x={-91}
        y={-17}
        width={28}
        height={28}
      />
      <text x={-52} y={-18} fill={theme.colors.text.primary} fontSize={theme.typography.body.fontSize} fontWeight={600}>
        {node.site.slice(0, 20)}
      </text>
      <circle cx={90} cy={-25} r={4} fill={c} />
      <text x={-52} y={1} fill={theme.colors.text.secondary} fontSize={theme.typography.bodySmall.fontSize}>
        {node.hostname.slice(0, 23)}
      </text>
      <text x={-88} y={28} fill={theme.colors.text.secondary} fontSize={theme.typography.bodySmall.fontSize}>
        OSPF{' '}
        <tspan
          fill={
            ospf === 'FULL'
              ? theme.colors.success.text
              : ospf === '—'
                ? theme.colors.text.secondary
                : theme.colors.warning.text
          }
        >
          {ospf}
        </tspan>
      </text>
      <text x={18} y={28} fill={theme.colors.text.secondary} fontSize={theme.typography.bodySmall.fontSize}>
        TE{' '}
        <tspan
          fill={
            mpls === 'UP'
              ? theme.colors.success.text
              : mpls === '—'
                ? theme.colors.text.secondary
                : theme.colors.error.text
          }
        >
          {mpls}
        </tspan>
      </text>
    </g>
  );
});

export function TopologyCanvas({
  snapshot,
  mode,
  selected,
  pathLinks,
  backupLinks,
  pathNodes,
  editing,
  routeStyle,
  viewport,
  onViewport,
  onSelect,
  onMove,
  onBend,
  connectSource,
  onConnect,
  onExpand,
  serviceFlows = [],
}: {
  snapshot: TopologySnapshot;
  mode: ViewMode;
  selected: Selection;
  pathLinks: string[];
  backupLinks: string[];
  pathNodes: string[];
  editing: boolean;
  routeStyle: PanelOptions['routeStyle'];
  viewport: PanelOptions['viewport'];
  onViewport: (v: NonNullable<PanelOptions['viewport']>) => void;
  onSelect: (s: Selection) => void;
  onMove: (id: string, p: Point) => void;
  onBend: (id: string, points: Point[]) => void;
  connectSource?: string;
  onConnect: (id: string) => void;
  onExpand: (id: string) => void;
  serviceFlows?: Array<{ id: string; direction: 'forward' | 'reverse'; record: ServicePathRecord }>;
}) {
  const theme = useTheme2();
  const styles = useStyles2(getStyles);
  const root = React.useRef<HTMLDivElement>(null),
    svg = React.useRef<SVGSVGElement>(null);
  const [size, setSize] = React.useState({ w: 0, h: 0 });
  const [view, setView] = React.useState({ x: 0, y: 0, scale: 0.7, ...viewport });
  React.useEffect(() => {
    if (viewport) {
      setView(viewport);
    }
  }, [viewport]);
  const [autoPositions, setAutoPositions] = React.useState<Record<string, Point>>({});
  React.useEffect(() => {
    setAutoPositions((current) => {
      const missing = snapshot.nodes.filter((n) => !current[n.id]);
      if (!missing.length) {
        return current;
      }
      const next = { ...current };
      missing.forEach((n, i) => {
        next[n.id] = n.position ?? defaultPoint(Object.keys(current).length + i);
      });
      return next;
    });
  }, [snapshot.nodes]);
  const [drag, setDrag] = React.useState<{
    kind: 'node' | 'pan' | 'bend';
    id?: string;
    index?: number;
    start: Point;
    origin: Point;
  }>();
  const [preview, setPreview] = React.useState<{ id: string; p: Point }>();
  const [bendPreview, setBendPreview] = React.useState<{ id: string; index: number; p: Point }>();
  const moved = React.useRef(false),
    fitted = React.useRef(false);
  React.useEffect(() => {
    if (!root.current) {
      return;
    }
    const observer = new ResizeObserver(([entry]) =>
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height })
    );
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  const points = React.useMemo(
    () => new Map(snapshot.nodes.map((n, i) => [n.id, n.position ?? autoPositions[n.id] ?? defaultPoint(i)])),
    [snapshot.nodes, autoPositions]
  );
  const fit = React.useCallback(() => {
    const pts = [...points.values()];
    if (!pts.length) {
      return;
    }
    const minX = Math.min(...pts.map((p) => p.x)) - 150,
      maxX = Math.max(...pts.map((p) => p.x)) + 150;
    const minY = Math.min(...pts.map((p) => p.y)) - 110,
      maxY = Math.max(...pts.map((p) => p.y)) + 110;
    const scale = Math.max(0.08, Math.min(1.4, size.w / (maxX - minX), size.h / (maxY - minY)));
    setView({
      x: (size.w - (maxX - minX) * scale) / 2 - minX * scale,
      y: (size.h - (maxY - minY) * scale) / 2 - minY * scale,
      scale,
    });
  }, [points, size, setView]);
  React.useEffect(() => {
    if (!fitted.current && size.w > 100 && size.h > 30 && points.size) {
      fitted.current = true;
      if (!viewport) {
        fit();
      }
    }
  }, [size, points, fit, viewport]);
  const local = (event: React.PointerEvent | React.WheelEvent | React.MouseEvent): Point => {
    const rect = svg.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const world = (event: React.PointerEvent | React.MouseEvent) => {
    const p = local(event);
    return { x: (p.x - view.x) / view.scale, y: (p.y - view.y) / view.scale };
  };
  const point = (id: string) => (preview?.id === id ? preview.p : points.get(id));
  const path = (a: Point, b: Point, bends: Point[] = [], parallel = 0) => {
    if (bends.length) {
      return `M ${a.x} ${a.y} ${bends.map((p) => `L ${p.x} ${p.y}`).join(' ')} L ${b.x} ${b.y}`;
    }
    if (routeStyle === 'direct') {
      return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
    }
    if (routeStyle === 'orthogonal') {
      const mid = (a.x + b.x) / 2 + parallel;
      return `M ${a.x} ${a.y} L ${mid} ${a.y} L ${mid} ${b.y} L ${b.x} ${b.y}`;
    }
    const dx = b.x - a.x,
      dy = b.y - a.y,
      length = Math.max(1, Math.hypot(dx, dy));
    return `M ${a.x} ${a.y} Q ${(a.x + b.x) / 2 - (dy / length) * parallel} ${(a.y + b.y) / 2 + (dx / length) * parallel} ${b.x} ${b.y}`;
  };
  const pairs = new Map<string, string[]>();
  snapshot.links.forEach((l) => {
    const k = [l.source, l.target].sort().join(':');
    pairs.set(k, [...(pairs.get(k) ?? []), l.id]);
  });
  const highlight = pathLinks.length > 0 || backupLinks.length > 0 || serviceFlows.length > 0;
  return (
    <div ref={root} className={styles.canvas}>
      <div className={styles.legend}>
        {(['ok', 'degraded', 'down', 'unknown'] as const).map((s) => (
          <span key={s} style={{ color: color(theme, s) }}>
            ● {healthLabel[s]}
          </span>
        ))}
        {highlight && (
          <span style={{ color: theme.colors.info.text }}>
            {serviceFlows.length ? '→ Ida (ciano) · → Volta (âmbar)' : '━━ Principal · ┄ Backup'}
          </span>
        )}
        {connectSource && <strong>Selecione o destino para conectar</strong>}
      </div>
      <svg
        ref={svg}
        aria-label="Topologia da rede de transporte"
        onWheel={(e) => {
          const p = local(e),
            next = Math.max(0.08, Math.min(3, view.scale * (e.deltaY > 0 ? 0.9 : 1.1)));
          setView({
            x: p.x - ((p.x - view.x) * next) / view.scale,
            y: p.y - ((p.y - view.y) * next) / view.scale,
            scale: next,
          });
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) {
            return;
          }
          svg.current?.setPointerCapture(e.pointerId);
          moved.current = false;
          setDrag({ kind: 'pan', start: local(e), origin: { x: view.x, y: view.y } });
        }}
        onPointerMove={(e) => {
          if (!drag) {
            return;
          }
          const p = local(e),
            dx = p.x - drag.start.x,
            dy = p.y - drag.start.y;
          if (Math.hypot(dx, dy) > 3) {
            moved.current = true;
          }
          if (drag.kind === 'pan') {
            setView((v) => ({ ...v, x: drag.origin.x + dx, y: drag.origin.y + dy }));
          } else if (drag.kind === 'node') {
            setPreview({ id: drag.id!, p: { x: drag.origin.x + dx / view.scale, y: drag.origin.y + dy / view.scale } });
          } else {
            setBendPreview({
              id: drag.id!,
              index: drag.index!,
              p: { x: drag.origin.x + dx / view.scale, y: drag.origin.y + dy / view.scale },
            });
          }
        }}
        onPointerUp={(e) => {
          if (preview) {
            onMove(preview.id, { x: Math.round(preview.p.x / 10) * 10, y: Math.round(preview.p.y / 10) * 10 });
          }
          if (bendPreview) {
            const l = snapshot.links.find((l) => l.id === bendPreview.id);
            if (l) {
              onBend(
                l.id,
                (l.points ?? []).map((p, i) => (i === bendPreview.index ? bendPreview.p : p))
              );
            }
          }
          if (drag?.kind === 'pan' && !moved.current) {
            onSelect(undefined);
          }
          setDrag(undefined);
          setPreview(undefined);
          setBendPreview(undefined);
          svg.current?.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          setDrag(undefined);
          setPreview(undefined);
          setBendPreview(undefined);
        }}
      >
        <g transform={`translate(${view.x},${view.y}) scale(${view.scale})`}>
          {snapshot.links.map((l) => {
            const a = point(l.source),
              b = point(l.target);
            if (!a || !b) {
              return null;
            }
            const siblings = pairs.get([l.source, l.target].sort().join(':'))!;
            const offset = (siblings.indexOf(l.id) - (siblings.length - 1) / 2) * 80;
            const bends = (l.points ?? []).map((p, i) =>
              bendPreview?.id === l.id && bendPreview.index === i ? bendPreview.p : p
            );
            const d = path(a, b, bends, offset),
              isPath = pathLinks.includes(l.id),
              isBackup = backupLinks.includes(l.id);
            const hidden = mode === 'ospf' || (mode === 'mpls' && !highlight);
            const opacity = hidden || (highlight && !isPath && !isBackup) ? 0.15 : 1;
            const c = isPath ? theme.colors.info.text : isBackup ? theme.colors.warning.text : color(theme, l.health);
            return (
              <g key={l.id} opacity={opacity}>
                <path
                  d={d}
                  fill="none"
                  stroke={c}
                  strokeWidth={isPath ? 5 : selected?.id === l.id ? 4 : 2}
                  strokeDasharray={isBackup ? '8 6' : l.physical === 'unknown' ? '3 6' : undefined}
                />
                {isPath && l.physical === 'ok' && (
                  <path
                    d={d}
                    fill="none"
                    stroke={theme.colors.text.primary}
                    strokeWidth={1}
                    className="flow"
                    opacity={0.55}
                  />
                )}
                <path
                  d={d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={22}
                  role="button"
                  tabIndex={0}
                  aria-label={`Enlace ${l.name}: ${healthLabel[l.health]}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => onSelect({ kind: 'link', id: l.id })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect({ kind: 'link', id: l.id });
                    }
                  }}
                  onDoubleClick={(e) => {
                    if (editing) {
                      onBend(l.id, [...(l.points ?? []), world(e)]);
                    }
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <title>{`${l.name}\n${l.sourceInterface} ↔ ${l.targetInterface}\nRX ${rate(l.values.rx)} · TX ${rate(l.values.tx)}\n${healthLabel[l.health]}${editing ? '\nDuplo clique: adicionar desvio' : ''}`}</title>
                </path>
                {!hidden && (!highlight || isPath || isBackup) && (
                  <g
                    transform={`translate(${(a.x + b.x) / 2},${(a.y + b.y) / 2 + offset / 2})`}
                    role="button"
                    tabIndex={0}
                    aria-label={`Detalhar enlace ${l.name}`}
                    style={{ cursor: 'pointer' }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => onSelect({ kind: 'link', id: l.id })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelect({ kind: 'link', id: l.id });
                      }
                    }}
                  >
                    <rect
                      x={-46}
                      y={-18}
                      width={92}
                      height={38}
                      rx={5}
                      fill={theme.colors.background.primary}
                      stroke={theme.colors.border.weak}
                    />
                    <text
                      textAnchor="middle"
                      y={-2}
                      fill={l.physical === 'down' ? theme.colors.error.text : theme.colors.text.primary}
                      fontSize={theme.typography.bodySmall.fontSize}
                      fontWeight={600}
                    >
                      {l.physical === 'down'
                        ? 'DOWN'
                        : rate(Math.max(l.values.rx ?? 0, l.values.tx ?? 0) || (l.values.rx === 0 ? 0 : NaN))}
                    </text>
                    <text
                      textAnchor="middle"
                      y={13}
                      fill={theme.colors.text.secondary}
                      fontSize={theme.typography.bodySmall.fontSize}
                    >
                      {l.utilization?.toFixed(0) ?? '—'}% · {l.values.latency?.toFixed(0) ?? '—'} ms
                    </text>
                  </g>
                )}
                {editing &&
                  selected?.id === l.id &&
                  bends.map((p, i) => (
                    <circle
                      key={i}
                      cx={p.x}
                      cy={p.y}
                      r={7}
                      fill={theme.colors.info.text}
                      stroke={theme.colors.background.canvas}
                      strokeWidth={2}
                      onDoubleClick={() =>
                        onBend(
                          l.id,
                          bends.filter((_, j) => i !== j)
                        )
                      }
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        svg.current?.setPointerCapture(e.pointerId);
                        setDrag({ kind: 'bend', id: l.id, index: i, start: local(e), origin: p });
                      }}
                      style={{ cursor: 'move' }}
                    >
                      <title>Arraste para ajustar; duplo clique remove o desvio</title>
                    </circle>
                  ))}
              </g>
            );
          })}
          {(mode === 'ospf' || mode === 'all') &&
            snapshot.ospfNeighbors.map((n) => {
              const a = point(n.localNode),
                b = point(n.targetNode ?? '');
              if (!a || !b) {
                return null;
              }
              return (
                <g key={n.id}>
                  <path
                    d={path(a, b, [], 30)}
                    fill="none"
                    stroke={color(theme, n.health)}
                    strokeWidth={2}
                    strokeDasharray="5 5"
                  />
                  <path
                    d={path(a, b, [], 30)}
                    fill="none"
                    stroke="transparent"
                    strokeWidth={16}
                    role="button"
                    tabIndex={0}
                    aria-label={`OSPF ${n.id} ${n.state}`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => onSelect({ kind: 'ospf', id: n.id })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        onSelect({ kind: 'ospf', id: n.id });
                      }
                    }}
                  >
                    <title>{`${n.interface} · área ${n.area} · ${n.state}`}</title>
                  </path>
                  {(view.scale > 0.6 || selected?.id === n.id) && (
                    <text
                      x={(a.x + b.x) / 2}
                      y={(a.y + b.y) / 2 + 20}
                      textAnchor="middle"
                      fill={color(theme, n.health)}
                      fontSize={theme.typography.bodySmall.fontSize}
                      pointerEvents="none"
                    >
                      {n.localNode} → {n.targetNode} · cost {n.cost ?? '—'} · {n.state}
                    </text>
                  )}
                </g>
              );
            })}
          {(mode === 'mpls' || mode === 'all') &&
            !highlight &&
            snapshot.mplsTunnels
              .filter((t) => selected?.kind === 'tunnel' && selected.id === t.id)
              .map((t) => {
                const a = point(t.source),
                  b = point(t.destination);
                if (!a || !b) {
                  return null;
                }
                return (
                  <path
                    key={t.id}
                    d={path(a, b, [], 80)}
                    fill="none"
                    stroke={color(theme, t.health)}
                    strokeWidth={3}
                    strokeDasharray="12 5"
                    role="button"
                    tabIndex={0}
                    aria-label={`Túnel ${t.name}`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => onSelect({ kind: 'tunnel', id: t.id })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        onSelect({ kind: 'tunnel', id: t.id });
                      }
                    }}
                  >
                    <title>{`${t.name} · relação lógica origem/destino; selecione para verificar saltos`}</title>
                  </path>
                );
              })}
          {serviceFlows.map((flow) =>
            flow.record.path?.segments.map((segment, index) => {
              const a = point(segment.source),
                b = point(segment.target);
              if (!a || !b) {
                return null;
              }
              const c = flow.record.path?.actual
                ? flow.direction === 'forward'
                  ? theme.colors.info.text
                  : theme.colors.warning.text
                : theme.colors.text.secondary;
              // The normal reverses with the endpoints: equal offsets separate ida and volta.
              const offset = 25;
              const dx = b.x - a.x,
                dy = b.y - a.y,
                len = Math.max(1, Math.hypot(dx, dy)),
                nx = -dy / len,
                ny = dx / len;
              const center = { x: a.x + dx * 0.62 + (nx * offset) / 2, y: a.y + dy * 0.62 + (ny * offset) / 2 };
              return (
                <g key={`${flow.id}:${index}`} pointerEvents="none">
                  <path
                    d={path(a, b, [], offset)}
                    fill="none"
                    stroke={c}
                    strokeWidth={4}
                    strokeDasharray={!segment.linkId ? '6 6' : undefined}
                  />
                  {flow.record.path?.actual && segment.linkId && (
                    <path
                      d={path(a, b, [], offset)}
                      fill="none"
                      stroke={theme.colors.text.primary}
                      strokeWidth={1}
                      className="flow"
                      opacity={0.6}
                    />
                  )}
                  <path
                    d={`M ${center.x} ${center.y} L ${center.x - (dx / len) * 12 + nx * 6} ${center.y - (dy / len) * 12 + ny * 6} L ${center.x - (dx / len) * 12 - nx * 6} ${center.y - (dy / len) * 12 - ny * 6} Z`}
                    fill={c}
                  />
                  <text
                    x={(a.x + b.x) / 2 + nx * offset}
                    y={(a.y + b.y) / 2 + ny * offset + 4}
                    textAnchor={Math.abs(nx) > 0.6 ? (nx > 0 ? 'start' : 'end') : 'middle'}
                    fill={c}
                    fontSize={theme.typography.bodySmall.fontSize}
                  >
                    {flow.direction === 'forward' ? 'A → B' : 'B → A'} · cost {segment.ospfCost ?? '—'}
                  </text>
                </g>
              );
            })
          )}
          {snapshot.nodes.map((node, i) => {
            const nbs = snapshot.ospfNeighbors.filter((n) => n.localNode === node.id),
              tunnels = snapshot.mplsTunnels.filter((t) => t.source === node.id || t.destination === node.id);
            const ospf =
              !nbs.length || nbs.some((n) => n.health === 'unknown')
                ? '—'
                : nbs.every((n) => n.state === 'Full')
                  ? 'FULL'
                  : nbs.some((n) => n.state === 'Down')
                    ? 'DOWN'
                    : 'ATENÇÃO';
            const mpls =
              !tunnels.length || tunnels.some((t) => t.health === 'unknown')
                ? '—'
                : tunnels.some((t) => t.health === 'down')
                  ? 'DOWN'
                  : 'UP';
            return (
              <g key={node.id} opacity={highlight && !pathNodes.includes(node.id) ? 0.4 : 1}>
                <NodeCard
                  node={node}
                  point={point(node.id) ?? defaultPoint(i)}
                  selected={selected?.id === node.id || connectSource === node.id}
                  editing={editing && !connectSource}
                  ospf={ospf}
                  mpls={mpls}
                  onSelect={() => {
                    if (moved.current) {
                      moved.current = false;
                      return;
                    }
                    if (connectSource) {
                      onConnect(node.id);
                    } else {
                      onSelect({ kind: 'node', id: node.id });
                    }
                  }}
                  onDoubleClick={() => onExpand(node.id)}
                  onDrag={(e) => {
                    e.stopPropagation();
                    onSelect({ kind: 'node', id: node.id });
                    moved.current = false;
                    svg.current?.setPointerCapture(e.pointerId);
                    setDrag({ kind: 'node', id: node.id, start: local(e), origin: point(node.id) ?? defaultPoint(i) });
                  }}
                />
                {pathNodes.includes(node.id) && !serviceFlows.length && !(pathLinks.length && backupLinks.length) && (
                  <g transform={`translate(${point(node.id)!.x + 100},${point(node.id)!.y + 44})`}>
                    <circle r={12} fill={theme.colors.info.main} />
                    <text
                      textAnchor="middle"
                      y={4}
                      fill={theme.colors.info.contrastText}
                      fontSize={theme.typography.bodySmall.fontSize}
                    >
                      {pathNodes.indexOf(node.id) + 1}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      <div className={styles.canvasTools}>
        <button
          onClick={() => setView((v) => ({ ...v, scale: Math.min(3, v.scale * 1.2) }))}
          aria-label="Aumentar zoom"
        >
          ＋
        </button>
        <button
          onClick={() => setView((v) => ({ ...v, scale: Math.max(0.08, v.scale / 1.2) }))}
          aria-label="Diminuir zoom"
        >
          −
        </button>
        <button onClick={fit}>Centralizar</button>
        <button onClick={() => onViewport(view)}>Salvar visão</button>
        <small style={{ padding: theme.spacing(0.75) }}>{Math.round(view.scale * 100)}%</small>
      </div>
    </div>
  );
}
