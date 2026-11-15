SMART SUPPORT AI

Guia de demonstração (cerca de 3 minutos)

---

Antes de começar (checklist)

- Feche o arquivo .env no editor e não o mostre na tela em nenhum momento.
- Confira que o .env está com MODO_IA=simulado.
- No terminal, na pasta do projeto: npm start
- Abra http://localhost:3000 no navegador. O selo no topo deve mostrar "Modo simulado".
- Deixe este texto copiado, para colar durante a demonstração (Caso 2, fictício):

  Olá! Recebi a camiseta, mas o tamanho M ficou pequeno. Gostaria de trocar pelo G. Como faço?

- Deixe também a solução autorizada (fictícia):

  Troca gratuita por outro tamanho, com envio da etiqueta de devolução por e-mail em até 2 dias úteis.

Use somente os dados acima. Nunca use nomes, e-mails ou pedidos reais.

---

Roteiro

0:00 a 0:20 · O problema

Fala sugerida: "Atendentes recebem mensagens confusas e precisam responder rápido sem prometer o que a empresa não autorizou. O Smart Support AI é um copiloto: primeiro ele organiza o caso; só depois, se o atendente pedir, sugere uma resposta. A decisão final é sempre do atendente."

Mostrar: o cabeçalho, o selo "Modo simulado" e o aviso de privacidade ("Use apenas casos fictícios…").

0:20 a 0:50 · Cadastro do caso

1. Cole a mensagem do Caso 2 em "Mensagem do cliente". Mostre o contador de caracteres.
2. Tipo de atendimento: "Troca ou devolução".
3. Identificação do caso: CASO-T002.
4. Histórico: "Primeiro contato do cliente sobre este pedido."
5. Em "Existe solução autorizada?", marque "Sim". Mostre que o campo de descrição aparece só agora, e cole a solução autorizada.

Fala sugerida: "A IA só pode usar a solução que estiver escrita aqui. Ela não cria prazos, valores ou políticas."

0:50 a 1:40 · Análise em seis partes

1. Clique em "Analisar caso".
2. Percorra as seis partes: problema, necessidade, informações identificadas, o que precisa ser verificado, contradições e próximo passo sugerido.
3. Aponte o aviso em "Contradições": "Verificação de contradições indisponível no modo simulado."

Fala sugerida: "Esta é a demonstração em modo simulado: o formato é o final, mas o conteúdo é um exemplo montado a partir dos campos. Repare que a resposta ainda não existe: ela não é gerada sozinha."

1:40 a 2:20 · Resposta, edição e cópia

1. Clique em "Gerar resposta".
2. Mostre que o texto usa exatamente a solução autorizada.
3. Edite: troque "[Seu nome]" por "Ana (atendente fictícia)".
4. Clique em "Copiar resposta" e mostre a confirmação "Resposta copiada.".

Opcional (se houver tempo): clique de novo em "Gerar resposta". A tela pede confirmação antes de descartar a edição; clique em "Cancelar" e mostre que o texto editado continua lá.

2:20 a 3:00 · Como foi construído e estado atual

Fala sugerida:
- "O servidor é Node.js com Express; a tela é HTML, CSS e JavaScript puros."
- "Os prompts da IA foram versionados e validados com casos fictícios antes de virar código."
- "O modo é escolhido no servidor: simulado, que é o padrão, ou Gemini. A integração com o Gemini está implementada, com chave só no servidor, sem armazenamento da conversa no Google, sem novas tentativas automáticas e com limite de tempo."
- "Nos testes reais, a API do Gemini respondeu com indisponibilidade por alta demanda e com tempo esgotado. O sistema mostrou mensagens claras e não trocou para o modo simulado escondido. Por isso, a demonstração usa o modo simulado."
- "São 185 testes automáticos, sem internet e sem custo, e uma verificação da tela no navegador."

---

Perguntas prováveis (respostas curtas)

- "A IA lê de verdade a mensagem?" No modo simulado, não: ele demonstra o formato. A leitura real virá com o Gemini ativado.
- "Onde fica a chave da API?" Só no servidor, no arquivo .env, que não é enviado ao navegador nem ao repositório.
- "E se a API cair?" O atendente vê uma mensagem clara, e nada é inventado no lugar.
- "Os dados ficam salvos?" Não. Tudo fica na memória da página e some ao recarregar.

---

Se algo der errado durante a apresentação

- A página não abre: confira se o terminal mostra "Smart Support AI iniciado." e se o endereço é http://localhost:3000.
- O selo não mostra "Modo simulado": pare o servidor (Ctrl + C), confira MODO_IA=simulado no .env sem exibi-lo na tela, e rode npm start de novo.
- A cópia foi bloqueada pelo navegador: o texto já fica selecionado; pressione Ctrl + C.
