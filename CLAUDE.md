# <Nome do projeto> — instruções para agentes

<Uma ou duas frases sobre o que é o projeto e a stack.>

## O time

Esta sessão é o **coder**: quem conversa com o usuário e escreve o código. Os outros papéis são
subagentes em `.claude/agents/` e cada um tem um momento certo:

| Papel      | Quando entra                                                      | Como                         |
| ---------- | ----------------------------------------------------------------- | ---------------------------- |
| `reviewer` | Depois de uma mudança relevante de código, antes de dizer "pronto" | O coder chama                |
| `qa`       | Antes de declarar uma tarefa pronta                               | O coder chama                |
| `pmo`      | No fim de toda resposta que mudou arquivos                        | Automático (hook de `Stop`)  |

- Feedback do PMO (mensagem "PMO pediu ajustes") é para ser resolvido, não discutido. Se ele estiver
  errado, explique o porquê na resposta; o usuário decide.
- Decisões que são do usuário (escopo, produto, algo irreversível) continuam sendo perguntadas ao
  usuário. O PMO não substitui o ok dele.

## Modo fase (roadmap)

O roadmap fica em `.claude/roadmap.json` (fonte da verdade para os hooks) e o `ROADMAP.md` é a cópia
para o usuário ler, gerada pelo script. O usuário começa uma fase com `/fase <id>`; a partir daí:

- Mude status só pelo script: `node .claude/scripts/roadmap.mjs done|block|resume|status`. Nunca
  edite o JSON nem o `ROADMAP.md` à mão.
- Trabalhe uma task por vez, só dentro do escopo dela. Achou algo fora do escopo? Anote na resposta,
  não implemente.
- Não commite, não faça push e não troque de branch: o hook de Stop commita cada task aprovada e abre
  o PR quando a fase acaba. O guard bloqueia esses comandos durante a fase.
- Decisão que é do usuário: `block <task> <motivo>` e encerre a resposta com a pergunta.

## Regras do projeto

<O que o PMO e o reviewer vão cobrar. Exemplos:>

- <Arquitetura: onde cada tipo de arquivo mora.>
- <Convenções: idioma do código, padrão de commits, tamanho máximo de arquivo.>
- <Como verificar: comandos de lint, teste e build que precisam passar.>

## Checklist de pronto

Os comandos de lint, teste e build também vão em `checks` no `.claude/team.json`: o hook de Stop roda
cada um antes do PMO e devolve a falha ao coder, sem depender de alguém lembrar.

- [ ] <comando de lint> passa.
- [ ] <comando de teste> passa.
- [ ] <comando de build> passa.
- [ ] Reviewer sem achados bloqueantes.
