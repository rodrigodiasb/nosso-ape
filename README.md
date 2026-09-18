# Nosso Apê — v0.2

Segunda base funcional da PWA.

## O que mudou nesta versão

- O dashboard deixou de usar valores fictícios.
- O primeiro usuário pode criar o projeto real do imóvel.
- Valor contratado e data da aquisição passam a vir do Cloud Firestore.
- É possível convidar a segunda pessoa por e-mail + código de convite.
- A segunda conta entra no mesmo projeto usando o código.
- Ambos passam a visualizar o mesmo projeto.
- Tela Projeto / imóvel permite editar os dados básicos.
- Lista de membros vinculados.
- Firestore Security Rules por projeto e membro.
- Estrutura de segurança já reservada para contratos, parcelas, pagamentos, despesas e reservas.

## ORDEM PARA ATUALIZAR

### 1. Atualize PRIMEIRO as regras do Firestore

Firebase Console → Firestore Database → Regras

Apague o conteúdo atual e cole integralmente o conteúdo do arquivo:

`firestore.rules`

Clique em **Publicar**.

### 2. Atualize os arquivos no GitHub

Substitua os arquivos anteriores pelos arquivos desta v0.2.

O arquivo novo mais importante é:

`js/data.js`

### 3. Recarregue o GitHub Pages

O Service Worker mudou de `v01` para `v02`.

Se a versão anterior continuar aparecendo:
- faça recarga forçada (Ctrl + F5), ou
- feche e abra novamente o PWA, ou
- remova e instale novamente o atalho do aplicativo apenas se necessário.

## TESTE A — criar o projeto

Entre com a conta que será usada para criar o projeto.

Como essa conta ainda não tem projeto vinculado, aparecerá uma nova tela:

**Criar projeto | Entrar com convite**

Escolha **Criar projeto**.

Preencha:
- nome do projeto;
- valor contratado do imóvel;
- data do contrato;
- e-mail da outra pessoa.

Ao concluir, será gerado um código semelhante a:

`J7K8Q2PM`

Copie esse código.

## TESTE B — conectar a segunda conta

1. Saia da primeira conta.
2. Entre com a segunda conta.
3. Escolha **Entrar com convite**.
4. Informe o código gerado.
5. A conta deve passar a visualizar o mesmo projeto.

O convite somente pode ser lido/aceito pela conta cujo e-mail seja igual ao e-mail informado na criação do convite.

## TESTE C — acesso compartilhado

Altere o valor do imóvel em:

Mais → Projeto / imóvel

Salve.

Depois entre com a outra conta.

O novo valor deve aparecer para os dois usuários.

## Estrutura criada no Firestore

Após o teste, você verá automaticamente:

```text
users
  └── UID
       └── activeProjectId

projects
  └── projectId
       ├── name
       ├── propertyValue
       ├── ownerUid
       └── members
            ├── UID 1
            └── UID 2

invites
  └── CODIGO
       ├── projectId
       ├── email
       └── status
```

NÃO é necessário criar nenhuma dessas coleções manualmente.

## Próxima versão

A v0.3 será o núcleo financeiro:

- criação de contratos;
- contrato parcelado;
- contrato recorrente variável;
- meta financeira;
- geração automática de parcelas;
- baixa total/parcial;
- identificação de quem pagou;
- auditoria de quem registrou;
- primeiro cálculo real de capital empregado.
