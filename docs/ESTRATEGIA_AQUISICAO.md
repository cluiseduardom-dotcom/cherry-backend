# Estratégia de aquisição de clientes — Vertumno / GiroNex

Estado: proposta para decisão do PO (14/11/2026). Parte de uma conversa externa (Google) sobre atrair vendedores informais e MEIs, reavaliada contra o que o Vertumno **realmente tem hoje**. Nada aqui altera código.

## 1. Veredito sobre a conversa externa

| Ponto da conversa | Avaliação |
|---|---|
| Atacar "informais, sacoleiras, MEI, artesãs" ao mesmo tempo | **Largo demais.** Um produto que ainda se vende na mão precisa de um nicho em que ele já é a melhor resposta. |
| "Sem barreira de CNPJ / MEI não pede nota" | **Meia verdade.** MEI é dispensado de nota para pessoa física, mas a NF-e é exigida na venda para empresa. O Vertumno **ainda não emite nota** (ver `docs/` e a análise fiscal). Não prometer. |
| Abordagem direta consultiva (diagnóstico, 14 dias, setup feito por você) | **Boa e compatível** com o que existe: a criação de empresa (tenant) é privilegiada, feita pela GiroNex; **não há cadastro público**. Quem entra, entra com ajuda sua. |
| "R$ 2,65 por dia" | **Conta errada:** R$ 79 ÷ 30 = **R$ 2,63**. Mostrar a conta certa; número errado destrói confiança. |
| Conteúdo em vídeo mostrando a tela | **Bom**, e já há o tenant de demonstração (`docs/TENANT_DEMO.md`). Os vídeos devem usar só o que existe. |
| Prova social por depoimento | **Exige consentimento escrito.** Print de cliente com nome é dado pessoal. |
| DM em massa no Instagram/WhatsApp | **Risco real:** bloqueio da conta, e abordagem de desconhecidos pede cuidado com a LGPD (interesse legítimo, opção de parar). Volume baixo, personalizado, uma conversa por vez. |

## 2. O que o Vertumno tem de diferente (verificado no repositório)
Não é "ERP genérico para sacoleira". O diferencial concreto é **a operação de revenda de produto físico com consignado**:

- Estoque por **local** (Central, **maleta**, consignado, reserva) com transferência e acerto: `docs/ESTOQUE_LOCAIS.md`.
- **Comissão** por vendedor/revendedora com liberação conforme o recebimento: `docs/COMISSOES_API.md`.
- **Crediário** com parcelas e contas a receber por parcela (PDV).
- **Pix com Mercado Pago** e link de cartão no PDV, e **loja online** própria.
- **Clientes**, financeiro, análise (ponto de equilíbrio) e plano por funcionalidade.
- Uma **referência real**: a Cherry Semijoias, que usa tudo isso.

Isso aponta para **um nicho**: **quem vende semijoias, bijuterias e acessórios por revendedoras/maletas** (o ecossistema de Limeira e de marcas que trabalham com revendedoras). É o caso que o produto resolve melhor que planilha, e onde a Cherry pode servir de prova.

## 3. O que NÃO prometer (ainda)
Nota fiscal, integração com maquininha, Mercado Livre, cobrança automática de mensalidade, cadastro por conta própria, "Meu Fiado" (ainda é projeto). Cada promessa que o produto não cumpre vira cancelamento no 1º mês.

## 4. Estratégia proposta

**Meta (90 dias):** 10 clientes pagando, de **um** nicho, com 5 deles ativos 30 dias seguidos.

### Fase 0 — preparar (1 semana, sem desenvolvimento)
1. **Definir a oferta** (decisão do PO): o que cada plano inclui e o preço de lançamento; qual condição para os 10 "clientes fundadores" (preço travado por X meses em troca de feedback e, se quiser, depoimento com consentimento).
2. **Roteiro de demonstração de 10 minutos** no tenant Demo, no fluxo: cadastrar peça → colocar na maleta → vender (Pix e crediário) → ver comissão → ver o que falta receber.
3. **Caso Cherry** (com sua permissão): 3 números reais e verdadeiros (por exemplo, tempo que a equipe economiza, vendas por Pix), sem expor dado de cliente.
4. **Página simples** (`vertumno.com.br`): o que faz, para quem, como pedir demonstração (WhatsApp). Os planos já têm rota pública (`/publico/planos`).

### Fase 1 — 20 conversas (semanas 2–5)
- Fontes de lista (gratuitas): lojas e revendedoras de semijoias no Instagram; grupos de revenda; fornecedores de Limeira que têm rede de revendedoras (parceria, não spam).
- **Uma mensagem curta e personalizada**, só com pergunta: "como você controla maleta e quem ainda deve?". Sem link na 1ª mensagem. Parar se disser que não.
- **Demonstração de 15 min** com os dados dela (uma peça e uma venda reais, feitos juntos).
- **Piloto de 14 dias**, com setup feito por você (importar planilha, até 30 peças).

### Fase 2 — converter e provar (semanas 6–12)
- Medir por cliente: **ativação** (1ª venda registrada até o dia 7), **retenção** (uso na semana 4), **conversão** (paga no dia 15).
- Depoimento e vídeo curto **somente com consentimento**.
- Indicação: quem indica ganha mês de desconto (só depois de 3 clientes satisfeitos).

## 5. Números a acompanhar (planilha simples)
| Métrica | Como medir | Alvo inicial |
|---|---|---|
| Conversas iniciadas | contagem | 20 |
| Demonstrações feitas | contagem | 10 |
| Pilotos iniciados | contagem | 6 |
| Ativação no dia 7 | % dos pilotos | ≥ 60% |
| Conversão em pago | % dos pilotos | ≥ 40% |
| Horas gastas por cliente | você mesmo | < 3 h até a ativação |

Os alvos são **hipóteses**; ajuste depois das primeiras 10 conversas.

## 6. Capacidade (a restrição verdadeira)
Você é uma pessoa só, com poucas horas por dia. Como o cadastro de empresa é feito por você e a cobrança de mensalidade ainda não é automática, **o limite realista hoje é de poucos clientes ao mesmo tempo**. Isso é compatível com a meta de 10, e incompatível com um plano de R$ 9,99 que dependa de cadastro por conta própria (ver `docs/FIADO_NO_VERTUMNO.md`).

## 7. Preço
O texto externo usa R$ 79 e R$ 129. Antes de fixar:
1. **Verifique concorrentes** no momento da decisão (planos e preços mudam; não usei tabela de concorrente aqui porque não pesquisei).
2. Considere que o Vertumno também ganha com a **taxa do Pix** da loja (política vigente em `docs/TAXA_PLATAFORMA.md`), então o preço da mensalidade não precisa carregar toda a receita.
3. Decida **nome dos planos** públicos (Semente, Cultivo, Pomar já existem em `PLANOS_PUBLICOS.md`).

## 8. Decisões que preciso de você
1. Nicho único para os 90 dias: **semijoias/acessórios com revendedoras** (recomendado), ou outro?
2. Preço e condição dos clientes fundadores.
3. Posso usar a Cherry como caso (quais números e quais não)?
4. Cadastro por conta própria e cobrança automática entram antes ou depois dos 10 primeiros? (Recomendo **depois**: com 10 clientes, o cadastro manual basta.)
