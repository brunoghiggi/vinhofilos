# CONTEXT.md — Sistema Vinhófilos

> Documento de contexto funcional e técnico para desenvolvimento assistido por IA.  
> Versão: 1.1  
> Data: 09/11/2026  
> Status: v1 implementada — ver seção 17 para as decisões adotadas na implementação. Itens ainda **PENDENTES** devem ser confirmados pelo responsável pelo projeto.

---

## 1. Visão geral

O **Vinhófilos** é uma aplicação web responsiva para organizar encontros de degustação de vinhos, registrar os palpites dos participantes durante degustações às cegas e disponibilizar os resultados e relatórios após o encerramento.

A aplicação deve funcionar em computadores, tablets e celulares, com interface adaptável e uso simples durante o encontro.

### Objetivos principais

- Manter um cadastro permanente de participantes.
- Permitir que qualquer visitante cadastre participantes e crie degustações.
- Registrar os vinhos que serão degustados e seus dados reais.
- Manter os dados reais dos vinhos ocultos para os demais participantes enquanto a degustação estiver em andamento.
- Permitir ao organizador selecionar os participantes presentes e definir a ordem de participação.
- Registrar, por participante e por vinho, os palpites de região, safra, uva, preço e pontuação.
- Finalizar a degustação e revelar os dados reais dos vinhos e os resultados.
- Gerar um relatório consolidado dos palpites e resultados de cada degustação.

---

## 2. Plataforma e arquitetura

### 2.1 Requisitos de plataforma

- Aplicação web responsiva.
- Hospedagem do frontend no **GitHub Pages**.
- Acesso por URL pública, sem instalação obrigatória.
- Interface otimizada para uso em celular durante a degustação.
- Não exigir login, e-mail ou senha dos participantes.

### 2.2 Arquitetura recomendada

O GitHub Pages é um serviço de hospedagem estática: não fornece, por si só, banco de dados compartilhado com escrita. Portanto, recomenda-se:

- **Frontend:** HTML, CSS e JavaScript (ou framework leve, se justificado).
- **Hospedagem:** GitHub Pages.
- **Persistência compartilhada:** Supabase (PostgreSQL e API), preferencialmente em plano gratuito.
- **Acesso:** cliente web usando a chave pública/anon do Supabase.
- **Segurança:** políticas RLS (Row Level Security), validações e regras de acesso no banco.

A chave pública do Supabase pode estar no frontend; **chaves secretas/service role nunca devem ser incluídas no repositório ou no navegador**.

### 2.3 Limitação de segurança sem login

Sem autenticação de usuários, não há identidade forte que prove quem criou uma degustação. Para aproximar o comportamento desejado:

- Ao criar uma degustação, gerar um **token de controle aleatório e secreto**.
- Guardar esse token no armazenamento local do navegador do criador.
- O token permite ao criador operar a degustação.
- Não exibir o token na interface pública nem incluí-lo em URLs compartilháveis.
- As operações privilegiadas devem ser validadas no backend/banco, não apenas escondidas na interface.
- Prever uma opção de recuperação/exportação do token ou aviso de que limpar os dados do navegador pode retirar o controle da degustação.

**PENDENTE:** definir se o token será suficiente ou se o projeto aceita uma solução mais simples, com menor proteção. Não prometer segurança absoluta em um sistema público sem autenticação.

---

## 3. Conceitos e entidades

### 3.1 Participante

Pessoa cadastrada na confraria.

Campos sugeridos:

- `id`: identificador único.
- `nome`: nome de exibição, obrigatório.
- `apelido`: opcional.
- `ativo`: indica se aparece na seleção de participantes.
- `created_at`: data de cadastro.

Regras:
- Qualquer visitante pode cadastrar participante.
- Evitar duplicidade de nomes, com aviso e possibilidade de confirmação.
- Participantes inativos não aparecem por padrão na seleção, mas continuam nos históricos.

### 3.2 Degustação / Confraria

