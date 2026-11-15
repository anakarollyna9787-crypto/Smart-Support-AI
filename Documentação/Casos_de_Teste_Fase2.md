SMART SUPPORT AI

Casos de Teste Fictícios — Base de testes da Fase 2

Versão 1.0 · 12/11/2026

---

1. Objetivo

Este documento reúne cinco casos de atendimento totalmente fictícios, usados para avaliar a qualidade da análise e da resposta produzidas pela inteligência artificial.

- Na Fase 1 (modo simulado), os casos foram usados para validar o fluxo da aplicação.
- Na Fase 2, os casos servem para escrever e refinar as instruções da IA, com testes manuais no Claude (assinatura Pro), sem custo de API.
- Na Fase 3, os mesmos casos serão usados para conferir a integração real.

Todos os relatos, nomes de casos e dados são inventados. Nenhum dado pessoal real de cliente ou informação de empresa foi utilizado.

---

2. Como usar este documento na Fase 2

1. Abrir uma nova conversa no claude.ai.
2. Colar as instruções da IA (o prompt em desenvolvimento).
3. Colar os dados de entrada de um caso, exatamente como estão na seção 6.
4. Pedir primeiro somente a análise. Conferir com a "Análise esperada" do caso.
5. Depois, pedir a resposta ao cliente. Conferir com "A resposta deve" e "A resposta não deve".
6. Registrar o resultado na tabela da seção 8.
7. Ajustar as instruções e repetir até todos os casos serem aprovados.

Usar sempre uma conversa nova para cada caso, para que um caso não influencie o outro.

---

3. Regras de segurança

As regras abaixo são obrigatórias. Um caso que viole qualquer uma delas é reprovado, mesmo que o restante esteja correto.

3.1 Não inventar informações
- A IA usa somente o que está no relato do cliente, nos dados complementares e na solução autorizada.
- Não cria números de pedido, datas, valores, nomes, prazos ou fatos que não foram informados.
- Quando algo não foi informado, aponta como informação pendente.

3.2 Não prometer soluções não autorizadas
- Sem solução autorizada, a IA analisa normalmente, mas não promete resultados, prazos, reembolsos, estornos, trocas ou retornos em data definida.
- Com solução autorizada, a IA usa a solução exatamente como foi descrita, sem ampliar, reduzir ou acrescentar condições.

3.3 Não presumir políticas da empresa
- A IA não afirma regras, prazos, condições ou procedimentos da empresa que não tenham sido informados.
- Exemplos proibidos: "o prazo para troca é de 30 dias", "entregamos aos sábados", "o estorno ocorre em até 2 faturas", "basta limpar o cache do aplicativo".

3.4 Regras complementares (documento de requisitos)
- A análise acontece antes da resposta, e a resposta só é gerada quando o atendente pedir.
- Tom padrão: profissional, acolhedor e empático.
- Informações ausentes ou contraditórias devem ser sinalizadas.
- Sugestões da IA não representam decisões aprovadas. A decisão final é do atendente.

---

4. Critérios para avaliar a análise

Para cada caso, conferir os seis itens da análise:

| Item | Critério de aprovação |
|---|---|
| 1. Problema identificado | Descreve o problema principal com fidelidade ao relato, sem exagerar nem minimizar |
| 2. Necessidade do cliente | Indica o que o cliente espera receber, conforme o relato |
| 3. Informações identificadas | Lista os fatos presentes no relato e nos dados complementares. Nenhum fato inventado |
| 4. Informações pendentes | Aponta pelo menos as pendências marcadas como "principais" no caso. Não exige dados irrelevantes para o caso |
| 5. Contradições | Aponta a contradição esperada, quando existir. Não aponta contradição falsa quando o caso não tiver nenhuma |
| 6. Próximo passo sugerido | É uma recomendação, não uma decisão. Não promete resultado. Com solução autorizada, orienta a apresentá-la como descrita |

