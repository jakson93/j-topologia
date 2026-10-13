# Validação — 13/10/2026

Versão de laboratório **0.2.0**, ID `jakson-j-topologia-panel`.

## Executado

- TypeScript: `npm run typecheck` aprovado.
- ESLint: `npm run lint` aprovado, sem erros. A ferramenta de estilo herdada do scaffold emite aviso de depreciação.
- Jest: **45 testes** em 8 suítes aprovados, incluindo componentes React, edição/aplicação/cancelamento, importação JMAP, alias conflitante, merge de opções, caminhos ambíguos, dados stale, cost/estados e potência óptica.
- Pytest: **26 testes** aprovados, incluindo API/token separado, grafo VSI/PW/TE/LSP, ida/volta assimétrica, ausência de caminho de volta, multi-path sem percentuais, custo VLANIF sem vizinho, /30 com donos duplicados/antigos, processos separados, circuitos paralelos/next-hop, policy por PW com precedência, cost direcional, LLDP recíproco, prioridade por campo/fonte, fallback, cache e comandos de leitura. A biblioteca TestClient emite um aviso de depreciação de dependência.
- Build de produção: manifesto, ID, versão, módulo e ícones verificados pelo script de distribuição.
- Grafana local **12.3.1**, Chrome: **5 fluxos E2E** aprovados com `@grafana/plugin-e2e`: dashboard NOC, custos VLANIF /30 nos dois sentidos sem colisão com os cards adjacentes, ida/volta e policy, edição/conexão/organização e histórico óptico/dependências.
- A atualização dos arquivos estáticos foi aplicada ao laboratório em execução. A tentativa de reiniciar o Grafana foi bloqueada pela revisão automática de execução; não foi repetida por outro mecanismo. A versão nos metadados do serviço pode continuar sendo a lida na inicialização anterior, embora a interface atualizada tenha sido validada.
- Capturas do dashboard real inspecionadas. As capturas usam viewport, pois a captura full-page aciona a virtualização do dashboard Grafana neste laboratório.
- Benchmark do adapter na versão inicial 0.1.0 (não repetido nesta alteração): conjunto de 100 equipamentos, 300 enlaces, 500 adjacências e 500 túneis, aproximadamente **86 ms** na última execução. Isso não comprova desempenho de renderização com a rede inteira.
- O repositório original JMAP permanece sem alterações locais, no commit `846b38a7b976560f5c0e56e336649f35c73bfba0`.

## Não executado

- Acesso a Huawei real por SNMP/SSH/NETCONF.
- Homologação dos outputs, prompts, capabilities e schemas da release VRP específica. O usuário informou **Version 5.170**.
- Descoberta real de todas as VSIs da rede, nem validação de tráfego por serviço.
- Build/execução da imagem Docker ou implantação no Portainer; Docker não estava disponível neste ambiente. O compose e o Dockerfile foram preparados.
- Publicação de um novo repositório ou release no GitHub.

O collector e os parsers estão implementados para homologação. As capacidades não testadas no equipamento são tratadas como incompletas e listadas em [ARQUITETURA.md](ARQUITETURA.md). Demonstração e fixtures são sintéticas e ficam identificadas.
