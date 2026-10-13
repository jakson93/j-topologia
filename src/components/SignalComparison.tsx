import React from 'react';
import { css } from '@emotion/css';
import { dateTimeFormat, dateTimeParse, GrafanaTheme2 } from '@grafana/data';
import { TimeZone } from '@grafana/schema';
import { useStyles2 } from '@grafana/ui';
import { SignalSeries } from '../signalHistory';
import { compareSignalDates } from '../opticalModel';

export function SignalComparison({
  series,
  timeZone,
  toleranceMs,
}: {
  series: SignalSeries;
  timeZone?: TimeZone;
  toleranceMs: number;
}) {
  const styles = useStyles2(getStyles);
  const valid = series.times.filter((_, i) => series.values[i] !== null && Number.isFinite(series.values[i]));
  const inputFormat = (time: number) => dateTimeFormat(time, { format: 'YYYY-MM-DD[T]HH:mm:ss', timeZone });
  const format = (time: number) => dateTimeFormat(time, { format: 'DD/MM/YYYY HH:mm:ss', timeZone });
  const [chosen, setChosen] = React.useState<{ a?: string; b?: string }>({});
  const a = chosen.a ?? (valid.length ? inputFormat(valid[0]) : '');
  const b = chosen.b ?? (valid.length ? inputFormat(valid[valid.length - 1]) : '');
  const parse = (value: string) =>
    value ? dateTimeParse(value, { timeZone, format: 'YYYY-MM-DD[T]HH:mm:ss' }).valueOf() : NaN;
  const comparison = compareSignalDates(series, parse(a), parse(b), toleranceMs);
  return (
    <section className={styles.root} aria-label="Comparação de potência RX">
      <strong>Comparar potência entre datas</strong>
      <div className={styles.grid}>
        <label>
          Data A
          <input
            type="datetime-local"
            step="1"
            value={a}
            onChange={(e) => setChosen({ ...chosen, a: e.currentTarget.value })}
          />
        </label>
        <label>
          Data B
          <input
            type="datetime-local"
            step="1"
            value={b}
            onChange={(e) => setChosen({ ...chosen, b: e.currentTarget.value })}
          />
        </label>
      </div>
      <button type="button" onClick={() => setChosen({})}>
        Usar início e fim das amostras
      </button>
      {'error' in comparison ? (
        <p role="status">{comparison.error}</p>
      ) : (
        <>
          <div className={styles.grid}>
            <div>
              <small>RX em A</small>
              <strong>{comparison.first.value.toFixed(2)} dBm</strong>
              <small>{format(comparison.first.time)}</small>
            </div>
            <div>
              <small>RX em B</small>
              <strong>{comparison.second.value.toFixed(2)} dBm</strong>
              <small>{format(comparison.second.time)}</small>
            </div>
          </div>
          <p
            className={
              comparison.direction === 'worsened'
                ? styles.worsened
                : comparison.direction === 'improved'
                  ? styles.improved
                  : undefined
            }
          >
            <strong>
              {comparison.direction === 'stable'
                ? 'Sem variação ≥ 0,01 dB'
                : `${comparison.direction === 'worsened' ? 'Piorou' : 'Melhorou'} ${Math.abs(comparison.deltaDb).toFixed(2)} dB`}
            </strong>{' '}
            · Δ RX {comparison.deltaDb > 0 ? '+' : ''}
            {comparison.deltaDb.toFixed(2)} dB
          </p>
        </>
      )}
      <small>
        Datas no fuso do painel ({timeZone || 'configurado no Grafana'}). São usadas coletas reais a até{' '}
        {Math.round(toleranceMs / 1000)}s do horário escolhido; os horários efetivos aparecem acima. Para comparar dias
        diferentes, inclua ambos no período do Grafana.
      </small>
    </section>
  );
}
function getStyles(t: GrafanaTheme2) {
  return {
    root: css({
      display: 'grid',
      gap: t.spacing(1),
      padding: t.spacing(1.5),
      marginTop: t.spacing(2),
      background: t.colors.background.secondary,
      border: `1px solid ${t.colors.border.weak}`,
      borderRadius: t.shape.radius.default,
      p: { margin: 0 },
      label: { display: 'grid', gap: t.spacing(0.5), minWidth: 0 },
      input: {
        width: '100%',
        minWidth: 0,
        background: t.colors.background.primary,
        color: t.colors.text.primary,
        border: `1px solid ${t.colors.border.medium}`,
        borderRadius: t.shape.radius.default,
        padding: t.spacing(0.75),
        colorScheme: t.isDark ? 'dark' : 'light',
      },
      button: {
        justifySelf: 'start',
        border: 0,
        background: 'transparent',
        color: t.colors.primary.text,
        padding: t.spacing(0.5, 0),
        textAlign: 'left',
      },
      'button:focus-visible, input:focus-visible': { outline: `2px solid ${t.colors.primary.text}` },
    }),
    grid: css({
      display: 'grid',
      gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${t.spacing(25)}), 1fr))`,
      gap: t.spacing(1.5),
      strong: { display: 'block' },
    }),
    worsened: css({ color: t.colors.warning.text }),
    improved: css({ color: t.colors.success.text }),
  };
}
