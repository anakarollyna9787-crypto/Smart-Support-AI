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

---

Site público com IA real (Groq) no Render

Este roteiro é para quando a publicação com a Groq for autorizada. Nada aqui deve ser feito sem essa autorização.

Pré-requisitos

- O código com a Groq e a proteção (server/ia-groq.js, server/protecao.js e as demais alterações) precisa estar no GitHub, porque o Render publica a partir do repositório. Isso exige commit e push autorizados.
- Antes do push, rode npm test na pasta do projeto. Todos os testes devem passar (nenhum faz chamada real).
- Na conta da Groq: mantenha o plano gratuito, sem cartão cadastrado (assim, o pior caso é o limite da Groq, nunca uma cobrança). Confira também, no painel da Groq, as opções de controle e retenção de dados e ative a retenção zero se ela estiver disponível para a conta.

Variáveis de ambiente no Render (Environment)

- MODO_IA = groq
- GROQ_API_KEY = a chave da Groq. Cadastre só no painel do Render. Nunca coloque a chave em arquivos do repositório, em render.yaml, em prints ou em mensagens.
- Os limites já têm os valores aprovados como padrão e não precisam ser cadastrados. Só cadastre se quiser trocar algum: LIMITE_IP_JANELA (6), JANELA_IP_MS (600000 = 10 min), LIMITE_IP_DIA (20), LIMITE_GLOBAL_DIA (200), LIMITE_SIMULTANEAS (2).
- PROXIES_CONFIAVEIS: não cadastre (o padrão é 1). Só mude se a validação abaixo indicar. Valores aceitos: números de 0 a 10. Qualquer outro valor (inclusive "true") é ignorado e vale 1.

Como validar o IP real no Render (sem custo, ANTES de ativar a Groq)

Os limites valem também no modo simulado. Por isso, dá para validar tudo com MODO_IA=simulado, sem gastar nenhuma chamada da Groq. O servidor não registra IPs; a validação é feita pelo comportamento dos limites.

1. Publique com MODO_IA=simulado e sem PROXIES_CONFIAVEIS.
2. No computador (rede Wi-Fi), faça 6 análises seguidas no site. A 7ª deve mostrar: "Você atingiu o limite da demonstração: até 6 chamadas a cada 10 minutos."
3. Ao mesmo tempo, no celular usando dados móveis (Wi-Fi desligado), faça uma análise. Ela deve funcionar.
   - Se o celular também estiver bloqueado, o servidor está enxergando o IP de um proxy do Render (todos os visitantes dividiriam a mesma cota). Cadastre PROXIES_CONFIAVEIS=2, aguarde o reinício do serviço e repita do passo 2.
4. Com o computador ainda bloqueado, tente "inventar" outro IP. No Git Bash, troque SEU-SITE pelo endereço do site:

   curl -s -X POST https://SEU-SITE.onrender.com/api/analisar -H "Content-Type: application/json" -H "X-Forwarded-For: 198.51.100.7" --data '{"mensagem":"teste ficticio"}'

   A resposta deve continuar sendo o aviso de limite. Se vier uma análise, o servidor está confiando em proxies demais (o visitante conseguiria escapar do limite): diminua PROXIES_CONFIAVEIS (de 2 para 1) e repita.
5. Os contadores ficam na memória e zeram quando o serviço reinicia. Depois da validação, reinicie o serviço no Render (ou aguarde 10 minutos) para começar do zero.

Ativando a Groq

1. Com a validação concluída, troque MODO_IA para groq e cadastre GROQ_API_KEY.
2. Abra o site: o selo deve mostrar "IA real · Groq" e o aviso azul deve informar que é IA real, com o limite da demonstração.
3. Faça um único caso fictício (este guia, Caso 2) para conferir a análise e a resposta. Essa é a primeira chamada real e só deve ser feita com autorização.
4. Confira os registros (Logs) do Render: devem aparecer só linhas técnicas (modo, limites, códigos de erro). Nenhuma chave, IP ou texto do caso.

Voltar para o modo simulado (plano B, sem novo deploy)

- No painel do Render, troque MODO_IA para simulado e salve. O serviço reinicia sozinho em cerca de 1 minuto.
- A chave da Groq pode continuar cadastrada (ela não é usada no modo simulado) ou ser removida.
- O modo Gemini continua disponível do mesmo jeito (MODO_IA=gemini e GEMINI_API_KEY).

Limites da proteção (o que ela não cobre)

- Os contadores ficam na memória do servidor: zeram a cada reinício (deploy, troca de variável ou "hibernação" do plano gratuito do Render).
- Os limites contam por IP. Quem troca de rede (por exemplo, de Wi-Fi para dados móveis) ganha uma nova cota de visitante; o limite global diário de 200 chamadas é a barreira final.
- Visitantes atrás da mesma rede (empresa, universidade) dividem a mesma cota por IP.
- Com mais de uma instância do serviço, cada uma teria contadores próprios. O plano atual usa uma única instância.
