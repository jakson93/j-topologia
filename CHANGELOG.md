# Changelog

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
