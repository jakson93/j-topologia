# Changelog

## 0.3.0 — 2026-10-14

- Reintroduz o cadastro por formulários nas Options: POPs, equipamentos, rotas e interfaces, com seletores dos itens retornados pelas Queries.
- Associa disponibilidade, tráfego, potência, erros, descartes, latência, CPU, memória, temperatura e uptime sem exigir JSON ou digitação de aliases.
- Permite associar dois itens Zabbix de custo OSPF por rota/VLANIF, preservando a independência entre A → B e B → A e a validade das amostras.
- Usa o mesmo inventário no cadastro e na edição visual, preserva posições e detecta edições concorrentes.
- Importação JMAP agrupa equipamentos por POP sem criar um segundo switch para o container quando ele não é uma ponta explícita de rota.
- Adiciona laboratório com consultas TestData sintéticas e teste E2E que comprova que alterar o item no formulário altera a telemetria do enlace.

## 0.2.0 — 2026-10-13

- Prioriza VLANIF/custos direcionais e VSIs; remove badges OSPF/TE UP/DOWN e a aba de túneis do fluxo principal. Detalhes do túnel continuam acessíveis pela VSI.
- Coleta custo de interface mesmo sem vizinho, por OSPF-MIB ou tabela CLI, separando processos e mantendo a validade por campo.
- Correlaciona pontas /30 com inventário recente e único, sem inventar portas físicas. Circuitos paralelos exigem interface ou next-hop para associar custo a um salto.
- Exibe policy por PW, com prioridade sobre a policy padrão da VSI, fonte/data e indicação de coleta antiga. Policy sem vínculo ativo não confirma caminho.
- Acrescenta testes de VLANIF, circuitos paralelos, policy por peer e interação no Grafana.

## 0.1.0 — 2026-10-13

- Cria j-topologia como plugin independente derivado do JMAP 1.6.0.
- Adiciona grafo de transporte e investigação de VSI com sentidos independentes.
- Adiciona NetworkCollector, fontes SNMP/NETCONF/CLI, SQLite e API de serviço/impacto.
- Adiciona histórico de cost OSPF e caminhos, qualidade de evidências e dados stale.
- Mantém histórico óptico, comparação entre datas e detecção visual de atenuação.
- Perfil inicial para homologação; validação com Huawei real pendente.
