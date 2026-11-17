// ============================================================
// Smart Support AI - Servidor
// ============================================================

// 1. Carrega a biblioteca Express, que cria o servidor web.
const express = require('express');

//    "path" já vem com o Node.js e ajuda a montar caminhos de pastas.
const path = require('path');

//    Nosso módulo de IA (modo simulado, Gemini ou Groq, conforme MODO_IA no .env).
const { analisarCaso, gerarResposta, situacaoConfiguracao, MODO_IA, MODELO_GEMINI, MODELO_GROQ } = require('./ia');

//    Proteção da demonstração pública: limites por visitante, limite global
//    diário, máximo de chamadas simultâneas e conferência de formato e
//    tamanho da análise, iguais em todos os modos (ver server/protecao.js).
const { criarProtecao, lerConfiguracao, lerFonteIp, analiseDentroDosLimites, copiarAnalise } = require('./protecao');

//    Diagnóstico TEMPORÁRIO da cadeia de proxies (desligado por padrão;
//    só liga com DIAGNOSTICO_IP_TOKEN). Ver server/diagnostico-ip.js.
const { criarDiagnosticoIp } = require('./diagnostico-ip');

//    Modelo usado no modo atual (nenhum no modo simulado).
const MODELO_ATUAL = { gemini: MODELO_GEMINI, groq: MODELO_GROQ }[MODO_IA];

// 2. Lê a porta: PORT (fornecida por serviços de hospedagem, como o Render),
//    depois PORTA (do arquivo .env, para uso local) e, por fim, 3000.
const PORTA = process.env.PORT || process.env.PORTA || 3000;

// 3. Cria a aplicação (o "servidor") e a proteção da demonstração.
const app = express();
//    FONTE_IP diz de onde vem o IP do visitante para os limites por IP:
//    req-ip (padrão, uso local) ou cloudflare (Render). Ver server/ip-visitante.js.
const FONTE_IP = lerFonteIp(process.env);
const protecao = criarProtecao(lerConfiguracao(process.env), { fonteIp: FONTE_IP.fonteIp });

//    Não anuncia a tecnologia do servidor nos cabeçalhos.
app.disable('x-powered-by');

//    Quantos proxies existem à frente do servidor (PROXIES_CONFIAVEIS, padrão 1).
//    É sempre um NÚMERO, nunca "true": assim o Express nunca usa valores de
//    X-Forwarded-For inventados pelo visitante para calcular req.ip.
//    Só importa para os limites com FONTE_IP=req-ip. No Render, o diagnóstico
//    mostrou que req.ip é um endereço INTERNO (não o do visitante); por isso,
//    no Render use FONTE_IP=cloudflare. Ver Documentação/Guia_Demonstracao.md.
app.set('trust proxy', protecao.configuracao.proxiesConfiaveis);

//    Permite receber dados em formato JSON vindos da tela (limite de 32 KB).
app.use(express.json({ limit: '32kb' }));

// 4. Entrega os arquivos da pasta "public" (a tela do sistema).
//    Ao acessar http://localhost:3000/ o navegador recebe public/index.html.
app.use(express.static(path.join(__dirname, '..', 'public')));

// Mensagem mostrada ao visitante quando o problema é de configuração do servidor.
// O detalhe (qual variável falta, por exemplo) fica só no registro do servidor.
const MSG_CONFIGURACAO_PUBLICA = 'O serviço de IA não está disponível no momento por um problema de configuração do servidor. Tente novamente mais tarde.';

// Textos que revelam detalhes internos (arquivo .env e nomes de variáveis).
const PADRAO_DETALHE_INTERNO = /\.env\b|\b[A-Z][A-Z0-9]*_API_KEY\b|\bMODO_IA\b|\bMODELO_[A-Z]+\b/;

// Garante que nenhuma mensagem enviada ao visitante cite o .env ou variáveis.
function mensagemParaVisitante(texto) {
  return PADRAO_DETALHE_INTERNO.test(texto) ? MSG_CONFIGURACAO_PUBLICA : texto;
}

// 5. Rota de teste: confirma que o servidor está no ar e qual o modo da IA.
//    Acesse http://localhost:3000/api/status
//    Informa também se a configuração está completa (nunca o valor da chave)
//    e os limites da demonstração (sem IPs e sem dados de outros visitantes).
app.get('/api/status', (req, res) => {
  const configuracao = situacaoConfiguracao();
  const dados = { status: 'funcionando', modoIA: MODO_IA, configuracaoOk: configuracao.ok };
  if (MODELO_ATUAL) dados.modelo = MODELO_ATUAL;
  if (!configuracao.ok) dados.erroConfiguracao = mensagemParaVisitante(configuracao.mensagem);
  dados.demonstracao = protecao.situacaoPublica();
  res.json(dados);
});

