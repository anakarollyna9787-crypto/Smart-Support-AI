// ============================================================
// Smart Support AI - Comportamento da tela
// Etapa 8: análise, resposta, edição, cópia e tratamento de erros.
// No modo simulado, o servidor devolve conteúdos de exemplo.
// ============================================================

// Pega os elementos da página pelo id.
const form = document.getElementById('form-caso');
const mensagem = document.getElementById('mensagem');
const contador = document.getElementById('contador-mensagem');
const blocoSolucao = document.getElementById('bloco-solucao');
const descricaoSolucao = document.getElementById('descricao-solucao');
const erroMensagem = document.getElementById('erro-mensagem');
const erroSolucao = document.getElementById('erro-solucao');
const status = document.getElementById('status');
const seloModo = document.getElementById('selo-modo');
const botaoAnalisar = form.querySelector('button[type="submit"]');
const botaoLimpar = document.getElementById('botao-limpar');
const cartaoAnalise = document.getElementById('cartao-analise');
const avisoSimulado = document.getElementById('aviso-simulado');
const passoCadastro = document.getElementById('passo-cadastro');
const passoAnalise = document.getElementById('passo-analise');
const passoResposta = document.getElementById('passo-resposta');
const botaoGerar = document.getElementById('botao-gerar');
const avisoDesatualizada = document.getElementById('aviso-desatualizada');
const statusResposta = document.getElementById('status-resposta');
const cartaoResposta = document.getElementById('cartao-resposta');
const textoResposta = document.getElementById('texto-resposta');
const avisoSimuladoResposta = document.getElementById('aviso-simulado-resposta');
const botaoCopiar = document.getElementById('botao-copiar');
const confirmacaoCopia = document.getElementById('confirmacao-copia');
const dialogoDescartar = document.getElementById('dialogo-descartar');
const colunaPrincipal = document.querySelector('.coluna-principal');

// Configurações do tratamento de erros.
const TEMPO_LIMITE_MS = 35000;  // desiste depois de 35 segundos sem resposta (a API desiste em 25 s)
const AVISO_DEMORA_MS = 8000;   // avisa que está demorando depois de 8 segundos
const LIMITE_MENSAGEM = Number(mensagem.getAttribute('maxlength')) || 5000;

const MSG_SEM_CONEXAO = 'Não foi possível falar com o servidor. Confira se ele está ligado (npm start) e tente de novo.';
const MSG_TEMPO_ESGOTADO = 'O servidor demorou demais para responder. Tente novamente em instantes.';
const MSG_RESPOSTA_INVALIDA = 'O servidor enviou uma resposta inesperada. Tente novamente.';

// Estado atual. Fica só na memória desta página:
// nada é salvo, e tudo some ao recarregar (regra de privacidade).
let casoAnalisado = null;   // dados do caso usados na última análise
let analiseAtual = null;    // última análise recebida
let textoGerado = '';       // texto original da última resposta gerada
let processando = false;    // true enquanto espera o servidor

// ------------------------------------------------------------
// Funções de apoio
// ------------------------------------------------------------

// Mostra um aviso num parágrafo de status (informação ou erro).
function mostrarAviso(elemento, textoAviso, ehErro) {
  elemento.textContent = textoAviso;
  elemento.classList.toggle('status-erro', Boolean(ehErro));
  elemento.hidden = false;
}

function mostrarErro(campo, elementoErro) {
  campo.classList.add('campo-invalido');
  elementoErro.hidden = false;
}
function esconderErro(campo, elementoErro) {
  campo.classList.remove('campo-invalido');
  elementoErro.hidden = true;
}

// Atualiza o fluxo na lateral: passos anteriores ganham ✓, o atual fica em destaque.
function marcarPasso(etapa) {
  const ordem = ['cadastro', 'analise', 'resposta'];
  const posicao = ordem.indexOf(etapa);
  [passoCadastro, passoAnalise, passoResposta].forEach((passo, i) => {
    passo.classList.toggle('feito', i < posicao);
    passo.classList.toggle('atual', i === posicao);
  });
}

// Rola a tela até um cartão (sem animação para quem prefere menos movimento).
function rolarAte(elemento) {
  const semAnimacao = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  elemento.scrollIntoView({ behavior: semAnimacao ? 'auto' : 'smooth', block: 'start' });
}

// Junta os dados atuais do formulário num objeto.
function lerFormulario() {
  const temSolucao = !blocoSolucao.hidden;
  return {
    mensagem: mensagem.value,
    tipo: document.getElementById('tipo').value,
    identificacao: document.getElementById('identificacao').value,
    contexto: document.getElementById('contexto').value,
    solucao: temSolucao ? 'sim' : 'nao',
    descricaoSolucao: temSolucao ? descricaoSolucao.value : '',
  };
}

