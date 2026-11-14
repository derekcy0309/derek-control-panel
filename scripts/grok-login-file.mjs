// Generates a local credential artifact. Never prints the Access Code or any
// database/service credential. No external accounts or paid services are used.
import {randomBytes,createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,chmod} from 'node:fs/promises';
import {resolve,dirname,relative,isAbsolute,sep} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const args=process.argv.slice(2),get=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
const output=get('--output'),origin=get('--origin'),verify=args.includes('--verify'),repair=args.includes('--repair-permissions');
if(!output||!isAbsolute(output)||!origin)throw new Error('Provide an absolute --output path and an HTTPS --origin');
const url=new URL(origin);if(url.protocol!=='https:'||url.origin!==origin)throw new Error('Origin must be an HTTPS origin without credentials/path/query');
const file=resolve(output),repo=resolve(fileURLToPath(new URL('..',import.meta.url)));
const inside=relative(repo,file);if(inside!=='..'&&!inside.startsWith('..'+sep)&&!isAbsolute(inside))throw new Error('Credential artifacts must stay outside the source repository');
if(verify){
  const value=await readFile(file,'utf8'),key=/^Access Code: (dcp_grok_[A-Za-z0-9_-]{43})$/m.exec(value)?.[1];
  if(!key)throw new Error('Credential artifact is not valid');
  const response=await fetch(origin+'/api/agent?view=status',{headers:{Authorization:'Bearer '+key},signal:AbortSignal.timeout(15000)});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(`Agent verification failed (${response.status}); ${typeof body.error==='string'?body.error:'no app response'}`);
  if(body.permissions?.delete!==false||body.permissions?.update!==false||body.permissions?.read!==true||body.permissions?.create!==true)throw new Error('Unexpected agent permission contract');
  console.log(JSON.stringify({verified:true,id:body.id,label:body.label,expiresAt:body.expiresAt,permissions:body.permissions}));
}else{
  let sid=null;
  if(process.platform==='win32'){
    const user=spawnSync('whoami.exe',['/user','/fo','csv','/nh'],{encoding:'utf8',windowsHide:true});sid=/S-1-\d+(?:-\d+)+/.exec(user.stdout||'')?.[0];
    if(user.status!==0||!sid)throw new Error('Could not determine current Windows identity; no credential written');
  }
  const key=repair?/^Access Code: (dcp_grok_[A-Za-z0-9_-]{43})$/m.exec(await readFile(file,'utf8'))?.[1]:'dcp_grok_'+randomBytes(32).toString('base64url');
  if(!key)throw new Error('Credential artifact is not valid');
  const hash=createHash('sha256').update(key).digest('hex');
  await mkdir(dirname(file),{recursive:true});
  if(!repair)
  await writeFile(file,[`Derek Panel - Grok Agent Login`,`Login: ${origin}/agent`,`Access Code: ${key}`,``,`Permissions: read opened own Tasks/Notes; create new private Tasks/Notes.`,`No update, completion, handover, archive, delete, user administration, finance or medication access.`,`Expires: 30 days from activation. Revoke from Settings > Grok Login.`,``,`Keep this file private. Enter the code through Grok Vault / Secure Form, not ordinary chat.`,`All Bots on the same Grok account may share the browser session.`,``].join('\n'),{encoding:'utf8',flag:'wx',mode:0o600});
  if(sid){const acl=spawnSync('icacls.exe',[file,'/inheritance:r','/grant:r',`*${sid}:(F)`],{encoding:'utf8',windowsHide:true});if(acl.status!==0)throw new Error('Credential written but ACL could not be tightened; do not activate it');}
  else await chmod(file,0o600);
  console.log(JSON.stringify({path:file,hash,restrictedFile:true}));
}
