const { json, methodNotAllowed, requestId } = require('./_lib/http');
module.exports=async function handler(req,res){if(req.method!=='GET')return methodNotAllowed(res,['GET']);res.setHeader('x-request-id',requestId(req));return json(res,200,{ok:true,service:'sra-luck-dev-console',runtime:'vercel-functions',time:new Date().toISOString()})};
