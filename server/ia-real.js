// ============================================================
// Smart Support AI - IA real (API da Anthropic)
//
// Mesma "tomada" do modo simulado: analisarCaso(caso) e
// gerarResposta(caso, analise).
//
// Etapa 3.2: este arquivo ainda NÃO é usado pela aplicação.
// O servidor continua no modo simulado (MODO_IA=simulado).
//
// Segurança da chave:
// - a chave é lida do .env (ANTHROPIC_API_KEY) somente no servidor;
// - nada é criado nem conectado ao carregar este arquivo;
// - mensagens de erro e registros passam por ocultarSegredos().
// ============================================================

const { BLOCO_A_ANALISE, BLOCO_B_RESPOSTA } = require('./prompts');
const { montarCaso } = require('./montar-caso');

// Modelo padrão (pode ser trocado por MODELO_IA no .env).
const MODELO_PADRAO = 'claude-opus-5-5';

// Tempo máximo de espera pela API. Fica abaixo dos 35 s que a tela espera,
// para que o servidor responda com uma mensagem clara antes de a tela desistir.
const TEMPO_LIMITE_PADRAO_MS = 25000;

// Limite de tamanho da resposta da IA (em tokens).
const MAX_TOKENS = 16000;

// Recurso da API que tenta outro modelo quando o principal recusa um pedido
// por segurança (recomendado pela documentação oficial para este modelo).
const BETA_FALLBACK = 'server-side-fallback-2026-07-01';

// Formato garantido da análise: as 6 partes, só com textos.
const CHAVES_ANALISE = ['problema', 'necessidade', 'informacoesIdentificadas', 'informacoesPendentes', 'contradicoes', 'proximoPasso'];
const LISTA_DE_TEXTOS = { type: 'array', items: { type: 'string' } };
const ESQUEMA_ANALISE = {
  type: 'object',
  properties: {
    problema: { type: 'string' },
    necessidade: { type: 'string' },
    informacoesIdentificadas: LISTA_DE_TEXTOS,
    informacoesPendentes: LISTA_DE_TEXTOS,
    contradicoes: LISTA_DE_TEXTOS,
    proximoPasso: { type: 'string' },
  },
  required: CHAVES_ANALISE,
  additionalProperties: false,
};

// Mensagens exibidas ao atendente (nunca contêm dados técnicos nem a chave).
const MENSAGENS = {
  semChave: 'A chave da API não está configurada no servidor. Para usar o modo real, adicione ANTHROPIC_API_KEY ao arquivo .env.',
  chaveInvalida: 'A chave da API foi recusada. Confira a chave configurada no arquivo .env.',
  semPermissao: 'A chave da API não tem permissão para usar este recurso. Confira a conta na Anthropic.',
  semCreditos: 'A conta da API está sem créditos ou com o limite de gasto atingido. Confira a conta na Anthropic.',
  limiteUso: 'O limite de uso da API foi atingido. Aguarde alguns instantes e tente novamente.',
  indisponivel: 'O serviço de IA está indisponível no momento. Tente novamente em instantes.',
  semConexao: 'Não foi possível conectar ao serviço de IA. Verifique a conexão com a internet.',
  demora: 'O serviço de IA demorou demais para responder. Tente novamente.',
  modeloNaoEncontrado: 'O modelo de IA configurado não foi encontrado. Confira MODELO_IA no arquivo .env.',
  conteudoGrande: 'O caso é grande demais para o serviço de IA. Reduza o texto e tente novamente.',
  pedidoRecusado: 'O serviço de IA não aceitou o pedido. Tente novamente; se continuar, revise o texto do caso.',
  recusa: 'A IA não pôde processar este caso. Revise o texto e tente novamente.',
  incompleta: 'A resposta da IA ficou incompleta. Tente novamente.',
  formatoInvalido: 'A IA devolveu um conteúdo em formato inesperado. Tente novamente.',
  analiseInvalida: 'A análise recebida está incompleta. Analise o caso novamente antes de gerar a resposta.',
  inesperado: 'Ocorreu um problema ao falar com o serviço de IA. Tente novamente em instantes.',
};

// Cria um erro cuja mensagem pode ser mostrada ao atendente na tela.
function erroAmigavel(mensagem) {
  const erro = new Error(mensagem);
  erro.amigavel = true;
  return erro;
}

