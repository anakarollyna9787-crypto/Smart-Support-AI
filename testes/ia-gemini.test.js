// ============================================================
// Smart Support AI - Testes da integração com o Google Gemini
//
// Usa o SDK oficial @google/genai DE VERDADE, mas com uma "rede falsa":
// cada teste define a resposta que o servidor do Google daria
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
  criarIaGemini, MENSAGENS, MODELO_PADRAO, TEMPO_LIMITE_PADRAO_MS, NIVEL_RACIOCINIO,
  montarEntradaAnalise, montarEntradaResposta,
} = require('../server/ia-gemini');
const { ESQUEMA_ANALISE, ocultarSegredos } = require('../server/ia-comum');
const { BLOCO_A_ANALISE, BLOCO_B_RESPOSTA } = require('../server/prompts');
const { montarCaso } = require('../server/montar-caso');
const { CASOS_FICTICIOS } = require('./casos-ficticios');

const RAIZ = path.join(__dirname, '..');
const CHAVE_FALSA = 'AIzaSyFALSA-CHAVE-SO-PARA-TESTE-00000000';
const CASO = CASOS_FICTICIOS[0];
const ANALISE_OK = {
  problema: 'Pedido não entregue.',
  necessidade: 'Saber a situação do pedido.',
  informacoesIdentificadas: ['O cliente afirma que fez o pedido no dia 3.'],
  informacoesPendentes: ['Perguntar ao cliente: número do pedido.'],
  contradicoes: ['Cartão de crédito × boleto pendente.'],
  proximoPasso: 'Verificar o pedido e o pagamento, sem prometer prazo.',
};

// ---------- Rede falsa ----------
let fetchOriginal;
let acessosNaoPermitidos = 0;
let pedidos = [];
let responder = null;
let registros = [];
let avisos = [];
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
  avisos = [];
  originais.error = console.error;
  originais.warn = console.warn;
  console.error = (...p) => { registros.push(p.join(' ')); };
  console.warn = (...p) => { avisos.push(p.join(' ')); };
});
afterEach(() => {
  responder = null;
  console.error = originais.error;
  console.warn = originais.warn;
});

