// ============================================================
// Smart Support AI - Os 5 casos fictícios, no formato do formulário
//
// Mesmos dados de Documentação/Casos_de_Teste_Fase2.md.
// Os valores de "tipo" são os da tela (ex.: 'reclamacao').
// Todos os dados são inventados.
// ============================================================

const CASOS_FICTICIOS = [
  {
    nome: 'Caso 1 - Entrega atrasada',
    tipo: 'reclamacao',
    identificacao: '',
    contexto: '',
    solucao: 'nao',
    descricaoSolucao: '',
    mensagem: 'Boa tarde. Fiz um pedido no dia 3 e até agora não chegou. Na confirmação dizia entrega em 5 dias úteis. Paguei no cartão de crédito e o valor já saiu da minha conta, mas no e-mail aparece que o boleto ainda está pendente. Quero uma resposta ainda hoje.',
  },
  {
    nome: 'Caso 2 - Troca de tamanho',
    tipo: 'troca-devolucao',
    identificacao: 'CASO-T002',
    contexto: 'Primeiro contato do cliente sobre este pedido.',
    solucao: 'sim',
    descricaoSolucao: 'Troca gratuita por outro tamanho, com envio da etiqueta de devolução por e-mail em até 2 dias úteis.',
    mensagem: 'Olá! Recebi a camiseta, mas o tamanho M ficou pequeno. Gostaria de trocar pelo G. Como faço?',
  },
  {
    nome: 'Caso 3 - Cobrança em dobro',
    tipo: 'financeiro',
    identificacao: 'CASO-F003',
    contexto: 'Cliente já entrou em contato duas vezes pelo chat sobre o mesmo assunto.',
    solucao: 'nao',
    descricaoSolucao: '',
    mensagem: 'Fui cobrado duas vezes na fatura deste mês pela mesma assinatura. Isso é um absurdo! Exijo o estorno imediato do valor ou vou procurar meus direitos.',
  },
  {
    nome: 'Caso 4 - Dúvida sem tipo',
    tipo: '',
    identificacao: '',
    contexto: '',
    solucao: 'nao',
    descricaoSolucao: '',
    mensagem: 'Vocês entregam aos sábados?',
  },
  {
    nome: 'Caso 5 - Aplicativo não abre',
    tipo: 'problema-tecnico',
    identificacao: 'CASO-P005',
    contexto: 'Cliente informou que usa celular Android e que já reinstalou o aplicativo.',
    solucao: 'nao',
    descricaoSolucao: '',
    mensagem: 'O aplicativo de vocês nunca funcionou desde que instalei. Até ontem estava funcionando normalmente, mas hoje fecha sozinho assim que abro.',
  },
];

module.exports = { CASOS_FICTICIOS };
