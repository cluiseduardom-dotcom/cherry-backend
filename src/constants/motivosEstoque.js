// Motivos aceitos na movimentação AVULSA de estoque (POST /produtos/:id/movimentacoes).
// Entrada normal de mercadoria não passa por aqui: vem de Compra ou Recebimento (documento).
// A entrada avulsa existe só para duas exceções, ambas controladas por permissão.
const MOTIVOS_ESTOQUE = Object.freeze({
    entrada: Object.freeze({
        estoque_inicial: { rotulo: 'Estoque inicial', observacao_obrigatoria: false },
        recebimento_sem_compra: { rotulo: 'Recebimento sem compra', observacao_obrigatoria: true }
    }),
    saida: Object.freeze({
        perda: { rotulo: 'Perda', observacao_obrigatoria: false },
        avaria: { rotulo: 'Avaria', observacao_obrigatoria: false },
        brinde: { rotulo: 'Brinde', observacao_obrigatoria: false },
        uso_interno: { rotulo: 'Uso interno', observacao_obrigatoria: false },
        outro: { rotulo: 'Outro', observacao_obrigatoria: true }
    }),
    ajuste: Object.freeze({
        contagem: { rotulo: 'Contagem de estoque', observacao_obrigatoria: false },
        correcao: { rotulo: 'Correção de lançamento', observacao_obrigatoria: true }
    })
});

module.exports = { MOTIVOS_ESTOQUE };
