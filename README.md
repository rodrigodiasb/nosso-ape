# Nosso Apê — v0.3

Núcleo financeiro real do projeto.

## O que já funciona

- Contrato parcelado com geração automática de até 480 parcelas.
- Contrato recorrente/variável, adequado para juros de obra.
- Meta/reserva financeira, adequada para móveis planejados.
- Aporte em reserva com identificação de quem colocou o dinheiro.
- Pagamento total ou parcial de parcelas.
- Pagamento de contrato recorrente.
- Pagamento direto ou usando saldo de uma reserva.
- Despesa avulsa: cartório, certidões, taxas, banco, reforma etc.
- `registeredBy` automático: quem deu baixa fica auditado pelo UID do login.
- `shares`: registra quanto cada pessoa efetivamente aportou.
- Dashboard real: valor do imóvel, custos adicionais, custo real conhecido, capital empregado, aportes e próximos vencimentos.
- Extrato de movimentações.
- Tela de conquista quando uma meta/reserva ou contrato parcelado chega a 100%.

## Regra contábil usada

`Custo real conhecido = valor do imóvel + custos adicionais já reconhecidos`

`Capital empregado = pagamentos + despesas + saldo atual das reservas`

Quando uma reserva é usada para pagar algo, o saldo da reserva cai e o pagamento/despesa aumenta. Portanto, o capital empregado não é contado duas vezes.

## Atualização

1. Firebase Console → Firestore Database → Regras.
2. Substitua pelas regras do arquivo `firestore.rules` desta versão e clique em Publicar.
3. Depois substitua os arquivos do GitHub pelos arquivos da v0.3.
4. Aguarde o GitHub Pages publicar e faça `Ctrl + F5`.

## Primeiro teste recomendado

Crie:

### Entrada do apartamento
- Tipo: Parcelado
- Categoria: Aquisição
- Como entra no custo real: Parte do valor do imóvel
- Valor total: valor real da entrada
- Quantidade: 23
- Primeiro vencimento: data real

O aplicativo gerará as 23 parcelas.

### Juros de obra
- Tipo: Recorrente / valor variável
- Categoria: Juros de obra
- Como entra no custo real: Custo adicional

Cada pagamento de juros aumentará automaticamente `Custos adicionais` e `Custo real conhecido`.

### Móveis planejados
- Tipo: Meta / reserva financeira
- Categoria: Móveis
- Meta financeira: valor que vocês querem juntar

Cada aporte aumentará o `Capital empregado`, mas não o custo real enquanto o dinheiro estiver apenas reservado.

## Atenção sobre financiamento

Nesta versão, se o financiamento for cadastrado como `Parte do valor do imóvel`, as parcelas não são somadas novamente ao custo real, evitando duplicar o preço do apartamento. Juros bancários embutidos em financiamento ainda não são separados automaticamente entre principal e juros. Esse refinamento poderá entrar em uma versão posterior.
