// ============================================================
// Smart Support AI - Diagnóstico TEMPORÁRIO de IP (cadeia de proxies)
//
// Objetivo: descobrir, no Render, qual endereço identifica o visitante
// (posição do X-Forwarded-For, CF-Connecting-IP etc.), SEM expor IPs.
//
// Segurança:
// - DESLIGADO por padrão. Só existe se DIAGNOSTICO_IP_TOKEN estiver definido
//   com 32 a 256 caracteres (letras, números, "-" ou "_").
// - O token vem SOMENTE do cabeçalho "Authorization: Bearer <token>".
//   Pedidos com query string (?...) são recusados, para que ninguém use a URL.
// - Comparação em tempo constante (SHA-256 + crypto.timingSafeEqual).
// - Expira sozinho: 30 consultas autorizadas OU 30 minutos após o início do servidor.
// - Sem token válido, ou depois de expirar, responde exatamente como um
//   endereço inexistente (a rota não "aparece").
// - Nunca devolve nem registra IPs ou o token. Cada endereço vira um
//   "apelido" HMAC-SHA256 (8 caracteres) com um sal aleatório que existe
//   só na memória desta instância: não dá para recuperar o IP a partir dele,
//   e os apelidos mudam a cada reinício.
// - Não passa pelos limites de IA, não chama a IA e não consome cotas.
//
// Remover este arquivo (e a variável no Render) depois do diagnóstico.
// ============================================================

const crypto = require('crypto');
const net = require('net');

const LIMITE_CONSULTAS = 30;
const DURACAO_MS = 30 * 60 * 1000;
const MAX_CABECALHO = 1024;   // tamanho máximo aceito para cada cabeçalho analisado
const MAX_ENDERECOS = 20;     // máximo de endereços no X-Forwarded-For
const MAX_ENDERECO = 64;      // tamanho máximo de um endereço
const FORMATO_TOKEN = /^[A-Za-z0-9_-]{32,256}$/;

// Faixas publicadas pela Cloudflare (cloudflare.com/ips-v4 e /ips-v6, consultadas em 2026-11-16).
// Usadas só para responder "sim/não": o endereço é de um servidor da Cloudflare?
const FAIXAS_CLOUDFLARE = new net.BlockList();
for (const faixa of ['173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18',
  '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14',
  '172.64.0.0/13', '131.0.72.0/22']) {
  const [base, bits] = faixa.split('/');
  FAIXAS_CLOUDFLARE.addSubnet(base, Number(bits), 'ipv4');
}
for (const faixa of ['2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32']) {
  const [base, bits] = faixa.split('/');
  FAIXAS_CLOUDFLARE.addSubnet(base, Number(bits), 'ipv6');
}

