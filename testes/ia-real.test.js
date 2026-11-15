// ============================================================
// Smart Support AI - Testes da IA real (server/ia-real.js)
//
// Usa um "Claude de mentira" (mock). NENHUMA chamada real é feita:
// o acesso à internet (fetch) é bloqueado durante estes testes.
//
// Como rodar (na pasta do projeto):  node --test "testes/*.test.js"
// ============================================================

const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
// A classe do cliente e as classes de erro do SDK oficial.
const { Anthropic } = require('@anthropic-ai/sdk');

const {
  criarIaReal, ESQUEMA_ANALISE, MENSAGENS, MODELO_PADRAO, TEMPO_LIMITE_PADRAO_MS, BETA_FALLBACK,
  montarMensagensAnalise, montarMensagensResposta, ocultarSegredos,
} = require('../server/ia-real');
const { BLOCO_A_ANALISE, BLOCO_B_RESPOSTA } = require('../server/prompts');
const { montarCaso } = require('../server/montar-caso');
const { CASOS_FICTICIOS } = require('./casos-ficticios');

const RAIZ = path.join(__dirname, '..');
const CHAVE_FALSA = 'sk-ant-api03-CHAVE-FALSA-SO-PARA-TESTE-0000000000';
const CASO = CASOS_FICTICIOS[0];
const ANALISE_OK = {
  problema: 'Pedido não entregue.',
  necessidade: 'Saber a situação do pedido.',
  informacoesIdentificadas: ['O cliente afirma que fez o pedido no dia 3.'],
  informacoesPendentes: ['Perguntar ao cliente: número do pedido.'],
  contradicoes: ['Cartão de crédito × boleto pendente.'],
  proximoPasso: 'Verificar o pedido e o pagamento, sem prometer prazo.',
};

// ---------- Bloqueio da internet e captura do terminal ----------
let fetchOriginal;
let tentativasDeRede = 0;
let registros = [];
let consoleErrorOriginal;

before(() => {
  fetchOriginal = globalThis.fetch;
  globalThis.fetch = async () => { tentativasDeRede++; throw new Error('Acesso à internet bloqueado nos testes'); };
});
after(() => {
  globalThis.fetch = fetchOriginal;
  assert.equal(tentativasDeRede, 0, 'algum teste tentou acessar a internet');
});
beforeEach(() => {
  registros = [];
  consoleErrorOriginal = console.error;
  console.error = (...partes) => { registros.push(partes.join(' ')); };
});
afterEach(() => { console.error = consoleErrorOriginal; });

// ---------- Claude de mentira ----------
// "comportamento" recebe o pedido e devolve a resposta ou lança um erro.
function clienteFalso(comportamento) {
  const pedidos = [];
  const create = async (pedido) => { pedidos.push(pedido); return comportamento(pedido); };
  return { pedidos, messages: { create }, beta: { messages: { create } } };
}
const respostaTexto = (texto, extra = {}) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: texto }], ...extra });
const iaCom = (comportamento, opcoes = {}) => {
  const cliente = clienteFalso(comportamento);
  return { ia: criarIaReal({ cliente, chave: CHAVE_FALSA, ...opcoes }), cliente };
};
const cabecalhos = () => new Headers({ 'request-id': 'req_teste' });
const erroDaApi = (Classe, status, tipo) =>
  new Classe(status, { type: 'error', error: { type: tipo, message: `falha simulada com a chave ${CHAVE_FALSA}` } }, `falha simulada com a chave ${CHAVE_FALSA}`, cabecalhos());

async function esperaErro(promessa, mensagemEsperada) {
  await assert.rejects(promessa, (erro) => {
    assert.equal(erro.amigavel, true, 'o erro deveria ser amigável');
    assert.equal(erro.message, mensagemEsperada);
    return true;
  });
}

