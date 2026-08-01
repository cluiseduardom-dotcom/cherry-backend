require('dotenv').config({ quiet: true });
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const NOME_EMPRESA_SEED = 'Cherry Semijoias';
const ESTOQUE_INICIAL = 100;

// markup é sempre relativo ao custo, margem sempre relativa ao preço de
// venda — mesma fórmula de precosService.calcularPreco, pra precos_produto
// ficar consistente com o resto do sistema.
function calcularMarkupEMargem(custo, precoVenda) {
    const markup = Number((((precoVenda - custo) / custo) * 100).toFixed(2));
    const margem = Number((((precoVenda - custo) / precoVenda) * 100).toFixed(2));
    return { markup, margem };
}

async function main() {
    const jaExiste = await pool.query('SELECT id FROM empresas WHERE nome = $1', [NOME_EMPRESA_SEED]);

    if (jaExiste.rows.length) {
        console.log(`Seed pulado: empresa '${NOME_EMPRESA_SEED}' já existe (id ${jaExiste.rows[0].id}).`);
        await pool.end();
        return;
    }

    const senhaHash = await bcrypt.hash('senha123', 10);

    await pool.query('BEGIN');

    try {
        const empresaResult = await pool.query(
            `INSERT INTO empresas (nome, cnpj, status) VALUES ($1, NULL, 'ativa') RETURNING id`,
            [NOME_EMPRESA_SEED]
        );
        const empresaId = empresaResult.rows[0].id;

        const canaisResult = await pool.query(
            `INSERT INTO canais_venda (empresa_id, nome, ativo) VALUES
                ($1, 'loja_fisica', true),
                ($1, 'online', true)
             RETURNING id, nome`,
            [empresaId]
        );
        const canalLojaFisicaId = canaisResult.rows.find((c) => c.nome === 'loja_fisica').id;

        const usuariosResult = await pool.query(
            `INSERT INTO usuarios (empresa_id, nome, email, senha, papel) VALUES
                ($1, $2, $3, $4, 'admin'),
                ($1, $5, $6, $7, 'vendedor'),
                ($1, $8, $9, $10, 'estoquista')
             RETURNING id, papel`,
            [
                empresaId,
                'Ana Souza', 'ana@cherry.com', senhaHash,
                'Bruno Lima', 'bruno@cherry.com', senhaHash,
                'Carla Dias', 'carla@cherry.com', senhaHash
            ]
        );
        const adminId = usuariosResult.rows.find((u) => u.papel === 'admin').id;

        const clientesResult = await pool.query(
            `INSERT INTO clientes (empresa_id, nome, telefone, email) VALUES
                ($1, 'João Pereira', '11999990001', 'joao@example.com'),
                ($1, 'Maria Santos', '11999990002', 'maria@example.com'),
                ($1, 'Pedro Alves', '11999990003', 'pedro@example.com'),
                ($1, 'Fernanda Costa', '11999990004', 'fernanda@example.com')
             RETURNING id`,
            [empresaId]
        );
        const [c1, c2, c3, c4] = clientesResult.rows.map((r) => r.id);

        const produtosSeed = [
            { sku: 'CAM-001', nome: 'Camiseta Básica', custo: 20.00, preco_venda: 49.90 },
            { sku: 'CAN-001', nome: 'Caneca Cherry', custo: 12.00, preco_venda: 29.90 },
            { sku: 'BON-001', nome: 'Boné Cherry', custo: 18.00, preco_venda: 39.90 },
            { sku: 'ECO-001', nome: 'Ecobag', custo: 10.00, preco_venda: 24.90 },
            { sku: 'SQZ-001', nome: 'Squeeze Térmico', custo: 35.00, preco_venda: 59.90 },
            // custo > preco_venda de propósito: testa alertaPrejuizo/curva ABC/produtos "parados"
            { sku: 'CHV-001', nome: 'Chaveiro Promo', custo: 6.00, preco_venda: 5.00 }
        ];

        const produtoIds = [];
        const estoqueAtual = {};

        for (const p of produtosSeed) {
            const { rows } = await pool.query(
                `INSERT INTO produtos (empresa_id, sku, nome, preco_venda, custo, estoque_atual)
                 VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
                [empresaId, p.sku, p.nome, p.preco_venda, p.custo, ESTOQUE_INICIAL]
            );
            const produtoId = rows[0].id;
            produtoIds.push(produtoId);
            estoqueAtual[produtoId] = ESTOQUE_INICIAL;

            await pool.query(
                `INSERT INTO movimentacoes_estoque (empresa_id, produto_id, tipo, quantidade, estoque_resultante, motivo, usuario_id)
                 VALUES ($1, $2, 'entrada', $3, $3, 'Estoque inicial (seed)', $4)`,
                [empresaId, produtoId, ESTOQUE_INICIAL, adminId]
            );

            const { markup, margem } = calcularMarkupEMargem(p.custo, p.preco_venda);
            await pool.query(
                `INSERT INTO precos_produto (empresa_id, produto_id, canal_id, preco_venda, markup_percentual, margem_percentual, usuario_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [empresaId, produtoId, canalLojaFisicaId, p.preco_venda, markup, margem, adminId]
            );
        }

        const [p1, p2, p3, p4, p5] = produtoIds;
        // p6 (Chaveiro Promo) fica sem venda de propósito: testa alertaPrejuizo (custo > preco_venda) e produtos "parados"

        const vendasSeed = [
            { cliente: c1, diasAtras: 45, itens: [[p1, 2, 49.90], [p2, 1, 29.90]] },
            { cliente: c2, diasAtras: 30, itens: [[p3, 1, 39.90]] },
            { cliente: c3, diasAtras: 20, itens: [[p1, 1, 49.90], [p4, 3, 24.90]] },
            { cliente: c4, diasAtras: 10, itens: [[p5, 1, 59.90], [p2, 2, 29.90]] },
            { cliente: c1, diasAtras: 5, itens: [[p2, 4, 29.90]] },
            { cliente: c2, diasAtras: 1, itens: [[p1, 1, 49.90], [p3, 2, 39.90]] }
        ];

        for (const venda of vendasSeed) {
            const total = venda.itens.reduce((soma, [, quantidade, preco]) => soma + quantidade * preco, 0);

            const vendaResult = await pool.query(
                `INSERT INTO vendas (empresa_id, cliente_id, canal_id, usuario_id, total, status, data)
                 VALUES ($1, $2, $3, $4, $5, 'finalizada', NOW() - $6::interval)
                 RETURNING id`,
                [empresaId, venda.cliente, canalLojaFisicaId, adminId, total, `${venda.diasAtras} days`]
            );
            const vendaId = vendaResult.rows[0].id;

            for (const [produtoId, quantidade, precoUnitario] of venda.itens) {
                await pool.query(
                    `INSERT INTO itens_venda (empresa_id, venda_id, produto_id, quantidade, preco_unitario)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [empresaId, vendaId, produtoId, quantidade, precoUnitario]
                );

                estoqueAtual[produtoId] -= quantidade;

                await pool.query(
                    `UPDATE produtos SET estoque_atual = $1 WHERE id = $2`,
                    [estoqueAtual[produtoId], produtoId]
                );

                await pool.query(
                    `INSERT INTO movimentacoes_estoque (empresa_id, produto_id, tipo, quantidade, estoque_resultante, motivo, usuario_id)
                     VALUES ($1, $2, 'saida', $3, $4, $5, $6)`,
                    [empresaId, produtoId, quantidade, estoqueAtual[produtoId], `Venda #${vendaId}`, adminId]
                );
            }
        }

        await pool.query('COMMIT');
        console.log(`Seed concluído: empresa '${NOME_EMPRESA_SEED}' (id ${empresaId}), 3 usuarios, 4 clientes, 6 produtos, 6 vendas.`);
    } catch (err) {
        await pool.query('ROLLBACK');
        throw err;
    } finally {
        await pool.end();
    }
}

main().catch((err) => {
    console.error('ERRO no seed:', err.message);
    process.exit(1);
});
