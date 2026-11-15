// ============================================================
// Smart Support AI - Testes da seleção de modo (MODO_IA)
//
// Confere server/ia.js e o servidor (server/server.js) nos modos
// "simulado" e "gemini", com uma "rede falsa" para o Google.
// NENHUMA chamada real é feita: qualquer acesso que não seja ao
// próprio servidor de teste (127.0.0.1) é bloqueado e conta como falha.
//
// Como rodar (na pasta do projeto):  node --test "testes/*.test.js"
// ============================================================

const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { CASOS_FICTICIOS } = require('./casos-ficticios');

const RAIZ = path.join(__dirname, '..');
const CAMINHOS = {
  ia: require.resolve('../server/ia'),
  gemini: require.resolve('../server/ia-gemini'),
  real: require.resolve('../server/ia-real'),
  servidor: require.resolve('../server/server'),
};
const CHAVE_FALSA = 'AIzaSyFALSA-CHAVE-SO-PARA-TESTE-00000000';
const CHAVE_FALSA_AQ = 'AQ.FALSA-CHAVE-SO-PARA-TESTE_000000000000000000000';
const CASO = CASOS_FICTICIOS[0];
const PARTES = ['problema', 'necessidade', 'informacoesIdentificadas', 'informacoesPendentes', 'contradicoes', 'proximoPasso'];
const ANALISE_OK = {
  problema: 'Pedido não entregue.',
  necessidade: 'Saber a situação do pedido.',
  informacoesIdentificadas: ['O cliente afirma que fez o pedido no dia 3.'],
  informacoesPendentes: ['Perguntar ao cliente: número do pedido.'],
  contradicoes: ['Cartão de crédito × boleto pendente.'],
  proximoPasso: 'Verificar o pedido e o pagamento, sem prometer prazo.',
};
const VARIAVEIS = ['MODO_IA', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'MODELO_GEMINI', 'TEMPO_LIMITE_IA_MS', 'PORTA'];
const { MENSAGENS } = require('../server/ia-gemini');
delete require.cache[CAMINHOS.gemini]; // cada teste carrega os módulos do zero

// ---------- Rede falsa ----------
let fetchOriginal;
let acessosNaoPermitidos = 0;
let pedidos = [];
let responder = null;
let registros = [];
const ambienteOriginal = {};
const consoleOriginal = {};

const ehLocal = (url) => /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(url);

before(() => {
  for (const v of VARIAVEIS) ambienteOriginal[v] = process.env[v];
  fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const req = url instanceof Request ? url : new Request(url, init);
    if (ehLocal(req.url)) return fetchOriginal(url, init); // o próprio servidor de teste
    if (!responder) { acessosNaoPermitidos++; throw new Error('Acesso à internet bloqueado nos testes'); }
    let corpo = null;
    try { corpo = JSON.parse(await req.clone().text()); } catch (e) { corpo = null; }
    pedidos.push({ url: req.url, cabecalhos: Object.fromEntries(req.headers), corpo });
    return responder(req, init.signal || req.signal);
  };
});
after(() => {
  globalThis.fetch = fetchOriginal;
  restaurarAmbiente();
  assert.equal(acessosNaoPermitidos, 0, 'algum teste tentou acessar a internet sem a rede falsa');
});
beforeEach(() => {
  pedidos = [];
  responder = null;
  registros = [];
  for (const nome of ['error', 'warn', 'log']) consoleOriginal[nome] = console[nome];
  console.error = (...p) => { registros.push(p.join(' ')); };
  console.warn = (...p) => { registros.push(p.join(' ')); };
  console.log = (...p) => { registros.push(p.join(' ')); };
});
afterEach(() => {
  responder = null;
  for (const nome of ['error', 'warn', 'log']) console[nome] = consoleOriginal[nome];
  restaurarAmbiente();
  for (const c of Object.values(CAMINHOS)) delete require.cache[c];
});

function restaurarAmbiente() {
  for (const v of VARIAVEIS) {
    if (ambienteOriginal[v] === undefined) delete process.env[v]; else process.env[v] = ambienteOriginal[v];
  }
}

