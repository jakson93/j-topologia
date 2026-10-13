import React from 'react';
import { StandardEditorProps } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import { EMPTY_INVENTORY, TopologyInventory } from '../types';
import { importJmap, parseInventory } from '../inventory';
import { getStyles } from '../styles';

export function InventoryEditor({ value, onChange }: StandardEditorProps<TopologyInventory>) {
  const styles = useStyles2(getStyles);
  const [text, setText] = React.useState(JSON.stringify(value ?? EMPTY_INVENTORY, null, 2));
  const [message, setMessage] = React.useState('');
  React.useEffect(() => setText(JSON.stringify(value ?? EMPTY_INVENTORY, null, 2)), [value]);
  return (
    <div className={styles.root} style={{ height: 'auto' }}>
      <div className={styles.editor}>
        <p>
          Cadastre equipamentos e enlaces pelo modo edição da topologia. Use o JSON para bindings e configurações
          avançadas.
        </p>
        <small>
          Aliases únicos por item. Tráfego em bps, erros/descartes em ocorrências/s, latência em ms e potência óptica em
          dBm.
        </small>
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
              setMessage('Inventário validado e aplicado. Salve o dashboard.');
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
              setMessage(['JMAP importado. Revise os vínculos e salve o dashboard.', ...imported.warnings].join('\n'));
            } catch (e) {
              setMessage((e as Error).message);
            }
          }}
        >
          Importar options do JMAP coladas acima
        </button>
        {message && (
          <p role="status" className={styles.warning} style={{ whiteSpace: 'pre-wrap' }}>
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