// ============================================================
describe('1. Respostas válidas', () => {
  test('análise válida: devolve as 6 partes com simulado = false', async () => {
    const { ia } = iaCom(() => respostaTexto(JSON.stringify(ANALISE_OK)));
    const analise = await ia.analisarCaso(CASO);
    assert.deepEqual(analise, { simulado: false, ...ANALISE_OK });
  });

  test('análise: o pedido usa o Bloco A + o bloco <caso> exatamente como no teste do claude.ai', async () => {
    const { ia, cliente } = iaCom(() => respostaTexto(JSON.stringify(ANALISE_OK)));
    await ia.analisarCaso(CASO);
    const pedido = cliente.pedidos[0];
    assert.equal(pedido.messages.length, 1);
    assert.equal(pedido.messages[0].role, 'user');
    assert.equal(pedido.messages[0].content, `${BLOCO_A_ANALISE}\n\n${montarCaso(CASO)}`);
  });

  test('análise: pede o formato garantido com as 6 chaves', async () => {
    const { ia, cliente } = iaCom(() => respostaTexto(JSON.stringify(ANALISE_OK)));
    await ia.analisarCaso(CASO);
    const formato = cliente.pedidos[0].output_config.format;
    assert.equal(formato.type, 'json_schema');
    assert.deepEqual(formato.schema, ESQUEMA_ANALISE);
    assert.deepEqual(ESQUEMA_ANALISE.required, ['problema', 'necessidade', 'informacoesIdentificadas', 'informacoesPendentes', 'contradicoes', 'proximoPasso']);
    assert.equal(ESQUEMA_ANALISE.additionalProperties, false);
  });

  test('pedido: modelo padrão, limite de tokens, esforço e recurso de recusa (fallback)', async () => {
    const { ia, cliente } = iaCom(() => respostaTexto(JSON.stringify(ANALISE_OK)));
    await ia.analisarCaso(CASO);
    const pedido = cliente.pedidos[0];
    assert.equal(pedido.model, MODELO_PADRAO);
    assert.equal(MODELO_PADRAO, 'claude-opus-5-5');
    assert.equal(pedido.max_tokens, 16000);
    assert.equal(pedido.output_config.effort, 'medium');
    assert.deepEqual(pedido.betas, [BETA_FALLBACK]);
    assert.equal(pedido.fallbacks, 'default');
  });

  test('pedido: com usarFallback = false, usa a chamada comum, sem o recurso de recusa', async () => {
    let usouBeta = false;
    const cliente = {
      pedidos: [],
      messages: { create: async (p) => { cliente.pedidos.push(p); return respostaTexto(JSON.stringify(ANALISE_OK)); } },
      beta: { messages: { create: async () => { usouBeta = true; } } },
    };
    const ia = criarIaReal({ cliente, chave: CHAVE_FALSA, usarFallback: false });
    await ia.analisarCaso(CASO);
    assert.equal(usouBeta, false);
    assert.equal(cliente.pedidos[0].betas, undefined);
    assert.equal(cliente.pedidos[0].fallbacks, undefined);
  });

  test('análise: campos extras devolvidos pela IA são descartados', async () => {
    const { ia } = iaCom(() => respostaTexto(JSON.stringify({ ...ANALISE_OK, extra: 'x' })));
    const analise = await ia.analisarCaso(CASO);
    assert.equal('extra' in analise, false);
  });

  test('análise: blocos que não são texto (ex.: troca de modelo) são ignorados', async () => {
    const { ia } = iaCom(() => ({
      stop_reason: 'end_turn',
      content: [{ type: 'fallback', from: { model: 'a' }, to: { model: 'b' } }, { type: 'text', text: JSON.stringify(ANALISE_OK) }],
    }));
    assert.deepEqual(await ia.analisarCaso(CASO), { simulado: false, ...ANALISE_OK });
  });

  test('resposta válida: devolve o texto com simulado = false', async () => {
    const { ia } = iaCom(() => respostaTexto('Olá! Texto da resposta.\n\nAtenciosamente,\n[Seu nome]'));
    const resposta = await ia.gerarResposta(CASO, ANALISE_OK);
    assert.deepEqual(resposta, { simulado: false, texto: 'Olá! Texto da resposta.\n\nAtenciosamente,\n[Seu nome]' });
  });

  test('resposta: o pedido repete a conversa do claude.ai (Bloco A + caso, análise, Bloco B)', async () => {
    const { ia, cliente } = iaCom(() => respostaTexto('Olá!'));
    await ia.gerarResposta(CASO, { simulado: false, ...ANALISE_OK });
    const m = cliente.pedidos[0].messages;
    assert.deepEqual(m.map((x) => x.role), ['user', 'assistant', 'user']);
    assert.equal(m[0].content, `${BLOCO_A_ANALISE}\n\n${montarCaso(CASO)}`);
    assert.deepEqual(JSON.parse(m[1].content), ANALISE_OK, 'a análise enviada deve ter só as 6 partes');
    assert.equal(m[2].content, BLOCO_B_RESPOSTA);
    assert.equal(cliente.pedidos[0].output_config.format, undefined, 'a resposta é texto livre');
  });

  test('montarMensagensAnalise/Resposta funcionam para os 5 casos fictícios', () => {
    for (const caso of CASOS_FICTICIOS) {
      assert.equal(montarMensagensAnalise(caso)[0].content, `${BLOCO_A_ANALISE}\n\n${montarCaso(caso)}`);
      assert.equal(montarMensagensResposta(caso, ANALISE_OK).length, 3);
    }
  });

  test('o modelo e o tempo limite podem vir do .env (MODELO_IA, TEMPO_LIMITE_IA_MS)', () => {
    const antes = { m: process.env.MODELO_IA, t: process.env.TEMPO_LIMITE_IA_MS };
    process.env.MODELO_IA = 'claude-sonnet-5-5';
    process.env.TEMPO_LIMITE_IA_MS = '40000';
    try {
      const ia = criarIaReal({ cliente: clienteFalso(() => null), chave: CHAVE_FALSA });
      assert.equal(ia.modelo, 'claude-sonnet-5-5');
      assert.equal(ia.tempoLimiteMs, 40000);
    } finally {
      if (antes.m === undefined) delete process.env.MODELO_IA; else process.env.MODELO_IA = antes.m;
      if (antes.t === undefined) delete process.env.TEMPO_LIMITE_IA_MS; else process.env.TEMPO_LIMITE_IA_MS = antes.t;
    }
    assert.equal(criarIaReal({ chave: CHAVE_FALSA }).tempoLimiteMs, TEMPO_LIMITE_PADRAO_MS);
  });
});

