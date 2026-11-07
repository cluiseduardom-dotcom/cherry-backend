const request = require('supertest');

// Cadastro de produto não lança estoque: a entrada é um ato à parte. Este helper faz o ato (Estoque inicial, só admin)
// para os testes que precisam de produto já com saldo.
async function darEstoqueInicial(app, token, produtoId, quantidade, localId) {
    const corpo = { tipo: 'entrada', quantidade, motivo_codigo: 'estoque_inicial' };
    if (localId !== undefined) corpo.local_id = localId;
    const res = await request(app)
        .post(`/produtos/${produtoId}/movimentacoes`)
        .set('Authorization', `Bearer ${token}`)
        .send(corpo);
    if (res.status !== 201 && res.status !== 200) {
        throw new Error(`estoque inicial do produto ${produtoId}: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res;
}

module.exports = { darEstoqueInicial };
