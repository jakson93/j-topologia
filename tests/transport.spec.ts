import { test, expect } from '@grafana/plugin-e2e';

test('NOC dashboard has a usable canvas and exposes both service directions without a geographic map', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/d/jtopologia-lab/?orgId=1&kiosk=true');
  await expect(page.getByRole('button', { name: /CLIENTE-300/ })).toBeVisible();
  const canvas = page.locator('svg[aria-label="Topologia da rede de transporte"]');
  const box = await canvas.boundingBox();
  expect(box?.height).toBeGreaterThan(250);
  const filter = await page.getByLabel('Filtrar POP', { exact: true }).boundingBox();
  expect(filter?.height).toBeGreaterThanOrEqual(28);
  await page.screenshot({ path: 'test-results/j-topologia-noc.png', fullPage: false });
  await page.getByRole('button', { name: /CLIENTE-300/ }).click();
  await expect(page.getByRole('region', { name: 'Caminho da VSI' }).getByText('IDA ≠ VOLTA')).toBeVisible();
  await expect(page.getByRole('button', { name: /ALTAMIRA, S6730-ATM/ })).toBeInViewport();
  await page.screenshot({ path: 'test-results/j-topologia-vsi-ambos-viewport.png', animations: 'disabled' });

  expect(errors).toEqual([]);
});

test('VSI inspection highlights independent forward and reverse actual paths', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'j-topologia-demo.json' });
  const editor = await gotoPanelEditPage({ dashboard, id: '1' }),
    panel = editor.panel.locator;
  await expect(panel.getByText(/Dados demonstrativos, sem conexão/)).toBeVisible();
  await panel.getByRole('button', { name: /CLIENTE-300/ }).click();
  const inspector = panel.getByRole('region', { name: 'Caminho da VSI' });
  await expect(inspector.getByText('IDA ≠ VOLTA')).toBeVisible();
  await expect(inspector.getByText('IDA · path 1')).toBeVisible();
  await expect(inspector.getByText('VOLTA · path 1')).toBeAttached();
  await inspector.getByRole('button', { name: 'Volta', exact: true }).click();
  await expect(inspector.getByText('IDA · path 1')).toHaveCount(0);
  await expect(inspector.getByText('VOLTA · path 1')).toBeVisible();
  await page.screenshot({ path: 'test-results/j-topologia-vsi-volta.png', fullPage: false });
});

test('manual overrides and layout commands remain usable in the Grafana editor', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'j-topologia-demo.json' });
  const editor = await gotoPanelEditPage({ dashboard, id: '1' }),
    panel = editor.panel.locator;
  await panel.getByRole('button', { name: 'Editar topologia', exact: true }).click();
  await panel.getByRole('button', { name: /ALTAMIRA, S6730-ATM/ }).click();
  await panel.getByLabel('Hostname', { exact: true }).fill('S6730-ATM-EDITADO');
  await panel.getByRole('button', { name: 'Conectar a outro equipamento', exact: true }).click();
  await panel.getByRole('button', { name: /SANTARÉM, S6730-STM/ }).click();
  await panel.getByLabel('Interface origem', { exact: true }).fill('XGE0/0/99');
  await panel.getByLabel('Interface destino', { exact: true }).fill('XGE0/0/98');
  await panel.getByLabel('Organizar layout').selectOption('ring');
  await panel.getByRole('button', { name: 'Aplicar alterações', exact: true }).click();
  await expect(panel.getByRole('button', { name: /ALTAMIRA, S6730-ATM-EDITADO/ })).toBeVisible();
  await expect(panel.getByText(/Alterações aplicadas. Salve o dashboard/)).toBeVisible();
});

test('link inspection keeps optical history and discovers dependent VSI instances', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'j-topologia-demo.json' });
  const editor = await gotoPanelEditPage({ dashboard, id: '1' }),
    panel = editor.panel.locator;
  await panel.getByRole('button', { name: /Detalhar enlace STM ↔ ALQ/ }).click();
  const inspector = panel.getByRole('region', { name: 'Detalhes da seleção' });
  await expect(inspector.getByRole('button', { name: /CLIENTE-300/ })).toBeAttached();
  await inspector.getByLabel('Métrica do enlace').selectOption('opticalRx');
  await expect(inspector.getByRole('region', { name: 'Comparação de potência RX' })).toBeVisible();
  await page.screenshot({ path: 'test-results/j-topologia-optico.png', fullPage: false });
});
