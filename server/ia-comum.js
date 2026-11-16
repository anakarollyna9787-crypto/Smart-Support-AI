// ============================================================
// Smart Support AI - Peças comuns às integrações de IA
//
// Usado por: server/ia-gemini.js e server/ia-groq.js
// NÃO é usado pelo modo simulado (ia.js) nem pela Anthropic (ia-real.js),
// que continuam exatamente como estavam.
// ============================================================

// As 6 partes da análise e o formato garantido (JSON Schema).
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

// Mensagens exibidas ao atendente (nunca contêm dados técnicos nem chaves).
const MENSAGENS = {
  semChave: 'O serviço de IA não está configurado no servidor. Tente novamente mais tarde.',
  chaveInvalida: 'O serviço de IA recusou a credencial do servidor. Tente novamente mais tarde.',
  semPermissao: 'O serviço de IA não autorizou este pedido. Tente novamente mais tarde.',
  limiteUso: 'O limite de uso da API foi atingido. Aguarde alguns instantes e tente novamente.',
  indisponivel: 'O serviço de IA está indisponível no momento. Tente novamente em instantes.',
  semConexao: 'Não foi possível conectar ao serviço de IA. Verifique a conexão com a internet.',
  demora: 'O serviço de IA demorou demais para responder. Tente novamente.',
  modeloNaoEncontrado: 'O modelo de IA configurado no servidor não está disponível no momento. Tente novamente mais tarde.',
  conteudoGrande: 'O caso é grande demais para o serviço de IA. Reduza o texto e tente novamente.',
  pedidoRecusado: 'O serviço de IA não aceitou o pedido. Tente novamente; se continuar, revise o texto do caso.',
  bloqueado: 'A IA não processou este caso (o pedido pode ter sido bloqueado pelos filtros de segurança). Revise o texto e tente novamente.',
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

// Formatos de chave conhecidos: Anthropic (sk-ant-...), Google (AIza... e AQ....) e Groq (gsk_...).
const PADROES_DE_CHAVE = [
  /sk-ant-[A-Za-z0-9_-]+/g,
  /AIza[0-9A-Za-z_-]{10,}/g,
  /\bAQ\.[0-9A-Za-z_.-]{20,}/g,
  /\bgsk_[0-9A-Za-z]{20,}/g,
];

// Troca as chaves informadas, e qualquer texto com formato de chave, por "[chave oculta]".
function ocultarSegredos(texto, chaves = [process.env.GEMINI_API_KEY, process.env.GROQ_API_KEY, process.env.ANTHROPIC_API_KEY]) {
  let resultado = String(texto == null ? '' : texto);
  for (const chave of [].concat(chaves)) {
    const valor = typeof chave === 'string' ? chave.trim() : '';
    if (valor) resultado = resultado.split(valor).join('[chave oculta]');
  }
  for (const padrao of PADROES_DE_CHAVE) resultado = resultado.replace(padrao, '[chave oculta]');
  return resultado;
}

// Aceita só códigos curtos e técnicos (ex.: RESOURCE_EXHAUSTED, invalid_api_key, ECONNRESET).
function codigoSeguro(valor) {
  return typeof valor === 'string' && /^[A-Za-z0-9_.-]{1,60}$/.test(valor) ? valor : null;
}

// Registra um erro técnico no terminal do servidor, sem chaves e sem conteúdo.
// A mensagem do erro NÃO é registrada: em alguns provedores ela traz o corpo
// inteiro da resposta (por exemplo, "failed_generation" da Groq, que contém
// texto gerado a partir do caso). Ficam só o tipo, o status HTTP e os códigos.
function registrarErro(prefixo, contexto, erro, chaves) {
  const detalhe = erro && erro.error && typeof erro.error === 'object' ? erro.error.error : null;
  const tipo = detalhe && typeof detalhe === 'object' ? codigoSeguro(detalhe.status) : null;
  const codigo = detalhe && typeof detalhe === 'object' ? codigoSeguro(detalhe.code) : null;
  const causa = erro && erro.cause && typeof erro.cause === 'object' ? codigoSeguro(erro.cause.code) : null;
  const status = erro ? Number(erro.status || erro.statusCode) : NaN;
  const partes = [
    erro && codigoSeguro(erro.name) ? erro.name : 'Erro',
    Number.isInteger(status) && status > 0 ? `status=${status}` : null,
    tipo ? `tipo=${tipo}` : null,
    codigo ? `codigo=${codigo}` : null,
    causa ? `causa=${causa}` : null,
  ].filter(Boolean);
  console.error(`[${prefixo}] ${contexto}: ${ocultarSegredos(partes.join(' | '), chaves)}`);
}

// Confere se um objeto tem exatamente o formato da análise.
function analiseValida(a) {
  const ehLista = (x) => Array.isArray(x) && x.every((item) => typeof item === 'string');
  return Boolean(a) && typeof a === 'object' && !Array.isArray(a)
    && typeof a.problema === 'string' && typeof a.necessidade === 'string'
    && ehLista(a.informacoesIdentificadas) && ehLista(a.informacoesPendentes)
    && ehLista(a.contradicoes) && typeof a.proximoPasso === 'string';
}

// Copia só as 6 partes da análise (descarta campos extras).
function somenteAnalise(a) {
  return Object.fromEntries(CHAVES_ANALISE.map((chave) => [chave, a[chave]]));
}

// Converte o texto da IA em análise conferida (ou lança erro amigável).
function lerAnaliseJson(texto) {
  let analise;
  try {
    analise = JSON.parse(texto);
  } catch (e) {
    throw erroAmigavel(MENSAGENS.formatoInvalido);
  }
  if (!analiseValida(analise)) throw erroAmigavel(MENSAGENS.formatoInvalido);
  return somenteAnalise(analise);
}

module.exports = {
  CHAVES_ANALISE,
  ESQUEMA_ANALISE,
  MENSAGENS,
  erroAmigavel,
  ocultarSegredos,
  registrarErro,
  analiseValida,
  somenteAnalise,
  lerAnaliseJson,
};
