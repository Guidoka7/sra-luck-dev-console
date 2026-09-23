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

## Segurança

- `CRON_SECRET` deve existir somente no backend.
- `GET /api/infra-scan` rejeita requisições sem o Bearer correto.
- A UI usa `POST /api/infra-scan` e exige sessão + `agents.run`.
- O scheduler nunca recebe credenciais dos providers; ele só aciona a Function, que lê as variáveis privadas da Vercel.
