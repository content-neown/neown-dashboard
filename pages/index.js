import { useState, useEffect, useRef } from 'react';
import Head from 'next/head';

const C = {
  blue: '#185FA5', green: '#1D9E75', amber: '#BA7517',
  red: '#E24B4A', purple: '#534AB7', coral: '#D85A30', gray: '#888780'
};

function extractId(url) {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

function parseCSV(text) {
  const lines = text.split('\n');
  const headers = splitLine(lines[0]).map(h => h.replace(/^"|"$/g, '').trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = splitLine(lines[i]);
    const row = {};
    headers.forEach((h, j) => row[h] = (vals[j] || '').replace(/^"|"$/g, '').trim());
    rows.push(row);
  }
  return rows;
}

function splitLine(line) {
  const out = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQ = !inQ;
    else if (c === ',' && !inQ) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur); return out;
}

function col(row, ...keys) {
  for (const k of keys) if (row[k] !== undefined && row[k] !== '') return row[k];
  return '';
}

function getCustomerType(row) {
  const ct = col(row, 'Customer Type', 'customer_type').toLowerCase();
  if (ct.includes('renew')) return 'renewal';
  if (ct.includes('new')) return 'new';
  return 'other';
}

function parseLineItems(raw) {
  const li = (raw || '').toLowerCase();
  if (li.includes('workshop')) return { productType: 'workshop', packDuration: null, packSubtype: 'workshop' };
  if (li.includes('workbook')) return { productType: 'workbook', packDuration: null, packSubtype: 'workbook' };

  let productType = 'books';
  if (li.includes('toy library')) productType = 'toys';
  else if (li.includes('toys + books') || li.includes('toys+books')) productType = 'combo';

  let packDuration = null;
  if (li.includes('12 month')) packDuration = '12 months';
  else if (li.includes('6 month')) packDuration = '6 months';
  else if (li.includes('3 month')) packDuration = '3 months';
  else if (li.includes('2 month')) packDuration = '2 months';

  let packSubtype = 'standard';
  if (li.includes('sibling')) packSubtype = 'sibling';
  else if (li.includes('mini pack')) packSubtype = 'mini';
  else if (li.includes('gift subscription') || li.includes('gift sub')) packSubtype = 'gift';
  else if (li.includes('toys + books') || li.includes('combo')) packSubtype = 'combo';

  return { productType, packDuration, packSubtype };
}

function MetricCard({ label, value, sub }) {
  return (
    <div style={{ background: '#fff', border: '0.5px solid #e5e5e3', borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 500 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Legend({ items }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 10, fontSize: 12, color: '#555' }}>
      {items.map(({ label, color }) => (
        <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }} />
          {label}
        </span>
      ))}
    </div>
  );
}

function ChartCard({ title, sub, children, half }) {
  return (
    <div style={{ background: '#fff', border: '0.5px solid #e5e5e3', borderRadius: 12, padding: 18, marginBottom: half ? 0 : 16 }}>
      <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 3 }}>{title}</div>
      {sub && <div style={{ fontSize: 12, color: '#888', marginBottom: 14 }}>{sub}</div>}
      {children}
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 500, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '24px 0 12px', paddingBottom: 6, borderBottom: '0.5px solid #e5e5e3' }}>
      {children}
    </div>
  );
}

