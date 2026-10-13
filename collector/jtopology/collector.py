import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from .models import Batch, Device, now_ms, stable
from .drivers import CliDriver, NetconfDriver, SnmpDriver
from .storage import Store

DEFAULT_INTERVALS={'interfaces':30,'ospf':30,'cost':60,'tunnels':30,'paths':30,'services':300,'pws':300,'lsps':300,'identity':1800}
GROUP_TABLE={'identity':'nodes','interfaces':'interfaces','ospf':'ospf','cost':'ospf','tunnels':'tunnels','paths':'paths','services':'services','pws':'pws','lsps':'lsps'}

class NetworkCollector:
    def __init__(self,store:Store,devices:list[Device],intervals:dict|None=None,drivers=None):
        self.store=store;self.devices={d.id:d for d in devices};self.intervals={**DEFAULT_INTERVALS,**(intervals or {})}
        if set(self.intervals)-set(DEFAULT_INTERVALS):raise ValueError('Unknown polling domain')
        if any(not isinstance(v,(int,float)) or v<15 for v in self.intervals.values()):raise ValueError('Polling intervals must be at least 15 seconds')
        self.drivers=drivers or [NetconfDriver(),SnmpDriver(),CliDriver()]
        self.last={};self.locks={d.id:threading.Lock() for d in devices};self.stop_event=threading.Event()

    def discoverDevice(self,device_id:str,force:bool=False):
        if device_id not in self.devices:raise KeyError(device_id)
        device=self.devices[device_id];lock=self.locks[device_id]
        if not lock.acquire(blocking=False):return {'deviceId':device_id,'status':'already_running'}
        try:
            now=time.monotonic();groups={group for group,interval in self.intervals.items() if force or now-self.last.get((device_id,group),-1e15)>=interval}
            if not groups:return {'deviceId':device_id,'status':'cached'}
            needed=set(groups);results=[]
            for driver in self.drivers:
                enabled=bool(device.netconf) if driver.source=='netconf' else bool(device.snmp) if driver.source=='snmp' else device.cli_enabled and bool(device.ssh)
                if not enabled or not needed:continue
                requested=set(needed)
                if driver.source=='cli':
                    if 'cost' in requested:requested.add('ospf')
                    if 'pws' in requested:requested.add('services')
                started=time.monotonic()
                try:
                    batch=driver.collect(device,requested)
                    self._counter_rates(batch)
                    self.store.save(batch)
                    delivered={g for g in needed if batch.tables.get(GROUP_TABLE[g]) and
                        (g!='cost' or any(row.get('cost') is not None for row in batch.tables.get('ospf',[])))}
                    needed-=delivered
                    status='ok' if delivered else 'incomplete'
                    self.store.log(device_id,driver.source,'discovery',status,json.dumps({'requested':sorted(requested),'delivered':sorted(delivered),
                        'durationMs':int((time.monotonic()-started)*1000),'counts':{k:len(v) for k,v in batch.tables.items()},'warningCount':len(batch.warnings)}))
                    poll=Batch(device_id,driver.source,now_ms())
                    poll.add('collector',{'id':stable(device_id,driver.source),'protocol':driver.source,'status':status,'lastPoll':now_ms(),'modules':sorted(delivered),'warningCount':len(batch.warnings)})
                    self.store.save(poll);results.append({'source':driver.source,'status':status,'modules':sorted(delivered)})
                except Exception as exc:
                    # Library exceptions may embed passwords, communities, raw XML or banners.
                    self.store.log(device_id,driver.source,'discovery','error',f'{type(exc).__name__}; check server credentials, host-key trust, ACLs, protocol and VRP profile')
                    poll=Batch(device_id,driver.source,now_ms());poll.add('collector',{'id':stable(device_id,driver.source),'protocol':driver.source,'status':'error','lastAttempt':now_ms()});self.store.save(poll)
                    if driver.source=='snmp':
                        unknown=Batch(device_id,'snmp',now_ms());unknown.add('nodes',{'id':device_id,'snmpStatus':'unknown'});self.store.save(unknown)
                    results.append({'source':driver.source,'status':'error','errorType':type(exc).__name__})
            for group in groups:self.last[(device_id,group)]=now
            return {'deviceId':device_id,'status':'complete' if not needed else 'incomplete','missingModules':sorted(needed),'sources':results}
        finally:lock.release()

    def _counter_rates(self,batch):
        for row in batch.tables.get('interfaces',[]):
            for counter,rate in [('rxOctets','rxBps'),('txOctets','txBps'),('errorCounter','errorsPerSecond'),('discardCounter','discardsPerSecond')]:
                if counter in row:row[rate]=None
            previous=self.store.history('interfaces',row['id'],batch.observed_at-300000,20)
            prev=next((p for p in reversed(previous) if p.get('dataSource')==batch.source and p['observedAt']<batch.observed_at),None)
            if not prev:continue
            elapsed=(batch.observed_at-prev['observedAt'])/1000
            if elapsed<=0 or elapsed>300:continue
            # Counter reset/wrap is unknown; never create a traffic spike from a negative delta.
            for counter,rate,factor in [('rxOctets','rxBps',8),('txOctets','txBps',8),('errorCounter','errorsPerSecond',1),('discardCounter','discardsPerSecond',1)]:
                a=prev.get(counter);b=row.get(counter)
                if isinstance(a,(int,float)) and isinstance(b,(int,float)) and b>=a:row[rate]=(b-a)*factor/elapsed

    def discoverNetwork(self,force:bool=False):
        with ThreadPoolExecutor(max_workers=min(4,max(1,len(self.devices)))) as pool:
            return list(pool.map(lambda identifier:self.discoverDevice(identifier,force),self.devices))

    def run(self):
        last_pruned=-1e15
        while not self.stop_event.is_set():
            self.discoverNetwork()
            if time.monotonic()-last_pruned>=3600:
                self.store.prune();last_pruned=time.monotonic()
            self.stop_event.wait(5)

def load_config(path:str):
    config=json.loads(Path(path).read_text())
    devices=[Device(**d) for d in config.get('devices',[])]
    if len({d.id for d in devices})!=len(devices):raise ValueError('Duplicate seed device ID')
    # Only the explicitly configured management seeds are contacted, never arbitrary discovered IPs.
    return devices,config.get('intervals',{})
