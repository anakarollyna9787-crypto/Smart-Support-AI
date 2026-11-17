SMART SUPPORT AI

Fase 3 — Registro de implementação

---

Etapa 3.1 — Prompts no código e montagem do caso

Data: 12/11/2026 · Situação: concluída · Custo: nenhum

1. Objetivo

Preparar, sem custo e sem chamar nenhuma API, as peças que a integração real vai usar:
- os prompts oficiais (Blocos A e B da v2) dentro do código;
- a função que transforma os dados do formulário no bloco <caso> usado pelos prompts;
- testes automáticos que garantem que o código continua igual aos documentos oficiais.

2. Arquivos criados

| Arquivo | O que contém |
|---|---|
| server/prompts.js | PROMPT_VERSAO ('v2'), BLOCO_A_ANALISE e BLOCO_B_RESPOSTA, copiados de Documentação/Prompt_IA_v2.md por um script, sem redigitação |
| server/montar-caso.js | montarCaso(caso) e a lista NOMES_TIPO |
| testes/casos-ficticios.js | Os 5 casos fictícios no formato do formulário |
| testes/prompts-e-casos.test.js | 27 testes automáticos |
| Documentação/Fase3_Implementacao.md | Este registro |

Nenhum arquivo existente foi alterado. A aplicação ainda não usa os arquivos novos: server.js e ia.js continuam iguais, e MODO_IA continua "simulado".

3. Como funciona montarCaso

Recebe os dados do caso (o mesmo objeto produzido por lerCaso() no servidor) e devolve o bloco:

```
<caso>
<tipo_atendimento>...</tipo_atendimento>
<identificacao>...</identificacao>
<historico_contexto>...</historico_contexto>
<solucao_autorizada>...</solucao_autorizada>
<mensagem_cliente>
...
</mensagem_cliente>
</caso>
```

Regras:
- O tipo vira o nome exibido na tela (ex.: 'reclamacao' → "Reclamação"). Tipo vazio ou desconhecido vira "(não selecionado)".
- Campos vazios recebem os mesmos textos usados na Fase 2: "(não informada)", "(não informado)" e "Não há solução autorizada para este caso.".
- A descrição da solução só entra quando a opção é "Sim".
- Quebras de linha do Windows são padronizadas, e os espaços das pontas são removidos.
- Segurança: se o texto digitado contiver uma das marcações do bloco (ex.: </mensagem_cliente>), os sinais < e > dessa marcação são trocados por ‹ e ›. Assim o relato não consegue fechar o bloco nem criar uma "solução autorizada" falsa. Outros usos de < e > (ex.: "R$ 5 < R$ 10") ficam intactos.

4. Como rodar os testes

Na pasta do projeto, no terminal:

```
node --test "testes/*.test.js"
```

Não precisa de internet, chave de API ou instalação. Usa o executor de testes que já vem com o Node.js.

5. Resultados

| Grupo | Testes | Resultado |
|---|---|---|
| 1. Prompts (prompts.js × Prompt_IA_v2.md) | 4 | Todos passaram |
| 2. Casos dos testes × Casos_de_Teste_Fase2.md | 6 | Todos passaram |
| 3. montarCaso × blocos validados na Fase 2 (incluindo segurança) | 15 | Todos passaram |
| 4. A aplicação ainda não usa os arquivos novos | 2 | Todos passaram |
| Total | 27 | 27 passaram |

Verificação de que os testes detectam erros: numa cópia temporária do projeto, foi trocada uma palavra do Bloco A e um texto padrão de montarCaso. Os testes acusaram as duas mudanças (5 falhas, nos pontos esperados). A cópia foi apagada.

Verificação da aplicação: os testes de tela das Etapas 5 a 9 (153 verificações, em modo simulado) foram executados novamente. Uma rodada passou completa (153 de 153). Outras rodadas tiveram de 1 a 3 falhas, cada vez em um ponto diferente, sempre nas confirmações da Etapa 8, sem nenhuma alteração nos arquivos da aplicação. Isso indica instabilidade de tempo nesses testes de tela (que ficam fora do projeto), e não uma mudança de comportamento.