// ============================================================
describe('2. Chave ausente ou inválida', () => {
  for (const [descricao, chave] of [['vazia', ''], ['só espaços', '   '], ['ausente', undefined]]) {
    test(`chave ${descricao}: mensagem clara e nenhuma conexão criada`, async () => {
      const antes = process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      try {
        const ia = criarIaReal(chave === undefined ? {} : { chave });
        await esperaErro(ia.analisarCaso(CASO), MENSAGENS.semChave);
        await esperaErro(ia.gerarResposta(CASO, ANALISE_OK), MENSAGENS.semChave);
      } finally {
        if (antes !== undefined) process.env.ANTHROPIC_API_KEY = antes;
      }
    });
  }

  test('chave inválida (401): mensagem clara', async () => {
    const { ia } = iaCom(() => { throw erroDaApi(Anthropic.AuthenticationError, 401, 'authentication_error'); });
    await esperaErro(ia.analisarCaso(CASO), MENSAGENS.chaveInvalida);
  });

  test('chave sem permissão (403): mensagem clara', async () => {
    const { ia } = iaCom(() => { throw erroDaApi(Anthropic.PermissionDeniedError, 403, 'permission_error'); });
    await esperaErro(ia.analisarCaso(CASO), MENSAGENS.semPermissao);
  });

  test('conta sem créditos (402): mensagem clara', async () => {
    const { ia } = iaCom(() => { throw erroDaApi(Anthropic.APIError, 402, 'billing_error'); });
    await esperaErro(ia.analisarCaso(CASO), MENSAGENS.semCreditos);
  });

  test('com chave, o cliente real é criado sem novas tentativas e com tempo limite (sem conectar)', () => {
    const ia = criarIaReal({ chave: CHAVE_FALSA });
    const cliente = ia.obterCliente();
    assert.ok(cliente instanceof Anthropic);
    assert.equal(cliente.maxRetries, 0);
    assert.equal(cliente.timeout, TEMPO_LIMITE_PADRAO_MS);
  });
});

