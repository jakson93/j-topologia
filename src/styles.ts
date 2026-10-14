import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Health } from './types';
export const color = (t: GrafanaTheme2, health: Health) =>
  health === 'ok'
    ? t.colors.success.text
    : health === 'down' || health === 'critical'
      ? t.colors.error.text
      : health === 'unknown'
        ? t.colors.text.secondary
        : t.colors.warning.text;

export const getStyles = (t: GrafanaTheme2) => ({
  root: css`
    height: 100%;
    width: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    color: ${t.colors.text.primary};
    background: ${t.colors.background.canvas};
    font-family: ${t.typography.fontFamily};
    font-size: ${t.typography.bodySmall.fontSize};
    border: 1px solid ${t.colors.border.weak};
    border-radius: ${t.shape.radius.default};
    button,
    input,
    select,
    textarea {
      font: inherit;
      color: inherit;
      border: 1px solid ${t.colors.border.medium};
      border-radius: ${t.shape.radius.default};
      background: ${t.colors.background.secondary};
    }
    button {
      padding: ${t.spacing(0.75, 1.25)};
      cursor: pointer;
      white-space: nowrap;
    }
    button:hover {
      background: ${t.colors.action.hover};
      border-color: ${t.colors.info.border};
    }
    button:focus-visible,
    input:focus-visible,
    select:focus-visible,
    textarea:focus-visible {
      outline: 2px solid ${t.colors.info.main};
      outline-offset: 2px;
    }
    button[aria-pressed='true'] {
      color: ${t.colors.info.text};
      background: ${t.colors.info.transparent};
      border-color: ${t.colors.info.border};
    }
    button:disabled {
      opacity: 0.45;
      cursor: default;
    }
    input,
    select,
    textarea {
      padding: ${t.spacing(0.75, 1)};
      min-width: 0;
    }
    select,
    input:not([type='checkbox']) {
      min-height: ${t.spacing(4)};
    }
    select {
      height: ${t.spacing(4)};
      appearance: auto;
      line-height: normal;
    }
    small {
      color: ${t.colors.text.secondary};
      font-size: ${t.typography.bodySmall.fontSize};
    }
    h2,
    h3,
    h4,
    p {
      margin: 0;
    }
    h2 {
      font-size: ${t.typography.h5.fontSize};
    }
    h3 {
      font-size: ${t.typography.h6.fontSize};
    }
    a {
      color: ${t.colors.info.text};
    }
    label {
      display: flex;
      flex-direction: column;
      gap: ${t.spacing(0.75)};
    }
    svg text {
      font-family: ${t.typography.fontFamily};
    }
    :fullscreen {
      width: 100vw !important;
      height: 100vh !important;
    }
  `,
  compact: css`
    > header {
      padding: ${t.spacing(0.5, 1)};
      gap: ${t.spacing(0.75)};
      small {
        display: none !important;
      }
      strong {
        font-size: ${t.typography.body.fontSize}!important;
      }
    }
    > [data-region='summary'] {
      padding: ${t.spacing(0.5, 1)};
      gap: ${t.spacing(0.5)};
      > div {
        padding: ${t.spacing(0.5, 1)};
        min-width: ${t.spacing(12)};
      }
      strong {
        font-size: ${t.typography.h6.fontSize};
      }
    }
    > [data-region='filters'] {
      padding: ${t.spacing(0.5, 1)};
      gap: ${t.spacing(0.5)};
    }
    button {
      padding: ${t.spacing(0.5, 0.75)};
    }
  `,
  header: css`
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: ${t.spacing(1.5)};
    padding: ${t.spacing(1.5, 2)};
    border-bottom: 1px solid ${t.colors.border.weak};
    background: ${t.colors.background.primary};
  `,
  brand: css`
    display: flex;
    align-items: center;
    gap: ${t.spacing(1.5)};
    flex: 1;
    min-width: ${t.spacing(24)};
    strong {
      font-size: ${t.typography.h5.fontSize};
      letter-spacing: -0.03em;
    }
  `,
  badge: css`
    display: inline-flex;
    align-items: center;
    gap: ${t.spacing(0.75)};
    padding: ${t.spacing(0.5, 1)};
    border-radius: ${t.shape.radius.pill};
    border: 1px solid ${t.colors.border.weak};
    font-size: ${t.typography.bodySmall.fontSize};
  `,
  stats: css`
    display: flex;
    overflow: auto;
    gap: ${t.spacing(1)};
    padding: ${t.spacing(1, 2)};
    flex-shrink: 0;
  `,
  stat: css`
    flex: 1;
    min-width: ${t.spacing(15)};
    padding: ${t.spacing(1, 1.5)};
    background: ${t.colors.background.primary};
    border: 1px solid ${t.colors.border.weak};
    border-radius: ${t.shape.radius.default};
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: ${t.spacing(1)};
    strong {
      font-size: ${t.typography.h4.fontSize};
      font-variant-numeric: tabular-nums;
    }
  `,
  toolbar: css`
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: ${t.spacing(1)};
    padding: ${t.spacing(1, 2)};
    input {
      flex: 1;
      min-width: ${t.spacing(20)};
    }
  `,
  segment: css`
    display: flex;
    gap: ${t.spacing(0.5)};
    flex-wrap: wrap;
  `,
  body: css`
    display: flex;
    flex: 1;
    min-height: 0;
    position: relative;
  `,
  canvas: css`
    flex: 1;
    min-width: 0;
    position: relative;
    overflow: hidden;
    background-image: radial-gradient(${t.colors.border.medium} 1px, transparent 1px);
    background-size: ${t.spacing(3)} ${t.spacing(3)};
    svg {
      display: block;
      width: 100%;
      height: 100%;
      touch-action: none;
      user-select: none;
    }
    svg [role='button']:focus-visible {
      outline: 2px solid ${t.colors.info.main};
    }
    .flow {
      stroke-dasharray: 10 6;
      animation: jtopology-flow 2s linear infinite;
    }
    @keyframes jtopology-flow {
      to {
        stroke-dashoffset: -32;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .flow {
        animation: none;
      }
    }
  `,
  canvasTools: css`
    position: absolute;
    bottom: ${t.spacing(2)};
    left: ${t.spacing(2)};
    display: flex;
    gap: ${t.spacing(0.5)};
    background: ${t.colors.background.primary};
    padding: ${t.spacing(0.5)};
    border-radius: ${t.shape.radius.default};
  `,
  legend: css`
    position: absolute;
    top: ${t.spacing(1.5)};
    left: ${t.spacing(2)};
    display: flex;
    gap: ${t.spacing(1.5)};
    flex-wrap: wrap;
    pointer-events: none;
    background: ${t.colors.background.primary};
    padding: ${t.spacing(0.75, 1)};
    border-radius: ${t.shape.radius.default};
    font-size: ${t.typography.bodySmall.fontSize};
  `,
  sidebar: css`
    width: clamp(${t.spacing(34)}, 28%, ${t.spacing(52)});
    flex-shrink: 0;
    min-height: 0;
    overflow: auto;
    background: ${t.colors.background.primary};
    border-left: 1px solid ${t.colors.border.weak};
    @media (max-width: 900px) {
      width: ${t.spacing(36)};
    }
  `,
  section: css`
    padding: ${t.spacing(2)};
    border-bottom: 1px solid ${t.colors.border.weak};
    display: flex;
    flex-direction: column;
    gap: ${t.spacing(1.5)};
  `,
  row: css`
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: ${t.spacing(1)};
    min-width: 0;
  `,
  list: css`
    display: flex;
    flex-direction: column;
    gap: ${t.spacing(0.75)};
  `,
  item: css`
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: ${t.spacing(0.75)};
    text-align: left;
    padding: ${t.spacing(1.25)}!important;
    min-width: 0;
    white-space: normal !important;
    overflow-wrap: anywhere;
  `,
  detailGrid: css`
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: ${t.spacing(1)};
    > div {
      padding: ${t.spacing(1)};
      background: ${t.colors.background.secondary};
      border-radius: ${t.shape.radius.default};
      overflow-wrap: anywhere;
      small {
        display: block;
        margin-bottom: ${t.spacing(0.5)};
      }
      strong {
        font-variant-numeric: tabular-nums;
      }
    }
  `,
  notice: css`
    padding: ${t.spacing(1, 2)};
    background: ${t.colors.info.transparent};
    color: ${t.colors.info.text};
    border-bottom: 1px solid ${t.colors.info.border};
    flex-shrink: 0;
  `,
  warning: css`
    padding: ${t.spacing(1)};
    border: 1px solid ${t.colors.warning.border};
    background: ${t.colors.warning.transparent};
    border-radius: ${t.shape.radius.default};
    color: ${t.colors.warning.text};
  `,
  footer: css`
    display: flex;
    justify-content: space-between;
    gap: ${t.spacing(1)};
    padding: ${t.spacing(0.75, 2)};
    border-top: 1px solid ${t.colors.border.weak};
    color: ${t.colors.text.secondary};
    font-size: ${t.typography.bodySmall.fontSize};
  `,
  empty: css`
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: ${t.spacing(2)};
    padding: ${t.spacing(4)};
    text-align: center;
  `,
  editor: css`
    display: flex;
    flex-direction: column;
    gap: ${t.spacing(1.5)};
    textarea {
      width: 100%;
      min-height: ${t.spacing(35)};
      font-family: ${t.typography.fontFamilyMonospace};
    }
    input,
    select {
      width: 100%;
    }
    label {
      font-size: ${t.typography.bodySmall.fontSize};
    }
  `,
  configForm: css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: ${t.spacing(2)};
    padding: ${t.spacing(2)};
    max-height: 65vh;
    overflow: auto;
    input,
    select {
      width: 100%;
    }
    p {
      grid-column: 1 / -1;
    }
    @media (max-width: 650px) {
      grid-template-columns: 1fr;
    }
  `,
  configModal: css`
    width: min(92vw, ${t.spacing(106)});
  `,
  path: css`
    display: flex;
    flex-direction: column;
    gap: ${t.spacing(0.75)};
    > button {
      display: flex;
      align-items: center;
      gap: ${t.spacing(1)};
      text-align: left;
    }
    b {
      display: grid;
      place-items: center;
      min-width: ${t.spacing(3)};
      height: ${t.spacing(3)};
      border-radius: 50%;
      background: ${t.colors.info.transparent};
      color: ${t.colors.info.text};
    }
  `,
  chart: css`
    width: 100%;
    height: ${t.spacing(18)};
    border: 1px solid ${t.colors.border.weak};
    border-radius: ${t.shape.radius.default};
  `,
});
