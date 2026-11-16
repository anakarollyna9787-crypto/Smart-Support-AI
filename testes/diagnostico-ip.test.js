// ============================================================
// Smart Support AI - Testes do diagnóstico TEMPORÁRIO de IP
//
// Confere server/diagnostico-ip.js e a ligação com o server.js:
// desligado por padrão, token só pelo cabeçalho Authorization,
// expiração (30 consultas / 30 minutos), cabeçalhos grandes,
// cabeçalhos falsificados e nenhum IP ou segredo na resposta ou no terminal.
//
// NENHUMA chamada externa é feita (qualquer acesso fora do 127.0.0.1 é bloqueado).
// Como rodar (na pasta do projeto):  npm test
// ============================================================

const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const express = require('express');

const { CASOS_FICTICIOS } = require('./casos-ficticios');

const RAIZ = path.join(__dirname, '..');
const CAMINHOS = ['../server/server', '../server/ia', '../server/ia-gemini', '../server/ia-groq', '../server/ia-real', '../server/protecao', '../server/diagnostico-ip'].map((c) => require.resolve(c));
const VARIAVEIS = ['MODO_IA', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'PORTA', 'PORT', 'DIAGNOSTICO_IP_TOKEN',
  'LIMITE_IP_JANELA', 'JANELA_IP_MS', 'LIMITE_IP_DIA', 'LIMITE_GLOBAL_DIA', 'LIMITE_SIMULTANEAS', 'PROXIES_CONFIAVEIS'];

const TOKEN = 'K7QM-3XPD-9TRW-H2NB-V8FC-L4ZJ-6YSG-E5AU';   // fictício, só para os testes
const OUTRO_TOKEN = 'A1B2-C3D4-E5F6-G7H8-J9K1-L2M3-N4P5-Q6R7';
const IPS_TESTE = ['198.51.100.7', '203.0.113.50', '203.0.113.60', '192.0.2.10', '10.1.2.3', '162.158.1.1', '127.0.0.1', '::1'];

// ---------- Ambiente, rede e terminal ----------
let fetchOriginal;
let acessosNaoPermitidos = 0;
let registros = [];
const ambienteOriginal = {};
const consoleOriginal = {};

before(() => {
  for (const v of VARIAVEIS) ambienteOriginal[v] = process.env[v];
  fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const endereco = typeof url === 'string' ? url : url.url;
    if (!/^http:\/\/127\.0\.0\.1(:\d+)?\//.test(endereco)) { acessosNaoPermitidos++; throw new Error('Acesso à internet bloqueado nos testes'); }
    return fetchOriginal(url, init);
  };
});
after(() => {
  globalThis.fetch = fetchOriginal;
  restaurarAmbiente();
  assert.equal(acessosNaoPermitidos, 0, 'algum teste tentou acessar a internet');
});
beforeEach(() => {
  registros = [];
  for (const nome of ['error', 'warn', 'log', 'info', 'debug']) {
    consoleOriginal[nome] = console[nome];
    console[nome] = (...p) => { registros.push(p.map(String).join(' ')); };
  }
});
afterEach(async () => {
  await desligar();
  for (const nome of Object.keys(consoleOriginal)) console[nome] = consoleOriginal[nome];
  restaurarAmbiente();
  for (const c of CAMINHOS) delete require.cache[c];
});
function restaurarAmbiente() {
  for (const v of VARIAVEIS) {
    if (ambienteOriginal[v] === undefined) delete process.env[v]; else process.env[v] = ambienteOriginal[v];
  }
}

// ---------- Servidor de teste ----------
let servidor = null;
let base = '';
let modulo = null;

async function ligar(ambiente = {}) {
  for (const v of VARIAVEIS) delete process.env[v];
  for (const [nome, valor] of Object.entries({ MODO_IA: 'simulado', PORTA: '0', ...ambiente })) process.env[nome] = valor;
  for (const c of CAMINHOS) delete require.cache[c];
  modulo = require('../server/server');
  servidor = modulo.servidor;
  if (!servidor.listening) await new Promise((ok) => servidor.once('listening', ok));
  await new Promise((ok) => setImmediate(ok));
  base = `http://127.0.0.1:${servidor.address().port}`;
  return modulo;
}
async function desligar() {
  if (servidor) {
    servidor.closeAllConnections();
    await new Promise((ok) => servidor.close(ok));
  }
  servidor = null;
}

