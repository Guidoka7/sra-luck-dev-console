// Explicações em linguagem simples para cada tipo de problema detectado.
// Sem custo e sem IA: regras escritas a partir do que cada detector sabe.
// Formato: { oQue, porQue, comoResolver: [passos] }.

function ev(p, label) {
  return (p.evidencias || []).find((e) => e.label === label)?.valor;
}

function bug(p) {
  const t = p.pacote || {};
  const status = Number(t.status_http) || 0;
  const rota = t.rota || 'uma rota';
  if (status >= 500) return {
    oQue: `O servidor do Sra Luck quebrou ${p.ocorrencias}x ao responder ${t.metodo || ''} ${rota}. Quem passou por ali viu erro em vez da tela funcionando.`,
    porQue: 'Erro 5xx é falha do nosso código ou de algo que ele depende (banco, integração). Não é culpa da cliente e tende a se repetir até ser corrigido.',
    comoResolver: [
      'Abra o pacote técnico e copie um request ID.',
      'Procure esse request ID nos logs da Vercel do sra-luck-react para ver a exceção completa.',
      'Veja em Engenharia se houve deploy pouco antes do primeiro erro; se sim, provavelmente veio dele (dá para voltar o deploy anterior).',
      'Corrija, publique e acompanhe aqui: o problema some sozinho quando parar de acontecer.',
    ],
  };
  if (status === 401 || status === 403) return {
    oQue: `Pessoas estão levando "sem permissão" em ${rota} (${p.ocorrencias}x).`,
    porQue: 'Pode ser normal (sessão expirou) ou uma regra de permissão errada impedindo alguém de fazer o próprio trabalho.',
    comoResolver: ['Veja se é sempre a mesma pessoa/tela (Atividade do Admin ajuda).', 'Se for sessão expirada, é esperado; se for alguém com o cargo certo sendo barrado, revise as permissões do cargo.'],
  };
  if (status === 404) return {
    oQue: `Alguma tela está chamando ${rota}, mas esse endereço não existe mais (${p.ocorrencias}x).`,
    porQue: 'Geralmente é app antigo em cache ou um link esquecido depois de uma mudança.',
    comoResolver: ['Confira se a rota foi renomeada/removida recentemente.', 'Se for app antigo em cache, peça para a cliente atualizar o app; se for link do código, corrija o link.'],
  };
  if (/NETWORK/.test(t.codigo || '')) return {
    oQue: `O app não conseguiu falar com o servidor em ${rota} (${p.ocorrencias}x).`,
    porQue: 'Costuma ser internet fraca da cliente; se muita gente tiver ao mesmo tempo, o servidor pode estar fora do ar.',
    comoResolver: ['Se for uma pessoa só, geralmente é conexão dela.', 'Se forem várias ao mesmo tempo, olhe Infraestrutura e a prontidão do Sra Luck.'],
  };
  if (/GLOBAL_JS_ERROR|UNHANDLED_REJECTION|CONSOLE_ERROR/.test(t.codigo || '')) return {
    oQue: `A tela ${rota} teve um erro de JavaScript (${p.ocorrencias}x): "${String(t.mensagem || '').slice(0, 120)}".`,
    porQue: 'Erro de tela pode deixar botão sem funcionar ou parte da página em branco.',
    comoResolver: ['Abra a tela citada e tente reproduzir o caminho da cliente.', 'Use o pacote técnico (mensagem e amostras) para achar o componente e corrigir.', 'Use "Pedir análise da IA" para uma primeira hipótese da causa.'],
  };
  return {
    oQue: `Erro repetido em ${rota} (${p.ocorrencias}x): "${String(t.mensagem || p.descricao || '').slice(0, 140)}".`,
    porQue: 'Erro que se repete costuma ser bug de verdade, não acaso.',
    comoResolver: ['Abra o pacote técnico para ver onde e quando acontece.', 'Reproduza o caminho e corrija; acompanhe aqui se parou.'],
  };
}

