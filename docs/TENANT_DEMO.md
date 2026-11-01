# Tenant de demonstração (staging)

Empresa fictícia **Vertumno Demo** para mostrar o sistema a clientes, no **staging**. Nunca em produção.

## O que é criado
- Empresa `Vertumno Demo`, tema `vertumno`, endereço `/c/demo`.
- 3 usuários (mesma senha): `admin@demo.example`, `vendedor@demo.example`, `estoquista@demo.example`.
- 6 clientes, 12 produtos (estoque inicial 120 no Central, preços no canal da loja), 24 vendas finalizadas nos últimos ~60 dias com Pix, dinheiro, débito e crédito.
- O produto `Chaveiro Promo` tem custo maior que o preço e nunca é vendido, de propósito (alerta de prejuízo e produto parado).
- Determinístico: toda restauração produz os mesmos dados. Não grava `taxas_venda`, então não aparece na taxa da plataforma.

## Como restaurar (voltar ao estado original)
`scripts/demo/restaurar-demo.sql` faz **arquivar + recriar**: a demonstração atual vira `Vertumno Demo (arquivada #<id>)`, fica inativa, perde o endereço e seus usuários são desativados e renomeados (`arquivado-<id>-...`); em seguida uma empresa nova é criada do zero. Nada é apagado, porque o histórico imutável do sistema (cancelamentos, comissões, trilha de usuários) impede `DELETE` e a regra do projeto é não apagar histórico.

1. Gere uma senha aleatória e o hash bcrypt: `node -e "console.log(require('bcrypt').hashSync(process.argv[1], 10))" '<senha>'`.
2. Substitua `__SENHA_HASH__` no SQL pelo hash (nunca pela senha) e execute o arquivo **inteiro, uma vez**, no banco do **staging** (uma transação: ou tudo, ou nada).
3. Entregue a senha por canal seguro. O hash e a senha não vão para o repositório.

## Limites
- O staging acumula as demonstrações arquivadas (poucas linhas cada); aceitável em staging.
- O script não foi pensado para produção: cria usuários com e-mail conhecido.
- Dados criados pelos visitantes durante a demonstração ficam na empresa arquivada após a restauração.
