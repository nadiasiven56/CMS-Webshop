import { chromium } from '@playwright/test';
import fs from 'fs';
const base='http://127.0.0.1:7301'; const out='C:/temp/waveD-qa'; fs.mkdirSync(out,{recursive:true});
const pages=[['orders','/orders'],['finance','/finance'],['ledger','/ledger']];
const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:1440,height:900}}); const p=await ctx.newPage();
let ce=[],pe=[],ae=[];
p.on('console',m=>{if(m.type()==='error')ce.push(m.text().slice(0,200))});
p.on('pageerror',e=>pe.push('PAGEERR: '+e.message.slice(0,200)));
p.on('response',r=>{const u=r.url();if(u.includes('/api/')&&r.status()>=400)ae.push(`${r.status()} ${u.replace(base,'')}`)});
await p.goto(base+'/login',{waitUntil:'domcontentloaded'});
await p.fill('#email','admin@webshop-crm.local'); await p.fill('#password','admin12345');
await p.click('button[type=submit]'); await p.waitForURL('**/launch',{timeout:10000}).catch(()=>{});
await p.waitForSelector('.launch-card:not(.launch-add)',{timeout:10000}).catch(()=>{});
await p.locator('.launch-card:not(.launch-add)').first().click().catch(()=>{}); await p.waitForTimeout(1200);
const rep=[];
for(const [name,path] of pages){
  ce=[];pe=[];ae=[];
  await p.goto(base+path,{waitUntil:'domcontentloaded'}); await p.waitForTimeout(1900);
  const txt=await p.locator('body').innerText().catch(()=>'');
  const looksErr=await p.locator('text=/Something went wrong|Cannot read|undefined is not|is not a function/i').count().catch(()=>0);
  await p.screenshot({path:`${out}/${name}.png`,fullPage:true});
  rep.push({name,url:p.url(),chars:txt.length,rendered:txt.length>400&&looksErr===0,consoleErrors:ce.slice(0,4),pageErrors:pe.slice(0,3),apiErrors:ae.slice(0,5),
    hasChannelUI:/kanaal|channel|webshop|bol|amazon/i.test(txt), hasAlleShops:/alle shops/i.test(txt)});
}
console.log(JSON.stringify(rep,null,2));
await b.close();
