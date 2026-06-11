import { useState, useEffect, useRef, useCallback } from 'react';
import Head from 'next/head';

const C = { blue:'#185FA5', green:'#1D9E75', amber:'#BA7517', red:'#E24B4A', purple:'#534AB7', coral:'#D85A30', gray:'#888780' };

/* ── CSV helpers ── */
function extractId(url) { const m=url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/); return m?m[1]:null; }
function parseCSV(text) {
  const lines=text.split('\n'), headers=splitLine(lines[0]).map(h=>h.replace(/^"|"$/g,'').trim()), rows=[];
  for (let i=1;i<lines.length;i++) { if(!lines[i].trim()) continue; const vals=splitLine(lines[i]),row={}; headers.forEach((h,j)=>row[h]=(vals[j]||'').replace(/^"|"$/g,'').trim()); rows.push(row); }
  return rows;
}
function splitLine(line) { const out=[]; let cur='',inQ=false; for(let i=0;i<line.length;i++){const c=line[i];if(c==='"')inQ=!inQ;else if(c===','&&!inQ){out.push(cur);cur='';}else cur+=c;} out.push(cur); return out; }
function col(row,...keys) { for(const k of keys) if(row[k]!==undefined&&row[k]!=='') return row[k]; return ''; }
function getCustomerType(row) { const ct=col(row,'Customer Type','customer_type').toLowerCase(); if(ct.includes('renew'))return'renewal'; if(ct.includes('new'))return'new'; return'other'; }
function parseLineItems(raw) {
  const li=(raw||'').toLowerCase();
  if(li.includes('workshop')) return {productType:'workshop',packDuration:null,packSubtype:'workshop'};
  if(li.includes('workbook')) return {productType:'workbook',packDuration:null,packSubtype:'workbook'};
  let productType='books';
  if(li.includes('toy library')) productType='toys';
  else if(li.includes('toys + books')||li.includes('toys+books')) productType='combo';
  let packDuration=null;
  if(li.includes('12 month')) packDuration='12 months';
  else if(li.includes('6 month')) packDuration='6 months';
  else if(li.includes('3 month')) packDuration='3 months';
  else if(li.includes('2 month')) packDuration='2 months';
  let packSubtype='standard';
  if(li.includes('sibling')) packSubtype='sibling';
  else if(li.includes('mini pack')) packSubtype='mini';
  else if(li.includes('gift sub')) packSubtype='gift';
  else if(li.includes('toys + books')||li.includes('combo')) packSubtype='combo';
  return {productType,packDuration,packSubtype};
}

/* ── State name normalizer → matches GeoJSON NAME_1 exactly ── */
const STATE_MAP = {
  'andhra pradesh':'Andhra Pradesh','arunachal pradesh':'Arunachal Pradesh','assam':'Assam',
  'bihar':'Bihar','chhattisgarh':'Chhattisgarh','goa':'Goa','gujarat':'Gujarat',
  'haryana':'Haryana','himachal pradesh':'Himachal Pradesh','jharkhand':'Jharkhand',
  'karnataka':'Karnataka','kerala':'Kerala','madhya pradesh':'Madhya Pradesh',
  'maharashtra':'Maharashtra','manipur':'Manipur','meghalaya':'Meghalaya',
  'mizoram':'Mizoram','nagaland':'Nagaland','odisha':'Odisha','orissa':'Orissa',
  'punjab':'Punjab','rajasthan':'Rajasthan','sikkim':'Sikkim','tamil nadu':'Tamil Nadu',
  'tamilnadu':'Tamil Nadu','telangana':'Andhra Pradesh', // telangana was carved from AP in 2014; GeoJSON may not have it
  'tripura':'Tripura','uttar pradesh':'Uttar Pradesh','uttarakhand':'Uttaranchal',
  'uttaranchal':'Uttaranchal','west bengal':'West Bengal',
  'jammu and kashmir':'Jammu and Kashmir','jammu & kashmir':'Jammu and Kashmir',
  'j & k':'Jammu and Kashmir','j&k':'Jammu and Kashmir',
  'delhi':'Delhi','new delhi':'Delhi','nct of delhi':'Delhi','nct':'Delhi',
  'chandigarh':'Chandigarh','puducherry':'Puducherry','pondicherry':'Puducherry',
  'andaman and nicobar':'Andaman and Nicobar','andaman & nicobar':'Andaman and Nicobar',
  'lakshadweep':'Lakshadweep','dadra and nagar haveli':'Dadra and Nagar Haveli',
  'daman and diu':'Daman and Diu',
};
function normalizeState(s) {
  if (!s) return null;
  const key = s.toLowerCase().trim();
  return STATE_MAP[key] || null;
}

