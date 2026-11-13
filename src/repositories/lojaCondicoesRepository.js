const db = require('../config/db');
const { executarComLock } = require('./shared/transacoes');

// Condições de venda da loja online (frete grátis acima de um valor, garantia, embalagem de presente).
// Mesma tabela do institucional (loja_institucional), repositório PRÓPRIO: se a migration 107 faltar, o institucional segue
// funcionando. Sempre filtra por empresa_id.
const CAMPOS = ['frete_gratis_acima', 'garantia_texto', 'embalagem_presente_texto'];
const PADRAO = Object.freeze({ frete_gratis_acima: null, garantia_texto: null, embalagem_presente_texto: null });

const normalizar = (linha) => ({ ...linha, frete_gratis_acima: linha.frete_gratis_acima === null ? null : Number(linha.frete_gratis_acima) });

async function buscar(empresa_id) {
    const { rows } = await db.query(`SELECT ${CAMPOS.join(', ')} FROM loja_institucional WHERE empresa_id = $1`, [empresa_id]);

    return rows[0] ? normalizar(rows[0]) : { ...PADRAO };
}

// Grava só os campos enviados (os ausentes ficam como estão; `null` limpa), com a linha da empresa travada.
async function salvar(empresa_id, dados) {
    await db.query('INSERT INTO loja_institucional (empresa_id) VALUES ($1) ON CONFLICT (empresa_id) DO NOTHING', [empresa_id]);

    await executarComLock('loja_institucional', { coluna: 'empresa_id', valor: empresa_id }, empresa_id, undefined, async (linha, client) => {
        const final = { ...linha, ...Object.fromEntries(CAMPOS.filter((c) => c in dados).map((c) => [c, dados[c]])) };

        await client.query(
            `UPDATE loja_institucional SET ${CAMPOS.map((c, i) => `${c} = $${i + 2}`).join(', ')}, atualizado_em = NOW()
              WHERE empresa_id = $1`,
            [empresa_id, ...CAMPOS.map((c) => final[c])]
        );
    });

    return buscar(empresa_id);
}

// Dentro da transação do pedido: o valor mínimo vigente (em centavos) ou null. O servidor decide; o navegador nunca.
async function freteGratisAcimaEmCentavos(client, empresa_id) {
    const { rows } = await client.query('SELECT frete_gratis_acima FROM loja_institucional WHERE empresa_id = $1', [empresa_id]);

    return rows[0] && rows[0].frete_gratis_acima !== null ? Math.round(Number(rows[0].frete_gratis_acima) * 100) : null;
}

module.exports = { buscar, salvar, freteGratisAcimaEmCentavos, CAMPOS };
