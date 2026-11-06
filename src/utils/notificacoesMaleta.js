// Regras PURAS dos avisos de maleta no sino (sem banco). Recebem linhas já agregadas por local e devolvem
// avisos no mesmo formato do sino. Nunca trazem custo, margem ou lucro.
// Equipe (admin/estoquista) vê todas as maletas; os demais só a própria e as transferências para ela.
const LIMITES_MALETA = Object.freeze({
    TRANSFERENCIA_PENDENTE_DIAS: 2,
    MALETA_SEM_VENDA_DIAS: 30,
    MALETA_SEM_CONFERENCIA_DIAS: 30
});

const TIPOS_MALETA = Object.freeze({
    TRANSFERENCIA_PENDENTE: 'transferencia_pendente',
    MALETA_SEM_CONFERENCIA: 'maleta_sem_conferencia',
    MALETA_SEM_VENDA: 'maleta_sem_venda',
    MALETA_DIVERGENCIA: 'maleta_divergencia'
});

const num = (v) => (v === null || v === undefined ? null : Number(v));
const pecas = (n) => `${n} peça${n === 1 ? '' : 's'}`;

function aviso(tipo, chaveId, prioridade, titulo, mensagem, acao, extra, dados) {
    return {
        id: `${tipo}:${chaveId}`,
        tipo,
        prioridade,
        produto_id: null,
        sku: null,
        nome: null,
        item: 'maleta',
        ...extra,
        titulo,
        mensagem,
        acao,
        dados
    };
}

// maletas: { local_id, nome, usuario_id, saldo_total, dias_sem_venda, dias_sem_conferencia, conferencia_divergente_id, itens_divergentes }
//   dias_sem_venda: dias desde a última venda OU o último recebimento (o que for mais recente); null = sem referência.
//   dias_sem_conferencia: dias desde a última conferência; sem nenhuma, desde o primeiro recebimento; null = sem referência.
// pendentes: { id, origem_nome, destino_nome, destino_usuario_id, pecas, dias }
function montarNotificacoesMaleta({ maletas = [], pendentes = [] }, perfil, usuarioId) {
    const equipe = Boolean(perfil.administrador || perfil.estoquista);
    const itens = [];

    for (const t of pendentes) {
        const dias = num(t.dias);
        if (dias === null || dias < LIMITES_MALETA.TRANSFERENCIA_PENDENTE_DIAS) continue;
        const dono = num(t.destino_usuario_id) !== null && Number(t.destino_usuario_id) === Number(usuarioId);
        if (!equipe && !dono) continue;

        const qtd = Number(t.pecas) || 0;
        itens.push(aviso(
            TIPOS_MALETA.TRANSFERENCIA_PENDENTE, t.id, 'alta',
            'Transferência sem aceite',
            dono
                ? `Transferência #${t.id} de ${t.origem_nome}: ${pecas(qtd)} aguardam o seu aceite há ${dias} dias.`
                : `Transferência #${t.id} (${t.origem_nome} → ${t.destino_nome}): ${pecas(qtd)} estão há ${dias} dias sem aceite.`,
            dono ? 'Aceitar ou recusar a transferência.' : 'Cobrar o aceite ou cancelar a transferência.',
            { transferencia_id: Number(t.id) },
            { dias, pecas: qtd }
        ));
    }

    for (const m of maletas) {
        const doDono = Number(m.usuario_id) === Number(usuarioId);
        if (!equipe && !doDono) continue;

        const saldo = Number(m.saldo_total) || 0;
        const extra = { local_id: Number(m.local_id) };
        const semConferencia = num(m.dias_sem_conferencia);
        const semVenda = num(m.dias_sem_venda);

        if (equipe && m.conferencia_divergente_id !== null && m.conferencia_divergente_id !== undefined) {
            const n = Number(m.itens_divergentes) || 0;
            itens.push(aviso(
                TIPOS_MALETA.MALETA_DIVERGENCIA, m.local_id, 'alta',
                'Conferência com diferença',
                `A última conferência de ${m.nome} achou diferença em ${n} produto${n === 1 ? '' : 's'} e o ajuste não foi aplicado.`,
                'Revisar a conferência e aplicar o ajuste ou investigar a diferença.',
                extra,
                { conferencia_id: Number(m.conferencia_divergente_id), itens_divergentes: n }
            ));
        }

        if (saldo > 0 && semConferencia !== null && semConferencia >= LIMITES_MALETA.MALETA_SEM_CONFERENCIA_DIAS) {
            itens.push(aviso(
                TIPOS_MALETA.MALETA_SEM_CONFERENCIA, m.local_id, 'media',
                'Maleta sem conferência',
                `${m.nome} tem ${pecas(saldo)} e está há ${semConferencia} dias sem conferência.`,
                equipe ? 'Conferir a maleta (contagem física).' : 'Combinar a conferência da maleta com a equipe.',
                extra,
                { saldo, dias_sem_conferencia: semConferencia }
            ));
        }

        if (saldo > 0 && semVenda !== null && semVenda >= LIMITES_MALETA.MALETA_SEM_VENDA_DIAS) {
            itens.push(aviso(
                TIPOS_MALETA.MALETA_SEM_VENDA, m.local_id, 'media',
                'Maleta sem vender',
                `${m.nome} tem ${pecas(saldo)} e está há ${semVenda} dias sem vender.`,
                'Avaliar a troca de peças ou a devolução ao Central.',
                extra,
                { saldo, dias_sem_venda: semVenda }
            ));
        }
    }

    return itens;
}

module.exports = { montarNotificacoesMaleta, LIMITES_MALETA, TIPOS_MALETA };
