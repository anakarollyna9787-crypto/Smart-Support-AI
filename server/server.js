// ============================================================
// Smart Support AI - Servidor
// ============================================================

// 1. Carrega a biblioteca Express, que cria o servidor web.
const express = require('express');

//    "path" já vem com o Node.js e ajuda a montar caminhos de pastas.
const path = require('path');

//    Nosso módulo de IA (modo simulado ou Gemini, conforme MODO_IA no .env).
const { analisarCaso, gerarResposta, situacaoConfiguracao, MODO_IA, MODELO_GEMINI } = require('./ia');

// 2. Lê a porta: PORT (fornecida por serviços de hospedagem, como o Render),
//    depois PORTA (do arquivo .env, para uso local) e, por fim, 3000.
const PORTA = process.env.PORT || process.env.PORTA || 3000;

// 3. Cria a aplicação (o "servidor").
const app = express();

//    Permite receber dados em formato JSON vindos da tela (limite de 100 KB).
app.use(express.json({ limit: '100kb' }));

// 4. Entrega os arquivos da pasta "public" (a tela do sistema).
//    Ao acessar http://localhost:3000/ o navegador recebe public/index.html.
app.use(express.static(path.join(__dirname, '..', 'public')));

// 5. Rota de teste: confirma que o servidor está no ar e qual o modo da IA.
//    Acesse http://localhost:3000/api/status
//    Informa também se a configuração está completa (nunca o valor da chave).
app.get('/api/status', (req, res) => {
  const configuracao = situacaoConfiguracao();
  const dados = { status: 'funcionando', modoIA: MODO_IA, configuracaoOk: configuracao.ok };
  if (MODO_IA === 'gemini') dados.modelo = MODELO_GEMINI;
  if (!configuracao.ok) dados.erroConfiguracao = configuracao.mensagem;
  res.json(dados);
});

// Função de apoio: transforma qualquer valor em texto sem espaços nas pontas.
function texto(valor) {
  return typeof valor === 'string' ? valor.trim() : '';
}

// Tamanho máximo de cada campo (os mesmos limites da tela).
const LIMITES = {
  mensagem: { max: 5000, nome: 'A mensagem do cliente' },
  contexto: { max: 5000, nome: 'O histórico ou contexto' },
  descricaoSolucao: { max: 2000, nome: 'A descrição da solução' },
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

// Escolhe a mensagem de erro que pode aparecer na tela.
// Erros técnicos inesperados viram uma mensagem simples.
function mensagemDeFalha(falha, acao) {
  if (falha && falha.amigavel) return falha.message;
  return `Ocorreu um problema ao ${acao}. Tente novamente em instantes.`;
}

// 6. Rota de análise: recebe o caso, confere os dados e devolve a análise.
app.post('/api/analisar', async (req, res) => {
  const { caso, erro } = lerCaso(req.body);
  if (erro) return res.status(400).json({ erro });

  try {
    const analise = await analisarCaso(caso);
    res.json(analise);
  } catch (falha) {
    console.error('Erro na análise:', falha.message);
    res.status(500).json({ erro: mensagemDeFalha(falha, 'analisar o caso') });
  }
});

// 7. Rota da resposta: só funciona se a análise vier junto (regra de negócio).
app.post('/api/gerar-resposta', async (req, res) => {
  const corpo = req.body || {};
  const { caso, erro } = lerCaso(corpo.caso);
  if (erro) return res.status(400).json({ erro });

  const analise = corpo.analise;
  if (!analise || typeof analise !== 'object' || typeof analise.proximoPasso !== 'string') {
    return res.status(400).json({ erro: 'Faça a análise do caso antes de gerar a resposta.' });
  }

  try {
    const resposta = await gerarResposta(caso, analise);
    res.json(resposta);
  } catch (falha) {
    console.error('Erro ao gerar resposta:', falha.message);
    res.status(500).json({ erro: mensagemDeFalha(falha, 'gerar a resposta') });
  }
});

// 8. Endereço /api que não existe: responde em JSON, não em página HTML.
app.use('/api', (req, res) => {
  res.status(404).json({ erro: 'Endereço não encontrado no servidor.' });
});

// 9. Tratamento geral de erros: sempre responde com uma mensagem clara em JSON.
app.use((erro, req, res, next) => {
  if (erro.type === 'entity.too.large') {
    return res.status(413).json({ erro: 'Os textos enviados são grandes demais. Reduza o conteúdo e tente novamente.' });
  }
  if (erro.type === 'entity.parse.failed') {
    return res.status(400).json({ erro: 'Os dados enviados estão em um formato inválido. Recarregue a página e tente novamente.' });
  }
  console.error('Erro inesperado:', erro);
  res.status(500).json({ erro: 'Ocorreu um erro inesperado no servidor. Tente novamente em instantes.' });
});

// 10. Liga o servidor na porta definida e avisa no terminal.
const servidor = app.listen(PORTA, () => {
  const configuracao = situacaoConfiguracao();
  console.log('Smart Support AI iniciado.');
  console.log(`Modo da IA: ${MODO_IA}${MODO_IA === 'gemini' ? ` (modelo ${MODELO_GEMINI})` : ''}`);
  if (!configuracao.ok) console.warn(`Aviso de configuração: ${configuracao.mensagem}`);
  console.log(`Acesse: http://localhost:${servidor.address().port}`);
  console.log('Para encerrar, pressione Ctrl + C.');
});

// Exportado só para os testes automáticos poderem desligar o servidor.
module.exports = { app, servidor };
