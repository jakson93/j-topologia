import { test, expect } from '@grafana/plugin-e2e';

test('Options reuse queried items to configure a route and update actual canvas telemetry', async ({
  gotoPanelEditPage,
  readProvisionedDashboard,
  page,
}) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'j-topologia-cadastro-demo.json' });
  const editor = await gotoPanelEditPage({ dashboard, id: '1' });
  const group = editor.getCustomOptions('Cadastro da rede');
  await group.expand();
  await page.getByRole('tab', { name: 'POPs e equipamentos', exact: true }).click();
  await page.getByRole('button', { name: 'Adicionar POP', exact: true }).click();
  const pop = page.getByRole('dialog');
  await pop.getByLabel('Nome do POP', { exact: true }).fill('POP TESTE');
  await pop.getByRole('button', { name: 'Salvar POP', exact: true }).click();
  await page.getByRole('button', { name: 'Adicionar equipamento em POP TESTE', exact: true }).click();
  const node = page.getByRole('dialog');
  await node.getByLabel('Hostname / nome do equipamento', { exact: true }).fill('S6730-TESTE');
  await node.getByRole('button', { name: 'Salvar equipamento', exact: true }).click();
  await expect(editor.panel.locator.getByRole('button', { name: /POP TESTE, S6730-TESTE/ })).toBeAttached();
  await page.getByRole('tab', { name: 'Rotas e interfaces', exact: true }).click();
  await page.getByRole('button', { name: 'Editar rota ALTAMIRA - SANTAREM', exact: true }).click();
  const modal = page.getByRole('dialog');
  const rx = modal.getByRole('combobox', { name: 'Item Zabbix — Tráfego recebido RX', exact: true });
  await rx.click();
  await rx.fill('ATM TX');
  await page.getByRole('option', { name: 'ATM TX', exact: true }).click();
  await expect(modal.getByText('ATM TX', { exact: true })).toHaveCount(2);
  await page.screenshot({ path: 'test-results/j-topologia-options-rota.png', animations: 'disabled' });
  await modal.getByRole('button', { name: 'Salvar rota', exact: true }).click();
  await editor.panel.locator.getByRole('button', { name: 'Detalhar enlace ALTAMIRA - SANTAREM', exact: true }).click();
  const detail = editor.panel.locator.getByRole('region', { name: 'Detalhes da seleção' });
  await expect(detail.getByText('30.0%', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Editar rota ALTAMIRA - SANTAREM', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('ATM TX', { exact: true })).toHaveCount(2);
  await page.getByRole('dialog').getByRole('button', { name: 'Cancelar cadastro' }).click();
  await page.screenshot({ path: 'test-results/j-topologia-options-cadastro.png', animations: 'disabled' });
});