// O "Gerar resposta" só fica liberado quando há análise atualizada
// e nenhuma outra ação está em andamento.
function atualizarBotaoGerar() {
  botaoGerar.disabled = processando || !analiseAtual || !avisoDesatualizada.hidden;
}

// Liga ou desliga o estado "processando".
// Enquanto processa, bloqueia os botões para evitar cliques repetidos.
function definirProcessando(ativo, botao, textoCarregando, textoNormal) {
  processando = ativo;
  botaoAnalisar.disabled = ativo;
  botaoLimpar.disabled = ativo;
  atualizarBotaoGerar();
  botao.classList.toggle('carregando', ativo);
  botao.textContent = ativo ? textoCarregando : textoNormal;
  colunaPrincipal.setAttribute('aria-busy', ativo ? 'true' : 'false');
}

// Mensagem amigável conforme o código de erro do servidor.
function mensagemPorCodigo(codigo) {
  if (codigo === 413) return 'Os textos enviados são grandes demais. Reduza o conteúdo e tente novamente.';
  if (codigo === 404) return 'O servidor não reconheceu o pedido. Reinicie o servidor (npm start) e recarregue a página.';
  if (codigo >= 500) return 'O servidor encontrou um problema. Tente novamente em instantes.';
  return 'Não foi possível concluir o pedido. Tente novamente.';
}

// Envia dados ao servidor e devolve a resposta já convertida.
// Em caso de problema, lança um erro com uma mensagem clara para a tela.
async function chamarServidor(rota, corpo, elementoAviso) {
  const controle = new AbortController();
  const limite = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
  const avisoDemora = setTimeout(() => {
    mostrarAviso(elementoAviso, 'Ainda processando. Isso pode levar alguns segundos…', false);
  }, AVISO_DEMORA_MS);

  try {
    let resposta;
    try {
      resposta = await fetch(rota, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
        signal: controle.signal,
      });
    } catch (falha) {
      throw new Error(falha.name === 'AbortError' ? MSG_TEMPO_ESGOTADO : MSG_SEM_CONEXAO);
    }

    let dados = null;
    try {
      dados = await resposta.json();
    } catch (falha) {
      if (falha.name === 'AbortError') throw new Error(MSG_TEMPO_ESGOTADO);
      dados = null; // resposta não veio em JSON
    }

    if (!resposta.ok) {
      throw new Error((dados && typeof dados.erro === 'string' && dados.erro) || mensagemPorCodigo(resposta.status));
    }
    if (!dados) throw new Error(MSG_RESPOSTA_INVALIDA);
    return dados;
  } finally {
    clearTimeout(limite);
    clearTimeout(avisoDemora);
    elementoAviso.hidden = true;
  }
}

// Confere se a análise recebida tem o formato esperado.
function analiseValida(a) {
  const ehLista = (x) => Array.isArray(x) && x.every((item) => typeof item === 'string');
  return a && typeof a.problema === 'string' && typeof a.necessidade === 'string'
    && ehLista(a.informacoesIdentificadas) && ehLista(a.informacoesPendentes)
    && ehLista(a.contradicoes) && typeof a.proximoPasso === 'string';
}

// ------------------------------------------------------------
// 1. Contador de caracteres da mensagem do cliente
// ------------------------------------------------------------
function atualizarContador() {
  const total = mensagem.value.length;
  contador.textContent = `${total.toLocaleString('pt-BR')} / ${LIMITE_MENSAGEM.toLocaleString('pt-BR')} caracteres`;
}
mensagem.addEventListener('input', () => {
  atualizarContador();
  if (mensagem.value.trim()) esconderErro(mensagem, erroMensagem);
});

// ------------------------------------------------------------
// 2. Campo "Descreva a solução": só aparece quando a opção é "Sim"
// ------------------------------------------------------------
function atualizarCampoSolucao() {
  const escolhida = form.querySelector('input[name="solucao"]:checked');
  const temSolucao = escolhida && escolhida.value === 'sim';
  blocoSolucao.hidden = !temSolucao;
  if (!temSolucao) esconderErro(descricaoSolucao, erroSolucao);
}
form.querySelectorAll('input[name="solucao"]').forEach((opcao) => {
  opcao.addEventListener('change', atualizarCampoSolucao);
});
descricaoSolucao.addEventListener('input', () => {
  if (descricaoSolucao.value.trim()) esconderErro(descricaoSolucao, erroSolucao);
});

