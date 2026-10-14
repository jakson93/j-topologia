import React from 'react';
import { DataFrame } from '@grafana/data';
import { NetworkNode, NetworkLink, TopologyInventory, NetworkPop } from '../types';
import { MetricSelect } from './MetricSelect';

export function inventoryPops(inventory: TopologyInventory): NetworkPop[] {
  const pops = [...(inventory.pops ?? [])];
  for (const node of inventory.nodes) {
    if (!pops.some((p) => p.id === node.popId || p.name === node.site)) {
      pops.push({ id: `site:${node.site}`, name: node.site, region: node.region });
    }
  }
  return pops;
}
const text = (label: string, value: string | undefined, update: (s: string) => void) => (
  <label>
    {label}
    <input value={value ?? ''} onChange={(e) => update(e.target.value)} />
  </label>
);

export function NodeFields({
  node,
  inventory,
  data,
  onChange,
}: {
  node: NetworkNode;
  inventory: TopologyInventory;
  data?: DataFrame[];
  onChange: (patch: Partial<NetworkNode>) => void;
}) {
  const pops = inventoryPops(inventory);
  return (
    <>
      {text('Hostname / nome do equipamento', node.hostname, (hostname) => onChange({ hostname }))}
      <label>
        POP do equipamento
        <select
          aria-label="POP do equipamento"
          value={node.popId ?? pops.find((p) => p.name === node.site)?.id ?? ''}
          onChange={(e) => {
            const pop = pops.find((p) => p.id === e.target.value);
            if (pop) {
              onChange({ popId: pop.id, site: pop.name, region: pop.region });
            }
          }}
        >
          <option value="">Selecione um POP</option>
          {pops.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {text('Router ID', node.routerId, (routerId) => onChange({ routerId }))}
      {text('IP de gerenciamento', node.ip, (ip) => onChange({ ip }))}
      {text('Modelo', node.model, (model) => onChange({ model }))}
      {text('Grupo', node.group, (group) => onChange({ group }))}
      <label>
        Ícone
        <select
          value={node.icon ?? 'router'}
          onChange={(e) => onChange({ icon: e.target.value as NetworkNode['icon'] })}
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
        onChange={(status) => onChange({ bindings: { ...node.bindings, status } })}
      />
      <MetricSelect
        label="Item Zabbix — uptime"
        description="Valor em segundos."
        value={node.bindings?.uptime}
        data={data}
        onChange={(uptime) => onChange({ bindings: { ...node.bindings, uptime } })}
      />
      {(
        [
          ['cpu', 'CPU', '%'],
          ['memory', 'Memória', '%'],
          ['temperature', 'Temperatura', '°C'],
        ] as const
      ).map(([key, label, unit]) => (
        <MetricSelect
          key={key}
          label={`Item Zabbix — ${label}`}
          description={unit}
          value={node.bindings?.[key]}
          data={data}
          onChange={(value) => onChange({ bindings: { ...node.bindings, [key]: value } })}
        />
      ))}
    </>
  );
}

export const LINK_METRICS = [
  ['status', 'Estado da interface', '1=up, 2=down (IF-MIB); 0=offline também é aceito.'],
  ['rx', 'Tráfego recebido RX', 'bps'],
  ['tx', 'Tráfego transmitido TX', 'bps'],
  ['opticalRx', 'Potência óptica RX', 'dBm'],
  ['opticalTx', 'Potência óptica TX', 'dBm'],
  ['latency', 'Latência', 'ms'],
  ['errors', 'Erros', 'ocorrências/s'],
  ['discards', 'Descartes', 'ocorrências/s'],
] as const;

export function LinkFields({
  link,
  inventory,
  data,
  onChange,
}: {
  link: NetworkLink;
  inventory: TopologyInventory;
  data?: DataFrame[];
  onChange: (patch: Partial<NetworkLink>) => void;
}) {
  return (
    <>
      {text('Nome da rota', link.name, (name) => onChange({ name }))}
      {(['source', 'target'] as const).map((key) => (
        <label key={key}>
          {key === 'source' ? 'Equipamento A / origem' : 'Equipamento B / destino'}
          <select
            aria-label={key === 'source' ? 'Equipamento A / origem' : 'Equipamento B / destino'}
            value={link[key]}
            onChange={(e) => onChange({ [key]: e.target.value })}
          >
            <option value="">Selecione um equipamento</option>
            {inventory.nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.site} · {n.hostname}
              </option>
            ))}
          </select>
        </label>
      ))}
      {text('Interface A / origem', link.sourceInterface, (sourceInterface) => onChange({ sourceInterface }))}
      {text('Interface B / destino', link.targetInterface, (targetInterface) => onChange({ targetInterface }))}
      <label>
        Capacidade (Gbps)
        <input
          type="number"
          min="0.001"
          step="0.1"
          value={link.capacityBps ? link.capacityBps / 1e9 : ''}
          onChange={(e) => onChange({ capacityBps: e.target.value ? Number(e.target.value) * 1e9 : undefined })}
        />
      </label>
      <p>
        Selecione os itens já consultados no Grafana. RX/TX representam a interface escolhida; cadastre outra rota para
        acompanhar outra ligação.
      </p>
      {LINK_METRICS.map(([key, label, unit]) => (
        <MetricSelect
          key={key}
          label={`Item Zabbix — ${label}`}
          description={unit}
          value={link.bindings?.[key]}
          data={data}
          onChange={(value) => onChange({ bindings: { ...link.bindings, [key]: value } })}
        />
      ))}
      {(['sourceOspf', 'targetOspf'] as const).map((key) => {
        const direction = key === 'sourceOspf' ? 'A → B' : 'B → A';
        const ospf = link[key] ?? {};
        const update = (patch: Partial<typeof ospf>) => onChange({ [key]: { ...ospf, ...patch } });
        return (
          <React.Fragment key={key}>
            <h4>Custo OSPF {direction}</h4>
            {text(`VLANIF ${direction}`, ospf.interface, (name) => update({ interface: name }))}
            {text(`IP local ${direction}`, ospf.localIp, (localIp) => update({ localIp }))}
            {text(`Área OSPF ${direction}`, ospf.area, (area) => update({ area }))}
            {text(`Processo OSPF ${direction}`, ospf.process, (process) => update({ process }))}
            <MetricSelect
              label={`Item Zabbix — custo OSPF ${direction}`}
              value={ospf.costItem}
              data={data}
              description="Custo real da saída local. Cada sentido usa seu próprio item."
              onChange={(costItem) => update({ costItem })}
            />
          </React.Fragment>
        );
      })}
    </>
  );
}