// 5b. Diagnóstico temporário de IP. Desligado, as rotas nem são criadas.
//     Ligado, sem token válido (ou depois de expirar) responde como um
//     endereço inexistente. Não passa pelos limites de IA e não chama a IA.
const diagnosticoIp = criarDiagnosticoIp({ ambiente: process.env, trustProxy: protecao.configuracao.proxiesConfiaveis });
if (diagnosticoIp.ativo) {
  app.get('/api/diagnostico-ip', diagnosticoIp.rotaApi);
  app.get('/diagnostico-ip', diagnosticoIp.pagina);
}

// Função de apoio: transforma qualquer valor em texto sem espaços nas pontas.
function texto(valor) {
  return typeof valor === 'string' ? valor.trim() : '';
}

// Tamanho máximo de cada campo na demonstração pública (os mesmos limites da tela).
const LIMITES = {
  mensagem: { max: 2000, nome: 'A mensagem do cliente' },
  contexto: { max: 2000, nome: 'O histórico ou contexto' },
  descricaoSolucao: { max: 1000, nome: 'A descrição da solução' },
  identificacao: { max: 60, nome: 'A identificação do caso' },
};

// Lê os dados do caso enviados pela tela e confere os campos obrigatórios.
// Devolve { caso } quando está tudo certo, ou { erro } com o motivo.
function lerCaso(dados) {
  if (!dados || typeof dados !== 'object') {
    return { erro: 'Os dados do caso não foram recebidos. Preencha o formulário e tente novamente.' };
  }
  const caso = {
    mensagem: texto(dados.mensagem),
    tipo: texto(dados.tipo),
    identificacao: texto(dados.identificacao),
    contexto: texto(dados.contexto),
    solucao: dados.solucao === 'sim' ? 'sim' : 'nao',
    descricaoSolucao: texto(dados.descricaoSolucao),
  };
  if (!caso.mensagem) {
    return { erro: 'Informe a mensagem do cliente.' };
  }
  if (caso.solucao === 'sim' && !caso.descricaoSolucao) {
    return { erro: 'Descreva a solução autorizada ou marque "Não".' };
  }
  for (const [campo, limite] of Object.entries(LIMITES)) {
    if (caso[campo].length > limite.max) {
      return { erro: `${limite.nome} passou do limite de ${limite.max.toLocaleString('pt-BR')} caracteres. Reduza o texto e tente novamente.` };
    }
  }
  return { caso };
}

const MSG_SEM_ANALISE = 'Faça a análise do caso antes de gerar a resposta.';
const MSG_ANALISE_RECUSADA = 'A análise recebida está incompleta ou passou do tamanho permitido. Analise o caso novamente antes de gerar a resposta.';
const MSG_ANALISE_GRANDE = 'A análise gerada passou do tamanho permitido na demonstração. Tente novamente com um caso mais curto.';

// Lê a análise enviada pela tela (que pode ter sido adulterada) e confere
// formato e tamanho de cada campo e lista. Só as 6 partes seguem adiante.
function lerAnalise(valor) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor) || typeof valor.proximoPasso !== 'string') {
    return { erro: MSG_SEM_ANALISE };
  }
  if (!analiseDentroDosLimites(valor)) return { erro: MSG_ANALISE_RECUSADA };
  return { analise: copiarAnalise(valor) };
}

// Confere os dados ANTES dos limites de uso: um pedido inválido é
// recusado sem gastar a cota do visitante e sem chamar a IA.
function exigirCaso(req, res, next) {
  const { caso, erro } = lerCaso(req.body);
  if (erro) return res.status(400).json({ erro });
  res.locals.caso = caso;
  next();
}

function exigirCasoEAnalise(req, res, next) {
  const corpo = req.body || {};
  const { caso, erro } = lerCaso(corpo.caso);
  if (erro) return res.status(400).json({ erro });
  const lida = lerAnalise(corpo.analise);
  if (lida.erro) return res.status(400).json({ erro: lida.erro });
  res.locals.caso = caso;
  res.locals.analise = lida.analise;
  next();
}

// Escolhe a mensagem de erro que pode aparecer na tela.
// Erros técnicos inesperados viram uma mensagem simples.
function mensagemDeFalha(falha, acao) {
  if (falha && falha.amigavel) return mensagemParaVisitante(falha.message);
  return `Ocorreu um problema ao ${acao}. Tente novamente em instantes.`;
}

// O que vai para o registro do servidor: a mensagem amigável (texto fixo do
// projeto) ou só o tipo do erro. Nunca o objeto completo nem o conteúdo do caso.
function resumoDaFalha(falha) {
  if (falha && falha.amigavel) return falha.message;
  return falha && typeof falha.name === 'string' && /^[A-Za-z]{1,40}$/.test(falha.name) ? falha.name : 'Erro';
}

