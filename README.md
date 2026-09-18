# Nosso Apê — v0.1

Primeira base funcional da PWA.

## O que já funciona

- Login real pelo Firebase Authentication (e-mail/senha)
- Persistência da sessão
- Recuperação de senha
- Logout
- PWA instalável
- Interface responsiva baseada no protótipo visual
- Dashboard demonstrativo
- Botão central de ações
- Menu "Mais"

## Importante

Nesta versão, os valores do dashboard são **dados de demonstração**.
O Cloud Firestore deve permanecer bloqueado com:

```txt
allow read, write: if false;
```

A próxima etapa será criar a estrutura real do banco e regras de segurança baseadas em projeto + membros.

## 1. Criar os dois usuários

No Firebase Console:

Authentication → Usuários → Adicionar usuário

Crie manualmente uma conta para cada integrante do casal.

Não existe cadastro público na interface desta versão.

## 2. Testar localmente

Como o projeto usa JavaScript Modules, não abra o `index.html` apenas com duplo clique.

Uma forma simples é usar uma extensão de servidor local (por exemplo, Live Server) ou publicar diretamente no GitHub Pages.

## 3. Publicar no GitHub Pages

Envie **o conteúdo desta pasta** para a raiz do repositório.

Depois:

Settings → Pages → Deploy from a branch → `main` → `/ (root)`

## 4. Autorizar o domínio do GitHub Pages no Firebase

Depois que souber a URL final, vá em:

Firebase Console → Authentication → Settings → Authorized domains

Adicione:

`SEU-USUARIO.github.io`

Se futuramente usar domínio próprio, ele também deverá ser autorizado.

## 5. Firestore

NÃO crie coleções manualmente nesta etapa.

A estrutura oficial será criada na v0.2.

## Segurança

O objeto `firebaseConfig` do front-end não é uma senha administrativa.
Não coloque no front-end chaves privadas, credenciais de conta de serviço ou segredos administrativos.

A proteção dos dados será feita pelas Firebase Security Rules e pelo vínculo dos usuários ao projeto.
