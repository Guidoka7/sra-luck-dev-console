// Central de Incidentes: acompanhamento dos incidentes que a varredura já registra em
// dev_incidents / dev_incident_events (Central de Problemas + Infrastructure Guardian).
// Não detecta nada novo e não mexe em produção: só muda o registro de acompanhamento
// (status, responsável, notas) no banco do próprio Dev Console, com evento e auditoria.
const { rest, audit } = require('./supabase');

const STATUS_MANUAIS = new Set(['investigating', 'mitigated', 'resolved']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOME_STATUS = { open: 'aberto', investigating: 'investigando', mitigated: 'mitigado', resolved: 'resolvido', reopened: 'reaberto' };

async function listar({ dias = 7 } = {}) {
  const d = Math.min(Math.max(Number(dias) || 7, 1), 30);
  const desde = new Date(Date.now() - d * 86400000).toISOString();
  const q = encodeURIComponent(`(status.in.(open,investigating,reopened,mitigated),last_seen_at.gte."${desde}",updated_at.gte."${desde}")`);
  const [incidentes, eventos, responsaveis] = await Promise.all([
    rest(`dev_incidents?or=${q}&select=id,fingerprint,title,module,severity,status,occurrence_count,affected_entities,first_seen_at,last_seen_at,assigned_to,source,source_reference,metadata,resolved_at,updated_at&order=last_seen_at.desc&limit=300`, { method: 'GET' }),
    // "signal_repeated" é gravado a cada leitura e só infla a lista; a repetição aparece em occurrence_count.
    rest(`dev_incident_events?created_at=gte.${encodeURIComponent(desde)}&event_type=neq.signal_repeated&select=incident_id,event_type,message,actor_user_id,created_at&order=created_at.asc&limit=3000`, { method: 'GET' }),
    rest('dev_users?active=eq.true&role=in.(owner,developer,operator)&select=id,name,role&order=name.asc&limit=100', { method: 'GET' }).catch(() => []),
  ]);
  const ids = new Set((incidentes || []).map((i) => i.id));
  return {
    ok: true, geradoEm: new Date().toISOString(), desde, dias: d,
    incidentes: (incidentes || []).map((i) => ({ ...i, metadata: { ...(i.metadata || {}), evidencias: undefined } })),
    evidencias: Object.fromEntries((incidentes || []).map((i) => [i.id, i.metadata?.evidencias || []])),
    eventos: (eventos || []).filter((e) => ids.has(e.incident_id)),
    responsaveis: responsaveis || [],
  };
}

// acao: status | responsavel | nota. ids: 1..20 (um grupo de alertas relacionados muda junto).
async function atualizar(actor, input) {
  const ids = [...new Set((Array.isArray(input?.ids) ? input.ids : [input?.id]).map(String).filter((x) => UUID.test(x)))].slice(0, 20);
  if (!ids.length) return { status: 400, body: { erro: 'Informe o incidente.', codigo: 'INCIDENT_INPUT_INVALID' } };
  const acao = String(input?.acao || '');
  const nota = String(input?.nota || '').trim().slice(0, 500);
  let responsavel = null;
  if (acao === 'status' && !STATUS_MANUAIS.has(String(input?.status))) return { status: 400, body: { erro: 'Status inválido.', codigo: 'INCIDENT_STATUS_INVALID' } };
  if (acao === 'responsavel' && input?.usuario) {
    if (!UUID.test(String(input.usuario))) return { status: 400, body: { erro: 'Responsável inválido.', codigo: 'INCIDENT_ASSIGNEE_INVALID' } };
    const u = await rest(`dev_users?id=eq.${encodeURIComponent(input.usuario)}&active=eq.true&select=id,name&limit=1`, { method: 'GET' });
    responsavel = u?.[0] || null;
    if (!responsavel) return { status: 400, body: { erro: 'Responsável não encontrado ou inativo.', codigo: 'INCIDENT_ASSIGNEE_INVALID' } };
  }
  if (acao === 'nota' && !nota) return { status: 400, body: { erro: 'Escreva a nota.', codigo: 'INCIDENT_NOTE_EMPTY' } };
  if (!['status', 'responsavel', 'nota'].includes(acao)) return { status: 400, body: { erro: 'Ação inválida.', codigo: 'INCIDENT_ACTION_INVALID' } };

  const rows = await rest(`dev_incidents?id=in.(${ids.join(',')})&select=id,status,assigned_to,metadata,title`, { method: 'GET' });
  if (!rows?.length) return { status: 404, body: { erro: 'Incidente não encontrado.', codigo: 'INCIDENT_NOT_FOUND' } };
  const agora = new Date().toISOString(), feitos = [];
  for (const row of rows) {
    let patch = null, evento = null;
    if (acao === 'status') {
      const para = String(input.status);
      // A marcação manual fica no metadata para a varredura respeitá-la (mitigado manual não é reaberto
      // só por ainda ser detectado; resolvido é reaberto se o problema voltar).
      patch = { status: para, updated_at: agora, resolved_at: para === 'resolved' ? agora : null, metadata: { ...(row.metadata || {}), manual: { status: para, por: actor.id, em: agora } } };
      evento = { event_type: 'status_changed', message: `${actor.name || 'Alguém'} mudou de ${NOME_STATUS[row.status] || row.status} para ${NOME_STATUS[para]}${nota ? `: ${nota}` : '.'}`, details: { de: row.status, para, nota: nota || null } };
    } else if (acao === 'responsavel') {
      patch = { assigned_to: responsavel?.id || null, updated_at: agora };
      evento = { event_type: 'assigned', message: responsavel ? `${actor.name || 'Alguém'} atribuiu a ${responsavel.name}.` : `${actor.name || 'Alguém'} removeu o responsável.`, details: { para: responsavel?.id || null } };
    } else {
      evento = { event_type: 'note', message: `${actor.name || 'Alguém'}: ${nota}`, details: { nota } };
    }
    if (patch) await rest(`dev_incidents?id=eq.${encodeURIComponent(row.id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
    await rest('dev_incident_events', { method: 'POST', body: JSON.stringify({ incident_id: row.id, actor_user_id: actor.id, ...evento }) }).catch(() => undefined);
    feitos.push(row.id);
  }
  await audit({ actor_user_id: actor.id, action: `incidents.${acao}`, resource: 'dev_incidents', resource_id: feitos.join(',').slice(0, 300), details: { ids: feitos, status: input?.status || null, responsavel: responsavel?.id || null, nota: nota || null } }).catch(() => undefined);
  return { status: 200, body: { ok: true, atualizados: feitos.length } };
}

module.exports = { listar, atualizar, STATUS_MANUAIS };
