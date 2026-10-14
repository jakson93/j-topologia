# Contrato de dados do painel

O panel recebe DataFrames Grafana. O nome de cada frame abaixo deve ser preservado pelo datasource/transformação. Colunas aninhadas são JSON em string. Os aliases de séries Zabbix devem ser únicos por equipamento/interface.

| Frame | Colunas principais |
|---|---|
| `jtopology_nodes` | `id`, `hostname`, `site`, `routerId`, `ip`, `model`, `group`, `snmpStatus`, `observedAt` |
| `jtopology_links` | `id`, `source`, `target`, `sourceInterface`, `targetInterface`, `capacityBps`, `physicalStatus`, `observedAt`, `rxBps`, `txBps`, `latencyMs`, `errorsPerSecond`, `discardsPerSecond` |
| `jtopology_ospf` | `id`, `localNode`, `neighborRouterId`, `localIp`, `neighborIp`, `interface`, `targetNode`, `targetInterface`, `subnet`, `peerResolution`, `area`, `cost`, `costObservedAt`, `costSource`, `process`, `networkType`, `observedAt`; `state` é opcional para diagnóstico interno |
| `jtopology_tunnels` | `id`, `name`, `source`, `destination`, `operStatus`, `adminStatus`, `activePath`, `primaryLsp`, `backupLsp`, `primaryPath`, `backupPath`, `observedAt` |
| `jtopology_service_paths` | `id`, `vsi` JSON, `pseudowires` JSON, `forward` JSON, `reverse` JSON, `asymmetric`, `multipleActivePaths`, `discoveryConfidence`, `issues` JSON |
| `jtopology_events` | `id`, `entityId`, `kind` (`physical`/`ospf`/`mpls`), `time`, `severity`, `message` |
| `jtopology_collector` | `id`, `deviceId`, `protocol`, `status`, `modules` JSON, `observedAt`, `warningCount` |

`GET /snapshot` fornece essas listas para serem consultadas como tabelas. A fonte deve executar a chamada no servidor Grafana, usando o token de leitura configurado em secure storage. O token administrativo não deve ser instalado no datasource.

Valores de tempo: epoch em milissegundos (preferido); os adaptadores de séries aceitam segundos. Sem timestamp, o status não é considerado atual. IF-MIB usa `1=up,2=down`; disponibilidade Zabbix também aceita `1=online,0=offline`. OSPF-MIB usa `1=Down ... 8=Full`, com semântica independente de IF-MIB.

## Séries de métricas Zabbix

As métricas existentes continuam sendo consultadas pelo Grafana. Em modo edição, associe os aliases aos bindings dos enlaces. RX/TX de tráfego devem estar em **bps**; potência RX/TX óptica em **dBm**; latência em **ms**; erros e descartes em **taxas/s**. Não associe contadores cumulativos diretamente a taxas. O collector transforma contadores em taxas apenas com duas amostras válidas e sem reset/wrap.

Para gráficos reais, consulte também o histórico no datasource, ou transforme os registros de `/history/interfaces/<id>?since=<epoch_ms>` em séries com `observedAt` como tempo. Uma tabela com só o último valor não fornece histórico. Os botões de período solicitam outra faixa de tempo ao Grafana; não geram amostras.

## Custos de VLANIF e policies

Cada linha OSPF representa uma saída local; custo A → B e B → A são independentes. Mesmo sem vizinho descoberto, a interface/custo fica disponível na lateral. Interfaces IPv4 recentes e únicas nas duas pontas de um /30 permitem resolver `targetNode`, `targetInterface`, `neighborIp` e `subnet`. Prefixos duplicados, VRFs sobrepostos ou dados antigos impedem essa resolução automática. A linha pontilhada representa um P2P lógico, sem comprovar a fibra usada.

Cada registro em `forward`/`reverse` pode incluir `tunnelPolicy`, `policySource`, `policyObservedAt`, `policyStale`. A policy do PW prevalece sobre a padrão da VSI. `pseudowires` lista também peers sem caminho resolvido. O caminho exige vínculo ativo observado PW → túnel, LSP ativo e saltos reais recentes; policy sozinha não fornece esses saltos.

Os segmentos incluem `costInterface` (VLANIF), `costAssociation` (`next-hop`, `interface` ou `unique-peer`) e `subnet`. `unique-peer` mostra contexto lógico, sem afirmar o vínculo com a porta física. Com circuitos paralelos sem evidência que os diferencie, o custo do segmento fica desconhecido.

## Cadastro pelas Options

Os formulários em **Cadastro da rede** persistem `inventory.pops`, `inventory.nodes` e `inventory.links`. Equipamentos usam `popId`, além de `site`; inventários antigos sem `pops` continuam funcionando e seus grupos são apresentados pelo `site` existente. O mesmo inventário alimenta a topologia e o editor visual. Os itens dos seletores vêm de `context.data`, não de chamadas diretas ao Zabbix.

Os bindings de equipamento também aceitam `cpu`, `memory` (percentuais) e `temperature` (°C). Enlaces podem conter `sourceOspf`/`targetOspf` com `interface`, `localIp`, `area`, `process`, `costItem`. Cada `costItem` aponta a uma série numérica consultada no Grafana; ausência, conflito de alias ou amostra antiga resultam em custo desconhecido. Esses campos não geram consultas nem descobrem caminhos VSI.

## Overrides opcionais

```json
{
  "nodes": [
    {"id":"ATM","hostname":"S6730-ATM-01","site":"ALTAMIRA","routerId":"10.40.40.1","bindings":{"status":"ATM.snmp"}},
    {"id":"STM","hostname":"S6730-STM-01","site":"SANTARÉM","routerId":"10.40.40.2"}
  ],
  "links": [
    {"id":"ATM-STM","name":"ATM ↔ STM","source":"ATM","target":"STM","sourceInterface":"XGE0/0/1","targetInterface":"XGE0/0/2","capacityBps":10000000000,"bindings":{"status":"ATM-STM.status","rx":"ATM-STM.rx","tx":"ATM-STM.tx","opticalRx":"ATM-STM.opticalRx"}}
  ],
  "ospfNeighbors": [],
  "mplsTunnels": []
}
```

Paths manuais são identificados como **configurados**, mesmo se o JSON tentar promovê-los a observados. Para caminhos coletados, use os frames do collector, com timestamps e fontes.

## Semântica visual

Animação é indicação de direção, não velocidade ou medição de fluxo por VSI. O tráfego de uma interface pode somar muitos serviços. Banda reservada no túnel não é tráfego. Uma linha tracejada em um path pode representar hops coletados cuja interface física ainda não foi identificada — a lateral explicita essa ausência.