6. Pendências para a Etapa 3.2

- Ligar prompts.js e montarCaso ao servidor, por meio de um novo módulo ia-real.js (requer autorização para instalar o SDK da Anthropic).
- Tornar estáveis os testes de tela da Etapa 8, trocando as esperas fixas por esperas condicionadas ao resultado.
- Opcional: incluir o comando "test" no package.json, para rodar os testes com "npm test" (requer autorização para alterar o package.json).

---

Etapa 3.2 — Estabilização dos testes e preparação da integração

Data: 14/11/2026 · Situação: concluída · Custo: nenhum

1. Parte 1 — Estabilização dos testes de tela

Causa encontrada: os testes de tela rodavam o Edge invisível com "relógio acelerado" (opção --virtual-time-budget). O relógio da página corria mais rápido que o real, enquanto o servidor simulado espera 0,7 s de verdade. Esperas de tempo fixo na página às vezes terminavam antes de o servidor responder. Uma segunda causa apareceu durante a correção: todas as etapas usavam a mesma pasta de perfil do Edge.

Correções (somente nos testes de tela, que ficam fora do projeto; a aplicação não foi alterada):
- A página de teste roda em tempo real e envia o resultado para o servidor de teste ao terminar.
- Cada etapa usa um perfil novo do Edge, e o executor espera o Edge fechar antes de seguir.
- As pastas temporárias de perfil são apagadas com suporte a caminhos longos.
- As 153 verificações e seus critérios foram mantidos.

Resultado: 6 rodadas seguidas de 153/153 após a correção final, e mais uma rodada de 153/153 depois da instalação do SDK.

2. Parte 2 — Preparação da integração

Pacote instalado: @anthropic-ai/sdk 1.8.0 (oficial, gratuito, 0 vulnerabilidades).

Arquivo criado: server/ia-real.js, com a mesma "tomada" do modo simulado:
- analisarCaso(caso): envia o Bloco A + o bloco <caso> e exige o formato garantido da análise (as 6 partes, só com textos).
- gerarResposta(caso, analise): envia a mesma conversa testada no claude.ai (Bloco A + caso, a análise e o Bloco B).

Configurações:

| Item | Valor | Onde mudar |
|---|---|---|
| Modelo | claude-opus-5-5 | MODELO_IA no .env |
| Tempo limite da API | 25 s (abaixo do limite da tela: 30 s na época; atual: 35 s, ver "Ajuste do tempo limite da interface") | TEMPO_LIMITE_IA_MS no .env |
| Novas tentativas automáticas | 0 (para não ultrapassar o limite da tela) | No código |
| Esforço do modelo | medium | No código |
| Recurso de recusa (fallbacks) | Ligado ("default"): se o modelo principal recusar por segurança, a própria API tenta outro modelo | criarIaReal({ usarFallback: false }) |

Proteção da chave:
- A chave só é lida no servidor (ANTHROPIC_API_KEY), e somente no momento do uso.
- Carregar o arquivo não cria cliente nem abre conexão.
- Mensagens para a tela são textos fixos, sem dados técnicos.
- Registros no terminal passam por ocultarSegredos(), que troca a chave por "[chave oculta]".

Erros tratados com mensagem clara: chave ausente, chave inválida (401), sem créditos (402), sem permissão (403), modelo não encontrado (404), tempo esgotado (408 e tempo limite do cliente), conteúdo grande demais (413), limite de uso (429), erro interno e sobrecarga (500 e 529), sem conexão, recusa da IA, resposta cortada, formato inválido, análise incompleta e erro desconhecido.

3. Testes automáticos

Comando: node --test "testes/*.test.js"

| Arquivo | Testes | Resultado |
|---|---|---|
| testes/prompts-e-casos.test.js (Etapa 3.1) | 27 | 27 passaram |
| testes/ia-real.test.js (Etapa 3.2) | 51 | 51 passaram |
| Total | 78 | 78 passaram |

Os testes da IA real usam um "Claude de mentira" e bloqueiam o acesso à internet: se qualquer código tentasse chamar a API, o teste falharia. Nenhuma tentativa de acesso ocorreu.

