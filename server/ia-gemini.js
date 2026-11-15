// ============================================================
// Smart Support AI - IA real com Google Gemini
//
// Mesma "tomada" do modo simulado: analisarCaso(caso) e
// gerarResposta(caso, analise).
//
// Usado por server/ia.js somente quando MODO_IA=gemini.
// No modo simulado (padrão), este arquivo nem é carregado.
//
// Usa a Interactions API do SDK oficial @google/genai, sempre com:
// - store: false                  -> o Google não guarda a conversa;
// - automatic_continuation: false -> um único pedido por resposta;
// - retries: { strategy: 'none' } -> sem novas tentativas automáticas
//   (sem isso, um travamento virava 5 pedidos);
// - tempo limite de 25 s, abaixo dos 35 s que a tela espera.
//
// Pendente antes de ativar: confirmar, na conta Google, se o modelo
// escolhido está disponível no nível gratuito e quais são os limites.
// ============================================================

const { BLOCO_A_ANALISE, BLOCO_B_RESPOSTA } = require('./prompts');
const { montarCaso } = require('./montar-caso');
const comum = require('./ia-comum');

// Modelo padrão (pode ser trocado por MODELO_GEMINI no .env).
const MODELO_PADRAO = 'gemini-3.8-flash';

// Tempo máximo de espera pela API (pode ser trocado por TEMPO_LIMITE_IA_MS).
const TEMPO_LIMITE_PADRAO_MS = 25000;

// Nível de raciocínio do modelo (o gemini-3.8-flash aceita low, medium e high).
const NIVEL_RACIOCINIO = 'medium';

// Mensagens específicas do Gemini; as demais vêm de ia-comum.js.
const MENSAGENS = {
  ...comum.MENSAGENS,
  semChave: 'A chave do Gemini não está configurada no servidor. Para usar o Gemini, adicione GEMINI_API_KEY ao arquivo .env.',
  limiteUso: 'O limite de uso do Gemini foi atingido. No nível gratuito, os limites por minuto e por dia são baixos. Aguarde e tente novamente.',
  modeloNaoEncontrado: 'O modelo do Gemini configurado não foi encontrado. Confira MODELO_GEMINI no arquivo .env.',
};

// Opções de cada pedido: tempo limite e nenhuma nova tentativa automática.
function opcoesDoPedido(tempoLimiteMs) {
  return { timeout: tempoLimiteMs, retries: { strategy: 'none' } };
}

// Um turno da conversa no formato da Interactions API.
const turno = (tipo, texto) => ({ type: tipo, content: [{ type: 'text', text: texto }] });

// Entrada da análise: Bloco A + bloco <caso> (igual ao teste no claude.ai).
function montarEntradaAnalise(caso) {
  return [turno('user_input', `${BLOCO_A_ANALISE}\n\n${montarCaso(caso)}`)];
}

// Entrada da resposta: a mesma conversa do teste no claude.ai.
function montarEntradaResposta(caso, analise) {
  return [
    ...montarEntradaAnalise(caso),
    turno('model_output', JSON.stringify(comum.somenteAnalise(analise), null, 2)),
    turno('user_input', BLOCO_B_RESPOSTA),
  ];
}

// Indica se um erro da API diz que a chave é inválida (o Gemini pode responder 400).
function chaveRecusada(erro) {
  let detalhes = '';
  try { detalhes = JSON.stringify(erro.error || ''); } catch (e) { detalhes = ''; }
  return /API_KEY_INVALID/.test(detalhes) || /API key not valid/i.test(String(erro.message || ''));
}

// Traduz um erro do SDK para uma mensagem simples.
// O SDK só exporta ApiError; as demais classes são reconhecidas pelo nome e pelo código HTTP.
function traduzirErro(erro) {
  if (erro && erro.amigavel) return erro;
  const nome = erro && erro.name;
  if (['APIConnectionTimeoutError', 'RequestTimeoutError', 'TimeoutError', 'APIUserAbortError', 'AbortError'].includes(nome)) {
    return comum.erroAmigavel(MENSAGENS.demora);
  }
  if (['APIConnectionError', 'ConnectionError'].includes(nome)) return comum.erroAmigavel(MENSAGENS.semConexao);
  const status = erro && (typeof erro.status === 'number' ? erro.status : erro.statusCode);
  if (typeof status === 'number') {
    if (status === 400) return comum.erroAmigavel(chaveRecusada(erro) ? MENSAGENS.chaveInvalida : MENSAGENS.pedidoRecusado);
    if (status === 401) return comum.erroAmigavel(MENSAGENS.chaveInvalida);
    if (status === 403) return comum.erroAmigavel(MENSAGENS.semPermissao);
    if (status === 404) return comum.erroAmigavel(MENSAGENS.modeloNaoEncontrado);
    if (status === 408 || status === 504) return comum.erroAmigavel(MENSAGENS.demora);
    if (status === 413) return comum.erroAmigavel(MENSAGENS.conteudoGrande);
    if (status === 429) return comum.erroAmigavel(MENSAGENS.limiteUso);
    if (status >= 500) return comum.erroAmigavel(MENSAGENS.indisponivel);
    return comum.erroAmigavel(MENSAGENS.pedidoRecusado);
  }
  if (nome === 'SyntaxError') return comum.erroAmigavel(MENSAGENS.formatoInvalido); // resposta da API sem JSON válido
  return comum.erroAmigavel(MENSAGENS.inesperado);
}

