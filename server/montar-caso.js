// ============================================================
// Smart Support AI - Montagem do bloco <caso>
//
// Transforma os dados do formulário no bloco <caso>...</caso>
// esperado pelos prompts oficiais (Documentação/Prompt_IA_v2.md).
// O formato é o mesmo dos blocos usados nos testes da Fase 2.
//
// Etapa 3.1: este arquivo ainda NÃO é usado pela aplicação.
// ============================================================

// Nomes dos tipos de atendimento, iguais aos da tela (public/index.html).
// Um teste automático confere se as duas listas continuam iguais.
const NOMES_TIPO = {
  'duvida': 'Dúvida',
  'reclamacao': 'Reclamação',
  'solicitacao': 'Solicitação',
  'problema-tecnico': 'Problema técnico',
  'financeiro': 'Financeiro ou cobrança',
  'troca-devolucao': 'Troca ou devolução',
  'cancelamento': 'Cancelamento',
  'outro': 'Outro',
};

// Textos usados quando um campo não foi preenchido (iguais aos da Fase 2).
const VAZIO = {
  tipo: '(não selecionado)',
  identificacao: '(não informada)',
  contexto: '(não informado)',
  solucao: 'Não há solução autorizada para este caso.',
};

// Marcações usadas no bloco. Se aparecerem dentro do texto digitado,
// são neutralizadas para não "fechar" o bloco antes da hora.
const MARCACOES = ['caso', 'tipo_atendimento', 'identificacao', 'historico_contexto', 'solucao_autorizada', 'mensagem_cliente'];
const PADRAO_MARCACAO = new RegExp(`<\\s*(/?)\\s*(${MARCACOES.join('|')})\\b([^<>]*)>`, 'gi');

// Limpa um texto: aceita só texto, padroniza quebras de linha,
// tira espaços das pontas e neutraliza as marcações do bloco.
function limpar(valor) {
  if (typeof valor !== 'string') return '';
  return valor
    .replace(/\r\n?/g, '\n')
    .trim()
    .replace(PADRAO_MARCACAO, (_, barra, nome, resto) => `‹${barra}${nome}${resto}›`);
}

// Monta o bloco <caso> a partir dos dados do caso.
// Recebe: { mensagem, tipo, identificacao, contexto, solucao, descricaoSolucao }
// Devolve: o texto do bloco, pronto para ir depois do Bloco A.
function montarCaso(caso) {
  const dados = caso || {};
  const tipo = NOMES_TIPO[limpar(dados.tipo)] || VAZIO.tipo;
  const identificacao = limpar(dados.identificacao) || VAZIO.identificacao;
  const contexto = limpar(dados.contexto) || VAZIO.contexto;
  const descricao = limpar(dados.descricaoSolucao);
  const solucao = dados.solucao === 'sim' && descricao ? descricao : VAZIO.solucao;
  const mensagem = limpar(dados.mensagem);

  return [
    '<caso>',
    `<tipo_atendimento>${tipo}</tipo_atendimento>`,
    `<identificacao>${identificacao}</identificacao>`,
    `<historico_contexto>${contexto}</historico_contexto>`,
    `<solucao_autorizada>${solucao}</solucao_autorizada>`,
    '<mensagem_cliente>',
    mensagem,
    '</mensagem_cliente>',
    '</caso>',
  ].join('\n');
}

module.exports = { montarCaso, NOMES_TIPO };
