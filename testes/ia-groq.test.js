// ============================================================
// Smart Support AI - Testes da integração com a Groq
//
// Usa o SDK oficial groq-sdk DE VERDADE, mas com uma "rede falsa":
// cada teste define a resposta que o servidor da Groq daria
// (sucesso, 429, 401, resposta quebrada, travamento...).
// NENHUMA chamada real é feita.
//
// Como rodar (na pasta do projeto):  node --test "testes/*.test.js"
// ============================================================

const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  criarIaGroq, MENSAGENS, MODELO_PADRAO, TEMPO_LIMITE_PADRAO_MS, ENDERECO_OFICIAL, NIVEL_RACIOCINIO, NOME_ESQUEMA,
  montarMensagensAnalise, montarMensagensResposta,
} = require('../server/ia-groq');
const { ESQUEMA_ANALISE, ocultarSegredos } = require('../server/ia-comum');
const { BLOCO_A_ANALISE, BLOCO_B_RESPOSTA } = require('../server/prompts');
const { montarCaso } = require('../server/montar-caso');
const { CASOS_FICTICIOS } = require('./casos-ficticios');

const RAIZ = path.join(__dirname, '..');
const CHAVE_FALSA = 'gsk_FALSAchaveSOparaTESTE0000000000000000000000';
const CASO = CASOS_FICTICIOS[0];
const ANALISE_OK = {
  problema: 'Pedido não entregue.',
  necessidade: 'Saber a situação do pedido.',
  informacoesIdentificadas: ['O cliente afirma que fez o pedido no dia 3.'],
  informacoesPendentes: ['Perguntar ao cliente: número do pedido.'],
  contradicoes: ['Cartão de crédito × boleto pendente.'],
  proximoPasso: 'Verificar o pedido e o pagamento, sem prometer prazo.',
};
const semChave = (texto) => !texto.includes(CHAVE_FALSA) && !/\bgsk_[0-9A-Za-z]{20,}/.test(texto);

// ---------- Rede falsa ----------
let fetchOriginal;
let acessosNaoPermitidos = 0;
let pedidos = [];
let responder = null;
let registros = [];
let outrasSaidas = [];
const originais = {};

before(() => {
  fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const req = url instanceof Request ? url : new Request(url, init);
    if (!responder) { acessosNaoPermitidos++; throw new Error('Acesso à internet bloqueado nos testes'); }
    let corpo = null;
    try { corpo = JSON.parse(await req.clone().text()); } catch (e) { corpo = null; }
    pedidos.push({ url: req.url, metodo: req.method, cabecalhos: Object.fromEntries(req.headers), corpo });
    return responder(req, init.signal || req.signal);
  };
});
after(() => {
  globalThis.fetch = fetchOriginal;
  assert.equal(acessosNaoPermitidos, 0, 'algum teste tentou acessar a internet sem a rede falsa');
});
beforeEach(() => {
  pedidos = [];
  responder = null;
  registros = [];
  outrasSaidas = [];
  for (const nome of ['error', 'warn', 'log', 'info', 'debug']) originais[nome] = console[nome];
  console.error = (...p) => { registros.push(p.join(' ')); };
  for (const nome of ['warn', 'log', 'info', 'debug']) console[nome] = (...p) => { outrasSaidas.push(p.join(' ')); };
});
afterEach(() => {
  responder = null;
  for (const nome of Object.keys(originais)) console[nome] = originais[nome];
});

