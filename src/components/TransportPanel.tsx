import React from 'react';
import { dateTimeFormat, PanelProps } from '@grafana/data';
import { useStyles2, useTheme2 } from '@grafana/ui';
import { GrafanaTopologyDataProvider } from '../provider';
import { demoData } from '../demo';
import { parseInventory } from '../inventory';
import { mergeOptions } from '../optionMerge';
import { EMPTY_INVENTORY, PanelOptions, TopologyInventory, ViewMode } from '../types';
import { getStyles, color } from '../styles';
import { healthLabel, positions } from '../transportModel';
import { Selection, TopologyCanvas } from './TopologyCanvas';
import { TransportInspector, PathMode, evidenceLabel } from './TransportInspector';
import { TransportEditor } from './TransportEditor';
import { ServiceDirection, ServiceInspector, confidenceLabel } from './ServiceInspector';

const modes: Array<[ViewMode, string]> = [
  ['physical', 'Físico'],
  ['ospf', 'Custos OSPF'],
  ['mpls', 'VSIs'],
  ['all', 'Tudo'],
];
export function TransportPanel(props: PanelProps<PanelOptions>) {
  const { options, data, timeRange, timeZone, onOptionsChange } = props;
  const theme = useTheme2(),
    styles = useStyles2(getStyles),
    root = React.useRef<HTMLDivElement>(null);
  const now = timeRange.to.valueOf(),
    from = timeRange.from.valueOf();
  const fixture = React.useMemo(() => (options.demo ? demoData(now) : undefined), [options.demo, now]);
  const effectiveInventory = options.inventory?.nodes.length
    ? options.inventory
    : (fixture?.inventory ?? EMPTY_INVENTORY);
  const frames = fixture?.frames ?? data.series;
  const [mode, setMode] = React.useState<ViewMode>(options.mode ?? 'physical');
  const [selected, setSelected] = React.useState<Selection>();
  const [sidebar, setSidebar] = React.useState(options.sidebar !== false);
  const [tab, setTab] = React.useState<'operation' | 'services' | 'ospf' | 'events'>('services');
  const [filters, setFilters] = React.useState(options.filters ?? { query: '', site: '', group: '', status: '' });
  const [pathMode, setPathMode] = React.useState<PathMode>('primary');
  const [serviceDirection, setServiceDirection] = React.useState<ServiceDirection>('both');
  const [expanded, setExpanded] = React.useState(false);
  const [draft, setDraft] = React.useState<TopologyInventory>();
  const [history, setHistory] = React.useState<TopologyInventory[]>([]);
  const [connectSource, setConnectSource] = React.useState<string>();
  const [message, setMessage] = React.useState('');
  const [limit, setLimit] = React.useState(30);
  React.useEffect(() => setMode(options.mode ?? 'physical'), [options.mode]);
  React.useEffect(() => setSidebar(options.sidebar !== false), [options.sidebar]);
  React.useEffect(
    () => setFilters(options.filters ?? { query: '', site: '', group: '', status: '' }),
    [options.filters]
  );
  const editBase = React.useRef<PanelOptions>();
  const snapshot = React.useMemo(
    () =>
      new GrafanaTopologyDataProvider(theme, timeZone).getSnapshot(frames, draft ?? effectiveInventory, options, now),
    [frames, draft, effectiveInventory, options, now, theme, timeZone]
  );
  const selectedTunnel =
    selected?.kind === 'tunnel' ? snapshot.mplsTunnels.find((t) => t.id === selected.id) : undefined;
  const primary =
    selectedTunnel && pathMode !== 'backup' && selectedTunnel.primary.complete ? selectedTunnel.primary : undefined;
  const backup =
    selectedTunnel && pathMode !== 'primary' && selectedTunnel.backup.complete ? selectedTunnel.backup : undefined;
  const selectedService =
    selected?.kind === 'service' ? snapshot.services.find((s) => s.id === selected.id) : undefined;
  const serviceFlows = selectedService
    ? [
        ...(serviceDirection !== 'reverse'
          ? selectedService.forward.map((record, i) => ({ id: `forward:${i}`, direction: 'forward' as const, record }))
          : []),
        ...(serviceDirection !== 'forward'
          ? selectedService.reverse.map((record, i) => ({ id: `reverse:${i}`, direction: 'reverse' as const, record }))
          : []),
      ].filter((p) => p.record.path)
    : [];
  const pathNodes = [
    ...new Set([
      ...(primary?.nodes ?? []),
      ...(backup?.nodes ?? []),
      ...serviceFlows.flatMap((f) => f.record.path?.hops.flatMap((h) => (h.nodeId ? [h.nodeId] : [])) ?? []),
    ]),
  ];
  const select = (selection: Selection) => {
    setSelected(selection);
    setExpanded(false);
    if (selection) {
      setSidebar(true);
    }
  };
  const query = filters.query.toLowerCase();
  const visibleNodes = snapshot.nodes.filter(
    (n) =>
      pathNodes.includes(n.id) ||
      ((!filters.site || n.site === filters.site) &&
        (!filters.group || n.group === filters.group) &&
        (!filters.status || n.health === filters.status) &&
        (!query ||
          [
            n.hostname,
            n.site,
            n.ip,
            n.routerId,
            n.region,
            ...snapshot.links
              .filter((l) => l.source === n.id || l.target === n.id)
              .flatMap((l) => [l.name, l.sourceInterface, l.targetInterface]),
            ...snapshot.mplsTunnels.filter((t) => t.source === n.id || t.destination === n.id).map((t) => t.name),
            ...snapshot.ospfNeighbors
              .filter((o) => o.localNode === n.id || o.targetNode === n.id)
              .flatMap((o) => [o.interface, o.localIp, o.neighborIp, o.subnet]),
          ].some((s) => s?.toLowerCase().includes(query))))
  );
  const visibleIds = new Set(visibleNodes.map((n) => n.id));
  const filtered = {
    ...snapshot,
    nodes: visibleNodes,
    links: snapshot.links.filter((l) => visibleIds.has(l.source) && visibleIds.has(l.target)),
    ospfNeighbors: snapshot.ospfNeighbors.filter((n) => visibleIds.has(n.localNode)),
    mplsTunnels: snapshot.mplsTunnels.filter((t) => visibleIds.has(t.source) && visibleIds.has(t.destination)),
  };
  const changeDraft = (value: TopologyInventory) => {
    if (draft) {
      setHistory((h) => [...h.slice(-39), draft]);
    }
    setDraft(value);
    setMessage('');
  };
  const startEditing = () => {
    editBase.current = options;
    setDraft({
      ...effectiveInventory,
      nodes: snapshot.nodes.map((n) => ({
        id: n.id,
        popId: n.popId,
        hostname: n.hostname,
        site: n.site,
        routerId: n.routerId,
        ip: n.ip,
        model: n.model,
        vendor: n.vendor,
        region: n.region,
        group: n.group,
        icon: n.icon,
        position: n.position,
        bindings: n.bindings,
        overrideFields: n.overrideFields,
      })),
      links: snapshot.links.map((l) => ({
        id: l.id,
        sourceOspf: l.sourceOspf,
        targetOspf: l.targetOspf,
        name: l.name,
        source: l.source,
        target: l.target,
        sourceInterface: l.sourceInterface,
        targetInterface: l.targetInterface,
        capacityBps: l.capacityBps,
        bindings: l.bindings,
        points: l.points,
        overrideFields: l.overrideFields,
      })),
    });
    setHistory([]);
    setSidebar(true);
    setMessage('');
  };
  const apply = () => {
    if (!draft || !editBase.current) {
      return;
    }
    try {
      const inventory = parseInventory(JSON.stringify(draft));
      const merged = mergeOptions(editBase.current, { ...editBase.current, inventory }, options);
      if (merged.conflicts.length) {
        setMessage(
          `Há alterações concorrentes em ${merged.conflicts.join(', ')}. Cancele e reabra a edição para revisar.`
        );
        return;
      }
      onOptionsChange(merged.value);
      setDraft(undefined);
      setConnectSource(undefined);
      setHistory([]);
      setMessage('Alterações aplicadas. Salve o dashboard no Grafana para persistir.');
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  const id = () =>
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const connect = (target: string) => {
    if (!draft || !connectSource || target === connectSource) {
      return;
    }
    const newId = id();
    changeDraft({
      ...draft,
      links: [
        ...draft.links,
        {
          id: newId,
          name: `${connectSource} ↔ ${target}`,
          source: connectSource,
          target,
          sourceInterface: 'Configurar interface A',
          targetInterface: 'Configurar interface B',
        },
      ],
    });
    setConnectSource(undefined);
    select({ kind: 'link', id: newId });
  };
  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await root.current?.requestFullscreen();
      }
    } catch {
      setMessage('Este navegador não permitiu tela cheia. Use o modo de visualização do painel do Grafana.');
    }
  };
  const healthLinks = snapshot.links.filter((l) => l.health === 'ok').length;
  const troubledLinks = snapshot.links.filter((l) => ['warning', 'degraded', 'critical'].includes(l.health)).length;
  const downLinks = snapshot.links.filter((l) => l.health === 'down').length;
  const unknownLinks = snapshot.links.filter((l) => l.health === 'unknown').length;
  const stats = [
    ['Equipamentos', snapshot.nodes.length, 'unknown'],
    ['Enlaces normais', healthLinks, 'ok'],
    ['Sob atenção', troubledLinks, 'degraded'],
    ['Indisponíveis', downLinks, 'down'],
    [
      'Custos coletados',
      `${snapshot.ospfNeighbors.filter((n) => n.cost !== undefined).length}/${snapshot.ospfNeighbors.length}`,
      'unknown',
    ],
    [
      'VSIs com ida e volta',
      snapshot.services.filter((s) => s.forward.some((p) => p.path?.actual) && s.reverse.some((p) => p.path?.actual))
        .length,
      'unknown',
    ],
    ['VSIs descobertas', snapshot.services.length, 'unknown'],
  ] as const;
  const summary = (
    <section className={styles.section}>
      <div className={styles.row}>
        <h3>Diagnóstico do transporte</h3>
        <span className={styles.badge}>{snapshot.incidents.length}</span>
      </div>
      {snapshot.incidents.length ? (
        snapshot.incidents.slice(0, limit).map((incident) => (
          <button
            className={styles.item}
            key={incident.id}
            onClick={() =>
              select(
                incident.linkId
                  ? { kind: 'link', id: incident.linkId }
                  : incident.tunnelIds.length
                    ? { kind: 'tunnel', id: incident.tunnelIds[0] }
                    : { kind: 'ospf', id: incident.neighborIds[0] }
              )
            }
          >
            <div className={styles.row}>
              <strong style={{ color: color(theme, incident.health) }}>{incident.title}</strong>
              <small>{healthLabel[incident.health]}</small>
            </div>
            <small>{incident.description}</small>
            <span>
              {incident.tunnelIds.length} túneis · {incident.neighborIds.length} vizinhanças
            </span>
          </button>
        ))
      ) : (
        <p>
          {!snapshot.links.length
            ? 'Cadastre a rede para iniciar.'
            : unknownLinks
              ? 'Há enlaces sem dados. Normalidade da rede não confirmada.'
              : 'Nenhum incidente detectado nos dados disponíveis.'}
        </p>
      )}
      {unknownLinks > 0 && (
        <p className={styles.warning}>{unknownLinks} enlace(s) sem status válido ou com coleta antiga.</p>
      )}
    </section>
  );
  return (
    <div
      ref={root}
      className={`${styles.root} ${props.height < 500 ? styles.compact : ''}`}
      style={{ width: props.width, height: props.height }}
    >
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.badge} style={{ color: theme.colors.info.text }}>
            ◈
          </span>
          <div>
            <strong>j-topologia</strong>
            <small style={{ display: 'block' }}>SERVIÇOS / CAMINHOS / TRANSPORTE</small>
          </div>
        </div>
        <div className={styles.segment} role="group" aria-label="Camada de transporte">
          {modes.map(([value, label]) => (
            <button
              key={value}
              aria-pressed={mode === value}
              onClick={() => {
                setMode(value);
                if (value === 'ospf') {
                  setTab('ospf');
                  setSidebar(true);
                }
                if (value === 'mpls') {
                  setTab('services');
                  setSidebar(true);
                }
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <button onClick={() => setSidebar((s) => !s)} aria-expanded={sidebar}>
          Inspeção {sidebar ? '›' : '‹'}
        </button>
        <button onClick={fullscreen}>Tela cheia</button>
        {!draft ? (
          <button onClick={startEditing}>Editar topologia</button>
        ) : (
          <>
            <button onClick={apply}>Aplicar alterações</button>
            <button
              onClick={() => {
                setDraft(undefined);
                setConnectSource(undefined);
                setMessage('');
              }}
            >
              Cancelar
            </button>
          </>
        )}
      </header>
      {options.demo && (
        <div className={styles.notice}>
          LABORATÓRIO · Dados demonstrativos, sem conexão com sua rede. Desative “Demonstração” nas opções para usar as
          consultas reais.
        </div>
      )}
      <div className={styles.stats} data-region="summary">
        {stats.map(([label, value, health]) => (
          <div key={label} className={styles.stat}>
            <small>{label}</small>
            <strong style={{ color: color(theme, health) }}>{value}</strong>
          </div>
        ))}
      </div>
      <div className={styles.toolbar} data-region="filters">
        <input
          aria-label="Pesquisar rede"
          placeholder="Pesquisar POP, equipamento, Router ID, interface ou túnel…"
          value={filters.query}
          onChange={(e) => setFilters({ ...filters, query: e.target.value })}
        />
        <select
          aria-label="Filtrar POP"
          value={filters.site}
          onChange={(e) => setFilters({ ...filters, site: e.target.value })}
        >
          <option value="">Todos os POPs</option>
          {[...new Set(snapshot.nodes.map((n) => n.site))].sort().map((site) => (
            <option key={site}>{site}</option>
          ))}
        </select>
        <select
          aria-label="Filtrar grupo"
          value={filters.group}
          onChange={(e) => setFilters({ ...filters, group: e.target.value })}
        >
          <option value="">Todos os grupos</option>
          {[...new Set(snapshot.nodes.map((n) => n.group).filter(Boolean))].map((group) => (
            <option key={group}>{group}</option>
          ))}
        </select>
        <select
          aria-label="Filtrar status"
          value={filters.status}
          onChange={(e) => setFilters({ ...filters, status: e.target.value })}
        >
          <option value="">Todos os estados</option>
          {Object.entries(healthLabel).map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        {(filters.query || filters.site || filters.group || filters.status) && (
          <button onClick={() => setFilters({ query: '', site: '', group: '', status: '' })}>Limpar filtros</button>
        )}
        {draft && (
          <>
            <button
              onClick={() => {
                const newId = id();
                changeDraft({
                  ...draft,
                  nodes: [
                    ...draft.nodes,
                    {
                      id: newId,
                      hostname: 'Novo equipamento',
                      site: 'Novo POP',
                      icon: 'router',
                      position: { x: 650, y: 380 },
                    },
                  ],
                });
                select({ kind: 'node', id: newId });
              }}
            >
              ＋ Equipamento
            </button>
            <select
              aria-label="Organizar layout"
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) {
                  changeDraft({
                    ...draft,
                    nodes: positions(draft.nodes, e.target.value as 'ring' | 'grid' | 'star' | 'tree'),
                  });
                  e.target.value = '';
                }
              }}
            >
              <option value="">Organizar…</option>
              <option value="ring">Anel</option>
              <option value="star">Estrela</option>
              <option value="tree">Árvore</option>
              <option value="grid">Grade</option>
            </select>
            <button
              disabled={!history.length}
              onClick={() => {
                setDraft(history.at(-1));
                setHistory((h) => h.slice(0, -1));
              }}
            >
              Desfazer
            </button>
            {connectSource && <button onClick={() => setConnectSource(undefined)}>Cancelar conexão</button>}
          </>
        )}
      </div>
      {message && (
        <div role="status" className={styles.notice}>
          {message}
        </div>
      )}
      {selectedTunnel && (
        <div className={styles.notice}>
          {selectedTunnel.name} ·{' '}
          {pathMode === 'backup' ? evidenceLabel(selectedTunnel.backup) : evidenceLabel(selectedTunnel.primary)} ·
          Traçado destacado não representa volume de tráfego.
        </div>
      )}
      <main className={styles.body}>
        {!snapshot.nodes.length ? (
          <div className={styles.empty} style={{ flex: 1 }}>
            <h2>Seu transporte, enlace por enlace.</h2>
            <p>
              Conecte as consultas do NetworkCollector para descobrir equipamentos, VSIs, PWs e caminhos
              automaticamente. O cadastro manual é um override opcional.
            </p>
            <div className={styles.segment}>
              <button onClick={startEditing}>Override manual</button>
              <button onClick={() => onOptionsChange({ ...options, demo: true })}>Explorar demonstração</button>
            </div>
            <small>
              O collector precisa de acessos de leitura configurados no servidor. Nenhuma credencial é enviada ao
              navegador.
            </small>
          </div>
        ) : (
          <TopologyCanvas
            snapshot={filtered}
            mode={mode}
            selected={selected}
            pathLinks={primary?.linkIds ?? []}
            backupLinks={backup?.linkIds ?? []}
            pathNodes={pathNodes}
            serviceFlows={serviceFlows}
            editing={Boolean(draft)}
            routeStyle={options.routeStyle ?? 'curve'}
            viewport={options.viewport}
            onViewport={(viewport) => {
              onOptionsChange({ ...options, viewport, filters, mode, sidebar });
              setMessage('Visão e filtros aplicados. Salve o dashboard no Grafana.');
            }}
            onSelect={select}
            onMove={(nodeId, p) =>
              draft &&
              changeDraft({ ...draft, nodes: draft.nodes.map((n) => (n.id === nodeId ? { ...n, position: p } : n)) })
            }
            onBend={(linkId, points) =>
              draft &&
              changeDraft({ ...draft, links: draft.links.map((l) => (l.id === linkId ? { ...l, points } : l)) })
            }
            connectSource={connectSource}
            onConnect={connect}
            onExpand={(nodeId) => {
              setSelected({ kind: 'node', id: nodeId });
              setExpanded(true);
              setSidebar(true);
            }}
          />
        )}
        {sidebar && (
          <aside
            className={styles.sidebar}
            style={expanded ? { width: '42%' } : undefined}
            aria-label="Inspeção do transporte"
          >
            {draft && (
              <TransportEditor
                data={frames}
                inventory={draft}
                selected={selected}
                onChange={changeDraft}
                onConnect={(nodeId) => setConnectSource(nodeId)}
              />
            )}
            {!draft && selectedService && (
              <ServiceInspector
                service={selectedService}
                snapshot={snapshot}
                direction={serviceDirection}
                onDirection={setServiceDirection}
                onSelect={select}
                now={now}
                timeZone={timeZone}
              />
            )}
            {!draft && (
              <TransportInspector
                snapshot={snapshot}
                selected={selected}
                onSelect={select}
                now={now}
                from={from}
                timeZone={timeZone}
                pathMode={pathMode}
                onPathMode={setPathMode}
                options={options}
                expanded={expanded}
                onPeriod={(ms) => props.onChangeTimeRange({ from: now - ms, to: now })}
              />
            )}
            <section className={styles.section}>
              <div className={styles.segment} role="tablist" aria-label="Diagnóstico">
                <button
                  role="tab"
                  aria-selected={tab === 'services'}
                  aria-pressed={tab === 'services'}
                  onClick={() => setTab('services')}
                >
                  VSIs
                </button>
                <button
                  role="tab"
                  aria-selected={tab === 'operation'}
                  aria-pressed={tab === 'operation'}
                  onClick={() => setTab('operation')}
                >
                  Operação
                </button>
                <button
                  role="tab"
                  aria-selected={tab === 'ospf'}
                  aria-pressed={tab === 'ospf'}
                  onClick={() => {
                    setTab('ospf');
                    setMode('ospf');
                    select(undefined);
                  }}
                >
                  Custos OSPF
                </button>
                <button
                  role="tab"
                  aria-selected={tab === 'events'}
                  aria-pressed={tab === 'events'}
                  onClick={() => setTab('events')}
                >
                  Eventos
                </button>
              </div>
            </section>
            {tab === 'services' && (
              <section className={styles.section}>
                <h3>Por onde sua VSI passa?</h3>
                <small>Descoberta automática · VSI → PW → tunnel policy → túnel → saltos</small>
                {!snapshot.services.length && (
                  <p className={styles.warning}>
                    Nenhuma VSI descoberta. Configure o collector e a consulta jtopology_service_paths; não é necessário
                    cadastrar cada serviço.
                  </p>
                )}
                {snapshot.services
                  .filter(
                    (service) =>
                      !query ||
                      [service.vsi.name, service.vsi.localNode, service.vsi.vsiId, service.vsi.tunnelPolicy].some((v) =>
                        v?.toLowerCase().includes(query)
                      )
                  )
                  .slice(0, limit)
                  .map((service) => (
                    <button
                      key={service.id}
                      className={styles.item}
                      aria-pressed={selected?.id === service.id}
                      onClick={() => {
                        select({ kind: 'service', id: service.id });
                        setMode('mpls');
                      }}
                    >
                      <div className={styles.row}>
                        <strong>{service.vsi.name}</strong>
                        <span className={styles.badge}>{service.vsi.status ?? '—'}</span>
                      </div>
                      <small>
                        {service.vsi.localNode} · {confidenceLabel(service.discoveryConfidence)}
                      </small>
                      <small>
                        {service.forward.length} path(s) de ida · {service.reverse.length} de volta
                        {service.asymmetric === true ? ' · ASSIMÉTRICO' : ''}
                      </small>
                    </button>
                  ))}
              </section>
            )}
            {tab === 'operation' && summary}
            {tab === 'ospf' && (
              <section className={styles.section}>
                <h3>Custo por saída / VLANIF</h3>
                <small>Cada sentido tem seu próprio custo. A linha pontilhada representa o P2P lógico.</small>
                {!snapshot.ospfNeighbors.length && (
                  <p className={styles.warning}>
                    Sem coleta OSPF. Prepare a consulta conforme o contrato de dados do plugin.
                  </p>
                )}
                {snapshot.ospfNeighbors
                  .filter(
                    (n) =>
                      !query ||
                      [n.localNode, n.neighborRouterId, n.interface, n.area, n.localIp, n.neighborIp, n.subnet].some(
                        (s) => s?.toLowerCase().includes(query)
                      )
                  )
                  .slice(0, limit)
                  .map((n) => (
                    <button className={styles.item} key={n.id} onClick={() => select({ kind: 'ospf', id: n.id })}>
                      <div className={styles.row}>
                        <strong>
                          {n.localNode} → {n.targetNode ?? n.neighborRouterId}
                        </strong>
                        <span className={styles.badge}>Custo {n.cost ?? '—'}</span>
                      </div>
                      <small>
                        {n.interface} · {n.localIp ?? '—'} → {n.neighborIp ?? '—'}
                      </small>
                      <small>
                        {n.subnet ?? 'Prefixo não coletado'} · área {n.area}
                      </small>
                    </button>
                  ))}
              </section>
            )}
            {tab === 'events' && (
              <section className={styles.section}>
                <h3>Eventos no período consultado</h3>
                {!snapshot.events.length && (
                  <small>
                    Nenhuma transição observada nas amostras recebidas. Eventos anteriores à consulta não são
                    inventados.
                  </small>
                )}
                {snapshot.events
                  .filter((e) => e.time >= from)
                  .slice(0, limit)
                  .map((e) => (
                    <button
                      className={styles.item}
                      key={e.id}
                      onClick={() =>
                        select({
                          kind: e.kind === 'physical' ? 'link' : e.kind === 'mpls' ? 'tunnel' : 'ospf',
                          id: e.entityId,
                        })
                      }
                    >
                      <small>
                        {dateTimeFormat(e.time, { format: 'DD/MM HH:mm:ss', timeZone })} ·{' '}
                        {e.severity === 'restored' ? 'RESTAURADO' : e.severity === 'critical' ? 'CRÍTICO' : 'ATENÇÃO'}
                      </small>
                      <strong>{e.message}</strong>
                    </button>
                  ))}
              </section>
            )}
            {Math.max(
              snapshot.services.length,
              snapshot.events.length,
              snapshot.mplsTunnels.length,
              snapshot.ospfNeighbors.length,
              snapshot.incidents.length
            ) > limit && (
              <section className={styles.section}>
                <button onClick={() => setLimit((l) => l + 30)}>Mostrar mais 30</button>
              </section>
            )}
            {snapshot.collectors.length > 0 && (
              <section className={styles.section}>
                <h4>Coleta e discovery</h4>
                {snapshot.collectors.map((c) => (
                  <div key={c.id}>
                    <strong>
                      {c.deviceId} · {c.protocol.toUpperCase()} · {c.status}
                    </strong>
                    <small style={{ display: 'block' }}>
                      Módulos: {c.modules.join(', ') || 'não confirmados'} · {c.warningCount ?? 0} aviso(s)
                    </small>
                  </div>
                ))}
              </section>
            )}
            {snapshot.warnings.length > 0 && (
              <section className={styles.section}>
                <h4>Qualidade dos dados</h4>
                {snapshot.warnings.map((warning, i) => (
                  <p className={styles.warning} key={i}>
                    {warning}
                  </p>
                ))}
              </section>
            )}
          </aside>
        )}
      </main>
      <footer className={styles.footer}>
        <span>
          {visibleNodes.length}/{snapshot.nodes.length} equipamentos · {snapshot.links.length} enlaces · {unknownLinks}{' '}
          sem dados
        </span>
        <span>
          {draft ? 'EDIÇÃO · rascunho local' : options.demo ? 'DEMONSTRAÇÃO' : 'CONSULTAS DO GRAFANA'} ·{' '}
          {dateTimeFormat(now, { format: 'DD/MM HH:mm:ss', timeZone })}
        </span>
      </footer>
    </div>
  );
}
