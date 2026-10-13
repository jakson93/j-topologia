# NetworkCollector

Serviço independente do painel Grafana, com adaptadores `NetconfDriver`, `SnmpDriver`, `CliDriver`, SQLite e grafo de dependências. Configure apenas os equipamentos-semente de gerenciamento; VSI, PW, túnel e caminho são objetos descobertos, não cadastros obrigatórios.

## Perfil Huawei inicial

A linha **VRP 5.170** foi informada pelo usuário. A release V200Rxxx/SPC completa é descoberta no banner quando disponível. O perfil inicial usa apenas:

```text
display version
display ip interface brief
display ospf peer
display ospf interface
display mpls te tunnel-interface
display mpls te tunnel path
display vsi verbose
display vsi pw out-interface
display mpls lsp verbose
```

A lista é fixa: argumentos arbitrários, separadores, configurações, `undo`, `system-view`, `shutdown` e `commit` são rejeitados. Não há alteração de configuração nem habilitação automática de record-route. SSH exige host key conhecida. O transporte tenta exec e permite shell de leitura com paginação por espaço, sem executar comandos para alterar a sessão ou a configuração. Respostas incompletas/truncadas ou formatos desconhecidos não são aceitos como descoberta completa. O comportamento de prompt/paginação deve ser homologado no equipamento.

## NETCONF

A sessão lê as capabilities e executa somente `get` com filtros de subtree, sem RPCs de configuração. Há um parser builtin para interfaces IETF. Modelos Huawei de TE/VSI/OSPF variam por release: configure `yang_profiles` após validar o schema anunciado. Um perfil identifica `group`, `capability`, `filter`, `table`, `row_path`, `fields`, `device_scoped_fields` e `constants`. Ele mapeia uma lista inteira; não exige cadastrar cada VSI.

Sem perfil Huawei validado, a conexão NETCONF pode funcionar enquanto VSI/path vêm da CLI. Isso fica nos logs. Não alegue suporte de um módulo só porque ele aparece em uma versão diferente do equipamento.

## SNMP

O adaptador usa GET/GETBULK para identificação, IF-MIB, IP-MIB IPv4, OSPF-MIB e LLDP. SNMPv3 inicial: SHA/AES128. SNMPv2c usa community somente no servidor. IPv6 de gerenciamento é aceito; o inventário IPv6 completo depende de profile NETCONF/expansão IP-MIB. MPLS-TE/VSI via MIB empresarial não é presumido. OSPF multi-processo/contexto requer validação por release: o contexto SNMP padrão não revela necessariamente todos os processos.

## API

| Operação | Uso |
|---|---|
| `GET /health` | Disponibilidade do processo, sem dados de rede |
| `GET /snapshot` | Listas para datasource Grafana |
| `GET /service-path/<id-ou-nome-vsi>` | Ida/volta, PW/túnel/LSP/path, fontes e confiança |
| `GET /impact/<link-id>` | Dependências ativas coletadas |
| `GET /events?since=<ms>` | Mudanças de cost e path |
| `GET /history/<dominio>/<id>?since=<ms>` | Histórico persistido de observações |
| `GET /collector/status` | Coletas, módulos e logs sanitizados |
| `POST /discover/device/<id>` | Forçar discovery de um equipamento-semente |
| `POST /discover/network` | Forçar discovery de todas as sementes |

GETs de rede exigem token de leitura; POSTs exigem token administrativo diferente. Nome de VSI duplicado retorna conflito: use o ID que inclui o PE. Não há endpoint para receber senhas, executar comandos livres ou adicionar alvos pela internet.

## Referências técnicas

- [RFC 3209](https://www.rfc-editor.org/rfc/rfc3209.html): diferença entre explicit route e record route.
- [RFC 2328](https://www.rfc-editor.org/rfc/rfc2328.html): vizinhanças OSPF e custos direcionais.
- [Huawei: verificação de CR-LSP hot standby](https://support.huawei.com/enterprise/en/doc/EDOC1100459005/3ddfa620/configuring-cr-lsp-hot-standby): comandos para verificar estado e path, em uma família/release documentada.
- [Huawei: VPLS command reference](https://support.huawei.cn/enterprise/en/doc/EDOC1100515417/20972474/vpls-configuration-commands): política configurada e out-interface operacional do PW são informações diferentes.
- [PySNMP 7.1](https://docs.lextudio.com/pysnmp/v7.1/docs/pysnmp-hlapi-tutorial): API assíncrona GET/WALK.

As referências não comprovam que o mesmo schema/output está presente no S6730 do usuário. A homologação deve comparar dados reais com o perfil antes da produção.

## Coleta do custo OSPF na VLANIF

O collector lê `ospfIfMetricValue` (`1.3.6.1.2.1.14.8.1.4`), com índice `IP-local.0.0` para interfaces IPv4 numeradas e TOS 0, cruzando IP-MIB/ifName. A métrica existe independentemente da descoberta do vizinho. Não há cálculo baseado na capacidade da interface. Referência do índice: [RFC 1850, OSPF Interface Metric Table](https://www.rfc-editor.org/rfc/rfc1850.html#page-40).

Se esse domínio não for entregue por NETCONF/SNMP, o fallback SSH lê `display ospf interface`, `display ospf peer` e `display ip interface brief`. Custo, processo e área são preservados por interface; o inventário IPv4 fornece a máscara /30. A coleta é somente leitura. O contexto SNMP padrão pode não expor todos os processos: valide o perfil CLI com as saídas do VRP instalado antes de usar em produção.

A correlação /30 exige endereços recentes e donos únicos das duas pontas. Não relaciona automaticamente a VLANIF a uma fibra/porta física. Entre nós com várias VLANIFs, a associação do custo a um salto TE exige next-hop/interface observados; quando faltar evidência, o painel mostra a incerteza.

A tunnel policy específica do peer/PW prevalece sobre a padrão da VSI. O nome da policy é exibido com origem e data, mas não substitui a coleta do vínculo PW/túnel, do LSP ativo e dos saltos. Uma policy pode permitir vários túneis; seu nome sozinho não determina o caminho que está em uso.
