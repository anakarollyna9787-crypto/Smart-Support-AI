// ============================================================
// Smart Support AI - Testes da identificação do visitante (FONTE_IP)
//
// Confere server/ip-visitante.js e a ligação com protecao.js e server.js:
// - FONTE_IP: req-ip (padrão) e cloudflare; valores desconhecidos valem req-ip;
// - modo cloudflare: CF-Connecting-IP só é aceito com socket interno,
//   um único cf-ray válido e um único IP público válido;
// - cabeçalho ausente, repetido, IP inválido ou não público, cf-ray ausente,
//   repetido ou inválido, socket externo -> chave compartilhada "sem-ip-confiavel";
// - falsificação: X-Forwarded-For, X-Real-IP, True-Client-IP e req.ip NUNCA
//   são usados como alternativa;
// - trust proxy continua numérico; nenhum IP aparece no terminal.
//
// Observação: nos testes HTTP, o próprio teste faz o papel da Cloudflare
// (a conexão vem do 127.0.0.1, que conta como "interna"). Em produção, quem
// impede o visitante de enviar um CF-Connecting-IP próprio é a Cloudflare
// do Render (no diagnóstico, essas tentativas receberam HTTP 403).
//
// Tudo no modo simulado; NENHUMA chamada externa é feita.
// Como rodar (na pasta do projeto):  npm test
// ============================================================

const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { ipKeyGenerator } = require('express-rate-limit');

const { CASOS_FICTICIOS } = require('./casos-ficticios');

const CAMINHOS = ['../server/server', '../server/ia', '../server/ia-gemini', '../server/ia-groq', '../server/ia-real', '../server/protecao', '../server/diagnostico-ip', '../server/ip-visitante']
  .map((c) => require.resolve(c));
const VARIAVEIS = ['MODO_IA', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'PORTA', 'PORT', 'DIAGNOSTICO_IP_TOKEN', 'FONTE_IP',
  'LIMITE_IP_JANELA', 'JANELA_IP_MS', 'LIMITE_IP_DIA', 'LIMITE_GLOBAL_DIA', 'LIMITE_SIMULTANEAS', 'PROXIES_CONFIAVEIS'];

const ipVisitante = () => require('../server/ip-visitante');

const RAY = '8d3f0c2a1b9e4f12-GRU';
const CASO = { ...CASOS_FICTICIOS[0] };
const SEM_IP = 'sem-ip-confiavel';
// Endereços usados nos testes: nenhum deles pode aparecer no terminal.
const IPS_TESTE = ['203.0.113.10', '203.0.113.20', '198.51.100.7', '198.51.100.8', '198.51.100.9', '192.0.2.44', '10.0.0.1', '10.9.9.9', '2001:db8'];

// ---------- Ambiente, rede e terminal ----------
let fetchOriginal;
let acessosNaoPermitidos = 0;
let registros = [];
const ambienteOriginal = {};
const consoleOriginal = {};