// Respostas do "servidor do Google".
const json = (status, corpo) => () => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
const interacao = (texto, status = 'completed') => json(200, {
  id: 'interacao-teste', status, steps: [{ type: 'model_output', content: [{ type: 'text', text: texto }] }],
});
const erroGoogle = (status, codigo, mensagem = 'erro simulado') => json(status, { error: { code: status, message: mensagem, status: codigo } });
const travado = () => (req, sinal) => new Promise((_, rejeitar) => {
  const manter = setTimeout(() => {}, 60000);
  if (sinal) sinal.addEventListener('abort', () => { clearTimeout(manter); rejeitar(sinal.reason || new DOMException('aborted', 'AbortError')); });
});
const ia = (opcoes = {}) => criarIaGemini({ chave: CHAVE_FALSA, ...opcoes });

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
    responder = interacao(JSON.stringify(ANALISE_OK));
    assert.deepEqual(await ia().analisarCaso(CASO), { simulado: false, ...ANALISE_OK });
  });

  test('pedido de análise: modelo, store=false, raciocínio e formato JSON garantido', async () => {
    responder = interacao(JSON.stringify(ANALISE_OK));
    await ia().analisarCaso(CASO);
    assert.equal(pedidos.length, 1);
    const c = pedidos[0].corpo;
    assert.equal(c.model, MODELO_PADRAO);
    assert.equal(MODELO_PADRAO, 'gemini-3.8-flash');
    assert.equal(c.store, false, 'o Google não pode guardar a conversa');
    assert.equal('automatic_continuation' in c, false, 'a opção é do SDK e não vai ao servidor');
    assert.deepEqual(c.generation_config, { thinking_level: NIVEL_RACIOCINIO });
    assert.deepEqual(c.response_format, { type: 'text', mime_type: 'application/json', schema: ESQUEMA_ANALISE });
    assert.equal('response_mime_type' in c, false, 'campo obsoleto não deve ser usado');
  });

  test('pedido de análise: Bloco A + bloco <caso> exatamente como no teste do claude.ai', async () => {
    responder = interacao(JSON.stringify(ANALISE_OK));
    await ia().analisarCaso(CASO);
    assert.deepEqual(pedidos[0].corpo.input, [
      { type: 'user_input', content: [{ type: 'text', text: `${BLOCO_A_ANALISE}\n\n${montarCaso(CASO)}` }] },
    ]);
  });

  test('pedido de resposta: a mesma conversa (Bloco A + caso, análise, Bloco B), sem formato JSON', async () => {
    responder = interacao('Olá! Texto da resposta.\n\nAtenciosamente,\n[Seu nome]');
    const r = await ia().gerarResposta(CASO, { simulado: false, ...ANALISE_OK });
    assert.deepEqual(r, { simulado: false, texto: 'Olá! Texto da resposta.\n\nAtenciosamente,\n[Seu nome]' });
    const entrada = pedidos[0].corpo.input;
    assert.deepEqual(entrada.map((t) => t.type), ['user_input', 'model_output', 'user_input']);
    assert.equal(entrada[0].content[0].text, `${BLOCO_A_ANALISE}\n\n${montarCaso(CASO)}`);
    assert.deepEqual(JSON.parse(entrada[1].content[0].text), ANALISE_OK, 'a análise enviada deve ter só as 6 partes');
    assert.equal(entrada[2].content[0].text, BLOCO_B_RESPOSTA);
    assert.equal(pedidos[0].corpo.response_format, undefined);
    assert.equal(pedidos[0].corpo.store, false);
  });

  test('a chave vai só no cabeçalho x-goog-api-key (nunca na URL nem no corpo)', async () => {
    responder = interacao(JSON.stringify(ANALISE_OK));
    await ia().analisarCaso(CASO);
    const p = pedidos[0];
    assert.equal(p.cabecalhos['x-goog-api-key'], CHAVE_FALSA);
    assert.ok(!p.url.includes(CHAVE_FALSA) && !/key=/.test(p.url), 'a chave apareceu na URL');
    assert.ok(!JSON.stringify(p.corpo).includes(CHAVE_FALSA), 'a chave apareceu no corpo');
    assert.match(p.url, /^https:\/\/generativelanguage\.googleapis\.com\//);
  });

  test('campos extras devolvidos pela IA são descartados', async () => {
    responder = interacao(JSON.stringify({ ...ANALISE_OK, extra: 'x' }));
    assert.equal('extra' in await ia().analisarCaso(CASO), false);
  });

  test('montarEntradaAnalise/Resposta funcionam para os 5 casos fictícios', () => {
    for (const caso of CASOS_FICTICIOS) {
      assert.equal(montarEntradaAnalise(caso)[0].content[0].text, `${BLOCO_A_ANALISE}\n\n${montarCaso(caso)}`);
      assert.equal(montarEntradaResposta(caso, ANALISE_OK).length, 3);
    }
  });

  test('modelo e tempo limite podem vir do .env (MODELO_GEMINI, TEMPO_LIMITE_IA_MS)', () => {
    const antes = { m: process.env.MODELO_GEMINI, t: process.env.TEMPO_LIMITE_IA_MS };
    process.env.MODELO_GEMINI = 'gemini-3.6-flash';
    process.env.TEMPO_LIMITE_IA_MS = '40000';
    try {
      const x = criarIaGemini({ chave: CHAVE_FALSA });
      assert.equal(x.modelo, 'gemini-3.6-flash');
      assert.equal(x.tempoLimiteMs, 40000);
    } finally {
      if (antes.m === undefined) delete process.env.MODELO_GEMINI; else process.env.MODELO_GEMINI = antes.m;
      if (antes.t === undefined) delete process.env.TEMPO_LIMITE_IA_MS; else process.env.TEMPO_LIMITE_IA_MS = antes.t;
    }
    assert.equal(criarIaGemini({ chave: CHAVE_FALSA }).tempoLimiteMs, TEMPO_LIMITE_PADRAO_MS);
  });
});