// Define as variáveis do "ambiente" e carrega o ia.js do zero.
function carregarIa(ambiente = {}) {
  for (const v of VARIAVEIS) delete process.env[v];
  for (const [nome, valor] of Object.entries(ambiente)) process.env[nome] = valor;
  for (const c of Object.values(CAMINHOS)) delete require.cache[c];
  return require('../server/ia');
}

// Respostas do "servidor do Google".
const json = (status, corpo) => () => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
const interacao = (texto) => json(200, {
  id: 'interacao-teste', status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: texto }] }],
});
const erroGoogle = (status, codigo, mensagem = 'erro simulado') => json(status, { error: { code: status, message: mensagem, status: codigo } });
// Responde à análise (com formato JSON) e à resposta (texto) corretamente.
const googleOk = (texto = 'Olá! Texto da resposta.\n\nAtenciosamente,\n[Seu nome]') => (req) => {
  const corpo = pedidos[pedidos.length - 1].corpo;
  return (corpo && corpo.response_format ? interacao(JSON.stringify(ANALISE_OK)) : interacao(texto))();
};
const travado = () => (req, sinal) => new Promise((_, rejeitar) => {
  const manter = setTimeout(() => {}, 60000);
  if (sinal) sinal.addEventListener('abort', () => { clearTimeout(manter); rejeitar(sinal.reason || new DOMException('aborted', 'AbortError')); });
});

async function esperaErro(promessa, mensagemEsperada) {
  await assert.rejects(promessa, (erro) => {
    assert.equal(erro.amigavel, true, 'o erro deveria ser amigável');
    assert.equal(erro.message, mensagemEsperada);
    return true;
  });
}

const semChave = (texto) => !texto.includes(CHAVE_FALSA) && !texto.includes(CHAVE_FALSA_AQ)
  && !/AIza[0-9A-Za-z_-]{10,}/.test(texto) && !/\bAQ\.[0-9A-Za-z_.-]{20,}/.test(texto);

// ============================================================
describe('1. Escolha do modo', () => {
  test('sem MODO_IA, ou vazio, o padrão é "simulado"', () => {
    assert.equal(carregarIa({}).MODO_IA, 'simulado');
    assert.equal(carregarIa({ MODO_IA: '' }).MODO_IA, 'simulado');
    assert.equal(carregarIa({ MODO_IA: '  ' }).MODO_IA, 'simulado');
  });

  test('MODO_IA aceita maiúsculas e espaços nas pontas', () => {
    assert.equal(carregarIa({ MODO_IA: ' Simulado ' }).MODO_IA, 'simulado');
    assert.equal(carregarIa({ MODO_IA: 'GEMINI' }).MODO_IA, 'gemini');
  });

  test('o modelo do modo gemini é o oficial: gemini-3.8-flash', () => {
    const ia = carregarIa({ MODO_IA: 'gemini' });
    assert.equal(ia.MODELO_GEMINI, 'gemini-3.8-flash');
    assert.equal(require('../server/ia-gemini').MODELO_PADRAO, ia.MODELO_GEMINI);
  });

  for (const modo of ['real', 'anthropic', 'claude', 'qualquer']) {
    test(`modo inválido "${modo}": erro claro, sem pedidos, sem carregar Gemini nem Anthropic`, async () => {
      responder = googleOk();
      const ia = carregarIa({ MODO_IA: modo, GEMINI_API_KEY: CHAVE_FALSA });
      assert.deepEqual(ia.situacaoConfiguracao(), { ok: false, mensagem: ia.MSG_MODO_INVALIDO });
      await esperaErro(ia.analisarCaso(CASO), ia.MSG_MODO_INVALIDO);
      await esperaErro(ia.gerarResposta(CASO, ANALISE_OK), ia.MSG_MODO_INVALIDO);
      assert.equal(pedidos.length, 0);
      assert.equal(require.cache[CAMINHOS.gemini], undefined, 'o Gemini não deveria ser carregado');
      assert.equal(require.cache[CAMINHOS.real], undefined, 'a Anthropic não deveria ser carregada');
    });
  }
});