before(() => {
  for (const v of VARIAVEIS) ambienteOriginal[v] = process.env[v];
  fetchOriginal = globalThis.fetch;
  globalThis.fetch = async () => { acessosNaoPermitidos++; throw new Error('Acesso à internet bloqueado nos testes'); };
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
const semIps = (texto) => !IPS_TESTE.some((ip) => texto.includes(ip));

// ---------- Pedido falso (testes da função, sem servidor) ----------
// "cabecalhos" guarda cada cabeçalho como LISTA (como req.headersDistinct do Node).
function pedidoFalso({ socket = '10.0.0.5', cabecalhos = {}, ip = '10.9.9.9' } = {}) {
  const distintos = {};
  const juntos = {};
  for (const [nome, valor] of Object.entries(cabecalhos)) {
    const lista = Array.isArray(valor) ? valor : [valor];
    distintos[nome.toLowerCase()] = lista;
    juntos[nome.toLowerCase()] = lista.join(', ');
  }
  return { ip, socket: socket === null ? undefined : { remoteAddress: socket }, headersDistinct: distintos, headers: juntos };
}
const viaCloudflare = (ipVisit, extra = {}) => ({ 'cf-ray': RAY, 'cf-connecting-ip': ipVisit, ...extra });

function chaveCloudflare(req) {
  const motivos = [];
  const chave = ipVisitante().criarChaveDoVisitante({ fonteIp: 'cloudflare', ipKeyGenerator, aoRecusar: (m) => motivos.push(m) })(req);
  return { chave, motivos };
}

// ---------- Servidor de teste ----------
let servidor = null;
let base = '';
let modulo = null;

async function ligar(ambiente = {}) {
  for (const v of VARIAVEIS) delete process.env[v];
  for (const [nome, valor] of Object.entries({ MODO_IA: 'simulado', PORTA: '0', FONTE_IP: 'cloudflare', LIMITE_IP_JANELA: '1', ...ambiente })) {
    if (valor !== undefined) process.env[nome] = valor;
  }
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

// Usa node:http (e não fetch) para poder enviar cabeçalhos REPETIDOS:
// um valor em lista vira várias linhas do mesmo cabeçalho.
function analisar(cabecalhos = {}) {
  return new Promise((ok, falha) => {
    const dados = JSON.stringify(CASO);
    const pedido = http.request(`${base}/api/analisar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(dados), ...cabecalhos },
    }, (res) => {
      let texto = '';
      res.setEncoding('utf8');
      res.on('data', (parte) => { texto += parte; });
      res.on('end', () => ok({ status: res.statusCode, texto }));
    });
    pedido.on('error', falha);
    pedido.end(dados);
  });
}
const cf = (ipVisit, extra = {}) => ({ 'CF-Ray': RAY, 'CF-Connecting-IP': ipVisit, ...extra });

// ============================================================
describe('1. FONTE_IP: leitura da variável', () => {
  test('ausente ou vazia: req-ip (padrão), sem aviso', () => {
    for (const ambiente of [{}, { FONTE_IP: '' }, { FONTE_IP: '   ' }]) {
      assert.deepEqual(ipVisitante().lerFonteIp(ambiente), { fonteIp: 'req-ip', valorInvalido: false });
    }
  });

  test('aceita req-ip e cloudflare (sem diferenciar maiúsculas e espaços nas pontas)', () => {
    assert.equal(ipVisitante().lerFonteIp({ FONTE_IP: 'req-ip' }).fonteIp, 'req-ip');
    assert.equal(ipVisitante().lerFonteIp({ FONTE_IP: 'cloudflare' }).fonteIp, 'cloudflare');
    assert.equal(ipVisitante().lerFonteIp({ FONTE_IP: ' CloudFlare ' }).fonteIp, 'cloudflare');
  });

  for (const valor of ['true', '1', 'cf', 'cloudfare', 'req.ip', 'x-forwarded-for', 'true-client-ip', 'cloudflare,req-ip']) {
    test(`valor desconhecido "${valor}": vale req-ip e é sinalizado`, () => {
      assert.deepEqual(ipVisitante().lerFonteIp({ FONTE_IP: valor }), { fonteIp: 'req-ip', valorInvalido: true });
    });
  }
});

// ============================================================
describe('2. Modo cloudflare: cenários válidos', () => {
  test('IPv4 público válido: a chave é o próprio IP', () => {
    const { chave, motivos } = chaveCloudflare(pedidoFalso({ cabecalhos: viaCloudflare('203.0.113.10') }));
    assert.equal(chave, '203.0.113.10');
    assert.deepEqual(motivos, []);
  });

  test('IPv6 válido: agrupado por sub-rede /56 (ipKeyGenerator)', () => {
    const a = chaveCloudflare(pedidoFalso({ cabecalhos: viaCloudflare('2001:db8:abcd:1200::1') })).chave;
    const b = chaveCloudflare(pedidoFalso({ cabecalhos: viaCloudflare('2001:db8:abcd:12ff::2') })).chave;
    const c = chaveCloudflare(pedidoFalso({ cabecalhos: viaCloudflare('2001:db8:abcd:1300::1') })).chave;
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.equal(a, ipKeyGenerator('2001:db8:abcd:1200::1'));
  });

  test('IPv4 escrito como IPv6 (::ffff:) vira IPv4 comum', () => {
    assert.equal(chaveCloudflare(pedidoFalso({ cabecalhos: viaCloudflare('::ffff:203.0.113.10') })).chave, '203.0.113.10');
  });

  test('aceita o cf-ray com letras maiúsculas ou minúsculas', () => {
    assert.equal(chaveCloudflare(pedidoFalso({ cabecalhos: viaCloudflare('203.0.113.10', { 'cf-ray': '8D3F0C2A1B9E4F12-gru' }) })).chave, '203.0.113.10');
  });

  for (const socket of ['10.0.0.5', '172.20.1.2', '192.168.0.9', '100.64.3.4', '127.0.0.1', '::ffff:10.0.0.5', '::1', 'fd00::5']) {
    test(`conexão interna aceita: ${socket}`, () => {
      assert.equal(chaveCloudflare(pedidoFalso({ socket, cabecalhos: viaCloudflare('203.0.113.10') })).chave, '203.0.113.10');
    });
  }
});

// ============================================================
describe('3. Modo cloudflare: cenários inválidos usam "sem-ip-confiavel"', () => {
  const casos = [
    // [descrição, pedido, motivo esperado]
    ['CF-Connecting-IP ausente', { cabecalhos: { 'cf-ray': RAY } }, 'cf-connecting-ip-ausente'],
    ['CF-Connecting-IP repetido (valores diferentes)', { cabecalhos: viaCloudflare(['203.0.113.10', '203.0.113.20']) }, 'cf-connecting-ip-repetido'],
    ['CF-Connecting-IP repetido (valores iguais)', { cabecalhos: viaCloudflare(['203.0.113.10', '203.0.113.10']) }, 'cf-connecting-ip-repetido'],
    ['cf-ray ausente', { cabecalhos: { 'cf-connecting-ip': '203.0.113.10' } }, 'cf-ray-ausente'],
    ['cf-ray repetido', { cabecalhos: viaCloudflare('203.0.113.10', { 'cf-ray': [RAY, RAY] }) }, 'cf-ray-repetido'],
    ['conexão de endereço público (não veio pela rede interna)', { socket: '198.51.100.9', cabecalhos: viaCloudflare('203.0.113.10') }, 'conexao-nao-interna'],
    ['conexão sem endereço', { socket: null, cabecalhos: viaCloudflare('203.0.113.10') }, 'conexao-nao-interna'],
    ['conexão com endereço inválido', { socket: 'nao-e-ip', cabecalhos: viaCloudflare('203.0.113.10') }, 'conexao-nao-interna'],
  ];
  for (const [descricao, pedido, motivo] of casos) {
    test(descricao, () => {
      const { chave, motivos } = chaveCloudflare(pedidoFalso(pedido));
      assert.equal(chave, SEM_IP);
      assert.deepEqual(motivos, [motivo]);
    });
  }

  for (const ray of ['', 'abc', '8d3f0c2a1b9e4f12', '8d3f0c2a1b9e4f12-GRU, 8d3f0c2a1b9e4f13-GRU', 'zzzzzzzzzzzzzzzz-GRU', '8d3f0c2a1b9e4f12-GR', '8d3f0c2a1b9e4f12-GRU1', `${RAY} `]) {
    test(`cf-ray inválido: ${JSON.stringify(ray)}`, () => {
      const { chave, motivos } = chaveCloudflare(pedidoFalso({ cabecalhos: viaCloudflare('203.0.113.10', { 'cf-ray': ray }) }));
      assert.equal(chave, SEM_IP);
      assert.deepEqual(motivos, ['cf-ray-invalido']);
    });
  }

  const invalidos = ['', ' ', 'abc', 'nao-e-ip', '<script>', '203.0.113.10, 198.51.100.7', '203.0.113.10,198.51.100.7', '203.0.113.10:443',
    '[2001:db8::1]', '[2001:db8::1]:443', '2001:db8::1%eth0', '999.1.1.1', '203.0.113', '203.0.113.10.5', '1.2.3.04',
    ' 203.0.113.10', '203.0.113.10 ', 'unknown', '1'.repeat(46), '::ffff:999.1.1.1'];
  for (const valor of invalidos) {
    test(`IP inválido no CF-Connecting-IP: ${JSON.stringify(valor.length > 30 ? `${valor.slice(0, 30)}...` : valor)}`, () => {
      const { chave, motivos } = chaveCloudflare(pedidoFalso({ cabecalhos: viaCloudflare(valor) }));
      assert.equal(chave, SEM_IP);
      assert.deepEqual(motivos, ['cf-connecting-ip-invalido']);
    });
  }

  const naoPublicos = ['10.0.0.1', '172.16.5.4', '192.168.1.1', '100.64.0.1', '127.0.0.1', '169.254.1.1', '0.0.0.0', '0.1.2.3',
    '224.0.0.1', '239.255.255.250', '240.0.0.1', '255.255.255.255', '::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '::ffff:10.0.0.1'];
  for (const valor of naoPublicos) {
    test(`IP não público no CF-Connecting-IP: ${valor}`, () => {
      const { chave, motivos } = chaveCloudflare(pedidoFalso({ cabecalhos: viaCloudflare(valor) }));
      assert.equal(chave, SEM_IP);
      assert.deepEqual(motivos, ['cf-connecting-ip-nao-publico']);
    });
  }
});

// ============================================================
describe('4. Modo cloudflare: nunca recorre a req.ip, True-Client-IP, X-Real-IP ou X-Forwarded-For', () => {
  const alternativas = {
    'true-client-ip': '198.51.100.7',
    'x-real-ip': '198.51.100.8',
    'x-forwarded-for': '198.51.100.9, 203.0.113.20',
    forwarded: 'for=192.0.2.44',
  };

  test('sem CF-Connecting-IP, mesmo com req.ip e os outros cabeçalhos preenchidos: chave compartilhada', () => {
    const { chave } = chaveCloudflare(pedidoFalso({ ip: '203.0.113.20', cabecalhos: { 'cf-ray': RAY, ...alternativas } }));
    assert.equal(chave, SEM_IP);
  });

  test('com CF-Connecting-IP inválido, os outros cabeçalhos também são ignorados', () => {
    const { chave } = chaveCloudflare(pedidoFalso({ ip: '203.0.113.20', cabecalhos: viaCloudflare('lixo', alternativas) }));
    assert.equal(chave, SEM_IP);
  });

  test('com CF-Connecting-IP válido, os outros cabeçalhos e req.ip não mudam a chave', () => {
    const { chave } = chaveCloudflare(pedidoFalso({ ip: '203.0.113.20', cabecalhos: viaCloudflare('203.0.113.10', alternativas) }));
    assert.equal(chave, '203.0.113.10');
  });

  test('o código do modo cloudflare não lê esses cabeçalhos nem req.ip', () => {
    const fonte = String(ipVisitante().avaliarCloudflare);
    for (const proibido of ['true-client-ip', 'x-real-ip', 'x-forwarded-for', 'forwarded', 'req.ip']) {
      assert.ok(!fonte.toLowerCase().includes(proibido), `avaliarCloudflare não deveria citar ${proibido}`);
    }
  });

  test('modo req-ip continua usando req.ip e ignora os cabeçalhos da Cloudflare', () => {
    const chave = ipVisitante().criarChaveDoVisitante({ fonteIp: 'req-ip', ipKeyGenerator });
    assert.equal(chave(pedidoFalso({ ip: '203.0.113.20', cabecalhos: viaCloudflare('203.0.113.10') })), '203.0.113.20');
  });
});

// ============================================================
describe('5. Servidor com FONTE_IP=cloudflare (HTTP, modo simulado)', () => {
  test('inicia informando a fonte do IP; trust proxy continua NÚMERO; modo simulado', async () => {
    const { app, protecao } = await ligar();
    assert.equal(protecao.fonteIp, 'cloudflare');
    assert.equal(app.get('trust proxy'), 1);
    assert.equal(typeof app.get('trust proxy'), 'number');
    assert.ok(registros.some((l) => l.includes('Fonte do IP do visitante: cloudflare')));
    assert.ok(registros.some((l) => l.includes('Modo da IA: simulado')));
  });

  test('os limites e as demais proteções não mudam com FONTE_IP=cloudflare', async () => {
    const { protecao } = await ligar({ LIMITE_IP_JANELA: undefined });
    assert.deepEqual(protecao.configuracao, { limiteIpJanela: 6, janelaIpMs: 600000, limiteIpDia: 20, limiteGlobalDia: 200, maxSimultaneas: 2, proxiesConfiaveis: 1 });
  });

  test('cada visitante válido tem a própria cota', async () => {
    await ligar();
    assert.equal((await analisar(cf('203.0.113.10'))).status, 200);
    assert.equal((await analisar(cf('203.0.113.10'))).status, 429, 'o mesmo visitante esgotou a cota');
    assert.equal((await analisar(cf('203.0.113.20'))).status, 200, 'outro visitante tem cota própria');
  });

  test('falsificação: X-Forwarded-For, X-Real-IP e True-Client-IP não tiram o visitante do limite', async () => {
    await ligar();
    assert.equal((await analisar(cf('203.0.113.10'))).status, 200);
    assert.equal((await analisar(cf('203.0.113.10', { 'X-Forwarded-For': '198.51.100.7' }))).status, 429);
    assert.equal((await analisar(cf('203.0.113.10', { 'X-Real-IP': '198.51.100.8' }))).status, 429);
    assert.equal((await analisar(cf('203.0.113.10', { 'True-Client-IP': '198.51.100.9' }))).status, 429);
    assert.equal((await analisar(cf('203.0.113.10', { 'X-Forwarded-For': '198.51.100.7, 192.0.2.44', 'X-Real-IP': '198.51.100.8', 'True-Client-IP': '198.51.100.9' }))).status, 429);
  });

  test('falsificação: sem CF-Connecting-IP, trocar X-Forwarded-For/True-Client-IP a cada pedido não cria cotas novas', async () => {
    await ligar();
    assert.equal((await analisar({ 'CF-Ray': RAY, 'X-Forwarded-For': '198.51.100.7' })).status, 200);
    assert.equal((await analisar({ 'CF-Ray': RAY, 'X-Forwarded-For': '198.51.100.8' })).status, 429);
    assert.equal((await analisar({ 'CF-Ray': RAY, 'True-Client-IP': '198.51.100.9' })).status, 429);
    assert.equal((await analisar({ 'X-Real-IP': '192.0.2.44' })).status, 429);
  });

  // Cada cenário inválido cai na MESMA chave compartilhada: depois de um pedido
  // inválido, um pedido sem cabeçalho nenhum já encontra a cota esgotada.
  const cenarios = [
    ['cabeçalho ausente', { 'CF-Ray': RAY }],
    ['CF-Connecting-IP repetido', { 'CF-Ray': RAY, 'CF-Connecting-IP': ['203.0.113.10', '203.0.113.20'] }],
    ['CF-Connecting-IP com dois IPs', cf('203.0.113.10, 203.0.113.20')],
    ['IP inválido', cf('nao-e-ip')],
    ['IP com porta', cf('203.0.113.10:443')],
    ['IP privado', cf('10.0.0.1')],
    ['cf-ray ausente', { 'CF-Connecting-IP': '203.0.113.10' }],
    ['cf-ray repetido', { 'CF-Ray': [RAY, RAY], 'CF-Connecting-IP': '203.0.113.10' }],
    ['cf-ray inválido', { 'CF-Ray': 'abc', 'CF-Connecting-IP': '203.0.113.10' }],
  ];
  for (const [descricao, cabecalhos] of cenarios) {
    test(`${descricao}: usa a cota compartilhada "sem-ip-confiavel"`, async () => {
      await ligar();
      assert.equal((await analisar(cabecalhos)).status, 200);
      assert.equal((await analisar({})).status, 429, 'deveria dividir a cota com qualquer outro pedido sem IP confiável');
      assert.equal((await analisar(cf('203.0.113.20'))).status, 200, 'um visitante válido não é afetado pela cota compartilhada');
    });
  }

  test('terminal: avisa o motivo UMA vez por motivo e nunca mostra IPs', async () => {
    await ligar({ LIMITE_IP_JANELA: '5' });
    await analisar({ 'CF-Ray': RAY, 'X-Forwarded-For': '198.51.100.7' });
    await analisar({ 'CF-Ray': RAY, 'X-Forwarded-For': '198.51.100.8' });
    await analisar(cf('10.0.0.1'));
    await analisar(cf('203.0.113.10'));
    const avisos = registros.filter((l) => l.includes('sem IP confiável'));
    assert.equal(avisos.length, 2, JSON.stringify(avisos));
    assert.ok(avisos[0].includes('cf-connecting-ip-ausente'));
    assert.ok(avisos[1].includes('cf-connecting-ip-nao-publico'));
    assert.ok(semIps(registros.join('\n')), 'nenhum IP pode aparecer no terminal');
  });

  test('FONTE_IP desconhecido: avisa no terminal e usa req-ip', async () => {
    const { protecao } = await ligar({ FONTE_IP: 'cloudfare' });
    assert.equal(protecao.fonteIp, 'req-ip');
    assert.ok(registros.some((l) => l.includes('FONTE_IP com valor desconhecido')));
    assert.ok(registros.some((l) => l.includes('Fonte do IP do visitante: req-ip')));
  });

  test('sem FONTE_IP: req-ip (comportamento anterior, X-Forwarded-For pelo trust proxy numérico)', async () => {
    const { protecao } = await ligar({ FONTE_IP: undefined });
    assert.equal(protecao.fonteIp, 'req-ip');
    assert.equal((await analisar({ 'X-Forwarded-For': '203.0.113.10' })).status, 200);
    assert.equal((await analisar({ 'X-Forwarded-For': '198.51.100.7, 203.0.113.10' })).status, 429, 'vale o último endereço (o do proxy)');
    assert.equal((await analisar({ 'X-Forwarded-For': '203.0.113.20' })).status, 200);
  });
});
