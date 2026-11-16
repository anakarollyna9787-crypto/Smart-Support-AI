// ============================================================
// Smart Support AI - Módulo da inteligência artificial
// Este é o ÚNICO arquivo que o servidor usa para a IA.
//
// O modo vem de MODO_IA no .env:
// - simulado (padrão): conteúdos de exemplo, sem API e sem custo;
// - gemini: Google Gemini, por meio de server/ia-gemini.js;
// - groq: Groq, por meio de server/ia-groq.js.
// Qualquer outro valor é recusado com uma mensagem clara.
// Não há troca silenciosa de modo: se o Gemini ou a Groq falharem, o erro é mostrado.
// A integração Anthropic (ia-real.js) não é carregada.
// ============================================================

// Lê o modo do .env (sem diferenciar maiúsculas; vazio = simulado).
function lerModo(valor) {
  const modo = typeof valor === 'string' ? valor.trim().toLowerCase() : '';
  return modo || 'simulado';
}
const MODO_IA = lerModo(process.env.MODO_IA);

// Modelo oficial do Gemini (fixo; MODELO_GEMINI do .env não é usado neste modo).
const MODELO_GEMINI = 'gemini-3.8-flash';

// Modelo oficial da Groq (fixo; compatível com saída estruturada estrita).
const MODELO_GROQ = 'openai/gpt-oss-120b';

const MSG_MODO_INVALIDO = 'O modo de IA configurado não é válido. Use MODO_IA=simulado, MODO_IA=gemini ou MODO_IA=groq no arquivo .env e reinicie o servidor.';

// A integração Gemini só é carregada no modo gemini, no primeiro uso.
let iaGemini = null;
function obterIaGemini() {
  if (!iaGemini) {
    const { criarIaGemini } = require('./ia-gemini');
    iaGemini = criarIaGemini({ modelo: MODELO_GEMINI });
  }
  return iaGemini;
}

// A integração Groq só é carregada no modo groq, no primeiro uso.
let iaGroq = null;
function obterIaGroq() {
  if (!iaGroq) {
    const { criarIaGroq } = require('./ia-groq');
    iaGroq = criarIaGroq({ modelo: MODELO_GROQ });
  }
  return iaGroq;
}

// Diz se a configuração do modo atual está completa (sem revelar valores).
function situacaoConfiguracao() {
  if (MODO_IA === 'simulado') return { ok: true };
  if (MODO_IA === 'gemini') {
    const chave = process.env.GEMINI_API_KEY;
    if (typeof chave === 'string' && chave.trim()) return { ok: true };
    return { ok: false, mensagem: require('./ia-gemini').MENSAGENS.semChave };
  }
  if (MODO_IA === 'groq') {
    const chave = process.env.GROQ_API_KEY;
    if (typeof chave === 'string' && chave.trim()) return { ok: true };
    return { ok: false, mensagem: require('./ia-groq').MENSAGENS.semChave };
  }
  return { ok: false, mensagem: MSG_MODO_INVALIDO };
}

// Nomes legíveis dos tipos de atendimento (iguais aos da tela).
const NOMES_TIPO = {
  'duvida': 'Dúvida',
  'reclamacao': 'Reclamação',
  'solicitacao': 'Solicitação',
  'problema-tecnico': 'Problema técnico',
  'financeiro': 'Financeiro ou cobrança',
  'troca-devolucao': 'Troca ou devolução',
  'cancelamento': 'Cancelamento',
  'outro': 'Outro',
};

// Cria um erro cuja mensagem pode ser mostrada ao atendente na tela.
function erroAmigavel(mensagem) {
  const erro = new Error(mensagem);
  erro.amigavel = true;
  return erro;
}

// Pequena espera, para imitar o tempo de resposta de uma IA real.
function esperar(milissegundos) {
  return new Promise((resolver) => setTimeout(resolver, milissegundos));
}

