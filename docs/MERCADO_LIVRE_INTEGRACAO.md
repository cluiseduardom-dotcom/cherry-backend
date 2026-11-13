# Integração com o Mercado Livre (pesquisa e plano)

Estado: **pesquisa e plano, nada implementado**. Levantado em 13/11/2026 a partir da documentação pública do Mercado Livre e de materiais de terceiros (contabilidade e ERPs). Onde a fonte é de terceiros ou a documentação não pôde ser consultada, está marcado **[CONFIRMAR]**.

## 1. O que "integrar" pode significar (decidir antes)
| Opção | O que faz | Esforço | Risco |
|---|---|---|---|
| A. **Só vender lá, à mão** | Anúncios criados e geridos na Central do Vendedor; o estoque é ajustado manualmente no Vertumno | Nenhum de código | Estoque desencontrado entre canais |
| B. **Importar pedidos e avisar o estoque** (leitura) | O Vertumno lê os pedidos do ML, baixa o estoque e mostra "a despachar"; não mexe nos anúncios | Médio | Baixo (só lê) |
| C. **Sincronizar estoque e preço** (escrita) | Além de B, o Vertumno atualiza `available_quantity` e preço dos anúncios | Alto | Médio (erro de sincronização vira venda sem estoque) |
| D. **Publicar a partir do Vertumno** | Cria e edita anúncios (categoria, atributos, fotos, frete) | Muito alto | Alto (regras de categoria e de catálogo mudam) |
| E. **Hub pronto** (Bling, Tiny, Olist etc.) | Terceiro sincroniza ML com o ERP | Baixo de código, custo mensal | Dependência de um fornecedor [CONFIRMAR integração com o Vertumno] |

Recomendação: **A agora**, B se houver venda real no ML, C só depois de B estável. D e E só com demanda comprovada.

## 2. Antes de qualquer código (conta e fiscal)
- **Conta de vendedor**, de preferência em nome de **pessoa jurídica**: a documentação do ML recomenda conta PJ para aplicações, e fontes de contabilidade indicam que contas em CPF não acessam o emissor de nota integrado [CONFIRMAR na Central de Ajuda].
- **Nota fiscal:** vendedor de produtos emite NF-e (modelo 55). Fontes de terceiros indicam, para MEI: CNPJ ativo, Inscrição Estadual quando aplicável e certificado digital e-CNPJ A1; e que o ML exige a nota para liberar o pagamento no modelo sem Full **[CONFIRMAR com o contador e na política atual do ML]**. O Vertumno **não emite documento fiscal** hoje.
- **Tarifas:** variam por categoria e tipo de anúncio. Fontes de 2026 citam em torno de 10-14% (Clássico) e 15-19% (Premium), e para Joias e Relógios cerca de 12,5% e 17,5%, mais um custo fixo por unidade em produtos a partir de R$ 19 que depende de peso e faixa de preço. As fontes divergem: **usar a tabela oficial da Central do Vendedor [CONFIRMAR]**.
- **Regras de categoria para semijoias:** não encontrei requisitos específicos; **[CONFIRMAR]** nas políticas do ML (marca, descrição, fotos, garantia).

## 3. A aplicação no DevCenter (passo a passo do PO)
1. https://developers.mercadolivre.com.br → **Minhas aplicações** → criar. Pede nome, nome curto, descrição e logo.
2. **URI de redirecionamento: obrigatoriamente HTTPS.** Definiremos `https://api.vertumno.com.br/mercado-livre/callback` quando o código existir.
3. **Permissões:** Leitura para as opções A/B; Leitura e escrita para C/D.
4. **Notificações:** escolher os tópicos (pedidos, itens, perguntas, envios) e a URL de notificação, também HTTPS. Formato e tópicos exatos **[CONFIRMAR na página de notificações]**.
5. Guardar **Client ID** e **Client Secret** como segredo (Render, nunca no repositório nem no chat). Em contas brasileiras a documentação cita limite de **1 aplicação** por conta, após validar os dados do titular.
6. Se algum segredo for exposto, trocá-lo no DevCenter na hora.

## 4. Autorização (OAuth 2.0)
- Quem autoriza é o **dono da conta** no navegador; devolve um `code`, trocado por `access_token` em `POST /oauth/token` (`grant_type`, `client_id`, `client_secret`, `code`, `redirect_uri`). Usuário **operador/colaborador não consegue** autorizar (erro `invalid_operator_user_id`).
- O token vai no header `Authorization` em cada chamada. Há opção de PKCE.
- Guardar tokens **cifrados por loja** (`criptografiaToken`), como já é feito com o Mercado Pago.

## 5. Desenho no Vertumno (se for adiante)
- **Aditivo e por loja:** novo canal de venda `mercado_livre` (já existe preço por canal), atrás de funcionalidade desligada por padrão. Nada muda no PDV, na loja online, nas permissões nem no financeiro das lojas que não ligarem.
- Tabelas novas com `empresa_id`: conexão (tokens cifrados), vínculo produto↔anúncio, pedido importado (idempotente por id do pedido), log de sincronização.
- Webhook do ML com validação, **reconsulta do pedido pela API** (como no Mercado Pago) e idempotência. Pedido do ML vira venda com origem `mercado_livre`, em transação, com `FOR UPDATE` no estoque.
- Vendedor nunca vê custo, margem nem tarifa do ML; a tarifa e o repasse entram no financeiro só para quem tem acesso.

## 5.1 Risco central: peça única em vários canais
Boa parte das peças tem **estoque 1** e é vendida na loja física, no site e (se integrar) no ML. Duas vendas quase simultâneas da mesma peça geram venda sem estoque (cancelamento, reclamação, reputação do vendedor no ML). Para C: reservar a peça ao receber o pedido, publicar quantidade com **margem de segurança** e reconsultar o estoque antes de confirmar. Para A/B: baixar no Vertumno assim que o pedido do ML chegar e tolerar o atraso.

## 6. Fases propostas
0. **Preparar (PO):** conta PJ, fiscal com o contador, aplicação no DevCenter, 3 a 5 peças-piloto anunciadas à mão.
1. **Leitura (B):** conectar a conta, importar pedidos, baixar estoque, painel "a despachar". Só GET.
2. **Estoque (C):** enviar quantidade e preço, com reserva e margem.
3. **Publicação (D):** só se houver demanda.

## 7. Decisões que dependem do PO
1. Qual das opções da seção 1 (recomendo A, depois B).
2. Conta do ML: PF ou PJ, e situação fiscal (MEI/ME, Inscrição Estadual, certificado digital).
3. Quem despacha e como (Mercado Envios, Correios, retirada).
4. Preço no ML: mesmo da loja, ou com tarifa embutida (o canal permite preço próprio).
5. Quais peças vão para o ML (as únicas têm mais risco).

## Fontes
- Aplicações e OAuth: https://developers.mercadolivre.com.br/crie-uma-aplicacao-no-mercado-livre e https://developers.mercadolivre.com.br/autenticacao-e-autorizacao
- Publicar itens: https://developers.mercadolivre.com.br/publicacao-de-produtos e https://developers.mercadolivre.com.br/validador-de-publicacoes
- Tarifas e fiscal (terceiros, conferir): https://ecommercenapratica.com/blog/comissao-mercado-livre/ e https://agilize.com.br/artigos/emitir-nota-fiscal-mercadolivre-mei
