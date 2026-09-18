# Nosso Apê — v0.6.2

Correção da v0.6.1: o botão visual de reset financeiro agora aparece corretamente para a conta proprietária do projeto.

## O que o reset preserva

- Projeto do imóvel
- Nome do projeto
- Valor contratado do imóvel
- Data da aquisição
- Usuários
- Associação dos dois membros
- Convites existentes

## O que o reset apaga

- Contratos
- Parcelas
- Pagamentos
- Despesas
- Reservas
- Aportes / movimentações de reservas
- Registros financeiros estornados ou ativos

## Segurança

O reset:

1. aparece somente para o proprietário/criador do projeto;
2. exige digitar `RESETAR`;
3. oferece backup JSON antes da exclusão;
4. não altera o documento do imóvel;
5. não remove usuários ou membros.

## Atualização

### 1. Atualize as regras do Firestore primeiro

Firebase Console → Firestore Database → Regras

Substitua pelas regras deste pacote e clique em Publicar.

A mudança principal é permitir exclusão das coleções financeiras SOMENTE ao proprietário do projeto.

### 2. Atualize o GitHub Pages

Substitua os arquivos atuais pelos da v0.6.1.

O cache foi atualizado para `v061`.

### 3. Para resetar

Entre com a conta que criou o projeto:

Mais → Projeto / imóvel → Resetar dados financeiros

Digite:

`RESETAR`

Mantenha marcada a opção de gerar backup JSON e confirme.

Depois do reset, o dashboard deve manter o valor do imóvel e retornar a zero em:

- custos adicionais;
- capital empregado;
- contratos;
- reservas;
- movimentações;
- próximos vencimentos.

## Observação

A conta da segunda pessoa continua normalmente vinculada ao mesmo projeto após o reset.


## Correção específica da v0.6.2

Na v0.6.1 a função de reset, o modal de confirmação e as regras de exclusão estavam presentes, porém o bloco visual `financialResetZone` não havia sido inserido na tela **Projeto / imóvel**.

A v0.6.2 corrige esse ponto.

### Onde o botão aparece

Entre com a conta que originalmente criou o projeto e acesse:

**Mais → Projeto / imóvel**

Role até o final da tela. Após a área de convite aparecerá:

**ÁREA DE SEGURANÇA → Resetar dados financeiros**

A função permanece invisível para a segunda conta.

### Cache

O Service Worker foi atualizado para `v062`.
