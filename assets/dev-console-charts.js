(() => {
  // Gráfico de linhas interativo do Dev Console (SVG, sem dependências).
  // Um eixo só; séries na mesma unidade; crosshair com tooltip de todas as
  // séries; legenda com chave de linha; tabela acessível. Textos de dados
  // entram por textContent (nunca innerHTML).
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs = {}, parent) => {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (parent) parent.appendChild(node);
    return node;
  };
  const html = (tag, cls, parent, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    if (parent) parent.appendChild(node);
    return node;
  };
  const timeFmt = (ms, spanMs) => new Intl.DateTimeFormat('pt-BR', spanMs > 2 * 86400000
    ? { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }
    : { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
  const fullFmt = (ms) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(ms));

  function line(container, opts) {
    const unit = opts.unit || '';
    const dec = opts.decimals;
    const fmt = (v) => (v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(dec ?? (v >= 100 ? 0 : 1))}${unit}`);
    const series = (opts.series || []).map((s) => ({ ...s, points: (s.points || []).map((p) => ({ t: new Date(p.t).getTime(), v: Number(p.v) })).filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v)).sort((a, b) => a.t - b.t) }));
    container.textContent = '';
    container.classList.add('dcc-root');
    const withData = series.filter((s) => s.points.length);
    if (!withData.length) {
      const empty = html('div', 'dc-empty', container, opts.empty || 'Sem leituras neste período.');
      empty.style.padding = '28px 0';
      return;
    }

    // Legenda (sempre presente com 2+ séries) com o valor mais recente.
    if (series.length > 1 || opts.legend) {
      const legend = html('div', 'dcc-legend', container);
      for (const s of series) {
        const item = html('span', 'dcc-legend-item', legend);
        const key = html('i', 'dcc-key', item); key.style.background = s.color;
        html('span', '', item, s.name);
        const last = s.points[s.points.length - 1];
        html('b', '', item, last ? fmt(last.v) : 'sem dados');
      }
    }

    const wrap = html('div', 'dcc-plot', container);
    const tooltip = html('div', 'dcc-tooltip', wrap);
    tooltip.hidden = true;
    const W = Math.max(280, wrap.clientWidth || container.clientWidth || 600);
    const H = opts.height || 190;
    const m = { l: 36, r: 12, t: 10, b: 24 };
    const all = withData.flatMap((s) => s.points);
    const tMin = opts.from ?? Math.min(...all.map((p) => p.t));
    const tMax = opts.to ?? Math.max(...all.map((p) => p.t));
    const span = Math.max(1, tMax - tMin);
    // Passo "redondo" (1, 2, 2,5, 5 × 10ⁿ) para as 4 linhas da grade caírem em valores inteiros legíveis.
    const bruto = Math.max(1, ...all.map((p) => p.v)) * 1.05 / 4, mag = 10 ** Math.floor(Math.log10(bruto));
    const passo = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((k) => k >= bruto && (dec !== 0 || Number.isInteger(k))) || 10 * mag;
    const yMax = opts.yMax ?? Math.max(dec === 0 ? 4 : 0, passo * 4);
    m.l = Math.max(m.l, String(Math.round(yMax)).length * 6 + unit.length * 5 + 12);
    const x = (t) => m.l + ((t - tMin) / span) * (W - m.l - m.r);
    const y = (v) => m.t + (1 - Math.min(v, yMax) / yMax) * (H - m.t - m.b);
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': opts.label || 'Gráfico' }, wrap);

    // Grade e eixo Y recessivos.
    for (let i = 0; i <= 4; i++) {
      const v = (yMax / 4) * i;
      el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: 'dcc-grid' }, svg);
      const label = el('text', { x: m.l - 6, y: y(v) + 3, class: 'dcc-axis', 'text-anchor': 'end' }, svg);
      label.textContent = `${Math.round(v)}${unit}`;
    }
    for (const ref of opts.references || []) {
      if (!Number.isFinite(ref.v) || ref.v > yMax) continue;
      el('line', { x1: m.l, x2: W - m.r, y1: y(ref.v), y2: y(ref.v), class: `dcc-ref ${ref.tone || ''}` }, svg);
      const t = el('text', { x: W - m.r, y: y(ref.v) - 3, class: 'dcc-axis', 'text-anchor': 'end' }, svg);
      t.textContent = ref.label;
    }
    const ticks = Math.min(6, Math.max(2, Math.floor((W - m.l - m.r) / 110)));
    for (let i = 0; i <= ticks; i++) {
      const t = tMin + (span / ticks) * i;
      const label = el('text', { x: x(t), y: H - 6, class: 'dcc-axis', 'text-anchor': i === 0 ? 'start' : i === ticks ? 'end' : 'middle' }, svg);
      label.textContent = timeFmt(t, span);
    }

    // Linhas 2px + marcadores quando há poucos pontos.
    for (const s of withData) {
      if (s.points.length > 1) el('polyline', { points: s.points.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' '), fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
      if (s.points.length <= 12) for (const p of s.points) el('circle', { cx: x(p.t), cy: y(p.v), r: 4, fill: s.color, stroke: 'var(--dcc-surface)', 'stroke-width': 2 }, svg);
    }

    // Crosshair: segue o ponteiro e encaixa no instante de leitura mais próximo.
    const times = [...new Set(all.map((p) => p.t))].sort((a, b) => a - b);
    const hair = el('line', { y1: m.t, y2: H - m.b, class: 'dcc-hair', visibility: 'hidden' }, svg);
    const dots = withData.map((s) => el('circle', { r: 5, fill: s.color, stroke: 'var(--dcc-surface)', 'stroke-width': 2, visibility: 'hidden' }, svg));
    const nearest = (pts, t) => pts.reduce((best, p) => (Math.abs(p.t - t) < Math.abs(best.t - t) ? p : best), pts[0]);
    const show = (t) => {
      hair.setAttribute('x1', x(t)); hair.setAttribute('x2', x(t)); hair.setAttribute('visibility', 'visible');
      tooltip.textContent = '';
      html('div', 'dcc-tip-time', tooltip, fullFmt(t));
      withData.forEach((s, i) => {
        const p = nearest(s.points, t);
        const close = Math.abs(p.t - t) <= Math.max(span / 40, 15 * 60000);
        dots[i].setAttribute('cx', x(p.t)); dots[i].setAttribute('cy', y(p.v)); dots[i].setAttribute('visibility', close ? 'visible' : 'hidden');
        const row = html('div', 'dcc-tip-row', tooltip);
        const key = html('i', 'dcc-key', row); key.style.background = s.color;
        html('b', '', row, close ? fmt(p.v) : '—');
        html('span', '', row, s.name);
      });
      tooltip.hidden = false;
      const left = x(t) + 12;
      tooltip.style.left = `${Math.min(left, W - tooltip.offsetWidth - 4)}px`;
      tooltip.style.top = '8px';
    };
    const hide = () => { tooltip.hidden = true; hair.setAttribute('visibility', 'hidden'); dots.forEach((d) => d.setAttribute('visibility', 'hidden')); };
    const hit = el('rect', { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: 'transparent', tabindex: 0, 'aria-label': 'Explorar valores (setas esquerda/direita)' }, svg);
    let idx = times.length - 1;
    hit.addEventListener('pointermove', (e) => {
      const r = svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      const t = tMin + ((px - m.l) / (W - m.l - m.r)) * span;
      idx = times.reduce((bi, tt, i) => (Math.abs(tt - t) < Math.abs(times[bi] - t) ? i : bi), 0);
      show(times[idx]);
    });
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('focus', () => show(times[idx]));
    hit.addEventListener('blur', hide);
    hit.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { idx = Math.max(0, idx - 1); show(times[idx]); e.preventDefault(); }
      if (e.key === 'ArrowRight') { idx = Math.min(times.length - 1, idx + 1); show(times[idx]); e.preventDefault(); }
    });

    // Tabela acessível (os mesmos valores sem depender do hover).
    const details = html('details', 'dcc-table', container);
    html('summary', '', details, 'Ver valores em tabela');
    const table = html('table', 'dc-compact-table', details);
    const head = html('tr', '', html('thead', '', table));
    html('th', '', head, 'Quando');
    for (const s of series) html('th', '', head, s.name);
    const tbody = html('tbody', '', table);
    for (const t of times.slice().reverse().slice(0, 60)) {
      const tr = html('tr', '', tbody);
      html('td', '', tr, fullFmt(t));
      for (const s of series) {
        const p = s.points.find((q) => q.t === t);
        html('td', '', tr, p ? fmt(p.v) : '—');
      }
    }
  }

  window.DCChart = { line };
})();
