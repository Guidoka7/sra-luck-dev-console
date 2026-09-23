# Desenvolvimento local

## Requisitos

- Node.js 20+
- conta Vercel para emular Functions com fidelidade
- projeto Supabase exclusivo do Dev Console

## 1. Validar o repositório

```bash
npm run check
```

Esse comando verifica JavaScript, scripts inline, links locais, IDs duplicados e componentes obrigatórios.

## 2. Configurar variáveis

Copie `.env.example` para um arquivo local de ambiente aceito pela sua ferramenta/Vercel e preencha apenas no seu computador.

Nunca commite o arquivo preenchido.

## 3. Rodar com Vercel

O caminho recomendado é usar o ambiente local da Vercel para que `/api/*` funcione como em produção:

```bash
npx vercel dev
```

Abra a URL informada pelo CLI.

## 4. Primeiro banco

Aplique, nesta ordem:

1. `supabase/001_dev_console_base.sql`
2. `supabase/002_infrastructure_observability.sql`
3. crie o usuário no Supabase Auth
4. use `supabase/BOOTSTRAP_OWNER.sql` para vincular o primeiro Owner

## 5. Conector Sra Luck

Sem o conector M2M implementado no `sra-luck-react`, as telas próprias do Dev Console funcionam, mas consultas administrativas ao sistema principal devem retornar configuração/autorização pendente em vez de fingir dados.