// ============================================================
describe('2. Chave ausente ou inválida', () => {
  for (const [descricao, chave] of [['vazia', ''], ['só espaços', '   '], ['ausente', undefined]]) {
    test(`chave ${descricao}: mensagem clara e nenhum pedido enviado`, async () => {
      const antes = process.env.GEMINI_API_KEY;
      delete process.env.GEMINI_API_KEY;
      try {
        responder = interacao(JSON.stringify(ANALISE_OK));
        const x = criarIaGemini(chave === undefined ? {} : { chave });
        await esperaErro(x.analisarCaso(CASO), MENSAGENS.semChave);
        await esperaErro(x.gerarResposta(CASO, ANALISE_OK), MENSAGENS.semChave);
        assert.equal(pedidos.length, 0);
      } finally {
        if (antes !== undefined) process.env.GEMINI_API_KEY = antes;
      }
    });
  }

  test('chave inválida (401): mensagem clara', async () => {
    responder = erroGoogle(401, 'UNAUTHENTICATED');
    await esperaErro(ia().analisarCaso(CASO), MENSAGENS.chaveInvalida);
  });

  test('chave inválida respondida como 400 (API_KEY_INVALID): mensagem de chave, não de pedido', async () => {
    responder = json(400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } });
    await esperaErro(ia().analisarCaso(CASO), MENSAGENS.chaveInvalida);
  });

  test('sem permissão (403): mensagem clara', async () => {
    responder = erroGoogle(403, 'PERMISSION_DENIED');
    await esperaErro(ia().analisarCaso(CASO), MENSAGENS.semPermissao);
  });
});

// ============================================================
describe('3. Limites, indisponibilidade e demora', () => {
  test('limite de requisições / cota gratuita (429): mensagem clara e SEM novas tentativas', async () => {
    responder = erroGoogle(429, 'RESOURCE_EXHAUSTED');
    await esperaErro(ia().analisarCaso(CASO), MENSAGENS.limiteUso);
    assert.equal(pedidos.length, 1, 'um 429 não pode gerar novos pedidos automáticos');
    assert.match(MENSAGENS.limiteUso, /nível gratuito/);
  });

  for (const [status, codigo] of [[500, 'INTERNAL'], [503, 'UNAVAILABLE']]) {
    test(`serviço indisponível (${status}): mensagem clara e um único pedido`, async () => {
      responder = erroGoogle(status, codigo);
      await esperaErro(ia().analisarCaso(CASO), MENSAGENS.indisponivel);
      assert.equal(pedidos.length, 1);
    });
  }

  test('erro 502 em HTML (não JSON): serviço indisponível', async () => {
    responder = () => new Response('<html>erro</html>', { status: 502, headers: { 'content-type': 'text/html' } });
    await esperaErro(ia().analisarCaso(CASO), MENSAGENS.indisponivel);
  });

  test('prazo esgotado no Google (504): mensagem de demora', async () => {
    responder = erroGoogle(504, 'DEADLINE_EXCEEDED');
    await esperaErro(ia().analisarCaso(CASO), MENSAGENS.demora);
  });

  test('timeout: o servidor não responde, o limite é respeitado e há um único pedido', async () => {
    responder = travado();
    const inicio = Date.now();
    await esperaErro(ia({ tempoLimiteMs: 200 }).analisarCaso(CASO), MENSAGENS.demora);
    assert.equal(pedidos.length, 1, 'o timeout não pode gerar novos pedidos automáticos');
    assert.ok(Date.now() - inicio < 3000, `demorou ${Date.now() - inicio} ms para desistir`);
  });

  test('timeout também na geração da resposta', async () => {
    responder = travado();
    await esperaErro(ia({ tempoLimiteMs: 200 }).gerarResposta(CASO, ANALISE_OK), MENSAGENS.demora);
  });

  test('sem conexão: mensagem clara', async () => {
    responder = () => { throw new TypeError('fetch failed'); };
    await esperaErro(ia().analisarCaso(CASO), MENSAGENS.semConexao);
  });

  test('modelo não encontrado (404): mensagem clara', async () => {
    responder = erroGoogle(404, 'NOT_FOUND');
    await esperaErro(ia().analisarCaso(CASO), MENSAGENS.modeloNaoEncontrado);
  });

  test('pedido inválido (400 comum): mensagem clara', async () => {
    responder = erroGoogle(400, 'INVALID_ARGUMENT', 'schema too complex');
    await esperaErro(ia().analisarCaso(CASO), MENSAGENS.pedidoRecusado);
  });

  test('conteúdo grande demais (413): mensagem clara', async () => {
    responder = erroGoogle(413, 'INVALID_ARGUMENT');
    await esperaErro(ia().analisarCaso(CASO), MENSAGENS.conteudoGrande);
  });

  test('erro desconhecido (não é do SDK): mensagem genérica', async () => {
    const cliente = { interactions: { create: async () => { throw new RangeError('algo quebrou'); } } };
    await esperaErro(criarIaGemini({ cliente }).analisarCaso(CASO), MENSAGENS.inesperado);
  });
});