Representa um encontro de degustação.

Campos sugeridos:

- `id`: identificador único.
- `nome`: nome/título do encontro.
- `data`: data do encontro, opcional no cadastro inicial.
- `descricao`: opcional.
- `status`: `rascunho`, `em_andamento` ou `finalizada`.
- `created_at`: criação.
- `creator_token_hash` ou mecanismo equivalente para autorização do organizador.
- `finished_at`: data/hora da finalização.

Regras:
- Qualquer visitante pode criar uma degustação.
- A pessoa que criou recebe o controle operacional.
- Uma degustação pode conter vários vinhos.
- Uma degustação pode ter vários participantes presentes.
- Degustações finalizadas ficam disponíveis para consulta pública.
- Degustações em andamento não revelam os dados reais dos vinhos aos visitantes comuns.

### 3.3 Vinho da degustação

Cada vinho pertence a uma degustação. Os dados abaixo são os dados **reais**, preenchidos pelo criador antes ou durante a preparação do encontro.

Campos:

- `id`: identificador único.
- `degustacao_id`: degustação relacionada.
- `ordem`: posição do vinho na sequência.
- `nome`: identificação/nome do vinho.
- `pais`: país de origem.
- `regiao`: região de origem.
- `preco`: preço original/sem desconto.
- `preco_desconto`: preço com desconto.
- `uva`: variedade ou composição de uvas.
- `safra`: ano da safra; permitir valor desconhecido/não informado.
- `observacoes`: opcional.

Regras:
- O cadastro de vinhos deve ocorrer na criação/preparação da degustação.
- O organizador pode revisar os dados antes de iniciar.
- Os dados reais ficam ocultos para o público durante o andamento.
- Após a finalização, todos os dados reais são revelados.
- A interface deve diferenciar claramente preço original e preço com desconto.

### 3.4 Participante presente na degustação

Relaciona participantes cadastrados a uma degustação.

Campos:

- `id`.
- `degustacao_id`.
- `participante_id`.
- `ordem`: ordem de fala/registro no encontro.

Regras:
- No dia, o organizador visualiza todos os participantes cadastrados.
- Deve poder selecionar/desselecionar participantes presentes de forma rápida.
- A ordem em que forem selecionados define a ordem da degustação.
- Deve ser possível ajustar a ordem antes de começar, preferencialmente por arrastar e soltar ou controles simples de mover para cima/baixo.
- Um participante não pode aparecer duas vezes na mesma degustação.

### 3.5 Palpite / avaliação de degustação

Registra o que um participante acredita sobre determinado vinho.

Campos:

- `id`.
- `degustacao_id`.
- `vinho_id`.
- `participante_id`.
- `regiao_palpite`.
- `safra_palpite`.
- `uva_palpite`.
- `preco_palpite`.
- `pontuacao`.
- `observacoes`: opcional.
- `created_at` e `updated_at`.

Regras:
- Cada participante deve ter um registro de palpite para cada vinho degustado.
- Os campos são preenchidos pelo organizador, pessoa por pessoa, conforme a ordem definida.
- O sistema deve facilitar a navegação entre participantes e vinhos.
- O organizador deve conseguir salvar parcialmente e continuar depois.
- Não permitir que visitantes comuns consultem os palpites enquanto a degustação estiver em andamento.
- Após finalizar, os palpites ficam públicos no relatório.

**DEFINIDO:** pontuação inteira de 50 a 100 (ver §17).

---

## 4. Fluxos principais

### 4.1 Cadastro de participante

1. Visitante acessa a aplicação.
2. Abre a área de participantes.
3. Informa o nome e, opcionalmente, apelido.
4. Confirma o cadastro.
5. Participante passa a integrar a lista geral e pode ser selecionado em futuras degustações.

### 4.2 Criar degustação

1. Visitante seleciona **Criar degustação**.
2. Informa nome, data e descrição opcional.
3. Adiciona um ou mais vinhos.
4. Para cada vinho, informa:
   - nome;
   - país;
   - região;
   - preço;
   - preço com desconto;
   - uva;
   - safra.
