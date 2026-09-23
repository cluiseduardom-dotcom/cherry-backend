const { z } = require('zod');

const SEPARADORES_PERMITIDOS = ['-', '_', '/', 'x', '*', '+'];

const segmentoSchema = z.object({
    nivel: z.coerce.number().int().positive('Nível inválido'),
    ordem: z.coerce.number().int().positive('Ordem inválida'),
    nome: z.string().min(1, 'Nome do segmento é obrigatório').max(255),
    obrigatorio: z.boolean().default(true),
    participa_sku: z.boolean().default(true)
}).strict();

const salvarConfiguracaoSkuSchema = z.object({
    id: z.coerce.number().int().positive().optional(),
    padrao: z.boolean().default(true),
    nome: z.string().min(1, 'Nome é obrigatório').max(100),
    tipo_sku: z.enum(['numerico', 'alfabetico', 'alfanumerico']),
    separador: z.string().max(1).refine(value => value === '' || SEPARADORES_PERMITIDOS.includes(value), 'Separador de SKU não permitido'),
    prefixo: z.string().max(30),
    sufixo: z.string().max(30),
    tamanho_sequencia: z.coerce.number().int().min(1).max(18),
    inicio_sequencia: z.coerce.bigint().min(0n),
    segmentos: z.array(segmentoSchema)
}).strict();

module.exports = { salvarConfiguracaoSkuSchema };
