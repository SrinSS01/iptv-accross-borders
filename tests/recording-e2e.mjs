// Requires pnpm dev and native ffmpeg/ffprobe for test-only media generation.
// BROWSER_PATH=/usr/bin/brave node tests/recording-e2e.mjs
import { chromium } from 'playwright'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
const dir = await mkdtemp(join(tmpdir(), 'iptv-e2e-'))
const common=['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=320x180:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','12','-c:v','libx264','-preset','ultrafast','-g','48','-sc_threshold','0','-c:a','aac','-b:a','64k']
for(const kind of ['ts','fmp4','video','audio']){
 await mkdir(join(dir,kind))
 const options=kind==='video'?['-an']:kind==='audio'?['-vn']:[]
 const format=kind==='fmp4'?['-hls_segment_type','fmp4','-hls_flags','single_file']:[]
 execFileSync('ffmpeg',[...common,...options,'-f','hls','-hls_time','2','-hls_playlist_type','vod',...format,'-hls_segment_filename',join(dir,kind,kind==='fmp4'?'media.mp4':'segment%02d.ts'),join(dir,kind,'index.m3u8')])
}
const origin = process.env.TEST_ORIGIN || 'http://localhost:8443'
const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH, args: ['--no-sandbox'] })
function rewrite(text,kind){return text.replace(/^(segment\d+\.ts|media\.mp4)$/gm,`/api/streams/fixture/${kind}/$1`).replace(/URI="media\.mp4"/g,`URI="/api/streams/fixture/${kind}/media.mp4"`)}
async function inspect(page,count,minDuration){
 await page.locator('a[download]').first().waitFor({timeout:90000})
 assert.equal(await page.locator('a[download]').count(),count)
 for(const a of await page.locator('a[download]').all()){
 const result=await a.evaluate(async a=>({name:a.download,bytes:Array.from(new Uint8Array(await(await fetch(a.href)).arrayBuffer()))}))
 const file=join(dir,result.name);await writeFile(file,new Uint8Array(result.bytes))
 const probe=JSON.parse(execFileSync('ffprobe',['-v','quiet','-show_streams','-show_format','-of','json',file],{encoding:'utf8'}))
 assert(probe.streams.some(s=>s.codec_type==='video'));assert(probe.streams.some(s=>s.codec_type==='audio'))
 assert(Number(probe.format.duration)>=minDuration)
 const pcm=execFileSync('ffmpeg',['-v','error','-i',file,'-map','0:a:0','-f','f32le','-ac','1','pipe:1'],{maxBuffer:10*1024*1024})
 let peak=0;for(let i=0;i<pcm.length;i+=4)peak=Math.max(peak,Math.abs(pcm.readFloatLE(i)))
 assert(peak>0.01,'Saved audio must not be silent')
 console.log(JSON.stringify({file,seconds:probe.format.duration,bytes:result.bytes.length,audioPeak:peak}))
 }
}
try {
 for(const scenario of (process.env.SCENARIOS?.split(',') || ['vod','live','fmp4','separate-audio','discontinuity','retry','encrypted','matroska','cancel-finalization','network-failure','oversize','scheduled','hidden'])){
 const page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(30000)
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 if(['retry','matroska','cancel-finalization'].includes(scenario))await page.addInitScript((scenario)=>{const RealWorker=window.Worker;let failures=0;window.Worker=class extends RealWorker{postMessage(data,options){if(data.type==='EXEC'&&scenario==='cancel-finalization')return;if(data.type==='EXEC'&&failures++<(scenario==='matroska'?1:2)){setTimeout(()=>this.dispatchEvent(new MessageEvent('message',{data:{id:data.id,type:'EXEC',data:1}})),10);return}super.postMessage(data,options)}}},scenario)
 let liveRequests=0
 await page.route('**/api/streams/**',async route=>{
 const path=new URL(route.request().url()).pathname
 if(path.endsWith('.ts')||path.endsWith('.mp4')){
   if(path.endsWith('segment01.ts')&&scenario==='network-failure')return route.abort('failed')
   if(path.endsWith('segment01.ts')&&scenario==='oversize')return route.fulfill({body:'oversize',headers:{'content-length':String(33*1024*1024),'content-type':'video/mp2t'}})
   const kind=path.split('/').at(-2);const data=await readFile(join(dir,kind,basename(path)))
   const range=route.request().headers().range
   if(range){const [,start,end]=range.match(/bytes=(\d+)-(\d+)/);return route.fulfill({status:206,body:data.subarray(Number(start),Number(end)+1),headers:{'Content-Range':`bytes ${start}-${end}/${data.length}`,'Content-Type':'video/mp4'}})}
   return route.fulfill({body:data,contentType:'video/mp2t'})
 }
 let kind=scenario==='fmp4'?'fmp4':'ts'
 if(scenario==='separate-audio'){
   if(path.endsWith('test-hls'))return route.fulfill({body:'#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Default",DEFAULT=YES,URI="/api/streams/fixture/audio/index.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=320x180,AUDIO="audio"\n/api/streams/fixture/video/index.m3u8\n',contentType:'application/vnd.apple.mpegurl'})
   kind=path.includes('/audio/')?'audio':'video'
 }
 let manifest=await readFile(join(dir,kind,'index.m3u8'),'utf8')
 if(['live','scheduled','hidden'].includes(scenario)){
   // Preflight and initial collection see segments 0..2, refreshes add 3..5.
   const last=Math.min(5,2+Math.max(0,liveRequests++-1))
   manifest='#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:0\n'+Array.from({length:last+1},(_,i)=>`#EXTINF:2,\nsegment${String(i).padStart(2,'0')}.ts\n`).join('')
 }
 if(scenario==='discontinuity')manifest=manifest.replace('#EXTINF:2.000000,\nsegment03.ts','#EXT-X-DISCONTINUITY\n#EXTINF:2.000000,\nsegment03.ts')
 if(scenario==='encrypted')manifest=manifest.replace('#EXTM3U','#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"')
 return route.fulfill({body:rewrite(manifest,kind),contentType:'application/vnd.apple.mpegurl'})
 })
 await page.goto(`${origin}/test/wasm`)
 await page.getByRole('button',{name:'Record channel',exact:true}).click()
 if(scenario==='scheduled'){
   const time=await page.evaluate(()=>{const now=Date.now();const local=t=>new Date(t-new Date(t).getTimezoneOffset()*60000).toISOString().slice(0,19);return {start:local(now+12000),end:local(now+17000)}})
   await page.locator('#record-start').fill(time.start)
   await page.locator('#record-end').fill(time.end)
   await page.getByRole('button',{name:'Schedule recording',exact:true}).click()
 }else await page.getByRole('button',{name:'Start recording',exact:true}).click()
 try{
 if(scenario==='cancel-finalization'){
   await page.getByRole('button',{name:'Cancel finalization',exact:true}).first().click({timeout:90000})
   await page.getByRole('button',{name:'Record channel',exact:true}).waitFor()
   assert.equal(await page.locator('a[download]').count(),0)
 }else if(scenario==='encrypted'){
   await page.getByText(/This stream is encrypted/).waitFor()
   assert.equal(await page.locator('a[download]').count(),0)
   await page.getByRole('radio',{name:/Browser capture/}).check()
 }else{
   if(scenario==='scheduled')await page.getByRole('button',{name:'Cancel schedule',exact:true}).first().waitFor()
   if(scenario==='hidden'){
     await page.getByRole('button',{name:'End recording',exact:true}).first().waitFor()
     await page.waitForTimeout(2500)
     await page.evaluate(()=>{Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'))})
   }
   if(scenario==='live'){
     await page.getByRole('button',{name:'End recording',exact:true}).first().waitFor()
     await page.waitForTimeout(3500)
     await page.getByRole('button',{name:'End recording',exact:true}).first().click()
   }
   if(scenario==='retry')await page.getByRole('button',{name:'Retry finalization',exact:true}).click({timeout:90000})
   await inspect(page,scenario==='discontinuity'?2:1,['live','scheduled','hidden'].includes(scenario)?4:scenario==='discontinuity'?5.9:['network-failure','oversize'].includes(scenario)?1.9:11.9)
 }
 assert.deepEqual(errors,[])
 console.log('PASS',scenario)
 await page.screenshot({path:join(dir,`${scenario}.png`)})
 }catch(error){console.error(await page.locator('body').innerText());throw error}
 await page.close()
 }
} finally { await browser.close() }
