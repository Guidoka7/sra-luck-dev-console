(()=>{
 const S='fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
 const svg=(body)=>`<svg viewBox="0 0 24 24" aria-hidden="true" ${S}>${body}</svg>`;
 function body(n){n=(n||'').toLowerCase();
  if(n.includes('search'))return'<circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/>';
  if(n.includes('bug'))return'<rect x="7" y="7" width="10" height="11" rx="4"/><path d="M9 7V5m6 2V5M4 10h3m10 0h3M4 14h3m10 0h3M9 12h6"/>';
  if(n.includes('activity')||n.includes('pulse'))return'<path d="M3 12h4l2-6 4 12 2-6h6"/>';
  if(n.includes('route'))return'<circle cx="6" cy="6" r="2"/><circle cx="18" cy="18" r="2"/><path d="M8 6h4a4 4 0 0 1 4 4v2a4 4 0 0 1-4 4H8"/>';
  if(n.includes('wallet')||n.includes('credit-card'))return'<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18M15 14h3"/>';
  if(n.includes('receipt'))return'<path d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21z"/><path d="M9 8h6m-6 4h6"/>';
  if(n.includes('smartphone'))return'<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M10 18h4"/>';
  if(n.includes('user')||n.includes('users'))return'<circle cx="12" cy="8" r="3"/><path d="M5 21a7 7 0 0 1 14 0"/>';
  if(n.includes('bell'))return'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>';
  if(n.includes('gift'))return'<rect x="3" y="9" width="18" height="12" rx="1"/><path d="M12 9v12M3 13h18M8 9c-3 0-3-4-1-5 2-1 5 5 5 5m4 0c3 0 3-4 1-5-2-1-5 5-5 5"/>';
  if(n.includes('workflow')||n.includes('network'))return'<circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M8 6h8M7 8l4 8m6-8-4 8"/>';
  if(n.includes('git'))return'<circle cx="7" cy="5" r="2"/><circle cx="17" cy="19" r="2"/><circle cx="7" cy="19" r="2"/><path d="M7 7v10m0-6h4a6 6 0 0 0 6-6"/>';
  if(n.includes('refresh')||n.includes('repeat'))return'<path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M6 8a7 7 0 0 1 11-2l3 6M18 16a7 7 0 0 1-11 2l-3-6"/>';
  if(n.includes('download'))return'<path d="M12 3v12m-4-4 4 4 4-4"/><path d="M5 20h14"/>';
  if(n.includes('upload'))return'<path d="M12 16V4m-4 4 4-4 4 4"/><path d="M5 20h14"/>';
  if(n.includes('alert')||n.includes('siren'))return'<path d="M12 3 2.5 20h19z"/><path d="M12 9v5m0 3h.01"/>';
  if(n.includes('check')||n.includes('badge'))return'<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>';
  if(n.includes('clock'))return'<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>';
  if(n.includes('calendar'))return'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4m8-4v4M3 10h18"/>';
  if(n.includes('shield'))return'<path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6z"/><path d="m9 12 2 2 4-5"/>';
  if(n.includes('code'))return'<path d="m8 8-4 4 4 4m8-8 4 4-4 4m-2-11-4 14"/>';
  if(n.includes('play'))return'<circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4z"/>';
  if(n.includes('external')||n.includes('arrow-right'))return'<path d="M5 12h14m-5-5 5 5-5 5"/>';
  if(n.includes('log-in'))return'<path d="M10 5H5v14h5m4-4 4-3-4-3m4 3H9"/>';
  if(n.includes('help'))return'<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.6 2.6 0 1 1 4.4 1.9c-1.2 1-1.9 1.4-1.9 3.1m0 3h.01"/>';
  if(n.includes('server'))return'<rect x="4" y="4" width="16" height="6" rx="2"/><rect x="4" y="14" width="16" height="6" rx="2"/><path d="M8 7h.01M8 17h.01"/>';
  if(n.includes('settings')||n.includes('cog'))return'<circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M19 5l-2 2M7 17l-2 2"/>';
  if(n.includes('file')||n.includes('scroll'))return'<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 12h6m-6 4h6"/>';
  if(n.includes('bar-chart')||n.includes('chart'))return'<path d="M4 20V10m6 10V4m6 16v-7m4 7H2"/>';
  return'<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>';
 }
 function createIcons(){document.querySelectorAll('i[data-lucide]').forEach(i=>{const n=i.getAttribute('data-lucide');const wrap=document.createElement('span');wrap.innerHTML=svg(body(n));const s=wrap.firstElementChild;for(const c of [...i.classList])s.classList.add(c);s.setAttribute('data-lucide-rendered',n);i.replaceWith(s)})}
 window.lucide={createIcons};
})();
