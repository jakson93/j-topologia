import React from 'react';
import { createTheme, dateTime, LoadingState, PanelProps, ThemeContext } from '@grafana/data';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { TransportPanel } from './TransportPanel';
import { PanelOptions } from '../types';

const now = Date.parse('2026-10-13T15:00:00Z');
beforeAll(() => {
  global.ResizeObserver = class {
    constructor(private callback: ResizeObserverCallback) {}
    observe() {
      this.callback(
        [{ contentRect: { width: 1000, height: 700 } } as ResizeObserverEntry],
        this as unknown as ResizeObserver
      );
    }
    unobserve() {}
    disconnect() {}
  } as typeof ResizeObserver;
});
function mount(initial: PanelOptions = { demo: true }) {
  const save = jest.fn();
  function Harness() {
    const [options, setOptions] = React.useState(initial);
    const props = {
      id: 1,
      width: 1400,
      height: 850,
      options,
      data: { state: LoadingState.Done, series: [] },
      timeRange: { from: dateTime(now - 3600000), to: dateTime(now), raw: { from: 'now-1h', to: 'now' } },
      timeZone: 'utc',
      onOptionsChange: (next: PanelOptions) => {
        save(next);
        setOptions(next);
      },
      onChangeTimeRange: jest.fn(),
    } as unknown as PanelProps<PanelOptions>;
    return (
      <ThemeContext.Provider value={createTheme({ colors: { mode: 'dark' } })}>
        <TransportPanel {...props} />
      </ThemeContext.Provider>
    );
  }
  render(<Harness />);
  return save;
}
test('demo is explicit; selecting a VSI exposes independent ida/volta controls without saving options', () => {
  const save = mount();
  expect(screen.getByText(/Dados demonstrativos, sem conexão/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /CLIENTE-300/ }));
  const inspector = within(screen.getByRole('region', { name: 'Caminho da VSI' }));
  expect(inspector.getByText('IDA ≠ VOLTA')).toBeInTheDocument();
  expect(inspector.getByText(/IDA · path 1/)).toBeInTheDocument();
  expect(inspector.getByText(/VOLTA · path 1/)).toBeInTheDocument();
  expect(inspector.getByText('TP-CORPORATIVO-ATM')).toBeInTheDocument();
  expect(inspector.getByText('TP-CORPORATIVO-BSB')).toBeInTheDocument();
  fireEvent.click(inspector.getByRole('button', { name: 'Volta' }));
  expect(inspector.queryByText(/IDA · path 1/)).not.toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();
});

test('cost view exposes both VLANIF directions and a private /30 without OSPF or TE status badges', () => {
  mount();
  expect(screen.queryByText('OSPF FULL')).not.toBeInTheDocument();
  expect(screen.queryByText('Túneis UP')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Custos OSPF' }));
  const outward = screen.getByRole('button', { name: 'Custo OSPF ATM para STM, Vlanif100: 10' });
  expect(screen.getByRole('button', { name: 'Custo OSPF STM para ATM, Vlanif100: 50' })).toBeInTheDocument();
  fireEvent.click(outward);
  const details = within(screen.getByRole('region', { name: 'Detalhes da seleção' }));
  expect(details.getByText('172.20.0.0/30')).toBeInTheDocument();
  expect(details.getByText('Custo remoto ←')).toBeInTheDocument();
  expect(details.getByText('50')).toBeInTheDocument();
  expect(details.queryByText('Estado observado')).not.toBeInTheDocument();
});
test('manual changes are draft-only until Apply and can be cancelled', () => {
  const save = mount();
  fireEvent.click(screen.getByRole('button', { name: 'Editar topologia' }));
  fireEvent.click(screen.getByRole('button', { name: '＋ Equipamento' }));
  fireEvent.change(screen.getByLabelText('Hostname'), { target: { value: 'NOVO-ROTEADOR' } });
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Aplicar alterações' }));
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0][0].inventory.nodes.some((n: { hostname: string }) => n.hostname === 'NOVO-ROTEADOR')).toBe(
    true
  );
  fireEvent.click(screen.getByRole('button', { name: 'Editar topologia' }));
  fireEvent.click(screen.getByRole('button', { name: '＋ Equipamento' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  expect(save).toHaveBeenCalledTimes(1);
});
test('initial production view has no fictitious inventory and offers automatic discovery setup', () => {
  const save = mount({ demo: false });
  expect(screen.queryByText(/CLIENTE-300/)).not.toBeInTheDocument();
  expect(screen.getByText(/Conecte as consultas do NetworkCollector/)).toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();
});
test('link inspection provides reverse VSI dependencies and optical history selection', () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: /Enlace STM ↔ ALQ:/ }));
  const inspector = within(screen.getByRole('region', { name: 'Detalhes da seleção' }));
  expect(inspector.getByRole('button', { name: /CLIENTE-300/ })).toBeInTheDocument();
  fireEvent.change(inspector.getByLabelText('Métrica do enlace'), { target: { value: 'opticalRx' } });
  expect(inspector.getByText(/Comparar potência entre datas/)).toBeInTheDocument();
});