// Faixas privadas/internas (redes locais, CGNAT, loopback, link-local).
const FAIXAS_PRIVADAS = new net.BlockList();
for (const [base, bits] of [['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['127.0.0.0', 8], ['100.64.0.0', 10], ['169.254.0.0', 16], ['0.0.0.0', 8]]) {
  FAIXAS_PRIVADAS.addSubnet(base, bits, 'ipv4');
}
for (const [base, bits] of [['fc00::', 7], ['fe80::', 10], ['::1', 128], ['::', 128]]) {
  FAIXAS_PRIVADAS.addSubnet(base, bits, 'ipv6');
}

// Lê o token do ambiente. Formato inválido = diagnóstico desligado.
function lerToken(ambiente) {
  const valor = typeof ambiente.DIAGNOSTICO_IP_TOKEN === 'string' ? ambiente.DIAGNOSTICO_IP_TOKEN.trim() : '';
  return FORMATO_TOKEN.test(valor) ? valor : null;
}

// Padroniza um endereço: tira espaços, colchetes, porta, zona IPv6 e o prefixo ::ffff: (IPv4 em IPv6).
function normalizar(valor) {
  if (typeof valor !== 'string') return null;
  let ip = valor.trim();
  if (!ip || ip.length > MAX_ENDERECO) return null;
  const comColchetes = ip.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (comColchetes) ip = comColchetes[1];
  else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(ip)) ip = ip.replace(/:\d+$/, '');
  ip = ip.replace(/%.*$/, '');
  if (/^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(ip)) ip = ip.slice(7);
  return net.isIP(ip) ? ip.toLowerCase() : null;
}

function criarDiagnosticoIp({ ambiente = process.env, agora = () => Date.now(), trustProxy = 1 } = {}) {
  const token = lerToken(ambiente);
  const formatoInvalido = !token && typeof ambiente.DIAGNOSTICO_IP_TOKEN === 'string' && ambiente.DIAGNOSTICO_IP_TOKEN.trim() !== '';
  if (!token) return { ativo: false, formatoInvalido };

  // Guardamos só o resumo SHA-256 do token (não o token em si) para a comparação.
  // Maiúsculas e minúsculas não importam (facilita digitar o código no celular).
  const resumoToken = crypto.createHash('sha256').update(token.toUpperCase(), 'utf8').digest();
  const sal = crypto.randomBytes(32);                      // só na memória desta instância
  const instancia = crypto.randomBytes(4).toString('hex'); // identifica a instância (aleatório, sem relação com IPs)
  const inicio = agora();
  let consultas = 0;

  function expirado() {
    return consultas >= LIMITE_CONSULTAS || agora() - inicio >= DURACAO_MS;
  }

  // Confere "Authorization: Bearer <token>" em tempo constante.
  function autorizado(req) {
    const cabecalho = req.headers.authorization;
    if (typeof cabecalho !== 'string' || cabecalho.length > 300) return false;
    const achado = cabecalho.match(/^Bearer ([^\s]+)$/);
    const recebido = crypto.createHash('sha256').update(achado ? achado[1].toUpperCase() : '', 'utf8').digest();
    return crypto.timingSafeEqual(recebido, resumoToken) && Boolean(achado);
  }

  // A rota só responde a GET sem query string, com token válido e dentro do prazo.
  function permitido(req) {
    if (req.method !== 'GET' || req.originalUrl.includes('?')) return false;
    if (expirado()) return false;
    return autorizado(req);
  }

  function apelido(ip) {
    return crypto.createHmac('sha256', sal).update(ip).digest('hex').slice(0, 8);
  }

  // Descreve um endereço sem revelá-lo.
  function descrever(valor) {
    const ip = normalizar(valor);
    if (!ip) return { apelido: null, versao: null, tipo: 'inválido ou vazio' };
    const versao = net.isIPv4(ip) ? 'ipv4' : 'ipv6';
    let tipo = 'público';
    if (FAIXAS_PRIVADAS.check(ip, versao)) tipo = 'privado/interno';
    else if (FAIXAS_CLOUDFLARE.check(ip, versao)) tipo = 'Cloudflare';
    return { apelido: apelido(ip), versao, tipo };
  }

  function cabecalhoUnico(req, nome) {
    const valor = req.headers[nome];
    return Array.isArray(valor) ? valor.join(',') : valor;
  }

  function rotaApi(req, res, next) {
    if (!permitido(req)) return next(); // igual a um endereço inexistente
    consultas++;

    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });

    // Proteção contra cabeçalhos grandes demais (o Node já limita o total a 16 KB).
    const nomes = ['x-forwarded-for', 'cf-connecting-ip', 'true-client-ip', 'x-real-ip'];
    for (const nome of nomes) {
      const valor = cabecalhoUnico(req, nome);
      if (typeof valor === 'string' && valor.length > MAX_CABECALHO) {
        return res.status(431).json({ erro: `O cabeçalho ${nome} é grande demais para o diagnóstico.` });
      }
    }
    const xff = cabecalhoUnico(req, 'x-forwarded-for');
    const lista = typeof xff === 'string' && xff.trim() ? xff.split(',') : [];
    if (lista.length > MAX_ENDERECOS) {
      return res.status(431).json({ erro: `O X-Forwarded-For tem mais de ${MAX_ENDERECOS} endereços.` });
    }

    // Fontes analisadas. As posições do X-Forwarded-For vão da esquerda (1) para a direita.
    const fontes = {
      'req.ip': req.ip,
      socket: req.socket && req.socket.remoteAddress,
      'cf-connecting-ip': cabecalhoUnico(req, 'cf-connecting-ip'),
      'true-client-ip': cabecalhoUnico(req, 'true-client-ip'),
      'x-real-ip': cabecalhoUnico(req, 'x-real-ip'),
    };
    lista.forEach((valor, i) => { fontes[`xff[${i + 1}]`] = valor; });

    const descricoes = {};
    for (const [nome, valor] of Object.entries(fontes)) {
      descricoes[nome] = valor === undefined || valor === null || valor === '' ? null : descrever(valor);
    }

    // Quais fontes têm o mesmo endereço (comparando apelidos, nunca IPs).
    const grupos = {};
    for (const [nome, d] of Object.entries(descricoes)) {
      if (d && d.apelido) (grupos[d.apelido] = grupos[d.apelido] || []).push(nome);
    }
    const coincidencias = Object.values(grupos).filter((g) => g.length > 1).map((g) => g.join(' = '));

    res.json({
      instancia,
      consulta: consultas,
      consultasRestantes: LIMITE_CONSULTAS - consultas,
      minutosRestantes: Math.max(0, Math.ceil((DURACAO_MS - (agora() - inicio)) / 60000)),
      trustProxy,
      quantidadeXForwardedFor: lista.length,
      fontes: descricoes,
      coincidencias,
      cabecalhosPresentes: ['cf-ray', 'cf-ipcountry', 'cf-visitor', 'x-forwarded-proto', 'x-forwarded-host', 'forwarded', 'via', 'rndr-id']
        .filter((nome) => req.headers[nome] !== undefined),
    });
  }

  // Página para usar no celular ou no computador: o token é digitado num campo
  // de senha e enviado só no cabeçalho Authorization (nunca na URL).
  function pagina(req, res, next) {
    if (req.method !== 'GET' || req.originalUrl.includes('?') || expirado()) return next();
    res.set({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
    });
    res.type('html').send(PAGINA);
  }

  return { ativo: true, rotaApi, pagina, situacao: () => ({ consultas, expirado: expirado(), instancia }) };
}

