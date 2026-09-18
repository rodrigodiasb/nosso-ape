# Nosso Apê — v0.5

Versão de integridade financeira, estornos e backup.

## O que entrou

- Estorno seguro de pagamentos, despesas e aportes em reservas.
- Nenhum lançamento financeiro é apagado: o original permanece visível como **ESTORNADO**.
- Registro de quem realizou o lançamento e de quem realizou o estorno.
- Motivo obrigatório para o estorno.
- Reversão automática dos efeitos financeiros do lançamento:
  - parcela;
  - amortização do financiamento;
  - custos adicionais;
  - capital empregado;
  - participação individual;
  - saldo de reservas.
- Proteção contra estorno de aporte já consumido por uma reserva.
- Exportação de backup completo em JSON.
- Exportação de movimentações em CSV compatível com Excel.
- Regras do Firestore mais restritivas: lançamentos financeiros não podem ter valor/data/pagadores adulterados após a criação; somente campos de estorno podem ser acrescentados.

## Atualização

### 1. Publique PRIMEIRO as novas regras

Firebase → Firestore Database → Regras

Cole integralmente o arquivo `firestore.rules` desta versão e clique em **Publicar**.

### 2. Atualize o GitHub Pages

Substitua os arquivos pelos da v0.5.

O Service Worker foi alterado para `v05`.

Depois use `Ctrl + F5`. No celular, feche a PWA completamente e abra novamente.

## Teste recomendado

Use um valor pequeno de teste para não interferir nos dados reais.

1. Crie uma despesa de R$ 1,00.
2. Abra **Gastos / Movimentações**.
3. Toque na despesa.
4. Informe como motivo: `Teste de estorno da v0.5`.
5. Toque em **Estornar lançamento**.

Resultado esperado:

- a despesa continua aparecendo no histórico como **ESTORNADO**;
- o valor deixa de compor o capital empregado;
- o valor deixa de compor o custo adicional, se estava marcado para compor;
- aparece quem realizou o estorno e o motivo;
- a outra conta também visualiza o lançamento estornado.

### Teste de reserva

Se um gasto pago com uma reserva for estornado, o dinheiro deve retornar para o saldo disponível da reserva.

Se tentar estornar um aporte em reserva cujo dinheiro já foi usado, o aplicativo bloqueia e orienta a estornar primeiro o gasto/pagamento vinculado.

## Backup

Acesse:

**Mais → Backup e exportação**

Há duas opções:

- **JSON:** cópia completa do projeto e estrutura financeira para segurança/recuperação futura.
- **CSV:** extrato de movimentações para abrir no Excel, incluindo lançamentos ativos e estornados.

## Estratégia adotada para correções

Nesta versão não existe edição silenciosa de valores financeiros já registrados.

A correção segura é:

1. estornar o lançamento incorreto;
2. manter o registro original para rastreabilidade;
3. cadastrar um novo lançamento com o valor correto.

Isso reduz o risco de perda de histórico e inconsistência nos totais.

## Próxima versão sugerida

v0.6 — calendário financeiro e previsões:

- calendário mensal;
- vencimentos por dia;
- próximos 7/30/60/90 dias;
- visão de fluxo de caixa futuro;
- alertas visuais de parcelas próximas e vencidas;
- preparação para notificações locais da PWA.
