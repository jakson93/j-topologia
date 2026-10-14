import React from 'react';
import { StandardEditorProps } from '@grafana/data';
import { Modal, useStyles2 } from '@grafana/ui';
import { EMPTY_INVENTORY, TopologyInventory, NetworkNode, NetworkLink, NetworkPop } from '../types';
import { importJmap, parseInventory } from '../inventory';
import { mergeOptions } from '../optionMerge';
import { getStyles } from '../styles';
import { NodeFields, LinkFields, inventoryPops } from './NetworkForms';
import { metricChoices } from './MetricSelect';

const id = () =>
  `manual-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
export function InventoryEditor({ value, onChange, context }: StandardEditorProps<TopologyInventory>) {
  const styles = useStyles2(getStyles);
  const saved = value ?? EMPTY_INVENTORY;
  const inventory = { ...saved, pops: inventoryPops(saved) };
  const [tab, setTab] = React.useState<'pops' | 'routes' | 'advanced'>('pops');
  const [text, setText] = React.useState(JSON.stringify(saved, null, 2));
  const [message, setMessage] = React.useState('');
  const [error, setError] = React.useState('');
  const [pop, setPop] = React.useState<NetworkPop>();
  const [node, setNode] = React.useState<NetworkNode>();
  const [link, setLink] = React.useState<NetworkLink>();
  const base = React.useRef(inventory);
  const frames = context?.data;
  const itemCount = React.useMemo(() => metricChoices(frames).length, [frames]);
  React.useEffect(() => setText(JSON.stringify(value ?? EMPTY_INVENTORY, null, 2)), [value]);
  const begin = () => {
    base.current = inventory;
    setError('');
    setMessage('');
  };
  const close = () => {
    setPop(undefined);
    setNode(undefined);
    setLink(undefined);
    setError('');
  };
  const updateNode = (patch: Partial<NetworkNode>) =>
    setNode((n) =>
      n ? { ...n, ...patch, overrideFields: [...new Set([...(n.overrideFields ?? []), ...Object.keys(patch)])] } : n
    );
  const updateLink = (patch: Partial<NetworkLink>) =>
    setLink((l) =>
      l ? { ...l, ...patch, overrideFields: [...new Set([...(l.overrideFields ?? []), ...Object.keys(patch)])] } : l
    );
  const upsert = <T extends { id: string }>(items: T[], draft: T) =>
    items.some((i) => i.id === draft.id) ? items.map((i) => (i.id === draft.id ? draft : i)) : [...items, draft];
  const save = () => {
    try {
      const before = base.current;
      let edited: TopologyInventory = before;
      if (pop) {
        if (!pop.name.trim()) {
          throw new Error('Informe o nome do POP.');
        }
        if (
          before.pops?.some((p) => p.id !== pop.id && p.name.trim().toLowerCase() === pop.name.trim().toLowerCase())
        ) {
          throw new Error('Já existe um POP com esse nome.');
        }
        const previous = before.pops?.find((p) => p.id === pop.id);
        edited = {
          ...before,
          pops: upsert(before.pops ?? [], { ...pop, name: pop.name.trim() }),
          nodes: before.nodes.map((n) =>
            n.popId === pop.id || (previous && n.site === previous.name)
              ? {
                  ...n,
                  popId: pop.id,
                  site: pop.name.trim(),
                  region: pop.region,
                  overrideFields: [...new Set([...(n.overrideFields ?? []), 'site', 'region'])],
                }
              : n
          ),
        };
      }
      if (node) {
        if (!node.site || !node.hostname.trim()) {
          throw new Error('Selecione um POP e informe o nome do equipamento.');
        }
        edited = { ...before, nodes: upsert(before.nodes, node) };
      }
      if (link) {
        edited = { ...before, links: upsert(before.links, link) };
      }
      const result = mergeOptions(before, edited, inventory);
      if (result.conflicts.length) {
        throw new Error('O cadastro mudou durante a edição. Feche e reabra o formulário para revisar.');
      }
      onChange(parseInventory(JSON.stringify(result.value)));
      close();
      setMessage('Cadastro aplicado à topologia. Salve o dashboard do Grafana.');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const blockedNode = (n: NetworkNode) =>
    inventory.links.some((l) => l.source === n.id || l.target === n.id) ||
    inventory.ospfNeighbors.some((o) => o.localNode === n.id || o.targetNode === n.id) ||
    inventory.mplsTunnels.some((t) => t.source === n.id || t.destination === n.id);
  return (
    <div className={styles.root} style={{ height: 'auto' }}>
      <div className={styles.editor}>
        <p>Cadastre POPs, equipamentos e rotas aqui. O mesmo cadastro aparece na topologia e no editor visual.</p>
        <small>
          {itemCount} opções de itens recebidos nas consultas. Os seletores usam as Queries deste painel, como no JMAP.
          Adicione as consultas Zabbix para os itens aparecerem.
        </small>
        {context?.options?.demo && (
          <p className={styles.warning}>
            A demonstração está ativa. Desative Laboratório → Demonstração para usar somente suas consultas reais.
          </p>
        )}
        <div className={styles.segment} role="tablist" aria-label="Cadastros da rede">
          {(
            [
              ['pops', 'POPs e equipamentos'],
              ['routes', 'Rotas e interfaces'],
              ['advanced', 'Importar / avançado'],
            ] as const
          ).map(([key, label]) => (
            <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </div>
        {tab === 'pops' && (
          <section aria-label="Cadastro de POPs">
            <button
              onClick={() => {
                begin();
                setPop({ id: id(), name: '' });
              }}
            >
              Adicionar POP
            </button>
            {!inventory.pops.length && <p>Nenhum POP cadastrado. Comece adicionando um POP e seus equipamentos.</p>}
            {inventory.pops.map((p) => {
              const equipment = inventory.nodes.filter((n) => n.popId === p.id || n.site === p.name);
              return (
                <div className={styles.section} key={p.id}>
                  <strong>{p.name}</strong>
                  <small>
                    {p.region ?? 'Sem região'} · {equipment.length} equipamento(s)
                  </small>
                  <div className={styles.row}>
                    <button
                      aria-label={`Editar POP ${p.name}`}
                      onClick={() => {
                        begin();
                        setPop({ ...p });
                      }}
                    >
                      Editar POP
                    </button>
                    <button
                      aria-label={`Adicionar equipamento em ${p.name}`}
                      onClick={() => {
                        begin();
                        setNode({
                          id: id(),
                          popId: p.id,
                          site: p.name,
                          hostname: '',
                          region: p.region,
                          icon: 'switch',
                        });
                      }}
                    >
                      Adicionar equipamento
                    </button>
                  </div>
                  {equipment.map((n) => (
                    <div className={styles.list} key={n.id}>
                      <button
                        className={styles.item}
                        aria-label={`Editar equipamento ${n.hostname}`}
                        onClick={() => {
                          begin();
                          setNode({ ...n, popId: p.id });
                        }}
                      >
                        <strong>{n.hostname}</strong>
                        <small>
                          {n.ip || 'IP não informado'} · {n.bindings?.status || 'Item de disponibilidade não associado'}
                        </small>
                      </button>
                      <button
                        disabled={blockedNode(n)}
                        title="Remova primeiro as rotas, custos OSPF e túneis associados"
                        aria-label={`Remover equipamento ${n.hostname}`}
                        onClick={() => {
                          onChange({ ...inventory, nodes: inventory.nodes.filter((entry) => entry.id !== n.id) });
                          setMessage('Equipamento removido do cadastro. Salve o dashboard.');
                        }}
                      >
                        Remover equipamento
                      </button>
                    </div>
                  ))}
                  {!equipment.length && (
                    <button
                      onClick={() =>
                        onChange({ ...inventory, pops: inventory.pops.filter((entry) => entry.id !== p.id) })
                      }
                    >
                      Remover POP vazio
                    </button>
                  )}
                </div>
              );
            })}
          </section>
        )}
        {tab === 'routes' && (
          <section aria-label="Cadastro de rotas">
            <button
              disabled={inventory.nodes.length < 2}
              onClick={() => {
                begin();
                setLink({
                  id: id(),
                  name: '',
                  source: inventory.nodes[0]?.id ?? '',
                  target: inventory.nodes[1]?.id ?? '',
                  sourceInterface: '',
                  targetInterface: '',
                });
              }}
            >
              Adicionar rota
            </button>
            {inventory.nodes.length < 2 && <p>Cadastre pelo menos dois equipamentos para ligar uma rota.</p>}
            {inventory.links.map((l) => (
              <div key={l.id} className={styles.section}>
                <button
                  className={styles.item}
                  aria-label={`Editar rota ${l.name}`}
                  onClick={() => {
                    begin();
                    setLink({ ...l });
                  }}
                >
                  <strong>{l.name}</strong>
                  <small>
                    {inventory.nodes.find((n) => n.id === l.source)?.hostname} →{' '}
                    {inventory.nodes.find((n) => n.id === l.target)?.hostname}
                  </small>
                  <small>
                    {l.sourceInterface} ↔ {l.targetInterface}
                  </small>
                </button>
                <button
                  aria-label={`Remover rota ${l.name}`}
                  onClick={() => {
                    onChange({ ...inventory, links: inventory.links.filter((entry) => entry.id !== l.id) });
                    setMessage('Rota removida do cadastro. Salve o dashboard.');
                  }}
                >
                  Remover rota
                </button>
              </div>
            ))}
          </section>
        )}
        {tab === 'advanced' && (
          <>
            <p>
              Importe as options do JMAP para reaproveitar os cadastros. O JSON também permite editar configurações
              avançadas.
            </p>
            <textarea
              aria-label="Inventário da topologia em JSON"
              spellCheck={false}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <button
              onClick={() => {
                try {
                  onChange(parseInventory(text));
                  setMessage('Inventário aplicado. Salve o dashboard.');
                } catch (e) {
                  setMessage((e as Error).message);
                }
              }}
            >
              Validar e aplicar JSON
            </button>
            <button
              onClick={() => {
                try {
                  const imported = importJmap(text);
                  onChange(imported.inventory);
                  setMessage(
                    [
                      'JMAP importado. Revise interfaces e unidades, depois salve o dashboard.',
                      ...imported.warnings,
                    ].join('\n')
                  );
                } catch (e) {
                  setMessage((e as Error).message);
                }
              }}
            >
              Importar options do JMAP coladas acima
            </button>
          </>
        )}
        {message && (
          <p role="status" className={styles.warning} style={{ whiteSpace: 'pre-wrap' }}>
            {message}
          </p>
        )}
        {(pop || node || link) && (
          <Modal
            title={pop ? 'Cadastro de POP' : node ? 'Cadastro de equipamento' : 'Cadastro de rota'}
            isOpen
            onDismiss={close}
            className={styles.configModal}
          >
            <div className={styles.root} style={{ height: 'auto' }}>
              <div className={styles.configForm}>
                {pop && (
                  <>
                    <label>
                      Nome do POP
                      <input value={pop.name} onChange={(e) => setPop({ ...pop, name: e.target.value })} />
                    </label>
                    <label>
                      Região
                      <input value={pop.region ?? ''} onChange={(e) => setPop({ ...pop, region: e.target.value })} />
                    </label>
                  </>
                )}
                {node && <NodeFields node={node} inventory={inventory} data={frames} onChange={updateNode} />}
                {link && <LinkFields link={link} inventory={inventory} data={frames} onChange={updateLink} />}
              </div>
              {error && (
                <p className={styles.warning} role="alert">
                  {error}
                </p>
              )}
              <div className={styles.section}>
                <div className={styles.row}>
                  <button onClick={close}>Cancelar cadastro</button>
                  <button onClick={save}>{pop ? 'Salvar POP' : node ? 'Salvar equipamento' : 'Salvar rota'}</button>
                </div>
                <small>Depois de salvar o cadastro, salve também o dashboard no Grafana.</small>
              </div>
            </div>
          </Modal>
        )}
      </div>
    </div>
  );
}