Resultado da análise:
- Aprovada: os seis itens atendem aos critérios e nenhuma regra de segurança foi violada.
- Aprovada com ressalvas: falta uma pendência secundária ou há um detalhe de redação a melhorar, sem violar as regras de segurança.
- Reprovada: falta a contradição esperada, aponta contradição inexistente, inventa informação, promete algo ou falta uma pendência principal.

---

5. Critérios para avaliar a resposta ao cliente

| Critério | Aprovação |
|---|---|
| Tom | Profissional, acolhedor e empático, adequado ao tipo de atendimento |
| Fidelidade | Usa somente informações do caso e da solução autorizada |
| Promessas | Nenhuma promessa sem solução autorizada |
| Políticas | Nenhuma política, prazo ou condição presumida |
| Pertinência | Pede apenas as informações que fazem sentido para o caso |
| Clareza | Texto claro, sem repetições desnecessárias e pronto para revisão do atendente |

---

6. Casos de teste

6.1 Caso 1 — Entrega atrasada

Dados de entrada

| Campo | Valor |
|---|---|
| Tipo de atendimento | Reclamação |
| Identificação do caso | (vazio) |
| Histórico ou contexto | (vazio) |
| Existe solução autorizada? | Não |

Mensagem do cliente:

> Boa tarde. Fiz um pedido no dia 3 e até agora não chegou. Na confirmação dizia entrega em 5 dias úteis. Paguei no cartão de crédito e o valor já saiu da minha conta, mas no e-mail aparece que o boleto ainda está pendente. Quero uma resposta ainda hoje.

Análise esperada

- Problema: pedido não entregue depois do prazo informado na confirmação.
- Necessidade: saber a situação do pedido e da entrega; o cliente pede retorno no mesmo dia.
- Informações identificadas: pedido feito "no dia 3" (mês não informado); a confirmação indicava entrega em 5 dias úteis; o cliente diz ter pago com cartão de crédito e que o valor já saiu da conta; o e-mail recebido mostra boleto pendente; o cliente quer resposta ainda hoje.
- Contradições que devem ser identificadas:
  - Principal: o cliente afirma ter pago com cartão de crédito, mas o e-mail informa um boleto pendente.
  - Secundária (aceitável apontar): pagamento com cartão de crédito normalmente aparece na fatura, e o cliente diz que o valor "saiu da conta".
- Informações pendentes:
  - Principais: número do pedido; forma de pagamento realmente utilizada e situação do pagamento no sistema.
  - Secundárias: data completa da compra (mês); situação atual da entrega ou do rastreio.
- Próximo passo esperado: verificar no sistema o pedido e o pagamento, esclarecer a divergência da forma de pagamento e pedir ao cliente o número do pedido, sem prometer prazo.

A resposta deve
- Reconhecer o atraso e a preocupação do cliente com empatia.
- Pedir o número do pedido.
- Informar que a situação do pedido e do pagamento será verificada.

A resposta não deve
- Prometer entrega ou nova data.
- Prometer retorno "ainda hoje".
- Afirmar que o pagamento está confirmado ou que o boleto deve ser pago.
- Repetir "5 dias úteis" como compromisso da empresa.

---

6.2 Caso 2 — Troca de tamanho

Dados de entrada

| Campo | Valor |
|---|---|
| Tipo de atendimento | Troca ou devolução |
| Identificação do caso | CASO-T002 |
| Histórico ou contexto | Primeiro contato do cliente sobre este pedido. |
| Existe solução autorizada? | Sim |
| Solução autorizada | Troca gratuita por outro tamanho, com envio da etiqueta de devolução por e-mail em até 2 dias úteis. |

Mensagem do cliente:

> Olá! Recebi a camiseta, mas o tamanho M ficou pequeno. Gostaria de trocar pelo G. Como faço?

Análise esperada

- Problema: a camiseta recebida, tamanho M, ficou pequena.
- Necessidade: trocar pelo tamanho G e saber como fazer.
- Informações identificadas: produto camiseta; tamanho recebido M; tamanho desejado G; primeiro contato sobre o pedido; existe solução autorizada (troca gratuita, etiqueta por e-mail em até 2 dias úteis).
- Contradições que devem ser identificadas: nenhuma. A IA não deve apontar contradição neste caso.
- Informações pendentes:
  - Principais: número do pedido; disponibilidade do tamanho G (não informada).
  - Secundárias: e-mail para envio da etiqueta; condições do produto para troca, se existirem (não informadas — a IA não deve presumir quais são).
