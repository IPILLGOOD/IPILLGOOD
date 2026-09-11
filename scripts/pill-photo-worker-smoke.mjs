import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { validatePillCatalogSnapshot } from '../backend/src/pill-catalog-snapshot.ts';
import { classifyPillForm } from '../backend/src/pill-form-policy.ts';
import { migrateObservedPillSideV1 } from '../backend/src/pill-identification.ts';
import { PILL_WEB_IMAGE_NAMES, PILL_WEB_PREPROCESSING_VERSION } from '../backend/src/pill-photo-web-contract.ts';

// Explicit OFFLINE regression: original historical timestamps are preserved. No deployed files are touched.
const snapshot = JSON.parse(gunzipSync(readFileSync('backend/test-support/pill-photo-fixtures/catalog.json.gz')));
assert.equal(validatePillCatalogSnapshot(snapshot).ok, true);
const assets = new Map(); const chunks = [];
for (let at = 0; at < snapshot.items.length; at += 1000) {
  const items = snapshot.items.slice(at, at + 1000); const bytes = Buffer.from(JSON.stringify(items));
  const sha256 = createHash('sha256').update(bytes).digest('hex'); const path = `/pill-catalog/${sha256}.json`;
  chunks.push({ path, count: items.length, bytes: bytes.length, sha256 }); assets.set(path, bytes);
}
const manifest = { schemaVersion: 'pill-web-catalog.v1', version: snapshot.version, verifiedAt: snapshot.verifiedAt, totalCount: snapshot.totalCount, chunks };
assets.set('/pill-catalog/manifest.json', Buffer.from(JSON.stringify(manifest)));
const item = snapshot.items.find(item => classifyPillForm(item.formName).status === 'supported' && item.front.imprint?.length >= 3 && item.back.imprint?.length >= 2 && item.shape === '원형' && item.colors.length === 1 && item.colors[0] === '하양');
const observation = { schemaVersion: 'pill-observation.v2', form: classifyPillForm(item.formName).form, integrity: 'intact', count: 1, overlapping: false, quality: 'clear', shape: item.shape, colors: item.colors,
  front: migrateObservedPillSideV1({ imprint: item.front.imprint, scoreLine: item.front.scoreLine }), back: migrateObservedPillSideV1({ imprint: item.back.imprint, scoreLine: item.back.scoreLine }) };
const result = await build({ stdin: { contents: `
import { parsePillWebUpload, analyzePillWebPhotos } from './backend/src/pill-photo-web.ts';
import { readPillWebManifest, readPillWebChunks } from './backend/src/pill-catalog-web.ts';
const observation = ${JSON.stringify(observation)};
export default { async fetch(request, env) {
 const started = Date.now();
 const readAsset = path => env.ASSETS.fetch(new Request('https://assets.local' + path));
 // The explicit historical clock is confined to this offline test harness.
 const manifest = await readPillWebManifest(readAsset, ${Date.parse(snapshot.verifiedAt)});
 const images = await parsePillWebUpload(await request.formData()); let calls = 0;
 const result = await analyzePillWebPhotos(images, { apiKey:'synthetic-key', model:'synthetic-model', catalog: {version:manifest.version, verifiedAt:manifest.verifiedAt, totalCount:manifest.totalCount}, chunks:()=>readPillWebChunks(manifest,readAsset), fetchImpl: async () => {
   const index = calls++; const side = index === 1 ? observation.front : observation.back;
   const features = index === 0 ? {observation,pairConsistency:'consistent',bothSidesVisible:true,imageArtifact:'none'} : {schemaVersion:'pill-photo-imprint-ocr-side.v2', side: {imprintCandidates:side.imprintCandidates,noImprintObserved:side.noImprintObserved,imprintVisibility:side.imprintVisibility}};
   return Response.json({status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(features)}]}]});
 }});
 return Response.json({calls,elapsedMs:Date.now()-started,result});
}};`, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, format:'esm', platform:'browser', external:['node:*'], write:false, metafile:true });
assert.ok(!Object.keys(result.metafile.inputs).some(path => /sharp|pill-photo-preprocessing\.ts$/.test(path)), 'native preprocessing must not enter the Worker bundle');
let assetReads = 0;
const mf = new Miniflare(convertV4MiniflareOptions({ name:"pill-photo-smoke", modules:true, script:result.outputFiles[0].text, compatibilityDate:'2026-08-16', compatibilityFlags:['nodejs_compat'], serviceBindings:{ ASSETS: async request => { assetReads++; const bytes=assets.get(new URL(request.url).pathname); return bytes ? new Response(bytes) : new Response('missing',{status:404}); } } }));
try {
 const form = new FormData(); form.set('consent','true'); form.set('version',PILL_WEB_PREPROCESSING_VERSION);
 const [front,back] = await Promise.all(['white','gray'].map(background=>sharp({create:{width:768,height:768,channels:3,background}}).jpeg().toBuffer()));
 for(const name of PILL_WEB_IMAGE_NAMES) form.set(name,new File([name.startsWith('front')?front:back],'synthetic.jpg',{type:'image/jpeg'}));
 const encoded = new Request('https://test.local/analyze',{method:'POST',body:form});
 const response = await mf.dispatchFetch(encoded.url,{method:'POST',headers:{'content-type':encoded.headers.get('content-type')},body:await encoded.arrayBuffer()});
 assert.equal(response.status,200,await response.clone().text());
 const body=await response.json(); assert.equal(body.calls,3); assert.equal(body.result.comparison.status,'searched');
 assert.equal(body.result.comparison.search.metrics.catalogRecords,snapshot.totalCount);
 assert.equal(assetReads,chunks.length+1);
 assert.ok(body.result.comparison.search.candidates.some(candidate=>candidate.itemSeq===item.itemSeq));
 const summary={runtime:'workerd',network:'mock provider + local asset binding only',historicalClock:snapshot.verifiedAt,records:snapshot.totalCount,chunks:chunks.length,assetReads,modelRequests:body.calls,elapsedMs:body.elapsedMs,comparison:body.result.comparison.search.status,bundleBytes:result.outputFiles[0].contents.length,nativeDecoderBundled:false};
 mkdirSync('verification-artifacts',{recursive:true});
 writeFileSync('verification-artifacts/pill-web-worker-smoke.json',JSON.stringify(summary,null,2)); console.log(JSON.stringify(summary,null,2));
} finally { await mf.dispose(); }
