# Comissões — contrato da API e guia para as telas

Este documento é o contrato que o frontend deve seguir. O backend (PR #126) calcula, congela e estorna a comissão; as telas só consultam e configuram. **Nada de cálculo de comissão no frontend.**

## Regras de negócio (para o texto da tela)

- A comissão é **por venda**, gravada quando a venda é finalizada.
- Base de cálculo = **subtotal − desconto** (sem os juros do crediário).
- O percentual fica **congelado** na venda: mudar o percentual depois não altera comissões já geradas.
- Cancelar a venda **estorna** a comissão (ela continua listada, com status `estornada`, e sai dos totais).
- Percentual do vendedor prevalece sobre o **padrão da empresa**. Percentual `0` desliga a comissão daquele vendedor. Sem percentual (nem padrão) = sem comissão.
- Vendas anteriores à ativação do módulo **não têm comissão**.
- Estoquista e faturista não recebem comissão.

## Quem acessa o quê (o backend é a fronteira; o frontend só esconde)

| Rota | Quem | Observação |
|---|---|---|
| `GET /comissoes/minhas` | admin e perfil vendedor (inclui gerente) | Sempre o usuário do token. Nenhum parâmetro escolhe outro usuário. |
| `GET /comissoes/equipe` | quem tem a capacidade `ver_vendas_de_todos` (admin tem todas) | Gerente precisa ter o cargo ligado (ver abaixo). |
| `GET /comissoes/percentuais` | só admin | |
| `PUT /comissoes/percentuais` | só admin | |

Envelope das respostas: sucesso `{ "success": true, "data": ... }`; erro `{ "success": false, "message": "..." }` (400 validação, 401 sem sessão, 403 sem permissão, 404 não encontrado).

## Formatos

Valores monetários e percentuais vêm como **string** (NUMERIC do Postgres), ex.: `"10.00"`, `"5.0000"`. Formatar para exibição; **não somar no cliente** (os totais já vêm prontos do backend). Datas de filtro: `YYYY-MM-DD`.

### `GET /comissoes/minhas?page=1&pageSize=20&data_inicio=2026-10-01&data_fim=2026-10-31`

Todos os parâmetros são opcionais. `pageSize` máximo 100.

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": 12,
        "venda_id": 340,
        "data_venda": "2026-10-23T14:02:11.000Z",
        "percentual": "5.0000",
        "base_calculo": "200.00",
        "valor": "10.00",
        "status": "apurada",
        "criado_em": "2026-10-23T14:02:11.000Z",
        "estornado_em": null
      }
    ],
    "totais": { "total_base": "200.00", "total_comissao": "10.00", "total_estornado": "0" },
    "page": 1,
    "pageSize": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

- `status`: `apurada` | `estornada`.
- `totais` cobrem **todo o filtro** (não só a página). `total_base` e `total_comissao` somam só as apuradas; `total_estornado` soma as estornadas.
- `total` (número) = quantidade de comissões no filtro, apuradas + estornadas.

### `GET /comissoes/equipe?data_inicio=...&data_fim=...`

Sem paginação. Ordenado por `total_comissao` decrescente. Inclui quem não vendeu no período. Não inclui estoquista/faturista.

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "usuario_id": 2,
        "nome": "Ana",
        "cargo": "vendedor",
        "percentual": "5.0000",
        "quantidade_vendas": "3",
        "total_base": "300.00",
        "total_comissao": "15.00",
        "total_estornado": "0"
      }
    ],
    "totais": { "total_base": "300.00", "total_comissao": "15.00", "total_estornado": "0.00" }
  }
}
```

- `percentual` é o vigente (próprio ou herdado do padrão); `null` = sem comissão configurada.
- `quantidade_vendas` vem como string (converter com `Number`).

### `GET /comissoes/percentuais` (admin)

```json
{
  "success": true,
  "data": {
    "padrao": "3.0000",
    "usuarios": [
      { "usuario_id": 2, "nome": "Ana", "cargo": "vendedor", "percentual": "5.0000" },
      { "usuario_id": 3, "nome": "Bia", "cargo": "vendedor", "percentual": null }
    ]
  }
}
```

- `padrao: null` = a empresa não definiu padrão.
- `usuarios[].percentual: null` = o vendedor **herda o padrão**.

### `PUT /comissoes/percentuais` (admin)

```json
{ "usuario_id": 2, "percentual": 5 }
```

- `usuario_id` omitido ou `null` → define o **padrão da empresa**.
- `percentual`: número de 0 a 100, até 4 casas decimais (enviar `number`, não string). `null` → **remove** a regra (o vendedor volta a herdar o padrão; no caso do padrão, a empresa fica sem padrão).
- Campos extras são recusados (400). Resposta: `{ "usuario_id": 2, "percentual": "5.0000" }` (ou `percentual: null` ao remover).
- Erros: 400 (percentual inválido, ou usuário que não vende), 404 (usuário inexistente ou de outra empresa).
- Alterar o percentual vale só para vendas **futuras**. Avisar isso na tela.

## Integração no frontend existente (verificado no código atual)

- `src/config/access.js`: registrar `'/comissoes'` em `ALLOWED_ROLES_BY_PATH` com `['admin', 'vendedor']`. O gerente tem `user.role === 'vendedor'` (perfil legado).
- `src/App.jsx` **lança erro ao carregar** se uma rota está em `access.js` e não em `ROUTE_COMPONENTS` (e vice-versa): registrar nos dois.
- `src/components/Sidebar.jsx`: incluir a rota em `NAV_META_BY_PATH` (ícone, rótulo, seção). Sem a entrada o item de menu sai quebrado. Opcional: item em `src/pages/Mais.jsx` para o menu mobile.
- Uma única página `/comissoes` com abas conforme o perfil:
  - **Minhas comissões**: todos que acessam a página.
  - **Equipe**: só se `useAuth().temCapacidade('ver_vendas_de_todos')` (admin passa).
  - **Percentuais**: só se `user.role === 'admin'` (o backend usa `role === 'admin'`).
- Estados obrigatórios: carregando, vazio ("nenhuma comissão no período"), erro (mostrar `message` do backend sem mascarar). `estornada` deve se diferenciar por **texto/ícone**, não só por cor.
- Filtro de período com padrão no mês atual; enviar `YYYY-MM-DD`.

## Atenção: o cargo Gerente precisa ser ligado

O cargo `gerente` já existe no catálogo, mas vem **desligado por padrão** em cada empresa. O frontend atual **não tem tela de cargos**: `'/configuracoes/cargos'` aparece em `access.js` só como regra de capacidade, sem página, e não há serviço de cargos. Enquanto não existir a tela, ligar o cargo é via API (`GET /cargos`, `PUT /cargos/:cargo`, exige `gerir_cargos`; admin tem todas). Sem isso, nenhum usuário consegue ser gerente e a aba **Equipe** só aparece para o admin.

## O que não existe (fora do escopo desta entrega)

- Fechamento/pagamento de comissão ("marcar como paga").
- Comissão de vendas anteriores à ativação.
- Percentual por categoria, meta escalonada ou comissão por recebimento.
