-- Migration 018: campo unidade em produtos.
-- Cadastro de produto ganha unidade de venda (UN, PAR, CX, PCT). Lista
-- fechada, validada na aplicação (produtosValidation.js) - unidades
-- fracionárias (KG, G, L, ML) ficam fora de propósito, exigiriam estoque
-- decimal (fica para quando confeitaria/mercadinho entrarem).
--
-- NOT NULL DEFAULT 'UN' cobre o backfill de produtos já cadastrados sem
-- precisar de UPDATE explícito.

ALTER TABLE produtos ADD COLUMN unidade VARCHAR(4) NOT NULL DEFAULT 'UN';
