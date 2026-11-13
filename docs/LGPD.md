# LGPD: inventário de dados pessoais e atendimento ao titular

Documento técnico de apoio. **Não é parecer jurídico**: bases legais, prazos de retenção e textos precisam ser validados pelo PO e, de preferência, por um advogado. O que está aqui foi levantado do schema e do código em 13/11/2026.

## 1. Quem trata o quê

No modelo multi-tenant, cada loja (empresa) é a **controladora** dos dados dos seus clientes e equipe; o Vertumno/GiroNex atua como **operador** (hospeda e processa por conta da loja). [Confirmar com o PO e o contrato de uso do sistema.]

## 2. Inventário (campos que identificam pessoas)

| Tabela | Campos | Titular | Para quê |
|---|---|---|---|
| `clientes` | nome, `cpf_cnpj`, `email`, `telefone`, `endereco`, `cep`, `data_nascimento` | cliente da loja | cadastro, venda, crediário, contato |
| `pedidos_loja` | `cliente_nome`, `cliente_email`, `cliente_telefone` | cliente da loja online | identificar o pedido e combinar a entrega |
| `usuarios` | nome, `email` | equipe da loja | login e trilha de auditoria |
| `usuarios_dados` | `cpf`, `data_nascimento`, `telefone`, `cep` (e endereço) | equipe da loja | cadastro do colaborador |
| `usuarios_fotos` | foto de perfil | equipe da loja | identificação no sistema |
| `loja_retratos` | foto de pessoa na Home, com trilha da **autorização de uso de imagem** | modelo/pessoa retratada | exibição na vitrine |
| `fornecedores`, `cotacoes_fornecedores` | `cnpj_cpf`, e-mail, telefone | fornecedor (pode ser pessoa física) | compras |
| `plataforma_operadores` | e-mail | operador GiroNex | painel do operador |
| `*_eventos` e logs de auditoria | ids de usuário, ações | equipe | trilha obrigatória; não se apaga para esconder operação |

Dados de cartão **não** são guardados: o pagamento é feito no Mercado Pago.
Subprocessadores conhecidos (a Política de privacidade da loja já cita): Mercado Pago, Cloudflare (Turnstile), hospedagem e banco de dados (Render, Neon).

## 3. Atendimento a pedidos do titular (acesso, correção, anonimização)

| Pedido | O que existe hoje | Lacuna |
|---|---|---|
| Cliente cadastrado pede anonimização | Existe: `anonimizar` em `clientesService` (preserva o histórico de vendas) | nenhuma |
| Cliente da loja online pede anonimização | **Não existe** rotina para `pedidos_loja.cliente_*` | criar procedimento (script administrativo com confirmação, preservando o pedido e a venda) |
| Colaborador sai | Não há exclusão de usuário: **bloqueia-se** (regra do projeto, por causa da trilha) | definir se `usuarios_dados` (CPF, nascimento) é anonimizado após um prazo |
| Pessoa retratada retira a autorização | A tela "Retratos da Home" permite desativar | registrar a retirada na trilha e remover o arquivo |
| Pedido de cópia dos dados | Não há rotina | procedimento manual com consulta por empresa, entregue pelo PO |

Regra: histórico financeiro e operacional **não é apagado**; anonimiza-se o dado pessoal mantendo o registro.

## 4. Decisões que dependem do PO (não definidas no código)
1. **Prazo de retenção** dos dados de pedidos da loja e de clientes sem compra (a Política da loja tem uma seção "Por quanto tempo guardamos"; conferir se o texto bate com a prática).
2. **Canal e responsável** para pedidos de titulares (e-mail de contato publicado e prazo de resposta).
3. **Aviso interno** para colaboradores sobre CPF, endereço e foto.
4. **Incidente de segurança**: quem avisa a ANPD e os titulares, e em quanto tempo (a lei fala em prazo razoável; ver orientação vigente da ANPD).
5. Se for adotada coleta de erros (Sentry etc.), incluir o provedor na Política.

## 5. Próximos passos técnicos sugeridos
1. Rotina administrativa para anonimizar dados pessoais de um pedido da loja (com `dry-run`, filtro por `empresa_id` e registro em evento).
2. Rotina equivalente para `usuarios_dados` de colaborador bloqueado há mais de N meses.
3. Teste de integração para cada rotina, provando que o histórico financeiro permanece.
