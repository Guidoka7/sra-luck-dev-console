# Scheduler do Infrastructure Guardian

O Dev Console não embute um scheduler em memória, porque Vercel Functions não permanecem executando continuamente. A coleta automática é disparada por `GET /api/infra-scan`, autenticado com `CRON_SECRET`.

## Vercel Pro / Enterprise

Para observabilidade operacional, uma frequência inicial razoável é 5 minutos:

```json
{
  "crons": [
    { "path": "/api/infra-scan", "schedule": "*/5 * * * *" }
  ]
}
```

A Vercel envia `Authorization: Bearer <CRON_SECRET>` automaticamente quando `CRON_SECRET` está configurado no projeto.

## Vercel Hobby

Hobby permite cron somente uma vez por dia. Não coloque uma expressão de 5 minutos no `vercel.json`, pois o deployment será rejeitado. Para desenvolvimento, use varredura manual pelo painel ou um scheduler externo autorizado. Para monitoramento de produção em intervalos curtos, use um plano/scheduler compatível.

## Central de Problemas no mesmo agendamento

A execução agendada de `/api/infra-scan` também roda a Central de Problemas: aplica sozinha só as correções seguras (L2: teste de conexão de integração). Rotinas que enviam notificação de cobrança à cliente **nunca** rodam sozinhas: exigem confirmação humana (L3), verifica se o problema sumiu, abre/atualiza incidentes `source=problems` para o que continua crítico/alto e mitiga os que desapareceram. O resultado fica em `dev_job_runs` (`job_key = problems.autofix`).

## Segurança

- `CRON_SECRET` deve existir somente no backend.
- `GET /api/infra-scan` rejeita requisições sem o Bearer correto.
- A UI usa `POST /api/infra-scan` e exige sessão + `agents.run`.
- O scheduler nunca recebe credenciais dos providers; ele só aciona a Function, que lê as variáveis privadas da Vercel.