// 6. Rota de análise: confere os dados, aplica os limites e devolve a análise.
app.post('/api/analisar', exigirCaso, ...protecao.middlewares, async (req, res) => {
  try {
    const analise = await analisarCaso(res.locals.caso);
    if (!analiseDentroDosLimites(analise)) {
      console.error('Erro na análise: a análise gerada passou do tamanho permitido.');
      return res.status(500).json({ erro: MSG_ANALISE_GRANDE });
    }
    res.json(analise);
  } catch (falha) {
    console.error('Erro na análise:', resumoDaFalha(falha));
    res.status(500).json({ erro: mensagemDeFalha(falha, 'analisar o caso') });
  } finally {
    res.locals.liberarVaga(); // libera a vaga de chamada simultânea
  }
});

// 7. Rota da resposta: só funciona se a análise vier junto (regra de negócio).
app.post('/api/gerar-resposta', exigirCasoEAnalise, ...protecao.middlewares, async (req, res) => {
  try {
    const resposta = await gerarResposta(res.locals.caso, res.locals.analise);
    res.json(resposta);
  } catch (falha) {
    console.error('Erro ao gerar resposta:', resumoDaFalha(falha));
    res.status(500).json({ erro: mensagemDeFalha(falha, 'gerar a resposta') });
  } finally {
    res.locals.liberarVaga(); // libera a vaga de chamada simultânea
  }
});

// 8. Endereço /api que não existe: responde em JSON, não em página HTML.
app.use('/api', (req, res) => {
  res.status(404).json({ erro: 'Endereço não encontrado no servidor.' });
});

// 9. Tratamento geral de erros: sempre responde com uma mensagem clara em JSON.
//    No registro vão só o tipo e o status (nunca o objeto completo, que pode
//    conter o corpo do pedido).
app.use((erro, req, res, next) => {
  if (erro.type === 'entity.too.large') {
    return res.status(413).json({ erro: 'Os textos enviados são grandes demais. Reduza o conteúdo e tente novamente.' });
  }
  if (erro.type === 'entity.parse.failed') {
    return res.status(400).json({ erro: 'Os dados enviados estão em um formato inválido. Recarregue a página e tente novamente.' });
  }
  const tipo = typeof erro.type === 'string' && /^[a-z.]{1,40}$/.test(erro.type) ? ` tipo=${erro.type}` : '';
  const status = Number.isInteger(erro.status) ? ` status=${erro.status}` : '';
  console.error(`Erro inesperado: ${resumoDaFalha(erro)}${tipo}${status}`);
  res.status(500).json({ erro: 'Ocorreu um erro inesperado no servidor. Tente novamente em instantes.' });
});

// 10. Liga o servidor na porta definida e avisa no terminal.
//     O terminal (ou o log do Render) é visto só pela responsável pelo projeto,
//     então aqui o aviso de configuração pode ser detalhado.
const servidor = app.listen(PORTA, () => {
  const configuracao = situacaoConfiguracao();
  const limites = protecao.configuracao;
  console.log('Smart Support AI iniciado.');
  console.log(`Modo da IA: ${MODO_IA}${MODELO_ATUAL ? ` (modelo ${MODELO_ATUAL})` : ''}`);
  console.log(`Limites da demonstração: ${limites.limiteIpJanela} por visitante a cada ${Math.round(limites.janelaIpMs / 60000)} min, ${limites.limiteIpDia} por visitante por dia, ${limites.limiteGlobalDia} no total por dia, ${limites.maxSimultaneas} ao mesmo tempo.`);
  console.log(`Fonte do IP do visitante: ${protecao.fonteIp}`);
  if (FONTE_IP.valorInvalido) console.warn('Aviso de configuração: FONTE_IP com valor desconhecido; usando req-ip. Valores aceitos: req-ip ou cloudflare.');
  if (!configuracao.ok) {
    console.warn(`Aviso de configuração: ${configuracao.mensagem}`);
    console.warn('Confira MODO_IA e a chave do provedor (GEMINI_API_KEY ou GROQ_API_KEY) no .env local ou nas variáveis de ambiente do Render.');
  }
  if (diagnosticoIp.ativo) console.warn('Diagnóstico de IP: ATIVO (temporário) por até 30 consultas ou 30 minutos.');
  else if (diagnosticoIp.formatoInvalido) console.warn('Diagnóstico de IP: DIAGNOSTICO_IP_TOKEN com formato inválido; o diagnóstico continua desligado.');
  console.log(`Acesse: http://localhost:${servidor.address().port}`);
  console.log('Para encerrar, pressione Ctrl + C.');
});

// Exportado só para os testes automáticos poderem desligar o servidor.
module.exports = { app, servidor, protecao, diagnosticoIp, LIMITES, MSG_CONFIGURACAO_PUBLICA, MSG_SEM_ANALISE, MSG_ANALISE_RECUSADA, MSG_ANALISE_GRANDE };