// Respostas do "servidor da Groq".
const json = (status, corpo) => () => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
const conclusao = (texto, motivo = 'stop') => json(200, {
  id: 'chatcmpl-teste', object: 'chat.completion', created: 0, model: MODELO_PADRAO,
  choices: [{ index: 0, message: { role: 'assistant', content: texto }, finish_reason: motivo }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
});
const erroGroq = (status, codigo, mensagem = 'erro simulado', tipo = 'invalid_request_error') => json(status, { error: { message: mensagem, type: tipo, code: codigo } });
const travado = () => (req, sinal) => new Promise((_, rejeitar) => {
  const manter = setTimeout(() => {}, 60000);
  if (sinal) sinal.addEventListener('abort', () => { clearTimeout(manter); rejeitar(sinal.reason || new DOMException('aborted', 'AbortError')); });
});
const ia = (opcoes = {}) => criarIaGroq({ chave: CHAVE_FALSA, ...opcoes });

async function esperaErro(promessa, mensagemEsperada) {
  await assert.rejects(promessa, (erro) => {
    assert.equal(erro.amigavel, true, 'o erro deveria ser amigável');
    assert.equal(erro.message, mensagemEsperada);
    return true;
  });
}

// ============================================================
describe('1. Respostas válidas e formato do pedido', () => {
  test('análise válida: devolve as 6 partes com simulado = false', async () => {
    responder = conclusao(JSON.stringify(ANALISE_OK));
    assert.deepEqual(await ia().analisarCaso(CASO), { simulado: false, ...ANALISE_OK });
    assert.equal(pedidos.length, 1);
  });

  test('pedido de análise: modelo oficial, raciocínio, sem raciocínio na saída e JSON estrito', async () => {
    responder = conclusao(JSON.stringify(ANALISE_OK));
    await ia().analisarCaso(CASO);
    const p = pedidos[0];
    assert.equal(p.metodo, 'POST');
    assert.match(p.url, /^https:\/\/api\.groq\.com\/openai\/v1\/chat\/completions$/);
    assert.equal(p.corpo.model, 'openai/gpt-oss-120b');
    assert.equal(MODELO_PADRAO, 'openai/gpt-oss-120b');
    assert.equal(p.corpo.reasoning_effort, NIVEL_RACIOCINIO);
    assert.equal(p.corpo.include_reasoning, false);
    assert.deepEqual(p.corpo.response_format, {
      type: 'json_schema', json_schema: { name: NOME_ESQUEMA, strict: true, schema: ESQUEMA_ANALISE },
    });
    assert.notEqual(p.corpo.stream, true, 'não deve usar streaming');
  });

  test('o esquema da análise atende ao modo estrito (tudo obrigatório, sem campos extras)', () => {
    assert.equal(ESQUEMA_ANALISE.additionalProperties, false);
    assert.deepEqual([...ESQUEMA_ANALISE.required].sort(), Object.keys(ESQUEMA_ANALISE.properties).sort());
  });

  test('pedido de análise: Bloco A + bloco <caso>, em uma única mensagem', async () => {
    responder = conclusao(JSON.stringify(ANALISE_OK));
    await ia().analisarCaso(CASO);
    assert.deepEqual(pedidos[0].corpo.messages, [{ role: 'user', content: `${BLOCO_A_ANALISE}\n\n${montarCaso(CASO)}` }]);
  });

  test('pedido de resposta: chamada separada com a mesma conversa (caso, análise, Bloco B), sem formato JSON', async () => {
    responder = conclusao('Olá! Texto da resposta.\n\nAtenciosamente,\n[Seu nome]');
    const r = await ia().gerarResposta(CASO, { simulado: false, ...ANALISE_OK, extra: 'x' });
    assert.deepEqual(r, { simulado: false, texto: 'Olá! Texto da resposta.\n\nAtenciosamente,\n[Seu nome]' });
    assert.equal(pedidos.length, 1);
    const { corpo } = pedidos[0];
    assert.equal(corpo.response_format, undefined);
    assert.deepEqual(corpo.messages, [
      { role: 'user', content: `${BLOCO_A_ANALISE}\n\n${montarCaso(CASO)}` },
      { role: 'assistant', content: JSON.stringify(ANALISE_OK, null, 2) },
      { role: 'user', content: BLOCO_B_RESPOSTA },
    ]);
  });

  test('a análise não gera a resposta automaticamente (um pedido só)', async () => {
    responder = conclusao(JSON.stringify(ANALISE_OK));
    await ia().analisarCaso(CASO);
    assert.equal(pedidos.length, 1);
    assert.ok(pedidos[0].corpo.response_format, 'o único pedido deveria ser o da análise');
  });

  test('sem histórico: pedidos seguidos não acumulam conversas anteriores', async () => {
    responder = conclusao(JSON.stringify(ANALISE_OK));
    const integracao = ia();
    await integracao.analisarCaso(CASOS_FICTICIOS[0]);
    await integracao.analisarCaso(CASOS_FICTICIOS[1]);
    await integracao.analisarCaso(CASOS_FICTICIOS[0]);
    assert.equal(pedidos.length, 3);
    for (const p of pedidos) assert.equal(p.corpo.messages.length, 1);
    assert.deepEqual(pedidos[0].corpo, pedidos[2].corpo, 'o mesmo caso deveria gerar o mesmo pedido');
    assert.ok(!JSON.stringify(pedidos[1].corpo).includes(montarCaso(CASOS_FICTICIOS[0])), 'o caso anterior vazou para o pedido seguinte');
  });

  test('a chave vai só no cabeçalho Authorization (nunca na URL nem no corpo)', async () => {
    responder = conclusao(JSON.stringify(ANALISE_OK));
    await ia().analisarCaso(CASO);
    const p = pedidos[0];
    assert.equal(p.cabecalhos.authorization, `Bearer ${CHAVE_FALSA}`);
    assert.ok(!p.url.includes(CHAVE_FALSA), 'a chave apareceu na URL');
    assert.ok(!JSON.stringify(p.corpo).includes(CHAVE_FALSA), 'a chave apareceu no corpo');
  });

  test('campos extras devolvidos pela IA são descartados', async () => {
    responder = conclusao(JSON.stringify({ ...ANALISE_OK, extra: 'não deveria aparecer' }));
    assert.deepEqual(await ia().analisarCaso(CASO), { simulado: false, ...ANALISE_OK });
  });

  test('montarMensagensAnalise/Resposta funcionam para os 5 casos fictícios', () => {
    for (const caso of CASOS_FICTICIOS) {
      assert.equal(montarMensagensAnalise(caso).length, 1);
      assert.equal(montarMensagensResposta(caso, ANALISE_OK).length, 3);
    }
  });

  test('tempo limite padrão de 25 s, ajustável por TEMPO_LIMITE_IA_MS; cliente sem novas tentativas', () => {
    const antes = process.env.TEMPO_LIMITE_IA_MS;
    try {
      delete process.env.TEMPO_LIMITE_IA_MS;
      assert.equal(TEMPO_LIMITE_PADRAO_MS, 25000);
      assert.equal(ia().tempoLimiteMs, 25000);
      process.env.TEMPO_LIMITE_IA_MS = '12000';
      const integracao = ia();
      assert.equal(integracao.tempoLimiteMs, 12000);
      const cliente = integracao.obterCliente();
      assert.equal(cliente.maxRetries, 0);
      assert.equal(cliente.timeout, 12000);
      assert.equal(cliente.logLevel, 'off');
    } finally {
      if (antes === undefined) delete process.env.TEMPO_LIMITE_IA_MS; else process.env.TEMPO_LIMITE_IA_MS = antes;
    }
  });
});

// ============================================================
describe('1b. Endereço fixo da API', () => {
  const ENDERECO_DESVIADO = 'https://desvio.invalido.example';

  test('o endereço oficial é https://api.groq.com e está escrito no código', () => {
    assert.equal(ENDERECO_OFICIAL, 'https://api.groq.com');
    const codigo = fs.readFileSync(path.join(RAIZ, 'server', 'ia-groq.js'), 'utf8');
    assert.ok(/baseURL: ENDERECO_OFICIAL/.test(codigo), 'o cliente deve receber baseURL explicitamente');
    assert.ok(!/process\.env\.GROQ_BASE_URL|process\.env\[['"]GROQ_BASE_URL/.test(codigo), 'ia-groq.js não pode ler GROQ_BASE_URL');
  });

  for (const [descricao, valor] of [
    ['endereço diferente', ENDERECO_DESVIADO],
    ['endereço http sem TLS', 'http://127.0.0.1:9'],
    ['valor vazio', ''],
  ]) {
    test(`GROQ_BASE_URL com ${descricao}: o cliente e os pedidos continuam no endereço oficial`, async () => {
      const antes = process.env.GROQ_BASE_URL;
      process.env.GROQ_BASE_URL = valor;
      try {
        responder = conclusao(JSON.stringify(ANALISE_OK));
        const integracao = ia();
        assert.equal(integracao.obterCliente().baseURL, ENDERECO_OFICIAL);
        await integracao.analisarCaso(CASO);
        responder = conclusao('Olá!');
        await integracao.gerarResposta(CASO, ANALISE_OK);
        assert.equal(pedidos.length, 2);
        for (const p of pedidos) {
          assert.equal(new URL(p.url).origin, ENDERECO_OFICIAL);
          assert.equal(p.url, `${ENDERECO_OFICIAL}/openai/v1/chat/completions`);
        }
      } finally {
        if (antes === undefined) delete process.env.GROQ_BASE_URL; else process.env.GROQ_BASE_URL = antes;
      }
    });
  }
});

// ============================================================
describe('2. Chave ausente ou inválida', () => {
  for (const [descricao, chave] of [['ausente', undefined], ['vazia', ''], ['só com espaços', '   ']]) {
    test(`chave ${descricao}: mensagem clara e nenhum pedido enviado`, async () => {
      responder = conclusao(JSON.stringify(ANALISE_OK));
      const antes = process.env.GROQ_API_KEY;
      delete process.env.GROQ_API_KEY;
      try {
        const integracao = criarIaGroq(chave === undefined ? {} : { chave });
        await esperaErro(integracao.analisarCaso(CASO), MENSAGENS.semChave);
        await esperaErro(integracao.gerarResposta(CASO, ANALISE_OK), MENSAGENS.semChave);
        assert.equal(pedidos.length, 0);
      } finally {
        if (antes !== undefined) process.env.GROQ_API_KEY = antes;
      }
    });
  }

  test('a chave vem de GROQ_API_KEY quando não é informada diretamente', async () => {
    responder = conclusao(JSON.stringify(ANALISE_OK));
    const antes = process.env.GROQ_API_KEY;
    process.env.GROQ_API_KEY = CHAVE_FALSA;
    try {
      await criarIaGroq().analisarCaso(CASO);
      assert.equal(pedidos[0].cabecalhos.authorization, `Bearer ${CHAVE_FALSA}`);
    } finally {
      if (antes === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = antes;
    }
  });

  test('chave inválida (401): mensagem clara', async () => {
    responder = erroGroq(401, 'invalid_api_key', 'Invalid API Key');
    await esperaErro(ia().analisarCaso(CASO), MENSAGENS.chaveInvalida);
  });

  test('chave inválida respondida como 400 (invalid_api_key): mensagem de chave, não de pedido', async () => {
    responder = erroGroq(400, 'invalid_api_key', 'Invalid API Key');
    await esperaErro(ia().analisarCaso(CASO), MENSAGENS.chaveInvalida);
  });

  test('sem permissão (403): mensagem clara', async () => {
    responder = erroGroq(403, 'permission_denied', 'forbidden', 'permissions_error');
    await esperaErro(ia().analisarCaso(CASO), MENSAGENS.semPermissao);
  });
});

// ============================================================
describe('3. Limites, indisponibilidade e demora', () => {
  test('limite de requisições (429): mensagem clara e SEM novas tentativas', async () => {
    responder = erroGroq(429, 'rate_limit_exceeded', 'Rate limit reached', 'tokens');
    await esperaErro(ia().analisarCaso(CASO), MENSAGENS.limiteUso);
    assert.equal(pedidos.length, 1, 'não pode haver novas tentativas automáticas');
  });

  for (const status of [500, 502, 503, 498]) {
    test(`serviço indisponível (${status}): mensagem clara e um único pedido`, async () => {
      responder = erroGroq(status, 'service_unavailable', 'over capacity', 'internal_server_error');
      await esperaErro(ia().analisarCaso(CASO), MENSAGENS.indisponivel);
      assert.equal(pedidos.length, 1);
    });
  }

  test('erro 502 em HTML (não JSON): serviço indisponível', async () => {
    responder = () => new Response('<html>Bad Gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } });
    await esperaErro(ia().analisarCaso(CASO), MENSAGENS.indisponivel);
  });

  test('prazo esgotado no servidor (504): mensagem de demora', async () => {
    responder = erroGroq(504, 'gateway_timeout', 'timeout');
    await esperaErro(ia().analisarCaso(CASO), MENSAGENS.demora);
  });

  test('timeout: o servidor não responde, o limite é respeitado e há um único pedido', async () => {
    responder = travado();
    const inicio = Date.now();
    await esperaErro(ia({ tempoLimiteMs: 300 }).analisarCaso(CASO), MENSAGENS.demora);
    assert.ok(Date.now() - inicio < 5000, 'demorou demais para desistir');
    assert.equal(pedidos.length, 1);
  });

  test('timeout também na geração da resposta', async () => {
    responder = travado();
    await esperaErro(ia({ tempoLimiteMs: 300 }).gerarResposta(CASO, ANALISE_OK), MENSAGENS.demora);
    assert.equal(pedidos.length, 1);
  });

  test('sem conexão: mensagem clara', async () => {
    responder = () => { throw new TypeError('fetch failed'); };
    await esperaErro(ia().analisarCaso(CASO), MENSAGENS.semConexao);
    assert.equal(pedidos.length, 1);
  });

  test('modelo não encontrado (404): mensagem clara', async () => {
    responder = erroGroq(404, 'model_not_found', 'The model does not exist');
    await esperaErro(ia().analisarCaso(CASO), MENSAGENS.modeloNaoEncontrado);
  });

  for (const status of [400, 422]) {
    test(`pedido inválido (${status} comum): mensagem clara`, async () => {
      responder = erroGroq(status, 'invalid_request', 'bad request');
      await esperaErro(ia().analisarCaso(CASO), MENSAGENS.pedidoRecusado);
    });
  }

  test('conteúdo grande demais (413): mensagem clara', async () => {
    responder = erroGroq(413, 'request_too_large', 'too large');
    await esperaErro(ia().analisarCaso(CASO), MENSAGENS.conteudoGrande);
  });

  test('erro desconhecido (não é do SDK): mensagem genérica', async () => {
    const cliente = { chat: { completions: { create: async () => { throw new Error('falha qualquer'); } } } };
    await esperaErro(criarIaGroq({ cliente }).analisarCaso(CASO), MENSAGENS.inesperado);
  });
});

// ============================================================
describe('4. Respostas incompletas ou inválidas', () => {
  test('resposta cortada (finish_reason = length): mensagem de incompleta', async () => {
    responder = conclusao('{"problema": "corta', 'length');
    await esperaErro(ia().analisarCaso(CASO), MENSAGENS.incompleta);
  });

  test('término inesperado (finish_reason = tool_calls): formato inválido', async () => {
    responder = conclusao('', 'tool_calls');
    await esperaErro(ia().gerarResposta(CASO, ANALISE_OK), MENSAGENS.formatoInvalido);
  });

  test('JSON fora do esquema rejeitado pela Groq (400 json_validate_failed): formato inválido', async () => {
    responder = erroGroq(400, 'json_validate_failed', 'Generated JSON does not match the expected schema.');
    await esperaErro(ia().analisarCaso(CASO), MENSAGENS.formatoInvalido);
  });

  test('corpo da resposta da API não é JSON: formato inválido', async () => {
    responder = () => new Response('isto não é json', { status: 200, headers: { 'content-type': 'application/json' } });
    await esperaErro(ia().analisarCaso(CASO), MENSAGENS.formatoInvalido);
  });

  test('resposta sem choices: formato inválido', async () => {
    responder = json(200, { id: 'x', object: 'chat.completion', choices: [] });
    await esperaErro(ia().analisarCaso(CASO), MENSAGENS.formatoInvalido);
  });

  const { problema, ...semProblema } = ANALISE_OK;
  for (const [descricao, texto] of [
    ['texto que não é JSON', 'não é json'],
    ['faltando uma parte', JSON.stringify(semProblema)],
    ['lista com item que não é texto', JSON.stringify({ ...ANALISE_OK, contradicoes: [1] })],
    ['lista de JSON em vez de objeto', JSON.stringify([ANALISE_OK])],
  ]) {
    test(`análise com formato inválido (${descricao}): mensagem clara`, async () => {
      responder = conclusao(texto);
      await esperaErro(ia().analisarCaso(CASO), MENSAGENS.formatoInvalido);
    });
  }

  for (const [descricao, conteudo] of [['vazia', ''], ['só espaços', '   '], ['nula', null]]) {
    test(`resposta ${descricao}: formato inválido, sem texto inventado`, async () => {
      responder = conclusao(conteudo);
      await esperaErro(ia().gerarResposta(CASO, ANALISE_OK), MENSAGENS.formatoInvalido);
    });
  }

  test('gerar resposta com análise incompleta: recusa sem enviar pedido', async () => {
    responder = conclusao('texto');
    const { proximoPasso, ...incompleta } = ANALISE_OK;
    await esperaErro(ia().gerarResposta(CASO, incompleta), MENSAGENS.analiseInvalida);
    await esperaErro(ia().gerarResposta(CASO, null), MENSAGENS.analiseInvalida);
    assert.equal(pedidos.length, 0);
  });
});

// ============================================================
describe('5. Proteção da chave', () => {
  for (const [descricao, resposta, mensagem] of [
    ['401 com a chave na mensagem', erroGroq(401, 'invalid_api_key', `Invalid API Key: ${CHAVE_FALSA}`), MENSAGENS.chaveInvalida],
    ['429 com a chave na mensagem', erroGroq(429, 'rate_limit_exceeded', `limite da chave ${CHAVE_FALSA}`), MENSAGENS.limiteUso],
    ['500 com outra chave gsk_ na mensagem', erroGroq(500, 'x', 'falha gsk_OUTRAchaveQUALQUER1234567890abcd'), MENSAGENS.indisponivel],
    ['400 com a chave na mensagem', erroGroq(400, 'x', `pedido ruim ${CHAVE_FALSA}`), MENSAGENS.pedidoRecusado],
  ]) {
    test(`${descricao}: a chave não aparece na tela nem no terminal`, async () => {
      responder = resposta;
      await esperaErro(ia().analisarCaso(CASO), mensagem);
      assert.ok(registros.length >= 1, 'o erro técnico deveria ser registrado no terminal');
      for (const linha of [...registros, ...outrasSaidas]) assert.ok(semChave(linha), `a chave apareceu no terminal: ${linha}`);
    });
  }

  test('o SDK não escreve nada no terminal (só o registro do próprio projeto)', async () => {
    responder = erroGroq(503, 'x', 'indisponível');
    await esperaErro(ia().analisarCaso(CASO), MENSAGENS.indisponivel);
    assert.equal(registros.length, 1);
    assert.match(registros[0], /^\[ia-groq\] análise:/);
    assert.deepEqual(outrasSaidas, []);
  });

  test('a chave não aparece nos resultados devolvidos à tela', async () => {
    responder = conclusao(JSON.stringify(ANALISE_OK));
    const analise = await ia().analisarCaso(CASO);
    responder = conclusao('Olá!');
    const resposta = await ia().gerarResposta(CASO, analise);
    assert.ok(semChave(JSON.stringify(analise)) && semChave(JSON.stringify(resposta)));
  });

  test('ocultarSegredos esconde chaves da Groq pelo formato e pelo valor de GROQ_API_KEY', () => {
    assert.equal(ocultarSegredos(`x ${CHAVE_FALSA} y`, []), 'x [chave oculta] y');
    const antes = process.env.GROQ_API_KEY;
    process.env.GROQ_API_KEY = 'valor-sem-formato-conhecido-123';
    try {
      assert.equal(ocultarSegredos('a valor-sem-formato-conhecido-123 b'), 'a [chave oculta] b');
    } finally {
      if (antes === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = antes;
    }
    assert.equal(ocultarSegredos('texto comum com gsk_curta'), 'texto comum com gsk_curta');
  });

  test('ia-groq.js não contém chaves escritas no código', () => {
    const codigo = fs.readFileSync(path.join(RAIZ, 'server', 'ia-groq.js'), 'utf8');
    assert.ok(!/\bgsk_[0-9A-Za-z]{20,}/.test(codigo), 'ia-groq.js contém algo com formato de chave');
    assert.ok(!/console\.[a-z]+\(/.test(codigo), 'ia-groq.js não deve escrever no terminal diretamente');
  });

  test('carregar ia-groq.js não cria cliente nem carrega o SDK (sem efeitos colaterais)', () => {
    const codigo = fs.readFileSync(path.join(RAIZ, 'server', 'ia-groq.js'), 'utf8');
    const foraDeFuncoes = codigo.split('\nfunction ')[0];
    assert.ok(!foraDeFuncoes.includes('new Groq'));
    assert.ok(!foraDeFuncoes.includes("require('groq-sdk')"));
    assert.ok(codigo.includes("const Groq = require('groq-sdk');"), 'o SDK deve ser carregado dentro das funções');
  });
});

// ============================================================
describe('7. Demonstração pública: teto de tokens, análise adulterada e registro sem conteúdo', () => {
  const { MAX_TOKENS_ANALISE, MAX_TOKENS_RESPOSTA } = require('../server/ia-groq');
  const { LIMITES_ANALISE } = require('../server/protecao');

  test('max_completion_tokens: 2.500 na análise e 1.500 na resposta', async () => {
    assert.equal(MAX_TOKENS_ANALISE, 2500);
    assert.equal(MAX_TOKENS_RESPOSTA, 1500);
    responder = conclusao(JSON.stringify(ANALISE_OK));
    await ia().analisarCaso(CASO);
    responder = conclusao('Olá! Texto.');
    await ia().gerarResposta(CASO, ANALISE_OK);
    assert.equal(pedidos[0].corpo.max_completion_tokens, 2500);
    assert.equal(pedidos[1].corpo.max_completion_tokens, 1500);
    for (const p of pedidos) assert.equal(p.corpo.max_tokens, undefined, 'não deve usar o parâmetro antigo max_tokens');
  });

  test('IA atinge o teto de tokens (finish_reason = length): mensagem "incompleta", sem conteúdo parcial', async () => {
    responder = conclusao('{"problema": "texto cort', 'length');
    await esperaErro(ia().analisarCaso(CASO), MENSAGENS.incompleta);
    responder = conclusao('Olá! Texto cort', 'length');
    await esperaErro(ia().gerarResposta(CASO, ANALISE_OK), MENSAGENS.incompleta);
  });

  const grande = (n) => 'x'.repeat(n);
  for (const [descricao, analise] of [
    ['texto acima de 3.000 caracteres', { ...ANALISE_OK, problema: grande(LIMITES_ANALISE.texto + 1) }],
    ['lista com 21 itens', { ...ANALISE_OK, informacoesPendentes: Array(LIMITES_ANALISE.itensPorLista + 1).fill('item') }],
    ['item acima de 1.500 caracteres', { ...ANALISE_OK, contradicoes: [grande(LIMITES_ANALISE.item + 1)] }],
    ['total acima de 12.000 caracteres', { ...ANALISE_OK, informacoesIdentificadas: Array(9).fill(grande(1400)) }],
    ['item que não é texto', { ...ANALISE_OK, informacoesIdentificadas: [{ texto: 'x' }] }],
  ]) {
    test(`análise adulterada (${descricao}): recusada antes de qualquer pedido à Groq`, async () => {
      responder = conclusao('não deveria ser chamado');
      await esperaErro(ia().gerarResposta(CASO, analise), MENSAGENS.analiseInvalida);
      assert.equal(pedidos.length, 0);
    });
  }

  test('análise no limite exato (3.000 / 20 itens / 1.500 / 12.000) é aceita', async () => {
    responder = conclusao('Olá! Texto.');
    const analise = {
      problema: grande(3000), necessidade: grande(1000), proximoPasso: grande(1000),
      informacoesIdentificadas: Array(4).fill(grande(1500)), informacoesPendentes: Array(1).fill(grande(1000)), contradicoes: [],
    };
    assert.equal(3000 + 1000 + 1000 + 6000 + 1000, LIMITES_ANALISE.total);
    await ia().gerarResposta(CASO, analise);
    assert.equal(pedidos.length, 1);
  });

  test('erro da Groq com "failed_generation": o texto gerado a partir do caso NÃO vai para o terminal', async () => {
    const MARCA = 'CONTEUDO-DO-CASO-7f3a';
    responder = json(400, { error: { message: `Failed to generate JSON ${MARCA}`, type: 'invalid_request_error', code: 'json_validate_failed', failed_generation: `{"problema": "${MARCA}"}` } });
    await esperaErro(ia().analisarCaso(CASO), MENSAGENS.formatoInvalido);
    assert.equal(registros.length, 1);
    assert.match(registros[0], /^\[ia-groq\] análise: [A-Za-z]+ \| status=400 \| codigo=json_validate_failed$/);
    for (const linha of [...registros, ...outrasSaidas]) assert.ok(!linha.includes(MARCA), `conteúdo do caso no terminal: ${linha}`);
  });

  test('mensagens da Groq mostradas ao visitante não citam .env nem variáveis', () => {
    for (const [nome, texto] of Object.entries(MENSAGENS)) {
      assert.ok(!/\.env\b|_API_KEY|MODO_IA|MODELO_GEMINI/.test(texto), `MENSAGENS.${nome} cita detalhe interno: ${texto}`);
    }
  });
});
