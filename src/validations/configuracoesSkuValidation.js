const { z } = require('zod');

const segmentoSchema = z.object({
    nivel: z.coerce.number().int().positive('Nível inválido'),
    ordem: z.coerce.number().int().positive('Ordem inválida'),
    nome: z.string().min(1, 'Nome do segmento é obrigatório').max(255),
    obrigatorio: z.boolean().default(true),
    participa_sku: z.boolean().default(true)
}).strict();

const salvarConfiguracaoSkuSchema = z.object({
    nome: z.string().min(1, 'Nome é obrigatório').max(100),
    tipo_sku: z.enum(['numerico', 'alfabetico', 'alfanumerico']),
    separador: z.string().max(1),
    prefixo: z.string().max(30),
    sufixo: z.string().max(30),
    tamanho_sequencia: z.coerce.number().int().min(1).max(9),
    inicio_sequencia: z.coerce.number().int().min(0),
    segmentos: z.array(segmentoSchema)
}).strict();

module.exports = { salvarConfiguracaoSkuSchema };
