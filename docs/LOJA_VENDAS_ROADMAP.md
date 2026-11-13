# Loja online: funcionalidades de venda (plano por fases)

Estado: **fase 1 e fase 2 (condições de venda) entregues**. Fase 1: (seção "presentes por faixa de preço + últimas unidades + ajuda por WhatsApp", migration 106, ligada pelo ERP). As demais funcionalidades pedidas pelo PO estão **planejadas aqui**, cada uma com dado real por trás, desligada por padrão e por loja.

Regras que valem para todas (do PO): aditivo; funcionalidade desligada por padrão; nada altera PDV, estoque, vendas, financeiro nem permissões; `empresa_id` nunca vem do navegador; **nada inventado** (nem prova social, nem prazo, nem promoção, nem garantia); nada de dado simulado exibido como real.

## Ordem sugerida (valor, esforço e risco)
| # | Funcionalidade | Esforço | Risco | Depende de |
|---|---|---|---|---|
| 1 | Garantia, embalagem de presente e frete grátis (textos e regra no ERP) | Baixo | Baixo | Texto e valor definidos pelo PO |
| 2 | Cadastro de e-mails (captura preparada) | Médio | Médio (LGPD) | Texto de consentimento e política |
| 3 | Depoimentos (manuais) e Instagram (galeria curada) | Baixo | Baixo | Conteúdo e autorização reais |
| 4 | Avaliações de compradores (verificadas) | Médio | Médio | Fluxo pós-entrega e moderação |
| 5 | Campanhas com preço (base do contador e do "5% no Pix") | Alto | Alto | Regra comercial do PO |
| 6 | "X pessoas vendo agora" | Médio | Médio (privacidade) | Tráfego real e política |

## 1. Garantia, embalagem de presente e frete grátis — ENTREGUE (migration 107)
**Decisões do PO (13/11/2026):** frete grátis a partir de R$ 300,00 (subtotal das peças, Brasil todo, sem desconto vigente); garantia de 1 ano que não cobre mau uso; embalagem de presente grátis. Os textos finais são digitados pelo admin no ERP ("Institucional da loja" > "Condições de venda").
**Como funciona:** o servidor decide no pedido (subtotal >= valor vigente => `frete = 0`; senão `NULL` = a combinar) e grava; o total não muda. Mudar o valor depois não altera pedidos antigos. O navegador só exibe. Sem valor configurado, nada muda.
**Pendente desta frente (não construído):** caixa "é presente" + mensagem do cartão no checkout (precisa de coluna no pedido e aparecer em "Pedidos da loja"); garantia nos Termos de uso (texto jurídico a validar).

Desenho original:
- **ERP** (mesma tela da seção de presentes): `garantia_texto`, `embalagem_presente_texto` e `frete_gratis_acima` (valor em R$; vazio = desligado). Nada preenchido pelo sistema.
- **Loja:** mostra a garantia na página da peça e na página de termos; a embalagem como linha informativa na peça e no checkout; o frete grátis como barra no carrinho ("faltam R$ X para frete grátis") e linha "Frete: grátis" no checkout quando o subtotal passa do valor, senão "a combinar" como hoje.
- **Opção de presente no checkout (fase seguinte):** caixa "é presente" + mensagem do cartão (até 200 caracteres), gravadas no pedido e mostradas em "Pedidos da loja" para a separação. Cobrança de embalagem só se o PO definir preço.
- **Condição legal e comercial:** o texto é do PO, e só pode afirmar o que a loja cumpre. O frete grátis é uma **promessa vinculante**: o valor mínimo, a cobertura (Brasil todo ou regiões), se vale antes ou depois de desconto e quem arca precisam estar definidos. Hoje o frete é combinado depois do pedido (sem cálculo por CEP), então a regra recomendada é "frete grátis para todo o Brasil acima de R$ X" ou, se houver restrição, coletar o CEP no checkout.
- **Decisões do PO:** valor mínimo, cobertura, texto da garantia (prazo e o que cobre), preço (ou gratuidade) da embalagem.

