const { z } = require('zod');

// Strings 'YYYY-MM-DD' do início ao fim (nunca viram Date): mesma armadilha de
// fuso horário das demais colunas DATE do projeto.
const dataISO = (mensagem) => z.iso.date({ error: mensagem });

const periodoSchema = z.object({
    data_inicio: dataISO('Data inicial inválida').optional(),
    data_fim: dataISO('Data final inválida').optional()
}).refine((data) => !data.data_inicio || !data.data_fim || data.data_inicio <= data.data_fim, {
    message: 'Data inicial não pode ser depois da data final',
    path: ['data_fim']
});

// usuario_id ausente/null = padrão da empresa. percentual null = remover a regra
// (o vendedor volta a herdar o padrão). Percentual com até 4 casas, de 0 a 100.
const definirPercentualSchema = z.object({
    usuario_id: z.number({ error: 'Usuário inválido' }).int('Usuário inválido').positive('Usuário inválido').nullable().optional(),
    percentual: z.number({ error: 'Percentual inválido' })
        .min(0, 'Percentual deve estar entre 0 e 100')
        .max(100, 'Percentual deve estar entre 0 e 100')
        .refine((valor) => Math.abs(valor * 10000 - Math.round(valor * 10000)) < 1e-6, 'Percentual aceita até 4 casas decimais')
        .nullable()
}).strict();

module.exports = {
    periodoSchema,
    definirPercentualSchema
};
