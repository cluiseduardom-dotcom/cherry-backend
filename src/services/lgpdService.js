const AppError = require('../errors/AppError');
const lgpdRepository = require('../repositories/lgpdRepository');
const storage = require('./storage/imagensStorage');

// Orquestra a anonimização (LGPD). Quem chama é um script administrativo (nunca uma rota pública): `empresa_id` é
// informado explicitamente por quem opera e toda consulta é filtrada por ele. Simulação por padrão.

const MOTIVO_RETENCAO = 'Prazo de retenção vencido (LGPD)';

function validarMotivo(motivo, executar) {
    const texto = String(motivo ?? '').trim();

    if (executar && texto.length < 3) {
        throw new AppError('Informe o motivo (ex.: "Pedido do titular em 13/11/2026") para executar.', 400);
    }

    return texto;
}

async function apagarFoto(chave) {
    if (chave && storage.configurado()) await storage.remover(chave).catch(() => {});
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function anonimizarPedidoLoja({ empresa_id, codigo, executar = false, motivo }) {
    if (!UUID.test(String(codigo))) throw new AppError('Código do pedido inválido (esperado no formato 00000000-0000-0000-0000-000000000000).', 400);

    return lgpdRepository.anonimizarPedidoLoja({ empresa_id, codigo, executar, motivo: validarMotivo(motivo, executar) });
}

async function anonimizarColaborador({ empresa_id, usuario_id, executar = false, executado_por, motivo }) {
    if (executar && !Number.isInteger(executado_por)) throw new AppError('Informe quem está executando (id de um administrador).', 400);

    const r = await lgpdRepository.anonimizarColaborador({ empresa_id, usuario_id, executar, executado_por, motivo: validarMotivo(motivo, executar) });
    if (r.chave_foto) await apagarFoto(r.chave_foto);
    delete r.chave_foto;

    return r;
}

// Tudo que passou do prazo, na empresa. Devolve só contagens e ids/códigos.
async function aplicarRetencao({ empresa_id, executar = false, executado_por }) {
    const [pedidos, colaboradores] = await Promise.all([
        lgpdRepository.listarPedidosLojaVencidos(empresa_id),
        lgpdRepository.listarColaboradoresVencidos(empresa_id)
    ]);
    const resumo = { pedidos: { vencidos: pedidos.length, anonimizados: 0, recusados: 0 }, colaboradores: { vencidos: colaboradores.length, anonimizados: 0, recusados: 0 } };

    for (const codigo of pedidos) {
        const r = await anonimizarPedidoLoja({ empresa_id, codigo, executar, motivo: MOTIVO_RETENCAO });
        if (r.resultado === 'anonimizado') resumo.pedidos.anonimizados += 1;
        if (r.resultado === 'recusado') resumo.pedidos.recusados += 1;
    }

    for (const usuario_id of colaboradores) {
        const r = await anonimizarColaborador({ empresa_id, usuario_id, executar, executado_por, motivo: MOTIVO_RETENCAO });
        if (r.resultado === 'anonimizado') resumo.colaboradores.anonimizados += 1;
        if (r.resultado === 'recusado') resumo.colaboradores.recusados += 1;
    }

    return resumo;
}

module.exports = { anonimizarPedidoLoja, anonimizarColaborador, aplicarRetencao, MOTIVO_RETENCAO };
