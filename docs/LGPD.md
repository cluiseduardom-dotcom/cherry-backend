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

## 3. Prazos de retenção adotados (padrão sugerido, a validar com contador/advogado)

| Dado | Prazo | Depois |
|---|---|---|
| Comprador de pedido **pago** da loja online (nome, e-mail, telefone) | 5 anos após o pagamento | anonimizado; o pedido, o valor e a venda ficam |
| Comprador de pedido **nunca pago** (cancelado ou expirado) | 90 dias após encerrado | anonimizado |
| Colaborador **bloqueado** (CPF, nascimento, endereço, telefone, foto) | 5 anos após o bloqueio | dados e foto removidos; nome e e-mail ficam na trilha de auditoria |
| Cliente cadastrado no ERP | sem prazo automático | anonimização manual pela tela de Clientes (já existe) |
| Trilha de auditoria e histórico financeiro | não se apaga | só o dado pessoal é trocado por marcador |

Base do prazo de 5 anos: prazo de reclamação do consumidor e guarda de registros de venda (CDC e legislação tributária). **Não é parecer jurídico.** Os valores estão em `src/constants/lgpd.js`.
Anonimizar **não apaga cópias de segurança** já feitas: o histórico do Neon (7 dias) expira sozinho e as cópias lógicas (`docs/OPERACAO.md`) têm retenção de 4 semanas.

## 4. Como atender um pedido do titular

Tudo por `scripts/lgpd-anonimizar.js`, **simulação por padrão** (só `--executar` grava). Nunca imprime dado pessoal (só ids, códigos e contagens). Usar o mesmo `DATABASE_URL` do serviço, de um ambiente de confiança.

```bash
# Comprador da loja online (código do pedido está na página do pedido)
node scripts/lgpd-anonimizar.js --empresa <id> --pedido-loja <codigo> --motivo "Pedido do titular em DD/MM/AAAA"
node scripts/lgpd-anonimizar.js --empresa <id> --pedido-loja <codigo> --motivo "Pedido do titular em DD/MM/AAAA" --executar

# Colaborador (precisa estar bloqueado)
node scripts/lgpd-anonimizar.js --empresa <id> --colaborador <usuario_id> --executado-por <id-do-admin> --motivo "..." --executar

# Prazos vencidos (rodar mensalmente: primeiro sem --executar, conferir, depois com)
node scripts/lgpd-anonimizar.js --empresa <id> --retencao --executado-por <id-do-admin> [--executar]
```

Recusas por segurança: pedido aguardando pagamento; pedido pago com entrega ainda não combinada (precisa do contato); colaborador ainda ativo. Cada anonimização deixa um evento na trilha (`pedidos_loja_eventos` ou `usuarios_eventos`). Repetir é seguro (idempotente).

Pedido de **cópia dos dados** (acesso): ainda manual, feito pelo PO com consulta por empresa; não há rotina.

## 5. O que ainda depende do PO
1. Canal e responsável para pedidos de titulares (e-mail publicado e prazo de resposta; a Política da loja remete ao contato do rodapé).
2. Aviso interno aos colaboradores sobre CPF, endereço e foto.
3. Plano de incidente: quem avisa a ANPD e os titulares, e em quanto tempo.
4. Validar os prazos da seção 3 com contador/advogado.
5. Rotina mensal: alguém precisa rodar `--retencao` (hoje é manual; pode virar tarefa agendada depois de validada).
