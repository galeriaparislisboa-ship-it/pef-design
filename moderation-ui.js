(() => {
 const api=window.pefPartners?.api||'https://pef-design-api.galeriaparislisboa.workers.dev';
 const label={delete_account:'Supprimer le compte',hide:'Masquer',show:'Republier',archive:'Archiver',restore:'Restaurer',resolve:'Traiter',dismiss:'Classer',reopen:'Rouvrir',approve:'Certifier',reject:'Refuser',revoke:'Révoquer'};
 const states={pending:'À traiter',resolved:'Traité',dismissed:'Classé',approved:'Certifié',rejected:'Refusé',revoked:'Révoqué',available:'Disponible',reserved:'Réservé',sold:'Vendu'};
 const el=(tag,text)=>Object.assign(document.createElement(tag),text===undefined?{}:{textContent:text});
 const button=(text,run)=>Object.assign(el('button',text),{type:'button',onclick:run});
 const statusLine=()=>{const node=el('p');node.setAttribute('role','status');return node};
 async function request(path,token,method='GET',data){
  const response=await fetch(api+path,{method,headers:{Authorization:'Bearer '+token,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined});
  const payload=await response.json().catch(()=>null);
  if(!response.ok||!payload)throw Error(payload?.error||'Service momentanément indisponible.');
  return payload;
 }
 function menu(labelText,options){
  const select=el('select');
  select.setAttribute('aria-label',labelText);
  for(const [value,text] of options)select.add(new Option(text,value));
  return select;
 }
 function card(title,summary){
  const node=el('details'), heading=el('summary'), content=el('div');
  heading.append(el('strong',title),el('small',summary));
  node.append(heading,content);
  return {node,content};
 }
 async function submitVerification(host,token){
  const status=statusLine();host.append(status);
  try{
   const {request:application}=await request('/api/verification',token);
   const form=el('form');
   for(const [key,title,max] of [['display_name','Nom public',120],['business_name','Galerie ou entreprise',120],['website','Site Internet',250],['country','Pays',100],['details','Présentation',500]]){
    const label=el('label',title),input=el(key==='details'?'textarea':'input');
    Object.assign(input,{name:key,maxLength:max,required:key==='display_name',value:application?.[key]||''});
    if(key==='website')input.type='url';
    label.append(input);form.append(label);
   }
   if(application)status.textContent=[states[application.status]||application.status,application.admin_note].filter(Boolean).join(' · ');
   if(application?.status==='approved')return;
   const send=el('button',application?.status==='pending'?'Mettre à jour la demande':'Envoyer la demande');
   form.append(send);host.append(form);
   form.onsubmit=async event=>{
    event.preventDefault();send.disabled=true;
    try{await request('/api/verification',token,'POST',Object.fromEntries(new FormData(form)));status.textContent='Demande reçue. En attente de décision.'}
    catch(error){status.textContent=error.message}
    finally{send.disabled=false}
   };
  }catch(error){status.textContent=error.message}
 }
 function mount(host,token,editor,reloadFeed,mountPartners){
  host.classList.add('pef-moderation');
  const path='/api/admin/moderation';
  const nav=el('nav'), controls=el('div'), list=el('div'), feedback=statusLine();
  const search=Object.assign(el('input'),{type:'search',placeholder:'Rechercher'});
  search.setAttribute('aria-label','Rechercher dans la section');
  let active='listings',data,busy=false,category,filter,order,sellerFilter,showingPartners=false;
  const titles={listings:'Annonces',accounts:'Comptes',reports:'Signalements',requests:'Certifications',history:'Historique'};
  const pending=rows=>rows.filter(row=>row.status==='pending').length;
  const formatDate=value=>value?new Date(value.replace(' ','T')+(value.includes('T')?'':'Z')).toLocaleString('fr-FR'):'';
  const name=id=>{const account=data.accounts.find(row=>row.id===id);return account?.display_name||account?.email||id||'Compte inconnu'};
  function selectSection(key,sellerId){
   selectPartners(false);
   active=key;
   sellerFilter=sellerId;
   search.value='';
   if(data){renderControls();renderList()}
   else refresh();
  }
  const tabButtons=Object.fromEntries(Object.entries(titles).map(([key,title])=>{
   const tab=button(title,()=>selectSection(key));
   nav.append(tab);return [key,tab];
  }));
  const partnerPanel=el('div');
  partnerPanel.hidden=true;
  const partnerTab=button('Provisional Seller Pages',()=>{
   selectPartners(true);
   if(!partnerPanel.childElementCount)void mountPartners(partnerPanel);
  });
  partnerTab.setAttribute('aria-pressed','false');
  if(mountPartners)nav.prepend(partnerTab);
  function selectPartners(selected){
   showingPartners=selected;
   partnerPanel.hidden=!selected;
   for(const node of [controls,feedback,list])node.hidden=selected;
   partnerTab.setAttribute('aria-pressed',String(selected));
   for(const [key,tab] of Object.entries(tabButtons))tab.setAttribute('aria-pressed',String(!selected&&active===key));
  }
  async function refresh(){
   if(busy)return;
   busy=true;refreshButton.disabled=true;feedback.textContent='Chargement…';
   try{data=await request(path,token);search.disabled=false;renderControls();renderList();feedback.textContent=''}
   catch(error){
    feedback.textContent=error.message==='Unauthorized'
     ? 'Session expirée. Déconnectez-vous puis reconnectez-vous.'
     : 'Impossible de charger l’administration. Cliquez sur Actualiser pour réessayer.';
   }
   finally{busy=false;refreshButton.disabled=false}
  }
  const refreshButton=button('Actualiser',refresh);
  controls.append(refreshButton);
  host.append(nav,controls,feedback,list,partnerPanel);
  function renderControls(){
   for(const [key,tab] of Object.entries(tabButtons)){
    const count=['reports','requests'].includes(key)?pending(data[key]):data[key].length;
    tab.textContent=titles[key]+' '+count;
    tab.setAttribute('aria-pressed',String(!showingPartners&&active===key));
   }
   const prior=filter?.dataset.section===active?filter.value:null;
   const options={
    listings:[['','Toutes les annonces'],['visible','Visibles'],['hidden','Masquées individuellement'],['archived','Compte archivé'],...['available','reserved','sold'].map(s=>[s,states[s]])],
    accounts:[['','Tous les comptes'],['gallery','Galeries'],['active','Actifs'],['archived','Archivés'],['verified','Certifiés']],
    reports:[['pending','À traiter'],['','Tous'],['resolved','Traités'],['dismissed','Classés']],
    requests:[['pending','À traiter'],['','Toutes'],...['approved','rejected','revoked'].map(s=>[s,states[s]])],
   };
   controls.replaceChildren(refreshButton,search);
   filter=options[active]?menu('Statut',options[active]):null;
   if(filter){filter.dataset.section=active;if(prior!==null)filter.value=prior;filter.onchange=renderList;controls.append(filter)}
   if(active==='listings'){
    if(sellerFilter)controls.append(button('Toutes les annonces',()=>selectSection('listings')));
    const selected=category?.value||'', sorted=order?.value||'recent';
    const categories=[...new Set(data.listings.map(row=>row.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
    category=menu('Catégorie',[['','Toutes les catégories'],...categories.map(value=>[value,value])]);
    category.value=categories.includes(selected)?selected:'';category.onchange=renderList;
    order=menu('Ordre des annonces',[['recent','Plus récentes'],['oldest','Plus anciennes'],['category','Par catégorie'],['seller','Par vendeur']]);
    order.value=sorted;order.onchange=renderList;controls.append(category,order);
   }
  }
  function decisions(host,row,actions){
   if(!actions.length)return;
   const box=el('div'), note=Object.assign(el('textarea'),{maxLength:500,rows:2,placeholder:'Note facultative dans l’historique'});
   note.setAttribute('aria-label','Note de modération');
   box.className='pef-decision';box.append(note);
   for(const action of actions){
    const control=button(label[action],async()=>{
    if(busy)return;
    if(action==='delete_account'&&!confirm('Supprimer définitivement le compte '+(row.email||row.display_name)+' ? Ses annonces seront retirées du feed.'))return;
    if(['archive','revoke'].includes(action)&&!confirm(label[action]+' ce compte ?'))return;
    busy=true;refreshButton.disabled=true;feedback.textContent='Enregistrement…';
    try{
     await request(path,token,'PATCH',{id:row.id,action,note:note.value});
     data=await request(path,token);renderControls();renderList();
     feedback.textContent='Décision enregistrée.';
     if(['delete_account','archive','restore','hide','show','approve','revoke'].includes(action))await reloadFeed().catch(()=>{feedback.textContent='Décision enregistrée. Actualisez le flux public pour voir le changement.'});
    }catch(error){feedback.textContent=error.message}
    finally{busy=false;refreshButton.disabled=false}
    });
    if(action==='delete_account')control.classList.add('pef-delete-account');
    box.append(control);
   }
   host.append(box);
  }
  function match(row,value){
   if(!value)return true;
   if(active==='listings')return ({visible:!row.is_hidden&&!row.seller_archived,hidden:!!row.is_hidden,archived:!!row.seller_archived})[value]??row.listing_status===value;
   if(active==='accounts')return ({gallery:!!row.gallery,active:!row.archived_at,archived:!!row.archived_at,verified:row.badge&&row.badge!=='none'})[value];
   return row.status===value;
  }
  function openEditor(host,row,onDetailsSaved){
   const edit=el('details');edit.append(el('summary','Modifier l’annonce et ses médias'));
   edit.addEventListener('toggle',()=>{
    if(!edit.open||edit.childElementCount>1)return;
    try{
     const photos=Array.isArray(row.photos)?row.photos:JSON.parse(row.photos||'[]');
     edit.append(editor({...row,photos,media:row.video_url?[{type:'video',url:row.video_url}]:[]},changes=>{
      Object.assign(row,changes);
      onDetailsSaved?.();
     }));
    }catch(error){
     console.error(error);
     edit.append(el('p','Impossible d’ouvrir l’éditeur de cette annonce.'));
    }
   });
   host.append(edit);
  }
  function renderList(){
   let rows=data[active].filter(row=>{
    if(!match(row,filter?.value))return false;
    if(active==='listings'&&sellerFilter&&row.seller_id!==sellerFilter)return false;
    if(active==='listings'&&category.value&&row.category!==category.value)return false;
    const haystack=[row.title,row.display_name,row.email,row.category,row.city,row.country,row.reason,row.details,row.business_name,row.actor,row.action,row.target,row.note,row.reporter,row.seller_id&&name(row.seller_id)].filter(Boolean).join(' ').toLocaleLowerCase();
    return haystack.includes(search.value.trim().toLocaleLowerCase());
   });
   if(active==='listings'){
    if(order.value==='oldest')rows.reverse();
    if(order.value==='category')rows.sort((a,b)=>(a.category||'').localeCompare(b.category||''));
    if(order.value==='seller')rows.sort((a,b)=>name(a.seller_id).localeCompare(name(b.seller_id)));
   }
   list.replaceChildren();
   if(!rows.length)list.append(el('p','Aucun résultat.'));
   for(const row of rows){
    let item;
    if(active==='listings'){
     const visibility=row.is_hidden?'Masquée':row.seller_archived?'Compte archivé':'Visible';
     const listingSummary=()=>[visibility,states[row.listing_status]||states.available,Number(row.negotiable)?'Négociable':'',row.category,name(row.seller_id)].filter(Boolean).join(' · ');
     item=card(row.title||'Sans titre',listingSummary());
     decisions(item.content,row,[row.is_hidden?'show':'hide']);
     openEditor(item.content,row,()=>{
      item.node.querySelector('summary strong').textContent=row.title;
      item.node.querySelector('summary small').textContent=listingSummary();
     });
    }else if(active==='accounts'){
     item=card(name(row.id),[row.gallery?'Galerie':'Compte',row.archived_at?'Archivé':'Actif',row.badge&&row.badge!=='none'?'Certifié':'',row.listings+' annonce(s)'].filter(Boolean).join(' · '));
     item.content.append(el('p',[row.email,row.id,formatDate(row.archived_at)].filter(Boolean).join(' · ')));
     if(row.listings>0)item.content.append(button('Voir les annonces ('+row.listings+')',()=>{
      if(filter)filter.value='';
      if(category)category.value='';
      selectSection('listings',row.id);
     }));
     if(row.email?.toLowerCase()!=='ndondina@muchimuchi.fr')decisions(item.content,row,[row.archived_at?'restore':'archive',...(Number(row.can_delete)?['delete_account']:[])]);
    }else if(active==='reports'){
     item=card(row.title||'Annonce indisponible',states[row.status]+' · '+row.reason);
     item.content.append(el('p',[row.reporter,formatDate(row.created_at)].filter(Boolean).join(' · ')),el('p',row.details||''));
     const target=data.listings.find(listing=>listing.id===row.object_id);
     if(target){
      if(!target.is_hidden)decisions(item.content,target,['hide']);
      openEditor(item.content,target);
     }
     decisions(item.content,row,row.status==='pending'?['resolve','dismiss']:['reopen']);
    }else if(active==='requests'){
     item=card(row.display_name||name(row.seller_id),states[row.status]||row.status);
     for(const value of [row.email,row.business_name,row.website,row.registration_number,row.country,row.details,row.admin_note])if(value)item.content.append(el('p',value));
     decisions(item.content,row,row.status==='pending'?['approve','reject']:row.status==='approved'?['revoke']:[]);
    }else{
     item=card(label[row.action]||row.action,[formatDate(row.created_at),row.actor].join(' · '));
     const target=data.listings.find(listing=>listing.id===row.target)?.title||data.accounts.find(account=>account.id===row.target)?.display_name||data.requests.find(application=>application.id===row.target)?.display_name||data.reports.find(report=>report.id===row.target)?.title||row.target;
     item.content.append(el('p',target),el('p',row.note||''));
    }
    list.append(item.node);
   }
  }
  search.oninput=renderList;
  search.disabled=true;
  refresh();
 }
 window.pefModeration={mount,submitVerification,report:(token,id,reason,details)=>request('/api/reports',token,'POST',{id,reason,details})};
})();
