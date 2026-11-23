import test from "node:test";
import assert from "node:assert/strict";
import { acquireWikipedia, findKnowledge, knowledgeContext, knowledgeTerms } from "../.test-build/functions/_knowledge.js";

class KnowledgeDB {
  rows = new Map();
  prepare(sql) {
    let values=[];
    const db=this;
    return {
      bind(...args){values=args;return this;},
      async run(){
        if(sql.startsWith("INSERT OR IGNORE INTO knowledge")){
          const [id,title,extract,source_url,search_text,created_at]=values;
          if(!db.rows.has(source_url)) db.rows.set(source_url,{id,title,extract,source_url,source_name:"Wikipedia",search_text,created_at});
        }
        return {meta:{changes:1}};
      },
      async first(){
        if(sql.includes("WHERE source_url = ?")) return db.rows.get(values[0]) || null;
        return null;
      },
      async all(){
        const terms=values.map(v=>String(v).replaceAll("%","").toLowerCase());
        const results=[...db.rows.values()].filter(row=>terms.some(term=>(row.title+" "+row.search_text).toLowerCase().includes(term)));
        return {results};
      }
    };
  }
}

test("knowledge query tokenization removes common filler words",()=>{
  assert.deepEqual(knowledgeTerms("What is quantum mechanics?"),["quantum","mechanics"]);
});

test("Wikipedia pages are acquired, deduplicated, and made available for retrieval",async()=>{
  const originalFetch=globalThis.fetch;
  const calls=[];
  globalThis.fetch=async input=>{
    const url=String(input);calls.push(url);
    if(url.includes("list=search")){
      return new Response(JSON.stringify({query:{search:[{pageid:42,title:"Quantum mechanics"}]}}),{status:200,headers:{"content-type":"application/json"}});
    }
    return new Response(JSON.stringify({query:{pages:[{
      pageid:42,title:"Quantum mechanics",
      extract:"Quantum mechanics is a fundamental theory in physics. ".repeat(8),
      fullurl:"https://en.wikipedia.org/wiki/Quantum_mechanics",
      pageprops:{}
    }]}}),{status:200,headers:{"content-type":"application/json"}});
  };
  try{
    const env={DB:new KnowledgeDB()};
    const first=await acquireWikipedia(env,"quantum mechanics");
    const second=await acquireWikipedia(env,"quantum mechanics");
    assert.equal(first.length,1);
    assert.equal(second.length,1);
    assert.equal(first[0].title,"Quantum mechanics");
    assert.equal(first[0].source_name,"Wikipedia");
    assert.equal(calls.length,4);
    const found=await findKnowledge(env,"Explain quantum mechanics");
    assert.equal(found.length,1);
    const context=knowledgeContext(found);
    assert.match(context,/\[Source 1\]/);
    assert.match(context,/https:\/\/en\.wikipedia\.org\/wiki\/Quantum_mechanics/);
    assert.match(context,/untrusted data/);
  }finally{globalThis.fetch=originalFetch;}
});
