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

## Como testar localmente
Sem Python/Node no Windows: `powershell -ExecutionPolicy Bypass -File tools\serve.ps1` e abrir http://localhost:8765/. Com `config.js` preenchido, o app local já grava no Supabase real (para o modo demonstração, esvazie temporariamente o `config.js`).

## Supabase (produção)
- Organização **Vinhofilos** (plano Free), projeto **vinhofilos**, ref `gyaxczqrsxjlesuamifo`, região Americas.
- Painel: https://supabase.com/dashboard/project/gyaxczqrsxjlesuamifo
- `config.js` usa a chave **publishable** (`sb_publishable_...`). A senha do banco foi gerada pelo Supabase e não está guardada aqui (pode ser redefinida em Settings → Database).
- `schema.sql` foi executado em 11/11/2026 e também está salvo como snippet no SQL Editor. Ao mudar o schema, rode o arquivo inteiro de novo (ele é idempotente).

## Estado (11/11/2026)
- Fluxo completo testado no modo demonstração (desktop e celular).
- Banco real testado via API com a chave pública (19 verificações: cadastro, criação/token, chave errada recusada, ocultação antes de finalizar, sem acesso direto às tabelas privadas, hash não exposto, nota fora de 50–100 recusada, revelação e bloqueio após finalizar). Dados de teste apagados.
- **Não testado:** a interface rodando contra o Supabase real (o servidor local não pôde ser iniciado na sessão de configuração). Fazer o teste de aceite do README pela interface.
- Próximo passo: publicar no GitHub Pages.
- Pendências restantes estão marcadas **PENDENTE** no CONTEXT.md.
