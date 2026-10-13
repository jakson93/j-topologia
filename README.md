# j-topologia

Plugin Grafana independente para investigar serviços de transporte: **VSI → PW → túnel → CR-LSP ativo → saltos → interfaces**. ID: `jakson-j-topologia-panel`. Versão inicial de laboratório: **0.1.0**.

O JMAP (`jakson-jmap-panel`) permanece separado e intacto. Esta base foi derivada do commit `846b38a7b976560f5c0e56e336649f35c73bfba0`: reaproveita o scaffold Grafana, tokens de tema, leitura de séries, merge de opções, histórico óptico, comparação de datas e detecção de atenuação de 2 dB/5 min. Não há mapa, tiles, Leaflet, clima ou incêndios neste plugin.

## O que esta versão implementa

- Topologia editável: arrastar, conectar equipamentos, desvios no traçado, curvas/ortogonal/direto, anel/estrela/árvore/grade, zoom, centralizar e tela cheia.
- Físico, OSPF, MPLS-TE e visão combinada; seleção de VSI com ida/volta/ambos, caminhos assimétricos e múltiplos caminhos conhecidos.
- Detalhes de PW/túnel/LSP/saltos, cost OSPF direcional, origem e idade do dado; interfaces não resolvidas permanecem identificadas como incompletas.
- Consulta inversa de VSIs dependentes de enlace, túnel ou equipamento, baseada em relações ativas observadas.
- Tráfego e utilização full duplex (máximo entre RX/TX), erros, descartes, oscilações e potência óptica; comparação RX entre datas e alerta visual de possível atenuação.
- Collector Python separado, SQLite, API autenticada, polling por domínio, logs de discovery e eventos de alteração de path/cost.
- Adaptadores NETCONF GET, SNMP GET/GETBULK e CLI Huawei com allowlist fixa de comandos `display`.

**Limite de validação:** nenhum Huawei real foi acessado neste desenvolvimento. O perfil CLI cobre os formatos testados e reconhece a identificação VRP **5.170** informada pelo usuário; isso não comprova compatibilidade com todas as releases V200Rxxx. Os modelos YANG Huawei de VSI/TE precisam ser mapeados contra as capabilities e o schema da release instalada. O adapter NETCONF de interfaces IETF e a infraestrutura de mapeamentos estão implementados; a descoberta completa de serviços não é prometida apenas porque a sessão NETCONF abriu. Formatos desconhecidos geram logs e relações incompletas, nunca dados simulados em produção.

## Experimentar no Grafana

1. Instale o ZIP do painel em uma pasta nova, sem substituir o JMAP.
2. Acrescente `jakson-j-topologia-panel` à lista `GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS`, preservando `jakson-jmap-panel` se ele estiver instalado.
3. Reinicie o container Grafana e crie um painel do tipo **j-topologia**.
4. Ative **Laboratório → Demonstração** para explorar a interface. Todos os dados ficam identificados como fictícios.
5. Selecione **CLIENTE-300** na aba VSIs; alterne **Ida / Volta / Ambos**, investigue um hop e os serviços dependentes de um enlace.
6. Edite posições e desvios, aplique e **salve o dashboard do Grafana**. Refresh de telemetria não recalcula o layout.

## Usar a rede real

O painel continua consumindo as consultas e os aliases do Zabbix pelo Grafana. Para autodiscovery de VSI/PW/path, execute o collector em um container separado e consulte sua API pelo **backend de um datasource Grafana**, com o token em secure storage do datasource. O painel não contém senhas nem se conecta diretamente aos switches.

Consulte [instalação e homologação](docs/INSTALACAO.md), [contrato de dados](docs/DADOS.md), [arquitetura e limites](docs/ARQUITETURA.md) e [perfis Huawei](collector/README.md).

## Desenvolvimento

```sh
npm ci
npm run typecheck
npm run lint
npm run test:ci
npm run build

python -m venv collector/.venv
# Ative o venv conforme seu sistema.
pip install -r collector/requirements.lock.txt
PYTHONPATH=collector python -m pytest collector/tests -q
```

`dist/` contém somente o painel Grafana; o collector é outro componente. Dependências Python estão fixadas em `requirements.lock.txt`. O uso local de um junction para os node_modules do JMAP é apenas uma otimização do workspace; o projeto funciona com `npm ci` independente.
