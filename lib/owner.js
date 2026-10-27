'use strict';
const defaults = {
  prices: {Monthly:3500,Quarterly:9500,Annual:32000},
  hours: {weekdayOpen:'06:00',weekdayClose:'23:00',sundayOpen:'08:00',sundayClose:'18:00'},
  photos: {hero:'/assets/hero_gym.jpg',turf:'/assets/turf_zone.jpg',recovery:'/assets/sauna_recovery.jpg'},
  offer: {title:'',description:'',endsOn:''},
  trainers: [
    {name:'Coach Hamza Khan',specialty:'Head Strength & Powerlifting',bio:'CSCS Certified · Strength training and barbell technique.',shift:'Mon to Sat (4 PM to 11 PM)',photo:''},
    {name:'Coach Ayesha Zafar',specialty:"Women's Strength & Mobility",bio:'NASM CPT · Strength sessions, mobility and sustainable fitness.',shift:'Mon to Sat (8 AM to 4 PM)',photo:''},
    {name:'Coach Zohaib Ali',specialty:'HIIT, Turf & Boxing Conditioning',bio:'Conditioning, boxing pad work and group training.',shift:'Mon to Sat (6 AM to 2 PM)',photo:''},
    {name:'Dr. Usman Siddiqui',specialty:'Sports Nutrition & Injury Rehab',bio:'DPT & ISSN Sports Nutritionist · Nutrition and recovery support.',shift:'Tue/Thu/Sat (5 PM to 10 PM)',photo:''}
  ]
};
const schemas = [
  `CREATE TABLE IF NOT EXISTS site_settings (id INTEGER PRIMARY KEY CHECK (id=1), value TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, updatedAt TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS payment_ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, clientId INTEGER NOT NULL, memberCode TEXT NOT NULL, memberName TEXT NOT NULL, plan TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount>0), paidOn TEXT NOT NULL, periodStart TEXT NOT NULL, periodEnd TEXT NOT NULL, method TEXT NOT NULL DEFAULT 'Cash', kind TEXT NOT NULL DEFAULT 'renewal', note TEXT NOT NULL DEFAULT '', recordedBy TEXT NOT NULL, createdAt TEXT NOT NULL, requestKey TEXT NOT NULL UNIQUE)`,
  `CREATE TABLE IF NOT EXISTS site_media (id TEXT PRIMARY KEY, contentType TEXT NOT NULL, content TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS ledger_paid_date ON payment_ledger(paidOn)`,
  `CREATE INDEX IF NOT EXISTS ledger_member ON payment_ledger(clientId)`
];
module.exports = function mountOwner(app, deps) {
  const {dbGet,dbAll,dbRun,dbBatch,requireAuth,todayStr,addDays,daysBetween,planCycleDays,serialize,validDate,displayId} = deps;
  async function getSettings() {
    const row = await dbGet('SELECT * FROM site_settings WHERE id=1');
    return row ? {...JSON.parse(row.value),revision:Number(row.revision)} : {...structuredClone(defaults),revision:0};
  }
  const string = (v,max,required=true) => typeof v === 'string' && v.length <= max && (!required || v.trim().length > 0);
  const image = v => string(v,500,false) && (!v || /^\/api\/media\/[a-f0-9]{32}$/.test(v) || /^\/assets\/[\w./-]+$/.test(v) || (()=>{try{return new URL(v).protocol==='https:';}catch{return false;}})());
  const validFrame = f => f===undefined || (!!f && typeof f==='object' && ['cover','contain'].includes(f.fit) && ['x','y'].every(k=>Number.isFinite(f[k])&&f[k]>=0&&f[k]<=100) && Number.isFinite(f.zoom)&&f.zoom>=1&&f.zoom<=3);
  function validateSettings(b) {
    if (!b || !b.prices || !b.hours || !b.photos || !b.offer || !Array.isArray(b.trainers)) return false;
    if (!Number.isInteger(b.revision) || b.revision<0) return false;
    if (['Monthly','Quarterly','Annual'].some(k=>!Number.isInteger(b.prices[k]) || b.prices[k]<1 || b.prices[k]>1000000)) return false;
    if (['weekdayOpen','weekdayClose','sundayOpen','sundayClose'].some(k=>!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.hours[k]))) return false;
    if (b.hours.weekdayOpen>=b.hours.weekdayClose || b.hours.sundayOpen>=b.hours.sundayClose) return false;
    if (['hero','turf','recovery'].some(k=>!b.photos[k] || !image(b.photos[k]))) return false;
    if (!string(b.offer.title,100,false)||!string(b.offer.description,500,false)||!(b.offer.endsOn==='' || validDate(b.offer.endsOn))) return false;
    if(b.framing!==undefined && (!b.framing || typeof b.framing!=='object' || ['hero','turf','recovery'].some(key=>!validFrame(b.framing[key]))))return false;
    if (b.trainers.length>12 || b.trainers.length<1) return false;
    return b.trainers.every(t=>t && string(t.name,80) && string(t.specialty,100) && string(t.bio,500,false) && string(t.shift,100,false) && image(t.photo) && validFrame(t.photoFrame));
  }
  app.post('/api/site-image',requireAuth,require('express').raw({type:['image/jpeg','image/png','image/webp'],limit:'1mb'}),async(req,res,next)=>{
    try {
      let b=req.body,type=req.get('content-type');
      // JSON transport also works on hosts that pre-parse serverless request bodies.
      if(type?.startsWith('application/json')) {
        type=b?.contentType;
        const encoded=b?.data;
        if(typeof encoded!=='string'||encoded.length>1398104||encoded.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))return res.status(400).json({error:'Choose a valid photo and try uploading again.'});
        b=Buffer.from(encoded,'base64');
      }
      if(Buffer.isBuffer(b)&&b.length>1048576)return res.status(413).json({error:'Photo is too large. Please choose a smaller image.'});
      const valid=Buffer.isBuffer(b) && b.length>12 && ((type==='image/jpeg'&&b[0]===255&&b[1]===216&&b[2]===255)||(type==='image/png'&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))||(type==='image/webp'&&b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP'));
      if(!valid)return res.status(400).json({error:'Upload a valid JPEG, PNG or WebP image under 1 MB.'});
      const id=require('node:crypto').randomBytes(16).toString('hex');
      await dbRun('INSERT INTO site_media(id,contentType,content) VALUES(?,?,?)',[id,type,b.toString('base64')]);
      res.status(201).json({url:'/api/media/'+id});
    }catch(err){next(err);}
  });
  app.get('/api/media/:id',async(req,res,next)=>{
    try{
      if(!/^[a-f0-9]{32}$/.test(req.params.id))return res.sendStatus(404);
      const row=await dbGet('SELECT * FROM site_media WHERE id=?',[req.params.id]);if(!row)return res.sendStatus(404);
      res.type(row.contentType).set('Cache-Control','public,max-age=31536000,immutable').send(Buffer.from(row.content,'base64'));
    }catch(err){next(err);}
  });
  app.get('/api/site',async(req,res,next)=>{try {res.json(await getSettings());}catch(err){next(err);}});
  app.put('/api/site',requireAuth,async(req,res,next)=>{
    try {
      const b=req.body;
      if(!validateSettings(b)) return res.status(400).json({error:'Check prices, opening hours, trainer details, HTTPS image links and offer date.'});
      const settings={prices:b.prices,hours:b.hours,photos:b.photos,framing:b.framing || {},offer:b.offer,trainers:b.trainers};
      const now=new Date().toISOString();
      const result = b.revision===0
        ? await dbRun('INSERT OR IGNORE INTO site_settings(id,value,revision,updatedAt) VALUES(1,?,1,?)',[JSON.stringify(settings),now])
        : await dbRun('UPDATE site_settings SET value=?,revision=revision+1,updatedAt=? WHERE id=1 AND revision=?',[JSON.stringify(settings),now,b.revision]);
      if(!result.changes) return res.status(409).json({error:'Another editor saved changes. Reload settings before saving again.'});
      res.json(await getSettings());
    }catch(err){next(err);}
  });
  function paymentObject(row) {return {...row,id:Number(row.id),clientId:Number(row.clientId),amount:Number(row.amount),receiptNo:'FH-R'+String(row.id).padStart(6,'0')};}
  async function recordPayment(row,options={}) {
    const {kind='renewal',paidOn=todayStr(),note='',recordedBy='staff',requestKey=require('node:crypto').randomUUID()}=options;
    const existing=await dbGet('SELECT * FROM payment_ledger WHERE requestKey=?',[requestKey]);
    if(existing) {
      if(Number(existing.clientId)!==Number(row.id)) throw Object.assign(new Error('Payment key already used.'),{status:409});
      return paymentObject(existing);
    }
    if(!validDate(paidOn) || paidOn>todayStr() || paidOn<row.joinDate) throw Object.assign(new Error('Payment date must be on or after joining and no later than today.'),{status:400});
    const due=row.paidUntil || addDays(row.lastPaidDate,planCycleDays(row.plan));
    const start=kind==='renewal' && due>=paidOn ? due : paidOn;
    const end=addDays(start,planCycleDays(row.plan));
    const expectedStatus=kind==='admission'?'pending':'active';
    const amount=Number(row.planPrice);
    if(!Number.isInteger(amount) || amount<1) throw Object.assign(new Error('Member fee must be a positive whole amount.'),{status:400});
    try { await dbBatch([
      {sql:`INSERT INTO payment_ledger (clientId,memberCode,memberName,plan,amount,paidOn,periodStart,periodEnd,method,kind,note,recordedBy,createdAt,requestKey)
        SELECT id,?,name,plan,?,?,?,?, 'Cash',?,?,?,?,? FROM clients WHERE id=? AND lastPaidDate=? AND approvalStatus=? AND plan=? AND planPrice=? AND paidUntil=?`,
       args:[displayId(row.id),amount,paidOn,start,end,kind,note,recordedBy,new Date().toISOString(),requestKey,row.id,row.lastPaidDate,expectedStatus,row.plan,row.planPrice,row.paidUntil || '']},
      {sql:`UPDATE clients SET lastPaidDate=?, paidUntil=?, approvalStatus='active', joinDate=CASE WHEN approvalStatus='pending' THEN ? ELSE joinDate END WHERE id=? AND EXISTS(SELECT 1 FROM payment_ledger WHERE requestKey=?)`,args:[start,end,paidOn,row.id,requestKey]}
    ]); } catch(err) {const duplicate=await dbGet('SELECT * FROM payment_ledger WHERE requestKey=?',[requestKey]); if(duplicate && Number(duplicate.clientId)===Number(row.id))return paymentObject(duplicate); throw err;}
    const saved=await dbGet('SELECT * FROM payment_ledger WHERE requestKey=?',[requestKey]);
    if(!saved) throw Object.assign(new Error('Member changed while saving. Refresh and try again.'),{status:409});
    return paymentObject(saved);
  }
  app.post('/api/clients/:id/pay',requireAuth,async(req,res,next)=>{
    try {
      const key=req.body?.requestKey;
      if(key && !/^[\w-]{16,80}$/.test(key)) return res.status(400).json({error:'Invalid payment request key.'});
      const row=await dbGet('SELECT * FROM clients WHERE id=?',[Number(req.params.id)]);
      if(!row) return res.status(404).json({error:'Member not found.'});
      if(row.approvalStatus==='pending') return res.status(400).json({error:'Approve admission before recording renewals.'});
      const note=req.body?.note || '';
      if(!string(note,300,false)) return res.status(400).json({error:'Note must be under 300 characters.'});
      const payment=await recordPayment(row,{paidOn:req.body?.paidOn || todayStr(),note,recordedBy:req.user,requestKey:key});
      res.json({...serialize(await dbGet('SELECT * FROM clients WHERE id=?',[row.id])),payment});
    }catch(err){if(err.status)return res.status(err.status).json({error:err.message});next(err);}
  });
  app.post('/api/clients/:id/approve',requireAuth,async(req,res,next)=>{
    try {
      const row=await dbGet('SELECT * FROM clients WHERE id=?',[Number(req.params.id)]);
      if(!row) return res.status(404).json({error:'Member not found.'});
      if(row.approvalStatus!=='pending') return res.status(400).json({error:'Admission is already processed.'});
      const payment=await recordPayment(row,{kind:'admission',recordedBy:req.user,requestKey:'admission-'+row.id});
      res.json({...serialize(await dbGet('SELECT * FROM clients WHERE id=?',[row.id])),payment});
    }catch(err){if(err.status)return res.status(err.status).json({error:err.message});next(err);}
  });
  app.post('/api/clients/quick',requireAuth,async(req,res,next)=>{
    try {
      const {name,phone,plan}=req.body || {};
      if(!string(name,100)||name.trim().length<3||! /^(?:\+?92|0)3\d{9}$/.test(phone)||!Object.hasOwn(defaults.prices,plan)) return res.status(400).json({error:'Enter full name, Pakistani mobile number and a valid plan.'});
      const price=(await getSettings()).prices[plan], today=todayStr(), now=new Date().toISOString();
      const supplied=req.body.requestKey;
      if(supplied && !/^[\w-]{16,80}$/.test(supplied))return res.status(400).json({error:'Invalid request key.'});
      const key='quick-'+(supplied || require('node:crypto').randomUUID());
      const previous=await dbGet('SELECT * FROM payment_ledger WHERE requestKey=?',[key]);
      if(previous)return res.status(200).json({id:displayId(previous.clientId),payment:paymentObject(previous)});
      const preferences=JSON.stringify({registrationKey:key});
      await dbBatch([
        {sql:`INSERT INTO clients(name,phone,plan,planPrice,joinDate,lastPaidDate,createdAt,approvalStatus,preferences) VALUES(?,?,?,?,?,?,?,'active',?)`,args:[name.trim(),phone,plan,price,today,today,now,preferences]},
        {sql:`INSERT INTO payment_ledger(clientId,memberCode,memberName,plan,amount,paidOn,periodStart,periodEnd,method,kind,note,recordedBy,createdAt,requestKey) SELECT id,'FH'||printf('%04d',id),name,plan,planPrice,?,?,?,'Cash','joining','Joining fee',?,?,? FROM clients WHERE preferences=?`,args:[today,today,addDays(today,planCycleDays(plan)),req.user,now,key,preferences]},
        {sql:'UPDATE clients SET paidUntil=? WHERE preferences=?',args:[addDays(today,planCycleDays(plan)),preferences]}
      ]);
      const payment=paymentObject(await dbGet('SELECT * FROM payment_ledger WHERE requestKey=?',[key]));
      res.status(201).json({id:displayId(payment.clientId),payment});
    }catch(err){next(err);}
  });
  app.get('/api/payments',requireAuth,async(req,res,next)=>{
    try {
      const id=req.query.clientId;
      if(id!==undefined && !/^\d+$/.test(id))return res.status(400).json({error:'Invalid member.'});
      const rows=id?await dbAll('SELECT * FROM payment_ledger WHERE clientId=? ORDER BY paidOn DESC,id DESC',[Number(id)]):await dbAll('SELECT * FROM payment_ledger ORDER BY paidOn DESC,id DESC LIMIT 1000');
      res.json(rows.map(paymentObject));
    }catch(err){next(err);}
  });
  app.get('/api/reports',requireAuth,async(req,res,next)=>{
    try {
      const month=req.query.month || todayStr().slice(0,7);
      if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return res.status(400).json({error:'Select a valid month.'});
      const clients=(await dbAll('SELECT * FROM clients')).map(serialize);
      const active=clients.filter(c=>c.approvalStatus==='active');
      const payments=(await dbAll('SELECT * FROM payment_ledger WHERE substr(paidOn,1,7)=? ORDER BY paidOn DESC,id DESC',[month])).map(paymentObject);
      const trend=await dbAll(`SELECT substr(paidOn,1,7) AS month, SUM(amount) AS income, COUNT(*) AS payments FROM payment_ledger GROUP BY substr(paidOn,1,7) ORDER BY month DESC LIMIT 12`);
      const overdue=active.filter(c=>c.status==='overdue');
      const dueSoon=active.filter(c=>c.status==='due');
      res.json({month,income:payments.reduce((sum,p)=>sum+p.amount,0),paymentCount:payments.length,renewals:payments.filter(p=>p.kind==='renewal').length,activeMembers:active.filter(c=>c.daysLeft>=0).length,registeredMembers:active.length,pendingAdmissions:clients.filter(c=>c.approvalStatus==='pending').length,overdueFees:overdue.reduce((sum,c)=>sum+c.planPrice,0),overdue,dueSoon,payments,trend:trend.map(r=>({...r,income:Number(r.income),payments:Number(r.payments)}))});
    }catch(err){next(err);}
  });
  return {getSettings,recordPayment};
};
module.exports.schemas=schemas;
module.exports.defaults=defaults;
