// ============================================================
// Smart Support AI - IA real com Groq
//
// Mesma "tomada" do modo simulado e do Gemini: analisarCaso(caso) e
// gerarResposta(caso, analise), sempre em chamadas separadas.
//
// Usado por server/ia.js somente quando MODO_IA=groq.
// Nos outros modos, este arquivo nem é carregado.
//
// Usa o SDK oficial groq-sdk (Chat Completions), sempre com:
// - maxRetries: 0      -> um único pedido por ação (sem novas tentativas);
// - timeout de 25 s    -> abaixo dos 35 s que a tela espera;
// - logLevel: 'off'    -> o SDK não escreve nada no terminal;
// - baseURL fixo       -> sempre o endereço oficial (GROQ_BASE_URL é ignorado);
// - nenhum histórico   -> cada pedido leva só o caso atual; nada é guardado;
// - teto de saída      -> max_completion_tokens (2.500 na análise, 1.500 na resposta),
//                         que inclui os tokens de raciocínio do modelo.
// A análise usa saída estruturada estrita (json_schema + strict: true),
// com o mesmo esquema das 6 partes usado no Gemini.
// ============================================================

const { BLOCO_A_ANALISE, BLOCO_B_RESPOSTA } = require('./prompts');
const { montarCaso } = require('./montar-caso');
const comum = require('./ia-comum');
const { analiseDentroDosLimites } = require('./protecao');

// Modelo padrão (compatível com saída estruturada estrita na Groq).
const MODELO_PADRAO = 'openai/gpt-oss-120b';

// Tempo máximo de espera pela API (pode ser trocado por TEMPO_LIMITE_IA_MS).
const TEMPO_LIMITE_PADRAO_MS = 25000;

// Endereço oficial da API. É passado explicitamente ao SDK para que nenhuma
// variável de ambiente (como GROQ_BASE_URL) mude o destino dos pedidos e da chave.
const ENDERECO_OFICIAL = 'https://api.groq.com';

// Nível de raciocínio do modelo (o gpt-oss aceita low, medium e high).
const NIVEL_RACIOCINIO = 'medium';

// Nome do formato da análise enviado à Groq.
const NOME_ESQUEMA = 'analise_caso';

// Teto de tokens gerados por pedido (inclui o raciocínio). Limita o custo
// de cada chamada. Se a IA atingir o teto, a tela mostra "resposta incompleta".
const MAX_TOKENS_ANALISE = 2500;
const MAX_TOKENS_RESPOSTA = 1500;

// Mensagens específicas da Groq; as demais vêm de ia-comum.js.
// Elas aparecem para o visitante: não citam arquivos nem variáveis do servidor.
const MENSAGENS = {
  ...comum.MENSAGENS,
  semChave: 'O serviço de IA (Groq) não está configurado no servidor. Tente novamente mais tarde.',
  limiteUso: 'O limite de uso da Groq foi atingido. No nível gratuito, os limites por minuto e por dia são baixos. Aguarde e tente novamente.',
  modeloNaoEncontrado: 'O modelo da Groq configurado não foi encontrado ou não está disponível no momento.',
};

// Uma mensagem da conversa no formato Chat Completions.
const mensagem = (papel, texto) => ({ role: papel, content: texto });

// Mensagens da análise: Bloco A + bloco <caso> (igual ao Gemini).
function montarMensagensAnalise(caso) {
  return [mensagem('user', `${BLOCO_A_ANALISE}\n\n${montarCaso(caso)}`)];
}

// Mensagens da resposta: a mesma conversa do Gemini (caso, análise, Bloco B).
function montarMensagensResposta(caso, analise) {
  return [
    ...montarMensagensAnalise(caso),
    mensagem('assistant', JSON.stringify(comum.somenteAnalise(analise), null, 2)),
    mensagem('user', BLOCO_B_RESPOSTA),
  ];
}

// Código de erro informado pela Groq no corpo da resposta (ex.: invalid_api_key).
function codigoGroq(erro) {
  const detalhe = erro && erro.error && erro.error.error;
  return detalhe && typeof detalhe.code === 'string' ? detalhe.code : '';
}