// Monta uma análise de EXEMPLO a partir dos campos preenchidos.
// Ela não interpreta o texto da mensagem; só demonstra o formato final.
function analiseSimulada(caso) {
  const tipo = NOMES_TIPO[caso.tipo];
  const temSolucao = caso.solucao === 'sim';

  // 3. Informações identificadas
  const identificadas = [`Mensagem do cliente recebida (${caso.mensagem.length} caracteres).`];
  if (tipo) identificadas.push(`Tipo de atendimento: ${tipo}.`);
  if (caso.identificacao) identificadas.push(`Identificação do caso: ${caso.identificacao}.`);
  if (caso.contexto) identificadas.push('Histórico ou contexto adicional foi informado.');
  identificadas.push(temSolucao
    ? `Solução autorizada informada: ${caso.descricaoSolucao}`
    : 'Não há solução autorizada para este caso.');

  // 4. Informações que precisam ser verificadas
  const pendentes = [];
  if (!tipo) pendentes.push('O tipo de atendimento não foi selecionado.');
  if (!caso.identificacao) pendentes.push('O caso não tem identificação, o que dificulta o acompanhamento.');
  if (!caso.contexto) pendentes.push('Não há histórico. Confirme se o cliente já fez contatos anteriores.');
  pendentes.push('Confirme os dados do pedido ou serviço citado pelo cliente.');

  return {
    simulado: true,
    problema: tipo
      ? `Exemplo: caso do tipo "${tipo}". Com a IA real, aqui aparecerá o problema principal descrito pelo cliente.`
      : 'Exemplo: com a IA real, aqui aparecerá o problema principal descrito pelo cliente.',
    necessidade: 'Exemplo: com a IA real, aqui aparecerá o que o cliente espera receber como solução ou retorno.',
    informacoesIdentificadas: identificadas,
    informacoesPendentes: pendentes,
    contradicoes: [], // o modo simulado não consegue detectar contradições reais
    proximoPasso: temSolucao
      ? 'Apresentar ao cliente a solução autorizada, exatamente como foi descrita, e confirmar se ela atende à necessidade dele.'
      : 'Responder com acolhimento, informar que o caso será verificado e solicitar as informações pendentes. Não prometer prazos nem resultados.',
  };
}

// Frases de abertura conforme o tipo de atendimento.
const ABERTURAS = {
  'reclamacao': 'Lamento pelo transtorno e agradeço por nos avisar sobre o que aconteceu.',
  'problema-tecnico': 'Sinto muito pela dificuldade. Entendo como isso atrapalha a sua rotina.',
  'financeiro': 'Entendo a sua preocupação com essa questão financeira e agradeço por nos procurar.',
  'cancelamento': 'Recebi o seu pedido e agradeço por nos explicar o motivo.',
  'troca-devolucao': 'Recebi a sua solicitação e agradeço por nos explicar a situação.',
  'duvida': 'Obrigado pela sua pergunta. Será um prazer ajudar.',
  'solicitacao': 'Recebi a sua solicitação e agradeço pelo contato.',
};
const ABERTURA_PADRAO = 'Obrigado por entrar em contato e por explicar a situação.';

// Monta uma resposta de EXEMPLO. Ela só usa o que o atendente informou:
// nunca cria prazos, valores ou soluções por conta própria.
function respostaSimulada(caso) {
  const partes = ['Olá!', ABERTURAS[caso.tipo] || ABERTURA_PADRAO];

  if (caso.solucao === 'sim') {
    partes.push(`Para resolver a sua situação, podemos oferecer o seguinte: ${caso.descricaoSolucao}`);
    partes.push('Se tiver qualquer dúvida sobre essa solução, é só me avisar.');
  } else {
    partes.push('Vou verificar o seu caso com atenção. Para isso, poderia me confirmar os dados do pedido ou do serviço mencionado?');
    partes.push('Com essas informações, consigo analisar a situação e orientar você sobre os próximos passos.');
  }

  partes.push('Fico à disposição.');
  partes.push('Atenciosamente,\n[Seu nome]');
  return { simulado: true, texto: partes.join('\n\n') };
}

// Função usada pelo servidor para gerar a resposta (somente após a análise).
async function gerarResposta(caso, analise) {
  if (MODO_IA === 'simulado') {
    await esperar(700);
    return respostaSimulada(caso, analise);
  }
  if (MODO_IA === 'gemini') return obterIaGemini().gerarResposta(caso, analise);
  if (MODO_IA === 'groq') return obterIaGroq().gerarResposta(caso, analise);
  throw erroAmigavel(MSG_MODO_INVALIDO);
}

// Função usada pelo servidor. Decide o que fazer conforme o modo da IA.
async function analisarCaso(caso) {
  if (MODO_IA === 'simulado') {
    await esperar(700);
    return analiseSimulada(caso);
  }
  if (MODO_IA === 'gemini') return obterIaGemini().analisarCaso(caso);
  if (MODO_IA === 'groq') return obterIaGroq().analisarCaso(caso);
  throw erroAmigavel(MSG_MODO_INVALIDO);
}

module.exports = { analisarCaso, gerarResposta, situacaoConfiguracao, MODO_IA, MODELO_GEMINI, MODELO_GROQ, MSG_MODO_INVALIDO };
