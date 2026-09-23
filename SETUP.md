# Setup rápido

Para o passo a passo completo, use `SETUP-V1.md` e `REPOSITORY-CHECKLIST.md`.

## Ordem mínima

1. criar repo privado `Guidoka7/sra-luck-dev-console`;
2. enviar este pacote para a `main`;
3. criar Supabase exclusivo do Dev Console;
4. aplicar migrations `001` e `002`;
5. criar primeiro usuário Auth e bootstrap Owner;
6. criar projeto Vercel ligado ao repo;
7. cadastrar as variáveis de `.env.example`;
8. validar `/api/dev-health` e `/api/dev-ready`;
9. validar login/RBAC;
10. implementar e habilitar o conector M2M no `sra-luck-react`;
11. configurar Supabase Management API, Cloudflare e Vercel para observabilidade;
12. habilitar scheduler do Infrastructure Guardian.
