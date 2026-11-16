// ============================================================
// Smart Support AI - Proteção da demonstração pública
//
// Protege a cota da IA contra uso excessivo, em TODOS os modos
// (simulado, gemini e groq), com quatro barreiras:
//
// 1. Limite por visitante (IP) a cada 10 minutos  -> express-rate-limit
// 2. Limite por visitante (IP) por dia            -> express-rate-limit
// 3. Limite global por dia (todos os visitantes)  -> este arquivo
// 4. Máximo de chamadas simultâneas à IA          -> este arquivo
//
// Ordem das barreiras: primeiro as do visitante (1 e 2) e depois as
// globais (3 e 4). Assim, um único visitante insistente esgota só a
// própria cota, e não a cota do dia de todo mundo.
//
// Privacidade: nada aqui registra IPs nem o conteúdo dos casos.
// Os contadores ficam só na memória do servidor e somem ao reiniciar.
//
// Também define os limites de tamanho da análise aceita pelo servidor
// (analiseDentroDosLimites), usados pelo server.js e pelo ia-groq.js.
//
// Valores padrão (podem ser trocados por variáveis de ambiente):
//   LIMITE_IP_JANELA=6        chamadas por visitante em cada janela
//   JANELA_IP_MS=600000       tamanho da janela (10 minutos)
//   LIMITE_IP_DIA=20          chamadas por visitante por dia
//   LIMITE_GLOBAL_DIA=200     chamadas de todos os visitantes por dia
//   LIMITE_SIMULTANEAS=2      chamadas à IA ao mesmo tempo
//   PROXIES_CONFIAVEIS=1      quantos proxies existem à frente do servidor
// ============================================================

// A biblioteca express-rate-limit só é carregada quando a proteção é criada
// (o ia-groq.js usa este arquivo apenas para os limites da análise).
const limitador = () => require('express-rate-limit');

// ---------- Limites de tamanho da análise ----------
// Iguais em todos os modos (simulado, gemini e groq). Com max_completion_tokens
// de 2.500 na análise, uma análise legítima fica abaixo destes valores; uma
// análise adulterada (enviada pelo navegador) é recusada antes de chegar à IA.
const LIMITES_ANALISE = {
  texto: 3000,         // problema, necessidade e próximo passo (cada um)
  itensPorLista: 20,   // informações identificadas, pendentes e contradições (cada lista)
  item: 1500,          // cada item de lista
  total: 12000,        // soma dos caracteres de todos os textos da análise
};
const CAMPOS_TEXTO = ['problema', 'necessidade', 'proximoPasso'];
const CAMPOS_LISTA = ['informacoesIdentificadas', 'informacoesPendentes', 'contradicoes'];

// Confere o formato (6 partes com os tipos certos) E os limites de tamanho.
function analiseDentroDosLimites(a) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return false;
  let total = 0;
  for (const campo of CAMPOS_TEXTO) {
    if (typeof a[campo] !== 'string' || a[campo].length > LIMITES_ANALISE.texto) return false;
    total += a[campo].length;
  }
  for (const campo of CAMPOS_LISTA) {
    const lista = a[campo];
    if (!Array.isArray(lista) || lista.length > LIMITES_ANALISE.itensPorLista) return false;
    for (const item of lista) {
      if (typeof item !== 'string' || item.length > LIMITES_ANALISE.item) return false;
      total += item.length;
    }
  }
  return total <= LIMITES_ANALISE.total;
}

// Copia só as 6 partes da análise (descarta campos extras enviados pelo navegador).
function copiarAnalise(a) {
  return Object.fromEntries([...CAMPOS_TEXTO, ...CAMPOS_LISTA].map((campo) => [campo, a[campo]]));
}

// Fuso usado para "virar o dia" do limite global.
const FUSO = 'America/Sao_Paulo';

const PADROES = {
  limiteIpJanela: 6,
  janelaIpMs: 10 * 60 * 1000,
  limiteIpDia: 20,
  limiteGlobalDia: 200,
  maxSimultaneas: 2,
  proxiesConfiaveis: 1,
};

// Nome da variável de ambiente e valores aceitos para cada configuração.
const VARIAVEIS = {
  limiteIpJanela: { nome: 'LIMITE_IP_JANELA', min: 1, max: 100000 },
  janelaIpMs: { nome: 'JANELA_IP_MS', min: 100, max: 24 * 60 * 60 * 1000 },
  limiteIpDia: { nome: 'LIMITE_IP_DIA', min: 1, max: 100000 },
  limiteGlobalDia: { nome: 'LIMITE_GLOBAL_DIA', min: 1, max: 1000000 },
  maxSimultaneas: { nome: 'LIMITE_SIMULTANEAS', min: 1, max: 100 },
  proxiesConfiaveis: { nome: 'PROXIES_CONFIAVEIS', min: 0, max: 10 },
};