5. Salva a degustação.
6. O sistema registra o criador e entrega o acesso de controle ao navegador que criou.
7. A degustação fica em estado de rascunho ou pronta para iniciar.

**PENDENTE:** decidir se o encontro pode ser criado sem vinhos ou se pelo menos um vinho é obrigatório.

### 4.3 Preparar participantes e iniciar

1. O criador abre a degustação usando o controle local.
2. Seleciona **Participantes do dia**.
3. O sistema mostra todos os participantes cadastrados.
4. O criador seleciona os presentes.
5. A ordem da seleção define a ordem inicial.
6. O criador pode ajustar a ordem.
7. Confirma os participantes.
8. Inicia a degustação.
9. O status passa para `em_andamento`.

### 4.4 Registrar palpites

1. Apenas o criador autorizado acessa a área de operação.
2. O sistema mostra o primeiro participante da ordem.
3. O organizador registra, para cada vinho:
   - região percebida;
   - safra percebida;
   - uva percebida;
   - preço estimado;
   - pontuação.
4. O sistema indica visualmente o progresso (participante e vinhos concluídos).
5. O organizador avança para o próximo participante.
6. Deve ser possível voltar e corrigir um registro antes da finalização.
7. O sistema salva as alterações.

**PENDENTE:** definir se os palpites são feitos vinho a vinho para cada pessoa ou pessoa a pessoa para todos os vinhos. A interface pode permitir ambos, mantendo a ordem de fala dos participantes.

### 4.5 Finalizar degustação

1. O criador seleciona **Finalizar degustação**.
2. O sistema apresenta confirmação e resumo de pendências.
3. O criador confirma.
4. O status passa para `finalizada`.
5. Os dados reais dos vinhos e todos os palpites passam a ser públicos.
6. O relatório é disponibilizado para consulta.
7. A degustação aparece no histórico público.

A finalização deve ser irreversível por padrão. Caso seja necessário corrigir dados depois, prever ação administrativa/controlada ou reabertura com registro da alteração.

---

## 5. Regras de visibilidade e permissões

| Informação/ação | Público durante rascunho/em andamento | Criador autorizado | Público após finalização |
|---|---:|---:|---:|
| Nome e data da degustação | Sim | Sim | Sim |
| Dados reais dos vinhos | Não | Sim | Sim |
| Lista de participantes presentes | Definir | Sim | Sim |
| Palpites | Não | Sim | Sim |
| Editar vinhos | Não | Sim | Não, por padrão |
| Registrar/editar palpites | Não | Sim | Não, por padrão |
| Finalizar degustação | Não | Sim | Não |
| Consultar relatório | Não | Sim | Sim |

- A restrição deve ser aplicada na camada de dados/backend, e não apenas ocultando componentes no frontend.
- A interface pública pode exibir o nome da degustação e o status, sem revelar os vinhos ou palpites.
- **PENDENTE:** decidir se a lista de participantes presentes também fica oculta durante a degustação.

---

## 6. Relatório de resultados

Cada degustação finalizada deve possuir um relatório acessível publicamente.

### 6.1 Visão geral

- Nome e data da degustação.
- Quantidade de vinhos.
- Quantidade de participantes.
- Lista ordenada de participantes.
- Resumo dos resultados.

### 6.2 Resultado por vinho

Para cada vinho, apresentar:

- Dados reais: nome, país, região, preço, preço com desconto, uva e safra.
- Palpites de todos os participantes.
- Pontuação atribuída por cada participante.
- Comparação entre palpite e dado real, quando aplicável.

### 6.3 Resultado por participante

Para cada participante, apresentar:

- Palpites realizados em cada vinho.
- Pontuação atribuída a cada vinho.
- Comparação dos palpites com os dados reais.
- Resumo de desempenho, se houver regra de pontuação definida.