// ============================================================
describe('3. Limite de uso, indisponibilidade e demora', () => {
  test('limite de uso (429): mensagem clara', async () => {
    const { ia } = iaCom(() => { throw erroDaApi(Anthropic.RateLimitError, 429, 'rate_limit_error'); });
    await esperaErro(ia.analisarCaso(CASO), MENSAGENS.limiteUso);
  });

  test('erro interno (500): serviço indisponível', async () => {
    const { ia } = iaCom(() => { throw erroDaApi(Anthropic.InternalServerError, 500, 'api_error'); });
    await esperaErro(ia.analisarCaso(CASO), MENSAGENS.indisponivel);
  });

  test('sobrecarga (529): serviço indisponível', async () => {
    const { ia } = iaCom(() => { throw Anthropic.APIError.generate(529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, 'Overloaded', cabecalhos()); });
    await esperaErro(ia.analisarCaso(CASO), MENSAGENS.indisponivel);
  });

  test('sem conexão: mensagem clara', async () => {
    const { ia } = iaCom(() => { throw new Anthropic.APIConnectionError({ message: 'Connection error.' }); });
    await esperaErro(ia.analisarCaso(CASO), MENSAGENS.semConexao);
  });

  test('demora (tempo esgotado): mensagem clara', async () => {
    const { ia } = iaCom(() => { throw new Anthropic.APIConnectionTimeoutError({ message: 'Request timed out.' }); });
    await esperaErro(ia.analisarCaso(CASO), MENSAGENS.demora);
    const { ia: ia2 } = iaCom(() => { throw new Anthropic.APIConnectionTimeoutError({ message: 'Request timed out.' }); });
    await esperaErro(ia2.gerarResposta(CASO, ANALISE_OK), MENSAGENS.demora);
  });

  test('tempo esgotado no servidor da API (408): mensagem de demora', async () => {
    const { ia } = iaCom(() => { throw Anthropic.APIError.generate(408, undefined, 'Request Timeout', cabecalhos()); });
    await esperaErro(ia.analisarCaso(CASO), MENSAGENS.demora);
  });

  test('conteúdo grande demais (413): mensagem clara', async () => {
    const { ia } = iaCom(() => { throw Anthropic.APIError.generate(413, undefined, 'Request Entity Too Large', cabecalhos()); });
    await esperaErro(ia.analisarCaso(CASO), MENSAGENS.conteudoGrande);
  });

  test('modelo não encontrado (404): mensagem clara', async () => {
    const { ia } = iaCom(() => { throw erroDaApi(Anthropic.NotFoundError, 404, 'not_found_error'); });
    await esperaErro(ia.analisarCaso(CASO), MENSAGENS.modeloNaoEncontrado);
  });

  test('pedido recusado pela API (400): mensagem clara', async () => {
    const { ia } = iaCom(() => { throw erroDaApi(Anthropic.BadRequestError, 400, 'invalid_request_error'); });
    await esperaErro(ia.analisarCaso(CASO), MENSAGENS.pedidoRecusado);
  });

  test('erro desconhecido (não é do SDK): mensagem genérica', async () => {
    const { ia } = iaCom(() => { throw new TypeError('algo quebrou'); });
    await esperaErro(ia.analisarCaso(CASO), MENSAGENS.inesperado);
  });
});

