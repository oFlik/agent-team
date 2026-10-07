# agent-team

Base para projetos com um **time de agentes** no Claude Code. Em vez de você ler cada resposta do
Claude, validar e decidir o próximo passo, um agente **PMO** faz essa primeira triagem sozinho.
Outros papéis (revisor, QA) ficam à mão do coder. **Você continua sendo o dono das decisões**; o
time só filtra o vai e volta pequeno antes de a resposta chegar até você.

## Como funciona

```
você ──pedido──▶ CODER (a sessão principal)
                   │  escreve código
                   │  chama @reviewer e @qa quando precisa
                   ▼
             vai responder ──▶ hook de Stop ──▶ PMO (outra sessão, só leitura)
                                                  │
                    ┌─────── "revise" ◀───────────┤
                    ▼                             │
             coder recebe o feedback              └── "approve" ──▶ resposta chega até você
             e trabalha mais uma rodada               (com "PMO aprovou: ..." na tela)
             (no máximo 3 rodadas, depois a decisão volta para você)
```

### As três peças do Claude Code que usamos

**1. Subagentes** (`.claude/agents/*.md`). Cada arquivo é um papel: um prompt próprio, as
ferramentas que ele pode usar e o modelo. O coder delega para eles e recebe só a conclusão, então o
contexto da conversa principal fica limpo.

- Automático: o coder decide chamar com base no `description` do agente.
- Explícito: você escreve `@agent-reviewer revise o que mudou`.
- Listar ou editar: comando `/agents`.

**2. Hooks** (`.claude/settings.json`). Scripts que o próprio Claude Code roda em momentos fixos.
Diferente de uma instrução no `CLAUDE.md`, o modelo **não tem como esquecer** de rodar um hook.

- `UserPromptSubmit` → `record-prompt.mjs`: guarda o que você pediu, para o PMO julgar a resposta
  contra o pedido, e zera o contador de rodadas.
- `Stop` → `pmo-gate.mjs`: quando o coder vai te responder, abre uma sessão `claude -p` com o
  prompt do PMO. Se o PMO devolver `revise`, o hook bloqueia a parada e entrega o feedback ao coder.

**3. Modo headless** (`claude -p`). É o Claude Code rodando sem interface, recebendo o prompt pela
entrada e devolvendo JSON. É assim que o PMO roda: uma sessão separada, que **não vê o raciocínio
do coder**, só o pedido, a resposta final e o `git diff`. Essa separação é proposital, para ele não
herdar os mesmos pontos cegos.

## Os papéis

| Papel      | Arquivo                     | Pode editar?        | Quem chama        |
| ---------- | --------------------------- | ------------------- | ----------------- |
| coder      | (a sessão principal)        | Sim                 | Você              |
| `pmo`      | `.claude/agents/pmo.md`      | Não                 | Hook, automático  |
| `reviewer` | `.claude/agents/reviewer.md` | Não                 | O coder, ou você  |
| `qa`       | `.claude/agents/qa.md`       | Só arquivos de teste | O coder, ou você  |

O `pmo.md` é usado pelos dois caminhos: o hook lê o corpo dele como prompt, e você ainda pode chamar
`@agent-pmo` à mão. O papel fica definido num lugar só.

## Usar num projeto novo

1. Copie para a raiz do projeto: a pasta `.claude/` (sem `.claude/state/`), o `.gitignore` (ou
   junte as linhas dele ao seu) e o `CLAUDE.md`.
2. Preencha o `CLAUDE.md`: as regras e o checklist são o que o PMO e o reviewer vão cobrar. Quanto
   mais concretas, melhor a revisão.
3. Abra o Claude Code **na raiz do projeto**. Agentes e hooks só são lidos da pasta onde a sessão
   abre, e só quando ela abre.
4. Na primeira vez, o Claude Code pede para você confiar nos hooks do projeto. Leia e aceite.

Requisitos: Node 18+ e o `claude` no PATH. O projeto precisa ser um repositório git, porque o PMO
olha o `git diff`. Para o modo fase abrir o PR sozinho: um remote `origin` e o `gh` autenticado.

## Configuração (`.claude/team.json`)

| Campo                  | Padrão     | O que faz                                                         |
| ---------------------- | ---------- | ----------------------------------------------------------------- |
| `enabled`              | `true`     | Liga ou desliga o PMO automático                                  |
| `model`                | `"sonnet"` | Modelo do PMO; um modelo diferente do coder ajuda a ter outro olhar |
| `maxRounds`            | `3`        | Quantas vezes o PMO pode devolver a mesma resposta ao coder       |
| `onlyWhenFilesChanged` | `true`     | Pula a revisão quando a rodada não mexeu em arquivos (perguntas)  |
| `timeoutSeconds`       | `240`      | Tempo máximo de uma revisão                                       |
| `claudeCommand`        | `"claude"` | Executável do Claude Code                                         |

Esses campos ficam dentro de `pmoGate`. Os outros blocos do arquivo:

| Campo                       | Padrão  | O que faz                                                            |
| --------------------------- | ------- | -------------------------------------------------------------------- |
| `autopilot.maxTasksPerRun`  | `5`     | Quantas tasks o coder emenda antes de parar e pedir um "continue"     |
| `checks`                    | `[]`    | Comandos que o Stop roda antes do PMO: `{ "name", "command", "timeoutSeconds" }` |
| `guard.enabled`             | `true`  | Liga ou desliga o guard                                              |
| `guard.secretPaths` etc.    | ver `guard.mjs` | Cada lista que você puser aqui **substitui** a padrão inteira |

