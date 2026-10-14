# Cadastro nas Options e associação de itens Zabbix

O cadastro funciona pelo mesmo princípio do JMAP: primeiro consulte os itens no Grafana, depois associe cada item ao equipamento ou à rota. O painel visualiza o que o datasource retorna; ele não configura o servidor Zabbix.

1. Edite um painel do tipo **j-topologia** e desative **Laboratório → Demonstração** ao usar sua rede.
2. Em **Queries**, selecione seu datasource Zabbix e adicione os itens dos hosts/interfaces desejados. Execute as consultas. Se dois hosts retornarem nomes iguais, use aliases únicos para diferenciá-los.
3. Em **Options → Cadastro da rede → POPs, equipamentos e rotas**, clique em **Adicionar POP**. Informe nome e região e salve.
4. Clique em **Adicionar equipamento** dentro do POP. Informe hostname, IP, Router ID, modelo e ícone. Nos seletores, escolha os itens de disponibilidade, uptime, CPU, memória e temperatura disponíveis. Salve.
5. Repita para o equipamento da outra ponta. Na aba **Rotas e interfaces**, clique em **Adicionar rota**. Escolha os equipamentos A e B, as interfaces e a capacidade.
6. Escolha os itens de estado, tráfego RX/TX e potência óptica RX/TX. Erros, descartes e latência são opcionais. O seletor permite pesquisar pelo nome do item; um valor já salvo continua preservado quando a consulta estiver sem resposta.
7. Se o Zabbix já coleta o custo OSPF, preencha a VLANIF e o item de custo em **A → B** e **B → A** separadamente. IP local, área e processo ajudam a identificar a saída. Não copie um único custo para as duas direções.
8. Salve a rota. O desenho e os detalhes usam esse cadastro imediatamente. Arraste os equipamentos/desvios no editor visual se desejar, aplique as posições e **salve o dashboard do Grafana**.

Unidades esperadas: tráfego em bps; óptica em dBm; latência em ms; erros/descartes em ocorrências/s; uptime em segundos; CPU/memória em %; temperatura em °C. Não use contadores cumulativos como taxas.

Se um item não aparece, confira se está em uma Query deste painel, se a consulta está retornando dados e se o nome/alias é único. As listas não navegam todo o inventário do servidor Zabbix. Não há senhas de equipamentos nesses formulários.

A associação manual de custos e métricas funciona sem o collector. A descoberta **VSI → PW → policy → túnel → LSP → saltos reais** continua dependendo do collector e da homologação dos comandos no Huawei; selecionar um item de tráfego não descobre uma VSI.

O laboratório `j-topologia-cadastro-demo.json` usa Grafana TestData com valores SINTÉTICOS e demonstra os mesmos formulários/seletores. Não é uma conexão ao seu Zabbix. Para executar esse laboratório, configure um datasource TestData de UID `jtopologia-config-testdata`; ele é utilizado apenas para testes. Em produção, use as Queries Zabbix reais.

Cadastros antigos são preservados. A aba **Importar / avançado** recebe as options de um painel JMAP (pops e routes). Rotas sem pontas explícitas não são inventadas por proximidade geográfica; revise os avisos de importação, interfaces e unidades.