### 6.4 Exportação

**Desejável:**
- Relatório imprimível com layout adequado para PDF pelo navegador.
- Botão **Imprimir / Salvar em PDF**.
- Possibilidade de exportar CSV ou planilha em uma etapa futura.

**DEFINIDO:** regras de acerto e rankings na §17 (1 ponto por item e margem de 15% no preço, confirmados pelo responsável em 10/11/2026).

---

## 7. Telas sugeridas

1. **Página inicial**
   - Identidade visual Vinhófilos.
   - Botões para participantes, criar degustação e histórico.
   - Degustações recentes/finalizadas.

2. **Participantes**
   - Lista pesquisável.
   - Cadastro rápido.
   - Ativar/inativar participante.

3. **Criar/editar degustação**
   - Dados gerais.
   - Formulário repetível para adicionar vinhos.
   - Ordenação dos vinhos.
   - Validação de campos.

4. **Detalhe da degustação**
   - Status e informações gerais.
   - Acesso de controle para o criador.
   - Visão pública limitada enquanto estiver em andamento.

5. **Seleção de participantes**
   - Lista completa.
   - Seleção rápida.
   - Ordem de seleção visível.
   - Ajuste de ordem.

6. **Operação da degustação**
   - Participante atual em destaque.
   - Navegação entre vinhos e participantes.
   - Campos de palpite.
   - Salvamento e indicador de progresso.

7. **Relatório**
   - Dados reais dos vinhos.
   - Palpites organizados por vinho e participante.
   - Comparações.
   - Impressão/PDF.

8. **Histórico**
   - Degustações finalizadas.
   - Busca/filtro por nome e data.
   - Acesso ao relatório.

---

## 8. UX e acessibilidade

- Priorizar celular: botões grandes, campos simples e navegação clara.
- Evitar tabelas largas no celular; usar cartões ou abas.
- Não exigir digitação excessiva durante a degustação.
- Permitir teclado e navegação acessível.
- Informar claramente o status: rascunho, em andamento e finalizada.
- Exibir mensagens de sucesso e erro compreensíveis.
- Confirmar ações irreversíveis.
- Indicar progresso de preenchimento.
- Salvar automaticamente ou oferecer salvamento explícito confiável.

---

## 9. Requisitos não funcionais

- Interface responsiva e compatível com navegadores modernos.
- Dados persistidos em banco compartilhado, não apenas em `localStorage`.
- Integridade referencial entre degustação, vinhos, participantes e palpites.
- Prevenção de registros duplicados.
- Validação de dados no frontend e no banco.
- Tratamento de falhas de conexão e tentativas de salvar.
- Nenhuma credencial secreta no código público.
- Código organizado, modular e documentado.
- Configuração de ambiente simples, documentada no README.
- Projeto versionado no GitHub e publicado pelo GitHub Pages.

---

## 10. Modelo de dados relacional inicial

Estrutura conceitual recomendada:

```text
participants
  id
  name
  nickname
  active
  created_at

tastings
  id
  name
  date
  description
  status
  creator_token_hash
  created_at
  finished_at

tasting_wines
  id
  tasting_id
  order
  name
  country
  region
  price
  discounted_price
  grape
  vintage
  notes

tasting_participants
  id
  tasting_id
  participant_id
  order

wine_guesses
  id
  tasting_id
  wine_id
  participant_id
  guessed_region
  guessed_vintage
  guessed_grape
  guessed_price
  score
  notes
  created_at
  updated_at
```

### Restrições recomendadas

- `tasting_wines.tasting_id` referencia `tastings.id`.
- `tasting_participants.participant_id` referencia `participants.id`.
- `tasting_participants.tasting_id` referencia `tastings.id`.
- `wine_guesses.wine_id` referencia `tasting_wines.id`.
- `wine_guesses.participant_id` referencia `participants.id`.
- Um participante só pode ser incluído uma vez por degustação.
- Um palpite deve ser único por combinação de vinho e participante.
- Valores monetários devem usar tipo decimal adequado, nunca ponto flutuante impreciso.
- Safra deve permitir ausência de informação.

