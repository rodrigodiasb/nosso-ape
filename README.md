# Nosso Apê — v0.6

Versão focada em **Calendário Financeiro e Fluxo Futuro**.

## O que entrou

- Card de Agenda Financeira no dashboard.
- Total e quantidade de compromissos vencidos.
- Visões de próximos 7, 30, 60 e 90 dias.
- Calendário mensal navegável.
- Destaque visual de hoje, vencimentos e atrasados.
- Toque em um vencimento abre diretamente a tela de pagamento.
- Seleção de um dia mostra todos os compromissos daquele dia.
- Projeção visual dos próximos 12 meses.
- Identificação do mês de maior saída conhecida.
- Parcelas parcialmente pagas entram somente pelo saldo restante.
- Financiamentos usam a prestação estimada conhecida; valores não informados ficam como “a confirmar”.
- Contratos recorrentes com valor mensal estimado entram na projeção sem criar lançamentos falsos no Firestore.
- Backup JSON atualizado para schemaVersion 0.6.

## Importante: não há alteração nas regras do Firestore

A v0.6 usa somente os dados que a v0.5 já estava autorizada a ler. Portanto:

**não é necessário publicar novas regras no Firebase nesta versão.**

O arquivo `firestore.rules` permanece no ZIP apenas como referência e é idêntico ao da v0.5.

## Atualização

1. Faça um backup JSON pela v0.5 antes da atualização.
2. Substitua no GitHub todos os arquivos da v0.5 pelos arquivos da v0.6.
3. Aguarde o GitHub Pages concluir a publicação.
4. Faça `Ctrl + F5` no computador.
5. No PWA do celular, feche completamente e abra novamente.

O cache do Service Worker mudou de `v05` para `v06`.

## Teste recomendado

Use um contrato parcelado já existente ou crie um de teste com vencimentos próximos.

Valide:

- Agenda Financeira aparece no dashboard.
- “30 dias” soma apenas os saldos ainda não pagos.
- Parcela vencida aparece em vermelho.
- Ao tocar em um dia do calendário, os compromissos daquele dia aparecem abaixo.
- Ao tocar em um compromisso, a tela de pagamento abre com contrato/parcela selecionados.
- Após registrar o pagamento e reabrir o calendário, a parcela quitada desaparece da agenda.
- A projeção de 12 meses se reorganiza automaticamente.

## Limite intencional da projeção

A aplicação não inventa juros futuros, tarifas ou valores ainda desconhecidos. Quando um financiamento não possui prestação estimada conhecida, o compromisso continua visível, mas o valor aparece como `A confirmar`.

Contratos recorrentes são projeções gerenciais; eles não criam parcelas no banco. Quando um pagamento desse contrato é registrado em determinado mês, a estimativa daquele mês deixa de aparecer no calendário.
