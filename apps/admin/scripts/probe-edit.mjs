import { chromium } from '@playwright/test';
import fs from 'fs';
const base='http://127.0.0.1:7301'; const out='C:/temp/edit-probe'; fs.mkdirSync(out,{recursive:true});
const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:1440,height:980}}); const p=await ctx.newPage();
let ce=[],pe=[],aw=[];
p.on('console',m=>{if(m.type()==='error')ce.push(m.text().slice(0,160))});
p.on('pageerror',e=>pe.push('PAGEERR '+e.message.slice(0,160)));
p.on('response',r=>{const u=r.url();const m=r.request().method();if(u.includes('/api/')&&m!=='GET')aw.push(`${r.status()} ${m} ${u.replace(base,'')}`)});
const reset=()=>{ce=[];pe=[];aw=[]};
async function snap(name){await p.screenshot({path:`${out}/${name}.png`,fullPage:true})}
async function info(){const inputs=await p.locator('input,textarea,select').count();const btns=await p.$$eval('button',bs=>bs.map(b=>b.textContent.trim()).filter(Boolean).slice(0,18));return {inputs,btns}}
// login
await p.goto(base+'/login',{waitUntil:'domcontentloaded'});
await p.fill('#email','admin@webshop-crm.local');await p.fill('#password','admin12345');
await p.click('button[type=submit]');await p.waitForURL('**/launch',{timeout:10000}).catch(()=>{});
await p.waitForSelector('.launch-card:not(.launch-add)',{timeout:10000}).catch(()=>{});
await p.locator('.launch-card:not(.launch-add)').first().click().catch(()=>{});await p.waitForTimeout(1000);

const R={};
// PRODUCTS LIST
reset(); await p.goto(base+'/products',{waitUntil:'domcontentloaded'});await p.waitForTimeout(1800);
R.productsList={...await info(),ce:[...ce],pe:[...pe], url:p.url()}; await snap('products-list');
// click first product
reset();
const firstProd=p.locator('a[href*="/products/"], tr[role="button"], tbody tr, .card').first();
await firstProd.click().catch(e=>R.clickErr=String(e).slice(0,100)); await p.waitForTimeout(1800);
R.productDetail={...await info(),ce:[...ce],pe:[...pe], url:p.url()}; await snap('product-detail');
// try to edit: find a text input, change it, find a Save/Opslaan button
reset();
const ti=p.locator('input[type=text], input:not([type])').first();
let editTried={};
if(await ti.count()){ const before=await ti.inputValue().catch(()=>''); await ti.fill((before||'X')+' (uitest)').catch(()=>{}); editTried.filled=true;
  const saveBtn=p.locator('button:has-text("Opslaan"), button:has-text("Bewaar"), button:has-text("Save"), button[type=submit]').first();
  editTried.saveBtnFound=await saveBtn.count()>0;
  if(editTried.saveBtnFound){await saveBtn.click().catch(()=>{}); await p.waitForTimeout(1500);} }
editTried.writeCalls=[...aw]; editTried.ce=[...ce]; editTried.pe=[...pe];
R.productEditAttempt=editTried; await snap('product-edit-after-save');
// NEW PRODUCT
reset(); await p.goto(base+'/products/new',{waitUntil:'domcontentloaded'}).catch(()=>{});await p.waitForTimeout(1800);
R.productNew={...await info(),ce:[...ce],pe:[...pe], url:p.url()}; await snap('product-new');
// SHOP EDIT (control)
reset();
const cremaId=await p.evaluate(async()=>{const r=await fetch('/api/shops?limit=100',{credentials:'include'});const j=await r.json();return (j.items||[]).find(s=>s.slug==='crema')?.id});
await p.goto(base+'/shops/'+cremaId,{waitUntil:'domcontentloaded'});await p.waitForTimeout(1800);
const editShopBtn=p.locator('button:has-text("Bewerk"), button:has-text("Wijzig"), button:has-text("Bewerken"), button[aria-label*="ewerk"]').first();
R.shopDetail={...await info(), editShopBtnFound:await editShopBtn.count()>0, ce:[...ce],pe:[...pe]};
await snap('shop-detail-full');
console.log(JSON.stringify(R,null,2));
await b.close();
