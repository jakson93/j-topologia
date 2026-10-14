import React from 'react';
import { DataFrame, FieldType, SelectableValue } from '@grafana/data';
import { Field, Select } from '@grafana/ui';

/** Only items already returned by Grafana queries; no browser access to Zabbix credentials. */
export function metricChoices(data: DataFrame[] = []): Array<SelectableValue<string>> {
  const names = new Map<string, Set<string>>();
  data.forEach((frame, i) => {
    if (frame.name?.startsWith('jtopology_')) {
      return;
    }
    const fields = frame.fields.filter((f) => f.type !== FieldType.time);
    fields.forEach((field, j) => {
      for (const name of [
        field.config.displayNameFromDS,
        field.config.displayName,
        fields.length === 1 ? frame.name : undefined,
        field.name,
      ]) {
        if (name?.trim()) {
          const key = name.trim();
          const owners = names.get(key) ?? new Set<string>();
          owners.add(`${i}:${j}`);
          names.set(key, owners);
        }
      }
    });
  });
  return [...names]
    .filter(([, owners]) => owners.size === 1)
    .map(([value]) => ({ label: value, value }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function MetricSelect({
  label,
  value,
  onChange,
  data,
  description,
}: {
  label: string;
  value?: string;
  onChange: (value: string) => void;
  data?: DataFrame[];
  description?: string;
}) {
  const id = React.useId();
  const choices = React.useMemo(() => metricChoices(data), [data]);
  return (
    <Field label={label} htmlFor={id} description={description}>
      <div>
        <Select<string>
          inputId={id}
          aria-label={label}
          options={choices}
          value={value ? { label: value, value } : null}
          isClearable
          allowCustomValue
          placeholder={choices.length ? 'Selecionar item da consulta…' : 'Adicione uma consulta Zabbix no painel'}
          onChange={(v) => onChange(v?.value ?? '')}
          onCreateOption={onChange}
        />
        {value && !choices.some((c) => c.value === value) && (
          <small>Item salvo, mas não retornado pelas consultas atuais.</small>
        )}
      </div>
    </Field>
  );
}