Verificação de que os testes detectam erros: numa cópia temporária, o filtro da chave e o tratamento de recusa foram desligados. Os testes acusaram as duas mudanças (6 falhas, nos pontos esperados).

4. O que NÃO mudou

- MODO_IA continua "simulado", e não há chave no .env.
- server.js, ia.js e todos os arquivos de public/ não foram alterados. A aplicação ainda não usa ia-real.js.
- Os prompts oficiais não foram alterados.

5. Pontos para a etapa de ativação (3.5)

- Ligar ia-real.js ao ia.js quando MODO_IA=real (alteração no ia.js).
- Revisar os tempos: a IA real pode levar mais de 25 s. Na ativação, avaliar aumentar o limite da tela (30 s na época, em public/app.js) e o da API juntos. Atualização: o limite da tela passou para 35 s, ver "Ajuste do tempo limite da interface".
- O recurso de recusa, quando acionado, cobra a resposta pelo preço do modelo que respondeu.

---

Preparação técnica da integração com o Google Gemini

Data: 14/11/2026 · Situação: concluída (sem ativação) · Custo: nenhum

1. Objetivo

Preparar uma integração real com o Google Gemini, testada com simulações, sem conta, sem chave, sem chamadas reais e com a aplicação em modo simulado. A integração com a Anthropic não foi ativada nem alterada.

2. Pacote e modelo

| Item | Valor | Fonte |
|---|---|---|
| SDK oficial | @google/genai 3.3.0 (0 vulnerabilidades) | Página oficial de bibliotecas (o pacote antigo @google/generativeai está descontinuado) |
| Modelo padrão | gemini-3.8-flash (estável) | Página oficial de modelos |
| Saída estruturada JSON | Suportada pelo gemini-3.8-flash | Página oficial do modelo ("Structured outputs: Supported") |
| Raciocínio | Suportado (low, medium, high); usado: medium | Página oficial do modelo |
| Alternativa configurável | gemini-3.6-flash (MODELO_GEMINI no .env) | Página oficial de modelos |

3. PENDENTE de confirmação na conta Google, antes de qualquer ativação

- Disponibilidade do gemini-3.8-flash no nível gratuito para esta conta e região. A página de preços lista o modelo no nível gratuito, mas isso não foi confirmado em uma conta, e a disponibilidade pode variar.
- Limites do nível gratuito (pedidos por minuto e por dia) para o modelo escolhido.
- Uso dos dados: no nível gratuito, o Google informa que o conteúdo enviado é usado para melhorar seus produtos. Por isso, somente casos fictícios podem ser usados.
- Chave inválida respondida como erro 400 (API_KEY_INVALID): o tratamento segue o comportamento conhecido da API e deve ser confirmado no primeiro teste real.

4. Decisões técnicas (confirmadas no código do SDK instalado)

| Decisão | Motivo |
|---|---|
| Interactions API (ai.interactions.create) | É a API documentada atualmente pelo Google |
| store: false em todo pedido | Por padrão o Google guarda as conversas (1 dia no nível gratuito); o documento de requisitos proíbe armazenar histórico |
| automatic_continuation: false | Evita vários pedidos seguidos para uma mesma resposta |
| retries: { strategy: 'none' } | Sem isso, um único travamento gerou 5 pedidos e levou 8,5 s com limite de 0,3 s (medido numa sonda sem rede) |
| Tempo limite de 25 s (TEMPO_LIMITE_IA_MS) | Abaixo do limite da tela (30 s na época; atual: 35 s, ver "Ajuste do tempo limite da interface") |
| response_format com o esquema das 6 partes | Campo atual; response_mime_type está marcado como obsoleto |
| Erros reconhecidos pelo código HTTP e pelo nome | O SDK só exporta a classe ApiError |
| Chave enviada pelo SDK no cabeçalho x-goog-api-key | Confirmado: a chave não vai na URL nem no corpo |

5. Arquivos

