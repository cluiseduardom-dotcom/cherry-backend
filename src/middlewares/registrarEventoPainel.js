const painelRepository = require('../repositories/painelRepository');

// Grava na trilha do painel toda ação que mudou algo e deu certo (status < 400), depois da resposta.
// A empresa-alvo vem da rota (:id). Nada do corpo vai para a trilha (pode ter dado sensível): só a ação.
function registrarEventoPainel(acao) {
    return (req, res, next) => {
        res.on('finish', () => {
            if (res.statusCode >= 400 || !req.operador) return;
            const alvo = Number.parseInt(req.params?.id, 10);
            painelRepository.registrarEvento({
                operador_id: req.operador.id,
                acao,
                alvo_empresa_id: Number.isInteger(alvo) && alvo > 0 ? alvo : null,
                ip: req.ip
            }).catch((error) => console.error('Painel: falha ao gravar evento', acao, error.message));
        });
        next();
    };
}

module.exports = registrarEventoPainel;