const UM_DIA_MS = 24 * 60 * 60 * 1000;

// Lê um número inteiro de uma variável de ambiente.
// Valor ausente, inválido ou fora da faixa -> usa o padrão.
// (Por isso PROXIES_CONFIAVEIS=true NUNCA liga a confiança irrestrita.)
function lerInteiro(texto, padrao, min, max) {
  if (typeof texto !== 'string' || !/^\s*\d+\s*$/.test(texto)) return padrao;
  const numero = Number(texto.trim());
  return Number.isSafeInteger(numero) && numero >= min && numero <= max ? numero : padrao;
}

// Monta a configuração da proteção a partir das variáveis de ambiente.
function lerConfiguracao(ambiente = process.env) {
  const configuracao = {};
  for (const [campo, regra] of Object.entries(VARIAVEIS)) {
    configuracao[campo] = lerInteiro(ambiente[regra.nome], PADROES[campo], regra.min, regra.max);
  }
  return configuracao;
}

// ---------- Datas no horário de Brasília ----------
const formatoData = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function partesDaData(ms) {
  const partes = {};
  for (const { type, value } of formatoData.formatToParts(ms)) partes[type] = value;
  return partes;
}

// Ex.: "2026-11-16" (o dia atual em Brasília).
function diaEmBrasilia(ms) {
  const p = partesDaData(ms);
  return `${p.year}-${p.month}-${p.day}`;
}

// Segundos que faltam para a meia-noite em Brasília (mínimo 1).
function segundosAteMeiaNoite(ms) {
  const p = partesDaData(ms);
  const passados = Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second);
  return Math.max(1, 24 * 3600 - passados);
}

// ---------- Mensagens exibidas ao visitante ----------
function minutos(ms) {
  return Math.max(1, Math.round(ms / 60000));
}

function criarMensagens(configuracao) {
  return {
    limiteJanela: `Você atingiu o limite da demonstração: até ${configuracao.limiteIpJanela} chamadas a cada ${minutos(configuracao.janelaIpMs)} minutos. Aguarde alguns minutos e tente novamente.`,
    limiteDia: `Você atingiu o limite diário da demonstração: até ${configuracao.limiteIpDia} chamadas por dia. Tente novamente amanhã.`,
    limiteGlobal: 'O limite diário de uso da demonstração foi atingido. Tente novamente amanhã (a cota é renovada à meia-noite, horário de Brasília).',
    ocupado: 'Muitas pessoas estão usando a demonstração agora. Aguarde alguns segundos e tente novamente.',
  };
}

// ---------- Limite global diário e chamadas simultâneas ----------
// opcoes.agora: função que devolve a hora atual em ms (trocada nos testes).
function criarControleDeUso({ limiteGlobalDia, maxSimultaneas, agora = () => Date.now() }) {
  let dia = diaEmBrasilia(agora());
  let usadasHoje = 0;
  let emAndamento = 0;

  // Na virada do dia (Brasília), a cota global recomeça do zero.
  function atualizarDia() {
    const hoje = diaEmBrasilia(agora());
    if (hoje !== dia) {
      dia = hoje;
      usadasHoje = 0;
    }
  }

  // Tenta reservar uma chamada. Devolve { ok: true, finalizar } ou { ok: false, motivo }.
  // A cota global é gasta no início (mesmo que a IA falhe depois),
  // porque uma chamada com erro também pode consumir a cota do provedor.
  function tentarIniciar() {
    atualizarDia();
    if (usadasHoje >= limiteGlobalDia) return { ok: false, motivo: 'esgotado' };
    if (emAndamento >= maxSimultaneas) return { ok: false, motivo: 'ocupado' };
    usadasHoje++;
    emAndamento++;
    let finalizada = false;
    return {
      ok: true,
      finalizar() {           // libera a vaga (só uma vez, mesmo se chamada de novo)
        if (finalizada) return;
        finalizada = true;
        emAndamento--;
      },
    };
  }

  function situacao() {
    atualizarDia();
    return { limiteGlobalDia, usadasHoje, emAndamento, maxSimultaneas, esgotadoHoje: usadasHoje >= limiteGlobalDia };
  }

  return { tentarIniciar, situacao };
}

// ---------- Identificação do visitante ----------
// Usa req.ip, que o Express calcula com base em "trust proxy"
// (configurado no server.js com um NÚMERO de proxies, nunca "true").
// IPv6 é agrupado por sub-rede /56, para que um único visitante não
// escape do limite trocando de endereço dentro da própria rede.
function chaveDoVisitante(req) {
  return limitador().ipKeyGenerator(typeof req.ip === 'string' ? req.ip : '');
}

