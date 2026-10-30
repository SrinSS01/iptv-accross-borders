import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
const raw = fs.readFileSync(new URL('../src/recorders/hls-policy.ts',import.meta.url),'utf8')
const {outputText}=ts.transpileModule(raw,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}})
const code=outputText.replace('from "m3u8-parser"',`from ${JSON.stringify(import.meta.resolve('m3u8-parser'))}`)
const {parsePlaylist,chooseVariant,pendingSegments,buildLocalPlaylist,resourceIdentity}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const base='https://test.invalid/api/streams/test'
const live='#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:10\n#EXTINF:2,\na.ts\n#EXTINF:2,\nb.ts\n#EXTINF:2,\nc.ts\n'
test('live recording starts at edge and ignores older entries on refresh',()=>{
 const p=parsePlaylist(live,base)
 assert.deepEqual(pendingSegments(p,undefined,true).map(s=>s.sequence),[12])
 assert.deepEqual(pendingSegments(p,12,false),[])
 const next=parsePlaylist(live+'#EXTINF:2,\nd.ts\n',base)
 assert.deepEqual(pendingSegments(next,12,false).map(s=>s.sequence),[13])
 assert.throws(()=>pendingSegments(parsePlaylist(live.replace('SEQUENCE:10','SEQUENCE:20'),base),12,false),/missing/)
 assert.throws(()=>pendingSegments(p,30,false),/restarted/)
})
test('fixed rendition picks highest at or below 720p and resolves default audio',()=>{
 const p=parsePlaylist('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="English",DEFAULT=YES,URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080,AUDIO="a"\n1080.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=1500000,RESOLUTION=1280x720,AUDIO="a"\n720.m3u8\n',base)
 assert.equal(chooseVariant(p.variants).height,720)
 assert.equal(p.audioGroups.a[0].default,true)
 assert.equal(p.audioGroups.a[0].uri,'https://test.invalid/api/streams/audio.m3u8')
})
test('rejects encrypted and unsupported playlists before collecting',()=>{
 assert.throws(()=>parsePlaylist(live.replace('#EXTINF:2,','#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:2,'),base),/encrypted/)
 assert.throws(()=>parsePlaylist(live.replace('#EXTM3U','#EXTM3U\n#EXT-X-SKIP:SKIPPED-SEGMENTS=2'),base),/not supported/)
 assert.throws(()=>parsePlaylist('<html>error</html>',base),/HLS playlist/)
})
test('byte ranges, initialization data and discontinuity epochs survive parsing',()=>{
 const p=parsePlaylist('#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MAP:URI="init.mp4",BYTERANGE="100@0"\n#EXTINF:2,\n#EXT-X-BYTERANGE:20@100\nmedia.mp4\n#EXT-X-DISCONTINUITY\n#EXTINF:2,\n#EXT-X-BYTERANGE:30@120\nmedia.mp4\n#EXT-X-ENDLIST',base)
 assert.deepEqual(p.segments.map(s=>s.range),[{offset:100,length:20},{offset:120,length:30}])
 assert.notEqual(p.segments[0].timeline,p.segments[1].timeline)
 assert.equal(p.segments[0].map.range.length,100)
 assert.equal(p.endList,true)
 assert.equal(pendingSegments(p,undefined,true).length,2)
})
test('local finalization manifest references only collected files',()=>{
 const output=buildLocalPlaylist([{duration:2,file:'one.m4s',mapFile:'init.mp4'},{duration:2,file:'two.m4s',mapFile:'init.mp4'}])
 assert.equal(output.match(/EXT-X-MAP/g).length,1)
 assert.match(output,/#EXT-X-ENDLIST/)
 assert.doesNotMatch(output,/https?:/)
})
test('refreshed signed resource URLs retain a stable deduplication identity',()=>{
 const data=Buffer.from(JSON.stringify({url:'https://cdn.test/init.mp4'})).toString('base64url')
 assert.equal(resourceIdentity(`${base}?token=${data}.old`),resourceIdentity(`${base}?token=${data}.new`))
})
