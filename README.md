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
olha o `git diff`.

## Configuração (`.claude/team.json`)

| Campo                  | Padrão     | O que faz                                                         |
| ---------------------- | ---------- | ----------------------------------------------------------------- |
| `enabled`              | `true`     | Liga ou desliga o PMO automático                                  |
| `model`                | `"sonnet"` | Modelo do PMO; um modelo diferente do coder ajuda a ter outro olhar |
| `maxRounds`            | `3`        | Quantas vezes o PMO pode devolver a mesma resposta ao coder       |
| `onlyWhenFilesChanged` | `true`     | Pula a revisão quando a rodada não mexeu em arquivos (perguntas)  |
| `timeoutSeconds`       | `240`      | Tempo máximo de uma revisão                                       |
| `claudeCommand`        | `"claude"` | Executável do Claude Code                                         |

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