const consultar = (cabecalhos = {}, caminho = '/api/diagnostico-ip') => fetch(`${base}${caminho}`, { headers: cabecalhos });
const comToken = (extra = {}, token = TOKEN) => ({ Authorization: `Bearer ${token}`, ...extra });
const semIpsNemToken = (texto) => !IPS_TESTE.some((ip) => texto.includes(ip)) && !texto.includes(TOKEN) && !texto.toUpperCase().includes(TOKEN);

// Resposta de um endereço inexistente, para comparar com a rota "escondida".
async function respostaInexistente() {
  const r = await consultar({}, '/api/nao-existe');
  return { status: r.status, corpo: await r.text() };
}

// ============================================================
describe('1. Desligado por padrão', () => {
  test('sem DIAGNOSTICO_IP_TOKEN: a rota não existe (mesma resposta de um endereço inexistente)', async () => {
    await ligar();
    const esperado = await respostaInexistente();
    for (const cabecalhos of [{}, comToken()]) {
      const r = await consultar(cabecalhos);
      assert.equal(r.status, esperado.status);
      assert.equal(await r.text(), esperado.corpo);
    }
    assert.equal((await consultar({}, '/diagnostico-ip')).status, 404);
    assert.equal(modulo.diagnosticoIp.ativo, false);
  });

  for (const [descricao, valor] of [
    ['31 caracteres', 'A'.repeat(31)],
    ['com espaço no meio', `${'A'.repeat(20)} ${'B'.repeat(20)}`],
    ['com caracteres especiais', `${'A'.repeat(32)}!@#`],
    ['longo demais (257)', 'A'.repeat(257)],
  ]) {
    test(`token com formato inválido (${descricao}): continua desligado e o terminal avisa sem mostrar o valor`, async () => {
      await ligar({ DIAGNOSTICO_IP_TOKEN: valor });
      assert.equal(modulo.diagnosticoIp.ativo, false);
      assert.equal((await consultar({ Authorization: `Bearer ${valor}` })).status, 404);
      assert.ok(registros.some((l) => l.includes('DIAGNOSTICO_IP_TOKEN com formato inválido')));
      assert.ok(registros.every((l) => !l.includes(valor.trim())), 'o valor do token apareceu no terminal');
    });
  }
});

// ============================================================
describe('2. Token: ausente, incorreto e correto', () => {
  test('token ausente, incorreto, sem "Bearer" ou com outro esquema: resposta idêntica a endereço inexistente', async () => {
    await ligar({ DIAGNOSTICO_IP_TOKEN: TOKEN });
    const esperado = await respostaInexistente();
    for (const cabecalhos of [
      {},
      comToken({}, OUTRO_TOKEN),
      { Authorization: TOKEN },
      { Authorization: `Basic ${TOKEN}` },
      { Authorization: `Bearer ${TOKEN} extra` },
      { Authorization: `Bearer ${TOKEN.slice(0, -1)}` },
      { Authorization: 'Bearer ' },
      { 'X-Token': TOKEN },
    ]) {
      const r = await consultar(cabecalhos);
      assert.equal(r.status, esperado.status, JSON.stringify(Object.keys(cabecalhos)));
      assert.equal(await r.text(), esperado.corpo);
    }
  });

  test('token na URL (query string) é recusado, mesmo com o cabeçalho correto', async () => {
    await ligar({ DIAGNOSTICO_IP_TOKEN: TOKEN });
    for (const caminho of [`/api/diagnostico-ip?token=${TOKEN}`, '/api/diagnostico-ip?x=1', `/diagnostico-ip?token=${TOKEN}`]) {
      assert.equal((await consultar(comToken(), caminho)).status, 404, caminho);
    }
  });

  test('token correto: 200, sem cache, com a estrutura esperada', async () => {
    await ligar({ DIAGNOSTICO_IP_TOKEN: TOKEN });
    const r = await consultar(comToken());
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const d = await r.json();
    assert.match(d.instancia, /^[0-9a-f]{8}$/);
    assert.equal(d.consulta, 1);
    assert.equal(d.consultasRestantes, 29);
    assert.equal(d.minutosRestantes, 30);
    assert.equal(d.trustProxy, 1);
    assert.equal(d.quantidadeXForwardedFor, 0);
    assert.ok('req.ip' in d.fontes && 'socket' in d.fontes);
  });

  test('o código vale com letras minúsculas (facilita digitar no celular)', async () => {
    await ligar({ DIAGNOSTICO_IP_TOKEN: TOKEN });
    assert.equal((await consultar(comToken({}, TOKEN.toLowerCase()))).status, 200);
  });

  test('a comparação usa tempo constante (crypto.timingSafeEqual) e só o cabeçalho Authorization', () => {
    const codigo = fs.readFileSync(path.join(RAIZ, 'server', 'diagnostico-ip.js'), 'utf8');
    assert.ok(codigo.includes('crypto.timingSafeEqual('));
    assert.ok(!/req\.query|req\.params|req\.body/.test(codigo), 'o token não pode vir de query, params ou corpo');
  });
});

