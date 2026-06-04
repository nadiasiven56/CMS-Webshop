import { chromium } from '@playwright/test';
import fs from 'fs';
const base='http://127.0.0.1:7301'; const out='C:/temp/edit2-qa'; fs.mkdirSync(out,{recursive:true});
const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:1440,height:980}}); const p=await ctx.newPage();
let ce=[],pe=[],aw=[];
p.on('console',m=>{if(m.type()==='error')ce.push(m.text().slice(0,150))});
p.on('pageerror',e=>pe.push('PAGEERR '+e.message.slice(0,150)));
p.on('response',r=>{const u=r.url();const m=r.request().method();if(u.includes('/api/')&&m!=='GET')aw.push(`${r.status()} ${m} ${u.replace('http://127.0.0.1:7301','').split('?')[0]}`)});
const reset=()=>{ce=[];pe=[];aw=[]};
await p.goto(base+'/login',{waitUntil:'domcontentloaded'});
await p.fill('#email','admin@webshop-crm.local');await p.fill('#password','admin12345');
await p.click('button[type=submit]');await p.waitForURL('**/launch',{timeout:10000}).catch(()=>{});
await p.waitForSelector('.launch-card:not(.launch-add)',{timeout:10000}).catch(()=>{});
await p.locator('.launch-card:not(.launch-add)').first().click().catch(()=>{});await p.waitForTimeout(1000);
const ids=await p.evaluate(async()=>{
  const g=async u=>{const r=await fetch(u,{credentials:'include'});return r.ok?r.json():null};
  const sh=await g('/api/shops?limit=100'); const crema=(sh?.items||[]).find(s=>s.slug==='crema');
  const pr=await g('/api/products?limit=1');
  const cu=await g('/api/customers?limit=1&shop_id='+crema?.id);
  const or=await g('/api/orders?limit=1');
  const st=await g('/api/stock?page=1&pageSize=1');
  const stItem=(st?.items||[])[0]||{};
  return { cremaId:crema?.id,
    pid:(pr?.items||[])[0]?.id, ptitle:(pr?.items||[])[0]?.title,
    cid:(cu?.items||[])[0]?.id, oid:(or?.items||[])[0]?.id,
    sid: stItem.itemId||stItem.id||stItem.inventoryItemId };
});
const pages=[
  ['product-detail','/products/'+ids.pid],
  ['product-new','/products/new'],
  ['customer-detail','/customers/'+ids.cid],
  ['order-detail','/orders/'+ids.oid],
  ['stock-detail','/stock/'+ids.sid],
];
const R={ids:{...ids, ptitle:undefined}, pages:[]};
for(const [name,path] of pages){
  reset(); await p.goto(base+path,{waitUntil:'domcontentloaded'}); await p.waitForTimeout(1700);
  const txt=await p.locator('body').innerText().catch(()=>'');
  // list-heuristic: the list toolbar shows status tabs "Concept" + pagination "Volgende"
  const looksLikeList=/Concept\s*\d/.test(txt) && /Volgende/.test(txt);
  const inputs=await p.locator('input,textarea,select').count();
  await p.screenshot({path:`${out}/${name}.png`,fullPage:true});
  R.pages.push({name,url:p.url().replace(base,''),chars:txt.length,inputs,looksLikeList,errors:[...ce,...pe,...aw.filter(x=>x.startsWith('4')||x.startsWith('5'))]});
}
// REAL EDIT on product detail
reset();
let edit={done:false};
await p.goto(base+'/products/'+ids.pid,{waitUntil:'domcontentloaded'}); await p.waitForTimeout(1500);
const titleInput=p.locator('input').filter({hasText:''}).first();
const inp=p.locator('input[type=text], input:not([type]):not([type=checkbox]):not([type=radio])').first();
if(await inp.count()){
  const before=await inp.inputValue().catch(()=>null);
  edit.before=before;
  await inp.fill((before||'Test')+' ✏').catch(()=>{});
  const save=p.locator('button:has-text("Opslaan"),button:has-text("Bewaar"),button[type=submit]').first();
  edit.saveFound=await save.count()>0;
  if(edit.saveFound){ await save.click().catch(()=>{}); await p.waitForTimeout(1500); edit.writeCalls=[...aw]; edit.done=true;
    // revert
    if(before){ await p.goto(base+'/products/'+ids.pid,{waitUntil:'domcontentloaded'}); await p.waitForTimeout(1000);
      const inp2=p.locator('input[type=text], input:not([type]):not([type=checkbox]):not([type=radio])').first();
      if(await inp2.count()){ await inp2.fill(before); const s2=p.locator('button:has-text("Opslaan"),button[type=submit]').first(); if(await s2.count())await s2.click().catch(()=>{}); await p.waitForTimeout(800);} }
  }
}
edit.errors=[...ce,...pe];
R.productEdit=edit;
console.log(JSON.stringify(R,null,2));
await b.close();
