const { json, body, sameOrigin, methodNotAllowed, requestId } = require('./_lib/http');
const { requireSession, ROLE_PERMISSIONS } = require('./_lib/rbac');
const { rest, adminCreateUser, adminDeleteUser, audit } = require('./_lib/supabase');

const ROLES = new Set(Object.keys(ROLE_PERMISSIONS));
function cleanPermissions(v){return Array.isArray(v)?[...new Set(v.filter(x=>typeof x==='string'&&x.length<=120))].slice(0,100):[]}

module.exports=async function handler(req,res){
 res.setHeader('x-request-id',requestId(req));
 const actor=await requireSession(req,res,'users.manage');if(!actor)return;
 if(req.method==='GET'){
   const rows=await rest('dev_users?select=id,email,name,role,active,permissions,last_login_at,created_at,updated_at&order=name.asc',{method:'GET'}).catch(()=>null);
   if(!rows)return json(res,503,{erro:'Não foi possível carregar os usuários do Dev Console.'});
   return json(res,200,{users:rows,roles:[...ROLES]});
 }
 if(!['POST','PATCH'].includes(req.method))return methodNotAllowed(res,['GET','POST','PATCH']);
 if(!sameOrigin(req))return json(res,403,{erro:'Origem não autorizada.'});
 let b;try{b=await body(req,32*1024)}catch{return json(res,400,{erro:'Requisição inválida.'})}
 if(req.method==='POST'){
   const email=String(b.email||'').trim().toLowerCase(),name=String(b.name||'').trim(),role=String(b.role||'viewer'),password=String(b.temporaryPassword||'');
   if(!email||!name||!ROLES.has(role))return json(res,400,{erro:'Nome, e-mail e perfil válidos são obrigatórios.'});
   if(password.length<12)return json(res,400,{erro:'A senha temporária deve ter pelo menos 12 caracteres.'});
   if(role==='owner'&&actor.role!=='owner')return json(res,403,{erro:'Somente Owner pode criar outro Owner.'});
   let authUser;try{authUser=await adminCreateUser({email,password,name})}catch(e){return json(res,400,{erro:e.message||'Não foi possível criar o acesso.'})}
   try{
     const rows=await rest('dev_users',{method:'POST',body:JSON.stringify({auth_user_id:authUser.id,email,name,role,active:true,permissions:cleanPermissions(b.permissions)})});
     const user=rows?.[0];await audit({actor_user_id:actor.id,action:'user.create',resource:'dev_users',resource_id:user?.id||null,details:{email,role}});
     return json(res,201,{user});
   }catch(e){await adminDeleteUser(authUser.id);return json(res,400,{erro:'Não foi possível persistir o perfil do novo usuário.'})}
 }
 const id=String(b.id||'');if(!id)return json(res,400,{erro:'Usuário não informado.'});
 const targetRows=await rest(`dev_users?id=eq.${encodeURIComponent(id)}&select=*`,{method:'GET'}).catch(()=>[]);const target=targetRows?.[0];if(!target)return json(res,404,{erro:'Usuário não encontrado.'});
 if(target.role==='owner'&&actor.role!=='owner')return json(res,403,{erro:'Somente Owner pode alterar outro Owner.'});
 if(id===actor.id&&b.active===false)return json(res,409,{erro:'Você não pode desativar o próprio acesso.'});
 const patch={updated_at:new Date().toISOString()};
 if(b.name!==undefined){const name=String(b.name||'').trim();if(!name)return json(res,400,{erro:'Nome inválido.'});patch.name=name}
 if(b.role!==undefined){const role=String(b.role);if(!ROLES.has(role))return json(res,400,{erro:'Perfil inválido.'});if(role==='owner'&&actor.role!=='owner')return json(res,403,{erro:'Somente Owner pode conceder perfil Owner.'});patch.role=role}
 if(b.active!==undefined)patch.active=Boolean(b.active);
 if(b.permissions!==undefined)patch.permissions=cleanPermissions(b.permissions);
 const rows=await rest(`dev_users?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(patch)}).catch(()=>null);if(!rows)return json(res,400,{erro:'Não foi possível atualizar o usuário.'});
 await audit({actor_user_id:actor.id,action:'user.update',resource:'dev_users',resource_id:id,details:{fields:Object.keys(patch).filter(k=>k!=='updated_at')}});
 return json(res,200,{user:rows[0]});
};