// ============================================================
describe('3. Expiração: 30 consultas ou 30 minutos', () => {
  test('30 consultas autorizadas; a 31ª é recusada. Tentativas sem token não gastam o limite', async () => {
    await ligar({ DIAGNOSTICO_IP_TOKEN: TOKEN });
    for (let i = 0; i < 5; i++) assert.equal((await consultar({})).status, 404);
    for (let i = 1; i <= 30; i++) {
      const r = await consultar(comToken());
      assert.equal(r.status, 200, `consulta ${i}`);
      assert.equal((await r.json()).consultasRestantes, 30 - i);
    }
    assert.equal((await consultar(comToken())).status, 404);
    assert.equal((await consultar({}, '/diagnostico-ip')).status, 404, 'a página também some ao expirar');
  });

  test('30 minutos depois do início: recusado (relógio falso)', async () => {
    const { criarDiagnosticoIp } = require('../server/diagnostico-ip');
    let agora = Date.parse('2026-11-16T12:00:00Z');
    const diag = criarDiagnosticoIp({ ambiente: { DIAGNOSTICO_IP_TOKEN: TOKEN }, agora: () => agora });
    const app = express();
    app.get('/api/diagnostico-ip', diag.rotaApi);
    app.get('/diagnostico-ip', diag.pagina);
    app.use((req, res) => res.status(404).json({ erro: 'Endereço não encontrado no servidor.' }));
    servidor = app.listen(0);
    await new Promise((ok) => servidor.once('listening', ok));
    base = `http://127.0.0.1:${servidor.address().port}`;

    assert.equal((await consultar(comToken())).status, 200);
    agora += 29 * 60 * 1000 + 59 * 1000;
    const quase = await consultar(comToken());
    assert.equal(quase.status, 200);
    assert.equal((await quase.json()).minutosRestantes, 1);
    agora += 1000; // completou 30 minutos
    assert.equal((await consultar(comToken())).status, 404);
    assert.equal((await consultar({}, '/diagnostico-ip')).status, 404);
  });
});

