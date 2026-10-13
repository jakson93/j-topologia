import hmac
import json
import os
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from .collector import NetworkCollector, load_config
from .graph import DependencyGraph
from .models import now_ms
from .storage import Store

def token(name):
    file=os.environ.get(name+'_FILE')
    value=Path(file).read_text().strip() if file else os.environ.get(name,'')
    if len(value)<24:raise RuntimeError(f'{name} must be configured server-side (at least 24 characters)')
    return value

def create_app(store=None,collector=None,read_token=None,admin_token=None,start_polling=True):
    state_store=store or Store(os.environ.get('JTOPOLOGY_DB','/data/jtopology.sqlite'))
    read_secret=read_token or token('JTOPOLOGY_READ_TOKEN')
    admin_secret=admin_token or token('JTOPOLOGY_ADMIN_TOKEN')
    if hmac.compare_digest(read_secret,admin_secret):raise RuntimeError('Use separate read and administration tokens')
    if collector is None:
        devices,intervals=load_config(os.environ.get('JTOPOLOGY_CONFIG','/config/devices.json'))
        collector=NetworkCollector(state_store,devices,intervals)
    @asynccontextmanager
    async def lifespan(app):
        thread=threading.Thread(target=collector.run,daemon=True) if start_polling else None
        if thread:thread.start()
        yield
        collector.stop_event.set()
        if thread:thread.join(timeout=5)
    app=FastAPI(title='j-topologia NetworkCollector',version='0.1.0',lifespan=lifespan,docs_url=None,redoc_url=None,openapi_url=None)
    def authorize(expected,authorization):
        if not authorization or not hmac.compare_digest(authorization,'Bearer '+expected):raise HTTPException(401,'Unauthorized')
    def read_auth(authorization:str|None=Header(default=None)):authorize(read_secret,authorization)
    def admin_auth(authorization:str|None=Header(default=None)):authorize(admin_secret,authorization)
    def graph():return DependencyGraph(state_store.snapshot(),max_age_ms=int(os.environ.get('JTOPOLOGY_STALE_SECONDS','300'))*1000)
    @app.get('/health')
    def health():return {'status':'ok','component':'NetworkCollector'}
    @app.get('/snapshot',dependencies=[Depends(read_auth)])
    def snapshot():
        g=graph();rows=g.grafana_rows()
        rows['jtopology_events']=[{'id':e['id'],'entityId':g.paths.get(e['entity'],{}).get('tunnelId',e['entity']),
            'kind':e['kind'],'time':e['time'],'severity':'warning','message':f'{e["event_type"]}: {e["before_value"]} → {e["after_value"]}'} for e in state_store.events()]
        return rows
    @app.get('/service-path/{vsi:path}',dependencies=[Depends(read_auth)])
    def service_path(vsi:str):
        g=graph();identifier=vsi
        if vsi not in g.services:
            matches=[s['id'] for s in g.services.values() if s.get('name')==vsi]
            if len(matches)>1:raise HTTPException(409,'VSI name is not unique. Use the discovered ID.')
            if len(matches)==1:identifier=matches[0]
        result=g.service_path(identifier)
        if result is None:raise HTTPException(404,'VSI not discovered')
        return result
    @app.get('/impact/{link:path}',dependencies=[Depends(read_auth)])
    def impact(link:str):return graph().impact(link)
    @app.get('/events',dependencies=[Depends(read_auth)])
    def events(since:int=0):return state_store.events(since)
    @app.get('/history/{kind}/{entity:path}',dependencies=[Depends(read_auth)])
    def history(kind:str,entity:str,since:int=Query(default=0,ge=0)):return state_store.history(kind,entity,since)
    @app.get('/collector/status',dependencies=[Depends(read_auth)])
    def status():return {'at':now_ms(),'collectors':state_store.snapshot()['collector'],'recentLogs':state_store.logs()}
    @app.post('/discover/device/{device_id}',dependencies=[Depends(admin_auth)])
    def discover_device(device_id:str):
        if device_id not in collector.devices:raise HTTPException(404,'Seed device not registered')
        return collector.discoverDevice(device_id,force=True)
    @app.post('/discover/network',dependencies=[Depends(admin_auth)])
    def discover_network():return collector.discoverNetwork(force=True)
    return app

def app_factory():return create_app()
