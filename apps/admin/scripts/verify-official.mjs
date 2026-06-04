import { chromium } from '@playwright/test';
import fs from 'fs';
const base='http://127.0.0.1:7301'; const out='C:/temp/official-qa'; fs.mkdirSync(out,{recursive:true});
const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:1440,height:980}}); const p=await ctx.newPage();
let ce=[],pe=[],ae=[];
p.on('console',m=>{if(m.type()==='error')ce.push(m.text().slice(0,180))});
p.on('pageerror',e=>pe.push('PAGEERR '+e.message.slice(0,180)));
p.on('response',r=>{const u=r.url();if(u.includes('/api/')&&r.status()>=400)ae.push(`${r.status()} ${u.replace(base,'')}`)});
// login + pick shop
await p.goto(base+'/login',{waitUntil:'domcontentloaded'});
await p.fill('#email','admin@webshop-crm.local'); await p.fill('#password','admin12345');
await p.click('button[type=submit]'); await p.waitForURL('**/launch',{timeout:10000}).catch(()=>{});
await p.waitForSelector('.launch-card:not(.launch-add)',{timeout:10000}).catch(()=>{});
await p.locator('.launch-card:not(.launch-add)').first().click().catch(()=>{}); await p.waitForTimeout(1000);
// crema shop id
const cremaId=await p.evaluate(async()=>{const r=await fetch('/api/shops?limit=100',{credentials:'include'});const j=await r.json();const c=(j.items||[]).find(s=>s.slug==='crema');return c&&c.id;});
const pages=[['shop-detail','/shops/'+cremaId],['channels','/channels'],['dashboard','/'],['orders','/orders'],['finance','/finance']];
const rep=[];
for(const [name,path] of pages){
  ce=[];pe=[];ae=[];
  await p.goto(base+path,{waitUntil:'domcontentloaded'}); await p.waitForTimeout(2000);
  const txt=await p.locator('body').innerText().catch(()=>'');
  const looksErr=await p.locator('text=/Something went wrong|Cannot read|undefined is not|is not a function/i').count().catch(()=>0);
  await p.screenshot({path:`${out}/${name}.png`,fullPage:true});
  rep.push({name,url:p.url(),chars:txt.length,rendered:txt.length>400&&looksErr===0,
    consoleErrors:ce.slice(0,3),pageErrors:pe.slice(0,2),apiErrors:ae.slice(0,4),
    hasStorefrontToken:/storefront-token|wcrm_pk|publishable/i.test(txt),
    hasBetalingen:/betaling|mollie/i.test(txt)});
}
// open a channel config drawer to confirm official fields render
ce=[];pe=[];
await p.goto(base+'/channels',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(1500);
const cfg=p.locator('button:has-text("Configureren")').first();
let drawer={opened:false};
if(await cfg.count()){ await cfg.click().catch(()=>{}); await p.waitForTimeout(1200);
  const dtxt=await p.locator('body').innerText().catch(()=>'');
  drawer={opened:true, hasOfficialFields:/client|secret|refresh|marketplace|environment|omgeving|offici/i.test(dtxt), errors:[...ce,...pe].slice(0,3)};
  await p.screenshot({path:`${out}/channel-config-drawer.png`,fullPage:true});
}
console.log(JSON.stringify({pages:rep, drawer},null,2));
await b.close();