## Modo fase: trabalhar sem você a cada interação

Você define o roadmap em fases e tasks; o time trabalha uma fase inteira e te chama no PR.

```
/fase F1 ──▶ roadmap.mjs start-phase: valida, cria a branch fase/f1, ativa a 1ª task
               │
               ▼
          coder trabalha a task ──▶ roadmap.mjs done F1.1 ──▶ Stop
                                                            │
             checks (lint/teste/build) ──falhou──▶ volta ao coder
             PMO (julga contra escopo e aceite da task) ──revise──▶ volta ao coder
                                                            │ approve
             hook commita "task(F1.1): ..." e entrega a F1.2 ao coder ─┐
                                                            ▲          │
                                                            └──────────┘
             última task aprovada ──▶ push + `gh pr create` ──▶ para e te mostra o PR
```

**Onde você entra:** no PR de cada fase; quando uma task fica `blocked` (decisão sua; depois
`roadmap.mjs resume <task>`); quando o limite de rodadas ou de tasks por execução é atingido.

**Roadmap:** `.claude/roadmap.json` é o que os hooks leem; o `ROADMAP.md` na raiz é a sua cópia
legível, regerada a cada mudança de status. Para começar, copie `.claude/roadmap.example.json` para
`.claude/roadmap.json` (ou peça ao coder para montar o roadmap com você) e rode
`node .claude/scripts/roadmap.mjs validate`. Toda task precisa de critérios de aceite: é com eles que
o PMO decide se a task acabou, e é o que mais segura alucinação.

**Por que é seguro deixar rodar:** cada commit é uma task que passou pelas verificações e pelo PMO;
o coder não consegue commitar, trocar de branch nem editar `.claude/`, `CLAUDE.md` ou o roadmap durante
a fase (o guard bloqueia); o modo fase só fica ativo enquanto o repositório está na branch da fase.

**Permissões:** um pedido de permissão no meio da fase para tudo até você responder. Para rodar
sozinho, libere os comandos do seu projeto em `.claude/settings.json` (`permissions.allow`) ou use o
modo automático do Claude Code. O guard continua valendo nos dois casos.

## Guard (`.claude/hooks/guard.mjs`)

Hook de `PreToolUse` que bloqueia antes de executar, sem depender de nenhum agente lembrar da regra:

- **Segredos**: ler, editar ou mencionar num comando `.env`, `.env.*`, chaves `.pem`/`.key`,
  `id_rsa`, `credentials*.json` (`.env.example` é liberado).
- **Comandos perigosos**: `git push --force`, push para `main`/`master` (inclusive `HEAD:main`),
  `rm -rf /`/`~`/`*`/`.`, `curl ... | sh`, `gh pr merge` (o merge é seu).
- **Durante uma fase**: `git commit/push/switch/checkout/reset/rebase/merge/stash/cherry-pick/tag`,
  apagar ou renomear branch, e escrita em `.claude/`, `CLAUDE.md` e `ROADMAP.md` da raiz. Comandos
  encadeados (`&&`, `;`, `|`) são julgados um por um.
- **Falha fechada**: se o `team.json` estiver quebrado, o guard bloqueia em vez de liberar tudo. Se o
  `roadmap.json` estiver quebrado, as regras de fase continuam valendo enquanto a branch for `fase/*`.

Limites conhecidos: os comandos Bash são checados pelo texto, então o guard pega engano e atalho, não
um ataque deliberado. Um `git push` sem argumentos estando na `main` não é pego, e um `Grep` numa
pasta pode ler arquivos de segredo que estejam nela. O commit de cada task usa `git add -A`: mantenha
o `.gitignore` do projeto em dia. Ajuste as listas no bloco `guard` do `team.json`.

## Proteções

- **Loop infinito**: o contador de rodadas fica em `.claude/state/<sessão>.json` e é zerado a cada
  pedido novo seu. Bateu o limite, a resposta passa com o aviso "a decisão volta para você".
- **Recursão**: a sessão do PMO carrega os mesmos hooks. A variável `AGENT_TEAM_ROLE=pmo` faz os
  hooks não fazerem nada dentro dela; sem isso, o PMO revisaria a si mesmo para sempre.
- **Falha não trava**: se a revisão der erro ou estourar o tempo, a resposta passa com um aviso, e o
  detalhe fica em `.claude/state/last-pmo-error.json`.
- **PMO só lê**: `Edit` e `Write` ficam bloqueados para ele. Atenção: se as suas permissões globais
  (`~/.claude/settings.json`) liberarem outros comandos, a sessão do PMO herda essas permissões.

## Custo e tempo

Cada revisão é uma sessão inteira do Claude: nos testes, de 10 a 20 segundos e alguns milhares de
tokens. Por isso as respostas que não mexem em arquivos não passam pelo PMO. Para desligar
temporariamente, ponha `"enabled": false` no `team.json`; vale a partir da próxima resposta, sem
reiniciar.

## Indo além: agent teams (experimental)

O Claude Code tem um modo em que várias sessões trabalham juntas e trocam mensagens diretamente, com
um líder e colegas. Ele fica desligado por padrão e se liga com a variável de ambiente
`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`. Limitações hoje: um time por sessão, colegas não criam
sub-times, e `/resume` não restaura os colegas. Esta base não depende dele; ele é o próximo passo se
você quiser papéis trabalhando em paralelo, e não só em sequência.

## Testar esta base

Abra o Claude Code nesta pasta e peça algo pequeno, como "crie um hello.txt com a frase olá mundo".
Na tela, você deve ver "PMO revisando a entrega..." e depois "PMO aprovou: ...".