// Lê o texto da interação, conferindo a situação informada pela API.
function lerTexto(interacao) {
  if (!interacao || typeof interacao !== 'object') throw comum.erroAmigavel(MENSAGENS.formatoInvalido);
  const situacao = interacao.status;
  if (situacao === 'failed') throw comum.erroAmigavel(MENSAGENS.bloqueado);
  if (['incomplete', 'requires_continuation', 'budget_exceeded'].includes(situacao)) {
    throw comum.erroAmigavel(MENSAGENS.incompleta);
  }
  if (situacao !== 'completed') throw comum.erroAmigavel(MENSAGENS.formatoInvalido);

  let texto = typeof interacao.output_text === 'string' ? interacao.output_text : '';
  if (!texto && Array.isArray(interacao.steps)) {
    // Reserva: junta o texto do último passo do modelo.
    const passos = interacao.steps.filter((p) => p && p.type === 'model_output' && Array.isArray(p.content));
    const ultimo = passos[passos.length - 1];
    texto = ultimo ? ultimo.content.filter((c) => c && c.type === 'text' && typeof c.text === 'string').map((c) => c.text).join('') : '';
  }
  texto = texto.trim();
  if (!texto) throw comum.erroAmigavel(MENSAGENS.formatoInvalido);
  return texto;
}

// Cria a integração com o Gemini.
// opcoes.cliente: um cliente já pronto (para testes).
// opcoes.chave / opcoes.modelo / opcoes.tempoLimiteMs: por padrão, vêm do .env.
function criarIaGemini(opcoes = {}) {
  const chave = opcoes.chave !== undefined ? opcoes.chave : process.env.GEMINI_API_KEY;
  const modelo = opcoes.modelo || process.env.MODELO_GEMINI || MODELO_PADRAO;
  const tempoLimiteMs = Number(opcoes.tempoLimiteMs || process.env.TEMPO_LIMITE_IA_MS) || TEMPO_LIMITE_PADRAO_MS;
  let cliente = opcoes.cliente || null;

  // Cria o cliente do SDK só quando for usado pela primeira vez.
  function obterCliente() {
    if (cliente) return cliente;
    if (typeof chave !== 'string' || !chave.trim()) throw comum.erroAmigavel(MENSAGENS.semChave);
    const { GoogleGenAI } = require('@google/genai');
    cliente = new GoogleGenAI({ apiKey: chave.trim() });
    return cliente;
  }

  async function chamarApi(contexto, entrada, comFormatoJson) {
    const pedido = {
      model: modelo,
      input: entrada,
      store: false,
      automatic_continuation: false,
      generation_config: { thinking_level: NIVEL_RACIOCINIO },
    };
    if (comFormatoJson) {
      pedido.response_format = { type: 'text', mime_type: 'application/json', schema: comum.ESQUEMA_ANALISE };
    }
    try {
      return await obterCliente().interactions.create(pedido, opcoesDoPedido(tempoLimiteMs));
    } catch (erro) {
      const amigavel = traduzirErro(erro);
      if (!erro || !erro.amigavel) comum.registrarErro('ia-gemini', contexto, erro, [chave]);
      throw amigavel;
    }
  }

  async function analisarCaso(caso) {
    const interacao = await chamarApi('análise', montarEntradaAnalise(caso), true);
    return { simulado: false, ...comum.lerAnaliseJson(lerTexto(interacao)) };
  }

  async function gerarResposta(caso, analise) {
    if (!comum.analiseValida(analise)) throw comum.erroAmigavel(MENSAGENS.analiseInvalida);
    const interacao = await chamarApi('resposta', montarEntradaResposta(caso, analise), false);
    return { simulado: false, texto: lerTexto(interacao) };
  }

  return { analisarCaso, gerarResposta, modelo, tempoLimiteMs, obterCliente };
}

module.exports = {
  criarIaGemini,
  MENSAGENS,
  MODELO_PADRAO,
  TEMPO_LIMITE_PADRAO_MS,
  NIVEL_RACIOCINIO,
  montarEntradaAnalise,
  montarEntradaResposta,
};