// ============================================================
describe('4. Recusas e respostas inválidas', () => {
  test('pedido bloqueado pelos filtros de segurança (status failed): mensagem clara', async () => {
    responder = json(200, { id: 'x', status: 'failed', steps: [{ type: 'model_output', error: { code: 3, message: 'blocked by safety' } }] });
    await esperaErro(ia().analisarCaso(CASO), MENSAGENS.bloqueado);
    responder = json(200, { id: 'x', status: 'failed', steps: [] });
    await esperaErro(ia().gerarResposta(CASO, ANALISE_OK), MENSAGENS.bloqueado);
  });

  for (const situacao of ['incomplete', 'requires_continuation', 'budget_exceeded']) {
    test(`resposta incompleta (status ${situacao}): mensagem clara`, async () => {
      responder = interacao('{"problema": "inco', situacao);
      await esperaErro(ia().analisarCaso(CASO), MENSAGENS.incompleta);
    });
  }

  test('situação inesperada (status requires_action / cancelled): formato inválido', async () => {
    for (const situacao of ['requires_action', 'cancelled']) {
      responder = interacao(JSON.stringify(ANALISE_OK), situacao);
      await esperaErro(ia().analisarCaso(CASO), MENSAGENS.formatoInvalido);
    }
  });

  test('corpo da resposta da API não é JSON: formato inválido', async () => {
    responder = () => new Response('{ isto nao e json', { status: 200, headers: { 'content-type': 'application/json' } });
    await esperaErro(ia().analisarCaso(CASO), MENSAGENS.formatoInvalido);
  });

  const invalidos = [
    ['texto que não é JSON', 'Aqui está a análise: problema...'],
    ['JSON sem uma das chaves', JSON.stringify({ ...ANALISE_OK, proximoPasso: undefined })],
    ['lista com número', JSON.stringify({ ...ANALISE_OK, contradicoes: [1] })],
    ['lista que virou texto', JSON.stringify({ ...ANALISE_OK, informacoesPendentes: 'nenhuma' })],
    ['JSON que é uma lista', '[]'],
    ['só espaços', '   '],
  ];
  for (const [descricao, texto] of invalidos) {
    test(`análise com formato inválido (${descricao}): mensagem clara`, async () => {
      responder = interacao(texto);
      await esperaErro(ia().analisarCaso(CASO), MENSAGENS.formatoInvalido);
    });
  }

  test('resposta sem nenhum texto: formato inválido', async () => {
    responder = json(200, { id: 'x', status: 'completed', steps: [] });
    await esperaErro(ia().analisarCaso(CASO), MENSAGENS.formatoInvalido);
    await esperaErro(ia().gerarResposta(CASO, ANALISE_OK), MENSAGENS.formatoInvalido);
  });

  test('gerar resposta com análise incompleta: recusa sem enviar pedido', async () => {
    responder = interacao('Olá!');
    await esperaErro(ia().gerarResposta(CASO, { problema: 'x' }), MENSAGENS.analiseInvalida);
    await esperaErro(ia().gerarResposta(CASO, null), MENSAGENS.analiseInvalida);
    assert.equal(pedidos.length, 0);
  });
});

