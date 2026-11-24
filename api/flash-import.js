const pages=new Set(['galeriaparislisboa.com','www.galeriaparislisboa.com']);
const images=new Set([...pages,'images.squarespace-cdn.com','static1.squarespace.com']);
function allowed(value,hosts,base){
 try{
  const url=new URL(value,base);
  return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&hosts.has(url.hostname)?url:null;
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
module.exports=async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed.'});
 const image=req.query?.image==='1';
 const input=req.query?.url;
 const hosts=image?images:pages;
 const url=typeof input==='string'&&input.length<=2500?allowed(input,hosts):null;
 if(!url)return res.status(400).json({error:'Flash import currently supports product links from galeriaparislisboa.com.'});
 try{
  if(image&&url.hostname==='images.squarespace-cdn.com')url.searchParams.set('format','1500w');
  const result=await retrieve(url,hosts,image?4*1024*1024:3*1024*1024,image?'image/jpeg,image/png,image/webp':'text/html,application/xhtml+xml');
  if(image){res.setHeader('Content-Type',result.type);return res.status(200).send(result.body)}
  return res.status(200).json(extract(result.body.toString('utf8'),result.url));
 }catch(error){return res.status(422).json({error:error.message||'Import unavailable.'})}
};