---

## 11. Organização sugerida do projeto

```text
vinhofilos/
├── index.html
├── README.md
├── CONTEXT.md
├── assets/
│   ├── css/
│   │   ├── base.css
│   │   ├── layout.css
│   │   └── components.css
│   ├── js/
│   │   ├── app.js
│   │   ├── router.js
│   │   ├── services/
│   │   │   └── database.js
│   │   ├── modules/
│   │   │   ├── participants.js
│   │   │   ├── tastings.js
│   │   │   ├── wines.js
│   │   │   ├── guesses.js
│   │   │   └── reports.js
│   │   └── utils/
│   └── images/
└── supabase/
    └── schema.sql
```

A estrutura pode ser adaptada pela IA conforme a tecnologia escolhida, desde que preserve os módulos e responsabilidades.

---

## 12. Roadmap recomendado

### Fase 1 — Fundação
- Criar repositório e publicação no GitHub Pages.
- Definir identidade visual e layout responsivo.
- Configurar Supabase.
- Criar tabelas e políticas de acesso.
- Documentar instalação e configuração.

### Fase 2 — Cadastros
- Cadastro/listagem/edição de participantes.
- Criação de degustação.
- Cadastro e ordenação dos vinhos.
- Persistência e validações.

### Fase 3 — Operação
- Controle do criador sem login.
- Seleção e ordenação de participantes presentes.
- Início da degustação.
- Formulário de palpites por participante e vinho.
- Salvamento e progresso.

### Fase 4 — Encerramento e consulta
- Finalização com confirmação.
- Revelação pública dos dados.
- Relatório por vinho e por participante.
- Impressão/PDF.

### Fase 5 — Qualidade
- Testes em celular e desktop.
- Testes de permissões e visibilidade.
- Testes de concorrência e falhas de conexão.
- Revisão de acessibilidade e documentação.

---

## 13. Critérios de aceite

O sistema será considerado funcional quando:

- [ ] Abrir por URL pública do GitHub Pages em computador e celular.
- [ ] Permitir cadastrar participantes sem login.
- [ ] Permitir criar degustação sem login.
- [ ] Permitir adicionar vinhos com todos os campos especificados.
- [ ] Permitir selecionar participantes presentes e definir ordem.
- [ ] Permitir ao criador registrar palpites por participante.
- [ ] Impedir que visitantes comuns vejam os dados reais dos vinhos antes da finalização.
- [ ] Impedir que visitantes comuns alterem a degustação em andamento.
- [ ] Persistir dados entre dispositivos e sessões.
- [ ] Finalizar degustação e liberar dados e palpites.
- [ ] Gerar relatório consultável e imprimível.
- [ ] Não exigir login ou senha dos participantes.
- [ ] Não expor credenciais privilegiadas no frontend.

---

## 14. Instruções para a IA desenvolvedora

Ao desenvolver o Vinhófilos:

1. Leia este arquivo integralmente antes de implementar.
2. Trate os requisitos definidos como obrigatórios.
3. Não invente regras de ranking, pontuação ou acerto; consulte o responsável quando necessário.
4. Não implemente login/senha, salvo decisão explícita futura.
5. Não use `localStorage` como banco principal compartilhado.
6. Não confie apenas em ocultar elementos no frontend para proteger dados.
7. Não coloque chaves secretas do Supabase no código público.
8. Mantenha o frontend compatível com GitHub Pages.
9. Priorize a experiência de uso em celular durante a degustação.
10. Quando houver decisões pendentes, documente-as e proponha opções objetivas.
11. Atualize este `CONTEXT.md` quando requisitos ou decisões forem alterados.
12. Entregue código funcional, instruções de configuração, SQL/migrations e passos de publicação.

---

## 15. Decisões pendentes para validação