/* ── India Heatmap component ── */
function IndiaHeatmap({ stateData, metric }) {
  const containerRef = useRef(null);
  const geoRef = useRef(null);

  const draw = useCallback(() => {
    const d3 = window.d3;
    const container = containerRef.current;
    const geo = geoRef.current;
    if (!d3 || !container || !geo || !stateData) return;

    // Clear previous
    container.innerHTML = '';

    const W = 660, H = 560;

    const svg = d3.select(container)
      .append('svg')
      .attr('viewBox', `0 0 ${W} ${H}`)
      .attr('width', '100%')
      .attr('height', H)
      .style('display', 'block');

    // Fixed projection centred on India — avoids fitSize timing issues
    const projection = d3.geoMercator()
      .center([82.5, 22])
      .scale(1050)
      .translate([W / 2, H / 2]);

    const path = d3.geoPath(projection);

    const vals = Object.values(stateData).map(d => d[metric] || 0).filter(v => v > 0);
    const maxVal = Math.max(...vals, 1);
    const colorScale = d3.scaleSequential([0, maxVal], d3.interpolateBlues);

    // Tooltip div (sits outside SVG, inside the relative wrapper)
    const tooltip = d3.select(container.parentNode)
      .selectAll('.map-tt')
      .data([1])
      .join('div')
      .attr('class', 'map-tt')
      .style('position','absolute')
      .style('background','#fff')
      .style('border','0.5px solid #ddd')
      .style('border-radius','8px')
      .style('padding','8px 12px')
      .style('font-size','12px')
      .style('line-height','1.6')
      .style('pointer-events','none')
      .style('opacity','0')
      .style('transition','opacity 0.1s')
      .style('white-space','nowrap')
      .style('z-index','20')
      .style('box-shadow','0 2px 8px rgba(0,0,0,0.08)');

    // Draw states
    svg.selectAll('path')
      .data(geo.features)
      .join('path')
      .attr('d', path)
      .attr('fill', d => {
        const name = d.properties.NAME_1;
        const v = stateData[name]?.[metric] || 0;
        return v > 0 ? colorScale(v) : '#eeecea';
      })
      .attr('stroke', '#fff')
      .attr('stroke-width', 0.6)
      .style('cursor', 'pointer')
      .on('mouseover', function(event, d) {
        const name = d.properties.NAME_1;
        const sd = stateData[name];
        d3.select(this).attr('stroke','#185FA5').attr('stroke-width', 1.5);
        const metFmt = !sd ? '—' :
          metric === 'aov' ? '₹' + Math.round(sd.aov).toLocaleString('en-IN') :
          metric === 'renewal' ? Math.round(sd.renewal) + '%' :
          metric === 'disc' ? Math.round(sd.disc) + '%' :
          sd.orders.toLocaleString('en-IN') + ' orders';
        const label = metric==='aov'?'AOV':metric==='renewal'?'Renewal':metric==='disc'?'Discount':'Orders';
        tooltip
          .style('opacity','1')
          .html(`<strong>${name}</strong><br/>${label}: ${metFmt}${sd ? `<br/><span style="color:#888;font-size:11px">${sd.orders.toLocaleString('en-IN')} orders</span>` : ''}`);
      })
      .on('mousemove', function(event) {
        const rect = container.parentNode.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        tooltip.style('left', (x + 14) + 'px').style('top', (y - 36) + 'px');
      })
      .on('mouseout', function() {
        d3.select(this).attr('stroke','#fff').attr('stroke-width', 0.6);
        tooltip.style('opacity','0');
      });

    // State name labels on larger states only
    const labelStates = ['Maharashtra','Rajasthan','Madhya Pradesh','Uttar Pradesh','Karnataka','Gujarat','Andhra Pradesh','Tamil Nadu','Orissa','West Bengal','Bihar','Jharkhand'];
    svg.selectAll('text.state-label')
      .data(geo.features.filter(f => labelStates.includes(f.properties.NAME_1)))
      .join('text')
      .attr('class','state-label')
      .attr('transform', d => { const c=path.centroid(d); return `translate(${c[0]},${c[1]})`; })
      .attr('text-anchor','middle')
      .attr('dominant-baseline','middle')
      .attr('font-size', 9)
      .attr('fill', d => {
        const v = stateData[d.properties.NAME_1]?.[metric] || 0;
        return v > maxVal * 0.55 ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.45)';
      })
      .attr('pointer-events','none')
      .text(d => {
        const v = stateData[d.properties.NAME_1]?.[metric] || 0;
        if (!v) return '';
        if (metric === 'aov') return '₹' + (v >= 1000 ? Math.round(v/1000) + 'k' : Math.round(v));
        if (metric === 'renewal' || metric === 'disc') return Math.round(v) + '%';
        return v >= 1000 ? (v/1000).toFixed(1) + 'k' : v;
      });

    // Gradient legend
    const lW = 120, lH = 8, lX = W - lW - 16, lY = H - 28;
    const defs = svg.append('defs');
    const grad = defs.append('linearGradient').attr('id','heatGrad').attr('x1','0%').attr('x2','100%');
    [0,0.25,0.5,0.75,1].forEach(t => {
      grad.append('stop').attr('offset', t*100+'%').attr('stop-color', colorScale(maxVal * t));
    });
    svg.append('rect').attr('x',lX).attr('y',lY).attr('width',lW).attr('height',lH).attr('rx',3).attr('fill','url(#heatGrad)');
    svg.append('text').attr('x',lX).attr('y',lY+18).attr('font-size',9).attr('fill','#999').text('0');
    const maxLabel = metric==='aov' ? '₹'+Math.round(maxVal/1000)+'k' : metric==='renewal'||metric==='disc' ? Math.round(maxVal)+'%' : maxVal>=1000?(maxVal/1000).toFixed(1)+'k':maxVal;
    svg.append('text').attr('x',lX+lW).attr('y',lY+18).attr('font-size',9).attr('fill','#999').attr('text-anchor','end').text(maxLabel);

  }, [stateData, metric]);

  // Load GeoJSON once, then draw
  useEffect(() => {
    if (geoRef.current) { waitForD3(draw); return; }
    fetch('/india.json')
      .then(r => r.json())
      .then(geo => { geoRef.current = geo; waitForD3(draw); })
      .catch(e => console.error('GeoJSON load failed', e));
  }, [draw]);

  return (
    <div ref={containerRef} style={{ position:'relative', minHeight:560, background:'#f9f9f8', borderRadius:8 }} />
  );
}