// ============================================================
describe('5. Proteção da chave', () => {
  const comChaveNaMensagem = `chave usada: ${CHAVE_FALSA}`;
  const cenarios = [
    ['401 com a chave na mensagem', json(401, { error: { code: 401, message: comChaveNaMensagem, status: 'UNAUTHENTICATED' } })],
    ['400 API_KEY_INVALID com a chave', json(400, { error: { code: 400, message: `API key not valid: ${CHAVE_FALSA}`, status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } })],
    ['429 com a chave na mensagem', json(429, { error: { code: 429, message: comChaveNaMensagem, status: 'RESOURCE_EXHAUSTED' } })],
    ['500 com a chave na mensagem', json(500, { error: { code: 500, message: comChaveNaMensagem, status: 'INTERNAL' } })],
    ['falha de conexão com a chave', () => { throw new TypeError(`fetch failed ${CHAVE_FALSA}`); }],
  ];
  for (const [descricao, resposta] of cenarios) {
    test(`${descricao}: a chave não aparece na tela nem no terminal`, async () => {
      responder = resposta;
      let mensagem = '';
      try { await ia().analisarCaso(CASO); } catch (e) { mensagem = e.message; }
      assert.ok(mensagem.length > 0);
      assert.ok(!mensagem.includes(CHAVE_FALSA) && !/AIza/.test(mensagem), 'a chave apareceu na mensagem da tela');
      assert.ok(registros.length > 0, 'o erro técnico deveria ser registrado no terminal');
      for (const linha of [...registros, ...avisos]) {
        assert.ok(!linha.includes(CHAVE_FALSA) && !/AIza/.test(linha), `a chave apareceu no terminal: ${linha}`);
      }
    });
  }

  test('a chave não aparece nos resultados devolvidos à tela', async () => {
    responder = (req) => {
      const corpo = pedidos[pedidos.length - 1].corpo;
      return corpo.response_format ? interacao(JSON.stringify(ANALISE_OK))() : interacao('Olá!')();
    };
    const x = ia();
    const analise = await x.analisarCaso(CASO);
    const resposta = await x.gerarResposta(CASO, analise);
    const tudo = JSON.stringify([analise, resposta, pedidos.map((p) => [p.url, p.corpo])]);
    assert.ok(!tudo.includes(CHAVE_FALSA));
  });

  test('ocultarSegredos esconde chaves do Google e da Anthropic', () => {
    assert.equal(ocultarSegredos(`a ${CHAVE_FALSA} b`, [CHAVE_FALSA]), 'a [chave oculta] b');
    assert.equal(ocultarSegredos('a AIzaSyQualquerCoisa_123-abc b', []), 'a [chave oculta] b');
    assert.equal(ocultarSegredos('a sk-ant-api03-xyz b', []), 'a [chave oculta] b');
    assert.equal(ocultarSegredos(undefined, []), '');
  });

  test('ia-gemini.js e ia-comum.js não contêm chaves escritas no código', () => {
    for (const arquivo of ['ia-gemini.js', 'ia-comum.js']) {
      const codigo = fs.readFileSync(path.join(RAIZ, 'server', arquivo), 'utf8');
      assert.ok(!/AIza[0-9A-Za-z_-]{10,}/.test(codigo) && !/sk-ant-[A-Za-z0-9]/.test(codigo), `${arquivo} contém algo com formato de chave`);
      assert.ok(!/\bAQ\.[0-9A-Za-z_.-]{20,}/.test(codigo), `${arquivo} contém algo com formato de chave AQ.`);
    }
  });
});

