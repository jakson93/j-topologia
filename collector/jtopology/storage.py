"""SQLite persists latest facts, observation history, changes and discovery diagnostics."""
import hashlib
import json
import sqlite3
import threading
from pathlib import Path
from .models import Batch, TABLES, now_ms

def fingerprint(value: object) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()

class Store:
    def __init__(self, path: str = ':memory:'):
        if path != ':memory:':
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.lock = threading.RLock()
        self.db.executescript('''
          PRAGMA journal_mode=WAL;
          CREATE TABLE IF NOT EXISTS facts(kind TEXT, id TEXT, device TEXT, source TEXT, observed INTEGER, payload TEXT, PRIMARY KEY(kind,id,source));
          CREATE TABLE IF NOT EXISTS observations(seq INTEGER PRIMARY KEY, kind TEXT,id TEXT,source TEXT,observed INTEGER,payload TEXT);
          CREATE INDEX IF NOT EXISTS obs_time ON observations(observed);
          CREATE INDEX IF NOT EXISTS obs_entity ON observations(kind,id,source,observed);
          CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,entity TEXT,time INTEGER,kind TEXT,event_type TEXT,before_value TEXT,after_value TEXT);
          CREATE INDEX IF NOT EXISTS events_time ON events(time);
          CREATE TABLE IF NOT EXISTS discovery_logs(seq INTEGER PRIMARY KEY,time INTEGER,device TEXT,source TEXT,stage TEXT,outcome TEXT,message TEXT);
          CREATE INDEX IF NOT EXISTS logs_time ON discovery_logs(time);
        ''')

    def log(self, device: str, source: str, stage: str, outcome: str, message: str):
        # Callers supply sanitized summaries, never raw command output or exceptions with secrets.
        with self.lock, self.db:
            self.db.execute('INSERT INTO discovery_logs(time,device,source,stage,outcome,message) VALUES(?,?,?,?,?,?)',
                (now_ms(),device,source,stage,outcome,message[:1000]))

    def save(self, batch: Batch):
        with self.lock, self.db:
            for kind, rows in batch.tables.items():
                for row in rows:
                    previous = self.db.execute('SELECT payload,observed FROM facts WHERE kind=? AND id=? AND source=?',
                        (kind,row['id'],batch.source)).fetchone()
                    if previous and previous['observed'] > batch.observed_at:
                        continue
                    before = json.loads(previous['payload']) if previous else None
                    compare_key = 'hops' if kind == 'paths' else 'cost' if kind == 'ospf' else None
                    def comparison(record):
                        value=record.get(compare_key)
                        return [(h.get('routerId'),h.get('outgoingInterface')) if isinstance(h,dict) else h for h in value] if compare_key=='hops' and isinstance(value,list) else value
                    if before is not None and compare_key and row.get(compare_key) is not None and comparison(before) != comparison(row):
                        event_type = 'PATH_CHANGE' if kind == 'paths' else 'OSPF_COST_CHANGE'
                        event_id = fingerprint([kind,row['id'],batch.observed_at,before.get(compare_key),row.get(compare_key)])
                        self.db.execute('INSERT OR IGNORE INTO events VALUES(?,?,?,?,?,?,?)',
                            (event_id,row['id'],batch.observed_at,'mpls' if kind=='paths' else 'ospf',event_type,json.dumps(before.get(compare_key)),json.dumps(row.get(compare_key))))
                    provenance={**(before or {}).get('provenance',{})}
                    for key in row:
                        if key not in {'provenance','observedAt','dataSource'}:provenance[key]={'dataSource':batch.source,'observedAt':batch.observed_at}
                    merged={**(before or {}),**row,'provenance':provenance}
                    payload=json.dumps(merged,sort_keys=True)
                    self.db.execute('INSERT INTO facts VALUES(?,?,?,?,?,?) ON CONFLICT(kind,id,source) DO UPDATE SET device=excluded.device,observed=excluded.observed,payload=excluded.payload',
                        (kind,row['id'],batch.device_id,batch.source,batch.observed_at,payload))
                    def content(record):return {k:v for k,v in record.items() if k not in {'observedAt','provenance','dataSource'}}
                    changed=before is None or content(before)!=content(merged)
                    previous_history=self.db.execute('SELECT observed FROM observations WHERE kind=? AND id=? AND source=? ORDER BY observed DESC LIMIT 1',
                        (kind,row['id'],batch.source)).fetchone()
                    if kind!='collector' and (kind=='interfaces' or changed or previous_history is None or batch.observed_at-previous_history['observed']>=3600000):
                        historical=merged
                        if kind=='interfaces':
                            fields={'id','nodeId','name','ifIndex','dataSource','observedAt','physicalStatus','rxBps','txBps','rxOctets','txOctets','errorCounter','discardCounter','errorsPerSecond','discardsPerSecond'}
                            historical={k:v for k,v in merged.items() if k in fields}
                        self.db.execute('INSERT INTO observations(kind,id,source,observed,payload) VALUES(?,?,?,?,?)',
                            (kind,row['id'],batch.source,batch.observed_at,json.dumps(historical,sort_keys=True)))
            for kind in batch.authoritative:
                ids=[row['id'] for row in batch.tables.get(kind,[])]
                placeholders=','.join('?' for _ in ids)
                self.db.execute(f'DELETE FROM facts WHERE kind=? AND device=? AND source=? AND observed<=?'+
                    (f' AND id NOT IN ({placeholders})' if ids else ''), (kind,batch.device_id,batch.source,batch.observed_at,*ids))
        for warning in batch.warnings:
            self.log(batch.device_id,batch.source,'parse','incomplete',warning)

    def snapshot(self, at: int | None = None, max_age_ms: int = 300000) -> dict:
        at = now_ms() if at is None else at
        priority={'netconf':0,'snmp':1,'cli':2,'fixture':3}
        with self.lock:
            rows=self.db.execute('SELECT kind,id,source,observed,payload FROM facts WHERE observed<=?',(at,)).fetchall()
        grouped={}
        for row in rows:
            grouped.setdefault((row['kind'],row['id']),[]).append(row)
        output={kind:[] for kind in TABLES}
        for (kind,_), sources in grouped.items():
            # Fresh observations beat stale facts; per-field provenance is retained for merged records.
            sources.sort(key=lambda r:(at-r['observed']>max_age_ms,priority.get(r['source'],9),-r['observed']))
            record={}; provenance={}; choices={}
            for row in sources:
                payload=json.loads(row['payload'])
                for key,value in payload.items():
                    meta=payload.get('provenance',{}).get(key,{'dataSource':row['source'],'observedAt':row['observed']})
                    choice=(at-meta['observedAt']>max_age_ms,priority.get(row['source'],9),-meta['observedAt'])
                    if key!='provenance' and value is not None and value != '' and (key not in choices or choice<choices[key]):
                        record[key]=value
                        provenance[key]=meta;choices[key]=choice
            record['provenance']=provenance
            output[kind].append(record)
        return output

    def history(self, kind: str, entity: str, since: int, limit: int = 2000):
        with self.lock:
            rows=self.db.execute('SELECT payload FROM observations WHERE kind=? AND id=? AND observed>=? ORDER BY observed DESC LIMIT ?',
                (kind,entity,since,min(limit,5000))).fetchall()
        return [json.loads(r['payload']) for r in reversed(rows)]

    def events(self, since: int = 0, limit: int = 1000):
        with self.lock:
            return [dict(row) for row in self.db.execute('SELECT * FROM events WHERE time>=? ORDER BY time DESC LIMIT ?', (since,min(limit,5000)))]

    def logs(self, limit: int = 100):
        with self.lock:
            return [dict(row) for row in self.db.execute('SELECT * FROM discovery_logs ORDER BY seq DESC LIMIT ?', (min(limit,1000),))]

    def prune(self, days: int = 30, metric_days: int = 7):
        cutoff=now_ms()-days*86400000
        with self.lock,self.db:
            self.db.execute("DELETE FROM observations WHERE kind='interfaces' AND observed<?",(now_ms()-metric_days*86400000,))
            for table, field in [('observations','observed'),('events','time'),('discovery_logs','time')]:
                self.db.execute(f'DELETE FROM {table} WHERE {field}<?',(cutoff,))
