
const refreshBtn = document.getElementById('refreshBtn');
const top50Grid = document.getElementById('top50-grid');
const top50Date = document.getElementById('top50-date');

const scoreDateInput = document.getElementById('score-date');
const loadScoresBtn = document.getElementById('load-scores-btn');
const latestBtn = document.getElementById('latest-btn');
const searchInput = document.getElementById('search');
const minMcapInput = document.getElementById('min-mcap');
const minVolInput = document.getElementById('min-vol');
const rowsPerPageSelect = document.getElementById('rows-per-page');
const applyFiltersBtn = document.getElementById('apply-filters');
const tbody = document.getElementById('scores-tbody');
const totalSpan = document.getElementById('total-span');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');

let currentOffset = 0;
let currentTotal = 0;

function fmt(x, pct=false){
  if (x===null || x===undefined || Number.isNaN(+x)) return '—';
  return pct ? (Number(x)*100).toFixed(2)+'%' : Number(x).toFixed(3);
}

async function fetchLatest(){ const r = await fetch('/api/latest-date'); return (await r.json()).date || null; }

async function loadTop50(date=null){
  const url = date ? `/api/top50?date=${encodeURIComponent(date)}` : '/api/top50';
  const r = await fetch(url, { cache:'no-store' });
  const j = await r.json();
  top50Date.textContent = j.date ? `Date: ${j.date}` : '';
  top50Grid.innerHTML = '';
  (j.rows||[]).forEach((row)=>{
    const card = document.createElement('div');
    card.className = 'rounded-xl border border-slate-700/60 bg-[#0b1026] p-3';
    card.innerHTML = `
      <div class="flex items-center justify-between">
        <div class="text-lg font-semibold">${row.ticker}</div>
        <div class="text-emerald-300 font-bold">${fmt(row.composite)}</div>
      </div>
      <div class="grid grid-cols-2 gap-2 mt-2 text-sm text-slate-300">
        <div>P/E: ${fmt(row.pe)}</div>
        <div>ROE: ${fmt(row.roe,true)}</div>
        <div>P/B: ${fmt(row.pb)}</div>
        <div>FCF: ${fmt(row.fcf_yield,true)}</div>
        <div>PEG: ${fmt(row.peg)}</div>
        <div>P/S: ${fmt(row.ps)}</div>
      </div>
      <div class="mt-2 text-xs text-slate-400">
        MCAP: ${row.market_cap ? Number(row.market_cap).toLocaleString() : '—'}
        &nbsp;•&nbsp;
        AvgVol: ${row.avg_volume ? Number(row.avg_volume).toLocaleString() : '—'}
      </div>
    `;
    top50Grid.appendChild(card);
  });
}

async function loadFiltered(){
  const d = scoreDateInput.value || await fetchLatest();
  if (!d) return;
  scoreDateInput.value = d;
  const q = (searchInput.value||'').toUpperCase();
  const min_mcap = minMcapInput.value || '';
  const min_vol = minVolInput.value || '';
  const limit = parseInt(rowsPerPageSelect.value,10);
  const offset = currentOffset;

  const url=`/api/scores_filtered/${d}?q=${encodeURIComponent(q)}&min_mcap=${encodeURIComponent(min_mcap)}&min_vol=${encodeURIComponent(min_vol)}&limit=${limit}&offset=${offset}`;
  const r = await fetch(url, { cache:'no-store' });
  const j = await r.json();
  currentTotal = j.total||0;
  totalSpan.textContent = currentTotal;
  tbody.innerHTML='';
  (j.rows||[]).forEach(r=>{
    const tr=document.createElement('tr');
    tr.className='hover:bg-[#0b1026]';
    tr.innerHTML=`
      <td class="px-2 py-2 text-left font-medium">${r.ticker}</td>
      <td class="px-2 py-2">${fmt(r.momentum,true)}</td>
      <td class="px-2 py-2">${fmt(r.volatility,true)}</td>
      <td class="px-2 py-2">${(r.volume||0).toLocaleString()}</td>
      <td class="px-2 py-2">${fmt(r.vwap_dev,true)}</td>
      <td class="px-2 py-2">${fmt(r.pe)}</td>
      <td class="px-2 py-2">${fmt(r.pb)}</td>
      <td class="px-2 py-2">${fmt(r.de)}</td>
      <td class="px-2 py-2">${fmt(r.fcf_yield,true)}</td>
      <td class="px-2 py-2">${fmt(r.peg)}</td>
      <td class="px-2 py-2">${fmt(r.ps)}</td>
      <td class="px-2 py-2">${fmt(r.roe,true)}</td>
      <td class="px-2 py-2">${fmt(r.dividend_yield,true)}</td>
      <td class="px-2 py-2 font-semibold text-emerald-300">${fmt(r.composite)}</td>
    `;
    tbody.appendChild(tr);
  });

  prevBtn.disabled = currentOffset<=0;
  nextBtn.disabled = (currentOffset+limit)>=currentTotal;
}

document.getElementById('latest-btn').addEventListener('click', async ()=>{
  const d = await fetchLatest();
  if (d) { scoreDateInput.value = d; await loadTop50(d); await loadFiltered(); }
});
document.getElementById('load-scores-btn').addEventListener('click', async ()=>{
  await loadTop50(scoreDateInput.value || null);
  await loadFiltered();
});
document.getElementById('apply-filters').addEventListener('click', ()=>{ currentOffset=0; loadFiltered(); });
prevBtn.addEventListener('click', ()=>{ const lim=parseInt(rowsPerPageSelect.value,10); currentOffset=Math.max(0,currentOffset-lim); loadFiltered(); });
nextBtn.addEventListener('click', ()=>{ const lim=parseInt(rowsPerPageSelect.value,10); if(currentOffset+lim<currentTotal){ currentOffset+=lim; loadFiltered(); }});
refreshBtn.addEventListener('click', async ()=>{ await loadTop50(scoreDateInput.value||null); await loadFiltered(); });

(async ()=>{
  const d = await fetchLatest();
  if (d) scoreDateInput.value = d;
  rowsPerPageSelect.value = '50';
  await loadTop50(d);
  await loadFiltered();
})();
