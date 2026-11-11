# Vinhófilos

Aplicação web responsiva para organizar degustações de vinho às cegas: cadastro de participantes, preparação do encontro, registro dos palpites (região, safra, uva, preço e pontuação) e relatório após a revelação.

- **Frontend:** HTML + CSS + JavaScript puro (módulos ES), sem build. Publicado no **GitHub Pages**.
- **Dados:** **Supabase** (PostgreSQL + RLS + funções RPC).
- **Sem login.** Quem cria a degustação recebe uma **chave de controle** secreta, guardada no navegador.

Especificação completa e decisões: [CONTEXT.md](CONTEXT.md).

---

## 1. Testar localmente (modo demonstração)

Com `assets/js/config.js` vazio, o app roda em **modo demonstração**: os dados ficam só no navegador (útil para conhecer a interface).

Módulos ES não funcionam abrindo o arquivo direto (`file://`); use qualquer servidor estático na pasta do projeto, por exemplo:

```bash
npx serve .
```

ou

```bash
python -m http.server 8000
# ou, no Windows sem Python/Node:
powershell -ExecutionPolicy Bypass -File tools\serve.ps1   # http://localhost:8765/
```

e abra `http://localhost:8000` (ou a porta indicada).

## 2. Configurar o Supabase

1. Crie uma conta e um projeto em <https://supabase.com> (plano gratuito atende).
2. No projeto: **SQL Editor → New query**, cole todo o conteúdo de [`supabase/schema.sql`](supabase/schema.sql) e clique em **Run**. O script pode ser executado de novo para atualizar funções e políticas.
3. Em **Project Settings → API** (ou **API Keys**), copie:
   - **Project URL**
   - a chave **pública** (`anon` / `publishable`)
4. Preencha `assets/js/config.js`:

   ```js
   export const SUPABASE_URL = 'https://xxxx.supabase.co';
   export const SUPABASE_ANON_KEY = 'eyJ...';   // ou sb_publishable_...
   ```

> ⚠️ **Nunca** use a chave `service_role` / `secret`. Ela ignora todas as regras de segurança. O app se recusa a iniciar se detectar uma chave secreta.

A chave pública **pode** ficar no repositório: toda a proteção está no banco (RLS + funções).

## 3. Publicar no GitHub Pages

1. Crie um repositório no GitHub e envie o conteúdo desta pasta (a raiz deve conter `index.html`).
2. No repositório: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `main`, pasta `/ (root)`.
3. Aguarde a publicação; o endereço será `https://<usuario>.github.io/<repositorio>/`.

O roteamento usa `#/...` na URL, então não é preciso nenhuma configuração extra de rotas. O arquivo `.nojekyll` evita processamento do Jekyll.

---

## Como funciona a segurança (sem login)

| Dado | Acesso pela chave pública |
|---|---|
| `participants` | Leitura, cadastro e edição (sem exclusão) |
| `tastings` | Leitura apenas de colunas públicas (nome, data, status…). O hash da chave nunca é exposto |
| `tasting_wines`, `tasting_participants`, `wine_guesses` | **Nenhum acesso direto.** Só via funções RPC |

- `create_tasting` gera a chave no banco (24 bytes aleatórios) e armazena somente o **hash SHA-256**. A chave volta uma única vez ao navegador do criador.
- Todas as operações do organizador (`save_tasting`, `set_tasting_participants`, `start_tasting`, `save_guess`, `finish_tasting`, `delete_tasting`, `get_tasting_admin`) validam a chave no banco.
- `get_tasting_public` só devolve vinhos, presentes e palpites quando o status é `finalizada`.
- `ensure_monthly_tastings` cria (uma vez) as degustações mensais do ano, no último domingo, **sem chave**. `claim_tasting` entrega a chave ao **primeiro** que assumir; depois disso só quem tem a chave opera. Sem dono, nenhuma operação do organizador é aceita.
- `set_tasting_organizers` permite a qualquer visitante definir os organizadores (participantes do cadastro) até a degustação ser finalizada.
- A chave não aparece em URLs. O organizador pode copiá-la (painel da degustação → *Chave de controle*) e importá-la em outro aparelho (página da degustação → *Sou o organizador*).

**Limitações conhecidas** (inerentes a um sistema público sem login):

- Quem perder a chave (limpar dados do navegador sem tê-la copiado) perde o controle da degustação.
- Qualquer visitante pode cadastrar/editar participantes e criar degustações; não há proteção contra abuso/spam além dos limites do Supabase.
- Quem tiver a chave tem controle total da degustação.

## Estrutura

```text
index.html
assets/
  css/        base.css · layout.css · components.css (inclui estilos de impressão)
  images/     icon.svg
  js/
    app.js            inicialização e rotas
    router.js         roteador por hash
    config.js         URL e chave pública do Supabase
    services/
      database.js     camada de dados (Supabase) + fachada `api`
      demo-backend.js backend local do modo demonstração
      token-store.js  chaves de controle e preferências no navegador
    modules/
      tastings.js     início, histórico, detalhe/painel do organizador
      participants.js cadastro e seleção/ordem dos presentes
      wines.js        criação/edição da degustação e dos vinhos
      guesses.js      registro de palpites com salvamento automático
      reports.js      relatório, impressão e CSV
    utils/            dom, formatação, erros, sugestões
supabase/schema.sql   tabelas, RLS e funções
```

## Rotas

| Rota | Tela |
|---|---|
| `#/` | Início |
| `#/participantes` | Participantes |
| `#/historico` | Degustações finalizadas |
| `#/degustacao/nova` | Criar degustação |
| `#/degustacao/:id` | Detalhe (público) ou painel do organizador |
| `#/degustacao/:id/editar` | Editar dados e vinhos (organizador) |
| `#/degustacao/:id/participantes` | Participantes do dia e ordem (organizador) |
| `#/degustacao/:id/operar` | Registro de palpites (organizador) |
| `#/degustacao/:id/relatorio` | Relatório (público após finalizar; prévia para o organizador) |

## Teste de aceite rápido

1. Cadastre 3 participantes.
2. Crie uma degustação com 2 vinhos e guarde a chave mostrada.
3. *Participantes do dia*: toque nos nomes na ordem desejada, ajuste com ↑ ↓, salve.
4. *Iniciar degustação* → *Registrar palpites* (modo por participante ou por vinho).
5. Em outra janela anônima, abra a mesma degustação: vinhos e palpites devem estar ocultos.
6. *Finalizar degustação* → confira o relatório na janela anônima, imprima/salve em PDF e exporte o CSV.
