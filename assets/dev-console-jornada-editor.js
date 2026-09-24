(() => {
  const esc = (v) => DC.esc(v == null ? '' : String(v));
  const ordem = ['pagamentos','jornada','agenda','clube'];

  function ensureSection() {
    let section = document.getElementById('journeyTemplatesSection');
    if (section) return section;
    section = document.createElement('section');
    section.id = 'journeyTemplatesSection';
    section.className = 'dc-card dc-section';
    section.innerHTML = '<div class="dc-section-head"><div class="dc-title"><i data-lucide="route"></i><div><h2>Avisos da jornada</h2><p>Pagamentos, agenda, liberação e Clube. Cada evento usa o catálogo real da migration 093.</p></div></div><span id="journeyCount"></span></div><div id="journeyTemplates"></div>';
    const logs = document.getElementById('logs')?.closest('section');
    if (logs) logs.parentNode.insertBefore(section, logs); else document.querySelector('.dc-content')?.appendChild(section);
    window.lucide?.createIcons();
    return section;
  }

  function categoryName(cat) {
    return N.categoriasEventos?.[cat] || ({pagamentos:'Pagamentos',jornada:'Jornada e liberação',agenda:'Agenda',clube:'Clube'}[cat] || cat);
  }

  function renderJourney() {
    ensureSection();
    const target = document.getElementById('journeyTemplates');
    const count = document.getElementById('journeyCount');
    if (!target) return;
    if (N.eventos === null) {
      target.innerHTML = '<div class="dc-warn-box">Os avisos da jornada ainda não estão disponíveis neste ambiente. A migration 093 precisa estar aplicada.</div>';
      if (count) count.innerHTML = DC.chip('Indisponível','warn');
      return;
    }
    const eventos = Array.isArray(N.eventos) ? N.eventos : [];
    if (count) count.innerHTML = DC.chip(`${eventos.filter((e)=>e.is_active).length}/${eventos.length} ligados`, eventos.length ? 'ok' : 'neutral');
    const cats = [...new Set([...ordem, ...eventos.map((e)=>e.categoria)])].filter((cat)=>eventos.some((e)=>e.categoria===cat));
    target.innerHTML = cats.map((cat) => {
      const itens = eventos.filter((e)=>e.categoria===cat);
      return `<h3 class="dc-nc-h">${esc(categoryName(cat))} <span class="dc-muted">· ${itens.filter((e)=>e.is_active).length}/${itens.length}</span></h3>
        <div class="dc-table-wrap"><table class="dc-compact-table"><thead><tr><th>Aviso</th><th>Quando</th><th>Destino</th><th>Status</th><th>Ações</th></tr></thead><tbody>
        ${itens.map((e)=>`<tr><td><strong>${esc((e.emoji||'🔔')+' '+e.nome)}</strong><div class="dc-muted" style="font-size:8.5px">${esc(e.titulo)}</div></td><td>${esc(e.quando)}</td><td class="dc-mono">${esc(e.destino||'—')}</td><td>${e.is_active?DC.chip('Ligado','ok'):DC.chip('Desligado','neutral')}</td><td><div class="dc-toolbar"><button class="dc-btn" onclick="DCJourneyEditor.edit('${esc(e.chave)}')">Editar</button><button class="dc-btn ${e.is_active?'danger':''}" onclick="DCJourneyEditor.toggle('${esc(e.chave)}',this)">${e.is_active?'Desligar':'Ligar'}</button></div></td></tr>`).join('')}
        </tbody></table></div>`;
    }).join('') || '<div class="dc-empty">Nenhum aviso da jornada encontrado.</div>';
  }

  function eventByKey(key) { return (N.eventos || []).find((e)=>e.chave===key); }
  function defaultByKey(key) { return (N.eventosPadrao || []).find((e)=>e.chave===key); }

  function editBody(e) {
    return `<div class="dc-note"><b>${esc(e.nome)}</b><br/>${esc(e.quando)}<br/><span class="dc-muted">Variáveis permitidas: ${esc((e.variaveis||[]).map((v)=>'{{'+v+'}}').join(', ') || 'nenhuma')}</span></div>
      <div class="dc-grid g2" style="margin-top:9px"><div class="dc-field"><label for="jeTitle">Título</label><input class="dc-input" id="jeTitle" maxlength="80" value="${esc(e.titulo||'')}"/></div><div class="dc-field"><label for="jeEmoji">Ícone</label><input class="dc-input" id="jeEmoji" maxlength="4" value="${esc(e.emoji||'🔔')}"/></div></div>
      <div class="dc-field" style="margin-top:8px"><label for="jeBody">Mensagem</label><textarea class="dc-input area" id="jeBody" rows="4" maxlength="300">${esc(e.corpo||'')}</textarea></div>
      <div class="dc-toolbar" style="margin-top:8px"><button class="dc-btn" type="button" onclick="DCJourneyEditor.restoreEvent('${esc(e.chave)}')">Restaurar texto padrão</button></div>`;
  }

  async function edit(key) {
    const e = eventByKey(key); if (!e) return;
    if (!await DC.modal('Editar aviso da jornada', editBody(e), { confirmText:'Salvar aviso' })) return;
    const body = {
      chave:key,
      titulo:String(document.getElementById('jeTitle')?.value||'').trim(),
      corpo:String(document.getElementById('jeBody')?.value||'').trim(),
      emoji:String(document.getElementById('jeEmoji')?.value||'').trim() || '🔔',
    };
    if (!body.titulo || !body.corpo) return DC.toast('Título e mensagem são obrigatórios.', true);
    const r = await DC.api('/api/admin/notificacoes/eventos',{method:'PATCH',body});
    DC.toast(r.ok ? 'Aviso salvo.' : (r.error || r.data?.erro || 'Falha ao salvar o aviso.'), !r.ok);
    if (r.ok) await load();
  }

  async function toggle(key, btn) {
    const e = eventByKey(key); if (!e) return;
    if (e.is_active && !await DC.modal('Desligar aviso', `<div class="dc-warn-box">A cliente deixa de receber <b>${esc(e.nome)}</b> quando este evento ocorrer.</div>`, {confirmText:'Desligar',danger:true})) return;
    const r = await DC.action(btn,()=>DC.api('/api/admin/notificacoes/eventos',{method:'PATCH',body:{chave:key,is_active:!e.is_active}}),{success:e.is_active?'Aviso desligado.':'Aviso ligado.'});
    if (r?.ok) await load();
  }

  function restoreEvent(key) {
    const p = defaultByKey(key); if (!p) return DC.toast('Texto padrão não encontrado.', true);
    const title=document.getElementById('jeTitle'), body=document.getElementById('jeBody'), emoji=document.getElementById('jeEmoji');
    if (title) title.value=p.titulo||''; if (body) body.value=p.corpo||''; if (emoji) emoji.value=p.emoji||'🔔';
  }

  function templateDefault(x) {
    return (N.padroes||[]).find((p)=>p.tipo===x.tipo && Number(p.dias)===Number(x.dias_referencia));
  }
  function unifiedTemplateBody(x, idx) {
    const p=templateDefault(x);
    const variables=(N.variaveis||[]).map((v)=>`{{${v.chave}}}`).join(', ');
    return `<div class="dc-note">Edite a versão para <b>uma parcela</b> e a versão unificada para <b>duas ou mais parcelas</b>. Variáveis: ${esc(variables)}</div>
      <div class="dc-grid g2" style="margin-top:8px"><div class="dc-field"><label for="utEmoji">Emoji</label><input class="dc-input" id="utEmoji" maxlength="8" value="${esc(x.emoji||'💬')}"/></div><div class="dc-field"><label>Status</label><div style="padding-top:8px">${x.is_active?DC.chip('Ativo','ok'):DC.chip('Inativo','neutral')}</div></div></div>
      <h3 class="dc-nc-h">Uma parcela</h3>
      <div class="dc-field"><label for="utTitle">Título</label><input class="dc-input" id="utTitle" maxlength="80" value="${esc(x.titulo||'')}"/></div>
      <div class="dc-field" style="margin-top:7px"><label for="utBody">Mensagem</label><textarea class="dc-input area" id="utBody" rows="3" maxlength="300">${esc(x.corpo||'')}</textarea></div>
      <h3 class="dc-nc-h">Duas ou mais parcelas · mensagem unificada</h3>
      <div class="dc-field"><label for="utMultiTitle">Título</label><input class="dc-input" id="utMultiTitle" maxlength="80" value="${esc(x.titulo_multiplas||'')}"/></div>
      <div class="dc-field" style="margin-top:7px"><label for="utMultiBody">Mensagem</label><textarea class="dc-input area" id="utMultiBody" rows="3" maxlength="300">${esc(x.corpo_multiplas||'')}</textarea></div>
      ${p?`<div class="dc-toolbar" style="margin-top:8px"><button class="dc-btn" type="button" onclick="DCJourneyEditor.restoreTemplate(${idx})">Restaurar padrão da régua</button></div>`:''}`;
  }

  async function editTemplateUnified(idx) {
    const x=(N.templates||[])[idx]; if(!x) return;
    if (!await DC.modal('Editar template da régua', unifiedTemplateBody(x,idx), {confirmText:'Salvar template'})) return;
    const body={
      id:x.id,
      titulo:String(document.getElementById('utTitle')?.value||'').trim(),
      corpo:String(document.getElementById('utBody')?.value||'').trim(),
      titulo_multiplas:String(document.getElementById('utMultiTitle')?.value||'').trim(),
      corpo_multiplas:String(document.getElementById('utMultiBody')?.value||'').trim(),
      emoji:String(document.getElementById('utEmoji')?.value||'').trim()||'💬',
      is_active:x.is_active,
    };
    if(!body.titulo||!body.corpo)return DC.toast('Título e mensagem de uma parcela são obrigatórios.',true);
    const r=await DC.api('/api/admin/notificacoes/templates',{method:'PATCH',body});
    DC.toast(r.ok?'Template salvo.':(r.error||r.data?.erro||'Falha ao salvar.'),!r.ok);
    if(r.ok)await load();
  }

  function restoreTemplate(idx) {
    const x=(N.templates||[])[idx], p=x&&templateDefault(x); if(!p)return;
    const values={utTitle:p.titulo||'',utBody:p.corpo||'',utMultiTitle:p.titulo_multiplas||'',utMultiBody:p.corpo_multiplas||'',utEmoji:p.emoji||'💬'};
    Object.entries(values).forEach(([id,v])=>{const el=document.getElementById(id);if(el)el.value=v});
  }

  const baseLoad=load;
  load=async()=>{await baseLoad();renderJourney()};
  window.editTemplate=editTemplateUnified;
  window.DCJourneyEditor={edit,toggle,restoreEvent,restoreTemplate,render:renderJourney};
})();