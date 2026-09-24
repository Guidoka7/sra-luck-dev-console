# Supabase do Dev Console

## Ordem de aplicação

1. `001_dev_console_base.sql`
2. `002_infrastructure_observability.sql`
3. `003_custom_apis.sql` (APIs personalizadas da aba Integrações)
4. criar usuário no Supabase Auth
5. adaptar e executar `BOOTSTRAP_OWNER.sql`

Não aplicar essas migrations no Supabase do `sra-luck-react`. Este banco é exclusivo do Dev Console.