// ------------------------------------------------------------
// Lógica da página. Estas funções rodam NO NAVEGADOR (são copiadas para
// dentro da página com Function.prototype.toString) e também são
// exportadas para os testes automáticos. Por isso usam JavaScript simples
// e não dependem de nada do Node.
// ------------------------------------------------------------

// Cabeçalhos de cada consulta. Os endereços falsos são de faixas reservadas
// para documentação (RFC 5737), nunca IPs reais.
//   normal: só o código de acesso;
//   A: X-Forwarded-For e X-Real-IP falsos;
//   B: CF-Connecting-IP e True-Client-IP falsos.
function montarCabecalhos(codigo, teste) {
  var cabecalhos = { 'Authorization': 'Bearer ' + codigo };
  if (teste === 'A') {
    cabecalhos['X-Forwarded-For'] = '198.51.100.7, 203.0.113.50';
    cabecalhos['X-Real-IP'] = '198.51.100.10';
  } else if (teste === 'B') {
    cabecalhos['CF-Connecting-IP'] = '198.51.100.8';
    cabecalhos['True-Client-IP'] = '198.51.100.9';
  }
  return cabecalhos;
}

// Copia do JSON de sucesso SOMENTE os campos conhecidos do diagnóstico,
// cada um conferido pelo formato esperado. Campos extras são ignorados;
// valores fora do formato viram null (ou são descartados, nas listas).
// Devolve null se faltar a identificação mínima (instancia e consulta).
function filtrarDiagnostico(dados) {
  var HEX8 = /^[0-9a-f]{8}$/;
  var FONTE = /^(req\.ip|socket|cf-connecting-ip|true-client-ip|x-real-ip|xff\[[1-9][0-9]?\])$/;
  var TIPOS = ['público', 'privado/interno', 'Cloudflare', 'inválido ou vazio'];
  var CABECALHOS = ['cf-ray', 'cf-ipcountry', 'cf-visitor', 'x-forwarded-proto', 'x-forwarded-host', 'forwarded', 'via', 'rndr-id'];
  function inteiro(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= 0 && v <= 100000 ? v : null; }
  function propria(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) return null;
  var instancia = typeof dados.instancia === 'string' && HEX8.test(dados.instancia) ? dados.instancia : null;
  var consulta = inteiro(dados.consulta);
  if (instancia === null || consulta === null) return null;

  var fontes = {};
  if (dados.fontes && typeof dados.fontes === 'object' && !Array.isArray(dados.fontes)) {
    var nomes = Object.keys(dados.fontes);
    for (var i = 0; i < nomes.length && i < 30; i++) {
      var nome = nomes[i];
      if (!FONTE.test(nome)) continue;
      var f = dados.fontes[nome];
      if (!f || typeof f !== 'object') { fontes[nome] = null; continue; }
      fontes[nome] = {
        apelido: typeof f.apelido === 'string' && HEX8.test(f.apelido) ? f.apelido : null,
        versao: f.versao === 'ipv4' || f.versao === 'ipv6' ? f.versao : null,
        tipo: TIPOS.indexOf(f.tipo) >= 0 ? f.tipo : null,
      };
    }
  }
  var coincidencias = [];
  if (Array.isArray(dados.coincidencias)) {
    for (var j = 0; j < dados.coincidencias.length && j < 30; j++) {
      var c = dados.coincidencias[j];
      if (typeof c !== 'string' || c.length > 300) continue;
      var partes = c.split(' = ');
      var valida = partes.length > 1;
      for (var p = 0; p < partes.length; p++) if (!FONTE.test(partes[p]) || !propria(fontes, partes[p])) valida = false;
      if (valida) coincidencias.push(c);
    }
  }
  var presentes = [];
  if (Array.isArray(dados.cabecalhosPresentes)) {
    for (var k = 0; k < CABECALHOS.length; k++) if (dados.cabecalhosPresentes.indexOf(CABECALHOS[k]) >= 0) presentes.push(CABECALHOS[k]);
  }
  return {
    instancia: instancia,
    consulta: consulta,
    consultasRestantes: inteiro(dados.consultasRestantes),
    minutosRestantes: inteiro(dados.minutosRestantes),
    trustProxy: inteiro(dados.trustProxy),
    quantidadeXForwardedFor: inteiro(dados.quantidadeXForwardedFor),
    fontes: fontes,
    coincidencias: coincidencias,
    cabecalhosPresentes: presentes,
  };
}

