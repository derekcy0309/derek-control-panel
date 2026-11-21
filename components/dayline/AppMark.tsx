import { ImageResponse } from "next/og";
export function daylineIcon(size:number){
  const n=(v:number)=>Math.round(size*v/100);
  return new ImageResponse(<div style={{width:size,height:size,display:"flex",alignItems:"center",justifyContent:"center",background:"#e2eeeb"}}>
    <div style={{width:n(51),height:n(49),position:"relative",display:"flex",transform:"rotate(-7deg)"}}>
      {[0,1,2].map(i=><div key={i} style={{display:"flex",flexDirection:"column",gap:n(5),justifyContent:"center",position:"absolute",left:n(i*3),top:n(7-i*3),width:n(45),height:n(39),border:n(1.5)+"px solid #195b64",borderRadius:n(5),background:["#75a2a2","#f6f9f5","#195b64"][i],padding:n(7)}}>{i===2?<><div style={{width:n(24),height:n(2.5),background:"#f6f9f5"}}/><div style={{width:n(16),height:n(2.5),background:"#f6f9f5"}}/></>:null}</div>)}
    </div>
  </div>,{width:size,height:size});
}
