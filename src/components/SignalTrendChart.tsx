import React from 'react';
import { css } from '@emotion/css';
import { dateTimeFormat, GrafanaTheme2 } from '@grafana/data';
import { TimeZone } from '@grafana/schema';
import { useStyles2, useTheme2 } from '@grafana/ui';
import {
  OpticalSettings,
  OpticalState,
  opticalSettings as defaultOpticalSettings,
  signalAttenuation,
} from '../opticalModel';
import { SignalComparison } from './SignalComparison';
import { RX_CRITICAL, SignalSeries, signalSegments, signalSummary } from '../signalHistory';

const FALLBACK_OPTICAL_SETTINGS = defaultOpticalSettings();

export function SignalTrendChart({
  series,
  from,
  to,
  timeZone,
  opticalSettings,
  attenuationState,
}: {
  series: SignalSeries;
  from: number;
  to: number;
  timeZone?: TimeZone;
  opticalSettings?: OpticalSettings;
  attenuationState?: OpticalState;
}) {
  const theme = useTheme2();
  const styles = useStyles2(getStyles);
  const root = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(680);
  const [hover, setHover] = React.useState<number>();
  const [period, setPeriod] = React.useState<'samples' | 'panel'>('samples');
  React.useEffect(() => {
    if (!root.current || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, entry.contentRect.width)));
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  const settings = opticalSettings ?? FALLBACK_OPTICAL_SETTINGS;
  const attenuation = React.useMemo(
    () => attenuationState ?? signalAttenuation(series, settings, to),
    [attenuationState, series, settings, to]
  );
  const summary = React.useMemo(() => signalSummary(series), [series]);
  const beforeDrop = summary.beforeLoss ?? attenuation.event?.reference;
  const segments = React.useMemo(() => signalSegments(series, Math.max(32, width / 4)), [series, width]);
  const points = segments.flat();
  const height = parseFloat(theme.spacing(30));
  const left = parseFloat(theme.spacing(9)),
    top = parseFloat(theme.spacing(3)),
    bottom = parseFloat(theme.spacing(5));
  const plotWidth = width - left - parseFloat(theme.spacing(2));
  const plotHeight = height - top - bottom;
  const firstTime = series.times[0] ?? from;
  const lastTime = series.times[series.times.length - 1] ?? to;
  const axisFrom = period === 'panel' ? from : firstTime === lastTime ? firstTime - 30000 : firstTime;
  const axisTo = period === 'panel' ? to : firstTime === lastTime ? lastTime + 30000 : lastTime;
  const x = (time: number) => left + ((time - axisFrom) / Math.max(1, axisTo - axisFrom)) * plotWidth;
  const y = (value: number) => top + ((summary.max - value) / (summary.max - summary.min)) * plotHeight;
  const format = (time: number) => dateTimeFormat(time, { format: 'DD/MM HH:mm', timeZone });
  const color = (value: number) => (value <= RX_CRITICAL ? theme.colors.error.text : theme.colors.success.text);
  const point = hover === undefined ? undefined : points[hover];
  return (
    <div ref={root} className={styles.root}>
      {!summary.last ? (
        <p role="status">Sem amostras RX no período selecionado.</p>
      ) : (
        <>
          {settings.enabled && attenuation.state === 'active' && attenuation.event && (
            <div className={styles.alert} role="alert">
              <strong>
                {attenuation.event.recovering
                  ? 'Recuperação em confirmação'
                  : `Possível atenuação · queda de ${attenuation.event.dropDb.toFixed(2)} dB`}
              </strong>
              <small>
                Referência {attenuation.event.baseline.toFixed(2)} dBm → RX {attenuation.event.current.value.toFixed(2)}{' '}
                dBm. Queda confirmada em duas coletas.
              </small>
            </div>
          )}
          {settings.enabled && attenuation.state === 'pending' && (
            <p role="status">Queda de RX em confirmação: aguardando a segunda coleta.</p>
          )}
          <div className={styles.period} role="group" aria-label="Intervalo do gráfico RX">
            <button type="button" aria-pressed={period === 'samples'} onClick={() => setPeriod('samples')}>
              Intervalo com amostras
            </button>
            <button type="button" aria-pressed={period === 'panel'} onClick={() => setPeriod('panel')}>
              Período do painel
            </button>
          </div>
          <div className={styles.summary}>
            <div>
              <small>Última leitura RX</small>
              <strong style={{ color: color(summary.last.value) }}>{summary.last.value.toFixed(2)} dBm</strong>
              <small>{format(summary.last.time)}</small>
            </div>
            <div>
              <small>Antes da última queda observada</small>
              <strong>{beforeDrop ? `${beforeDrop.value.toFixed(2)} dBm` : 'Não identificado no período'}</strong>
              <small>{beforeDrop ? format(beforeDrop.time) : 'Histórico fornecido pela consulta'}</small>
            </div>
          </div>
          <svg
            role="img"
            aria-label="Histórico RX com escala de todo o período e quedas destacadas"
            viewBox={`0 0 ${width} ${height}`}
            width="100%"
            height={height}
            onMouseLeave={() => setHover(undefined)}
            onMouseMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const cursor = ((event.clientX - rect.left) / rect.width) * width;
              let nearest = 0;
              points.forEach((p, i) => {
                if (Math.abs(x(p.time) - cursor) < Math.abs(x(points[nearest].time) - cursor)) {
                  nearest = i;
                }
              });
              setHover(nearest);
            }}
          >
            {summary.min < RX_CRITICAL && (
              <rect
                x={left}
                y={y(Math.min(summary.max, RX_CRITICAL))}
                width={plotWidth}
                height={top + plotHeight - y(Math.min(summary.max, RX_CRITICAL))}
                fill={theme.colors.error.main}
                opacity={0.08}
              />
            )}
            {Array.from({ length: 5 }, (_, i) => {
              const value = summary.max - ((summary.max - summary.min) * i) / 4;
              return (
                <g key={i}>
                  <line x1={left} y1={y(value)} x2={left + plotWidth} y2={y(value)} stroke={theme.colors.border.weak} />
                  <text
                    x={left - parseFloat(theme.spacing(1))}
                    y={y(value)}
                    dominantBaseline="middle"
                    textAnchor="end"
                    fill={theme.colors.text.secondary}
                    fontSize={theme.typography.bodySmall.fontSize}
                  >
                    {value.toFixed(1)} dBm
                  </text>
                </g>
              );
            })}
            {segments.map((segment, s) => (
              <g key={s}>
                {segment.length === 1 ? (
                  <circle cx={x(segment[0].time)} cy={y(segment[0].value)} r={3} fill={color(segment[0].value)}>
                    <title>
                      {format(segment[0].time)} · {segment[0].value} dBm
                    </title>
                  </circle>
                ) : (
                  segment.slice(1).map((p, i) => (
                    <line
                      key={i}
                      data-signal-segment="true"
                      x1={x(segment[i].time)}
                      y1={y(segment[i].value)}
                      x2={x(p.time)}
                      y2={y(p.value)}
                      stroke={color(Math.min(segment[i].value, p.value))}
                      strokeWidth={2}
                      strokeLinecap="round"
                    >
                      <title>
                        {format(p.time)} · {p.value.toFixed(2)} dBm
                      </title>
                    </line>
                  ))
                )}
              </g>
            ))}
            {Array.from({ length: width < 420 ? 3 : 5 }, (_, i) => {
              const time = axisFrom + ((axisTo - axisFrom) * i) / ((width < 420 ? 3 : 5) - 1);
              return (
                <text
                  key={i}
                  x={x(time)}
                  y={height - parseFloat(theme.spacing(1))}
                  textAnchor={i === 0 ? 'start' : i === (width < 420 ? 3 : 5) - 1 ? 'end' : 'middle'}
                  fill={theme.colors.text.secondary}
                  fontSize={theme.typography.bodySmall.fontSize}
                >
                  {format(time)}
                </text>
              );
            })}
            {point && (
              <g>
                <line
                  x1={x(point.time)}
                  x2={x(point.time)}
                  y1={top}
                  y2={top + plotHeight}
                  stroke={theme.colors.text.secondary}
                  strokeDasharray="4 4"
                />
                <circle cx={x(point.time)} cy={y(point.value)} r={4} fill={color(point.value)} />
              </g>
            )}
          </svg>
          <div className={styles.legend}>
            <span style={{ color: theme.colors.success.text }}>● Histórico RX</span>
            <span style={{ color: theme.colors.error.text }}>● Faixa crítica ≤ {RX_CRITICAL} dBm</span>
            <span>
              {point
                ? `${format(point.time)} · ${point.value.toFixed(2)} dBm`
                : 'Passe o cursor para consultar valores'}
            </span>
          </div>
          <SignalComparison key={timeZone} series={series} timeZone={timeZone} toleranceMs={settings.maxGapMs} />
          {series.values.some((v) => v === null) && (
            <small>Lacunas representam ausência de dados; não foram preenchidas.</small>
          )}
          <small>
            A faixa crítica indica nível óptico baixo; o status da rota continua vindo das métricas configuradas.
          </small>
          <small>
            {series.values.filter((v) => v !== null).length} amostra(s) recebida(s) · {format(firstTime)} até{' '}
            {format(lastTime)}
          </small>
        </>
      )}
    </div>
  );
}
function getStyles(theme: GrafanaTheme2) {
  return {
    alert: css({
      padding: theme.spacing(1.5),
      marginBottom: theme.spacing(1.5),
      background: theme.colors.warning.transparent,
      border: `1px solid ${theme.colors.warning.border}`,
      borderRadius: theme.shape.radius.default,
      strong: { color: theme.colors.warning.text },
    }),
    period: css({
      display: 'flex',
      flexWrap: 'wrap',
      gap: theme.spacing(1),
      marginBottom: theme.spacing(1.5),
      button: {
        padding: theme.spacing(0.75, 1),
        color: theme.colors.text.secondary,
        background: theme.colors.background.secondary,
        border: `1px solid ${theme.colors.border.weak}`,
        borderRadius: theme.shape.radius.default,
        fontSize: theme.typography.bodySmall.fontSize,
        '&[aria-pressed=true]': { color: theme.colors.primary.text, borderColor: theme.colors.primary.border },
        '&:focus-visible': { outline: `2px solid ${theme.colors.primary.text}` },
      },
    }),
    root: css({
      width: '100%',
      minWidth: 0,
      color: theme.colors.text.primary,
      small: { display: 'block', color: theme.colors.text.secondary, fontSize: theme.typography.bodySmall.fontSize },
      svg: { display: 'block' },
    }),
    summary: css({
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
      gap: theme.spacing(2),
      marginBottom: theme.spacing(2),
      '> div': {
        padding: theme.spacing(1.5),
        border: `1px solid ${theme.colors.border.weak}`,
        borderRadius: theme.shape.radius.default,
        background: theme.colors.background.secondary,
      },
      strong: { display: 'block', margin: theme.spacing(0.5, 0), fontSize: theme.typography.h5.fontSize },
    }),
    legend: css({
      display: 'flex',
      flexWrap: 'wrap',
      gap: theme.spacing(1, 2),
      margin: theme.spacing(1, 0),
      fontSize: theme.typography.bodySmall.fontSize,
    }),
  };
}
