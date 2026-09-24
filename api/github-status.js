const { json, body, methodNotAllowed, requestId, sameOrigin } = require('./_lib/http');
const { requireSession, hasPermission } = require('./_lib/rbac');
const { audit } = require('./_lib/supabase');
const { getSecret } = require('./_lib/secrets');

// Engenharia: GitHub (PRs, CI, commits) e Vercel (deploys) dos dois projetos.
// Leitura: code.view. Ações (re-rodar CI, merge, criar PR, disparar workflow,
// redeploy/promover): releases.manage, sempre auditadas. Só os dois repos e
// os dois projetos configurados podem ser tocados.

const REPOS = async () => ({
  sra: String((await getSecret('GITHUB_REPOSITORY')) || 'Guidoka7/sra-luck-react'),
  console: String((await getSecret('GITHUB_CONSOLE_REPOSITORY')) || 'Guidoka7/sra-luck-dev-console'),
});
const PROJECTS = async () => ({
  sra: String((await getSecret('SRA_VERCEL_PROJECT_ID')) || '').trim(),
  console: String(process.env.VERCEL_PROJECT_ID || (await getSecret('DEV_VERCEL_PROJECT_ID')) || '').trim(),
});

async function ghHeaders() {
  const token = String((await getSecret('GITHUB_TOKEN')) || '').trim();
  const h = { Accept: 'application/vnd.github+json', 'User-Agent': 'sra-luck-dev-console', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}
async function github(repo, path, init = {}) {
  const r = await fetch(`https://api.github.com/repos/${repo}${path}`, { ...init, headers: { ...(await ghHeaders()), ...(init.body ? { 'Content-Type': 'application/json' } : {}) }, cache: 'no-store' });
  const data = r.status === 204 ? {} : await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data?.message || `GitHub HTTP ${r.status}`); e.status = r.status; throw e; }
  return data;
}
async function vercel(path, init = {}) {
  const token = String((await getSecret('DEV_VERCEL_ACCESS_TOKEN')) || '').trim();
  if (!token) { const e = new Error('Configure DEV_VERCEL_ACCESS_TOKEN para ver e operar os deploys.'); e.status = 503; throw e; }
  const team = String((await getSecret('DEV_VERCEL_TEAM_ID')) || '').trim();
  const url = `https://api.vercel.com${path}${team ? `${path.includes('?') ? '&' : '?'}teamId=${encodeURIComponent(team)}` : ''}`;
  const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) }, cache: 'no-store' });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data?.error?.message || `Vercel HTTP ${r.status}`); e.status = r.status; throw e; }
  return data;
}

function normalizeCommit(x) {
  return { sha: x?.sha || null, message: String(x?.commit?.message || '').split('\n')[0] || 'Commit', author: x?.commit?.author?.name || x?.author?.login || null, date: x?.commit?.author?.date || x?.commit?.committer?.date || null, url: x?.html_url || null };
}
function normalizeRun(x) {
  return { id: x?.id || null, name: x?.name || x?.display_title || 'Workflow', title: x?.display_title || null, event: x?.event || null, status: x?.status || null, conclusion: x?.conclusion || null, head_sha: x?.head_sha || null, head_branch: x?.head_branch || null, created_at: x?.created_at || null, updated_at: x?.updated_at || null, run_started_at: x?.run_started_at || null, url: x?.html_url || null };
}
function rollup(checks, statuses) {
  const items = [...(checks?.check_runs || []).map((c) => ({ name: c.name, state: c.status !== 'completed' ? 'pending' : ['success', 'neutral', 'skipped'].includes(c.conclusion) ? 'success' : 'failure', url: c.html_url })), ...(statuses?.statuses || []).map((s) => ({ name: s.context, state: s.state === 'success' ? 'success' : s.state === 'pending' ? 'pending' : 'failure', url: s.target_url, description: s.description }))];
  const state = !items.length ? 'none' : items.some((i) => i.state === 'failure') ? 'failure' : items.some((i) => i.state === 'pending') ? 'pending' : 'success';
  return { state, items };
}
async function ciFor(repo, sha) {
  const [checks, statuses] = await Promise.all([github(repo, `/commits/${sha}/check-runs?per_page=50`).catch(() => null), github(repo, `/commits/${sha}/status`).catch(() => null)]);
  return rollup(checks, statuses);
}