// ------------------------------------------------------------
// 3. Exibir a análise
// ------------------------------------------------------------

// Preenche uma lista (<ul>). Usa textContent: texto puro, nunca código.
function preencherLista(idLista, itens, textoVazio) {
  const lista = document.getElementById(idLista);
  lista.replaceChildren();
  if (!itens || itens.length === 0) {
    const li = document.createElement('li');
    li.className = 'vazio';
    li.textContent = textoVazio;
    lista.append(li);
    return;
  }
  itens.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = item;
    lista.append(li);
  });
}

// Mostra a contagem ao lado do título (vazio quando é zero).
function preencherContagem(idContagem, itens) {
  const total = itens ? itens.length : 0;
  document.getElementById(idContagem).textContent = total > 0 ? String(total) : '';
}

function exibirAnalise(analise, caso) {
  casoAnalisado = caso;
  analiseAtual = analise;
  document.getElementById('a-problema').textContent = analise.problema;
  document.getElementById('a-necessidade').textContent = analise.necessidade;
  preencherLista('a-identificadas', analise.informacoesIdentificadas, 'Nenhuma informação identificada.');
  preencherLista('a-pendentes', analise.informacoesPendentes, 'Nenhuma informação pendente.');
  // No modo simulado não há leitura real da mensagem: a lista vazia NÃO
  // significa "sem contradições", e sim "verificação indisponível".
  const contradicoesIndisponiveis = analise.simulado && analise.contradicoes.length === 0;
  preencherLista('a-contradicoes', analise.contradicoes, contradicoesIndisponiveis
    ? 'Verificação de contradições indisponível no modo simulado.'
    : 'Nenhuma contradição encontrada.');
  if (contradicoesIndisponiveis) {
    document.querySelector('#a-contradicoes .vazio').classList.add('indisponivel');
  }
  document.getElementById('ajuda-contradicoes').hidden = !contradicoesIndisponiveis;
  preencherContagem('c-pendentes', analise.informacoesPendentes);
  preencherContagem('c-contradicoes', analise.contradicoes);
  document.getElementById('a-proximo').textContent = analise.proximoPasso;
  avisoSimulado.hidden = !analise.simulado;

  // Nova análise: descarta uma resposta antiga, se houver.
  avisoDesatualizada.hidden = true;
  statusResposta.hidden = true;
  limparResposta();

  // Se o atendente mudou o formulário enquanto a análise era feita,
  // a análise já chega marcada como desatualizada.
  if (JSON.stringify(lerFormulario()) !== JSON.stringify(caso)) {
    avisoDesatualizada.hidden = false;
  }

  cartaoAnalise.hidden = false;
  marcarPasso('analise');
}

function limparResposta() {
  cartaoResposta.hidden = true;
  textoResposta.value = '';
  textoGerado = '';
  confirmacaoCopia.hidden = true;
}

// Esconde análise e resposta e volta o fluxo ao passo 1.
function limparAnalise() {
  casoAnalisado = null;
  analiseAtual = null;
  cartaoAnalise.hidden = true;
  limparResposta();
  marcarPasso('cadastro');
}

// Se o formulário mudar depois da análise, bloqueia a geração da resposta
// até que o caso seja analisado de novo.
function marcarAnaliseDesatualizada() {
  if (!analiseAtual) return;
  avisoDesatualizada.hidden = false;
  atualizarBotaoGerar();
}
form.addEventListener('input', marcarAnaliseDesatualizada);
form.addEventListener('change', marcarAnaliseDesatualizada);

// ------------------------------------------------------------
// 4. Botão "Analisar caso"
// ------------------------------------------------------------
form.addEventListener('submit', async (evento) => {
  evento.preventDefault(); // impede a página de recarregar
  if (processando) return;  // proteção contra cliques repetidos
  status.hidden = true;

  let valido = true;
  if (!mensagem.value.trim()) {
    mostrarErro(mensagem, erroMensagem);
    valido = false;
  }
  if (!blocoSolucao.hidden && !descricaoSolucao.value.trim()) {
    mostrarErro(descricaoSolucao, erroSolucao);
    valido = false;
  }
  if (!valido) {
    form.querySelector('.campo-invalido').focus();
    return;
  }

  // Existe uma resposta editada? Pergunta antes de analisar de novo.
  if (respostaFoiEditada()) {
    const continuar = await confirmarDescarte('analisar');
    if (!continuar) {
      textoResposta.focus(); // volta para o texto, que continua intacto
      return;
    }
    if (processando) return;
  }

  const caso = lerFormulario();
  definirProcessando(true, botaoAnalisar, 'Analisando…', 'Analisar caso');
  let sucesso = false;
  try {
    const analise = await chamarServidor('/api/analisar', caso, status);
    if (!analiseValida(analise)) throw new Error(MSG_RESPOSTA_INVALIDA);
    exibirAnalise(analise, caso);
    sucesso = true;
  } catch (falha) {
    mostrarAviso(status, falha.message, true);
  } finally {
    definirProcessando(false, botaoAnalisar, 'Analisando…', 'Analisar caso');
  }
  if (sucesso) rolarAte(cartaoAnalise);
});

