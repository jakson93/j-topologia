import React from 'react';
import { useStyles2 } from '@grafana/ui';
import { NetworkNode, NetworkLink, TopologyInventory } from '../types';
import { getStyles } from '../styles';
import { Selection } from './TopologyCanvas';
import { DataFrame } from '@grafana/data';
import { MetricSelect } from './MetricSelect';
import { LINK_METRICS } from './NetworkForms';

export function TransportEditor({
  inventory,
  selected,
  onChange,
  onConnect,
  data,
}: {
  inventory: TopologyInventory;
  selected: Selection;
  onChange: (v: TopologyInventory) => void;
  onConnect: (id: string) => void;
  data?: DataFrame[];
}) {
  const styles = useStyles2(getStyles);
  const node = selected?.kind === 'node' ? inventory.nodes.find((n) => n.id === selected.id) : undefined;
  const link = selected?.kind === 'link' ? inventory.links.find((l) => l.id === selected.id) : undefined;
  const changeNode = (changes: Partial<NetworkNode>) =>
    onChange({
      ...inventory,
      nodes: inventory.nodes.map((n) =>
        n.id === node?.id
          ? { ...n, ...changes, overrideFields: [...new Set([...(n.overrideFields ?? []), ...Object.keys(changes)])] }
          : n
      ),
    });
  const changeLink = (changes: Partial<NetworkLink>) =>
    onChange({
      ...inventory,
      links: inventory.links.map((l) =>
        l.id === link?.id
          ? { ...l, ...changes, overrideFields: [...new Set([...(l.overrideFields ?? []), ...Object.keys(changes)])] }
          : l
      ),
    });
  const field = (label: string, value: string | undefined, update: (s: string) => void) => (
    <label key={label}>
      {label}
      <input value={value ?? ''} onChange={(e) => update(e.target.value)} />
    </label>
  );
  return (
    <section className={styles.section}>
      <h3>Editar cadastro</h3>
      <small>Alterações ficam em rascunho até aplicar. Depois, salve o dashboard no Grafana.</small>
      <div className={styles.editor}>
        {node ? (
          <>
            {field('Hostname', node.hostname, (hostname) => changeNode({ hostname }))}
            {field('POP / localidade', node.site, (site) =>
              changeNode({ site, popId: inventory.pops?.find((p) => p.name === site)?.id })
            )}
            {field('Router ID', node.routerId, (routerId) => changeNode({ routerId }))}
            {field('IP de gerenciamento', node.ip, (ip) => changeNode({ ip }))}
            {field('Modelo', node.model, (model) => changeNode({ model }))}
            {field('Grupo', node.group, (group) => changeNode({ group }))}
            {field('Região', node.region, (region) => changeNode({ region }))}
            <label>
              Ícone
              <select
                value={node.icon ?? 'router'}
                onChange={(e) => changeNode({ icon: e.target.value as NetworkNode['icon'] })}
              >
                <option value="router">Roteador</option>
                <option value="switch">Switch</option>
                <option value="datacenter">Datacenter</option>
              </select>
            </label>
            <MetricSelect
              label="Item Zabbix — disponibilidade do equipamento"
              value={node.bindings?.status}
              data={data}
              onChange={(status) => changeNode({ bindings: { ...node.bindings, status } })}
            />
            <MetricSelect
              label="Item Zabbix — uptime"
              value={node.bindings?.uptime}
              data={data}
              onChange={(uptime) => changeNode({ bindings: { ...node.bindings, uptime } })}
            />
            <button onClick={() => onConnect(node.id)}>Conectar a outro equipamento</button>
            <button
              disabled={
                inventory.links.some((l) => l.source === node.id || l.target === node.id) ||
                inventory.ospfNeighbors.some((n) => n.localNode === node.id) ||
                inventory.mplsTunnels.some((t) => t.source === node.id || t.destination === node.id)
              }
              title="Remova primeiro os enlaces, vizinhanças e túneis associados"
              onClick={() => onChange({ ...inventory, nodes: inventory.nodes.filter((n) => n.id !== node.id) })}
            >
              Remover equipamento do rascunho
            </button>
          </>
        ) : link ? (
          <>
            {field('Nome do enlace', link.name, (name) => changeLink({ name }))}
            <small>
              {link.source} → {link.target}
            </small>
            {field('Interface origem', link.sourceInterface, (sourceInterface) => changeLink({ sourceInterface }))}
            {field('Interface destino', link.targetInterface, (targetInterface) => changeLink({ targetInterface }))}
            <label>
              Capacidade (Gbps)
              <input
                type="number"
                min="0.001"
                step="0.1"
                value={link.capacityBps ? link.capacityBps / 1e9 : ''}
                onChange={(e) => changeLink({ capacityBps: e.target.value ? Number(e.target.value) * 1e9 : undefined })}
              />
            </label>
            {LINK_METRICS.map(([key, label, unit]) => (
              <MetricSelect
                key={key}
                label={`Item Zabbix — ${label}`}
                description={unit}
                value={link.bindings?.[key]}
                data={data}
                onChange={(value) => changeLink({ bindings: { ...link.bindings, [key]: value } })}
              />
            ))}
            <small>RX/TX em bps; erros e descartes já convertidos para taxas/s. Potência óptica em dBm.</small>
            <button onClick={() => changeLink({ points: [] })}>Limpar desvios do traçado</button>
            <button onClick={() => onChange({ ...inventory, links: inventory.links.filter((l) => l.id !== link.id) })}>
              Remover enlace do rascunho
            </button>
          </>
        ) : (
          <p>
            Selecione um equipamento ou enlace. Arraste os cards; dê duplo clique em um enlace para adicionar um desvio.
          </p>
        )}
      </div>
    </section>
  );
}