async function repoSummary(repo) {
  const [commitsRaw, runsRaw, pullsRaw] = await Promise.all([
    github(repo, '/commits?sha=main&per_page=15'),
    github(repo, '/actions/runs?per_page=25'),
    github(repo, '/pulls?state=open&per_page=15'),
  ]);
  const commits = (Array.isArray(commitsRaw) ? commitsRaw : []).map(normalizeCommit);
  const runs = (runsRaw?.workflow_runs || []).map(normalizeRun);
  const pulls = await Promise.all((Array.isArray(pullsRaw) ? pullsRaw : []).slice(0, 10).map(async (p) => {
    const [detail, ci] = await Promise.all([github(repo, `/pulls/${p.number}`).catch(() => p), ciFor(repo, p.head.sha)]);
    const failedRun = runs.find((r) => r.head_sha === p.head.sha && r.status === 'completed' && r.conclusion === 'failure');
    return { number: p.number, title: p.title, author: p.user?.login || null, head: p.head?.ref, base: p.base?.ref, sha: p.head?.sha, draft: Boolean(p.draft), url: p.html_url, updated_at: p.updated_at, mergeable: detail.mergeable ?? null, mergeable_state: detail.mergeable_state || null, ci, failedRunId: failedRun?.id || null };
  }));
  const mainCi = commits[0] ? await ciFor(repo, commits[0].sha) : { state: 'none', items: [] };
  return { repo, commits, runs, pulls, main: { commit: commits[0] || null, ci: mainCi } };
}

async function deployments(projectId) {
  if (!projectId) return { configured: false, deployments: [] };
  const data = await vercel(`/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=12`);
  const list = (data.deployments || []).map((d) => ({ uid: d.uid, name: d.name, url: d.url, state: d.state || d.readyState, target: d.target || 'preview', createdAt: d.createdAt, ready: d.ready, creator: d.creator?.username || null, branch: d.meta?.githubCommitRef || null, sha: d.meta?.githubCommitSha || null, message: d.meta?.githubCommitMessage ? String(d.meta.githubCommitMessage).split('\n')[0] : null }));
  let project = null;
  try { project = await vercel(`/v9/projects/${encodeURIComponent(projectId)}`); } catch { /* nome/produção atual são complementares */ }
  const productionId = project?.targets?.production?.id || null;
  return { configured: true, projectId, name: project?.name || list[0]?.name || null, productionId, deployments: list.map((d) => ({ ...d, current: d.uid === productionId })) };
}

async function overview() {
  const repos = await REPOS(), projects = await PROJECTS();
  const settle = (p) => p.then((v) => ({ ok: true, ...v })).catch((e) => ({ ok: false, erro: e.message, status: e.status || null }));
  const [sra, dc, vsra, vdc] = await Promise.all([settle(repoSummary(repos.sra)), settle(repoSummary(repos.console)), settle(deployments(projects.sra)), settle(deployments(projects.console))]);
  return { ok: true, geradoEm: new Date().toISOString(), tokens: { github: Boolean(await getSecret('GITHUB_TOKEN')), vercel: Boolean(await getSecret('DEV_VERCEL_ACCESS_TOKEN')) }, repos: { sra, console: dc }, deploys: { sra: vsra, console: vdc } };
}

/**
 * "Últimas alterações" da Visão Geral: commits e CI da main do Sra Luck,
 * deploys da Vercel, migrations presentes no repositório e se a produção
 * roda o mesmo código da main. Só afirma sincronia quando há os dois SHAs.
 */
