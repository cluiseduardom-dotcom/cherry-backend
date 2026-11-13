const db = require('../config/db');
const { executarComLock } = require('./shared/transacoes');

// Seção comercial da Home da loja online (presentes por faixa de preço, últimas unidades, ajuda por WhatsApp).
// Mesma tabela do texto institucional (loja_institucional), mas repositório PRÓPRIO: se esta parte falhar (ex.: migration 106
// ainda não aplicada), o texto institucional e o rodapé do site continuam funcionando. Sempre filtra por empresa_id.
const CAMPOS = ['home_vendas_ativo', 'home_presentes_titulo', 'home_presentes_texto', 'home_ultimas_titulo', 'home_ultimas_texto',
    'home_ajuda_titulo', 'home_ajuda_texto'];

const PADRAO = Object.freeze({ home_vendas_ativo: false, home_presentes_titulo: null, home_presentes_texto: null,
    home_ultimas_titulo: null, home_ultimas_texto: null, home_ajuda_titulo: null, home_ajuda_texto: null });

async function buscar(empresa_id) {
    const { rows } = await db.query(`SELECT ${CAMPOS.join(', ')} FROM loja_institucional WHERE empresa_id = $1`, [empresa_id]);

    return rows[0] ? { ...rows[0] } : { ...PADRAO };
}

// Grava só os campos enviados (os ausentes ficam como estão; `null` limpa), com a linha da empresa travada.
async function salvar(empresa_id, dados) {
    // Garante a linha (vazia). O lock e a escrita acontecem dentro de executarComLock.
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

// Leitura pública: só devolve algo se a seção estiver LIGADA no ERP; senão null (a Home segue como sempre).
async function buscarPublico(empresa_id) {
    const dados = await buscar(empresa_id);

    return dados.home_vendas_ativo === true ? dados : null;
}

module.exports = { buscar, salvar, buscarPublico, CAMPOS };
