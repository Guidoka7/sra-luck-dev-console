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

    return `<div class="dc-note"><b>Credenciais gerenciadas pelo Dev.</b> Valores existentes aparecem somente mascarados. Segredos novos são enviados uma vez e permanecem cifrados no Sra Luck.</div>
      <div class="dc-row" style="grid-template-columns:1fr auto;margin-top:8px">
        <div><strong>Integração ${p.ativo === false ? 'pausada' : 'ativa'}</strong><div class="dc-muted">Pausar faz o backend deixar de entregar estas credenciais às rotinas.</div></div>
        <label class="dc-switch"><input type="checkbox" ${p.ativo === false ? '' : 'checked'} onchange="DCIntegrationEditor.toggleProvider('${id}',this.checked,this)"/><span></span></label>
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
    }), { success: 'Credencial salva no cofre do Sra Luck.' });
    if (r?.ok) { if (input) input.value = ''; await refreshAndReopen(id); }
  }

  async function removeCredential(id, chave, btn) {
    if (!await DC.modal('Remover credencial', '<div class="dc-warn-box">Remove somente o valor salvo no cofre. Se existir uma variável de ambiente para este campo, ela volta a ser usada como fallback.</div>', { confirmText: 'Remover', danger: true })) return;
    const r = await DC.action(btn, () => DC.api('/api/admin/integrations/credenciais', {
      method: 'POST', body: { provedor: id, chave, remover: true }
    }), { success: 'Credencial removida do cofre.' });
    if (r?.ok) await refreshAndReopen(id);
  }

  async function toggleProvider(id, ativo, input) {
    input.disabled = true;
    const r = await DC.api('/api/admin/integrations/credenciais', { method: 'POST', body: { provedor: id, ativo } });
    input.disabled = false;
    if (!r.ok) { input.checked = !ativo; return DC.toast(r.error || r.data?.erro || 'Falha ao alterar a integração.', true); }
    DC.toast(ativo ? 'Integração ativada.' : 'Integração pausada.');
    await refreshAndReopen(id);
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
    const topo = `<div class="dc-int-top" style="margin-bottom:10px">${logo(x.id,x.nome)}<div><strong>${esc(x.nome)}</strong><small>${esc(GROUPS[x.grupo] || x.grupo)}</small></div>${DC.chip(...(STATE[stateOf(x)] || [x.estado,'neutral']))}</div><div class="dc-note">${esc(x.detalhes || '')}</div>`;
    const extras = id === 'web_push' && I.vapid
      ? `${DC.field('VAPID configurado', I.vapid.configurado ? 'Sim' : 'Não')}${DC.field('Validado', I.vapid.validado ? 'Sim' : 'Não')}${DC.field('Aparelhos inscritos', I.vapid.assinaturas ?? '—')}`
      : '';
    const footer = [
      id === 'gemini' ? '<button class="dc-btn" onclick="openGeminiDrawer()">Mensagem diária</button>' : '',
      canTest(id) ? `<button class="dc-btn primary" onclick="testProvider('${id}',this)">Testar conexão</button>` : ''
    ].join('');
    DCIntegracoes.abrir(id, { topo, credenciais: editorCredenciais(id), eventos: ev, extras, rodape: footer }, () => enhancedOpenProvider(id));
    window.lucide?.createIcons();
  }

  const oldTest = window.testProvider;
  async function enhancedTestProvider(id, btn) {
    if (id === 'web_push') return testVapid(btn);
    return oldTest(id, btn);
  }

  window.DCIntegrationEditor = { saveCredential, removeCredential, toggleProvider, generateVapid, importVapid, testVapid };
  window.openProvider = enhancedOpenProvider;
  window.testProvider = enhancedTestProvider;
})();