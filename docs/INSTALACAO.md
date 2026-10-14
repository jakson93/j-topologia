# Instalação e homologação

## Painel Grafana

Extraia `jakson-j-topologia-panel-0.3.0.zip` em `/var/lib/grafana/plugins`. O arquivo `plugin.json` deve ficar em `/var/lib/grafana/plugins/jakson-j-topologia-panel/plugin.json`.

No ambiente do serviço Grafana no Portainer:

```yaml
GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS: jakson-jmap-panel,jakson-j-topologia-panel
```

Preserve quaisquer outros IDs já permitidos. Reinicie o Grafana, escolha **j-topologia** em um painel novo e teste primeiro a demonstração. O novo plugin não substitui o JMAP nem altera seus dashboards.

## Collector

1. Use o projeto completo, não apenas o ZIP `dist` do painel.
2. Copie `collector/devices.example.json` para `collector/config/devices.json` e substitua os IPs de documentação pelos equipamentos autorizados.
3. Configure os arquivos referenciados em `collector/secrets/`; eles não pertencem ao Git. Use usuários de monitoramento somente de leitura e verifique as host keys SSH/NETCONF antes de preencher `collector/config/known_hosts`.
4. Gere tokens diferentes de leitura/administração, com pelo menos 24 caracteres. O datasource Grafana recebe apenas o de leitura.
5. Revise os intervalos e os perfis da release VRP e execute:

```sh
docker compose -f compose.collector.yaml up -d --build
```

O compose monta config/segredos como leitura e SQLite em volume persistente. Publiquei a porta do exemplo apenas em loopback; para Grafana em outro container, coloque ambos na mesma rede Docker e use `http://jtopologia-collector:8080` no datasource. Para acesso entre hosts, configure uma rede privada/reverse proxy TLS; o compose não configura isso automaticamente.

O collector roda como UID **10001**. Nos mounts de arquivos do Docker Compose, dê a esse UID permissão de leitura dos segredos e de `known_hosts`, mantendo os segredos inacessíveis a outros usuários. Em Portainer/Swarm, adapte a seção `secrets` para os Docker Secrets já cadastrados. Os arquivos de segredo não entram no contexto de build nem no pacote do projeto.

O plugin de painel não é um datasource HTTP. Use um datasource que suporte consultas JSON **no backend** e cabeçalhos secretos, por exemplo uma instalação aprovada de Infinity com parser backend. Consulte `/snapshot` e extraia as raízes conforme [DADOS.md](DADOS.md), renomeando os frames exatamente. A configuração precisa respeitar a versão do datasource instalada; nenhum plugin externo foi instalado automaticamente.

As opções de parser backend e armazenamento de cabeçalhos sensíveis são documentadas pelo Grafana em [Query editor](https://grafana.com/docs/plugins/yesoreyeram-infinity-datasource/latest/query/) e [URL configuration](https://grafana.com/docs/plugins/yesoreyeram-infinity-datasource/latest/advanced-features/url/). Mantenha o header `Authorization` na configuração segura do datasource, fora das queries e das opções do painel.

## Sequência de validação

1. Teste um único Huawei e compare o inventário/VRP/capabilities com as respostas reais.
2. Confira uma VSI conhecida: PW/VC ID, policy padrão e específica do peer, túnel de saída, CR-LSP ativo e hops.
3. Faça a mesma leitura no PE remoto e confira a volta separadamente.
4. Compare o custo de saída nas duas VLANIFs do /30, em ambos os equipamentos, sem presumir valores iguais; confirme a resolução do underlay físico, especialmente em VLANIFs/Eth-Trunks.
5. Confira se um backup existente está ativo ou somente configurado; valide dados stale e formatos não reconhecidos.
6. Confira `/collector/status` e os eventos. Não provoque quedas em produção para testar; use um ambiente de homologação ou eventos já ocorridos.
7. Valide as dependências de um enlace conhecido e o tempo de resposta antes de aumentar o inventário.

## Reversão

Pare o novo collector e remova apenas o novo painel/dashboard de teste. O JMAP original continua usando seu próprio ID e sua pasta. Mantenha o volume SQLite se desejar preservar o histórico. Não é necessário desfazer alterações no JMAP.