// ============================================================
describe('4. Recusa e formato inválido', () => {
  test('recusa da IA (stop_reason = refusal): mensagem clara', async () => {
    const { ia } = iaCom(() => ({ stop_reason: 'refusal', stop_details: { type: 'refusal', category: null }, content: [] }));
    await esperaErro(ia.analisarCaso(CASO), MENSAGENS.recusa);
    const { ia: ia2 } = iaCom(() => ({ stop_reason: 'refusal', content: [{ type: 'text', text: 'parcial' }] }));
    await esperaErro(ia2.gerarResposta(CASO, ANALISE_OK), MENSAGENS.recusa);
  });

  test('resposta cortada (stop_reason = max_tokens): mensagem clara', async () => {
    const { ia } = iaCom(() => ({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"problema": "inco' }] }));
    await esperaErro(ia.analisarCaso(CASO), MENSAGENS.incompleta);
  });

  const invalidos = [
    ['texto que não é JSON', respostaTexto('Aqui está a análise: problema...')],
    ['JSON sem uma das chaves', respostaTexto(JSON.stringify({ ...ANALISE_OK, proximoPasso: undefined }))],
    ['lista com número', respostaTexto(JSON.stringify({ ...ANALISE_OK, contradicoes: [1] }))],
    ['lista que virou texto', respostaTexto(JSON.stringify({ ...ANALISE_OK, informacoesPendentes: 'nenhuma' }))],
    ['JSON que é uma lista', respostaTexto('[]')],
    ['resposta vazia', { stop_reason: 'end_turn', content: [] }],
    ['só espaços', respostaTexto('   ')],
    ['resposta nula', null],
  ];
  for (const [descricao, resposta] of invalidos) {
    test(`análise com formato inválido (${descricao}): mensagem clara`, async () => {
      const { ia } = iaCom(() => resposta);
      await esperaErro(ia.analisarCaso(CASO), MENSAGENS.formatoInvalido);
    });
  }

  test('resposta vazia na geração do texto: mensagem clara', async () => {
    const { ia } = iaCom(() => ({ stop_reason: 'end_turn', content: [] }));
    await esperaErro(ia.gerarResposta(CASO, ANALISE_OK), MENSAGENS.formatoInvalido);
  });

  test('gerar resposta com análise incompleta: recusa sem chamar a API', async () => {
    const { ia, cliente } = iaCom(() => respostaTexto('Olá!'));
    await esperaErro(ia.gerarResposta(CASO, { problema: 'x' }), MENSAGENS.analiseInvalida);
    await esperaErro(ia.gerarResposta(CASO, null), MENSAGENS.analiseInvalida);
    assert.equal(cliente.pedidos.length, 0);
  });
});

// ============================================================
describe('5. A chave nunca aparece', () => {
  const erros = [
    ['401', () => erroDaApi(Anthropic.AuthenticationError, 401, 'authentication_error')],
    ['429', () => erroDaApi(Anthropic.RateLimitError, 429, 'rate_limit_error')],
    ['500', () => erroDaApi(Anthropic.InternalServerError, 500, 'api_error')],
    ['conexão', () => new Anthropic.APIConnectionError({ message: `falhou usando ${CHAVE_FALSA}` })],
    ['desconhecido', () => new Error(`erro contendo ${CHAVE_FALSA}`)],
  ];
  for (const [descricao, criar] of erros) {
    test(`erro ${descricao}: a chave não aparece na mensagem da tela nem no registro do terminal`, async () => {
      const { ia } = iaCom(() => { throw criar(); });
      let mensagem = '';
      try { await ia.analisarCaso(CASO); } catch (e) { mensagem = e.message; }
      assert.ok(mensagem.length > 0);
      assert.ok(!mensagem.includes(CHAVE_FALSA) && !mensagem.includes('sk-ant'), 'a chave apareceu na mensagem da tela');
      assert.ok(registros.length > 0, 'o erro técnico deveria ser registrado no terminal');
      for (const linha of registros) {
        assert.ok(!linha.includes(CHAVE_FALSA) && !linha.includes('sk-ant'), `a chave apareceu no registro: ${linha}`);
      }
    });
  }

  test('a chave não aparece nos pedidos nem nos resultados devolvidos à tela', async () => {
    const { ia, cliente } = iaCom((pedido) => (pedido.output_config.format
      ? respostaTexto(JSON.stringify(ANALISE_OK))
      : respostaTexto('Olá!')));
    const analise = await ia.analisarCaso(CASO);
    const resposta = await ia.gerarResposta(CASO, analise);
    const tudo = JSON.stringify([cliente.pedidos, analise, resposta]);
    assert.ok(!tudo.includes(CHAVE_FALSA) && !tudo.includes('sk-ant'));
  });

  test('ocultarSegredos troca a chave configurada e qualquer texto no formato de chave', () => {
    assert.equal(ocultarSegredos(`a ${CHAVE_FALSA} b`, CHAVE_FALSA), 'a [chave oculta] b');
    assert.equal(ocultarSegredos('a sk-ant-qualquer-coisa_123 b', ''), 'a [chave oculta] b');
    assert.equal(ocultarSegredos('chave-sem-prefixo', 'chave-sem-prefixo'), '[chave oculta]');
    assert.equal(ocultarSegredos(undefined), '');
  });

  test('o arquivo ia-real.js não contém nenhuma chave escrita no código', () => {
    const codigo = fs.readFileSync(path.join(RAIZ, 'server', 'ia-real.js'), 'utf8');
    assert.ok(!/sk-ant-[A-Za-z0-9]/.test(codigo));
  });
});

// ============================================================
describe('6. A aplicação continua no modo simulado', () => {
  // O modo é definido aqui no teste: o resultado não depende do valor atual do .env.
  // assert.ok em vez de assert.match: em caso de falha, o conteúdo do .env não é exibido.
  test('com MODO_IA=simulado definido no teste, a Anthropic não é usada; e não há chave da Anthropic no .env', async () => {
    const caminhos = { ia: require.resolve('../server/ia'), real: require.resolve('../server/ia-real') };
    const antes = process.env.MODO_IA;
    try {
      process.env.MODO_IA = 'simulado';
      delete require.cache[caminhos.ia];
      delete require.cache[caminhos.real];
      const ia = require('../server/ia');
      assert.equal(ia.MODO_IA, 'simulado');
      assert.equal((await ia.analisarCaso(CASO)).simulado, true);
      assert.equal(require.cache[caminhos.real], undefined, 'o modo simulado não pode carregar ia-real.js');
    } finally {
      if (antes === undefined) delete process.env.MODO_IA; else process.env.MODO_IA = antes;
      delete require.cache[caminhos.ia];
    }
    const env = fs.readFileSync(path.join(RAIZ, '.env'), 'utf8');
    assert.ok(!/^ANTHROPIC_API_KEY=/m.test(env), 'não deveria haver chave da Anthropic no .env');
  });

  test('server.js e ia.js ainda não carregam ia-real.js', () => {
    for (const arquivo of ['server.js', 'ia.js']) {
      const codigo = fs.readFileSync(path.join(RAIZ, 'server', arquivo), 'utf8');
      assert.ok(!/require\(['"]\.\/ia-real['"]\)/.test(codigo), `${arquivo} já carrega ia-real.js`);
    }
  });

  test('carregar ia-real.js não cria cliente nem lê a chave (sem efeitos colaterais)', () => {
    const codigo = fs.readFileSync(path.join(RAIZ, 'server', 'ia-real.js'), 'utf8');
    const foraDeFuncoes = codigo.split('\nfunction ')[0];
    assert.ok(!foraDeFuncoes.includes('new Anthropic'), 'o cliente não pode ser criado ao carregar o arquivo');
    assert.ok(!foraDeFuncoes.includes("require('@anthropic-ai/sdk')"), 'o SDK só deve ser carregado quando usado');
    assert.ok(codigo.includes("const { Anthropic } = require('@anthropic-ai/sdk');"), 'o SDK deve ser carregado dentro das funções');
  });
});