async function changes() {
  const repos = await REPOS(), projects = await PROJECTS();
  const settle = (p) => p.then((v) => ({ ok: true, v })).catch((e) => ({ ok: false, erro: e.message, status: e.status || null }));
  const [commitsR, runsR, dirR, depR] = await Promise.all([
    settle(github(repos.sra, '/commits?sha=main&per_page=10')),
    settle(github(repos.sra, '/actions/runs?branch=main&per_page=10')),
    settle(github(repos.sra, '/contents/supabase?ref=main')),
    settle(deployments(projects.sra)),
  ]);
  const commits = commitsR.ok ? (Array.isArray(commitsR.v) ? commitsR.v : []).map(normalizeCommit) : [];
  const runs = runsR.ok ? (runsR.v?.workflow_runs || []).map(normalizeRun) : [];
  const main = commits[0] || null;

  let migrations = { ok: false, erro: dirR.ok ? null : dirR.erro, itens: [] };
  if (dirR.ok && Array.isArray(dirR.v)) {
    const files = dirR.v.map((f) => f.name).map((name) => ({ name, n: Number((name.match(/^migration_(\d+)_.+\.sql$/) || [])[1]) })).filter((f) => Number.isFinite(f.n)).sort((a, b) => b.n - a.n).slice(0, 6);
    const itens = await Promise.all(files.map(async (f) => {
      const c = await github(repos.sra, `/commits?sha=main&path=${encodeURIComponent(`supabase/${f.name}`)}&per_page=1`).catch(() => null);
      const commit = Array.isArray(c) && c[0] ? normalizeCommit(c[0]) : null;
      return { numero: f.n, arquivo: f.name, alteradaEm: commit?.date || null, commit: commit?.sha || null, mensagem: commit?.message || null };
    }));
    migrations = { ok: true, itens, nota: 'Presentes no repositório (main). A aplicação no banco é manual e não é verificável daqui.' };
  }

  const dep = depR.ok ? depR.v : { configured: false, deployments: [], erro: depR.erro };
  const producao = (dep.deployments || []).find((d) => d.current) || (dep.deployments || []).find((d) => d.target === 'production' && d.state === 'READY') || null;
  let sincronia = { estado: 'desconhecido', motivo: !dep.configured ? 'Projeto Vercel do Sra Luck não configurado (SRA_VERCEL_PROJECT_ID).' : !producao ? 'Nenhum deploy de produção encontrado.' : !producao.sha ? 'O deploy de produção não informa o commit.' : !main ? 'Não foi possível ler a main.' : null };
  if (producao?.sha && main?.sha) {
    if (producao.sha === main.sha) sincronia = { estado: 'sincronizado', producaoSha: producao.sha, mainSha: main.sha };
    else {
      const cmp = await github(repos.sra, `/compare/${producao.sha}...${main.sha}`).catch(() => null);
      sincronia = cmp
        ? { estado: cmp.ahead_by > 0 ? 'producao_atras' : 'divergente', commitsAtras: cmp.ahead_by ?? null, commitsNaFrente: cmp.behind_by ?? null, producaoSha: producao.sha, mainSha: main.sha }
        : { estado: 'desconhecido', motivo: 'Não foi possível comparar os commits.', producaoSha: producao.sha, mainSha: main.sha };
    }
  }
  return {
    ok: true, geradoEm: new Date().toISOString(), repo: repos.sra,
    fontes: { github: commitsR.ok ? 'ok' : commitsR.erro, vercel: dep.configured === false ? (dep.erro || 'não configurado') : 'ok' },
    main, commits, runs, ci: runs[0] || null, migrations,
    deploy: { configured: dep.configured !== false, erro: dep.erro || null, producao, recentes: (dep.deployments || []).slice(0, 12) },
    sincronia,
  };
}

