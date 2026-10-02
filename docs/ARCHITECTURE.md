# VERTUMNO — Arquitetura atual

## Backend
- Node.js
- Express
- PostgreSQL
- API REST
- Autenticação com JWT
- Hash de senha com bcrypt
- Validação com Zod
- Jest + Supertest
- Migrations executadas pelo projeto
- Helmet, CORS e rate limiting fazem parte da camada de aplicação.

## Organização
O backend separa responsabilidades entre:
- routes
- controllers
- services
- repositories
- validations
- middlewares
- database/migrations
- tests

## Módulos atualmente expostos pela aplicação
Entre as rotas existentes estão:
- auth
- onboarding
- produtos
- vendas
- clientes
- canais de venda
- dashboard
- contas a pagar
- contas a receber
- fornecedores
- categorias
- níveis de categoria
- configuração de SKU
- compras
- produções
- despesas fixas
- configurações financeiras
- financeiro
- pagamentos
- parcelas

## Princípio arquitetural
O VERTUMNO deve ser configurável por empresa sempre que uma regra puder variar entre negócios, evitando colocar regras específicas de um segmento diretamente no código.

## Integração entre módulos
Uma funcionalidade não deve ser considerada completa apenas por possuir uma tela ou endpoint. Deve-se avaliar seus efeitos nos módulos relacionados, especialmente estoque, vendas, pagamentos, financeiro e histórico.
