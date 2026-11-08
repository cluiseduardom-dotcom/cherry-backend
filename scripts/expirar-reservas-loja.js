'use strict';

// Rotina da loja online, a cada minuto:
//  1. converte em venda os pedidos cuja cobrança já está PAGA mas ainda sem venda (rede de segurança do webhook);
//  2. libera as reservas vencidas (pedido aguardando pagamento cujo prazo acabou): a peça volta da Reserva ao
//     Central e o pedido vira `expirado`. Pedido com cobrança paga nunca expira: espera a conversão. Rodar a cada minuto como Cron Job do Render:
//   comando:  node scripts/expirar-reservas-loja.js
//   variáveis: as mesmas do serviço da API (DATABASE_URL etc.).
// Seguro rodar junto com a API ou em dobro: cada pedido é travado com SKIP LOCKED e só é processado uma vez.
// Varre todas as empresas por desenho (é um job de sistema); cada pedido usa o empresa_id da própria linha.
require('dotenv').config({ quiet: true });

const db = require('../src/config/db');
const { expirarVencidos, converterPendentes } = require('../src/repositories/lojaPedidosRepository');

(async () => {
    try {
        // Conversão primeiro: um pedido pago nunca deve ser tratado como vencido.
        const convertidos = await converterPendentes({ limite: 200 });
        const expirados = await expirarVencidos({ limite: 500 });
        console.log(`Pedidos pagos convertidos em venda: ${convertidos}; reservas da loja liberadas: ${expirados}`);
    } catch (error) {
        console.error('Falha ao liberar reservas da loja:', error.message);
        process.exitCode = 1;
    } finally {
        await db.end();
    }
})();