| Arquivo | Situação |
|---|---|
| server/ia-comum.js | Criado: mensagens, formato da análise, conferência e filtro de segredos (Google e Anthropic). Usado só pelo ia-gemini.js |
| server/ia-gemini.js | Criado: analisarCaso e gerarResposta com o Gemini |
| testes/ia-gemini.test.js | Criado: 52 testes |
| package.json / package-lock.json | Alterados pela instalação do @google/genai |

Sem alteração: ia.js, server.js, ia-real.js, public/, .env, prompts.js, montar-caso.js e os casos fictícios.

6. Testes

Os testes usam o SDK verdadeiro com uma "rede falsa": cada teste define a resposta que o servidor do Google daria, e o próprio SDK produz o resultado ou o erro. Qualquer acesso fora da rede falsa é bloqueado e conta como falha.

| Grupo | Testes |
|---|---|
| Respostas válidas e formato do pedido (store=false, JSON, conversa, chave no cabeçalho) | 8 |
| Chave ausente, inválida (401 e 400 API_KEY_INVALID) e sem permissão | 6 |
| Limite 429 sem novas tentativas, 500, 503, 502 em HTML, 504, timeout, sem conexão, 404, 400, 413, erro desconhecido | 12 |
| Bloqueio de segurança, respostas incompletas, situações inesperadas e formatos inválidos | 14 |
| Proteção da chave (tela, terminal, resultados, código) | 8 |
| Aplicação, modo simulado e Anthropic inalterados | 4 |
| Total | 52 (todos passaram) |

Prova de que os testes detectam erros: numa cópia temporária, quatro sabotagens (store=true, novas tentativas religadas, filtro da chave desligado, bloqueio não reconhecido) foram todas detectadas.

Resultado geral: 130/130 testes automáticos (27 + 51 + 52) e 153/153 testes de tela.

7. Observações

- O npm não executou o script automático de instalação de uma dependência interna (protobufjs), por uma proteção do próprio npm. Os 52 testes com o SDK passaram, então isso não afetou o uso.
- Os prompts v2 foram validados com o Claude. Na ativação do Gemini, os 5 casos fictícios precisam ser testados novamente.
- O ia-real.js (Anthropic) não foi alterado para usar o ia-comum.js. Essa unificação pode ser feita depois, com autorização.
- A ativação exigirá ligar o ia-gemini.js ao ia.js (ex.: MODO_IA=gemini) e revisar os tempos limite da tela e da API.

---

Ajuste do tempo limite da interface

Data: 14/11/2026 · Situação: concluída · Custo: nenhum

1. Objetivo

Dar uma margem maior entre o limite da API Gemini e o limite da tela, para que a tela não desista do pedido antes do servidor. Assim, quando a API demora demais, o atendente recebe a mensagem específica do servidor ("O serviço de IA demorou demais para responder…"), e não a mensagem genérica da tela.

2. Alteração

| Item | Antes | Depois | Onde |
|---|---|---|---|
| Tempo limite da tela (TEMPO_LIMITE_MS) | 30 s (30000 ms) | 35 s (35000 ms) | public/app.js |
| Tempo limite de cada chamada à API Gemini | 25 s | 25 s (sem alteração) | server/ia-gemini.js (TEMPO_LIMITE_PADRAO_MS) |
| Margem entre a API e a tela | 5 s | 10 s | — |

As menções a "30 s" nas etapas acima foram mantidas como registro histórico e marcadas como "30 s na época", com remissão a esta seção. Os comentários correspondentes em server/ia-gemini.js e server/ia-real.js também passaram a citar os 35 s da tela (revisão textual, sem mudança de comportamento). O aviso "Ainda processando…" continua aparecendo depois de 8 s.

3. Arquivos

| Arquivo | Situação |
|---|---|
| public/app.js | Alterado: TEMPO_LIMITE_MS de 30000 para 35000 (e o comentário da linha) |
| testes/ia-modos.test.js | Alterado: 1 teste novo no grupo "8. Interface e .env" |
| Documentação/Fase3_Implementacao.md | Este registro |

