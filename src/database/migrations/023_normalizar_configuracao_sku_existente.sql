-- Normaliza a configuração criada pela migration 022 para empresas existentes.
-- A migration 022 usava o formato legado (alfanumérico, sem separador).
-- Não altera SKUs já emitidos; novos SKUs passam a usar o padrão numérico com '-'.

UPDATE configuracoes_sku
SET tipo_sku = 'numerico',
    separador = '-',
    tamanho_sequencia = 3,
    inicio_sequencia = 1,
    nome = 'Padrão',
    atualizado_em = NOW()
WHERE ativo = true
  AND nome = 'Padrão atual'
  AND tipo_sku = 'alfanumerico'
  AND separador = '';
