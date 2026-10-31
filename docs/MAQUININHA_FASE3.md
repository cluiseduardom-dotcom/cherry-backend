# Maquininha integrada (Fase 3) — pesquisa e perguntas

Estado: **pesquisa, nada implementado**. Não bloqueia o lançamento. Começa depois que a Cherry estiver estável em produção.

## Objetivo (PO)
- A maquininha responde ao sistema: o valor vem do PDV e o resultado volta sem o vendedor digitar o valor.
- Possível parceria: o VERTUMNO fornece a maquininha junto com uma adquirente aos clientes que comprarem o sistema.
- Cobre o **débito**, que o link de pagamento não ofereceu no teste de 31/10/2026.

## O que se sabe da pesquisa (sem valores de comissão públicos)
- **Mercado Pago (Point / Orders):** parcelamento só no crédito; `installments_cost` (vendedor ou comprador). **Comissão da plataforma por transação presencial não está documentada.**
- **Stone (Stone Connect / programa de parceiros), Getnet (Connects), Cielo (Aliança):** existem programas para software parceiro; **percentuais de comissão ou revenue share não são públicos**. Parte da documentação não pôde ser consultada.

## Perguntas a fazer às adquirentes (decidem o desenho)
1. Existe comissão ou revenue share para o software parceiro sobre as vendas presenciais? Qual a regra?
2. Dá para cobrar a taxa da plataforma por transação presencial (como no Pix)? Como ela é repassada?
3. Quem fornece e subsidia as maquininhas dos clientes do VERTUMNO?
4. Qual o custo, prazo e volume mínimo para homologar a integração?
5. Um único cadastro do VERTUMNO serve vários clientes (multi-tenant), ou cada loja precisa contratar separadamente?

## Regras que valem para qualquer provedor
- Valor e resultado do pagamento confirmados no provedor, nunca digitados nem confiados ao frontend.
- Isolamento por `empresa_id` do JWT; taxa da plataforma só sobre Pix até decisão contrária do PO.
- Idempotência e confirmação por webhook + consulta, como no Pix e no link de cartão.
