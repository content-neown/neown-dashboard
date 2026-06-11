import { useState, useEffect, useRef, useCallback } from 'react';
import Head from 'next/head';

const C={blue:'#185FA5',green:'#1D9E75',amber:'#BA7517',red:'#E24B4A',purple:'#534AB7',coral:'#D85A30',gray:'#888780'};

function extractId(u){const m=u.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);return m?m[1]:null;}
function parseCSV(text){const lines=text.split('\n'),h=splitLine(lines[0]).map(x=>x.replace(/^"|"$/g,'').trim()),rows=[];for(let i=1;i<lines.length;i++){if(!lines[i].trim())continue;const v=splitLine(lines[i]),r={};h.forEach((k,j)=>r[k]=(v[j]||'').replace(/^"|"$/g,'').trim());rows.push(r);}return rows;}
function splitLine(l){const o=[];let c='',q=false;for(let i=0;i<l.length;i++){const x=l[i];if(x==='"')q=!q;else if(x===','&&!q){o.push(c);c='';}else c+=x;}o.push(c);return o;}
function col(r,...keys){for(const k of keys)if(r[k]!==undefined&&r[k]!=='')return r[k];return '';}
function getCT(r){const ct=col(r,'Customer Type','customer_type').toLowerCase();if(ct.includes('renew'))return'renewal';if(ct.includes('new'))return'new';return'other';}
function parseLI(raw){
  const li=(raw||'').toLowerCase();
  if(li.includes('workshop'))return{pt:'workshop',pd:null,ps:'workshop'};
  if(li.includes('workbook'))return{pt:'workbook',pd:null,ps:'workbook'};
  let pt='books';
  if(li.includes('toy library'))pt='toys';
  else if(li.includes('toys + books')||li.includes('toys+books'))pt='combo';
  let pd=null;
  if(li.includes('12 month'))pd='12 months';else if(li.includes('6 month'))pd='6 months';
  else if(li.includes('3 month'))pd='3 months';else if(li.includes('2 month'))pd='2 months';
  let ps='standard';
  if(li.includes('sibling'))ps='sibling';else if(li.includes('mini pack'))ps='mini';
  else if(li.includes('gift sub'))ps='gift';else if(li.includes('toys + books')||li.includes('combo'))ps='combo';
  return{pt,pd,ps};
}
const SM={'andhra pradesh':'Andhra Pradesh','arunachal pradesh':'Arunachal Pradesh','assam':'Assam','bihar':'Bihar','chhattisgarh':'Chhattisgarh','goa':'Goa','gujarat':'Gujarat','haryana':'Haryana','himachal pradesh':'Himachal Pradesh','jharkhand':'Jharkhand','karnataka':'Karnataka','kerala':'Kerala','madhya pradesh':'Madhya Pradesh','maharashtra':'Maharashtra','manipur':'Manipur','meghalaya':'Meghalaya','mizoram':'Mizoram','nagaland':'Nagaland','odisha':'Orissa','orissa':'Orissa','punjab':'Punjab','rajasthan':'Rajasthan','sikkim':'Sikkim','tamil nadu':'Tamil Nadu','tamilnadu':'Tamil Nadu','telangana':'Andhra Pradesh','tripura':'Tripura','uttar pradesh':'Uttar Pradesh','uttarakhand':'Uttaranchal','uttaranchal':'Uttaranchal','west bengal':'West Bengal','jammu and kashmir':'Jammu and Kashmir','jammu & kashmir':'Jammu and Kashmir','j & k':'Jammu and Kashmir','delhi':'Delhi','new delhi':'Delhi','nct of delhi':'Delhi','chandigarh':'Chandigarh','puducherry':'Puducherry','pondicherry':'Puducherry'};
function normState(s){if(!s)return null;return SM[s.toLowerCase().trim()]||null;}