// Troca qualquer chave da API encontrada no texto por "[chave oculta]".
function ocultarSegredos(texto, chave = process.env.ANTHROPIC_API_KEY) {
  let resultado = String(texto == null ? '' : texto);
  const valor = typeof chave === 'string' ? chave.trim() : '';
  if (valor) resultado = resultado.split(valor).join('[chave oculta]');
  return resultado.replace(/sk-ant-[A-Za-z0-9_-]+/g, '[chave oculta]');
}

// Registra um erro no terminal do servidor, sem a chave.
function registrarErro(contexto, erro, chave) {
  const partes = [
    erro && erro.name ? erro.name : 'Erro',
    erro && erro.status ? `status=${erro.status}` : null,
    erro && erro.type ? `tipo=${erro.type}` : null,
    erro && erro.message ? erro.message : null,
  ].filter(Boolean);
  console.error(`[ia-real] ${contexto}: ${ocultarSegredos(partes.join(' | '), chave)}`);
}

// Traduz um erro do SDK para uma mensagem simples (da mais específica para a mais geral).
function traduzirErro(erro) {
  if (erro && erro.amigavel) return erro;
  const { Anthropic } = require('@anthropic-ai/sdk');
  if (erro instanceof Anthropic.APIConnectionTimeoutError) return erroAmigavel(MENSAGENS.demora);
  if (erro instanceof Anthropic.APIConnectionError) return erroAmigavel(MENSAGENS.semConexao);
  if (erro instanceof Anthropic.AuthenticationError) return erroAmigavel(MENSAGENS.chaveInvalida);
  if (erro instanceof Anthropic.PermissionDeniedError) return erroAmigavel(MENSAGENS.semPermissao);
  if (erro instanceof Anthropic.NotFoundError) return erroAmigavel(MENSAGENS.modeloNaoEncontrado);
  if (erro instanceof Anthropic.RequestTimeoutError) return erroAmigavel(MENSAGENS.demora);
  if (erro instanceof Anthropic.ContentTooLargeError) return erroAmigavel(MENSAGENS.conteudoGrande);
  if (erro instanceof Anthropic.RateLimitError) return erroAmigavel(MENSAGENS.limiteUso);
  if (erro instanceof Anthropic.InternalServerError) return erroAmigavel(MENSAGENS.indisponivel);
  if (erro instanceof Anthropic.BadRequestError) return erroAmigavel(MENSAGENS.pedidoRecusado);
  if (erro instanceof Anthropic.APIError) {
    if (erro.status === 402 || erro.type === 'billing_error') return erroAmigavel(MENSAGENS.semCreditos);
    if (erro.status === 529 || erro.type === 'overloaded_error') return erroAmigavel(MENSAGENS.indisponivel);
    if (erro.status >= 500) return erroAmigavel(MENSAGENS.indisponivel);
    return erroAmigavel(MENSAGENS.pedidoRecusado);
  }
  return erroAmigavel(MENSAGENS.inesperado);
}

// Confere se um objeto tem exatamente o formato da análise.
function analiseValida(a) {
  const ehLista = (x) => Array.isArray(x) && x.every((item) => typeof item === 'string');
  return Boolean(a) && typeof a === 'object'
    && typeof a.problema === 'string' && typeof a.necessidade === 'string'
    && ehLista(a.informacoesIdentificadas) && ehLista(a.informacoesPendentes)
    && ehLista(a.contradicoes) && typeof a.proximoPasso === 'string';
}

// Copia só as 6 partes da análise (descarta campos extras).
function somenteAnalise(a) {
  return Object.fromEntries(CHAVES_ANALISE.map((chave) => [chave, a[chave]]));
}

// Mensagens da análise: Bloco A + bloco <caso> (igual ao teste no claude.ai).
function montarMensagensAnalise(caso) {
  return [{ role: 'user', content: `${BLOCO_A_ANALISE}\n\n${montarCaso(caso)}` }];
}

// Mensagens da resposta: a mesma conversa do teste no claude.ai.
function montarMensagensResposta(caso, analise) {
  return [
    ...montarMensagensAnalise(caso),
    { role: 'assistant', content: JSON.stringify(somenteAnalise(analise), null, 2) },
    { role: 'user', content: BLOCO_B_RESPOSTA },
  ];
}