const RULES = [
  [/^plataforma:ready$/, () => ({ oQue: 'O Sra Luck não está respondendo que está pronto.', porQue: 'Se ele não está pronto, clientes e equipe podem não conseguir entrar nem usar nada.', comoResolver: ['Veja Infraestrutura: banco (Supabase) e hospedagem (Vercel).', 'Confira o último deploy em Engenharia; se quebrou, volte o anterior.', 'Verifique se as variáveis do Supabase estão configuradas na Vercel.'] })],
  [/^plataforma:diagnostico:/, (p) => ({ oQue: `${p.titulo.replace('Falha no diagnóstico: ', 'A tabela ')} não respondeu no teste do banco.`, porQue: 'Tudo que depende dessa tabela (telas, rotinas, relatórios) pode falhar.', comoResolver: ['Veja em Infraestrutura se o Supabase está com RAM/CPU/disco no limite.', 'Confira no Supabase se a tabela existe e se alguma migration ficou pela metade.'] })],
  [/^plataforma:storage$/, () => ({ oQue: 'Algum “armário” de arquivos (bucket do Storage) está faltando, inacessível ou público.', porQue: 'Boletos, comprovantes, fotos e vouchers podem não subir/abrir; bucket público expõe arquivos de clientes.', comoResolver: ['No Supabase → Storage, confira os buckets boletos-clientes, clientes-perfil e clube-vouchers.', 'Eles precisam existir e estar privados.'] })],
  [/^funcao:/, (p) => p.tipo === 'configuracao'
    ? { oQue: `O Dev Console não tem acesso à função "${p.titulo.match(/"(.+)"/)?.[1] || ''}".`, porQue: 'Não é o Admin quebrado: é o conector que não deixou ler. Enquanto isso, essa área fica sem monitoramento.', comoResolver: ['Confira em Conexões se o token do conector está igual nos dois projetos.', 'Se o token está certo, a rota pode não estar liberada no conector do Sra Luck.'] }
    : { oQue: `A função "${p.titulo.match(/"(.+)"/)?.[1] || ''}" do Admin respondeu com erro.`, porQue: 'Essa tela provavelmente está quebrada também para a equipe no Admin.', comoResolver: ['Abra a mesma tela no Admin para confirmar.', 'Procure o erro nos logs da Vercel do sra-luck-react (horário do teste).', 'Veja se houve deploy recente em Engenharia.'] }],
  [/^app:desempenho:APP_MEMORY_PRESSURE$/, (p) => ({ oQue: `O app está usando memória demais no celular de algumas clientes (${ev(p, 'Maior uso de memória') || 'acima de 80%'}).`, porQue: 'Com pouca memória o celular fica lento, trava ou fecha o app.', comoResolver: ['Veja em quais telas acontece (evidências).', 'Procure listas muito grandes, imagens pesadas ou coisas que não são limpas ao trocar de aba.', 'Peça análise da IA com o pacote técnico para achar o suspeito.'] })],
  [/^app:desempenho:APP_MAIN_THREAD_BLOCKED$/, () => ({ oQue: 'O app travou a tela por alguns segundos para algumas clientes.', porQue: 'Nesse tempo nada responde ao toque; parece que o app congelou.', comoResolver: ['Veja as telas afetadas.', 'Procure cálculos pesados ou listas enormes renderizadas de uma vez; divida ou pagine.'] })],
  [/^app:desempenho:APP_SLOW_LOAD$/, () => ({ oQue: 'Algumas telas do app estão demorando mais de 4 segundos para aparecer.', porQue: 'Demora faz a cliente achar que não funcionou e desistir.', comoResolver: ['Veja as telas afetadas.', 'Reduza imagens, carregue dados aos poucos e confira se a API está lenta em Infraestrutura.'] })],
  [/^notificacoes:vapid$/, () => ({ oQue: 'As chaves do Web Push (VAPID) estão faltando ou inválidas.', porQue: 'Sem elas nenhuma notificação chega no celular das clientes.', comoResolver: ['No Admin do Sra Luck → Integrações → Web Push, gere ou salve um par de chaves válido.', 'Depois teste aqui em Integrações.'] })],
  [/^notificacoes:entrega$/, () => ({ oQue: 'Muitas notificações push não estão chegando nos aparelhos.', porQue: 'A cliente deixa de receber lembrete de parcela e avisos da jornada.', comoResolver: ['Veja em Notificações quais envios falharam e a mensagem de erro.', 'Erro 404/410 = aparelho desinstalou/desativou (normal, o sistema limpa).', 'Erro 401/403 = problema de chave VAPID: confira em Integrações.'] })],
  [/^notificacoes:sem-inscricoes$/, () => ({ oQue: 'Nenhuma cliente ativou as notificações no celular.', porQue: 'Os avisos só aparecem dentro do app, então muita coisa passa despercebida.', comoResolver: ['Incentive as clientes a tocar em “Ativar notificações” no app.', 'Confira se o botão de ativar está aparecendo no app.'] })],
  [/^notificacoes:rotina-atraso$/, () => ({ oQue: 'A rotina que lembra as clientes de parcela atrasada não roda há mais tempo que o normal.', porQue: 'Cliente atrasada sem lembrete tende a atrasar mais.', comoResolver: ['Clique em “Rodar rotina agora” (é seguro: não manda duplicado).', 'O Agente de Notificações também roda sozinho na varredura diária.', 'Se continuar parando, configure um agendamento automático para a rotina.'] })],
  [/^notificacoes:rotina-vencimento$/, () => ({ oQue: 'A rotina que avisa sobre parcelas vencendo não rodou nas últimas 26h.', porQue: 'A cliente pode esquecer do vencimento.', comoResolver: ['Clique em “Rodar rotina agora” (é seguro: não repete aviso).'] })],
  [/^notificacoes:atraso-desligado$/, () => ({ oQue: 'O lembrete automático de parcela atrasada foi desligado.', porQue: 'Se não foi de propósito, clientes em atraso não estão sendo avisadas.', comoResolver: ['Se foi sem querer, religue em Notificações → Configuração da automação.'] })],
  [/^app:aptas-sem-acesso$/, (p) => ({ oQue: `${p.ocorrencias} cliente(s) já têm tudo certo no cadastro, mas ainda não receberam acesso ao app.`, porQue: 'Elas não conseguem acompanhar parcelas e agenda pelo celular.', comoResolver: ['Clique em “Liberar acesso”, escolha as clientes e confirme.', 'O sistema confere os requisitos de cada uma antes de liberar.'] })],
  [/^app:liberadas-cadastro-incompleto$/, () => ({ oQue: 'Algumas clientes têm o app liberado, mas falta dado obrigatório no cadastro.', porQue: 'Partes do app podem aparecer vazias ou com erro para elas.', comoResolver: ['Complete CPF, data de nascimento ou parcelas no Admin (cadastro da cliente).'] })],
  [/^app:cadastro-incompleto$/, () => ({ oQue: 'Tem cliente ativa que ainda não pode entrar no app porque falta dado no cadastro.', porQue: 'Enquanto faltar, não dá para liberar o app para ela.', comoResolver: ['Veja o que falta em cada uma (evidências).', 'Complete no Admin e depois libere o acesso.'] })],
  [/^app:liberadas-sem-uso$/, () => ({ oQue: 'Algumas clientes receberam o app, mas nunca abriram.', porQue: 'Pode ser dificuldade de login ou falta de orientação.', comoResolver: ['Mande uma mensagem explicando como entrar (CPF + data de nascimento).', 'Veja no drawer da cliente se ela tentou entrar e teve erro.'] })],
  [/^app:push-bloqueado$/, () => ({ oQue: 'Algumas clientes bloquearam as notificações no celular.', porQue: 'Elas não recebem avisos fora do app.', comoResolver: ['Só a própria cliente consegue reativar nas configurações do celular; vale orientar no atendimento.'] })],
  [/^v46:comparecimento-pendente$/, () => ({ oQue: 'Tem cliente com data de termos que já passou e ninguém marcou se ela compareceu.', porQue: 'A jornada fica parada: prazo cirúrgico e quitação não andam.', comoResolver: ['Abra a Jornada V46, encontre a cliente e marque o comparecimento (compareceu ou não).'] })],
  [/^v46:quitacao-pendente$/, () => ({ oQue: 'Clientes compareceram aos termos há mais de 7 dias e a quitação ainda não foi registrada.', porQue: 'Sem quitação, a agenda cirúrgica não libera.', comoResolver: ['Confira com o financeiro e registre a quitação na Jornada V46.'] })],
  [/^financeiro:validacoes-atrasadas$/, () => ({ oQue: 'Tem comprovante de pagamento esperando validação há mais de 2 dias.', porQue: 'Enquanto não valida, a parcela segue “em aberto” e a cliente pode receber lembrete de atraso sem dever.', comoResolver: ['Abra o Financeiro → Validações e confirme ou rejeite cada comprovante.'] })],
  [/^integracoes:base:/, () => ({ oQue: 'Uma integração não tem a estrutura de banco que precisa.', porQue: 'Ela não consegue registrar eventos nem funcionar direito.', comoResolver: ['Aplique a migration da integração no Supabase do Sra Luck.'] })],
  [/^integracoes:nao-verificada:/, () => ({ oQue: 'A integração tem credenciais, mas ninguém testou se elas funcionam.', porQue: 'Credencial errada só apareceria quando algo importante falhar.', comoResolver: ['Clique em “Testar conexão” (é seguro).', 'O Agente de Integrações também testa sozinho na varredura diária.'] })],
  [/^integracoes:custom:/, (p) => ({ oQue: `A sua API "${p.titulo.match(/"(.+)"/)?.[1] || ''}" não está respondendo como deveria.`, porQue: p.impacto || 'O que depende dela pode falhar.', comoResolver: ['Abra o endereço de saúde e veja se está no ar.', 'Se usa token, confira se a variável CUSTOM_API_* está configurada na Vercel.', 'Teste de novo em Integrações → APIs personalizadas.'] })],
];

