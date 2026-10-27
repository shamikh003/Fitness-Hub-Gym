'use strict';
(() => {
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = n => 'Rs. '+Number(n || 0).toLocaleString('en-PK');
  const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  let settings, clients=[], payments=[], report, refreshAt=0, loading=false, unlocked=false, settingsDirty=false;
  async function api(path,options={}) {
    const response=await fetch('/api'+path,{headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(15000),...options});
    const body=await response.json();
    if(!response.ok)throw new Error(body.error || Object.values(body.errors || {}).join(' ') || 'Unable to complete request.');
    return body;
  }
  function status(scope,message){scope.querySelector('[role=status]').textContent=message;}
  const workspace=document.createElement('section');workspace.id='ownerWorkspace';workspace.className='owner-workspace';
  workspace.innerHTML=`<div class="owner-heading"><div><small>FITNESS HUB / OWNER DESK</small><h2>Run your club.</h2><p>Website content, verified cash collections and renewals in one place.</p></div><button type="button" id="ownerRefresh">Refresh data ↻</button></div>
    <nav class="owner-tabs" aria-label="Owner tools"><button type="button" data-panel="reports" aria-selected="true">Overview & reports</button><button type="button" data-panel="payments" aria-selected="false">Cash payments</button><button type="button" data-panel="reminders" aria-selected="false">Renewals</button><button type="button" data-panel="editor" aria-selected="false">Edit website</button></nav>
    <p role="status" id="ownerStatus" aria-live="polite"></p>
    <section data-owner-panel="reports"><div class="owner-heading"><h3>Collections overview</h3><label>Report month<input type="month" id="reportMonth" value="${today().slice(0,7)}"></label></div><div id="reportStats" class="owner-stats"></div><div class="owner-split"><div class="owner-box"><h3>Cash collected by month</h3><div id="incomeTrend"></div></div><div class="owner-box"><h3>Membership health</h3><div id="memberHealth"></div><p class="owner-note">Income counts saved cash receipts only. Historical fees from before payment tracking are not reconstructed. Overdue fees show one outstanding membership cycle per member.</p></div></div></section>
    <section data-owner-panel="payments" hidden><div class="owner-heading"><div><h3>Cash payment history</h3><p>Every receipt retains its original member name, fee and coverage dates.</p></div><button type="button" id="newCashPayment">+ Record cash payment</button></div><div class="owner-filters"><label>Find member or receipt<input id="paymentSearch" type="search" placeholder="Name, member ID or receipt number"></label><label>Payment month<input id="paymentMonth" type="month"></label><button type="button" id="downloadPayments">Download CSV</button></div><p class="owner-note">Latest 1,000 entries. Use the monthly report for complete collections totals.</p><div id="paymentsTable" class="owner-table-wrap"></div></section>
    <section data-owner-panel="reminders" hidden><div class="owner-heading"><div><h3>Renewals & outstanding fees</h3><p>Prepare WhatsApp reminders individually; review each message before sending.</p></div></div><div id="renewalList"></div></section>
    <section data-owner-panel="editor" hidden><div class="owner-heading"><div><h3>Website editor</h3><p>Changes appear on the public website after saving. Existing membership fees and receipts stay unchanged.</p></div></div><form id="siteEditor"><div id="editorFields"></div><div class="owner-actions"><button type="submit">Save website changes</button><button type="button" id="reloadSettings">Reload saved version</button></div><p role="status" aria-live="polite"></p></form></section>`;
  $('#adminUnlockedContent').prepend(workspace);
  const dialog=document.createElement('dialog');dialog.id='ownerDialog';dialog.className='owner-dialog';dialog.innerHTML='<button type="button" id="closeOwnerDialog" aria-label="Close dialog">×</button><div id="ownerDialogBody"></div>';document.body.append(dialog);
  $('#closeOwnerDialog').onclick=()=>dialog.close();
  dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
  dialog.addEventListener('close',()=>delete document.body.dataset.print);
  workspace.querySelectorAll('[data-panel]').forEach(button=>button.addEventListener('click',()=>{
    workspace.querySelectorAll('[data-panel]').forEach(tab=>tab.setAttribute('aria-selected',String(tab===button)));
    workspace.querySelectorAll('[data-owner-panel]').forEach(panel=>panel.hidden=panel.dataset.ownerPanel!==button.dataset.panel);
  }));
  async function refresh(force=false){
    if(!unlocked || loading || (!force && Date.now()-refreshAt<5000))return;
    loading=true;$('#ownerStatus').textContent='Loading owner data…';
    try {
      const [members,ledger,summary]=await Promise.all([api('/clients'),api('/payments'),api('/reports?month='+encodeURIComponent($('#reportMonth').value))]);
      if(!unlocked)return;
      clients=members;payments=ledger;report=summary;renderReports();renderPayments();renderReminders();refreshAt=Date.now();$('#ownerStatus').textContent='';
      if(!settings){settings=await api('/site');if(unlocked)renderEditor();}
    }catch(error){$('#ownerStatus').textContent=error.message || 'Could not load data. Please try again.';}
    finally{loading=false;}
  }
  function renderReports(){
    $('#reportStats').innerHTML=[['Cash collected',money(report.income)],['Payments this month',report.paymentCount],['Renewals this month',report.renewals],['Current memberships',report.activeMembers],['Overdue fees',money(report.overdueFees)],['Pending admissions',report.pendingAdmissions]].map(([label,value])=>`<div class="owner-stat"><small>${label}</small><strong>${value}</strong></div>`).join('');
    const peak=Math.max(1,...report.trend.map(row=>row.income));
    $('#incomeTrend').innerHTML=report.trend.length?report.trend.slice().reverse().map(row=>`<div class="income-row"><span>${esc(row.month)}</span><div><i style="width:${Math.max(2,row.income/peak*100)}%"></i></div><strong>${money(row.income)}</strong></div>`).join(''):'<p>No cash payments recorded yet.</p>';
    $('#memberHealth').innerHTML=`<p><b>${report.activeMembers}</b> members with current coverage</p><p><b>${report.overdue.length}</b> overdue members</p><p><b>${report.dueSoon.length}</b> renewals due within 5 days</p><p><b>${report.registeredMembers}</b> registered members in total</p>`;
  }
  function filteredPayments(){const query=$('#paymentSearch').value.toLowerCase().trim(),month=$('#paymentMonth').value;return payments.filter(p=>(!month||p.paidOn.startsWith(month))&&(!query||[p.memberName,p.memberCode,p.receiptNo].join(' ').toLowerCase().includes(query)));}
  function renderPayments(){
    const rows=filteredPayments();
    $('#paymentsTable').innerHTML=rows.length?`<table><thead><tr><th>Receipt / date</th><th>Member</th><th>Plan / coverage</th><th>Cash amount</th><th></th></tr></thead><tbody>${rows.map(p=>`<tr><td>${esc(p.receiptNo)}<small>${esc(p.paidOn)}</small></td><td>${esc(p.memberName)}<small>${esc(p.memberCode)}</small></td><td>${esc(p.plan)}<small>${esc(p.periodStart)} → ${esc(p.periodEnd)}</small></td><td>${money(p.amount)}</td><td><button type="button" data-ledger-receipt="${p.id}">Receipt ↗</button></td></tr>`).join('')}</tbody></table>`:'<p class="owner-empty">No recorded payments match these filters.</p>';
  }
  function renderReminders(){
    const rows=[...report.overdue,...report.dueSoon].sort((a,b)=>a.daysLeft-b.daysLeft);
    $('#renewalList').innerHTML=rows.length?`<div class="owner-table-wrap"><table><thead><tr><th>Member</th><th>Renewal due</th><th>Fee</th><th>Action</th></tr></thead><tbody>${rows.map(c=>`<tr><td>${esc(c.name)}<small>${esc(c.clientId)} · ${esc(c.phone)}</small></td><td>${esc(c.dueDate)}<small>${c.daysLeft<0?Math.abs(c.daysLeft)+' days overdue':c.daysLeft===0?'Due today':'Due in '+c.daysLeft+' days'}</small></td><td>${money(c.planPrice)}</td><td><button type="button" data-remind="${c.id}">Prepare reminder ↗</button><button type="button" data-record-cash="${c.id}">Record cash</button></td></tr>`).join('')}</tbody></table></div>`:'<p class="owner-empty">No overdue fees or renewals due in the next five days.</p>';
  }
  function receipt(payment){
    document.body.dataset.print='ledger';
    $('#ownerDialogBody').innerHTML=`<article id="ownerReceipt"><small>FITNESS HUB · CASH RECEIPT</small><h2>${esc(payment.receiptNo)}</h2><p>3 Imran Khan Rd, Metroville Sector 3, SITE, Karachi<br>0325 6060570</p><dl>${[['Member',payment.memberName],['Member ID',payment.memberCode],['Plan',payment.plan],['Payment date',payment.paidOn],['Coverage',payment.periodStart+' → '+payment.periodEnd],['Payment method','Cash'],['Cash received',money(payment.amount)],['Recorded by',payment.recordedBy],['Note',payment.note || '—']].map(([label,value])=>`<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl><p class="owner-note">Keep this receipt for your records. Receipt details reflect the recorded payment.</p></article><div class="owner-actions no-print"><button type="button" id="printLedgerReceipt">Print / Save PDF</button></div>`;
    $('#printLedgerReceipt').onclick=()=>window.print();if(!dialog.open)dialog.showModal();
  }
  async function openPayment(id){
    if(!unlocked)return;
    if(!clients.length)await refresh(true);
    const active=clients.filter(c=>c.approvalStatus==='active');
    $('#ownerDialogBody').innerHTML=`<h2>Record cash payment</h2><p>Confirm that cash has been received. This records one membership cycle and issues a receipt.</p><form id="cashPaymentForm"><label>Member<select id="cashMember" required><option value="">Choose member</option>${active.map(c=>`<option value="${c.id}" ${String(c.id)===String(id)?'selected':''}>${esc(c.clientId+' · '+c.name+' · '+money(c.planPrice))}</option>`).join('')}</select></label><p id="cashCoverage" class="owner-note"></p><label>Cash received on<input id="cashDate" type="date" value="${today()}" max="${today()}" required></label><label>Note (optional)<input id="cashNote" maxlength="300" placeholder="e.g. October renewal"></label><button type="submit">Confirm cash received</button><p role="status" aria-live="polite"></p></form>`;
    const selection=$('#cashMember'),date=$('#cashDate');
    const describe=()=>{const c=active.find(c=>String(c.id)===selection.value);$('#cashCoverage').textContent=c?`${money(c.planPrice)} cash · ${c.plan}. Existing coverage ends ${c.dueDate}. Early renewals extend from that date; overdue renewals start on the payment date.`:'';if(c)date.min=c.joinDate;};selection.onchange=describe;describe();
    const requestKey=crypto.randomUUID();
    $('#cashPaymentForm').onsubmit=async event=>{
      event.preventDefault();const form=event.target,button=form.querySelector('button[type=submit]');button.disabled=true;status(form,'Saving cash receipt…');
      try{const result=await api(`/clients/${selection.value}/pay`,{method:'POST',body:JSON.stringify({paidOn:date.value,note:$('#cashNote').value,requestKey})});document.dispatchEvent(new CustomEvent('gym-data-changed'));await refresh(true);receipt(result.payment);}
      catch(error){status(form,error.message || 'Could not save payment. Try again.');button.disabled=false;}
    };
    if(!dialog.open)dialog.showModal();
  }
  const field=(label,path,value,type='text',extra='')=>`<label>${esc(label)}<input type="${type}" data-setting="${path}" value="${esc(value)}" ${extra}></label>`;
  function renderEditor(){
    const s=settings;
    $('#editorFields').innerHTML=`<fieldset><legend>Membership prices (PKR)</legend><p>New admissions use these prices. Existing agreed member fees are preserved.</p><div class="owner-fields">${['Monthly','Quarterly','Annual'].map(p=>field(p,'prices.'+p,s.prices[p],'number','required min="1" max="1000000" step="1"')).join('')}</div></fieldset>
      <fieldset><legend>Opening hours · Karachi time</legend><div class="owner-fields">${[['Mon–Sat opens','weekdayOpen'],['Mon–Sat closes','weekdayClose'],['Sunday opens','sundayOpen'],['Sunday closes','sundayClose']].map(([label,key])=>field(label,'hours.'+key,s.hours[key],'time','required')).join('')}</div></fieldset>
      <fieldset><legend>Website photos</legend><p>Use an HTTPS image link, a local asset, or upload a JPEG, PNG or WebP up to 1 MB.</p><div class="owner-fields">${[['Hero photo','hero'],['Training turf','turf'],['Recovery photo','recovery']].map(([label,key])=>`<div>${field(label,'photos.'+key,s.photos[key],'text','required')}<img class="editor-image" src="${esc(s.photos[key])}" alt="${label} preview"><label>Upload photo<input type="file" data-upload="photos.${key}" accept="image/jpeg,image/png,image/webp"></label></div>`).join('')}</div></fieldset>
      <fieldset><legend>Current offer</legend><p>Leave the title empty to hide the offer. Offers describe your promotion; membership prices above remain the charged fee.</p>${field('Offer title','offer.title',s.offer.title,'text','maxlength="100"')}${field('Offer description','offer.description',s.offer.description,'text','maxlength="500"')}${field('Show until (optional)','offer.endsOn',s.offer.endsOn,'date')}</fieldset>
      <fieldset><legend>Trainers</legend><div id="trainerEditor">${s.trainers.map((t,i)=>trainerFields(t,i)).join('')}</div><button type="button" id="addTrainer">+ Add trainer</button></fieldset>`;
    settingsDirty=false;
    $('#addTrainer').onclick=()=>{
      if(settings.trainers.length>=12){status($('#siteEditor'),'Maximum 12 trainers.');return;}
      collectSettings();settings.trainers.push({name:'New Coach',specialty:'Personal Training',bio:'',shift:'',photo:''});renderEditor();settingsDirty=true;
    };
  }
  function trainerFields(t,i){return `<div class="trainer-editor"><h4>Trainer ${i+1}</h4><div class="owner-fields">${field('Full name',`trainers.${i}.name`,t.name,'text','required maxlength="80"')}${field('Specialty',`trainers.${i}.specialty`,t.specialty,'text','required maxlength="100"')}${field('Shift / availability',`trainers.${i}.shift`,t.shift,'text','maxlength="100"')}${field('Photo link (optional)',`trainers.${i}.photo`,t.photo,'text','maxlength="500"')}</div>${field('Biography',`trainers.${i}.bio`,t.bio,'text','maxlength="500"')}<label>Upload trainer photo<input type="file" data-upload="trainers.${i}.photo" accept="image/jpeg,image/png,image/webp"></label><button type="button" data-remove-trainer="${i}">Remove trainer</button></div>`;}
  function collectSettings(){
    $('#editorFields').querySelectorAll('[data-setting]').forEach(input=>{
      const keys=input.dataset.setting.split('.');let target=settings;
      keys.slice(0,-1).forEach(key=>target=target[key]);target[keys.at(-1)]=input.type==='number'?Number(input.value):input.value.trim();
    });return settings;
  }
  $('#siteEditor').addEventListener('input',()=>settingsDirty=true);
  $('#siteEditor').addEventListener('change',async event=>{
    if(!event.target.matches('[data-upload]'))return;
    const file=event.target.files[0];if(!file)return;
    if(file.size>1048576){status($('#siteEditor'),'Choose an image smaller than 1 MB.');return;}
    const button=$('#siteEditor button[type=submit]');button.disabled=true;status($('#siteEditor'),'Uploading photo…');
    try{const response=await fetch('/api/site-image',{method:'POST',headers:{'Content-Type':file.type},body:file,signal:AbortSignal.timeout(20000)});const data=await response.json();if(!response.ok)throw new Error(data.error);const input=$(`[data-setting="${event.target.dataset.upload}"]`);input.value=data.url;const preview=input.closest('div')?.querySelector('.editor-image');if(preview)preview.src=data.url;settingsDirty=true;status($('#siteEditor'),'Photo uploaded. Save website changes to publish it.');}
    catch(error){status($('#siteEditor'),error.message || 'Photo upload failed.');}finally{button.disabled=false;}
  });
  $('#siteEditor').onsubmit=async event=>{
    event.preventDefault();const form=event.target,button=form.querySelector('[type=submit]');button.disabled=true;status(form,'Saving website…');
    try{const saved=await api('/site',{method:'PUT',body:JSON.stringify(collectSettings())});settings=saved;settingsDirty=false;window.applyGymSettings(saved);renderEditor();status(form,'Website changes saved.');}
    catch(error){status(form,error.message || 'Could not save.');}finally{button.disabled=false;}
  };
  $('#reloadSettings').onclick=async()=>{try{settings=await api('/site');renderEditor();status($('#siteEditor'),'Loaded the saved website version.');}catch(error){status($('#siteEditor'),error.message);}};
  workspace.addEventListener('click',event=>{
    const receiptButton=event.target.closest('[data-ledger-receipt]');if(receiptButton)receipt(payments.find(p=>p.id===Number(receiptButton.dataset.ledgerReceipt)));
    const paymentButton=event.target.closest('[data-record-cash]');if(paymentButton)openPayment(paymentButton.dataset.recordCash);
    const reminder=event.target.closest('[data-remind]');
    if(reminder){const c=clients.find(c=>c.id===Number(reminder.dataset.remind));if(!c)return;let phone=c.phone.replace(/\D/g,'');if(phone.startsWith('0'))phone='92'+phone.slice(1);const message=`Hello ${c.name}, your Fitness Hub ${c.plan} membership renewal of ${money(c.planPrice)} is due on ${c.dueDate}. Please pay cash at reception. Thank you!`;window.open('https://wa.me/'+phone+'?text='+encodeURIComponent(message),'_blank','noopener');}
    const remove=event.target.closest('[data-remove-trainer]');if(remove){if(settings.trainers.length===1){status($('#siteEditor'),'Keep at least one trainer.');return;}collectSettings();settings.trainers.splice(Number(remove.dataset.removeTrainer),1);renderEditor();settingsDirty=true;}
  });
  $('#paymentSearch').oninput=renderPayments;$('#paymentMonth').onchange=renderPayments;
  $('#reportMonth').onchange=()=>refresh(true);$('#ownerRefresh').onclick=()=>refresh(true);$('#newCashPayment').onclick=()=>openPayment();
  $('#downloadPayments').onclick=()=>{
    const data=[['Receipt','PaymentDate','MemberID','Member','Plan','CashPKR','CoverageStart','CoverageEnd','RecordedBy'],...filteredPayments().map(p=>[p.receiptNo,p.paidOn,p.memberCode,p.memberName,p.plan,p.amount,p.periodStart,p.periodEnd,p.recordedBy])];
    const csv=data.map(row=>row.map(value=>'"'+String(value).replace(/^[=+@\-\t\r]/,"'$&").replace(/"/g,'""')+'"').join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='fitness-hub-cash-payments.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  // Route member payment and receipt actions to the immutable ledger, before old handlers.
  $('#clientTableBody').addEventListener('click',async event=>{
    const button=event.target.closest('[data-action]');if(!button||!['paid','receipt'].includes(button.dataset.action))return;
    event.stopImmediatePropagation();
    if(button.dataset.action==='paid')return openPayment(button.dataset.id);
    try{const history=await api('/payments?clientId='+button.dataset.id);if(history.length)receipt(history[0]);else{$('#ownerStatus').textContent='No cash receipt exists for this member. Historical membership dates are not proof of payment.';workspace.scrollIntoView({behavior:'smooth',block:'start'});}}catch(error){$('#ownerStatus').textContent=error.message;}
  },true);
  document.addEventListener('gym-admin-ready',()=>{unlocked=true;refresh();});
  document.addEventListener('gym-admin-locked',()=>{unlocked=false;clients=[];payments=[];report=null;settings=null;settingsDirty=false;dialog.close();$('#paymentsTable').replaceChildren();$('#renewalList').replaceChildren();$('#reportStats').replaceChildren();$('#editorFields').replaceChildren();});
  window.addEventListener('beforeunload',event=>{if(settingsDirty){event.preventDefault();event.returnValue='';}});
})();
