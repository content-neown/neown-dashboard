import React, { useState, useEffect, useRef, useCallback } from 'react';
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

/* ── India Map: state choropleth → district drill-down with borders + breakdown ── */
function IndiaHeatmap({stateData,districtData,metric,onDistrictData}){
  const wrapRef=useRef(null),geoStateRef=useRef(null),geoDistRef=useRef(null),aliasRef=useRef(null);
  const zoomRef=useRef(null),drawnRef=useRef(false),modeRef=useRef('state'),activeStateRef=useRef(null);

  const fmtV=(v,m)=>{
    if(v===undefined||v===null||isNaN(v))return'—';
    if(m==='aov')return'₹'+Math.round(v).toLocaleString('en-IN');
    if(m==='renewal'||m==='disc')return Math.round(v)+'%';
    return Number(v).toLocaleString('en-IN');
  };
  const mLbl=m=>({aov:'AOV',renewal:'Renewal rate',disc:'Discount rate',orders:'Orders'}[m]||m);

  // Normalize district name for matching
  function normDist(s){ return (s||'').toLowerCase().trim().replace(/\s+/g,' '); }

  // Resolve pincode district name → GeoJSON district name
  function resolveDistName(name,aliases){
    const k=normDist(name);
    if(aliases[k]) return aliases[k];
    // Try without common suffixes
    const stripped=k.replace(/ (district|dist|urban|rural|nagar|city)$/,'').trim();
    if(aliases[stripped]) return aliases[stripped];
    // Title case fallback
    return name.split(' ').map(w=>w.charAt(0).toUpperCase()+w.slice(1).toLowerCase()).join(' ');
  }

  const draw=useCallback(()=>{
    const d3=window.d3,wrap=wrapRef.current;
    const geoState=geoStateRef.current,geoDist=geoDistRef.current,aliases=aliasRef.current;
    if(!d3||!wrap||!geoState||!geoDist||!aliases||!stateData)return;

    wrap.innerHTML='';
    drawnRef.current=false; modeRef.current='state'; activeStateRef.current=null;

    const W=wrap.clientWidth||700,H=Math.min(Math.round(W*0.78),600);
    const svg=d3.select(wrap).append('svg').attr('width','100%').attr('height',H)
      .attr('viewBox',`0 0 ${W} ${H}`).style('display','block').style('cursor','grab');
    svg.append('rect').attr('width',W).attr('height',H).attr('fill','#eeecea').attr('rx',8);

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
      tt.style('opacity','1')
        .style('left',(x+18+280>W?x-290:x+18)+'px')
        .style('top',Math.max(8,y-95)+'px').html(html);
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

    // State paths
    const stG=g.append('g').attr('class','state-g');
    stG.selectAll('path').data(geoState.features).join('path')
      .attr('d',path)
      .attr('fill',d=>{const v=stateData[d.properties.NAME_1]?.[metric]||0;return v>0?sCs(v):'#d8d5d0';})
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
          `<div style="color:#999;font-size:11px;margin-top:2px;font-style:italic">Click to see districts →</div>`
        );
      })
      .on('mousemove',function(event){
        if(modeRef.current!=='state')return;
        const rect=wrap.getBoundingClientRect();
        const x=event.clientX-rect.left,y=event.clientY-rect.top;
        tt.style('left',(x+18+280>W?x-290:x+18)+'px').style('top',Math.max(8,y-95)+'px');
      })
      .on('mouseout',function(){
        if(modeRef.current!=='state')return;
        d3.select(this).attr('stroke','#fff').attr('stroke-width',0.7/(zoomRef.current?.k||1));
        tt.style('opacity','0');
      })
      .on('click',function(event,d){
        event.stopPropagation();tt.style('opacity','0');
        drillDown(d3,svg,zoom,W,H,path,d,g,stG,districtG,bubbleG,lblG,bc,back);
      });

    // District border layer
    const districtG=g.append('g').attr('class','district-g').style('display','none');
    // District bubble layer
    const bubbleG=g.append('g').attr('class','bubble-g').style('display','none');

    // State labels
    const bigSt=['Maharashtra','Rajasthan','Madhya Pradesh','Uttar Pradesh','Karnataka','Gujarat',
      'Andhra Pradesh','Tamil Nadu','Orissa','West Bengal','Bihar','Jharkhand','Chhattisgarh','Haryana','Telangana'];
    const lblG=g.append('g').attr('class','label-g');
    lblG.selectAll('text').data(geoState.features.filter(f=>bigSt.includes(f.properties.NAME_1))).join('text')
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

    // ── Drill into state ──
    function drillDown(d3,svg,zoom,W,H,path,feat,g,stG,districtG,bubbleG,lblG,bc,back){
      const stateName=feat.properties.NAME_1;
      if(activeStateRef.current===stateName){resetAll();return;}
      activeStateRef.current=stateName; modeRef.current='district';

      // Zoom bounds
      const[[x0,y0],[x1,y1]]=path.bounds(feat);
      const scale=Math.min(10,Math.min(W/(x1-x0)*0.72,H/(y1-y0)*0.72));
      const cx=(x0+x1)/2,cy=(y0+y1)/2;
      const tx=W/2-scale*cx,ty=H/2-scale*cy;

      // Dim state layer
      stG.selectAll('path').transition().duration(300)
        .attr('opacity',f=>f.properties.NAME_1===stateName?0.18:0.08)
        .attr('stroke-width',0.5/scale);
      lblG.transition().duration(250).attr('opacity',0);

      // GeoJSON districts for this state
      // Map state name to GeoJSON state name (handle Telangana → Andhra Pradesh)
      const geoStateName = stateName==='Telangana'?'Andhra Pradesh':stateName;
      const stateDists=geoDist.features.filter(f=>f.properties.state===geoStateName);

      // District order data for this state
      const dData=districtData?.[stateName]||{};
      const dEntries=Object.entries(dData);
      const dVals=dEntries.map(([,d])=>d[metric]||0).filter(v=>v>0);
      const dMx=Math.max(...dVals,1);
      const dCs=d3.scaleSequential([0,dMx],d3.interpolateOrRd);

      // Build lookup: geoJSON district name → order data
      // Try exact match first, then alias, then fuzzy
      function findData(geoName){
        const geoKey=normDist(geoName);
        // Direct match
        const direct=dEntries.find(([k])=>normDist(k)===geoKey);
        if(direct)return{key:direct[0],data:direct[1]};
        // Via alias (reverse: find pincode district whose alias === this geo name)
        const viaAlias=dEntries.find(([k])=>normDist(resolveDistName(k,aliases))===geoKey);
        if(viaAlias)return{key:viaAlias[0],data:viaAlias[1]};
        // Partial match
        const partial=dEntries.find(([k])=>normDist(k).includes(geoKey)||geoKey.includes(normDist(k)));
        if(partial)return{key:partial[0],data:partial[1]};
        return null;
      }

      // Draw district borders + fill
      districtG.style('display',null).selectAll('*').remove();
      districtG.selectAll('path').data(stateDists).join('path')
        .attr('d',path)
        .attr('fill',d=>{
          const found=findData(d.properties.district);
          const v=found?found.data[metric]||0:0;
          return v>0?dCs(v):'rgba(200,195,190,0.5)';
        })
        .attr('stroke','rgba(255,255,255,0.9)').attr('stroke-width',0.6/scale)
        .attr('stroke-linejoin','round')
        .style('cursor','pointer')
        .on('mouseover',function(event,d){
          d3.select(this).raise().attr('stroke','#185FA5').attr('stroke-width',1.2/scale);
          const found=findData(d.properties.district);
          const dd=found?.data;
          showTT(event,
            `<div style="font-weight:500;font-size:13px;margin-bottom:4px">${d.properties.district}</div>`+
            (dd
              ? `<div style="color:#444">${mLbl(metric)}: <strong>${fmtV(dd[metric],metric)}</strong></div>`+
                `<div style="color:#aaa;font-size:11px;margin-top:3px">${dd.orders.toLocaleString('en-IN')} orders · AOV ₹${dd.aov.toLocaleString('en-IN')} · ${dd.renewal}% renewal</div>`+
                `<div style="color:#aaa;font-size:11px">${dd.pincodeCount} pincode${dd.pincodeCount!==1?'s':''}</div>`
              : `<div style="color:#aaa;font-size:12px;margin-top:2px">No orders in this district</div>`)
          );
        })
        .on('mousemove',function(event){
          const rect=wrap.getBoundingClientRect();
          const x=event.clientX-rect.left,y=event.clientY-rect.top;
          tt.style('left',(x+18+280>W?x-290:x+18)+'px').style('top',Math.max(8,y-95)+'px');
        })
        .on('mouseout',function(){
          d3.select(this).attr('stroke','rgba(255,255,255,0.9)').attr('stroke-width',0.6/scale);
          tt.style('opacity','0');
        });

      // Bubbles at district centroids (only for districts with data)
      const bubblePts=dEntries
        .filter(([,d])=>d.lat&&d.lng)
        .map(([name,d])=>({name,lat:d.lat,lng:d.lng,...d}));

      const rScale=d3.scaleSqrt([0,Math.max(...bubblePts.map(p=>p.orders),1)],[4,32]);

      bubbleG.style('display',null).selectAll('*').remove();
      bubbleG.selectAll('circle')
        .data(bubblePts.sort((a,b)=>b.orders-a.orders))
        .join('circle')
        .attr('cx',p=>{try{return proj([p.lng,p.lat])[0];}catch{return -999;}})
        .attr('cy',p=>{try{return proj([p.lng,p.lat])[1];}catch{return -999;}})
        .attr('r',p=>rScale(p.orders)/scale)
        .attr('fill','rgba(24,95,165,0.75)')
        .attr('stroke','#fff').attr('stroke-width',0.8/scale)
        .style('cursor','pointer')
        .on('mouseover',function(event,p){
          d3.select(this).raise().attr('fill','rgba(24,95,165,1)').attr('stroke-width',1.5/scale);
          showTT(event,
            `<div style="font-weight:500;font-size:13px;margin-bottom:4px">${p.name}</div>`+
            `<div style="color:#444">${mLbl(metric)}: <strong>${fmtV(p[metric],metric)}</strong></div>`+
            `<div style="color:#aaa;font-size:11px;margin-top:3px">${p.orders.toLocaleString('en-IN')} orders · AOV ₹${p.aov.toLocaleString('en-IN')} · ${p.renewal}% renewal</div>`+
            `<div style="color:#aaa;font-size:11px">${p.pincodeCount} pincode${p.pincodeCount!==1?'s':''}</div>`
          );
        })
        .on('mousemove',function(event){
          const rect=wrap.getBoundingClientRect();
          const x=event.clientX-rect.left,y=event.clientY-rect.top;
          tt.style('left',(x+18+280>W?x-290:x+18)+'px').style('top',Math.max(8,y-95)+'px');
        })
        .on('mouseout',function(){
          d3.select(this).attr('fill','rgba(24,95,165,0.75)').attr('stroke-width',0.8/scale);
          tt.style('opacity','0');
        });

      // Animate zoom
      svg.transition().duration(650).ease(d3.easeCubicInOut)
        .call(zoom.transform,d3.zoomIdentity.translate(tx,ty).scale(scale));

      bc.style('display','block').html(
        `<span style="color:#888">India</span> <span style="color:#ccc"> › </span>`+
        `<span style="color:#185FA5;font-weight:500">${stateName}</span>`+
        `<span style="color:#999;font-size:11px"> · ${dEntries.length} districts</span>`
      );
      back.style('display','block');

      // Update legend to district scale
      updateLegend(svg,dCs,dMx,W,H,'district');

      // Pass district data up for breakdown table
      if(onDistrictData) onDistrictData(stateName, dEntries.map(([name,d])=>({name,...d})).sort((a,b)=>b.orders-a.orders));
    }

    function resetAll(){
      activeStateRef.current=null; modeRef.current='state';
      bc.style('display','none'); back.style('display','none'); tt.style('opacity','0');
      districtG.style('display','none').selectAll('*').remove();
      bubbleG.style('display','none').selectAll('*').remove();
      stG.selectAll('path').transition().duration(400).attr('opacity',1).attr('stroke','#fff').attr('stroke-width',0.7);
      lblG.transition().duration(400).attr('opacity',1);
      svg.transition().duration(500).ease(d3.easeCubicInOut).call(zoom.transform,d3.zoomIdentity);
      updateLegend(svg,sCs,sMx,W,H,'state');
      if(onDistrictData) onDistrictData(null,null);
    }

    function updateLegend(svg,cs,mx,W,H,mode){
      svg.selectAll('.leg').remove();
      const lg=svg.append('g').attr('class','leg');
      const lW=110,lH=7,lX=W-lW-12,lY=H-22;
      if(!svg.select('defs').node())svg.append('defs');
      svg.select('defs').selectAll('#hGrd').remove();
      const grad=svg.select('defs').append('linearGradient').attr('id','hGrd').attr('x1','0%').attr('x2','100%');
      [0,0.25,0.5,0.75,1].forEach(t=>grad.append('stop').attr('offset',t*100+'%').attr('stop-color',cs(mx*t)));
      lg.append('rect').attr('x',lX).attr('y',lY).attr('width',lW).attr('height',lH).attr('rx',3).attr('fill','url(#hGrd)');
      lg.append('text').attr('x',lX).attr('y',lY+15).attr('font-size',9).attr('fill','#999').text('0');
      const mxL=metric==='aov'?'₹'+Math.round(mx/1000)+'k':metric==='renewal'||metric==='disc'?Math.round(mx)+'%':mx>=1000?(mx/1000).toFixed(1)+'k':mx;
      lg.append('text').attr('x',lX+lW).attr('y',lY+15).attr('font-size',9).attr('fill','#999').attr('text-anchor','end').text(mxL);
      if(mode==='district'){
        lg.append('circle').attr('cx',lX-10).attr('cy',lY+3).attr('r',4).attr('fill','rgba(24,95,165,0.75)');
        lg.append('text').attr('x',lX-22).attr('y',lY+7).attr('font-size',9).attr('fill','#999').attr('text-anchor','end').text('= order volume');
      }
    }

    svg.on('click',()=>{if(modeRef.current!=='state')resetAll();});

    const zoom=d3.zoom().scaleExtent([1,14]).translateExtent([[0,0],[W,H]])
      .on('zoom',event=>{
        const{transform:tr}=event;
        zoomRef.current={k:tr.k};
        g.attr('transform',tr);
        stG.selectAll('path').attr('stroke-width',(modeRef.current==='state'?0.7:0.5)/tr.k);
        districtG.selectAll('path').attr('stroke-width',0.6/tr.k);
        bubbleG.selectAll('circle').attr('stroke-width',0.8/tr.k);
        lblG.selectAll('text').attr('font-size',9/Math.sqrt(tr.k));
        if(tr.k<=1.05&&modeRef.current!=='state')resetAll();
        tt.style('opacity','0');
      });

    svg.call(zoom);
    zoomRef.current={k:1};

    // +/- buttons
    const ctrl=svg.append('g').attr('transform','translate(12,12)');
    [['+',0,1.6],['-',28,0.625]].forEach(([l,dy,f])=>{
      const b=ctrl.append('g').attr('transform',`translate(0,${dy})`).style('cursor','pointer');
      b.append('rect').attr('width',26).attr('height',24).attr('rx',5).attr('fill','rgba(255,255,255,0.92)').attr('stroke','rgba(0,0,0,0.12)').attr('stroke-width',0.5);
      b.append('text').attr('x',13).attr('y',16).attr('text-anchor','middle').attr('font-size',16).attr('fill','#444').text(l);
      b.on('click',ev=>{ev.stopPropagation();svg.transition().duration(250).call(zoom.scaleBy,f);});
    });

    updateLegend(svg,sCs,sMx,W,H,'state');
    drawnRef.current=true;
  },[stateData,districtData,metric,onDistrictData]);

  useEffect(()=>{
    function tryDraw(){
      if(!window.d3||!window.d3.geoMercator){setTimeout(tryDraw,150);return;}
      const fetches=[];
      if(!geoStateRef.current) fetches.push(fetch('/india.json').then(r=>r.json()).then(g=>{geoStateRef.current=g;}));
      if(!geoDistRef.current) fetches.push(fetch('/india_districts.json').then(r=>r.json()).then(g=>{geoDistRef.current=g;}));
      if(!aliasRef.current) fetches.push(fetch('/district_aliases.json').then(r=>r.json()).then(a=>{aliasRef.current=a;}));
      Promise.all(fetches).then(()=>draw()).catch(e=>{
        const w=wrapRef.current;if(w)w.innerHTML=`<div style="padding:48px;text-align:center;color:#E24B4A;font-size:13px">Map error: ${e.message}</div>`;
      });
    }
    tryDraw();
  },[draw]);

  useEffect(()=>{
    let t;
    const obs=new ResizeObserver(()=>{clearTimeout(t);t=setTimeout(()=>{if(drawnRef.current&&window.d3)draw();},200);});
    if(wrapRef.current)obs.observe(wrapRef.current);
    return()=>{obs.disconnect();clearTimeout(t);};
  },[draw]);

  return <div ref={wrapRef} style={{position:'relative',width:'100%',borderRadius:8,overflow:'hidden',minHeight:300}}/>;
}