// ------------------------------------------------------------
// 5. Botão "Gerar resposta" (nunca é automático, só por este clique)
// ------------------------------------------------------------

// A resposta foi editada? (texto diferente do gerado e não vazio)
function respostaFoiEditada() {
  return !cartaoResposta.hidden
    && textoResposta.value.trim() !== ''
    && textoResposta.value !== textoGerado;
}

// Textos da janela de confirmação para cada situação em que uma
// resposta editada seria descartada.
const CONFIRMACOES = {
  gerar: {
    titulo: 'Gerar nova resposta?',
    texto: 'Você editou a resposta. Gerar uma nova vai descartar suas alterações. Deseja continuar?',
    botao: 'Gerar nova resposta',
  },
  analisar: {
    titulo: 'Analisar o caso novamente?',
    texto: 'Você editou a resposta. Uma nova análise poderá descartar a resposta editada. Deseja continuar?',
    botao: 'Continuar',
  },
  limpar: {
    titulo: 'Limpar os campos?',
    texto: 'Você editou a resposta. Limpar os campos vai descartar o caso, a análise e a resposta editada. Deseja continuar?',
    botao: 'Limpar campos',
  },
};

// Abre a janela de confirmação e espera a escolha do atendente.
// Devolve true para o botão de confirmar e false para "Cancelar" (ou Esc).
// A escolha é lida no próprio clique, sem depender do evento de fechamento.
const botaoDialogoConfirmar = document.getElementById('dialogo-confirmar');
const botaoDialogoCancelar = document.getElementById('dialogo-cancelar');

function confirmarDescarte(situacao) {
  const textos = CONFIRMACOES[situacao];
  document.getElementById('dialogo-titulo').textContent = textos.titulo;
  document.getElementById('dialogo-texto').textContent = textos.texto;
  botaoDialogoConfirmar.textContent = textos.botao;

  return new Promise((resolver) => {
    function terminar(escolha) {
      botaoDialogoConfirmar.removeEventListener('click', aoConfirmar);
      botaoDialogoCancelar.removeEventListener('click', aoCancelar);
      dialogoDescartar.removeEventListener('cancel', aoCancelar);
      dialogoDescartar.removeEventListener('close', aoFecharDeOutroJeito);
      if (dialogoDescartar.open) dialogoDescartar.close();
      resolver(escolha);
    }
    function aoConfirmar() { terminar(true); }
    function aoCancelar(evento) { evento.preventDefault(); terminar(false); } // botão Cancelar ou tecla Esc
    function aoFecharDeOutroJeito() { terminar(false); }                       // reserva: sempre conta como Cancelar

    botaoDialogoConfirmar.addEventListener('click', aoConfirmar);
    botaoDialogoCancelar.addEventListener('click', aoCancelar);
    dialogoDescartar.addEventListener('cancel', aoCancelar);
    dialogoDescartar.addEventListener('close', aoFecharDeOutroJeito);
    dialogoDescartar.showModal();
  });
}

botaoGerar.addEventListener('click', async () => {
  if (processando || !analiseAtual || !avisoDesatualizada.hidden) return;

  if (respostaFoiEditada()) {
    const continuar = await confirmarDescarte('gerar');
    if (!continuar) {
      textoResposta.focus(); // volta para o texto, que continua intacto
      return;
    }
    if (processando || !analiseAtual || !avisoDesatualizada.hidden) return;
  }

  statusResposta.hidden = true;
  definirProcessando(true, botaoGerar, 'Gerando resposta…', 'Gerar resposta');
  let sucesso = false;
  try {
    const dados = await chamarServidor('/api/gerar-resposta', { caso: casoAnalisado, analise: analiseAtual }, statusResposta);
    if (!dados || typeof dados.texto !== 'string' || !dados.texto.trim()) throw new Error(MSG_RESPOSTA_INVALIDA);
    textoResposta.value = dados.texto;
    textoGerado = dados.texto;
    confirmacaoCopia.hidden = true;
    avisoSimuladoResposta.hidden = !dados.simulado;
    cartaoResposta.hidden = false;
    marcarPasso('resposta');
    sucesso = true;
  } catch (falha) {
    // Em caso de erro, uma resposta anterior (editada ou não) é mantida.
    mostrarAviso(statusResposta, falha.message, true);
  } finally {
    definirProcessando(false, botaoGerar, 'Gerando resposta…', 'Gerar resposta');
  }
  if (sucesso) rolarAte(cartaoResposta);
});

