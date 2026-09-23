import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectMcp, approvedEndpoint } from '../lib/mcp-client.ts';
const url = new URL('https://mcp.example/mcp');
function server(options = {}) {
  const calls = [];
  const fetch = async (_url, request) => {
    calls.push(request);
    if (request.method === 'DELETE') return new Response(null, {status: 204});
    const body = JSON.parse(request.body);
    if (body.method === 'initialize') return Response.json({jsonrpc:'2.0',id:body.id,result:{protocolVersion:options.version ?? '2025-06-18', capabilities:options.noTools ? {} : {tools:{}}, serverInfo:{name:'fixture',version:'1'}}}, {headers:options.stateless ? {} : {'Mcp-Session-Id':'fixture-session'}});
    assert.equal(request.headers['MCP-Protocol-Version'],'2025-06-18');
    assert.equal(request.headers['Mcp-Session-Id'], options.stateless ? undefined : 'fixture-session');
    assert.equal(request.headers.Authorization, 'Bearer test-only');
    if (body.method === 'notifications/initialized') return new Response(null,{status: options.notifyStatus ?? 202});
    const result = {tools:[{name:body.params.cursor ? 'second':'first',inputSchema:{type:'object'}}], ...(options.paginate && !body.params.cursor ? {nextCursor:'page2'} : {})};
    if (options.repeat) result.nextCursor = 'page2';
    if (options.malformed) return new Response('{bad JSON');
    if (options.large) return new Response('x'.repeat(1_000_001));
    if (options.stream) {
      const text = `: heartbeat\r\nevent: message\r\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\r\n\r\ndata: {"jsonrpc":"2.0","id":"other","result":{}}\r\n\r\ndata: ${JSON.stringify({jsonrpc:'2.0',id:body.id,result})}\r\n\r\n`;
      // Deliberately keep the connection open after a result; split UTF-8 chunks.
      return new Response(new ReadableStream({start(c){const bytes=new TextEncoder().encode(text); for(let n=0;n<bytes.length;n+=7)c.enqueue(bytes.slice(n,n+7));}}), {headers:{'Content-Type':'text/event-stream'}});
    }
    return Response.json({jsonrpc:'2.0',id:options.wrongId?'wrong':body.id,result});
  };
  return {fetch,calls};
}
test('stateful handshake, negotiated headers, paginated discovery and cleanup', async()=>{
 const s=server({paginate:true}); const r=await inspectMcp(url,'test-only',true,s);
 assert.deepEqual(r.tools.map(t=>t.name),['first','second']); assert.equal(r.tools[0].enabled,false);
 assert.equal(s.calls.at(-1).method,'DELETE');
});
test('stateless servers still receive negotiated protocol header',async()=>{const s=server({stateless:true});await inspectMcp(url,'test-only',true,s);assert.equal(s.calls.length,3);});
test('SSE parses split chunks, skips notifications and mismatched responses, finishes without EOF',async()=>{const s=server({stream:true});const r=await inspectMcp(url,'test-only',true,s);assert.equal(r.tools[0].name,'first');});
test('does not call tools/list without advertised capability',async()=>{const s=server({noTools:true});assert.deepEqual((await inspectMcp(url,'test-only',true,s)).tools,[]);assert.equal(s.calls.length,3);});
for (const [name,opts,pattern] of [
 ['failed initialized notification',{notifyStatus:401},/authentication/],
 ['unsupported protocol',{version:'2099-01-01'},/unsupported/],
 ['wrong response id',{wrongId:true},/different request/],
 ['malformed response',{malformed:true},/malformed/],
 ['oversized response',{large:true},/1 MB/],
 ['pagination loop',{repeat:true},/pagination/],
]) test(name,async()=>{await assert.rejects(inspectMcp(url,'test-only',true,server(opts)),pattern);});
test('rejects unapproved hosts, embedded credentials and invalid URLs',()=>{for(const u of ['http://mcp.example/mcp','https://mcp.example.evil/mcp','https://user:pass@mcp.example/mcp','bad'])assert.throws(()=>approvedEndpoint(u,'mcp.example'));assert.equal(approvedEndpoint(url.href,' mcp.example ').hostname,'mcp.example');});
test('network failure is actionable and does not disclose tokens',async()=>{await assert.rejects(inspectMcp(url,'secret',true,{fetch:async()=>{throw new Error('secret');}}),e=>/Unable to reach/.test(e.message)&&!e.message.includes('secret'));});
test('deadline aborts stalled requests',async()=>{const keepAlive=setTimeout(()=>{},1000);try{await assert.rejects(inspectMcp(url,'',false,{timeoutMs:5,fetch:async(_u,r)=>new Promise((_resolve,reject)=>{r.signal.addEventListener('abort',()=>reject(r.signal.reason));})}),/timed out/);}finally{clearTimeout(keepAlive);}});