/* ── District breakdown table ── */
function DistrictBreakdown({stateName,districts,metric,pincodeRaw}){
  if(!stateName||!districts||!districts.length) return null;
  const[expanded,setExpanded]=useState(null);
  const fmtV=(v,m)=>{
    if(v===undefined||v===null||isNaN(v))return'—';
    if(m==='aov')return'₹'+Math.round(v).toLocaleString('en-IN');
    if(m==='renewal'||m==='disc')return Math.round(v)+'%';
    return Number(v).toLocaleString('en-IN');
  };
  const maxOrders=Math.max(...districts.map(d=>d.orders),1);
  // Get pincode rows for a district
  function getPincodes(distName){
    const raw=(pincodeRaw||{})[stateName]?.[distName]||{};
    return Object.entries(raw).sort((a,b)=>b[1].orders-a[1].orders);
  }
  return(
    <div style={{background:'#fff',border:'0.5px solid #e5e5e3',borderRadius:12,padding:18,marginTop:16}}>
      <div style={{fontSize:14,fontWeight:500,marginBottom:3}}>{stateName} — district breakdown</div>
      <div style={{fontSize:12,color:'#888',marginBottom:14}}>{districts.length} districts with orders · click a district to see pincode breakdown</div>
      <div style={{overflowX:'auto'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
          <thead>
            <tr style={{borderBottom:'0.5px solid #e5e5e3'}}>
              {['District','Orders','AOV','Renewal','Disc %','Pincodes'].map(h=>(
                <th key={h} style={{padding:'6px 12px',textAlign:h==='District'?'left':'right',color:'#888',fontWeight:400,fontSize:11,whiteSpace:'nowrap'}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {districts.map((d,i)=>{
              const isOpen=expanded===d.name;
              const pcs=isOpen?getPincodes(d.name):[];
              const pcMax=pcs.length?Math.max(...pcs.map(([,v])=>v.orders),1):1;
              return(
                <React.Fragment key={d.name}>
                  <tr
                    onClick={()=>setExpanded(isOpen?null:d.name)}
                    style={{borderBottom:isOpen?'none':'0.5px solid #f0f0ee',background:isOpen?'#f0f5ff':i%2===0?'#fff':'#fafaf8',cursor:'pointer'}}
                  >
                    <td style={{padding:'9px 12px',fontWeight:500}}>
                      <div style={{display:'flex',alignItems:'center',gap:8}}>
                        <div style={{width:Math.max(3,Math.round(d.orders/maxOrders*60)),height:6,background:'#185FA5',borderRadius:3,opacity:0.7,flexShrink:0}}/>
                        <span style={{color:isOpen?'#185FA5':'#1a1a1a'}}>{d.name}</span>
                        <span style={{fontSize:10,color:'#aaa',marginLeft:'auto'}}>{isOpen?'▲':'▼'}</span>
                      </div>
                    </td>
                    <td style={{padding:'9px 12px',textAlign:'right',fontWeight:600}}>{d.orders.toLocaleString('en-IN')}</td>
                    <td style={{padding:'9px 12px',textAlign:'right'}}>₹{d.aov.toLocaleString('en-IN')}</td>
                    <td style={{padding:'9px 12px',textAlign:'right',color:d.renewal>=50?'#1D9E75':d.renewal>=30?'#BA7517':'#E24B4A',fontWeight:500}}>{d.renewal}%</td>
                    <td style={{padding:'9px 12px',textAlign:'right'}}>{d.disc}%</td>
                    <td style={{padding:'9px 12px',textAlign:'right',color:'#888'}}>{d.pincodeCount||1}</td>
                  </tr>
                  {isOpen&&(
                    <tr style={{borderBottom:'0.5px solid #e5e5e3'}}>
                      <td colSpan={6} style={{padding:'0 12px 14px 12px',background:'#f7f9ff'}}>
                        <div style={{fontSize:11,color:'#888',margin:'10px 0 8px',fontWeight:500,textTransform:'uppercase',letterSpacing:'0.05em'}}>
                          Pincode breakdown — {d.name}
                        </div>
                        <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
                          <thead>
                            <tr style={{borderBottom:'0.5px solid #e5e5e3'}}>
                              {['Pincode','Orders','AOV','Renewal','Disc %'].map(h=>(
                                <th key={h} style={{padding:'5px 10px',textAlign:h==='Pincode'?'left':'right',color:'#aaa',fontWeight:400}}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {pcs.map(([pc,v],pi)=>(
                              <tr key={pc} style={{borderBottom:'0.5px solid #eee',background:pi%2===0?'#f7f9ff':'#f2f5fd'}}>
                                <td style={{padding:'6px 10px',fontWeight:500,color:'#185FA5'}}>
                                  <div style={{display:'flex',alignItems:'center',gap:6}}>
                                    <div style={{width:Math.max(2,Math.round(v.orders/pcMax*40)),height:4,background:'#185FA5',borderRadius:2,opacity:0.5,flexShrink:0}}/>
                                    {pc}
                                  </div>
                                </td>
                                <td style={{padding:'6px 10px',textAlign:'right',fontWeight:600}}>{v.orders.toLocaleString('en-IN')}</td>
                                <td style={{padding:'6px 10px',textAlign:'right'}}>₹{v.aov.toLocaleString('en-IN')}</td>
                                <td style={{padding:'6px 10px',textAlign:'right',color:v.renewal>=50?'#1D9E75':v.renewal>=30?'#BA7517':'#E24B4A',fontWeight:500}}>{v.renewal}%</td>
                                <td style={{padding:'6px 10px',textAlign:'right'}}>{v.disc}%</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}



/* ══════════════════════════════════════
   PACK & PRODUCT TAB
   ══════════════════════════════════════ */

function PackProductTab({pp, chartsRef2}){
  useEffect(()=>{
    if(!pp) return;
    const go=()=>renderPackProductCharts(pp,chartsRef2);
    if(window.Chart) go();
    else{ const s=document.createElement('script'); s.src='https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js'; s.onload=go; document.head.appendChild(s); }
  },[pp]);

  if(!pp) return null;

  const PACK_COLORS={'1 month':'#534AB7','2 months':'#888780','3 months':'#185FA5','6 months':'#1D9E75','12 months':'#BA7517'};
  const PROD_COLORS={books:'#185FA5',workshop:'#1D9E75',workbook:'#BA7517',combo:'#D85A30',toys:'#534AB7'};
  const PACK_ORDER=['1 month','2 months','3 months','6 months','12 months'];
  const PROD_ORDER=['books','workshop','workbook','combo','toys'];
  const PROD_LABELS={books:'Books',workshop:'Workshops',workbook:'Workbooks',combo:'Toys+Books',toys:'Toys'};
  const SUB_ORDER=['standard','sibling','mini','gift','combo'];
  const SUB_LABELS={standard:'Standard',sibling:'Sibling plan',mini:'Mini pack',gift:'Gift',combo:'Toys+Books'};
  const SUB_COLORS={standard:'#185FA5',sibling:'#1D9E75',mini:'#888780',gift:'#534AB7',combo:'#D85A30'};

  const packs=PACK_ORDER.filter(k=>pp.byPack[k]);
  const prods=PROD_ORDER.filter(k=>pp.byProduct[k]);
  const subs=SUB_ORDER.filter(k=>pp.bySub[k]);

  function Leg({items}){
    return(
      <div style={{display:'flex',flexWrap:'wrap',gap:10,marginBottom:10,fontSize:12,color:'#555'}}>
        {items.map(({l,c})=>(<span key={l} style={{display:'flex',alignItems:'center',gap:5}}>
          <span style={{width:10,height:10,borderRadius:2,background:c,flexShrink:0}}/>{l}
        </span>))}
      </div>
    );
  }

  function StatCard({label,value,sub,color}){
    return(
      <div style={{background:'#fff',border:'0.5px solid #e5e5e3',borderRadius:10,padding:'14px 16px'}}>
        <div style={{fontSize:11,color:'#888',marginBottom:4}}>{label}</div>
        <div style={{fontSize:20,fontWeight:500,color:color||'#1a1a1a'}}>{value}</div>
        {sub&&<div style={{fontSize:11,color:'#aaa',marginTop:2}}>{sub}</div>}
      </div>
    );
  }

  // Best and worst performers
  const packsSorted=[...packs].sort((a,b)=>(pp.byPack[b]?.renewal||0)-(pp.byPack[a]?.renewal||0));
  const bestPackRenewal=packsSorted[0];
  const prodsSorted=[...prods].sort((a,b)=>(pp.byProduct[b]?.aov||0)-(pp.byProduct[a]?.aov||0));
  const bestProdAov=prodsSorted[0];

  return(
    <div>
      {/* ── KPI summary row ── */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:10,marginBottom:20}}>
        {packs.map(pk=>(
          <StatCard key={pk} label={pk}
            value={pp.byPack[pk]?.orders.toLocaleString('en-IN')||0}
            sub={`₹${(pp.byPack[pk]?.aov||0).toLocaleString('en-IN')} AOV · ${pp.byPack[pk]?.renewal||0}% renewal`}
            color={PACK_COLORS[pk]}
          />
        ))}
      </div>

      {/* ── Row 1: Pack charts ── */}
      <div style={{fontSize:11,fontWeight:500,color:'#aaa',textTransform:'uppercase',letterSpacing:'0.08em',margin:'0 0 12px',paddingBottom:6,borderBottom:'0.5px solid #e5e5e3'}}>Pack duration breakdown</div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:14,marginBottom:16}}>
        <div style={{background:'#fff',border:'0.5px solid #e5e5e3',borderRadius:12,padding:16}}>
          <div style={{fontSize:13,fontWeight:500,marginBottom:12}}>Orders by pack</div>
          <div style={{position:'relative',height:200}}><canvas id="pp-pack-orders"/></div>
        </div>
        <div style={{background:'#fff',border:'0.5px solid #e5e5e3',borderRadius:12,padding:16}}>
          <div style={{fontSize:13,fontWeight:500,marginBottom:12}}>AOV by pack</div>
          <div style={{position:'relative',height:200}}><canvas id="pp-pack-aov"/></div>
        </div>
        <div style={{background:'#fff',border:'0.5px solid #e5e5e3',borderRadius:12,padding:16}}>
          <div style={{fontSize:13,fontWeight:500,marginBottom:12}}>Renewal rate by pack</div>
          <div style={{position:'relative',height:200}}><canvas id="pp-pack-renewal"/></div>
        </div>
      </div>

      {/* ── Row 2: Product charts ── */}
      <div style={{fontSize:11,fontWeight:500,color:'#aaa',textTransform:'uppercase',letterSpacing:'0.08em',margin:'24px 0 12px',paddingBottom:6,borderBottom:'0.5px solid #e5e5e3'}}>Product type breakdown</div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:14,marginBottom:16}}>
        <div style={{background:'#fff',border:'0.5px solid #e5e5e3',borderRadius:12,padding:16}}>
          <div style={{fontSize:13,fontWeight:500,marginBottom:12}}>Orders by product</div>
          <div style={{position:'relative',height:200}}><canvas id="pp-prod-orders"/></div>
        </div>
        <div style={{background:'#fff',border:'0.5px solid #e5e5e3',borderRadius:12,padding:16}}>
          <div style={{fontSize:13,fontWeight:500,marginBottom:12}}>AOV by product</div>
          <div style={{position:'relative',height:200}}><canvas id="pp-prod-aov"/></div>
        </div>
        <div style={{background:'#fff',border:'0.5px solid #e5e5e3',borderRadius:12,padding:16}}>
          <div style={{fontSize:13,fontWeight:500,marginBottom:12}}>Renewal by product</div>
          <div style={{position:'relative',height:200}}><canvas id="pp-prod-renewal"/></div>
        </div>
      </div>

      {/* ── Row 3: Pack subtype ── */}
      <div style={{fontSize:11,fontWeight:500,color:'#aaa',textTransform:'uppercase',letterSpacing:'0.08em',margin:'24px 0 12px',paddingBottom:6,borderBottom:'0.5px solid #e5e5e3'}}>Subscription type breakdown</div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:14,marginBottom:16}}>
        <div style={{background:'#fff',border:'0.5px solid #e5e5e3',borderRadius:12,padding:16}}>
          <div style={{fontSize:13,fontWeight:500,marginBottom:12}}>Orders by subscription type</div>
          <div style={{position:'relative',height:200}}><canvas id="pp-sub-orders"/></div>
        </div>
        <div style={{background:'#fff',border:'0.5px solid #e5e5e3',borderRadius:12,padding:16}}>
          <div style={{fontSize:13,fontWeight:500,marginBottom:12}}>AOV by subscription type</div>
          <div style={{position:'relative',height:200}}><canvas id="pp-sub-aov"/></div>
        </div>
        <div style={{background:'#fff',border:'0.5px solid #e5e5e3',borderRadius:12,padding:16}}>
          <div style={{fontSize:13,fontWeight:500,marginBottom:12}}>Renewal by subscription type</div>
          <div style={{position:'relative',height:200}}><canvas id="pp-sub-renewal"/></div>
        </div>
      </div>

      {/* ── Cross-tab: Pack × Product ── */}
      <div style={{fontSize:11,fontWeight:500,color:'#aaa',textTransform:'uppercase',letterSpacing:'0.08em',margin:'24px 0 12px',paddingBottom:6,borderBottom:'0.5px solid #e5e5e3'}}>Pack × product cross-breakdown</div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:16}}>
        <div style={{background:'#fff',border:'0.5px solid #e5e5e3',borderRadius:12,padding:16}}>
          <div style={{fontSize:13,fontWeight:500,marginBottom:4}}>Orders — pack duration × product type</div>
          <div style={{fontSize:12,color:'#888',marginBottom:10}}>Stacked bars per pack, split by product</div>
          <Leg items={prods.map(p=>({l:PROD_LABELS[p],c:PROD_COLORS[p]}))}/>
          <div style={{position:'relative',height:220}}><canvas id="pp-cross-orders"/></div>
        </div>
        <div style={{background:'#fff',border:'0.5px solid #e5e5e3',borderRadius:12,padding:16}}>
          <div style={{fontSize:13,fontWeight:500,marginBottom:4}}>AOV — pack duration × product type</div>
          <div style={{fontSize:12,color:'#888',marginBottom:10}}>Grouped bars: AOV per product within each pack</div>
          <Leg items={prods.map(p=>({l:PROD_LABELS[p],c:PROD_COLORS[p]}))}/>
          <div style={{position:'relative',height:220}}><canvas id="pp-cross-aov"/></div>
        </div>
      </div>

      {/* ── Detailed breakdown table ── */}
      <div style={{fontSize:11,fontWeight:500,color:'#aaa',textTransform:'uppercase',letterSpacing:'0.08em',margin:'24px 0 12px',paddingBottom:6,borderBottom:'0.5px solid #e5e5e3'}}>Full pack × product table</div>
      <PackProductTable pp={pp} packs={packs} prods={prods} packColors={PACK_COLORS} prodColors={PROD_COLORS} prodLabels={PROD_LABELS}/>
    </div>
  );
}

function PackProductTable({pp,packs,prods,packColors,prodColors,prodLabels}){
  const [view,setView]=useState('orders'); // orders | aov | renewal
  const cols=['orders','aov','renewal'];
  const fmt=(v,t)=>t==='orders'?v.toLocaleString('en-IN'):t==='aov'?'₹'+v.toLocaleString('en-IN'):v+'%';
  const maxOrders=Math.max(...packs.map(pk=>pp.byPack[pk]?.orders||0),1);

  return(
    <div style={{background:'#fff',border:'0.5px solid #e5e5e3',borderRadius:12,padding:18}}>
      <div style={{display:'flex',gap:6,marginBottom:14}}>
        {[['orders','Orders'],['aov','AOV'],['renewal','Renewal']].map(([k,l])=>(
          <button key={k} onClick={()=>setView(k)} style={{fontSize:12,padding:'4px 12px',borderRadius:20,border:'0.5px solid',borderColor:view===k?'#185FA5':'#ccc',background:view===k?'#185FA5':'#fff',color:view===k?'#fff':'#555',cursor:'pointer'}}>{l}</button>
        ))}
      </div>
      <div style={{overflowX:'auto'}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
          <thead>
            <tr style={{borderBottom:'0.5px solid #e5e5e3'}}>
              <th style={{padding:'6px 12px',textAlign:'left',color:'#888',fontWeight:400,fontSize:11}}>Pack</th>
              <th style={{padding:'6px 12px',textAlign:'right',color:'#888',fontWeight:400,fontSize:11}}>Total</th>
              {prods.map(p=>(
                <th key={p} style={{padding:'6px 12px',textAlign:'right',fontSize:11,fontWeight:500,color:prodColors[p]}}>{prodLabels[p]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {packs.map((pk,i)=>{
              const total=pp.byPack[pk];
              return(
                <tr key={pk} style={{borderBottom:'0.5px solid #f0f0ee',background:i%2===0?'#fff':'#fafaf8'}}>
                  <td style={{padding:'9px 12px'}}>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <div style={{width:Math.max(3,Math.round((total?.orders||0)/maxOrders*50)),height:6,background:packColors[pk],borderRadius:3,flexShrink:0}}/>
                      <span style={{fontWeight:500,color:packColors[pk]}}>{pk}</span>
                    </div>
                  </td>
                  <td style={{padding:'9px 12px',textAlign:'right',fontWeight:600}}>{fmt(total?.[view]||0,view)}</td>
                  {prods.map(p=>{
                    const cell=pp.cross[pk]?.[p];
                    return(
                      <td key={p} style={{padding:'9px 12px',textAlign:'right',color:cell?'#1a1a1a':'#ccc'}}>
                        {cell?fmt(cell[view]||0,view):'—'}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {/* Totals row */}
            <tr style={{borderTop:'1px solid #e5e5e3',background:'#f5f5f3',fontWeight:600}}>
              <td style={{padding:'9px 12px',fontSize:11,color:'#888'}}>ALL PACKS</td>
              <td style={{padding:'9px 12px',textAlign:'right'}}>{fmt(pp.overall[view]||0,view)}</td>
              {prods.map(p=>(
                <td key={p} style={{padding:'9px 12px',textAlign:'right'}}>
                  {fmt(pp.byProduct[p]?.[view]||0,view)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function renderPackProductCharts(pp, cRef){
  const Ch=window.Chart; if(!Ch) return;
  const tC='rgba(0,0,0,0.42)',gC='rgba(0,0,0,0.06)';

  const PACK_ORDER=['1 month','2 months','3 months','6 months','12 months'];
  const PROD_ORDER=['books','workshop','workbook','combo','toys'];
  const PROD_LABELS={books:'Books',workshop:'Workshops',workbook:'Workbooks',combo:'Toys+Books',toys:'Toys'};
  const PACK_COLORS={'1 month':'#534AB7','2 months':'#888780','3 months':'#185FA5','6 months':'#1D9E75','12 months':'#BA7517'};
  const PROD_COLORS={books:'#185FA5',workshop:'#1D9E75',workbook:'#BA7517',combo:'#D85A30',toys:'#534AB7'};
  const SUB_ORDER=['standard','sibling','mini','gift','combo'];
  const SUB_LABELS={standard:'Standard',sibling:'Sibling plan',mini:'Mini pack',gift:'Gift',combo:'Toys+Books'};
  const SUB_COLORS={standard:'#185FA5',sibling:'#1D9E75',mini:'#888780',gift:'#534AB7',combo:'#D85A30'};

  const packs=PACK_ORDER.filter(k=>pp.byPack[k]);
  const prods=PROD_ORDER.filter(k=>pp.byProduct[k]);
  const subs=SUB_ORDER.filter(k=>pp.bySub[k]);

  function kill(id){if(cRef.current[id]){cRef.current[id].destroy();delete cRef.current[id];}}
  function mkBar(id,labels,datasets,opts={}){
    kill(id); const c=document.getElementById(id); if(!c) return;
    cRef.current[id]=new Ch(c,{type:'bar',data:{labels,datasets},options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},...(opts.plugins||{})},
      scales:{
        x:{ticks:{color:tC,font:{size:11},autoSkip:false},grid:{color:gC},...(opts.xScale||{})},
        y:{ticks:{color:tC,font:{size:11},...(opts.yTick||{})},grid:{color:gC},...(opts.yScale||{})}
      },
      ...opts
    }});
  }

  // Pack — orders
  mkBar('pp-pack-orders',packs,
    [{data:packs.map(k=>pp.byPack[k]?.orders||0),backgroundColor:packs.map(k=>PACK_COLORS[k]),borderRadius:5,borderSkipped:false}],
    {plugins:{tooltip:{callbacks:{label:v=>v.raw.toLocaleString('en-IN')+' orders'}}}}
  );
  // Pack — AOV
  mkBar('pp-pack-aov',packs,
    [{data:packs.map(k=>pp.byPack[k]?.aov||0),backgroundColor:packs.map(k=>PACK_COLORS[k]),borderRadius:5,borderSkipped:false}],
    {yTick:{callback:v=>'₹'+v.toLocaleString('en-IN')},plugins:{tooltip:{callbacks:{label:v=>'₹'+v.raw.toLocaleString('en-IN')}}}}
  );
  // Pack — renewal
  mkBar('pp-pack-renewal',packs,
    [{data:packs.map(k=>pp.byPack[k]?.renewal||0),backgroundColor:packs.map(k=>PACK_COLORS[k]),borderRadius:5,borderSkipped:false}],
    {yTick:{callback:v=>v+'%'},yScale:{max:100},plugins:{tooltip:{callbacks:{label:v=>v.raw+'%'}}}}
  );

  // Product — orders
  mkBar('pp-prod-orders',prods.map(k=>PROD_LABELS[k]),
    [{data:prods.map(k=>pp.byProduct[k]?.orders||0),backgroundColor:prods.map(k=>PROD_COLORS[k]),borderRadius:5,borderSkipped:false}],
    {plugins:{tooltip:{callbacks:{label:v=>v.raw.toLocaleString('en-IN')+' orders'}}}}
  );
  // Product — AOV
  mkBar('pp-prod-aov',prods.map(k=>PROD_LABELS[k]),
    [{data:prods.map(k=>pp.byProduct[k]?.aov||0),backgroundColor:prods.map(k=>PROD_COLORS[k]),borderRadius:5,borderSkipped:false}],
    {yTick:{callback:v=>'₹'+v.toLocaleString('en-IN')},plugins:{tooltip:{callbacks:{label:v=>'₹'+v.raw.toLocaleString('en-IN')}}}}
  );
  // Product — renewal
  mkBar('pp-prod-renewal',prods.map(k=>PROD_LABELS[k]),
    [{data:prods.map(k=>pp.byProduct[k]?.renewal||0),backgroundColor:prods.map(k=>PROD_COLORS[k]),borderRadius:5,borderSkipped:false}],
    {yTick:{callback:v=>v+'%'},yScale:{max:100},plugins:{tooltip:{callbacks:{label:v=>v.raw+'%'}}}}
  );

  // Sub type — orders
  mkBar('pp-sub-orders',subs.map(k=>SUB_LABELS[k]),
    [{data:subs.map(k=>pp.bySub[k]?.orders||0),backgroundColor:subs.map(k=>SUB_COLORS[k]),borderRadius:5,borderSkipped:false}],
    {plugins:{tooltip:{callbacks:{label:v=>v.raw.toLocaleString('en-IN')+' orders'}}}}
  );
  // Sub type — AOV
  mkBar('pp-sub-aov',subs.map(k=>SUB_LABELS[k]),
    [{data:subs.map(k=>pp.bySub[k]?.aov||0),backgroundColor:subs.map(k=>SUB_COLORS[k]),borderRadius:5,borderSkipped:false}],
    {yTick:{callback:v=>'₹'+v.toLocaleString('en-IN')},plugins:{tooltip:{callbacks:{label:v=>'₹'+v.raw.toLocaleString('en-IN')}}}}
  );
  // Sub type — renewal
  mkBar('pp-sub-renewal',subs.map(k=>SUB_LABELS[k]),
    [{data:subs.map(k=>pp.bySub[k]?.renewal||0),backgroundColor:subs.map(k=>SUB_COLORS[k]),borderRadius:5,borderSkipped:false}],
    {yTick:{callback:v=>v+'%'},yScale:{max:100},plugins:{tooltip:{callbacks:{label:v=>v.raw+'%'}}}}
  );

  // Cross: orders stacked (pack × product)
  kill('pp-cross-orders');
  const cco=document.getElementById('pp-cross-orders');
  if(cco) cRef.current['pp-cross-orders']=new Ch(cco,{
    type:'bar',
    data:{
      labels:packs,
      datasets:prods.map(p=>({
        label:PROD_LABELS[p],
        data:packs.map(pk=>pp.cross[pk]?.[p]?.orders||0),
        backgroundColor:PROD_COLORS[p],
        borderRadius:0,borderSkipped:false,stack:'s'
      }))
    },
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{mode:'index',callbacks:{label:v=>v.dataset.label+': '+v.raw.toLocaleString('en-IN')}}},
      scales:{x:{stacked:true,ticks:{color:tC,font:{size:11}}},y:{stacked:true,ticks:{color:tC,font:{size:11}}}}}
  });

  // Cross: AOV grouped (pack × product)
  kill('pp-cross-aov');
  const cca=document.getElementById('pp-cross-aov');
  if(cca) cRef.current['pp-cross-aov']=new Ch(cca,{
    type:'bar',
    data:{
      labels:packs,
      datasets:prods.map(p=>({
        label:PROD_LABELS[p],
        data:packs.map(pk=>pp.cross[pk]?.[p]?.aov||0),
        backgroundColor:PROD_COLORS[p],
        borderRadius:4,borderSkipped:false
      }))
    },
    options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{mode:'index',callbacks:{label:v=>v.dataset.label+': ₹'+v.raw.toLocaleString('en-IN')}}},
      scales:{x:{ticks:{color:tC,font:{size:11}}},y:{ticks:{color:tC,font:{size:11},callback:v=>'₹'+v.toLocaleString('en-IN')}}}}
  });
}


/* ── UI helpers ── */
function MCard({label,value,sub}){return(<div style={{background:'#fff',border:'0.5px solid #e5e5e3',borderRadius:10,padding:'14px 16px'}}><div style={{fontSize:11,color:'#888',marginBottom:4}}>{label}</div><div style={{fontSize:22,fontWeight:500}}>{value}</div>{sub&&<div style={{fontSize:11,color:'#aaa',marginTop:2}}>{sub}</div>}</div>);}
function Leg({items}){return(<div style={{display:'flex',flexWrap:'wrap',gap:12,marginBottom:10,fontSize:12,color:'#555'}}>{items.map(({l,c})=>(<span key={l} style={{display:'flex',alignItems:'center',gap:5}}><span style={{width:10,height:10,borderRadius:2,background:c,flexShrink:0}}/>{l}</span>))}</div>);}
function CCard({title,sub,children,half}){return(<div style={{background:'#fff',border:'0.5px solid #e5e5e3',borderRadius:12,padding:18,marginBottom:half?0:16}}><div style={{fontSize:14,fontWeight:500,marginBottom:3}}>{title}</div>{sub&&<div style={{fontSize:12,color:'#888',marginBottom:14}}>{sub}</div>}{children}</div>);}
function ST({children}){return<div style={{fontSize:11,fontWeight:500,color:'#aaa',textTransform:'uppercase',letterSpacing:'0.08em',margin:'24px 0 12px',paddingBottom:6,borderBottom:'0.5px solid #e5e5e3'}}>{children}</div>;}

/* ── Main page ── */
export default function Dashboard(){
  const[url,setUrl]=useState('https://docs.google.com/spreadsheets/d/1R3YTJLE-J3D_GMNjRC4GGdqNssmopDZ0TO4YuCPi5ww/edit?usp=sharing'),[oSheet,setOSheet]=useState('orders'),[pSheet,setPSheet]=useState('india post pincode');
  const[drillState,setDrillState]=useState(null),[drillDistricts,setDrillDistricts]=useState(null);
  const[status,setStatus]=useState({msg:'',type:''}),[appData,setAppData]=useState(null);
  const[filter,setFilter]=useState('all'),[tab,setTab]=useState('charts'),[mapMet,setMapMet]=useState('orders');
  const[dateFrom,setDateFrom]=useState(''),[dateTo,setDateTo]=useState(''),[showCustom,setShowCustom]=useState(false);
  const cRef=useRef({}),chartsRef2=useRef({});

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
    if(filter==='custom'){
      const from=dateFrom?new Date(dateFrom):null;
      const to=dateTo?new Date(dateTo+'T23:59:59'):null;
      return appData.orders.filter(r=>{
        const x=new Date(col(r,'Created At','created_at'));
        if(isNaN(x))return false;
        if(from&&x<from)return false;
        if(to&&x>to)return false;
        return true;
      });
    }
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
    // District-level aggregation: group pincodes by district name per state
    // districtData[stateName][districtName] = {orders, aov, renewal, disc, lat, lng (centroid), pincodeCount}
    const distRaw={}; // state → district → {orders,rev,renC,discC,lats,lngs,pincodes}
    const pcRaw={};   // state → district → pincode → {orders,rev,renC,discC}
    rows.forEach(r=>{
      const pc=col(r,'Shipping Pincode','shipping_pincode').toString().trim();
      const pm=appData?.pm[pc];
      if(!pm||!pm.state)return;
      const st=pm.state, di=pm.city||'Unknown';
      if(!distRaw[st])distRaw[st]={};
      if(!distRaw[st][di])distRaw[st][di]={orders:0,rev:0,renC:0,discC:0,lats:[],lngs:[],pincodes:new Set()};
      const d=distRaw[st][di];
      d.orders++;
      d.rev+=parseFloat(col(r,'Total Price','total_price').replace(/[^0-9.]/g,''))||0;
      const ct=getCT(r);if(ct==='renewal')d.renC++;
      if((col(r,'Discount Code','discount_code')||'').trim())d.discC++;
      if(pm.lat&&pm.lng){d.lats.push(pm.lat);d.lngs.push(pm.lng);}
      d.pincodes.add(pc);
      // pincode-level tracking
      if(!pcRaw[st])pcRaw[st]={};
      if(!pcRaw[st][di])pcRaw[st][di]={};
      if(!pcRaw[st][di][pc])pcRaw[st][di][pc]={orders:0,rev:0,renC:0,discC:0};
      const p=pcRaw[st][di][pc];
      p.orders++;
      p.rev+=parseFloat(col(r,'Total Price','total_price').replace(/[^0-9.]/g,''))||0;
      const ct2=getCT(r);if(ct2==='renewal')p.renC++;
      if((col(r,'Discount Code','discount_code')||'').trim())p.discC++;
    });
    // Finalise pincodeRaw
    const pincodeRaw={};
    Object.keys(pcRaw).forEach(st=>{
      pincodeRaw[st]={};
      Object.keys(pcRaw[st]).forEach(di=>{
        pincodeRaw[st][di]={};
        Object.keys(pcRaw[st][di]).forEach(pc=>{
          const p=pcRaw[st][di][pc];
          pincodeRaw[st][di][pc]={
            orders:p.orders,
            aov:p.orders?Math.round(p.rev/p.orders):0,
            renewal:p.orders?Math.round(p.renC/p.orders*100):0,
            disc:p.orders?Math.round(p.discC/p.orders*100):0,
          };
        });
      });
    });
    const districtData={};
    Object.keys(distRaw).forEach(st=>{
      districtData[st]={};
      Object.keys(distRaw[st]).forEach(di=>{
        const d=distRaw[st][di];
        const lat=d.lats.length?d.lats.reduce((a,b)=>a+b,0)/d.lats.length:null;
        const lng=d.lngs.length?d.lngs.reduce((a,b)=>a+b,0)/d.lngs.length:null;
        districtData[st][di]={
          orders:d.orders,
          aov:d.orders?Math.round(d.rev/d.orders):0,
          renewal:d.orders?Math.round(d.renC/d.orders*100):0,
          disc:d.orders?Math.round(d.discC/d.orders*100):0,
          lat,lng,
          pincodeCount:d.pincodes.size,
        };
      });
    });
    // ── Pack & Product cross-tabulation ──
    const ppBP={},ppBProd={},ppBSub={},ppCross={};
    // accumulators helper
    function ppAcc(map,key,rv,isRen){
      if(!map[key])map[key]={orders:0,rev:0,renC:0};
      map[key].orders++; map[key].rev+=rv; if(isRen)map[key].renC++;
    }
    rows.forEach(r=>{
      const rv=parseFloat(col(r,'Total Price','total_price').replace(/[^0-9.]/g,''))||0;
      const isRen=getCT(r)==='renewal';
      const{pt,pd,ps}=parseLI(col(r,'Line Items','line_items'));
      const prodKey=pt==='toys'?'toys':pt; // books|workshop|workbook|combo|toys
      if(pd){ ppAcc(ppBP,pd,rv,isRen); }
      ppAcc(ppBProd,prodKey,rv,isRen);
      ppAcc(ppBSub,ps,rv,isRen);
      // cross: pack × product
      if(pd){
        if(!ppCross[pd])ppCross[pd]={};
        ppAcc(ppCross[pd],prodKey,rv,isRen);
      }
    });
    function finalise(map){
      const out={};
      Object.keys(map).forEach(k=>{
        const d=map[k];
        out[k]={orders:d.orders,aov:d.orders?Math.round(d.rev/d.orders):0,renewal:d.orders?Math.round(d.renC/d.orders*100):0};
      });
      return out;
    }
    const ppFinalCross={};
    Object.keys(ppCross).forEach(pk=>{ppFinalCross[pk]=finalise(ppCross[pk]);});
    const overallRen=rows.filter(r=>getCT(r)==='renewal').length;
    const overallRev=rows.reduce((s,r)=>s+(parseFloat(col(r,'Total Price','total_price').replace(/[^0-9.]/g,''))||0),0);
    const pp={
      byPack:finalise(ppBP),
      byProduct:finalise(ppBProd),
      bySub:finalise(ppBSub),
      cross:ppFinalCross,
      overall:{orders:rows.length,aov:rows.length?Math.round(overallRev/rows.length):0,renewal:rows.length?Math.round(overallRen/rows.length*100):0}
    };
    const t15=Object.entries(city).sort((a,b)=>b[1].orders-a[1].orders).slice(0,15);
    const tot=rows.length,totR=rows.reduce((s,r)=>s+(parseFloat(col(r,'Total Price','total_price').replace(/[^0-9.]/g,''))||0),0);
    const totRen=rows.filter(r=>getCT(r)==='renewal').length,totNew=rows.filter(r=>getCT(r)==='new').length;
    const totD=rows.filter(r=>(col(r,'Discount Code','discount_code')||'').trim()).length;
    return{t15,state,districtData,pincodeRaw,pp,tot,totR,totRen,totNew,totD,pDur,pSub,cities:Object.keys(city).length};
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
          <div style={{marginBottom:18}}>
            <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
              <span style={{fontSize:12,color:'#888'}}>Period:</span>
              {fBtns.map(({k,l})=>(<button key={k} onClick={()=>{setFilter(k);setShowCustom(false);}} style={{fontSize:12,padding:'5px 14px',borderRadius:20,border:'0.5px solid',borderColor:filter===k?'#185FA5':'#ccc',background:filter===k?'#185FA5':'#fff',color:filter===k?'#fff':'#555',cursor:'pointer'}}>{l}</button>))}
              <button onClick={()=>{setFilter('custom');setShowCustom(true);}} style={{fontSize:12,padding:'5px 14px',borderRadius:20,border:'0.5px solid',borderColor:filter==='custom'?'#185FA5':'#ccc',background:filter==='custom'?'#185FA5':'#fff',color:filter==='custom'?'#fff':'#555',cursor:'pointer'}}>Custom range</button>
            </div>
            {showCustom&&(
              <div style={{marginTop:10,display:'flex',gap:10,alignItems:'center',flexWrap:'wrap',background:'#f7f9ff',border:'0.5px solid #dde8f7',borderRadius:10,padding:'12px 16px'}}>
                <span style={{fontSize:12,color:'#888'}}>From:</span>
                <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)}
                  style={{height:34,border:'0.5px solid #ccc',borderRadius:7,padding:'0 10px',fontSize:13,background:'#fff',outline:'none',cursor:'pointer'}}/>
                <span style={{fontSize:12,color:'#888'}}>To:</span>
                <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)}
                  style={{height:34,border:'0.5px solid #ccc',borderRadius:7,padding:'0 10px',fontSize:13,background:'#fff',outline:'none',cursor:'pointer'}}/>
                {(dateFrom||dateTo)&&(
                  <span style={{fontSize:11,color:'#888',background:'#fff',border:'0.5px solid #ddd',borderRadius:6,padding:'4px 10px'}}>
                    {dateFrom||'start'} → {dateTo||'today'}
                  </span>
                )}
                <button onClick={()=>{setDateFrom('');setDateTo('');}} style={{fontSize:11,padding:'4px 10px',borderRadius:6,border:'0.5px solid #ccc',background:'#fff',color:'#888',cursor:'pointer'}}>Clear</button>
              </div>
            )}
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
              {[['charts','Charts'],['map','India heatmap'],['packproduct','Pack & Product']].map(([k,l])=>(
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
                <CCard title={`India heatmap — ${mmL[mapMet]} by state`} sub="Click a state → district view with borders · Drag to pan · Scroll to zoom">
                  <IndiaHeatmap stateData={m.state} districtData={m.districtData} metric={mapMet} onDistrictData={(st,dists)=>{setDrillState(st);setDrillDistricts(dists);}}/>
                <DistrictBreakdown stateName={drillState} districts={drillDistricts} metric={mapMet} pincodeRaw={m?.pincodeRaw}/>
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

            {tab==='packproduct'&&(
              <PackProductTab pp={m.pp} chartsRef2={chartsRef2}/>
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
