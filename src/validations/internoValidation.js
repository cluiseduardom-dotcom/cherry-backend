const { z } = require('zod');
const { MODULOS } = require('../constants/modulos');
const { TEMAS_VISUAIS } = require('../constants/temasVisuais');

const empresaIdSchema = z.coerce.number({ message: 'Empresa inválida' })
    .int('Empresa inválida').positive('Empresa inválida');

const responsavelSchema = z.string({ message: 'Responsável é obrigatório' })
    .trim().min(2, 'Responsável é obrigatório').max(120, 'Responsável muito longo');

const justificativaSchema = z.string({ message: 'Justificativa é obrigatória' })
    .trim().min(3, 'Justificativa é obrigatória').max(500, 'Justificativa muito longa');

const temaSchema = z.object({
    tema: z.enum(TEMAS_VISUAIS, { message: 'Tema inválido' }),
    responsavel: responsavelSchema,
    justificativa: justificativaSchema
}).strict();

const moduloSchema = z.object({
    ativo: z.boolean({ message: 'Informe ativo como verdadeiro ou falso' }),
    responsavel: responsavelSchema,
    justificativa: justificativaSchema
}).strict();

const codigoModuloSchema = z.enum(MODULOS, { message: 'Módulo inválido' });

module.exports = { empresaIdSchema, temaSchema, moduloSchema, codigoModuloSchema };