// ============================================================
describe('2. Modo simulado continua igual', () => {
  for (const [descricao, ambiente] of [
    ['padrão (sem MODO_IA)', {}],
    ['MODO_IA=simulado', { MODO_IA: 'simulado' }],
    ['MODO_IA=simulado com GEMINI_API_KEY presente', { MODO_IA: 'simulado', GEMINI_API_KEY: CHAVE_FALSA }],
  ]) {
    test(`${descricao}: análise e resposta simuladas, sem rede e sem carregar o Gemini`, async () => {
      const ia = carregarIa(ambiente);
      assert.deepEqual(ia.situacaoConfiguracao(), { ok: true });
      const analise = await ia.analisarCaso(CASO);
      assert.equal(analise.simulado, true);
      for (const parte of PARTES) assert.ok(parte in analise, `faltou a parte ${parte}`);
      const resposta = await ia.gerarResposta(CASO, analise);
      assert.equal(resposta.simulado, true);
      assert.match(resposta.texto, /^Olá!/);
      assert.equal(pedidos.length, 0);
      assert.equal(require.cache[CAMINHOS.gemini], undefined, 'o modo simulado não deveria carregar o Gemini');
      assert.equal(require.cache[CAMINHOS.real], undefined, 'o modo simulado não deveria carregar a Anthropic');
    });
  }
});