/* ── Zoomable India Heatmap with click-to-zoom-state ── */
function IndiaHeatmap({stateData,metric}){
  const wrapRef=useRef(null),geoRef=useRef(null),zoomRef=useRef(null),drawnRef=useRef(false),activeRef=useRef(null);

  const draw=useCallback(()=>{
    const d3=window.d3,wrap=wrapRef.current,geo=geoRef.current;
    if(!d3||!wrap||!geo||!stateData)return;
    wrap.innerHTML='';
    drawnRef.current=false;
    activeRef.current=null;

    const W=wrap.clientWidth||700;
    const H=Math.min(Math.round(W*0.78),600);

    const svg=d3.select(wrap).append('svg')
      .attr('width','100%').attr('height',H)
      .attr('viewBox',`0 0 ${W} ${H}`)
      .style('display','block').style('cursor','grab');

    // Tooltip
    const tt=d3.select(wrap).append('div')
      .style('position','absolute').style('background','#fff')
      .style('border','0.5px solid #e0e0e0').style('border-radius','10px')
      .style('padding','10px 14px').style('font-size','12px').style('line-height','1.65')
      .style('pointer-events','none').style('opacity','0').style('transition','opacity 0.12s')
      .style('white-space','nowrap').style('z-index','30')
      .style('box-shadow','0 4px 16px rgba(0,0,0,0.13)');

    // Back button (hidden until a state is selected)
    const backBtn=d3.select(wrap).append('div')
      .style('position','absolute').style('top','10px').style('right','10px')
      .style('background','rgba(255,255,255,0.95)').style('border','0.5px solid #ddd')
      .style('border-radius','8px').style('padding','6px 14px').style('font-size','12px')
      .style('cursor','pointer').style('display','none').style('color','#185FA5')
      .style('font-weight','500').style('z-index','20')
      .style('box-shadow','0 2px 8px rgba(0,0,0,0.1)')
      .text('← All India')
      .on('click',()=>resetToIndia(d3,svg,zoom,W,H,path,g,backBtn,stateLabelDiv));

    // State name overlay (shown when zoomed into a state)
    const stateLabelDiv=d3.select(wrap).append('div')
      .style('position','absolute').style('bottom','36px').style('left','12px')
      .style('font-size','16px').style('font-weight','500').style('color','#1a1a1a')
      .style('display','none').style('pointer-events','none')
      .style('background','rgba(255,255,255,0.88)').style('padding','4px 10px')
      .style('border-radius','6px');

    const vals=Object.values(stateData).map(d=>d[metric]||0).filter(v=>v>0);
    const mx=Math.max(...vals,1);
    const cs=d3.scaleSequential([0,mx],d3.interpolateBlues);

    const proj=d3.geoMercator().center([82.5,22]).scale(W*1.45).translate([W/2,H/2]);
    const path=d3.geoPath(proj);

    svg.append('rect').attr('width',W).attr('height',H).attr('fill','#f5f5f3').attr('rx',8);

    const g=svg.append('g');

    const paths=g.selectAll('path').data(geo.features).join('path')
      .attr('d',path)
      .attr('fill',d=>{const v=stateData[d.properties.NAME_1]?.[metric]||0;return v>0?cs(v):'#e2e0db';})
      .attr('stroke','#fff').attr('stroke-width',0.7).style('cursor','pointer');

    // ── Click to zoom into state ──
    paths.on('click',function(event,d){
      event.stopPropagation();
      tt.style('opacity','0');
      const nm=d.properties.NAME_1;
      if(activeRef.current===nm){
        // Second click on same state = reset
        resetToIndia(d3,svg,zoom,W,H,path,g,backBtn,stateLabelDiv);
        return;
      }
      activeRef.current=nm;

      // Compute bounds of clicked state
      const [[x0,y0],[x1,y1]]=path.bounds(d);
      const bW=x1-x0,bH=y1-y0;
      // Padding around the state
      const pad=0.25;
      const scale=Math.min(8,0.9/Math.max(bW/W,bH/H))*(1-pad);
      const cx=(x0+x1)/2,cy=(y0+y1)/2;
      const tx=W/2-scale*cx,ty=H/2-scale*cy;

      // Highlight selected, dim others
      g.selectAll('path')
        .transition().duration(300)
        .attr('opacity',feat=>feat.properties.NAME_1===nm?1:0.35)
        .attr('stroke',feat=>feat.properties.NAME_1===nm?'#185FA5':'#fff')
        .attr('stroke-width',feat=>feat.properties.NAME_1===nm?1.5/scale:0.7/scale);

      svg.transition().duration(600).ease(d3.easeCubicInOut)
        .call(zoom.transform,d3.zoomIdentity.translate(tx,ty).scale(scale));

      // Show back button + state label
      backBtn.style('display','block');
      const sd=stateData[nm];
      const metVal=!sd?'—':metric==='aov'?'₹'+sd.aov.toLocaleString('en-IN'):metric==='renewal'?sd.renewal+'% renewal':metric==='disc'?sd.disc+'% discount rate':sd.orders.toLocaleString('en-IN')+' orders';
      stateLabelDiv.style('display','block').text(`${nm}  ·  ${metVal}`);
    });

    // Click on SVG background = reset
    svg.on('click',()=>resetToIndia(d3,svg,zoom,W,H,path,g,backBtn,stateLabelDiv));

    // Hover
    paths.on('mouseover',function(event,d){
      const nm=d.properties.NAME_1,sd=stateData[nm];
      if(activeRef.current&&activeRef.current!==nm)return;
      d3.select(this).raise().attr('stroke','#185FA5').attr('stroke-width',1.5/((zoomRef.current?.k)||1));
      if(!sd){tt.style('opacity','0');return;}
      const fmt=metric==='aov'?'₹'+sd.aov.toLocaleString('en-IN'):metric==='renewal'?sd.renewal+'%':metric==='disc'?sd.disc+'%':sd.orders.toLocaleString('en-IN')+' orders';
      const metLabel=metric==='aov'?'AOV':metric==='renewal'?'Renewal':metric==='disc'?'Discount':'Orders';
      tt.style('opacity','1').html(
        `<div style="font-weight:500;font-size:13px;margin-bottom:4px">${nm}</div>`+
        `<div style="color:#444">${metLabel}: <strong>${fmt}</strong></div>`+
        `<div style="color:#aaa;font-size:11px;margin-top:3px">${sd.orders.toLocaleString('en-IN')} orders · AOV ₹${sd.aov.toLocaleString('en-IN')} · ${sd.renewal}% renewal</div>`
      );
    })
    .on('mousemove',function(event){
      const rect=wrap.getBoundingClientRect();
      const x=event.clientX-rect.left,y=event.clientY-rect.top;
      const lx=x+18+220>wrap.clientWidth?x-230:x+18;
      tt.style('left',lx+'px').style('top',Math.max(8,y-80)+'px');
    })
    .on('mouseout',function(){
      const k=(zoomRef.current?.k)||1;
      const nm=d3.select(this).datum().properties.NAME_1;
      const isActive=activeRef.current===nm||!activeRef.current;
      d3.select(this)
        .attr('stroke',activeRef.current===nm?'#185FA5':'#fff')
        .attr('stroke-width',(activeRef.current===nm?1.5:0.7)/k);
      tt.style('opacity','0');
    });

    // Labels
    const bigStates=['Maharashtra','Rajasthan','Madhya Pradesh','Uttar Pradesh','Karnataka','Gujarat','Andhra Pradesh','Tamil Nadu','Orissa','West Bengal','Bihar','Jharkhand','Chhattisgarh','Haryana'];
    const lblG=g.append('g').attr('class','labels');
    lblG.selectAll('text').data(geo.features.filter(f=>bigStates.includes(f.properties.NAME_1))).join('text')
      .attr('pointer-events','none')
      .attr('transform',d=>{const[cx,cy]=path.centroid(d);return`translate(${cx},${cy})`;})
      .attr('text-anchor','middle').attr('dominant-baseline','middle').attr('font-size',9)
      .attr('fill',d=>{const v=stateData[d.properties.NAME_1]?.[metric]||0;return v>mx*0.5?'rgba(255,255,255,0.93)':'rgba(0,0,0,0.35)';})
      .text(d=>{
        const v=stateData[d.properties.NAME_1]?.[metric]||0;if(!v)return'';
        if(metric==='aov')return'₹'+(v>=1000?Math.round(v/1000)+'k':Math.round(v));
        if(metric==='renewal'||metric==='disc')return Math.round(v)+'%';
        return v>=1000?(v/1000).toFixed(1)+'k':v;
      });

    // Zoom behaviour
    const zoom=d3.zoom()
      .scaleExtent([1,9])
      .translateExtent([[0,0],[W,H]])
      .on('zoom',event=>{
        const{transform:tr}=event;
        zoomRef.current={zoom,svg,W,H,k:tr.k};
        g.attr('transform',tr);
        g.selectAll('path:not(.lbl)').attr('stroke-width',function(){
          const nm=d3.select(this).datum().properties.NAME_1;
          return(activeRef.current===nm?1.5:0.7)/tr.k;
        });
        lblG.selectAll('text').attr('font-size',9/Math.sqrt(tr.k));
        if(tr.k===1){
          backBtn.style('display','none');
          stateLabelDiv.style('display','none');
          activeRef.current=null;
          g.selectAll('path').attr('opacity',1).attr('stroke','#fff');
        }
        tt.style('opacity','0');
      });

    svg.call(zoom);
    zoomRef.current={zoom,svg,W,H,k:1};

    // +/- zoom controls
    const ctrlG=svg.append('g').attr('transform','translate(12,12)');
    [['+',0,'in'],['-',28,'out']].forEach(([lbl,dy,action])=>{
      const btn=ctrlG.append('g').attr('transform',`translate(0,${dy})`).style('cursor','pointer');
      btn.append('rect').attr('width',26).attr('height',24).attr('rx',5).attr('fill','rgba(255,255,255,0.92)').attr('stroke','rgba(0,0,0,0.12)').attr('stroke-width',0.5);
      btn.append('text').attr('x',13).attr('y',16).attr('text-anchor','middle').attr('font-size',16).attr('fill','#444').text(lbl);
      btn.on('click',ev=>{ev.stopPropagation();svg.transition().duration(250).call(zoom.scaleBy,action==='in'?1.6:0.625);});
    });

    // Legend
    const lW=110,lH=7,lX=W-lW-12,lY=H-22;
    const defs=svg.append('defs');
    const grad=defs.append('linearGradient').attr('id','hGrd').attr('x1','0%').attr('x2','100%');
    [0,0.25,0.5,0.75,1].forEach(t=>grad.append('stop').attr('offset',t*100+'%').attr('stop-color',cs(mx*t)));
    svg.append('rect').attr('x',lX).attr('y',lY).attr('width',lW).attr('height',lH).attr('rx',3).attr('fill','url(#hGrd)');
    svg.append('text').attr('x',lX).attr('y',lY+15).attr('font-size',9).attr('fill','#999').text('0');
    const mxL=metric==='aov'?'₹'+Math.round(mx/1000)+'k':metric==='renewal'||metric==='disc'?Math.round(mx)+'%':mx>=1000?(mx/1000).toFixed(1)+'k':mx;
    svg.append('text').attr('x',lX+lW).attr('y',lY+15).attr('font-size',9).attr('fill','#999').attr('text-anchor','end').text(mxL);

    drawnRef.current=true;
  },[stateData,metric]);

  function resetToIndia(d3,svg,zoom,W,H,path,g,backBtn,stateLabelDiv){
    activeRef.current=null;
    backBtn.style('display','none');
    stateLabelDiv.style('display','none');
    g.selectAll('path').transition().duration(400)
      .attr('opacity',1).attr('stroke','#fff').attr('stroke-width',0.7);
    svg.transition().duration(500).ease(d3.easeCubicInOut)
      .call(zoom.transform,d3.zoomIdentity);
  }

  useEffect(()=>{
    function tryDraw(){
      if(!window.d3||!window.d3.geoMercator){setTimeout(tryDraw,150);return;}
      if(geoRef.current){draw();return;}
      fetch('/india.json')
        .then(r=>{if(!r.ok)throw new Error(`india.json ${r.status}`);return r.json();})
        .then(geo=>{geoRef.current=geo;draw();})
        .catch(e=>{const w=wrapRef.current;if(w)w.innerHTML=`<div style="padding:48px;text-align:center;color:#E24B4A;font-size:13px">Map failed: ${e.message}</div>`;});
    }
    tryDraw();
  },[draw]);

  useEffect(()=>{
    let t;
    const obs=new ResizeObserver(()=>{clearTimeout(t);t=setTimeout(()=>{if(drawnRef.current&&geoRef.current&&window.d3)draw();},150);});
    if(wrapRef.current)obs.observe(wrapRef.current);
    return()=>{obs.disconnect();clearTimeout(t);};
  },[draw]);

  return <div ref={wrapRef} style={{position:'relative',width:'100%',borderRadius:8,overflow:'hidden',minHeight:300}}/>;
}