// ============================================================
describe('5b. Proteção de chaves Google no formato AQ.', () => {
  // Chaves FALSAS, só para teste (nenhuma é real).
  const AQ_FALSA = 'AQ.FALSA-CHAVE-SO-PARA-TESTE_000000000000000000000';
  const AQ_OUTRA = 'AQ.OUTRA.CHAVE-FALSA_SO-PARA-TESTE-111111111111111';
  const temAQ = (texto) => texto.includes(AQ_FALSA) || texto.includes(AQ_OUTRA) || /\bAQ\.[0-9A-Za-z_.-]{20,}/.test(texto);

  test('ocultarSegredos esconde chaves AQ. pelo formato, mesmo sem conhecer o valor', () => {
    assert.equal(ocultarSegredos(`a ${AQ_FALSA} b`, []), 'a [chave oculta] b');
    assert.equal(ocultarSegredos(`x=${AQ_OUTRA};`, []), 'x=[chave oculta];');
    assert.equal(ocultarSegredos(`"${AQ_FALSA}" e ${CHAVE_FALSA}`, []), '"[chave oculta]" e [chave oculta]');
  });

  test('ocultarSegredos não altera textos comuns', () => {
    for (const texto of ['Pedido AQ. 123', 'status=AQ.ok', 'FAQ.informacoes-do-cliente-sobre-o-pedido']) {
      assert.equal(ocultarSegredos(texto, []), texto);
    }
  });

  // Erros da API que trazem uma chave AQ. diferente da configurada:
  // só o filtro por formato consegue escondê-la.
  const cenarios = [
    ['401', json(401, { error: { code: 401, message: `chave usada: ${AQ_OUTRA}`, status: 'UNAUTHENTICATED' } })],
    ['400 API_KEY_INVALID', json(400, { error: { code: 400, message: `API key not valid: ${AQ_OUTRA}`, status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } })],
    ['429', json(429, { error: { code: 429, message: `cota da chave ${AQ_OUTRA}`, status: 'RESOURCE_EXHAUSTED' } })],
    ['500', json(500, { error: { code: 500, message: `falha interna ${AQ_OUTRA}`, status: 'INTERNAL' } })],
    ['falha de conexão', () => { throw new TypeError(`fetch failed ${AQ_OUTRA}`); }],
  ];
  for (const [descricao, resposta] of cenarios) {
    for (const [tipoChave, chave] of [['chave AIza', CHAVE_FALSA], ['chave AQ.', AQ_FALSA]]) {
      test(`${descricao} com ${tipoChave} configurada: nenhuma chave AQ. na tela nem no terminal`, async () => {
        responder = resposta;
        let mensagem = '';
        try { await criarIaGemini({ chave }).analisarCaso(CASO); } catch (e) { mensagem = e.message; }
        assert.ok(mensagem.length > 0);
        assert.ok(!temAQ(mensagem) && !mensagem.includes(chave), 'uma chave apareceu na mensagem da tela');
        assert.ok(registros.length > 0, 'o erro técnico deveria ser registrado no terminal');
        for (const linha of [...registros, ...avisos]) {
          assert.ok(!temAQ(linha) && !linha.includes(chave), 'uma chave apareceu no terminal');
        }
      });
    }
  }

  test('chave AQ. configurada vai só no cabeçalho e não aparece nos resultados', async () => {
    responder = (req) => {
      const corpo = pedidos[pedidos.length - 1].corpo;
      return corpo.response_format ? interacao(JSON.stringify(ANALISE_OK))() : interacao('Olá!')();
    };
    const x = criarIaGemini({ chave: AQ_FALSA });
    const analise = await x.analisarCaso(CASO);
    const resposta = await x.gerarResposta(CASO, analise);
    assert.ok(pedidos.every((p) => p.cabecalhos['x-goog-api-key'] === AQ_FALSA), 'a chave deveria ir no cabeçalho');
    const tudo = JSON.stringify([analise, resposta, pedidos.map((p) => [p.url, p.corpo])]);
    assert.ok(!temAQ(tudo), 'a chave AQ. apareceu na URL, no corpo ou nos resultados');
  });
});