async function legacySummary(repo) {
  const [commitsRaw, runsRaw] = await Promise.all([github(repo, '/commits?sha=main&per_page=20'), github(repo, '/actions/runs?branch=main&per_page=20')]);
  const s = { commits: (Array.isArray(commitsRaw) ? commitsRaw : []).map(normalizeCommit), runs: (runsRaw?.workflow_runs || []).map(normalizeRun) };
  const commit = s.commits[0] || null, latestRun = s.runs[0] || null;
  return { ok: true, repository: repo, commit, current: commit, sha: commit?.sha || null, message: commit?.message || null, commits: s.commits, runs: s.runs, workflows: s.runs, latestRun, ci: { ok: latestRun ? latestRun.status === 'completed' && latestRun.conclusion === 'success' : null, status: latestRun?.status || null, conclusion: latestRun?.conclusion || null, sha: latestRun?.head_sha || null } };
}

async function action(actor, input) {
  const repos = await REPOS(), projects = await PROJECTS();
  const which = input?.repo === 'console' ? 'console' : 'sra';
  const repo = repos[which];
  const name = String(input?.action || '');
  const int = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);
  if (name === 'rerun_failed') {
    const run = int(input.runId); if (!run) return [400, { erro: 'Informe o workflow.' }];
    await github(repo, `/actions/runs/${run}/rerun-failed-jobs`, { method: 'POST' });
    return [200, { ok: true, mensagem: 'Jobs com falha re-enfileirados no GitHub Actions.' }, { repo, run }];
  }
  if (name === 'merge_pr') {
    const number = int(input.number); if (!number) return [400, { erro: 'Informe o PR.' }];
    const method = ['squash', 'merge', 'rebase'].includes(input.method) ? input.method : 'squash';
    const pr = await github(repo, `/pulls/${number}`);
    if (pr.mergeable === false) return [409, { erro: 'O PR tem conflito com a base. Resolva antes do merge.' }];
    const ci = await ciFor(repo, pr.head.sha);
    if (ci.state === 'failure' && input.force !== true) return [409, { erro: 'O CI deste PR está vermelho. Corrija ou confirme o merge mesmo assim.', codigo: 'CI_FAILING' }];
    const r = await github(repo, `/pulls/${number}/merge`, { method: 'PUT', body: JSON.stringify({ merge_method: method, sha: pr.head.sha }) });
    return [200, { ok: true, mensagem: r.message || 'PR mesclado.', sha: r.sha }, { repo, number, method, forced: input.force === true }];
  }
  if (name === 'create_pr') {
    const head = String(input.head || '').trim(), base = String(input.base || 'main').trim(), title = String(input.title || '').trim();
    if (!/^[\w./-]{1,200}$/.test(head) || !/^[\w./-]{1,200}$/.test(base) || !title) return [400, { erro: 'Informe branch, base e título válidos.' }];
    const r = await github(repo, '/pulls', { method: 'POST', body: JSON.stringify({ head, base, title: title.slice(0, 250), body: String(input.body || '').slice(0, 20000), draft: input.draft === true }) });
    return [200, { ok: true, mensagem: `PR #${r.number} criado.`, url: r.html_url, number: r.number }, { repo, number: r.number, head, base }];
  }
  if (name === 'dispatch_workflow') {
    const workflow = String(input.workflow || '').trim(), ref = String(input.ref || 'main').trim();
    if (!/^[\w.-]{1,120}$/.test(workflow) || !/^[\w./-]{1,200}$/.test(ref)) return [400, { erro: 'Workflow ou branch inválidos.' }];
    await github(repo, `/actions/workflows/${encodeURIComponent(workflow)}/dispatches`, { method: 'POST', body: JSON.stringify({ ref }) });
    return [200, { ok: true, mensagem: 'Workflow disparado.' }, { repo, workflow, ref }];
  }
  if (name === 'redeploy' || name === 'promote') {
    const projectId = projects[which]; if (!projectId) return [503, { erro: 'Projeto Vercel não configurado para este repositório.' }];
    const uid = String(input.deploymentId || '').trim(); if (!/^dpl_[A-Za-z0-9]{6,60}$/.test(uid)) return [400, { erro: 'Deploy inválido.' }];
    const d = await vercel(`/v13/deployments/${uid}`);
    if (d.projectId && d.projectId !== projectId) return [403, { erro: 'Este deploy não pertence ao projeto configurado.' }];
    if (name === 'promote') {
      await vercel(`/v10/projects/${encodeURIComponent(projectId)}/promote/${uid}`, { method: 'POST' });
      return [200, { ok: true, mensagem: 'Deploy promovido para produção.' }, { project: projectId, deployment: uid }];
    }
    const target = input.target === 'production' ? 'production' : undefined;
    const r = await vercel('/v13/deployments', { method: 'POST', body: JSON.stringify({ name: d.name, deploymentId: uid, ...(target ? { target } : {}) }) });
    return [200, { ok: true, mensagem: 'Novo deploy iniciado.', url: r.url ? `https://${r.url}` : null, id: r.id }, { project: projectId, from: uid, target: target || 'preview' }];
  }
  return [400, { erro: 'Ação desconhecida.' }];
}