function waitForD3(cb, tries=0) {
  if (window.d3 && window.d3.geoMercator) { cb(); return; }
  if (tries > 40) { console.error('D3 never loaded'); return; }
  setTimeout(() => waitForD3(cb, tries+1), 150);
}

/* ── UI helpers ── */
function MetricCard({label,value,sub}) {
  return (
    <div style={{background:'#fff',border:'0.5px solid #e5e5e3',borderRadius:10,padding:'14px 16px'}}>
      <div style={{fontSize:11,color:'#888',marginBottom:4}}>{label}</div>
      <div style={{fontSize:22,fontWeight:500}}>{value}</div>
      {sub && <div style={{fontSize:11,color:'#aaa',marginTop:2}}>{sub}</div>}
    </div>
  );
}
function Legend({items}) {
  return (
    <div style={{display:'flex',flexWrap:'wrap',gap:12,marginBottom:10,fontSize:12,color:'#555'}}>
      {items.map(({label,color})=>(
        <span key={label} style={{display:'flex',alignItems:'center',gap:5}}>
          <span style={{width:10,height:10,borderRadius:2,background:color,flexShrink:0}}/>
          {label}
        </span>
      ))}
    </div>
  );
}
function ChartCard({title,sub,children,half}) {
  return (
    <div style={{background:'#fff',border:'0.5px solid #e5e5e3',borderRadius:12,padding:18,marginBottom:half?0:16}}>
      <div style={{fontSize:14,fontWeight:500,marginBottom:3}}>{title}</div>
      {sub && <div style={{fontSize:12,color:'#888',marginBottom:14}}>{sub}</div>}
      {children}
    </div>
  );
}
function SecTitle({children}) {
  return <div style={{fontSize:11,fontWeight:500,color:'#aaa',textTransform:'uppercase',letterSpacing:'0.08em',margin:'24px 0 12px',paddingBottom:6,borderBottom:'0.5px solid #e5e5e3'}}>{children}</div>;
}