## 2. Cadastro de e-mails (preparado)
- **Dados:** tabela `loja_inscritos` (`empresa_id`, e-mail, `consentimento_em`, versão do texto de consentimento, origem, token de cancelamento, `cancelado_em`; e-mail único por empresa, sem diferença de maiúsculas). **Não guarda IP.**
- **Captura:** formulário no rodapé e na seção de ajuda, com caixa de consentimento **desmarcada**, texto da finalidade e link para a Política de privacidade; verificação anti-robô (Turnstile, já usado no pedido) e limite de tentativas.
- **ERP:** lista, busca, exportar CSV e remover (admin).
- **Cancelar:** link com token, sem login.
- **Desligado por padrão** até a Política de privacidade citar a finalidade ("novidades e promoções"), o prazo e como cancelar.
- **Limite honesto:** o sistema **não envia e-mail** hoje; a captura apenas guarda. Com o consentimento simples (sem confirmação por e-mail) o ideal é adotar confirmação em duas etapas assim que houver envio. Decisão do PO: qual provedor de e-mail usar para envio.

## 3. Depoimentos e Instagram
- **Depoimentos (manuais):** o ERP cadastra texto, nome (como a pessoa autorizou aparecer), data e uma **caixa "autorização confirmada"**. A loja só mostra os com autorização, como já é feito com os retratos. Nada é criado pelo sistema.
- **Instagram:** a opção rápida e honesta é uma **galeria curada** no ERP (imagem + link para a publicação, até 6 itens). A integração automática exige conta Business ou Creator ligada a uma página do Facebook e um aplicativo da Meta (com revisão); a API antiga de exibição básica foi descontinuada **[CONFIRMAR na documentação da Meta]**. Recomendação: começar curado e só integrar se houver rotina de postagem que justifique.

## 4. Avaliações de compradores
- **Só comprador verificado:** avaliação ligada a um pedido **pago e com entrega combinada**, uma por peça e por pedido. Nota de 1 a 5 e texto curto.
- **Moderação no ERP:** nasce "pendente"; o admin aprova ou recusa; pode responder. Nada aparece sem aprovação.
- **Exibição:** nota média só aparece a partir de um mínimo de avaliações (ex.: 5) para não exibir "5,0 com 1 voto". Nome só o primeiro, com consentimento no envio.
- **Como a cliente avalia sem e-mail do sistema:** pela página do pedido e "Meus pedidos", que já existem.
- **Defesas:** Turnstile, limite de tentativas, bloqueio de avaliação duplicada.
- **Marcação para buscadores (rich results)** só depois de haver avaliações reais.

## 5. Campanhas com preço (contador regressivo, "5% no Pix", parcelas)
- **Por que antes de qualquer contador:** contador regressivo ou "últimas horas" que **não correspondem a uma promoção real** é publicidade enganosa (Código de Defesa do Consumidor, art. 37). O contador só pode refletir uma **campanha real**, com preço de fato diferente e fim de fato real.
- **Desenho:** entidade `campanha` (nome, início, fim, desconto % no canal online, peças ou categorias, ativa). O servidor recalcula o preço no catálogo e **no pedido** (o preço enviado pelo navegador nunca vale); a taxa da plataforma e o financeiro usam o valor realmente cobrado. Fim da campanha = preço volta sozinho.
- **Contador:** só aparece enquanto a campanha estiver ativa, com data de término vinda dela; ao acabar, some.
- **Desconto no Pix e parcelas** entram na mesma estrutura (pendência "b" da auditoria de pagamentos).
- **Decisões do PO:** quem arca com o desconto, se soma com outras regras, se afeta o PDV (sugestão: não afeta), parcelamento com ou sem juros.

## 6. "X pessoas vendo agora"
- **Real ou nada:** contagem de visitantes **simultâneos de verdade** na peça (últimos 2 minutos), sem inflar nem arredondar para cima.
- **Privacidade:** o navegador envia um sinal anônimo com identificador aleatório por aba (sem cookie, sem IP gravado). O servidor guarda só a contagem agregada por peça, em memória.
- **Só mostra a partir de um mínimo** (ex.: 3 pessoas). Com o tráfego atual vai aparecer pouco, e isso é correto; mostrar "1 pessoa vendo" vira ruído.
- **Antes de ligar:** atualizar a Política de privacidade e confirmar que a hospedagem tem uma única instância (a contagem em memória não soma entre instâncias).
- **Recomendação:** deixar por último; só compensa com tráfego.