// Classifica uma resposta já lida como texto. Nunca guarda o corpo; do JSON
// de sucesso guarda só os campos conhecidos (filtrarDiagnostico).
//   sucesso:  2xx com o JSON do diagnóstico;
//   recusado: JSON com status de erro (vindo do aplicativo);
//   outra:    qualquer outra coisa (HTML de um proxy, por exemplo).
// O Content-Type só é repetido se estiver na lista fixa; senão, "(outro)".
function interpretarResposta(status, tipoConteudo, temCfRay, corpo) {
  var PERMITIDOS = ['text/html', 'text/plain', 'application/json'];
  var codigo = typeof status === 'number' && status >= 100 && status <= 599 ? Math.floor(status) : 0;
  var bruto = typeof tipoConteudo === 'string' ? tipoConteudo.split(';')[0].trim().toLowerCase() : '';
  var tipo = !bruto ? '(ausente)' : (PERMITIDOS.indexOf(bruto) >= 0 ? bruto : '(outro)');
  var dados = null;
  try { dados = JSON.parse(corpo); } catch (e) { dados = null; }
  var objeto = dados !== null && typeof dados === 'object' && !Array.isArray(dados);
  var filtrado = objeto && codigo >= 200 && codigo < 300 ? filtrarDiagnostico(dados) : null;
  if (filtrado) return { tipo: 'sucesso', status: codigo, dados: filtrado };
  if (objeto && (codigo < 200 || codigo >= 300)) return { tipo: 'recusado', status: codigo };
  return { tipo: 'outra', status: codigo, json: objeto, contentType: tipo, cfRay: temCfRay === true };
}

