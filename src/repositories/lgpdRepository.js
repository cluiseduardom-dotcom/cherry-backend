const db = require('../config/db');
const { executarComLock } = require('./shared/transacoes');
const { RETENCAO, ANONIMIZADO } = require('../constants/lgpd');

// Anonimização de dados pessoais (LGPD). Regras: sempre filtra por empresa_id; nunca apaga histórico financeiro nem
// trilha (só troca o dado pessoal por marcador); `executar = false` é simulação e não escreve nada; idempotente.
// Nunca devolve dado pessoal: só ids/códigos e o resultado.

// ---- Pedido da loja online (nome, e-mail e telefone do comprador) ----

async function anonimizarPedidoLoja({ empresa_id, codigo, executar, motivo }) {
    return executarComLock('pedidos_loja', { coluna: 'codigo', valor: codigo }, empresa_id, undefined, async (pedido, client) => {
        if (!pedido) return { resultado: 'nao_encontrado' };
        if (pedido.cliente_email === ANONIMIZADO.EMAIL) return { resultado: 'ja_anonimizado', pedido_id: pedido.id };
        if (pedido.status === 'aguardando_pagamento') return { resultado: 'recusado', motivo: 'pedido aguardando pagamento', pedido_id: pedido.id };
        if (pedido.status === 'pago' && !pedido.entrega_combinada_em) return { resultado: 'recusado', motivo: 'pedido pago com entrega ainda não combinada', pedido_id: pedido.id };

        if (!executar) return { resultado: 'seria_anonimizado', pedido_id: pedido.id };

        await client.query(
            `UPDATE pedidos_loja SET cliente_nome = $3, cliente_email = $4, cliente_telefone = NULL WHERE id = $1 AND empresa_id = $2`,
            [pedido.id, empresa_id, ANONIMIZADO.NOME, ANONIMIZADO.EMAIL]
        );
        await client.query(
            `INSERT INTO pedidos_loja_eventos (empresa_id, pedido_id, tipo, status_anterior, status_novo, detalhes)
             VALUES ($1, $2, 'dados_anonimizados', $3, $3, $4)`,
            [empresa_id, pedido.id, pedido.status, JSON.stringify({ motivo })]
        );

        return { resultado: 'anonimizado', pedido_id: pedido.id };
    });
}

// Códigos de pedidos que passaram do prazo de retenção e ainda não foram anonimizados.
async function listarPedidosLojaVencidos(empresa_id) {
    const { rows } = await db.query(
        `SELECT codigo FROM pedidos_loja
          WHERE empresa_id = $1 AND cliente_email <> $2
            AND ((status = 'pago' AND pago_em < NOW() - make_interval(years => $3))
              OR (status IN ('cancelado', 'expirado') AND encerrado_em < NOW() - make_interval(days => $4)))
          ORDER BY id`,
        [empresa_id, ANONIMIZADO.EMAIL, RETENCAO.PEDIDO_PAGO_ANOS, RETENCAO.PEDIDO_NAO_PAGO_DIAS]
    );

    return rows.map((r) => r.codigo);
}

// ---- Colaborador bloqueado (dados cadastrais e foto) ----

async function anonimizarColaborador({ empresa_id, usuario_id, executar, executado_por, motivo }) {
    return executarComLock('usuarios', { coluna: 'id', valor: usuario_id }, empresa_id, undefined, async (usuario, client) => {
        if (!usuario) return { resultado: 'nao_encontrado' };
        if (usuario.ativo) return { resultado: 'recusado', motivo: 'o colaborador está ativo: bloqueie-o antes' };

        const { rows: dados } = await client.query(
            `SELECT telefone, cpf, data_nascimento, cep, logradouro, numero, complemento, bairro, cidade, uf, data_admissao, observacoes
               FROM usuarios_dados WHERE usuario_id = $1 AND empresa_id = $2`,
            [usuario_id, empresa_id]
        );
        const temDado = dados.length > 0 && Object.values(dados[0]).some((v) => v !== null);
        const { rows: foto } = await client.query(`SELECT chave FROM usuarios_fotos WHERE usuario_id = $1 AND empresa_id = $2`, [usuario_id, empresa_id]);

        if (!temDado && foto.length === 0) return { resultado: 'ja_anonimizado', usuario_id };
        if (!executar) return { resultado: 'seria_anonimizado', usuario_id };

        await client.query(
            `UPDATE usuarios_dados SET telefone = NULL, cpf = NULL, data_nascimento = NULL, cep = NULL, logradouro = NULL, numero = NULL,
                    complemento = NULL, bairro = NULL, cidade = NULL, uf = NULL, data_admissao = NULL, observacoes = NULL, atualizado_em = NOW()
              WHERE usuario_id = $1 AND empresa_id = $2`,
            [usuario_id, empresa_id]
        );
        await client.query(`DELETE FROM usuarios_fotos WHERE usuario_id = $1 AND empresa_id = $2`, [usuario_id, empresa_id]);
        await client.query(
            `INSERT INTO usuarios_eventos (empresa_id, acao, alvo_usuario_id, cargo_alvo, executado_por, motivo, campos)
             VALUES ($1, 'editar', $2, $3, $4, $5, ARRAY['dados_pessoais_lgpd'])`,
            [empresa_id, usuario_id, usuario.papel, executado_por, motivo]
        );

        // A chave do arquivo volta para o chamador apagar do bucket (depois do COMMIT).
        return { resultado: 'anonimizado', usuario_id, chave_foto: foto[0]?.chave ?? null };
    });
}

// Bloqueados há mais que o prazo (último evento de bloqueio) e que ainda têm dado ou foto.
async function listarColaboradoresVencidos(empresa_id) {
    const { rows } = await db.query(
        `SELECT u.id FROM usuarios u
          WHERE u.empresa_id = $1 AND u.ativo = false
            AND (SELECT max(e.criado_em) FROM usuarios_eventos e WHERE e.alvo_usuario_id = u.id AND e.empresa_id = u.empresa_id AND e.acao = 'bloquear')
                < NOW() - make_interval(years => $2)
            AND (EXISTS (SELECT 1 FROM usuarios_fotos f WHERE f.usuario_id = u.id AND f.empresa_id = u.empresa_id)
              OR EXISTS (SELECT 1 FROM usuarios_dados d WHERE d.usuario_id = u.id AND d.empresa_id = u.empresa_id
                          AND (d.cpf IS NOT NULL OR d.telefone IS NOT NULL OR d.data_nascimento IS NOT NULL OR d.cep IS NOT NULL OR d.logradouro IS NOT NULL)))
          ORDER BY u.id`,
        [empresa_id, RETENCAO.COLABORADOR_ANOS]
    );

    return rows.map((r) => r.id);
}

module.exports = { anonimizarPedidoLoja, listarPedidosLojaVencidos, anonimizarColaborador, listarColaboradoresVencidos };