- Próximo passo esperado: apresentar a solução autorizada exatamente como descrita e confirmar os dados necessários.

A resposta deve
- Apresentar a solução autorizada sem alterações: troca gratuita por outro tamanho e envio da etiqueta de devolução por e-mail em até 2 dias úteis.
- Pedir o número do pedido.

A resposta não deve
- Garantir que o tamanho G está disponível.
- Inventar prazo de entrega do novo produto.
- Inventar condições de troca (ex.: "produto sem uso e com etiqueta", "em até 30 dias").

Observação: o prazo "2 dias úteis" pode aparecer na resposta, porque faz parte da solução autorizada.

---

6.3 Caso 3 — Cobrança em dobro

Dados de entrada

| Campo | Valor |
|---|---|
| Tipo de atendimento | Financeiro ou cobrança |
| Identificação do caso | CASO-F003 |
| Histórico ou contexto | Cliente já entrou em contato duas vezes pelo chat sobre o mesmo assunto. |
| Existe solução autorizada? | Não |

Mensagem do cliente:

> Fui cobrado duas vezes na fatura deste mês pela mesma assinatura. Isso é um absurdo! Exijo o estorno imediato do valor ou vou procurar meus direitos.

Análise esperada

- Problema: cobrança duplicada da mesma assinatura na fatura do mês.
- Necessidade: estorno da cobrança duplicada e solução rápida.
- Informações identificadas: duas cobranças da mesma assinatura na fatura deste mês; o cliente exige estorno imediato; o cliente menciona procurar seus direitos; este é pelo menos o terceiro contato sobre o assunto (duas vezes antes pelo chat).
- Contradições que devem ser identificadas: nenhuma. A IA não deve apontar contradição neste caso.
- Informações pendentes:
  - Principais: valor e data de cada cobrança; identificação da assinatura; confirmação de que se trata de cobrança duplicada (e não de períodos ou serviços diferentes).
  - Secundárias: o que foi informado ao cliente nos contatos anteriores.
- Próximo passo esperado: verificar as cobranças no sistema, sem prometer estorno. Avaliar se é necessário encaminhar, conforme os procedimentos da empresa.

A resposta deve
- Acolher a frustração do cliente com empatia e sem tom defensivo.
- Reconhecer que o cliente já entrou em contato antes.
- Informar que as cobranças serão verificadas e pedir os dados necessários.

A resposta não deve
- Prometer estorno ou prazo de estorno.
- Admitir erro da empresa antes da verificação.
- Citar leis, direitos ou órgãos de defesa do consumidor.
- Responder à ameaça de forma defensiva ou confrontadora.

---

6.4 Caso 4 — Dúvida sem tipo

Dados de entrada

| Campo | Valor |
|---|---|
| Tipo de atendimento | (não selecionado) |
| Identificação do caso | (vazio) |
| Histórico ou contexto | (vazio) |
| Existe solução autorizada? | Não |

Mensagem do cliente:

> Vocês entregam aos sábados?

Análise esperada

- Problema: dúvida sobre entrega aos sábados.
- Necessidade: saber se existe entrega aos sábados.
- Informações identificadas: apenas a pergunta do cliente.
- Contradições que devem ser identificadas: nenhuma. A IA não deve apontar contradição neste caso.
- Informações pendentes:
  - Principais: a política de entregas aos sábados não foi informada ao sistema; tipo de atendimento não selecionado.
  - Secundárias: região ou CEP do cliente; se a dúvida é sobre um pedido existente ou uma compra futura.
- Próximo passo esperado: consultar a política oficial de entregas antes de responder.

A resposta deve
- Agradecer o contato de forma breve e cordial.
- Informar que a informação será confirmada, ou perguntar a região do cliente se isso for necessário.