// Traduz um erro do SDK para uma mensagem simples.
// As classes do SDK são reconhecidas por instanceof (o SDK já está carregado
// sempre que um erro dele chega aqui) e, como reserva, pelo código HTTP.
function traduzirErro(erro) {
  if (erro && erro.amigavel) return erro;
  const Groq = require('groq-sdk');
  if (erro instanceof Groq.APIConnectionTimeoutError) return comum.erroAmigavel(MENSAGENS.demora);
  if (erro instanceof Groq.APIUserAbortError) return comum.erroAmigavel(MENSAGENS.demora);
  if (erro instanceof Groq.APIConnectionError) return comum.erroAmigavel(MENSAGENS.semConexao);
  const nome = erro && erro.name;
  if (['TimeoutError', 'AbortError'].includes(nome)) return comum.erroAmigavel(MENSAGENS.demora);
  const status = erro && erro.status;
  if (typeof status === 'number') {
    const codigo = codigoGroq(erro);
    if (status === 400) {
      if (codigo === 'invalid_api_key') return comum.erroAmigavel(MENSAGENS.chaveInvalida);
      if (codigo === 'json_validate_failed') return comum.erroAmigavel(MENSAGENS.formatoInvalido);
      return comum.erroAmigavel(MENSAGENS.pedidoRecusado);
    }
    if (status === 401) return comum.erroAmigavel(MENSAGENS.chaveInvalida);
    if (status === 403) return comum.erroAmigavel(MENSAGENS.semPermissao);
    if (status === 404) return comum.erroAmigavel(MENSAGENS.modeloNaoEncontrado);
    if (status === 408 || status === 504) return comum.erroAmigavel(MENSAGENS.demora);
    if (status === 413) return comum.erroAmigavel(MENSAGENS.conteudoGrande);
    if (status === 429) return comum.erroAmigavel(MENSAGENS.limiteUso);
    if (status === 498 || status >= 500) return comum.erroAmigavel(MENSAGENS.indisponivel); // 498: capacidade esgotada
    return comum.erroAmigavel(MENSAGENS.pedidoRecusado);
  }
  if (nome === 'SyntaxError') return comum.erroAmigavel(MENSAGENS.formatoInvalido);
  return comum.erroAmigavel(MENSAGENS.inesperado);
}

// Lê o texto da resposta, conferindo o motivo de término informado pela API.
function lerTexto(resposta) {
  const escolha = resposta && Array.isArray(resposta.choices) ? resposta.choices[0] : null;
  if (!escolha || typeof escolha !== 'object') throw comum.erroAmigavel(MENSAGENS.formatoInvalido);
  if (escolha.finish_reason === 'length') throw comum.erroAmigavel(MENSAGENS.incompleta);
  if (escolha.finish_reason !== 'stop') throw comum.erroAmigavel(MENSAGENS.formatoInvalido);
  const conteudo = escolha.message && escolha.message.content;
  const texto = typeof conteudo === 'string' ? conteudo.trim() : '';
  if (!texto) throw comum.erroAmigavel(MENSAGENS.formatoInvalido);
  return texto;
}

// Cria a integração com a Groq.
// opcoes.cliente: um cliente já pronto (para testes).
// opcoes.chave / opcoes.modelo / opcoes.tempoLimiteMs: por padrão, vêm do .env.
function criarIaGroq(opcoes = {}) {
  const chave = opcoes.chave !== undefined ? opcoes.chave : process.env.GROQ_API_KEY;
  const modelo = opcoes.modelo || MODELO_PADRAO;
  const tempoLimiteMs = Number(opcoes.tempoLimiteMs || process.env.TEMPO_LIMITE_IA_MS) || TEMPO_LIMITE_PADRAO_MS;
  let cliente = opcoes.cliente || null;

  // Cria o cliente do SDK só quando for usado pela primeira vez.
  function obterCliente() {
    if (cliente) return cliente;
    if (typeof chave !== 'string' || !chave.trim()) throw comum.erroAmigavel(MENSAGENS.semChave);
    const Groq = require('groq-sdk');
    cliente = new Groq({
      apiKey: chave.trim(),
      baseURL: ENDERECO_OFICIAL,
      timeout: tempoLimiteMs,
      maxRetries: 0,
      logLevel: 'off',
    });
    return cliente;
  }

  async function chamarApi(contexto, mensagens, comFormatoJson) {
    const pedido = {
      model: modelo,
      messages: mensagens,
      reasoning_effort: NIVEL_RACIOCINIO,
      include_reasoning: false,
      max_completion_tokens: comFormatoJson ? MAX_TOKENS_ANALISE : MAX_TOKENS_RESPOSTA,
    };
    if (comFormatoJson) {
      pedido.response_format = {
        type: 'json_schema',
        json_schema: { name: NOME_ESQUEMA, strict: true, schema: comum.ESQUEMA_ANALISE },
      };
    }
    try {
      return await obterCliente().chat.completions.create(pedido);
    } catch (erro) {
      const amigavel = traduzirErro(erro);
      if (!erro || !erro.amigavel) comum.registrarErro('ia-groq', contexto, erro, [chave]);
      throw amigavel;
    }
  }

  async function analisarCaso(caso) {
    const resposta = await chamarApi('análise', montarMensagensAnalise(caso), true);
    return { simulado: false, ...comum.lerAnaliseJson(lerTexto(resposta)) };
  }

  async function gerarResposta(caso, analise) {
    // Formato e tamanho conferidos de novo aqui (além da rota), antes de qualquer pedido.
    if (!analiseDentroDosLimites(analise)) throw comum.erroAmigavel(MENSAGENS.analiseInvalida);
    const resposta = await chamarApi('resposta', montarMensagensResposta(caso, analise), false);
    return { simulado: false, texto: lerTexto(resposta) };
  }

  return { analisarCaso, gerarResposta, modelo, tempoLimiteMs, obterCliente };
}

module.exports = {
  criarIaGroq,
  MENSAGENS,
  MODELO_PADRAO,
  TEMPO_LIMITE_PADRAO_MS,
  ENDERECO_OFICIAL,
  NIVEL_RACIOCINIO,
  NOME_ESQUEMA,
  MAX_TOKENS_ANALISE,
  MAX_TOKENS_RESPOSTA,
  montarMensagensAnalise,
  montarMensagensResposta,
};