// ------------------------------------------------------------
// 6. Copiar a resposta (RF10), incluindo as edições (RF09)
// ------------------------------------------------------------
let temporizadorCopia = null;
function mostrarConfirmacao(textoConfirmacao, ehAlerta) {
  confirmacaoCopia.textContent = textoConfirmacao;
  confirmacaoCopia.classList.toggle('confirmacao-alerta', Boolean(ehAlerta));
  confirmacaoCopia.hidden = false;
  clearTimeout(temporizadorCopia);
  if (!ehAlerta) {
    temporizadorCopia = setTimeout(() => { confirmacaoCopia.hidden = true; }, 3000);
  }
}

botaoCopiar.addEventListener('click', async () => {
  const textoFinal = textoResposta.value;
  if (!textoFinal.trim()) {
    mostrarConfirmacao('Não há texto para copiar.', true);
    return;
  }

  try {
    // Forma moderna de copiar.
    await navigator.clipboard.writeText(textoFinal);
    mostrarConfirmacao('Resposta copiada.');
  } catch (falha) {
    // Plano B: seleciona o texto e tenta o método antigo de cópia.
    textoResposta.focus();
    textoResposta.select();
    let copiou = false;
    try { copiou = document.execCommand('copy'); } catch (e) { copiou = false; }
    if (copiou) {
      mostrarConfirmacao('Resposta copiada.');
    } else {
      mostrarConfirmacao('O navegador bloqueou a cópia. O texto está selecionado: pressione Ctrl + C.', true);
    }
  }
});

// Ao editar o texto, esconde a confirmação antiga.
textoResposta.addEventListener('input', () => { confirmacaoCopia.hidden = true; });

// ------------------------------------------------------------
// 7. Botão "Limpar campos": volta tudo ao estado inicial
// ------------------------------------------------------------
let limpezaConfirmada = false;

form.addEventListener('reset', async (evento) => {
  if (processando) {        // proteção: não limpa no meio de um pedido
    evento.preventDefault();
    return;
  }

  // Existe uma resposta editada? Pergunta antes de limpar.
  if (!limpezaConfirmada && respostaFoiEditada()) {
    evento.preventDefault(); // segura a limpeza até a resposta
    const continuar = await confirmarDescarte('limpar');
    if (!continuar) {
      textoResposta.focus();
      return;
    }
    if (processando) return;
    limpezaConfirmada = true;
    form.reset();            // agora limpa de verdade (passa por aqui de novo)
    return;
  }
  limpezaConfirmada = false;

  setTimeout(() => {
    atualizarContador();
    atualizarCampoSolucao();
    esconderErro(mensagem, erroMensagem);
    status.hidden = true;
    statusResposta.hidden = true;
    limparAnalise();
  }, 0);
});

// Recarregar ou fechar a aba com uma resposta editada: o navegador
// mostra o aviso padrão dele ("Sair do site?"), que não pode ser personalizado.
window.addEventListener('beforeunload', (evento) => {
  if (respostaFoiEditada()) {
    evento.preventDefault();
    evento.returnValue = ''; // necessário em alguns navegadores
  }
});

// ------------------------------------------------------------
// 8. Mostra no topo o modo atual, informado pelo servidor,
//    e avisa se a configuração do servidor estiver incompleta.
// ------------------------------------------------------------
const NOMES_MODO = { simulado: 'Modo simulado', gemini: 'Modo Gemini' };
fetch('/api/status')
  .then((resposta) => resposta.json())
  .then((dados) => {
    seloModo.textContent = NOMES_MODO[dados.modoIA] || 'Modo desconhecido';
    if (dados.configuracaoOk === false) {
      seloModo.textContent += ' · configuração incompleta';
      if (typeof dados.erroConfiguracao === 'string') mostrarAviso(status, dados.erroConfiguracao, true);
    }
  })
  .catch(() => { /* se falhar, mantém o texto padrão */ });

// Estado inicial ao abrir a página.
atualizarContador();
atualizarCampoSolucao();
