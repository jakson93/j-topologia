import { PanelPlugin } from '@grafana/data';
import { PanelOptions, EMPTY_INVENTORY } from './types';
import { TransportPanel } from './components/TransportPanel';
import { InventoryEditor } from './components/InventoryEditor';

export const plugin = new PanelPlugin<PanelOptions>(TransportPanel).setPanelOptions((builder) => {
  builder.addCustomEditor({
    id: 'inventory',
    path: 'inventory',
    name: 'Inventário e bindings',
    category: ['Rede de transporte'],
    defaultValue: EMPTY_INVENTORY,
    editor: InventoryEditor,
  });
  builder.addBooleanSwitch({
    path: 'demo',
    name: 'Demonstração (dados fictícios)',
    category: ['Laboratório'],
    defaultValue: false,
    description: 'Sempre identificada como laboratório. Desative para usar os dados reais do Grafana.',
  });
  builder.addRadio({
    path: 'mode',
    name: 'Camada inicial',
    category: ['Visualização'],
    defaultValue: 'physical',
    settings: {
      options: [
        { label: 'Físico', value: 'physical' },
        { label: 'OSPF', value: 'ospf' },
        { label: 'MPLS-TE', value: 'mpls' },
        { label: 'Tudo', value: 'all' },
      ],
    },
  });
  builder.addRadio({
    path: 'routeStyle',
    name: 'Traçado dos enlaces',
    category: ['Visualização'],
    defaultValue: 'curve',
    settings: {
      options: [
        { label: 'Curvas', value: 'curve' },
        { label: 'Ortogonal', value: 'orthogonal' },
        { label: 'Direto', value: 'direct' },
      ],
    },
  });
  builder.addBooleanSwitch({
    path: 'sidebar',
    name: 'Inspeção aberta inicialmente',
    category: ['Visualização'],
    defaultValue: true,
  });
  builder.addNumberInput({
    path: 'staleAfterSeconds',
    name: 'Validade máxima das amostras (s)',
    category: ['Qualidade dos dados'],
    defaultValue: 300,
    settings: { min: 10, max: 2592000, step: 10 },
  });
  builder.addNumberInput({
    path: 'warningPercent',
    name: 'Atenção a partir de (%)',
    category: ['Utilização'],
    defaultValue: 70,
    settings: { min: 0, max: 100, step: 1 },
  });
  builder.addNumberInput({
    path: 'degradedPercent',
    name: 'Degradado a partir de (%)',
    category: ['Utilização'],
    defaultValue: 85,
    settings: { min: 0, max: 100, step: 1 },
  });
  builder.addNumberInput({
    path: 'criticalPercent',
    name: 'Crítico a partir de (%)',
    category: ['Utilização'],
    defaultValue: 95,
    settings: { min: 0, max: 100, step: 1 },
  });
  builder.addNumberInput({
    path: 'flapCount',
    name: 'Quedas para classificar oscilação',
    category: ['Oscilações'],
    defaultValue: 3,
    settings: { min: 2, max: 100, step: 1 },
  });
  builder.addNumberInput({
    path: 'flapWindowMinutes',
    name: 'Janela de oscilação (min)',
    category: ['Oscilações'],
    defaultValue: 10,
    settings: { min: 1, max: 1440, step: 1 },
  });
  builder.addBooleanSwitch({
    path: 'attenuationEnabled',
    name: 'Detectar possível atenuação RX',
    category: ['Potência óptica'],
    defaultValue: true,
  });
  builder.addNumberInput({
    path: 'attenuationDropDb',
    name: 'Queda de potência (dB)',
    category: ['Potência óptica'],
    defaultValue: 2,
    settings: { min: 0.1, max: 30, step: 0.1 },
    showIf: (o) => o.attenuationEnabled !== false,
  });
  builder.addNumberInput({
    path: 'attenuationWindowMinutes',
    name: 'Janela da queda (min)',
    category: ['Potência óptica'],
    defaultValue: 5,
    settings: { min: 1, max: 60, step: 1 },
    showIf: (o) => o.attenuationEnabled !== false,
  });
});
