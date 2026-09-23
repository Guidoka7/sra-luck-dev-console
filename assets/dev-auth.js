(()=>{
 const $=id=>document.getElementById(id);
 async function call(url,options={}){try{const r=await fetch(url,{credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json',...(options.headers||{})},...options});const data=await r.json().catch(()=>({}));return{ok:r.ok,status:r.status,data}}catch(e){return{ok:false,status:0,data:{erro:'Falha de rede.'}}}}
 function state(message,bad=false){const el=$('authState');if(!el)return;el.className='dc-auth-state show '+(bad?'dc-critical-box':'dc-ok-box');el.textContent=message}
 function loading(button,on,label='Entrar'){button.disabled=on;button.textContent=on?'Validando…':label}
 async function existing(){const r=await call('/api/auth/session',{method:'GET'});if(r.ok&&r.data?.autenticado)location.replace('visao-geral.html')}
 window.DevAuth={call,state,loading,existing};
})();
