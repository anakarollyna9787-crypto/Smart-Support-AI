// ============================================================
// Smart Support AI - Identificação do visitante para os limites por IP
//
// Escolhida pela variável FONTE_IP:
//
//   req-ip      (padrão) usa req.ip, calculado pelo Express com
//               "trust proxy" numérico. Serve para uso local e testes.
//
//   cloudflare  usa o cabeçalho CF-Connecting-IP, que a Cloudflare
//               (borda do Render) preenche com o IP do visitante.
//               Só é aceito quando TODAS as condições valem:
//               1. a conexão TCP (socket) vem de um endereço interno
//                  (rede privada do Render; loopback no uso local);
//               2. existe exatamente UM cabeçalho cf-ray, no formato
//                  da Cloudflare (16 hexadecimais, hífen, 3 letras);
//               3. existe exatamente UM cabeçalho CF-Connecting-IP,
//                  com um único IP válido (sem vírgula, porta, colchetes
//                  ou zona) e público (não privado, interno ou reservado).
//               Se qualquer condição falhar, o pedido usa a chave
//               compartilhada "sem-ip-confiavel": todos os pedidos sem IP
//               confiável dividem UMA cota. NUNCA se recorre a req.ip,
//               True-Client-IP, X-Real-IP ou X-Forwarded-For.
//
// Por que é seguro no Render: no diagnóstico, a Cloudflare recusou (HTTP 403)
// pedidos que tentaram enviar CF-Connecting-IP e True-Client-IP próprios.
// Essa garantia é da infraestrutura: se surgir um domínio próprio ou outro
// proxy à frente do Render, refaça a validação do Guia de Demonstração.
//
// Qualquer valor de FONTE_IP diferente de "req-ip" ou "cloudflare" vale
// "req-ip" (com aviso no terminal).
//
// Privacidade: nada aqui registra IPs. Os avisos mostram só o motivo da recusa.
// ============================================================

const net = require('net');

const FONTES_IP = ['req-ip', 'cloudflare'];
const FONTE_PADRAO = 'req-ip';
const CHAVE_SEM_IP_CONFIAVEL = 'sem-ip-confiavel';

// Formato do Ray ID da Cloudflare, por exemplo "8d3f0c2a1b9e4f12-GRU".
const FORMATO_CF_RAY = /^[0-9a-f]{16}-[A-Z]{3}$/i;
// Um único endereço IPv4 ou IPv6: só dígitos hexadecimais, ":" e ".".
// (Recusa vírgulas, espaços, colchetes, portas com colchetes e zonas "%".)
const FORMATO_IP = /^[0-9A-Fa-f:.]{2,45}$/;
const TAMANHO_MAXIMO_IP = 45;

