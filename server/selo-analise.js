// ============================================================
// Smart Support AI - Selo da análise (assinatura HMAC do servidor)
//
// Problema que resolve: a rota /api/gerar-resposta recebe a análise de
// volta do navegador. Sem o selo, qualquer texto com o formato certo seria
// enviado à IA como se fosse a análise que ela mesma escreveu.
//
// Como funciona:
// - /api/analisar: depois de gerar e conferir a análise, o servidor assina
//   o CASO (já normalizado) + a ANÁLISE (só as 6 partes) + o MODO da IA +
//   a expiração, com HMAC-SHA256, e devolve o selo junto com a análise.
// - /api/gerar-resposta: o servidor recalcula a assinatura com o caso e a
//   análise recebidos e compara em tempo constante. Qualquer mudança (uma
//   letra, um item a mais, outra ordem, outro caso, outro modo) invalida o selo.
//
// Formato do selo: "v1.<expiração em ms>.<HMAC em base64url>" (cerca de 60
// caracteres). Ele NÃO contém nenhum texto do caso nem da análise, e nada é
// guardado no servidor: não há banco, cache nem sessão.
//
// O segredo é aleatório, criado quando o servidor inicia e mantido só na
// memória. Consequência: ao reiniciar o serviço (deploy, hibernação), os selos
// antigos deixam de valer e o atendente precisa analisar o caso de novo.
// ============================================================

const crypto = require('crypto');

const VERSAO = 'v1';
const VALIDADE_PADRAO_MS = 30 * 60 * 1000; // 30 minutos
const TAMANHO_MAXIMO_SELO = 100;
// v1 . 13 dígitos (milissegundos) . 43 caracteres base64url (32 bytes de HMAC)
const FORMATO_SELO = /^v1\.(\d{13})\.([A-Za-z0-9_-]{43})$/;

// Campos em ordem FIXA: a mesma ordem na assinatura e na conferência.
const CAMPOS_CASO = ['mensagem', 'tipo', 'identificacao', 'contexto', 'solucao', 'descricaoSolucao'];
const CAMPOS_ANALISE = ['problema', 'necessidade', 'informacoesIdentificadas', 'informacoesPendentes', 'contradicoes', 'proximoPasso'];

// Texto canônico assinado. JSON.stringify de uma lista em ordem fixa:
// não depende da ordem das chaves enviadas e não é ambíguo.
function textoCanonico(modo, expiracao, caso, analise) {
  return JSON.stringify([
    VERSAO,
    String(modo),
    expiracao,
    CAMPOS_CASO.map((campo) => caso[campo]),
    CAMPOS_ANALISE.map((campo) => analise[campo]),
  ]);
}

// Cria o selo da análise.
// - segredo: Buffer (padrão: 32 bytes aleatórios desta instância);
// - modo: o MODO_IA atual (o selo de um modo não vale em outro);
// - agora: relógio (os testes usam um relógio falso);
// - validadeMs: por quanto tempo o selo vale.
function criarSeloAnalise({ segredo = crypto.randomBytes(32), modo, agora = () => Date.now(), validadeMs = VALIDADE_PADRAO_MS } = {}) {
  if (!Buffer.isBuffer(segredo) || segredo.length < 32) throw new Error('O segredo do selo precisa ter pelo menos 32 bytes.');

  function calcular(expiracao, caso, analise) {
    return crypto.createHmac('sha256', segredo).update(textoCanonico(modo, expiracao, caso, analise), 'utf8').digest();
  }

  // caso: o caso normalizado pela rota (lerCaso); analise: as 6 partes.
  function assinar(caso, analise) {
    const expiracao = agora() + validadeMs;
    return `${VERSAO}.${expiracao}.${calcular(expiracao, caso, analise).toString('base64url')}`;
  }

  // Devolve { ok: true } ou { ok: false, motivo } (o motivo é só um código).
  function verificar(caso, analise, selo) {
    if (typeof selo !== 'string' || !selo) return { ok: false, motivo: 'ausente' };
    if (selo.length > TAMANHO_MAXIMO_SELO) return { ok: false, motivo: 'formato' };
    const partes = FORMATO_SELO.exec(selo);
    if (!partes) return { ok: false, motivo: 'formato' };
    const expiracao = Number(partes[1]);
    const recebido = Buffer.from(partes[2], 'base64url');
    const esperado = calcular(expiracao, caso, analise);
    // Comparação em tempo constante (os dois têm 32 bytes pelo formato acima).
    if (recebido.length !== esperado.length || !crypto.timingSafeEqual(recebido, esperado)) return { ok: false, motivo: 'assinatura' };
    // A expiração faz parte do texto assinado: não dá para "esticar" o prazo.
    if (agora() >= expiracao) return { ok: false, motivo: 'expirado' };
    return { ok: true };
  }

  return { assinar, verificar };
}

module.exports = { criarSeloAnalise, textoCanonico, VERSAO, VALIDADE_PADRAO_MS, CAMPOS_CASO, CAMPOS_ANALISE };
