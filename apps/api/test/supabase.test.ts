import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
test('Supabase Data API roles cannot access the identity catalogue',async()=>{
  const pg=new PGlite();
  try {
    await pg.exec('create role anon; create role authenticated; create role nexo_app; create table users(id integer); create table equipamentos(id integer); grant select on users,equipamentos to public,anon,authenticated,nexo_app;');
    await pg.exec(await readFile(new URL('../src/db/restrict-data-api.sql',import.meta.url),'utf8'));
    await pg.exec(await readFile(new URL('../src/db/restrict-data-api.sql',import.meta.url),'utf8'));
    for(const role of ['anon','authenticated']){
      const result=await pg.query<{allowed:boolean}>("select has_table_privilege($1,'users','SELECT') as allowed",[role]);
      assert.equal(result.rows[0].allowed,false);
    }
    const own=await pg.query<{allowed:boolean}>("select has_table_privilege('nexo_app','users','SELECT') as allowed");
    assert.equal(own.rows[0].allowed,true);
  } finally {await pg.close();}
});