Sem alteração: server/ia-gemini.js, server/ia.js, server/server.js, server/ia-comum.js, server/ia-real.js, os prompts oficiais v2, montar-caso.js, os demais arquivos de public/ e o .env. O modo simulado e a seleção entre "simulado" e "gemini" (MODO_IA) não foram alterados.

4. Teste novo

"tempo limite da tela é 35 s e fica 10 s acima do limite de 25 s da API Gemini" confere que:
- TEMPO_LIMITE_MS vale 35000 em public/app.js e é o valor usado para encerrar o pedido da tela;
- o limite padrão da API Gemini continua em 25000 ms, inclusive na integração criada no modo gemini;
- a tela espera pelo menos 10 s a mais que a API.

5. Resultados

Comando: node --test "testes/*.test.js"

| Arquivo | Testes | Resultado |
|---|---|---|
| testes/prompts-e-casos.test.js | 27 | 27 passaram |
| testes/ia-real.test.js | 51 | 51 passaram |
| testes/ia-gemini.test.js | 66 | 66 passaram |
| testes/ia-modos.test.js (seleção de modo + teste novo) | 41 | 41 passaram |
| Total | 185 | 185 passaram (184 existentes + 1 novo), 0 falhas |

Confirmações:
- Modo simulado: os testes do grupo "2. Modo simulado continua igual" e o servidor em MODO_IA=simulado passaram.
- Gemini selecionável: os testes com MODO_IA=gemini (integração, modelo gemini-3.8-flash, falta de chave, erros e servidor HTTP) passaram com a rede falsa.
- Nenhuma chamada real: todos os acessos fora do servidor de teste local são bloqueados e contados como falha; nenhum ocorreu.
- Nenhuma chave criada ou alterada: o .env ficou idêntico antes e depois (conferido por resumo SHA-256, sem exibir o conteúdo) e continua com MODO_IA=simulado.

---

Seleção de modo (simulado / gemini)

Data: 14/11/2026 · Situação: concluída · Custo: nenhum

1. Como funciona

O modo é escolhido por MODO_IA no .env e lido uma vez, quando o servidor inicia:

| MODO_IA | Comportamento |
|---|---|
| ausente, vazio ou simulado | Modo simulado (padrão). O ia-gemini.js nem é carregado |
| gemini | server/ia.js usa server/ia-gemini.js, sempre com o modelo gemini-3.8-flash (MODELO_GEMINI do .env é ignorado neste modo) |
| qualquer outro valor (ex.: real) | Erro claro: "O modo de IA configurado não é válido…". Nenhuma integração é carregada |

Regras garantidas:
- A integração Anthropic (ia-real.js) não é carregada em nenhum modo.
- GEMINI_API_KEY é lida só no servidor. A tela nunca recebe a chave.
- Sem chave no modo gemini: mensagem de configuração na tela e no terminal, e nenhuma chamada.
- Sem troca silenciosa: se o Gemini falhar, o atendente vê o erro, e nunca uma análise simulada no lugar.
- Análise primeiro; resposta só pelo botão "Gerar resposta". Cada clique gera no máximo um pedido (sem novas tentativas automáticas, store: false, limite de 25 s).

2. Arquivos

