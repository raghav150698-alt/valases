"""Apply the one-shot launch coordinator and validate RLS without launching."""
import json
from pathlib import Path
from uuid import UUID
from dotenv import dotenv_values
from sqlalchemy import create_engine,text
ROOT=Path(__file__).resolve().parents[2]
v=dotenv_values(ROOT/'secrets/valases-new-project.env')
engine=create_engine(v['NEW_DATABASE_URL'],connect_args={'connect_timeout':15,'prepare_threshold':None})
with engine.begin() as db:
 owner=db.execute(text("select id from auth.users where lower(email)='raghavendra@valases.com' and email_confirmed_at is not null")).scalar_one()
 owner=str(UUID(str(owner)))
 sql=(Path(__file__).parent/'schema.sql').read_text(encoding='utf-8').replace('$OWNER_ID$',owner)
 db.exec_driver_sql(sql)
 (ROOT/'.vercel-release/launch-owner-public.json').write_text(json.dumps({'id':owner}),encoding='utf-8')
 print('Launch coordinator installed; owner restricted to the confirmed internal Auth account.')
with engine.connect() as db:
 transaction=db.begin()
 try:
  before=db.execute(text("select launched_at from public.valases_launch_event where event_key='tests-launch-20261111'")).scalar_one()
  assert before is None,'Launch already happened; refusing to perform launch-state tests.'
  db.exec_driver_sql('set local role anon')
  assert db.execute(text('select count(*) from public.valases_launch_event')).scalar_one()==1
  assert not db.execute(text("select has_function_privilege('anon','public.launch_valases_once()','EXECUTE')")).scalar_one()
  assert not db.execute(text("select has_column_privilege('anon','public.valases_launch_event','launched_at','UPDATE')")).scalar_one()
  db.exec_driver_sql('reset role');db.exec_driver_sql('set local role authenticated')
  db.execute(text("select set_config('request.jwt.claim.sub',:id,true)"),{'id':'00000000-0000-0000-0000-000000000001'})
  point=db.begin_nested()
  try:db.execute(text('select public.launch_valases_once()'));raise AssertionError('Non-owner launched')
  except Exception as error:
   point.rollback()
   if isinstance(error,AssertionError):raise
  db.execute(text("select set_config('request.jwt.claim.sub',:id,true)"),{'id':owner})
  first=db.execute(text('select public.launch_valases_once()')).scalar_one()
  second=db.execute(text('select public.launch_valases_once()')).scalar_one()
  assert first['launchedAt'] and first==second
  changed=db.execute(text("update public.valases_launch_event set launched_at=null where event_key='tests-launch-20261111'"))
  assert changed.rowcount==0
  print('PASS: anonymous read only; anonymous launch denied; non-owner denied; owner once only; reset denied. All test changes rolled back.')
 finally:transaction.rollback()
with engine.connect() as db:
 assert db.execute(text("select launched_at from public.valases_launch_event where event_key='tests-launch-20261111'")).scalar_one() is None
 print('Verified production launch remains UNPRESSED.')