// Lê o texto da resposta da API, conferindo os motivos de parada.
function lerTexto(resposta) {
  if (!resposta || typeof resposta !== 'object') throw erroAmigavel(MENSAGENS.formatoInvalido);
  if (resposta.stop_reason === 'refusal') throw erroAmigavel(MENSAGENS.recusa);
  if (resposta.stop_reason === 'max_tokens') throw erroAmigavel(MENSAGENS.incompleta);
  const texto = (Array.isArray(resposta.content) ? resposta.content : [])
    .filter((bloco) => bloco && bloco.type === 'text' && typeof bloco.text === 'string')
    .map((bloco) => bloco.text)
    .join('')
    .trim();
  if (!texto) throw erroAmigavel(MENSAGENS.formatoInvalido);
  return texto;
}

// Cria a IA real.
// opcoes.cliente: um cliente já pronto (os testes usam um cliente falso).
// opcoes.chave / opcoes.modelo / opcoes.tempoLimiteMs: por padrão, vêm do .env.
// opcoes.usarFallback: true (padrão) ativa o recurso de recusa da API.
function criarIaReal(opcoes = {}) {
  const chave = opcoes.chave !== undefined ? opcoes.chave : process.env.ANTHROPIC_API_KEY;
  const modelo = opcoes.modelo || process.env.MODELO_IA || MODELO_PADRAO;
  const tempoLimiteMs = Number(opcoes.tempoLimiteMs || process.env.TEMPO_LIMITE_IA_MS) || TEMPO_LIMITE_PADRAO_MS;
  const usarFallback = opcoes.usarFallback !== false;
  let cliente = opcoes.cliente || null;

  // Cria o cliente do SDK só quando for usado pela primeira vez.
  function obterCliente() {
    if (cliente) return cliente;
    if (typeof chave !== 'string' || !chave.trim()) throw erroAmigavel(MENSAGENS.semChave);
    const { Anthropic } = require('@anthropic-ai/sdk');
    cliente = new Anthropic({ apiKey: chave.trim(), timeout: tempoLimiteMs, maxRetries: 0 });
    return cliente;
  }

  async function chamarApi(contexto, mensagens, outputConfig) {
    const pedido = {
      model: modelo,
      max_tokens: MAX_TOKENS,
      messages: mensagens,
      output_config: { effort: 'medium', ...outputConfig },
    };
    try {
      const c = obterCliente();
      if (usarFallback) {
        return await c.beta.messages.create({ ...pedido, betas: [BETA_FALLBACK], fallbacks: 'default' });
      }
      return await c.messages.create(pedido);
    } catch (erro) {
      const amigavel = traduzirErro(erro);
      if (!erro || !erro.amigavel) registrarErro(contexto, erro, chave);
      throw amigavel;
    }
  }

  async function analisarCaso(caso) {
    const resposta = await chamarApi('análise', montarMensagensAnalise(caso), {
      format: { type: 'json_schema', schema: ESQUEMA_ANALISE },
    });
    const texto = lerTexto(resposta);
    let analise;
    try {
      analise = JSON.parse(texto);
    } catch (e) {
      throw erroAmigavel(MENSAGENS.formatoInvalido);
    }
    if (!analiseValida(analise)) throw erroAmigavel(MENSAGENS.formatoInvalido);
    return { simulado: false, ...somenteAnalise(analise) };
  }

  async function gerarResposta(caso, analise) {
    if (!analiseValida(analise)) throw erroAmigavel(MENSAGENS.analiseInvalida);
    const resposta = await chamarApi('resposta', montarMensagensResposta(caso, analise), {});
    return { simulado: false, texto: lerTexto(resposta) };
  }

  return { analisarCaso, gerarResposta, modelo, tempoLimiteMs, usarFallback, obterCliente };
}

module.exports = {
  criarIaReal,
  ESQUEMA_ANALISE,
  MENSAGENS,
  MODELO_PADRAO,
  TEMPO_LIMITE_PADRAO_MS,
  BETA_FALLBACK,
  montarMensagensAnalise,
  montarMensagensResposta,
  ocultarSegredos,
};
