(() => {
  const production = 'https://pef-design.vercel.app';
  const api = location.origin===production
    ? 'https://pef-design-api.galeriaparislisboa.workers.dev'
    : 'https://pef-design-api-staging.galeriaparislisboa.workers.dev';
  const sessionKey='pefCloudflareSession';
  const session={
    get(){return localStorage.getItem(sessionKey)||sessionStorage.getItem(sessionKey)},
    set(token){localStorage.setItem(sessionKey,token);sessionStorage.removeItem(sessionKey)},
    clear(){localStorage.removeItem(sessionKey);sessionStorage.removeItem(sessionKey)},
  };
  const section = '/api/admin/partner-pages';
  const ownerSection = '/api/partners/pages';

  function element(tag,text) {
    const node=document.createElement(tag);
    if(text)node.textContent=text;
    return node;
  }
  function button(label, action) {
    const node=element('button',label);
    node.type='button';
    node.onclick=()=>action(node);
    return node;
  }
  function status() {
    const node=element('p');
    node.setAttribute('role','status');
    return node;
  }
  function field(form,key,label,{value='',type='text',max=120,required=true}={}) {
    const wrap=element('label',label), input=element(type==='textarea'?'textarea':'input');
    if(type!=='textarea')input.type=type;
    input.name=key;
    input.value=value??'';
    input.required=required;
    input.maxLength=max;
    if(type==='number'){input.min='0.01';input.step='0.01'}
    wrap.append(input);form.append(wrap);
    return input;
  }
  const values=form=>Object.fromEntries(new FormData(form));
  const bearer=token=>({Authorization:'Bearer '+token});
  async function request(path,headers,method='GET',data) {
    const multipart=data instanceof FormData;
    const response=await fetch(api+path,{method,headers:data&&!multipart?{...headers,'Content-Type':'application/json'}:headers,
      body:data===undefined?undefined:multipart?data:JSON.stringify(data),cache:'no-store'});
    const result=await response.json().catch(()=>null);
    if(!response.ok)throw Error(result?.error||'This action is temporarily unavailable.');
    return result;
  }
  async function run(control,feedback,work) {
    control.disabled=true;
    feedback.textContent='Working…';
    try{feedback.textContent=await work()||''}
    catch(error){feedback.textContent=error.message}
    finally{control.disabled=false}
  }
  function markInvalid(control,message) {
    control.setAttribute('aria-invalid','true');
    const id=control.id||'pef-field-'+crypto.randomUUID();
    control.id=id;
    let notice=document.getElementById(id+'-error');
    if(!notice){
      notice=element('small');
      notice.id=id+'-error';
      notice.className='pef-field-error';
      control.after(notice);
      control.setAttribute('aria-describedby',notice.id);
    }
    notice.textContent=message;
  }
  function clearInvalid(control) {
    if(!control.hasAttribute('aria-invalid'))return;
    document.getElementById(control.id+'-error')?.remove();
    control.removeAttribute('aria-invalid');
    control.removeAttribute('aria-describedby');
  }
  function submit(form,label,feedback,work) {
    form.addEventListener('invalid',event=>markInvalid(event.target,event.target.validationMessage),true);
    form.addEventListener('input',event=>clearInvalid(event.target));
    const control=element('button',label);
    control.type='submit';form.append(control,feedback);
    form.onsubmit=event=>{event.preventDefault();void run(control,feedback,work)};
  }
  function profileFields(form,page={},admin=false) {
    field(form,'name','Seller name',{value:page.name});
    field(form,'city','City',{value:page.city,max:60});
    field(form,'country','Country',{value:page.country,max:60});
    if(admin)field(form,'email','Seller email',{type:'email',max:254});
    field(form,'whatsapp','Confirmed WhatsApp number',{value:page.whatsapp,type:'tel',max:20,required:!admin});
  }
  async function compress(file) {
    const bitmap=await createImageBitmap(file);
    const canvas=element('canvas');
    const ratio=Math.min(1,1080/Math.max(bitmap.width,bitmap.height));
    canvas.width=Math.max(1,Math.round(bitmap.width*ratio));
    canvas.height=Math.max(1,Math.round(bitmap.height*ratio));
    const context=canvas.getContext('2d');
    context.fillStyle='#fff';
    context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(bitmap,0,0,canvas.width,canvas.height);
    bitmap.close();
    for(const quality of [0.86,0.72,0.56]){
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));
      if(blob&&blob.size<=1024*1024)return blob;
    }
    throw Error('An image could not be compressed.');
  }
  function categoryField(form,value='') {
    const label=element('label','Category'), select=element('select');
    select.name='category';
    select.required=true;
    select.add(new Option('Choose a category',''));
    const options=document.getElementById('category')?.options||[];
    for(const option of options)if(option.value&&option.value!=='All')select.add(new Option(option.text,option.value));
    if(value&&value!=='All'&&![...select.options].some(option=>option.value===value))select.add(new Option(value,value));
    select.value=value==='All'?'':value;
    label.append(select);form.append(label);
    return select;
  }
  function draftForm(path,headers,refresh) {
    const form=element('form'), feedback=status(), importFeedback=status();
    const source=field(form,'source_url','Listing URL',{type:'url',max:1500,required:false});
    const account=field(form,'instagram_account','Instagram account',{max:31,required:false});
    account.parentElement.hidden=true;
    source.oninput=()=>{
      try{account.parentElement.hidden=!['instagram.com','www.instagram.com'].includes(new URL(source.value).hostname)}
      catch{account.parentElement.hidden=true}
    };
    let photos=[];
    const selected=element('ol');
    selected.className='pef-partner-selection';
    const draw=()=>{
      selected.replaceChildren(...photos.map((file,index)=>{
        const row=element('li');
        const image=element('img');
        image.alt=file.name;
        const url=URL.createObjectURL(file);
        image.onload=image.onerror=()=>URL.revokeObjectURL(url);
        image.src=url;
        const controls=element('div');
        const action=(symbol,label,handler)=>{
          const control=button(symbol,handler);
          control.setAttribute('aria-label',label);
          control.title=label;
          return control;
        };
        if(index>0)controls.append(action('↑','Move photo '+(index+1)+' earlier',()=>{[photos[index-1],photos[index]]=[photos[index],photos[index-1]];draw()}));
        controls.append(action('×','Remove photo '+(index+1),()=>{photos.splice(index,1);draw()}));
        row.append(image,element('small',index===0?'Cover':String(index+1)),controls);
        return row;
      }));
    };
    form.append(button('Flash import',control=>run(control,importFeedback,async()=>{
      if(!source.value||!source.checkValidity())throw Error('Enter a valid listing URL.');
      const data=await fetch('/api/flash-import?'+new URLSearchParams({url:source.value,instagramAccount:account.value}));
      const product=await data.json();
      if(!data.ok)throw Error(product.error||'Could not read this listing.');
      const imported=await Promise.allSettled(product.photos.slice(0,5).map(async (url,index)=>{
        const response=await fetch('/api/flash-import?'+new URLSearchParams({url,image:'1'}));
        if(!response.ok)throw Error('Photo unavailable');
        const blob=await response.blob();
        return new File([blob],'Imported photo '+(index+1),{type:blob.type});
      }));
      photos=imported.filter(result=>result.status==='fulfilled').map(result=>result.value);
      form.elements.title.value=[...(product.title||'')].slice(0,60).join('');
      form.elements.description.value=[...(product.description||'')].slice(0,80).join('');
      form.elements.price.value=product.price??'';
      draw();
      return photos.length+' photos imported. Review the details and add photos if needed.';
    })),importFeedback);
    field(form,'title','Title',{max:60});
    field(form,'description','Description',{type:'textarea',max:80,required:false});
    field(form,'price','Price (€)',{type:'number',required:false});
    categoryField(form).required=false;
    const pick=element('input');
    pick.type='file';pick.accept='image/*';pick.multiple=true;
    pick.onchange=()=>{
      const added=[...pick.files];
      if(photos.length+added.length>5)importFeedback.textContent='Choose a maximum of 5 photos.';
      else {photos.push(...added);draw()}
      pick.value='';
    };
    const photoLabel=element('label','Photos (2 to 5)');
    photoLabel.append(pick);form.append(photoLabel,selected);
    submit(form,'Save draft',feedback,async()=>{
      if(photos.length<2||photos.length>5)throw Error('Select 2 to 5 photos.');
      const data=new FormData(form);
      data.delete('instagram_account');
      const files=await Promise.all(photos.map(compress));
      files.forEach(file=>data.append('photo',file,'photo.jpg'));
      await request(path+'/drafts',headers,'POST',data);
      await refresh();
    });
    return form;
  }
  function showPhotos(container,photos,headers) {
    const grid=element('div');
    grid.className='pef-partner-photos';
    container.append(grid);
    for(const url of photos){
      const image=element('img');
      image.alt='';image.loading='lazy';image.hidden=true;
      grid.append(image);
      fetch(url,{headers:url.startsWith(api+'/media/')?headers:{},referrerPolicy:'no-referrer'}).then(async response=>{
        if(!response.ok)return;
        const source=URL.createObjectURL(await response.blob());
        image.onload=image.onerror=()=>URL.revokeObjectURL(source);
        image.src=source;image.hidden=false;
      }).catch(()=>{});
    }
  }
  function showListings(container,listings,headers,path,admin,refresh) {
    for(const listing of listings){
      const card=element('article');
      card.append(element('h4',listing.title),element('p',[listing.price&&listing.price+' €',listing.is_hidden?'Private':'In the feed'].filter(Boolean).join(' · ')));
      showPhotos(card,listing.photos,headers);
      if(!path&&listing.description)card.append(element('p',listing.description));
      if(path){
        const form=element('form'), feedback=status();
        field(form,'title','Title',{value:listing.title,max:60});
        field(form,'description','Description',{value:listing.description,type:'textarea',max:80,required:false});
        field(form,'price','Price (€)',{value:listing.price,type:'number'});
        categoryField(form,listing.category||'');
        field(form,'city','City',{value:listing.city,max:60});
        field(form,'country','Country',{value:listing.country,max:60});
        field(form,'whatsapp','WhatsApp',{value:listing.whatsapp,type:'tel',max:20});
        const phone=form.elements.whatsapp;
        const validatePhone=()=>phone.setCustomValidity(phone.value&&!/^\+?[1-9][0-9\s().-]{6,19}$/.test(phone.value.trim())
          ?'Enter a valid WhatsApp number, including its country code.':'');
        phone.addEventListener('input',validatePhone);
        validatePhone();
        phone.title='Enter a WhatsApp number with its country code.';
        const savedValues=values(form);
        const edit=element('details');
        edit.append(element('summary','Edit listing'),form);
        submit(form,'Save details',feedback,async()=>{
          await request('/api/listings/'+encodeURIComponent(listing.id),headers,'PATCH',values(form));
          await refresh();
        });
        card.append(edit);
        if(!listing.published_at){
          const publish=element('form'), feedback=status();
          if(admin)field(publish,'consent','Seller’s permission to publish',{type:'textarea',max:500});
          submit(publish,'Publish in feed',feedback,async()=>{
            const current=values(form);
            const invalid=[];
            for(const key of ['title','description','category','city','country','whatsapp','price']){
              const control=form.elements.namedItem(key);
              clearInvalid(control);
              if(!current[key]?.trim()||!control.validity.valid||(key==='category'&&current[key]==='All')){
                markInvalid(control,control.validationMessage||'Required to publish.');
                invalid.push(control);
              }
            }
            if(invalid.length){
              edit.open=true;
              invalid[0].focus();
              throw Error('Correct the fields marked in red before publishing.');
            }
            if(Object.keys(savedValues).some(key=>savedValues[key]!==current[key])){
              edit.open=true;
              form.querySelector('[type=submit]').focus();
              throw Error('Click Save details before publishing your changes.');
            }
            if(listing.photos.length<2)throw Error('At least two photos are required to publish.');
            await request(path+'/publish/'+encodeURIComponent(listing.id),headers,'POST',values(publish));
            await refresh();
            await window.loadRemote?.();
          });
          card.append(publish);
        }
      }
      container.append(card);
    }
  }
  function profileHeader(page) {
    const header=element('header');
    header.className='pef-partner-identity';
    if(page.logo){
      const logo=element('img');logo.src=page.logo;logo.alt='';header.append(logo);
    }
    const identity=element('div');
    identity.append(element('h2',page.name),element('p',[page.city,page.country].filter(Boolean).join(', ')));
    header.append(identity);
    return header;
  }
  function logoEditor(path,headers,page,refresh) {
    const form=element('form'), feedback=status(), input=element('input'), label=element('label','Partner logo');
    input.type='file';input.accept='image/png,image/jpeg,image/webp';input.required=true;
    label.append(input);form.append(label);
    submit(form,'Save logo',feedback,async()=>{
      const bitmap=await createImageBitmap(input.files[0]);
      const canvas=element('canvas'), ratio=Math.min(1,256/Math.max(bitmap.width,bitmap.height));
      canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));
      canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
      let logo=canvas.toDataURL('image/png');
      while(logo.length>180000&&Math.max(canvas.width,canvas.height)>64){
        const smaller=element('canvas');
        smaller.width=Math.max(1,Math.floor(canvas.width/2));smaller.height=Math.max(1,Math.floor(canvas.height/2));
        smaller.getContext('2d').drawImage(canvas,0,0,smaller.width,smaller.height);
        canvas.width=smaller.width;canvas.height=smaller.height;
        canvas.getContext('2d').drawImage(smaller,0,0);logo=canvas.toDataURL('image/png');
      }
      await request(path+'/presentation',headers,'POST',{logo});
      await refresh();
    });
    if(page.logo)form.append(button('Remove logo',node=>run(node,feedback,async()=>{
      await request(path+'/presentation',headers,'POST',{logo:null});await refresh();
    })));
    return form;
  }
  function renderPreview(host,page,listings,headers) {
    host.append(profileHeader(page),element('h2','Listings'));
    const grid=element('div');grid.className='pef-partner-preview-grid';host.append(grid);
    showListings(grid,listings,headers);
    if(!listings.length)host.append(element('p','No listings yet.'));
  }

  async function mount(host,token,admin) {
    const headers=bearer(token), root=element(admin?'section':'details'), body=element('div'), message=status();
    root.className='pef-partners';
    root.append(element(admin?'h2':'summary',admin?'Provisional Seller Pages':'My seller pages'),body,message);
    host.prepend(root);
    const prefix=admin?section:ownerSection;
    async function list(){
      body.replaceChildren();
      const {pages}=await request(prefix,headers);
      if(admin){
        const create=element('details'), form=element('form');
        profileFields(form,{},true);
        submit(form,'Create provisional page',status(),async()=>{
          const {id}=await request(prefix,headers,'POST',values(form));
          await open(id);
        });
        create.append(element('summary','New provisional page'),form);body.append(create);
      }
      for(const page of pages){
        const control=button(page.name+(admin?(page.owner_id?' · Claimed':' · Provisional'):''),
          node=>run(node,message,()=>open(page.id)));
        body.append(control);
      }
      if(!pages.length&&!admin)root.remove();
    }
    async function open(id){
      const path=prefix+'/'+id;
      const {page,listings}=await request(path,headers);
      body.replaceChildren(button('All seller pages',node=>run(node,message,list)),profileHeader(page),
        element('p',page.public?'Public seller page':'Private seller page'));
      const logo=element('details');
      logo.append(element('summary','Partner logo'),logoEditor(path,headers,page,()=>open(id)));body.append(logo);
      if(admin&&!page.owner_id){
        const feedback=status(), link=element('input');
        const previewLink=element('a','Open private seller page');
        previewLink.target='_blank';previewLink.rel='noopener';previewLink.hidden=true;
        link.readOnly=true;link.hidden=true;link.setAttribute('aria-label','Private preview link');
        body.append(button('Generate private preview link',node=>run(node,feedback,async()=>{
          const result=await request(path+'/preview',headers,'POST');
          link.value=result.url;link.hidden=false;link.select();
          previewLink.href=result.url;previewLink.hidden=false;
          return 'Private preview link valid for 7 days. Copy it to share.';
        })),link,previewLink,button('Send takeover invitation',node=>run(node,feedback,async()=>{
          if(!confirm('Send the seller an invitation to take over '+page.name+'?'))return;
          await request(path+'/invite',headers,'POST');
          return 'Invitation emailed. This link is valid for 3 days.';
        })),feedback);
        const draft=element('details');
        draft.append(element('summary','New listing draft'),draftForm(path,headers,()=>open(id)));body.append(draft);
      }
      if(!admin){
        const visibility=status();
        body.append(button(page.public?'Hide seller page':'Confirm and publish seller page',node=>run(node,visibility,async()=>{
          await request(path+'/presentation',headers,'POST',{public:!page.public});
          await open(id);await window.loadRemote?.();
        })),visibility);
        const details=element('details'), form=element('form');
        profileFields(form,page);
        submit(form,'Save profile and listing contact',status(),async()=>{
          await request(path+'/profile',headers,'POST',values(form));
          await open(id);
          await window.loadRemote?.();
        });
        details.append(element('summary','Edit seller page'),form);
        body.append(details);
      }
      showListings(body,listings,headers,path,admin,()=>open(id));
      if(!listings.length)body.append(element('p','No listings yet.'));
    }
    if(admin){
      const retry=button('Reload seller pages',node=>run(node,message,async()=>{await list();retry.remove()}));
      try{await list()}catch(error){message.textContent=error.message;root.append(retry)}
      return;
    }
    root.addEventListener('toggle',()=>{
      if(root.open&&!body.childElementCount)list().catch(error=>{message.textContent=error.message});
    });
    try{const {pages}=await request(prefix,headers);if(!pages.length)root.remove()}
    catch{root.remove()}
  }

  async function onboarding(host) {
    const params=new URLSearchParams(location.hash.slice(1)), preview=params.get('preview'), invite=params.get('invite');
    const feedback=status(), heading=element('h1',preview?'Seller page preview':'Take over your seller page');
    host.replaceChildren(heading,feedback);
    if(preview){
      const headers={Authorization:'Preview '+preview};
      try{
        const {page,listings}=await request('/api/partners/preview',headers);
        heading.hidden=true;
        renderPreview(host,page,listings,headers);
      }catch(error){feedback.textContent=error.message}
      return;
    }
    if(!invite){feedback.textContent='Open the personal invitation link from your email.';return}
    host.append(element('p','Use the address that received the invitation. Your listings and their statistics will move to your account.'));
    const form=element('form'), otp=element('form');
    const email=field(form,'email','Invited email',{type:'email',max:254});
    let invitedAddress='';
    const code=field(otp,'code','Six-digit code',{max:6});
    code.inputMode='numeric';code.pattern='[0-9]{6}';code.autocomplete='one-time-code';
    otp.hidden=true;
    function complete(token){
      session.set(token);
      location.replace('/?sellerOnboarded=1');
    }
    submit(form,'Send sign-in code',feedback,async()=>{
      invitedAddress=email.value.trim();
      await request('/api/auth/code/send',{},'POST',{email:invitedAddress,invite});
      otp.hidden=false;code.focus();
      return 'Check your email for the code.';
    });
    const claimStatus=status();
    submit(otp,'Verify code and take over my page',claimStatus,async()=>{
      const result=await request('/api/auth/code/verify',{},'POST',{email:invitedAddress,code:code.value,invite});
      complete(result.token);
    });
    let popup;
    window.addEventListener('message',event=>{
      if(event.origin===api&&event.source===popup&&event.data?.type==='pef-google-auth'&&event.data.role==='seller'&&typeof event.data.token==='string')complete(event.data.token);
    });
    const google=button('Take over with Google',()=>{
      const url=api+'/auth/google/start?'+new URLSearchParams({origin:location.origin,invite});
      popup=window.open(url,'pefPartnerLogin','popup,width=500,height=650');
    });
    host.append(form,otp);
    if(location.origin===production)host.append(google);
    const headers={Authorization:'Preview '+invite};
    try{
      const {page,listings}=await request('/api/partners/preview',headers);
      heading.textContent='Take over '+page.name;
      renderPreview(host,page,listings,headers);
    }catch(error){feedback.textContent=error.message}
  }

  window.pefPartners={mount,api,session};
  const onboardingHost=document.getElementById('pef-partner-onboarding');
  if(onboardingHost)void onboarding(onboardingHost);
})();
