import {chromium} from 'playwright';
let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>100_000)throw new Error('Input too large');}
const task=JSON.parse(input);const browser=await chromium.launch({headless:true,proxy:{server:'http://nexus-proxy:3128'},args:['--disable-quic','--disable-background-networking','--disable-extensions']});
try{
  const context=await browser.newContext({viewport:{width:1280,height:800},acceptDownloads:false,serviceWorkers:'block',permissions:[]});
  await context.route('**/*',async route=>{const u=new URL(route.request().url());if(!['https:','data:','about:'].includes(u.protocol))await route.abort();else await route.continue();});
  const page=await context.newPage();page.setDefaultTimeout(12_000);const actions=[];
  if(task.demo){await page.setContent('<main><h1>NexusIDE sandbox</h1><label>Test name <input aria-label="Test name"></label><button onclick="document.querySelector(\'h1\').textContent=\'Dashboard loaded\'">Continue</button></main>');}
  else await page.goto(task.url,{waitUntil:'domcontentloaded',timeout:30_000});
  for(const action of task.actions??[]){if(action.type==='click')await page.locator(action.selector).click();else if(action.type==='fill'){if(/password|secret|token|api.?key/i.test(action.selector))throw new Error('Credential fields are blocked');const locator=page.locator(action.selector);if(await locator.getAttribute('type')==='password')throw new Error('Password fields are blocked');await locator.fill(action.value??'');}else if(action.type==='scroll')await page.mouse.wheel(0,Math.max(-2000,Math.min(2000,Number(action.value)||500)));else if(action.type==='wait')await page.locator(action.selector).waitFor({state:'visible'});actions.push({type:action.type,selector:action.selector,status:'ok',time:new Date().toISOString(),screenshot:(await page.screenshot({type:'jpeg',quality:35})).toString('base64')});}
  console.log(JSON.stringify({url:page.url(),title:await page.title(),text:(await page.locator('body').innerText()).slice(0,20_000),actions,screenshot:(await page.screenshot({type:'jpeg',quality:55})).toString('base64')}));
}finally{await browser.close();}