// O limitador avisa no terminal quando detecta configuração suspeita.
// Registramos só o código do aviso, nunca a mensagem (que pode conter o IP).
const registroSemIp = {
  warn(aviso) { console.warn(`[protecao] aviso do limitador: ${aviso && aviso.code ? aviso.code : 'sem código'}`); },
  error(erro) { console.error(`[protecao] erro do limitador: ${erro && erro.code ? erro.code : 'sem código'}`); },
};

// Marca a resposta como recusada pela proteção (usado pelos testes e pelo reembolso).
function recusar(res, status, segundos, mensagem) {
  res.locals.recusadoPelaProtecao = true;
  res.set('Retry-After', String(Math.max(1, Math.ceil(segundos))));
  res.status(status).json({ erro: mensagem });
}

// Cria um limitador por visitante (express-rate-limit, memória local).
function criarLimitador({ janelaMs, limite, mensagem, loja }) {
  return limitador().rateLimit({
    windowMs: janelaMs,
    limit: limite,
    store: loja,
    keyGenerator: chaveDoVisitante,
    standardHeaders: false,
    legacyHeaders: false,
    logger: registroSemIp,
    handler(req, res) {
      const reinicio = req.rateLimit && req.rateLimit.resetTime ? req.rateLimit.resetTime.getTime() : Date.now() + janelaMs;
      recusar(res, 429, (reinicio - Date.now()) / 1000, mensagem);
    },
  });
}

// Cria toda a proteção da demonstração.
// Devolve { middlewares, situacaoPublica, configuracao, controle }.
function criarProtecao(configuracao = lerConfiguracao(), opcoes = {}) {
  const mensagens = criarMensagens(configuracao);
  const agora = opcoes.agora || (() => Date.now());
  const controle = criarControleDeUso({ ...configuracao, agora });

  const { MemoryStore } = limitador();
  const lojaJanela = new MemoryStore();
  const lojaDia = new MemoryStore();
  const limiteJanela = criarLimitador({ janelaMs: configuracao.janelaIpMs, limite: configuracao.limiteIpJanela, mensagem: mensagens.limiteJanela, loja: lojaJanela });
  const limiteDia = criarLimitador({ janelaMs: UM_DIA_MS, limite: configuracao.limiteIpDia, mensagem: mensagens.limiteDia, loja: lojaDia });

  // Barreiras globais: cota do dia e vagas simultâneas.
  async function controlarUso(req, res, next) {
    const reserva = controle.tentarIniciar();
    if (!reserva.ok) {
      if (reserva.motivo === 'esgotado') {
        return recusar(res, 429, segundosAteMeiaNoite(agora()), mensagens.limiteGlobal);
      }
      // Servidor ocupado: a chamada não aconteceu, então ela é devolvida
      // à cota do visitante (para não punir quem só pegou um momento cheio).
      const chave = chaveDoVisitante(req);
      await Promise.all([lojaJanela.decrement(chave), lojaDia.decrement(chave)]);
      return recusar(res, 503, 5, mensagens.ocupado);
    }
    // A rota libera a vaga quando a chamada à IA TERMINA (res.locals.liberarVaga,
    // num "finally"). Não liberamos quando a conexão cai: se o visitante
    // desistir no meio, a chamada à IA continua em andamento e ainda ocupa a vaga.
    // O evento "finish" fica como reserva (finalizar só age uma vez).
    res.locals.liberarVaga = reserva.finalizar;
    res.once('finish', reserva.finalizar);
    next();
  }

  // Informações seguras para a tela (sem IPs, sem contagens de outros visitantes).
  function situacaoPublica() {
    return {
      limitePorJanela: configuracao.limiteIpJanela,
      janelaMinutos: minutos(configuracao.janelaIpMs),
      limitePorDia: configuracao.limiteIpDia,
      limiteGlobalDia: configuracao.limiteGlobalDia,
      esgotadoHoje: controle.situacao().esgotadoHoje,
    };
  }

  return {
    middlewares: [limiteJanela, limiteDia, controlarUso],
    situacaoPublica,
    configuracao,
    controle,
    mensagens,
  };
}

module.exports = {
  analiseDentroDosLimites,
  copiarAnalise,
  LIMITES_ANALISE,
  criarProtecao,
  criarControleDeUso,
  lerConfiguracao,
  diaEmBrasilia,
  segundosAteMeiaNoite,
  chaveDoVisitante,
  registroSemIp,
  PADROES,
  VARIAVEIS,
};
