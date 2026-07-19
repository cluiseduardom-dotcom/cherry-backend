require('dotenv').config();
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
    const senhaHash = await bcrypt.hash('senha123', 10);

    await pool.query('BEGIN');

    try {
        const usuarios = await pool.query(
            `INSERT INTO usuarios (nome, email, senha, papel) VALUES
                ($1, $2, $3, 'admin'),
                ($4, $5, $6, 'vendedor'),
                ($7, $8, $9, 'estoquista')
            RETURNING id`,
            [
                'Ana Souza', 'ana@cherry.com', senhaHash,
                'Bruno Lima', 'bruno@cherry.com', senhaHash,
                'Carla Dias', 'carla@cherry.com', senhaHash
            ]
        );

        const clientes = await pool.query(
            `INSERT INTO clientes (nome, telefone, email) VALUES
                ('João Pereira', '11999990001', 'joao@example.com'),
                ('Maria Santos', '11999990002', 'maria@example.com'),
                ('Pedro Alves', '11999990003', 'pedro@example.com'),
                ('Fernanda Costa', '11999990004', 'fernanda@example.com')
            RETURNING id`
        );

        const produtos = await pool.query(
            `INSERT INTO produtos (nome, preco_venda, custo) VALUES
                ('Camiseta Básica', 49.90, 20.00),
                ('Caneca Cherry', 29.90, 12.00),
                ('Boné Cherry', 39.90, 18.00),
                ('Ecobag', 24.90, 10.00),
                ('Squeeze Térmico', 59.90, 35.00),
                ('Chaveiro Promo', 5.00, 6.00)
            RETURNING id`
        );

        const [c1, c2, c3, c4] = clientes.rows.map(r => r.id);
        const [p1, p2, p3, p4, p5] = produtos.rows.map(r => r.id);
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
                `INSERT INTO vendas (cliente_id, total, data)
                 VALUES ($1, $2, NOW() - $3::interval)
                 RETURNING id`,
                [venda.cliente, total, `${venda.diasAtras} days`]
            );

            const vendaId = vendaResult.rows[0].id;

            for (const [produtoId, quantidade, precoUnitario] of venda.itens) {
                await pool.query(
                    `INSERT INTO itens_venda (venda_id, produto_id, quantidade, preco_unitario)
                     VALUES ($1, $2, $3, $4)`,
                    [vendaId, produtoId, quantidade, precoUnitario]
                );
            }
        }

        await pool.query('COMMIT');
        console.log('Seed concluído: 3 usuarios, 4 clientes, 6 produtos, 6 vendas.');
    } catch (err) {
        await pool.query('ROLLBACK');
        throw err;
    } finally {
        await pool.end();
    }
}

main().catch(err => {
    console.error('ERRO no seed:', err.message);
    process.exit(1);
});
