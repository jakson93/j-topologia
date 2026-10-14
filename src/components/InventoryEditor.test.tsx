import React from 'react';
import { createTheme, FieldType, StandardEditorProps, ThemeContext, toDataFrame } from '@grafana/data';
import { fireEvent, render, screen } from '@testing-library/react';
import { InventoryEditor } from './InventoryEditor';
import { metricChoices } from './MetricSelect';
import { EMPTY_INVENTORY, TopologyInventory } from '../types';
import { GrafanaTopologyDataProvider } from '../provider';

const now = Date.now();
beforeAll(() => {
  global.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
});
const frames = [
  ['ATM interface estado', 1],
  ['ATM tráfego RX', 6e9],
  ['ATM potência RX', -19],
].map(([name, value]) =>
  toDataFrame({
    name: String(name),
    fields: [
      { name: 'Time', type: FieldType.time, values: [now] },
      { name: 'Value', type: FieldType.number, values: [value] },
    ],
  })
);
function mount(initial: TopologyInventory = EMPTY_INVENTORY) {
  const save = jest.fn();
  function Harness() {
    const [value, setValue] = React.useState(initial);
    const props = {
      value,
      onChange: (next: TopologyInventory) => {
        setValue(next);
        save(next);
      },
      context: { data: frames, options: { demo: false } },
    } as unknown as StandardEditorProps<TopologyInventory>;
    return (
      <ThemeContext.Provider value={createTheme()}>
        <InventoryEditor {...props} />
      </ThemeContext.Provider>
    );
  }
  render(<Harness />);
  return save;
}
async function choose(label: string, item: string) {
  fireEvent.keyDown(screen.getByRole('combobox', { name: label }), { key: 'ArrowDown', code: 'ArrowDown' });
  fireEvent.click(await screen.findByText(item));
}
test('Options forms register POPs, switches and queried Zabbix items that drive actual link telemetry', async () => {
  const save = mount();
  for (const [pop, hostname] of [
    ['ALTAMIRA', 'S6730-ATM'],
    ['SANTARÉM', 'S6730-STM'],
  ]) {
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar POP' }));
    fireEvent.change(screen.getByLabelText('Nome do POP'), { target: { value: pop } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar POP' }));
    fireEvent.click(screen.getByRole('button', { name: `Adicionar equipamento em ${pop}` }));
    fireEvent.change(screen.getByLabelText('Hostname / nome do equipamento'), { target: { value: hostname } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar equipamento' }));
  }
  fireEvent.click(screen.getByRole('tab', { name: 'Rotas e interfaces' }));
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar rota' }));
  fireEvent.change(screen.getByLabelText('Nome da rota'), { target: { value: 'ATM — STM' } });
  fireEvent.change(screen.getByLabelText('Interface A / origem'), { target: { value: 'XGE0/0/1' } });
  fireEvent.change(screen.getByLabelText('Interface B / destino'), { target: { value: 'XGE0/0/2' } });
  fireEvent.change(screen.getByLabelText('Capacidade (Gbps)'), { target: { value: '10' } });
  await choose('Item Zabbix — Estado da interface', 'ATM interface estado');
  await choose('Item Zabbix — Tráfego recebido RX', 'ATM tráfego RX');
  await choose('Item Zabbix — Potência óptica RX', 'ATM potência RX');
  fireEvent.click(screen.getByRole('button', { name: 'Salvar rota' }));
  const inventory = save.mock.calls.at(-1)![0] as TopologyInventory;
  expect(inventory.pops).toHaveLength(2);
  expect(inventory.nodes).toHaveLength(2);
  expect(inventory.links[0].bindings).toMatchObject({
    status: 'ATM interface estado',
    rx: 'ATM tráfego RX',
    opticalRx: 'ATM potência RX',
  });
  const snapshot = new GrafanaTopologyDataProvider(createTheme()).getSnapshot(frames, inventory, {}, now);
  expect(snapshot.links[0]).toMatchObject({ physical: 'ok', utilization: 60, values: { rx: 6e9, opticalRx: -19 } });
});
test('cancel leaves saved options untouched', () => {
  const save = mount();
  fireEvent.click(screen.getByRole('button', { name: 'Adicionar POP' }));
  fireEvent.change(screen.getByLabelText('Nome do POP'), { target: { value: 'Rascunho' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar cadastro' }));
  expect(save).not.toHaveBeenCalled();
});
test('item choices exclude time, collector tables and ambiguous generic names', () => {
  const data = [
    ...frames,
    toDataFrame({
      name: 'jtopology_nodes',
      fields: [{ name: 'hostname', type: FieldType.string, values: ['SECRET-TOPOLOGY'] }],
    }),
  ];
  expect(metricChoices(data).map((o) => o.value)).toEqual([
    'ATM interface estado',
    'ATM potência RX',
    'ATM tráfego RX',
  ]);
});
test('concurrent edits to the same POP do not silently overwrite another saved name', () => {
  const value = { ...EMPTY_INVENTORY, pops: [{ id: 'p', name: 'Original' }] };
  const save = jest.fn();
  const props = (v: TopologyInventory) =>
    ({
      value: v,
      onChange: save,
      context: { data: frames, options: {} },
    }) as unknown as StandardEditorProps<TopologyInventory>;
  const ui = (v: TopologyInventory) => (
    <ThemeContext.Provider value={createTheme()}>
      <InventoryEditor {...props(v)} />
    </ThemeContext.Provider>
  );
  const view = render(ui(value));
  fireEvent.click(screen.getByRole('button', { name: 'Editar POP Original' }));
  fireEvent.change(screen.getByLabelText('Nome do POP'), { target: { value: 'Meu nome' } });
  view.rerender(ui({ ...value, pops: [{ id: 'p', name: 'Outro nome' }] }));
  fireEvent.click(screen.getByRole('button', { name: 'Salvar POP' }));
  expect(screen.getByRole('alert')).toHaveTextContent('cadastro mudou');
  expect(save).not.toHaveBeenCalled();
});