// Endereços internos: redes privadas, CGNAT, loopback, link-local, IPv6 local (ULA).
// A conexão TCP (socket) PRECISA vir de uma destas faixas no modo cloudflare.
const FAIXAS_INTERNAS = new net.BlockList();
for (const [base, bits] of [['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16]]) {
  FAIXAS_INTERNAS.addSubnet(base, bits, 'ipv4');
}
for (const [base, bits] of [['fc00::', 7], ['fe80::', 10], ['::1', 128]]) {
  FAIXAS_INTERNAS.addSubnet(base, bits, 'ipv6');
}

// Endereços que nunca são de um visitante real: "esta rede", multicast,
// reservados, broadcast, endereço não especificado e multicast IPv6.
const FAIXAS_RESERVADAS = new net.BlockList();
for (const [base, bits] of [['0.0.0.0', 8], ['224.0.0.0', 4], ['240.0.0.0', 4]]) {
  FAIXAS_RESERVADAS.addSubnet(base, bits, 'ipv4');
}
for (const [base, bits] of [['::', 128], ['ff00::', 8]]) {
  FAIXAS_RESERVADAS.addSubnet(base, bits, 'ipv6');
}

// Lê FONTE_IP. Valor ausente fica no padrão; valor desconhecido também,
// mas é sinalizado para o servidor avisar no terminal.
function lerFonteIp(ambiente = process.env) {
  const bruto = typeof ambiente.FONTE_IP === 'string' ? ambiente.FONTE_IP.trim() : '';
  if (!bruto) return { fonteIp: FONTE_PADRAO, valorInvalido: false };
  const valor = bruto.toLowerCase();
  return FONTES_IP.includes(valor) ? { fonteIp: valor, valorInvalido: false } : { fonteIp: FONTE_PADRAO, valorInvalido: true };
}

// Converte um IPv4 escrito como IPv6 (::ffff:1.2.3.4) para IPv4 comum.
function desmapearIpv4(ip) {
  const achado = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  return achado && net.isIPv4(achado[1]) ? achado[1] : ip;
}

// Valida um único IP, sem nenhuma "limpeza" além de tirar o prefixo ::ffff:.
// Devolve { ip, versao } ou null.
function lerIpEstrito(valor) {
  if (typeof valor !== 'string' || valor.length > TAMANHO_MAXIMO_IP || !FORMATO_IP.test(valor)) return null;
  if (!net.isIP(valor)) return null;
  const ip = desmapearIpv4(valor.toLowerCase());
  return { ip, versao: net.isIPv4(ip) ? 'ipv4' : 'ipv6' };
}

// Endereço da conexão TCP (o "socket"), que o visitante não controla.
function ipDoSocket(req) {
  const endereco = req && req.socket && req.socket.remoteAddress;
  return typeof endereco === 'string' ? lerIpEstrito(endereco) : null;
}

// Valores de um cabeçalho, separando cabeçalhos repetidos.
// O Node junta repetições em req.headers; headersDistinct as mantém separadas.
function valoresDoCabecalho(req, nome) {
  const distintos = req && req.headersDistinct;
  if (distintos && typeof distintos === 'object') {
    const lista = distintos[nome];
    return Array.isArray(lista) ? lista : [];
  }
  const valor = req && req.headers ? req.headers[nome] : undefined;
  if (valor === undefined) return [];
  return Array.isArray(valor) ? valor : [valor];
}

// Avalia o pedido no modo cloudflare.
// Devolve { ip, versao } quando o IP é confiável, ou { motivo } quando não é.
function avaliarCloudflare(req) {
  const socket = ipDoSocket(req);
  if (!socket || !FAIXAS_INTERNAS.check(socket.ip, socket.versao)) return { motivo: 'conexao-nao-interna' };

  const rays = valoresDoCabecalho(req, 'cf-ray');
  if (rays.length === 0) return { motivo: 'cf-ray-ausente' };
  if (rays.length > 1) return { motivo: 'cf-ray-repetido' };
  if (typeof rays[0] !== 'string' || !FORMATO_CF_RAY.test(rays[0])) return { motivo: 'cf-ray-invalido' };

  const ips = valoresDoCabecalho(req, 'cf-connecting-ip');
  if (ips.length === 0) return { motivo: 'cf-connecting-ip-ausente' };
  if (ips.length > 1) return { motivo: 'cf-connecting-ip-repetido' };
  const visitante = lerIpEstrito(ips[0]);
  if (!visitante) return { motivo: 'cf-connecting-ip-invalido' };
  if (FAIXAS_INTERNAS.check(visitante.ip, visitante.versao) || FAIXAS_RESERVADAS.check(visitante.ip, visitante.versao)) {
    return { motivo: 'cf-connecting-ip-nao-publico' };
  }
  return visitante;
}

// Cria a função que dá a chave do visitante para os limitadores.
// - ipKeyGenerator: função do express-rate-limit (agrupa IPv6 por /56).
// - aoRecusar(motivo): chamada quando o modo cloudflare usa a chave compartilhada.
function criarChaveDoVisitante({ fonteIp = FONTE_PADRAO, ipKeyGenerator, aoRecusar = () => {} }) {
  if (fonteIp === 'cloudflare') {
    return function chaveCloudflare(req) {
      const resultado = avaliarCloudflare(req);
      if (resultado.motivo) {
        aoRecusar(resultado.motivo);
        return CHAVE_SEM_IP_CONFIAVEL;
      }
      return ipKeyGenerator(resultado.ip);
    };
  }
  // Modo req-ip: comportamento original (req.ip com "trust proxy" numérico).
  return function chaveReqIp(req) {
    return ipKeyGenerator(typeof req.ip === 'string' ? req.ip : '');
  };
}

module.exports = {
  FONTES_IP,
  FONTE_PADRAO,
  CHAVE_SEM_IP_CONFIAVEL,
  lerFonteIp,
  lerIpEstrito,
  avaliarCloudflare,
  criarChaveDoVisitante,
};
