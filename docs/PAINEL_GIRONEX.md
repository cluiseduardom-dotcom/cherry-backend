# Painel GiroNex — operação da plataforma

O Painel GiroNex é a área de **operação da plataforma**: planos e condições comerciais, taxa a receber,
identidade visual (tema e endereço `/c/<slug>`) e criação de empresas. Ele é **separado do ERP**:
quem opera a plataforma não é usuário de loja, e uma credencial de loja nunca abre o painel.

## Por que separado

Até aqui, essas telas ficavam dentro do ERP, liberadas para um usuário de loja com `plataforma_admin`.
Quem tomasse essa senha controlava planos, taxas e identidade de **todas** as empresas pela mesma tela
de vendas. O painel tira esse poder do ERP.

## Arquitetura

| Item | ERP (lojas) | Painel GiroNex |
|---|---|---|
| Quem entra | `usuarios` (com `empresa_id`) | `plataforma_operadores` (sem empresa) |
| Rotas | todas as demais | `/painel/*` |
| Assinatura da sessão | `JWT_SECRET` | `PAINEL_JWT_SECRET` (obrigatoriamente diferente) + `aud: gironex-painel` |
| Duração da sessão | 8 h | 30 min (`/painel/auth/renovar`) |
| Segundo fator | não | **obrigatório** (TOTP, app autenticador) |
| Trilha | por módulo | `plataforma_eventos` (só-inserção) |

Um token do ERP é recusado no painel (assinatura e `aud` diferentes) e um token do painel é recusado no
ERP (testes de integração em `tests/routes/painelGironex.integration.test.js`).

## Login

E-mail + senha + código de 6 dígitos (Google Authenticator, Microsoft Authenticator, Authy, 1Password…).

1. **Primeiro acesso:** a senha (temporária) devolve só um token de configuração (10 min). O painel mostra
   o segredo / link `otpauth://`; o operador cadastra no app e confirma com o primeiro código. Só então a
   sessão nasce, e com senha temporária ela só permite **trocar a senha** (mín. 12 caracteres).
2. **Demais acessos:** os três juntos. Erro em qualquer um → a mesma mensagem (sem dizer qual errou).
   O mesmo código não vale duas vezes. Limite: 5 tentativas por conta e 20 por IP a cada 15 min.

O segredo TOTP fica **cifrado** no banco (AES-256-GCM com `PAINEL_ENC_KEY`).

## Variáveis de ambiente (backend)

| Variável | Valor |
|---|---|
| `PAINEL_JWT_SECRET` | ≥ 32 caracteres aleatórios, diferente de `JWT_SECRET` |
| `PAINEL_ENC_KEY` | 32 bytes aleatórios em base64 (`openssl rand -base64 32`) |
| `PAINEL_CORS_ORIGINS` | endereço do frontend do painel (ex.: `https://gironex-painel.onrender.com`); somado à allowlist `CORS_ORIGINS` do ERP, que não muda |

Sem `PAINEL_JWT_SECRET`/`PAINEL_ENC_KEY` válidos, **todo** `/painel` responde 503 (falha fechada).
Trocar `PAINEL_ENC_KEY` invalida os 2FA cadastrados (resetar e configurar de novo).

## Operadores (sem tela, de propósito)

```
DATABASE_URL=... npm run painel:operador -- criar "Nome Completo" email@dominio
DATABASE_URL=... npm run painel:operador -- resetar-2fa email@dominio   # celular perdido
DATABASE_URL=... npm run painel:operador -- bloquear email@dominio
```

`criar` mostra uma senha temporária uma única vez. Tudo vai para `plataforma_eventos`.

## Criação de empresa

`POST /painel/empresas` `{ empresa_nome, cnpj?, nome_admin, email_admin }` cria a empresa, os padrões
(canais, financeiro, SKU) e o admin com **senha temporária aleatória**, devolvida uma vez ao operador para
entregar ao cliente por canal seguro. O admin é obrigado a trocá-la no primeiro acesso. Nenhum token de
loja é emitido. O login (código de usuário) do admin é gerado pelo nome. Tema e endereço da marca ficam na
tela de identidade.

## Rotas

`/painel/auth/{login,2fa/iniciar,2fa/confirmar,me,renovar,senha}`, `GET /painel/taxas`, `GET /painel/planos`,
`GET /painel/empresas/comercial`, `GET /painel/empresas/identidade`, `GET /painel/empresas/:id/{comercial,identidade}/historico`,
`POST /painel/empresas`, `POST /painel/empresas/:id/{plano,condicao,condicao/encerrar}`,
`PATCH /painel/empresas/:id/identidade`, `GET /painel/eventos`.

As ações de plataforma usam os serviços de planos, taxas e identidade (antes expostos em `/plataforma`); o responsável gravado é
`painel:<email> (#<id do operador>)`.

## Etapas

1. **Este backend** (rotas `/painel`, operadores, 2FA, trilha, criação de empresa).
2. **Frontend** no repositório `gironex-painel`, com deploy próprio e domínio da GiroNex.
3. **Limpeza do ERP** (feita): as rotas `/plataforma/*` e o middleware `requirePlataformaAdmin` foram removidos
   (agora respondem 404), e `plataforma_admin` deixou de ser lido ou devolvido (`/auth/me`, login, sessão). As telas
   `Planos e condições` / `Taxas a receber` saem do ERP no PR de frontend correspondente.
   A coluna `usuarios.plataforma_admin` foi removida pela migration `088` (autorizada pelo PO; snapshot Neon
   `pre-088-drop-plataforma_admin` tirado antes).
   Ordem de deploy: **frontend do ERP primeiro**, depois este backend (o ERP antigo ainda chama `/plataforma`).
