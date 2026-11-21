// Handoff after the existing edition has been produced. No scheduling, reading other chats or fetching Gmail.
// Use only on a trusted publisher host. No credential or full article is ever printed.
const names=["home","ngo","chronic","weekly","us"],topic=process.argv[2],key=process.env["DAYLINE_PUBLISH_"+String(topic).toUpperCase()];
if(!names.includes(topic)||!/^dlpub_[a-f0-9]{64}$/.test(key||"")){console.error("Missing series-specific publishing credential.");process.exit(2);}
const origin=new URL(process.env.DAYLINE_PUBLISH_ORIGIN||"https://derek-control-panel.vercel.app");
if(origin.username||origin.password||origin.pathname!=="/"||origin.search||origin.hash||!(origin.href==="https://derek-control-panel.vercel.app/"||(origin.protocol==="https:"&&/^derek-control-panel-[a-z0-9]+-derekcy0309-4881s-projects\.vercel\.app$/.test(origin.hostname)))){
 console.error("Unrecognised Dayline destination.");process.exit(2);}
try{let size=0;const chunks=[];for await(const c of process.stdin){size+=c.length;if(size>550000)throw Error();chunks.push(c);}
 const envelope=JSON.parse(Buffer.concat(chunks));if(!["issue","no_issue","failed"].includes(envelope.outcome)||envelope.outcome==="issue"&&(envelope.issue?.series!==topic||envelope.issue?.sourceKind!=="codex-scheduled"))throw Error();
 const r=await fetch(new URL("/api/publications/deliver",origin),{method:"POST",redirect:"error",signal:AbortSignal.timeout(20000),headers:{"Content-Type":"application/json",Authorization:"Bearer "+key},body:JSON.stringify(envelope)});
 if(!r.ok){console.error("Not delivered (HTTP "+r.status+"). Preserve original; retry identical edition. Corrections require previous digest.");process.exitCode=1;}
 else {const j=await r.json();if(!["created","revised","unchanged","failed","no_issue"].includes(j.receipt))throw Error();console.log("Dayline receipt: "+j.receipt+(j.revision?" "+j.revision:""));}
}catch{console.error("No confirmed delivery. Retain original and retry.");process.exitCode=1;}
