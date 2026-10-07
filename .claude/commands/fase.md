---
description: Começa uma fase do roadmap e trabalha as tasks dela sem parar, até abrir o PR
argument-hint: <id da fase, ex. F1>
---

Comece a fase `$ARGUMENTS` do roadmap.

1. Rode `node .claude/scripts/roadmap.mjs start-phase $ARGUMENTS`. Ele valida o roadmap, cria a
   branch da fase e mostra a primeira task. Se falhar, pare e explique o erro ao usuário.
2. Trabalhe na task mostrada, dentro do escopo e até cumprir todos os critérios de aceite. Use o
   `reviewer` e o `qa` como o `CLAUDE.md` manda.
3. Ao terminar, rode `node .claude/scripts/roadmap.mjs done <id da task>` e encerre a resposta com um
   resumo do que fez e a evidência de cada critério de aceite (saída de comando, teste rodado).
4. O hook de Stop roda as verificações, o PMO revisa, commita a task e entrega a próxima. Continue
   até ele parar.

Se precisar de uma decisão que é do usuário, rode
`node .claude/scripts/roadmap.mjs block <id da task> <o que precisa ser decidido>` e encerre a
resposta com a pergunta. Quando o usuário responder, rode `node .claude/scripts/roadmap.mjs resume
<id da task>` e continue a task.
