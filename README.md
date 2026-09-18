# Nosso Apê — v0.4

Versão de inteligência financeira e financiamento bancário.

## Novidades

- Novo tipo de contrato: **Financiamento bancário**.
- O principal financiado não é somado novamente ao custo real do imóvel.
- Em cada prestação, o pagamento é dividido entre:
  - amortização do principal;
  - juros + seguros + encargos.
- Só a parte de juros/seguros/encargos aumenta os **Custos adicionais**.
- O valor integral da prestação continua compondo o **Capital empregado**.
- Acompanhamento do principal ainda não amortizado.
- Relatórios visuais:
  - custo real conhecido;
  - percentual de custos adicionais sobre o valor do imóvel;
  - capital empregado;
  - saldo em reservas;
  - distribuição do dinheiro por categoria;
  - custos adicionais por categoria;
  - ritmo mensal de aportes;
  - parcelas futuras conhecidas;
  - principal de financiamento ainda não amortizado;
  - compromissos estimados dos próximos 30 dias.

## Atualização

1. Publique primeiro o novo `firestore.rules` no Firebase.
2. Depois substitua os arquivos do GitHub pela v0.4.
3. Aguarde o GitHub Pages publicar.
4. Faça `Ctrl + F5` no computador e feche/abra o PWA no celular.

## Teste recomendado — financiamento

Crie um novo compromisso:

- Tipo: `Financiamento bancário`
- Nome: `Financiamento do apartamento`
- Valor financiado (principal): use um valor de teste
- Número de parcelas: por exemplo 360
- Primeiro vencimento: uma data válida
- Prestação estimada inicial: opcional

Ao registrar uma prestação, informe um exemplo como:

- Total pago: R$ 3.200,00
- Amortização do principal: R$ 1.450,00
- Juros + seguros + encargos: R$ 1.750,00

A soma dos dois componentes precisa ser igual ao total pago.

Resultado esperado:

- `Capital empregado` aumenta R$ 3.200,00.
- `Custos adicionais` aumentam somente R$ 1.750,00.
- `Principal restante` cai R$ 1.450,00.

## Relatórios

Acesse:

`Mais → Relatórios`

Os relatórios trabalham somente com valores já registrados ou conhecidos. O aplicativo não inventa juros futuros do financiamento.

## Compatibilidade

Os contratos, despesas, reservas e pagamentos já cadastrados na v0.3 continuam compatíveis.

## Próxima etapa sugerida

A v0.5 deve priorizar integridade e manutenção dos dados:

- correção/estorno de lançamentos;
- edição controlada de contratos;
- histórico de alterações;
- exportação/backup CSV e JSON;
- calendário financeiro completo.
