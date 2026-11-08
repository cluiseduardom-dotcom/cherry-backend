'use strict';

// Libera as reservas vencidas da loja online (pedido aguardando pagamento cujo prazo acabou): a peça volta da
// Reserva ao Central e o pedido vira `expirado`. Rodar a cada minuto como Cron Job do Render:
//   comando:  node scripts/expirar-reservas-loja.js
//   variáveis: as mesmas do serviço da API (DATABASE_URL etc.).
// Seguro rodar junto com a API ou em dobro: cada pedido é travado com SKIP LOCKED e só é processado uma vez.
// Varre todas as empresas por desenho (é um job de sistema); cada pedido usa o empresa_id da própria linha.
require('dotenv').config({ quiet: true });

const db = require('../src/config/db');
const { expirarVencidos } = require('../src/repositories/lojaPedidosRepository');

(async () => {
    try {
        const expirados = await expirarVencidos({ limite: 500 });
        console.log(`Reservas da loja liberadas: ${expirados}`);
    } catch (error) {
        console.error('Falha ao liberar reservas da loja:', error.message);
        process.exitCode = 1;
    } finally {
        await db.end();
    }
})();
