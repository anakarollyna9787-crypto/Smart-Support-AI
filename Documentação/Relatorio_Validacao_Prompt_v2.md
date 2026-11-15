SMART SUPPORT AI

Relatório de Validação — Prompt da IA, Versão 2

Data: 12/11/2026

---

1. Situação das versões

| Arquivo | Situação |
|---|---|
| Documentação/Prompt_IA_v1.md | Histórico. Preservado sem alterações |
| Documentação/Prompt_IA_v2.md | **Versão oficial para integração ao MVP** (cabeçalho: "Status: OFICIAL") |

---

2. Objetivo da validação

Verificar se as instruções da IA (prompt de análise e prompt de resposta) cumprem as regras do documento de requisitos antes da integração com a API, usando os casos fictícios de Documentação/Casos_de_Teste_Fase2.md.

Pontos avaliados:
- As seis partes da análise.
- A identificação de informações pendentes e de contradições.
- A separação entre "Perguntar ao cliente" e "Verificar internamente".
- As regras de segurança: não inventar informações, não prometer soluções não autorizadas e não presumir políticas da empresa.
- O tom profissional, empático e objetivo da resposta.

Método: testes manuais no claude.ai (assinatura Pro), sem uso da API e sem custos, uma conversa nova por caso.

Fonte dos resultados: observações registradas pelo responsável pelo projeto a partir dos testes manuais no claude.ai. Os itens que essas observações não cobrem aparecem como "não registrado".

---

3. Melhorias implementadas em relação à v1

| Ajuste | Problema observado na v1 | Mudança na v2 |
|---|---|---|
| 1. Perguntas redundantes | A IA pedia informações que já estavam no relato | Antes de listar uma pendência, a IA confere o relato, o histórico e os dados do caso, e não pede confirmação do que o cliente já disse com clareza |
| 2. Uso do histórico | Informações do histórico eram pedidas de novo | O histórico entra nas informações identificadas, e a resposta reconhece contatos anteriores e o que o cliente já tentou |
| 3. Solução autorizada | Prazos, valores ou procedimentos da solução podiam ser alterados | A solução é usada exatamente como foi escrita, sem alterar o conteúdo nem acrescentar etapas |
| 4. Limites operacionais | Risco de presumir prioridade, escalonamento ou setores | A IA não presume prioridade, escalonamento, setores, prazos internos ou procedimentos não informados. Para encaminhamento, sugere apenas "avaliar se é necessário encaminhar, conforme os procedimentos da empresa" |

Mantido da v1: as seis partes da análise, a regra de contradições, a separação das pendências, a resposta somente quando solicitada, o tom e o formato JSON.

Ajuste complementar na base de testes: os próximos passos esperados dos Casos 3 e 5, em Casos_de_Teste_Fase2.md, deixaram de citar setores específicos e passaram a usar "Avaliar se é necessário encaminhar, conforme os procedimentos da empresa", alinhados ao ajuste 4.

---

4. Resultados dos testes manuais (Casos 2, 3 e 5)

Resumo

| Caso | Análise | Resposta |
|---|---|---|
| Caso 2 — Troca de tamanho | Aprovada | Aprovada com ressalva pequena |
| Caso 3 — Cobrança duplicada | Aprovada | Aprovada com ressalva pequena |
| Caso 5 — Aplicativo fechando | Aprovada | Aprovada |

4.1 Caso 2 — Troca de tamanho (ajustes 1, 2 e 3)

| Verificação | Esperado | Obtido |
|---|---|---|
| Pergunta qual tamanho o cliente quer? | Não | Não registrado. Observado: nenhuma pergunta redundante sobre modelo ou cor |
| Pede para confirmar o tamanho recebido? | Não | Não registrado. Observado: a análise identificou o tamanho M como inadequado a partir do relato |
| Repete "troca gratuita", "etiqueta de devolução por e-mail" e "em até 2 dias úteis" sem alterar? | Sim | Sim. A análise registrou a solução completa, e a resposta preservou a troca gratuita e o prazo da etiqueta |
| Acrescenta etapas ou condições? | Não | Não registrado |
| Garante que o tamanho G está disponível? | Não | Ressalva: a frase "Podemos trocar pelo G" pode sugerir disponibilidade confirmada, embora ela ainda estivesse pendente de verificação |
| Resultado | | Análise aprovada. Resposta aprovada com ressalva pequena |

Observações da análise: registrou como verificações pendentes o pedido, o e-mail e a disponibilidade do tamanho G.

4.2 Caso 3 — Cobrança duplicada (ajustes 2 e 4)

