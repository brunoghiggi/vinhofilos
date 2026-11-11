# Vinhófilos — instruções para o Claude

## Idioma
Responda **sempre em português do Brasil**, inclusive resumos, perguntas e botões.

## O que é
App web responsivo para degustações às cegas de vinho. Especificação completa e decisões tomadas: **[CONTEXT.md](CONTEXT.md)** (leia a §14 — restrições — e a §17 — decisões — antes de mudar qualquer coisa). Instalação e publicação: [README.md](README.md).

## Regras do projeto (resumo da §14)
- Sem login/senha. Controle do organizador por chave secreta (token) guardada no navegador; o banco guarda só o hash sha256.
- localStorage **não** é o banco compartilhado (só guarda tokens e o modo demonstração).
- Regras valem no banco (RLS, grants, funções `SECURITY DEFINER` em `supabase/schema.sql`), não só na interface.
- Nunca colocar chave `service_role` / `sb_secret_` no código (o app se recusa a iniciar se detectar).
- Não inventar regra de pontuação/ranking sem validar com o responsável; registrar pendências.
- **Atualizar o CONTEXT.md sempre que uma decisão mudar.**

## Arquitetura
- HTML/CSS/JS puro com módulos ES, sem build. Roteamento por hash (`#/...`) para GitHub Pages (`.nojekyll`).
- `assets/js/config.js` vazio ⇒ **modo demonstração** (`services/demo-backend.js`, que espelha as regras do SQL sobre localStorage). Preenchido ⇒ Supabase (`services/database.js`, supabase-js 2.45.4 via jsDelivr).
- Módulos: `tastings.js` (início, histórico, detalhe), `participants.js` (cadastro e presença/ordem), `wines.js` (formulário da degustação), `guesses.js` (operação/palpites com salvamento automático), `scoring.js` (regras de acerto e rankings — mudar só `RULES`), `reports.js` (relatório, impressão, CSV).
- `utils/dom.js`: use `h()` / `append()` (ignoram null/false; nunca inserir HTML cru).

## Decisões já fechadas (detalhes na §17)
- Notas: escala fixa **50 a 100, só inteiros** (app + banco).
- Rankings: participantes por pontos de acerto; vinhos por nota média; empates dividem a posição.
- Acertos: 1 ponto por item (região, uva, safra, preço). Região/uva: um texto contém o outro (sem acento/maiúscula; palpite < 3 letras só se idêntico). Safra exata. Preço até 15% do **preço cheio**. Item sem dado real não conta.
- Palpite: ordem Região, Uva, Safra, Preço, Pontuação; **safra opcional** (não entra no "completo"); **sem campo Observações**.
- Degustações mensais automáticas no **último domingo**, ano corrente inteiro (`ensure_monthly_tastings`, chamada na tela inicial). Nascem **sem chave**: o primeiro que "Assumir organização" recebe a chave (`claim_tasting`). Não podem ser excluídas.
- Organizadores: participantes do cadastro (até 10), editáveis por **qualquer pessoa** até finalizar (`set_tasting_organizers`). Independentes de quem tem a chave.
- Ordem dos participantes durante a degustação: botão "Reordenar" na tela de palpites, arrastar para os lados.
- `creator_token_hash` agora pode ser nulo: qualquer função nova que valide chave deve usar `_assert_creator` (que recusa hash nulo), nunca comparar o hash direto.

## Como testar localmente
Sem Python/Node no Windows: `powershell -ExecutionPolicy Bypass -File tools\serve.ps1` e abrir http://localhost:8765/. Nesta máquina o `HttpListener` do PowerShell é bloqueado ("Acesso negado"); alternativa: `perl tools/serve.pl . 8766 demo` (o `demo` serve um `config.js` vazio ⇒ modo demonstração, sem tocar no banco real). Com `config.js` preenchido, o app local já grava no Supabase real (para o modo demonstração, esvazie temporariamente o `config.js`).

## Supabase (produção)
- Organização **Vinhofilos** (plano Free), projeto **vinhofilos**, ref `gyaxczqrsxjlesuamifo`, região Americas.
- Painel: https://supabase.com/dashboard/project/gyaxczqrsxjlesuamifo
- `config.js` usa a chave **publishable** (`sb_publishable_...`). A senha do banco foi gerada pelo Supabase e não está guardada aqui (pode ser redefinida em Settings → Database).
- `schema.sql` foi executado em 11/11/2026 e também está salvo como snippet no SQL Editor. Ao mudar o schema, rode o arquivo inteiro de novo (ele é idempotente).

## Estado (11/11/2026)
- Fluxo completo testado no modo demonstração (desktop e celular).
- Banco real testado via API com a chave pública (19 verificações: cadastro, criação/token, chave errada recusada, ocultação antes de finalizar, sem acesso direto às tabelas privadas, hash não exposto, nota fora de 50–100 recusada, revelação e bloqueio após finalizar). Dados de teste apagados.
- Site publicado testado contra o banco real usando o próprio `database.js` (cadastro, criação, palpite, ocultação, finalização) e a tela de relatório renderizou corretamente. Dados de teste apagados.
- **Não testado:** o fluxo completo clicando na interface publicada (formulários, operação de palpites, celular). Fazer o teste de aceite do README no site.
- Publicado no GitHub Pages (branch `main`, raiz): https://brunoghiggi.github.io/vinhofilos/ — repositório público https://github.com/brunoghiggi/vinhofilos. Todo `git push` em `main` republica o site em ~1 min.
- Git local: o proxy corporativo intercepta SSL; o repositório usa `http.sslBackend=schannel` (config local) para o push funcionar. Autor dos commits: e-mail noreply do GitHub, não o corporativo.
- Pendências restantes estão marcadas **PENDENTE** no CONTEXT.md.
