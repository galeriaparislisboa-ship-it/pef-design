const pages=new Set(['galeriaparislisboa.com','www.galeriaparislisboa.com']);
const images=new Set([...pages,'images.squarespace-cdn.com','static1.squarespace.com']);
const vintedPages=new Set(['www.vinted.pt','vinted.pt']);
const vintedImages=new Set(Array.from({length:4},(_,index)=>'images'+(index+1)+'.vinted.net'));
const etsyPages=new Set(['www.etsy.com','etsy.com']);
const etsyImages=new Set(['i.etsystatic.com']);
for(const host of [...vintedImages,...etsyImages])images.add(host);
function allowed(value,hosts,base){
 try{
  const url=new URL(value,base);
  return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&(hosts.has(url.hostname)||(hosts===images&&/(?:^|\.)(?:cdninstagram\.com|fbcdn\.net)$/.test(url.hostname)))?url:null;
 }catch{return null}
}
async function retrieve(url,hosts,max,accept){
 for(let redirects=0;redirects<4;redirects++){
  const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(8000),headers:{Accept:accept}});
  if([301,302,303,307,308].includes(response.status)){
   const location=response.headers.get('location');
   url=location&&allowed(location,hosts,url);
   if(!url)throw Error('Redirect outside the supported site.');
   continue;
  }
  const type=(response.headers.get('content-type')||'').split(';')[0].toLowerCase();
  if(!response.ok||!response.body||!accept.split(',').includes(type))throw Error('This page or image could not be loaded.');
  if(Number(response.headers.get('content-length'))>max)throw Error('The file exceeds the import size limit.');
  const reader=response.body.getReader(),buffers=[];
  let length=0;
  try{
   for(;;){
    const {done,value}=await reader.read();
    if(done)break;
    length+=value.length;
    if(length>max)throw Error('The file exceeds the import size limit.');
    buffers.push(Buffer.from(value));
   }
  }finally{await reader.cancel().catch(()=>{})}
  return {body:Buffer.concat(buffers,length),type,url};
 }
 throw Error('Too many redirects from the source site.');
}
function decode(text){
 return String(text||'').replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi,(match,code)=>{
  const key=code.toLowerCase();
  if(key[0]!=='#')return {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '}[key];
  const value=key[1]==='x'?parseInt(key.slice(2),16):Number(key.slice(1));
  return value<=0x10ffff?String.fromCodePoint(value):match;
 });
}
const plain=text=>decode(String(text||'').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
function euroPrice(value){
 let amount=plain(value).replace(/[\s\u202f€]/g,'');
 if(/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(amount))amount=amount.replace(/\./g,'');
 if(/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(amount))amount=amount.replace(/,/g,'');
 amount=amount.replace(',','.');
 return /^\d+(?:\.\d{1,2})?$/.test(amount)&&Number(amount)>0&&Number.isFinite(Number(amount))?Number(amount).toFixed(2):null;
}
function extractPrice(product,meta,html){
 for(const offer of [product?.offers].flat()){
  if(String(offer?.priceCurrency||'').toUpperCase()==='EUR'){
   const price=euroPrice(offer.price);
   if(price)return price;
  }
 }
 for(const key of ['product:price','og:price']){
  if(meta.get(key+':currency')?.[0]?.toUpperCase()==='EUR'){
   const price=euroPrice(meta.get(key+':amount')?.[0]);
   if(price)return price;
  }
 }
 const visible=html.match(/<[^>]+class=["'][^"']*\b(?:product-price|ProductItem-product-price)\b[^"']*["'][^>]*>([\s\S]{0,600}?)(?=<\/(?:div|p)>)/i)?.[1];
 const match=plain(visible).match(/(?:€\s*([\d][\d.,\s]*)|([\d][\d.,\s]*)\s*€)/);
 return match?euroPrice(match[1]||match[2]):null;
}
function extract(html,base){
 const meta=new Map();
 for(const tag of html.matchAll(/<meta\b[^>]*>/gi)){
  const attrs=Object.fromEntries([...tag[0].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(([,k,a,b])=>[k.toLowerCase(),a??b]));
  const key=attrs.property||attrs.name;
  if(key&&attrs.content)meta.set(key,[...(meta.get(key)||[]),attrs.content]);
 }
 let product;
 function find(node){
  if(!node||typeof node!=='object')return;
  if([node['@type']].flat().some(type=>type==='Product'||type?.endsWith?.('/Product')))return node;
  for(const child of Object.values(node)){const found=find(child);if(found)return found}
 }
 for(const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
  try{product=find(JSON.parse(match[1]));if(product)break}catch{}
 }
 const links=new Map();
 function add(value){
  if(!value)return;
  const url=allowed(decode(value),images,base);
  if(url){url.hash='';const key=url.origin+url.pathname;if(!links.has(key))links.set(key,url.href)}
 }
 for(const image of [product?.image].flat())add(typeof image==='string'?image:image?.url||image?.contentUrl);
 for(const image of meta.get('og:image')||[])add(image);
 const gallery=html.match(/<[^>]+class=["'][^"']*(?:ProductItem-gallery|product-gallery)[^"']*["'][^>]*>[\s\S]{0,150000}?(?=<[^>]+class=["'][^"']*(?:ProductItem-details|product-details)[^"']*["']|<\/main>)/i)?.[0];
 if(gallery){
  for(const hit of gallery.matchAll(/<img\b[^>]*\b(?:data-image|data-src|src)=["']([^"']+)["'][^>]*>/gi)){
   add(hit[1]);if(links.size>=5)break;
  }
 }
 if(!product&&!gallery&&!meta.get('og:type')?.includes('product'))throw Error('Enter a product page URL.');
 const headings=[...html.matchAll(/<h1\b([^>]*)>([\s\S]*?)<\/h1>/gi)];
 const productHeading=headings.find(([,attributes])=>/product[-_ ]?(?:item[-_ ]?)?title/i.test(attributes));
 const genericTitle=/^Art, design and bespoke creations|^Galeria Paris Lisboa\s*[–—-]/i;
 const visibleHeading=headings.map(([, ,value])=>plain(value)).find(value=>value&&!genericTitle.test(value));
 const slug=decodeURIComponent(base.pathname.split('/').filter(Boolean).at(-1)||'').replace(/-/g,' ');
 const title=[productHeading?.[2],product?.name,visibleHeading,meta.get('og:title')?.[0],slug].map(plain).find(value=>value&&!genericTitle.test(value));
 if(!title||!links.size)throw Error('No product title and photos were found.');
 return {title,price:extractPrice(product,meta,html),description:plain(product?.description||meta.get('og:description')?.[0]||meta.get('description')?.[0]),photos:[...links.values()].slice(0,5)};
}
function extractVinted(html,url){
 const product=extract(html,url);
 const gallery=new Map();
 for(const [tag] of html.matchAll(/<img\b[^>]*>/gi)){
  const index=Number(tag.match(/\bdata-testid=["']item-photo-(\d+)--img["']/i)?.[1]);
  const source=tag.match(/\ssrc=["']([^"']+)["']/i)?.[1];
  if(!index||!source||gallery.has(index))continue;
  const photo=allowed(decode(source),vintedImages,url);
  if(photo)gallery.set(index,photo.href);
 }
 if(gallery.size)product.photos=[...new Set([...gallery].sort(([a],[b])=>a-b).map(([,photo])=>photo))].slice(0,5);
 return product;
}
async function importEtsy(id){
 const key=(process.env.ETSY_API_KEY||'').trim();
 if(!key)throw Error('Etsy automatic import is not configured. Enter listing details and add photos manually.');
 const response=await fetch('https://openapi.etsy.com/v3/application/listings/'+id+'?includes=Shop,Images',{
  headers:{'x-api-key':key,Accept:'application/json'},
  redirect:'error',
  signal:AbortSignal.timeout(8000)
 });
 if(!response.ok)throw Error('Etsy could not provide this listing. Check the link or enter the details manually.');
 const listing=await response.json();
 if(!listing.title||listing.state!=='active')throw Error('This Etsy listing is unavailable.');
 const photos=(listing.images||[]).toSorted((a,b)=>a.rank-b.rank)
  .map(image=>allowed(image.url_570xN||image.url_fullxfull,etsyImages)?.href).filter(Boolean);
 const shop=listing.shop?.shop_name;
 const {amount,divisor,currency_code:currency}=listing.price||{};
 return {title:plain(listing.title),description:plain(listing.description),
  price:currency==='EUR'&&divisor>0?euroPrice(amount/divisor):null,photos:[...new Set(photos)].slice(0,5),
  seller:shop?{name:shop,url:'https://www.etsy.com/shop/'+encodeURIComponent(shop)}:null};
}
function instagramPost(value){
 const url=allowed(value,new Set(['instagram.com','www.instagram.com']));
 return url?.pathname.match(/^\/(?:p|reel)\/([A-Za-z0-9_-]+)\/?$/)?.[1];
}
async function importInstagram(post,handle){
 const username=String(handle||'').trim().replace(/^@/,'');
 if(!/^[a-z0-9_.]{1,30}$/i.test(username))throw Error('Enter the public professional Instagram account as @username.');
 const token=(process.env.INSTAGRAM_ACCESS_TOKEN||'').trim();
 if(!token||token.startsWith('IG'))throw Error('Instagram import requires a Meta Facebook Login token with Business Discovery access.');
 const graph=new URL('https://graph.facebook.com/v24.0/17841434467277923');
 const timeout=AbortSignal.timeout(8500);
 const fields='permalink,caption,media_type,media_url,children{media_type,media_url}';
 let cursor='';
 for(let page=0;page<4;page++){
  const after=cursor?'.after('+cursor+')':'';
  graph.searchParams.set('fields','business_discovery.username('+username+'){media.limit(50)'+after+'{'+fields+'}}');
  const response=await fetch(graph,{headers:{Authorization:'Bearer '+token},signal:timeout,redirect:'error'});
  const data=await response.json();
  if(!response.ok||data.error)throw Error('Meta could not read this Instagram account. Check that it is a public professional account and that Business Discovery is enabled.');
  const media=data.business_discovery?.media;
  const entry=media?.data?.find(item=>instagramPost(item.permalink)===post);
  if(entry){
   const items=entry.media_type==='CAROUSEL_ALBUM'?entry.children?.data||[]:[entry];
   const photos=[...new Set(items.filter(item=>item.media_type==='IMAGE'&&allowed(item.media_url,images)).map(item=>item.media_url))].slice(0,5);
   if(!photos.length)throw Error('Meta did not provide downloadable photos for this post.');
   const caption=String(entry.caption||'').replace(/(^|\s)#[^\s#]+/g,' ').trim();
   const lines=caption.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
   const title=lines[0]||'';
   const description=lines.slice(1).join(' ')||title;
   return {title,description,photos,price:null};
  }
  cursor=media?.paging?.cursors?.after;
  if(!cursor||!(/^[a-z0-9_=+\/-]+$/i.test(cursor)))break;
 }
 throw Error('Post not found in the latest publications available for this account. Check the link and @username.');
}
module.exports=async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed.'});
 const image=req.query?.image==='1';
 const input=req.query?.url;
 const post=!image&&typeof input==='string'&&input.length<=2500&&instagramPost(input);
 if(post){
  try{return res.status(200).json(await importInstagram(post,req.query?.instagramAccount))}
  catch(error){
   const message=error.name==='TimeoutError'||error instanceof TypeError?'Instagram request unavailable. Try again.':error.message;
   return res.status(422).json({error:message||'Instagram import unavailable.'});
  }
 }
 const etsy=!image&&typeof input==='string'&&input.length<=2500?allowed(input,etsyPages):null;
 if(etsy){
  const id=etsy.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?listing\/(\d+)(?:\/[^/]+)?\/?$/i)?.[1];
  if(!id)return res.status(400).json({error:'Enter an Etsy listing URL.'});
  try{return res.status(200).json(await importEtsy(id))}
  catch(error){return res.status(422).json({error:error.message||'Etsy import unavailable.'})}
 }
 const vinted=!image&&typeof input==='string'&&input.length<=2500?allowed(input,vintedPages):null;
 if(vinted&&!/^\/items\/\d+(?:-[^/]+)?\/?$/.test(vinted.pathname))return res.status(400).json({error:'Enter a Vinted Portugal listing URL.'});
 if(vinted)vinted.search='';
 const hosts=image?images:vinted?vintedPages:pages;
 const url=vinted||(typeof input==='string'&&input.length<=2500?allowed(input,hosts):null);
 if(!url)return res.status(400).json({error:'Enter a Galerie Paris–Lisboa product URL, a Vinted Portugal or Etsy listing URL, or an Instagram post URL.'});
 try{
  if(image&&url.hostname==='images.squarespace-cdn.com')url.searchParams.set('format','1500w');
  const result=await retrieve(url,hosts,image?4*1024*1024:3*1024*1024,image?'image/jpeg,image/png,image/webp':'text/html,application/xhtml+xml');
  if(image){res.setHeader('Content-Type',result.type);return res.status(200).send(result.body)}
  const html=result.body.toString('utf8');
  return res.status(200).json(vinted?extractVinted(html,result.url):extract(html,result.url));
 }catch(error){return res.status(422).json({error:error.message||'Import unavailable.'})}
};