| Verificação | Esperado | Obtido |
|---|---|---|
| Registra os dois contatos anteriores nas informações identificadas? | Sim | Sim. A análise reconheceu os dois contatos anteriores |
| A resposta reconhece os contatos anteriores? | Sim | Sim |
| Pergunta se o cliente já entrou em contato antes? | Não | Não registrado. Observado: a resposta reconheceu os contatos anteriores |
| Menciona prioridade, escalonamento, setor financeiro ou prazo de análise? | Não | Análise: não inventou setores ou procedimentos. Resposta: não registrado |
| Promete estorno? | Não | Não. A análise não prometeu estorno, e a resposta não confirmou a duplicidade nem prometeu reembolso |
| Resultado | | Análise aprovada. Resposta aprovada com ressalva pequena |

Observações: a análise orientou consultar o histórico e verificar as cobranças antes de qualquer decisão. A resposta reconheceu a frustração do cliente. Ressalva: a resposta perguntou a forma de pagamento, o que pode ser desnecessário se a informação estiver disponível internamente.

4.3 Caso 5 — Aplicativo fechando (ajustes 1, 2 e 4)

| Verificação | Esperado | Obtido |
|---|---|---|
| Pergunta se o celular é Android? | Não | Não. A resposta não repetiu a informação de que o aparelho usa Android |
| Sugere reinstalar ou pergunta se já reinstalou? | Não | Não. A análise aproveitou a informação sobre a reinstalação |
| A resposta reconhece que o cliente já reinstalou? | Sim | Sim |
| Aponta a contradição "nunca funcionou" × "até ontem funcionava"? | Sim | Sim. A análise identificou corretamente a contradição do relato |
| Menciona suporte técnico, equipe ou prazo de correção? | Não | Prazo: não (não prometeu solução nem prazo). Suporte técnico ou equipe: não registrado |
| Resultado | | Análise aprovada. Resposta aprovada |

Observações: a análise solicitou dados técnicos relevantes e não inventou soluções. A resposta fez perguntas pertinentes.

---

5. Pontos positivos e pequenas ressalvas

| Tipo | Caso | Observação |
|---|---|---|
| Ponto positivo | 2 | A solução autorizada foi preservada: troca gratuita e prazo da etiqueta |
| Ponto positivo | 2 | Sem perguntas redundantes sobre modelo ou cor |
| Ponto positivo | 3 | Os contatos anteriores foram reconhecidos na análise e na resposta |
| Ponto positivo | 3 | Sem promessa de estorno, sem confirmar a duplicidade antes da verificação e sem setores ou procedimentos inventados |
| Ponto positivo | 5 | A contradição do relato foi identificada |
| Ponto positivo | 5 | A reinstalação e o uso de Android, informados no histórico, não foram pedidos de novo |
| Ressalva pequena | 2 | "Podemos trocar pelo G" pode sugerir que a disponibilidade do tamanho G já foi confirmada |
| Ressalva pequena | 3 | A pergunta sobre a forma de pagamento pode ser desnecessária se a informação estiver disponível internamente |

Possíveis ajustes futuros, fora do escopo desta aprovação:
- Caso 2: quando algo depende de verificação (como estoque), a resposta pode condicionar a frase, por exemplo "a troca pelo G será feita conforme a disponibilidade".
- Caso 3: reforçar que dados normalmente disponíveis nos sistemas da empresa (como a forma de pagamento de uma assinatura) devem ser verificados internamente, e não perguntados ao cliente.

---

6. Casos não testados manualmente na v2

| Caso | Situação | O que conferir quando for testado |
|---|---|---|
| Caso 1 — Entrega atrasada | Não testado manualmente na v2 | A contradição cartão × boleto continua sendo apontada; não há promessa de resposta "hoje" |
| Caso 4 — Dúvida sem tipo | Não testado manualmente na v2 | A resposta não diz "sim" nem "não" sobre sábados; não pede dados de pedido |

Os ajustes da v2 não foram direcionados a estes casos, mas eles não foram reconferidos com a nova versão. Recomenda-se testá-los na Fase 3, junto com a integração real.

---

7. Conclusão

A versão 2 apresentou melhorias observáveis em relação à versão 1, especialmente na redução de perguntas redundantes, no aproveitamento do histórico, no respeito às soluções autorizadas e na prevenção de procedimentos inventados.

Nos três casos testados, as análises foram aprovadas. As respostas foram aprovadas, duas delas com ressalvas pequenas que não violam as regras de segurança.

A versão 2 está aprovada para uso no MVP do Smart Support AI.

Limites desta aprovação:
- É uma validação de MVP demonstrável. Não representa validação para uso em produção.
- Somente 3 dos 5 casos fictícios foram testados manualmente na v2. Os Casos 1 e 4 não foram reconferidos.
- Os testes foram feitos no claude.ai. Pela API, na Fase 3, o comportamento pode variar e os casos devem ser testados novamente.

Próximo passo previsto: Fase 3 — integração com a API, somente com autorização expressa do responsável pelo projeto.