// Faz a consulta. "buscar" é o fetch (no navegador, window.fetch).
// Só falhas do próprio pedido (rede, conexão cortada, corpo interrompido)
// viram "rede"; qualquer resposta HTTP é classificada por interpretarResposta.
function consultarDiagnostico(codigo, teste, buscar) {
  var cabecalhos = montarCabecalhos(codigo, teste);
  var pedido;
  try {
    pedido = buscar('/api/diagnostico-ip', { method: 'GET', headers: cabecalhos, cache: 'no-store', referrerPolicy: 'no-referrer', credentials: 'omit' });
  } catch (e) {
    return Promise.resolve({ tipo: 'rede' });
  }
  return Promise.resolve(pedido).then(function (r) {
    var tipoConteudo = r.headers.get('content-type');
    var temCfRay = r.headers.get('cf-ray') !== null;
    return r.text().then(function (corpo) {
      return interpretarResposta(r.status, tipoConteudo, temCfRay, corpo);
    }, function () { return { tipo: 'rede' }; });
  }, function () { return { tipo: 'rede' }; });
}

// Monta o aviso e o registro do histórico. Nunca inclui o corpo de uma
// resposta que não seja o JSON de sucesso, nem o código de acesso.
function descreverResultado(resultado, rotulo) {
  if (resultado.tipo === 'sucesso') {
    var d = resultado.dados;
    return {
      aviso: 'Consulta ' + d.consulta + ' concluída. Restam ' + d.consultasRestantes + ' consultas e cerca de ' + d.minutosRestantes + ' min.',
      registro: rotulo + '\n' + JSON.stringify(d, null, 2),
    };
  }
  if (resultado.tipo === 'recusado') {
    var texto = 'Recusado pelo servidor (HTTP ' + resultado.status + ')' +
      (resultado.status === 404 ? ': código incorreto, diagnóstico expirado ou limite de consultas atingido.' : '.');
    return { aviso: texto, registro: rotulo + '\n' + texto };
  }
  if (resultado.tipo === 'outra') {
    var resumo = 'Resposta que não veio do diagnóstico (' + (resultado.json ? 'JSON desconhecido' : 'não é JSON') + '; corpo omitido).\n' +
      'Status HTTP: ' + resultado.status + '\n' +
      'Content-Type: ' + resultado.contentType + '\n' +
      'cf-ray: ' + (resultado.cfRay ? 'presente' : 'ausente');
    return { aviso: 'Resposta inesperada (HTTP ' + resultado.status + '). Veja o resumo no resultado.', registro: rotulo + '\n' + resumo };
  }
  return { aviso: 'Não foi possível consultar. Verifique a conexão e tente de novo.', registro: null };
}

const ROTULOS = {
  normal: 'NORMAL',
  A: 'TESTE A: X-Forwarded-For e X-Real-IP falsos',
  B: 'TESTE B: CF-Connecting-IP e True-Client-IP falsos',
};

const SCRIPT_PAGINA = [montarCabecalhos, filtrarDiagnostico, interpretarResposta, consultarDiagnostico, descreverResultado].map(String).join('\n');