// ============================================================
describe('4. Cabeçalhos falsificados e grandes', () => {
  test('nenhum IP aparece: só apelidos de 8 caracteres, tipo e versão', async () => {
    await ligar({ DIAGNOSTICO_IP_TOKEN: TOKEN });
    const r = await consultar(comToken({
      'X-Forwarded-For': '198.51.100.7, 10.1.2.3, 162.158.1.1, 203.0.113.60',
      'CF-Connecting-IP': '203.0.113.50', 'True-Client-IP': '192.0.2.10', 'X-Real-IP': '::1',
    }));
    const texto = await r.text();
    assert.ok(semIpsNemToken(texto), `IP ou token na resposta: ${texto}`);
    const d = JSON.parse(texto);
    assert.equal(d.quantidadeXForwardedFor, 4);
    for (const desc of Object.values(d.fontes).filter(Boolean)) assert.match(desc.apelido, /^[0-9a-f]{8}$/);
    assert.equal(d.fontes['xff[1]'].tipo, 'público');
    assert.equal(d.fontes['xff[2]'].tipo, 'privado/interno');
    assert.equal(d.fontes['xff[3]'].tipo, 'Cloudflare');
    assert.equal(d.fontes['x-real-ip'].tipo, 'privado/interno');
    assert.equal(d.fontes['xff[1]'].versao, 'ipv4');
  });

  test('com trust proxy = 1, req.ip é a ÚLTIMA posição do X-Forwarded-For (a do proxy mais próximo)', async () => {
    await ligar({ DIAGNOSTICO_IP_TOKEN: TOKEN });
    const d = await (await consultar(comToken({ 'X-Forwarded-For': '198.51.100.7, 203.0.113.60', 'CF-Connecting-IP': '198.51.100.7' }))).json();
    assert.ok(d.coincidencias.includes('req.ip = xff[2]'), JSON.stringify(d.coincidencias));
    assert.ok(d.coincidencias.includes('cf-connecting-ip = xff[1]'), JSON.stringify(d.coincidencias));
  });

  test('apelidos: iguais para o mesmo IP na mesma instância; diferentes após reiniciar (sal novo)', async () => {
    await ligar({ DIAGNOSTICO_IP_TOKEN: TOKEN });
    const a = await (await consultar(comToken({ 'X-Forwarded-For': '198.51.100.7' }))).json();
    const b = await (await consultar(comToken({ 'X-Forwarded-For': '198.51.100.7' }))).json();
    assert.equal(a.fontes['xff[1]'].apelido, b.fontes['xff[1]'].apelido);
    assert.equal(a.instancia, b.instancia);
    await desligar();
    await ligar({ DIAGNOSTICO_IP_TOKEN: TOKEN });
    const c = await (await consultar(comToken({ 'X-Forwarded-For': '198.51.100.7' }))).json();
    assert.notEqual(c.fontes['xff[1]'].apelido, a.fontes['xff[1]'].apelido);
    assert.notEqual(c.instancia, a.instancia);
  });

  test('endereços inválidos (texto inventado) não quebram o diagnóstico', async () => {
    await ligar({ DIAGNOSTICO_IP_TOKEN: TOKEN });
    const d = await (await consultar(comToken({ 'X-Forwarded-For': 'nao-e-ip, <script>, 203.0.113.60', 'CF-Connecting-IP': 'qualquer' }))).json();
    assert.deepEqual(d.fontes['xff[1]'], { apelido: null, versao: null, tipo: 'inválido ou vazio' });
    assert.deepEqual(d.fontes['cf-connecting-ip'], { apelido: null, versao: null, tipo: 'inválido ou vazio' });
  });

  test('X-Forwarded-For com mais de 1.024 caracteres ou mais de 20 endereços: 431', async () => {
    await ligar({ DIAGNOSTICO_IP_TOKEN: TOKEN });
    const longo = await consultar(comToken({ 'X-Forwarded-For': `${'1.1.1.1, '.repeat(120)}2.2.2.2` }));
    assert.equal(longo.status, 431);
    const muitos = await consultar(comToken({ 'X-Forwarded-For': Array(21).fill('1.1.1.1').join(',') }));
    assert.equal(muitos.status, 431);
    const grandeCf = await consultar(comToken({ 'CF-Connecting-IP': 'x'.repeat(1025) }));
    assert.equal(grandeCf.status, 431);
  });

  test('cabeçalhos acima do limite do Node (16 KB) são recusados antes de chegar à rota', async () => {
    await ligar({ DIAGNOSTICO_IP_TOKEN: TOKEN });
    let status = null;
    try { status = (await consultar(comToken({ 'X-Enorme': 'x'.repeat(20000) }))).status; } catch (e) { status = 'conexão recusada'; }
    assert.ok(status === 431 || status === 'conexão recusada', `status inesperado: ${status}`);
    assert.equal(modulo.diagnosticoIp.situacao().consultas, 0);
  });
});

