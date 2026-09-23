# Checklist — primeiro push e primeira publicação

## GitHub

- [ ] Criar repositório privado `Guidoka7/sra-luck-dev-console`
- [ ] Enviar todo o conteúdo deste pacote para a `main`
- [ ] Confirmar que `.env` não foi commitado
- [ ] Confirmar execução verde do workflow `validate`
- [ ] Opcional: habilitar proteção da `main` após a primeira publicação

## Supabase Dev Console

- [ ] Criar projeto novo
- [ ] Aplicar migration `001`
- [ ] Aplicar migration `002`
- [ ] Criar primeiro usuário no Auth
- [ ] Executar bootstrap do Owner
- [ ] Confirmar RLS/restrições

## Vercel Dev Console

- [ ] Criar projeto apontando para o novo repo
- [ ] Adicionar variáveis de `.env.example`
- [ ] Fazer primeiro deploy
- [ ] Validar `/api/dev-health`
- [ ] Validar `/api/dev-ready`
- [ ] Validar login/logout/recovery

## Sra Luck

- [ ] Implementar autenticação M2M no `sra-luck-react`
- [ ] Configurar `SRA_LUCK_SERVICE_TOKEN` nos dois lados
- [ ] Testar health/readiness
- [ ] Testar uma consulta administrativa somente leitura
- [ ] Testar uma mutação segura e auditada

## Infraestrutura

- [ ] Configurar Management API do Supabase Sra Luck
- [ ] Configurar Management API do Supabase Dev
- [ ] Configurar Cloudflare GraphQL
- [ ] Configurar Vercel API
- [ ] Definir scheduler do Infrastructure Guardian
- [ ] Validar abertura e mitigação automática de incidente de teste

## Produção

- [ ] QA visual
- [ ] QA de permissões por perfil
- [ ] E2E autenticado
- [ ] Revisão de headers/CSP
- [ ] Revisão de logs sem PII/segredos
- [ ] Registrar SHA da primeira release
