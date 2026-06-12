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

/* ── India Map: state choropleth + pincode bubbles on drill-down ── */
function IndiaHeatmap({stateData,pincodePoints,metric}){
  const wrapRef=useRef(null),geoStateRef=useRef(null);
  const zoomRef=useRef(null),drawnRef=useRef(false),modeRef=useRef('state'),activeStateRef=useRef(null);

  const fmtV=(v,m)=>{
    if(v===undefined||v===null)return'—';
    if(m==='aov')return'₹'+Math.round(v).toLocaleString('en-IN');
    if(m==='renewal'||m==='disc')return Math.round(v)+'%';
    return v.toLocaleString('en-IN');
  };
  const mLbl=m=>({aov:'AOV',renewal:'Renewal',disc:'Discount',orders:'Orders'}[m]);

  const draw=useCallback(()=>{
    const d3=window.d3,wrap=wrapRef.current,geo=geoStateRef.current;
    if(!d3||!wrap||!geo||!stateData)return;
    wrap.innerHTML=''; drawnRef.current=false; modeRef.current='state'; activeStateRef.current=null;

    const W=wrap.clientWidth||700,H=Math.min(Math.round(W*0.78),600);
    const svg=d3.select(wrap).append('svg').attr('width','100%').attr('height',H)
      .attr('viewBox',`0 0 ${W} ${H}`).style('display','block').style('cursor','grab');
    svg.append('rect').attr('width',W).attr('height',H).attr('fill','#f0eeea').attr('rx',8);

    const g=svg.append('g');
    const proj=d3.geoMercator().center([82.5,22]).scale(W*1.45).translate([W/2,H/2]);
    const path=d3.geoPath(proj);

    // Tooltip
    const tt=d3.select(wrap).append('div')
      .style('position','absolute').style('background','#fff').style('border','0.5px solid #e0e0e0')
      .style('border-radius','10px').style('padding','10px 14px').style('font-size','12px')
      .style('line-height','1.65').style('pointer-events','none').style('opacity','0')
      .style('transition','opacity 0.1s').style('white-space','nowrap').style('z-index','30')
      .style('box-shadow','0 4px 16px rgba(0,0,0,0.12)');

    function showTT(event,html){
      const rect=wrap.getBoundingClientRect();
      const x=event.clientX-rect.left,y=event.clientY-rect.top;
      const lx=x+18+260>wrap.clientWidth?x-270:x+18;
      tt.style('opacity','1').style('left',lx+'px').style('top',Math.max(8,y-90)+'px').html(html);
    }

    // Breadcrumb
    const bc=d3.select(wrap).append('div')
      .style('position','absolute').style('top','10px').style('left','50px')
      .style('background','rgba(255,255,255,0.95)').style('border','0.5px solid #ddd')
      .style('border-radius','8px').style('padding','5px 12px').style('font-size','12px')
      .style('display','none').style('z-index','20').style('color','#555')
      .style('box-shadow','0 2px 8px rgba(0,0,0,0.08)');

    // Back button
    const back=d3.select(wrap).append('div')
      .style('position','absolute').style('top','10px').style('right','10px')
      .style('background','rgba(255,255,255,0.95)').style('border','0.5px solid #ddd')
      .style('border-radius','8px').style('padding','5px 14px').style('font-size','12px')
      .style('cursor','pointer').style('display','none').style('color','#185FA5')
      .style('font-weight','500').style('z-index','20').style('box-shadow','0 2px 8px rgba(0,0,0,0.08)')
      .text('← All India').on('click',ev=>{ev.stopPropagation();resetAll();});

    // State color scale
    const sVals=Object.values(stateData).map(d=>d[metric]||0).filter(v=>v>0);
    const sMx=Math.max(...sVals,1);
    const sCs=d3.scaleSequential([0,sMx],d3.interpolateBlues);

    // State layer
    const stG=g.append('g');
    stG.selectAll('path').data(geo.features).join('path')
      .attr('d',path)
      .attr('fill',d=>{const v=stateData[d.properties.NAME_1]?.[metric]||0;return v>0?sCs(v):'#dddbd6';})
      .attr('stroke','#fff').attr('stroke-width',0.7).style('cursor','pointer')
      .on('mouseover',function(event,d){
        if(modeRef.current!=='state')return;
        d3.select(this).raise().attr('stroke','#185FA5').attr('stroke-width',1.5);
        const nm=d.properties.NAME_1,sd=stateData[nm];
        if(!sd){tt.style('opacity','0');return;}
        showTT(event,
          `<div style="font-weight:500;font-size:13px;margin-bottom:4px">${nm}</div>`+
          `<div style="color:#444">${mLbl(metric)}: <strong>${fmtV(sd[metric],metric)}</strong></div>`+
          `<div style="color:#aaa;font-size:11px;margin-top:3px">${sd.orders.toLocaleString('en-IN')} orders · AOV ₹${sd.aov.toLocaleString('en-IN')} · ${sd.renewal}% renewal</div>`+
          `<div style="color:#999;font-size:11px;margin-top:2px;font-style:italic">Click to see pincode breakdown →</div>`
        );
      })
      .on('mousemove',function(event){
        if(modeRef.current!=='state')return;
        const rect=wrap.getBoundingClientRect();
        const x=event.clientX-rect.left,y=event.clientY-rect.top;
        const lx=x+18+260>wrap.clientWidth?x-270:x+18;
        tt.style('left',lx+'px').style('top',Math.max(8,y-90)+'px');
      })
      .on('mouseout',function(){
        if(modeRef.current!=='state')return;
        d3.select(this).attr('stroke','#fff').attr('stroke-width',0.7/(zoomRef.current?.k||1));
        tt.style('opacity','0');
      })
      .on('click',function(event,d){
        event.stopPropagation();tt.style('opacity','0');
        zoomState(d3,svg,zoom,W,H,path,d,stG,bubbleG,lblG,bc,back);
      });

    // Bubble layer (pincode points — shown on drill-down)
    const bubbleG=g.append('g').style('display','none');

    // State labels
    const bigSt=['Maharashtra','Rajasthan','Madhya Pradesh','Uttar Pradesh','Karnataka','Gujarat',
      'Andhra Pradesh','Tamil Nadu','Orissa','West Bengal','Bihar','Jharkhand','Chhattisgarh','Haryana','Telangana'];
    const lblG=g.append('g');
    lblG.selectAll('text').data(geo.features.filter(f=>bigSt.includes(f.properties.NAME_1))).join('text')
      .attr('pointer-events','none')
      .attr('transform',d=>{const[cx,cy]=path.centroid(d);return`translate(${cx},${cy})`;})
      .attr('text-anchor','middle').attr('dominant-baseline','middle').attr('font-size',9)
      .attr('fill',d=>{const v=stateData[d.properties.NAME_1]?.[metric]||0;return v>sMx*0.5?'rgba(255,255,255,0.92)':'rgba(0,0,0,0.35)';})
      .text(d=>{
        const v=stateData[d.properties.NAME_1]?.[metric]||0;if(!v)return'';
        if(metric==='aov')return'₹'+(v>=1000?Math.round(v/1000)+'k':Math.round(v));
        if(metric==='renewal'||metric==='disc')return Math.round(v)+'%';
        return v>=1000?(v/1000).toFixed(1)+'k':v;
      });

    // ── Zoom into state + show pincode bubbles ──
    function zoomState(d3,svg,zoom,W,H,path,d,stG,bubbleG,lblG,bc,back){
      const nm=d.properties.NAME_1;
      if(activeStateRef.current===nm){resetAll();return;}
      activeStateRef.current=nm; modeRef.current='bubble';

      const[[x0,y0],[x1,y1]]=path.bounds(d);
      const scale=Math.min(10,Math.min(W/(x1-x0)*0.75,H/(y1-y0)*0.75));
      const cx=(x0+x1)/2,cy=(y0+y1)/2;

      // Dim states
      stG.selectAll('path').transition().duration(300)
        .attr('opacity',f=>f.properties.NAME_1===nm?0.25:0.12)
        .attr('stroke-width',0.3/(scale));
      lblG.transition().duration(250).attr('opacity',0);

      // Filter pincode points for this state
      const pts=(pincodePoints||[]).filter(p=>p.state===nm);
      const pVals=pts.map(p=>p[metric]||0).filter(v=>v>0);
      const pMx=Math.max(...pVals,1);
      const pCs=d3.scaleSequential([0,pMx],d3.interpolateOrRd);
      const rScale=d3.scaleSqrt([0,Math.max(...pts.map(p=>p.orders),1)],[3,28]);

      bubbleG.style('display',null).selectAll('*').remove();

      // Draw pincode bubbles
      pts.sort((a,b)=>b.orders-a.orders); // draw small ones on top
      bubbleG.selectAll('circle').data(pts).join('circle')
        .attr('cx',p=>proj([p.lng,p.lat])[0])
        .attr('cy',p=>proj([p.lng,p.lat])[1])
        .attr('r',p=>rScale(p.orders)/scale)
        .attr('fill',p=>{const v=p[metric]||0;return v>0?pCs(v):'rgba(100,100,100,0.3)';})
        .attr('fill-opacity',0.82)
        .attr('stroke','#fff').attr('stroke-width',0.4/scale)
        .style('cursor','pointer')
        .on('mouseover',function(event,p){
          d3.select(this).raise().attr('stroke','#185FA5').attr('stroke-width',1.2/scale).attr('fill-opacity',1);
          showTT(event,
            `<div style="font-weight:500;font-size:13px;margin-bottom:4px">${p.district}</div>`+
            `<div style="color:#666;font-size:11px;margin-bottom:4px">Pincode: ${p.pincode}</div>`+
            `<div style="color:#444">${mLbl(metric)}: <strong>${fmtV(p[metric],metric)}</strong></div>`+
            `<div style="color:#aaa;font-size:11px;margin-top:3px">${p.orders.toLocaleString('en-IN')} orders · AOV ₹${p.aov.toLocaleString('en-IN')} · ${p.renewal}% renewal</div>`
          );
        })
        .on('mousemove',function(event){
          const rect=wrap.getBoundingClientRect();
          const x=event.clientX-rect.left,y=event.clientY-rect.top;
          const lx=x+18+260>wrap.clientWidth?x-270:x+18;
          tt.style('left',lx+'px').style('top',Math.max(8,y-90)+'px');
        })
        .on('mouseout',function(){
          d3.select(this).attr('stroke','#fff').attr('stroke-width',0.4/scale).attr('fill-opacity',0.82);
          tt.style('opacity','0');
        });

      // Bubble legend (size)
      updateBubbleLegend(svg,rScale,scale,pCs,pMx,W,H);

      svg.transition().duration(650).ease(d3.easeCubicInOut)
        .call(zoom.transform,d3.zoomIdentity.translate(W/2-scale*cx,H/2-scale*cy).scale(scale));

      bc.style('display','block').html(
        `<span style="color:#888">India</span> <span style="color:#ccc"> › </span>`+
        `<span style="color:#185FA5;font-weight:500">${nm}</span>`+
        `<span style="color:#999;font-size:11px"> · ${pts.length} pincodes</span>`
      );
      back.style('display','block');
    }

    function resetAll(){
      activeStateRef.current=null; modeRef.current='state';
      bc.style('display','none'); back.style('display','none'); tt.style('opacity','0');
      bubbleG.style('display','none').selectAll('*').remove();
      stG.selectAll('path').transition().duration(400).attr('opacity',1).attr('stroke','#fff').attr('stroke-width',0.7);
      lblG.transition().duration(400).attr('opacity',1);
      svg.transition().duration(500).ease(d3.easeCubicInOut).call(zoom.transform,d3.zoomIdentity);
      updateStateLegend(svg,sCs,sMx,W,H);
    }

    svg.on('click',()=>{if(modeRef.current!=='state')resetAll();});

    const zoom=d3.zoom().scaleExtent([1,14]).translateExtent([[0,0],[W,H]])
      .on('zoom',event=>{
        const{transform:tr}=event;
        zoomRef.current={k:tr.k};
        g.attr('transform',tr);
        stG.selectAll('path').attr('stroke-width',(modeRef.current==='state'?0.7:0.3)/tr.k);
        bubbleG.selectAll('circle')
          .attr('r',p=>{ try{return d3.scaleSqrt([0,Math.max(...((pincodePoints||[]).filter(x=>x.state===activeStateRef.current).map(x=>x.orders)),1)],[3,28])(p.orders)/tr.k;}catch{return 3/tr.k;}})
          .attr('stroke-width',0.4/tr.k);
        lblG.selectAll('text').attr('font-size',9/Math.sqrt(tr.k));
        if(tr.k<=1.05&&modeRef.current!=='state')resetAll();
        tt.style('opacity','0');
      });

    svg.call(zoom);
    zoomRef.current={k:1};

    // +/- controls
    const ctrl=svg.append('g').attr('transform','translate(12,12)');
    [['+',0,1.6],['-',28,0.625]].forEach(([l,dy,f])=>{
      const b=ctrl.append('g').attr('transform',`translate(0,${dy})`).style('cursor','pointer');
      b.append('rect').attr('width',26).attr('height',24).attr('rx',5).attr('fill','rgba(255,255,255,0.92)').attr('stroke','rgba(0,0,0,0.12)').attr('stroke-width',0.5);
      b.append('text').attr('x',13).attr('y',16).attr('text-anchor','middle').attr('font-size',16).attr('fill','#444').text(l);
      b.on('click',ev=>{ev.stopPropagation();svg.transition().duration(250).call(zoom.scaleBy,f);});
    });

    updateStateLegend(svg,sCs,sMx,W,H);
    drawnRef.current=true;
  },[stateData,pincodePoints,metric]);

  function updateStateLegend(svg,cs,mx,W,H){
    svg.selectAll('.leg').remove();
    const lg=svg.append('g').attr('class','leg');
    const lW=110,lH=7,lX=W-lW-12,lY=H-22;
    svg.select('defs').empty()&&svg.append('defs');
    svg.select('defs').selectAll('#hGrd').remove();
    const grad=svg.select('defs').append('linearGradient').attr('id','hGrd').attr('x1','0%').attr('x2','100%');
    [0,0.25,0.5,0.75,1].forEach(t=>grad.append('stop').attr('offset',t*100+'%').attr('stop-color',cs(mx*t)));
    lg.append('rect').attr('x',lX).attr('y',lY).attr('width',lW).attr('height',lH).attr('rx',3).attr('fill','url(#hGrd)');
    lg.append('text').attr('x',lX).attr('y',lY+15).attr('font-size',9).attr('fill','#999').text('0');
    const mxL=metric==='aov'?'₹'+Math.round(mx/1000)+'k':metric==='renewal'||metric==='disc'?Math.round(mx)+'%':mx>=1000?(mx/1000).toFixed(1)+'k':mx;
    lg.append('text').attr('x',lX+lW).attr('y',lY+15).attr('font-size',9).attr('fill','#999').attr('text-anchor','end').text(mxL);
  }

  function updateBubbleLegend(svg,rScale,scale,cs,mx,W,H){
    svg.selectAll('.leg').remove();
    const lg=svg.append('g').attr('class','leg');
    // Color ramp
    const lW=90,lH=6,lX=W-lW-12,lY=H-22;
    svg.select('defs').empty()&&svg.append('defs');
    svg.select('defs').selectAll('#bGrd').remove();
    const grad=svg.select('defs').append('linearGradient').attr('id','bGrd').attr('x1','0%').attr('x2','100%');
    const bCs=window.d3.scaleSequential([0,mx],window.d3.interpolateOrRd);
    [0,0.25,0.5,0.75,1].forEach(t=>grad.append('stop').attr('offset',t*100+'%').attr('stop-color',bCs(mx*t)));
    lg.append('rect').attr('x',lX).attr('y',lY).attr('width',lW).attr('height',lH).attr('rx',3).attr('fill','url(#bGrd)');
    lg.append('text').attr('x',lX).attr('y',lY+15).attr('font-size',9).attr('fill','#999').text('low');
    const mxL=metric==='aov'?'₹'+Math.round(mx/1000)+'k':metric==='renewal'||metric==='disc'?Math.round(mx)+'%':'high';
    lg.append('text').attr('x',lX+lW).attr('y',lY+15).attr('font-size',9).attr('fill','#999').attr('text-anchor','end').text(mxL);
    // Size legend
    lg.append('text').attr('x',W-lW-14).attr('y',lY+15).attr('font-size',9).attr('fill','#999').attr('text-anchor','end').text('● = order volume');
  }

  useEffect(()=>{
    function tryDraw(){
      if(!window.d3||!window.d3.geoMercator){setTimeout(tryDraw,150);return;}
      if(geoStateRef.current){draw();return;}
      fetch('/india.json').then(r=>r.json()).then(g=>{geoStateRef.current=g;draw();})
        .catch(e=>{const w=wrapRef.current;if(w)w.innerHTML=`<div style="padding:48px;text-align:center;color:#E24B4A;font-size:13px">Map error: ${e.message}</div>`;});
    }
    tryDraw();
  },[draw]);

  useEffect(()=>{
    let t;
    const obs=new ResizeObserver(()=>{clearTimeout(t);t=setTimeout(()=>{if(drawnRef.current&&geoStateRef.current&&window.d3)draw();},150);});
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
      pincodes.forEach(r=>{const pc=col(r,'pincode','Pincode').toString().trim();if(pc)pm[pc]={city:col(r,'district','District','officename')||'Unknown',state:normState(col(r,'statename','Statename','state')),lat:parseFloat(col(r,'latitude','Latitude')||0),lng:parseFloat(col(r,'longitude','Longitude')||0)};});
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
    // District data: state → { districtName → {orders,rev,renC,discC} }
    // Pincode-level bubble data using lat/lng from pincode sheet
    const pcRaw={};
    rows.forEach(r=>{
      const pc=col(r,'Shipping Pincode','shipping_pincode').toString().trim();
      const pm=appData?.pm[pc];
      if(!pm)return;
      if(!pcRaw[pc])pcRaw[pc]={orders:0,rev:0,renC:0,discC:0,district:pm.city,state:pm.state,lat:pm.lat,lng:pm.lng,pincode:pc};
      const d=pcRaw[pc];
      d.orders++;
      d.rev+=parseFloat(col(r,'Total Price','total_price').replace(/[^0-9.]/g,''))||0;
      const ct=getCT(r);if(ct==='renewal')d.renC++;
      if((col(r,'Discount Code','discount_code')||'').trim())d.discC++;
    });
    const pincodePoints=Object.values(pcRaw)
      .filter(p=>p.lat&&p.lng&&p.state)
      .map(p=>({...p,aov:p.orders?Math.round(p.rev/p.orders):0,renewal:p.orders?Math.round(p.renC/p.orders*100):0,disc:p.orders?Math.round(p.discC/p.orders*100):0}));
    const t15=Object.entries(city).sort((a,b)=>b[1].orders-a[1].orders).slice(0,15);
    const tot=rows.length,totR=rows.reduce((s,r)=>s+(parseFloat(col(r,'Total Price','total_price').replace(/[^0-9.]/g,''))||0),0);
    const totRen=rows.filter(r=>getCT(r)==='renewal').length,totNew=rows.filter(r=>getCT(r)==='new').length;
    const totD=rows.filter(r=>(col(r,'Discount Code','discount_code')||'').trim()).length;
    return{t15,state,pincodePoints,tot,totR,totRen,totNew,totD,pDur,pSub,cities:Object.keys(city).length};
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
                <CCard title={`India heatmap — ${mmL[mapMet]} by state`} sub="Click a state → pincode bubbles · Scroll to zoom · Drag to pan">
                  <IndiaHeatmap stateData={m.state} pincodePoints={m.pincodePoints} metric={mapMet}/>
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
