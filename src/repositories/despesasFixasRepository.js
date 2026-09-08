const db = require('../config/db');

// pg devolve coluna DATE como Date (meia-noite local — mesma armadilha de
// fuso já documentada em contas_pagar/vendasRepository, só que do lado da
// leitura). Convertido de volta pra string 'YYYY-MM-DD' com getters LOCAIS
// (nunca toISOString) antes de sair do repository: tanto o frontend
// (input type="date") quanto ratearCustoFixo (src/utils/rateioCustoFixo.js)
// esperam string, não Date.
function paraDataString(data) {
    if (!data) return null;
    const ano = data.getFullYear();
    const mes = String(data.getMonth() + 1).padStart(2, '0');
    const dia = String(data.getDate()).padStart(2, '0');
    return `${ano}-${mes}-${dia}`;
}

function normalizarVigencia(despesa) {
    if (!despesa) return despesa;
    return {
        ...despesa,
        vigencia_inicio: paraDataString(despesa.vigencia_inicio),
        vigencia_fim: paraDataString(despesa.vigencia_fim)
    };
}

// A listagem filtra só deletado_em IS NULL (não ativo = true): precisa
// mostrar despesas desligadas pelo toggle também, senão a tela de gestão
// não teria como reativá-las.
async function listar(empresa_id) {
    const { rows } = await db.query(
        `SELECT * FROM despesas_fixas
         WHERE empresa_id = $1 AND deletado_em IS NULL
         ORDER BY categoria ASC, descricao ASC`,
        [empresa_id]
    );
    return rows.map(normalizarVigencia);
}

async function criar({ categoria, descricao, valor, vigencia_inicio, vigencia_fim, empresa_id }) {
    const { rows } = await db.query(
        `INSERT INTO despesas_fixas (categoria, descricao, valor, vigencia_inicio, vigencia_fim, empresa_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [categoria, descricao, valor, vigencia_inicio, vigencia_fim ?? null, empresa_id]
    );
    return normalizarVigencia(rows[0]);
}

// UPDATE ... RETURNING é atômico numa única query: dispensa a transação com
// FOR UPDATE usada em contas_pagar, porque aqui não há máquina de estados
// (status pendente/pago) com uma janela de corrida a proteger — só um campo
// sendo sobrescrito de uma vez.
async function atualizar(id, dados, empresa_id) {
    const campos = ['categoria', 'descricao', 'valor', 'vigencia_inicio', 'vigencia_fim'];
    const sets = ['atualizado_em = NOW()'];
    const valores = [];
    let i = 1;

    for (const campo of campos) {
        if (dados[campo] !== undefined) {
            sets.push(`${campo} = $${i}`);
            valores.push(dados[campo]);
            i++;
        }
    }

    valores.push(id, empresa_id);

    const { rows } = await db.query(
        `UPDATE despesas_fixas SET ${sets.join(', ')}
         WHERE id = $${i} AND empresa_id = $${i + 1} AND deletado_em IS NULL
         RETURNING *`,
        valores
    );

    return rows.length ? normalizarVigencia(rows[0]) : null;
}

async function deletar(id, empresa_id) {
    const { rows } = await db.query(
        `UPDATE despesas_fixas SET deletado_em = NOW(), atualizado_em = NOW()
         WHERE id = $1 AND empresa_id = $2 AND deletado_em IS NULL
         RETURNING *`,
        [id, empresa_id]
    );
    return rows.length ? normalizarVigencia(rows[0]) : null;
}

async function alternarAtivo(id, empresa_id) {
    const { rows } = await db.query(
        `UPDATE despesas_fixas SET ativo = NOT ativo, atualizado_em = NOW()
         WHERE id = $1 AND empresa_id = $2 AND deletado_em IS NULL
         RETURNING *`,
        [id, empresa_id]
    );
    return rows.length ? normalizarVigencia(rows[0]) : null;
}

// Substitui somarAtivas: soma mensal cheia comparava qualquer período
// (7 dias ou 3 meses) contra um mês inteiro de custo fixo — PE mentiroso
// nos dois sentidos. Devolve as despesas vigentes no período (não a soma:
// o rateio dia-a-dia é responsabilidade de ratearCustoFixo, em
// src/utils/rateioCustoFixo.js) pra quem chama poder distinguir "zero
// despesas encontradas" (semDespesasFixas) de "soma deu zero".
//
// ativo = true é checado primeiro, sempre — é a pausa de exceção manual:
// nunca conta enquanto desligado, independente de vigência cobrir o
// período. vigencia_inicio/vigencia_fim são a fonte de verdade cronológica
// pra quem está ligado.
async function listarVigentesNoPeriodo(empresaId, dataInicio, dataFim) {
    const { rows } = await db.query(
        `SELECT valor, vigencia_inicio, vigencia_fim FROM despesas_fixas
         WHERE empresa_id = $1 AND ativo = true AND deletado_em IS NULL
           AND vigencia_inicio <= $3
           AND (vigencia_fim IS NULL OR vigencia_fim >= $2)`,
        [empresaId, dataInicio, dataFim]
    );
    return rows.map(normalizarVigencia);
}

module.exports = {
    listar,
    criar,
    atualizar,
    deletar,
    alternarAtivo,
    listarVigentesNoPeriodo
};
