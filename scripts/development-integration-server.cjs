// Dedicated loopback-only app process, attested before test requests are allowed.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),https=require('node:https');
const {loadDevelopmentTarget,assertPrismaIsolation}=require('./development-integration-target.cjs');
async function main(){
  const target=loadDevelopmentTarget(process.env.TEST_DATABASE_URL,process.env.BBE_INTEGRATION_SUITE);
  if(!target)throw Error('Explicit guarded development mode required');
  const {PrismaClient}=require('@prisma/client');
  const prisma=new PrismaClient({log:[]});
  await assertPrismaIsolation(prisma,target);
  globalThis.prisma=prisma;
  // Integration may exercise invalid upload/email paths but must never perform
  // an external upload, send a message or contact a real third-party media API.
  const loopback=value=>['127.0.0.1','localhost','[::1]','::1'].includes(value);
  const originalFetch=globalThis.fetch;
  globalThis.fetch=(input,options)=>{
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
    if(!loopback(url.hostname))throw Error('Integration guard blocked external HTTP request');
    return originalFetch(input,options);
  };
  for(const transport of [http,https]){
    const original=transport.request;
    transport.request=function(input,...args){
      const host=typeof input==='string'||input instanceof URL?new URL(input).hostname:input.hostname||input.host||'localhost';
      if(!loopback(String(host).split(':')[0])&&!loopback(host))throw Error('Integration guard blocked external HTTP transport');
      return original.call(this,input,...args);
    };
  }
  const dir=path.resolve(process.env.BBE_INTEGRATION_APP_DIR||process.cwd());
  const port=Number(process.env.BBE_INTEGRATION_PORT);
  if(!Number.isInteger(port)||port<3100||port>3199)throw Error('Unexpected test server port');
  const config=require(path.join(dir,'next.config.js'));
  const app=require('next')({dev:true,hostname:'127.0.0.1',port,dir,conf:{...config,distDir:`.next-integration-${target.suite}`}});
  await app.prepare();
  const handler=app.getRequestHandler();
  const configured=process.env.DATABASE_URL;
  const server=http.createServer((req,res)=>{
    if(process.env.DATABASE_URL!==configured||globalThis.prisma!==prisma){res.statusCode=503;res.end('Integration target changed');return;}
    return handler(req,res);
  });
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
  await assertPrismaIsolation(prisma,target);
  const receipt={createdAt:new Date().toISOString(),pid:process.pid,origin:`http://127.0.0.1:${port}`,projectRef:target.projectRef,database:target.database,schema:target.schema,connectionFingerprint:target.fingerprint,nonce:process.env.BBE_SERVER_NONCE,prismaInstanceAttested:true,externalHttpBlocked:true};
  fs.writeFileSync(process.env.BBE_SERVER_ATTESTATION,JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify({status:'READY',projectRef:target.projectRef,database:target.database,schema:target.schema,origin:receipt.origin,externalHttpBlocked:true}));
  let closing=false;
  const close=async()=>{if(closing)return;closing=true;await new Promise(r=>server.close(r));await app.close();await prisma.$disconnect();process.exit(0);};
  process.on('message',message=>{if(message?.type==='shutdown')void close();});process.on('SIGTERM',()=>void close());
}
main().catch(error=>{console.error(JSON.stringify({status:'FAIL',message:String(error.message).replace(/postgres(?:ql)?:\/\/\S+/g,'[redacted]').slice(0,250)}));process.exitCode=1;});