// ============================================================
describe('5. Nada de IPs ou segredos no terminal; nenhuma cota gasta', () => {
  test('terminal: só o aviso de ativação, sem token e sem IPs', async () => {
    await ligar({ DIAGNOSTICO_IP_TOKEN: TOKEN });
    await consultar({});
    await consultar(comToken({}, OUTRO_TOKEN));
    await consultar(comToken({ 'X-Forwarded-For': '198.51.100.7, 203.0.113.60', 'CF-Connecting-IP': '203.0.113.50' }));
    await consultar(comToken({ 'X-Forwarded-For': Array(21).fill('198.51.100.7').join(',') }));
    await consultar({}, '/diagnostico-ip');
    assert.ok(registros.some((l) => l.includes('Diagnóstico de IP: ATIVO (temporário)')));
    for (const linha of registros) {
      assert.ok(semIpsNemToken(linha) && !linha.includes(OUTRO_TOKEN), `apareceu no terminal: ${linha}`);
    }
  });

  test('o diagnóstico não gasta a cota de IA nem a cota do visitante', async () => {
    await ligar({ DIAGNOSTICO_IP_TOKEN: TOKEN, LIMITE_IP_JANELA: '1', LIMITE_GLOBAL_DIA: '1' });
    for (let i = 0; i < 5; i++) assert.equal((await consultar(comToken())).status, 200);
    assert.equal(modulo.protecao.controle.situacao().usadasHoje, 0);
    const r = await fetch(`${base}/api/analisar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(CASOS_FICTICIOS[0]) });
    assert.equal(r.status, 200, 'a análise (simulada) deveria continuar liberada');
  });

  test('o módulo não registra nada no terminal e não grava arquivos', () => {
    const codigo = fs.readFileSync(path.join(RAIZ, 'server', 'diagnostico-ip.js'), 'utf8');
    assert.ok(!/console\.[a-z]+\(/.test(codigo), 'diagnostico-ip.js não deveria escrever no terminal');
    assert.ok(!/fs\.|localStorage|sessionStorage|indexedDB|document\.cookie/.test(codigo));
  });
});

// ============================================================
describe('6. Página para celular e computador', () => {
  test('ligado: a página abre sem token, sem cache, com CSP restrita e sem o token no conteúdo', async () => {
    await ligar({ DIAGNOSTICO_IP_TOKEN: TOKEN });
    const r = await consultar({}, '/diagnostico-ip');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
    assert.match(r.headers.get('content-security-policy'), /default-src 'none'.*connect-src 'self'.*frame-ancestors 'none'/);
    const html = await r.text();
    assert.ok(!html.toUpperCase().includes(TOKEN));
    assert.ok(html.includes('type="password"'));
  });

  test('o código vai só no cabeçalho Authorization; a URL da consulta não tem parâmetros; nada é guardado', async () => {
    const { criarDiagnosticoIp } = require('../server/diagnostico-ip');
    const diag = criarDiagnosticoIp({ ambiente: { DIAGNOSTICO_IP_TOKEN: TOKEN } });
    let html = '';
    diag.pagina({ method: 'GET', originalUrl: '/diagnostico-ip' }, { set() {}, type() { return this; }, send(t) { html = t; } }, () => {});
    assert.ok(html.includes("'Authorization': 'Bearer ' + codigo"));
    assert.ok(html.includes("fetch('/api/diagnostico-ip', {"));
    assert.ok(!/diagnostico-ip\?/.test(html), 'a URL não pode levar parâmetros');
    assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie|<form/.test(html), 'a página não pode guardar o código nem usar formulário');
    assert.ok(html.includes("credentials: 'omit'") && html.includes("referrerPolicy: 'no-referrer'"));
  });

  test('os modos continuam funcionando com o diagnóstico ligado (simulado)', async () => {
    await ligar({ DIAGNOSTICO_IP_TOKEN: TOKEN });
    const status = await (await fetch(`${base}/api/status`)).json();
    assert.equal(status.modoIA, 'simulado');
    const r = await fetch(`${base}/api/analisar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(CASOS_FICTICIOS[0]) });
    assert.equal(r.status, 200);
  });
});
