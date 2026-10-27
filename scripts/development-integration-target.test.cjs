const {test}=require('node:test');const assert=require('node:assert/strict');
const {validateDevelopmentDescriptor,metadata}=require('./development-integration-target.cjs');
const url='postgresql://postgres.testproject:fixture-only@aws-0-us-west-1.pooler.supabase.com:5432/postgres?schema=bbe_ui_it_organization_abcd1234';
const descriptor={status:'READY',suite:'organization',schema:'bbe_ui_it_organization_abcd1234',projectRef:'testproject',database:'postgres',backupSha256:'backup',foreignKeysOutsideSchema:0};
const inspection={target:{projectRef:'testproject',database:'postgres'},directTarget:{projectRef:'testproject',database:'postgres'}};
const backup={projectRef:'testproject',database:'postgres',cipherSha256:'backup',roundTripVerified:true,dpapiRestoreVerified:true,createdAt:new Date().toISOString()};
descriptor.connectionFingerprint=metadata(url).fingerprint;
inspection.directTarget.fingerprint=metadata(url).fingerprint;
test('explicit development mode names the real project/database and a registered isolated schema',()=>{assert.equal(validateDevelopmentDescriptor(url,'organization',descriptor,inspection,backup).schema,descriptor.schema);});
test('public/system/foreign or mismatched targets are rejected',()=>{
  for(const value of [url.replace('schema=bbe_ui_it_organization_abcd1234','schema=public'),url.replace('schema=bbe_ui_it_organization_abcd1234','schema=auth'),url.replace('testproject:','otherproject:'),url.replace('/postgres?','/other?'),url.replace('pooler.supabase.com','evil.invalid')])assert.throws(()=>validateDevelopmentDescriptor(value,'organization',descriptor,inspection,backup));
  assert.throws(()=>validateDevelopmentDescriptor(url,'leaderboard',descriptor,inspection,backup));
});
test('missing backup, incomplete namespace and stale receipt cannot authorize writes',()=>{
  assert.throws(()=>validateDevelopmentDescriptor(url,'organization',{...descriptor,status:'PLAN_ONLY'},inspection,backup));
  assert.throws(()=>validateDevelopmentDescriptor(url,'organization',{...descriptor,foreignKeysOutsideSchema:1},inspection,backup));
  assert.throws(()=>validateDevelopmentDescriptor(url,'organization',descriptor,inspection,{...backup,roundTripVerified:false}));
  assert.throws(()=>validateDevelopmentDescriptor(url,'organization',descriptor,inspection,{...backup,createdAt:new Date(0).toISOString()}));
  assert.throws(()=>validateDevelopmentDescriptor(url,'organization',descriptor,inspection,{...backup,createdAt:'invalid'}));
});
