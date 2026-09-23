# Modelo operacional para bugs

## 1. Detectar

Prioridade alta quando ocorrer pelo menos um:

- evento `fatal`;
- HTTP 5xx;
- mesmo fingerprint 3+ vezes em uma hora;
- `/api/ready` não pronto;
- check do diagnóstico falhando.

## 2. Classificar

- **Operacional**: credencial/conexão, VAPID, OAuth, sync, fila de validação, acesso da cliente ou manutenção V46 já coberta por endpoint oficial.
- **Código**: exceção/5xx recorrente, contrato de API quebrado, regressão frontend/backend, erro sem correção operacional disponível.
- **Permissão**: 401/403 que precisa ser diferenciado entre sessão, RBAC esperado e regressão de autorização.
- **Dados/regra**: estado persistido inconsistente; deve ser investigado no módulo autoritativo, sem recalcular regra no Dev Console.

## 3. Reproduzir

O console pode refazer automaticamente apenas GETs. Mutações nunca são repetidas como teste genérico.

## 4. Corrigir

Use somente ações oficiais já disponíveis no backend. Ausência de endpoint = ausência de botão de correção automática.

## 5. Corrigir código

O pacote técnico inclui rota, código, severidade, ocorrências, request IDs, timestamps e estado do runtime. A aba Código & Releases ajuda a relacionar o incidente com commits/CI.

## 6. Verificar

Após manutenção ou deploy:

1. health;
2. ready;
3. diagnóstico;
4. GET de reprodução quando aplicável;
5. observar se o fingerprint deixa de reaparecer.
