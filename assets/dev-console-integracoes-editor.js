(() => {
  const esc = (v) => DC.esc(v == null ? '' : String(v));
  const ORIG = {
    painel: ['Cofre cifrado', 'ok'],
    variavel_de_ambiente: ['Variável de ambiente', 'info'],
    nao_configurado: ['Não configurada', 'warn'],
  };
  const textoVisivel = new Set(['modelo','redirect_uri','token_expires_at']);

  function provedor(id) {
    return (I.creds?.provedores || []).find((p) => p.id === id) || null;
  }

  function estadoCredencial(c) {
    const [label, tone] = ORIG[c.origem] || [c.origem || '—', 'neutral'];
    return `${DC.chip(label, tone)}${c.mascara ? ` <span class="dc-mono dc-muted" style="font-size:8.5px">${esc(c.mascara)}</span>` : ''}`;
  }

  function editorCredenciais(id) {
    const p = provedor(id);
    if (!p) return '<div class="dc-empty">Catálogo de credenciais indisponível.</div>';
    if (id === 'web_push') return editorVapid(p);

    const campos = (p.campos || []).map((c) => {
      const inputId = `cred-${id}-${c.chave}`;
      const type = textoVisivel.has(c.chave) ? 'text' : 'password';
      const remover = c.origem === 'painel'
        ? `<button class="dc-btn danger" type="button" onclick="DCIntegrationEditor.removeCredential('${id}','${c.chave}',this)">Remover do cofre</button>`
        : '';
      return `<div class="dc-ip-credential">
        <div class="dc-ip-credential-head"><div><strong>${esc(c.label)}</strong>${c.obrigatorio ? '' : ' <span class="dc-muted">(opcional)</span>'}<div style="margin-top:3px">${estadoCredencial(c)}${c.atualizadoEm ? ` <span class="dc-muted">· ${DC.relTime(c.atualizadoEm)}</span>` : ''}</div></div></div>
        <div class="dc-toolbar" style="margin-top:7px;align-items:stretch">
          <input class="dc-input" id="${inputId}" type="${type}" autocomplete="off" spellcheck="false" placeholder="${c.origem === 'nao_configurado' ? 'Cadastrar valor' : 'Digite somente para substituir'}" style="flex:1;min-width:180px"/>
          <button class="dc-btn primary" type="button" onclick="DCIntegrationEditor.saveCredential('${id}','${c.chave}',this)">Salvar</button>
          ${remover}
        </div>
        <small class="dc-muted">O valor atual nunca volta ao navegador. Ao salvar, ele é cifrado no cofre do Sra Luck e o campo é limpo.</small>
      </div>`;
    }).join('');

    const status = (I.status?.integracoes || []).find((x) => x.id === id) || {};
    const obrigatoriasOk = (p.campos || []).filter((x) => x.obrigatorio).every((x) => x.origem !== 'nao_configurado');
    const rdOAuthOk = id !== 'rd_station' || (
      (p.campos || []).find((x) => x.chave === 'access_token')?.origem !== 'nao_configurado' &&
      (p.campos || []).find((x) => x.chave === 'refresh_token')?.origem !== 'nao_configurado'
    );
    const baseOk = id !== 'rd_station' || !['base_incompleta'].includes(status.estadoValidacao || status.estado);
    const bloqueada = p.ativo !== true && (!obrigatoriasOk || !rdOAuthOk || !baseOk);
    const rdGate = id === 'rd_station' ? `<div class="dc-ip-list" style="margin-top:8px">
      <div class="dc-ip-row"><b>Credenciais obrigatórias</b><span>Client ID, Client Secret, Redirect URI e segredo do webhook</span>${DC.chip(obrigatoriasOk ? 'OK' : 'Pendente', obrigatoriasOk ? 'ok' : 'warn')}</div>
      <div class="dc-ip-row"><b>OAuth autorizado</b><span>Access Token e Refresh Token presentes no cofre após a autorização</span>${DC.chip(rdOAuthOk ? 'OK' : 'Pendente', rdOAuthOk ? 'ok' : 'warn')}</div>
      <div class="dc-ip-row"><b>Persistência</b><span>Estrutura real do backend disponível</span>${DC.chip(baseOk ? 'OK' : 'Pendente', baseOk ? 'ok' : 'warn')}</div>
      <div class="dc-ip-row"><b>Validação real</b><span>Ao ativar, o backend testa a autenticação no RD. Falha mantém a integração desligada.</span>${DC.chip(status.conexaoLiveVerificada ? 'Validada' : 'Obrigatória', status.conexaoLiveVerificada ? 'ok' : 'warn')}</div>
    </div>` : '';

    return `<div class="dc-note"><b>Credenciais gerenciadas pelo Dev.</b> Valores existentes aparecem somente mascarados. Salvar ou remover qualquer credencial invalida a ativação anterior; o status só volta a Conectada depois de uma validação real.</div>
      ${rdGate}
      <div class="dc-row" style="grid-template-columns:1fr auto;margin-top:8px">
        <div><strong>${p.ativo === true ? 'Integração ativa e validada' : bloqueada ? 'Integração bloqueada por pré-requisito' : 'Integração desativada / requer validação'}</strong><div class="dc-muted">${p.ativo === true ? 'O backend já aprovou a ativação desta configuração.' : bloqueada ? 'Complete os itens pendentes acima antes de ativar.' : 'Ativar executa uma chamada real ao provedor. Se a autenticação falhar, permanece desligada.'}</div></div>
        <label class="dc-switch" title="${p.ativo === true ? 'Desativar integração' : bloqueada ? 'Complete os pré-requisitos antes de ativar' : 'Validar no provedor e ativar'}"><input type="checkbox" ${p.ativo === true ? 'checked' : ''} ${bloqueada ? 'disabled' : ''} onchange="DCIntegrationEditor.toggleProvider('${id}',this.checked,this)"/><span></span></label>
      </div>
      <div class="dc-ip-credentials" style="margin-top:8px">${campos || '<div class="dc-empty">Sem campos de credencial.</div>'}</div>`;
  }

  function editorVapid(p) {
    const v = I.vapid || {};
    return `<div class="dc-note"><b>Web Push / VAPID.</b> Gere o par aqui ou importe um par existente. A chave privada é validada e armazenada cifrada; nunca é devolvida ao navegador.</div>
      <div class="dc-ip-kpis" style="margin-top:8px">
        <div><small>Configuração</small><b>${v.configurado ? 'Configurada' : 'Ausente'}</b></div>
        <div><small>Validação</small><b>${v.validado ? 'Válida' : 'Pendente'}</b></div>
        <div><small>Dispositivos</small><b>${Number(v.assinaturas || 0)}</b></div>
        <div><small>Último teste</small><b>${v.ultimaVerificacao ? DC.relTime(v.ultimaVerificacao) : 'nunca'}</b></div>
      </div>
      <div class="dc-field" style="margin-top:9px"><label for="vapidSubjectDev">Subject VAPID</label><input class="dc-input" id="vapidSubjectDev" value="${esc(v.subject || '')}" placeholder="contato@empresa.com.br ou https://..."/></div>
      ${v.publicKey ? `<div class="dc-field" style="margin-top:8px"><label>Public Key atual</label><div class="dc-note dc-mono" style="word-break:break-all">${esc(v.publicKey)}</div></div>` : ''}
      <div class="dc-toolbar" style="margin-top:8px">
        <button class="dc-btn primary" type="button" onclick="DCIntegrationEditor.generateVapid(this)">${v.configurado ? 'Gerar novo par VAPID' : 'Gerar chaves automaticamente'}</button>
        <button class="dc-btn" type="button" onclick="DCIntegrationEditor.testVapid(this)" ${v.configurado ? '' : 'disabled'}>Testar configuração</button>
      </div>
      <details style="margin-top:10px"><summary style="cursor:pointer;font-weight:700">Importar par VAPID existente</summary>
        <div class="dc-field" style="margin-top:8px"><label for="vapidPublicDev">Public Key</label><textarea class="dc-input area" id="vapidPublicDev" rows="3" spellcheck="false"></textarea></div>
        <div class="dc-field" style="margin-top:8px"><label for="vapidPrivateDev">Private Key</label><textarea class="dc-input area" id="vapidPrivateDev" rows="3" spellcheck="false"></textarea></div>
        <div class="dc-toolbar" style="justify-content:flex-end;margin-top:8px"><button class="dc-btn primary" type="button" onclick="DCIntegrationEditor.importVapid(this)">Salvar e validar</button></div>
      </details>
      <div class="dc-muted" style="margin-top:8px">${esc(v.detalhe || '')}</div>`;
  }

  async function refreshAndReopen(id) {
    await load();
    window.openProvider(id);
  }

  async function saveCredential(id, chave, btn) {
    const input = document.getElementById(`cred-${id}-${chave}`);
    const valor = String(input?.value || '').trim();
    if (!valor) return DC.toast('Informe o valor da credencial.', true);
    const r = await DC.action(btn, () => DC.api('/api/admin/integrations/credenciais', {
      method: 'POST', body: { provedor: id, chave, valor }
    }), { success: 'Credencial salva. A integração foi desativada até nova validação real.' });
    if (r?.ok) { if (input) input.value = ''; await refreshAndReopen(id); }
  }

  async function removeCredential(id, chave, btn) {
    if (!await DC.modal('Remover credencial', '<div class="dc-warn-box">Remove somente o valor salvo no cofre. Se existir uma variável de ambiente para este campo, ela volta a ser usada como fallback.</div>', { confirmText: 'Remover', danger: true })) return;
    const r = await DC.action(btn, () => DC.api('/api/admin/integrations/credenciais', {
      method: 'POST', body: { provedor: id, chave, remover: true }
    }), { success: 'Credencial removida. A integração foi desativada e precisa ser revalidada.' });
    if (r?.ok) await refreshAndReopen(id);
  }

  async function toggleProvider(id, ativo, input) {
    input.disabled = true;
    const endpoint = '/api/admin/integrations/estado';
    const r = await DC.api(endpoint, { method: 'POST', body: { provedor: id, ativo }, timeout: 30000 });
    input.disabled = false;
    if (!r.ok) {
      input.checked = !ativo;
      const detalhe = r.data?.resultado?.detalhe || r.data?.erro || r.error || 'Falha ao alterar a integração.';
      DC.toast(detalhe, true);
      await refreshAndReopen(id);
      return;
    }
    const detalhe = r.data?.resultado?.detalhe;
    DC.toast(ativo ? `Integração validada e ativada.${detalhe ? ' ' + detalhe : ''}` : 'Integração desativada.');
    await refreshAndReopen(id);
  }

  async function oauthProvider(id, btn) {
    const endpoint = id === 'conta_azul'
      ? '/api/admin/integrations/conta-azul/authorize-url'
      : '/api/admin/integrations/rd-station/authorize-url';
    const r = await DC.action(btn, () => DC.api(endpoint, { timeout: 30000 }));
    const url = r?.data?.url || r?.data?.authorizeUrl || r?.data?.authorizationUrl;
    if (!r?.ok || !url) return;
    window.open(url, '_blank', 'noopener');
    DC.toast('Autorização aberta em nova aba. Depois de concluir, volte aqui e use Validar e ativar.');
  }

  async function configureRdWebhooks(btn) {
    const r = await DC.action(btn, () => DC.api('/api/admin/integrations/rd-station/webhooks/configurar', {
      method: 'POST', body: {}, timeout: 30000
    }));
    if (!r?.ok) return;
    const eventos = Array.isArray(r.data?.eventos) ? r.data.eventos : [];
    const criados = eventos.filter((x) => x.acao === 'criado').length;
    const atualizados = eventos.filter((x) => x.acao === 'atualizado').length;
    DC.toast(`Webhooks do RD configurados. ${criados} criado(s), ${atualizados} atualizado(s).`);
    await refreshAndReopen('rd_station');
  }

  async function vapidAction(payload, btn, success) {
    const r = await DC.action(btn, () => DC.api('/api/admin/integrations/web-push/vapid', {
      method: 'POST', body: payload, timeout: 30000
    }), { success });
    if (r?.ok) { await refreshAndReopen('web_push'); return r; }
    if (r?.status === 409 && r.data?.codigo === 'ROTACAO_VAPID_COM_ASSINATURAS') {
      const n = Number(r.data?.assinaturas || 0);
      const ok = await DC.modal('Confirmar rotação VAPID', `<div class="dc-critical-box">Existem <b>${n}</b> dispositivo(s) inscritos na chave atual. Trocar o par pode exigir que as clientes ativem as notificações novamente.</div>`, { confirmText: 'Confirmar rotação', danger: true });
      if (ok) {
        const retry = await DC.api('/api/admin/integrations/web-push/vapid', { method: 'POST', body: { ...payload, confirmarRotacao: true }, timeout: 30000 });
        DC.toast(retry.ok ? 'Par VAPID rotacionado e validado.' : (retry.error || retry.data?.erro || 'Falha ao rotacionar VAPID.'), !retry.ok);
        if (retry.ok) await refreshAndReopen('web_push');
        return retry;
      }
    }
    return r;
  }

  function subject() { return String(document.getElementById('vapidSubjectDev')?.value || '').trim(); }
  async function generateVapid(btn) {
    const s = subject(); if (!s) return DC.toast('Informe o Subject VAPID.', true);
    await vapidAction({ acao: 'gerar', subject: s }, btn, 'Chaves VAPID geradas e validadas.');
  }
  async function importVapid(btn) {
    const s = subject();
    const publicKey = String(document.getElementById('vapidPublicDev')?.value || '').trim();
    const privateKey = String(document.getElementById('vapidPrivateDev')?.value || '').trim();
    if (!s || !publicKey || !privateKey) return DC.toast('Subject, Public Key e Private Key são obrigatórios.', true);
    await vapidAction({ acao: 'salvar', subject: s, publicKey, privateKey }, btn, 'Par VAPID salvo e validado.');
  }
  async function testVapid(btn) {
    const r = await DC.action(btn, () => DC.api('/api/admin/integrations/web-push/vapid', {
      method: 'POST', body: { acao: 'testar' }, timeout: 30000
    }));
    if (r?.ok) DC.toast(r.data?.validado ? 'VAPID válido e pareado.' : (r.data?.detalhe || 'VAPID inválido.'), !r.data?.validado);
    await load(); window.openProvider('web_push');
  }

  function historyRow(h) {
    const ok = h.detalhes?.conectado ?? h.detalhes?.ok;
    return `<div class="dc-row" style="grid-template-columns:auto 1fr auto;gap:8px"><span class="dc-muted dc-mono" style="font-size:8.6px">${h.created_at ? DC.dateTimeFmt.format(new Date(h.created_at)) : '—'}</span><span>${esc(String(h.acao || '').replace(/_/g,' '))} <span class="dc-muted">· ${esc(h.entidade_id || h.detalhes?.provedor || '')}</span></span>${ok === true ? DC.chip('OK','ok') : ok === false ? DC.chip('Falhou','bad') : ''}</div>`;
  }

  function enhancedOpenProvider(id) {
    const x = (I.status?.integracoes || []).find((v) => v.id === id);
    if (!x && id !== 'gemini') return;
    if (!x || !DCIntegracoes.integracao(id)) {
      if (id === 'gemini') return openGeminiDrawer();
      return;
    }
    const ev = I.history.filter((h) => h.entidade_id === id || h.detalhes?.provedor === id).slice(0,15).map(historyRow).join('') || '<div class="dc-empty">Sem eventos registrados.</div>';
    const topo = `<div class="dc-int-top" style="margin-bottom:10px">${logo(x.id,x.nome)}<div><strong>${esc(x.nome)}</strong><small>${esc(GROUPS[x.grupo] || x.grupo)}</small></div>${DC.chip(...(STATE[stateOf(x)] || [stateOf(x),'neutral']))}</div><div class="dc-note">${esc(x.detalhes || '')}</div><div class="dc-ip-kpis" style="margin-top:8px"><div><small>Ativação</small><b>${x.ativo ? 'Ativa' : 'Desativada'}</b></div><div><small>Último teste</small><b>${x.ultimaVerificacao ? DC.relTime(x.ultimaVerificacao) : 'nunca'}</b></div><div><small>Latência</small><b>${x.latenciaMs != null ? x.latenciaMs + ' ms' : '—'}</b></div><div><small>Código</small><b>${esc(x.codigoValidacao || '—')}</b></div></div>`;
    const extras = id === 'web_push' && I.vapid
      ? `${DC.field('VAPID configurado', I.vapid.configurado ? 'Sim' : 'Não')}${DC.field('Validado', I.vapid.validado ? 'Sim' : 'Não')}${DC.field('Aparelhos inscritos', I.vapid.assinaturas ?? '—')}`
      : '';
    const footer = [
      id === 'gemini' ? '<button class="dc-btn" onclick="openGeminiDrawer()">Mensagem diária</button>' : '',
      id === 'rd_station' ? '<button class="dc-btn" onclick="DCIntegrationEditor.configureRdWebhooks(this)">Configurar webhooks</button><button class="dc-btn" onclick="DCIntegrationEditor.oauthProvider(\'rd_station\',this)">Autorizar RD Station</button>' : '',
      id === 'conta_azul' ? '<button class="dc-btn" onclick="DCIntegrationEditor.oauthProvider(\'conta_azul\',this)">Autorizar Conta Azul</button>' : '',
      canTest(id) ? `<button class="dc-btn primary" onclick="testProvider('${id}',this)">Testar conexão real</button>` : ''
    ].join('');
    DCIntegracoes.abrir(id, { topo, credenciais: editorCredenciais(id), eventos: ev, extras, rodape: footer }, () => enhancedOpenProvider(id));
    window.lucide?.createIcons();
  }

  const oldTest = window.testProvider;
  async function enhancedTestProvider(id, btn) {
    if (id === 'web_push') return testVapid(btn);
    return oldTest(id, btn);
  }

  window.DCIntegrationEditor = { saveCredential, removeCredential, toggleProvider, oauthProvider, configureRdWebhooks, generateVapid, importVapid, testVapid };
  window.openProvider = enhancedOpenProvider;
  window.testProvider = enhancedTestProvider;
})();