// ============================================================
describe('6. A aplicação, o modo simulado e a Anthropic continuam iguais', () => {
  // A presença (ou ausência) de GEMINI_API_KEY no .env não importa para o modo simulado.
  // assert.ok em vez de assert.match: em caso de falha, o conteúdo do .env não é exibido.
  // O modo é definido em cada teste; aqui só se confere que o .env tem um valor válido.
  test('o .env tem um MODO_IA válido (simulado, gemini ou groq) e nenhuma chave da Anthropic', () => {
    const env = fs.readFileSync(path.join(RAIZ, '.env'), 'utf8');
    const modos = [...env.matchAll(/^MODO_IA=(.*?)\r?$/gm)].map((m) => m[1].trim().toLowerCase());
    assert.equal(modos.length, 1, 'o .env deveria ter exatamente uma linha MODO_IA');
    assert.ok(['simulado', 'gemini', 'groq'].includes(modos[0]), 'MODO_IA no .env deveria ser "simulado", "gemini" ou "groq"');
    assert.ok(!/^ANTHROPIC_API_KEY=/m.test(env), 'não deveria haver chave da Anthropic no .env');
  });

  test('modo simulado funciona com ou sem GEMINI_API_KEY e não acessa a internet', async () => {
    const caminhoIa = require.resolve('../server/ia');
    const antes = { chave: process.env.GEMINI_API_KEY, modo: process.env.MODO_IA };
    try {
      for (const chave of [undefined, CHAVE_FALSA]) {
        if (chave === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = chave;
        process.env.MODO_IA = 'simulado';
        delete require.cache[caminhoIa];
        const iaSimulada = require('../server/ia');
        assert.equal(iaSimulada.MODO_IA, 'simulado');
        const analise = await iaSimulada.analisarCaso(CASO);
        assert.equal(analise.simulado, true);
        const resposta = await iaSimulada.gerarResposta(CASO, analise);
        assert.equal(resposta.simulado, true);
        assert.ok(typeof resposta.texto === 'string' && resposta.texto.length > 0);
        assert.equal(pedidos.length, 0, 'o modo simulado não pode enviar pedidos');
      }
    } finally {
      if (antes.chave === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = antes.chave;
      if (antes.modo === undefined) delete process.env.MODO_IA; else process.env.MODO_IA = antes.modo;
      delete require.cache[caminhoIa];
    }
  });

  test('só o ia.js carrega o ia-gemini.js; server.js e ia-real.js não carregam o Gemini', () => {
    const ia = fs.readFileSync(path.join(RAIZ, 'server', 'ia.js'), 'utf8');
    assert.ok(/require\(['"]\.\/ia-gemini['"]\)/.test(ia), 'ia.js deveria usar ia-gemini.js no modo gemini');
    assert.ok(!/require\(['"]\.\/ia-comum['"]\)/.test(ia), 'ia.js não deveria carregar ia-comum.js diretamente');
    assert.ok(!/require\(['"]\.\/ia-real['"]\)/.test(ia), 'ia.js não pode carregar a integração Anthropic');
    for (const arquivo of ['server.js', 'ia-real.js']) {
      const codigo = fs.readFileSync(path.join(RAIZ, 'server', arquivo), 'utf8');
      assert.ok(!/require\(['"]\.\/ia-gemini['"]\)/.test(codigo), `${arquivo} carrega ia-gemini.js`);
      assert.ok(!/require\(['"]\.\/ia-comum['"]\)/.test(codigo), `${arquivo} carrega ia-comum.js`);
    }
  });

  test('carregar ia-gemini.js não cria cliente nem carrega o SDK (sem efeitos colaterais)', () => {
    const codigo = fs.readFileSync(path.join(RAIZ, 'server', 'ia-gemini.js'), 'utf8');
    const foraDeFuncoes = codigo.split('\nfunction ')[0];
    assert.ok(!foraDeFuncoes.includes('new GoogleGenAI'));
    assert.ok(!foraDeFuncoes.includes("require('@google/genai')"));
    assert.ok(codigo.includes("const { GoogleGenAI } = require('@google/genai');"), 'o SDK deve ser carregado dentro das funções');
  });

  test('os prompts e os casos usados aqui são os oficiais (mesmos módulos da Etapa 3.1)', () => {
    const codigo = fs.readFileSync(path.join(RAIZ, 'server', 'ia-gemini.js'), 'utf8');
    assert.ok(codigo.includes("require('./prompts')") && codigo.includes("require('./montar-caso')"));
  });
});
