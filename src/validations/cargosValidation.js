const { z } = require('zod');
const { CARGOS, CAPACIDADES_CONFIGURAVEIS, NIVEL_MINIMO, NIVEL_MAXIMO } = require('../constants/cargos');

const cargoSchema = z.enum(CARGOS, { message: 'Cargo inválido' });

// Atualização parcial: só o que vier é alterado. `nivel: null` é válido apenas para cargos fora
// da escada (Estoquista, Faturista); o serviço confere. Campos desconhecidos são recusados.
const atualizarCargoSchema = z.object({
    nivel: z.number({ message: 'Nível inválido' })
        .int('Nível deve ser inteiro')
        .min(NIVEL_MINIMO, `Nível mínimo é ${NIVEL_MINIMO}`)
        .max(NIVEL_MAXIMO, `Nível máximo é ${NIVEL_MAXIMO}`)
        .nullable()
        .optional(),
    ativo: z.boolean({ message: 'Ativo deve ser verdadeiro ou falso' }).optional(),
    capacidades: z.array(z.enum(CAPACIDADES_CONFIGURAVEIS, { message: 'Capacidade inválida' }))
        .refine((lista) => new Set(lista).size === lista.length, { message: 'Capacidades repetidas' })
        .optional()
}).strict().refine((dados) => Object.keys(dados).length > 0, { message: 'Informe ao menos um campo' });

module.exports = { cargoSchema, atualizarCargoSchema };