/* ── Main page ── */
export default function Dashboard() {
  const [sheetUrl,setSheetUrl]=useState('');
  const [ordersSheet,setOrdersSheet]=useState('Sheet1');
  const [pincodeSheet,setPincodeSheet]=useState('Sheet2');
  const [status,setStatus]=useState({msg:'',type:''});
  const [appData,setAppData]=useState(null);
  const [filter,setFilter]=useState('all');
  const [tab,setTab]=useState('charts');
  const [mapMetric,setMapMetric]=useState('orders');
  const chartsRef=useRef({});

  // Load D3 once on mount
  useEffect(()=>{
    if (typeof window==='undefined') return;
    if (window.d3) return;
    const s=document.createElement('script');
    s.src='https://cdnjs.cloudflare.com/ajax/libs/d3/7.8.5/d3.min.js';
    document.head.appendChild(s);
  },[]);

  async function loadData() {
    const id=extractId(sheetUrl.trim());
    if (!id){setStatus({msg:'Could not find a sheet ID in that URL.',type:'err'});return;}
    setStatus({msg:'Connecting to Google Sheets…',type:'loading'});
    try {
      const [oRes,pRes]=await Promise.all([
        fetch(`/api/sheet?id=${id}&sheet=${encodeURIComponent(ordersSheet)}`),
        fetch(`/api/sheet?id=${id}&sheet=${encodeURIComponent(pincodeSheet)}`)
      ]);
      if (!oRes.ok||!pRes.ok) throw new Error('Sheet not accessible. Make sure it is shared as "Anyone with the link → Viewer".');
      const [oText,pText]=await Promise.all([oRes.text(),pRes.text()]);
      const orders=parseCSV(oText), pincodes=parseCSV(pText);
      const pincodeMap={};
      pincodes.forEach(r=>{
        const pc=col(r,'pincode','Pincode').toString().trim();
        if (pc) pincodeMap[pc]={
          city:col(r,'district','District','officename')||'Unknown',
          state:normalizeState(col(r,'statename','Statename','state'))
        };
      });
      setStatus({msg:`Loaded ${orders.length.toLocaleString('en-IN')} orders + ${pincodes.length.toLocaleString('en-IN')} pincode records.`,type:'ok'});
      setAppData({orders,pincodeMap});
    } catch(e){setStatus({msg:e.message,type:'err'});}
  }

  function getCity(row){const pc=col(row,'Shipping Pincode','shipping_pincode').toString().trim();if(appData?.pincodeMap[pc])return appData.pincodeMap[pc].city;return col(row,'Shipping City','shipping_city')||'Unknown';}
  function getState(row){const pc=col(row,'Shipping Pincode','shipping_pincode').toString().trim();if(appData?.pincodeMap[pc]&&appData.pincodeMap[pc].state)return appData.pincodeMap[pc].state;return normalizeState(col(row,'Shipping State','shipping_state'))||'Unknown';}

  function getFilteredRows(){
    if (!appData) return [];
    if (filter==='all') return appData.orders;
    const days=parseInt(filter), cutoff=new Date(); cutoff.setDate(cutoff.getDate()-days);
    return appData.orders.filter(r=>{const d=new Date(col(r,'Created At','created_at'));return !isNaN(d)&&d>=cutoff;});
  }

  function computeMetrics(){
    const rows=getFilteredRows();
    if (!rows.length||!appData) return null;
    const cityData={},stateData={},packDurTotals={},packSubTotals={};
    rows.forEach(r=>{
      const city=getCity(r), state=getState(r);
      if (!cityData[city]) cityData[city]={orders:0,revenue:0,renewal:0,newU:0,other:0,disc:0,books:0,workshop:0,workbook:0,combo:0};
      if (!stateData[state]) stateData[state]={orders:0,revenue:0,renewalCount:0,discCount:0};
      const cd=cityData[city],sd=stateData[state];
      cd.orders++;sd.orders++;
      const rev=parseFloat(col(r,'Total Price','total_price').replace(/[^0-9.]/g,''))||0;
      cd.revenue+=rev;sd.revenue+=rev;
      const ct=getCustomerType(r);
      if(ct==='renewal'){cd.renewal++;sd.renewalCount++;}else if(ct==='new')cd.newU++;else cd.other++;
      if((col(r,'Discount Code','discount_code')||'').trim()){cd.disc++;sd.discCount++;}
      const li=parseLineItems(col(r,'Line Items','line_items'));
      const pt=li.productType==='toys'?'combo':li.productType;
      cd[pt in cd?pt:'books']++;
      if(li.packDuration)packDurTotals[li.packDuration]=(packDurTotals[li.packDuration]||0)+1;
      packSubTotals[li.packSubtype]=(packSubTotals[li.packSubtype]||0)+1;
    });
    // Derived state metrics
    Object.keys(stateData).forEach(s=>{
      const d=stateData[s];
      d.aov=d.orders?Math.round(d.revenue/d.orders):0;
      d.renewal=d.orders?Math.round(d.renewalCount/d.orders*100):0;
      d.disc=d.orders?Math.round(d.discCount/d.orders*100):0;
    });
    const top15=Object.entries(cityData).sort((a,b)=>b[1].orders-a[1].orders).slice(0,15);
    const total=rows.length;
    const totalRev=rows.reduce((s,r)=>s+(parseFloat(col(r,'Total Price','total_price').replace(/[^0-9.]/g,''))||0),0);
    const totalRen=rows.filter(r=>getCustomerType(r)==='renewal').length;
    const totalNew=rows.filter(r=>getCustomerType(r)==='new').length;
    const totalDisc=rows.filter(r=>(col(r,'Discount Code','discount_code')||'').trim()).length;
    return {top15,stateData,total,totalRev,totalRen,totalNew,totalDisc,packDurTotals,packSubTotals,cityCount:Object.keys(cityData).length};
  }

  const m=appData?computeMetrics():null;

  // Render Chart.js charts when tab=charts and data changes
  useEffect(()=>{
    if (!m||tab!=='charts') return;
    const render=()=>renderCharts(m,chartsRef);
    if (window.Chart) render();
    else {
      const s=document.createElement('script');
      s.src='https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js';
      s.onload=render;
      document.head.appendChild(s);
    }
  },[m,tab]);

  const filters=[{k:'all',l:'All time'},{k:'30',l:'Last 30 days'},{k:'90',l:'Last 90 days'},{k:'180',l:'Last 180 days'}];
  const statClr={ok:'#1D9E75',err:'#E24B4A',loading:'#888'};
  const packDurData=m?(()=>{const dO=['3 months','6 months','12 months','2 months'],dC=[C.blue,C.green,C.amber,C.gray];const l=dO.filter(k=>m.packDurTotals[k]),v=l.map(k=>m.packDurTotals[k]);return{labels:l,vals:v,colors:dC,total:v.reduce((a,b)=>a+b,0)};})():null;
  const packSubData=m?(()=>{const sO=['standard','sibling','combo','gift','mini'],sC=[C.blue,C.green,C.coral,C.purple,C.gray];const l=sO.filter(k=>m.packSubTotals[k]),v=l.map(k=>m.packSubTotals[k]);return{labels:l,vals:v,colors:sC,total:v.reduce((a,b)=>a+b,0)};})():null;

  // Top states sorted, excluding Unknown
  const topStates=m?Object.entries(m.stateData).filter(([s])=>s!=='Unknown').sort((a,b)=>b[1].orders-a[1].orders).slice(0,10):[];

  const mapMetricLabel={orders:'Order volume',aov:'AOV (₹)',renewal:'Renewal rate',disc:'Discount rate'};

  return (
    <>
      <Head>
        <title>neOwn — Location Dashboard</title>
        <meta name="viewport" content="width=device-width,initial-scale=1"/>
      </Head>
      <div style={{maxWidth:1100,margin:'0 auto',padding:'28px 20px',fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',color:'#1a1a1a',fontSize:14}}>

        <div style={{marginBottom:24}}>
          <h1 style={{fontSize:20,fontWeight:500,marginBottom:3}}>neOwn — location dashboard</h1>
          <p style={{fontSize:13,color:'#777'}}>Live data from your Google Sheets</p>
        </div>

        {/* Connect panel */}
        <div style={{background:'#fff',border:'0.5px solid #ddd',borderRadius:12,padding:22,marginBottom:22}}>
          <h2 style={{fontSize:15,fontWeight:500,marginBottom:14}}>Connect Google Sheets</h2>
          <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:10}}>
            <input value={sheetUrl} onChange={e=>setSheetUrl(e.target.value)} placeholder="Paste your Google Sheets URL…"
              style={{flex:1,minWidth:260,height:38,border:'0.5px solid #ccc',borderRadius:8,padding:'0 12px',fontSize:13,background:'#fafafa',outline:'none'}}/>
            <button onClick={loadData} style={{height:38,padding:'0 18px',border:'none',borderRadius:8,background:'#185FA5',color:'#fff',fontSize:13,cursor:'pointer',whiteSpace:'nowrap'}}>Load data</button>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
            {[['Orders sheet',ordersSheet,setOrdersSheet],['Pincode sheet',pincodeSheet,setPincodeSheet]].map(([label,val,setter])=>(
              <div key={label} style={{display:'flex',flexDirection:'column',gap:4}}>
                <label style={{fontSize:11,color:'#888',textTransform:'uppercase',letterSpacing:'0.05em'}}>{label}</label>
                <input value={val} onChange={e=>setter(e.target.value)} style={{height:34,border:'0.5px solid #ccc',borderRadius:8,padding:'0 10px',fontSize:13,background:'#fafafa',outline:'none'}}/>
              </div>
            ))}
          </div>
          <p style={{fontSize:12,color:'#888',lineHeight:1.7}}>Share → <strong>Anyone with the link → Viewer</strong> → Copy link → paste above.</p>
          {status.msg&&<div style={{fontSize:12,marginTop:10,color:statClr[status.type]||'#888'}}>{status.msg}</div>}
        </div>

        {/* Period filter */}
        {appData&&(
          <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center',marginBottom:18}}>
            <span style={{fontSize:12,color:'#888'}}>Period:</span>
            {filters.map(({k,l})=>(
              <button key={k} onClick={()=>setFilter(k)} style={{fontSize:12,padding:'5px 14px',borderRadius:20,border:'0.5px solid',borderColor:filter===k?'#185FA5':'#ccc',background:filter===k?'#185FA5':'#fff',color:filter===k?'#fff':'#555',cursor:'pointer'}}>{l}</button>
            ))}
          </div>
        )}

        {/* KPI cards */}
        {m&&(
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(148px,1fr))',gap:10,marginBottom:20}}>
            <MetricCard label="Total orders" value={m.total.toLocaleString('en-IN')} sub={`${m.cityCount} cities`}/>
            <MetricCard label="Overall AOV" value={'₹'+Math.round(m.totalRev/m.total).toLocaleString('en-IN')} sub="per order"/>
            <MetricCard label="Renewal rate" value={Math.round(m.totalRen/m.total*100)+'%'} sub="of total orders"/>
            <MetricCard label="Churn rate" value={Math.round((1-m.totalRen/m.total)*100)+'%'} sub="non-renewals"/>
            <MetricCard label="New subscribers" value={m.totalNew.toLocaleString('en-IN')} sub={Math.round(m.totalNew/m.total*100)+'% of total'}/>
            <MetricCard label="Discount orders" value={m.totalDisc.toLocaleString('en-IN')} sub={Math.round(m.totalDisc/m.total*100)+'% of total'}/>
          </div>
        )}

        {/* Tab switcher */}
        {m&&(
          <>
            <div style={{display:'flex',borderBottom:'0.5px solid #e5e5e3',marginBottom:20}}>
              {[['charts','Charts'],['map','India heatmap']].map(([k,l])=>(
                <button key={k} onClick={()=>setTab(k)} style={{padding:'10px 20px',border:'none',borderBottom:tab===k?'2px solid #185FA5':'2px solid transparent',background:'none',fontSize:13,fontWeight:tab===k?500:400,color:tab===k?'#185FA5':'#777',cursor:'pointer'}}>{l}</button>
              ))}
            </div>

            {/* ── Charts tab ── */}
            {tab==='charts'&&(
              <>
                <SecTitle>Orders by city</SecTitle>
                <ChartCard title="Top cities by order volume" sub="Pincode → district; top 15 cities">
                  <div style={{position:'relative',height:Math.max(280,m.top15.length*34+80)}}>
                    <canvas id="cityOrders" role="img" aria-label="Orders by city"/>
                  </div>
                </ChartCard>
                <SecTitle>AOV by city</SecTitle>
                <ChartCard title="Average order value — top 15 cities" sub="₹ AOV per city">
                  <div style={{position:'relative',height:280}}><canvas id="aovChart" role="img" aria-label="AOV by city"/></div>
                </ChartCard>
                <SecTitle>Renewal, new & churn</SecTitle>
                <ChartCard title="Customer type split — top 15 cities" sub="% of city orders">
                  <Legend items={[{label:'Renewal',color:C.blue},{label:'New',color:C.green},{label:'Other / lapsed',color:C.red}]}/>
                  <div style={{position:'relative',height:300}}><canvas id="renewalChart" role="img" aria-label="Customer type by city"/></div>
                </ChartCard>
                <SecTitle>Discount redemptions</SecTitle>
                <ChartCard title="Discount code usage — top 15 cities" sub="% of city orders with a discount code">
                  <div style={{position:'relative',height:280}}><canvas id="discChart" role="img" aria-label="Discount rate by city"/></div>
                </ChartCard>
                <SecTitle>Pack & product split</SecTitle>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:16}}>
                  <ChartCard title="Pack duration" sub="Orders by subscription length" half>
                    {packDurData&&<Legend items={packDurData.labels.map((l,i)=>({label:`${l} — ${Math.round(packDurData.vals[i]/packDurData.total*100)}%`,color:packDurData.colors[i]}))}/>}
                    <div style={{position:'relative',height:210}}><canvas id="packDurChart" role="img" aria-label="Pack duration"/></div>
                  </ChartCard>
                  <ChartCard title="Pack type" sub="Standard vs sibling vs combo vs gift vs mini" half>
                    {packSubData&&<Legend items={packSubData.labels.map((l,i)=>({label:`${l.charAt(0).toUpperCase()+l.slice(1)} — ${Math.round(packSubData.vals[i]/packSubData.total*100)}%`,color:packSubData.colors[i]}))}/>}
                    <div style={{position:'relative',height:210}}><canvas id="packSubChart" role="img" aria-label="Pack type"/></div>
                  </ChartCard>
                </div>
                <ChartCard title="Product type — top 15 cities" sub="Books vs workshops vs workbooks vs toys/combo">
                  <Legend items={[{label:'Books',color:C.blue},{label:'Workshops',color:C.green},{label:'Workbooks',color:C.amber},{label:'Toys/Combo',color:C.purple}]}/>
                  <div style={{position:'relative',height:300}}><canvas id="productChart" role="img" aria-label="Product type by city"/></div>
                </ChartCard>
              </>
            )}

            {/* ── Map tab ── */}
            {tab==='map'&&(
              <>
                <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:16,flexWrap:'wrap'}}>
                  <span style={{fontSize:12,color:'#888'}}>Show:</span>
                  {Object.entries(mapMetricLabel).map(([k,l])=>(
                    <button key={k} onClick={()=>setMapMetric(k)} style={{fontSize:12,padding:'5px 14px',borderRadius:20,border:'0.5px solid',borderColor:mapMetric===k?'#185FA5':'#ccc',background:mapMetric===k?'#185FA5':'#fff',color:mapMetric===k?'#fff':'#555',cursor:'pointer'}}>{l}</button>
                  ))}
                </div>

                <ChartCard title={`India heatmap — ${mapMetricLabel[mapMetric]} by state`} sub="Hover a state to see details. Grey = no orders. Darker = higher value.">
                  <IndiaHeatmap stateData={m.stateData} metric={mapMetric}/>
                </ChartCard>

                {/* Top state cards */}
                <div style={{marginTop:16,display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:10}}>
                  {topStates.map(([state,d])=>(
                    <div key={state} style={{background:'#fff',border:'0.5px solid #e5e5e3',borderRadius:10,padding:'12px 14px'}}>
                      <div style={{fontSize:13,fontWeight:500,marginBottom:6}}>{state}</div>
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

/* ── Chart.js render function ── */
function renderCharts(m, chartsRef) {
  const Chart=window.Chart; if (!Chart) return;
  const cities=m.top15.map(e=>e[0]), cd=m.top15.map(e=>e[1]);
  const tC='rgba(0,0,0,0.42)', gC='rgba(0,0,0,0.06)';
  function kill(id){if(chartsRef.current[id]){chartsRef.current[id].destroy();delete chartsRef.current[id];}}
  function hbar(id,labels,data,color){kill(id);const c=document.getElementById(id);if(!c)return;chartsRef.current[id]=new Chart(c,{type:'bar',indexAxis:'y',data:{labels,datasets:[{data,backgroundColor:color,borderRadius:4,borderSkipped:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:v=>v.raw.toLocaleString('en-IN')+' orders'}}},scales:{x:{ticks:{color:tC,font:{size:11}},grid:{color:gC}},y:{ticks:{color:tC,font:{size:11}},grid:{color:'transparent'}}}}});}
  function bar(id,labels,data,color,pre,suf){kill(id);const c=document.getElementById(id);if(!c)return;chartsRef.current[id]=new Chart(c,{type:'bar',data:{labels,datasets:[{data,backgroundColor:color,borderRadius:4,borderSkipped:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:v=>pre+v.raw.toLocaleString('en-IN')+suf}}},scales:{x:{ticks:{color:tC,font:{size:11},autoSkip:false,maxRotation:40},grid:{color:gC}},y:{ticks:{color:tC,font:{size:11},callback:v=>pre+v.toLocaleString('en-IN')+suf},grid:{color:gC}}}}});}
  function stacked(id,labels,series){kill(id);const c=document.getElementById(id);if(!c)return;chartsRef.current[id]=new Chart(c,{type:'bar',data:{labels,datasets:series.map((s,i)=>({label:s.label,data:s.data,backgroundColor:s.color,borderRadius:i===series.length-1?4:0,borderSkipped:false,stack:'s'}))},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{mode:'index',callbacks:{label:v=>v.dataset.label+': '+v.raw+'%'}}},scales:{x:{stacked:true,ticks:{color:tC,font:{size:11},autoSkip:false,maxRotation:40},grid:{color:gC}},y:{stacked:true,max:100,ticks:{color:tC,font:{size:11},callback:v=>v+'%'},grid:{color:gC}}}}});}
  function donut(id,data,colors,labels){kill(id);const c=document.getElementById(id);if(!c)return;chartsRef.current[id]=new Chart(c,{type:'doughnut',data:{labels,datasets:[{data,backgroundColor:colors,borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,cutout:'65%',plugins:{legend:{display:false},tooltip:{callbacks:{label:v=>v.label+': '+v.raw.toLocaleString('en-IN')+' orders'}}}}});}

  hbar('cityOrders',cities,cd.map(d=>d.orders),C.blue);
  bar('aovChart',cities,cd.map(d=>d.orders?Math.round(d.revenue/d.orders):0),C.green,'₹','');
  stacked('renewalChart',cities,[
    {label:'Renewal',data:cd.map(d=>d.orders?Math.round(d.renewal/d.orders*100):0),color:C.blue},
    {label:'New',data:cd.map(d=>d.orders?Math.round(d.newU/d.orders*100):0),color:C.green},
    {label:'Other',data:cd.map(d=>d.orders?Math.round(d.other/d.orders*100):0),color:C.red},
  ]);
  bar('discChart',cities,cd.map(d=>d.orders?Math.round(d.disc/d.orders*100):0),C.amber,'','%');
  const dO=['3 months','6 months','12 months','2 months'],dC=[C.blue,C.green,C.amber,C.gray];
  const dL=dO.filter(k=>m.packDurTotals[k]),dV=dL.map(k=>m.packDurTotals[k]);
  donut('packDurChart',dV,dC.slice(0,dL.length),dL);
  const sO=['standard','sibling','combo','gift','mini'],sC=[C.blue,C.green,C.coral,C.purple,C.gray];
  const sL=sO.filter(k=>m.packSubTotals[k]),sV=sL.map(k=>m.packSubTotals[k]);
  donut('packSubChart',sV,sC.slice(0,sL.length),sL.map(l=>l.charAt(0).toUpperCase()+l.slice(1)));
  stacked('productChart',cities,[
    {label:'Books',data:cd.map(d=>d.orders?Math.round(d.books/d.orders*100):0),color:C.blue},
    {label:'Workshops',data:cd.map(d=>d.orders?Math.round(d.workshop/d.orders*100):0),color:C.green},
    {label:'Workbooks',data:cd.map(d=>d.orders?Math.round(d.workbook/d.orders*100):0),color:C.amber},
    {label:'Toys/Combo',data:cd.map(d=>d.orders?Math.round(d.combo/d.orders*100):0),color:C.purple},
  ]);
}