/* ── UI helpers ── */
function MCard({label,value,sub}){return(<div style={{background:'#fff',border:'0.5px solid #e5e5e3',borderRadius:10,padding:'14px 16px'}}><div style={{fontSize:11,color:'#888',marginBottom:4}}>{label}</div><div style={{fontSize:22,fontWeight:500}}>{value}</div>{sub&&<div style={{fontSize:11,color:'#aaa',marginTop:2}}>{sub}</div>}</div>);}
function Leg({items}){return(<div style={{display:'flex',flexWrap:'wrap',gap:12,marginBottom:10,fontSize:12,color:'#555'}}>{items.map(({l,c})=>(<span key={l} style={{display:'flex',alignItems:'center',gap:5}}><span style={{width:10,height:10,borderRadius:2,background:c,flexShrink:0}}/>{l}</span>))}</div>);}
function CCard({title,sub,children,half}){return(<div style={{background:'#fff',border:'0.5px solid #e5e5e3',borderRadius:12,padding:18,marginBottom:half?0:16}}><div style={{fontSize:14,fontWeight:500,marginBottom:3}}>{title}</div>{sub&&<div style={{fontSize:12,color:'#888',marginBottom:14}}>{sub}</div>}{children}</div>);}
function ST({children}){return<div style={{fontSize:11,fontWeight:500,color:'#aaa',textTransform:'uppercase',letterSpacing:'0.08em',margin:'24px 0 12px',paddingBottom:6,borderBottom:'0.5px solid #e5e5e3'}}>{children}</div>;}