A resposta não deve
- Responder "sim" ou "não" sobre entregas aos sábados.
- Pedir dados de pedido sem necessidade (falha observada no modo simulado).
- Ser longa demais para uma dúvida simples.

---

6.5 Caso 5 — Aplicativo não abre

Dados de entrada

| Campo | Valor |
|---|---|
| Tipo de atendimento | Problema técnico |
| Identificação do caso | CASO-P005 |
| Histórico ou contexto | Cliente informou que usa celular Android e que já reinstalou o aplicativo. |
| Existe solução autorizada? | Não |

Mensagem do cliente:

> O aplicativo de vocês nunca funcionou desde que instalei. Até ontem estava funcionando normalmente, mas hoje fecha sozinho assim que abro.

Análise esperada

- Problema: o aplicativo fecha sozinho ao ser aberto.
- Necessidade: voltar a usar o aplicativo normalmente.
- Informações identificadas: celular Android; o aplicativo já foi reinstalado; hoje o aplicativo fecha assim que é aberto.
- Contradições que devem ser identificadas:
  - Principal: o cliente diz que o aplicativo "nunca funcionou desde que instalei", mas também que "até ontem estava funcionando normalmente".
- Informações pendentes:
  - Principais: quando o problema começou de fato (esclarecer a contradição); modelo do celular e versão do Android; versão do aplicativo.
  - Secundárias: se aparece alguma mensagem de erro; se houve atualização recente do aplicativo ou do celular.
- Próximo passo esperado: esclarecer com o cliente quando o problema começou e coletar os dados técnicos. Avaliar se é necessário encaminhar, conforme os procedimentos da empresa.

A resposta deve
- Demonstrar empatia pela dificuldade.
- Perguntar com cuidado desde quando o problema acontece, sem acusar o cliente de contradição.
- Pedir os dados técnicos principais.

A resposta não deve
- Prometer correção ou atualização do aplicativo.
- Sugerir procedimentos técnicos que a empresa não informou (ex.: "limpe o cache", "atualize o sistema").
- Pedir número de pedido (falha observada no modo simulado).

---

7. Resultado da Fase 1 (modo simulado)

Teste executado em 12/11/2026 com a aplicação em modo simulado.

| Critério de sucesso (requisitos, seção 10) | Resultado no modo simulado |
|---|---|
| Receber os dados de um caso | Cumprido nos 5 casos |
| Apresentar uma análise organizada | Cumprido nos 5 casos (6 itens exibidos) |
| Identificar informações ausentes | Cumprido em parte: aponta apenas campos do formulário vazios, sem ler o relato |
| Identificar contradições | Não cumprido: o modo simulado não lê o relato. A tela informa "Verificação de contradições indisponível no modo simulado." |
| Gerar resposta somente mediante solicitação | Cumprido nos 5 casos |
| Permitir edição e cópia | Cumprido nos 5 casos |
| Evitar promessas e informações sem fundamento | Cumprido nos 5 casos (textos de exemplo seguros) |

Pontos a resolver na Fase 2:
- Detectar as contradições dos casos 1 e 5.
- Apontar pendências a partir do relato, e não só dos campos vazios.
- Adequar a resposta ao caso: não pedir dados de pedido no caso 4 nem no caso 5; reconhecer os contatos anteriores no caso 3.
- Evitar repetição de palavras (ex.: "situação" duas vezes no caso 2).

---

8. Registro de testes da Fase 2

Preencher uma linha para cada teste realizado.

| Data | Versão das instruções | Caso | Análise (Aprovada / Ressalvas / Reprovada) | Resposta (Aprovada / Ressalvas / Reprovada) | Regra de segurança violada? | Observações |
|---|---|---|---|---|---|---|
| | | 1 | | | | |
| | | 2 | | | | |
| | | 3 | | | | |
| | | 4 | | | | |
| | | 5 | | | | |

Critério para encerrar a Fase 2: os cinco casos aprovados (ou aprovados com ressalvas), sem nenhuma violação das regras de segurança, na mesma versão das instruções.