export default function Dashboard() {
  const [sheetUrl, setSheetUrl] = useState('');
  const [ordersSheet, setOrdersSheet] = useState('Sheet1');
  const [pincodeSheet, setPincodeSheet] = useState('Sheet2');
  const [status, setStatus] = useState({ msg: '', type: '' });
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('all');
  const chartsRef = useRef({});

  async function loadData() {
    const id = extractId(sheetUrl.trim());
    if (!id) { setStatus({ msg: 'Could not find a sheet ID in that URL.', type: 'err' }); return; }
    setStatus({ msg: 'Connecting to Google Sheets…', type: 'loading' });
    try {
      const [oRes, pRes] = await Promise.all([
        fetch(`/api/sheet?id=${id}&sheet=${encodeURIComponent(ordersSheet)}`),
        fetch(`/api/sheet?id=${id}&sheet=${encodeURIComponent(pincodeSheet)}`)
      ]);
      if (!oRes.ok || !pRes.ok) throw new Error('Sheet not accessible. Make sure it is shared as "Anyone with the link → Viewer".');
      const [oText, pText] = await Promise.all([oRes.text(), pRes.text()]);
      const orders = parseCSV(oText);
      const pincodes = parseCSV(pText);

      const pincodeMap = {};
      pincodes.forEach(r => {
        const pc = col(r, 'pincode', 'Pincode').toString().trim();
        if (pc) pincodeMap[pc] = {
          city: col(r, 'district', 'District', 'officename') || 'Unknown',
          state: col(r, 'statename', 'Statename', 'state') || ''
        };
      });

      setStatus({ msg: `Loaded ${orders.length.toLocaleString('en-IN')} orders + ${pincodes.length.toLocaleString('en-IN')} pincode records.`, type: 'ok' });
      setData({ orders, pincodeMap });
    } catch (e) {
      setStatus({ msg: e.message, type: 'err' });
    }
  }

  function getCity(row, pincodeMap) {
    const pc = col(row, 'Shipping Pincode', 'shipping_pincode').toString().trim();
    if (pincodeMap[pc]) return pincodeMap[pc].city;
    return col(row, 'Shipping City', 'shipping_city') || 'Unknown';
  }

  function getFilteredRows() {
    if (!data) return [];
    if (filter === 'all') return data.orders;
    const days = parseInt(filter);
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
    return data.orders.filter(r => {
      const d = new Date(col(r, 'Created At', 'created_at'));
      return !isNaN(d) && d >= cutoff;
    });
  }

  function computeMetrics() {
    const rows = getFilteredRows();
    if (!rows.length || !data) return null;

    const cityData = {};
    const packDurTotals = {};
    const packSubTotals = {};

    rows.forEach(r => {
      const city = getCity(r, data.pincodeMap);
      if (!cityData[city]) cityData[city] = { orders: 0, revenue: 0, renewal: 0, newU: 0, other: 0, disc: 0, books: 0, workshop: 0, workbook: 0, combo: 0 };
      const d = cityData[city];
      d.orders++;
      d.revenue += parseFloat(col(r, 'Total Price', 'total_price').replace(/[^0-9.]/g, '')) || 0;
      const ct = getCustomerType(r);
      if (ct === 'renewal') d.renewal++; else if (ct === 'new') d.newU++; else d.other++;
      if ((col(r, 'Discount Code', 'discount_code') || '').trim()) d.disc++;
      const li = parseLineItems(col(r, 'Line Items', 'line_items'));
      const pt = li.productType === 'toys' ? 'combo' : li.productType;
      d[pt in d ? pt : 'books']++;
      if (li.packDuration) packDurTotals[li.packDuration] = (packDurTotals[li.packDuration] || 0) + 1;
      packSubTotals[li.packSubtype] = (packSubTotals[li.packSubtype] || 0) + 1;
    });

    const top15 = Object.entries(cityData).sort((a, b) => b[1].orders - a[1].orders).slice(0, 15);
    const total = rows.length;
    const totalRev = rows.reduce((s, r) => s + (parseFloat(col(r, 'Total Price', 'total_price').replace(/[^0-9.]/g, '')) || 0), 0);
    const totalRen = rows.filter(r => getCustomerType(r) === 'renewal').length;
    const totalNew = rows.filter(r => getCustomerType(r) === 'new').length;
    const totalDisc = rows.filter(r => (col(r, 'Discount Code', 'discount_code') || '').trim()).length;

    return { top15, total, totalRev, totalRen, totalNew, totalDisc, packDurTotals, packSubTotals, cityCount: Object.keys(cityData).length };
  }

  useEffect(() => {
    if (!data) return;
    const m = computeMetrics();
    if (!m) return;
    renderCharts(m);
  }, [data, filter]);

  function renderCharts(m) {
    if (typeof window === 'undefined') return;
    const Chart = window.Chart;
    if (!Chart) return;

    const cities = m.top15.map(e => e[0]);
    const cd = m.top15.map(e => e[1]);
    const tClr = 'rgba(0,0,0,0.42)', gClr = 'rgba(0,0,0,0.06)';

    function destroy(id) { if (chartsRef.current[id]) { chartsRef.current[id].destroy(); delete chartsRef.current[id]; } }

    // City orders
    destroy('cityOrders');
    const co = document.getElementById('cityOrders');
    if (co) chartsRef.current.cityOrders = new Chart(co, {
      type: 'bar', indexAxis: 'y',
      data: { labels: cities, datasets: [{ data: cd.map(d => d.orders), backgroundColor: C.blue, borderRadius: 4, borderSkipped: false }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: v => v.raw.toLocaleString('en-IN') + ' orders' } } }, scales: { x: { ticks: { color: tClr, font: { size: 11 } }, grid: { color: gClr } }, y: { ticks: { color: tClr, font: { size: 11 } }, grid: { color: 'transparent' } } } }
    });

    // AOV
    destroy('aovChart');
    const ao = document.getElementById('aovChart');
    if (ao) chartsRef.current.aovChart = new Chart(ao, {
      type: 'bar',
      data: { labels: cities, datasets: [{ data: cd.map(d => d.orders ? Math.round(d.revenue / d.orders) : 0), backgroundColor: C.green, borderRadius: 4, borderSkipped: false }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: v => '₹' + v.raw.toLocaleString('en-IN') } } }, scales: { x: { ticks: { color: tClr, font: { size: 11 }, autoSkip: false, maxRotation: 40 }, grid: { color: gClr } }, y: { ticks: { color: tClr, font: { size: 11 }, callback: v => '₹' + v.toLocaleString('en-IN') }, grid: { color: gClr } } } }
    });

    // Renewal stacked
    destroy('renewalChart');
    const rc = document.getElementById('renewalChart');
    if (rc) chartsRef.current.renewalChart = new Chart(rc, {
      type: 'bar',
      data: {
        labels: cities,
        datasets: [
          { label: 'Renewal', data: cd.map(d => d.orders ? Math.round(d.renewal / d.orders * 100) : 0), backgroundColor: C.blue, stack: 's', borderRadius: 0, borderSkipped: false },
          { label: 'New', data: cd.map(d => d.orders ? Math.round(d.newU / d.orders * 100) : 0), backgroundColor: C.green, stack: 's', borderRadius: 0, borderSkipped: false },
          { label: 'Other', data: cd.map(d => d.orders ? Math.round(d.other / d.orders * 100) : 0), backgroundColor: C.red, stack: 's', borderRadius: 4, borderSkipped: false },
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { mode: 'index', callbacks: { label: v => v.dataset.label + ': ' + v.raw + '%' } } }, scales: { x: { stacked: true, ticks: { color: tClr, font: { size: 11 }, autoSkip: false, maxRotation: 40 }, grid: { color: gClr } }, y: { stacked: true, max: 100, ticks: { color: tClr, font: { size: 11 }, callback: v => v + '%' }, grid: { color: gClr } } } }
    });

    // Discount
    destroy('discChart');
    const dc = document.getElementById('discChart');
    if (dc) chartsRef.current.discChart = new Chart(dc, {
      type: 'bar',
      data: { labels: cities, datasets: [{ data: cd.map(d => d.orders ? Math.round(d.disc / d.orders * 100) : 0), backgroundColor: C.amber, borderRadius: 4, borderSkipped: false }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: v => v.raw + '% of city orders' } } }, scales: { x: { ticks: { color: tClr, font: { size: 11 }, autoSkip: false, maxRotation: 40 }, grid: { color: gClr } }, y: { ticks: { color: tClr, font: { size: 11 }, callback: v => v + '%' }, grid: { color: gClr } } } }
    });

    // Pack duration donut
    destroy('packDurChart');
    const pd = document.getElementById('packDurChart');
    const durOrder = ['3 months', '6 months', '12 months', '2 months'];
    const durColors = [C.blue, C.green, C.amber, C.gray];
    const durLabels = durOrder.filter(k => m.packDurTotals[k]);
    const durVals = durLabels.map(k => m.packDurTotals[k]);
    if (pd) chartsRef.current.packDurChart = new Chart(pd, {
      type: 'doughnut',
      data: { labels: durLabels, datasets: [{ data: durVals, backgroundColor: durColors.slice(0, durLabels.length), borderWidth: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: v => v.label + ': ' + v.raw.toLocaleString('en-IN') + ' orders' } } } }
    });
    window.__packDurData = { labels: durLabels, vals: durVals, colors: durColors };

    // Pack subtype donut
    destroy('packSubChart');
    const ps = document.getElementById('packSubChart');
    const subOrder = ['standard', 'sibling', 'combo', 'gift', 'mini', 'workshop', 'workbook'];
    const subColors = [C.blue, C.green, C.coral, C.purple, C.gray, C.amber, C.teal];
    const subLabels = subOrder.filter(k => m.packSubTotals[k]);
    const subVals = subLabels.map(k => m.packSubTotals[k]);
    if (ps) chartsRef.current.packSubChart = new Chart(ps, {
      type: 'doughnut',
      data: { labels: subLabels.map(l => l.charAt(0).toUpperCase() + l.slice(1)), datasets: [{ data: subVals, backgroundColor: subColors.slice(0, subLabels.length), borderWidth: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: v => v.label + ': ' + v.raw.toLocaleString('en-IN') + ' orders' } } } }
    });
    window.__packSubData = { labels: subLabels, vals: subVals, colors: subColors };

    // Product stacked
    destroy('productChart');
    const pc = document.getElementById('productChart');
    if (pc) chartsRef.current.productChart = new Chart(pc, {
      type: 'bar',
      data: {
        labels: cities,
        datasets: [
          { label: 'Books', data: cd.map(d => d.orders ? Math.round(d.books / d.orders * 100) : 0), backgroundColor: C.blue, stack: 's', borderRadius: 0, borderSkipped: false },
          { label: 'Workshops', data: cd.map(d => d.orders ? Math.round(d.workshop / d.orders * 100) : 0), backgroundColor: C.green, stack: 's', borderRadius: 0, borderSkipped: false },
          { label: 'Workbooks', data: cd.map(d => d.orders ? Math.round(d.workbook / d.orders * 100) : 0), backgroundColor: C.amber, stack: 's', borderRadius: 0, borderSkipped: false },
          { label: 'Toys/Combo', data: cd.map(d => d.orders ? Math.round(d.combo / d.orders * 100) : 0), backgroundColor: C.purple, stack: 's', borderRadius: 4, borderSkipped: false },
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { mode: 'index', callbacks: { label: v => v.dataset.label + ': ' + v.raw + '%' } } }, scales: { x: { stacked: true, ticks: { color: tClr, font: { size: 11 }, autoSkip: false, maxRotation: 40 }, grid: { color: gClr } }, y: { stacked: true, max: 100, ticks: { color: tClr, font: { size: 11 }, callback: v => v + '%' }, grid: { color: gClr } } } }
    });
  }

  const m = data ? computeMetrics() : null;
  const packDurData = m ? (() => {
    const durOrder = ['3 months', '6 months', '12 months', '2 months'];
    const durColors = [C.blue, C.green, C.amber, C.gray];
    const labels = durOrder.filter(k => m.packDurTotals[k]);
    const vals = labels.map(k => m.packDurTotals[k]);
    const total = vals.reduce((a, b) => a + b, 0);
    return { labels, vals, colors: durColors, total };
  })() : null;

  const packSubData = m ? (() => {
    const subOrder = ['standard', 'sibling', 'combo', 'gift', 'mini'];
    const subColors = [C.blue, C.green, C.coral, C.purple, C.gray];
    const labels = subOrder.filter(k => m.packSubTotals[k]);
    const vals = labels.map(k => m.packSubTotals[k]);
    const total = vals.reduce((a, b) => a + b, 0);
    return { labels, vals, colors: subColors, total };
  })() : null;

  const statusColors = { ok: '#1D9E75', err: '#E24B4A', loading: '#888' };
  const filters = [{ k: 'all', l: 'All time' }, { k: '30', l: 'Last 30 days' }, { k: '90', l: 'Last 90 days' }, { k: '180', l: 'Last 180 days' }];

  return (
    <>
      <Head>
        <title>neOwn — Location Dashboard</title>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js" />
      </Head>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 20px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', color: '#1a1a1a', fontSize: 14 }}>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 20, fontWeight: 500, marginBottom: 3 }}>neOwn — location dashboard</h1>
          <p style={{ fontSize: 13, color: '#777' }}>Live data from your Google Sheets</p>
        </div>

        {/* Connect */}
        <div style={{ background: '#fff', border: '0.5px solid #ddd', borderRadius: 12, padding: 22, marginBottom: 22 }}>
          <h2 style={{ fontSize: 15, fontWeight: 500, marginBottom: 14 }}>Connect Google Sheets</h2>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <input value={sheetUrl} onChange={e => setSheetUrl(e.target.value)} placeholder="Paste your Google Sheets URL…"
              style={{ flex: 1, minWidth: 260, height: 38, border: '0.5px solid #ccc', borderRadius: 8, padding: '0 12px', fontSize: 13, background: '#fafafa', outline: 'none' }} />
            <button onClick={loadData}
              style={{ height: 38, padding: '0 18px', border: 'none', borderRadius: 8, background: '#185FA5', color: '#fff', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              Load data
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            {[['Orders sheet name', ordersSheet, setOrdersSheet], ['Pincode sheet name', pincodeSheet, setPincodeSheet]].map(([label, val, setter]) => (
              <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</label>
                <input value={val} onChange={e => setter(e.target.value)}
                  style={{ height: 34, border: '0.5px solid #ccc', borderRadius: 8, padding: '0 10px', fontSize: 13, background: '#fafafa', outline: 'none' }} />
              </div>
            ))}
          </div>
          <p style={{ fontSize: 12, color: '#888', lineHeight: 1.7 }}>
            Sheet must be shared as <strong>Anyone with the link → Viewer</strong>.<br />
            Share → Copy link → paste above.
          </p>
          {status.msg && <div style={{ fontSize: 12, marginTop: 10, color: statusColors[status.type] || '#888' }}>{status.msg}</div>}
        </div>

        {/* Filters */}
        {data && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 18 }}>
            <span style={{ fontSize: 12, color: '#888' }}>Period:</span>
            {filters.map(({ k, l }) => (
              <button key={k} onClick={() => setFilter(k)}
                style={{ fontSize: 12, padding: '5px 14px', borderRadius: 20, border: '0.5px solid', borderColor: filter === k ? '#185FA5' : '#ccc', background: filter === k ? '#185FA5' : '#fff', color: filter === k ? '#fff' : '#555', cursor: 'pointer' }}>
                {l}
              </button>
            ))}
          </div>
        )}

        {/* Metrics */}
        {m && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(148px, 1fr))', gap: 10, marginBottom: 20 }}>
            <MetricCard label="Total orders" value={m.total.toLocaleString('en-IN')} sub={`${m.cityCount} cities`} />
            <MetricCard label="Overall AOV" value={'₹' + Math.round(m.totalRev / m.total).toLocaleString('en-IN')} sub="per order" />
            <MetricCard label="Renewal rate" value={Math.round(m.totalRen / m.total * 100) + '%'} sub="of total orders" />
            <MetricCard label="Churn rate" value={Math.round((1 - m.totalRen / m.total) * 100) + '%'} sub="non-renewals" />
            <MetricCard label="New subscribers" value={m.totalNew.toLocaleString('en-IN')} sub={Math.round(m.totalNew / m.total * 100) + '% of total'} />
            <MetricCard label="Discount orders" value={m.totalDisc.toLocaleString('en-IN')} sub={Math.round(m.totalDisc / m.total * 100) + '% of total'} />
          </div>
        )}

        {/* Charts */}
        {m && (
          <>
            <SectionTitle>Orders by city</SectionTitle>
            <ChartCard title="Top cities by order volume" sub="Pincode → district mapping; top 15 cities">
              <div style={{ position: 'relative', height: Math.max(280, m.top15.length * 34 + 80) }}>
                <canvas id="cityOrders" role="img" aria-label="Horizontal bar chart of orders by city" />
              </div>
            </ChartCard>

            <SectionTitle>AOV by city</SectionTitle>
            <ChartCard title="Average order value — top 15 cities" sub="₹ AOV per city">
              <div style={{ position: 'relative', height: 280 }}>
                <canvas id="aovChart" role="img" aria-label="Bar chart of AOV by city" />
              </div>
            </ChartCard>

            <SectionTitle>Renewal, new & churn</SectionTitle>
            <ChartCard title="Customer type split — top 15 cities" sub="% of city orders by customer type">
              <Legend items={[{ label: 'Renewal', color: C.blue }, { label: 'New', color: C.green }, { label: 'Other / lapsed', color: C.red }]} />
              <div style={{ position: 'relative', height: 300 }}>
                <canvas id="renewalChart" role="img" aria-label="Stacked bar of customer type by city" />
              </div>
            </ChartCard>

            <SectionTitle>Discount redemptions</SectionTitle>
            <ChartCard title="Discount code usage — top 15 cities" sub="% of city orders that used a discount code">
              <div style={{ position: 'relative', height: 280 }}>
                <canvas id="discChart" role="img" aria-label="Bar chart of discount rate by city" />
              </div>
            </ChartCard>

            <SectionTitle>Pack & product split</SectionTitle>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <ChartCard title="Pack duration split" sub="Orders by subscription length" half>
                {packDurData && (
                  <Legend items={packDurData.labels.map((l, i) => ({ label: `${l} — ${Math.round(packDurData.vals[i] / packDurData.total * 100)}%`, color: packDurData.colors[i] }))} />
                )}
                <div style={{ position: 'relative', height: 210 }}>
                  <canvas id="packDurChart" role="img" aria-label="Donut chart of pack duration" />
                </div>
              </ChartCard>
              <ChartCard title="Pack type split" sub="Standard vs sibling vs combo vs gift vs mini" half>
                {packSubData && (
                  <Legend items={packSubData.labels.map((l, i) => ({ label: `${l.charAt(0).toUpperCase() + l.slice(1)} — ${Math.round(packSubData.vals[i] / packSubData.total * 100)}%`, color: packSubData.colors[i] }))} />
                )}
                <div style={{ position: 'relative', height: 210 }}>
                  <canvas id="packSubChart" role="img" aria-label="Donut chart of pack subtype" />
                </div>
              </ChartCard>
            </div>

            <ChartCard title="Product type split — top 15 cities" sub="Books vs workshops vs workbooks vs toys/combo">
              <Legend items={[{ label: 'Books', color: C.blue }, { label: 'Workshops', color: C.green }, { label: 'Workbooks', color: C.amber }, { label: 'Toys / combo', color: C.purple }]} />
              <div style={{ position: 'relative', height: 300 }}>
                <canvas id="productChart" role="img" aria-label="Stacked bar of product type by city" />
              </div>
            </ChartCard>
          </>
        )}

        {!data && (
          <div style={{ textAlign: 'center', padding: '52px 20px', color: '#bbb' }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>↑</div>
            <p>Paste your Google Sheets URL above and click Load data</p>
          </div>
        )}

      </div>
    </>
  );
}