// ============================================================
describe('3. Modo gemini usa a integração correta', () => {
  test('análise e resposta vêm do ia-gemini.js (simulado = false), com o modelo oficial', async () => {
    responder = googleOk();
    const ia = carregarIa({ MODO_IA: 'gemini', GEMINI_API_KEY: CHAVE_FALSA });
    assert.deepEqual(ia.situacaoConfiguracao(), { ok: true });

    const analise = await ia.analisarCaso(CASO);
    assert.deepEqual(analise, { simulado: false, ...ANALISE_OK });
    const resposta = await ia.gerarResposta(CASO, analise);
    assert.deepEqual(resposta, { simulado: false, texto: 'Olá! Texto da resposta.\n\nAtenciosamente,\n[Seu nome]' });

    assert.equal(pedidos.length, 2, 'um pedido para a análise e um para a resposta');
    for (const p of pedidos) {
      assert.match(p.url, /^https:\/\/generativelanguage\.googleapis\.com\//);
      assert.equal(p.corpo.model, 'gemini-3.8-flash');
      assert.equal(p.corpo.store, false);
      assert.equal(p.cabecalhos['x-goog-api-key'], CHAVE_FALSA);
    }
    assert.ok(pedidos[0].corpo.response_format, 'a análise deve pedir o formato JSON das 6 partes');
    assert.equal(require.cache[CAMINHOS.gemini] !== undefined, true);
    assert.equal(require.cache[CAMINHOS.real], undefined, 'a Anthropic não deveria ser carregada');
  });

  test('MODELO_GEMINI no .env não troca o modelo oficial', async () => {
    responder = googleOk();
    const ia = carregarIa({ MODO_IA: 'gemini', GEMINI_API_KEY: CHAVE_FALSA, MODELO_GEMINI: 'outro-modelo' });
    await ia.analisarCaso(CASO);
    assert.equal(pedidos[0].corpo.model, 'gemini-3.8-flash');
  });

  test('carregar o ia.js no modo gemini não faz nenhum pedido (só ao analisar)', () => {
    responder = googleOk();
    carregarIa({ MODO_IA: 'gemini', GEMINI_API_KEY: CHAVE_FALSA });
    assert.equal(pedidos.length, 0);
  });

  test('gerar resposta com análise incompleta: recusa sem enviar pedido', async () => {
    responder = googleOk();
    const ia = carregarIa({ MODO_IA: 'gemini', GEMINI_API_KEY: CHAVE_FALSA });
    await esperaErro(ia.gerarResposta(CASO, { problema: 'x' }), MENSAGENS.analiseInvalida);
    assert.equal(pedidos.length, 0);
  });
});

// ============================================================
describe('4. Modo gemini sem chave', () => {
  for (const [descricao, ambiente] of [
    ['ausente', { MODO_IA: 'gemini' }],
    ['vazia', { MODO_IA: 'gemini', GEMINI_API_KEY: '' }],
    ['só espaços', { MODO_IA: 'gemini', GEMINI_API_KEY: '   ' }],
  ]) {
    test(`chave ${descricao}: erro de configuração claro e nenhuma chamada`, async () => {
      responder = googleOk();
      const ia = carregarIa(ambiente);
      assert.deepEqual(ia.situacaoConfiguracao(), { ok: false, mensagem: MENSAGENS.semChave });
      await esperaErro(ia.analisarCaso(CASO), MENSAGENS.semChave);
      await esperaErro(ia.gerarResposta(CASO, ANALISE_OK), MENSAGENS.semChave);
      assert.equal(pedidos.length, 0, 'sem chave, nenhum pedido pode ser enviado');
    });
  }
});

// ============================================================
describe('5. Erros do Gemini: mensagem clara e sem troca silenciosa para o simulado', () => {
  const cenarios = [
    ['limite de uso (429)', erroGoogle(429, 'RESOURCE_EXHAUSTED'), MENSAGENS.limiteUso],
    ['chave recusada (401)', erroGoogle(401, 'UNAUTHENTICATED'), MENSAGENS.chaveInvalida],
    ['serviço indisponível (503)', erroGoogle(503, 'UNAVAILABLE'), MENSAGENS.indisponivel],
    ['modelo não encontrado (404)', erroGoogle(404, 'NOT_FOUND'), MENSAGENS.modeloNaoEncontrado],
    ['sem conexão', () => { throw new TypeError('fetch failed'); }, MENSAGENS.semConexao],
    ['análise que não é JSON', interacao('Aqui está a análise: ...'), MENSAGENS.formatoInvalido],
    ['análise sem uma das partes', interacao(JSON.stringify({ ...ANALISE_OK, proximoPasso: undefined })), MENSAGENS.formatoInvalido],
  ];
  for (const [descricao, resposta, mensagem] of cenarios) {
    test(`${descricao}: erro amigável, um único pedido e nenhum conteúdo simulado`, async () => {
      responder = resposta;
      const ia = carregarIa({ MODO_IA: 'gemini', GEMINI_API_KEY: CHAVE_FALSA });
      await esperaErro(ia.analisarCaso(CASO), mensagem);
      assert.equal(pedidos.length, 1, 'não pode haver novas tentativas automáticas');
    });
  }

  test('tempo esgotado: respeita TEMPO_LIMITE_IA_MS e não tenta de novo', async () => {
    responder = travado();
    const ia = carregarIa({ MODO_IA: 'gemini', GEMINI_API_KEY: CHAVE_FALSA, TEMPO_LIMITE_IA_MS: '200' });
    await esperaErro(ia.analisarCaso(CASO), MENSAGENS.demora);
    assert.equal(pedidos.length, 1);
  });

  test('resposta vazia na geração: erro, sem texto simulado no lugar', async () => {
    responder = json(200, { id: 'x', status: 'completed', steps: [] });
    const ia = carregarIa({ MODO_IA: 'gemini', GEMINI_API_KEY: CHAVE_FALSA });
    await esperaErro(ia.gerarResposta(CASO, ANALISE_OK), MENSAGENS.formatoInvalido);
  });
});

// ============================================================
describe('6. Proteção da chave no modo gemini', () => {
  for (const chave of [CHAVE_FALSA, CHAVE_FALSA_AQ]) {
    for (const [descricao, resposta] of [
      ['401 com a chave na mensagem', json(401, { error: { code: 401, message: `chave usada: ${chave}`, status: 'UNAUTHENTICATED' } })],
      ['429 com a chave na mensagem', json(429, { error: { code: 429, message: `cota da chave ${chave}`, status: 'RESOURCE_EXHAUSTED' } })],
      ['falha de conexão com a chave', () => { throw new TypeError(`fetch failed ${chave}`); }],
    ]) {
      test(`${descricao} (chave ${chave.slice(0, 3)}…): nada na tela nem no terminal`, async () => {
        responder = resposta;
        const ia = carregarIa({ MODO_IA: 'gemini', GEMINI_API_KEY: chave });
        let mensagem = '';
        try { await ia.analisarCaso(CASO); } catch (e) { mensagem = e.message; }
        assert.ok(mensagem.length > 0);
        assert.ok(semChave(mensagem), 'a chave apareceu na mensagem');
        assert.ok(registros.length > 0, 'o erro técnico deveria ser registrado');
        assert.ok(registros.every(semChave), 'a chave apareceu no terminal');
      });
    }
  }

  test('ia.js não lê nem repassa o valor da chave (só confere se existe)', () => {
    const codigo = fs.readFileSync(CAMINHOS.ia, 'utf8');
    assert.ok(!/AIza[0-9A-Za-z_-]{10,}/.test(codigo) && !/\bAQ\.[0-9A-Za-z_.-]{20,}/.test(codigo));
    assert.ok(!/console\.[a-z]+\([^)]*GEMINI_API_KEY/.test(codigo), 'ia.js não pode registrar a chave');
  });
});

// ============================================================
describe('7. Servidor (HTTP) nos dois modos', () => {
  let servidor = null;
  let base = '';

  async function ligarServidor(ambiente) {
    carregarIa({ ...ambiente, PORTA: '0' });
    ({ servidor } = require('../server/server'));
    if (!servidor.listening) await new Promise((ok) => servidor.once('listening', ok));
    base = `http://127.0.0.1:${servidor.address().port}`;
  }
  afterEach(async () => {
    if (servidor) await new Promise((ok) => servidor.close(ok));
    servidor = null;
  });

  const postar = (rota, corpo) => fetch(`${base}${rota}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
  });

  test('simulado: /api/status informa o modo e a análise/resposta continuam simuladas', async () => {
    await ligarServidor({ MODO_IA: 'simulado' });
    const status = await (await fetch(`${base}/api/status`)).json();
    assert.deepEqual(status, { status: 'funcionando', modoIA: 'simulado', configuracaoOk: true });

    const analise = await (await postar('/api/analisar', CASO)).json();
    assert.equal(analise.simulado, true);
    const resposta = await (await postar('/api/gerar-resposta', { caso: CASO, analise })).json();
    assert.equal(resposta.simulado, true);
    assert.equal(pedidos.length, 0);
  });

  test('gemini sem chave: /api/status avisa o erro de configuração e a análise falha sem chamada', async () => {
    responder = googleOk();
    await ligarServidor({ MODO_IA: 'gemini' });
    const status = await (await fetch(`${base}/api/status`)).json();
    assert.deepEqual(status, {
      status: 'funcionando', modoIA: 'gemini', configuracaoOk: false, modelo: 'gemini-3.8-flash', erroConfiguracao: MENSAGENS.semChave,
    });
    assert.ok(registros.some((l) => l.includes(MENSAGENS.semChave)), 'o terminal deveria avisar na inicialização');

    const r = await postar('/api/analisar', CASO);
    assert.equal(r.status, 500);
    assert.deepEqual(await r.json(), { erro: MENSAGENS.semChave });
    assert.equal(pedidos.length, 0);
  });

  test('gemini com chave: análise e resposta pelo Gemini; a chave não aparece no status nem nas respostas', async () => {
    responder = googleOk();
    await ligarServidor({ MODO_IA: 'gemini', GEMINI_API_KEY: CHAVE_FALSA });
    const textoStatus = await (await fetch(`${base}/api/status`)).text();
    assert.deepEqual(JSON.parse(textoStatus), { status: 'funcionando', modoIA: 'gemini', configuracaoOk: true, modelo: 'gemini-3.8-flash' });
    assert.equal(pedidos.length, 0, 'abrir o status não pode chamar a API');

    const textoAnalise = await (await postar('/api/analisar', CASO)).text();
    const analise = JSON.parse(textoAnalise);
    assert.deepEqual(analise, { simulado: false, ...ANALISE_OK });
    assert.equal(pedidos.length, 1, 'a análise não pode gerar a resposta automaticamente');

    const textoResposta = await (await postar('/api/gerar-resposta', { caso: CASO, analise })).text();
    assert.equal(JSON.parse(textoResposta).simulado, false);
    assert.equal(pedidos.length, 2);
    for (const t of [textoStatus, textoAnalise, textoResposta, ...registros]) assert.ok(semChave(t), 'a chave apareceu');
  });

  test('gemini com erro da API: HTTP 500 com a mensagem clara, sem análise simulada', async () => {
    responder = json(429, { error: { code: 429, message: `cota da chave ${CHAVE_FALSA}`, status: 'RESOURCE_EXHAUSTED' } });
    await ligarServidor({ MODO_IA: 'gemini', GEMINI_API_KEY: CHAVE_FALSA });
    const r = await postar('/api/analisar', CASO);
    assert.equal(r.status, 500);
    const texto = await r.text();
    assert.deepEqual(JSON.parse(texto), { erro: MENSAGENS.limiteUso });
    assert.ok(semChave(texto) && registros.every(semChave));
  });

  test('gerar resposta sem análise continua bloqueado no modo gemini (sem chamada)', async () => {
    responder = googleOk();
    await ligarServidor({ MODO_IA: 'gemini', GEMINI_API_KEY: CHAVE_FALSA });
    const r = await postar('/api/gerar-resposta', { caso: CASO });
    assert.equal(r.status, 400);
    assert.equal(pedidos.length, 0);
  });
});

// ============================================================
describe('8. Interface e .env', () => {
  test('a tela mostra "Modo Gemini" e avisa erro de configuração informado pelo servidor', () => {
    const app = fs.readFileSync(path.join(RAIZ, 'public', 'app.js'), 'utf8');
    assert.ok(app.includes("gemini: 'Modo Gemini'"));
    assert.ok(app.includes('dados.configuracaoOk === false'));
    assert.ok(app.includes('dados.erroConfiguracao'));
  });

  test('tempo limite da tela é 35 s e fica 10 s acima do limite de 25 s da API Gemini', () => {
    const app = fs.readFileSync(path.join(RAIZ, 'public', 'app.js'), 'utf8');
    const achado = app.match(/^const TEMPO_LIMITE_MS = (\d+);/m);
    assert.ok(achado, 'TEMPO_LIMITE_MS não encontrado em public/app.js');
    const tela = Number(achado[1]);
    assert.equal(tela, 35000);
    assert.ok(/setTimeout\(\(\) => controle\.abort\(\), TEMPO_LIMITE_MS\)/.test(app), 'a tela deve usar TEMPO_LIMITE_MS para desistir');

    const { TEMPO_LIMITE_PADRAO_MS } = require('../server/ia-gemini');
    assert.equal(TEMPO_LIMITE_PADRAO_MS, 25000, 'o limite da API Gemini deve continuar em 25 s');
    assert.ok(tela - TEMPO_LIMITE_PADRAO_MS >= 10000, 'a tela deve esperar pelo menos 10 s a mais que a API');

    const ia = carregarIa({ MODO_IA: 'gemini', GEMINI_API_KEY: CHAVE_FALSA });
    assert.equal(ia.MODO_IA, 'gemini');
    assert.equal(require('../server/ia-gemini').criarIaGemini({ chave: CHAVE_FALSA }).tempoLimiteMs, 25000);
  });

  // O modo é definido no próprio teste: o resultado não depende do valor atual do .env.
  test('MODO_IA=simulado definido no teste vale mesmo com GEMINI_API_KEY presente (sem rede, sem Gemini)', async () => {
    responder = googleOk();
    const ia = carregarIa({ MODO_IA: 'simulado', GEMINI_API_KEY: CHAVE_FALSA });
    assert.equal(ia.MODO_IA, 'simulado');
    assert.equal((await ia.analisarCaso(CASO)).simulado, true);
    assert.equal(pedidos.length, 0);
    assert.equal(require.cache[CAMINHOS.gemini], undefined, 'o modo simulado não deveria carregar o Gemini');
  });
});
