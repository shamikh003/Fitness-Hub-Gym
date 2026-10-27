/* Public content is rendered using text nodes and validated image URLs. */

(() => {

  const cleanCopy = value => String(value ?? '').replace(/\s*[\u2013]\s*/g,' to ').replace(/\s*[\u2014]\s*/g,': ').replace(/\s+-\s+/g,', ');
  const money = n => Number(n).toLocaleString('en-PK');

  const time = value => {const [h,m]=value.split(':').map(Number);return `${h%12||12}${m?':'+String(m).padStart(2,'0'):''} ${h<12?'AM':'PM'}`;};

  window.applyGymSettings = settings => {

    window.gymSettings = settings;

    const names=['Monthly','Quarterly','Annual'];

    document.querySelectorAll('.plan-select-btn').forEach((button,index)=>{

      const plan=names[index],price=settings.prices[plan];

      button.dataset.selectPlan=`${plan}|${price}`;

      button.textContent=`Choose ${plan} (Rs. ${money(price)})`;

      const card=button.parentElement;

      card.querySelector('.text-4xl').textContent=`Rs. ${money(price)}`;

      const rate=card.querySelector('p.font-mono-code');

      if(rate)rate.textContent=`Effective rate: Rs. ${money(Math.round(price/(plan==='Annual'?12:3)))}/mo`;

      if(plan==='Quarterly')card.querySelector('.absolute').textContent='Most Popular';

      if(plan==='Annual')card.querySelector('.flex.justify-between span').textContent='365-Day Cycle';

    });

    document.querySelectorAll('select').forEach(select=>Array.from(select.options).forEach(option=>{

      const plan=option.value.split('|')[0];

      if(!names.includes(plan))return;

      if(option.value.includes('|'))option.value=`${plan}|${settings.prices[plan]}`;

      option.textContent=`${plan}: Rs. ${money(settings.prices[plan])}`;

    }));

    document.querySelector('.hero-plan strong').textContent=`Membership from Rs. ${money(settings.prices.Monthly)}`;

    const imageSlots={hero:'img[alt="Fitness Hub strength training floor"]',turf:'img[alt="Functional Turf and Conditioning Zone"]',recovery:'img[alt="Cedar Sauna and Recovery Suite"]'};

    Object.entries(imageSlots).forEach(([key,selector])=>{const img=document.querySelector(selector);img.src=settings.photos[key];window.GymPhotoFraming.apply(img,settings.framing?.[key]);});

    const hours=settings.hours;

    const weekday=`Mon to Sat: ${time(hours.weekdayOpen)}  to  ${time(hours.weekdayClose)}`;

    const sunday=`Sunday: ${time(hours.sundayOpen)}  to  ${time(hours.sundayClose)}`;

    const detail=document.querySelector('#viewPublic>section:nth-of-type(2) .border-l-2');

    detail.querySelector('.text-base').textContent=weekday;

    detail.querySelector('.text-xs').textContent=sunday;

    const footer=document.querySelector('#contact .grid>div:last-child');

    footer.querySelectorAll('p')[0].textContent=weekday;

    footer.querySelectorAll('p')[1].textContent=sunday;

    const trainerGrid=document.querySelector('#trainers .grid');

    trainerGrid.replaceChildren();

    settings.trainers.forEach(trainer=>{

      const card=document.createElement('article');card.className='card-glow cms-trainer';

      if(trainer.photo){const img=document.createElement('img');img.src=trainer.photo;img.alt=trainer.name;img.loading='lazy';const frame=document.createElement('div');frame.className='photo-frame trainer-photo-frame';frame.append(img);window.GymPhotoFraming.apply(img,trainer.photoFrame,true);card.append(frame);}

      else {const monogram=document.createElement('div');monogram.className='trainer-monogram';monogram.textContent=trainer.name.split(' ').filter(Boolean).slice(-2).map(n=>n[0]).join('');card.append(monogram);}

      for(const [tag,text] of [['h3',trainer.name],['strong',trainer.specialty],['p',trainer.bio],['small','Shift: '+trainer.shift]]){const node=document.createElement(tag);node.textContent=cleanCopy(text);card.append(node);}

      const button=document.createElement('button');button.type='button';button.dataset.trainer=trainer.name;button.className='select-trainer-btn';button.textContent='Train with '+trainer.name.replace(/^Coach /,'');

      button.addEventListener('click',()=>{document.getElementById('preferredCoach').value=trainer.name;document.getElementById('admission').scrollIntoView({behavior:'smooth'});});card.append(button);trainerGrid.append(card);

    });

    let offer=document.getElementById('currentOffer');

    if(!offer){offer=document.createElement('aside');offer.id='currentOffer';offer.className='current-offer';document.getElementById('plans').firstElementChild.prepend(offer);}

    offer.replaceChildren();

    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Karachi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

    offer.hidden=!settings.offer.title || (!!settings.offer.endsOn && settings.offer.endsOn<today);

    if(!offer.hidden){const title=document.createElement('h3');title.textContent=cleanCopy(settings.offer.title);const copy=document.createElement('p');copy.textContent=cleanCopy(settings.offer.description);offer.append(title,copy);if(settings.offer.endsOn){const date=document.createElement('small');date.textContent='Available until '+settings.offer.endsOn;offer.append(date);}}

    document.dispatchEvent(new CustomEvent('gym-settings-applied',{detail:settings}));

  };

  window.gymSettingsReady=fetch('/api/site',{signal:AbortSignal.timeout(12000)}).then(res=>{if(!res.ok)throw new Error('Content unavailable');return res.json();}).then(settings=>{window.applyGymSettings(settings);return settings;}).catch(()=>null);

})();