function explicar(p) {
  if (p.id?.startsWith('bug:')) return bug(p);
  for (const [re, fn] of RULES) if (re.test(p.id || '')) return fn(p);
  return { oQue: p.descricao || p.titulo, porQue: p.impacto || 'Pode afetar a operação.', comoResolver: (p.acoes || []).filter((a) => a.tipo !== 'pacote' && a.tipo !== 'issue').map((a) => a.label) };
}

// Sinais de infraestrutura (Guardian) explicados.
const INFRA = {
  memory_usage_percent: ['A memória (RAM) do banco está alta', 'Banco sem memória fica lento e pode derrubar consultas.', ['Veja as consultas mais pesadas no Supabase.', 'Se for crescimento normal, aumente o plano/compute.']],
  swap_usage_percent: ['O banco está usando swap (memória de disco)', 'Swap é bem mais lento que RAM: sinal de falta de memória.', ['Trate como RAM alta: otimize consultas ou aumente o compute.']],
  disk_usage_percent: ['O disco do banco está enchendo', 'Disco cheio para o banco de gravar.', ['Limpe dados antigos (logs/monitoramento) ou aumente o disco no Supabase.']],
  cpu_usage_percent: ['A CPU do banco está alta', 'Consultas ficam lentas para todo mundo.', ['Procure consultas sem índice ou rotinas pesadas rodando.']],
  oom_kills_delta: ['O banco matou processos por falta de memória', 'Consultas foram derrubadas no meio.', ['Aumente o compute ou reduza consultas pesadas urgente.']],
  postgres_restarts_delta: ['O banco reiniciou', 'Durante o reinício tudo fica fora do ar.', ['Veja os logs do Supabase no horário.']],
  worker_memory_p99_percent: ['O servidor (Worker) está perto do limite de memória', 'Se passar do limite, requisições falham.', ['Procure respostas muito grandes ou objetos acumulando em memória.']],
  worker_error_rate_percent: ['Muitas requisições do servidor estão dando erro', 'Clientes e equipe veem falhas.', ['Veja a Central de Problemas para os erros 5xx.']],
  rss_usage_percent: ['A memória do próprio Dev Console está alta', 'O painel pode ficar lento.', ['Normalmente se resolve sozinho no próximo ciclo da função.']],
  storage_unavailable: ['O Storage de arquivos está com problema', 'Upload e download de arquivos podem falhar.', ['Veja os buckets em Infraestrutura.']],
  backup_age_hours: ['O último backup do banco está antigo', 'Se algo der errado, pode-se perder dados recentes.', ['Confira os backups no Supabase.']],
  guardian_age_hours: ['A varredura automática não roda há muito tempo', 'Problemas podem passar sem ninguém ver.', ['Confira o agendamento (cron) da Vercel e o CRON_SECRET.']],
  provider_unavailable: ['Uma fonte de monitoramento não respondeu', 'É um ponto cego: não dá para ver essa parte.', ['Confira a credencial dessa fonte em Conexões.']],
};

function explicarSinal(s) {
  const [titulo, porQue, passos] = INFRA[s.key] || [s.label, 'Pode afetar a operação.', ['Veja os detalhes em Infraestrutura.']];
  const valor = s.unit === '%' ? `${Math.round(s.value)}%` : s.unit === 'h' ? `${Math.round(s.value)}h` : String(s.value);
  return { titulo: `${titulo} (${s.label}: ${valor})`, oQue: `${titulo}: está em ${valor} (alerta a partir de ${s.warn}${s.unit === '%' ? '%' : s.unit === 'h' ? 'h' : ''}).`, porQue, comoResolver: passos };
}

module.exports = { explicar, explicarSinal };