/* ── Main page ── */
export default function Dashboard(){
  const[url,setUrl]=useState(''),[oSheet,setOSheet]=useState('Sheet1'),[pSheet,setPSheet]=useState('Sheet2');
  const[status,setStatus]=useState({msg:'',type:''}),[appData,setAppData]=useState(null);
  const[filter,setFilter]=useState('all'),[tab,setTab]=useState('charts'),[mapMet,setMapMet]=useState('orders');
  const cRef=useRef({});

  useEffect(()=>{
    if(typeof window==='undefined'||window.d3)return;
    const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/d3/7.8.5/d3.min.js';document.head.appendChild(s);
  },[]);

  async function load(){
    const id=extractId(url.trim());
    if(!id){setStatus({msg:'No sheet ID found in URL.',type:'err'});return;}
    setStatus({msg:'Connecting…',type:'loading'});
    try{
      const[oR,pR]=await Promise.all([fetch(`/api/sheet?id=${id}&sheet=${encodeURIComponent(oSheet)}`),fetch(`/api/sheet?id=${id}&sheet=${encodeURIComponent(pSheet)}`)]);
      if(!oR.ok||!pR.ok)throw new Error('Sheet not accessible. Share as "Anyone with the link → Viewer".');
      const[oT,pT]=await Promise.all([oR.text(),pR.text()]);
      const orders=parseCSV(oT),pincodes=parseCSV(pT);
      const pm={};
      pincodes.forEach(r=>{const pc=col(r,'pincode','Pincode').toString().trim();if(pc)pm[pc]={city:col(r,'district','District','officename')||'Unknown',state:normState(col(r,'statename','Statename','state'))};});
      setStatus({msg:`Loaded ${orders.length.toLocaleString('en-IN')} orders + ${pincodes.length.toLocaleString('en-IN')} pincode records.`,type:'ok'});
      setAppData({orders,pm});
    }catch(e){setStatus({msg:e.message,type:'err'});}
  }

  function getCity(r){const pc=col(r,'Shipping Pincode','shipping_pincode').toString().trim();if(appData?.pm[pc])return appData.pm[pc].city;return col(r,'Shipping City','shipping_city')||'Unknown';}
  function getState(r){const pc=col(r,'Shipping Pincode','shipping_pincode').toString().trim();if(appData?.pm[pc]?.state)return appData.pm[pc].state;return normState(col(r,'Shipping State','shipping_state'))||'Unknown';}

  function filtRows(){
    if(!appData)return[];
    if(filter==='all')return appData.orders;
    const d=parseInt(filter),c=new Date();c.setDate(c.getDate()-d);
    return appData.orders.filter(r=>{const x=new Date(col(r,'Created At','created_at'));return!isNaN(x)&&x>=c;});
  }

  function calc(){
    const rows=filtRows();if(!rows.length||!appData)return null;
    const city={},state={},pDur={},pSub={};
    rows.forEach(r=>{
      const ci=getCity(r),st=getState(r);
      if(!city[ci])city[ci]={orders:0,rev:0,ren:0,newU:0,oth:0,disc:0,books:0,workshop:0,workbook:0,combo:0};
      if(!state[st])state[st]={orders:0,rev:0,renC:0,discC:0};
      const c=city[ci],s=state[st];
      c.orders++;s.orders++;
      const rv=parseFloat(col(r,'Total Price','total_price').replace(/[^0-9.]/g,''))||0;
      c.rev+=rv;s.rev+=rv;
      const ct=getCT(r);
      if(ct==='renewal'){c.ren++;s.renC++;}else if(ct==='new')c.newU++;else c.oth++;
      if((col(r,'Discount Code','discount_code')||'').trim()){c.disc++;s.discC++;}
      const{pt,pd,ps}=parseLI(col(r,'Line Items','line_items'));
      const k=pt==='toys'?'combo':pt;c[k in c?k:'books']++;
      if(pd)pDur[pd]=(pDur[pd]||0)+1;
      pSub[ps]=(pSub[ps]||0)+1;
    });
    Object.keys(state).forEach(k=>{const d=state[k];d.aov=d.orders?Math.round(d.rev/d.orders):0;d.renewal=d.orders?Math.round(d.renC/d.orders*100):0;d.disc=d.orders?Math.round(d.discC/d.orders*100):0;});
    const t15=Object.entries(city).sort((a,b)=>b[1].orders-a[1].orders).slice(0,15);
    const tot=rows.length,totR=rows.reduce((s,r)=>s+(parseFloat(col(r,'Total Price','total_price').replace(/[^0-9.]/g,''))||0),0);
    const totRen=rows.filter(r=>getCT(r)==='renewal').length,totNew=rows.filter(r=>getCT(r)==='new').length;
    const totD=rows.filter(r=>(col(r,'Discount Code','discount_code')||'').trim()).length;
    return{t15,state,tot,totR,totRen,totNew,totD,pDur,pSub,cities:Object.keys(city).length};
  }

  const m=appData?calc():null;

  useEffect(()=>{
    if(!m||tab!=='charts')return;
    const go=()=>renderCharts(m,cRef);
    if(window.Chart)go();
    else{const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js';s.onload=go;document.head.appendChild(s);}
  },[m,tab]);

  const fBtns=[{k:'all',l:'All time'},{k:'30',l:'Last 30 days'},{k:'90',l:'Last 90 days'},{k:'180',l:'Last 180 days'}];
  const sC={ok:'#1D9E75',err:'#E24B4A',loading:'#888'};
  const pDD=m?(()=>{const o=['3 months','6 months','12 months','2 months'],c=[C.blue,C.green,C.amber,C.gray],l=o.filter(k=>m.pDur[k]),v=l.map(k=>m.pDur[k]);return{l,v,c,t:v.reduce((a,b)=>a+b,0)};})():null;
  const pSD=m?(()=>{const o=['standard','sibling','combo','gift','mini'],c=[C.blue,C.green,C.coral,C.purple,C.gray],l=o.filter(k=>m.pSub[k]),v=l.map(k=>m.pSub[k]);return{l,v,c,t:v.reduce((a,b)=>a+b,0)};})():null;
  const topStates=m?Object.entries(m.state).filter(([s])=>s!=='Unknown').sort((a,b)=>b[1].orders-a[1].orders).slice(0,10):[];
  const mmL={orders:'Order volume',aov:'AOV (₹)',renewal:'Renewal rate',disc:'Discount rate'};

  return(
    <>
      <Head>
        <title>neOwn — Location Dashboard</title>
        <meta name="viewport" content="width=device-width,initial-scale=1"/>
        <style>{`*{box-sizing:border-box}body{margin:0}`}</style>
      </Head>
      <div style={{maxWidth:1100,margin:'0 auto',padding:'28px 20px',fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',color:'#1a1a1a',fontSize:14}}>

        <div style={{marginBottom:24}}>
          <h1 style={{fontSize:20,fontWeight:500,marginBottom:3}}>neOwn — location dashboard</h1>
          <p style={{fontSize:13,color:'#777'}}>Live data from your Google Sheets</p>
        </div>

        <div style={{background:'#fff',border:'0.5px solid #ddd',borderRadius:12,padding:22,marginBottom:22}}>
          <h2 style={{fontSize:15,fontWeight:500,marginBottom:14}}>Connect Google Sheets</h2>
          <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:10}}>
            <input value={url} onChange={e=>setUrl(e.target.value)} placeholder="Paste your Google Sheets URL…" style={{flex:1,minWidth:260,height:38,border:'0.5px solid #ccc',borderRadius:8,padding:'0 12px',fontSize:13,background:'#fafafa',outline:'none'}}/>
            <button onClick={load} style={{height:38,padding:'0 18px',border:'none',borderRadius:8,background:'#185FA5',color:'#fff',fontSize:13,cursor:'pointer',whiteSpace:'nowrap'}}>Load data</button>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
            {[['Orders sheet',oSheet,setOSheet],['Pincode sheet',pSheet,setPSheet]].map(([lb,v,set])=>(
              <div key={lb} style={{display:'flex',flexDirection:'column',gap:4}}>
                <label style={{fontSize:11,color:'#888',textTransform:'uppercase',letterSpacing:'0.05em'}}>{lb}</label>
                <input value={v} onChange={e=>set(e.target.value)} style={{height:34,border:'0.5px solid #ccc',borderRadius:8,padding:'0 10px',fontSize:13,background:'#fafafa',outline:'none'}}/>
              </div>
            ))}
          </div>
          <p style={{fontSize:12,color:'#888',lineHeight:1.7}}>Share → <strong>Anyone with the link → Viewer</strong> → Copy link → paste above.</p>
          {status.msg&&<div style={{fontSize:12,marginTop:10,color:sC[status.type]||'#888'}}>{status.msg}</div>}
        </div>

        {appData&&(
          <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center',marginBottom:18}}>
            <span style={{fontSize:12,color:'#888'}}>Period:</span>
            {fBtns.map(({k,l})=>(<button key={k} onClick={()=>setFilter(k)} style={{fontSize:12,padding:'5px 14px',borderRadius:20,border:'0.5px solid',borderColor:filter===k?'#185FA5':'#ccc',background:filter===k?'#185FA5':'#fff',color:filter===k?'#fff':'#555',cursor:'pointer'}}>{l}</button>))}
          </div>
        )}

        {m&&(
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(148px,1fr))',gap:10,marginBottom:20}}>
            <MCard label="Total orders" value={m.tot.toLocaleString('en-IN')} sub={`${m.cities} cities`}/>
            <MCard label="Overall AOV" value={'₹'+Math.round(m.totR/m.tot).toLocaleString('en-IN')} sub="per order"/>
            <MCard label="Renewal rate" value={Math.round(m.totRen/m.tot*100)+'%'} sub="of total orders"/>
            <MCard label="Churn rate" value={Math.round((1-m.totRen/m.tot)*100)+'%'} sub="non-renewals"/>
            <MCard label="New subscribers" value={m.totNew.toLocaleString('en-IN')} sub={Math.round(m.totNew/m.tot*100)+'% of total'}/>
            <MCard label="Discount orders" value={m.totD.toLocaleString('en-IN')} sub={Math.round(m.totD/m.tot*100)+'% of total'}/>
          </div>
        )}

        {m&&(
          <>
            <div style={{display:'flex',borderBottom:'0.5px solid #e5e5e3',marginBottom:20}}>
              {[['charts','Charts'],['map','India heatmap']].map(([k,l])=>(
                <button key={k} onClick={()=>setTab(k)} style={{padding:'10px 20px',border:'none',borderBottom:tab===k?'2px solid #185FA5':'2px solid transparent',background:'none',fontSize:13,fontWeight:tab===k?500:400,color:tab===k?'#185FA5':'#777',cursor:'pointer'}}>{l}</button>
              ))}
            </div>

            {tab==='charts'&&(
              <>
                <ST>Orders by city</ST>
                <CCard title="Top cities by order volume" sub="Pincode → district; top 15 cities">
                  <div style={{position:'relative',height:Math.max(280,m.t15.length*34+80)}}><canvas id="cityOrders" role="img" aria-label="Orders by city"/></div>
                </CCard>
                <ST>AOV by city</ST>
                <CCard title="Average order value — top 15 cities" sub="₹ AOV per city">
                  <div style={{position:'relative',height:280}}><canvas id="aovChart" role="img" aria-label="AOV by city"/></div>
                </CCard>
                <ST>Renewal, new & churn</ST>
                <CCard title="Customer type split — top 15 cities" sub="% of city orders">
                  <Leg items={[{l:'Renewal',c:C.blue},{l:'New',c:C.green},{l:'Other / lapsed',c:C.red}]}/>
                  <div style={{position:'relative',height:300}}><canvas id="renewalChart" role="img" aria-label="Customer type by city"/></div>
                </CCard>
                <ST>Discount redemptions</ST>
                <CCard title="Discount code usage — top 15 cities" sub="% of city orders with a discount code">
                  <div style={{position:'relative',height:280}}><canvas id="discChart" role="img" aria-label="Discount rate by city"/></div>
                </CCard>
                <ST>Pack & product split</ST>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:16}}>
                  <CCard title="Pack duration" sub="Orders by subscription length" half>
                    {pDD&&<Leg items={pDD.l.map((lb,i)=>({l:`${lb} — ${Math.round(pDD.v[i]/pDD.t*100)}%`,c:pDD.c[i]}))}/>}
                    <div style={{position:'relative',height:210}}><canvas id="packDurChart" role="img" aria-label="Pack duration"/></div>
                  </CCard>
                  <CCard title="Pack type" sub="Standard vs sibling vs combo vs gift vs mini" half>
                    {pSD&&<Leg items={pSD.l.map((lb,i)=>({l:`${lb.charAt(0).toUpperCase()+lb.slice(1)} — ${Math.round(pSD.v[i]/pSD.t*100)}%`,c:pSD.c[i]}))}/>}
                    <div style={{position:'relative',height:210}}><canvas id="packSubChart" role="img" aria-label="Pack type"/></div>
                  </CCard>
                </div>
                <CCard title="Product type — top 15 cities" sub="Books vs workshops vs workbooks vs toys/combo">
                  <Leg items={[{l:'Books',c:C.blue},{l:'Workshops',c:C.green},{l:'Workbooks',c:C.amber},{l:'Toys/Combo',c:C.purple}]}/>
                  <div style={{position:'relative',height:300}}><canvas id="productChart" role="img" aria-label="Product type by city"/></div>
                </CCard>
              </>
            )}

            {tab==='map'&&(
              <>
                <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:16,flexWrap:'wrap'}}>
                  <span style={{fontSize:12,color:'#888'}}>Show:</span>
                  {Object.entries(mmL).map(([k,l])=>(<button key={k} onClick={()=>setMapMet(k)} style={{fontSize:12,padding:'5px 14px',borderRadius:20,border:'0.5px solid',borderColor:mapMet===k?'#185FA5':'#ccc',background:mapMet===k?'#185FA5':'#fff',color:mapMet===k?'#fff':'#555',cursor:'pointer'}}>{l}</button>))}
                </div>
                <CCard title={`India heatmap — ${mmL[mapMet]} by state`} sub="Click a state to zoom in · Scroll to zoom · Drag to pan · Hover for details">
                  <IndiaHeatmap stateData={m.state} metric={mapMet}/>
                </CCard>
                <div style={{marginTop:16,display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:10}}>
                  {topStates.map(([st,d])=>(
                    <div key={st} style={{background:'#fff',border:'0.5px solid #e5e5e3',borderRadius:10,padding:'12px 14px'}}>
                      <div style={{fontSize:13,fontWeight:500,marginBottom:6}}>{st}</div>
                      <div style={{fontSize:11,color:'#888',display:'flex',flexDirection:'column',gap:3}}>
                        <span>Orders: <strong style={{color:'#1a1a1a'}}>{d.orders.toLocaleString('en-IN')}</strong></span>
                        <span>AOV: <strong style={{color:'#1a1a1a'}}>₹{d.aov.toLocaleString('en-IN')}</strong></span>
                        <span>Renewal: <strong style={{color:'#1a1a1a'}}>{d.renewal}%</strong></span>
                        <span>Discount rate: <strong style={{color:'#1a1a1a'}}>{d.disc}%</strong></span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {!appData&&(
          <div style={{textAlign:'center',padding:'60px 20px',color:'#ccc'}}>
            <div style={{fontSize:48,marginBottom:12}}>↑</div>
            <p style={{fontSize:14}}>Paste your Google Sheets URL above and click Load data</p>
          </div>
        )}
      </div>
    </>
  );
}

function renderCharts(m,cRef){
  const Ch=window.Chart;if(!Ch)return;
  const ci=m.t15.map(e=>e[0]),cd=m.t15.map(e=>e[1]);
  const tC='rgba(0,0,0,0.42)',gC='rgba(0,0,0,0.06)';
  function kill(id){if(cRef.current[id]){cRef.current[id].destroy();delete cRef.current[id];}}
  function hbar(id,lb,data,col){kill(id);const c=document.getElementById(id);if(!c)return;cRef.current[id]=new Ch(c,{type:'bar',indexAxis:'y',data:{labels:lb,datasets:[{data,backgroundColor:col,borderRadius:4,borderSkipped:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:v=>v.raw.toLocaleString('en-IN')+' orders'}}},scales:{x:{ticks:{color:tC,font:{size:11}},grid:{color:gC}},y:{ticks:{color:tC,font:{size:11}},grid:{color:'transparent'}}}}});}
  function bar(id,lb,data,col,pre,suf){kill(id);const c=document.getElementById(id);if(!c)return;cRef.current[id]=new Ch(c,{type:'bar',data:{labels:lb,datasets:[{data,backgroundColor:col,borderRadius:4,borderSkipped:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:v=>pre+v.raw.toLocaleString('en-IN')+suf}}},scales:{x:{ticks:{color:tC,font:{size:11},autoSkip:false,maxRotation:40},grid:{color:gC}},y:{ticks:{color:tC,font:{size:11},callback:v=>pre+v.toLocaleString('en-IN')+suf},grid:{color:gC}}}}});}
  function stk(id,lb,series){kill(id);const c=document.getElementById(id);if(!c)return;cRef.current[id]=new Ch(c,{type:'bar',data:{labels:lb,datasets:series.map((s,i)=>({label:s.l,data:s.d,backgroundColor:s.c,borderRadius:i===series.length-1?4:0,borderSkipped:false,stack:'s'}))},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{mode:'index',callbacks:{label:v=>v.dataset.label+': '+v.raw+'%'}}},scales:{x:{stacked:true,ticks:{color:tC,font:{size:11},autoSkip:false,maxRotation:40},grid:{color:gC}},y:{stacked:true,max:100,ticks:{color:tC,font:{size:11},callback:v=>v+'%'},grid:{color:gC}}}}});}
  function donut(id,data,cols,lb){kill(id);const c=document.getElementById(id);if(!c)return;cRef.current[id]=new Ch(c,{type:'doughnut',data:{labels:lb,datasets:[{data,backgroundColor:cols,borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,cutout:'65%',plugins:{legend:{display:false},tooltip:{callbacks:{label:v=>v.label+': '+v.raw.toLocaleString('en-IN')+' orders'}}}}});}
  hbar('cityOrders',ci,cd.map(d=>d.orders),C.blue);
  bar('aovChart',ci,cd.map(d=>d.orders?Math.round(d.rev/d.orders):0),C.green,'₹','');
  stk('renewalChart',ci,[{l:'Renewal',d:cd.map(d=>d.orders?Math.round(d.ren/d.orders*100):0),c:C.blue},{l:'New',d:cd.map(d=>d.orders?Math.round(d.newU/d.orders*100):0),c:C.green},{l:'Other',d:cd.map(d=>d.orders?Math.round(d.oth/d.orders*100):0),c:C.red}]);
  bar('discChart',ci,cd.map(d=>d.orders?Math.round(d.disc/d.orders*100):0),C.amber,'','%');
  const dO=['3 months','6 months','12 months','2 months'],dC=[C.blue,C.green,C.amber,C.gray];
  const dL=dO.filter(k=>m.pDur[k]),dV=dL.map(k=>m.pDur[k]);donut('packDurChart',dV,dC.slice(0,dL.length),dL);
  const sO=['standard','sibling','combo','gift','mini'],sC=[C.blue,C.green,C.coral,C.purple,C.gray];
  const sL=sO.filter(k=>m.pSub[k]),sV=sL.map(k=>m.pSub[k]);donut('packSubChart',sV,sC.slice(0,sL.length),sL.map(l=>l.charAt(0).toUpperCase()+l.slice(1)));
  stk('productChart',ci,[{l:'Books',d:cd.map(d=>d.orders?Math.round(d.books/d.orders*100):0),c:C.blue},{l:'Workshops',d:cd.map(d=>d.orders?Math.round(d.workshop/d.orders*100):0),c:C.green},{l:'Workbooks',d:cd.map(d=>d.orders?Math.round(d.workbook/d.orders*100):0),c:C.amber},{l:'Toys/Combo',d:cd.map(d=>d.orders?Math.round(d.combo/d.orders*100):0),c:C.purple}]);
}
