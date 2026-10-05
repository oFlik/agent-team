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

## Regras do projeto

<O que o PMO e o reviewer vão cobrar. Exemplos:>

- <Arquitetura: onde cada tipo de arquivo mora.>
- <Convenções: idioma do código, padrão de commits, tamanho máximo de arquivo.>
- <Como verificar: comandos de lint, teste e build que precisam passar.>

## Checklist de pronto

- [ ] <comando de lint> passa.
- [ ] <comando de teste> passa.
- [ ] <comando de build> passa.
- [ ] Reviewer sem achados bloqueantes.