| Questão | Proposta inicial |
|---|---|
| Nome de cada encontro | Campo obrigatório |
| Data | Campo opcional na criação; editável antes de iniciar |
| Mínimo de vinhos | Pelo menos 1 para iniciar |
| Pontuação | ~~Definir escala posteriormente~~ **Definido:** 50 a 100, inteiros (ver §17) |
| Ranking | ~~Não implementar até definir regra~~ **Definido:** participantes por acertos e vinhos por nota média (ver §17) |
| Participantes durante andamento | Ocultar lista pública por padrão |
| Ordem de preenchimento | Ordem selecionada, com ajuste manual |
| Correção após finalizar | Bloqueada por padrão |
| Relatório | Página web + impressão em PDF |
| Banco | Supabase |
| Controle do criador | Token secreto local, validado no backend |
| Exclusão de participantes/degustações | Preferir inativação ou exclusão controlada para preservar histórico |

---

## 16. Resumo executivo

O Vinhófilos é um sistema público, sem login, para cadastro de integrantes e organização de degustações às cegas. O criador de cada encontro controla a seleção dos participantes, o registro dos palpites e a finalização. Durante o encontro, os dados reais dos vinhos e os palpites permanecem privados; após a finalização, tudo é revelado e organizado em um relatório. O frontend será publicado no GitHub Pages e os dados compartilhados serão armazenados em um backend simples, recomendado Supabase.

---

## 17. Decisões adotadas na implementação v1 (09/11/2026)

Adotadas a partir das propostas da seção 15. Todas podem ser revistas; as marcadas **PENDENTE** ainda precisam de validação.