module.exports = async function handler(req, res) {
  res.setHeader('x-request-id', requestId(req));
  if (req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { erro: 'Origem da requisição não autorizada.', codigo: 'ORIGIN_DENIED' });
    const actor = await requireSession(req, res, 'releases.manage'); if (!actor) return;
    let input; try { input = await body(req); } catch (e) { return json(res, e.statusCode || 400, { erro: 'Payload inválido.' }); }
    try {
      const [status, payload, details] = await action(actor, input);
      await audit({ actor_user_id: actor.id, action: `engineering.${String(input?.action || 'unknown').slice(0, 40)}`, resource: input?.repo === 'console' ? 'dev-console' : 'sra-luck-react', details: { ...(details || {}), status, ok: status < 400 } });
      return json(res, status, payload);
    } catch (e) {
      await audit({ actor_user_id: actor.id, action: `engineering.${String(input?.action || 'unknown').slice(0, 40)}`, resource: input?.repo === 'console' ? 'dev-console' : 'sra-luck-react', details: { ok: false, erro: e.message } });
      const hint = e.status === 401 || e.status === 403 || e.status === 404 ? ' Confira se o token tem permissão de escrita neste repositório/projeto.' : '';
      return json(res, e.status && e.status < 600 ? e.status : 502, { erro: (e.message || 'Falha na ação.') + hint });
    }
  }
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET', 'POST']);
  const actor = await requireSession(req, res, 'code.view'); if (!actor) return;
  const resource = String(req.query?.resource || 'summary');
  try {
    if (resource === 'overview') return json(res, 200, { ...(await overview()), podeOperar: hasPermission(actor, 'releases.manage') });
    if (resource === 'changes') return json(res, 200, await changes());
    if (resource === 'branches') {
      const repo = (await REPOS())[req.query?.repo === 'console' ? 'console' : 'sra'];
      const data = await github(repo, '/branches?per_page=100');
      return json(res, 200, { ok: true, branches: (Array.isArray(data) ? data : []).map((b) => b.name) });
    }
    if (resource === 'workflows') {
      const repo = (await REPOS())[req.query?.repo === 'console' ? 'console' : 'sra'];
      const data = await github(repo, '/actions/workflows?per_page=50');
      return json(res, 200, { ok: true, workflows: (data.workflows || []).map((w) => ({ id: w.id, name: w.name, path: w.path, file: String(w.path || '').split('/').pop(), state: w.state })) });
    }
    if (resource !== 'summary') return json(res, 400, { erro: 'Recurso inválido.' });
    return json(res, 200, await legacySummary((await REPOS()).sra));
  } catch (error) {
    return json(res, error?.status || 502, { ok: false, erro: error?.message || 'Não foi possível consultar o GitHub.' });
  }
};
module.exports.changes = changes;