| Arquivo | Alteração |
|---|---|
| server/ia.js | Escolha do modo, situacaoConfiguracao() e uso do ia-gemini.js no modo gemini. Funções simuladas sem alteração |
| server/server.js | /api/status informa modoIA, configuracaoOk, modelo (no modo gemini) e erroConfiguracao (sem valores secretos); aviso no terminal ao iniciar; servidor exportado para os testes |
| public/app.js | Selo "Modo simulado" / "Modo Gemini" e aviso de configuração incompleta |
| testes/ia-modos.test.js | Criado (seleção de modo, servidor HTTP nos dois modos, proteção da chave) |
| testes/*.test.js | Os testes que exigiam MODO_IA=simulado no .env passaram a definir o modo dentro do próprio teste; o resultado não depende mais do .env |

Prova de que os testes detectam erros: numa cópia temporária, o ia.js foi alterado para devolver a análise simulada quando o Gemini falha. 19 testes acusaram a troca silenciosa. A cópia foi apagada.

---

Testes reais com o Gemini

Data: 14/11/2026 · Chamadas reais: 2 (nenhuma bem-sucedida)

Para cada tentativa, MODO_IA foi trocado para gemini só durante o teste e voltou para simulado em seguida. Foi enviado somente o Caso 1 fictício (Entrega atrasada), apenas para a análise.

| Tentativa | Resultado da API | O que a tela recebeu | Tempo |
|---|---|---|---|
| 1 | 503: "gemini-3.8-flash is currently experiencing high demand… Please try again later." | HTTP 500: "O serviço de IA está indisponível no momento. Tente novamente em instantes." | 4,4 s |
| 2 (após 5 min) | Sem resposta dentro do limite (APIConnectionTimeoutError) | HTTP 500: "O serviço de IA demorou demais para responder. Tente novamente." | 25,3 s |

Conclusões:
- A chave foi aceita, porque nenhuma das respostas foi de autenticação (401/403) nem de cota (429).
- O tratamento de erros funcionou como projetado: mensagem clara, um único pedido, nenhuma troca para o modo simulado e nenhuma chave nos registros (conferido sem exibi-los).
- A geração de resposta com o Gemini não foi testada, porque depende de uma análise bem-sucedida.
- Na tentativa 2, o pedido foi encerrado do nosso lado; o Google pode tê-lo processado e contado mesmo assim.

---

Estado do MVP (encerramento para portfólio)

Data: 14/11/2026

1. Situação

- A aplicação funciona de ponta a ponta no modo simulado, que é o modo ativo (MODO_IA=simulado).
- A integração com o Gemini está implementada, testada com simulações e desativada. Ela nunca produziu uma análise real, por instabilidade da API (503 e tempo esgotado).
- A integração com a Anthropic (ia-real.js) está implementada e testada com simulações, mas não está ligada ao servidor.

2. Testes automáticos

Comando: node --test "testes/*.test.js" (sem internet, sem chave e sem custo)

| Arquivo | Testes | Resultado |
|---|---|---|
| testes/prompts-e-casos.test.js | 27 | 27 passaram |
| testes/ia-real.test.js | 51 | 51 passaram |
| testes/ia-gemini.test.js | 66 | 66 passaram |
| testes/ia-modos.test.js | 41 | 41 passaram |
| Total | 185 | 185 passaram, 0 falhas |

A suíte também passou com MODO_IA=gemini no ambiente do processo, o que confirma que ela não depende do valor do .env.

3. Verificação da tela (Edge invisível, modo simulado, Caso 2 fictício)

33 de 33 verificações aprovadas:
- Preenchimento: mensagem obrigatória, contador de caracteres, campo "Descreva a solução" só com "Sim".
- Análise nas 6 partes, com aviso de modo simulado e uso da solução autorizada.
- Contradições: aviso "Verificação de contradições indisponível no modo simulado." e texto de ajuda.
- A resposta não é gerada sozinha; aparece só após o clique em "Gerar resposta".
- Edição e cópia: o texto copiado é o editado.
- Proteções: confirmação antes de descartar uma resposta editada; análise marcada como desatualizada quando o caso muda; "Limpar campos" volta ao início.
- A tela só fala com o próprio servidor (/api).

Observação: num navegador sem foco, a cópia automática é bloqueada e a tela mostra o plano B ("O texto está selecionado: pressione Ctrl + C."), como projetado.

Pela API, os 5 casos fictícios geraram análise (6 partes) e resposta simuladas, e "gerar resposta" sem análise foi recusado (HTTP 400).

4. Limitações conhecidas

- Modo simulado: a análise e a resposta são exemplos montados a partir dos campos do formulário; o texto da mensagem não é interpretado, e as contradições não são verificadas.
- Gemini: nenhuma análise real foi obtida até agora (503 por alta demanda e tempo esgotado em 25 s). A qualidade das respostas do Gemini com os prompts v2 ainda não foi avaliada; os prompts foram validados com o Claude.
- Nível gratuito do Gemini: o Google pode usar o conteúdo enviado para melhorar seus produtos. Por isso, só casos fictícios podem ser usados.
- Sem histórico, sem login e sem banco de dados: tudo fica na memória da página e some ao recarregar (regra de privacidade).
- O projeto ainda não é um repositório git; a proteção do .env pelo .gitignore só passa a valer após o git init.
- Não há o comando "npm test"; os testes rodam com node --test "testes/*.test.js".

5. Pendências para a futura ativação do Gemini

- Confirmar na conta Google a disponibilidade do gemini-3.8-flash e os limites do nível gratuito.
- Com autorização, decidir entre: nova tentativa única em outro horário; limite da API maior (até cerca de 30 s, abaixo dos 35 s da tela); ou nível de raciocínio "low" em vez de "medium".
- Obter uma análise e uma resposta reais com o Caso 1 e, depois, testar os 5 casos fictícios e comparar com a validação feita com o Claude (Relatorio_Validacao_Prompt_v2.md).
- Confirmar no primeiro sucesso o tratamento de chave inválida (400 API_KEY_INVALID), ainda baseado na documentação.
- Iniciar o repositório git antes de publicar o projeto, conferindo que o .env não entra no envio.

---

Selo da análise (proteção da geração de resposta)

Data: 16/11/2026 · Situação: implementada localmente (sem publicação) · Custo: nenhum

Problema: a rota /api/gerar-resposta recebia a análise de volta do navegador e a enviava à IA como mensagem "assistant" (como se a própria IA a tivesse escrito). Formato e tamanho eram conferidos, mas o conteúdo podia ser adulterado: alguém poderia colocar instruções nos campos da análise e usar a cota da IA para gerar outro tipo de texto.

Solução: o servidor assina a análise que ele mesmo gerou e só aceita, na geração da resposta, a análise com assinatura válida (arquivo server/selo-analise.js).

- Em /api/analisar, depois de conferir a análise, o servidor calcula um HMAC-SHA256 do caso normalizado + as 6 partes da análise + o modo da IA + a expiração, e devolve o campo "selo" junto com a análise.
- Em /api/gerar-resposta, antes dos limites de uso, o servidor recalcula a assinatura com o caso e a análise recebidos e compara em tempo constante. Qualquer diferença (uma letra, um item a mais, outra ordem, outro caso, outro modo, prazo vencido) é recusada com HTTP 400: "Não foi possível confirmar a análise. Analise o caso novamente antes de gerar a resposta." A IA não é chamada e nenhuma cota é gasta.
- Formato do selo: "v1.<expiração>.<assinatura>" (cerca de 60 caracteres). Ele não contém nenhum texto do caso, e nada é guardado no servidor: sem banco, sem cache e sem sessão.
- Validade: 30 minutos. Gerar a resposta de novo com o mesmo selo continua permitido (cada geração conta no limite, como antes).
- Segredo: aleatório, criado quando o servidor inicia e mantido só na memória. Nenhuma variável de ambiente nova.
- Tela: nenhuma mudança. O selo viaja dentro da análise que a tela já guarda e reenvia.

Efeito conhecido: quando o serviço reinicia (deploy, hibernação do plano gratuito do Render), os selos antigos deixam de valer. Quem estiver no meio de um caso vê a mensagem acima e precisa analisar o caso de novo (uma chamada a mais). Se um dia houver mais de uma instância do servidor, será preciso um segredo compartilhado (variável de ambiente, com autorização).

Risco que continua: a análise legítima é escrita pela IA, que pode ter sido influenciada por instruções escondidas na mensagem do cliente. Isso continua a cargo das regras dos Blocos A e B (prompts v2).

Testes: testes/selo-analise.test.js (83 testes): selo válido, todas as alterações da análise (inclusive instruções maliciosas nos 6 campos), caso trocado, selo ausente, malformado, forjado, de outro caso, expirado, de outra instância e de outro modo, limites de uso preservados e nada no terminal. Os testes que enviam análises diretamente (protecao.test.js e ia-modos.test.js) passaram a usar o selo do servidor de teste.

Prova de que os testes detectam erros: com uma versão sabotada do selo (que aceita qualquer coisa), 73 dos 83 testes falharam; os 10 restantes conferem o fluxo válido e o formato.

---

Estado atual

Data: 16/11/2026

Esta seção substitui, como retrato atual, a seção "Estado do MVP" de 14/11/2026 (mantida acima como registro histórico).

1. Situação

- A aplicação funciona de ponta a ponta no modo simulado, que continua sendo o modo ativo (MODO_IA=simulado), localmente e no Render.
- Groq: integração implementada e testada só com simulações (rede falsa). Ainda não foi ativada e nunca fez uma chamada real.
- Gemini: integração implementada e desativada; nenhuma análise real foi obtida (503 e tempo esgotado).
- Anthropic (ia-real.js): implementada e testada com simulações, mas não está ligada ao servidor.
- Proteção da demonstração pública (server/protecao.js): limite por visitante (6 chamadas a cada 10 minutos e 20 por dia), limite global (200 por dia), máximo de 2 chamadas simultâneas e limites de tamanho das entradas e da análise.
- Identificação do visitante (server/ip-visitante.js): variável FONTE_IP. No Render, req.ip é um endereço interno, por isso o Render deve usar FONTE_IP=cloudflare (CF-Connecting-IP validado). A mudança está publicada no GitHub, mas FONTE_IP ainda não foi cadastrada no Render: até lá, o limite por visitante não funciona lá. Roteiro de validação: Guia_Demonstracao.md.
- Selo da análise (server/selo-analise.js): implementado localmente, ainda sem publicação (ver seção anterior).

2. Testes automáticos

Comando: npm test (sem internet, sem chave e sem custo)

| Arquivo | Testes | Resultado |
|---|---|---|
| testes/prompts-e-casos.test.js | 27 | 27 passaram |
| testes/ia-real.test.js | 51 | 51 passaram |
| testes/ia-gemini.test.js | 66 | 66 passaram |
| testes/ia-groq.test.js | 69 | 69 passaram |
| testes/ia-modos.test.js | 59 | 59 passaram |
| testes/protecao.test.js | 74 | 74 passaram |
| testes/ip-visitante.test.js | 99 | 99 passaram |
| testes/selo-analise.test.js | 83 | 83 passaram |
| testes/diagnostico-ip.test.js | 37 | 37 passaram |
| Total | 565 | 565 passaram, 0 falhas |

3. Itens do estado de 14/11/2026 já resolvidos

- O projeto agora é um repositório git, publicado no GitHub, com o .env protegido pelo .gitignore.
- O comando "npm test" existe e roda todos os testes.

4. Limitações conhecidas

- Modo simulado: a análise e a resposta são exemplos montados a partir dos campos do formulário; o texto da mensagem não é interpretado e as contradições não são verificadas.
- Os prompts v2 foram validados com o Claude, não com o modelo da Groq (openai/gpt-oss-120b). A qualidade com a Groq ainda não foi avaliada.
- Cada caso completo usa 2 chamadas do limite por visitante (análise e resposta). Com o limite de 6, o 4º caso seguido é bloqueado.
- Os contadores de uso e o segredo do selo ficam só na memória: zeram quando o serviço reinicia (deploy ou hibernação do plano gratuito do Render).
- Sem histórico, sem login e sem banco de dados: tudo fica na memória da página e some ao recarregar (regra de privacidade).

5. Pendências antes de ativar a Groq

- Publicar o selo da análise (commit e push autorizados).
- Cadastrar FONTE_IP=cloudflare no Render e seguir a validação do Guia_Demonstracao.md, em modo simulado.
- Remover DIAGNOSTICO_IP_TOKEN do Render depois da validação e, depois, o arquivo server/diagnostico-ip.js e seus testes.
- Conferir no console da Groq os limites do nível gratuito do openai/gpt-oss-120b e a retenção de dados, e ajustar LIMITE_GLOBAL_DIA se necessário.
- Com autorização, testar os casos fictícios com a Groq e comparar com a validação feita com o Claude (Relatorio_Validacao_Prompt_v2.md).