| Questão | Decisão na v1 | Onde muda |
|---|---|---|
| Controle do criador | Token de 24 bytes gerado no banco; só o hash SHA-256 é armazenado; validado em todas as funções RPC. Exportável (copiar) e importável em outro aparelho. **Degustações mensais (11/11/2026):** nascem sem chave; o **primeiro que clicar em "Assumir organização"** recebe a chave (`claim_tasting`); depois disso, só com a chave. Sem dono, nenhuma operação do organizador é aceita (`_assert_creator` recusa hash nulo). | `supabase/schema.sql`, `tastings.js` |
| Degustações mensais | **DEFINIDO (11/11/2026, revisto no mesmo dia):** uma confraria por mês, criada automaticamente no **último domingo**, do **mês atual até 11 meses à frente** (nunca meses passados; a agenda começou em novembro de 2026 — todas as degustações anteriores foram apagadas a pedido do responsável). Nome interno fixo "Confraria de <mês> de <ano>" (não editável, para não vazar o tema). Criadas por `ensure_monthly_tastings()`, chamada ao abrir a tela inicial (idempotente; índice único em `monthly_ref`). Não podem ser excluídas. A tela inicial (seção única **"Agenda"**, sem divisão por ano nem texto explicativo — 11/11/2026) mostra **apenas "Confraria de <mês>"** (ex.: "Confraria de novembro"), data e organizadores, e destaca a próxima; depois de finalizada, sai da agenda e fica só no Histórico, com o **tema** como título. | `schema.sql`, `tastings.js`, `utils/format.js` (`tastingTitle`) |
| Tema da confraria | **DEFINIDO (11/11/2026):** campo `tastings.theme`, definido por quem tem a chave (`set_tasting_theme`, no formulário "Editar dados e vinhos", com aviso de que fica oculto). **Secreto até finalizar**, garantido no banco: `theme` não é concedido ao anon e é removido de `get_tasting_public`; a coluna calculada `public_theme` só tem valor quando `status = 'finalizada'` e é a única legível pelo público. Após finalizar, o tema vira o título na agenda, no histórico, no relatório e no CSV. | `schema.sql`, `wines.js`, `tastings.js`, `reports.js` |
| Organizadores | **DEFINIDO (11/11/2026):** escolhidos entre os participantes do cadastro (até 10), guardados em `tastings.organizer_ids`. **Qualquer pessoa** pode editá-los na página da degustação até ela ser finalizada (`set_tasting_organizers`). Organizador ≠ dono da chave: são independentes. | `schema.sql`, `tastings.js` |
| Acesso aos dados | `tasting_wines`, `tasting_participants` e `wine_guesses` sem acesso direto pela chave anon; tudo via funções `SECURITY DEFINER`. | `schema.sql` |
| Nome do encontro | Obrigatório. | |
| Data | Opcional; editável até finalizar. | |
| Mínimo de vinhos | Pode salvar rascunho sem vinhos; iniciar exige ≥ 1 vinho e ≥ 1 participante. | `start_tasting` |
| Pontuação | **DEFINIDA (09/11/2026):** escala fixa de **50 a 100, somente inteiros**, igual para todas as degustações. Validada no app e no banco (restrição em `wine_guesses.score` e checagem em `save_guess`). Os valores ficam gravados em `tastings.score_min/score_max` para histórico. | `utils/format.js` (`SCORE`), `schema.sql` |
| Rankings | **DEFINIDO (09/11/2026):** o relatório mostra (1) ranking dos participantes por pontos de acerto e (2) ranking dos vinhos por nota média. Empates dividem a posição (1º, 1º, 3º). Vinhos sem nota ficam no fim, sem posição. Não há ranking acumulado entre degustações. | `reports.js`, `scoring.js` |
| Regras de acerto | **DEFINIDAS (10/11/2026):** confirmadas pelo responsável. 1 ponto por item, até 4 por vinho. **Região e uva:** acerta se um texto contém o outro, ignorando acentos/maiúsculas (palpites com menos de 3 letras só valem se idênticos). **Safra:** exata. **Preço:** até 15% de diferença do **preço cheio**. Item sem dado real (ex.: safra não informada) não pontua para ninguém e sai do total possível. Calculado no relatório, a partir dos dados revelados. | `scoring.js` (`RULES`) |
| Participantes durante andamento | Lista oculta para o público (só o nº de vinhos é exibido). | `get_tasting_public` |
| Ordem de preenchimento | Ordem de seleção, com ajuste ↑ ↓ e arrastar. Registro pode ser **por participante** ou **por vinho** (alternável). **Durante a degustação (11/11/2026):** na tela de palpites, botão "Reordenar" permite arrastar os nomes para a esquerda/direita (mouse ou toque; setas do teclado também); a ordem é salva na hora. **Modo "Por vinho" (11/11/2026, pensado para o celular):** mostra **um participante por vez**; o botão de baixo é "Próximo participante" e só vira "Próximo vinho" no último participante ("Concluir" no último do último vinho); "Anterior" volta participante a participante (e para o último do vinho anterior). Fichas pequenas com os participantes do vinho permitem pular direto para alguém; Enter/"Próximo" do teclado no último campo avança. | `guesses.js` |
| Palpite "completo" | **Alterado (11/11/2026):** região, uva, preço e pontuação preenchidos; **safra é opcional**. Formulário na ordem Região, Uva, Safra, Preço, Pontuação; campo **Observações removido** do registro de palpites e do relatório/CSV (observações já gravadas são preservadas no banco). Safra continua valendo 1 ponto quando acertada. Finalizar com pendências é permitido, após confirmação que lista as pendências. | `guesses.js`, `reports.js` |
| Edição durante andamento | Vinhos e participantes podem ser ajustados; remover vinho/participante apaga os palpites dele (com aviso). | `save_tasting`, `set_tasting_participants` |
| Correção após finalizar | Bloqueada (irreversível). Reabertura não implementada. | |
| Exclusão | Participantes: só inativação. Degustações: exclusão apenas em rascunho, pelo criador; degustações mensais não podem ser excluídas. | |
| Sigilo na tela de operação | Nomes reais dos vinhos ocultos por padrão (opção "Mostrar nomes reais"), para não revelar a quem vê a tela. | `guesses.js` |
| Relatório | Página web com abas por vinho/por participante, impressão/PDF pelo navegador e exportação CSV (`;`, UTF-8 com BOM). | `reports.js` |
| Modo demonstração | Sem Supabase configurado, o app usa um backend local (localStorage) que reproduz as regras do banco — apenas para testes. | `demo-backend.js` |
| Identidade visual | **11/11/2026:** inspirada no logo da Confraria Vinhófilos — fundo branco, texto grafite (#3b3b3d), vinho do logo (#8b3a52) como cor principal, faixa com as 8 cores das taças sob o cabeçalho e uma cor por mês na agenda; títulos e marca em Josefin Sans (Google Fonts), fina e em caixa alta como no logo. Símbolo em `assets/images/icon.svg` é uma **recriação em SVG** do logo (8 taças em roda); trocar pelo arquivo original se o responsável fornecer. | `assets/css/*.css`, `index.html`, `icon.svg` |
| Tema claro/escuro | **11/11/2026:** botão no cabeçalho alterna **Automático → Claro → Escuro** (salvo por aparelho em `localStorage`, chave `vinhofilos.theme`). O escuro é ativado por `data-theme="dark"` no `<html>`, definido por `assets/js/theme.js` antes de a página aparecer (sem "piscar"); no Automático segue o sistema. Impressão sempre em cores claras. | `theme.js`, `assets/css/*.css` |
| Eventos especiais da agenda | **11/11/2026:** tabela `agenda_events` (data, título, descrição, `replaces_month`). Aparece na agenda como **card de destaque** ("Evento especial"), na ordem das datas; eventos passados somem. Com `replaces_month`, a confraria daquele mês não é criada. Leitura pública; **criação/edição só pelo SQL Editor**. Primeiro evento: **Confraternização de final de ano, 13/12/2026 (domingo)**, no lugar da confraria de dezembro/2026 (apagada). | `schema.sql`, `tastings.js` |
| Nomes de pessoas | **11/11/2026:** em todo o sistema as pessoas aparecem pelo **apelido** (`participantName`; sem apelido, usa o nome). O nome completo só aparece no cadastro de participantes (ao lado do apelido) e no aviso de duplicidade (`participantFullName`). Listas ordenadas pelo apelido. | `format.js` |
| Finalizadas e Histórico | **11/11/2026:** confrarias/degustações finalizadas **saem da tela inicial** e ficam só no **Histórico**. O Histórico tem layout de página de busca (estilo Google): marca centralizada, caixa de pesquisa arredondada (busca por tema, nome, descrição, organizadores e nomes dos vinhos; todas as palavras precisam aparecer), botão "Ferramentas" com filtro De/Até, e resultados com trilha (data e dia da semana), título em link, resumo e os vinhos. Ao abrir uma finalizada, a página mostra **primeiro os vinhos que participaram** (e os participantes); o **relatório detalhado** fica no botão abaixo. | `tastings.js`, `components.css` |
| Seleção de participantes | **11/11/2026:** botão **"Selecionar todos"** marca de uma vez todos os nomes visíveis (respeita a busca e "Mostrar inativos"); mantém a ordem já escolhida e acrescenta os demais na ordem da lista. Com todos marcados vira **"Desmarcar todos"**. | `participants.js` |
| Navegação | **11/11/2026:** link **Início** no menu e, em todas as telas internas, barra no topo com **"← Voltar"** (volta à tela anterior do app; se a pessoa entrou direto por um link, vai ao início) e **"⌂ Início"**. Oculta na impressão. | `router.js`, `index.html`, `layout.css` |
| Registro histórico | **11/11/2026:** Confraria de outubro/2026 (tema **Mendoza**, 25/10/2026, organizadores Franco e João) inserida via SQL Editor já finalizada, com os 6 vinhos da apresentação; sem chave de organizador (ninguém edita pelo app), sem participantes/palpites/preços. | banco |