const PAGINA = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow">
<title>Diagnóstico de IP</title>
<style>
  :root { color-scheme: light dark; --fundo:#EEF1F6; --cartao:#fff; --texto:#1A2233; --suave:#5A6478; --borda:#D5DBE6; --destaque:#2A55D9; }
  @media (prefers-color-scheme: dark) { :root { --fundo:#0F1420; --cartao:#171E2D; --texto:#E6EAF2; --suave:#9AA4B8; --borda:#2A3347; --destaque:#7E9CFF; } }
  body { margin:0; background:var(--fundo); color:var(--texto); font:16px/1.45 system-ui, "Segoe UI", sans-serif; }
  main { max-width:640px; margin:0 auto; padding:20px 16px 40px; }
  .cartao { background:var(--cartao); border:1px solid var(--borda); border-radius:10px; padding:16px; margin-bottom:14px; }
  h1 { font-size:1.25rem; margin:0 0 6px; } p { margin:6px 0; color:var(--suave); }
  label { display:block; font-weight:600; margin-bottom:6px; }
  input { width:100%; box-sizing:border-box; padding:12px; font:16px ui-monospace, Consolas, monospace; border:1px solid var(--borda); border-radius:8px; background:transparent; color:var(--texto); }
  .linha { display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; }
  button { flex:1 1 180px; padding:12px; font:600 15px system-ui, sans-serif; border-radius:8px; border:1px solid var(--destaque); background:var(--destaque); color:#fff; }
  button.secundario { background:transparent; color:var(--destaque); }
  pre { white-space:pre-wrap; word-break:break-word; font:13px/1.4 ui-monospace, Consolas, monospace; margin:0; }
  #aviso { font-weight:600; color:var(--texto); }
</style>
</head>
<body>
<main>
  <div class="cartao">
    <h1>Diagnóstico de IP (temporário)</h1>
    <p>Nenhum IP é mostrado: cada endereço aparece só como um apelido de 8 caracteres.</p>
    <p>O código de acesso fica apenas nesta aba e vai somente no cabeçalho do pedido. Ao recarregar a página, ele é apagado.</p>
  </div>
  <div class="cartao">
    <label for="codigo">Código de acesso</label>
    <input id="codigo" type="password" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" inputmode="text">
    <div class="linha">
      <button type="button" class="secundario" id="mostrar">Mostrar código</button>
    </div>
    <div class="linha">
      <button type="button" id="normal">Consulta normal</button>
    </div>
    <div class="linha">
      <button type="button" id="testeA">Teste A: X-Forwarded-For e X-Real-IP falsos</button>
      <button type="button" id="testeB">Teste B: CF-Connecting-IP e True-Client-IP falsos</button>
    </div>
    <p id="aviso" role="status"></p>
  </div>
  <div class="cartao">
    <label>Resultado (pode ser copiado e enviado: não contém IPs nem o código)</label>
    <pre id="resultado">Nenhuma consulta ainda.</pre>
    <div class="linha"><button type="button" class="secundario" id="copiar">Copiar resultado</button></div>
  </div>
</main>
<script>
${SCRIPT_PAGINA}
(function () {
  var ROTULOS = ${JSON.stringify(ROTULOS)};
  var campo = document.getElementById('codigo');
  var aviso = document.getElementById('aviso');
  var saida = document.getElementById('resultado');
  var historico = [];
  document.getElementById('mostrar').addEventListener('click', function () {
    campo.type = campo.type === 'password' ? 'text' : 'password';
    this.textContent = campo.type === 'password' ? 'Mostrar código' : 'Ocultar código';
  });
  function consultar(teste) {
    var codigo = campo.value.trim().toUpperCase();
    if (codigo.length < 32) { aviso.textContent = 'Digite o código completo (pelo menos 32 caracteres).'; return; }
    aviso.textContent = 'Consultando…';
    consultarDiagnostico(codigo, teste, window.fetch.bind(window)).then(function (resultado) {
      var texto = descreverResultado(resultado, ROTULOS[teste]);
      aviso.textContent = texto.aviso;
      if (texto.registro) {
        historico.push(texto.registro);
        saida.textContent = historico.join('\\n\\n');
      }
    });
  }
  document.getElementById('normal').addEventListener('click', function () { consultar('normal'); });
  document.getElementById('testeA').addEventListener('click', function () { consultar('A'); });
  document.getElementById('testeB').addEventListener('click', function () { consultar('B'); });
  document.getElementById('copiar').addEventListener('click', function () {
    var texto = saida.textContent;
    if (navigator.clipboard) navigator.clipboard.writeText(texto).then(function () { aviso.textContent = 'Resultado copiado.'; }, function () { aviso.textContent = 'Selecione o texto e copie manualmente.'; });
    else aviso.textContent = 'Selecione o texto e copie manualmente.';
  });
})();
</script>
</body>
</html>`;

module.exports = {
  criarDiagnosticoIp, normalizar, lerToken, LIMITE_CONSULTAS, DURACAO_MS, MAX_CABECALHO, MAX_ENDERECOS,
  // Lógica da página, exportada só para os testes.
  montarCabecalhos, filtrarDiagnostico, interpretarResposta, consultarDiagnostico, descreverResultado, ROTULOS,
};
